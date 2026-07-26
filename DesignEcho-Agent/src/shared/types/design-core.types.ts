export type DesignElementKind =
    | 'text'
    | 'image'
    | 'shape'
    | 'group'
    | 'background'
    | 'decoration'
    | 'unknown';

export interface DesignElementBounds {
    left: number;
    top: number;
    right: number;
    bottom: number;
    width: number;
    height: number;
    centerX: number;
    centerY: number;
}

export interface DesignLayerRef {
    layerId: number;
    name: string;
    kind: DesignElementKind;
    rawKind?: string;
    bounds?: DesignElementBounds | null;
    distance?: number;
    overlapRatio?: number;
}

export interface DesignElementIdentity {
    layerId: number;
    name: string;
    kind: DesignElementKind;
    rawKind: string;
    visible: boolean;
    locked: boolean;
    opacity?: number;
    blendMode?: string;
    parentId: number | null;
    parentName: string | null;
    depth: number;
    index: number;
    path: string;
    pathIds: number[];
    isClipped: boolean;
    isClippingBase: boolean;
    bounds: DesignElementBounds | null;
}

export interface SelectedElementRelations {
    parent: DesignLayerRef | null;
    children: DesignLayerRef[];
    siblings: DesignLayerRef[];
    overlappingLayers: DesignLayerRef[];
    nearestTextLayers: DesignLayerRef[];
    nearestImageLayers: DesignLayerRef[];
    clipping: {
        isClipped: boolean;
        isClippingBase: boolean;
        clippingBase: DesignLayerRef | null;
        clippedLayerIds: number[];
    };
}

export interface SelectedElementTextContext {
    content: string;
    lineCount: number;
    styleSummary?: {
        fontSize?: number;
        fontName?: string;
        fontStyle?: string;
        tracking?: number;
        leading?: number;
        color?: {
            r: number;
            g: number;
            b: number;
        };
    };
}

export interface SelectedElementDetailContext {
    screenId: number | null;
    screenName: string | null;
    screenRole?: string | null;
    screenConfidence?: number | null;
    visualModuleId: string | null;
    visualModuleConfidence?: number | null;
    visualModuleLayerIds: number[];
    segmentationStatus?: 'ok' | 'watch' | 'risky' | null;
}

export interface SelectedElementContext {
    source: 'active-layer' | 'layer-id';
    document: {
        id: number | null;
        name: string | null;
        width?: number;
        height?: number;
        mode?: string;
    };
    selectedElement: DesignElementIdentity;
    relations: SelectedElementRelations;
    text?: SelectedElementTextContext;
    detail?: SelectedElementDetailContext;
    diagnostics: {
        includeText: boolean;
        includeDetailContext: boolean;
        relationLimit: number;
        usedTools: string[];
    };
}

export type DesignNodeType = 'layer' | 'module' | 'screen';

export type DesignRelationType =
    | 'contains'
    | 'belongsTo'
    | 'parent'
    | 'overlaps'
    | 'near'
    | 'clips'
    | 'alignedWith'
    | 'attachedTo'
    | 'dominates';

export interface DesignModule {
    id: string;
    moduleType: 'screen' | 'visual';
    bounds: DesignElementBounds | null;
    layerIds: number[];
    primaryLayerId: number | null;
    confidence: number;
}

export interface DesignRelation {
    type: DesignRelationType;
    fromType: DesignNodeType;
    fromId: string | number;
    toType: DesignNodeType;
    toId: string | number;
    score: number;
}

export interface SelectedModuleContext {
    source: 'selected-element';
    selectedElementLayerId: number;
    selectedElementContext: SelectedElementContext;
    module: DesignModule | null;
    parentScreenModule: DesignModule | null;
    memberLayers: DesignLayerRef[];
    relations: DesignRelation[];
    diagnostics: {
        relationLimit: number;
        moduleFound: boolean;
        usedDetailContext: boolean;
        inferenceMode: 'detail-visual' | 'parent-group' | 'selection-cluster' | 'none';
    };
}

export interface SelectedDesignContextSummary {
    documentName: string | null;
    selectedLayerId: number;
    selectedLayerName: string;
    selectedKind: string;
    moduleFound: boolean;
    moduleId: string | null;
    screenModuleId: string | null;
    memberLayerCount: number;
    relationCount: number;
    inferenceMode: SelectedModuleContext['diagnostics']['inferenceMode'] | null;
}

export interface SelectedDesignContext {
    source: 'selected-element';
    selectedElementContext: SelectedElementContext;
    selectedModuleContext: SelectedModuleContext | null;
    summary: SelectedDesignContextSummary;
    scene: DesignScene | null;
}

export interface DesignScreen {
    id: string;
    sourceScreenId: number | null;
    name: string | null;
    role: string | null;
    bounds: DesignElementBounds | null;
    moduleIds: string[];
    confidence: number;
}

export interface DesignScene {
    source: 'selected-context';
    document: SelectedElementContext['document'];
    selectedElement: DesignElementIdentity;
    selectedModule: DesignModule | null;
    selectedScreen: DesignScreen | null;
    relations: DesignRelation[];
    diagnostics: {
        moduleFound: boolean;
        relationCount: number;
        inferenceMode: SelectedModuleContext['diagnostics']['inferenceMode'] | null;
    };
}
