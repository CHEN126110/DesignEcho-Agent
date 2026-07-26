/**
 * 流式聊天 Hook
 * 
 * 提供流式输出能力，让 AI 响应边生成边显示
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { streamChat, StreamCallbacks, StreamHandle } from '../services/stream-chat.service';

export interface StreamChatState {
    /** 当前累积的内容 */
    content: string;
    /** 当前累积的思维过程 */
    thinking: string;
    /** 是否正在流式传输 */
    isStreaming: boolean;
    /** 错误信息 */
    error: string | null;
}

export interface UseStreamChatReturn {
    /** 当前状态 */
    state: StreamChatState;
    /** 开始流式聊天 */
    startStream: (
        modelId: string, 
        messages: Array<{ role: string; content: string }>,
        options?: { maxTokens?: number; temperature?: number }
    ) => Promise<{ text: string; thinking?: string } | null>;
    /** 取消流式传输 */
    abort: () => void;
    /** 重置状态 */
    reset: () => void;
}

/**
 * 流式聊天 Hook
 * 
 * @example
 * const { state, startStream, abort, reset } = useStreamChat();
 * 
 * // 开始流式聊天
 * const response = await startStream(modelId, messages);
 * 
 * // 实时获取内容
 * console.log(state.content); // 实时更新
 * console.log(state.thinking); // 思维过程
 */
export function useStreamChat(): UseStreamChatReturn {
    const [state, setState] = useState<StreamChatState>({
        content: '',
        thinking: '',
        isStreaming: false,
        error: null
    });
    
    const handleRef = useRef<StreamHandle | null>(null);
    const abortedRef = useRef(false);
    
    // 清理函数
    useEffect(() => {
        return () => {
            if (handleRef.current) {
                handleRef.current.abort();
            }
        };
    }, []);
    
    const startStream = useCallback(async (
        modelId: string,
        messages: Array<{ role: string; content: string }>,
        options?: { maxTokens?: number; temperature?: number }
    ): Promise<{ text: string; thinking?: string } | null> => {
        // 重置状态
        abortedRef.current = false;
        setState({
            content: '',
            thinking: '',
            isStreaming: true,
            error: null
        });
        
        return new Promise((resolve) => {
            const callbacks: StreamCallbacks = {
                onContent: (content) => {
                    if (abortedRef.current) return;
                    setState(prev => ({
                        ...prev,
                        content: prev.content + content
                    }));
                },
                onThinking: (thinking) => {
                    if (abortedRef.current) return;
                    setState(prev => ({
                        ...prev,
                        thinking: prev.thinking + thinking
                    }));
                },
                onDone: (response) => {
                    setState(prev => ({
                        ...prev,
                        isStreaming: false,
                        content: response?.text || prev.content,
                        thinking: response?.thinking || prev.thinking
                    }));
                    handleRef.current = null;
                    resolve(response || { text: '' });
                },
                onError: (error) => {
                    setState(prev => ({
                        ...prev,
                        isStreaming: false,
                        error
                    }));
                    handleRef.current = null;
                    resolve(null);
                }
            };
            
            handleRef.current = streamChat(modelId, messages, callbacks, options);
        });
    }, []);
    
    const abort = useCallback(() => {
        abortedRef.current = true;
        if (handleRef.current) {
            handleRef.current.abort();
            handleRef.current = null;
        }
        setState(prev => ({
            ...prev,
            isStreaming: false
        }));
    }, []);
    
    const reset = useCallback(() => {
        abortedRef.current = false;
        setState({
            content: '',
            thinking: '',
            isStreaming: false,
            error: null
        });
    }, []);
    
    return {
        state,
        startStream,
        abort,
        reset
    };
}

/**
 * 简化的流式聊天函数（非 Hook 版本）
 * 
 * 适用于在回调中使用
 */
export async function streamChatWithCallback(
    modelId: string,
    messages: Array<{ role: string; content: string }>,
    callbacks: {
        onContent?: (fullContent: string, chunk: string) => void;
        onThinking?: (fullThinking: string, chunk: string) => void;
        onDone?: (response: { text: string; thinking?: string }) => void;
        onError?: (error: string) => void;
    },
    options?: { maxTokens?: number; temperature?: number }
): Promise<{ text: string; thinking?: string } | null> {
    let fullContent = '';
    let fullThinking = '';
    
    return new Promise((resolve) => {
        const handle = streamChat(
            modelId,
            messages,
            {
                onContent: (chunk) => {
                    fullContent += chunk;
                    callbacks.onContent?.(fullContent, chunk);
                },
                onThinking: (chunk) => {
                    fullThinking += chunk;
                    callbacks.onThinking?.(fullThinking, chunk);
                },
                onDone: (response) => {
                    const result = {
                        text: response?.text || fullContent,
                        thinking: response?.thinking || fullThinking || undefined
                    };
                    callbacks.onDone?.(result);
                    resolve(result);
                },
                onError: (error) => {
                    callbacks.onError?.(error);
                    resolve(null);
                }
            },
            options
        );
        
        // 返回 abort 函数供外部使用
        (resolve as any).abort = () => handle.abort();
    });
}

export default useStreamChat;
