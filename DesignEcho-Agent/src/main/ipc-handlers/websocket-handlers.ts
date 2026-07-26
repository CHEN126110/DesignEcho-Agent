/**
 * WebSocket 相关 IPC Handlers
 */

import { ipcMain, IpcMainInvokeEvent } from 'electron';
import type { IPCContext } from './types';
import {
    buildChatTestFakeModelText,
    buildChatTestFakeModelWithTools,
    isChatTestFakeModelEnabled
} from '../testing/chat-test-fake-model';

/**
 * 注册 WebSocket 相关 IPC handlers
 */
export function registerWebSocketHandlers(context: IPCContext): void {
    const { wsServer, taskOrchestrator, modelService } = context;

    // 发送消息到 UXP 插件（可选 timeout，单位 ms）
    ipcMain.handle('ws:send', async (_event: IpcMainInvokeEvent, method: string, params: unknown, timeout?: number) => {
        if (wsServer && wsServer.isPluginConnected()) {
            return await wsServer.sendRequest(method, params, timeout ?? 15000);
        }
        throw new Error('UXP 插件未连接');
    });

    ipcMain.handle('ws:send-cancellable', async (_event: IpcMainInvokeEvent, requestKey: string, method: string, params: unknown, timeout?: number) => {
        if (wsServer && wsServer.isPluginConnected()) {
            return await wsServer.sendRequest(method, params, timeout ?? 15000, { requestKey });
        }
        throw new Error('UXP 插件未连接');
    });

    ipcMain.handle('ws:cancel', async (_event: IpcMainInvokeEvent, requestKey: string) => {
        if (!wsServer) {
            return { success: false, cancelled: false, error: 'WebSocket 服务未初始化' };
        }
        const cancelled = wsServer.cancelRequestByKey(requestKey);
        return { success: true, cancelled };
    });

    // 执行任务
    ipcMain.handle('task:execute', async (_event: IpcMainInvokeEvent, taskType: string, input: unknown) => {
        if (!taskOrchestrator) {
            throw new Error('服务未初始化');
        }
        return await taskOrchestrator.execute(taskType as Parameters<typeof taskOrchestrator.execute>[0], input);
    });

    // 获取连接状态
    ipcMain.handle('ws:status', async () => {
        return {
            connected: wsServer?.isPluginConnected() ?? false,
            diagnostics: wsServer?.getConnectionDiagnostics?.() ?? null
        };
    });

    ipcMain.handle('mcp:tools:list', async () => {
        if (!wsServer || !wsServer.isPluginConnected()) {
            throw new Error('UXP 插件未连接');
        }
        return await wsServer.getMCPTools();
    });

    ipcMain.handle('mcp:tools:call', async (_event: IpcMainInvokeEvent, name: string, args?: unknown) => {
        if (!wsServer || !wsServer.isPluginConnected()) {
            throw new Error('UXP 插件未连接');
        }
        return await wsServer.callMCPTool(name, args ?? {});
    });

    ipcMain.handle('mcp:tools:call-cancellable', async (_event: IpcMainInvokeEvent, requestKey: string, name: string, args?: unknown) => {
        if (!wsServer || !wsServer.isPluginConnected()) {
            throw new Error('UXP 插件未连接');
        }
        return await wsServer.callMCPTool(name, args ?? {}, { requestKey });
    });

    ipcMain.handle('mcp:tools:cancel', async (_event: IpcMainInvokeEvent, requestKey: string) => {
        if (!wsServer) {
            return { success: false, cancelled: false, error: 'WebSocket 服务未初始化' };
        }
        const cancelled = wsServer.cancelRequestByKey(requestKey);
        return { success: true, cancelled };
    });

    // 直接调用模型
    ipcMain.handle('model:chat', async (_event: IpcMainInvokeEvent, modelId: string, messages: unknown[], options?: unknown) => {
        if (!modelService) {
            throw new Error('模型服务未初始化');
        }
        if (isChatTestFakeModelEnabled()) {
            return {
                text: buildChatTestFakeModelText(modelId, messages),
                usage: {
                    inputTokens: 0,
                    outputTokens: 0
                }
            };
        }
        return await modelService.chat(modelId, messages as Parameters<typeof modelService.chat>[1], options as Parameters<typeof modelService.chat>[2]);
    });

    // DeepSeek 官方连通性测试：只验证 OpenAI 兼容文本聊天链路，不声明视觉或工具调用能力。
    ipcMain.handle('model:testDeepSeek', async (_event: IpcMainInvokeEvent, apiKey?: string) => {
        if (!modelService) {
            throw new Error('模型服务未初始化');
        }
        return await modelService.testDeepSeek(apiKey);
    });

    // 带工具调用的模型聊天（Agent Runtime 使用）
    ipcMain.handle('model:chatWithTools', async (
        _event: IpcMainInvokeEvent,
        modelId: string,
        messages: unknown[],
        tools: unknown[],
        options?: unknown
    ) => {
        if (!modelService) {
            throw new Error('模型服务未初始化');
        }
        if (isChatTestFakeModelEnabled()) {
            return buildChatTestFakeModelWithTools(modelId, messages, tools);
        }
        return await modelService.chatWithTools(
            modelId,
            messages as any[],
            tools as any[],
            options as any
        );
    });
}
