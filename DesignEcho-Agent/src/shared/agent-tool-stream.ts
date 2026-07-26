import type {
    ProviderNativeToolCitation,
    ProviderNativeToolRequest,
    ProviderNativeToolUsage
} from './provider-native-tools';

export interface AgentToolStreamToolCall {
    id: string;
    name: string;
    arguments: Record<string, any>;
}

export interface AgentToolStreamResponse {
    content?: string;
    thinking?: string;
    toolCalls?: AgentToolStreamToolCall[];
    usage?: {
        inputTokens: number;
        outputTokens: number;
    };
    citations?: ProviderNativeToolCitation[];
    nativeToolUsage?: ProviderNativeToolUsage[];
    stopReason?: string;
    streamMode?: 'stream' | 'fallback';
}

export type AgentToolStreamChunk =
    | {
        type: 'content_delta';
        content: string;
    }
    | {
        type: 'thinking_delta';
        thinking: string;
    }
    | {
        type: 'tool_call_delta';
        index: number;
        toolCallId?: string;
        name?: string;
        argumentsDelta?: string;
    }
    | {
        type: 'tool_call_ready';
        toolCall: AgentToolStreamToolCall;
    }
    | {
        type: 'done';
        response: AgentToolStreamResponse;
    }
    | {
        type: 'error';
        error: string;
    };

export interface AgentToolStreamRequest {
    requestId: string;
    modelId: string;
    messages: any[];
    tools: any[];
    options?: {
        maxTokens?: number;
        temperature?: number;
        nativeTools?: ProviderNativeToolRequest[];
        timeoutMs?: number;
        /** 工具循环是否开启原生思考（reasoning_content）；贯通 renderer→main IPC 的思考开关。 */
        thinkingEnabled?: boolean;
    };
}
