export interface DetailNormalizedRect {
    left: number;
    top: number;
    right: number;
    bottom: number;
    width: number;
    height: number;
}

export interface DetailPlaceholderAnchorSource {
    layerId: number;
    layerName?: string;
    bounds?: unknown;
    baseLayerId?: number;
    isClippingMask?: boolean;
    clippingInfo?: {
        baseLayerId?: number;
        baseBounds?: unknown;
    };
}

export interface DetailScreenAnchorSource {
    id: number;
    name: string;
    imagePlaceholders?: DetailPlaceholderAnchorSource[];
}

export interface DetailImageAnchorAlert {
    screenId: number;
    screenName: string;
    severity: 'warning' | 'critical';
    message: string;
    layerIds: number[];
}

export function normalizeDetailRect(rect: any): DetailNormalizedRect | null {
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

export function computeDetailRectOverlapRatio(
    a: DetailNormalizedRect | null,
    b: DetailNormalizedRect | null
): number {
    if (!a || !b) return 0;

    const left = Math.max(a.left, b.left);
    const top = Math.max(a.top, b.top);
    const right = Math.min(a.right, b.right);
    const bottom = Math.min(a.bottom, b.bottom);
    const width = Math.max(0, right - left);
    const height = Math.max(0, bottom - top);
    const overlapArea = width * height;
    if (overlapArea <= 0) return 0;

    const aArea = Math.max(1, a.width * a.height);
    const bArea = Math.max(1, b.width * b.height);
    return overlapArea / Math.min(aArea, bArea);
}

function buildRectKey(rect: DetailNormalizedRect | null): string | null {
    if (!rect) return null;
    return [rect.left, rect.top, rect.right, rect.bottom]
        .map((value) => Math.round(value))
        .join(':');
}

export function analyzeDetailPlaceholderAnchors(
    screens: DetailScreenAnchorSource[]
): {
    alerts: DetailImageAnchorAlert[];
    riskyScreenIds: number[];
    riskyScreenNames: string[];
    warnings: string[];
} {
    const alerts: DetailImageAnchorAlert[] = [];

    for (const screen of screens || []) {
        const images = screen.imagePlaceholders || [];
        const screenName = screen.name;
        const rectGroups = new Map<string, number[]>();
        const baseGroups = new Map<number, DetailPlaceholderAnchorSource[]>();

        for (const image of images) {
            if (image.isClippingMask && !image.baseLayerId && !image.clippingInfo?.baseLayerId) {
                alerts.push({
                    screenId: screen.id,
                    screenName,
                    severity: 'critical',
                    message: `图片区「${image.layerName || image.layerId}」标记为剪切占位，但没有解析到基底层。`,
                    layerIds: [image.layerId]
                });
            }

            const rectKey = buildRectKey(normalizeDetailRect(image.clippingInfo?.baseBounds || image.bounds));
            if (rectKey) {
                const existing = rectGroups.get(rectKey) || [];
                existing.push(image.layerId);
                rectGroups.set(rectKey, existing);
            }

            const baseLayerId = image.baseLayerId || image.clippingInfo?.baseLayerId;
            if (typeof baseLayerId === 'number' && baseLayerId > 0) {
                const existing = baseGroups.get(baseLayerId) || [];
                existing.push(image);
                baseGroups.set(baseLayerId, existing);
            }
        }

        for (const [rectKey, layerIds] of rectGroups.entries()) {
            if (layerIds.length > 1) {
                alerts.push({
                    screenId: screen.id,
                    screenName,
                    severity: 'critical',
                    message: `多个图片区共享同一个占位容器（${rectKey}），填图后容易叠在一起。`,
                    layerIds
                });
            }
        }

        for (const [baseLayerId, groupedImages] of baseGroups.entries()) {
            if (groupedImages.length <= 1) continue;

            const distinctRects = new Set(
                groupedImages
                    .map((image) => buildRectKey(normalizeDetailRect(image.clippingInfo?.baseBounds || image.bounds)))
                    .filter(Boolean) as string[]
            );

            const severity: 'warning' | 'critical' = distinctRects.size <= 1 ? 'critical' : 'warning';
            alerts.push({
                screenId: screen.id,
                screenName,
                severity,
                message: severity === 'critical'
                    ? `多个图片区共用基底层 ${baseLayerId} 且占位容器相同。`
                    : `多个图片区共用基底层 ${baseLayerId}，需要确认模板是否刻意复用剪切基底。`,
                layerIds: groupedImages.map((image) => image.layerId)
            });
        }
    }

    const riskyAlerts = alerts.filter((alert) => alert.severity === 'critical');
    const riskyScreenIds = Array.from(new Set(riskyAlerts.map((alert) => alert.screenId)));
    const riskyScreenNames = Array.from(new Set(riskyAlerts.map((alert) => alert.screenName)));
    const warnings = alerts.map((alert) => `${alert.screenName}: ${alert.message}`);

    return {
        alerts,
        riskyScreenIds,
        riskyScreenNames,
        warnings
    };
}
