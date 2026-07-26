import type { FillPlan, ImagePlaceholder, ParsedScreen, PlanQuality } from './detail-page.types';

export interface DetailImageAnchorAlert {
    screenId: number;
    screenName: string;
    severity: 'warning' | 'critical';
    message: string;
    layerIds: number[];
}

export function clampDetailScore(input: number, fallback: number): number {
    if (!Number.isFinite(input)) return fallback;
    return Math.max(0, Math.min(1, input));
}

export function calculateDetailPlanQuality(plan: FillPlan | undefined): PlanQuality {
    const images = plan?.images || [];
    const copies = plan?.copies || [];

    const imageTotal = images.length;
    const imageMatched = images.filter((img) => !!img.imagePath).length;
    const imageCoverage = imageTotal > 0 ? imageMatched / imageTotal : 1;

    const copyTotal = copies.length;
    const copyNonEmpty = copies.filter((copy) => !!String(copy.content || '').trim()).length;
    const copyCoverage = copyTotal > 0 ? copyNonEmpty / copyTotal : 1;

    const confidence = clampDetailScore(Number(plan?.confidence), imageCoverage);
    const score = (imageCoverage * 0.65) + (copyCoverage * 0.2) + (confidence * 0.15);

    return {
        confidence,
        score,
        imageTotal,
        imageMatched,
        imageCoverage,
        copyTotal,
        copyNonEmpty,
        copyCoverage
    };
}

export function alignDetailFillPlansToScreens(
    fillPlans: FillPlan[],
    screens: ParsedScreen[]
): { alignedPlans: Array<FillPlan | undefined>; unmatchedPlanCount: number } {
    const byScreenId = new Map<number, { plan: FillPlan; index: number }>();
    fillPlans.forEach((plan, index) => {
        if (!byScreenId.has(plan.screenId)) {
            byScreenId.set(plan.screenId, { plan, index });
        }
    });

    const usedIndexes = new Set<number>();
    const alignedPlans: Array<FillPlan | undefined> = [];

    for (let i = 0; i < screens.length; i++) {
        const screen = screens[i];
        const hit = byScreenId.get(screen.id);
        if (hit && !usedIndexes.has(hit.index)) {
            usedIndexes.add(hit.index);
            alignedPlans.push(hit.plan);
            continue;
        }
        if (fillPlans[i] && !usedIndexes.has(i)) {
            usedIndexes.add(i);
            alignedPlans.push(fillPlans[i]);
            continue;
        }
        const fallbackIndex = fillPlans.findIndex((_, idx) => !usedIndexes.has(idx));
        if (fallbackIndex >= 0) {
            usedIndexes.add(fallbackIndex);
            alignedPlans.push(fillPlans[fallbackIndex]);
            continue;
        }
        alignedPlans.push(undefined);
    }

    return {
        alignedPlans,
        unmatchedPlanCount: Math.max(0, fillPlans.length - usedIndexes.size)
    };
}

export function enrichDetailFillPlansWithLayerRelations(fillPlans: FillPlan[], screens: ParsedScreen[]): FillPlan[] {
    const screenMap = new Map<number, ParsedScreen>(screens.map((screen) => [screen.id, screen]));
    return (fillPlans || []).map((plan) => {
        const screen = screenMap.get(plan.screenId);
        const placeholderMap = new Map<number, ImagePlaceholder>(
            (screen?.imagePlaceholders || []).map((item) => [item.layerId, item])
        );
        const images = (plan.images || []).map((image) => {
            const placeholder = placeholderMap.get(image.layerId);
            const baseLayerId = (image as any).baseLayerId
                || placeholder?.baseLayerId
                || placeholder?.clippingInfo?.baseLayerId;
            const zone = placeholder?.zone || (image as any).zone || 'unknown';
            const targetBounds = placeholder?.clippingInfo?.baseBounds || placeholder?.bounds;
            return {
                ...image,
                fillMode: zone === 'icon' ? 'contain' : (image.fillMode || 'cover'),
                isClippingMask: (image as any).isClippingMask ?? placeholder?.isClippingMask,
                baseLayerId,
                referenceLayerId: (image as any).referenceLayerId || baseLayerId || image.layerId,
                targetBounds,
                zone
            };
        });
        return { ...plan, images };
    });
}

export function collectDetailStructureAlerts(
    screens: ParsedScreen[]
): Array<{ screenName: string; missingGroups: string[] }> {
    const alerts: Array<{ screenName: string; missingGroups: string[] }> = [];
    for (const screen of screens || []) {
        const missing = screen?.structure?.missingGroups || [];
        if (missing.length > 0) {
            alerts.push({ screenName: screen.name, missingGroups: missing });
        }
    }
    return alerts;
}

function normalizeRect(rect: any): { left: number; top: number; right: number; bottom: number } | null {
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
    return { left, top, right, bottom };
}

function buildRectKey(rect: { left: number; top: number; right: number; bottom: number } | null): string | null {
    if (!rect) return null;
    return [rect.left, rect.top, rect.right, rect.bottom]
        .map((value) => Math.round(value))
        .join(':');
}

function getOverlapRatio(
    a: { left: number; top: number; right: number; bottom: number } | null,
    b: { left: number; top: number; right: number; bottom: number } | null
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
    const aArea = Math.max(1, (a.right - a.left) * (a.bottom - a.top));
    const bArea = Math.max(1, (b.right - b.left) * (b.bottom - b.top));
    return overlapArea / Math.min(aArea, bArea);
}

export function analyzeDetailImageAnchors(
    fillPlans: FillPlan[],
    screens: ParsedScreen[]
): {
    alerts: DetailImageAnchorAlert[];
    riskyScreenIds: number[];
    riskyScreenNames: string[];
    warnings: string[];
} {
    const screenMap = new Map<number, ParsedScreen>(screens.map((screen) => [screen.id, screen]));
    const alerts: DetailImageAnchorAlert[] = [];

    for (const plan of fillPlans || []) {
        const screen = screenMap.get(plan.screenId);
        const screenName = screen?.name || plan.screenName || `Screen ${plan.screenId}`;
        const images = plan.images || [];

        for (const image of images) {
            if (image.isClippingMask && !image.baseLayerId) {
                alerts.push({
                    screenId: plan.screenId,
                    screenName,
                    severity: 'critical',
                    message: `图片区「${image.layerName || image.layerId}」需要剪切，但没有识别到基底层。`,
                    layerIds: [image.layerId]
                });
            }
        }

        const rectGroups = new Map<string, number[]>();
        const baseGroups = new Map<number, typeof images>();

        for (const image of images) {
            const rectKey = buildRectKey(normalizeRect(image.targetBounds));
            if (rectKey) {
                const existing = rectGroups.get(rectKey) || [];
                existing.push(image.layerId);
                rectGroups.set(rectKey, existing);
            }
            if (typeof image.baseLayerId === 'number' && image.baseLayerId > 0) {
                const existing = baseGroups.get(image.baseLayerId) || [];
                existing.push(image);
                baseGroups.set(image.baseLayerId, existing);
            }
        }

        for (const [rectKey, layerIds] of rectGroups.entries()) {
            if (layerIds.length > 1) {
                alerts.push({
                    screenId: plan.screenId,
                    screenName,
                    severity: 'critical',
                    message: `多个图片区共享同一个目标容器（${rectKey}），填充后容易叠在一起。`,
                    layerIds
                });
            }
        }

        for (const [baseLayerId, groupedImages] of baseGroups.entries()) {
            if (groupedImages.length <= 1) continue;
            const distinctRects = new Set(
                groupedImages
                    .map((image) => buildRectKey(normalizeRect(image.targetBounds)))
                    .filter(Boolean) as string[]
            );
            const severity: 'warning' | 'critical' = distinctRects.size <= 1 ? 'critical' : 'warning';
            alerts.push({
                screenId: plan.screenId,
                screenName,
                severity,
                message: severity === 'critical'
                    ? `多个图片区共用基底层 ${baseLayerId} 且目标容器相同，剪切锚点风险较高。`
                    : `多个图片区共用基底层 ${baseLayerId}，需要确认模板是否有意复用同一个剪切基底。`,
                layerIds: groupedImages.map((image) => image.layerId)
            });
        }

        for (let i = 0; i < images.length; i++) {
            for (let j = i + 1; j < images.length; j++) {
                const first = normalizeRect(images[i].targetBounds);
                const second = normalizeRect(images[j].targetBounds);
                const overlapRatio = getOverlapRatio(first, second);
                if (overlapRatio >= 0.92) {
                    alerts.push({
                        screenId: plan.screenId,
                        screenName,
                        severity: 'warning',
                        message: `图片区「${images[i].layerName || images[i].layerId}」和「${images[j].layerName || images[j].layerId}」的目标区域高度重叠。`,
                        layerIds: [images[i].layerId, images[j].layerId]
                    });
                }
            }
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

export function analyzeDetailPlaceholderAnchors(
    screens: ParsedScreen[]
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
        const baseGroups = new Map<number, typeof images>();

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

            const rectKey = buildRectKey(normalizeRect(image.clippingInfo?.baseBounds || image.bounds));
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
                    .map((image) => buildRectKey(normalizeRect(image.clippingInfo?.baseBounds || image.bounds)))
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
