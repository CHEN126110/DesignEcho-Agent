import type { DetailVisualModule, DetailVisualScreenBoundary } from './detail-page-visual-segmentation';
import { normalizeSceneBounds } from './design-selected-element-context';
import type {
    DesignLayerRef,
    DesignModule,
    DesignRelation,
    DesignScreen,
    SelectedElementContext,
    SelectedModuleContext
} from './types/design-core.types';

export function clampDesignConfidence(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(1, value));
}

export function buildDesignModuleFromVisualModule(module: DetailVisualModule | null): DesignModule | null {
    if (!module) return null;
    return {
        id: String(module.id || ''),
        moduleType: 'visual',
        bounds: normalizeSceneBounds(module.bounds),
        layerIds: Array.isArray(module.layerIds) ? module.layerIds.map((item) => Number(item)).filter((item) => item > 0) : [],
        primaryLayerId: typeof module.mainImageLayerId === 'number' ? module.mainImageLayerId : null,
        confidence: clampDesignConfidence(Number(module.confidence || 0))
    };
}

export function buildDesignModuleFromScreenBoundary(screen: DetailVisualScreenBoundary | null): DesignModule | null {
    if (!screen) return null;
    return {
        id: String(screen.id || ''),
        moduleType: 'screen',
        bounds: normalizeSceneBounds(screen.bounds),
        layerIds: Array.isArray(screen.layerIds) ? screen.layerIds.map((item) => Number(item)).filter((item) => item > 0) : [],
        primaryLayerId: null,
        confidence: clampDesignConfidence(Number(screen.confidence || 0))
    };
}

export function buildClusterBounds(layers: DesignLayerRef[]): ReturnType<typeof normalizeSceneBounds> {
    const valid = layers.map((item) => item.bounds).filter(Boolean);
    if (!valid.length) return null;
    const left = Math.min(...valid.map((item) => Number(item!.left)));
    const top = Math.min(...valid.map((item) => Number(item!.top)));
    const right = Math.max(...valid.map((item) => Number(item!.right)));
    const bottom = Math.max(...valid.map((item) => Number(item!.bottom)));
    return normalizeSceneBounds({
        left,
        top,
        right,
        bottom,
        width: Math.max(0, right - left),
        height: Math.max(0, bottom - top)
    });
}

function dedupeLayerRefs(items: Array<DesignLayerRef | null | undefined>, relationLimit: number): DesignLayerRef[] {
    const seen = new Set<number>();
    const results: DesignLayerRef[] = [];
    for (const item of items) {
        const layerId = Number(item?.layerId || 0);
        if (!item || layerId <= 0 || seen.has(layerId)) continue;
        seen.add(layerId);
        results.push(item);
        if (results.length >= Math.max(1, relationLimit)) break;
    }
    return results;
}

export function buildLayerRefMap(relations: SelectedElementContext['relations']): Map<number, DesignLayerRef> {
    const refs: DesignLayerRef[] = [
        ...(relations.children || []),
        ...(relations.siblings || []),
        ...(relations.overlappingLayers || []),
        ...(relations.nearestImageLayers || []),
        ...(relations.nearestTextLayers || [])
    ];
    if (relations.parent) refs.unshift(relations.parent);
    return new Map<number, DesignLayerRef>(
        refs
            .filter((ref) => Number(ref.layerId || 0) > 0)
            .map((ref) => [Number(ref.layerId || 0), ref])
    );
}

export function inferGenericSelectionModule(params: {
    selectedElementContext: SelectedElementContext;
    relationLimit: number;
}): { module: DesignModule | null; memberLayers: DesignLayerRef[]; inferenceMode: SelectedModuleContext['diagnostics']['inferenceMode'] } {
    const { selectedElementContext, relationLimit } = params;
    const selectedElement = selectedElementContext.selectedElement;
    const relations = selectedElementContext.relations;
    const selectedLayerId = Number(selectedElement.layerId || 0);
    const parent = relations.parent;

    if (parent && parent.kind === 'group') {
        const memberLayers = dedupeLayerRefs(
            [selectedElement as DesignLayerRef, ...relations.children, ...relations.siblings],
            relationLimit + 1
        ).filter((item) => Number(item.layerId || 0) !== selectedLayerId);
        const layerIds = [selectedLayerId, ...memberLayers.map((item) => Number(item.layerId || 0))].filter((item) => item > 0);
        return {
            module: {
                id: `group:${parent.layerId}`,
                moduleType: 'visual',
                bounds: parent.bounds || buildClusterBounds([selectedElement as DesignLayerRef, ...memberLayers]),
                layerIds,
                primaryLayerId: selectedElement.kind === 'image'
                    ? selectedLayerId
                    : Number(relations.nearestImageLayers[0]?.layerId || selectedLayerId) || selectedLayerId,
                confidence: 0.82
            },
            memberLayers,
            inferenceMode: 'parent-group'
        };
    }

    const clusterMembers = dedupeLayerRefs(
        [
            selectedElement as DesignLayerRef,
            ...relations.overlappingLayers,
            ...relations.nearestTextLayers,
            ...relations.nearestImageLayers,
            relations.clipping.clippingBase || null
        ],
        relationLimit + 1
    ).filter((item) => Number(item.layerId || 0) !== selectedLayerId);

    if (clusterMembers.length > 0) {
        const layerIds = [selectedLayerId, ...clusterMembers.map((item) => Number(item.layerId || 0))].filter((item) => item > 0);
        return {
            module: {
                id: `cluster:${selectedLayerId}`,
                moduleType: 'visual',
                bounds: buildClusterBounds([selectedElement as DesignLayerRef, ...clusterMembers]),
                layerIds,
                primaryLayerId: selectedElement.kind === 'image'
                    ? selectedLayerId
                    : Number(relations.nearestImageLayers[0]?.layerId || selectedLayerId) || selectedLayerId,
                confidence: 0.64
            },
            memberLayers: clusterMembers,
            inferenceMode: 'selection-cluster'
        };
    }

    return {
        module: null,
        memberLayers: [],
        inferenceMode: 'none'
    };
}

export function buildSelectionModuleRelations(params: {
    selectedLayerId: number;
    selectedElementContext: SelectedElementContext;
    moduleRef: DesignModule | null;
    screenRef: DesignModule | null;
    relationLimit: number;
}): DesignRelation[] {
    const { selectedLayerId, selectedElementContext, moduleRef, screenRef, relationLimit } = params;
    const relations: DesignRelation[] = [];

    if (moduleRef) {
        relations.push({
            type: 'belongsTo',
            fromType: 'layer',
            fromId: selectedLayerId,
            toType: 'module',
            toId: moduleRef.id,
            score: moduleRef.confidence
        });
        for (const layerId of moduleRef.layerIds.slice(0, Math.max(1, relationLimit))) {
            relations.push({
                type: 'contains',
                fromType: 'module',
                fromId: moduleRef.id,
                toType: 'layer',
                toId: layerId,
                score: moduleRef.confidence
            });
        }
    }

    if (moduleRef && screenRef) {
        relations.push({
            type: 'belongsTo',
            fromType: 'module',
            fromId: moduleRef.id,
            toType: 'module',
            toId: screenRef.id,
            score: Math.min(moduleRef.confidence, screenRef.confidence)
        });
    }

    if (selectedElementContext.relations.parent) {
        relations.push({
            type: 'parent',
            fromType: 'layer',
            fromId: selectedLayerId,
            toType: 'layer',
            toId: selectedElementContext.relations.parent.layerId,
            score: 1
        });
    }

    if (selectedElementContext.relations.clipping.clippingBase) {
        relations.push({
            type: 'clips',
            fromType: 'layer',
            fromId: selectedLayerId,
            toType: 'layer',
            toId: selectedElementContext.relations.clipping.clippingBase.layerId,
            score: 1
        });
    }

    return relations;
}

export function buildDesignScreenFromSelection(params: {
    selectedElementContext: SelectedElementContext;
    selectedModuleContext: SelectedModuleContext | null;
}): DesignScreen | null {
    const { selectedElementContext, selectedModuleContext } = params;
    const detail = selectedElementContext.detail;
    const screenModule = selectedModuleContext?.parentScreenModule || null;
    const screenId = Number(detail?.screenId || 0) || null;

    if (!screenModule && screenId === null) {
        return null;
    }

    return {
        id: screenModule?.id || `screen:${screenId}`,
        sourceScreenId: screenId,
        name: detail?.screenName || null,
        role: detail?.screenRole || null,
        bounds: screenModule?.bounds || null,
        moduleIds: selectedModuleContext?.module ? [selectedModuleContext.module.id] : [],
        confidence: clampDesignConfidence(
            Number(detail?.screenConfidence || screenModule?.confidence || 0)
        )
    };
}
