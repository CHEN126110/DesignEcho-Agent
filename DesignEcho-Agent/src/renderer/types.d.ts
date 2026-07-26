import type { ContextSnapshot, ProjectAssetIndex } from '../shared/project-asset-index';
import type { ProjectVisualInsightCacheReadResult } from '../shared/project-visual-insight-cache';
import type { DesignAgentOsRecord } from '../shared/design-agent-os-contracts';
import type {
    DesignKnowledgeResult,
    DesignKnowledgeSearchResponse
} from '../shared/design-knowledge-search';
import type { ModelConfig } from '../shared/config/models.config';
import type {
    ArtifactRepositoryReadProjection,
    ArtifactRepositoryReadResult,
    ArtifactRuntimeBinding
} from '../shared/agent-runtime-v5/artifact-repository-contract';
import type { ArtifactRef } from '../shared/agent-runtime-v5/contracts/common';
import type {
    RuntimeArtifactAuthorizationGrant,
    RuntimeArtifactAuthorizationRequest,
    RuntimeArtifactFinalizationRequest
} from '../shared/agent-runtime-v5/runtime-artifact-finalization';
import type {
    ProjectVisualSamplingCacheEntry,
    ProjectVisualSamplingPlan,
    ProjectVisualSamplingScenario
} from '../shared/project-visual-sampling';
import type {
    EagleLibraryOpenResponse,
    EagleLibraryPreviewRequest,
    EagleLibraryPreviewResponse,
    EagleLibraryQueryRequest,
    EagleLibraryQueryResponse
} from '../shared/eagle-library';

export interface DownloadProgress {
    modelId: string;
    percent: number;
    downloaded: number;
    total: number;
}

export interface DesignEchoAPI {
    authorizeRuntimeArtifactFinalization?: (
        projectPath: string,
        request: RuntimeArtifactAuthorizationRequest
    ) => Promise<{
        success: boolean;
        grant?: RuntimeArtifactAuthorizationGrant;
        code?: string;
        error?: string;
    }>;
    finalizeRuntimeArtifacts?: (
        projectPath: string,
        request: RuntimeArtifactFinalizationRequest
    ) => Promise<{
        success: boolean;
        projection?: ArtifactRepositoryReadProjection;
        code?: string;
        error?: string;
    }>;
    getArtifact?: (
        projectPath: string,
        ref: ArtifactRef
    ) => Promise<{
        success: boolean;
        result?: ArtifactRepositoryReadResult;
        code?: string;
        error?: string;
    }>;
    readArtifactRepositoryProjection?: (
        projectPath: string,
        scope: ArtifactRuntimeBinding
    ) => Promise<{
        success: boolean;
        projection?: ArtifactRepositoryReadProjection;
        code?: string;
        error?: string;
    }>;
    openExternal?: (url: string) => Promise<unknown>;
    setApiKeys: (keys: {
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
    }) => Promise<void>;

    testVolcengineJimengCredentials?: (accessKeyId: string, secretAccessKey: string) => Promise<{
        success: boolean;
        message?: string;
        error?: string;
    }>;

    testVolcengineSeedreamApiKey?: (apiKey: string) => Promise<{
        success: boolean;
        message?: string;
        error?: string;
        status?: number;
    }>;

    testDeepSeek?: (apiKey: string) => Promise<{
        success: boolean;
        message?: string;
        error?: string;
        status?: number;
        baseUrl?: string;
        model?: string;
        usage?: {
            inputTokens: number;
            outputTokens: number;
        };
    }>;

    // 从某 provider 官方接口拉取最新模型列表（标准化后交合并层处理）
    listProviderModels?: (provider: string) => Promise<{
        success: boolean;
        models: Array<{
            apiModelId: string;
            name?: string;
            declaredKind?: string;
            inputModalities?: string[];
            outputModalities?: string[];
            capabilityNames?: string[];
            supportedMethods?: string[];
            supportsVision?: boolean;
            supportsToolUse?: boolean;
            contextWindow?: number;
        }>;
        error?: string;
        baseUrlUsed?: string;
    }>;

    probeDesignKnowledgeSearxng?: (settings: unknown) => Promise<{
        success: boolean;
        status?: 'disabled' | 'missing_endpoint' | 'ok' | 'unavailable';
        endpoint?: string;
        httpStatus?: number;
        warnings?: string[];
        error?: string;
    }>;

    probeDesignKnowledgeEagleReadonly?: (settings?: {
        enabled?: boolean;
        endpoint?: string;
        timeoutMs?: number;
    }) => Promise<{
        success: boolean;
        status: 'disabled' | 'ok' | 'unavailable';
        endpoint: string;
        app?: unknown;
        aiSearch?: unknown;
        warnings: string[];
        error?: string;
    }>;

    searchEagleReadonlyKnowledge?: (query: {
        query: string;
        limit?: number;
        preferAiSearch?: boolean;
        tags?: string[];
        folders?: string[];
        ext?: string;
        selectedOnly?: boolean;
    }, settings?: {
        enabled?: boolean;
        endpoint?: string;
        timeoutMs?: number;
    }) => Promise<{
        version: 'eagle-readonly-knowledge/v0';
        status: 'disabled' | 'ok' | 'unavailable';
        query: string;
        results: Array<DesignKnowledgeResult & { sourceType: 'eagle_library' | DesignKnowledgeResult['sourceType'] }>;
        providerSummary: {
            eagleLibrary: number;
        };
        warnings: string[];
        boundaries: {
            readonly: true;
            doesNotWriteEagle: true;
            doesNotRunPhotoshop: true;
            doesNotReturnRawImages: true;
            allowedTools: string[];
        };
    }>;

    getEagleReferencePreview?: (request: {
        itemId: string;
        maxSize?: number;
        purpose: 'knowledge_library_ui';
        settings?: {
            enabled?: boolean;
            endpoint?: string;
            timeoutMs?: number;
        };
    }) => Promise<{
        success: boolean;
        status: 'ok' | 'disabled' | 'unavailable' | 'not_found';
        item?: { id: string; title: string; ext?: string };
        preview?: {
            dataUrl: string;
            mimeType: 'image/jpeg';
            width: number;
            height: number;
            maxSize: number;
        };
        warnings: string[];
        error?: string;
        boundaries: {
            uiOnly: true;
            requiresExplicitRequest: true;
            singleItemOnly: true;
            requiredPurpose: 'knowledge_library_ui';
            maxPreviewSize: 512;
            localPathRedacted: true;
            doesNotEnterAgentContext: true;
            doesNotPersist: true;
            doesNotWriteEagle: true;
            doesNotRunPhotoshop: true;
        };
    }>;

    selectEagleLibrary?: (options?: { defaultPath?: string }) => Promise<EagleLibraryOpenResponse>;
    openEagleLibrary?: (
        libraryPath: string,
        forceRefresh?: boolean
    ) => Promise<EagleLibraryOpenResponse>;
    queryEagleLibrary?: (request: EagleLibraryQueryRequest) => Promise<EagleLibraryQueryResponse>;
    getEagleLibraryPreview?: (
        request: EagleLibraryPreviewRequest
    ) => Promise<EagleLibraryPreviewResponse>;
    // P3 Agent 参考与素材：真实视觉观察（回包无本地路径）+ 项目复制（来源追踪）
    observeEagleAsset?: (
        request: { libraryId?: string; itemId?: string; maxSize?: number }
    ) => Promise<unknown>;
    importEagleAssetToProject?: (
        request: { libraryId?: string; itemId?: string; projectPath?: string; targetSubdir?: string }
    ) => Promise<unknown>;
    // P2 双向编辑：Inspector 编辑写回运行中的 Eagle
    executeEagleInspectorWriteback?: (request: {
        itemId?: string;
        baseline?: { tags?: string[]; annotation?: string; rating?: number };
        edits?: { tags?: string[]; annotation?: string; rating?: number };
        userConfirmed?: boolean;
    }) => Promise<{
        success: boolean;
        status: string;
        itemId: string;
        appliedOperations: string[];
        currentValues?: { tags: string[]; annotation: string; rating: number };
        error?: string;
    }>;

    searchDesignKnowledge?: (query: {
        query: string;
        intents?: string[];
        sourceTypes?: string[];
        limit?: number;
    }, settings?: unknown) => Promise<{
        success: boolean;
        query?: string;
        results?: DesignKnowledgeResult[];
        providerSummary?: DesignKnowledgeSearchResponse['providerSummary'];
        warnings?: string[];
        knowledgeUsageSnapshot?: DesignKnowledgeSearchResponse['knowledgeUsageSnapshot'];
        designAgentOs?: DesignAgentOsRecord;
        error?: string;
    }>;

    setModelPreferences?: (prefs: {
        mode?: 'local' | 'cloud' | 'auto';
        primaryModel?: string;
        visualModel?: string;
        autoFallback?: boolean;
        preferredLocalModels?: { layoutAnalysis: string; textOptimize: string; visualAnalyze: string };
        preferredCloudModels?: { layoutAnalysis: string; textOptimize: string; visualAnalyze: string };
        thinking?: { enabled?: boolean };
        // 动态拉取模型快照：随偏好同步通道下发，供主进程冷启动回灌动态模型注册表。
        dynamicModels?: ModelConfig[];
    }) => Promise<void>;

    sendToPlugin: (method: string, params?: any, timeout?: number) => Promise<any>;
    sendToPluginCancellable?: (requestKey: string, method: string, params?: any, timeout?: number) => Promise<any>;
    cancelPluginRequest?: (requestKey: string) => Promise<{ success: boolean; cancelled: boolean; error?: string }>;
    callMcpToolCancellable?: (requestKey: string, name: string, args?: any) => Promise<any>;
    cancelMcpToolRequest?: (requestKey: string) => Promise<{ success: boolean; cancelled: boolean; error?: string }>;
    
    getConnectionStatus: () => Promise<{ connected: boolean }>;

    onPluginConnected: (callback: () => void) => () => void;
    onPluginDisconnected: (callback: () => void) => () => void;
    onPluginMessage: (callback: (message: any) => void) => () => void;

    executeTask: (taskType: string, input: any) => Promise<any>;
    chat: (modelId: string, messages: any[], options?: any) => Promise<any>;
    chatWithTools?: (modelId: string, messages: any[], tools: any[], options?: any) => Promise<any>;
    chatStream?: (params: {
        requestId: string;
        modelId: string;
        messages: Array<{ role: string; content: string }>;
        options?: { maxTokens?: number; temperature?: number; thinkingEnabled?: boolean; timeoutMs?: number };
    }) => Promise<{ success: boolean; error?: string; requestId?: string }>;
    chatWithToolsStream?: (params: {
        requestId: string;
        modelId: string;
        messages: any[];
        tools: any[];
        options?: { maxTokens?: number; temperature?: number; nativeTools?: any[] };
    }) => Promise<{ success: boolean; error?: string; requestId?: string }>;
    abortStream?: (requestId: string) => Promise<{ success: boolean; error?: string }>;
    onStreamChunk?: (callback: (data: { requestId: string; chunk: any }) => void) => () => void;
    
    getAvailableTools: () => { name: string; description: string; parameters: any }[];

    // 模型下载
    downloadModel: (modelId: string, downloadUrl: string, targetPath: string) => Promise<{
        success: boolean;
        modelId?: string;
        path?: string;
        size?: number;
        error?: string;
    }>;
    
    onDownloadProgress: (callback: (progress: DownloadProgress) => void) => () => void;
    
    checkModelExists: (modelPath: string) => Promise<{
        exists: boolean;
        path: string;
    }>;

    // 文件系统操作
    selectFolder: (title?: string) => Promise<string | null>;
    selectFile: (options?: { title?: string; filters?: { name: string; extensions: string[] }[] }) => Promise<string | null>;
    readFile: (path: string, encoding?: string) => Promise<string>;
    readDirectory: (path: string, options?: { recursive?: boolean; filter?: string[] }) => Promise<{
        name: string;
        path: string;
        type: 'file' | 'directory';
        ext?: string;
        size?: number;
    }[] | null>;
    openPath: (path: string) => Promise<void>;
    
    // 日志
    writeLog: (level: 'info' | 'warn' | 'error', message: string, data?: any) => Promise<{ success: boolean }>;
    getRecentLogs: (lines?: number) => Promise<string>;
    getLogPath: () => Promise<string>;
    clearLogs: () => Promise<{ success: boolean }>;
    
    // ===== 素材库管理 =====
    setProjectRoot: (rootPath: string) => Promise<{ success: boolean; projectRoot: string }>;
    getProjectRoot: () => Promise<string | null>;
    scanDirectory: (dirPath?: string, options?: {
        recursive?: boolean;
        includeDesignFiles?: boolean;
        maxDepth?: number;
        generateThumbnails?: boolean;
    }) => Promise<any>;
    searchResources: (query: string, options?: {
        directory?: string;
        type?: 'image' | 'design' | 'all';
        limit?: number;
    }) => Promise<any>;
    getResourceStructure: (directory?: string, maxDepth?: number) => Promise<any>;
    getResourceSummary: (directory?: string) => Promise<{
        totalFiles: number;
        imageCount?: number;
        [key: string]: any;
    }>;
    getResourcesByCategory: (directory?: string) => Promise<{
        products?: any[];
        backgrounds?: any[];
        elements?: any[];
        references?: any[];
        others?: any[];
    }>;
    getResourcePreview: (imagePath: string, maxSize?: number) => Promise<{
        success: boolean;
        base64?: string;
        imageData?: string;
        dimensions?: { width: number; height: number };
        error?: string;
    } | null>;
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
    }) => Promise<{
        success: boolean;
        sheet?: {
            imageData: string;
            mediaType: 'image/jpeg';
            width: number;
            height: number;
            columns: number;
            rows: number;
            tileWidth: number;
            tileHeight: number;
        };
        items: Array<{
            id: string;
            path: string;
            relativePath?: string;
            labelHint?: string;
            role?: string;
            status: 'rendered' | 'failed';
            error?: string;
            box: { x: number; y: number; width: number; height: number };
        }>;
        warnings: string[];
        limitations: string[];
        error?: string;
    }>;
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
    }) => Promise<{
        success: boolean;
        contactSheet: Awaited<ReturnType<Window['designEcho']['createProjectContactSheetOverview']>>;
        observation?: {
            projectStyle?: string;
            productUnderstanding?: string;
            sellingPoints: string[];
            imageRoles: Array<{ id: string; role: string; reason?: string }>;
            nextSingleImageChecks: string[];
            rawText?: string;
        };
        rawText?: string;
        warnings: string[];
        limitations: string[];
        error?: string;
    }>;
    readImageBase64: (imagePath: string) => Promise<string | null>;
    probeImageFile: (imagePath: string) => Promise<{
        success: boolean;
        path: string;
        status: 'ok' | 'missing' | 'not_file' | 'unsupported' | 'decode_failed';
        exists: boolean;
        isFile: boolean;
        byteLength?: number;
        format?: string;
        mimeType?: string;
        dimensions?: { width: number; height: number };
        visualMetrics?: {
            sampleSize: { width: number; height: number };
            nonWhitePixelRatio: number;
            nonWhiteBounds?: {
                x: number;
                y: number;
                width: number;
                height: number;
                centerX: number;
                centerY: number;
                widthRatio: number;
                heightRatio: number;
            };
            edgeOccupancy: { top: number; right: number; bottom: number; left: number };
            averageLuma?: number;
            lumaStdDev?: number;
            darkPixelRatio: number;
            highlightPixelRatio: number;
            shadowLikePixelRatio: number;
            textureContrastScore?: number;
            backgroundColor?: {
                r: number;
                g: number;
                b: number;
                luma: number;
            };
            backgroundDistanceThreshold?: number;
            rawImagesRedacted: true;
        };
        sha256?: string;
        rawImagesRedacted: true;
        error?: string;
    }>;
    compareImageFiles: (referencePath: string, resultPath: string, options?: {
        targetSize?: { width?: number; height?: number };
        thresholds?: {
            maxMae?: number;
            maxHighDeltaRatio?: number;
            minDarkJaccard?: number;
            minSoftDarkJaccard?: number;
            softMaskBlurSigma?: number;
            softMaskDarkThreshold?: number;
        };
    }) => Promise<{
        success: boolean;
        status: 'ok' | 'watch' | 'unverified';
        mode: 'pixel-probe';
        referencePath: string;
        resultPath: string;
        width?: number;
        height?: number;
        mae?: number;
        rmse?: number;
        highDeltaRatio?: number;
        darkJaccard?: number;
        softDarkJaccard?: number;
        softMaskBlurSigma?: number;
        softMaskDarkThreshold?: number;
        referenceDarkPixels?: number;
        resultDarkPixels?: number;
        summary?: string;
        boundary: string;
        rawImagesRedacted: true;
        error?: string;
    }>;
    analyzeAssetContent: (imagePath: string) => Promise<any>;
    analyzeDesignReference: (input: {
        imagePath: string;
        referenceTitle?: string;
        referenceTags?: string[];
        referenceSource?: string;
        topics?: string[];
        cadence?: string;
    }) => Promise<any>;
    recommendAssets: (params: {
        requirement: string;
        maxResults?: number;
        category?: string;
        deterministic?: boolean;
    }) => Promise<any[]>;
    getAssetDetails: (imagePath: string) => Promise<any>;
    
    // ===== Matting 配置 =====
    setMattingSettings: (settings: {
        activeModels?: {
            textGrounding?: string;
            objectDetection?: string;
            segmentation?: string;
            edgeRefine?: string;
        };
    }) => Promise<{ success: boolean }>;
    
    // ===== 模型导入 =====
    importModel: (sourcePath: string, targetModelId: string) => Promise<{
        success: boolean;
        targetPath?: string;
        error?: string;
    }>;
    
    // ===== 形态统一设置 =====
    setMorphingSettings?: (settings: {
        subjectDetectionModel?: 'u2netp' | 'u2net' | 'silueta' | 'isnet' | 'birefnet';
        contourPrecision?: 'fast' | 'balanced' | 'quality';
        scaleThreshold?: number;
        positionThreshold?: number;
    }) => Promise<{ success: boolean }>;
    
    getMorphingSettings?: () => Promise<{
        subjectDetectionModel: string;
        contourPrecision: string;
        scaleThreshold: number;
        positionThreshold: number;
    }>;
    
    // ===== 电商项目管理 =====
    scanEcommerceProject?: (projectPath: string) => Promise<{
        projectPath: string;
        projectName: string;
        folders: any[];
        summary: {
            totalImages: number;
            totalFolders: number;
            byFolderType: Record<string, number>;
            byImageType: Record<string, number>;
        };
        config?: any;
    }>;
    
    updateFolderType?: (projectPath: string, folderName: string, type: string) => Promise<void>;
    updateImageType?: (projectPath: string, imageRelativePath: string, type: string) => Promise<void>;
    loadEcommerceConfig?: (projectPath: string) => Promise<any>;
    saveEcommerceConfig?: (projectPath: string, config: any) => Promise<void>;
    buildProjectContextSnapshot?: (options: string | {
        projectPath: string;
        projectName?: string;
        currentDocument?: any;
        selectedAssetPaths?: string[];
        userConstraints?: string[];
        taskHistory?: string[];
        unverifiedItems?: string[];
        visualSamplingScenario?: ProjectVisualSamplingScenario;
        maxVisualSamples?: number;
        visualSamplingCache?: ProjectVisualSamplingCacheEntry[];
        usePersistedVisualInsightCache?: boolean;
    }) => Promise<{
        success: true;
        source: 'runtime-project-service';
        projectPath: string;
        projectName: string;
        contextSnapshot: ContextSnapshot;
        assetIndex: ProjectAssetIndex;
        visualSamplingPlan: ProjectVisualSamplingPlan;
        visualInsightCache: ProjectVisualInsightCacheReadResult;
        warnings: string[];
        limitations: string[];
    }>;
    writeProjectVisualInsightCache?: (options: {
        projectPath: string;
        entries: ProjectVisualSamplingCacheEntry[];
        replace?: boolean;
        nowIso?: string;
    }) => Promise<{
        success: true;
        source: 'runtime-project-service';
        cachePath: string;
        manifest: any;
        readResult: ProjectVisualInsightCacheReadResult;
    }>;
    /** 只读项目级视觉理解缓存（.designecho/visual-insights-cache.json；不扫描项目、不初始化配置）。 */
    readProjectVisualInsightCache?: (options: { projectPath: string } | string) => Promise<ProjectVisualInsightCacheReadResult>;
    
    // ===== 项目索引进度 =====
    onProjectIndexProgress?: (callback: (data: { projectId: string; current: number; total: number; phase?: 'project' | 'file'; fileName?: string }) => void) => () => void;

    // ===== Debug Bridge 运行窗口调试 =====
    onDebugBridgeChatSubmit?: (callback: (request: {
        requestId: string;
        text: string;
        timeoutMs?: number;
        resetConversation?: boolean;
        publicPlanConfirmationSourceMessageId?: string;
        publicPlanDisposableLiveAdapter?: boolean;
    }) => Promise<any>) => () => void;

    // ===== 通用 IPC 调用 =====
    invoke: (channel: string, ...args: any[]) => Promise<any>;
    
    // ===== BFL (Black Forest Labs) 图片生成 =====
    bfl: {
        // 文生图: (model, prompt, options)
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
        ) => Promise<{
            success: boolean;
            data?: { id: string; url: string; width: number; height: number };
            error?: string;
        }>;
        
        // 图生图: (model, prompt, inputImage, options)
        image2image: (
            model: string,
            prompt: string,
            inputImage: string,  // base64
            options?: {
                width?: number;
                height?: number;
                additionalImages?: string[];
            }
        ) => Promise<{
            success: boolean;
            data?: { id: string; url: string; width: number; height: number };
            error?: string;
        }>;
        
        // 局部重绘: (prompt, inputImage, maskImage, options)
        inpaint: (
            prompt: string,
            inputImage: string,  // base64
            maskImage: string,   // base64
            options?: {
                width?: number;
                height?: number;
            }
        ) => Promise<{
            success: boolean;
            data?: { id: string; url: string; width: number; height: number };
            error?: string;
        }>;
        
        // 下载图像
        downloadImage: (url: string) => Promise<{
            success: boolean;
            data?: string;  // base64
            error?: string;
        }>;
        
        // 测试 API Key
        testApiKey: (apiKey: string) => Promise<{
            success: boolean;
            error?: string;
        }>;
        
        // 检查是否已配置 API Key
        hasApiKey: () => Promise<boolean>;
    };

    captureAgentWindowScreenshot?: () => Promise<{
        success: boolean;
        imageBase64?: string;
        mimeType?: string;
        source?: string;
        error?: string;
    }>;

    captureDesktopScreenshot?: () => Promise<{
        success: boolean;
        imageBase64?: string;
        mimeType?: string;
        source?: string;
        error?: string;
    }>;

    testBflApi?: () => Promise<{ success: boolean; error?: string }>;
}

type ChatTestBridgeMessageSnapshot = {
    id: string;
    role: string;
    contentPreview: string;
    hasImage: boolean;
    thinkingStepCount: number;
    publicPlanRawStatus?: string;
    publicPlanProposedWriteTools?: string[];
    publicPlanAllowedWriteTools?: string[];
    publicPlanReadbackTargets?: string[];
    publicPlanOperationCount?: number;
    toolResultCount: number;
    conversationalFailureKind?: string;
    conversationalFailureAttempts?: Array<{
        purpose: string;
        status: string;
        errorKind?: string;
        reason?: string;
    }>;
};

type ChatTestBridgeSnapshot = {
    isLoading: boolean;
    messageCount: number;
    messages: ChatTestBridgeMessageSnapshot[];
};

declare global {
    interface Window {
        designEcho: DesignEchoAPI;
        __DESIGNECHO_CHAT_TEST_BRIDGE__?: {
            version: number;
            submit: (
                text: string,
                options?: {
                    image?: { data: string; type: string };
                    timeoutMs?: number;
                }
            ) => Promise<ChatTestBridgeSnapshot>;
            getSnapshot: () => ChatTestBridgeSnapshot;
            resetConversation?: () => ChatTestBridgeSnapshot;
            waitForIdle: (timeoutMs?: number) => Promise<ChatTestBridgeSnapshot>;
        };
    }
}
