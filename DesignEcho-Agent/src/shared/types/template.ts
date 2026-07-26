/**
 * 模板系统类型定义
 */

// ===== 基础类型 =====

export type TemplateType = 'mainImage' | 'sku' | 'detailPage';

export type PlaceholderType = 'IMG' | 'TEXT' | 'SO' | 'GROUP' | 'STYLE' | 'REPEAT';

export type ImageFit = 'contain' | 'cover' | 'fill' | 'none';
export type ImageAlign = 'center' | 'top' | 'bottom' | 'left' | 'right';
export type ImageMask = 'clip' | 'overflow';

export type TextSource = 'input' | 'preset' | 'auto';
export type RepeatDirection = 'horizontal' | 'vertical' | 'grid';

// ===== 占位符定义 =====

export interface PlaceholderOptions {
    // 图片选项
    fit?: ImageFit;
    align?: ImageAlign;
    mask?: ImageMask;
    maxWidth?: number;
    maxHeight?: number;
    
    // 文本选项
    source?: TextSource;
    maxLength?: number;
    fallback?: string;
    fontSize?: { min: number; max: number };
    presetType?: 'sellingPoint' | 'painPoint' | 'copyTemplate';
    
    // 样式选项
    property?: 'color' | 'font' | 'effect';
    inherit?: boolean;
    
    // 重复选项
    min?: number;
    max?: number;
    direction?: RepeatDirection;
}

export interface Placeholder {
    id: string;
    type: PlaceholderType;
    name: string;
    layerPath: string;
    options: PlaceholderOptions;
    required: boolean;
    default?: string;
    description?: string;
}

// ===== 模板样式 =====

export interface TemplateStyles {
    primaryColor?: string;
    secondaryColor?: string;
    accentColor?: string;
    backgroundColor?: string;
    fontFamily?: string;
    fontSize?: number;
}

// ===== 导出设置 =====

export interface ExportSize {
    name: string;
    width: number;
    height: number;
}

export interface ExportSettings {
    formats: ('jpg' | 'png' | 'psd')[];
    quality: number;
    sizes: ExportSize[];
}

// ===== 模板元数据 =====

export interface TemplateMetadata {
    id: string;
    name: string;
    version: string;
    type: TemplateType;
    category: string;
    dimensions: {
        width: number;
        height: number;
        unit: 'px' | 'mm' | 'in';
    };
    author?: string;
    createDate?: string;
    updateDate?: string;
    tags?: string[];
    description?: string;
    previewImage?: string;
}

// ===== 完整模板定义 =====

export interface Template extends TemplateMetadata {
    placeholders: Placeholder[];
    styles: TemplateStyles;
    exportSettings: ExportSettings;
    psdPath: string;
    assetsPath?: string;
}

// ===== 模板包 =====

export interface TemplatePack {
    id: string;
    name: string;
    version: string;
    category: string;
    author?: string;
    description?: string;
    templates: {
        mainImage?: string[];
        sku?: string[];
        detailPage?: Record<string, string[]>;
    };
    compatibility?: {
        designEchoVersion?: string;
        photoshopVersion?: string;
    };
}

// ===== 占位符解析结果 =====

export interface ParsedPlaceholder {
    type: PlaceholderType;
    name: string;
    options: string[];
    rawName: string;
    isLocked: boolean;
    isHidden: boolean;
    condition?: string;
}

// ===== 数据绑定 =====

export interface ImageBinding {
    type: 'image';
    source: 'file' | 'url' | 'base64';
    path?: string;
    url?: string;
    data?: string;
}

export interface TextBinding {
    type: 'text';
    value: string;
    source?: TextSource;
    presetId?: string;
}

export interface StyleBinding {
    type: 'style';
    property: 'color' | 'font' | 'effect';
    value: string;
}

export type PlaceholderBinding = ImageBinding | TextBinding | StyleBinding;

export interface TemplateBindings {
    [placeholderId: string]: PlaceholderBinding;
}

// ===== 渲染上下文 =====

export interface RenderContext {
    template: Template;
    bindings: TemplateBindings;
    conditions?: Record<string, boolean>;
    outputPath?: string;
    exportOptions?: Partial<ExportSettings>;
}

// ===== 渲染结果 =====

export interface RenderResult {
    success: boolean;
    outputFiles?: string[];
    psdFile?: string;
    duration?: number;
    errors?: string[];
}

// ===== 模板列表项 =====

export interface TemplateListItem {
    id: string;
    name: string;
    type: TemplateType;
    category: string;
    previewImage?: string;
    tags?: string[];
}
