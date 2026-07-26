import type { DetailVisualModule, DetailVisualScreenBoundary } from './detail-page-visual-segmentation';
import {
    buildDesignModuleFromScreenBoundary,
    buildDesignModuleFromVisualModule,
    buildLayerRefMap,
    buildSelectionModuleRelations,
    inferGenericSelectionModule
} from './design-scene-graph';
import type { DesignLayerRef, SelectedElementContext } from './types/design-scene.types';
import type { DesignModule, DesignRelation, SelectedModuleContext } from './types/design-graph.types';

export function buildSelectedModuleContext(params: {
    selectedElementContext: SelectedElementContext;
    visualModules?: DetailVisualModule[];
    visualScreens?: DetailVisualScreenBoundary[];
    relationLimit: number;
}): SelectedModuleContext {
    const { selectedElementContext, visualModules, visualScreens, relationLimit } = params;
    const selectedLayerId = Number(selectedElementContext.selectedElement.layerId || 0);
    const explicitVisualModuleId = selectedElementContext.detail?.visualModuleId || null;
    const matchedModule = explicitVisualModuleId
        ? (visualModules || []).find((item) => String(item.id || '') === explicitVisualModuleId) || null
        : (visualModules || []).find((item) => Array.isArray(item.layerIds) && item.layerIds.map(Number).includes(selectedLayerId)) || null;
    const focusedScreenId = Number(selectedElementContext.detail?.screenId || matchedModule?.sourceScreenId || 0) || null;
    const matchedScreen = focusedScreenId !== null
        ? (visualScreens || []).find((item) => Number(item.sourceScreenId || 0) === focusedScreenId) || null
        : null;

    const genericModule = inferGenericSelectionModule({
        selectedElementContext,
        relationLimit
    });
    const moduleRef = buildDesignModuleFromVisualModule(matchedModule) || genericModule.module;
    const screenRef = buildDesignModuleFromScreenBoundary(matchedScreen);
    const layerRefMap = buildLayerRefMap(selectedElementContext.relations);
    const memberLayers: DesignLayerRef[] = matchedModule && moduleRef
        ? moduleRef.layerIds
            .filter((layerId) => layerId !== selectedLayerId)
            .map((layerId) => layerRefMap.get(layerId))
            .filter(Boolean)
            .slice(0, Math.max(1, relationLimit)) as DesignLayerRef[]
        : genericModule.memberLayers;

    const inferenceMode: SelectedModuleContext['diagnostics']['inferenceMode'] = matchedModule
        ? 'detail-visual'
        : genericModule.inferenceMode;

    const relations: DesignRelation[] = buildSelectionModuleRelations({
        selectedLayerId,
        selectedElementContext,
        moduleRef,
        screenRef,
        relationLimit
    });

    return {
        source: 'selected-element',
        selectedElementLayerId: selectedLayerId,
        selectedElementContext,
        module: moduleRef,
        parentScreenModule: screenRef,
        memberLayers,
        relations,
        diagnostics: {
            relationLimit,
            moduleFound: Boolean(moduleRef),
            usedDetailContext: Boolean(selectedElementContext.detail),
            inferenceMode
        }
    };
}
