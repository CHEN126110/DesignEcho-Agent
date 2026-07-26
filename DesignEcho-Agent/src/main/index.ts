/**
 * DesignEcho Agent - 主进程入口（Electron Main Process）
 * 
 * 职责说明：
 * - 负责启动 Electron 应用、初始化所有后端服务并注册 IPC 通道。
 *   源码在 src/main/index.ts，打包后对应 dist/main/main/index.js。
 * - 所有 IPC handler 的注册逻辑已拆分为独立模块，不再在本文件中直接注册。
 * 
 * 主要模块划分：
 * 1. IPC handlers 已拆分到 ipc-handlers/ 目录下按功能独立注册
 * 2. UXP handlers 已拆分到 uxp-handlers/ 目录下按功能独立注册
 * 3. 服务初始化在 initializeServices() 中集中完成，各服务有独立类定义
 * 4. 窗口管理、生命周期管理、端口清理等辅助逻辑保留在本文件
 */

import { app, BrowserWindow, ipcMain, type IpcMainEvent } from 'electron';
import path from 'path';
import fs from 'fs';
import http from 'http';
import { execSync } from 'child_process';

// 服务模块导入
import { WebSocketServer } from './websocket/server';
import { ModelService } from './services/model-service';
import { TaskOrchestrator } from './services/task-orchestrator';
import { getLogService, LogService } from './services/log-service';
import { MattingService } from './services/matting-service';
import { ResourceManagerService } from './services/resource-manager-service';
import { InpaintingService } from './services/inpainting-service';
import { bflService } from './services/bfl-service';
import { volcengineJimengInpaintingService } from './services/volcengine-jimeng-inpainting-service';
import { volcengineJimengImageService } from './services/volcengine-jimeng-image-service';
import { volcengineSeedreamService } from './services/volcengine-seedream-service';
import { volcengineTosUploadService } from './services/volcengine-tos-upload-service';
import { gptsapiGeminiImageService } from './services/gptsapi-gemini-image-service';
import { openRouterGeminiImageService } from './services/openrouter-gemini-image-service';
import { getSubjectDetectionService, SubjectDetectionService } from './services/subject-detection-service';
import { ContourService } from './services/contour-service';
import { getSAMService, SAMService } from './services/sam-service';
import { DebugBridgeService, type DebugBridgeChatSubmitInput } from './services/debug-bridge-service';
import { MCPHostService } from './services/mcp-host-service';
import { BrowserBridgeService, initBrowserBridgeService } from './services/browser-bridge-service';
import {
    BROWSER_BRIDGE_PORT,
    DEBUG_BRIDGE_PORT,
    MCP_HOST_PORT,
    WEBVIEW_BIND_HOST,
    WEBVIEW_SERVER_PORT,
    WS_PORT
} from './config/network-ports';

// 导入拆分后的 handlers 注册器
import { setupIPCHandlers, IPCContext } from './ipc-handlers';
import { registerUXPHandlers, UXPContext } from './uxp-handlers';
import { cleanupStreams } from './ipc-handlers/stream-handlers';
import { BinaryMessageType, getBinaryTypeName } from '../shared/binary-protocol';

// ============ 全局变量 ============

function applyRemoteDebuggingPortFromEnv(): void {
    const raw = process.env.DESIGNECHO_REMOTE_DEBUGGING_PORT?.trim();
    if (!raw) return;

    const port = Number.parseInt(raw, 10);
    if (!Number.isInteger(port) || port < 1024 || port > 65535) {
        throw new Error('DESIGNECHO_REMOTE_DEBUGGING_PORT must be an integer port between 1024 and 65535.');
    }

    app.commandLine.appendSwitch('remote-debugging-port', String(port));
    app.commandLine.appendSwitch('remote-allow-origins', `http://127.0.0.1:${port}`);
    console.log(`[Main] Remote debugging enabled for running-window acceptance. port=${port}`);
}

applyRemoteDebuggingPortFromEnv();

// ============ 单实例锁（防止多开） ============
const testUserDataDir = process.env.DESIGNECHO_TEST_USER_DATA_DIR?.trim();
if (testUserDataDir) {
    const resolvedTestUserDataDir = path.resolve(testUserDataDir);
    fs.mkdirSync(resolvedTestUserDataDir, { recursive: true });
    app.setPath('userData', resolvedTestUserDataDir);
    app.setName('DesignEcho Test');
    console.log(`[Main] Using isolated test userData directory: ${resolvedTestUserDataDir}`);
}

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
    console.log('[Main] Another Agent instance is already running. Exiting current process.');
    app.quit();
    process.exit(0);
}

// ============ 窗口与服务实例声明 ============
let mainWindow: BrowserWindow | null = null;
let wsServer: WebSocketServer | null = null;
let modelService: ModelService | null = null;
let taskOrchestrator: TaskOrchestrator | null = null;
let logService: LogService | null = null;
let mattingService: MattingService | null = null;
let resourceManagerService: ResourceManagerService | null = null;
let inpaintingService: InpaintingService | null = null;
let subjectDetectionService: SubjectDetectionService | null = null;
let contourService: ContourService | null = null;
let samService: SAMService | null = null;
let webviewServer: http.Server | null = null;
let debugBridgeService: DebugBridgeService | null = null;
let mcpHostService: MCPHostService | null = null;
let browserBridgeService: BrowserBridgeService | null = null;
let mainWindowShown = false;

function submitChatToCurrentWindow(input: DebugBridgeChatSubmitInput): Promise<unknown> {
    if (!mainWindow || mainWindow.isDestroyed()) {
        return Promise.reject(new Error('DesignEcho 主窗口不可用，不能提交运行窗口消息。'));
    }

    const requestId = `debug_chat_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const timeoutMs = Math.max(1000, Math.min(Number(input.timeoutMs) || 60000, 300000));

    return new Promise((resolve, reject) => {
        const resultChannel = 'debug-bridge:chat-submit-result';
        const timer = setTimeout(() => {
            cleanup();
            reject(new Error(`运行窗口消息提交超时：${timeoutMs}ms`));
        }, timeoutMs + 5000);

        const cleanup = (): void => {
            clearTimeout(timer);
            ipcMain.removeListener(resultChannel, handleResult);
        };

        const handleResult = (_event: IpcMainEvent, payload: any): void => {
            if (!payload || payload.requestId !== requestId) return;
            cleanup();
            if (payload.success) {
                resolve(payload.result);
            } else {
                reject(new Error(String(payload.error || '运行窗口消息提交失败')));
            }
        };

        ipcMain.on(resultChannel, handleResult);
        mainWindow!.webContents.send('debug-bridge:chat-submit', {
            ...input,
            requestId,
            timeoutMs
        });
    });
}

type PersistedApiKeys = {
    anthropic?: string;
    google?: string;
    xiaomi?: string;
    openai?: string;
    gptsapi?: string;
    openrouter?: string;
    deepseek?: string;
    ollamaUrl?: string;
    ollamaApiKey?: string;
    bfl?: string;
    volcengineJimengAccessKeyId?: string;
    volcengineJimengSecretAccessKey?: string;
    volcengineSeedreamApiKey?: string;
    volcengineTosRegion?: string;
    volcengineTosEndpoint?: string;
    volcengineTosBucket?: string;
    volcengineTosPublicBaseUrl?: string;
    volcengineTosKeyPrefix?: string;
};

// ============ 二进制图像缓存（WebSocket 接收的原始图像数据） ============
const receivedBinaryImages: Map<number, { 
    type: number; 
    width: number; 
    height: number; 
    data: Buffer;
    timestamp: number;
}> = new Map();

// 定期清理过期的二进制图像缓存，避免内存泄漏
setInterval(() => {
    const now = Date.now();
    for (const [id, cache] of receivedBinaryImages) {
        if (now - cache.timestamp > 5 * 60 * 1000) {
            receivedBinaryImages.delete(id);
            console.log(`[Binary Cache] Expired binary image cache removed. requestId=${id}`);
        }
    }
}, 60 * 1000);

/**
 * 释放指定端口上占用的进程（仅 Windows 支持）
 */
function killProcessOnPort(port: number): boolean {
    if (process.env.DESIGNECHO_ALLOW_PORT_CLEANUP !== '1') {
        console.log(`[Main] Port cleanup is disabled by default. Set DESIGNECHO_ALLOW_PORT_CLEANUP=1 to intentionally free port ${port}.`);
        return false;
    }

    if (process.platform !== 'win32') {
        console.log('[Main] Port cleanup is only supported on Windows.');
        return false;
    }
    
    try {
        const result = execSync(`netstat -ano | findstr ":${port}"`, { encoding: 'utf-8' });
        const lines = result.split('\n').filter(line => line.includes('LISTENING'));
        
        for (const line of lines) {
            const parts = line.trim().split(/\s+/);
            const pid = parts[parts.length - 1];
            
            if (pid && /^\d+$/.test(pid) && parseInt(pid) > 0) {
                console.log(`[Main] Found process on target port. PID: ${pid}`);
                try {
                    execSync(`taskkill /F /PID ${pid}`, { encoding: 'utf-8' });
                    console.log(`[Main] Process ${pid} terminated`);
                    return true;
                } catch (e) {
                    console.log(`[Main] Unable to terminate process ${pid} (it may already be closed)`);
                }
            }
        }
    } catch {
        // 端口无占用或 netstat 未找到匹配项
    }
    return false;
}

/**
 * 创建主窗口（Electron BrowserWindow）
 */
function createWindow(): void {
    mainWindowShown = false;
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        minWidth: 800,
        minHeight: 600,
        title: 'DesignEcho',
        backgroundColor: '#0d0d14',
        titleBarStyle: 'hiddenInset',
        trafficLightPosition: { x: 16, y: 16 },
        autoHideMenuBar: true,
        show: false,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false
        }
    });
    
    mainWindow.setMenuBarVisibility(false);

    const showMainWindow = (reason: string): void => {
        if (!mainWindow || mainWindowShown) return;
        mainWindowShown = true;
        console.log(`[Main] Showing main window. reason=${reason}`);
        if (mainWindow.isMinimized()) {
            mainWindow.restore();
        }
        mainWindow.show();
        mainWindow.focus();
    };

    mainWindow.once('ready-to-show', () => {
        console.log('[Main] Window ready to show');
        showMainWindow('ready-to-show');
    });

    // 加载渲染进程页面。ChatPanel 测试桥接只在显式环境变量下启用，默认不暴露给用户会话。
    const rendererQuery = process.env.DESIGNECHO_CHAT_TEST_BRIDGE === '1'
        ? {
            designechoChatTestBridge: '1',
            ...(process.env.DESIGNECHO_CHAT_TEST_PROJECT_PATH
                ? { designechoChatTestProjectPath: process.env.DESIGNECHO_CHAT_TEST_PROJECT_PATH }
                : {}),
            ...(process.env.DESIGNECHO_CHAT_TEST_FAKE_MODEL === '1'
                ? { designechoChatTestFakeModel: '1' }
                : {}),
            ...(process.env.DESIGNECHO_CHAT_TEST_FAKE_PHOTOSHOP === '1'
                ? { designechoChatTestFakePhotoshop: '1' }
                : {}),
            ...(process.env.DESIGNECHO_CHAT_TEST_FAKE_PHOTOSHOP_EMPTY === '1'
                ? { designechoChatTestFakePhotoshopEmpty: '1' }
                : {})
        }
        : undefined;
    mainWindow.loadFile(
        path.join(__dirname, '../../renderer/index.html'),
        rendererQuery ? { query: rendererQuery } : undefined
    );

    mainWindow.webContents.once('did-finish-load', () => {
        showMainWindow('did-finish-load');
    });

    // 渲染进程 console 告警/错误落盘：此前 ErrorBoundary 崩溃现场只在 DevTools 可见，事后无法诊断。
    mainWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
        if (level < 2) return;
        const source = sourceId ? `${sourceId}:${line}` : 'renderer';
        logService?.logAgent(level === 3 ? 'error' : 'warn', `[Renderer] ${message} (${source})`);
    });

    mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
        console.error(`[Main] Renderer failed to load. code=${errorCode}, description=${errorDescription}, url=${validatedURL}`);
        showMainWindow('did-fail-load');
    });

    setTimeout(() => {
        showMainWindow('startup-timeout');
    }, 5000);

    mainWindow.on('closed', () => {
        mainWindow = null;
        mainWindowShown = false;
    });

    console.log('[Main] Window created (hidden until ready)');
}

function readPersistedApiKeys(): PersistedApiKeys {
    try {
        const stateStorePath = path.join(app.getPath('userData'), 'app-state-store.json');
        if (!fs.existsSync(stateStorePath)) {
            return {};
        }

        const raw = fs.readFileSync(stateStorePath, 'utf8');
        const parsed = JSON.parse(raw);
        const entries = parsed?.entries && typeof parsed.entries === 'object' ? parsed.entries : {};

        const tryParseApiKeys = (source: any): PersistedApiKeys => {
            const apiKeys = source?.apiKeys && typeof source.apiKeys === 'object' ? source.apiKeys : {};
            return {
                anthropic: typeof apiKeys.anthropic === 'string' ? apiKeys.anthropic : '',
                google: typeof apiKeys.google === 'string' ? apiKeys.google : '',
                xiaomi: typeof apiKeys.xiaomi === 'string' ? apiKeys.xiaomi : '',
                openai: typeof apiKeys.openai === 'string' ? apiKeys.openai : '',
                gptsapi: typeof apiKeys.gptsapi === 'string' ? apiKeys.gptsapi : '',
                openrouter: typeof apiKeys.openrouter === 'string' ? apiKeys.openrouter : '',
                deepseek: typeof apiKeys.deepseek === 'string' ? apiKeys.deepseek : '',
                ollamaUrl: typeof apiKeys.ollamaUrl === 'string' ? apiKeys.ollamaUrl : '',
                ollamaApiKey: typeof apiKeys.ollamaApiKey === 'string' ? apiKeys.ollamaApiKey : '',
                bfl: typeof apiKeys.bfl === 'string' ? apiKeys.bfl : '',
                volcengineJimengAccessKeyId: typeof apiKeys.volcengineJimengAccessKeyId === 'string' ? apiKeys.volcengineJimengAccessKeyId : '',
                volcengineJimengSecretAccessKey: typeof apiKeys.volcengineJimengSecretAccessKey === 'string' ? apiKeys.volcengineJimengSecretAccessKey : '',
                volcengineSeedreamApiKey: typeof apiKeys.volcengineSeedreamApiKey === 'string' ? apiKeys.volcengineSeedreamApiKey : '',
                volcengineTosRegion: typeof apiKeys.volcengineTosRegion === 'string' ? apiKeys.volcengineTosRegion : '',
                volcengineTosEndpoint: typeof apiKeys.volcengineTosEndpoint === 'string' ? apiKeys.volcengineTosEndpoint : '',
                volcengineTosBucket: typeof apiKeys.volcengineTosBucket === 'string' ? apiKeys.volcengineTosBucket : '',
                volcengineTosPublicBaseUrl: typeof apiKeys.volcengineTosPublicBaseUrl === 'string' ? apiKeys.volcengineTosPublicBaseUrl : '',
                volcengineTosKeyPrefix: typeof apiKeys.volcengineTosKeyPrefix === 'string' ? apiKeys.volcengineTosKeyPrefix : '',
            };
        };

        const rendererStateRaw = entries.rendererState;
        if (typeof rendererStateRaw === 'string' && rendererStateRaw.trim()) {
            const rendererState = JSON.parse(rendererStateRaw);
            const rendererKeys = tryParseApiKeys(rendererState);
            if (Object.values(rendererKeys).some(Boolean)) {
                return rendererKeys;
            }
        }

        const storeRaw = entries['designecho-storage'];
        if (typeof storeRaw === 'string' && storeRaw.trim()) {
            const storeState = JSON.parse(storeRaw);
            const storeKeys = tryParseApiKeys(storeState?.state || storeState);
            if (Object.values(storeKeys).some(Boolean)) {
                return storeKeys;
            }
        }
    } catch (error: any) {
        console.warn('[Main] Failed to read persisted API Keys:', error?.message || String(error));
    }
    return {};
}

/**
 * 启动内嵌 WebView 静态文件服务器（用于 UXP 侧调试面板等）
 */
function startWebViewServer(): void {
    const appPath = app.getAppPath();
    const publicDir = path.join(appPath, 'public/webview');
    
    console.log(`[Main] WebView public dir: ${publicDir}`);
    
    if (!fs.existsSync(publicDir)) {
        console.error(`[Main] WebView directory not found: ${publicDir}`);
        logService?.logAgent('error', `WebView directory not found: ${publicDir}`);
        return;
    }
    
    const mimeTypes: Record<string, string> = {
        '.html': 'text/html; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.js': 'application/javascript; charset=utf-8',
        '.json': 'application/json',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.svg': 'image/svg+xml',
        '.ico': 'image/x-icon'
    };
    
    webviewServer = http.createServer((req, res) => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        
        if (req.method === 'OPTIONS') {
            res.writeHead(200);
            res.end();
            return;
        }
        
        let filePath = req.url === '/' ? '/index.html' : req.url;
        filePath = path.join(publicDir, filePath || '');
        
        const extname = path.extname(filePath).toLowerCase();
        const contentType = mimeTypes[extname] || 'application/octet-stream';
        
        fs.readFile(filePath, (err, content) => {
            if (err) {
                if (err.code === 'ENOENT') {
                    res.writeHead(404);
                    res.end('Not Found');
                } else {
                    res.writeHead(500);
                    res.end('Server Error');
                }
            } else {
                res.writeHead(200, { 'Content-Type': contentType });
                res.end(content);
            }
        });
    });
    
    webviewServer.listen(WEBVIEW_SERVER_PORT, WEBVIEW_BIND_HOST, () => {
        logService?.logAgent('info', `WebView server started at http://${WEBVIEW_BIND_HOST}:${WEBVIEW_SERVER_PORT}`);
        console.log(`[Main] WebView server started on port ${WEBVIEW_SERVER_PORT}`);
    });
    
    webviewServer.on('error', (err: any) => {
        if (err.code === 'EADDRINUSE') {
            logService?.logAgent('warn', `WebView port ${WEBVIEW_SERVER_PORT} is already in use.`);
        } else {
            logService?.logAgent('error', `WebView server error: ${err.message}`);
        }
    });
}

/**
 * 初始化所有后端服务
 */
async function initializeServices(): Promise<void> {
    // 日志服务（最先初始化，后续服务依赖日志输出）
    logService = getLogService();
    await logService.initialize();
    logService.interceptConsole();
    logService.logAgent('info', 'DesignEcho Agent service initialization started');

    const persistedApiKeys = readPersistedApiKeys();
    if (persistedApiKeys.bfl) {
        bflService.setApiKey(persistedApiKeys.bfl);
        logService.logAgent('info', '[Main] Restored BFL API Key from persisted state');
    }
    if (persistedApiKeys.volcengineJimengAccessKeyId || persistedApiKeys.volcengineJimengSecretAccessKey) {
        volcengineJimengInpaintingService.setCredentials(
            persistedApiKeys.volcengineJimengAccessKeyId,
            persistedApiKeys.volcengineJimengSecretAccessKey
        );
        volcengineJimengImageService.setCredentials(
            persistedApiKeys.volcengineJimengAccessKeyId,
            persistedApiKeys.volcengineJimengSecretAccessKey
        );
        logService.logAgent('info', '[Main] Restored Jimeng inpainting credentials from persisted state');
    }
    if (
        persistedApiKeys.volcengineTosRegion ||
        persistedApiKeys.volcengineTosEndpoint ||
        persistedApiKeys.volcengineTosBucket ||
        persistedApiKeys.volcengineTosPublicBaseUrl ||
        persistedApiKeys.volcengineTosKeyPrefix
    ) {
        volcengineTosUploadService.setConfig({
            region: persistedApiKeys.volcengineTosRegion,
            endpoint: persistedApiKeys.volcengineTosEndpoint,
            bucket: persistedApiKeys.volcengineTosBucket,
            publicBaseUrl: persistedApiKeys.volcengineTosPublicBaseUrl,
            keyPrefix: persistedApiKeys.volcengineTosKeyPrefix
        });
        logService.logAgent('info', '[Main] Restored TOS upload config from persisted state');
    }
    if (persistedApiKeys.volcengineSeedreamApiKey) {
        volcengineSeedreamService.setApiKey(persistedApiKeys.volcengineSeedreamApiKey);
        logService.logAgent('info', '[Main] Restored Seedream API Key from persisted state');
    }
    if (persistedApiKeys.gptsapi) {
        gptsapiGeminiImageService.setApiKey(persistedApiKeys.gptsapi);
        logService.logAgent('info', '[Main] Restored GPTs API Key for Gemini image edit from persisted state');
    }
    if (persistedApiKeys.openrouter) {
        openRouterGeminiImageService.setApiKey(persistedApiKeys.openrouter);
        logService.logAgent('info', '[Main] Restored OpenRouter API Key for Gemini image edit from persisted state');
    }
    // 初始化 AI 模型服务（多 provider 支持）
    modelService = new ModelService({
        anthropicApiKey: persistedApiKeys.anthropic,
        googleApiKey: persistedApiKeys.google,
        xiaomiApiKey: persistedApiKeys.xiaomi,
        openaiApiKey: persistedApiKeys.openai,
        gptsapiApiKey: persistedApiKeys.gptsapi,
        openrouterApiKey: persistedApiKeys.openrouter,
        deepseekApiKey: persistedApiKeys.deepseek,
        ollamaUrl: persistedApiKeys.ollamaUrl,
        ollamaApiKey: persistedApiKeys.ollamaApiKey,
        bflApiKey: persistedApiKeys.bfl
    });
    logService.logAgent('info', 'Model service initialized');
    
    // 任务协调器（管理 Agent 任务的调度与执行）
    taskOrchestrator = new TaskOrchestrator(modelService);
    logService.logAgent('info', 'Task orchestrator initialized');

    // 资源管理服务（知识库文件、模板资源等）
    resourceManagerService = new ResourceManagerService();
    logService.logAgent('info', 'Resource manager initialized');

    // 局部重绘服务（Inpainting）
    inpaintingService = new InpaintingService();
    logService.logAgent('info', 'Inpainting service initialized');

    // 抠图服务（本地 ONNX 推理）
    // 模型目录显式指向 userData/models —— 与模型下载(model:download)、设置页列模型(matting:models)一致，
    // 避免推理服务在工程相对目录里找不到已下载的 BiRefNet/YOLO 模型。
    mattingService = new MattingService({ modelsDir: path.join(app.getPath('userData'), 'models') });
    logService.logAgent('info', 'Matting service initialized (local ONNX mode)');
    
    const mattingReady = await mattingService.reinitializePythonBackend();
    if (mattingReady) {
        logService.logAgent('info', 'Local matting engine ready');
    } else {
        logService.logAgent('warn', 'Matting engine initialization failed');
    }

    // 主体检测服务（用于智能排版的主体边界识别）
    subjectDetectionService = getSubjectDetectionService();
    logService.logAgent('info', 'Subject detection service initialized');
    
    // 轮廓提取服务（用于主体边缘描绘与裁切）
    contourService = ContourService.getInstance();
    logService.logAgent('info', 'Contour extraction service initialized');
    
    // SAM 分割服务
    samService = getSAMService({ modelsDir: path.join(process.cwd(), 'models') });
    const samReady = await samService.initialize();
    if (samReady) {
        logService.logAgent('info', 'SAM selection service ready');
    } else {
        logService.logAgent('info', 'SAM model unavailable, fallback to BiRefNet');
    }

    // WebSocket 服务（与 UXP 插件通信）
    wsServer = new WebSocketServer(WS_PORT, {
        onMessage: async (message) => {
            mainWindow?.webContents.send('ws:message', message);
        },
        onConnection: () => {
            logService?.logAgent('info', 'UXP plugin connected');
            mainWindow?.webContents.send('ws:connected');
        },
        onDisconnection: () => {
            logService?.logAgent('info', 'UXP plugin disconnected');
            mainWindow?.webContents.send('ws:disconnected');
        }
    });

    wsServer.start();
    logService.logAgent('info', `WebSocket server started on port ${WS_PORT}`);
    logService.logAgent('info', `Log file: ${logService.getLogFilePath()}`);
    
    // 设置二进制消息处理器（接收 UXP 端发送的图像二进制数据，避免 Base64 编码开销）
    wsServer.setBinaryHandler(async (header, imageData) => {
        console.log(`[Binary Handler] Received image payload. type=${getBinaryTypeName(header.type)}, requestId=${header.requestId}, ${header.width}x${header.height}, ${(imageData.length / 1024).toFixed(0)}KB`);
        
        if (header.type === BinaryMessageType.JPEG || 
            header.type === BinaryMessageType.PNG ||
            header.type === BinaryMessageType.RAW_RGB ||
            header.type === BinaryMessageType.RAW_RGBA ||
            header.type === BinaryMessageType.RAW_MASK) {
            receivedBinaryImages.set(header.requestId, {
                type: header.type,
                width: header.width,
                height: header.height,
                data: imageData,
                timestamp: Date.now()
            });
            console.log(`[Binary Handler] Cached image payload. type=${getBinaryTypeName(header.type)}, requestId=${header.requestId}`);
        }
        
        return null;
    });
    
    // 注册 UXP 消息处理器
    const uxpContext: UXPContext = {
        wsServer,
        logService,
        taskOrchestrator,
        mattingService,
        inpaintingService,
        subjectDetectionService,
        contourService,
        samService,
        mainWindow,
        binaryImageStore: receivedBinaryImages
    };
    registerUXPHandlers(uxpContext);
    
    // 启动 WebView 静态文件服务
    startWebViewServer();

    // 启动 Debug Bridge 服务（用于调试面板的消息代理与会话录制）
    debugBridgeService = new DebugBridgeService({
        host: WEBVIEW_BIND_HOST,
        port: DEBUG_BRIDGE_PORT,
        dataDir: path.join(app.getPath('userData'), 'debug-bridge'),
        onChatSubmit: submitChatToCurrentWindow,
        onEvent: (event) => {
            if (event.type === 'session.created') {
                logService?.logAgent('info', `[DebugBridge] Session created: ${event.sessionId}`);
            } else {
                const message = event.payload as { role?: string; direction?: string; content?: string };
                const preview = String(message.content || '').slice(0, 80);
                logService?.logAgent(
                    'info',
                    `[DebugBridge] ${event.sessionId} ${message.direction || 'inbound'} ${message.role || 'user'}: ${preview}`
                );
            }
            mainWindow?.webContents.send('debug-bridge:event', event);
        }
    });
    debugBridgeService.start();
    logService.logAgent('info', `Debug Bridge started at http://${WEBVIEW_BIND_HOST}:${DEBUG_BRIDGE_PORT}`);

    mcpHostService = new MCPHostService({
        host: WEBVIEW_BIND_HOST,
        port: MCP_HOST_PORT,
        wsServer: wsServer!,
        debugBridge: debugBridgeService!,
        resourceManagerService,
        modelService,
        taskOrchestrator,
        onLog: (level, message) => logService?.logAgent(level, message)
    });
    mcpHostService.start();
    logService.logAgent('info', `MCP Host started at ${mcpHostService.getBaseUrl()}/mcp`);

    // 启动浏览器扩展桥（Agent 操作用户真实浏览器，见 docs/browser-extension-bridge.md）
    browserBridgeService = initBrowserBridgeService({
        host: WEBVIEW_BIND_HOST,
        port: BROWSER_BRIDGE_PORT,
        token: process.env.DESIGNECHO_BROWSER_BRIDGE_TOKEN,
        onLog: (level, message) => logService?.logAgent(level, message)
    });
    await browserBridgeService.start();

    console.log('[Main] Services initialized');
}

/**
 * 注册渲染进程的 IPC 通道
 */
function setupIPC(): void {
    const context: IPCContext = {
        wsServer,
        modelService,
        taskOrchestrator,
        logService,
        mattingService,
        resourceManagerService,
        mainWindow
    };
    
    setupIPCHandlers(context);
    console.log('[Main] IPC handlers registered');
}

// 处理第二个实例启动时聚焦已有窗口，而非新建窗口
app.on('second-instance', () => {
    if (mainWindow) {
        if (mainWindow.isMinimized()) {
            mainWindow.restore();
        }
        if (!mainWindow.isVisible()) {
            mainWindow.show();
        }
        mainWindow.focus();
        console.log('[Main] Focused existing window');
    }
});

// 应用就绪后初始化
app.whenReady().then(async () => {
    if (process.env.DESIGNECHO_SKIP_PORT_CLEANUP === '1') {
        console.log(`[Main] Skipping port cleanup for ${WS_PORT} because DESIGNECHO_SKIP_PORT_CLEANUP=1`);
    } else if (process.env.DESIGNECHO_ALLOW_PORT_CLEANUP === '1') {
        console.log(`[Main] Preparing to intentionally free port ${WS_PORT} before startup...`);
        killProcessOnPort(WS_PORT);
    } else {
        console.log(`[Main] Port cleanup skipped for ${WS_PORT}. Existing runtimes will not be terminated automatically.`);
    }
    
    await new Promise(resolve => setTimeout(resolve, 500));
    
    createWindow();
    await initializeServices();
    setupIPC();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

// 所有窗口关闭后退出应用（macOS 除外，macOS 上应用通常保持活跃）
app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

// 应用退出前清理资源，确保所有服务正常关闭
app.on('before-quit', async () => {
    console.log('[Main] App is shutting down. Cleaning up resources...');

    cleanupStreams();
    
    if (mattingService) {
        await mattingService.shutdown();
    }
    
    if (wsServer) {
        wsServer.stop();
    }

    if (debugBridgeService) {
        debugBridgeService.stop();
    }

    if (mcpHostService) {
        mcpHostService.stop();
    }

    if (browserBridgeService) {
        browserBridgeService.stop();
    }

    if (logService) {
        await logService.close();
    }
    
    console.log('[Main] Resource cleanup completed');
});
