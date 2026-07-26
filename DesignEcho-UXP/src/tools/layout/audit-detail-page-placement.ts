import { Tool, ToolSchema } from '../types';

interface Rect {
    left: number;
    top: number;
    right: number;
    bottom: number;
    width?: number;
    height?: number;
}

interface ScreenLike {
    id: number;
    name: string;
    index?: number;
    bounds?: Rect;
}

interface PlacementLike {
    screenId?: number;
    screenName?: string;
    placeholderLayerId?: number;
    placeholderLayerName?: string;
    actualLayerId?: number;
    actualLayerName?: string;
    targetBounds?: Rect;
    actualBounds?: Rect;
    baseLayerId?: number;
    referenceLayerId?: number;
    isClipped?: boolean;
    fillMode?: string;
    subjectAlign?: string;
    parentGroupName?: string;
}

interface PlacementAudit {
    screenId: number;
    screenName: string;
    placeholderLayerId: number;
    placeholderLayerName: string;
    actualLayerId?: number;
    actualLayerName?: string;
    status: 'ok' | 'watch' | 'risky';
    warnings: string[];
    metrics: {
        overlapRatio: number;
        offsetRatio: number;
        centerOffsetX: number;
        centerOffsetY: number;
    };
    targetBounds: Required<Rect>;
    actualBounds: Required<Rect>;
    baseLayerId?: number;
    referenceLayerId?: number;
    isClipped: boolean;
    fillMode?: string;
    subjectAlign?: string;
    parentGroupName?: string;
}

function normalizeRect(rect: any): Required<Rect> | null {
    if (!rect) return null;
    const left = Number(rect.left);
    const top = Number(rect.top);
    const right = Number(rect.right);
    const bottom = Number(rect.bottom);
    if (![left, top, right, bottom].every((value) => Number.isFinite(value))) {
        return null;
    }
    if (right <= left || bottom <= top) {
        return null;
    }
    return {
        left,
        top,
        right,
        bottom,
        width: right - left,
        height: bottom - top
    };
}

function computeIntersectionRatio(a: Required<Rect>, b: Required<Rect>): number {
    const left = Math.max(a.left, b.left);
    const top = Math.max(a.top, b.top);
    const right = Math.min(a.right, b.right);
    const bottom = Math.min(a.bottom, b.bottom);
    if (right <= left || bottom <= top) return 0;
    const intersection = (right - left) * (bottom - top);
    const area = Math.max(1, a.width * a.height);
    return intersection / area;
}

function roundMetric(value: number): number {
    return Math.round(value * 1000) / 1000;
}

function statusFromPlacementWarnings(warnings: string[]): PlacementAudit['status'] {
    if (warnings.length >= 2) return 'risky';
    if (warnings.length === 1) return 'watch';
    return 'ok';
}

export class AuditDetailPagePlacementTool implements Tool {
    name = 'auditDetailPagePlacement';

    schema: ToolSchema = {
        name: 'auditDetailPagePlacement',
        description: 'Audit detail-page image placement against placeholder target bounds and flag stacking or offset risks.',
        parameters: {
            type: 'object',
            properties: {
                screens: {
                    type: 'array',
                    description: 'Parsed detail-page screens from parseDetailPageTemplate.'
                },
                placements: {
                    type: 'array',
                    description: 'Placement records returned from fillDetailPage.'
                }
            },
            required: ['screens']
        }
    };

    async execute(params: {
        screens: ScreenLike[];
        placements?: PlacementLike[];
    }): Promise<{
        success: boolean;
        audits?: PlacementAudit[];
        warnings?: string[];
        riskyScreenIds?: number[];
        summary?: {
            screenCount: number;
            placementCount: number;
            riskyPlacementCount: number;
            warningCount: number;
        };
        error?: string;
    }> {
        const screens = Array.isArray(params.screens) ? params.screens : [];
        const placements = Array.isArray(params.placements) ? params.placements : [];

        if (screens.length === 0) {
            return { success: false, error: 'Missing detail-page screens.' };
        }

        const audits: PlacementAudit[] = [];
        const warnings: string[] = [];
        const riskyScreenIds = new Set<number>();

        for (const placement of placements) {
            const screenId = Number(placement.screenId || 0);
            const screen = screens.find((item) => Number(item.id) === screenId);
            const screenName = String(placement.screenName || screen?.name || `Screen ${screenId}`);
            const targetBounds = normalizeRect(placement.targetBounds);
            const actualBounds = normalizeRect(placement.actualBounds);

            if (!screenId || !targetBounds || !actualBounds) {
                continue;
            }

            const targetCenterX = targetBounds.left + (targetBounds.width / 2);
            const targetCenterY = targetBounds.top + (targetBounds.height / 2);
            const actualCenterX = actualBounds.left + (actualBounds.width / 2);
            const actualCenterY = actualBounds.top + (actualBounds.height / 2);
            const centerOffsetX = actualCenterX - targetCenterX;
            const centerOffsetY = actualCenterY - targetCenterY;
            const targetDiagonal = Math.max(1, Math.sqrt((targetBounds.width ** 2) + (targetBounds.height ** 2)));
            const offsetRatio = Math.sqrt((centerOffsetX ** 2) + (centerOffsetY ** 2)) / targetDiagonal;
            const overlapRatio = computeIntersectionRatio(targetBounds, actualBounds);

            const itemWarnings: string[] = [];
            if (overlapRatio < 0.35) {
                itemWarnings.push('实际图片与占位容器重合过低');
            }
            if (offsetRatio > 0.18) {
                itemWarnings.push('实际图片中心明显偏离占位容器中心');
            }

            const status = statusFromPlacementWarnings(itemWarnings);

            if (status === 'risky') {
                riskyScreenIds.add(screenId);
            }

            audits.push({
                screenId,
                screenName,
                placeholderLayerId: Number(placement.placeholderLayerId || 0),
                placeholderLayerName: String(placement.placeholderLayerName || ''),
                actualLayerId: Number.isFinite(Number(placement.actualLayerId)) ? Number(placement.actualLayerId) : undefined,
                actualLayerName: placement.actualLayerName,
                status,
                warnings: itemWarnings,
                metrics: {
                    overlapRatio: roundMetric(overlapRatio),
                    offsetRatio: roundMetric(offsetRatio),
                    centerOffsetX: roundMetric(centerOffsetX),
                    centerOffsetY: roundMetric(centerOffsetY)
                },
                targetBounds,
                actualBounds,
                baseLayerId: placement.baseLayerId,
                referenceLayerId: placement.referenceLayerId,
                isClipped: placement.isClipped === true,
                fillMode: placement.fillMode,
                subjectAlign: placement.subjectAlign,
                parentGroupName: placement.parentGroupName
            });
        }

        const screenGroups = new Map<number, PlacementAudit[]>();
        for (const audit of audits) {
            const group = screenGroups.get(audit.screenId) || [];
            group.push(audit);
            screenGroups.set(audit.screenId, group);
        }

        for (const [screenId, group] of screenGroups.entries()) {
            for (let i = 0; i < group.length; i++) {
                for (let j = i + 1; j < group.length; j++) {
                    const first = group[i];
                    const second = group[j];
                    const actualOverlap = computeIntersectionRatio(first.actualBounds, second.actualBounds);
                    const targetOverlap = computeIntersectionRatio(first.targetBounds, second.targetBounds);
                    if (actualOverlap > 0.72 && targetOverlap < 0.18) {
                        const warning = `${first.screenName}: ${first.placeholderLayerName} 与 ${second.placeholderLayerName} 的实际放图区域严重重叠`;
                        warnings.push(warning);
                        riskyScreenIds.add(screenId);
                        if (!first.warnings.includes('与同屏其他图片严重叠放')) {
                            first.warnings.push('与同屏其他图片严重叠放');
                        }
                        if (!second.warnings.includes('与同屏其他图片严重叠放')) {
                            second.warnings.push('与同屏其他图片严重叠放');
                        }
                        first.status = 'risky';
                        second.status = 'risky';
                    }
                }
            }
        }

        for (const audit of audits) {
            for (const warning of audit.warnings) {
                warnings.push(`${audit.screenName}: ${audit.placeholderLayerName} - ${warning}`);
            }
        }

        return {
            success: true,
            audits,
            warnings,
            riskyScreenIds: Array.from(riskyScreenIds.values()),
            summary: {
                screenCount: screens.length,
                placementCount: audits.length,
                riskyPlacementCount: audits.filter((item) => item.status === 'risky').length,
                warningCount: warnings.length
            }
        };
    }
}
