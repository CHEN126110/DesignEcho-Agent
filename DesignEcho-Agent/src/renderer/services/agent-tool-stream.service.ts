import type {
    AgentToolStreamChunk,
    AgentToolStreamRequest,
    AgentToolStreamResponse,
    AgentToolStreamToolCall
} from '../../shared/agent-tool-stream';
import { normalizeStreamTextChunk } from '../../shared/stream-text-normalizer';

interface AgentToolStreamCallbacks {
    onContentDelta?: (fullContent: string, delta: string) => void;
    onThinkingDelta?: (fullThinking: string, delta: string) => void;
    onToolCallDelta?: (chunk: Extract<AgentToolStreamChunk, { type: 'tool_call_delta' }>) => void;
    onToolCallReady?: (toolCall: AgentToolStreamToolCall) => void;
    onDone?: (response: AgentToolStreamResponse) => void;
    onError?: (error: string) => void;
}

interface AgentToolStreamHandle {
    requestId: string;
    abort: () => Promise<void>;
    promise: Promise<AgentToolStreamResponse>;
}

const activeCallbacks = new Map<string, AgentToolStreamCallbacks>();
let listenerRegistered = false;

function generateRequestId(): string {
    return `tool-stream-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function ensureListenerRegistered(): void {
    if (listenerRegistered) return;

    const designEcho = (window as any).designEcho;
    if (!designEcho?.onStreamChunk) {
        console.error('[AgentToolStream] designEcho.onStreamChunk 不可用');
        return;
    }

    designEcho.onStreamChunk((data: { requestId: string; chunk: AgentToolStreamChunk }) => {
        const callbacks = activeCallbacks.get(data.requestId);
        if (!callbacks) return;

        switch (data.chunk.type) {
            case 'content_delta':
                callbacks.onContentDelta?.('', data.chunk.content);
                break;
            case 'thinking_delta':
                callbacks.onThinkingDelta?.('', data.chunk.thinking);
                break;
            case 'tool_call_delta':
                callbacks.onToolCallDelta?.(data.chunk);
                break;
            case 'tool_call_ready':
                callbacks.onToolCallReady?.(data.chunk.toolCall);
                break;
            case 'done':
                callbacks.onDone?.(data.chunk.response);
                activeCallbacks.delete(data.requestId);
                break;
            case 'error':
                callbacks.onError?.(data.chunk.error);
                activeCallbacks.delete(data.requestId);
                break;
        }
    });

    listenerRegistered = true;
}

export function streamChatWithTools(
    modelId: string,
    messages: any[],
    tools: any[],
    callbacks: AgentToolStreamCallbacks,
    options?: AgentToolStreamRequest['options']
): AgentToolStreamHandle {
    ensureListenerRegistered();

    const requestId = generateRequestId();
    const designEcho = (window as any).designEcho;
    let fullContent = '';
    let fullThinking = '';

    if (!designEcho?.chatWithToolsStream) {
        const error = 'designEcho.chatWithToolsStream 不可用';
        callbacks.onError?.(error);
        return {
            requestId,
            abort: async () => {},
            promise: Promise.reject(new Error(error))
        };
    }

    const wrappedCallbacks: AgentToolStreamCallbacks = {
        ...callbacks,
        onContentDelta: (_unused, delta) => {
            fullContent += delta;
            callbacks.onContentDelta?.(fullContent, delta);
        },
        onThinkingDelta: (_unused, delta) => {
            const normalized = normalizeStreamTextChunk(fullThinking, delta);
            fullThinking = normalized.fullText;
            if (normalized.deltaText) {
                callbacks.onThinkingDelta?.(fullThinking, normalized.deltaText);
            }
        }
    };

    const promise = new Promise<AgentToolStreamResponse>((resolve, reject) => {
        wrappedCallbacks.onDone = (response) => {
            callbacks.onDone?.(response);
            resolve({
                ...response,
                content: response.content ?? fullContent,
                thinking: response.thinking ?? (fullThinking || undefined)
            });
        };
        wrappedCallbacks.onError = (error) => {
            callbacks.onError?.(error);
            reject(new Error(error));
        };
    });

    activeCallbacks.set(requestId, wrappedCallbacks);

    designEcho.chatWithToolsStream({
        requestId,
        modelId,
        messages,
        tools,
        options
    }).then((result: { success: boolean; error?: string }) => {
        if (!result.success) {
            activeCallbacks.delete(requestId);
            wrappedCallbacks.onError?.(result.error || 'Agent 工具流式请求失败');
        }
    }).catch((error: Error) => {
        activeCallbacks.delete(requestId);
        wrappedCallbacks.onError?.(error.message);
    });

    return {
        requestId,
        abort: async () => {
            if (designEcho.abortStream) {
                await designEcho.abortStream(requestId);
            }
            activeCallbacks.delete(requestId);
        },
        promise
    };
}

export async function streamChatWithToolsAsync(
    modelId: string,
    messages: any[],
    tools: any[],
    options?: AgentToolStreamRequest['options'] & AgentToolStreamCallbacks
): Promise<AgentToolStreamResponse> {
    const {
        onContentDelta,
        onThinkingDelta,
        onToolCallDelta,
        onToolCallReady,
        onDone,
        onError,
        ...streamOptions
    } = options || {};

    const handle = streamChatWithTools(
        modelId,
        messages,
        tools,
        {
            onContentDelta,
            onThinkingDelta,
            onToolCallDelta,
            onToolCallReady,
            onDone,
            onError
        },
        streamOptions
    );

    return handle.promise;
}
