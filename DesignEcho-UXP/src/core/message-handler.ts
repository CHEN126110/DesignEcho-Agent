/**
 * 消息处理器
 * 
 * 处理来自 Agent 的请求，支持 MCP 协议和旧版工具调用
 */

import { ToolRegistry } from '../tools/registry';
import { MCPProtocolHandler } from './mcp-protocol';
import {
    executeToolWithPhotoshopTargetGuard,
    stripPhotoshopTargetGuard
} from './photoshop-target-guard';
import { createToolFailureResult } from './tool-error-normalizer';

function isRecord(value: unknown): value is Record<string, any> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function finalizeRawCancelledResult(result: unknown): Record<string, unknown> {
    if (isRecord(result) && isRecord(result.photoshopMutationCommit)) {
        return {
            ...result,
            cancellationRequestedAfterExecution: true
        };
    }
    return {
        success: false,
        cancelled: true,
        error: '请求已取消'
    };
}

function parseMcpTextPayload(value: unknown): unknown {
    if (typeof value !== 'string') return undefined;
    try {
        return JSON.parse(value);
    } catch (_error) {
        return undefined;
    }
}

function finalizeCancelledResult(result: unknown): unknown {
    if (!isRecord(result) || !Array.isArray(result.content)) {
        return finalizeRawCancelledResult(result);
    }
    const firstContent = result.content[0];
    if (!isRecord(firstContent) || firstContent.type !== 'text') {
        return finalizeRawCancelledResult(result);
    }
    const finalizedPayload = finalizeRawCancelledResult(parseMcpTextPayload(firstContent.text));
    return {
        ...result,
        content: [
            {
                ...firstContent,
                text: JSON.stringify(finalizedPayload, null, 2)
            },
            ...result.content.slice(1)
        ],
        isError: finalizedPayload.success === false
    };
}

export class MessageHandler {
    private toolRegistry: ToolRegistry;
    private mcpHandler: MCPProtocolHandler;
    private onPongCallback: (() => void) | null = null;
    private onProgressCallback: ((operation: string, progress: number, message?: string, stage?: string) => void) | null = null;
    private cancelledRequestIds = new Set<string>();

    constructor(toolRegistry: ToolRegistry) {
        this.toolRegistry = toolRegistry;
        this.mcpHandler = new MCPProtocolHandler(toolRegistry);
    }

    /**
     * 设置 pong 回调（用于更新心跳时间）
     */
    setOnPongCallback(callback: () => void): void {
        this.onPongCallback = callback;
    }

    /**
     * 设置进度回调（用于更新 UI 进度）
     */
    setOnProgressCallback(callback: (operation: string, progress: number, message?: string, stage?: string) => void): void {
        this.onProgressCallback = callback;
    }

    // 回调函数，用于处理 WebView 转发的消息
    private webviewActionCallback: ((action: string, payload: any) => Promise<any>) | null = null;

    /**
     * 设置 WebView 动作回调
     */
    setWebViewActionCallback(callback: (action: string, payload: any) => Promise<any>): void {
        this.webviewActionCallback = callback;
    }

    /**
     * 处理工具调用 (兼容 MCP 和旧版格式)
     */
    async handleToolCall(method: string, params: any, requestId?: string | number): Promise<any> {
        const loggedParams = method === 'tools/call' && params && typeof params === 'object'
            ? {
                ...params,
                arguments: stripPhotoshopTargetGuard(params.arguments)
            }
            : stripPhotoshopTargetGuard(params);
        console.log(`[MessageHandler] 请求: ${method}`, loggedParams);
        const requestIdKey = requestId === undefined || requestId === null ? '' : String(requestId);
        if (requestIdKey && this.cancelledRequestIds.has(requestIdKey)) {
            this.cancelledRequestIds.delete(requestIdKey);
            return {
                success: false,
                cancelled: true,
                error: '请求已取消'
            };
        }
        const executionContext = {
            requestId,
            isCancelled: () => Boolean(requestIdKey && this.cancelledRequestIds.has(requestIdKey))
        };

        // 处理来自 Agent WebView 的转发消息
        if (method === 'webview.action') {
            console.log('[MessageHandler] 收到 WebView 转发消息:', params);
            if (this.webviewActionCallback && params?.action) {
                try {
                    const result = await this.webviewActionCallback(params.action, params.payload || {});
                    return { success: true, result };
                } catch (error: any) {
                    console.error('[MessageHandler] WebView 动作处理错误:', error);
                    return { success: false, error: error.message };
                }
            }
            return { success: false, error: '未设置 WebView 动作回调' };
        }

        // 检查是否是 MCP 标准方法
        if (this.isMCPMethod(method)) {
            const result = await this.mcpHandler.handleMethod(method, params, executionContext);
            return this.finalizeRequestCancellation(requestIdKey, result);
        }

        // 提取工具名称 (格式: tool.toolName 或直接 toolName)
        const toolName = method.startsWith('tool.') 
            ? method.substring(5) 
            : method;

        // 检查是否是已注册的工具
        const tool = this.toolRegistry.getTool(toolName);
        if (tool) {
            try {
                const result = await executeToolWithPhotoshopTargetGuard(tool, params, executionContext);
                const finalizedResult = this.finalizeRequestCancellation(requestIdKey, result);
                console.log(`[MessageHandler] 工具结果:`, result);
                return finalizedResult;
            } catch (error: any) {
                console.error(`[MessageHandler] 工具错误:`, error);
                const failure = createToolFailureResult({
                    toolName,
                    error,
                    params: stripPhotoshopTargetGuard(params)
                });
                return this.finalizeRequestCancellation(requestIdKey, failure);
            }
        }

        // 尝试作为 MCP 方法处理
        const result = await this.mcpHandler.handleMethod(method, params, executionContext);
        return this.finalizeRequestCancellation(requestIdKey, result);
    }

    private finalizeRequestCancellation(requestIdKey: string, result: unknown): unknown {
        if (!requestIdKey || !this.cancelledRequestIds.has(requestIdKey)) return result;
        this.cancelledRequestIds.delete(requestIdKey);
        return finalizeCancelledResult(result);
    }

    /**
     * 检查是否是 MCP 标准方法
     */
    private isMCPMethod(method: string): boolean {
        const mcpMethods = [
            'initialize',
            'initialized',
            'tools/list',
            'tools/call',
            'resources/list',
            'resources/read',
            'resources/templates/list',
            'prompts/list',
            'prompts/get',
            'logging/setLevel',
            'ping'
        ];
        return mcpMethods.includes(method);
    }

    /**
     * 处理通知
     */
    handleNotification(method: string, params: any): void {
        console.log(`[MessageHandler] 通知: ${method}`, params);

        switch (method) {
            case 'pong':
                // 心跳响应 - 调用回调更新时间
                if (this.onPongCallback) {
                    this.onPongCallback();
                }
                break;
            case 'progress':
                // 进度更新 - 用于长时间操作
                if (this.onProgressCallback && params) {
                    this.onProgressCallback(
                        params.operation || 'unknown',
                        params.progress || 0,
                        params.message,
                        params.stage
                    );
                }
                break;
            case 'agent.status':
                // Agent 状态更新
                console.log('[MessageHandler] Agent 状态:', params);
                break;
            case 'agent.ready':
                // Agent 就绪
                console.log('[MessageHandler] Agent 已就绪:', params);
                break;
            case 'notifications/cancelled':
                // MCP 取消通知
                console.log('[MessageHandler] 请求已取消:', params);
                if (params?.requestId !== undefined && params?.requestId !== null) {
                    this.cancelledRequestIds.add(String(params.requestId));
                }
                break;
            default:
                console.log(`[MessageHandler] 未知通知: ${method}`);
        }
    }

    /**
     * 获取 MCP 协议处理器
     */
    getMCPHandler(): MCPProtocolHandler {
        return this.mcpHandler;
    }

    /**
     * 检查 MCP 是否已初始化
     */
    isMCPInitialized(): boolean {
        return this.mcpHandler.isInitialized();
    }
}
