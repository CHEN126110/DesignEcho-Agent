/**
 * Preload 脚本
 * 
 * 在渲染进程中暴露安全的 API
 */

import { contextBridge, ipcRenderer } from 'electron';
import type { ModelConfig } from '../shared/config/models.config';
import type {
    ArtifactRuntimeBinding
} from '../shared/agent-runtime-v5/artifact-repository-contract';
import type { ArtifactRef } from '../shared/agent-runtime-v5/contracts/common';
import type {
    RuntimeArtifactAuthorizationRequest,
    RuntimeArtifactFinalizationRequest
} from '../shared/agent-runtime-v5/runtime-artifact-finalization';
import type {
    EagleLibraryPreviewRequest,
    EagleLibraryQueryRequest
} from '../shared/eagle-library';

const chatTestFakePhotoshopEnabled = process.env.DESIGNECHO_CHAT_TEST_BRIDGE === '1'
    && process.env.DESIGNECHO_CHAT_TEST_FAKE_PHOTOSHOP === '1';

// 模型偏好类型
interface ModelPreferences {
    mode?: 'local' | 'cloud' | 'auto';
    autoFallback?: boolean;
    preferredLocalModels?: { layoutAnalysis: string; textOptimize: string; visualAnalyze: string };
    preferredCloudModels?: { layoutAnalysis: string; textOptimize: string; visualAnalyze: string };
    thinking?: { enabled?: boolean };
    // 动态拉取模型快照：随偏好同步通道下发，供主进程冷启动回灌动态模型注册表。
    dynamicModels?: ModelConfig[];
}

// 暴露给渲染进程的 API
const api = {
    // ===== 配置 =====
    setApiKeys: (keys: {
        anthropic?: string;
        google?: string;
        xiaomi?: string;
        openai?: string;
        gptsapi?: string;
        openrouter?: string;  // OpenRouter 中转平台
        deepseek?: string;    // DeepSeek 官方 API Key
        ollamaUrl?: string;
        ollamaApiKey?: string;
        bfl?: string;         // Black Forest Labs (FLUX) API Key
        volcengineJimengAccessKeyId?: string;
        volcengineJimengSecretAccessKey?: string;
        volcengineSeedreamApiKey?: string;
        volcengineTosRegion?: string;
        volcengineTosEndpoint?: string;
        volcengineTosBucket?: string;
        volcengineTosPublicBaseUrl?: string;
        volcengineTosKeyPrefix?: string;
    }) => ipcRenderer.invoke('config:setApiKeys', keys),

    testVolcengineJimengCredentials: (accessKeyId: string, secretAccessKey: string) =>
        ipcRenderer.invoke('volcengine:testJimengCredentials', accessKeyId, secretAccessKey),

    testVolcengineSeedreamApiKey: (apiKey: string) =>
        ipcRenderer.invoke('volcengine:testSeedreamApiKey', apiKey),

    testDeepSeek: (apiKey: string) =>
        ipcRenderer.invoke('model:testDeepSeek', apiKey),

    // 从某 provider 官方接口拉取最新模型列表（apiKey 由主进程取，渲染侧不传 key）
    listProviderModels: (provider: string) =>
        ipcRenderer.invoke('model:listProviderModels', provider),
    probeDesignKnowledgeSearxng: (settings: unknown) =>
        ipcRenderer.invoke('designKnowledge:probeSearxngHealth', settings),
    probeDesignKnowledgeEagleReadonly: (settings?: unknown) =>
        ipcRenderer.invoke('designKnowledge:probeEagleReadonly', settings),
    searchEagleReadonlyKnowledge: (query: unknown, settings?: unknown) =>
        ipcRenderer.invoke('designKnowledge:searchEagleReadonly', query, settings),
    getEagleReferencePreview: (request: unknown) =>
        ipcRenderer.invoke('designKnowledge:getEagleReferencePreview', request),
    selectEagleLibrary: (options?: { defaultPath?: string }) =>
        ipcRenderer.invoke('eagleLibrary:select', options),
    openEagleLibrary: (libraryPath: string, forceRefresh?: boolean) =>
        ipcRenderer.invoke('eagleLibrary:open', libraryPath, forceRefresh),
    queryEagleLibrary: (request: EagleLibraryQueryRequest) =>
        ipcRenderer.invoke('eagleLibrary:query', request),
    getEagleLibraryPreview: (request: EagleLibraryPreviewRequest) =>
        ipcRenderer.invoke('eagleLibrary:getPreview', request),
    // P3 Agent 参考与素材：真实视觉观察（回包无本地路径）+ 项目复制（只写项目、留来源追踪）
    observeEagleAsset: (request: { libraryId?: string; itemId?: string; maxSize?: number }) =>
        ipcRenderer.invoke('eagleLibrary:observeAsset', request),
    importEagleAssetToProject: (request: { libraryId?: string; itemId?: string; projectPath?: string; targetSubdir?: string }) =>
        ipcRenderer.invoke('eagleLibrary:importAssetToProject', request),
    // P2 双向编辑：Inspector 编辑写回运行中的 Eagle（安全闸门+冲突检测+读回验证；不写 .library JSON）
    executeEagleInspectorWriteback: (request: {
        itemId?: string;
        baseline?: { tags?: string[]; annotation?: string; rating?: number };
        edits?: { tags?: string[]; annotation?: string; rating?: number };
        userConfirmed?: boolean;
    }) => ipcRenderer.invoke('eagleLibrary:executeInspectorWriteback', request),
    searchDesignKnowledge: (query: unknown, settings?: unknown) =>
        ipcRenderer.invoke('designKnowledge:search', query, settings),

    // 模型偏好设置
    setModelPreferences: (prefs: ModelPreferences) => 
        ipcRenderer.invoke('config:setModelPreferences', prefs),

    // 抠图设置（只使用本地 AI 模型，不使用 PS 内置功能）
    // 支持四阶段模型配置：文本定位 → 目标检测 → 精确分割 → 边缘细化
    setMattingSettings: (settings: {
        mode?: 'cloud' | 'local' | 'auto';  // 移除 builtin
        localServiceUrl?: string;
        activeModels?: {
            textGrounding?: string;     // 文本定位（如 grounding-clip）
            objectDetection?: string;   // 目标检测（如 detection-yolov4）
            sceneAnalysis?: string;
            saliency?: string;
            segmentation?: string;
            edgeRefine?: string;
            geometry?: string;
        };
    }) => ipcRenderer.invoke('config:setMattingSettings', settings),
    
    getModelPreferences: () => 
        ipcRenderer.invoke('config:getModelPreferences'),
    
    // 形态统一设置
    setMorphingSettings: (settings: {
        subjectDetectionModel?: string;
        contourPrecision?: 'fast' | 'balanced' | 'quality';
        scaleThreshold?: number;
        positionThreshold?: number;
    }) => ipcRenderer.invoke('config:setMorphingSettings', settings),
    
    getMorphingSettings: () => 
        ipcRenderer.invoke('config:getMorphingSettings'),

    // ===== WebSocket =====
    sendToPlugin: (method: string, params?: any, timeout?: number) => 
        ipcRenderer.invoke('ws:send', method, params, timeout),

    sendToPluginCancellable: (requestKey: string, method: string, params?: any, timeout?: number) =>
        ipcRenderer.invoke('ws:send-cancellable', requestKey, method, params, timeout),

    cancelPluginRequest: (requestKey: string) =>
        ipcRenderer.invoke('ws:cancel', requestKey),

    callMcpToolCancellable: (requestKey: string, name: string, args?: any) =>
        ipcRenderer.invoke('mcp:tools:call-cancellable', requestKey, name, args),

    cancelMcpToolRequest: (requestKey: string) =>
        ipcRenderer.invoke('mcp:tools:cancel', requestKey),
    
    getConnectionStatus: () =>
        chatTestFakePhotoshopEnabled
            ? Promise.resolve({ connected: true })
            : ipcRenderer.invoke('ws:status'),

    onPluginConnected: (callback: () => void) => {
        ipcRenderer.on('ws:connected', callback);
        return () => ipcRenderer.removeListener('ws:connected', callback);
    },

    onPluginDisconnected: (callback: () => void) => {
        ipcRenderer.on('ws:disconnected', callback);
        return () => ipcRenderer.removeListener('ws:disconnected', callback);
    },

    onPluginMessage: (callback: (message: any) => void) => {
        const handler = (_event: any, message: any) => callback(message);
        ipcRenderer.on('ws:message', handler);
        return () => ipcRenderer.removeListener('ws:message', handler);
    },

    // 监听 UXP 转发的 WebView 消息（进度更新、状态等）
    onUXPWebViewMessage: (callback: (message: any) => void) => {
        const handler = (_event: any, message: any) => callback(message);
        ipcRenderer.on('uxp:webview-message', handler);
        return () => ipcRenderer.removeListener('uxp:webview-message', handler);
    },

    // ===== 任务 =====
    executeTask: (taskType: string, input: any) => 
        ipcRenderer.invoke('task:execute', taskType, input),

    // ===== 模型 =====
    chat: (modelId: string, messages: any[], options?: any) =>
        ipcRenderer.invoke('model:chat', modelId, messages, options),

    // 带工具调用的聊天（Agent Runtime 使用）
    chatWithTools: (modelId: string, messages: any[], tools: any[], options?: any) =>
        ipcRenderer.invoke('model:chatWithTools', modelId, messages, tools, options),
    
    // 流式聊天
    chatStream: (params: {
        requestId: string;
        modelId: string;
        messages: Array<{ role: string; content: string }>;
        options?: { maxTokens?: number; temperature?: number; thinkingEnabled?: boolean; timeoutMs?: number };
    }) => ipcRenderer.invoke('stream:chat', params),

    // 带工具调用的 Agent 流式聊天
    chatWithToolsStream: (params: {
        requestId: string;
        modelId: string;
        messages: any[];
        tools: any[];
        options?: { maxTokens?: number; temperature?: number; nativeTools?: any[] };
    }) => ipcRenderer.invoke('stream:chatWithTools', params),
    
    // 取消流式请求
    abortStream: (requestId: string) => 
        ipcRenderer.invoke('stream:abort', requestId),
    
    // 监听流式数据
    onStreamChunk: (callback: (data: { requestId: string; chunk: any }) => void) => {
        const handler = (_event: any, data: { requestId: string; chunk: any }) => callback(data);
        ipcRenderer.on('stream:chunk', handler);
        return () => ipcRenderer.removeListener('stream:chunk', handler);
    },

    // ===== 日志 =====
    getRecentLogs: (lines?: number) => 
        ipcRenderer.invoke('log:getRecent', lines),
    
    getLogPath: () => 
        ipcRenderer.invoke('log:getPath'),
    
    clearLogs: () => 
        ipcRenderer.invoke('log:clear'),
    
    // 写入日志（从渲染进程）
    writeLog: (level: 'info' | 'warn' | 'error', message: string, data?: any) =>
        ipcRenderer.invoke('log:write', level, message, data),

    // ===== 模型下载 =====
    downloadModel: (modelId: string, downloadUrl: string, targetPath: string, fallbackUrls?: string[]) =>
        ipcRenderer.invoke('model:download', modelId, downloadUrl, targetPath, fallbackUrls),

    onDownloadProgress: (callback: (progress: { modelId: string; percent: number; downloaded: number; total: number }) => void) => {
        const handler = (_event: any, progress: any) => callback(progress);
        ipcRenderer.on('model:download-progress', handler);
        return () => ipcRenderer.removeListener('model:download-progress', handler);
    },

    checkModelExists: (modelPath: string) =>
        ipcRenderer.invoke('model:checkExists', modelPath),

    // 手动导入模型（让用户选择文件并复制到正确位置）
    importModel: (modelId: string, targetPath: string) =>
        ipcRenderer.invoke('model:import', modelId, targetPath),

    // 扫描本地模型目录
    scanLocalModels: () =>
        ipcRenderer.invoke('matting:scanLocalModels'),

    // ===== 文件系统 =====
    // 选择文件夹
    selectFolder: (title?: string) =>
        ipcRenderer.invoke('fs:selectFolder', title),
    
    // 读取目录内容
    readDirectory: (dirPath: string, options?: { recursive?: boolean; filter?: string[] }) =>
        ipcRenderer.invoke('fs:readDirectory', dirPath, options),
    
    // 读取文件
    readFile: (filePath: string, encoding?: string) =>
        ipcRenderer.invoke('fs:readFile', filePath, encoding),
    
    // 写入文件
    writeFile: (filePath: string, content: string | Buffer) =>
        ipcRenderer.invoke('fs:writeFile', filePath, content),
    
    // 检查路径是否存在
    pathExists: (targetPath: string) =>
        ipcRenderer.invoke('fs:exists', targetPath),
    
    // 创建目录
    createDirectory: (dirPath: string) =>
        ipcRenderer.invoke('fs:createDirectory', dirPath),
    
    // 复制文件（用于将临时导出文件复制到目标目录）
    copyFile: (sourcePath: string, destPath: string) =>
        ipcRenderer.invoke('fs:copyFile', sourcePath, destPath),
    
    // 获取文件信息
    getFileInfo: (filePath: string) =>
        ipcRenderer.invoke('fs:getFileInfo', filePath),

    // 打开文件/文件夹（在系统资源管理器中）
    openPath: (targetPath: string) =>
        ipcRenderer.invoke('fs:openPath', targetPath),

    // 选择文件
    selectFile: (options?: { title?: string; filters?: { name: string; extensions: string[] }[] }) =>
        ipcRenderer.invoke('fs:selectFile', options),

    // ===== 系统功能 =====
    // 在系统默认浏览器中打开链接
    openExternal: (url: string) =>
        ipcRenderer.invoke('shell:openExternal', url),

    // 截图（用于多轮调试时附图发送）
    captureAgentWindowScreenshot: () =>
        ipcRenderer.invoke('screenshot:captureAgentWindow'),
    captureDesktopScreenshot: () =>
        ipcRenderer.invoke('screenshot:captureDesktop'),

    // ===== Ollama 模型管理 =====
    // 下载 Ollama 模型
    pullOllamaModel: (modelName: string) =>
        ipcRenderer.invoke('ollama:pull', modelName),
    
    // 在终端中下载 Ollama 模型（有进度显示）
    pullOllamaModelInTerminal: (modelName: string) =>
        ipcRenderer.invoke('ollama:pullInTerminal', modelName),
    
    // 监听 Ollama 下载进度
    onOllamaPullProgress: (callback: (data: { modelName: string; progress: number; status: string }) => void) => {
        const handler = (_event: any, data: { modelName: string; progress: number; status: string }) => callback(data);
        ipcRenderer.on('ollama:pullProgress', handler);
        return () => ipcRenderer.removeListener('ollama:pullProgress', handler);
    },
    
    // 获取已安装的 Ollama 模型列表
    listOllamaModels: () =>
        ipcRenderer.invoke('ollama:list'),
    
    // 删除 Ollama 模型
    deleteOllamaModel: (modelName: string) =>
        ipcRenderer.invoke('ollama:delete', modelName),

    // ===== 项目资源管理 =====
    // 设置项目根目录
    setProjectRoot: (rootPath: string) =>
        ipcRenderer.invoke('resource:setProjectRoot', rootPath),
    
    // 获取项目根目录
    getProjectRoot: () =>
        ipcRenderer.invoke('resource:getProjectRoot'),
    
    // 扫描目录
    scanDirectory: (dirPath?: string, options?: {
        recursive?: boolean;
        includeDesignFiles?: boolean;
        maxDepth?: number;
        generateThumbnails?: boolean;
    }) => ipcRenderer.invoke('resource:scanDirectory', dirPath, options),
    
    // 搜索资源
    searchResources: (query: string, options?: {
        directory?: string;
        type?: 'image' | 'design' | 'all';
        limit?: number;
    }) => ipcRenderer.invoke('resource:search', query, options),
    
    // 获取目录结构
    getResourceStructure: (directory?: string, maxDepth?: number) =>
        ipcRenderer.invoke('resource:getStructure', directory, maxDepth),
    
    // 获取资源摘要
    getResourceSummary: (directory?: string) =>
        ipcRenderer.invoke('resource:getSummary', directory),
    
    // 按类别获取资源
    getResourcesByCategory: (directory?: string) =>
        ipcRenderer.invoke('resource:getByCategory', directory),

    // Design Project State（共享设计项目状态）
    getDesignState: (projectPath: string) =>
        ipcRenderer.invoke('design-state:get', projectPath),
    updateDesignState: (projectPath: string, patch: any) =>
        ipcRenderer.invoke('design-state:update', projectPath, patch),

    // 主进程唯一 Artifact Repository；先签发 sender/project-bound 一次性授权，再提交收尾批次。
    authorizeRuntimeArtifactFinalization: (
        projectPath: string,
        request: RuntimeArtifactAuthorizationRequest
    ) => ipcRenderer.invoke('artifactRepository:authorizeRuntimeFinalization', projectPath, request),
    finalizeRuntimeArtifacts: (projectPath: string, request: RuntimeArtifactFinalizationRequest) =>
        ipcRenderer.invoke('artifactRepository:finalizeRuntime', projectPath, request),
    getArtifact: (projectPath: string, ref: ArtifactRef) =>
        ipcRenderer.invoke('artifactRepository:get', projectPath, ref),
    readArtifactRepositoryProjection: (projectPath: string, scope: ArtifactRuntimeBinding) =>
        ipcRenderer.invoke('artifactRepository:readProjection', projectPath, scope),

    // 获取图片预览
    getResourcePreview: (imagePath: string, maxSize?: number) =>
        ipcRenderer.invoke('resource:getPreview', imagePath, maxSize),

    // 抠图出主体蒙版（BiRefNet ONNX）——设计学习视觉案例用真实分割标注主体框
    mattingRemoveBackground: (imageBase64: string, options?: any) =>
        ipcRenderer.invoke('matting:removeBackground', imageBase64, options),

    // Agent Run Record（Harness v1）：持久化/读取运行记录（<project>/.designecho/runs/）
    writeAgentRunRecord: (record: unknown, projectPath: string) =>
        ipcRenderer.invoke('agentRun:writeRecord', record, projectPath),
    listAgentRunRecords: (projectPath: string, limit?: number) =>
        ipcRenderer.invoke('agentRun:listRecords', projectPath, limit),

    // 设计源解析（PSD 知识库 P0）：离线解析设计师 PSD/PSB 为 design-source-profile（只读、不落盘）
    analyzePsdDesignSource: (filePath: string) =>
        ipcRenderer.invoke('psdDesignSource:analyze', filePath),

    // 生成项目素材总览图：带编号缩略图 + 清单，供 Agent 观察项目素材集合
    createProjectContactSheetOverview: (options: {
        projectPath?: string;
        images?: Array<{
            path: string;
            relativePath?: string;
            labelHint?: string;
            role?: string;
        }>;
        columns?: number;
        tileWidth?: number;
        tileHeight?: number;
        maxImages?: number;
    }) => ipcRenderer.invoke('resource:createContactSheetOverview', options),

    // 生成并理解项目素材总览图：给 Agent 做项目第一眼观察
    analyzeProjectContactSheetOverview: (options: {
        projectPath?: string;
        images?: Array<{
            path: string;
            relativePath?: string;
            labelHint?: string;
            role?: string;
        }>;
        columns?: number;
        tileWidth?: number;
        tileHeight?: number;
        maxImages?: number;
        focus?: string;
        userIntent?: string;
    }) => ipcRenderer.invoke('resource:analyzeContactSheetOverview', options),
    
    // 读取图片为 Base64
    readImageBase64: (imagePath: string) =>
        ipcRenderer.invoke('resource:readImageBase64', imagePath),

    // 只读图片文件探针：不返回 base64 或原始图片内容
    probeImageFile: (imagePath: string) =>
        ipcRenderer.invoke('resource:probeImageFile', imagePath),

    // 只读图片像素探针：比较参考图与结果图，不返回 base64 或原始图片内容
    compareImageFiles: (referencePath: string, resultPath: string, options?: any) =>
        ipcRenderer.invoke('resource:compareImageFiles', referencePath, resultPath, options),
    
    // 分析素材内容（使用视觉模型）
    analyzeAssetContent: (imagePath: string) =>
        ipcRenderer.invoke('resource:analyzeAsset', imagePath),

    // 分析设计参考图为什么有效（使用视觉模型，只生成待复核经验观察）
    analyzeDesignReference: (input: {
        imagePath: string;
        referenceTitle?: string;
        referenceTags?: string[];
        referenceSource?: string;
        topics?: string[];
        cadence?: string;
    }) => ipcRenderer.invoke('resource:analyzeDesignReference', input),
    
    // 智能推荐素材
    recommendAssets: (params: {
        requirement: string;
        maxResults?: number;
        category?: string;
        deterministic?: boolean;
    }) => ipcRenderer.invoke('resource:recommendAssets', params),
    
    // 获取素材详情
    getAssetDetails: (imagePath: string) =>
        ipcRenderer.invoke('resource:getAssetDetails', imagePath),

    // ===== 抠图服务（兼容旧 API 名称）=====
    // 初始化抠图服务
    enablePythonBackend: () =>
        ipcRenderer.invoke('python:enable'),
    
    // 关闭抠图服务（保留但无操作）
    disablePythonBackend: () =>
        ipcRenderer.invoke('python:disable'),
    
    // 获取抠图服务状态
    getPythonBackendStatus: () =>
        ipcRenderer.invoke('python:status'),

    // ===== 智能分割模型管理 =====
    // 获取分割模型状态（BiRefNet + YOLO-World）
    getSegmentModelsStatus: () =>
        ipcRenderer.invoke('matting:getModelsStatus'),
    
    // 检查分割模型文件是否存在
    checkSegmentModelExists: (folder: string, fileName: string) =>
        ipcRenderer.invoke('model:checkModelFile', folder, fileName),
    
    // 下载分割模型
    downloadSegmentModel: (params: {
        url: string;
        folder: string;
        fileName: string;
        onProgress?: (progress: number) => void;
    }) => {
        // 使用 IPC 事件传递下载进度
        const channel = `model:download:progress:${Date.now()}`;
        if (params.onProgress) {
            ipcRenderer.on(channel, (_event, progress: number) => {
                params.onProgress!(progress);
            });
        }
        return ipcRenderer.invoke('model:downloadToModels', params.url, params.folder, params.fileName, channel)
            .finally(() => {
                ipcRenderer.removeAllListeners(channel);
            });
    },
    
    // 打开模型目录
    openModelsFolder: () =>
        ipcRenderer.invoke('model:openModelsFolder'),

    // ===== 电商项目管理 =====
    // 扫描电商项目结构
    scanEcommerceProject: (projectPath: string) =>
        ipcRenderer.invoke('ecommerce:scanProject', projectPath),
    
    // 更新文件夹类型
    updateFolderType: (projectPath: string, folderName: string, type: string) =>
        ipcRenderer.invoke('ecommerce:updateFolderType', projectPath, folderName, type),
    
    // 更新图片类型
    updateImageType: (projectPath: string, imageRelativePath: string, type: string) =>
        ipcRenderer.invoke('ecommerce:updateImageType', projectPath, imageRelativePath, type),
    
    // 加载电商项目配置
    loadEcommerceConfig: (projectPath: string) =>
        ipcRenderer.invoke('ecommerce:loadConfig', projectPath),
    
    // 保存电商项目配置
    saveEcommerceConfig: (projectPath: string, config: any) =>
        ipcRenderer.invoke('ecommerce:saveConfig', projectPath, config),

    // 构建运行时上下文快照（只读，不写项目配置）
    buildProjectContextSnapshot: (options: string | {
        projectPath: string;
        projectName?: string;
        currentDocument?: any;
        selectedAssetPaths?: string[];
        userConstraints?: string[];
        taskHistory?: string[];
        unverifiedItems?: string[];
        visualSamplingScenario?: 'main-image' | 'detail-page' | 'sku' | 'reference-replication' | 'general-design' | 'unknown';
        maxVisualSamples?: number;
        visualSamplingCache?: any[];
        usePersistedVisualInsightCache?: boolean;
    }) => ipcRenderer.invoke('ecommerce:buildContextSnapshot', options),

    // 写入项目级视觉理解缓存（仅写结构化 insight，不写 raw image/base64）
    writeProjectVisualInsightCache: (options: {
        projectPath: string;
        entries: any[];
        replace?: boolean;
        nowIso?: string;
    }) => ipcRenderer.invoke('ecommerce:writeVisualInsightCache', options),

    // 只读项目级视觉理解缓存（.designecho/visual-insights-cache.json；不扫描项目、不初始化配置）
    readProjectVisualInsightCache: (options: { projectPath: string } | string) =>
        ipcRenderer.invoke('ecommerce:readVisualInsightCache', options),

    // ===== 设计规范引擎 =====
    designSpec: {
        // 检查设计是否符合规范
        check: (context: object) => ipcRenderer.invoke('designSpec:check', context),
        // 获取规范要求
        getRequirements: (type: 'mainImage' | 'sku' | 'detailPage') => 
            ipcRenderer.invoke('designSpec:getRequirements', type),
        // 获取所有规则
        getRules: () => ipcRenderer.invoke('designSpec:getRules'),
        // 快速检查尺寸
        checkDimensions: (type: 'mainImage' | 'sku' | 'detailPage', width: number, height: number) => 
            ipcRenderer.invoke('designSpec:checkDimensions', type, width, height),
        // 获取规范建议
        getSuggestions: (type: 'mainImage' | 'sku' | 'detailPage') => 
            ipcRenderer.invoke('designSpec:getSuggestions', type),
    },

    // ===== 智能布局服务 =====
    smartLayout: {
        // 检测图像主体边界
        detectSubject: (params: {
            imageData: string;
            imageSize: { width: number; height: number };
            layerContext?: {
                layerId: number;
                isClipped: boolean;
                clippingBaseLayerId?: number;
                clippingBaseBounds?: { x: number; y: number; width: number; height: number };
            };
        }) => ipcRenderer.invoke('smartLayout:detectSubject', params),
        
        // 计算智能缩放和定位
        calculateScale: (params: {
            subjectBounds: { x: number; y: number; width: number; height: number };
            sourceImageSize: { width: number; height: number };
            targetArea: { x: number; y: number; width: number; height: number };
            config?: {
                fillRatio?: number;
                alignment?: 'center' | 'top-center' | 'bottom-center' | 'left-center' | 'right-center';
            };
        }) => ipcRenderer.invoke('smartLayout:calculateScale', params),
        
        // 一站式智能布局
        layout: (params: {
            imageData: string;
            imageSize: { width: number; height: number };
            targetArea: { x: number; y: number; width: number; height: number };
            layerContext?: object;
            config?: object;
        }) => ipcRenderer.invoke('smartLayout:layout', params),
        
        // 批量智能布局
        batchLayout: (params: {
            items: Array<{
                imageData: string;
                imageSize: { width: number; height: number };
                targetArea: { x: number; y: number; width: number; height: number };
                layerContext?: object;
            }>;
            config?: object;
        }) => ipcRenderer.invoke('smartLayout:batchLayout', params),
        
        // 获取服务状态
        getStatus: () => ipcRenderer.invoke('smartLayout:getStatus'),
        
        // 获取 GPU 状态
        getGPUStatus: () => ipcRenderer.invoke('smartLayout:getGPUStatus'),
        
        // 设置 GPU 模式
        setGPUMode: (mode: 'auto' | 'cuda' | 'directml' | 'cpu') => 
            ipcRenderer.invoke('smartLayout:setGPUMode', mode),
    },

    // ===== 图像协调服务 =====
    harmonization: {
        // 获取服务状态
        getStatus: () => ipcRenderer.invoke('harmonization:getStatus'),
        
        // 执行协调
        harmonize: (params: {
            foreground: string;
            background: string;
            mode?: 'fast' | 'balanced' | 'ai';
            intensity?: number;
            featherRadius?: number;
            preserveForeground?: boolean;
        }) => ipcRenderer.invoke('harmonization:harmonize', params),
        
        // 快速协调（简化接口）
        quickHarmonize: (params: {
            foreground: string;
            background: string;
            intensity?: number;
        }) => ipcRenderer.invoke('harmonization:quickHarmonize', params),
        
        // 检测 AI 模型是否可用
        checkAIModel: () => ipcRenderer.invoke('harmonization:checkAIModel'),
    },

    // ===== BFL (Black Forest Labs) FLUX 图像生成 =====
    bfl: {
        // 测试 API Key
        testApiKey: (apiKey: string) => ipcRenderer.invoke('bfl:testApiKey', apiKey),
        
        // 检查是否已配置 API Key
        hasApiKey: () => ipcRenderer.invoke('bfl:hasApiKey'),
        
        // 文生图
        text2image: (
            model: string,
            prompt: string,
            options?: {
                width?: number;
                height?: number;
                seed?: number;
                outputFormat?: 'png' | 'jpeg';
                steps?: number;
                guidance?: number;
            }
        ) => ipcRenderer.invoke('bfl:text2image', model, prompt, options),
        
        // 图生图
        image2image: (
            model: string,
            prompt: string,
            inputImage: string,
            options?: {
                width?: number;
                height?: number;
                additionalImages?: string[];
            }
        ) => ipcRenderer.invoke('bfl:image2image', model, prompt, inputImage, options),
        
        // 局部重绘
        inpaint: (
            prompt: string,
            inputImage: string,
            maskImage: string,
            options?: {
                width?: number;
                height?: number;
            }
        ) => ipcRenderer.invoke('bfl:inpaint', prompt, inputImage, maskImage, options),
        
        // 下载图像
        downloadImage: (url: string) => ipcRenderer.invoke('bfl:downloadImage', url),
        
        // 批量生成
        batchGenerate: (
            model: string,
            prompts: string[],
            options?: any
        ) => ipcRenderer.invoke('bfl:batchGenerate', model, prompts, options),
    },


    // ===== 项目索引进度 =====
    onProjectIndexProgress: (callback: (data: { projectId: string; current: number; total: number; phase?: 'project' | 'file'; fileName?: string }) => void) => {
        const handler = (_event: any, data: any) => callback(data);
        ipcRenderer.on('project:indexProgress', handler);
        return () => ipcRenderer.removeListener('project:indexProgress', handler);
    },

    // ===== Debug Bridge 运行窗口调试 =====
    onDebugBridgeChatSubmit: (callback: (request: {
        requestId: string;
        text: string;
        timeoutMs?: number;
        resetConversation?: boolean;
        publicPlanConfirmationSourceMessageId?: string;
        publicPlanDisposableLiveAdapter?: boolean;
    }) => Promise<any>) => {
        const handler = async (_event: any, request: any) => {
            try {
                const result = await callback(request);
                ipcRenderer.send('debug-bridge:chat-submit-result', {
                    requestId: request?.requestId,
                    success: true,
                    result
                });
            } catch (error: any) {
                ipcRenderer.send('debug-bridge:chat-submit-result', {
                    requestId: request?.requestId,
                    success: false,
                    error: error?.message || String(error)
                });
            }
        };
        ipcRenderer.on('debug-bridge:chat-submit', handler);
        return () => ipcRenderer.removeListener('debug-bridge:chat-submit', handler);
    },

    // ===== 项目设计知识学习 =====
    // ===== 通用 IPC 调用 =====
    // 允许调用任意已注册的 IPC handler
    invoke: (channel: string, ...args: any[]) =>
        ipcRenderer.invoke(channel, ...args),

    getPersistedValueSync: (key: string) =>
        ipcRenderer.sendSync('state:getPersistedValueSync', key)
};

// 暴露 API 到渲染进程
contextBridge.exposeInMainWorld('designEcho', api);

// electronAPI 别名（design-crawler、skills、aesthetic 等服务使用）
contextBridge.exposeInMainWorld('electronAPI', {
    invoke: (channel: string, ...args: any[]) => ipcRenderer.invoke(channel, ...args)
});

// 类型定义（供渲染进程使用）
export type DesignEchoAPI = typeof api;
