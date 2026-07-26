/**
 * WebSocket 服务器
 * 
 * 处理与 UXP 插件的通信
 * 支持 MCP (Model Context Protocol) 协议 + 二进制传输
 * 
 * 二进制传输优化：
 * - 图像数据使用二进制帧传输，避免 Base64 膨胀
 * - 参考 sd-ppp 设计，使用 Buffer/Uint8Array 直传
 */

import { WebSocketServer as WSServer, WebSocket } from 'ws';
import { getLogService, LogEntry } from '../services/log-service';
import {
    BinaryMessageType,
    BinaryHeader,
    BINARY_HEADER_SIZE,
    createBinaryMessage,
    parseBinaryMessage,
    isBinaryMessage,
    getBinaryTypeName,
    base64ToBuffer
} from '../../shared/binary-protocol';

// 重新导出二进制协议类型，供其他模块使用
export { BinaryMessageType, BinaryHeader } from '../../shared/binary-protocol';

// MCP 协议版本和服务器信息
const MCP_VERSION = '2024-11-05';
const AGENT_INFO = {
    name: 'DesignEcho-Agent',
    version: '1.0.0',
    description: 'DesignEcho Agent - MCP Host for AI-powered design assistance'
};

// MCP 能力声明 (作为 Host/Client)
const AGENT_CAPABILITIES = {
    roots: { listChanged: true },
    sampling: {}
};

interface JsonRpcRequest {
    jsonrpc: '2.0';
    id: string | number;
    method: string;
    params?: any;
}

interface JsonRpcResponse {
    jsonrpc: '2.0';
    id: string | number | null;
    result?: any;
    error?: {
        code: number;
        message: string;
        data?: any;
    };
}

interface ServerOptions {
    onMessage?: (message: any) => void;
    onConnection?: () => void;
    onDisconnection?: () => void;
}

export interface WebSocketConnectionDiagnostics {
    connected: boolean;
    readyState: string;
    lastActivityAt: string | null;
    lastConnectedAt: string | null;
    lastDisconnectedAt: string | null;
    lastPingReceivedAt: string | null;
    lastPongSentAt: string | null;
    lastNativePingAt: string | null;
    lastNativePongAt: string | null;
    appHeartbeatAgeMs: number | null;
    appHeartbeatStale: boolean;
    missedNativePongs: number;
    lastError: string | null;
    pendingRequestCount: number;
    pendingRequests: Array<{
        id: string;
        method: string;
        startedAt: string | null;
        ageMs: number;
    }>;
}

type PendingRequest = {
    resolve: (value: any) => void;
    reject: (error: Error) => void;
    timeout: ReturnType<typeof setTimeout>;
    method: string;
    startedAt: number;
    requestKey?: string;
};

type SendRequestOptions = {
    requestKey?: string;
};

// 请求处理器类型
type RequestHandler = (params: any) => Promise<any>;

// 二进制请求处理器类型
type BinaryRequestHandler = (header: BinaryHeader, imageData: Buffer) => Promise<{
    type: BinaryMessageType;
    width: number;
    height: number;
    data: Buffer;
} | null>;

// 二进制请求待处理项
type PendingBinaryRequest = {
    resolve: (data: { header: BinaryHeader; imageData: Buffer }) => void;
    reject: (error: Error) => void;
    timeout: ReturnType<typeof setTimeout>;
};

type CachedBinaryMessage = {
    header: BinaryHeader;
    imageData: Buffer;
    timestamp: number;
};

export class WebSocketServer {
    private requestHandlers: Map<string, RequestHandler> = new Map();
    private binaryHandler: BinaryRequestHandler | null = null;  // 二进制消息处理器
    private pendingBinaryRequests: Map<number, PendingBinaryRequest> = new Map();  // 二进制请求
    private receivedBinaryCache: Map<number, CachedBinaryMessage> = new Map();  // 已到达但未被 waitForBinaryData 消费的数据
    private receivedBinaryCacheTimers: Map<number, ReturnType<typeof setTimeout>> = new Map();
    private wss: WSServer | null = null;
    private port: number;
    private pluginSocket: WebSocket | null = null;
    private options: ServerOptions;
    private requestId: number = 0;
    private pendingRequests: Map<string | number, PendingRequest> = new Map();
    private requestKeyToId: Map<string, string | number> = new Map();
    
    // 连接保持机制（参考 sd-ppp: ping_interval=60, ping_timeout=50）
    private keepAliveInterval: ReturnType<typeof setInterval> | null = null;
    private lastActivityTime: number = Date.now();
    private static readonly KEEP_ALIVE_INTERVAL = 30000;  // 30秒发送一次心跳（sd-ppp 用 60s，适中选择）
    private static readonly MAX_MISSED_NATIVE_PONGS = 3;
    private static readonly APP_HEARTBEAT_STALE_MS = 120000;
    private lastConnectedAt: number | null = null;
    private lastDisconnectedAt: number | null = null;
    private lastPingReceivedAt: number | null = null;
    private lastPongSentAt: number | null = null;
    private lastNativePingAt: number | null = null;
    private lastNativePongAt: number | null = null;
    private missedNativePongs: number = 0;
    private awaitingNativePong: boolean = false;
    private lastSocketError: string | null = null;

    constructor(port: number, options: ServerOptions = {}) {
        this.port = port;
        this.options = options;
    }

    /**
     * 启动服务器（带重试机制）
     */
    start(retryCount: number = 0): void {
        const maxRetries = 3;
        const retryDelay = 1000; // 1秒
        
        // 参考 sd-ppp: max_http_buffer_size=524288000 (500MB)
        this.wss = new WSServer({ 
            port: this.port,
            maxPayload: 500 * 1024 * 1024  // 500MB - 支持超大图像传输（sd-ppp 标准）
        });

        this.wss.on('listening', () => {
            console.log(`[WebSocket Server] Listening on port ${this.port} (maxPayload: 500MB)`);
        });

        this.wss.on('connection', (socket: WebSocket) => {
            // 使用日志服务记录连接状态（只在状态变化时显示）
            const logService = getLogService();
            logService.logConnectionStatus(true, 'WebSocket connected');
            
            // 只允许一个插件连接
            if (this.pluginSocket) {
                logService.logAgent('debug', '[WebSocket] Closing previous plugin connection');
                this.stopKeepAlive();
                this.rejectPendingRequests('UXP 插件连接已被新连接替换');
                this.rejectPendingBinaryRequests();
                this.clearReceivedBinaryCache();
                const previousSocket = this.pluginSocket;
                this.pluginSocket = null;
                previousSocket.close();
            }

            this.pluginSocket = socket;
            this.lastActivityTime = Date.now();
            this.lastConnectedAt = Date.now();
            this.lastSocketError = null;
            this.lastDisconnectedAt = null;
            this.awaitingNativePong = false;
            this.missedNativePongs = 0;
            this.lastNativePingAt = null;
            this.lastNativePongAt = null;
            this.options.onConnection?.();
            
            // 启动心跳保持
            this.startKeepAlive();

            socket.on('message', (data: Buffer) => {
                if (this.pluginSocket !== socket) return;
                this.lastActivityTime = Date.now();
                
                // 区分二进制和文本消息
                if (isBinaryMessage(data)) {
                    this.handleBinaryMessage(data, socket);
                } else {
                    this.handleMessage(data.toString(), socket);
                }
            });

            socket.on('pong', () => {
                if (this.pluginSocket !== socket) return;
                this.lastNativePongAt = Date.now();
                this.awaitingNativePong = false;
                this.missedNativePongs = 0;
            });

            socket.on('close', () => {
                if (this.pluginSocket === socket) {
                    logService.logConnectionStatus(false, 'WebSocket disconnected');
                    logService.resetHeartbeatLog();
                    this.stopKeepAlive();
                    this.pluginSocket = null;
                    this.lastDisconnectedAt = Date.now();
                    this.awaitingNativePong = false;
                    this.missedNativePongs = 0;
                    this.rejectPendingRequests('UXP 插件连接已断开');
                    this.rejectPendingBinaryRequests();
                    this.clearReceivedBinaryCache();
                    this.options.onDisconnection?.();
                }
            });

            socket.on('error', (error: Error) => {
                if (this.pluginSocket === socket) {
                    this.lastSocketError = error.message;
                }
                logService.logAgent('error', `[WebSocket] Socket error: ${error.message}`);
            });
        });

        this.wss.on('error', (error: Error & { code?: string }) => {
            console.error('[WebSocket Server] Server error:', error);
            
            // 处理端口占用错误
            if (error.code === 'EADDRINUSE') {
                console.log(`[WebSocket Server] Port ${this.port} is already in use`);
                
                if (retryCount < maxRetries) {
                    console.log(`[WebSocket Server] Retrying in ${retryDelay / 1000}s (${retryCount + 1}/${maxRetries})...`);
                    
                    // 关闭当前服务器实例
                    if (this.wss) {
                        this.wss.close();
                        this.wss = null;
                    }
                    
                    // 延迟后重试
                    setTimeout(() => {
                        this.start(retryCount + 1);
                    }, retryDelay);
                } else {
                    console.error(`[WebSocket Server] Port ${this.port} is still in use after maximum retries`);
                }
            }
        });
    }

    /**
     * 停止服务器
     */
    stop(): void {
        this.stopKeepAlive();

        this.rejectPendingRequests('Server stopped');
        this.rejectPendingBinaryRequests();
        this.clearReceivedBinaryCache();

        if (this.pluginSocket) {
            this.pluginSocket.close();
            this.pluginSocket = null;
        }

        if (this.wss) {
            this.wss.close();
            this.wss = null;
        }

        console.log('[WebSocket Server] Stopped');
    }

    /**
     * 启动心跳保持机制
     * 定期向 UXP 发送心跳，防止长时间操作期间连接超时
     */
    private startKeepAlive(): void {
        this.stopKeepAlive();  // 确保清理旧的
        
        this.keepAliveInterval = setInterval(() => {
            if (this.isPluginConnected()) {
                this.sendNativePing();
                // 发送 pong 响应（模拟 UXP 的 ping），不记录日志
                this.sendNotification('pong', { 
                    timestamp: Date.now(),
                    serverAlive: true 
                });
            }
        }, WebSocketServer.KEEP_ALIVE_INTERVAL);
        
        // 只记录一次心跳启动
        const logService = getLogService();
        logService.logHeartbeatOnce();
    }

    /**
     * 停止心跳保持
     */
    private stopKeepAlive(): void {
        if (this.keepAliveInterval) {
            clearInterval(this.keepAliveInterval);
            this.keepAliveInterval = null;
        }
    }

    private sendNativePing(): void {
        if (!this.pluginSocket || this.pluginSocket.readyState !== WebSocket.OPEN) return;

        if (this.awaitingNativePong) {
            this.missedNativePongs += 1;
            if (this.missedNativePongs >= WebSocketServer.MAX_MISSED_NATIVE_PONGS) {
                this.closeStalePluginSocket('native pong timeout');
                return;
            }
        }

        try {
            this.awaitingNativePong = true;
            this.lastNativePingAt = Date.now();
            this.pluginSocket.ping();
        } catch (error: any) {
            const message = error?.message || 'native ping failed';
            this.lastSocketError = message;
            this.closeStalePluginSocket(message);
        }
    }

    private closeStalePluginSocket(reason: string): void {
        if (!this.pluginSocket) return;

        const socket = this.pluginSocket;
        this.lastSocketError = reason;
        console.warn(`[WebSocket Server] Closing stale plugin socket: ${reason}`);

        try {
            socket.close(1001, reason);
        } catch (error: any) {
            this.lastSocketError = error?.message || reason;
            socket.terminate();
        }
    }

    /**
     * 发送处理进度通知（用于长时间操作）
     */
    sendProgress(operation: string, progress: number, message?: string, stage?: string): void {
        if (!this.isPluginConnected()) return;
        
        this.sendNotification('progress', {
            operation,
            progress,
            message,
            stage,
            timestamp: Date.now()
        });
    }

    // ==================== 二进制传输方法 ====================

    /**
     * 注册二进制消息处理器
     */
    setBinaryHandler(handler: BinaryRequestHandler): void {
        this.binaryHandler = handler;
        console.log('[WebSocket Server] Binary handler registered');
    }

    private takePendingBinaryRequest(requestId: number): PendingBinaryRequest | undefined {
        const pending = this.pendingBinaryRequests.get(requestId);
        if (!pending) return undefined;
        clearTimeout(pending.timeout);
        this.pendingBinaryRequests.delete(requestId);
        return pending;
    }

    private rejectPendingBinaryRequests(): void {
        const requestIds = Array.from(this.pendingBinaryRequests.keys());
        requestIds.forEach((requestId) => {
            const pending = this.takePendingBinaryRequest(requestId);
            pending?.reject(new Error(`二进制请求已终止：${requestId}`));
        });
    }

    private takeReceivedBinaryCache(requestId: number): CachedBinaryMessage | undefined {
        const cached = this.receivedBinaryCache.get(requestId);
        if (!cached) return undefined;
        const timer = this.receivedBinaryCacheTimers.get(requestId);
        if (timer) clearTimeout(timer);
        this.receivedBinaryCacheTimers.delete(requestId);
        this.receivedBinaryCache.delete(requestId);
        return cached;
    }

    private cacheReceivedBinaryMessage(message: CachedBinaryMessage): void {
        this.takeReceivedBinaryCache(message.header.requestId);
        this.receivedBinaryCache.set(message.header.requestId, message);
        const timer = setTimeout(() => {
            if (this.receivedBinaryCache.get(message.header.requestId) === message) {
                this.receivedBinaryCache.delete(message.header.requestId);
            }
            if (this.receivedBinaryCacheTimers.get(message.header.requestId) === timer) {
                this.receivedBinaryCacheTimers.delete(message.header.requestId);
            }
        }, 30000);
        this.receivedBinaryCacheTimers.set(message.header.requestId, timer);
    }

    private clearReceivedBinaryCache(): void {
        this.receivedBinaryCacheTimers.forEach((timer) => clearTimeout(timer));
        this.receivedBinaryCacheTimers.clear();
        this.receivedBinaryCache.clear();
    }

    /**
     * 等待指定 requestId 的二进制数据到达
     *
     * 用于 UXP handler 中获取二进制图像传输的数据
     */
    waitForBinaryData(requestId: number, timeoutMs: number = 10000): Promise<{ header: BinaryHeader; imageData: Buffer } | null> {
        // 先检查是否已经到达（二进制可能先于 JSON 到达）
        const cached = this.takeReceivedBinaryCache(requestId);
        if (cached) {
            return Promise.resolve({ header: cached.header, imageData: cached.imageData });
        }

        if (this.pendingBinaryRequests.has(requestId)) {
            return Promise.reject(new Error(`二进制请求正在等待中，不能重复注册：${requestId}`));
        }

        return new Promise((resolve) => {
            const timeoutId = setTimeout(() => {
                const pending = this.takePendingBinaryRequest(requestId);
                pending?.reject(new Error(`二进制请求等待超时：${requestId}`));
            }, timeoutMs);

            this.pendingBinaryRequests.set(requestId, {
                resolve: (data) => {
                    clearTimeout(timeoutId);
                    resolve(data);
                },
                reject: () => {
                    clearTimeout(timeoutId);
                    resolve(null);
                },
                timeout: timeoutId
            });
        });
    }

    /**
     * 发送二进制数据到 UXP
     * 
     * @param type 消息类型
     * @param requestId 关联的请求 ID
     * @param width 图像宽度
     * @param height 图像高度
     * @param imageData 图像数据
     */
    sendBinaryData(
        type: BinaryMessageType,
        requestId: number,
        width: number,
        height: number,
        imageData: Buffer | Uint8Array
    ): void {
        if (!this.isPluginConnected()) {
            console.warn('[WebSocket Server] Cannot send binary: plugin not connected');
            return;
        }

        const message = createBinaryMessage(type, requestId, width, height, 
            Buffer.isBuffer(imageData) ? imageData : Buffer.from(imageData));
        
        try {
            this.pluginSocket!.send(message);
            console.log(`[WebSocket Server] 二进制发送: ${getBinaryTypeName(type)}, ` +
                `requestId=${requestId}, ${width}x${height}, ` +
                `${(imageData.length / 1024).toFixed(1)}KB`);
        } catch (e: any) {
            console.error(`[WebSocket Server] 二进制发送失败: ${e.message}`);
        }
    }

    /**
     * 处理收到的二进制消息
     */
    private async handleBinaryMessage(data: Buffer, sourceSocket: WebSocket): Promise<void> {
        console.log(`[WebSocket Server] 收到二进制消息: ${(data.length / 1024).toFixed(1)}KB`);

        // 解析消息
        const { header, imageData } = parseBinaryMessage(data);
        
        console.log(`[WebSocket Server] 二进制消息: ${getBinaryTypeName(header.type)}, ` +
            `requestId=${header.requestId}, ${header.width}x${header.height}, ` +
            `数据: ${(imageData.length / 1024).toFixed(1)}KB`);

        // 检查是否有等待的响应
        const pending = this.takePendingBinaryRequest(header.requestId);
        if (pending) {
            pending.resolve({ header, imageData });
            return;
        }

        // 缓存二进制数据，供后续 waitForBinaryData 调用消费
        this.cacheReceivedBinaryMessage({ header, imageData, timestamp: Date.now() });

        // 调用二进制处理器
        if (this.binaryHandler) {
            try {
                const result = await this.binaryHandler(header, imageData);
                if (result && this.pluginSocket === sourceSocket) {
                    // 返回处理结果
                    this.sendBinaryData(
                        result.type,
                        header.requestId,  // 使用相同的 requestId 关联响应
                        result.width,
                        result.height,
                        result.data
                    );
                }
            } catch (error: any) {
                console.error(`[WebSocket Server] 二进制处理失败:`, error);
                // 发送错误响应（使用 JSON-RPC）
                if (this.pluginSocket === sourceSocket) {
                    this.sendErrorResponse(header.requestId, -32000, error.message || '二进制处理失败', sourceSocket);
                }
            }
        } else {
            console.warn('[WebSocket Server] 没有注册二进制处理器');
        }
    }

    /**
     * 检查插件是否已连接
     */
    isPluginConnected(): boolean {
        return this.pluginSocket !== null && 
               this.pluginSocket.readyState === WebSocket.OPEN;
    }

    getConnectionDiagnostics(): WebSocketConnectionDiagnostics {
        return {
            connected: this.isPluginConnected(),
            readyState: this.getPluginReadyState(),
            lastActivityAt: this.formatTimestamp(this.lastActivityTime),
            lastConnectedAt: this.formatTimestamp(this.lastConnectedAt),
            lastDisconnectedAt: this.formatTimestamp(this.lastDisconnectedAt),
            lastPingReceivedAt: this.formatTimestamp(this.lastPingReceivedAt),
            lastPongSentAt: this.formatTimestamp(this.lastPongSentAt),
            lastNativePingAt: this.formatTimestamp(this.lastNativePingAt),
            lastNativePongAt: this.formatTimestamp(this.lastNativePongAt),
            appHeartbeatAgeMs: this.getAppHeartbeatAgeMs(),
            appHeartbeatStale: this.isAppHeartbeatStale(),
            missedNativePongs: this.missedNativePongs,
            lastError: this.lastSocketError,
            pendingRequestCount: this.pendingRequests.size,
            pendingRequests: this.getPendingRequestDiagnostics()
        };
    }

    private getAppHeartbeatAgeMs(now: number = Date.now()): number | null {
        if (!this.lastPingReceivedAt) return null;
        return Math.max(0, now - this.lastPingReceivedAt);
    }

    private isAppHeartbeatStale(now: number = Date.now()): boolean {
        if (!this.isPluginConnected()) return false;
        const heartbeatAgeMs = this.getAppHeartbeatAgeMs(now);
        if (heartbeatAgeMs === null) {
            return this.lastConnectedAt !== null
                && now - this.lastConnectedAt > WebSocketServer.APP_HEARTBEAT_STALE_MS;
        }
        return heartbeatAgeMs > WebSocketServer.APP_HEARTBEAT_STALE_MS;
    }

    private getPendingRequestDiagnostics(): WebSocketConnectionDiagnostics['pendingRequests'] {
        const now = Date.now();
        return Array.from(this.pendingRequests.entries()).map(([id, pending]) => ({
            id: String(id),
            method: pending.method,
            startedAt: this.formatTimestamp(pending.startedAt),
            ageMs: Math.max(0, now - pending.startedAt)
        }));
    }

    private buildPluginRequestTimeoutError(
        method: string,
        requestId: string | number,
        timeoutPrefix: 'Request timeout' | 'MCP request timeout' = 'Request timeout'
    ): Error {
        const diagnostics = this.getConnectionDiagnostics();
        const pending = diagnostics.pendingRequests.find((item) => item.id === String(requestId));
        const pendingSummary = pending
            ? `pendingRequest=${pending.method}, ageMs=${pending.ageMs}`
            : `pendingRequest=${method}`;
        const message = [
            `${timeoutPrefix}: ${method}`,
            'Photoshop 可能有弹窗未关闭，或仍在处理上一步。',
            '请检查 Photoshop 是否有确认框或提示框，关闭后重载插件；恢复前不要重复执行写入步骤。',
            pendingSummary
        ].join(' ');
        const error = new Error(message);
        (error as Error & {
            code?: string;
            errorCategory?: string;
            diagnostics?: WebSocketConnectionDiagnostics;
        }).code = 'photoshop_native_modal_suspected';
        (error as Error & {
            code?: string;
            errorCategory?: string;
            diagnostics?: WebSocketConnectionDiagnostics;
        }).errorCategory = 'photoshop_native_modal_suspected';
        (error as Error & {
            code?: string;
            errorCategory?: string;
            diagnostics?: WebSocketConnectionDiagnostics;
        }).diagnostics = diagnostics;
        return error;
    }

    private getPluginReadyState(): string {
        if (!this.pluginSocket) return 'none';

        switch (this.pluginSocket.readyState) {
            case WebSocket.CONNECTING:
                return 'connecting';
            case WebSocket.OPEN:
                return 'open';
            case WebSocket.CLOSING:
                return 'closing';
            case WebSocket.CLOSED:
                return 'closed';
            default:
                return String(this.pluginSocket.readyState);
        }
    }

    private formatTimestamp(value: number | null): string | null {
        return value ? new Date(value).toISOString() : null;
    }

    private rejectPendingRequests(message: string): void {
        const requestIds = Array.from(this.pendingRequests.keys());
        requestIds.forEach((requestId) => {
            const pending = this.takePendingRequest(requestId);
            pending?.reject(new Error(message));
        });
        this.requestKeyToId.clear();
    }

    private assertRequestKeyAvailable(requestKey: string | undefined): void {
        if (!requestKey) return;
        const activeId = this.requestKeyToId.get(requestKey);
        if (activeId === undefined) return;
        if (!this.pendingRequests.has(activeId)) {
            this.requestKeyToId.delete(requestKey);
            return;
        }
        throw new Error(`请求标识正在使用中，不能并发复用：${requestKey}`);
    }

    private releaseRequestKey(requestKey: string | undefined, requestId: string | number): void {
        if (!requestKey) return;
        if (this.requestKeyToId.get(requestKey) === requestId) {
            this.requestKeyToId.delete(requestKey);
        }
    }

    private takePendingRequest(requestId: string | number): PendingRequest | undefined {
        const pending = this.pendingRequests.get(requestId);
        if (!pending) return undefined;
        clearTimeout(pending.timeout);
        this.pendingRequests.delete(requestId);
        this.releaseRequestKey(pending.requestKey, requestId);
        return pending;
    }

    /**
     * Default timeout for normal tools. Kept short (15s) so that if Photoshop
     * pops a native dialog blocking executeAsModal, the Agent detects it quickly
     * instead of hanging for 30s. Long-running tools (exports, snapshots) use
     * LONG_RUNNING_TOOL_TIMEOUT_MS instead.
     */
    private static readonly DEFAULT_TOOL_TIMEOUT_MS = 15000;

    /**
     * 长任务工具：真实执行时间随文档大小线性增长（1.6GB PSB 上单屏裁切即 5-15s），
     * 30 秒统一超时会在任务正常推进时提前放弃并留下半完成状态（实测：导出做到一半、
     * 历史未恢复、屏分组可见性错乱）。这类工具放宽到 5 分钟；其余保持 15s 快速失败。
     */
    private static readonly LONG_RUNNING_TOOL_TIMEOUT_MS = 300000;
    private static readonly LONG_RUNNING_TOOL_NAMES = new Set([
        'exportDetailPageSlices',
        'fillDetailPage',
        'parseDetailPageTemplate',
        'detectLayerIssues',
        'fixLayerIssues',
        'getScreenSnapshots',
        'getScreenSnapshotsWithOverlay',
        'getDocumentSnapshot',
        'getCanvasSnapshot',
        'getAnnotatedSnapshot',
        'openTemplate',
        'smartSave',
        'saveDocument',
        'exportGroup',
        'quickExport'
    ]);

    private resolveRequestTimeoutMs(method: string, params: any, fallback: number): number {
        const candidates = [
            params?.name,
            params?.arguments?.name,
            String(method || '').replace(/^tool\./, '')
        ].map((value) => String(value || '').trim()).filter(Boolean);
        if (candidates.some((name) => WebSocketServer.LONG_RUNNING_TOOL_NAMES.has(name))) {
            return WebSocketServer.LONG_RUNNING_TOOL_TIMEOUT_MS;
        }
        return fallback;
    }

    /**
     * 发送请求到插件
     */
    async sendRequest(method: string, params?: any, timeout: number = WebSocketServer.DEFAULT_TOOL_TIMEOUT_MS, options: SendRequestOptions = {}): Promise<any> {
        timeout = Math.max(timeout, this.resolveRequestTimeoutMs(method, params, timeout));
        if (!this.isPluginConnected()) {
            throw new Error('Plugin not connected');
        }

        const requestKey = String(options.requestKey || '').trim() || undefined;
        this.assertRequestKeyAvailable(requestKey);
        const id = ++this.requestId;
        
        // 某些方法不需要添加 tool. 前缀
        const request: JsonRpcRequest = {
            jsonrpc: '2.0',
            id,
            method,
            params
        };

        return new Promise(async (resolve, reject) => {
            const timeoutId = setTimeout(() => {
                const timeoutError = this.buildPluginRequestTimeoutError(method, id, 'Request timeout');
                const pending = this.takePendingRequest(id);
                pending?.reject(timeoutError);
            }, timeout);

            this.pendingRequests.set(id, {
                resolve,
                reject,
                timeout: timeoutId,
                method,
                startedAt: Date.now(),
                requestKey
            });
            if (requestKey) {
                this.requestKeyToId.set(requestKey, id);
            }

            // 计算数据大小并在发送大数据前发送心跳
            const startTime = Date.now();
            const jsonString = JSON.stringify(request);
            const dataSize = jsonString.length;
            const serializeTime = Date.now() - startTime;
            
            if (serializeTime > 100) {
                console.log(`[WebSocket Server] JSON 序列化耗时: ${serializeTime}ms, 数据大小: ${(dataSize / 1024 / 1024).toFixed(2)}MB`);
            }
            
            // 如果数据较大，先发送一个心跳保持连接
            if (dataSize > 1024 * 1024) {  // 大于 1MB
                this.sendNotification('pong', { 
                    timestamp: Date.now(), 
                    serverAlive: true, 
                    stage: 'before-large-data',
                    dataSize: (dataSize / 1024 / 1024).toFixed(2) + 'MB'
                });
                // 让事件循环有机会处理其他任务
                await new Promise(r => setImmediate(r));
            }
            
            try {
                this.pluginSocket!.send(jsonString);
                console.log(`[WebSocket Server] Request sent: ${method} (${(dataSize / 1024).toFixed(1)}KB, serialize: ${serializeTime}ms)`);
            } catch (e: any) {
                const pending = this.takePendingRequest(id);
                pending?.reject(new Error(`发送失败: ${e.message}`));
            }
        });
    }

    cancelRequestByKey(requestKey: string, reason: string = 'user_cancelled'): boolean {
        const key = String(requestKey || '').trim();
        if (!key) return false;

        const id = this.requestKeyToId.get(key);
        if (id === undefined) return false;

        const pending = this.takePendingRequest(id);
        if (!pending) return false;

        pending.reject(new Error('请求已取消'));

        this.sendNotification('notifications/cancelled', {
            requestId: id,
            requestKey: key,
            method: pending.method,
            reason
        });
        console.log(`[WebSocket Server] Request cancelled: ${pending.method} id=${String(id)} key=${key}`);
        return true;
    }

    /**
     * 发送通知到插件（带错误保护）
     */
    sendNotification(method: string, params?: any): void {
        if (!this.isPluginConnected()) {
            console.warn('[WebSocket Server] Cannot send: plugin not connected');
            return;
        }

        const notification = {
            jsonrpc: '2.0',
            method,
            params
        };

            try {
                this.pluginSocket!.send(JSON.stringify(notification));
                if (method === 'pong') {
                    this.lastPongSentAt = Date.now();
                }
            } catch (e: any) {
                // 忽略发送错误（可能是连接已断开）
                console.warn(`[WebSocket Server] 发送通知失败: ${e.message}`);
        }
    }

    /**
     * 注册请求处理器
     */
    registerHandler(method: string, handler: RequestHandler): void {
        this.requestHandlers.set(method, handler);
        console.log(`[WebSocket Server] Handler registered: ${method}`);
    }

    private summarizeValueForLog(value: any, depth = 0): string {
        if (value === null) return 'null';
        if (value === undefined) return 'undefined';
        if (typeof value === 'string') return `string(${value.length})`;
        if (typeof value === 'number' || typeof value === 'boolean') return String(value);
        if (typeof value === 'bigint') return `bigint(${value.toString()})`;
        if (Buffer.isBuffer(value)) return `Buffer(${value.length})`;
        if (value instanceof Uint8Array) return `Uint8Array(${value.length})`;
        if (Array.isArray(value)) return `Array(${value.length})`;
        if (typeof value !== 'object') return typeof value;
        if (depth >= 1) return `Object(${Object.keys(value).length})`;
        const keys = Object.keys(value);
        const preview = keys.slice(0, 6).join(',');
        return `Object(${keys.length}){${preview}${keys.length > 6 ? ',...' : ''}}`;
    }

    private summarizeRpcMessageForLog(message: any): string {
        const hasId = Object.prototype.hasOwnProperty.call(message, 'id') && message.id !== null && message.id !== undefined;
        const hasMethod = typeof message?.method === 'string' && message.method.length > 0;
        const kind = hasId && hasMethod ? 'request'
            : hasId && !hasMethod ? 'response'
            : hasMethod ? 'notification'
            : 'unknown';
        const idPart = hasId ? ` id=${String(message.id)}` : '';
        const methodPart = hasMethod ? ` method=${message.method}` : '';
        const paramsPart = hasMethod && Object.prototype.hasOwnProperty.call(message, 'params')
            ? ` params=${this.summarizeValueForLog(message.params)}`
            : '';
        const resultPart = Object.prototype.hasOwnProperty.call(message, 'result')
            ? ` result=${this.summarizeValueForLog(message.result)}`
            : '';
        const errorPart = Object.prototype.hasOwnProperty.call(message, 'error')
            ? ` error=${this.summarizeValueForLog(message.error)}`
            : '';
        return `${kind}${idPart}${methodPart}${paramsPart}${resultPart}${errorPart}`;
    }

    /**
     * 处理收到的消息
     */
    private handleMessage(data: string, sourceSocket: WebSocket): void {
        try {
            const message = JSON.parse(data);
            
            // 过滤心跳消息的日志输出
            const isHeartbeat = message.method === 'ping' || message.method === 'pong' || 
                               (message.method === 'plugin.log' && message.params?.message?.includes('pong'));
            
            if (!isHeartbeat) {
                console.log(`[WebSocket Server] Received ${this.summarizeRpcMessageForLog(message)}`);
            }

            // 检查是否是响应（有 id，没有 method）
            if ('id' in message && message.id !== null && !('method' in message)) {
                this.handleResponse(message as JsonRpcResponse);
                return;
            }

            // 检查是否是请求（有 id 和 method）
            if ('id' in message && message.id !== null && 'method' in message) {
                void this.handleRequest(message as JsonRpcRequest, sourceSocket);
                return;
            }

            // 检查是否是通知（有 method，没有 id）
            if ('method' in message && !('id' in message)) {
                this.handleNotification(message);
                return;
            }

            // 通知渲染进程
            this.options.onMessage?.(message);

        } catch (error) {
            console.error('[WebSocket Server] Failed to parse message:', error);
        }
    }

    /**
     * 处理来自 UXP 的请求
     */
    private async handleRequest(request: JsonRpcRequest, sourceSocket: WebSocket): Promise<void> {
        const { id, method, params } = request;

        // 首先检查是否是 MCP 协议方法
        if (this.isMCPMethod(method)) {
            await this.handleMCPRequest(id, method, params, sourceSocket);
            return;
        }

        // 查找处理器
        const handler = this.requestHandlers.get(method);

        if (handler) {
            try {
                const result = await handler(params);
                this.sendResponse(id, result, sourceSocket);
            } catch (error: any) {
                this.sendErrorResponse(id, -32000, error.message || 'Handler error', sourceSocket);
            }
        } else {
            console.log(`[WebSocket Server] No handler for: ${method}`);
            this.sendErrorResponse(id, -32601, `Method not found: ${method}`, sourceSocket);
        }
    }

    /**
     * 检查是否是 MCP 方法
     */
    private isMCPMethod(method: string): boolean {
        return method === 'initialize' || 
               method.startsWith('tools/') ||
               method.startsWith('resources/') ||
               method.startsWith('prompts/') ||
               method.startsWith('logging/');
    }

    /**
     * 处理 MCP 协议请求
     */
    private async handleMCPRequest(
        id: string | number,
        method: string,
        params: any,
        sourceSocket: WebSocket
    ): Promise<void> {
        console.log(`[WebSocket Server] MCP 请求: ${method}`, params);

        try {
            if (this.pluginSocket !== sourceSocket) {
                throw new Error('UXP 连接已被替换，本次请求不再继续');
            }
            switch (method) {
                case 'initialize':
                    // MCP 初始化请求 - UXP 插件作为 MCP Server
                    const initResult = {
                        protocolVersion: MCP_VERSION,
                        capabilities: AGENT_CAPABILITIES,
                        serverInfo: AGENT_INFO
                    };
                    console.log('[WebSocket Server] MCP 初始化成功');
                    this.sendResponse(id, initResult, sourceSocket);
                    break;

                case 'tools/list':
                    // 转发到 UXP 获取工具列表
                    const tools = await this.forwardMCPRequest(method, params);
                    this.sendResponse(id, tools, sourceSocket);
                    break;

                case 'tools/call':
                    // 转发工具调用到 UXP
                    const toolResult = await this.forwardMCPRequest(method, params);
                    this.sendResponse(id, toolResult, sourceSocket);
                    break;

                case 'resources/list':
                case 'resources/read':
                case 'resources/templates/list':
                    // 转发资源请求到 UXP
                    const resourceResult = await this.forwardMCPRequest(method, params);
                    this.sendResponse(id, resourceResult, sourceSocket);
                    break;

                case 'prompts/list':
                case 'prompts/get':
                    // 转发提示词请求到 UXP
                    const promptResult = await this.forwardMCPRequest(method, params);
                    this.sendResponse(id, promptResult, sourceSocket);
                    break;

                default:
                    this.sendErrorResponse(id, -32601, `Unknown MCP method: ${method}`, sourceSocket);
            }
        } catch (error: any) {
            console.error(`[WebSocket Server] MCP 请求失败:`, error);
            this.sendErrorResponse(id, -32000, error.message || 'MCP request failed', sourceSocket);
        }
    }

    /**
     * 转发 MCP 请求到 UXP 插件
     */
    private async forwardMCPRequest(method: string, params: any, options: SendRequestOptions = {}): Promise<any> {
        if (!this.isPluginConnected()) {
            throw new Error('UXP 插件未连接');
        }

        // 直接发送 MCP 方法，不加 tool. 前缀
        const requestKey = String(options.requestKey || '').trim() || undefined;
        this.assertRequestKeyAvailable(requestKey);
        const id = ++this.requestId;
        const request: JsonRpcRequest = {
            jsonrpc: '2.0',
            id,
            method,
            params
        };

        const mcpTimeoutMs = this.resolveRequestTimeoutMs(method, params, 30000);
        return new Promise((resolve, reject) => {
            const timeoutId = setTimeout(() => {
                const timeoutError = this.buildPluginRequestTimeoutError(method, id, 'MCP request timeout');
                const pending = this.takePendingRequest(id);
                if (this.isAppHeartbeatStale()) {
                    this.closeStalePluginSocket('uxp app heartbeat stale during MCP request timeout');
                }
                pending?.reject(timeoutError);
            }, mcpTimeoutMs);

            this.pendingRequests.set(id, {
                resolve,
                reject,
                timeout: timeoutId,
                method,
                startedAt: Date.now(),
                requestKey
            });
            if (requestKey) {
                this.requestKeyToId.set(requestKey, id);
            }

            try {
                this.pluginSocket!.send(JSON.stringify(request));
                console.log(`[WebSocket Server] MCP 请求已发送: ${method}`);
            } catch (error: any) {
                const pending = this.takePendingRequest(id);
                pending?.reject(new Error(`MCP 发送失败: ${error?.message || error}`));
            }
        });
    }

    /**
     * 发送响应（带错误保护）
     */
    private sendResponse(id: string | number, result: any, targetSocket: WebSocket | null = this.pluginSocket): void {
        if (!targetSocket || targetSocket.readyState !== WebSocket.OPEN) return;

        const response: JsonRpcResponse = {
            jsonrpc: '2.0',
            id,
            result
        };

        try {
            targetSocket.send(JSON.stringify(response));
            console.log(`[WebSocket Server] Response sent for id: ${id}`);
        } catch (e: any) {
            console.warn(`[WebSocket Server] 发送响应失败: ${e.message}`);
        }
    }

    /**
     * 发送错误响应（带错误保护）
     */
    private sendErrorResponse(
        id: string | number,
        code: number,
        message: string,
        targetSocket: WebSocket | null = this.pluginSocket
    ): void {
        if (!targetSocket || targetSocket.readyState !== WebSocket.OPEN) return;

        const response: JsonRpcResponse = {
            jsonrpc: '2.0',
            id,
            error: { code, message }
        };

        try {
            targetSocket.send(JSON.stringify(response));
            console.log(`[WebSocket Server] Error response sent for id: ${id}`);
        } catch (e: any) {
            console.warn(`[WebSocket Server] 发送错误响应失败: ${e.message}`);
        }
    }

    /**
     * 处理响应
     */
    private handleResponse(response: JsonRpcResponse): void {
        const pending = this.takePendingRequest(response.id!);
        if (pending) {
            if (response.error) {
                pending.reject(new Error(response.error.message));
            } else {
                pending.resolve(response.result);
            }
        }
    }

    /**
     * 处理通知
     */
    private handleNotification(notification: any): void {
        const { method, params } = notification;

        switch (method) {
            case 'plugin.register':
                console.log('[WebSocket Server] Plugin registered:', params);
                // 发送确认
                this.sendNotification('agent.ready', AGENT_INFO);
                break;

            case 'initialized':
                // MCP initialized 通知
                console.log('[WebSocket Server] MCP 初始化完成 (from UXP)');
                this.sendNotification('agent.ready', AGENT_INFO);
                break;

            case 'plugin.log':
                // 处理来自 UXP 的日志（心跳消息由 LogService 过滤）
                this.handlePluginLog(params as LogEntry);
                break;

            case 'ping':
                this.lastPingReceivedAt = Date.now();
                // 静默响应 ping，不记录日志
                this.sendNotification('pong', { timestamp: Date.now() });
                break;

            case 'notifications/cancelled':
                // MCP 取消通知
                console.log('[WebSocket Server] 请求已取消:', params);
                break;

            default:
                // 检查是否有已注册的处理器
                const handler = this.requestHandlers.get(method);
                if (handler) {
                    console.log(`[WebSocket Server] 处理通知: ${method}`);
                    handler(params).catch((error: Error) => {
                        console.error(`[WebSocket Server] 通知处理器错误 (${method}):`, error);
                    });
                } else {
                    console.log(`[WebSocket Server] Unknown notification: ${method}`);
                    this.options.onMessage?.(notification);
                }
        }
    }

    /**
     * 处理来自 UXP 插件的日志
     */
    private handlePluginLog(entry: LogEntry): void {
        const logService = getLogService();
        logService.logFromUXP(entry);
    }

    // ==================== MCP 便捷方法 ====================

    /**
     * 获取 UXP MCP 服务器的工具列表
     */
    async getMCPTools(): Promise<any> {
        return this.forwardMCPRequest('tools/list', {});
    }

    /**
     * 调用 UXP MCP 工具
     */
    async callMCPTool(name: string, args: any = {}, options: SendRequestOptions = {}): Promise<any> {
        return this.forwardMCPRequest('tools/call', { name, arguments: args }, options);
    }

    /**
     * 获取 UXP MCP 资源列表
     */
    async getMCPResources(): Promise<any> {
        return this.forwardMCPRequest('resources/list', {});
    }

    /**
     * 读取 UXP MCP 资源
     */
    async readMCPResource(uri: string): Promise<any> {
        return this.forwardMCPRequest('resources/read', { uri });
    }

    /**
     * 获取 UXP MCP 提示词列表
     */
    async getMCPPrompts(): Promise<any> {
        return this.forwardMCPRequest('prompts/list', {});
    }

    /**
     * 获取 UXP MCP 提示词内容
     */
    async getMCPPrompt(name: string, args: Record<string, string> = {}): Promise<any> {
        return this.forwardMCPRequest('prompts/get', { name, arguments: args });
    }
}
