import {
    computeDetailRectOverlapRatio,
    type DetailNormalizedRect,
    normalizeDetailRect
} from './detail-page-anchor-diagnostics';

function asRecord(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return null;
    }
    return value as Record<string, unknown>;
}

export function buildDetailRectKey(rect: DetailNormalizedRect | null): string | null {
    if (!rect) return null;
    return [rect.left, rect.top, rect.right, rect.bottom]
        .map((value) => Math.round(value))
        .join(':');
}

export function isDetailRectCenterWithin(
    screenBounds: DetailNormalizedRect,
    rect: DetailNormalizedRect
): boolean {
    const centerX = rect.left + ((rect.right - rect.left) / 2);
    const centerY = rect.top + ((rect.bottom - rect.top) / 2);
    return centerX >= screenBounds.left
        && centerX <= screenBounds.right
        && centerY >= screenBounds.top
        && centerY <= screenBounds.bottom;
}

export function reconstructDetailPlacementsFromHierarchy(
    screens: any[],
    flatLayers: Array<Record<string, unknown>>,
    minOverlapRatio: number
): {
    placements: Array<Record<string, unknown>>;
    unmatchedPlaceholders: Array<Record<string, unknown>>;
    diagnostics: Array<Record<string, unknown>>;
} {
    const placements: Array<Record<string, unknown>> = [];
    const unmatchedPlaceholders: Array<Record<string, unknown>> = [];
    const diagnostics: Array<Record<string, unknown>> = [];
    const layerById = new Map<number, Record<string, unknown>>();

    for (const layer of flatLayers || []) {
        const id = Number(layer?.id || 0);
        if (id > 0) {
            layerById.set(id, layer);
        }
    }

    for (const screen of screens || []) {
        const screenId = Number(screen?.id || 0);
        const screenName = String(screen?.name || `Screen ${screenId}`);
        const screenBounds = normalizeDetailRect(screen?.bounds);
        const placeholders = Array.isArray(screen?.imagePlaceholders) ? screen.imagePlaceholders : [];

        for (const placeholder of placeholders) {
            const placeholderLayerId = Number(placeholder?.layerId || 0);
            const placeholderLayerName = String(placeholder?.layerName || placeholderLayerId);
            const baseLayerId = Number(placeholder?.baseLayerId || placeholder?.clippingInfo?.baseLayerId || 0) || undefined;
            const targetBounds = normalizeDetailRect(placeholder?.clippingInfo?.baseBounds || placeholder?.bounds);
            const referenceLayerId = baseLayerId || placeholderLayerId || undefined;
            const baseLayer = baseLayerId ? layerById.get(baseLayerId) : undefined;
            const placeholderLayer = placeholderLayerId ? layerById.get(placeholderLayerId) : undefined;
            const placeholderNameNormalized = placeholderLayerName.trim().toLowerCase();
            const candidates: Array<{ layer: Record<string, unknown>; score: number; overlapRatio: number; reasons: string[] }> = [];

            for (const layer of flatLayers || []) {
                const actualLayerId = Number(layer?.id || 0);
                if (!actualLayerId || actualLayerId === baseLayerId) {
                    continue;
                }

                const actualBounds = normalizeDetailRect(layer?.bounds);
                if (!actualBounds || !targetBounds) continue;

                const overlapRatio = computeDetailRectOverlapRatio(targetBounds, actualBounds);
                const layerName = String(layer?.name || '').trim();
                const sameLayerId = actualLayerId === placeholderLayerId;
                const sameName = !!layerName && layerName.toLowerCase() === placeholderNameNormalized;
                const pathIds = Array.isArray(layer?.pathIds) ? layer.pathIds.map((item: unknown) => Number(item)) : [];
                const layerKind = String(layer?.kind || '').trim().toLowerCase();
                const insideScreenPath = pathIds.includes(screenId);
                const parentId = Number(layer?.parentId || 0) || null;
                const sameParentAsBase = !!baseLayer && Number(baseLayer?.parentId || 0) === (parentId || 0);
                const sameParentAsPlaceholder = !!placeholderLayer && Number(placeholderLayer?.parentId || 0) === (parentId || 0);
                const isClipped = layer?.isClipped === true;
                const verticalHit = !!screenBounds && isDetailRectCenterWithin(screenBounds, actualBounds);
                const isGroupLike = layerKind === 'group';
                const isTextLike = layerKind === 'text';
                const isFillLike = layerKind === 'solidcolor' || layerKind === 'gradient' || layerKind === 'pattern';
                const isImageLike = layerKind === 'pixel' || layerKind === 'smartobject';
                const isTopLevelLayer = pathIds.length <= 1;

                if (isTopLevelLayer || isGroupLike || isTextLike || isFillLike) {
                    continue;
                }
                if (!isImageLike) {
                    continue;
                }
                if (baseLayerId && !isClipped && !sameName) {
                    continue;
                }
                if (overlapRatio < minOverlapRatio && !sameName) {
                    continue;
                }

                let score = overlapRatio * 0.6;
                const reasons: string[] = [];

                if (sameLayerId) {
                    score += 0.35;
                    reasons.push('same-layer-id');
                }
                if (sameName) {
                    score += 0.22;
                    reasons.push('name-match');
                }
                if (insideScreenPath) {
                    score += 0.1;
                    reasons.push('screen-path');
                }
                if (sameParentAsBase) {
                    score += 0.08;
                    reasons.push('same-parent-as-base');
                }
                if (sameParentAsPlaceholder) {
                    score += 0.08;
                    reasons.push('same-parent-as-placeholder');
                }
                if (baseLayerId && isClipped) {
                    score += 0.12;
                    reasons.push('clipped-to-base');
                }
                if (verticalHit) {
                    score += 0.06;
                    reasons.push('screen-bounds-hit');
                }

                candidates.push({ layer, score, overlapRatio, reasons });
            }

            candidates.sort((a, b) => b.score - a.score);
            const best = candidates[0];

            if (!best || !targetBounds) {
                unmatchedPlaceholders.push({
                    screenId,
                    screenName,
                    placeholderLayerId,
                    placeholderLayerName,
                    baseLayerId,
                    referenceLayerId,
                    reason: 'No live layer matched current placeholder target bounds'
                });
                continue;
            }

            const actualBounds = normalizeDetailRect(best.layer?.bounds);
            if (!actualBounds) {
                unmatchedPlaceholders.push({
                    screenId,
                    screenName,
                    placeholderLayerId,
                    placeholderLayerName,
                    baseLayerId,
                    referenceLayerId,
                    reason: 'Matched layer does not expose usable bounds'
                });
                continue;
            }

            placements.push({
                screenId,
                screenName,
                placeholderLayerId,
                placeholderLayerName,
                actualLayerId: Number(best.layer?.id || 0),
                actualLayerName: String(best.layer?.name || ''),
                targetBounds,
                actualBounds,
                baseLayerId,
                referenceLayerId,
                isClipped: best.layer?.isClipped === true,
                fillMode: undefined,
                subjectAlign: undefined,
                parentGroupName: typeof best.layer?.parentName === 'string' ? best.layer.parentName : undefined
            });

            diagnostics.push({
                screenId,
                screenName,
                placeholderLayerId,
                placeholderLayerName,
                matchedLayerId: Number(best.layer?.id || 0),
                matchedLayerName: String(best.layer?.name || ''),
                matchedLayerKind: String(best.layer?.kind || ''),
                overlapRatio: Math.round(best.overlapRatio * 1000) / 1000,
                score: Math.round(best.score * 1000) / 1000,
                reasons: best.reasons,
                candidateCount: candidates.length
            });
        }
    }

    return { placements, unmatchedPlaceholders, diagnostics };
}

export function normalizeDetailFlatLayers(input: unknown): Array<Record<string, unknown>> {
    const record = asRecord(input);
    if (Array.isArray(record?.flatList)) {
        return record!.flatList.filter((item): item is Record<string, unknown> => !!asRecord(item));
    }
    if (Array.isArray(record?.layers)) {
        return record!.layers.filter((item): item is Record<string, unknown> => !!asRecord(item));
    }
    if (Array.isArray(input)) {
        return input.filter((item): item is Record<string, unknown> => !!asRecord(item));
    }
    return [];
}
