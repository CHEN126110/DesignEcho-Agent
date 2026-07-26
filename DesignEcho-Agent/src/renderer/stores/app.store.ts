/**
 * 应用状态管理
 */

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { TextSuggestion } from '../components/SuggestionList';
import { LayoutAnalysisResult } from '../components/LayoutFixList';
import type { AgentExecutionSummary } from '../services/agent-runtime/types';
import type { AgentRequestLifecycleRecord } from '../../shared/agent-request-lifecycle';
import type { AgentDiagnosticRecord } from '../../shared/agent-diagnostic-record';
import {
    isAgentResponseInterruptionSentinelContent,
    resolveAgentResponseInterruption,
    type AgentResponseInterruption
} from '../../shared/agent-response-interruption';
import type { BusinessSkillVisualObservationFeedback } from '../../shared/business-skill-visual-observation-feedback';
import type { SkuDeliverySummary } from '../../shared/sku-delivery-summary';
import type {
    InteractiveCardDefinition,
    InteractiveCardSubmission
} from '../../shared/interactive-card-contract';
import type { PendingInteractiveContinuation } from '../../shared/pending-interactive-continuation';
import {
    uiStatusReplyOrigin,
    type AssistantReplyOrigin
} from '../../shared/assistant-reply-origin';
import type { AgentTaskPlanningContract } from '../../shared/agent-task-planning-contract';
import {
    shouldAcceptAgentTaskPlanPresentationUpdate,
    type AgentTaskPlanPresentation
} from '../../shared/agent-task-plan-presentation';
import type {
    AgentTaskPublicPlanExecutionPlanLike,
    AgentTaskPublicPlanExecutionRequest
} from '../../shared/agent-task-public-plan-execution-request';
import { stripRuntimeParamsFromPublicPlanExecutionRequest } from '../../shared/agent-task-public-plan-execution-request';
import type { AgentTaskPublicPlanApprovalRecord } from '../../shared/agent-task-public-plan-approval-record';
import type { AgentTaskPublicPlanControlledRun } from '../../shared/agent-task-public-plan-controlled-runner';
import { stripRuntimeParamsFromPublicPlanControlledRun } from '../../shared/agent-task-public-plan-controlled-runner';
import { sanitizeUserVisibleAssistantBodyText } from '../../shared/chat-response-cleaner';
import {
    DEFAULT_DESIGN_KNOWLEDGE_SETTINGS,
    normalizeDesignKnowledgeSettings,
    type DesignKnowledgeRuntimeSettings
} from '../../shared/design-knowledge-settings';

// 从统一配置导入
import {
    DEFAULT_MODEL_PREFERENCES,
    getModelsByProvider,
    normalizeModelPreferences,
    type ModelConfig,
    type ModelProvider,
    type ModelPreferences,
    type ModelPreferencesPatch
} from '../../shared/config/models.config';
import { setDynamicModels } from '../../shared/config/dynamic-model-registry';
import { normalizeDynamicModelUsageConfig } from '../../shared/config/provider-model-merge';
import { SKILL_REGISTRY } from '../../shared/skills/skill-declarations';
import type { DesignDimensionSpec } from '../../shared/design-dimension-spec';

// 抠图使用本地 ONNX 模型（BiRefNet + YOLO-World）

// 思维步骤类型（与 ThinkingProcess 组件同步）
interface ThinkingStepData {
    id: string;
    type: 'thinking' | 'status' | 'tool_call' | 'tool_result' | 'decision' | 'reading' | 'exploring' | 'analyzing';
    content: string;
    toolName?: string;
    toolParams?: any;
    toolResult?: any;
    status: 'pending' | 'running' | 'success' | 'error';
    timestamp: number;
    duration?: number;
    // 扩展字段（专业显示）
    filePath?: string;     // 正在读取的文件路径
    lineRange?: string;    // 读取的行范围 (如 "L1-150")
}

interface Message {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    timestamp: number;
    suggestions?: TextSuggestion[];
    layoutResult?: LayoutAnalysisResult;
    copyResult?: CopyGenerationResult;
    // 思维链相关
    isThinking?: boolean;
    thinkingSteps?: ThinkingStepData[];
    executionSummary?: AgentExecutionSummary;
    assistantReplyOrigin?: AssistantReplyOrigin;
    agentResponseInterruption?: AgentResponseInterruption;
    agentRequestLifecycle?: AgentRequestLifecycleRecord;
    agentDiagnosticRecord?: AgentDiagnosticRecord;
    businessVisualObservationFeedback?: BusinessSkillVisualObservationFeedback;
    agentTaskPlan?: AgentTaskPlanningContract;
    agentTaskPlanPresentation?: AgentTaskPlanPresentation;
    agentTaskPublicPlan?: AgentTaskPublicPlanExecutionPlanLike;
    agentTaskPublicPlanExecutionRequest?: AgentTaskPublicPlanExecutionRequest;
    agentTaskPublicPlanApprovalRecord?: AgentTaskPublicPlanApprovalRecord;
    agentTaskPublicPlanControlledRun?: AgentTaskPublicPlanControlledRun;
    skuDeliverySummary?: SkuDeliverySummary;
    interactiveCards?: InteractiveCardDefinition[];
    interactiveCardSubmissions?: InteractiveCardSubmission[];
    pendingInteractiveContinuation?: PendingInteractiveContinuation;
    conversationalModelFailure?: any;
    // 附带图片（用于视觉分析）
    image?: { data: string; type: string };
}
// 卖点文案生成结果
interface CopyGenerationResult {
    analysis?: {
        designType?: string;
        productType?: string;
        targetAudience?: string;
    };
    copies?: {
        style: string;
        headline: string;
        subheadline?: string;
        cta?: string;
        explanation?: string;
    }[];
}

// 对话会话
interface Conversation {
    id: string;
    title: string;
    createdAt: number;
    updatedAt: number;
    messages: Message[];
}

function normalizeAssistantReplyOriginForPersistence(message: Partial<Message>): AssistantReplyOrigin | undefined {
    if (message.role !== 'assistant') return message.assistantReplyOrigin;
    return message.assistantReplyOrigin || uiStatusReplyOrigin('store:assistant-message:missing-origin');
}

function sanitizeMessageForPersistence<T extends Partial<Message>>(message: T): T {
    const sanitizedContent = message.role === 'assistant' && typeof message.content === 'string'
        ? sanitizeUserVisibleAssistantBodyText(message.content)
        : message.content;
    const assistantReplyOrigin = normalizeAssistantReplyOriginForPersistence(message);
    const agentResponseInterruption = resolveAgentResponseInterruption({
        interruption: message.agentResponseInterruption,
        assistantReplyOrigin,
        content: sanitizedContent
    });
    const content = agentResponseInterruption
        && isAgentResponseInterruptionSentinelContent(sanitizedContent)
        ? ''
        : sanitizedContent;

    return {
        ...message,
        content,
        assistantReplyOrigin,
        agentResponseInterruption,
        agentTaskPublicPlanExecutionRequest: stripRuntimeParamsFromPublicPlanExecutionRequest(
            message.agentTaskPublicPlanExecutionRequest
        ),
        agentTaskPublicPlanControlledRun: stripRuntimeParamsFromPublicPlanControlledRun(
            message.agentTaskPublicPlanControlledRun
        )
    };
}

function hasMeaningfulAssistantPayload(message: Partial<Message>): boolean {
    return Boolean(
        message.image
        || message.layoutResult
        || message.copyResult
        || message.executionSummary
        || message.businessVisualObservationFeedback
        || message.agentTaskPlanPresentation
        || message.agentTaskPublicPlan
        || message.agentTaskPublicPlanExecutionRequest
        || message.agentTaskPublicPlanApprovalRecord
        || message.agentTaskPublicPlanControlledRun
        || message.skuDeliverySummary
        || (Array.isArray(message.interactiveCards) && message.interactiveCards.length > 0)
        || (Array.isArray(message.interactiveCardSubmissions) && message.interactiveCardSubmissions.length > 0)
        || Boolean(message.pendingInteractiveContinuation)
        || Boolean(message.agentResponseInterruption)
        || (Array.isArray(message.suggestions) && message.suggestions.length > 0)
        || (Array.isArray(message.thinkingSteps) && message.thinkingSteps.length > 0)
    );
}

function shouldKeepSanitizedMessage(message: Partial<Message>): boolean {
    if (message.role !== 'assistant') return true;
    if (typeof message.content === 'string' && message.content.trim()) return true;
    return hasMeaningfulAssistantPayload(message);
}

function sanitizeConversationForPersistence(conversation: Conversation): Conversation {
    return {
        ...conversation,
        messages: conversation.messages
            .map((message) => sanitizeMessageForPersistence(message) as Message)
            .filter(shouldKeepSanitizedMessage)
    };
}

function sanitizeConversationsForPersistence(conversations: Conversation[]): Conversation[] {
    return conversations.map(sanitizeConversationForPersistence);
}

interface ApiKeys {
    anthropic?: string;
    google?: string;           // Google AI Studio 官方 API Key
    xiaomi?: string;           // Xiaomi MiMo 官方 API Key
    openai?: string;
    gptsapi?: string;          // GPTs API 中转平台 API Key
    openrouter?: string;       // OpenRouter 中转平台 API Key
    deepseek?: string;         // DeepSeek 官方 API Key
    ollamaUrl?: string;
    ollamaApiKey?: string;     // Ollama Cloud API Key
    bfl?: string;              // Black Forest Labs (FLUX) API Key
    volcengineJimengAccessKeyId?: string;      // 即梦AI OpenAPI Access Key ID
    volcengineJimengSecretAccessKey?: string;  // 即梦AI OpenAPI Secret Access Key
    volcengineSeedreamApiKey?: string;         // Seedream 图生图 API Key
    volcengineTosRegion?: string;              // TOS Region
    volcengineTosEndpoint?: string;            // TOS Endpoint
    volcengineTosBucket?: string;              // TOS Bucket
    volcengineTosPublicBaseUrl?: string;       // TOS 公网访问前缀
    volcengineTosKeyPrefix?: string;           // TOS 对象前缀
}

// 模型模式
export type ModelMode = 'local' | 'cloud' | 'auto';

// 任务类型
export type TaskCategory = 'layoutAnalysis' | 'textOptimize' | 'visualAnalyze';

// 任务模型配置
export interface TaskModelConfig {
    layoutAnalysis: string;
    textOptimize: string;
    visualAnalyze: string;
}

// 自定义模型配置
export interface CustomModel {
    id: string;                          // 唯一标识
    name: string;                        // 显示名称
    provider: 'openrouter' | 'openai' | 'anthropic' | 'google' | 'xiaomi' | 'deepseek' | 'custom';
    modelId: string;                     // 实际模型 ID (如 anthropic/claude-3.5-sonnet)
    category: TaskCategory;              // 适用的任务类别
    apiEndpoint?: string;                // 自定义 API 端点 (可选)
    apiKey?: string;                     // 单独的 API Key (可选，优先于全局)
    description?: string;                // 描述
    isActive: boolean;                   // 是否激活
    createdAt: number;
}

export interface SkillToggleConfig {
    enabled: boolean;
}

export interface MCPServerConfig {
    id: string;
    name: string;
    transport: 'stdio' | 'http';
    enabled: boolean;
    command?: string;
    args?: string[];
    url?: string;
    notes?: string;
}

export interface IntegrationSettings {
    skills: Record<string, SkillToggleConfig>;
    mcpServers: MCPServerConfig[];
}

// Worker 类型（新架构）
export type WorkerType = 'vision' | 'design' | 'executor';

// Worker 配置
export interface WorkerModelConfig {
    modelId: string;
    enabled: boolean;
}

// Orchestrator 模型配置（新架构）
export interface OrchestratorModelConfig {
    /** 主规划模型 */
    primaryModel: string;
    /** 备用模型 */
    fallbackModel: string;
    /** Workers 模型配置 */
    workers: {
        vision: WorkerModelConfig;
        design: WorkerModelConfig;
        executor: WorkerModelConfig;
    };
}

// 模型偏好设置从统一模型配置导入，避免设置页、调度层和请求层各自维护一份结构。

// 智能分割阶段类型
export type SegmentationStage = 
    | 'textGrounding'    // 文本定位：理解用户输入，定位目标区域
    | 'objectDetection'  // 目标检测：检测图像中的所有对象
    | 'segmentation'     // 精确分割：生成精确的分割蒙版
    | 'edgeRefine';      // 边缘细化：优化分割边缘

// 分割模型配置
export interface SegmentationModelConfig {
    id: string;
    name: string;
    stage: SegmentationStage;
    type: 'local' | 'cloud' | 'builtin';  // 支持内置算法（无需下载）
    modelPath?: string;           // 本地模型路径（相对于 models 目录）
    modelDir?: string;            // 模型目录名（用于状态识别）
    apiEndpoint?: string;         // 云端 API 端点
    downloadUrl?: string;         // 模型下载地址
    fallbackUrls?: string[];      // 备用下载地址（主链接失败时尝试）
    size?: string;                // 模型大小
    isDownloaded?: boolean;       // 是否已下载
    isActive: boolean;            // 是否激活
    description?: string;
    capabilities?: string[];      // 模型能力标签
    isSkipOption?: boolean;       // 是否为跳过选项
    reusesModel?: string;         // 复用其他模型（指向另一个配置 ID）
}

// 兼容旧类型
export type MattingStage = SegmentationStage | 'sceneAnalysis' | 'saliency' | 'geometry';
export type MattingModelConfig = SegmentationModelConfig;

// 智能分割设置
export interface SegmentationSettings {
    mode: 'local';  // 只使用本地 AI 模型
    // 各阶段激活的模型
    activeModels: {
        textGrounding: string;   // 文本定位模型
        objectDetection: string; // 目标检测模型
        segmentation: string;    // 分割模型
        edgeRefine: string;      // 边缘细化模型
    };
    // 可用的模型列表
    availableModels: SegmentationModelConfig[];
}

// 兼容旧类型
export type MattingSettings = SegmentationSettings & {
    localServiceUrl?: string;
};

// ========== 形态统一设置 ==========
export interface MorphingSettings {
    // 主体检测模型（用于识别图片中的主体边界）
    subjectDetectionModel: 'u2netp' | 'u2net' | 'isnet' | 'birefnet' | 'silueta';
    // 轮廓匹配精度
    contourPrecision: 'fast' | 'balanced' | 'quality';
    // 缩放阈值（差异小于此百分比时不执行缩放）
    scaleThreshold: number;
    // 位置偏移阈值（差异小于此像素时不执行移动）
    positionThreshold: number;
}

// 项目信息
export interface ProjectInfo {
    id: string;
    name: string;
    path: string;
    createdAt: number;
    lastOpenedAt: number;
    folders: {
        assets?: string;      // 素材文件夹
        psd?: string;         // PSD 文件夹
        output?: string;      // 输出文件夹
    };
    thumbnail?: string;       // 项目缩略图
}

// ===== 电商项目类型 =====

/** 文件夹类型 */
export type FolderType = 
    | 'source'      // 拍摄图/素材
    | 'psd'         // PSD 源文件
    | 'mainImage'   // 主图输出
    | 'detail'      // 详情页输出
    | 'sku'         // SKU 图输出
    | 'unknown';    // 未识别

/** 图片类型 */
export type ImageType = 
    | 'product'     // 产品图（SKU）
    | 'model'       // 模特图
    | 'detail'      // 细节图
    | 'scene'       // 场景图
    | 'package'     // 包装图
    | 'material'    // 材质图
    | 'psd'         // PSD/PSB 设计文件
    | 'design'      // AI/EPS/SVG 设计文件
    | 'video'       // 视频文件
    | 'unknown';    // 未识别

/** 图片文件信息 */
export interface ImageFile {
    name: string;
    path: string;
    relativePath: string;
    size: number;
    ext: string;
    type: ImageType;
    width?: number;
    height?: number;
    aspectRatio?: number;
    thumbnailPath?: string;
    parentFolder: string;
    folderType: FolderType;
}

/** 文件夹信息（支持树形结构） */
export interface FolderInfo {
    name: string;
    path: string;
    relativePath: string;
    type: FolderType;
    depth: number;                  // 层级深度
    imageCount: number;             // 当前文件夹的图片数
    totalImageCount: number;        // 包含子文件夹的总图片数
    images: ImageFile[];
    children: FolderInfo[];         // 子文件夹
}

/** 电商项目结构 */
export interface EcommerceProjectStructure {
    projectPath: string;
    projectName: string;
    folders: FolderInfo[];
    summary: {
        totalImages: number;
        totalFolders: number;
        byFolderType: Record<FolderType, number>;
        byImageType: Record<ImageType, number>;
    };
}

type ThemeMode = 'light' | 'dark' | 'system';

interface AppState {
    // 主题设置
    theme: ThemeMode;
    setTheme: (theme: ThemeMode) => void;

    // 连接状态
    isPluginConnected: boolean;
    setPluginConnected: (connected: boolean) => void;

    // 停止生成
    abortController: AbortController | null;
    setAbortController: (controller: AbortController | null) => void;
    stopGeneration: () => void;

    // 项目管理
    currentProject: ProjectInfo | null;
    recentProjects: ProjectInfo[];
    setCurrentProject: (project: ProjectInfo | null) => void;
    addRecentProject: (project: ProjectInfo) => void;
    removeRecentProject: (id: string) => void;
    
    // 电商项目结构
    ecommerceStructure: EcommerceProjectStructure | null;
    setEcommerceStructure: (structure: EcommerceProjectStructure | null) => void;

    // API Keys
    apiKeys: ApiKeys;
    setApiKeys: (keys: ApiKeys) => void;

    // 模型偏好
    modelPreferences: ModelPreferences;
    setModelPreferences: (prefs: ModelPreferencesPatch) => void;
    setModelMode: (mode: ModelMode) => void;

    // 设计尺寸规范（用户可覆盖，默认预设；消费方经 normalizeDesignDimensionSpec 读取）
    designDimensionSpec: Partial<DesignDimensionSpec>;
    setDesignDimensionSpec: (spec: Partial<DesignDimensionSpec>) => void;
    resetDesignDimensionSpec: () => void;

    // 动态拉取的模型（从 provider 官方接口获取的完整 ModelConfig，含正确 apiModelId）。
    // 持久化后经 setDynamicModels 注入进程内注册表，让 getModelById 能查到带点 apiModelId。
    dynamicModels: ModelConfig[];
    upsertDynamicModels: (provider: ModelProvider, models: ModelConfig[]) => void;

    // 自定义模型管理
    customModels: CustomModel[];
    addCustomModel: (model: Omit<CustomModel, 'id' | 'createdAt'>) => string;
    updateCustomModel: (id: string, updates: Partial<CustomModel>) => void;
    deleteCustomModel: (id: string) => void;
    setActiveModel: (category: TaskCategory, modelId: string) => void;
    getModelsForCategory: (category: TaskCategory) => CustomModel[];

    // 对话列表（项目级别隔离）
    projectConversations: Record<string, Conversation[]>;  // 项目ID -> 对话列表
    conversations: Conversation[];  // 当前项目的对话（兼容旧代码）
    currentConversationId: string | null;
    createConversation: () => string;
    deleteConversation: (id: string) => void;
    switchConversation: (id: string) => void;
    updateConversationTitle: (id: string, title: string) => void;
    
    // 项目对话管理
    saveCurrentProjectConversations: () => void;  // 保存当前项目对话
    loadProjectConversations: (projectId: string) => void;  // 加载项目对话

    // 当前对话的消息
    messages: Message[];
    addMessage: (message: Omit<Message, 'id' | 'timestamp'> & { layoutResult?: LayoutAnalysisResult }) => string;  // 返回新消息 ID
    addMessageToConversation: (conversationId: string, message: Omit<Message, 'id' | 'timestamp'> & { layoutResult?: LayoutAnalysisResult }) => string;
    removeLastMessage: () => void;
    updateLastMessage: (content: string) => void;  // 更新最后一条消息内容
    updateMessage: (messageId: string, updates: Partial<Omit<Message, 'id' | 'timestamp'>>) => void;  // 按 ID 更新消息
    updateMessageInConversation: (conversationId: string, messageId: string, updates: Partial<Omit<Message, 'id' | 'timestamp'>>) => boolean;
    clearMessages: () => void;
    
    // 消息编辑
    editMessage: (messageId: string, newContent: string) => void;
    removeMessagesFrom: (messageId: string) => string | null;  // 返回被删除消息的内容

    // 当前任务
    currentTask: string | null;
    setCurrentTask: (task: string | null) => void;

    // 加载状态
    isLoading: boolean;
    setLoading: (loading: boolean) => void;

    // 抠图设置
    mattingSettings: MattingSettings;
    setMattingSettings: (settings: Partial<MattingSettings>) => void;
    setMattingMode: (mode: MattingSettings['mode']) => void;
    setActiveMattingModel: (stage: MattingStage, modelId: string) => void;
    addMattingModel: (model: Omit<MattingModelConfig, 'id'>) => string;
    updateMattingModel: (id: string, updates: Partial<MattingModelConfig>) => void;
    deleteMattingModel: (id: string) => void;

    // 形态统一设置
    morphingSettings: MorphingSettings;
    setMorphingSettings: (settings: Partial<MorphingSettings>) => void;


    // Integrations
    integrationSettings: IntegrationSettings;
    setIntegrationSettings: (settings: Partial<IntegrationSettings>) => void;

    // 设计知识设置
    designKnowledgeSettings: DesignKnowledgeRuntimeSettings;
    setDesignKnowledgeSettings: (settings: Partial<DesignKnowledgeRuntimeSettings>) => void;

    // 模型状态管理
    ollamaStatus: 'unknown' | 'online' | 'offline';
    installedOllamaModels: string[];
    setOllamaStatus: (status: 'unknown' | 'online' | 'offline') => void;
    setInstalledOllamaModels: (models: string[]) => void;
    checkAllModelsStatus: () => Promise<void>;
}

// 默认模型偏好 - 从统一配置导入
const defaultModelPreferences: ModelPreferences = normalizeModelPreferences(DEFAULT_MODEL_PREFERENCES);

function normalizePersistedDynamicModels(value: unknown): ModelConfig[] {
    if (!Array.isArray(value)) return [];
    return value
        .filter((model): model is ModelConfig => (
            !!model
            && typeof model === 'object'
            && typeof model.id === 'string'
            && model.id.trim().length > 0
            && typeof model.apiModelId === 'string'
            && model.apiModelId.trim().length > 0
        ))
        .map(normalizeDynamicModelUsageConfig);
}

function migrateRetiredXiaomiMimoModels(cloudModels?: TaskModelConfig): boolean {
    if (!cloudModels) return false;
    let changed = false;
    for (const key of Object.keys(cloudModels)) {
        const current = (cloudModels as any)[key];
        if (current === 'xiaomi-mimo-v2-pro') {
            (cloudModels as any)[key] = 'xiaomi-mimo-v2.5-pro';
            changed = true;
        }
        if (current === 'openrouter-mimo-v2-pro') {
            (cloudModels as any)[key] = 'openrouter-mimo-v2.5-pro';
            changed = true;
        }
        if (current === 'xiaomi-mimo-v2' || current === 'xiaomi-mimo-v2-omni') {
            (cloudModels as any)[key] = 'xiaomi-mimo-v2.5';
            changed = true;
        }
        if (current === 'openrouter-mimo-v2' || current === 'openrouter-mimo-v2-omni') {
            (cloudModels as any)[key] = 'openrouter-mimo-v2.5';
            changed = true;
        }
    }
    return changed;
}

const createDefaultSkillToggles = (): Record<string, SkillToggleConfig> =>
    Object.fromEntries(SKILL_REGISTRY.map((skill) => [skill.id, { enabled: true }]));

const normalizeIntegrationSettings = (settings?: Partial<IntegrationSettings> | null): IntegrationSettings => {
    const skillDefaults = createDefaultSkillToggles();
    const providedSkills = settings?.skills || {};
    const skills = Object.fromEntries(
        Object.keys(skillDefaults).map((skillId) => [
            skillId,
            { enabled: providedSkills[skillId]?.enabled !== false }
        ])
    );

    const mcpServers = Array.isArray(settings?.mcpServers)
        ? settings!.mcpServers
            .filter((server): server is MCPServerConfig => !!server && typeof server.id === 'string' && typeof server.name === 'string')
            .map((server): MCPServerConfig => ({
                id: server.id,
                name: server.name,
                transport: server.transport === 'http' ? 'http' : 'stdio',
                enabled: server.enabled !== false,
                command: server.command || '',
                args: Array.isArray(server.args) ? server.args.map((arg) => String(arg)) : [],
                url: server.url || '',
                notes: server.notes || ''
            }))
        : [];

    return { skills, mcpServers };
};

const defaultIntegrationSettings: IntegrationSettings = normalizeIntegrationSettings();
const defaultDesignKnowledgeSettings: DesignKnowledgeRuntimeSettings = normalizeDesignKnowledgeSettings(
    DEFAULT_DESIGN_KNOWLEDGE_SETTINGS
);

// 预设智能分割模型列表（本地 ONNX）
const presetSegmentationModels: SegmentationModelConfig[] = [];

// 默认激活模型配置（本地 ONNX）
const DEFAULT_ACTIVE_MODELS = {
    textGrounding: 'grounding-skip',      // 跳过（直接使用目标检测）
    objectDetection: 'yolo-world',        // YOLO-World
    segmentation: 'birefnet',             // BiRefNet
    edgeRefine: 'none'                    // 本地暂无边缘细化
};

// 默认智能分割设置
const defaultMattingSettings: MattingSettings = {
    mode: 'local',
    activeModels: DEFAULT_ACTIVE_MODELS,
    availableModels: presetSegmentationModels
};

// 默认形态统一设置
const defaultMorphingSettings: MorphingSettings = {
    subjectDetectionModel: 'u2netp',  // 默认使用轻量模型，速度快
    contourPrecision: 'balanced',
    scaleThreshold: 5,      // 缩放差异小于 5% 时不执行
    positionThreshold: 2    // 位置差异小于 2px 时不执行
};

// 默认项目 ID（没有打开项目时使用）
const DEFAULT_PROJECT_ID = '__default__';

// 创建默认对话
const createDefaultConversation = (): Conversation => ({
    id: crypto.randomUUID(),
    title: '新对话',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messages: []
});

// 获取当前项目 ID（用于对话隔离）
const getProjectId = (project: ProjectInfo | null): string => {
    return project?.id || DEFAULT_PROJECT_ID;
};

interface ConversationOwner {
    projectId: string;
    conversations: Conversation[];
    conversation: Conversation;
    isActiveProject: boolean;
}

/**
 * Resolve the project that owns a conversation before applying an async run update.
 * A run may finish after the user has switched projects; conversationId, rather than
 * the currently visible project, is therefore the resource identity for the write.
 */
function resolveConversationOwner(input: {
    conversationId: string;
    activeProjectId: string;
    activeConversations: Conversation[];
    projectConversations: Record<string, Conversation[]>;
}): ConversationOwner | undefined {
    const activeConversation = input.activeConversations.find(
        (conversation) => conversation.id === input.conversationId
    );
    if (activeConversation) {
        return {
            projectId: input.activeProjectId,
            conversations: input.activeConversations,
            conversation: activeConversation,
            isActiveProject: true
        };
    }

    for (const [projectId, conversations] of Object.entries(input.projectConversations)) {
        if (projectId === input.activeProjectId) continue;
        const conversation = conversations.find((item) => item.id === input.conversationId);
        if (!conversation) continue;
        return {
            projectId,
            conversations,
            conversation,
            isActiveProject: false
        };
    }
    return undefined;
}

// ===== 对话文件持久化 =====
// 每个项目独立防抖；A 项目的高频流式更新不能取消 B 项目的保存。
const _conversationSaveTimers = new Map<string, ReturnType<typeof setTimeout>>();
const _conversationMutationRevisions = new Map<string, number>();
const _dirtyConversationProjects = new Set<string>();
const CONVERSATION_SAVE_DELAY = 2000; // 2 秒防抖

function markConversationMutation(projectId: string): number {
    const nextRevision = (_conversationMutationRevisions.get(projectId) || 0) + 1;
    _conversationMutationRevisions.set(projectId, nextRevision);
    return nextRevision;
}

function getConversationMutationRevision(projectId: string): number {
    return _conversationMutationRevisions.get(projectId) || 0;
}

function mergeConversationCollections(persisted: Conversation[], local: Conversation[]): Conversation[] {
    const localIds = new Set(local.map((conversation) => conversation.id));
    return sanitizeConversationsForPersistence([
        ...local,
        ...persisted.filter((conversation) => !localIds.has(conversation.id))
    ]);
}

/**
 * 防抖保存当前项目对话到文件
 * 在对话内容变更后调用，2 秒内没有新变更时执行实际保存
 */
function debouncedSaveConversations(projectId: string, conversations: Conversation[]) {
    const revision = markConversationMutation(projectId);
    _dirtyConversationProjects.add(projectId);
    const existingTimer = _conversationSaveTimers.get(projectId);
    if (existingTimer) {
        clearTimeout(existingTimer);
    }
    const timer = setTimeout(() => {
        if (_conversationSaveTimers.get(projectId) !== timer) return;
        _conversationSaveTimers.delete(projectId);
        if (typeof window === 'undefined') return;
        const designEcho = (window as any).designEcho;
        if (designEcho?.invoke) {
            designEcho.invoke('conversation:save', projectId, sanitizeConversationsForPersistence(conversations))
                .then((r: any) => {
                    if (!r?.success) {
                        console.error('[Store] 对话保存失败:', r?.error);
                        return;
                    }
                    if (getConversationMutationRevision(projectId) === revision) {
                        _dirtyConversationProjects.delete(projectId);
                    }
                })
                .catch((e: any) => console.error('[Store] 对话保存异常:', e));
        }
    }, CONVERSATION_SAVE_DELAY);
    _conversationSaveTimers.set(projectId, timer);
}

/**
 * 立即保存（用于项目切换、窗口关闭等场景）
 */
function flushSaveConversations(projectId: string, conversations: Conversation[]) {
    const existingTimer = _conversationSaveTimers.get(projectId);
    if (existingTimer) {
        clearTimeout(existingTimer);
        _conversationSaveTimers.delete(projectId);
    }
    if (!_dirtyConversationProjects.has(projectId)) return;
    if (typeof window === 'undefined') return;
    const designEcho = (window as any).designEcho;
    if (designEcho?.invoke) {
        const revision = getConversationMutationRevision(projectId);
        designEcho.invoke('conversation:save', projectId, sanitizeConversationsForPersistence(conversations))
            .then((r: any) => {
                if (!r?.success) {
                    console.error('[Store] 对话保存失败:', r?.error);
                    return;
                }
                if (getConversationMutationRevision(projectId) === revision) {
                    _dirtyConversationProjects.delete(projectId);
                }
            })
            .catch((e: any) => console.error('[Store] 对话保存异常:', e));
    }
}

/**
 * 校验持久化字符串是合法 JSON；损坏（断电写半截/配额截断/迁移异常）则返回 null（走默认值），
 * 避免 zustand 水合期 JSON.parse 同步抛错 → 阻断 app.store 模块导入 → React 整树不挂载 → 黑屏。
 */
function validatePersistedJson(raw: string | null): string | null {
    if (raw == null) return null;
    try {
        JSON.parse(raw);
        return raw;
    } catch {
        console.warn('[Store] 持久化数据 JSON 损坏，丢弃并走默认值');
        return null;
    }
}

const persistedStorage = createJSONStorage(() => ({
    getItem: (name: string) => {
        if (typeof window === 'undefined') return null;
        const designEcho = (window as any).designEcho;
        const hasBridge = !!designEcho?.getPersistedValueSync;
        if (hasBridge) {
            try {
                const result = designEcho.getPersistedValueSync(name);
                if (result?.success && typeof result.value === 'string') {
                    console.log(`[Store] IPC 读取成功: key="${name}", len=${result.value.length}`);
                    return validatePersistedJson(result.value);
                }
                if (result?.success && result.value === null) {
                    // IPC store 没有数据，尝试从 localStorage 迁移
                    try {
                        const lsValue = window.localStorage.getItem(name);
                        if (lsValue) {
                            console.log(`[Store] 从 localStorage 迁移持久化数据到 IPC store (len=${lsValue.length})`);
                            // 使用异步 IPC 写入，避免 sendSync 对大数据的限制
                            designEcho.invoke?.('state:setPersistedValue', name, lsValue)
                                .then((r: any) => console.log('[Store] localStorage 迁移到 IPC:', r?.success ? '成功' : r?.error))
                                .catch((e: any) => console.warn('[Store] localStorage 迁移到 IPC 失败:', e));
                            return validatePersistedJson(lsValue);
                        }
                    } catch {}
                    return null;
                }
                console.warn('[Store] 持久化读取失败，回退到 localStorage:', result?.error || 'unknown');
            } catch (error: any) {
                console.warn('[Store] 持久化读取异常，回退到 localStorage:', error?.message || String(error));
            }
        }
        try {
            return validatePersistedJson(window.localStorage.getItem(name));
        } catch {
            return null;
        }
    },
    setItem: (name: string, value: string) => {
        if (typeof window === 'undefined') return;
        const designEcho = (window as any).designEcho;

        const valueSizeKB = Math.round(value.length / 1024);
        console.log(`[Store] setItem: key="${name}", size=${valueSizeKB}KB`);

        // 使用异步 IPC 写入（invoke），避免 sendSync 对大数据的阻塞和失败
        if (designEcho?.invoke) {
            designEcho.invoke('state:setPersistedValue', name, value)
                .then((result: any) => {
                    if (result?.success) {
                        console.log(`[Store] IPC 异步写入成功: key="${name}"`);
                    } else {
                        console.error(`[Store] IPC 异步写入失败: ${result?.error || 'unknown'}`);
                    }
                })
                .catch((error: any) => {
                    console.error(`[Store] IPC 异步写入异常:`, error?.message || String(error));
                });
        }

        // 同时尝试写入 localStorage 作为冗余备份
        try {
            window.localStorage.setItem(name, value);
        } catch (e: any) {
            // localStorage 有 ~5-10MB 限制，超出会抛出 QuotaExceededError
            if (e?.name === 'QuotaExceededError') {
                console.warn(`[Store] localStorage 写入失败: 数据过大 (${valueSizeKB}KB), QuotaExceededError`);
            }
        }
    },
    removeItem: (name: string) => {
        if (typeof window === 'undefined') return;
        const designEcho = (window as any).designEcho;
        // 异步删除 IPC store
        if (designEcho?.invoke) {
            designEcho.invoke('state:removePersistedValue', name)
                .catch((e: any) => console.warn('[Store] IPC 删除失败:', e));
        }
        try {
            window.localStorage.removeItem(name);
        } catch {}
    }
}));

export const useAppStore = create<AppState>()(
    persist(
        (set, get) => ({
            // 主题设置
            theme: 'dark' as ThemeMode,
            setTheme: (theme) => set({ theme }),

            // 连接状态
            isPluginConnected: false,
            setPluginConnected: (connected) => set({ isPluginConnected: connected }),

            // 停止生成
            abortController: null,
            setAbortController: (controller) => set({ abortController: controller }),
            stopGeneration: () => {
                const { abortController } = get();
                if (abortController) {
                    abortController.abort();
                    set({ abortController: null, isLoading: false });
                }
            },

            // 项目管理
            currentProject: null,
            recentProjects: [],
            setCurrentProject: (project) => {
                const state = get();
                const oldProjectId = getProjectId(state.currentProject);
                const newProjectId = getProjectId(project);
                
                // 如果项目没有变化，直接返回
                if (oldProjectId === newProjectId && state.currentProject?.path === project?.path) {
                    set({ currentProject: project });
                    return;
                }
                
                // 1. 保存当前项目的对话到 projectConversations
                const currentConversationsToSave = sanitizeConversationsForPersistence(state.conversations.map(c =>
                    c.id === state.currentConversationId 
                        ? { ...c, messages: state.messages, updatedAt: Date.now() }
                        : c
                ));
                
                const updatedProjectConversations = {
                    ...state.projectConversations,
                    [oldProjectId]: currentConversationsToSave
                };
                
                // 2. 加载新项目的对话
                let newProjectConversations = sanitizeConversationsForPersistence(updatedProjectConversations[newProjectId] || []);
                
                // 如果新项目没有对话，创建一个默认对话
                if (newProjectConversations.length === 0) {
                    newProjectConversations = [createDefaultConversation()];
                }
                
                // 3. 更新状态
                const firstConv = newProjectConversations[0];
                set({
                    currentProject: project,
                    projectConversations: updatedProjectConversations,
                    conversations: newProjectConversations,
                    currentConversationId: firstConv.id,
                    messages: firstConv.messages || []
                });

                // 项目切换是持久化边界：旧项目立即保存，新项目只通过统一加载入口恢复。
                flushSaveConversations(oldProjectId, currentConversationsToSave);
                get().loadProjectConversations(newProjectId);
                
                console.log(`[AppStore] 切换项目: ${oldProjectId} -> ${newProjectId}, 对话数: ${newProjectConversations.length}`);
            },
            addRecentProject: (project) => set((state) => {
                // 移除重复项
                const filtered = state.recentProjects.filter(p => p.path !== project.path);
                // 添加到最前面，最多保留 10 个
                return {
                    recentProjects: [{ ...project, lastOpenedAt: Date.now() }, ...filtered].slice(0, 10)
                };
            }),
            removeRecentProject: (id) => set((state) => ({
                recentProjects: state.recentProjects.filter(p => p.id !== id)
            })),
            
            // 电商项目结构
            ecommerceStructure: null,
            setEcommerceStructure: (structure) => set({ ecommerceStructure: structure }),

            // API Keys
            apiKeys: {},
            setApiKeys: (keys) => set((state) => ({ apiKeys: { ...state.apiKeys, ...keys } })),

            // 模型偏好
            modelPreferences: defaultModelPreferences,
            setModelPreferences: (prefs) => set((state) => ({
                modelPreferences: normalizeModelPreferences({
                    ...state.modelPreferences,
                    ...prefs,
                    thinking: {
                        ...state.modelPreferences.thinking,
                        ...prefs.thinking
                    }
                })
            })),
            setModelMode: (mode) => set((state) => ({
                modelPreferences: normalizeModelPreferences({ ...state.modelPreferences, mode })
            })),

            // 设计尺寸规范（空对象 = 全部走预设）
            designDimensionSpec: {},
            setDesignDimensionSpec: (spec) => set((state) => ({
                designDimensionSpec: { ...state.designDimensionSpec, ...spec }
            })),
            resetDesignDimensionSpec: () => set({ designDimensionSpec: {} }),

            // 动态拉取的模型（持久化 + 注入进程内注册表）
            dynamicModels: [],
            upsertDynamicModels: (provider, models) => set((state) => {
                // 按 provider 整体替换该 provider 的动态项：移除旧的，写入本次拉取的新集合。
                // 与硬编码 apiModelId 去重——已硬编码的模型由 ALL_MODELS 提供可靠能力，
                // 不让动态项（保守默认能力）覆盖它。
                const hardcodedApiModelIds = new Set(
                    getModelsByProvider(provider).map((m) => m.apiModelId)
                );
                const incoming = (Array.isArray(models) ? models : []).filter(
                    (m) =>
                        m &&
                        typeof m.id === 'string' &&
                        m.id.trim().length > 0 &&
                        typeof m.apiModelId === 'string' &&
                        m.apiModelId.trim().length > 0 &&
                        !hardcodedApiModelIds.has(m.apiModelId)
                );
                const kept = state.dynamicModels.filter((m) => m.provider !== provider);
                const nextDynamicModels = [...kept, ...incoming];
                // 同步注入进程内注册表，让 getModelById 立即可查到正确 apiModelId。
                setDynamicModels(nextDynamicModels);
                return { dynamicModels: nextDynamicModels };
            }),

            // 自定义模型管理
            customModels: [],

            addCustomModel: (model) => {
                const id = `custom-${crypto.randomUUID().slice(0, 8)}`;
                const newModel: CustomModel = {
                    ...model,
                    id,
                    createdAt: Date.now()
                };
                set((state) => ({
                    customModels: [...state.customModels, newModel]
                }));
                return id;
            },
            
            updateCustomModel: (id, updates) => set((state) => ({
                customModels: state.customModels.map(m => 
                    m.id === id ? { ...m, ...updates } : m
                )
            })),
            
            deleteCustomModel: (id) => set((state) => ({
                customModels: state.customModels.filter(m => m.id !== id)
            })),
            
            setActiveModel: (category, modelId) => set((state) => ({
                // 先取消该分类下所有模型的激活状态
                customModels: state.customModels.map(m => ({
                    ...m,
                    isActive: m.category === category 
                        ? m.id === modelId 
                        : m.isActive
                })),
                // 同时更新 preferredCloudModels
                modelPreferences: {
                    ...state.modelPreferences,
                    autoFallback: false,
                    preferredCloudModels: {
                        ...state.modelPreferences.preferredCloudModels,
                        [category]: modelId
                    }
                }
            })),
            
            getModelsForCategory: (category) => {
                return get().customModels.filter(m => m.category === category);
            },

            // 对话列表（项目级别隔离）
            projectConversations: {},  // 项目ID -> 对话列表
            conversations: [],
            currentConversationId: null,
            
            // 保存当前项目的对话（内存 + 文件）
            saveCurrentProjectConversations: () => {
                const state = get();
                const projectId = getProjectId(state.currentProject);
                const currentConversationsToSave = sanitizeConversationsForPersistence(state.conversations.map(c =>
                    c.id === state.currentConversationId
                        ? { ...c, messages: state.messages, updatedAt: Date.now() }
                        : c
                ));
                set({
                    projectConversations: {
                        ...state.projectConversations,
                        [projectId]: currentConversationsToSave
                    }
                });
                // 立即保存到文件（切换项目时调用，需要即时持久化）
                flushSaveConversations(projectId, currentConversationsToSave);
            },

            // 加载项目对话（优先从文件加载，兼容旧内存数据）
            loadProjectConversations: (projectId: string) => {
                const stateAtRequest = get();
                const memConvs = stateAtRequest.projectConversations[projectId];
                const isActiveProject = getProjectId(stateAtRequest.currentProject) === projectId;

                // 已有内存事实时不再发起可能迟到的文件加载；待写文件由主进程队列按调用顺序落盘。
                if (memConvs && memConvs.length > 0) {
                    if (isActiveProject) {
                        const loadedMemoryConversations = sanitizeConversationsForPersistence(memConvs);
                        set({
                            conversations: loadedMemoryConversations,
                            currentConversationId: loadedMemoryConversations[0].id,
                            messages: loadedMemoryConversations[0].messages || []
                        });
                    }
                    return;
                }

                const placeholder = createDefaultConversation();
                const requestRevision = getConversationMutationRevision(projectId);
                if (isActiveProject) {
                    set((currentState) => ({
                        conversations: [placeholder],
                        currentConversationId: placeholder.id,
                        messages: [],
                        projectConversations: {
                            ...currentState.projectConversations,
                            [projectId]: [placeholder]
                        }
                    }));
                }

                const designEcho = typeof window !== 'undefined' ? (window as any).designEcho : undefined;
                if (!designEcho?.invoke) return;
                designEcho.invoke('conversation:load', projectId)
                    .then((result: any) => {
                        const persistedConversations = result?.success && result.conversations?.length > 0
                            ? sanitizeConversationsForPersistence(result.conversations)
                            : [placeholder];
                        const revisionChanged = getConversationMutationRevision(projectId) !== requestRevision;
                        const localConversations = get().projectConversations[projectId] || [];
                        const loadedConversations = revisionChanged
                            ? mergeConversationCollections(persistedConversations, localConversations)
                            : persistedConversations;
                        const activeAfterLoad = getProjectId(get().currentProject) === projectId;

                        set((currentState) => ({
                            projectConversations: {
                                ...currentState.projectConversations,
                                [projectId]: loadedConversations
                            },
                            ...(activeAfterLoad ? {
                                conversations: loadedConversations,
                                currentConversationId: loadedConversations[0].id,
                                messages: loadedConversations[0].messages || []
                            } : {})
                        }));
                        if (revisionChanged) {
                            // 迟到加载不能覆盖本地新消息；合并后重新排队，确保磁盘最终包含两边事实。
                            debouncedSaveConversations(projectId, loadedConversations);
                        }
                        console.log(`[Store] 从文件加载对话: project="${projectId}", ${loadedConversations.length} 条`);
                    })
                    .catch((e: any) => {
                        console.error('[Store] 从文件加载对话失败:', e);
                    });
            },

            createConversation: () => {
                const newConv = createDefaultConversation();
                const state = get();
                const projectId = getProjectId(state.currentProject);
                const newConversations = [newConv, ...state.conversations];

                set({
                    conversations: newConversations,
                    currentConversationId: newConv.id,
                    messages: [],
                    projectConversations: {
                        ...state.projectConversations,
                        [projectId]: newConversations
                    }
                });
                debouncedSaveConversations(projectId, newConversations);
                return newConv.id;
            },

            deleteConversation: (id: string) => {
                const state = get();
                const projectId = getProjectId(state.currentProject);
                const filtered = state.conversations.filter(c => c.id !== id);
                let resultConversations: Conversation[];

                if (state.currentConversationId === id) {
                    if (filtered.length > 0) {
                        resultConversations = filtered;
                        set({
                            conversations: filtered,
                            currentConversationId: filtered[0].id,
                            messages: filtered[0].messages,
                            projectConversations: { ...state.projectConversations, [projectId]: filtered }
                        });
                    } else {
                        const newConv = createDefaultConversation();
                        resultConversations = [newConv];
                        set({
                            conversations: resultConversations,
                            currentConversationId: newConv.id,
                            messages: [],
                            projectConversations: { ...state.projectConversations, [projectId]: resultConversations }
                        });
                    }
                } else {
                    resultConversations = filtered;
                    set({
                        conversations: filtered,
                        projectConversations: { ...state.projectConversations, [projectId]: filtered }
                    });
                }
                debouncedSaveConversations(projectId, resultConversations);
            },

            switchConversation: (id: string) => {
                const state = get();
                const projectId = getProjectId(state.currentProject);
                const updatedConversations = state.conversations.map(c =>
                    c.id === state.currentConversationId
                        ? { ...c, messages: state.messages, updatedAt: Date.now() }
                        : c
                );
                const targetConv = updatedConversations.find(c => c.id === id);
                set({
                    conversations: updatedConversations,
                    currentConversationId: id,
                    messages: targetConv?.messages || [],
                    projectConversations: { ...state.projectConversations, [projectId]: updatedConversations }
                });
                debouncedSaveConversations(projectId, updatedConversations);
            },

            updateConversationTitle: (id: string, title: string) => {
                const state = get();
                const projectId = getProjectId(state.currentProject);
                const updatedConversations = state.conversations.map(c =>
                    c.id === id ? { ...c, title, updatedAt: Date.now() } : c
                );
                set({
                    conversations: updatedConversations,
                    projectConversations: { ...state.projectConversations, [projectId]: updatedConversations }
                });
                debouncedSaveConversations(projectId, updatedConversations);
            },

            // 当前对话的消息
            messages: [],
            addMessage: (message) => {
                const state = get();
                if (!state.currentConversationId) {
                    throw new Error('Cannot add a chat message without an active conversation.');
                }
                return get().addMessageToConversation(state.currentConversationId, message);
            },
            addMessageToConversation: (conversationId, message) => {
                const state = get();
                const activeProjectId = getProjectId(state.currentProject);
                const owner = resolveConversationOwner({
                    conversationId,
                    activeProjectId,
                    activeConversations: state.conversations,
                    projectConversations: state.projectConversations
                });
                if (!owner) {
                    throw new Error(`Conversation not found: ${conversationId}`);
                }
                const safeMessage = sanitizeMessageForPersistence(message);
                const newMessage = {
                    ...safeMessage,
                    id: crypto.randomUUID(),
                    timestamp: Date.now()
                } as Message;
                const isVisibleConversation = owner.isActiveProject
                    && conversationId === state.currentConversationId;
                const targetMessages = isVisibleConversation
                    ? state.messages
                    : owner.conversation.messages || [];
                const newMessages = [...targetMessages, newMessage];
                const updatedAt = Date.now();
                const shouldUpdateTitle = message.role === 'user' && targetMessages.length === 0;
                const updatedConversations = owner.conversations.map(c => {
                    if (c.id !== conversationId) return c;
                    return {
                        ...c,
                        title: shouldUpdateTitle
                            ? message.content.slice(0, 20) + (message.content.length > 20 ? '...' : '')
                            : c.title,
                        messages: newMessages,
                        updatedAt
                    };
                });

                set({
                    ...(owner.isActiveProject ? {
                        messages: isVisibleConversation ? newMessages : state.messages,
                        conversations: updatedConversations
                    } : {}),
                    projectConversations: {
                        ...state.projectConversations,
                        [owner.projectId]: updatedConversations
                    }
                });
                debouncedSaveConversations(owner.projectId, updatedConversations);

                return newMessage.id;
            },
            removeLastMessage: () => {
                const state = get();
                const projectId = getProjectId(state.currentProject);
                const newMessages = state.messages.slice(0, -1);
                const updatedConversations = state.conversations.map(c =>
                    c.id === state.currentConversationId
                        ? { ...c, messages: newMessages, updatedAt: Date.now() }
                        : c
                );
                set({
                    messages: newMessages,
                    conversations: updatedConversations,
                    projectConversations: { ...state.projectConversations, [projectId]: updatedConversations }
                });
                debouncedSaveConversations(projectId, updatedConversations);
            },

            // 更新最后一条消息内容（用于实时显示进度）
            updateLastMessage: (content: string) => {
                const state = get();
                if (state.messages.length === 0) return;
                const projectId = getProjectId(state.currentProject);

                const newMessages = [...state.messages];
                newMessages[newMessages.length - 1] = sanitizeMessageForPersistence({
                    ...newMessages[newMessages.length - 1],
                    content
                }) as Message;

                const updatedConversations = state.conversations.map(c =>
                    c.id === state.currentConversationId
                        ? { ...c, messages: newMessages }
                        : c
                );
                set({
                    messages: newMessages,
                    conversations: updatedConversations,
                    projectConversations: { ...state.projectConversations, [projectId]: updatedConversations }
                });
                // updateLastMessage 频繁调用（流式输出），用防抖避免过度写入
                debouncedSaveConversations(projectId, updatedConversations);
            },

            // 按 ID 更新消息
            updateMessage: (messageId: string, updates: Partial<Omit<Message, 'id' | 'timestamp'>>) => {
                const state = get();
                if (!state.currentConversationId) return;
                get().updateMessageInConversation(state.currentConversationId, messageId, updates);
            },
            updateMessageInConversation: (conversationId: string, messageId: string, updates: Partial<Omit<Message, 'id' | 'timestamp'>>) => {
                const state = get();
                const activeProjectId = getProjectId(state.currentProject);
                const owner = resolveConversationOwner({
                    conversationId,
                    activeProjectId,
                    activeConversations: state.conversations,
                    projectConversations: state.projectConversations
                });
                if (!owner) return false;
                const isVisibleConversation = owner.isActiveProject
                    && conversationId === state.currentConversationId;
                const targetMessages = isVisibleConversation
                    ? state.messages
                    : owner.conversation.messages || [];
                let didUpdate = false;
                const newMessages = targetMessages.map(m => {
                    if (m.id !== messageId) return m;
                    didUpdate = true;
                    const nextPresentation = updates.agentTaskPlanPresentation;
                    const presentationUpdateRejected = m.agentTaskPlanPresentation
                        && (!nextPresentation || !shouldAcceptAgentTaskPlanPresentationUpdate({
                            current: m.agentTaskPlanPresentation,
                            next: nextPresentation
                        }));
                    const guardedUpdates = presentationUpdateRejected
                        ? { ...updates, agentTaskPlanPresentation: m.agentTaskPlanPresentation }
                        : updates;
                    return sanitizeMessageForPersistence({ ...m, ...guardedUpdates }) as Message;
                });
                if (!didUpdate) return false;
                const updatedConversations = owner.conversations.map(c =>
                    c.id === conversationId
                        ? { ...c, messages: newMessages, updatedAt: Date.now() }
                        : c
                );
                set({
                    ...(owner.isActiveProject ? {
                        messages: isVisibleConversation ? newMessages : state.messages,
                        conversations: updatedConversations
                    } : {}),
                    projectConversations: {
                        ...state.projectConversations,
                        [owner.projectId]: updatedConversations
                    }
                });
                debouncedSaveConversations(owner.projectId, updatedConversations);
                return true;
            },

            // 编辑消息内容
            editMessage: (messageId: string, newContent: string) => {
                const state = get();
                const projectId = getProjectId(state.currentProject);
                const newMessages = state.messages.map(m =>
                    m.id === messageId
                        ? sanitizeMessageForPersistence({ ...m, content: newContent }) as Message
                        : m
                );
                const updatedConversations = state.conversations.map(c =>
                    c.id === state.currentConversationId
                        ? { ...c, messages: newMessages, updatedAt: Date.now() }
                        : c
                );
                set({
                    messages: newMessages,
                    conversations: updatedConversations,
                    projectConversations: { ...state.projectConversations, [projectId]: updatedConversations }
                });
                debouncedSaveConversations(projectId, updatedConversations);
            },

            // 删除指定消息及其后续所有消息，返回被删除消息的内容
            removeMessagesFrom: (messageId: string) => {
                const state = get();
                const projectId = getProjectId(state.currentProject);
                const messageIndex = state.messages.findIndex(m => m.id === messageId);
                if (messageIndex === -1) return null;

                const removedMessage = state.messages[messageIndex];
                const newMessages = state.messages.slice(0, messageIndex);

                const updatedConversations = state.conversations.map(c =>
                    c.id === state.currentConversationId
                        ? { ...c, messages: newMessages, updatedAt: Date.now() }
                        : c
                );
                set({
                    messages: newMessages,
                    conversations: updatedConversations,
                    projectConversations: { ...state.projectConversations, [projectId]: updatedConversations }
                });
                debouncedSaveConversations(projectId, updatedConversations);
                return removedMessage.content;
            },

            clearMessages: () => {
                const state = get();
                const projectId = getProjectId(state.currentProject);
                const updatedConversations = state.conversations.map(c =>
                    c.id === state.currentConversationId
                        ? { ...c, messages: [], updatedAt: Date.now() }
                        : c
                );
                set({
                    messages: [],
                    conversations: updatedConversations,
                    projectConversations: { ...state.projectConversations, [projectId]: updatedConversations }
                });
                debouncedSaveConversations(projectId, updatedConversations);
            },

            // 当前任务
            currentTask: null,
            setCurrentTask: (task) => set({ currentTask: task }),

            // 加载状态
            isLoading: false,
            setLoading: (loading) => set({ isLoading: loading }),

            // 抠图设置
            mattingSettings: defaultMattingSettings,
            
            setMattingSettings: (settings) => set((state) => ({
                mattingSettings: { ...state.mattingSettings, ...settings }
            })),
            
            setMattingMode: (mode) => set((state) => ({
                mattingSettings: { ...state.mattingSettings, mode }
            })),
            
            setActiveMattingModel: (stage, modelId) => {
                // 更新 Zustand 状态
                set((state) => ({
                    mattingSettings: {
                        ...state.mattingSettings,
                        activeModels: {
                            ...state.mattingSettings.activeModels,
                            [stage]: modelId
                        },
                        availableModels: state.mattingSettings.availableModels.map(m => ({
                            ...m,
                            isActive: m.stage === stage ? m.id === modelId : m.isActive
                        }))
                    }
                }));
                
                // 同步到主进程（通过 IPC）
                const api = (window as any).designEcho;
                if (api?.setMattingSettings) {
                    const currentState = get();
                    api.setMattingSettings({
                        activeModels: currentState.mattingSettings.activeModels
                    }).catch((err: any) => {
                        console.error('[Store] 同步抠图设置到主进程失败:', err);
                    });
                    console.log(`[Store] 抠图模型已更新: ${stage} = ${modelId}`);
                }
            },
            
            addMattingModel: (model) => {
                const id = `matting-${crypto.randomUUID().slice(0, 8)}`;
                const newModel: MattingModelConfig = { ...model, id };
                set((state) => ({
                    mattingSettings: {
                        ...state.mattingSettings,
                        availableModels: [...state.mattingSettings.availableModels, newModel]
                    }
                }));
                return id;
            },
            
            updateMattingModel: (id, updates) => set((state) => ({
                mattingSettings: {
                    ...state.mattingSettings,
                    availableModels: state.mattingSettings.availableModels.map(m =>
                        m.id === id ? { ...m, ...updates } : m
                    )
                }
            })),
            
            deleteMattingModel: (id) => set((state) => ({
                mattingSettings: {
                    ...state.mattingSettings,
                    availableModels: state.mattingSettings.availableModels.filter(m => m.id !== id)
                }
            })),

            // 形态统一设置
            morphingSettings: defaultMorphingSettings,
            
            setMorphingSettings: (settings) => set((state) => ({
                morphingSettings: { ...state.morphingSettings, ...settings }
            })),


            integrationSettings: defaultIntegrationSettings,
            setIntegrationSettings: (settings) => set((state) => ({
                integrationSettings: normalizeIntegrationSettings({
                    ...state.integrationSettings,
                    ...settings,
                    skills: settings.skills
                        ? { ...state.integrationSettings.skills, ...settings.skills }
                        : state.integrationSettings.skills,
                    mcpServers: settings.mcpServers ?? state.integrationSettings.mcpServers
                })
            })),

            designKnowledgeSettings: defaultDesignKnowledgeSettings,
            setDesignKnowledgeSettings: (settings) => set((state) => ({
                designKnowledgeSettings: normalizeDesignKnowledgeSettings({
                    ...state.designKnowledgeSettings,
                    ...settings,
                    searxng: {
                        ...state.designKnowledgeSettings.searxng,
                        ...(settings.searxng || {})
                    },
                    xiaomiWebSearch: {
                        ...state.designKnowledgeSettings.xiaomiWebSearch,
                        ...(settings.xiaomiWebSearch || {})
                    }
                })
            })),

            // 模型状态管理
            ollamaStatus: 'unknown' as 'unknown' | 'online' | 'offline',
            installedOllamaModels: [],
            
            setOllamaStatus: (status) => set({ ollamaStatus: status }),
            setInstalledOllamaModels: (models) => set({ installedOllamaModels: models }),
            
            checkAllModelsStatus: async () => {
                const designEcho = (window as any).designEcho;
                if (!designEcho) return;
                
                try {
                    // 检查 Ollama 状态和已安装模型
                    const ollamaResult = await designEcho.checkOllamaStatus();
                    if (ollamaResult?.success) {
                        set({ 
                            ollamaStatus: 'online',
                            installedOllamaModels: ollamaResult.models || []
                        });
                    } else {
                        set({ ollamaStatus: 'offline', installedOllamaModels: [] });
                    }
                    
                    console.log('[AppStore] 模型状态检查完成', {
                        ollamaModels: get().installedOllamaModels.length
                    });
                } catch (error) {
                    console.error('[AppStore] 检查模型状态失败', error);
                    set({ ollamaStatus: 'offline' });
                }
            }
        }),
        {
            name: 'designecho-storage',
            version: 39,  // v39: 动态模型用途分类，迁移旧的乐观 vision/tool 能力
            storage: persistedStorage,
            partialize: (state) => ({
                // 只持久化小体积配置数据（< 50KB）
                // 对话数据通过独立文件存储，不再经过 Zustand persist
                apiKeys: state.apiKeys,
                modelPreferences: state.modelPreferences,
                dynamicModels: state.dynamicModels,
                customModels: state.customModels,
                mattingSettings: state.mattingSettings,
                integrationSettings: state.integrationSettings,
                designKnowledgeSettings: state.designKnowledgeSettings,
                designDimensionSpec: state.designDimensionSpec,
                currentConversationId: state.currentConversationId,
                currentProject: state.currentProject,
                recentProjects: state.recentProjects
            }),
            migrate: (persistedState: any, version: number) => {
                console.log('[Store] 迁移: v', version, '→ v39');
                let state = { ...persistedState };
                
                // 统一迁移：所有低于当前版本的存储都重置为最新配置
                // v21: 重构模型配置，添加 modelDir 和 reusesModel 支持
                if (version < 21) {
                    console.log('[Store] 重置配置为最新默认值 (v21: 模型管理重构)');
                    state.mattingSettings = defaultMattingSettings;
                    
                    // v15+ 需要迁移对话到 projectConversations
                    if (version < 15) {
                        const oldConversations = state.conversations || [];
                        const currentProjectId = state.currentProject?.id || DEFAULT_PROJECT_ID;
                        state.projectConversations = {
                            [currentProjectId]: oldConversations
                        };
                    }
                }
                
                // v22-v23: 模型 ID 格式变更 + Gemini API ID 更新
                // 需要重置 modelPreferences 使用新格式
                if (version < 23) {
                    console.log('[Store] 迁移 v23: 重置 modelPreferences 为新格式 (local-xxx + Gemini latest)');
                    state.modelPreferences = DEFAULT_MODEL_PREFERENCES;
                }

                if (version < 36 || state.modelPreferences) {
                    state.modelPreferences = normalizeModelPreferences(state.modelPreferences);
                }
                
                // v24: 新增专业 Alpha Matting 模型
                // 重置 availableModels 以包含新模型（ViTMatte, RVM, InSPyReNet, refine-smart）
                if (version < 24) {
                    console.log('[Store] 迁移 v24: 更新抠图模型列表（新增 Alpha Matting 模型 + 智能边缘）');
                    state.mattingSettings = {
                        ...defaultMattingSettings,
                        // 保留用户的 activeModels 设置（如果存在且有效）
                        activeModels: {
                            ...defaultMattingSettings.activeModels,
                            ...(state.mattingSettings?.activeModels || {})
                        }
                    };
                }
                
                // v25: 新增语义理解模型（CLIP-Large, SigLIP, Chinese-CLIP, BLIP）
                // 强制重置 availableModels 以包含所有新模型
                if (version < 25) {
                    console.log('[Store] 迁移 v25: 完全重置模型列表（新增语义理解模型）');
                    state.mattingSettings = {
                        mode: 'local',
                        activeModels: {
                            ...defaultMattingSettings.activeModels,
                            ...(state.mattingSettings?.activeModels || {})
                        },
                        availableModels: presetSegmentationModels  // 强制使用最新模型列表
                    };
                }
                
                // v26: 修复语义理解模型显示问题（确保 availableModels 完全刷新）
                if (version < 26) {
                    console.log('[Store] 迁移 v26: 强制刷新 availableModels');
                    state.mattingSettings = {
                        mode: 'local',
                        activeModels: {
                            ...defaultMattingSettings.activeModels,
                            ...(state.mattingSettings?.activeModels || {})
                        },
                        availableModels: presetSegmentationModels  // 强制使用最新完整模型列表
                    };
                }
                
                // v27: 旧版（已废弃）
                
                // v28: 简化模型配置，只保留最强组合
                // Grounding DINO + BiRefNet + ViTMatte
                if (version < 28) {
                    console.log('[Store] 迁移 v28: 简化模型配置（Grounding DINO + BiRefNet + ViTMatte）');
                    state.mattingSettings = {
                        mode: 'local',
                        activeModels: {
                            textGrounding: 'grounding-skip',
                            objectDetection: 'grounding-dino',
                            segmentation: 'birefnet',
                            edgeRefine: 'vitmatte'
                        },
                        availableModels: presetSegmentationModels
                    };
                }
                
                // v29: 调整为本地可用最强组合
                // YOLOv4 + BiRefNet + InSPyReNet
                if (version < 29) {
                    console.log('[Store] 迁移 v29: 最强组合调整（YOLOv4 + BiRefNet + InSPyReNet）');
                    state.mattingSettings = {
                        mode: 'local',
                        activeModels: {
                            textGrounding: 'grounding-skip',
                            objectDetection: 'detection-yolov4',
                            segmentation: 'birefnet',
                            edgeRefine: 'refine-inspyrenet'
                        },
                        availableModels: presetSegmentationModels
                    };
                }

                // v30: 对话数据迁移到独立文件存储
                // projectConversations 不再通过 Zustand persist 持久化
                // 旧数据保留在 state 中供 onRehydrateStorage 迁移使用
                if (version < 30) {
                    console.log('[Store] 迁移 v30: 对话数据将迁移到独立文件存储');
                    // 注意：此处不删除 projectConversations，留给 onRehydrateStorage 处理迁移
                }

                if (version < 31) {
                    console.log('[Store] 迁移 v31: 初始化 integrations settings');
                    state.integrationSettings = defaultIntegrationSettings;
                }

                if (version < 32 && state?.modelPreferences?.preferredCloudModels) {
                    console.log('[Store] 迁移 v32: Xiaomi MiMo V2 Pro 升级到 V2.5 Pro');
                    migrateRetiredXiaomiMimoModels(state.modelPreferences.preferredCloudModels);
                }

                if (version < 33 && state?.modelPreferences?.preferredCloudModels) {
                    console.log('[Store] 迁移 v33: Xiaomi MiMo V2 / V2 Omni 升级到 V2.5');
                    migrateRetiredXiaomiMimoModels(state.modelPreferences.preferredCloudModels);
                }

                if (version < 34 && state?.modelPreferences?.preferredCloudModels) {
                    console.log('[Store] 迁移 v34: 移除即将下线 Xiaomi MiMo V2 旧模型，只保留 V2.5 系列');
                    migrateRetiredXiaomiMimoModels(state.modelPreferences.preferredCloudModels);
                }

                if (version < 35 && state?.modelPreferences) {
                    console.log('[Store] 迁移 v35: 关闭模型自动跨供应商回退');
                    state.modelPreferences = {
                        ...state.modelPreferences,
                        autoFallback: false
                    };
                }

                if (version < 38 && state?.modelPreferences) {
                    console.log('[Store] 迁移 v38: 从旧主模型/视觉槽初始化独立视觉模型');
                    state.modelPreferences = normalizeModelPreferences(state.modelPreferences);
                }

                if (!state.designKnowledgeSettings) {
                    state.designKnowledgeSettings = defaultDesignKnowledgeSettings;
                }

                // v37: 新增 dynamicModels（动态拉取模型）。仅补缺省值，绝不触碰上面的
                // Xiaomi 退役迁移链与 preferredCloudModels。
                if (!Array.isArray(state.dynamicModels)) {
                    state.dynamicModels = [];
                }
                if (version < 39) {
                    console.log('[Store] 迁移 v39: 重新分类旧动态模型并撤销未经证实的视觉/Tool 能力');
                    state.dynamicModels = normalizePersistedDynamicModels(state.dynamicModels);
                }

                return state;
            },
            onRehydrateStorage: () => (state) => {
                console.log('[Store] 重新加载存储数据');

                if (state) {
                    state.integrationSettings = normalizeIntegrationSettings(state.integrationSettings);
                    state.designKnowledgeSettings = normalizeDesignKnowledgeSettings(state.designKnowledgeSettings);
                    // 把持久化的动态模型注入 renderer 进程注册表，让 getModelById
                    // 在 hydrate 后立即能查到正确 apiModelId（不再走 slug 反推）。
                    state.dynamicModels = normalizePersistedDynamicModels(state.dynamicModels);
                    setDynamicModels(state.dynamicModels);
                }
                
                // 🔧 修复旧格式的模型 ID (ollama-xxx → local-xxx)
                if (state?.modelPreferences?.preferredLocalModels) {
                    const localModels = state.modelPreferences.preferredLocalModels;
                    let needsFix = false;
                    
                    // 检查是否有旧格式的模型 ID
                    for (const key of Object.keys(localModels)) {
                        const modelId = (localModels as any)[key];
                        if (typeof modelId === 'string' && modelId.startsWith('ollama-')) {
                            console.log(`[Store] onRehydrate: 检测到旧格式模型 ID: ${modelId}`);
                            needsFix = true;
                            break;
                        }
                    }
                    
                    if (needsFix) {
                        console.log('[Store] onRehydrate: 重置 modelPreferences 为新格式');
                        state.modelPreferences = normalizeModelPreferences(DEFAULT_MODEL_PREFERENCES);
                    }
                }
                
                // 确保 mattingSettings 正确初始化
                if (state) {
                    if (!state.mattingSettings || !state.mattingSettings.availableModels?.length) {
                        console.log('[Store] onRehydrate: 重置 mattingSettings（无可用模型）');
                        state.mattingSettings = defaultMattingSettings;
                    } else {
                        // 检查并合并缺失的阶段模型
                        const existingIds = new Set(state.mattingSettings.availableModels.map((m: any) => m.id));
                        const stages = ['textGrounding', 'objectDetection', 'segmentation', 'edgeRefine'];
                        
                        // 检查每个阶段是否至少有一个模型
                        let missingStages: string[] = [];
                        for (const stage of stages) {
                            const hasStageModel = state.mattingSettings.availableModels.some(
                                (m: any) => m.stage === stage
                            );
                            if (!hasStageModel) {
                                missingStages.push(stage);
                            }
                        }
                        
                        if (missingStages.length > 0) {
                            console.log('[Store] onRehydrate: 检测到缺失阶段:', missingStages.join(', '));
                            // 从预设模型中添加缺失阶段的模型
                            const modelsToAdd = presetSegmentationModels.filter(
                                m => missingStages.includes(m.stage) && !existingIds.has(m.id)
                            );
                            console.log('[Store] onRehydrate: 添加缺失模型:', modelsToAdd.map(m => m.id).join(', '));
                            state.mattingSettings.availableModels = [
                                ...state.mattingSettings.availableModels,
                                ...modelsToAdd
                            ];
                            
                            // 确保 activeModels 中有默认值
                            if (!state.mattingSettings.activeModels) {
                                state.mattingSettings.activeModels = defaultMattingSettings.activeModels;
                            } else {
                                // 合并缺失的 activeModels
                                const activeModels = state.mattingSettings.activeModels as Record<string, string>;
                                const defaultActive = defaultMattingSettings.activeModels as Record<string, string>;
                                for (const stage of missingStages) {
                                    if (!activeModels[stage]) {
                                        activeModels[stage] = defaultActive[stage];
                                    }
                                }
                            }
                        }
                        
                        console.log('[Store] onRehydrate: mattingSettings 最终有', 
                            state.mattingSettings.availableModels.length, '个模型');
                    }
                }
                
                // v30: 对话数据已迁移到独立文件存储
                // 如果旧持久化数据中包含 projectConversations，迁移到文件
                if (state) {
                    const oldProjectConversations = (state as any).projectConversations;
                    let migrationTask: Promise<unknown> = Promise.resolve();
                    if (oldProjectConversations && typeof oldProjectConversations === 'object') {
                        const projectIds = Object.keys(oldProjectConversations);
                        const hasData = projectIds.some(id => {
                            const convs = oldProjectConversations[id];
                            return Array.isArray(convs) && convs.length > 0;
                        });
                        if (hasData) {
                            console.log(`[Store] onRehydrate: 发现旧 projectConversations 数据 (${projectIds.length} 个项目)，迁移到文件...`);
                            const designEcho = typeof window !== 'undefined' ? (window as any).designEcho : undefined;
                            if (designEcho?.invoke) {
                                migrationTask = designEcho.invoke('conversation:migrateFromStore', oldProjectConversations)
                                    .then((r: any) => console.log('[Store] 对话迁移结果:', r))
                                    .catch((e: any) => console.error('[Store] 对话迁移失败:', e));
                            }
                        }
                    }

                    // 初始化运行时对话状态
                    state.projectConversations = {};

                    const projectId = getProjectId(state.currentProject);
                    const placeholder = createDefaultConversation();
                    state.conversations = [placeholder];
                    state.currentConversationId = placeholder.id;
                    state.messages = [];

                    // 迁移与加载共享主进程文件队列；加载统一走 store action，避免第二套迟到回写逻辑。
                    void migrationTask.finally(() => {
                        Promise.resolve().then(() => {
                            const currentStore = useAppStore.getState();
                            if (getProjectId(currentStore.currentProject) !== projectId) return;
                            currentStore.loadProjectConversations(projectId);
                        });
                    });
                }
            }
        }
    )
);
