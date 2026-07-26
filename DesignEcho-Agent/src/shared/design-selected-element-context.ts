import type {
    DesignElementBounds,
    DesignElementIdentity,
    DesignElementKind,
    DesignLayerRef,
    SelectedElementContext,
    SelectedElementDetailContext,
    SelectedElementRelations,
    SelectedElementTextContext
} from './types/design-scene.types';

type RawLayerNode = Record<string, unknown>;

function toNumber(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function normalizeSceneBounds(input: unknown): DesignElementBounds | null {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
    const record = input as Record<string, unknown>;

    const left = toNumber(record.left) ?? toNumber(record.x);
    const top = toNumber(record.top) ?? toNumber(record.y);
    const right = toNumber(record.right);
    const bottom = toNumber(record.bottom);
    const width = toNumber(record.width);
    const height = toNumber(record.height);

    if (left === null || top === null) return null;
    const normalizedWidth = width ?? (right !== null ? Math.max(0, right - left) : null);
    const normalizedHeight = height ?? (bottom !== null ? Math.max(0, bottom - top) : null);
    if (normalizedWidth === null || normalizedHeight === null) return null;

    const normalizedRight = right ?? (left + normalizedWidth);
    const normalizedBottom = bottom ?? (top + normalizedHeight);

    return {
        left,
        top,
        right: normalizedRight,
        bottom: normalizedBottom,
        width: normalizedWidth,
        height: normalizedHeight,
        centerX: left + (normalizedWidth / 2),
        centerY: top + (normalizedHeight / 2)
    };
}

export function inferDesignElementKind(rawKind: unknown, bounds: DesignElementBounds | null, documentBounds: DesignElementBounds | null): DesignElementKind {
    const kind = String(rawKind || '').trim().toLowerCase();
    if (kind.includes('text')) return 'text';
    if (kind.includes('group')) return 'group';
    if (kind.includes('shape') || kind.includes('solid') || kind.includes('vector')) return 'shape';
    if (kind.includes('smartobject') || kind.includes('pixel') || kind.includes('image')) return 'image';

    const area = bounds ? bounds.width * bounds.height : 0;
    const documentArea = documentBounds ? documentBounds.width * documentBounds.height : 0;
    if (documentArea > 0 && area / documentArea >= 0.8) return 'background';

    return 'unknown';
}

function distanceBetween(a: DesignElementBounds | null, b: DesignElementBounds | null): number {
    if (!a || !b) return Number.POSITIVE_INFINITY;
    const dx = a.centerX - b.centerX;
    const dy = a.centerY - b.centerY;
    return Math.sqrt((dx * dx) + (dy * dy));
}

function overlapRatio(a: DesignElementBounds | null, b: DesignElementBounds | null): number {
    if (!a || !b) return 0;
    const left = Math.max(a.left, b.left);
    const top = Math.max(a.top, b.top);
    const right = Math.min(a.right, b.right);
    const bottom = Math.min(a.bottom, b.bottom);
    const width = Math.max(0, right - left);
    const height = Math.max(0, bottom - top);
    if (width <= 0 || height <= 0) return 0;
    const intersection = width * height;
    const denominator = Math.max(1, Math.min(a.width * a.height, b.width * b.height));
    return intersection / denominator;
}

function buildLayerRef(node: RawLayerNode, documentBounds: DesignElementBounds | null, extras?: Partial<DesignLayerRef>): DesignLayerRef {
    const bounds = normalizeSceneBounds(node.bounds);
    return {
        layerId: Number(node.id || 0),
        name: String(node.name || node.id || ''),
        kind: inferDesignElementKind(node.kind, bounds, documentBounds),
        rawKind: String(node.kind || ''),
        bounds,
        ...extras
    };
}

function summarizeTextContext(contentPayload: Record<string, unknown> | null, stylePayload: Record<string, unknown> | null): SelectedElementTextContext | undefined {
    const content = typeof contentPayload?.content === 'string'
        ? String(contentPayload.content)
        : undefined;

    if (!content) return undefined;

    const style = stylePayload?.style && typeof stylePayload.style === 'object'
        ? stylePayload.style as Record<string, unknown>
        : null;

    return {
        content,
        lineCount: content.length ? content.split('\n').length : 0,
        styleSummary: style ? {
            fontSize: toNumber(style.fontSize) ?? undefined,
            fontName: typeof style.fontName === 'string' ? style.fontName : undefined,
            fontStyle: typeof style.fontStyle === 'string' ? style.fontStyle : undefined,
            tracking: toNumber(style.tracking) ?? undefined,
            leading: toNumber(style.leading) ?? undefined,
            color: style.color && typeof style.color === 'object'
                ? {
                    r: Number((style.color as Record<string, unknown>).r || 0),
                    g: Number((style.color as Record<string, unknown>).g || 0),
                    b: Number((style.color as Record<string, unknown>).b || 0)
                }
                : undefined
        } : undefined
    };
}

function buildRelations(
    selectedNode: RawLayerNode,
    flatLayers: RawLayerNode[],
    clippingPayload: Record<string, unknown> | null,
    documentBounds: DesignElementBounds | null,
    relationLimit: number
): SelectedElementRelations {
    const selectedId = Number(selectedNode.id || 0);
    const selectedBounds = normalizeSceneBounds(selectedNode.bounds);
    const selectedParentId = toNumber(selectedNode.parentId);

    const parentNode = selectedParentId !== null
        ? flatLayers.find((layer) => Number(layer.id || 0) === selectedParentId) || null
        : null;

    const children = flatLayers
        .filter((layer) => toNumber(layer.parentId) === selectedId)
        .map((layer) => buildLayerRef(layer, documentBounds))
        .slice(0, relationLimit);

    const siblings = flatLayers
        .filter((layer) => Number(layer.id || 0) !== selectedId && toNumber(layer.parentId) === selectedParentId)
        .map((layer) => ({
            ref: buildLayerRef(layer, documentBounds),
            distance: distanceBetween(selectedBounds, normalizeSceneBounds(layer.bounds))
        }))
        .sort((a, b) => a.distance - b.distance)
        .slice(0, relationLimit)
        .map((item) => ({ ...item.ref, distance: item.distance }));

    const overlappingLayers = flatLayers
        .filter((layer) => Number(layer.id || 0) !== selectedId)
        .map((layer) => {
            const candidateBounds = normalizeSceneBounds(layer.bounds);
            const ratio = overlapRatio(selectedBounds, candidateBounds);
            return {
                ref: buildLayerRef(layer, documentBounds),
                overlapRatio: ratio
            };
        })
        .filter((item) => item.overlapRatio >= 0.18)
        .sort((a, b) => b.overlapRatio - a.overlapRatio)
        .slice(0, relationLimit)
        .map((item) => ({ ...item.ref, overlapRatio: item.overlapRatio }));

    const nearestTextLayers = flatLayers
        .filter((layer) => Number(layer.id || 0) !== selectedId)
        .map((layer) => {
            const ref = buildLayerRef(layer, documentBounds);
            return {
                ref,
                distance: distanceBetween(selectedBounds, normalizeSceneBounds(layer.bounds))
            };
        })
        .filter((item) => item.ref.kind === 'text')
        .sort((a, b) => a.distance - b.distance)
        .slice(0, relationLimit)
        .map((item) => ({ ...item.ref, distance: item.distance }));

    const nearestImageLayers = flatLayers
        .filter((layer) => Number(layer.id || 0) !== selectedId)
        .map((layer) => {
            const ref = buildLayerRef(layer, documentBounds);
            return {
                ref,
                distance: distanceBetween(selectedBounds, normalizeSceneBounds(layer.bounds))
            };
        })
        .filter((item) => item.ref.kind === 'image')
        .sort((a, b) => a.distance - b.distance)
        .slice(0, relationLimit)
        .map((item) => ({ ...item.ref, distance: item.distance }));

    const clippingInfo = clippingPayload?.clippingMaskInfo && typeof clippingPayload.clippingMaskInfo === 'object'
        ? clippingPayload.clippingMaskInfo as Record<string, unknown>
        : null;

    const clippingBaseId = toNumber(clippingInfo?.clippingBaseId);
    const clippingBaseNode = clippingBaseId !== null
        ? flatLayers.find((layer) => Number(layer.id || 0) === clippingBaseId) || null
        : null;

    const clippedLayerIds = clippingInfo?.isClippingBase === true
        ? flatLayers
            .filter((layer) => {
                const candidateParentId = toNumber(layer.parentId);
                return candidateParentId === selectedParentId && layer.isClipped === true;
            })
            .map((layer) => Number(layer.id || 0))
            .filter((id) => id > 0)
        : [];

    return {
        parent: parentNode ? buildLayerRef(parentNode, documentBounds) : null,
        children,
        siblings,
        overlappingLayers,
        nearestTextLayers,
        nearestImageLayers,
        clipping: {
            isClipped: clippingInfo?.isClipped === true || selectedNode.isClipped === true,
            isClippingBase: clippingInfo?.isClippingBase === true || selectedNode.isClippingMask === true,
            clippingBase: clippingBaseNode ? buildLayerRef(clippingBaseNode, documentBounds) : null,
            clippedLayerIds
        }
    };
}

function buildDetailContext(
    layerId: number,
    detailPayload: Record<string, unknown> | null
): SelectedElementDetailContext | undefined {
    if (!detailPayload?.success) return undefined;

    const visualModules = Array.isArray(detailPayload.visualModules) ? detailPayload.visualModules as Array<Record<string, unknown>> : [];
    const screens = Array.isArray(detailPayload.screens) ? detailPayload.screens as Array<Record<string, unknown>> : [];
    const screenPlans = Array.isArray(detailPayload.screenPlans) ? detailPayload.screenPlans as Array<Record<string, unknown>> : [];
    const audit = detailPayload.audit && typeof detailPayload.audit === 'object'
        ? detailPayload.audit as Record<string, unknown>
        : null;

    const visualModule = visualModules.find((module) => {
        const layerIds = Array.isArray(module.layerIds) ? module.layerIds.map((value) => Number(value)) : [];
        return layerIds.includes(layerId);
    }) || null;

    let screenId: number | null = null;
    let screenName: string | null = null;

    if (visualModule && typeof visualModule.sourceScreenId === 'number') {
        screenId = Number(visualModule.sourceScreenId);
    } else {
        const matchedScreen = screens.find((screen) => {
            const copyIds = Array.isArray(screen.copyPlaceholders) ? screen.copyPlaceholders.map((item: any) => Number(item?.layerId || 0)) : [];
            const imageIds = Array.isArray(screen.imagePlaceholders) ? screen.imagePlaceholders.map((item: any) => Number(item?.layerId || 0)) : [];
            const iconIds = Array.isArray(screen.iconPlaceholders) ? screen.iconPlaceholders.map((item: any) => Number(item?.layerId || 0)) : [];
            return [...copyIds, ...imageIds, ...iconIds].includes(layerId);
        }) || null;
        if (matchedScreen) {
            screenId = Number(matchedScreen.id || 0) || null;
        }
    }

    const screen = screenId !== null
        ? screens.find((item) => Number(item.id || 0) === screenId) || null
        : null;
    if (screen) {
        screenName = String(screen.name || '');
    }

    const screenPlan = screenId !== null
        ? screenPlans.find((plan) => Number(plan.screenId || 0) === screenId) || null
        : null;

    return {
        screenId,
        screenName,
        screenRole: typeof screenPlan?.screenRole === 'string' ? String(screenPlan.screenRole) : null,
        screenConfidence: toNumber(screenPlan?.confidence),
        visualModuleId: visualModule ? String(visualModule.id || '') : null,
        visualModuleConfidence: visualModule ? toNumber(visualModule.confidence) ?? undefined : undefined,
        visualModuleLayerIds: visualModule && Array.isArray(visualModule.layerIds)
            ? visualModule.layerIds.map((value) => Number(value)).filter((value) => value > 0)
            : [],
        segmentationStatus: audit && typeof audit.status === 'string'
            ? audit.status as SelectedElementDetailContext['segmentationStatus']
            : null
    };
}

export function buildSelectedElementContext(params: {
    source: 'active-layer' | 'layer-id';
    documentInfo: Record<string, unknown> | null;
    selectedNode: RawLayerNode;
    flatLayers: RawLayerNode[];
    propertiesPayload?: Record<string, unknown> | null;
    clippingPayload?: Record<string, unknown> | null;
    textContentPayload?: Record<string, unknown> | null;
    textStylePayload?: Record<string, unknown> | null;
    detailPayload?: Record<string, unknown> | null;
    includeText: boolean;
    includeDetailContext: boolean;
    relationLimit: number;
    usedTools: string[];
}): SelectedElementContext {
    const documentInfo = params.documentInfo || {};
    const documentBounds = normalizeSceneBounds({
        left: 0,
        top: 0,
        right: toNumber(documentInfo.width) ?? 0,
        bottom: toNumber(documentInfo.height) ?? 0
    });
    const selectedBounds = normalizeSceneBounds(
        (params.propertiesPayload?.properties as Record<string, unknown> | undefined)?.bounds || params.selectedNode.bounds
    );
    const rawKind = String(params.selectedNode.kind || params.propertiesPayload?.properties && (params.propertiesPayload.properties as Record<string, unknown>).kind || '');
    const kind = inferDesignElementKind(rawKind, selectedBounds, documentBounds);

    const identity: DesignElementIdentity = {
        layerId: Number(params.selectedNode.id || 0),
        name: String(params.selectedNode.name || ''),
        kind,
        rawKind,
        visible: params.selectedNode.visible !== false,
        locked: Boolean(params.selectedNode.locked || (params.propertiesPayload?.properties as Record<string, unknown> | undefined)?.locked),
        opacity: toNumber(params.selectedNode.opacity) ?? toNumber((params.propertiesPayload?.properties as Record<string, unknown> | undefined)?.opacity) ?? undefined,
        blendMode: String(params.selectedNode.blendMode || (params.propertiesPayload?.properties as Record<string, unknown> | undefined)?.blendMode || ''),
        parentId: toNumber(params.selectedNode.parentId),
        parentName: typeof params.selectedNode.parentName === 'string' ? String(params.selectedNode.parentName) : null,
        depth: Number(params.selectedNode.depth || 0),
        index: Number(params.selectedNode.index || 0),
        path: typeof params.selectedNode.path === 'string' ? String(params.selectedNode.path) : String(params.selectedNode.name || ''),
        pathIds: Array.isArray(params.selectedNode.pathIds) ? params.selectedNode.pathIds.map((value) => Number(value)).filter((value) => value > 0) : [],
        isClipped: params.selectedNode.isClipped === true,
        isClippingBase: params.selectedNode.isClippingMask === true,
        bounds: selectedBounds
    };

    return {
        source: params.source,
        document: {
            id: toNumber(documentInfo.id),
            name: typeof documentInfo.name === 'string' ? String(documentInfo.name) : null,
            width: toNumber(documentInfo.width) ?? undefined,
            height: toNumber(documentInfo.height) ?? undefined,
            mode: typeof documentInfo.mode === 'string' ? String(documentInfo.mode) : undefined
        },
        selectedElement: identity,
        relations: buildRelations(
            params.selectedNode,
            params.flatLayers,
            params.clippingPayload || null,
            documentBounds,
            params.relationLimit
        ),
        text: params.includeText ? summarizeTextContext(params.textContentPayload || null, params.textStylePayload || null) : undefined,
        detail: params.includeDetailContext ? buildDetailContext(identity.layerId, params.detailPayload || null) : undefined,
        diagnostics: {
            includeText: params.includeText,
            includeDetailContext: params.includeDetailContext,
            relationLimit: params.relationLimit,
            usedTools: params.usedTools
        }
    };
}
