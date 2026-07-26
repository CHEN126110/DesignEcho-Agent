import type {
    ProviderNativeToolCitation,
    ProviderNativeToolRequest,
    ProviderNativeToolUsage
} from '../../../shared/provider-native-tools';

/**
 * Provider Adapter 类型定义
 *
 * 统一不同 LLM 提供商的 tool use 接口
 */

/** 工具定义（JSON Schema 格式） */
export interface ToolSchema {
    name: string;
    description: string;
    inputSchema: {
        type: 'object';
        properties: Record<string, any>;
        required?: string[];
    };
}

/** 模型调用的工具调用结果 */
export interface ToolCall {
    id: string;
    name: string;
    arguments: Record<string, any>;
}

/** Provider 格式化后的请求 */
export interface ProviderRequest {
    /** 提供商特定的请求体 */
    body: any;
    /** 额外的请求头 */
    headers?: Record<string, string>;
}

/** Provider 解析后的响应 */
export interface ProviderResponse {
    /** 文本内容 */
    content?: string;
    /** 工具调用列表 */
    toolCalls?: ToolCall[];
    /** 思维过程 */
    thinking?: string;
    /** token 用量 */
    usage?: {
        inputTokens: number;
        outputTokens: number;
    };
    /** provider-native 工具引用来源，例如 Xiaomi MiMo web_search annotations */
    citations?: ProviderNativeToolCitation[];
    /** provider-native 工具用量，例如 web_search_usage */
    nativeToolUsage?: ProviderNativeToolUsage[];
    /** 模型停止原因 */
    stopReason?: 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence';
}

/** Provider Adapter 接口 */
export interface ProviderAdapter {
    /** 是否原生支持 tool use */
    supportsNativeTools(): boolean;

    /** 将通用消息和工具格式化为提供商特定的请求 */
    formatMessages(
        messages: AdapterMessage[],
        tools: ToolSchema[],
        options?: AdapterOptions
    ): any;

    /** 解析提供商的原始响应为统一格式 */
    parseResponse(raw: any): ProviderResponse;
}

/** Multimodal 内容块 */
export interface ContentBlock {
    type: 'text' | 'image';
    text?: string;       // type='text'
    data?: string;       // type='image', base64 without prefix
    mediaType?: string;  // type='image', e.g. 'image/jpeg'
}

/** 统一消息格式（用于 adapter 输入） */
export interface AdapterMessage {
    role: 'system' | 'user' | 'assistant' | 'tool_result';
    content?: string;
    /** Multimodal 内容块（user 消息携带图片时使用） */
    contentBlocks?: ContentBlock[];
    /** assistant 消息中的工具调用 */
    toolCalls?: ToolCall[];
    /** tool_result 消息中的工具结果 */
    toolResults?: ToolResultEntry[];
    /**
     * 上一轮 assistant 的原生推理内容（reasoning_content / reasoning）。思考模式 + 工具调用时，
     * DeepSeek / 小米等要求后续轮次原样回传，formatMessages 据此写回；OpenAI 系字符串载体，
     * Anthropic 的 thinking block 带 signature 更复杂，本字段只服务 OpenAI 系。
     */
    reasoningContent?: string;
}

/** 工具执行结果条目 */
export interface ToolResultEntry {
    callId: string;
    success: boolean;
    output: any;
}

/** Adapter 选项 */
export interface AdapterOptions {
    maxTokens?: number;
    temperature?: number;
    systemPrompt?: string;
    /** provider-native tools are not function tools and must stay provider-scoped */
    nativeTools?: ProviderNativeToolRequest[];
    /**
     * 本次工具调用是否开启原生思考（由用户「模型思考」偏好经 resolveModelThinkingEnabledForCall 解析）。
     * adapter 据此决定是否下发 thinking:{type:'disabled'} 与是否回写历史 reasoning_content。
     */
    thinkingEnabled?: boolean;
    /**
     * 模型配置或 provider 列表明确给出的官方 thinking 请求参数。
     * adapter 只做格式化透传，不根据模型名猜测。
     */
    thinkingRequestParams?: Record<string, any>;
}
