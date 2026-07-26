export interface AgentProtocolMessageLike {
    role?: string;
    toolCalls?: unknown[];
    toolResults?: unknown[];
    reasoningContent?: unknown;
}

export type AgentModelTransport = 'plain_chat' | 'provider_adapter';

export interface AgentModelTransportInput {
    messages: readonly AgentProtocolMessageLike[];
    toolCount: number;
    hasProviderNativeTools: boolean;
}

/**
 * 工具协议属于整段消息历史，而不是本轮工具 schema 的附属状态。
 * 一旦历史进入过工具 / reasoning 协议，就必须继续经 provider adapter 序列化；
 * 否则内部 tool_result 会被普通聊天接口当成非法 provider role 原样发送。
 */
export function requiresAgentProtocolTransport(
    messages: readonly AgentProtocolMessageLike[]
): boolean {
    return messages.some((message) => {
        // plain chat 是白名单通道：只允许明确的 system/user/assistant 文本角色。
        // 未来新增任何内部角色时默认走 provider adapter，避免再次把内部协议原样泄漏给 provider。
        if (message.role !== 'system' && message.role !== 'user' && message.role !== 'assistant') {
            return true;
        }
        if (Array.isArray(message.toolCalls) && message.toolCalls.length > 0) return true;
        if (Array.isArray(message.toolResults) && message.toolResults.length > 0) return true;
        if (message.reasoningContent === undefined || message.reasoningContent === null) return false;
        return String(message.reasoningContent).trim().length > 0;
    });
}

export function resolveAgentModelTransport(input: AgentModelTransportInput): AgentModelTransport {
    if (input.toolCount > 0 || input.hasProviderNativeTools) {
        return 'provider_adapter';
    }
    return requiresAgentProtocolTransport(input.messages)
        ? 'provider_adapter'
        : 'plain_chat';
}
