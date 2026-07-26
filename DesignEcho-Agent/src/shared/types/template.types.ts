export type TemplateType = 'sku' | 'detail-page' | 'banner' | 'main-image' | 'other';

export type TemplateFormat = 'psd' | 'tif' | 'psb';

export interface TemplateSpecs {
    width: number;
    height: number;
    colorMode?: 'RGB' | 'CMYK' | 'Grayscale';
    resolution?: number;
}

export interface TemplateMetadata {
    comboSize?: number;
    category?: string;
    placeholderLayers?: string[];
    textLayers?: string[];
    backgroundLayer?: string;
    layerStructure?: string;
    platforms?: string[];
    scenes?: string[];
    sourcePath?: string;
    sourceDocumentName?: string;
}

export interface TemplateAsset {
    id: string;
    libraryId?: string;
    name: string;
    type: TemplateType;
    filePath: string;
    fileFormat: TemplateFormat;
    thumbnail?: string;
    description: string;
    aiPrompt?: string;
    specs?: TemplateSpecs;
    metadata?: TemplateMetadata;
    tags?: string[];
    source?: 'user' | 'system' | 'import';
    createdAt: number;
    updatedAt: number;
}

export interface TemplateKnowledge {
    id: string;
    name: string;
    templates: TemplateAsset[];
    createdAt: number;
    updatedAt: number;
}

export interface TemplateLibrary {
    id: string;
    name: string;
    dirPath?: string;
    dirToken?: string;
    createdAt: number;
    updatedAt: number;
}

export interface TemplateQuery {
    type?: TemplateType;
    tags?: string[];
    category?: string;
    comboSize?: number;
    keyword?: string;
    libraryId?: string;
}

export interface AddTemplateParams {
    name: string;
    type: TemplateType;
    libraryId?: string;
    filePath: string;
    description: string;
    aiPrompt?: string;
    metadata?: TemplateMetadata;
    tags?: string[];
}

export interface UpdateTemplateParams {
    id: string;
    name?: string;
    description?: string;
    aiPrompt?: string;
    metadata?: TemplateMetadata;
    tags?: string[];
}

export interface ResolvePhotoshopTemplateFileParams {
    documentName: string;
    documentPath?: string;
    currentProjectPath?: string;
}

export interface AddTemplateFromPhotoshopParams extends ResolvePhotoshopTemplateFileParams {
    type: TemplateType;
    libraryId?: string;
    description?: string;
    aiPrompt?: string;
    metadata?: TemplateMetadata;
    tags?: string[];
}

export interface TemplateResolverSettings {
    localLibraryDirs: string[];
    libraries: TemplateLibrary[];
    activeLibraryId?: string;
}

export type SKUTemplateSource = 'local-library' | 'template-library';

export interface SKUTemplateCandidate {
    id: string;
    name: string;
    filePath: string;
    description?: string;
    metadata?: {
        comboSize?: number;
    };
    source: SKUTemplateSource;
    sourcePriority: number;
}

export interface FindSKUTemplateParams {
    comboSize: number;
    keyword?: string;
    noteMode?: boolean;
    sources?: SKUTemplateSource[];
}

export interface GetAvailableSKUSpecsParams {
    sources?: SKUTemplateSource[];
}
