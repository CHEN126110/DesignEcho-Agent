import type {
    DesignScene,
    SelectedElementContext,
    SelectedModuleContext
} from './types/design-core.types';
import { buildDesignScreenFromSelection } from './design-scene-graph';

export function buildDesignScene(params: {
    selectedElementContext: SelectedElementContext;
    selectedModuleContext: SelectedModuleContext | null;
}): DesignScene {
    const { selectedElementContext, selectedModuleContext } = params;

    return {
        source: 'selected-context',
        document: selectedElementContext.document,
        selectedElement: selectedElementContext.selectedElement,
        selectedModule: selectedModuleContext?.module || null,
        selectedScreen: buildDesignScreenFromSelection(params),
        relations: selectedModuleContext?.relations || [],
        diagnostics: {
            moduleFound: selectedModuleContext?.diagnostics?.moduleFound === true,
            relationCount: Array.isArray(selectedModuleContext?.relations) ? selectedModuleContext.relations.length : 0,
            inferenceMode: selectedModuleContext?.diagnostics?.inferenceMode || null
        }
    };
}
