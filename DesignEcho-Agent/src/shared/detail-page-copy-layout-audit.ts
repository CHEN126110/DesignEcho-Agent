import type { DetailScreenPlan } from './detail-page-screen-plan';
import { normalizeDetailRect } from './detail-page-anchor-diagnostics';

export interface DetailCopyLayoutPlaceholderSource {
    layerId: number;
    layerName?: string;
    currentText?: string;
    role?: string;
    fontSize?: number;
    bounds?: unknown;
}

export interface DetailCopyLayoutScreenSource {
    id: number;
    name: string;
    copyPlaceholders?: DetailCopyLayoutPlaceholderSource[];
}

export interface DetailCopyLayoutAuditMetrics {
    charCount: number;
    lineCount: number;
    longestLineChars: number;
    longestLineUnits: number;
    duplicateCount: number;
    fontMetricsReliable: boolean;
    estimatedLineWidth: number | null;
    widthUsage: number | null;
    boundsWidth: number | null;
    boundsHeight: number | null;
    fontSize: number | null;
}

export interface DetailCopyLayoutAuditItem {
    screenId: number;
    screenName: string;
    screenRole: DetailScreenPlan['screenRole'] | null;
    mainMessage: string | null;
    placeholderLayerId: number;
    placeholderLayerName: string;
    role: string;
    copyStrategy: DetailScreenPlan['copyStrategy'] | null;
    currentText: string;
    status: 'ok' | 'watch' | 'risky';
    warnings: string[];
    metrics: DetailCopyLayoutAuditMetrics;
}

export interface DetailCopyLayoutAuditResult {
    success: true;
    screens: DetailCopyLayoutScreenSource[];
    screenPlans: DetailScreenPlan[];
    audits: DetailCopyLayoutAuditItem[];
    warnings: string[];
    riskyScreenIds: number[];
    summary: {
        screenCount: number;
        copyPlaceholderCount: number;
        riskyCopyCount: number;
        watchCopyCount: number;
        warningCount: number;
    };
}

export interface DetailCopyLayoutAuditOptions {
    screens: DetailCopyLayoutScreenSource[];
    screenPlans?: DetailScreenPlan[];
    nearLimitThreshold?: number;
    overflowThreshold?: number;
}

export interface DetailFillPlanCopyProjectionSource {
    screenId: number;
    copies?: Array<{
        layerId: number;
        content?: string;
    }>;
}

function countDetailCopyChars(text: string): number {
    return String(text || '')
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .replace(/\n/g, '')
        .replace(/\s+/g, '')
        .length;
}

function countDetailCopyUnits(text: string): number {
    const normalized = String(text || '')
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .replace(/\n/g, '')
        .replace(/\s+/g, '');

    let total = 0;
    for (const char of normalized) {
        if (/[\u4E00-\u9FFF\u3400-\u4DBF\uF900-\uFAFF]/u.test(char)) {
            total += 1;
        } else if (/[A-Z]/.test(char)) {
            total += 0.72;
        } else if (/[a-z0-9]/.test(char)) {
            total += 0.62;
        } else {
            total += 0.5;
        }
    }
    return total;
}

export function applyDetailFillPlanCopiesToScreens<T extends DetailCopyLayoutScreenSource>(
    screens: T[],
    fillPlans: DetailFillPlanCopyProjectionSource[]
): T[] {
    const copyByScreenId = new Map<number, Map<number, string>>();
    for (const plan of fillPlans || []) {
        const planScreenId = Number(plan?.screenId || 0);
        if (!planScreenId || !Array.isArray(plan.copies) || plan.copies.length === 0) continue;

        const perScreen = new Map<number, string>();
        for (const copy of plan.copies) {
            const layerId = Number(copy?.layerId || 0);
            if (!layerId) continue;
            perScreen.set(layerId, String(copy?.content || ''));
        }
        if (perScreen.size > 0) {
            copyByScreenId.set(planScreenId, perScreen);
        }
    }

    return (screens || []).map((screen) => {
        const perScreen = copyByScreenId.get(Number(screen?.id || 0));
        if (!perScreen || !Array.isArray(screen?.copyPlaceholders) || screen.copyPlaceholders.length === 0) {
            return screen;
        }

        return {
            ...screen,
            copyPlaceholders: screen.copyPlaceholders.map((placeholder) => {
                const replacement = perScreen.get(Number(placeholder?.layerId || 0));
                if (replacement === undefined) return placeholder;
                return {
                    ...placeholder,
                    currentText: replacement
                };
            })
        };
    });
}

export function auditDetailCopyLayoutForScreens(options: DetailCopyLayoutAuditOptions): DetailCopyLayoutAuditResult {
    const screens = Array.isArray(options.screens) ? options.screens : [];
    const screenPlans = Array.isArray(options.screenPlans) ? options.screenPlans : [];
    const planByScreenId = new Map<number, DetailScreenPlan>();
    for (const plan of screenPlans) {
        planByScreenId.set(Number(plan.screenId || 0), plan);
    }

    const nearLimitThreshold = typeof options.nearLimitThreshold === 'number'
        ? Math.max(0.7, Math.min(1.2, options.nearLimitThreshold))
        : 0.9;
    const overflowThreshold = typeof options.overflowThreshold === 'number'
        ? Math.max(0.85, Math.min(1.5, options.overflowThreshold))
        : 1.08;

    const audits: DetailCopyLayoutAuditItem[] = [];
    const warnings: string[] = [];
    const riskyScreenIds = new Set<number>();

    for (const screen of screens) {
        const screenId = Number(screen?.id || 0);
        const screenName = String(screen?.name || screenId || '');
        const screenPlan = planByScreenId.get(screenId);
        const copyPlaceholders = Array.isArray(screen?.copyPlaceholders) ? screen.copyPlaceholders : [];

        const duplicateMap = new Map<string, number>();
        for (const placeholder of copyPlaceholders) {
            const rawText = String(placeholder?.currentText || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
            const duplicateKey = rawText.replace(/\s+/g, '').toLowerCase();
            if (duplicateKey) {
                duplicateMap.set(duplicateKey, (duplicateMap.get(duplicateKey) || 0) + 1);
            }
        }

        for (const placeholder of copyPlaceholders) {
            const placeholderLayerId = Number(placeholder?.layerId || 0);
            const placeholderLayerName = String(placeholder?.layerName || placeholderLayerId);
            const rawText = String(placeholder?.currentText || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
            const trimmedText = rawText.trim();
            const bounds = normalizeDetailRect(placeholder?.bounds);
            const fontSize = Number(placeholder?.fontSize || 0);
            const role = String(placeholder?.role || 'unknown');
            const copyStrategy = screenPlan?.copyStrategy || null;
            const lines = rawText.length > 0 ? rawText.split('\n') : [];
            const nonEmptyLines = lines.filter((line) => line.trim().length > 0);
            const longestLineChars = nonEmptyLines.reduce((max, line) => Math.max(max, countDetailCopyChars(line)), 0);
            const longestLineUnits = nonEmptyLines.reduce((max, line) => Math.max(max, countDetailCopyUnits(line)), 0);
            const charCount = countDetailCopyChars(rawText);
            const duplicateKey = trimmedText.replace(/\s+/g, '').toLowerCase();
            const duplicateCount = duplicateKey ? (duplicateMap.get(duplicateKey) || 0) : 0;
            const fontMetricsReliable = Boolean(
                bounds
                && fontSize > 0
                && nonEmptyLines.length > 0
                && (bounds.height / (fontSize * nonEmptyLines.length)) >= 0.75
            );
            const estimatedLineWidth = bounds && fontSize > 0
                ? Math.round(longestLineUnits * fontSize * 100) / 100
                : null;
            const widthUsage = fontMetricsReliable && estimatedLineWidth !== null && bounds && bounds.width > 0
                ? estimatedLineWidth / bounds.width
                : null;
            const itemWarnings: string[] = [];

            if (!trimmedText) {
                itemWarnings.push('Copy is empty');
            }
            if (duplicateCount > 1 && charCount > 4) {
                itemWarnings.push('Duplicate copy exists in the same screen');
            }
            if (widthUsage !== null && charCount >= 6 && widthUsage > overflowThreshold) {
                itemWarnings.push('Estimated line width exceeds the current text frame');
            } else if (widthUsage !== null && charCount >= 6 && widthUsage >= nearLimitThreshold) {
                itemWarnings.push('Estimated line width is close to the text frame limit');
            }
            if ((role === 'title' || copyStrategy === 'headline') && nonEmptyLines.length > 2) {
                itemWarnings.push('Headline uses too many lines');
            }
            if ((role === 'title' || copyStrategy === 'headline') && charCount > 24) {
                itemWarnings.push('Headline character count is too long');
            }
            if (copyStrategy === 'parameter' && nonEmptyLines.length > 3) {
                itemWarnings.push('Parameter copy uses too many lines');
            }
            if (fontMetricsReliable && fontSize > 0 && bounds && nonEmptyLines.length > 0) {
                const expectedMinHeight = fontSize * Math.max(1.15, nonEmptyLines.length * 1.02);
                if (bounds.height < expectedMinHeight * 0.8) {
                    itemWarnings.push('Text frame height looks too tight');
                }
            }
            if (nonEmptyLines.length > 1) {
                const shortestLineChars = nonEmptyLines.reduce((min, line) => Math.min(min, countDetailCopyChars(line)), Number.MAX_SAFE_INTEGER);
                if (shortestLineChars !== Number.MAX_SAFE_INTEGER && shortestLineChars > 0 && longestLineChars / shortestLineChars >= 3) {
                    itemWarnings.push('Line length imbalance is too large after wrapping');
                }
            }

            const status: 'ok' | 'watch' | 'risky' =
                itemWarnings.includes('Copy is empty')
                    ? 'risky'
                    : itemWarnings.length > 0
                        ? 'watch'
                        : 'ok';

            if (status !== 'ok') {
                riskyScreenIds.add(screenId);
                warnings.push(`${screenName}: ${placeholderLayerName} - ${itemWarnings.join('; ')}`);
            }

            audits.push({
                screenId,
                screenName,
                screenRole: screenPlan?.screenRole || null,
                mainMessage: screenPlan?.mainMessage || null,
                placeholderLayerId,
                placeholderLayerName,
                role,
                copyStrategy,
                currentText: rawText,
                status,
                warnings: itemWarnings,
                metrics: {
                    charCount,
                    lineCount: nonEmptyLines.length,
                    longestLineChars,
                    longestLineUnits: Math.round(longestLineUnits * 100) / 100,
                    duplicateCount,
                    fontMetricsReliable,
                    estimatedLineWidth,
                    widthUsage: widthUsage === null ? null : Math.round(widthUsage * 1000) / 1000,
                    boundsWidth: bounds?.width ?? null,
                    boundsHeight: bounds?.height ?? null,
                    fontSize: Number.isFinite(fontSize) && fontSize > 0 ? fontSize : null
                }
            });
        }
    }

    return {
        success: true,
        screens,
        screenPlans,
        audits,
        warnings,
        riskyScreenIds: Array.from(riskyScreenIds),
        summary: {
            screenCount: screens.length,
            copyPlaceholderCount: audits.length,
            riskyCopyCount: audits.filter((item) => item.status === 'risky').length,
            watchCopyCount: audits.filter((item) => item.status === 'watch').length,
            warningCount: warnings.length
        }
    };
}
