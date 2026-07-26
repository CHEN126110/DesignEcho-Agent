import {
    computeDetailRectOverlapRatio,
    normalizeDetailRect,
    type DetailNormalizedRect
} from './detail-page-anchor-diagnostics';
import { normalizeDetailFlatLayers } from './detail-page-live-placement';
import type { DetailScreenRole } from './detail-page-screen-plan';

export type DetailVisualLayerKind = 'text' | 'image' | 'element' | 'background' | 'unknown';

export interface DetailVisualModule {
    id: string;
    sourceScreenId: number | null;
    sourceScreenName?: string;
    bounds: DetailNormalizedRect | null;
    layerIds: number[];
    textLayerIds: number[];
    imageLayerIds: number[];
    elementLayerIds: number[];
    backgroundLayerIds: number[];
    mainImageLayerId: number | null;
    confidence: number;
    reasons: string[];
}

export interface DetailVisualScreenBoundary {
    id: string;
    sourceScreenId: number | null;
    sourceScreenName?: string;
    bounds: DetailNormalizedRect | null;
    layerIds: number[];
    moduleIds: string[];
    confidence: number;
    reasons: string[];
    disagreementFlags: string[];
}

export interface DetailSegmentationMergeAudit {
    status: 'ok' | 'watch' | 'risky';
    summary: {
        parsedScreenCount: number;
        visualScreenCount: number;
        moduleCount: number;
        lowOverlapScreenCount: number;
        unmatchedVisualScreenCount: number;
        modulesWithoutSourceScreenCount: number;
    };
    lowOverlapScreens: Array<{
        screenId: number;
        screenName: string;
        matchedVisualScreenId: string | null;
        overlapRatio: number;
    }>;
    unmatchedVisualScreens: Array<{
        visualScreenId: string;
        confidence: number;
    }>;
    modulesWithoutSourceScreen: Array<{
        moduleId: string;
        confidence: number;
        layerIds: number[];
    }>;
}

export interface DetailScreenVisualSummary {
    screenId: number;
    screenName: string;
    visualScreenCount: number;
    visualModuleCount: number;
    imageModuleCount: number;
    textModuleCount: number;
    mixedModuleCount: number;
    dominantModuleType: 'image' | 'text' | 'mixed' | 'unknown';
    primaryVisualScreenId: string | null;
    segmentationAgreement: number;
    boundaryRisk: 'ok' | 'watch' | 'risky';
    confidence: number;
    roleHint: DetailScreenRole | null;
    mainImageLayerIds: number[];
    reasons: string[];
}

interface DetailVisualLayerNode {
    id: number;
    name: string;
    kind: DetailVisualLayerKind;
    bounds: DetailNormalizedRect;
    parentId: number | null;
    parentName?: string;
    pathIds: number[];
    isClipped: boolean;
    centerX: number;
    centerY: number;
    area: number;
}

function clamp01(value: number, minimum: number = 0, maximum: number = 1): number {
    return Math.max(minimum, Math.min(maximum, value));
}

function rectArea(rect: DetailNormalizedRect | null): number {
    return rect ? Math.max(1, rect.width * rect.height) : 0;
}

function unionRects(rects: Array<DetailNormalizedRect | null>): DetailNormalizedRect | null {
    const usable = rects.filter((rect): rect is DetailNormalizedRect => !!rect);
    if (!usable.length) return null;
    return {
        left: Math.min(...usable.map((rect) => rect.left)),
        top: Math.min(...usable.map((rect) => rect.top)),
        right: Math.max(...usable.map((rect) => rect.right)),
        bottom: Math.max(...usable.map((rect) => rect.bottom)),
        width: 0,
        height: 0
    } as DetailNormalizedRect;
}

function finalizeRect(rect: DetailNormalizedRect | null): DetailNormalizedRect | null {
    if (!rect) return null;
    return normalizeDetailRect(rect);
}

function centerWithinRect(rect: DetailNormalizedRect | null, x: number, y: number): boolean {
    if (!rect) return false;
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

function horizontalGap(a: DetailNormalizedRect, b: DetailNormalizedRect): number {
    if (a.right < b.left) return b.left - a.right;
    if (b.right < a.left) return a.left - b.right;
    return 0;
}

function verticalGap(a: DetailNormalizedRect, b: DetailNormalizedRect): number {
    if (a.bottom < b.top) return b.top - a.bottom;
    if (b.bottom < a.top) return a.top - b.bottom;
    return 0;
}

function verticalOverlapRatio(a: DetailNormalizedRect, b: DetailNormalizedRect): number {
    const top = Math.max(a.top, b.top);
    const bottom = Math.min(a.bottom, b.bottom);
    const overlap = Math.max(0, bottom - top);
    if (overlap <= 0) return 0;
    return overlap / Math.max(1, Math.min(a.height, b.height));
}

function horizontalOverlapRatio(a: DetailNormalizedRect, b: DetailNormalizedRect): number {
    const left = Math.max(a.left, b.left);
    const right = Math.min(a.right, b.right);
    const overlap = Math.max(0, right - left);
    if (overlap <= 0) return 0;
    return overlap / Math.max(1, Math.min(a.width, b.width));
}

function classifyVisualLayerKind(layer: Record<string, unknown>, documentArea: number): DetailVisualLayerKind {
    const kind = String(layer?.kind || '').trim().toLowerCase();
    const bounds = normalizeDetailRect(layer?.bounds);
    const area = rectArea(bounds);
    const areaRatio = documentArea > 0 ? area / documentArea : 0;

    if (kind.includes('text')) return 'text';
    if (kind.includes('smartobject') || kind.includes('pixel')) return 'image';
    if (kind.includes('shape') || kind.includes('vector') || kind.includes('solidcolor') || kind.includes('gradient') || kind.includes('pattern')) {
        return areaRatio >= 0.72 ? 'background' : 'element';
    }
    if (areaRatio >= 0.82) return 'background';
    return 'unknown';
}

function collectVisualLayerNodes(
    flatLayersInput: unknown,
    documentBounds: DetailNormalizedRect | null
): DetailVisualLayerNode[] {
    const flatLayers = normalizeDetailFlatLayers(flatLayersInput);
    const documentArea = rectArea(documentBounds);
    const nodes: DetailVisualLayerNode[] = [];

    for (const layer of flatLayers) {
        const bounds = normalizeDetailRect(layer?.bounds);
        if (!bounds) continue;
        const id = Number(layer?.id || 0);
        if (!id) continue;
        const kind = String(layer?.kind || '').trim().toLowerCase();
        if (kind === 'group') continue;

        nodes.push({
            id,
            name: String(layer?.name || id),
            kind: classifyVisualLayerKind(layer, documentArea),
            bounds,
            parentId: Number(layer?.parentId || 0) || null,
            parentName: typeof layer?.parentName === 'string' ? String(layer.parentName) : undefined,
            pathIds: Array.isArray(layer?.pathIds) ? layer.pathIds.map((value) => Number(value)).filter((value) => Number.isFinite(value)) : [],
            isClipped: layer?.isClipped === true,
            centerX: bounds.left + (bounds.width / 2),
            centerY: bounds.top + (bounds.height / 2),
            area: rectArea(bounds)
        });
    }

    return nodes;
}

function buildVerticalBands(
    nodes: DetailVisualLayerNode[],
    documentBounds: DetailNormalizedRect | null
): Array<{ id: string; bounds: DetailNormalizedRect | null; layerIds: number[]; reasons: string[] }> {
    if (!nodes.length) return [];

    const usableNodes = [...nodes].sort((a, b) => {
        if (a.bounds.top !== b.bounds.top) return a.bounds.top - b.bounds.top;
        return a.bounds.left - b.bounds.left;
    });

    const documentHeight = documentBounds?.height || Math.max(...usableNodes.map((node) => node.bounds.bottom));
    const gapThreshold = Math.max(24, documentHeight * 0.035);
    const bands: Array<{ id: string; bounds: DetailNormalizedRect | null; layerIds: number[]; reasons: string[] }> = [];

    for (const node of usableNodes) {
        const current = bands[bands.length - 1];
        if (!current || !current.bounds) {
            bands.push({
                id: `visual-screen-${bands.length + 1}`,
                bounds: node.bounds,
                layerIds: [node.id],
                reasons: ['seed-from-first-layer']
            });
            continue;
        }

        const gap = verticalGap(current.bounds, node.bounds);
        const overlap = verticalOverlapRatio(current.bounds, node.bounds);
        const horizontalOverlap = horizontalOverlapRatio(current.bounds, node.bounds);

        if (gap <= gapThreshold || overlap > 0.12 || horizontalOverlap > 0.35) {
            current.bounds = finalizeRect(unionRects([current.bounds, node.bounds]));
            current.layerIds.push(node.id);
            continue;
        }

        bands.push({
            id: `visual-screen-${bands.length + 1}`,
            bounds: node.bounds,
            layerIds: [node.id],
            reasons: ['new-band-from-large-gap']
        });
    }

    return bands;
}

function assignParsedScreenMatch(
    screens: any[],
    bandBounds: DetailNormalizedRect | null
): { sourceScreenId: number | null; sourceScreenName?: string; overlapRatio: number } {
    let bestScreenId: number | null = null;
    let bestScreenName: string | undefined;
    let bestOverlap = 0;

    for (const screen of screens || []) {
        const screenBounds = normalizeDetailRect(screen?.bounds);
        const overlap = computeDetailRectOverlapRatio(screenBounds, bandBounds);
        if (overlap > bestOverlap) {
            bestOverlap = overlap;
            bestScreenId = Number(screen?.id || 0) || null;
            bestScreenName = String(screen?.name || '');
        }
    }

    return {
        sourceScreenId: bestScreenId,
        sourceScreenName: bestScreenName,
        overlapRatio: bestOverlap
    };
}

export function buildDetailVisualScreenBoundaries(params: {
    screens?: any[];
    flatLayers: unknown;
    documentBounds?: DetailNormalizedRect | null;
}): DetailVisualScreenBoundary[] {
    const screens = Array.isArray(params.screens) ? params.screens : [];
    const nodes = collectVisualLayerNodes(params.flatLayers, params.documentBounds || null);
    const bands = buildVerticalBands(nodes, params.documentBounds || null);

    return bands.map((band) => {
        const match = assignParsedScreenMatch(screens, band.bounds);
        const confidence = clamp01(
            0.45
            + Math.min(0.2, band.layerIds.length * 0.025)
            + Math.min(0.25, match.overlapRatio * 0.3)
        );
        const disagreementFlags: string[] = [];
        if (match.sourceScreenId == null) disagreementFlags.push('no-structure-match');
        if (match.sourceScreenId != null && match.overlapRatio < 0.35) disagreementFlags.push('low-structure-overlap');

        return {
            id: band.id,
            sourceScreenId: match.sourceScreenId,
            sourceScreenName: match.sourceScreenName,
            bounds: band.bounds,
            layerIds: band.layerIds,
            moduleIds: [],
            confidence,
            reasons: [...band.reasons, match.sourceScreenId ? 'matched-structure-screen' : 'visual-only-band'],
            disagreementFlags
        };
    });
}

function shouldLinkNodes(
    a: DetailVisualLayerNode,
    b: DetailVisualLayerNode,
    boundary: DetailVisualScreenBoundary | null
): boolean {
    const overlap = computeDetailRectOverlapRatio(a.bounds, b.bounds);
    if (overlap > 0.12) return true;
    if (a.parentId && b.parentId && a.parentId === b.parentId) return true;
    if (a.isClipped && b.isClipped && a.parentId && b.parentId && a.parentId === b.parentId) return true;

    const bandWidth = boundary?.bounds?.width || Math.max(a.bounds.width, b.bounds.width);
    const bandHeight = boundary?.bounds?.height || Math.max(a.bounds.height, b.bounds.height);
    const hGap = horizontalGap(a.bounds, b.bounds);
    const vGap = verticalGap(a.bounds, b.bounds);
    const vOverlap = verticalOverlapRatio(a.bounds, b.bounds);
    const hOverlap = horizontalOverlapRatio(a.bounds, b.bounds);

    if (hGap <= Math.max(36, bandWidth * 0.08) && vOverlap > 0.25) return true;
    if (vGap <= Math.max(28, bandHeight * 0.06) && hOverlap > 0.2) return true;

    return false;
}

export function buildDetailVisualModules(params: {
    screens?: any[];
    visualScreens: DetailVisualScreenBoundary[];
    flatLayers: unknown;
    documentBounds?: DetailNormalizedRect | null;
}): DetailVisualModule[] {
    const screens = Array.isArray(params.screens) ? params.screens : [];
    const nodes = collectVisualLayerNodes(params.flatLayers, params.documentBounds || null);
    const modules: DetailVisualModule[] = [];
    let moduleIndex = 0;

    for (const visualScreen of params.visualScreens || []) {
        const members = nodes.filter((node) => {
            if (!visualScreen.bounds) return false;
            return centerWithinRect(visualScreen.bounds, node.centerX, node.centerY)
                || computeDetailRectOverlapRatio(visualScreen.bounds, node.bounds) > 0.08;
        });

        const visited = new Set<number>();
        for (const seed of members) {
            if (visited.has(seed.id)) continue;

            const stack = [seed];
            const cluster: DetailVisualLayerNode[] = [];
            visited.add(seed.id);

            while (stack.length) {
                const current = stack.pop()!;
                cluster.push(current);
                for (const candidate of members) {
                    if (visited.has(candidate.id)) continue;
                    if (!shouldLinkNodes(current, candidate, visualScreen)) continue;
                    visited.add(candidate.id);
                    stack.push(candidate);
                }
            }

            const bounds = finalizeRect(unionRects(cluster.map((item) => item.bounds)));
            const textLayerIds = cluster.filter((item) => item.kind === 'text').map((item) => item.id);
            const imageLayerIds = cluster.filter((item) => item.kind === 'image').map((item) => item.id);
            const elementLayerIds = cluster.filter((item) => item.kind === 'element').map((item) => item.id);
            const backgroundLayerIds = cluster.filter((item) => item.kind === 'background').map((item) => item.id);
            const mainImageLayerId = imageLayerIds.length
                ? cluster
                    .filter((item) => item.kind === 'image')
                    .sort((a, b) => b.area - a.area)[0]?.id || null
                : null;
            const sourceScreen = screens.find((screen) => Number(screen?.id || 0) === (visualScreen.sourceScreenId || 0));
            const reasons: string[] = [];
            if (imageLayerIds.length) reasons.push('contains-image');
            if (textLayerIds.length) reasons.push('contains-text');
            if (elementLayerIds.length) reasons.push('contains-elements');
            if (cluster.some((item) => item.isClipped)) reasons.push('contains-clipped-layer');
            if (cluster.length === 1) reasons.push('single-layer-cluster');
            if (cluster.length > 1) reasons.push('proximity-linked-cluster');

            const confidence = clamp01(
                0.35
                + (imageLayerIds.length ? 0.18 : 0)
                + (textLayerIds.length ? 0.16 : 0)
                + (cluster.some((item) => item.parentId && cluster.filter((other) => other.parentId === item.parentId).length > 1) ? 0.08 : 0)
                + Math.min(0.18, cluster.length * 0.03)
            );

            modules.push({
                id: `visual-module-${++moduleIndex}`,
                sourceScreenId: visualScreen.sourceScreenId,
                sourceScreenName: sourceScreen ? String(sourceScreen?.name || '') : visualScreen.sourceScreenName,
                bounds,
                layerIds: cluster.map((item) => item.id),
                textLayerIds,
                imageLayerIds,
                elementLayerIds,
                backgroundLayerIds,
                mainImageLayerId,
                confidence,
                reasons
            });
        }
    }

    return modules;
}

export function auditDetailSegmentationMerge(params: {
    screens?: any[];
    visualScreens: DetailVisualScreenBoundary[];
    visualModules: DetailVisualModule[];
}): DetailSegmentationMergeAudit {
    const screens = Array.isArray(params.screens) ? params.screens : [];
    const lowOverlapScreens: DetailSegmentationMergeAudit['lowOverlapScreens'] = [];
    const unmatchedVisualScreens: DetailSegmentationMergeAudit['unmatchedVisualScreens'] = [];
    const modulesWithoutSourceScreen: DetailSegmentationMergeAudit['modulesWithoutSourceScreen'] = [];

    for (const screen of screens) {
        const screenId = Number(screen?.id || 0);
        const screenName = String(screen?.name || `Screen ${screenId}`);
        const screenBounds = normalizeDetailRect(screen?.bounds);
        let bestVisualScreenId: string | null = null;
        let bestOverlap = 0;
        for (const visualScreen of params.visualScreens || []) {
            const overlap = computeDetailRectOverlapRatio(screenBounds, visualScreen.bounds);
            if (overlap > bestOverlap) {
                bestOverlap = overlap;
                bestVisualScreenId = visualScreen.id;
            }
        }
        if (bestOverlap < 0.35) {
            lowOverlapScreens.push({
                screenId,
                screenName,
                matchedVisualScreenId: bestVisualScreenId,
                overlapRatio: Math.round(bestOverlap * 1000) / 1000
            });
        }
    }

    for (const visualScreen of params.visualScreens || []) {
        if (visualScreen.sourceScreenId == null) {
            unmatchedVisualScreens.push({
                visualScreenId: visualScreen.id,
                confidence: visualScreen.confidence
            });
        }
    }

    for (const module of params.visualModules || []) {
        if (module.sourceScreenId == null) {
            modulesWithoutSourceScreen.push({
                moduleId: module.id,
                confidence: module.confidence,
                layerIds: module.layerIds
            });
        }
    }

    const risky = lowOverlapScreens.length > 0 || unmatchedVisualScreens.length > 0;
    const watch = !risky && modulesWithoutSourceScreen.length > 0;

    return {
        status: risky ? 'risky' : watch ? 'watch' : 'ok',
        summary: {
            parsedScreenCount: screens.length,
            visualScreenCount: params.visualScreens.length,
            moduleCount: params.visualModules.length,
            lowOverlapScreenCount: lowOverlapScreens.length,
            unmatchedVisualScreenCount: unmatchedVisualScreens.length,
            modulesWithoutSourceScreenCount: modulesWithoutSourceScreen.length
        },
        lowOverlapScreens,
        unmatchedVisualScreens,
        modulesWithoutSourceScreen
    };
}

function getVisualModuleDominantType(module: DetailVisualModule): 'image' | 'text' | 'mixed' | 'unknown' {
    const hasImage = module.imageLayerIds.length > 0;
    const hasText = module.textLayerIds.length > 0;
    if (hasImage && hasText) return 'mixed';
    if (hasImage) return 'image';
    if (hasText) return 'text';
    return 'unknown';
}

function inferScreenVisualRoleHint(params: {
    screen: Record<string, unknown>;
    matchedVisualScreens: DetailVisualScreenBoundary[];
    modules: DetailVisualModule[];
    dominantModuleType: 'image' | 'text' | 'mixed' | 'unknown';
}): { roleHint: DetailScreenRole | null; reasons: string[] } {
    const screen = params.screen;
    const reasons: string[] = [];
    const copyCount = Array.isArray(screen?.copyPlaceholders) ? screen.copyPlaceholders.length : 0;
    const imageCount = Array.isArray(screen?.imagePlaceholders) ? screen.imagePlaceholders.length : 0;
    const order = Number(screen?.order || 0);
    const imageDominantModules = params.modules.filter((module) => getVisualModuleDominantType(module) === 'image').length;
    const textDominantModules = params.modules.filter((module) => getVisualModuleDominantType(module) === 'text').length;
    const mixedModules = params.modules.filter((module) => getVisualModuleDominantType(module) === 'mixed').length;

    if (copyCount >= 4 && textDominantModules >= 1) {
        reasons.push('dense-copy-clusters');
        return { roleHint: 'parameter', reasons };
    }

    if (order === 0 && imageDominantModules >= 1 && copyCount <= 2 && params.dominantModuleType === 'image') {
        reasons.push('first-screen-image-dominant');
        return { roleHint: 'hero', reasons };
    }

    if (copyCount === 0 && imageCount >= 1 && imageDominantModules >= 1 && params.matchedVisualScreens.length === 1) {
        reasons.push('image-only-visual-band');
        return { roleHint: 'scene', reasons };
    }

    if (mixedModules >= 1 && imageDominantModules >= 1) {
        reasons.push('mixed-copy-image-clusters');
        return { roleHint: 'selling-point', reasons };
    }

    return { roleHint: null, reasons };
}

export function buildDetailScreenVisualSummaries(params: {
    screens?: Array<Record<string, unknown>>;
    visualScreens: DetailVisualScreenBoundary[];
    visualModules: DetailVisualModule[];
    mergeAudit: DetailSegmentationMergeAudit;
}): DetailScreenVisualSummary[] {
    const screens = Array.isArray(params.screens) ? params.screens : [];
    const lowOverlapMap = new Map<number, number>(
        (params.mergeAudit.lowOverlapScreens || []).map((item) => [Number(item.screenId || 0), Number(item.overlapRatio || 0)])
    );

    return screens.map((screen) => {
        const screenId = Number(screen?.id || 0);
        const screenName = String(screen?.name || `Screen ${screenId}`);
        const screenBounds = normalizeDetailRect(screen?.bounds);
        const matchedVisualScreens = params.visualScreens.filter((item) => item.sourceScreenId === screenId);
        const modules = params.visualModules.filter((item) => item.sourceScreenId === screenId);
        const imageModuleCount = modules.filter((item) => item.imageLayerIds.length > 0).length;
        const textModuleCount = modules.filter((item) => item.textLayerIds.length > 0).length;
        const mixedModuleCount = modules.filter((item) => getVisualModuleDominantType(item) === 'mixed').length;
        const imageOnlyModuleCount = modules.filter((item) => getVisualModuleDominantType(item) === 'image').length;
        const textOnlyModuleCount = modules.filter((item) => getVisualModuleDominantType(item) === 'text').length;

        const dominantModuleType: DetailScreenVisualSummary['dominantModuleType'] =
            imageOnlyModuleCount > textOnlyModuleCount && imageOnlyModuleCount >= mixedModuleCount
                ? 'image'
                : textOnlyModuleCount > imageOnlyModuleCount && textOnlyModuleCount >= mixedModuleCount
                    ? 'text'
                    : mixedModuleCount > 0
                        ? 'mixed'
                        : 'unknown';

        let bestVisualScreenId: string | null = null;
        let bestAgreement = 0;
        for (const visualScreen of matchedVisualScreens) {
            const overlap = computeDetailRectOverlapRatio(screenBounds, visualScreen.bounds);
            if (overlap > bestAgreement) {
                bestAgreement = overlap;
                bestVisualScreenId = visualScreen.id;
            }
        }

        const boundaryRisk: DetailScreenVisualSummary['boundaryRisk'] =
            matchedVisualScreens.length === 0 || lowOverlapMap.has(screenId)
                ? 'risky'
                : matchedVisualScreens.length > 1
                    ? 'watch'
                    : 'ok';

        const roleHintResult = inferScreenVisualRoleHint({
            screen,
            matchedVisualScreens,
            modules,
            dominantModuleType
        });

        const confidence = clamp01(
            0.38
            + Math.min(0.18, matchedVisualScreens.length * 0.08)
            + Math.min(0.2, modules.length * 0.04)
            + Math.min(0.14, bestAgreement * 0.18)
            + (roleHintResult.roleHint ? 0.08 : 0)
            - (boundaryRisk === 'risky' ? 0.12 : boundaryRisk === 'watch' ? 0.05 : 0)
        );

        const reasons: string[] = [];
        if (bestAgreement > 0) reasons.push(`agreement:${Math.round(bestAgreement * 100)}%`);
        if (matchedVisualScreens.length > 1) reasons.push('multiple-visual-bands');
        if (boundaryRisk === 'risky') reasons.push('screen-boundary-disagreement');
        if (dominantModuleType !== 'unknown') reasons.push(`dominant:${dominantModuleType}`);
        reasons.push(...roleHintResult.reasons);

        return {
            screenId,
            screenName,
            visualScreenCount: matchedVisualScreens.length,
            visualModuleCount: modules.length,
            imageModuleCount,
            textModuleCount,
            mixedModuleCount,
            dominantModuleType,
            primaryVisualScreenId: bestVisualScreenId,
            segmentationAgreement: Math.max(bestAgreement, Number(lowOverlapMap.get(screenId) || 0)),
            boundaryRisk,
            confidence,
            roleHint: roleHintResult.roleHint,
            mainImageLayerIds: modules
                .map((item) => item.mainImageLayerId)
                .filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0),
            reasons
        };
    });
}

export function captureDetailVisualContextBundle(params: {
    screens?: any[];
    screenPlans?: any[];
    visualScreens: DetailVisualScreenBoundary[];
    visualModules: DetailVisualModule[];
    mergeAudit: DetailSegmentationMergeAudit;
}): Record<string, unknown> {
    const screens = Array.isArray(params.screens) ? params.screens : [];
    const screenPlans = Array.isArray(params.screenPlans) ? params.screenPlans : [];

    const bundleScreens = screens.map((screen) => {
        const screenId = Number(screen?.id || 0);
        const matchedVisualScreens = params.visualScreens.filter((item) => item.sourceScreenId === screenId);
        const modules = params.visualModules.filter((item) => item.sourceScreenId === screenId);
        const plan = screenPlans.find((item) => Number(item?.screenId || 0) === screenId);

        return {
            screenId,
            screenName: String(screen?.name || ''),
            sourceBounds: normalizeDetailRect(screen?.bounds),
            screenRole: plan?.screenRole || 'unknown',
            copyStrategy: plan?.copyStrategy || 'unknown',
            imageStrategy: plan?.imageStrategy || 'unknown',
            confidence: typeof plan?.confidence === 'number' ? plan.confidence : null,
            visualScreenCount: matchedVisualScreens.length,
            visualModuleCount: modules.length,
            visualScreens: matchedVisualScreens.map((item) => ({
                id: item.id,
                bounds: item.bounds,
                confidence: item.confidence,
                disagreementFlags: item.disagreementFlags
            })),
            visualModules: modules.map((item) => ({
                id: item.id,
                bounds: item.bounds,
                mainImageLayerId: item.mainImageLayerId,
                textLayerIds: item.textLayerIds,
                imageLayerIds: item.imageLayerIds,
                confidence: item.confidence
            }))
        };
    });

    return {
        success: true,
        summary: {
            screenCount: screens.length,
            visualScreenCount: params.visualScreens.length,
            visualModuleCount: params.visualModules.length,
            mergeStatus: params.mergeAudit.status
        },
        screens: bundleScreens,
        mergeAudit: params.mergeAudit
    };
}
