import { app } from 'photoshop';
import { Tool, ToolSchema } from '../types';
import { getBounds, isGroup, isImageLike } from './layer-utils';

interface Rect {
    left: number;
    top: number;
    right: number;
    bottom: number;
    width: number;
    height: number;
}

interface ScreenLike {
    id: number;
    name: string;
    imagePlaceholders?: ImagePlaceholderLike[];
}

interface ImagePlaceholderLike {
    layerId: number;
    layerName?: string;
    bounds?: any;
    baseLayerId?: number;
    baseLayerName?: string;
    isClippingMask?: boolean;
    clippingInfo?: {
        isClipped?: boolean;
        baseLayerId?: number;
        baseBounds?: any;
    };
}

interface CandidateLayerSummary {
    layerId: number;
    layerName: string;
    clipped: boolean;
    overlapRatio: number;
    parentGroupName?: string;
}

interface LivePlacementRecord {
    screenId: number;
    screenName: string;
    placeholderLayerId: number;
    placeholderLayerName: string;
    placeholderFound: boolean;
    baseLayerId?: number;
    baseLayerName?: string;
    baseLayerFound: boolean;
    referenceLayerId?: number;
    referenceLayerName?: string;
    targetBounds?: Rect;
    actualLayerId?: number;
    actualLayerName?: string;
    actualBounds?: Rect;
    parentGroupName?: string;
    isClipped: boolean;
    status: 'resolved' | 'ambiguous' | 'unresolved';
    detectionMode:
        | 'placeholder-clipped-layer'
        | 'placeholder-current-layer'
        | 'single-clipped-layer-above-base'
        | 'multiple-clipped-layers-above-base'
        | 'single-sibling-above-placeholder'
        | 'multiple-siblings-above-placeholder'
        | 'missing-target-bounds'
        | 'missing-runtime-layer'
        | 'unresolved';
    candidateLayers: CandidateLayerSummary[];
    warnings: string[];
}

function normalizeRect(rect: any): Rect | null {
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

function rectFromLayer(layer: any): Rect | null {
    if (!layer) return null;
    const bounds = getBounds(layer);
    if (!bounds || bounds.width <= 0 || bounds.height <= 0) {
        return null;
    }
    return bounds;
}

function overlapRatio(a: Rect | null, b: Rect | null): number {
    if (!a || !b) return 0;
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

function isVisibleRenderableLayer(layer: any): boolean {
    if (!layer || layer.visible === false) return false;
    if (isGroup(layer)) return false;
    return isImageLike(layer);
}

function findLayerById(container: any, id: number): any {
    if (!container || !id) return null;
    const layers = Array.isArray(container) ? container : (container.layers || []);
    for (const layer of layers) {
        if (Number(layer?.id || 0) === id) return layer;
        if (layer?.layers) {
            const found = findLayerById(layer.layers, id);
            if (found) return found;
        }
    }
    return null;
}

function getParentLayers(layer: any, doc: any): any[] {
    if (!layer) return [];
    if (Array.isArray(layer.parent?.layers)) return layer.parent.layers;
    if (Array.isArray(doc?.layers)) return doc.layers;
    return [];
}

function getContiguousClippedLayersAbove(baseLayer: any, doc: any, targetBounds: Rect | null): CandidateLayerSummary[] {
    const siblings = getParentLayers(baseLayer, doc);
    const baseIndex = siblings.findIndex((item) => Number(item?.id || 0) === Number(baseLayer?.id || 0));
    if (baseIndex <= 0) return [];

    const candidates: CandidateLayerSummary[] = [];
    for (let index = baseIndex - 1; index >= 0; index--) {
        const layer = siblings[index];
        if (!layer?.clipped) break;
        const bounds = rectFromLayer(layer);
        candidates.push({
            layerId: Number(layer?.id || 0),
            layerName: String(layer?.name || ''),
            clipped: true,
            overlapRatio: roundMetric(overlapRatio(bounds, targetBounds)),
            parentGroupName: String(layer?.parent?.name || '')
        });
    }
    return candidates;
}

function getRenderableSiblingsAbove(targetLayer: any, doc: any, targetBounds: Rect | null): CandidateLayerSummary[] {
    const siblings = getParentLayers(targetLayer, doc);
    const targetIndex = siblings.findIndex((item) => Number(item?.id || 0) === Number(targetLayer?.id || 0));
    if (targetIndex <= 0) return [];

    const candidates: CandidateLayerSummary[] = [];
    for (let index = targetIndex - 1; index >= 0; index--) {
        const layer = siblings[index];
        if (!isVisibleRenderableLayer(layer)) continue;
        const bounds = rectFromLayer(layer);
        const ratio = roundMetric(overlapRatio(bounds, targetBounds));
        if (ratio < 0.35) continue;
        candidates.push({
            layerId: Number(layer?.id || 0),
            layerName: String(layer?.name || ''),
            clipped: layer?.clipped === true,
            overlapRatio: ratio,
            parentGroupName: String(layer?.parent?.name || '')
        });
    }
    return candidates;
}

function buildResolvedRecord(
    screen: ScreenLike,
    placeholder: ImagePlaceholderLike,
    placeholderLayer: any,
    baseLayer: any,
    actualLayer: any,
    detectionMode: LivePlacementRecord['detectionMode'],
    targetBounds: Rect,
    warnings: string[],
    candidateLayers: CandidateLayerSummary[]
): LivePlacementRecord {
    const actualBounds = rectFromLayer(actualLayer) || undefined;
    const actualOverlap = roundMetric(overlapRatio(actualBounds || null, targetBounds));
    const nextWarnings = [...warnings];
    if (actualOverlap < 0.35) {
        nextWarnings.push('Actual image overlaps the target container weakly.');
    }

    return {
        screenId: Number(screen.id || 0),
        screenName: String(screen.name || `Screen ${screen.id}`),
        placeholderLayerId: Number(placeholder.layerId || 0),
        placeholderLayerName: String(placeholder.layerName || ''),
        placeholderFound: !!placeholderLayer,
        baseLayerId: Number(baseLayer?.id || placeholder.baseLayerId || placeholder.clippingInfo?.baseLayerId || 0) || undefined,
        baseLayerName: String(baseLayer?.name || placeholder.baseLayerName || ''),
        baseLayerFound: !!baseLayer,
        referenceLayerId: Number(baseLayer?.id || placeholderLayer?.id || 0) || undefined,
        referenceLayerName: String(baseLayer?.name || placeholderLayer?.name || ''),
        targetBounds,
        actualLayerId: Number(actualLayer?.id || 0) || undefined,
        actualLayerName: String(actualLayer?.name || ''),
        actualBounds,
        parentGroupName: String(actualLayer?.parent?.name || ''),
        isClipped: actualLayer?.clipped === true,
        status: 'resolved',
        detectionMode,
        candidateLayers,
        warnings: nextWarnings
    };
}

export class InspectDetailPageLivePlacementsTool implements Tool {
    name = 'inspectDetailPageLivePlacements';

    schema: ToolSchema = {
        name: 'inspectDetailPageLivePlacements',
        description: 'Inspect current detail-page image placement runtime from the active PSD and parsed screens, without relying on fillDetailPage placement records.',
        parameters: {
            type: 'object',
            properties: {
                screens: {
                    type: 'array',
                    description: 'Screens returned from parseDetailPageTemplate.'
                }
            },
            required: ['screens']
        }
    };

    async execute(params: { screens: ScreenLike[] }): Promise<{
        success: boolean;
        placements?: LivePlacementRecord[];
        warnings?: string[];
        summary?: {
            screenCount: number;
            inspectedCount: number;
            resolvedCount: number;
            ambiguousCount: number;
            unresolvedCount: number;
        };
        error?: string;
    }> {
        const screens = Array.isArray(params.screens) ? params.screens : [];
        if (screens.length === 0) {
            return { success: false, error: 'Missing detail-page screens.' };
        }

        const doc = app.activeDocument;
        if (!doc) {
            return { success: false, error: 'No active document.' };
        }

        const placements: LivePlacementRecord[] = [];
        const warnings: string[] = [];

        for (const screen of screens) {
            for (const placeholder of screen.imagePlaceholders || []) {
                const targetBounds = normalizeRect(placeholder.clippingInfo?.baseBounds || placeholder.bounds);
                const placeholderLayer = findLayerById(doc, Number(placeholder.layerId || 0));
                const baseLayerId = Number(placeholder.baseLayerId || placeholder.clippingInfo?.baseLayerId || 0) || undefined;
                const baseLayer = baseLayerId ? findLayerById(doc, baseLayerId) : null;
                const baseWarnings: string[] = [];

                if (!targetBounds) {
                    placements.push({
                        screenId: Number(screen.id || 0),
                        screenName: String(screen.name || `Screen ${screen.id}`),
                        placeholderLayerId: Number(placeholder.layerId || 0),
                        placeholderLayerName: String(placeholder.layerName || ''),
                        placeholderFound: !!placeholderLayer,
                        baseLayerId,
                        baseLayerName: String(baseLayer?.name || placeholder.baseLayerName || ''),
                        baseLayerFound: !!baseLayer,
                        referenceLayerId: Number(baseLayer?.id || placeholderLayer?.id || 0) || undefined,
                        referenceLayerName: String(baseLayer?.name || placeholderLayer?.name || ''),
                        isClipped: false,
                        status: 'unresolved',
                        detectionMode: 'missing-target-bounds',
                        candidateLayers: [],
                        warnings: ['Missing target bounds in parsed screen placeholder.']
                    });
                    continue;
                }

                if (!placeholderLayer) {
                    baseWarnings.push('Parsed placeholder layer is not present in the current PSD.');
                }
                if (baseLayerId && !baseLayer) {
                    baseWarnings.push('Parsed clipping base layer is not present in the current PSD.');
                }

                if (placeholderLayer && (placeholderLayer.clipped === true || placeholder.isClippingMask === true)) {
                    placements.push(buildResolvedRecord(
                        screen,
                        placeholder,
                        placeholderLayer,
                        baseLayer,
                        placeholderLayer,
                        'placeholder-clipped-layer',
                        targetBounds,
                        baseWarnings,
                        []
                    ));
                    continue;
                }

                if (placeholderLayer && !baseLayer && isVisibleRenderableLayer(placeholderLayer)) {
                    const selfBounds = rectFromLayer(placeholderLayer);
                    if (overlapRatio(selfBounds, targetBounds) >= 0.35) {
                        placements.push(buildResolvedRecord(
                            screen,
                            placeholder,
                            placeholderLayer,
                            baseLayer,
                            placeholderLayer,
                            'placeholder-current-layer',
                            targetBounds,
                            baseWarnings,
                            []
                        ));
                        continue;
                    }
                }

                if (baseLayer) {
                    const clippedCandidates = getContiguousClippedLayersAbove(baseLayer, doc, targetBounds);
                    if (clippedCandidates.length === 1) {
                        const actualLayer = findLayerById(doc, clippedCandidates[0].layerId);
                        if (actualLayer) {
                            placements.push(buildResolvedRecord(
                                screen,
                                placeholder,
                                placeholderLayer,
                                baseLayer,
                                actualLayer,
                                'single-clipped-layer-above-base',
                                targetBounds,
                                baseWarnings,
                                clippedCandidates
                            ));
                            continue;
                        }
                    }
                    if (clippedCandidates.length > 1) {
                        const record: LivePlacementRecord = {
                            screenId: Number(screen.id || 0),
                            screenName: String(screen.name || `Screen ${screen.id}`),
                            placeholderLayerId: Number(placeholder.layerId || 0),
                            placeholderLayerName: String(placeholder.layerName || ''),
                            placeholderFound: !!placeholderLayer,
                            baseLayerId,
                            baseLayerName: String(baseLayer?.name || placeholder.baseLayerName || ''),
                            baseLayerFound: true,
                            referenceLayerId: Number(baseLayer?.id || placeholderLayer?.id || 0) || undefined,
                            referenceLayerName: String(baseLayer?.name || placeholderLayer?.name || ''),
                            targetBounds,
                            isClipped: false,
                            status: 'ambiguous',
                            detectionMode: 'multiple-clipped-layers-above-base',
                            candidateLayers: clippedCandidates,
                            warnings: [...baseWarnings, 'Multiple clipped layers were found above the parsed clipping base.']
                        };
                        placements.push(record);
                        continue;
                    }
                }

                if (placeholderLayer) {
                    const siblingCandidates = getRenderableSiblingsAbove(placeholderLayer, doc, targetBounds);
                    if (siblingCandidates.length === 1) {
                        const actualLayer = findLayerById(doc, siblingCandidates[0].layerId);
                        if (actualLayer) {
                            placements.push(buildResolvedRecord(
                                screen,
                                placeholder,
                                placeholderLayer,
                                baseLayer,
                                actualLayer,
                                'single-sibling-above-placeholder',
                                targetBounds,
                                baseWarnings,
                                siblingCandidates
                            ));
                            continue;
                        }
                    }
                    if (siblingCandidates.length > 1) {
                        placements.push({
                            screenId: Number(screen.id || 0),
                            screenName: String(screen.name || `Screen ${screen.id}`),
                            placeholderLayerId: Number(placeholder.layerId || 0),
                            placeholderLayerName: String(placeholder.layerName || ''),
                            placeholderFound: true,
                            baseLayerId,
                            baseLayerName: String(baseLayer?.name || placeholder.baseLayerName || ''),
                            baseLayerFound: !!baseLayer,
                            referenceLayerId: Number(baseLayer?.id || placeholderLayer?.id || 0) || undefined,
                            referenceLayerName: String(baseLayer?.name || placeholderLayer?.name || ''),
                            targetBounds,
                            isClipped: false,
                            status: 'ambiguous',
                            detectionMode: 'multiple-siblings-above-placeholder',
                            candidateLayers: siblingCandidates,
                            warnings: [...baseWarnings, 'Multiple renderable siblings overlap the target area above the parsed placeholder.']
                        });
                        continue;
                    }
                }

                placements.push({
                    screenId: Number(screen.id || 0),
                    screenName: String(screen.name || `Screen ${screen.id}`),
                    placeholderLayerId: Number(placeholder.layerId || 0),
                    placeholderLayerName: String(placeholder.layerName || ''),
                    placeholderFound: !!placeholderLayer,
                    baseLayerId,
                    baseLayerName: String(baseLayer?.name || placeholder.baseLayerName || ''),
                    baseLayerFound: !!baseLayer,
                    referenceLayerId: Number(baseLayer?.id || placeholderLayer?.id || 0) || undefined,
                    referenceLayerName: String(baseLayer?.name || placeholderLayer?.name || ''),
                    targetBounds,
                    isClipped: false,
                    status: 'unresolved',
                    detectionMode: placeholderLayer || baseLayer ? 'unresolved' : 'missing-runtime-layer',
                    candidateLayers: [],
                    warnings: [...baseWarnings, 'Could not resolve a live image layer for this parsed placeholder.']
                });
            }
        }

        for (const item of placements) {
            for (const warning of item.warnings) {
                warnings.push(`${item.screenName}: ${item.placeholderLayerName} - ${warning}`);
            }
        }

        return {
            success: true,
            placements,
            warnings,
            summary: {
                screenCount: screens.length,
                inspectedCount: placements.length,
                resolvedCount: placements.filter((item) => item.status === 'resolved').length,
                ambiguousCount: placements.filter((item) => item.status === 'ambiguous').length,
                unresolvedCount: placements.filter((item) => item.status === 'unresolved').length
            }
        };
    }
}
