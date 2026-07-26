const MCP_HOST_ENDPOINT = 'http://127.0.0.1:8768/mcp';
const MCP_HOST_TIMEOUT_MS = 1500;
const DEFAULT_MCP_TOOL_CALL_TIMEOUT_MS = 30_000;

type JsonRpcId = string | number;

type JsonRpcResponse = {
    jsonrpc: '2.0';
    id: JsonRpcId | null;
    result?: unknown;
    error?: {
        code: number;
        message: string;
        data?: unknown;
    };
};

type InvokeBridge = (channel: string, ...args: any[]) => Promise<any>;

type McpToolCallResult = {
    content?: Array<{ type?: string; text?: string }>;
    isError?: boolean;
};

export type McpToolCallOptions = {
    signal?: AbortSignal;
    timeoutMs?: number;
};

export type PhotoshopBridgeReadiness = {
    ready: boolean;
    healthStatus:
        | 'ready'
        | 'photoshop_not_connected'
        | 'photoshop_bridge_unresponsive'
        | 'photoshop_plugin_message_loop_stale';
    blockers: string[];
    recoveryActions: string[];
    source: 'mcp-host' | 'ipc' | 'provided';
};

function asRecord(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return value as Record<string, unknown>;
}

function parseJsonText(text: string): unknown {
    const raw = String(text || '').trim();
    if (!raw) return raw;
    try {
        return JSON.parse(raw);
    } catch {
        return raw;
    }
}

function getInvokeBridge(): InvokeBridge | null {
    if (typeof window === 'undefined') return null;
    const maybeInvoke = (window as any)?.designEcho?.invoke;
    if (typeof maybeInvoke !== 'function') return null;
    return maybeInvoke as InvokeBridge;
}

function createMcpRequestKey(toolName: string): string {
    const safeName = String(toolName || 'tool').replace(/[^a-z0-9_.-]+/gi, '-').slice(0, 60);
    return `renderer-mcp:${safeName}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
}

function buildCancelledMcpToolResult(requestKey: string): Record<string, unknown> {
    return {
        success: false,
        cancelled: true,
        error: '请求已取消',
        requestKey
    };
}

function parseToolCallPayload(result: unknown): unknown {
    const record = asRecord(result) as McpToolCallResult;
    const first = Array.isArray(record.content) ? record.content[0] : null;
    const text = first && typeof first.text === 'string' ? first.text : '';
    if (!text) return result;
    return parseJsonText(text);
}

function normalizeMcpHostTimeoutMs(value: unknown): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return MCP_HOST_TIMEOUT_MS;
    return Math.max(1_000, Math.round(parsed));
}

async function postMcpRequest(
    method: string,
    params: Record<string, unknown> = {},
    timeoutMs: number = MCP_HOST_TIMEOUT_MS
): Promise<unknown> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), normalizeMcpHostTimeoutMs(timeoutMs));

    try {
        const response = await fetch(MCP_HOST_ENDPOINT, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                jsonrpc: '2.0',
                id: Date.now(),
                method,
                params
            }),
            signal: controller.signal
        });

        if (!response.ok) {
            throw new Error(`MCP host HTTP ${response.status}`);
        }

        const payload = await response.json() as JsonRpcResponse;
        if (payload.error) {
            throw new Error(`MCP host error (${payload.error.code}): ${payload.error.message}`);
        }

        return payload.result;
    } finally {
        clearTimeout(timeoutId);
    }
}

async function callHostTool(
    name: string,
    args: Record<string, unknown> = {},
    options: { timeoutMs?: number } = {}
): Promise<unknown> {
    const result = await postMcpRequest('tools/call', {
        name,
        arguments: args
    }, options.timeoutMs);
    return parseToolCallPayload(result);
}

function getErrorMessage(error: unknown): string {
    if (error instanceof Error) return error.message;
    return String(error || '');
}

function isTimeoutLikeError(error: unknown): boolean {
    const message = getErrorMessage(error);
    return /timeout|timed out|abort|aborted|signal is aborted/i.test(message);
}

export async function getPhotoshopConnectionStatus(): Promise<{ connected: boolean; source: 'mcp-host' | 'ipc' }> {
    try {
        const result = asRecord(await callHostTool('photoshop.connection_status'));
        return {
            connected: Boolean(result.connected),
            source: 'mcp-host'
        };
    } catch {
        const invoke = getInvokeBridge();
        if (!invoke) return { connected: false, source: 'ipc' };
        const legacy = asRecord(await invoke('ws:status'));
        return {
            connected: Boolean(legacy.connected),
            source: 'ipc'
        };
    }
}

export async function checkPhotoshopBridgeReadiness(): Promise<PhotoshopBridgeReadiness> {
    return checkPhotoshopBridgeReadinessWithRetry(1);
}

/**
 * 带重试的 readiness 检查。
 * PS 弹出模态对话框（如"命令'建立:当前不可用"）会阻塞 UXP 插件消息循环，
 * 导致 MCP host 请求超时（1.5s）。用户关闭弹窗后 PS 即恢复，
 * 所以超时后等待 2 秒重试一次，而不是直接判定 PS 不可用。
 */
async function checkPhotoshopBridgeReadinessWithRetry(retriesLeft: number): Promise<PhotoshopBridgeReadiness> {
    const result = await checkPhotoshopBridgeReadinessOnce();

    // 超时类型且还有重试次数：等待后重试
    if (
        !result.ready
        && result.healthStatus === 'photoshop_plugin_message_loop_stale'
        && retriesLeft > 0
    ) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        return checkPhotoshopBridgeReadinessWithRetry(retriesLeft - 1);
    }

    return result;
}

async function checkPhotoshopBridgeReadinessOnce(): Promise<PhotoshopBridgeReadiness> {
    try {
        const connection = asRecord(await callHostTool('photoshop.connection_status'));
        if (!connection.connected) {
            return {
                ready: false,
                healthStatus: 'photoshop_not_connected',
                blockers: ['Photoshop 还没有连接。'],
                recoveryActions: ['请先打开 Photoshop，并确认插件已经连接。'],
                source: 'mcp-host'
            };
        }
    } catch (error) {
        const message = getErrorMessage(error);
        return {
            ready: false,
            healthStatus: isTimeoutLikeError(error)
                ? 'photoshop_plugin_message_loop_stale'
                : 'photoshop_bridge_unresponsive',
            blockers: [message ? `Photoshop 连接检查没有响应：${message}` : 'Photoshop 连接检查没有响应。'],
            recoveryActions: [
                '请在 UXP Developer Tool 中重载插件。',
                '如果仍无响应，请重新打开 Photoshop。'
            ],
            source: 'mcp-host'
        };
    }

    try {
        await callHostTool('photoshop.tools.list');
        return {
            ready: true,
            healthStatus: 'ready',
            blockers: [],
            recoveryActions: [],
            source: 'mcp-host'
        };
    } catch (error) {
        const message = getErrorMessage(error);
        return {
            ready: false,
            healthStatus: isTimeoutLikeError(error)
                ? 'photoshop_plugin_message_loop_stale'
                : 'photoshop_bridge_unresponsive',
            blockers: [message ? `Photoshop 工具暂时没有响应：${message}` : 'Photoshop 工具暂时没有响应。'],
            recoveryActions: [
                '请在 UXP Developer Tool 中重载插件。',
                '如果仍无响应，请重新打开 Photoshop。'
            ],
            source: 'mcp-host'
        };
    }
}

export async function listPhotoshopMcpTools(): Promise<unknown> {
    try {
        return await callHostTool('photoshop.tools.list');
    } catch {
        const invoke = getInvokeBridge();
        if (!invoke) throw new Error('MCP host unavailable and IPC bridge is not available');
        return await invoke('mcp:tools:list');
    }
}

export async function callPhotoshopMcpTool(
    name: string,
    args: Record<string, unknown> = {},
    options: McpToolCallOptions = {}
): Promise<unknown> {
    const normalizedName = String(name || '').trim();
    if (!normalizedName) {
        throw new Error('Tool name is required');
    }
    const requestKey = createMcpRequestKey(normalizedName);
    const directBridge = typeof window !== 'undefined' ? (window as any)?.designEcho : null;
    const invoke = getInvokeBridge();
    let cancelRequested = Boolean(options.signal?.aborted);
    let abortListener: (() => void) | undefined;

    const cancelCurrentRequest = async (): Promise<void> => {
        cancelRequested = true;
        if (typeof directBridge?.cancelMcpToolRequest === 'function') {
            try {
                await directBridge.cancelMcpToolRequest(requestKey);
                return;
            } catch {
                // Fall through to MCP-host or IPC cancellation below.
            }
        }
        try {
            await callHostTool('photoshop.tools.cancel', { requestKey });
            return;
        } catch {
            // Fall through to the preload IPC cancellation path.
        }
        try {
            if (invoke) {
                await invoke('mcp:tools:cancel', requestKey);
            }
        } catch {
            // Cancellation is best-effort; the caller still receives an explicit cancelled result.
        }
    };

    if (cancelRequested) {
        return buildCancelledMcpToolResult(requestKey);
    }

    if (options.signal) {
        abortListener = () => {
            void cancelCurrentRequest();
        };
        options.signal.addEventListener('abort', abortListener, { once: true });
    }

    try {
        if (typeof directBridge?.callMcpToolCancellable === 'function') {
            const result = await directBridge.callMcpToolCancellable(requestKey, normalizedName, args);
            return cancelRequested || options.signal?.aborted
                ? buildCancelledMcpToolResult(requestKey)
                : parseToolCallPayload(result);
        }

        try {
            const result = await callHostTool('photoshop.tools.call', {
                name: normalizedName,
                arguments: args,
                requestKey
            }, {
                timeoutMs: options.timeoutMs ?? DEFAULT_MCP_TOOL_CALL_TIMEOUT_MS
            });
            return cancelRequested || options.signal?.aborted
                ? buildCancelledMcpToolResult(requestKey)
                : result;
        } catch (error) {
            if (cancelRequested || options.signal?.aborted) {
                return buildCancelledMcpToolResult(requestKey);
            }
            try {
                await callHostTool('photoshop.tools.cancel', { requestKey });
            } catch {
                // Best-effort cleanup only; keep the original failure for the fallback path.
            }
            if (!invoke) {
                const originalMessage = getErrorMessage(error);
                throw new Error(originalMessage
                    ? `${originalMessage}; IPC bridge is not available`
                    : 'MCP host unavailable and IPC bridge is not available');
            }
            const result = await invoke('mcp:tools:call-cancellable', requestKey, normalizedName, args);
            return cancelRequested || options.signal?.aborted
                ? buildCancelledMcpToolResult(requestKey)
                : parseToolCallPayload(result);
        }
    } finally {
        if (options.signal && abortListener) {
            options.signal.removeEventListener('abort', abortListener);
        }
    }
}
