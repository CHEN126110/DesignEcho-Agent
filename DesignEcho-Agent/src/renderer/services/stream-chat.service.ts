/**
 * 流式聊天服务（渲染进程端）
 * 
 * 提供便捷的流式聊天接口，处理 IPC 通信。
 * 
 * @example
 * const stream = streamChat(modelId, messages, {
 *     onContent: (content) => console.log('内容:', content),
 *     onThinking: (thinking) => console.log('思考:', thinking),
 *     onDone: (response) => console.log('完成:', response),
 *     onError: (error) => console.error('错误:', error)
 * });
 * 
 * // 取消
 * stream.abort();
 */

import { normalizeStreamTextChunk } from '../../shared/stream-text-normalizer';

// ==================== 类型定义 ====================

export interface StreamChunk {
    type: 'content' | 'thinking' | 'done' | 'error';
    content?: string;
    thinking?: string;
    fullResponse?: {
        text: string;
        thinking?: string;
        usage?: {
            inputTokens: number;
            outputTokens: number;
        };
    };
    error?: string;
}

export interface StreamCallbacks {
    /** 收到内容片段 */
    onContent?: (content: string) => void;
    /** 收到思维过程片段 */
    onThinking?: (thinking: string) => void;
    /** 流式完成 */
    onDone?: (response: StreamChunk['fullResponse']) => void;
    /** 发生错误 */
    onError?: (error: string) => void;
}

export interface StreamOptions {
    maxTokens?: number;
    temperature?: number;
    thinkingEnabled?: boolean;
    timeoutMs?: number;
}

export interface StreamHandle {
    /** 请求 ID */
    requestId: string;
    /** 取消请求 */
    abort: () => Promise<void>;
    /** Promise 形式等待完成 */
    promise: Promise<StreamChunk['fullResponse'] | null>;
}

// ==================== 全局状态 ====================

// 存储活跃的流式请求回调
const activeCallbacks = new Map<string, StreamCallbacks>();

// 监听器注册状态
let listenerRegistered = false;

/**
 * 注册全局监听器
 */
function ensureListenerRegistered(): void {
    if (listenerRegistered) return;
    
    const designEcho = (window as any).designEcho;
    if (!designEcho?.onStreamChunk) {
        console.error('[StreamChat] designEcho.onStreamChunk 不可用');
        return;
    }
    
    designEcho.onStreamChunk((data: { requestId: string; chunk: StreamChunk }) => {
        const { requestId, chunk } = data;
        const callbacks = activeCallbacks.get(requestId);

        if (!callbacks) return;
        
        switch (chunk.type) {
            case 'content':
                callbacks.onContent?.(chunk.content || '');
                break;
            case 'thinking':
                callbacks.onThinking?.(chunk.thinking || '');
                break;
            case 'done':
                callbacks.onDone?.(chunk.fullResponse);
                activeCallbacks.delete(requestId);
                break;
            case 'error':
                callbacks.onError?.(chunk.error || '未知错误');
                activeCallbacks.delete(requestId);
                break;
        }
    });
    
    listenerRegistered = true;
    console.log('[StreamChat] 全局监听器已注册');
}

// ==================== 主函数 ====================

/**
 * 生成唯一请求 ID
 */
function generateRequestId(): string {
    return `stream-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * 流式聊天
 * 
 * @param modelId 模型 ID
 * @param messages 消息列表
 * @param callbacks 回调函数
 * @param options 选项
 * @returns 流式句柄，可用于取消
 */
export function streamChat(
    modelId: string,
    messages: Array<{ role: string; content: string }>,
    callbacks: StreamCallbacks,
    options?: StreamOptions
): StreamHandle {
    ensureListenerRegistered();
    
    const requestId = generateRequestId();
    const designEcho = (window as any).designEcho;
    
    if (!designEcho?.chatStream) {
        const error = 'designEcho.chatStream 不可用';
        callbacks.onError?.(error);
        return {
            requestId,
            abort: async () => {},
            promise: Promise.resolve(null)
        };
    }
    
    // 存储回调
    activeCallbacks.set(requestId, callbacks);
    
    // 创建 Promise 用于等待完成
    const promise = new Promise<StreamChunk['fullResponse'] | null>((resolve, reject) => {
        const originalOnDone = callbacks.onDone;
        const originalOnError = callbacks.onError;
        
        callbacks.onDone = (response) => {
            originalOnDone?.(response);
            resolve(response || null);
        };
        
        callbacks.onError = (error) => {
            originalOnError?.(error);
            reject(new Error(error));
        };
    });
    
    // 发起请求
    designEcho.chatStream({
        requestId,
        modelId,
        messages,
        options
    }).then((result: { success: boolean; error?: string }) => {
        if (!result.success) {
            callbacks.onError?.(result.error || '请求失败');
            activeCallbacks.delete(requestId);
        }
    }).catch((error: Error) => {
        callbacks.onError?.(error.message);
        activeCallbacks.delete(requestId);
    });
    
    return {
        requestId,
        abort: async () => {
            activeCallbacks.delete(requestId);
            if (designEcho.abortStream) {
                await designEcho.abortStream(requestId);
            }
        },
        promise
    };
}

/**
 * 简化的流式聊天（返回 Promise）
 * 
 * 适用于不需要实时显示的场景，但仍使用流式传输
 */
export async function streamChatAsync(
    modelId: string,
    messages: Array<{ role: string; content: string }>,
    options?: StreamOptions & {
        onProgress?: (content: string, chunk: string) => void;
        onThinkingProgress?: (thinking: string, chunk: string) => void;
    }
): Promise<{ text: string; thinking?: string }> {
    let fullContent = '';
    let fullThinking = '';
    const { onProgress, onThinkingProgress, ...streamOptions } = options || {};
    const timeoutMs = Number(options?.timeoutMs || 0);
    const hasInactivityTimeout = Number.isFinite(timeoutMs) && timeoutMs > 0;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let timeoutReject: ((reason?: any) => void) | null = null;
    let streamSettled = false;
    let handle: StreamHandle | null = null;

    function clearStreamInactivityTimeout(): void {
        if (!timeoutId) return;
        clearTimeout(timeoutId);
        timeoutId = null;
    }

    function refreshStreamInactivityTimeout(): void {
        if (!hasInactivityTimeout || !timeoutReject || streamSettled) return;
        clearStreamInactivityTimeout();
        timeoutId = setTimeout(() => {
            if (streamSettled) return;
            void handle?.abort().catch(() => undefined);
            timeoutReject?.(new Error(`Stream chat timeout after ${Math.round(timeoutMs)}ms`));
        }, timeoutMs);
    }

    const timeoutPromise = hasInactivityTimeout
        ? new Promise<StreamChunk['fullResponse'] | null>((_resolve, reject) => {
            timeoutReject = reject;
        })
        : null;

    handle = streamChat(
        modelId,
        messages,
        {
            onContent: (content) => {
                if (!content) return;
                fullContent += content;
                refreshStreamInactivityTimeout();
                onProgress?.(fullContent, content);
            },
            onThinking: (thinking) => {
                const normalized = normalizeStreamTextChunk(fullThinking, thinking);
                fullThinking = normalized.fullText;
                if (normalized.deltaText) {
                    refreshStreamInactivityTimeout();
                    onThinkingProgress?.(fullThinking, normalized.deltaText);
                }
            }
        },
        streamOptions
    );

    refreshStreamInactivityTimeout();

    try {
        const response = await (
            timeoutPromise
                ? Promise.race([handle.promise, timeoutPromise])
                : handle.promise
        );
        return {
            text: response?.text || fullContent,
            thinking: response?.thinking || fullThinking || undefined
        };
    } finally {
        streamSettled = true;
        clearStreamInactivityTimeout();
    }
}

// 类型已在定义处导出，无需重复导出
