import { buildDesignScene } from './design-selected-scene';
import type {
    SelectedDesignContext,
    SelectedDesignContextSummary,
    SelectedElementContext,
    SelectedModuleContext
} from './types/design-core.types';

export function buildSelectedDesignContext(params: {
    selectedElementContext: SelectedElementContext;
    selectedModuleContext: SelectedModuleContext | null;
}): SelectedDesignContext {
    const { selectedElementContext, selectedModuleContext } = params;
    const selectedElement = selectedElementContext.selectedElement;
    const scene = buildDesignScene({
        selectedElementContext,
        selectedModuleContext
    });

    const summary: SelectedDesignContextSummary = {
        documentName: selectedElementContext.document.name ?? null,
        selectedLayerId: Number(selectedElement.layerId || selectedModuleContext?.selectedElementLayerId || 0),
        selectedLayerName: String(selectedElement.name || ''),
        selectedKind: String(selectedElement.kind || 'unknown'),
        moduleFound: scene?.diagnostics?.moduleFound === true,
        moduleId: scene?.selectedModule?.id || null,
        screenModuleId: scene?.selectedScreen?.id || null,
        memberLayerCount: Array.isArray(selectedModuleContext?.memberLayers) ? selectedModuleContext.memberLayers.length : 0,
        relationCount: scene?.diagnostics?.relationCount || 0,
        inferenceMode: scene?.diagnostics?.inferenceMode || null
    };

    return {
        source: 'selected-element',
        selectedElementContext,
        selectedModuleContext,
        summary,
        scene
    };
}
