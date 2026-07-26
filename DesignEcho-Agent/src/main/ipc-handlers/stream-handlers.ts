/**
 * 流式输出 IPC 处理程序
 * 
 * 处理渲染进程的流式聊天请求，通过 IPC 通道传递流式数据
 */

import { ipcMain, BrowserWindow } from 'electron';
import { ModelService } from '../services/model-service';
import type { StreamChunk } from '../services/stream-adapter';
import type { AgentToolStreamChunk, AgentToolStreamRequest } from '../../shared/agent-tool-stream';
import {
    buildChatTestFakeModelText,
    buildChatTestFakeModelWithTools,
    isChatTestFakeModelEnabled
} from '../testing/chat-test-fake-model';

interface ActiveStream {
    abort: () => void;
}

// 存储活跃的流式请求（用于取消）
const activeStreams = new Map<string, ActiveStream>();

function releaseActiveStream(requestId: string, owner: ActiveStream | undefined): ActiveStream | undefined {
    if (!owner || activeStreams.get(requestId) !== owner) return undefined;
    activeStreams.delete(requestId);
    return owner;
}

function takeActiveStream(requestId: string): ActiveStream | undefined {
    const owner = activeStreams.get(requestId);
    return releaseActiveStream(requestId, owner);
}

function sendStreamChunk(window: BrowserWindow, requestId: string, chunk: StreamChunk): void {
    if (window.isDestroyed()) return;
    window.webContents.send('stream:chunk', {
        requestId,
        chunk
    });
}

function sendAgentToolStreamChunk(window: BrowserWindow, requestId: string, chunk: AgentToolStreamChunk): void {
    if (window.isDestroyed()) return;
    window.webContents.send('stream:chunk', {
        requestId,
        chunk
    });
}

function startChatTestFakeStream(
    window: BrowserWindow,
    requestId: string,
    modelId: string,
    messages: Array<{ role: string; content: string }>
): void {
    const text = buildChatTestFakeModelText(modelId, messages);
    let aborted = false;
    const timers: NodeJS.Timeout[] = [];

    const owner: ActiveStream = {
        abort: () => {
            aborted = true;
            timers.forEach((timer) => clearTimeout(timer));
        }
    };
    activeStreams.set(requestId, owner);

    const emit = (chunk: StreamChunk) => {
        if (aborted) return;
        sendStreamChunk(window, requestId, chunk);
        if (chunk.type === 'done' || chunk.type === 'error') {
            releaseActiveStream(requestId, owner);
        }
    };

    // 只模拟真实内容流，不伪造 provider thinking。
    timers.push(setTimeout(() => emit({ type: 'content', content: text }), 0));
    timers.push(setTimeout(() => emit({
        type: 'done',
        fullResponse: {
            text,
            usage: {
                inputTokens: 0,
                outputTokens: 0
            }
        }
    }), 1));
}

function startChatTestFakeToolStream(
    window: BrowserWindow,
    requestId: string,
    modelId: string,
    messages: unknown[],
    tools: unknown[]
): void {
    let aborted = false;
    const timer = setTimeout(() => {
        if (aborted) return;
        const response = buildChatTestFakeModelWithTools(modelId, messages, tools);
        sendAgentToolStreamChunk(window, requestId, {
            type: 'done',
            response: {
                content: response.content,
                thinking: (response as any).thinking,
                toolCalls: response.toolCalls,
                usage: response.usage,
                stopReason: response.stopReason,
                streamMode: 'fallback'
            }
        });
        releaseActiveStream(requestId, owner);
    }, 0);

    const owner: ActiveStream = {
        abort: () => {
            aborted = true;
            clearTimeout(timer);
        }
    };
    activeStreams.set(requestId, owner);
}

/**
 * 注册流式输出 IPC 处理程序
 */
export function registerStreamHandlers(modelService: ModelService): void {
    console.log('[StreamHandlers] 注册流式输出处理程序');
    
    /**
     * 开始流式聊天
     * 
     * 渲染进程调用此方法开始流式请求
     * 流式数据通过 'stream:chunk' 事件发送到渲染进程
     */
    ipcMain.handle('stream:chat', async (event, args: {
        requestId: string;
        modelId: string;
        messages: Array<{ role: string; content: string }>;
        options?: { maxTokens?: number; temperature?: number; thinkingEnabled?: boolean; timeoutMs?: number };
    }) => {
        const { requestId, modelId, messages, options } = args;
        const window = BrowserWindow.fromWebContents(event.sender);
        
        if (!window) {
            console.error('[StreamHandlers] 无法获取窗口引用');
            return { success: false, error: '无法获取窗口引用' };
        }
        
        console.log(`[StreamHandlers] 开始流式请求: ${requestId}, 模型: ${modelId}`);
        if (activeStreams.has(requestId)) {
            return { success: false, error: `流式请求标识正在使用中，不能并发复用：${requestId}` };
        }
        
        let owner: ActiveStream | undefined;
        try {
            if (isChatTestFakeModelEnabled()) {
                startChatTestFakeStream(window, requestId, modelId, messages);
                return { success: true, requestId };
            }

            // 创建 AbortController 用于取消
            const abortController = new AbortController();
            
            // 获取流式适配器
            const adapter = modelService.chatStream(
                modelId,
                messages.map(m => ({
                    role: m.role as 'user' | 'assistant',
                    content: m.content
                })),
                {
                    ...options,
                    signal: abortController.signal
                }
            );
            
            // 存储用于取消
            owner = {
                abort: () => {
                    abortController.abort();
                    adapter.abort();
                }
            };
            activeStreams.set(requestId, owner);
            
            // 监听流式数据
            adapter.on('chunk', (chunk: StreamChunk) => {
                // 发送到渲染进程
                if (!window.isDestroyed()) {
                    window.webContents.send('stream:chunk', {
                        requestId,
                        chunk
                    });
                }
                
                // 如果完成或出错，清理
                if (chunk.type === 'done' || chunk.type === 'error') {
                    releaseActiveStream(requestId, owner);
                }
            });
            
            return { success: true, requestId };
            
        } catch (error: any) {
            console.error('[StreamHandlers] 流式请求失败:', error);
            releaseActiveStream(requestId, owner);
            return { success: false, error: error.message };
        }
    });

    /**
     * 开始带工具调用的 Agent 模型流。
     *
     * 该通道只传 provider 真实流式事件；不支持工具流的模型由 ModelService 标记 fallback。
     */
    ipcMain.handle('stream:chatWithTools', async (event, args: AgentToolStreamRequest) => {
        const { requestId, modelId, messages, tools, options } = args;
        const window = BrowserWindow.fromWebContents(event.sender);

        if (!window) {
            console.error('[StreamHandlers] 无法获取窗口引用');
            return { success: false, error: '无法获取窗口引用' };
        }

        if (activeStreams.has(requestId)) {
            return { success: false, error: `流式请求标识正在使用中，不能并发复用：${requestId}` };
        }

        let owner: ActiveStream | undefined;
        try {
            if (isChatTestFakeModelEnabled()) {
                startChatTestFakeToolStream(window, requestId, modelId, messages, tools);
                return { success: true, requestId };
            }

            const stream = modelService.chatWithToolsStream(
                modelId,
                messages as any[],
                tools as any[],
                options
            );

            owner = {
                abort: () => stream.abort()
            };
            activeStreams.set(requestId, owner);

            stream.on('chunk', (chunk: AgentToolStreamChunk) => {
                sendAgentToolStreamChunk(window, requestId, chunk);
                if (chunk.type === 'done' || chunk.type === 'error') {
                    releaseActiveStream(requestId, owner);
                }
            });

            return { success: true, requestId };
        } catch (error: any) {
            console.error('[StreamHandlers] Agent 工具流式请求失败:', error);
            releaseActiveStream(requestId, owner);
            return { success: false, error: error.message };
        }
    });
    
    /**
     * 取消流式请求
     */
    ipcMain.handle('stream:abort', async (_event, requestId: string) => {
        console.log(`[StreamHandlers] 取消流式请求: ${requestId}`);
        
        const stream = takeActiveStream(requestId);
        if (stream) {
            stream.abort();
            return { success: true };
        }
        
        return { success: false, error: '请求不存在或已完成' };
    });
    
    /**
     * 获取活跃的流式请求数量
     */
    ipcMain.handle('stream:activeCount', async () => {
        return activeStreams.size;
    });
}

/**
 * 清理所有活跃的流式请求
 */
export function cleanupStreams(): void {
    console.log(`[StreamHandlers] 清理 ${activeStreams.size} 个活跃流式请求`);
    for (const requestId of Array.from(activeStreams.keys())) {
        const stream = takeActiveStream(requestId);
        if (!stream) continue;
        try {
            stream.abort();
        } catch {
            // 忽略错误
        }
    }
}
