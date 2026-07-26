/**
 * 浏览器扩展桥服务（Browser Extension Bridge）
 *
 * WebSocket 服务端：DesignEcho 浏览器扩展（Chrome/Edge MV3）作为客户端连入，
 * Agent 的浏览器工具（listBrowserTabs / readBrowserPage / captureBrowserTab /
 * navigateBrowserTab / interactWithBrowserPage）经此桥转发到扩展执行。
 *
 * 协议与安全边界见 docs/browser-extension-bridge.md：
 * - 只绑 127.0.0.1；升级握手强制 Origin 以 chrome-extension:// 开头；
 *   可选 DESIGNECHO_BROWSER_BRIDGE_TOKEN 共享 token（hello 握手校验）。
 * - 单客户端：新连接顶掉旧连接（与 UXP 桥同构，close code 4000）。
 * - 请求-响应用自增 id 关联，分方法超时；扩展侧每 20s 应用层 ping，
 *   桥侧 75s 无消息判定失活并关闭连接。
 */

import { WebSocketServer as WSServer, WebSocket } from 'ws';
import type { IncomingMessage } from 'http';

const BRIDGE_PATH = '/designecho-browser';
/** 扩展侧心跳间隔 20s，3 个周期 + 余量无任何消息则判定失活 */
const STALE_CONNECTION_MS = 75_000;
const STALE_CHECK_INTERVAL_MS = 30_000;
/** EADDRINUSE 重试（仿 UXP 桥 server.ts 的启动重试策略） */
const LISTEN_RETRY_ATTEMPTS = 3;
const LISTEN_RETRY_DELAY_MS = 1_000;

const DEFAULT_REQUEST_TIMEOUT_MS = 25_000;
/** 含导航等待（扩展侧 45s 加载超时）的方法给更长的桥侧超时 */
const METHOD_TIMEOUT_MS: Record<string, number> = {
    'browser.readPage': 60_000,
    'browser.navigate': 60_000,
    'browser.capture': 30_000,
    'browser.interact': 30_000,
    'browser.listTabs': 15_000
};

interface PendingRequest {
    resolve: (value: any) => void;
    reject: (error: Error) => void;
    timeout: ReturnType<typeof setTimeout>;
    method: string;
    startedAt: number;
}

export interface BrowserBridgeStatus {
    listening: boolean;
    port: number;
    connected: boolean;
    ready: boolean;
    extensionVersion: string | null;
    browserUserAgent: string | null;
    lastConnectedAt: string | null;
    lastDisconnectedAt: string | null;
    lastError: string | null;
    pendingRequestCount: number;
}

export interface BrowserBridgeOptions {
    host: string;
    port: number;
    /** 可选共享 token；设置后扩展 hello 必须携带一致 token */
    token?: string;
    onLog?: (level: 'info' | 'warn' | 'error', message: string) => void;
}

export class BrowserBridgeService {
    private readonly options: BrowserBridgeOptions;
    private wss: WSServer | null = null;
    private socket: WebSocket | null = null;
    private ready = false;
    private requestId = 0;
    private pendingRequests: Map<number, PendingRequest> = new Map();
    private extensionVersion: string | null = null;
    private browserUserAgent: string | null = null;
    private lastActivityAt = 0;
    private lastConnectedAt: string | null = null;
    private lastDisconnectedAt: string | null = null;
    private lastError: string | null = null;
    private staleCheckTimer: ReturnType<typeof setInterval> | null = null;

    constructor(options: BrowserBridgeOptions) {
        this.options = options;
    }

    async start(): Promise<void> {
        for (let attempt = 1; attempt <= LISTEN_RETRY_ATTEMPTS; attempt++) {
            try {
                await this.listenOnce();
                this.staleCheckTimer = setInterval(() => this.closeIfStale(), STALE_CHECK_INTERVAL_MS);
                this.log('info', `[BrowserBridge] 监听 ws://${this.options.host}:${this.options.port}${BRIDGE_PATH}`);
                return;
            } catch (error: any) {
                const isAddrInUse = error?.code === 'EADDRINUSE';
                this.lastError = `启动失败(第${attempt}次): ${error?.message || error}`;
                this.log('warn', `[BrowserBridge] ${this.lastError}`);
                if (!isAddrInUse || attempt === LISTEN_RETRY_ATTEMPTS) {
                    // 桥启动失败不阻塞应用：工具调用时会得到"扩展未连接"的明确错误
                    this.log('error', `[BrowserBridge] 端口 ${this.options.port} 不可用，浏览器工具将不可用。可用 DESIGNECHO_BROWSER_BRIDGE_PORT 换端口。`);
                    return;
                }
                await new Promise((resolve) => setTimeout(resolve, LISTEN_RETRY_DELAY_MS));
            }
        }
    }

    private listenOnce(): Promise<void> {
        return new Promise((resolve, reject) => {
            const wss = new WSServer({
                host: this.options.host,
                port: this.options.port,
                path: BRIDGE_PATH,
                // 升级阶段校验来源：MV3 service worker 的 WebSocket Origin 固定为 chrome-extension://<id>
                verifyClient: (info: { origin: string; req: IncomingMessage }, done: (ok: boolean, code?: number, message?: string) => void) => {
                    const origin = String(info.origin || '');
                    if (!origin.startsWith('chrome-extension://')) {
                        this.log('warn', `[BrowserBridge] 拒绝非扩展来源连接: origin=${origin || '(空)'}`);
                        done(false, 403, 'origin not allowed');
                        return;
                    }
                    done(true);
                }
            });
            const onListenError = (error: Error) => {
                wss.removeAllListeners();
                try { wss.close(); } catch { /* 忽略关闭失败 */ }
                reject(error);
            };
            wss.once('error', onListenError);
            wss.once('listening', () => {
                wss.off('error', onListenError);
                wss.on('error', (error) => {
                    this.lastError = error?.message || String(error);
                    this.log('error', `[BrowserBridge] 服务器错误: ${this.lastError}`);
                });
                wss.on('connection', (socket, req) => this.handleConnection(socket, req));
                this.wss = wss;
                resolve();
            });
        });
    }

    stop(): void {
        if (this.staleCheckTimer) {
            clearInterval(this.staleCheckTimer);
            this.staleCheckTimer = null;
        }
        this.rejectAllPending(new Error('浏览器桥服务已停止'));
        if (this.socket) {
            try { this.socket.close(1001, 'server shutting down'); } catch { /* 忽略关闭失败 */ }
            this.socket = null;
        }
        if (this.wss) {
            try { this.wss.close(); } catch { /* 忽略关闭失败 */ }
            this.wss = null;
        }
        this.ready = false;
    }

    isConnected(): boolean {
        return !!this.socket && this.socket.readyState === WebSocket.OPEN && this.ready;
    }

    getStatus(): BrowserBridgeStatus {
        return {
            listening: !!this.wss,
            port: this.options.port,
            connected: !!this.socket && this.socket.readyState === WebSocket.OPEN,
            ready: this.isConnected(),
            extensionVersion: this.extensionVersion,
            browserUserAgent: this.browserUserAgent,
            lastConnectedAt: this.lastConnectedAt,
            lastDisconnectedAt: this.lastDisconnectedAt,
            lastError: this.lastError,
            pendingRequestCount: this.pendingRequests.size
        };
    }

    /**
     * 向扩展发起请求。扩展未连接/超时/扩展报错都会 reject，
     * 错误信息面向 Agent 循环（中文、可指路）。
     */
    call(method: string, params: any = {}): Promise<any> {
        if (!this.isConnected()) {
            return Promise.reject(new Error(
                '浏览器扩展未连接：请确认已在 Chrome/Edge 安装并启用「DesignEcho 浏览器助手」扩展'
                + '（chrome://extensions → 开发者模式 → 加载已解压的扩展程序 → 选择 DesignEcho-Browser-Extension 目录），'
                + `且扩展弹窗里的端口与桥一致（当前 ${this.options.port}）。`
            ));
        }
        const id = ++this.requestId;
        const timeoutMs = METHOD_TIMEOUT_MS[method] || DEFAULT_REQUEST_TIMEOUT_MS;
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                this.pendingRequests.delete(id);
                reject(new Error(`浏览器扩展响应超时（${method}，${timeoutMs / 1000}s）：页面可能加载过慢或扩展已休眠，可重试一次。`));
            }, timeoutMs);
            this.pendingRequests.set(id, { resolve, reject, timeout, method, startedAt: Date.now() });
            try {
                this.socket!.send(JSON.stringify({ type: 'request', id, method, params }));
            } catch (error: any) {
                clearTimeout(timeout);
                this.pendingRequests.delete(id);
                reject(new Error(`向浏览器扩展发送请求失败（${method}）: ${error?.message || error}`));
            }
        });
    }

    private handleConnection(socket: WebSocket, req: IncomingMessage): void {
        // 单客户端：新连接顶掉旧连接（与 UXP 桥同构）
        if (this.socket && this.socket.readyState === WebSocket.OPEN) {
            this.log('info', '[BrowserBridge] 新扩展连接到达，替换旧连接');
            // 旧连接上的在途请求立即失败（旧 socket 的 close 回调会因 this.socket 已换而提前返回，
            // 不再清理 pending）——否则这些请求要挂到各自超时才 reject，Agent 白等最长 60s。
            this.rejectAllPending(new Error('浏览器扩展连接被新连接替换，请重试。'));
            try { this.socket.close(4000, 'replaced by new connection'); } catch { /* 忽略关闭失败 */ }
        }
        this.socket = socket;
        this.ready = false;
        this.lastActivityAt = Date.now();
        this.lastConnectedAt = new Date().toISOString();
        this.log('info', `[BrowserBridge] 扩展已连接 (origin=${req.headers.origin || '未知'})，等待 hello 握手`);

        socket.on('message', (data) => {
            this.lastActivityAt = Date.now();
            let message: any;
            try {
                message = JSON.parse(String(data));
            } catch {
                this.log('warn', '[BrowserBridge] 收到无法解析的消息，已忽略');
                return;
            }
            this.handleMessage(socket, message);
        });

        socket.on('close', (code, reason) => {
            if (this.socket !== socket) return; // 已被新连接替换
            this.socket = null;
            this.ready = false;
            this.lastDisconnectedAt = new Date().toISOString();
            this.rejectAllPending(new Error('浏览器扩展连接已断开（扩展休眠或浏览器关闭），请重试；扩展会自动重连。'));
            this.log('info', `[BrowserBridge] 扩展连接断开 (code=${code} reason=${String(reason || '')})`);
        });

        socket.on('error', (error) => {
            this.lastError = error?.message || String(error);
            this.log('warn', `[BrowserBridge] 连接错误: ${this.lastError}`);
        });
    }

    private handleMessage(socket: WebSocket, message: any): void {
        // 只处理当前 socket 的消息：并发连接顶替时，旧连接队列里迟到的 hello/response
        // 不能污染就绪状态或错认响应（this.socket 此刻已是新连接）。
        if (socket !== this.socket) return;
        const type = String(message?.type || '');
        if (type === 'hello') {
            const expectedToken = String(this.options.token || '');
            const gotToken = String(message?.token || '');
            if (expectedToken && gotToken !== expectedToken) {
                this.log('warn', '[BrowserBridge] hello token 不匹配，拒绝连接');
                try { socket.close(4401, 'token mismatch'); } catch { /* 忽略关闭失败 */ }
                return;
            }
            this.ready = true;
            this.extensionVersion = String(message?.extensionVersion || '') || null;
            this.browserUserAgent = String(message?.userAgent || '') || null;
            try { socket.send(JSON.stringify({ type: 'hello_ack', agent: 'DesignEcho-Agent' })); } catch { /* 发送失败由 close 兜底 */ }
            this.log('info', `[BrowserBridge] 握手完成 (extension v${this.extensionVersion || '?'})`);
            return;
        }
        if (type === 'ping') {
            try { socket.send(JSON.stringify({ type: 'pong', ts: message?.ts })); } catch { /* 忽略 */ }
            return;
        }
        if (type === 'response') {
            const id = Number(message?.id);
            const pending = this.pendingRequests.get(id);
            if (!pending) {
                this.log('warn', `[BrowserBridge] 收到未知/已超时请求的响应 (id=${id})`);
                return;
            }
            clearTimeout(pending.timeout);
            this.pendingRequests.delete(id);
            if (message?.ok) {
                pending.resolve(message?.result);
            } else {
                const detail = String(message?.error?.message || '扩展未说明原因');
                pending.reject(new Error(`浏览器扩展执行 ${pending.method} 失败: ${detail}`));
            }
            return;
        }
        this.log('warn', `[BrowserBridge] 收到未知类型消息: ${type || '(空)'}`);
    }

    private closeIfStale(): void {
        if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
        if (Date.now() - this.lastActivityAt <= STALE_CONNECTION_MS) return;
        this.log('warn', `[BrowserBridge] 连接超过 ${STALE_CONNECTION_MS / 1000}s 无消息，判定失活并关闭（扩展会自动重连）`);
        try { this.socket.close(4002, 'stale connection'); } catch { /* 忽略关闭失败 */ }
    }

    private rejectAllPending(error: Error): void {
        for (const pending of this.pendingRequests.values()) {
            clearTimeout(pending.timeout);
            pending.reject(error);
        }
        this.pendingRequests.clear();
    }

    private log(level: 'info' | 'warn' | 'error', message: string): void {
        if (this.options.onLog) {
            this.options.onLog(level, message);
        } else {
            console.log(message);
        }
    }
}

/** 模块级单例（仿 web-page-handlers 直接 import 服务的模式，避免扩 IPCContext） */
let browserBridgeService: BrowserBridgeService | null = null;

export function initBrowserBridgeService(options: BrowserBridgeOptions): BrowserBridgeService {
    if (browserBridgeService) {
        browserBridgeService.stop();
    }
    browserBridgeService = new BrowserBridgeService(options);
    return browserBridgeService;
}

export function getBrowserBridgeService(): BrowserBridgeService | null {
    return browserBridgeService;
}
