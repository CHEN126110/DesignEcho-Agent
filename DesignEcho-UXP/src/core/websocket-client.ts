/**
 * WebSocket 客户端
 *
 * 负责与 DesignEcho Agent 的通信
 * 使用 JSON-RPC 2.0 协议 + 二进制传输
 *
 * 二进制传输优化：
 * - 图像数据使用二进制帧传输，避免 Base64 膨胀
 * - 参考 sd-ppp 设计，使用 Uint8Array 直传
 */

import { MessageHandler } from './message-handler';
import { LogEntry, logger, setLogCallback } from './logger';
import {
    BinaryMessageType,
    BinaryHeader,
    BINARY_HEADER_SIZE,
    createBinaryMessage,
    parseBinaryMessage,
    isBinaryMessage,
    getBinaryTypeName
} from './binary-protocol';

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

interface JsonRpcNotification {
    jsonrpc: '2.0';
    method: string;
    params?: any;
}

type PendingRequest = {
    resolve: (value: any) => void;
    reject: (error: Error) => void;
    timeout: ReturnType<typeof setTimeout>;
};

/** 二进制请求待处理项 */
type PendingBinaryRequest = {
    resolve: (data: { header: BinaryHeader; imageData: Uint8Array }) => void;
    reject: (error: Error) => void;
    timeout: ReturnType<typeof setTimeout>;
};

/** 二进制消息回调 */
type BinaryMessageCallback = (header: BinaryHeader, imageData: Uint8Array) => void;

export class WebSocketClient {
    private ws: WebSocket | null = null;
    private url: string;
    private messageHandler: MessageHandler;
    private pendingRequests: Map<string | number, PendingRequest> = new Map();
    private pendingBinaryRequests: Map<number, PendingBinaryRequest> = new Map();  // 二进制请求
    private binaryMessageCallback: BinaryMessageCallback | null = null;  // 二进制消息回调
    private requestId: number = 0;
    private binaryRequestIdCounter: number = (Date.now() & 0xffffff);
    private reconnectAttempts: number = 0;
    private reconnectDelay: number = 2000;  // 2 秒基础延迟
    private maxReconnectDelay: number = 15000;
    private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
    private isManuallyDisconnected: boolean = false;  // 标记是否是手动断开
    private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    private lastPongTime: number = 0;  // 上次收到 pong 的时间
    private heartbeatCheckInterval: ReturnType<typeof setInterval> | null = null;  // 心跳检测定时器
    private connectionStable: boolean = false;  // 连接是否稳定
    private onDisconnectCallback: (() => void) | null = null;  // 断开连接回调
    private onConnectCallback: (() => void) | null = null;  // 连接成功回调
    private connectPromise: Promise<void> | null = null;
    private didNotifyDisconnect: boolean = false;

    constructor(url: string, messageHandler: MessageHandler) {
        this.url = url;
        this.messageHandler = messageHandler;
    }

    /**
     * 设置二进制消息回调（用于接收 Agent 返回的蒙版等）
     */
    setBinaryMessageCallback(callback: BinaryMessageCallback): void {
        this.binaryMessageCallback = callback;
    }

    /**
     * 设置连接状态回调
     */
    setConnectionCallbacks(onConnect: () => void, onDisconnect: () => void): void {
        this.onConnectCallback = onConnect;
        this.onDisconnectCallback = onDisconnect;
    }

    /**
     * 连接到 WebSocket 服务器
     */
    async connect(): Promise<void> {
        // 如果已经连接，直接返回
        if (this.isConnected()) {
            console.log('[WebSocket] Already connected');
            return Promise.resolve();
        }

        if (this.connectPromise) {
            console.log('[WebSocket] Connection already in progress');
            return this.connectPromise;
        }

        // 取消待处理的重连
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }

        this.isManuallyDisconnected = false;

        this.connectPromise = new Promise((resolve, reject) => {
            let settled = false;

            const resolveOnce = () => {
                if (settled) return;
                settled = true;
                this.connectPromise = null;
                resolve();
            };

            const rejectOnce = (error: Error) => {
                if (settled) return;
                settled = true;
                this.connectPromise = null;
                reject(error);
            };

            try {
                console.log(`[WebSocket] Connecting to ${this.url}...`);

                // 清理旧的 WebSocket
                if (this.ws) {
                    this.ws.onclose = null;  // 防止触发 handleDisconnect
                    this.ws.onerror = null;
                    this.ws.onmessage = null;
                    this.ws.onopen = null;
                    if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
                        this.ws.close();
                    }
                    this.ws = null;
                }

                this.ws = new WebSocket(this.url);

                // 设置二进制类型为 arraybuffer（用于高效图像传输）
                this.ws.binaryType = 'arraybuffer';

                this.ws.onopen = async () => {
                    console.log('[WebSocket] Connected');
                    this.reconnectAttempts = 0;
                    this.didNotifyDisconnect = false;
                    this.startHeartbeat();

                    // 触发连接成功回调
                    if (this.onConnectCallback) {
                        this.onConnectCallback();
                    }

                    // 设置 pong 回调，用于更新心跳时间
                    this.messageHandler.setOnPongCallback(() => {
                        this.updateLastPong();
                    });

                    // 启用日志转发到 Agent
                    this.enableLogForwarding();

                    // MCP 初始化流程
                    try {
                        // 发送 MCP initialize 请求
                        const initResult = await this.sendRequest('initialize', {
                            protocolVersion: '2024-11-05',
                            capabilities: {
                                roots: { listChanged: true }
                            },
                            clientInfo: {
                                name: 'DesignEcho-UXP',
                                version: '1.0.0'
                            }
                        });
                        console.log('[WebSocket] MCP 初始化响应:', initResult);

                        // 发送 initialized 通知
                        this.sendNotification('initialized', {});
                        console.log('[WebSocket] MCP 初始化完成');
                    } catch (e) {
                        // 如果 Agent 不支持 MCP，回退到旧协议
                        console.log('[WebSocket] MCP 初始化失败，使用旧协议:', e);
                        this.sendNotification('plugin.register', {
                            name: 'DesignEcho-UXP',
                            version: '1.0.0',
                            capabilities: ['text', 'layout', 'canvas', 'logging', 'mcp']
                        });
                    }

                    resolveOnce();
                };

                this.ws.onclose = (event) => {
                    console.log(`[WebSocket] Closed: ${event.code} ${event.reason}`);
                    this.stopHeartbeat();
                    this.handleDisconnect();
                    rejectOnce(new Error(`WebSocket closed before ready: ${event.code} ${event.reason || ''}`.trim()));
                };

                this.ws.onerror = (error) => {
                    console.error('[WebSocket] Error:', error);
                    this.forceReconnect('socket-error');
                    rejectOnce(new Error('WebSocket 连接失败'));
                };

                this.ws.onmessage = (event) => {
                    // 区分二进制和文本消息
                    if (event.data instanceof ArrayBuffer) {
                        this.handleBinaryMessage(event.data);
                    } else {
                        this.handleMessage(event.data);
                    }
                };

            } catch (error) {
                console.error('[WebSocket] Connection error:', error);
                this.connectPromise = null;
                this.scheduleReconnect('connect-exception');
                reject(error);
            }
        });

        return this.connectPromise;
    }

    /**
     * 断开连接
     */
    disconnect(): void {
        console.log('[WebSocket] Disconnecting...');
        this.isManuallyDisconnected = true;  // 标记为手动断开，防止自动重连

        // 取消待处理的重连
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }

        this.stopHeartbeat();
        this.connectPromise = null;
        this.connectionStable = false;

        if (this.ws) {
            this.ws.onclose = null;  // 防止触发 handleDisconnect
            this.ws.close(1000, 'Plugin closing');
            this.ws = null;
        }

        this.pendingRequests.forEach((pending) => {
            clearTimeout(pending.timeout);
            pending.reject(new Error('连接已断开'));
        });
        this.pendingRequests.clear();

        this.reconnectAttempts = 0;
        this.didNotifyDisconnect = false;
    }

    /**
     * 检查是否已连接
     */
    isConnected(): boolean {
        return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
    }

    private summarizePayloadForLog(value: any, depth = 0): string {
        if (value === null) return 'null';
        if (value === undefined) return 'undefined';
        if (typeof value === 'string') return `string(${value.length})`;
        if (typeof value === 'number' || typeof value === 'boolean') return String(value);
        if (typeof value === 'bigint') return `bigint(${value.toString()})`;
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
            ? ` params=${this.summarizePayloadForLog(message.params)}`
            : '';
        const resultPart = Object.prototype.hasOwnProperty.call(message, 'result')
            ? ` result=${this.summarizePayloadForLog(message.result)}`
            : '';
        const errorPart = Object.prototype.hasOwnProperty.call(message, 'error')
            ? ` error=${this.summarizePayloadForLog(message.error)}`
            : '';
        return `${kind}${idPart}${methodPart}${paramsPart}${resultPart}${errorPart}`;
    }

    /**
     * 发送请求并等待响应
     */
    async sendRequest(method: string, params?: any, timeout: number = 30000): Promise<any> {
        if (!this.isConnected()) {
            throw new Error('WebSocket 未连接');
        }

        const id = ++this.requestId;
        const request: JsonRpcRequest = {
            jsonrpc: '2.0',
            id,
            method,
            params
        };

        return new Promise((resolve, reject) => {
            const timeoutId = setTimeout(() => {
                this.pendingRequests.delete(id);
                reject(new Error(`请求超时: ${method}`));
            }, timeout);

            this.pendingRequests.set(id, {
                resolve,
                reject,
                timeout: timeoutId
            });

            this.ws!.send(JSON.stringify(request));
            console.log(`[WebSocket] Request sent: ${method}, payload=${this.summarizePayloadForLog(params)}`);
        });
    }

    /**
     * 发送通知 (不需要响应)
     */
    sendNotification(method: string, params?: any): void {
        if (!this.isConnected()) {
            console.warn('[WebSocket] Cannot send notification: not connected');
            return;
        }

        const notification: JsonRpcNotification = {
            jsonrpc: '2.0',
            method,
            params
        };

        this.ws!.send(JSON.stringify(notification));
        console.log(`[WebSocket] Notification sent: ${method}`);
    }

    // ==================== 二进制传输方法 ====================

    /**
     * 分配一个 binary requestId（独立于 RPC requestId 序列），用于在 binary 帧和后续 JSON 请求间做关联
     *
     * 使用范围：UXP 端单向把 raw RGBA 等二进制载荷发给 Agent，再用 sendRequest 发 JSON 请求时
     * 把这个 id 放进 params，Agent 端从 binaryImageStore 中按 id 取回 buffer。
     */
    allocBinaryRequestId(): number {
        // uint32 安全范围内自增，溢出后从 1 开始
        this.binaryRequestIdCounter = (this.binaryRequestIdCounter + 1) >>> 0;
        if (this.binaryRequestIdCounter === 0) {
            this.binaryRequestIdCounter = 1;
        }
        return this.binaryRequestIdCounter;
    }

    /**
     * 发送二进制图像数据
     *
     * @param type 消息类型（JPEG/PNG/RAW_MASK 等）
     * @param requestId 关联的请求 ID（用于匹配响应）
     * @param width 图像宽度
     * @param height 图像高度
     * @param imageData 图像数据（Uint8Array）
     */
    sendBinaryData(
        type: BinaryMessageType,
        requestId: number,
        width: number,
        height: number,
        imageData: Uint8Array
    ): void {
        if (!this.isConnected()) {
            console.warn('[WebSocket] Cannot send binary: not connected');
            return;
        }

        const message = createBinaryMessage(type, requestId, width, height, imageData);

        // 直接发送 ArrayBuffer
        this.ws!.send(message.buffer);

        console.log(`[WebSocket] 二进制发送: ${getBinaryTypeName(type)}, ` +
            `requestId=${requestId}, ${width}x${height}, ` +
            `${(imageData.length / 1024).toFixed(1)}KB`);
    }

    /**
     * 发送图像并等待响应（用于抠图等需要返回的场景）
     *
     * @param type 消息类型
     * @param width 图像宽度
     * @param height 图像高度
     * @param imageData 图像数据
     * @param timeout 超时时间（毫秒）
     * @returns 返回的图像数据
     */
    async sendBinaryRequest(
        type: BinaryMessageType,
        width: number,
        height: number,
        imageData: Uint8Array,
        timeout: number = 120000  // 2分钟超时（抠图可能较慢）
    ): Promise<{ header: BinaryHeader; imageData: Uint8Array }> {
        if (!this.isConnected()) {
            throw new Error('WebSocket 未连接');
        }

        const requestId = ++this.requestId;

        return new Promise((resolve, reject) => {
            const timeoutId = setTimeout(() => {
                this.pendingBinaryRequests.delete(requestId);
                reject(new Error(`二进制请求超时: ${getBinaryTypeName(type)}`));
            }, timeout);

            this.pendingBinaryRequests.set(requestId, {
                resolve,
                reject,
                timeout: timeoutId
            });

            this.sendBinaryData(type, requestId, width, height, imageData);
        });
    }

    /**
     * 处理收到的二进制消息
     */
    private handleBinaryMessage(data: ArrayBuffer): void {
        // 重要：必须立即复制 ArrayBuffer，因为 WebSocket 可能会重用底层缓冲区
        // 这是导致蒙版数据变成全 0 的根本原因
        const dataCopy = data.slice(0);
        const uint8Data = new Uint8Array(dataCopy);

        console.log(`[WebSocket] 收到二进制消息: ${(dataCopy.byteLength / 1024).toFixed(1)}KB`);

        // 验证是否为有效的二进制协议消息
        if (!isBinaryMessage(uint8Data)) {
            console.warn('[WebSocket] 收到未知二进制消息格式');
            return;
        }

        // 解析消息
        const { header, imageData } = parseBinaryMessage(uint8Data);

        console.log(`[WebSocket] 二进制消息: ${getBinaryTypeName(header.type)}, ` +
            `requestId=${header.requestId}, ${header.width}x${header.height}, ` +
            `数据: ${(imageData.length / 1024).toFixed(1)}KB`);

        // 检查是否有等待的请求
        const pending = this.pendingBinaryRequests.get(header.requestId);
        if (pending) {
            clearTimeout(pending.timeout);
            this.pendingBinaryRequests.delete(header.requestId);
            pending.resolve({ header, imageData });
            return;
        }

        // 如果没有匹配的请求，调用通用回调
        if (this.binaryMessageCallback) {
            this.binaryMessageCallback(header, imageData);
        }
    }

    /**
     * 处理收到的消息
     */
    private async handleMessage(data: string): Promise<void> {
        // 诊断日志：记录消息大小
        const dataSize = data?.length || 0;
        console.log(`[WebSocket] 收到消息, 大小: ${(dataSize / 1024).toFixed(1)}KB`);

        try {
            // 对于大消息，先尝试解析
            if (dataSize > 100 * 1024) {
                console.log(`[WebSocket] 解析大消息中... (${(dataSize / 1024 / 1024).toFixed(2)}MB)`);
            }

            const message = JSON.parse(data);
            console.log(`[WebSocket] Message received: ${this.summarizeRpcMessageForLog(message)}`);

            // 先检查是否是请求 (有 id 和 method - 来自 Agent 的工具调用)
            if ('id' in message && message.id !== null && 'method' in message) {
                await this.handleRequest(message as JsonRpcRequest);
                return;
            }

            // 检查是否是响应 (有 id 但没有 method)
            if ('id' in message && message.id !== null && !('method' in message)) {
                this.handleResponse(message as JsonRpcResponse);
                return;
            }

            // 检查是否是通知 (有 method 但没有 id)
            if ('method' in message && !('id' in message)) {
                this.handleNotification(message as JsonRpcNotification);
                return;
            }

        } catch (error) {
            console.error('[WebSocket] Failed to parse message:', error);
            console.error('[WebSocket] 消息前 500 字符:', data?.substring(0, 500));
        }
    }

    /**
     * 处理响应
     */
    private handleResponse(response: JsonRpcResponse): void {
        const pending = this.pendingRequests.get(response.id!);
        if (pending) {
            clearTimeout(pending.timeout);
            this.pendingRequests.delete(response.id!);

            if (response.error) {
                pending.reject(new Error(response.error.message));
            } else {
                pending.resolve(response.result);
            }
        }
    }

    /**
     * 处理来自 Agent 的请求 (工具调用)
     */
    private async handleRequest(request: JsonRpcRequest): Promise<void> {
        try {
            const result = await this.messageHandler.handleToolCall(
                request.method,
                request.params,
                request.id
            );

            const response: JsonRpcResponse = {
                jsonrpc: '2.0',
                id: request.id,
                result
            };

            this.ws!.send(JSON.stringify(response));

        } catch (error) {
            const response: JsonRpcResponse = {
                jsonrpc: '2.0',
                id: request.id,
                error: {
                    code: -32000,
                    message: error instanceof Error ? error.message : 'Unknown error'
                }
            };

            this.ws!.send(JSON.stringify(response));
        }
    }

    /**
     * 处理通知
     */
    private handleNotification(notification: JsonRpcNotification): void {
        this.messageHandler.handleNotification(
            notification.method,
            notification.params
        );
    }

    /**
     * 处理断开连接
     */
    private handleDisconnect(): void {
        this.connectionStable = false;
        this.connectPromise = null;

        // 拒绝所有待处理的请求
        this.pendingRequests.forEach((pending) => {
            clearTimeout(pending.timeout);
            pending.reject(new Error('连接已断开'));
        });
        this.pendingRequests.clear();

        // 触发断开连接回调
        if (this.onDisconnectCallback && !this.didNotifyDisconnect) {
            this.didNotifyDisconnect = true;
            this.onDisconnectCallback();
        }

        // 如果是手动断开，不自动重连
        if (this.isManuallyDisconnected) {
            console.log('[WebSocket] Manually disconnected, not reconnecting');
            return;
        }

        this.scheduleReconnect('disconnect');
    }

    private scheduleReconnect(reason: string): void {
        if (this.isManuallyDisconnected) return;
        if (this.reconnectTimer) return;
        if (this.isConnected() || this.connectPromise) return;

        this.reconnectAttempts++;
        const delay = Math.min(this.reconnectDelay * this.reconnectAttempts, this.maxReconnectDelay);
        console.log(`[WebSocket] Will reconnect in ${delay}ms... (attempt ${this.reconnectAttempts}, reason: ${reason})`);

        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            this.connect().catch((error) => {
                console.error('[WebSocket] Reconnect failed:', error);
            });
        }, delay);
    }

    private forceReconnect(reason: string): void {
        if (this.isManuallyDisconnected) return;

        console.warn(`[WebSocket] Force reconnect: ${reason}`);
        this.stopHeartbeat();

        if (this.ws) {
            const oldSocket = this.ws;
            this.ws = null;
            oldSocket.onclose = null;
            oldSocket.onerror = null;
            oldSocket.onmessage = null;
            oldSocket.onopen = null;
            try {
                oldSocket.close();
            } catch (error) {
                console.warn('[WebSocket] Failed to close stale socket:', error);
            }
        }

        this.handleDisconnect();
    }

    /**
     * 开始心跳检测
     */
    private startHeartbeat(): void {
        this.stopHeartbeat();
        this.lastPongTime = Date.now();
        this.connectionStable = true;

        // 发送心跳包（每 30 秒）- 参考 sd-ppp 的 60s ping_interval，适中选择
        // 过于频繁的心跳会增加开销，尤其是大数据传输期间
        this.heartbeatInterval = setInterval(() => {
            if (this.isConnected()) {
                this.sendNotification('ping', { timestamp: Date.now() });
            }
        }, 30000);

        // 检测心跳超时（每 60 秒检查一次）
        // 参考 sd-ppp: ping_timeout=50s，但大图传输需要更长时间
        // 超时阈值设为 90 秒标记不稳定，180 秒触发重连
        this.heartbeatCheckInterval = setInterval(() => {
            const now = Date.now();
            const timeSinceLastPong = now - this.lastPongTime;

            // 如果超过 90 秒没收到 pong，标记连接不稳定
            if (timeSinceLastPong > 90000 && this.isConnected()) {
                console.warn('[WebSocket] 心跳超时 90s，连接可能不稳定');
                this.connectionStable = false;

                // 超过 180 秒才主动重连（给大数据传输足够时间）
                if (timeSinceLastPong > 180000) {
                    console.log('[WebSocket] 心跳超时 180s，主动重连');
                    this.forceReconnect('heartbeat-timeout');
                }
            }
        }, 60000);
    }

    /**
     * 更新最后收到 pong 的时间
     */
    updateLastPong(): void {
        this.lastPongTime = Date.now();
        this.connectionStable = true;
    }

    /**
     * 检查连接是否稳定
     */
    isConnectionStable(): boolean {
        return this.connectionStable && this.isConnected();
    }

    /**
     * 停止心跳检测
     */
    private stopHeartbeat(): void {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }
        if (this.heartbeatCheckInterval) {
            clearInterval(this.heartbeatCheckInterval);
            this.heartbeatCheckInterval = null;
        }
    }

    /**
     * 启用日志转发到 Agent
     */
    private enableLogForwarding(): void {
        // 启用日志收集器
        logger.enable();

        // 设置回调，将日志发送到 Agent
        setLogCallback((entry: LogEntry) => {
            // 避免发送 WebSocket 相关的日志，防止死循环
            if (entry.message.includes('[WebSocket]')) {
                return;
            }

            // 通过 WebSocket 发送日志
            if (this.isConnected()) {
                this.sendNotification('plugin.log', entry);
            }
        });
    }

    /**
     * 手动发送日志到 Agent（用于关键调试信息）
     */
    sendLog(level: 'debug' | 'info' | 'warn' | 'error', message: string, data?: any): void {
        const entry: LogEntry = {
            timestamp: new Date().toISOString(),
            level,
            message,
            data,
            source: 'UXP'
        };

        if (this.isConnected()) {
            this.sendNotification('plugin.log', entry);
        }
    }
}
