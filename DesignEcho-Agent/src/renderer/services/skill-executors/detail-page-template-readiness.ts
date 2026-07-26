import type { LayerIssue, ParsedScreen } from './detail-page.types';

export type DetailTemplateMode = 'auto-fill' | 'recover-then-fill' | 'manual-assist';

export interface DetailScreenReadiness {
    screenId: number;
    screenName: string;
    score: number;
    copyCount: number;
    imageCount: number;
    missingGroups: string[];
    issueCount: number;
    severeIssueCount: number;
    mode: DetailTemplateMode;
}

export interface DetailTemplateReadiness {
    mode: DetailTemplateMode;
    score: number;
    reasons: string[];
    risks: string[];
    metrics: {
        screenCount: number;
        validScreenCount: number;
        copyPlaceholderCount: number;
        imagePlaceholderCount: number;
        screensWithMissingGroups: number;
        severeIssueCount: number;
        crossScreenRiskCount: number;
    };
    screenSummaries: DetailScreenReadiness[];
}

function clampScore(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(1, value));
}

function getScreenIssues(issues: LayerIssue[], screen: ParsedScreen): LayerIssue[] {
    return (issues || []).filter((issue) => {
        if (typeof (issue as any).screenIndex === 'number') {
            const screenIndex = Number((issue as any).screenIndex);
            return screenIndex === screen.id || screenIndex === screen.order || screenIndex === screen.id - 1;
        }
        return false;
    });
}

export function assessDetailPageTemplateReadiness(params: {
    screens: ParsedScreen[];
    issues?: LayerIssue[];
    crossScreenRiskCount?: number;
}): DetailTemplateReadiness {
    const screens = params.screens || [];
    const issues = params.issues || [];
    const crossScreenRiskCount = Number(params.crossScreenRiskCount || 0);

    const screenSummaries: DetailScreenReadiness[] = screens.map((screen) => {
        const screenIssues = getScreenIssues(issues, screen);
        const severeIssueCount = screenIssues.filter((issue) => issue.severity === 'critical').length;
        const missingGroups = screen.structure?.missingGroups || [];
        const copyCount = screen.copyPlaceholders?.length || 0;
        const imageCount = screen.imagePlaceholders?.length || 0;

        let score = 1;
        if (copyCount === 0 && imageCount === 0) score -= 0.45;
        if (copyCount === 0 || imageCount === 0) score -= 0.18;
        score -= Math.min(0.24, missingGroups.length * 0.08);
        score -= Math.min(0.35, severeIssueCount * 0.12);
        score -= Math.min(0.18, (screenIssues.length - severeIssueCount) * 0.04);

        const normalized = clampScore(score);
        let mode: DetailTemplateMode = 'auto-fill';
        if (normalized < 0.4 || severeIssueCount >= 2 || (copyCount === 0 && imageCount === 0)) {
            mode = 'manual-assist';
        } else if (normalized < 0.72 || missingGroups.length > 0 || screenIssues.length > 0) {
            mode = 'recover-then-fill';
        }

        return {
            screenId: screen.id,
            screenName: screen.name,
            score: normalized,
            copyCount,
            imageCount,
            missingGroups,
            issueCount: screenIssues.length,
            severeIssueCount,
            mode
        };
    });

    const screenCount = screens.length;
    const validScreenCount = screenSummaries.filter((screen) => screen.copyCount > 0 || screen.imageCount > 0).length;
    const copyPlaceholderCount = screenSummaries.reduce((sum, screen) => sum + screen.copyCount, 0);
    const imagePlaceholderCount = screenSummaries.reduce((sum, screen) => sum + screen.imageCount, 0);
    const screensWithMissingGroups = screenSummaries.filter((screen) => screen.missingGroups.length > 0).length;
    const severeIssueCount = issues.filter((issue) => issue.severity === 'critical').length;

    let overallScore = 1;
    if (screenCount === 0) overallScore = 0;
    overallScore -= Math.min(0.3, Math.max(0, screenCount - validScreenCount) * 0.12);
    overallScore -= Math.min(0.22, screensWithMissingGroups * 0.06);
    overallScore -= Math.min(0.3, severeIssueCount * 0.08);
    overallScore -= Math.min(0.16, crossScreenRiskCount * 0.04);
    overallScore = clampScore(overallScore);

    let mode: DetailTemplateMode = 'auto-fill';
    if (
        overallScore < 0.4 ||
        validScreenCount === 0 ||
        severeIssueCount >= 3 ||
        screenSummaries.some((screen) => screen.mode === 'manual-assist')
    ) {
        mode = 'manual-assist';
    } else if (
        overallScore < 0.74 ||
        screensWithMissingGroups > 0 ||
        severeIssueCount > 0 ||
        crossScreenRiskCount > 0
    ) {
        mode = 'recover-then-fill';
    }

    const reasons: string[] = [];
    const risks: string[] = [];

    if (validScreenCount > 0) {
        reasons.push(`解析到 ${screenCount} 屏，其中 ${validScreenCount} 屏具备可填充占位结构`);
    }
    if (copyPlaceholderCount > 0 || imagePlaceholderCount > 0) {
        reasons.push(`模板包含 ${copyPlaceholderCount} 个文案占位和 ${imagePlaceholderCount} 个图片区占位`);
    }
    if (screensWithMissingGroups > 0) {
        risks.push(`${screensWithMissingGroups} 屏缺少标准分组，可能需要先恢复结构`);
    }
    if (severeIssueCount > 0) {
        risks.push(`检测到 ${severeIssueCount} 个严重结构问题`);
    }
    if (crossScreenRiskCount > 0) {
        risks.push(`检测到 ${crossScreenRiskCount} 个跨屏图层风险`);
    }
    if (validScreenCount === 0) {
        risks.push('当前模板没有识别到稳定的可填充屏结构');
    }

    return {
        mode,
        score: overallScore,
        reasons,
        risks,
        metrics: {
            screenCount,
            validScreenCount,
            copyPlaceholderCount,
            imagePlaceholderCount,
            screensWithMissingGroups,
            severeIssueCount,
            crossScreenRiskCount
        },
        screenSummaries
    };
}
