/**
 * MCP 协议类型定义
 * 
 * 所有 MCP 通信必须严格遵循这些 TypeScript 类型定义
 * 
 * @version v7.1
 * @see 技术规划文档.md 7.1 节
 */

// ==================== 基础类型 ====================

/** MCP 请求基类 */
export interface MCPRequest<T = any> {
    jsonrpc: '2.0';
    id: string;
    method: 'tools/call' | 'tools/list';
    params?: {
        name: string;
        arguments: T;
    };
}

/** MCP 响应基类 */
export interface MCPResponse<R = any> {
    jsonrpc: '2.0';
    id: string;
    result?: {
        content: Array<MCPContent>;
        isError?: boolean;
    };
    error?: {
        code: number;
        message: string;
        data?: any;
    };
}

/** 内容类型 */
export type MCPContent = 
    | { type: 'text'; text: string }
    | { type: 'image'; data: string; mimeType: string };

// ==================== 工具定义 ====================

/** 工具 Schema */
export interface ToolSchema {
    name: string;
    description: string;
    parameters: {
        type: 'object';
        properties: Record<string, PropertySchema>;
        required?: string[];
    };
}

/** 属性 Schema */
export interface PropertySchema {
    type: 'string' | 'number' | 'boolean' | 'object' | 'array';
    description?: string;
    enum?: string[];
    default?: any;
    items?: PropertySchema;
    properties?: Record<string, PropertySchema>;
}

// ==================== 图层状态 ====================

/** 图层边界 */
export interface LayerBounds {
    left: number;
    top: number;
    right: number;
    bottom: number;
    width: number;
    height: number;
}

/** 图层状态 - 执行后必须返回 */
export interface LayerState {
    layerId: number;
    name: string;
    absoluteBounds: LayerBounds;
    opacity: number;
    visible: boolean;
    locked: boolean;
    blendMode: string;
    type?: 'pixel' | 'text' | 'shape' | 'group' | 'adjustment' | 'smartObject';
}

// ==================== 响应类型 ====================

/** 标准成功响应 */
export interface ActionSuccessResponse<T = any> {
    success: true;
    /** 变更后的图层状态 - 修改性操作必须返回 */
    layerState?: LayerState;
    /** 执行前的状态（用于撤销） */
    previousState?: LayerState;
    /** 额外数据 */
    data?: T;
    /** 处理时间 (ms) */
    processingTime?: number;
}

/** 标准错误响应 */
export interface ActionErrorResponse {
    success: false;
    errorCode: ActionErrorCode;
    message: string;
    /** 恢复建议 */
    suggestion?: string;
    /** 原始错误详情（调试用） */
    details?: any;
}

/** 错误码枚举 */
export enum ActionErrorCode {
    /** 没有打开的文档 */
    ERR_NO_DOCUMENT = 'ERR_NO_DOCUMENT',
    /** 找不到图层 */
    ERR_LAYER_NOT_FOUND = 'ERR_LAYER_NOT_FOUND',
    /** Photoshop 正在执行其他操作 */
    ERR_PS_BUSY = 'ERR_PS_BUSY',
    /** 参数无效 */
    ERR_INVALID_PARAMS = 'ERR_INVALID_PARAMS',
    /** 权限不足 */
    ERR_PERMISSION_DENIED = 'ERR_PERMISSION_DENIED',
    /** 图层被锁定 */
    ERR_LAYER_LOCKED = 'ERR_LAYER_LOCKED',
    /** 超出画布边界 */
    ERR_OUT_OF_BOUNDS = 'ERR_OUT_OF_BOUNDS',
    /** 选区不存在 */
    ERR_NO_SELECTION = 'ERR_NO_SELECTION',
    /** 文本图层不存在 */
    ERR_NOT_TEXT_LAYER = 'ERR_NOT_TEXT_LAYER',
    /** 操作超时 */
    ERR_TIMEOUT = 'ERR_TIMEOUT',
    /** 未知错误 */
    ERR_UNKNOWN = 'ERR_UNKNOWN'
}

/** 统一响应类型 */
export type ActionResponse<T = any> = ActionSuccessResponse<T> | ActionErrorResponse;

// ==================== 约束规则 ====================

/** 约束规则 - 防止 AI 产生低级错误 */
export interface ConstraintRule {
    id: string;
    description: string;
    /** 校验函数 - 返回 true 表示通过 */
    check: (context: ConstraintContext) => boolean | Promise<boolean>;
    errorMessage: string;
    /** 自动修复函数 */
    autoFix?: (context: ConstraintContext) => Promise<any>;
    /** 规则类型 */
    type?: 'error' | 'warning';
}

/** 约束上下文 */
export interface ConstraintContext {
    canvas: {
        width: number;
        height: number;
    };
    layers: LayerState[];
    safeMargin: number;
    
    // 辅助方法
    hasOverlappingText: () => boolean;
    allElementsWithinBounds: () => boolean;
    hasSafeMargin: (margin: number) => boolean;
    autoSpaceText: () => Promise<void>;
    clampToBounds: () => Promise<void>;
}

// ==================== 工具依赖 ====================

/** 工具依赖定义 */
export interface ToolDependency {
    toolName: string;
    /** 前置依赖 */
    requires?: string[];
    /** 可选依赖（增强功能） */
    enhancedBy?: string[];
}

/** 工具依赖检查结果 */
export interface DependencyCheckResult {
    valid: boolean;
    missingDependencies: string[];
    suggestion?: string;
}

// ==================== 技能定义 ====================

/** Skill 技能定义 */
export interface Skill {
    id: string;
    name: string;
    description: string;
    /** 触发词 */
    triggers: string[];
    /** 依赖的工具 */
    requiredTools: string[];
    /** 约束规则 */
    constraintRules?: ConstraintRule[];
    /** 系统提示词 */
    systemPrompt?: string;
    /** 创造性程度 0-1 */
    temperature?: number;
    /** 执行函数 */
    execute: (context: SkillContext) => Promise<SkillResult>;
}

/** Skill 执行上下文 */
export interface SkillContext {
    /** 用户原始输入 */
    userInput: string;
    /** 调用工具 */
    call: (toolName: string, params: any) => Promise<any>;
    /** 日志函数 */
    log: (message: string) => void;
    /** 更新进度 */
    updateProgress: (step: string, percent: number) => void;
}

/** Skill 执行结果 */
export interface SkillResult {
    success: boolean;
    message: string;
    details?: any;
    toolCallCount?: number;
    duration?: number;
}

// ==================== 类型守卫 ====================

/** 判断是否为成功响应 */
export function isSuccessResponse<T>(response: ActionResponse<T>): response is ActionSuccessResponse<T> {
    return response.success === true;
}

/** 判断是否为错误响应 */
export function isErrorResponse(response: ActionResponse): response is ActionErrorResponse {
    return response.success === false;
}

/** 获取错误码的友好描述 */
export function getErrorCodeDescription(code: ActionErrorCode): string {
    const descriptions: Record<ActionErrorCode, string> = {
        [ActionErrorCode.ERR_NO_DOCUMENT]: '没有打开的文档',
        [ActionErrorCode.ERR_LAYER_NOT_FOUND]: '找不到指定的图层',
        [ActionErrorCode.ERR_PS_BUSY]: 'Photoshop 正忙，请稍后重试',
        [ActionErrorCode.ERR_INVALID_PARAMS]: '参数格式不正确',
        [ActionErrorCode.ERR_PERMISSION_DENIED]: '权限不足',
        [ActionErrorCode.ERR_LAYER_LOCKED]: '图层已锁定',
        [ActionErrorCode.ERR_OUT_OF_BOUNDS]: '操作超出画布边界',
        [ActionErrorCode.ERR_NO_SELECTION]: '没有选区',
        [ActionErrorCode.ERR_NOT_TEXT_LAYER]: '不是文本图层',
        [ActionErrorCode.ERR_TIMEOUT]: '操作超时',
        [ActionErrorCode.ERR_UNKNOWN]: '未知错误'
    };
    return descriptions[code] || '未知错误';
}
