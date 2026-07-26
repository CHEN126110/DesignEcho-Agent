/**
 * Shared detail-page types between Agent and UXP.
 */

export interface BoundingBox {
    left: number;
    top: number;
    right: number;
    bottom: number;
    width: number;
    height: number;
}

export type AssetType = 'product' | 'model' | 'detail' | 'scene' | 'icon';
export type LayerZone = 'copy' | 'icon' | 'image' | 'unknown';
export type FillMode = 'cover' | 'contain' | 'smart' | 'aesthetic';
export type ContentSource = 'preset' | 'ai_generated' | 'user_input' | 'template';

// Keep ScreenType open to reduce coupling with parser naming variants.
export type ScreenType = string;

export interface ScreenTypeConfig {
    type: ScreenType;
    namePatterns: RegExp[];
    keywords: string[];
    recommendedAssetType: AssetType;
    contentTags: string[];
}

export interface ParsedScreen {
    id: number;
    name: string;
    type: ScreenType;
    typeConfidence: number;
    index: number;
    bounds: BoundingBox;
    visible: boolean;

    copyPlaceholders: CopyPlaceholder[];
    imagePlaceholders: ImagePlaceholder[];
    iconPlaceholders: IconPlaceholder[];

    structure?: {
        hasCopyGroup: boolean;
        hasIconGroup: boolean;
        hasImageGroup: boolean;
        missingGroups: Array<'文案' | 'icon' | '图片'>;
        recognizedGroups: string[];
    };
}

export interface CopyPlaceholder {
    layerId: number;
    layerName: string;
    currentText: string;
    bounds: BoundingBox;
    role: 'title' | 'subtitle' | 'body' | 'label' | 'unknown';
    fontSize: number;
    fontFamily?: string;
    color?: string;
    maxWidth?: number;
    zone?: LayerZone;
}

export interface ImagePlaceholder {
    layerId: number;
    layerName: string;
    baseLayerId?: number;
    baseLayerName?: string;
    bounds: BoundingBox;
    isClippingMask: boolean;
    clippingInfo?: {
        isClipped: boolean;
        baseLayerId: number;
        baseBounds: BoundingBox;
    };
    recommendedAssetType: AssetType;
    aspectRatio: number;
    zone?: LayerZone;
}

export interface IconPlaceholder {
    layerId: number;
    layerName: string;
    bounds: BoundingBox;
    size: { width: number; height: number };
    isVector: boolean;
    zone?: LayerZone;
}

/** 跨屏/全局图层标记 */
export interface CrossScreenLayer {
    layerId: number;
    layerName: string;
    layerType: 'text' | 'image' | 'icon' | 'other';
    bounds: BoundingBox;
    overlappingScreens: number[];
    tag: 'crossScreen' | 'globalBackground';
}

export interface TemplateParseResult {
    success: boolean;
    documentName: string;
    documentSize: { width: number; height: number };
    screenCount: number;
    screens: ParsedScreen[];
    issues: LayerIssue[];
    crossScreenLayers: CrossScreenLayer[];
    parseTime: number;
}

export type LayerIssueType =
    | 'occlusion'
    | 'clipping_broken'
    | 'overflow'
    | 'hidden_content'
    | 'aspect_distortion'
    | 'effect_clipped'
    | 'empty_placeholder'
    | 'invalid_structure'
    | 'cross_group_reassign'
    | 'orphan_reclaimed'
    | 'cross_screen'
    | 'global_background';

export interface LayerIssue {
    type: LayerIssueType;
    severity: 'critical' | 'warning' | 'info';
    layerId: number;
    layerName: string;
    screenIndex?: number;
    description: string;
    autoFixable: boolean;
    suggestedFix?: string;
    fixParams?: Record<string, any>;
}

export interface FixResult {
    issueType: LayerIssueType;
    layerId: number;
    success: boolean;
    message: string;
    changes?: string[];
}

export interface FillPlan {
    screenId: number;
    screenName: string;
    screenType: ScreenType;
    copies: CopyFillItem[];
    images: ImageFillItem[];
    icons?: IconFillItem[];
    confidence: number;
    needsReview: boolean;
}

export interface CopyFillItem {
    layerId: number;
    layerName: string;
    content: string;
    source: ContentSource;
    sourceId?: string;
    originalText?: string;
}

export interface ImageFillItem {
    layerId: number;
    layerName: string;
    imagePath: string;
    fillMode: FillMode;
    assetType: AssetType;
    needsMatting?: boolean;
    subjectAlign?: 'center' | 'left' | 'right' | 'top' | 'bottom';
}

export interface IconFillItem {
    layerId: number;
    layerName: string;
    iconPath?: string;
    iconContent?: string;
}

export interface SliceExportConfig {
    outputDir: string;
    format: 'jpeg' | 'png';
    quality: number;
    namingPattern: string;
    createSubfolder: boolean;
    subfolder: string;
}

export interface ScreenExportResult {
    index: number;
    name: string;
    type: ScreenType;
    path: string;
    size: { width: number; height: number };
    fileSize?: number;
}

export interface SliceExportResult {
    success: boolean;
    screens: ScreenExportResult[];
    outputDir: string;
    totalScreens: number;
    successCount: number;
    failedCount: number;
    totalTime: number;
    errors?: string[];
}

export interface DetailPageDesignParams {
    templatePath?: string;
    projectPath: string;
    outputDir?: string;
    autoFix?: boolean;
    structureMode?: 'guided' | 'strict' | 'ignore';
    visualValidation?: boolean;
    userConfirm?: boolean;
    exportFormat?: 'jpeg' | 'png';
    exportQuality?: number;
}

export interface DetailPageDesignResult {
    success: boolean;
    message: string;
    stats: {
        screensProcessed: number;
        screensSuccess: number;
        screensFailed: number;
        issuesFound: number;
        issuesFixed: number;
        totalTime: number;
    };
    screens: Array<{
        index: number;
        name: string;
        type: ScreenType;
        status: 'success' | 'warning' | 'error';
        exportPath?: string;
        issues?: LayerIssue[];
        score?: number;
    }>;
    export?: SliceExportResult;
}

export const SCREEN_TYPE_CONFIGS: ScreenTypeConfig[] = [
    {
        type: 'A_营销信息',
        namePatterns: [/营销/i, /活动/i, /优惠/i, /促销/i],
        keywords: ['满减', '折扣', '限时', '活动'],
        recommendedAssetType: 'scene',
        contentTags: ['marketing', 'promotion']
    },
    {
        type: 'B_信任状',
        namePatterns: [/信任/i, /品牌/i, /背书/i, /认证/i, /品牌背书/i],
        keywords: ['品牌', '认证', '资质', '奖项', '背书'],
        recommendedAssetType: 'icon',
        contentTags: ['brand', 'certification']
    },
    {
        type: 'C_详情页首屏',
        namePatterns: [/首屏/i, /hero/i, /kv0/i, /主视觉/i, /核心/i, /卖点/i],
        keywords: ['首屏', '核心', '卖点', '亮点', '优势'],
        recommendedAssetType: 'product',
        contentTags: ['hero', 'selling_point', 'feature']
    },
    {
        type: 'D_图标icon',
        namePatterns: [/icon/i, /图标/i, /图标卖点/i],
        keywords: ['icon', '图标', '标识', '辅助说明'],
        recommendedAssetType: 'icon',
        contentTags: ['icon', 'quick_point']
    },
    {
        type: 'E_KV图_调性',
        namePatterns: [/kv/i, /氛围/i, /视觉锤/i, /banner/i, /调性/i],
        keywords: ['kv', '氛围', 'banner', '调性'],
        recommendedAssetType: 'scene',
        contentTags: ['kv', 'hero']
    },
    {
        type: 'F_颜色款式展示',
        namePatterns: [/颜色/i, /款式/i, /配色/i, /color/i],
        keywords: ['颜色', '款式', '配色'],
        recommendedAssetType: 'product',
        contentTags: ['color', 'variant']
    },
    {
        type: 'G_面料',
        namePatterns: [/面料/i, /材质/i, /成分/i, /fabric/i, /材质面料/i],
        keywords: ['面料', '材质', '成分', '纤维'],
        recommendedAssetType: 'detail',
        contentTags: ['material', 'fabric']
    },
    {
        type: 'H_解决痛点',
        namePatterns: [/痛点/i, /问题/i, /解决/i, /pain/i],
        keywords: ['痛点', '问题', '解决'],
        recommendedAssetType: 'detail',
        contentTags: ['pain_point', 'solution']
    },
    {
        type: 'I_穿搭推荐',
        namePatterns: [/穿搭/i, /搭配/i, /outfit/i],
        keywords: ['穿搭', '搭配', '场景'],
        recommendedAssetType: 'model',
        contentTags: ['styling', 'outfit']
    },
    {
        type: 'J_细节展示',
        namePatterns: [/细节/i, /工艺/i, /detail/i],
        keywords: ['细节', '工艺', '做工'],
        recommendedAssetType: 'detail',
        contentTags: ['detail', 'craftsmanship']
    },
    {
        type: 'K_产品参数',
        namePatterns: [/参数/i, /规格/i, /尺码/i, /信息表/i],
        keywords: ['参数', '规格', '尺码', '数据'],
        recommendedAssetType: 'product',
        contentTags: ['specification', 'size']
    },
    {
        type: 'L_模特实拍',
        namePatterns: [/模特/i, /实拍/i, /model/i],
        keywords: ['模特', '实拍', '上身'],
        recommendedAssetType: 'model',
        contentTags: ['model', 'lifestyle']
    },
    {
        type: 'M_售后服务',
        namePatterns: [/售后/i, /服务/i, /保障/i, /退换/i],
        keywords: ['售后', '服务', '保障', '退换'],
        recommendedAssetType: 'icon',
        contentTags: ['service', 'guarantee']
    }
];

export const SCREEN_TO_CONTENT_TAG_MAP: Record<ScreenType, string[]> = {
    A_营销信息: ['promotion', 'discount', 'event'],
    B_信任状: ['brand', 'certification', 'award'],
    C_详情页首屏: ['hero', 'selling_point', 'feature', 'benefit'],
    D_图标icon: ['icon', 'quick_point'],
    E_KV图_调性: ['kv', 'hero', 'tone'],
    F_颜色款式展示: ['color', 'variant'],
    G_面料: ['material', 'fabric', 'composition'],
    H_解决痛点: ['pain_point', 'solution', 'problem'],
    I_穿搭推荐: ['styling', 'outfit', 'match'],
    J_细节展示: ['detail', 'craftsmanship', 'closeup'],
    K_产品参数: ['specification', 'size', 'info'],
    L_模特实拍: ['model', 'lifestyle'],
    M_售后服务: ['service', 'guarantee', 'policy'],
    CUSTOM: []
};

export const SCREEN_TO_ASSET_MAP: Record<ScreenType, AssetType[]> = {
    A_营销信息: ['scene'],
    B_信任状: ['icon'],
    C_详情页首屏: ['product'],
    D_图标icon: ['icon'],
    E_KV图_调性: ['scene', 'product'],
    F_颜色款式展示: ['product'],
    G_面料: ['detail'],
    H_解决痛点: ['detail', 'product'],
    I_穿搭推荐: ['model', 'scene'],
    J_细节展示: ['detail'],
    K_产品参数: ['product'],
    L_模特实拍: ['model'],
    M_售后服务: ['icon'],
    CUSTOM: ['product']
};
