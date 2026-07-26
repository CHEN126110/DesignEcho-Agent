/**
 * 审美知识库类型定义
 * 
 * 核心理念：知识库提供"参考"而非"规则"，AI 基于上下文做动态审美判断
 */

// ==================== 设计类型 ====================

export type DesignType = 
    | 'mainImage'      // 主图 800x800
    | 'detailHero'     // 详情页首屏
    | 'detailSection'  // 详情页内容区
    | 'skuImage'       // SKU 选项图
    | 'colorShowcase'  // 多色展示区
    | 'banner'         // 横幅
    | 'custom';        // 自定义

export type DesignStyle = 
    | 'minimal'        // 简约留白
    | 'rich'           // 饱满丰富
    | 'elegant'        // 优雅精致
    | 'dynamic'        // 动感活力
    | 'natural'        // 自然清新
    | 'premium'        // 高端质感
    | 'playful';       // 趣味活泼

// ==================== 审美参考 ====================

/**
 * 审美参考案例
 * 不是规则，而是 AI 理解审美的学习材料
 */
export interface AestheticReference {
    id: string;
    name: string;
    description: string;
    
    /** 设计类型 */
    designType: DesignType;
    
    /** 设计风格 */
    style: DesignStyle;
    
    /** 视觉参数（参考值，非强制） */
    visualParams: {
        /** 主体占比参考范围 */
        subjectRatio: { min: number; ideal: number; max: number };
        
        /** 位置参考 */
        position: {
            vertical: 'top' | 'center' | 'bottom' | 'top-third' | 'bottom-third';
            horizontal: 'left' | 'center' | 'right';
            /** 相对于中心的偏移（-1 到 1） */
            offsetX?: number;
            offsetY?: number;
        };
        
        /** 留白参考 */
        whitespace: {
            top: number;     // 0-1 比例
            bottom: number;
            left: number;
            right: number;
        };
    };
    
    /** 审美原则（自然语言描述，供 AI 理解） */
    principles: string[];
    
    /** 适用场景 */
    applicableScenarios: string[];
    
    /** 不适用场景 */
    avoidScenarios: string[];
    
    /** 示例图片路径（可选） */
    exampleImages?: string[];
    
    /** 权重（0-1，表示该参考的重要程度） */
    weight: number;
}

// ==================== 布局知识 ====================

/**
 * 布局知识条目
 */
export interface LayoutKnowledge {
    id: string;
    
    /** 知识类型 */
    type: 'composition' | 'balance' | 'hierarchy' | 'spacing' | 'alignment';
    
    /** 标题 */
    title: string;
    
    /** 详细描述（供 AI 理解） */
    description: string;
    
    /** 具体指导 */
    guidance: string[];
    
    /** 适用的设计类型 */
    applicableTypes: DesignType[];
    
    /** 关键词（用于检索） */
    keywords: string[];
}

// ==================== 配色知识 ====================

/**
 * 配色知识条目
 */
export interface ColorKnowledge {
    id: string;
    
    /** 配色方案名称 */
    name: string;
    
    /** 配色类型 */
    type: 'monochromatic' | 'complementary' | 'analogous' | 'triadic' | 'neutral';
    
    /** 主色 */
    primaryColors: string[];
    
    /** 辅助色 */
    accentColors: string[];
    
    /** 情绪/感受 */
    mood: string[];
    
    /** 适用场景 */
    suitableFor: string[];
    
    /** 搭配建议 */
    guidelines: string[];
}

// ==================== 字体知识 ====================

/**
 * 字体知识条目
 */
export interface TypographyKnowledge {
    id: string;
    
    /** 字体用途 */
    purpose: 'headline' | 'body' | 'accent' | 'label';
    
    /** 推荐字体（按优先级） */
    fontFamilies: string[];
    
    /** 字号参考 */
    fontSize: {
        min: number;
        ideal: number;
        max: number;
        unit: 'px' | 'pt';
    };
    
    /** 行高 */
    lineHeight: number;
    
    /** 字重 */
    fontWeight: 'light' | 'regular' | 'medium' | 'bold' | 'black';
    
    /** 适用设计类型 */
    applicableTypes: DesignType[];
    
    /** 使用建议 */
    guidelines: string[];
}

// ==================== 产品素材知识 ====================

/**
 * 产品素材关联信息
 * 将素材与卖点、场景关联
 */
export interface ProductAssetKnowledge {
    /** 素材 ID（来自 AssetLibraryService） */
    assetId: string;
    
    /** 关联的卖点 */
    sellingPoints: string[];
    
    /** 适用场景 */
    usageScenarios: string[];
    
    /** 视觉特征 */
    visualFeatures: {
        /** 主体形状 */
        subjectShape: 'horizontal' | 'vertical' | 'square' | 'irregular';
        /** 视觉重心 */
        visualCenter: { x: number; y: number };
        /** 是否有透明背景 */
        hasTransparency: boolean;
        /** 主色调 */
        dominantColors: string[];
    };
    
    /** 推荐用法 */
    recommendedUsage: {
        designType: DesignType;
        position: string;
        scale: string;
        reason: string;
    }[];
    
    /** 历史使用记录（用于学习） */
    usageHistory?: {
        projectId: string;
        designType: DesignType;
        position: { x: number; y: number };
        scale: number;
        userFeedback?: 'positive' | 'negative' | 'neutral';
        timestamp: string;
    }[];
}

// ==================== AI 决策相关 ====================

/**
 * 审美决策请求
 */
export interface AestheticDecisionRequest {
    /** 设计类型 */
    designType: DesignType;
    
    /** 画布信息 */
    canvas: {
        width: number;
        height: number;
        existingElements?: {
            type: string;
            bounds: { x: number; y: number; width: number; height: number };
        }[];
    };
    
    /** 待放置的素材信息 */
    asset: {
        id: string;
        width: number;
        height: number;
        subjectBounds?: { x: number; y: number; width: number; height: number };
        visualCenter?: { x: number; y: number };
    };
    
    /** 用户意图（自然语言） */
    userIntent?: string;
    
    /** 卖点关键词 */
    sellingPoints?: string[];
    
    /** 期望风格 */
    preferredStyle?: DesignStyle;
}

/**
 * 审美决策结果
 */
export interface AestheticDecisionResult {
    /** 是否成功 */
    success: boolean;
    
    /** 置信度 (0-1) */
    confidence: number;
    
    /** 推荐的缩放比例 */
    scale: number;
    
    /** 推荐的位置 */
    position: {
        x: number;
        y: number;
        anchor: 'center' | 'topLeft' | 'bottomCenter';
    };
    
    /** 决策理由（中文，供用户理解） */
    reason: string;
    
    /** 参考的知识条目 */
    referencedKnowledge: string[];
    
    /** 备选方案（如果置信度不够高） */
    alternatives?: {
        scale: number;
        position: { x: number; y: number };
        reason: string;
    }[];
    
    /** 处理耗时 (ms) */
    processingTime: number;
}

// ==================== 知识库整体结构 ====================

/**
 * 审美知识库
 */
export interface AestheticKnowledgeBase {
    version: string;
    lastUpdated: string;
    
    /** 审美参考案例 */
    references: AestheticReference[];
    
    /** 布局知识 */
    layoutKnowledge: LayoutKnowledge[];
    
    /** 配色知识 */
    colorKnowledge: ColorKnowledge[];
    
    /** 字体知识 */
    typographyKnowledge: TypographyKnowledge[];
    
    /** 产品素材关联（动态更新） */
    productAssetKnowledge: ProductAssetKnowledge[];
}
