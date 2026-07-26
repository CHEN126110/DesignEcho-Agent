/**
 * 工具类型定义
 */

export interface ToolSchemaProperty {
    type: string;
    description: string;
    enum?: string[];
    /**
     * 用于数组类型。数组元素可以是简单类型（{ type: 'number' }），
     * 也可以是带 properties 的对象 schema（如 createSkuPlaceholders 的 slots 槽位数组）。
     * 元素级 description 可省略（外层属性通常已描述数组语义）。
     */
    items?: {
        type: string;
        description?: string;
        enum?: string[];
        properties?: Record<string, ToolSchemaProperty>;
    };
    properties?: Record<string, ToolSchemaProperty>;  // 用于嵌套对象类型
}

export interface ToolSchema {
    name: string;
    description: string;
    parameters: {
        type: 'object';
        properties: Record<string, ToolSchemaProperty>;
        required?: string[];
    };
}

export interface Tool {
    name: string;
    schema: ToolSchema;
    execute(params: any, context?: ToolExecutionContext): Promise<any>;
}

/**
 * Renderer 在一次写调用上签发的 Photoshop 目标约束。
 *
 * 它只存在于该次 ToolExecutionContext 中；不得保存到 Tool 实例或模块全局，
 * 否则并发调用会把彼此的目标身份串线。
 */
export interface PhotoshopTargetGuard {
    readonly expectedDocumentId: number;
    readonly expectedActiveLayerId?: number;
    readonly expectedHistoryStateRef?: Readonly<{
        documentId: number;
        historyStateId: number;
    }>;
    readonly observationTool?: string;
}

export interface ToolExecutionContext {
    requestId?: string | number;
    isCancelled?: () => boolean;
    /** 已归一化且已从业务参数剥离的调用级目标约束。 */
    photoshopTargetGuard?: Readonly<PhotoshopTargetGuard>;
}

/**
 * 文本图层信息
 */
export interface TextLayerInfo {
    id: number;
    name: string;
    contents: string;
    bounds: LayerBounds;
    boundsNoEffects?: LayerBounds;
    style: TextStyle;
}

/**
 * 图层边界
 */
export interface LayerBounds {
    left: number;
    top: number;
    right: number;
    bottom: number;
    width: number;
    height: number;
}

/**
 * 文本样式
 */
export interface TextStyle {
    fontSize?: number;
    fontName?: string;
    fontStyle?: string;
    color?: { r: number; g: number; b: number };
    tracking?: number;       // 字间距
    leading?: number;        // 行高
    horizontalScale?: number;
    verticalScale?: number;
    /**
     * 段落对齐（来自 batchPlay 描述符 paragraphStyleRange.paragraphStyle.align）。
     * 读不到 / 多段不一致 / 枚举不在三值域内时不输出该字段，绝不默认 center。【需真机验证】
     */
    textAlign?: 'left' | 'center' | 'right';
}

/**
 * 文档信息
 */
export interface DocumentInfo {
    id: number;
    name: string;
    width: number;
    height: number;
    resolution: number;
    colorMode: string;
    layerCount: number;
    activeLayerId?: number;
    activeLayerName?: string;
}

/**
 * 工具返回结果
 */
export interface ToolResult<T = any> {
    success: boolean;
    error?: string;
    data: T | null;
}
