/**
 * 设置弹窗 - 重构版
 * 
 * 清晰划分模型类型：
 * 1. AI 对话模型 - 用于文案、排版、视觉分析
 *    - 本地：Ollama LLM
 *    - 云端：OpenRouter / 直连 API
 * 2. 图像处理模型 - 用于抠图等图像处理
 *    - 本地 ONNX：BiRefNet + YOLO-World
 */

import React, { useState, useEffect, useRef } from 'react';
import './SettingsModal.css';
import './KnowledgeLibraryPage.css';
import { useAppStore, TaskCategory } from '../stores/app.store';
import { DesignLearningRuntimeSettingsPanel } from './DesignLearningRuntimeSettingsPanel';
import { DesignLearningReviewSettingsPanel } from './DesignLearningReviewSettingsPanel';
import { KnowledgeSourceManagementPanel } from './KnowledgeSourceManagementPanel';
import { UserPreferencesPanel } from './UserPreferencesPanel';
import { getUserFacingSkills } from '../../shared/skills/skill-declarations';
import { getSkillExecutor } from '../services/skill-executors';
import { normalizeDesignDimensionSpec } from '../../shared/design-dimension-spec';
import {
    buildDesignKnowledgeSettingsSummary,
    normalizeDesignKnowledgeSettings
} from '../../shared/design-knowledge-settings';
import { buildDesignKnowledgeRuntimeCapabilitySummary } from '../../shared/design-knowledge-runtime-capability';
import {
    getMemoryService,
    type PreferenceMemoryItem
} from '../services/memory.service';

// 从统一配置导入模型定义
import { 
    LOCAL_MODELS as LOCAL_MODELS_CONFIG, 
    GOOGLE_MODELS as GOOGLE_MODELS_CONFIG,
    XIAOMI_MODELS as XIAOMI_MODELS_CONFIG,
    OPENROUTER_MODELS as OPENROUTER_MODELS_CONFIG,
    OLLAMA_CLOUD_MODELS as OLLAMA_CLOUD_CONFIG,
    GPTSAPI_MODELS as GPTSAPI_MODELS_CONFIG,
    DEEPSEEK_MODELS as DEEPSEEK_MODELS_CONFIG,
    DEFAULT_MODEL_PREFERENCES,
    getModelById,
    getModelsByProvider,
    isConversationModelConfig,
    isConversationModelId,
    isModelThinkingUserControllable,
    getModelThinkingDisplayName,
    type ModelProvider
} from '../../shared/config/models.config';
import { mergeFetchedProviderModels } from '../../shared/config/provider-model-merge';
import { isVisionCapableModelId } from '../../shared/model-selection';

// ========== 类型定义 ==========

// 设置 Tab 类型
type SettingsTab = 'general' | 'ai-models' | 'image-models' | 'api-keys' | 'integrations' | 'knowledge-sources' | 'user-preferences' | 'knowledge' | 'learning' | 'preferences';

const SETTINGS_TABS: Array<{ id: SettingsTab; label: string }> = [
    { id: 'ai-models', label: 'AI 模型' },
    { id: 'image-models', label: '图像处理' },
    { id: 'api-keys', label: 'API 密钥' },
    { id: 'integrations', label: 'MCP / Skills' },
    { id: 'knowledge-sources', label: '知识来源' },
    { id: 'user-preferences', label: '用户偏好' },
    { id: 'general', label: '常规' }
];

const getSettingsTabId = (tab: SettingsTab) => `settings-tab-${tab}`;
const getSettingsPanelId = (tab: SettingsTab) => `settings-panel-${tab}`;

// 简洁单色图标组件（与导航栏风格一致）
const TaskIcon: React.FC<{ type: string }> = ({ type }) => {
    const icons: Record<string, JSX.Element> = {
        brain: (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
            </svg>
        ),
        edit: (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 20h9"/>
                <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
            </svg>
        ),
        eye: (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                <circle cx="12" cy="12" r="3"/>
            </svg>
        )
    };
    return <span className="task-svg-icon">{icons[type] || null}</span>;
};

// 任务分类配置（简洁单色图标）
const TASK_CATEGORIES = [
    { id: 'layoutAnalysis' as TaskCategory, name: '逻辑理解', desc: '排版分析、代码生成', iconType: 'brain' },
    { id: 'textOptimize' as TaskCategory, name: '文案撰写', desc: '文案生成、营销文案', iconType: 'edit' },
    { id: 'visualAnalyze' as TaskCategory, name: '视觉分析', desc: '图像理解、设计分析', iconType: 'eye' },
];

// ========== 本地模型（Ollama）==========
const OLLAMA_MODELS = LOCAL_MODELS_CONFIG.map(m => ({
    id: m.id,
    name: m.name,
    desc: m.description || '',
    size: m.size || '',
    recommended: m.recommended || false,
    vision: m.supportsVision,
    apiModelId: m.apiModelId
}));

// ========== 云端模型 ==========

// Google AI Studio（官方直连）
const GOOGLE_MODELS = GOOGLE_MODELS_CONFIG.map(m => ({
    id: m.id,
    name: m.name,
    provider: 'google',
    channel: 'Google AI Studio' as const,
    desc: m.description || '',
    recommended: m.recommended || false,
    vision: m.supportsVision,
    requiredKey: 'google' as const
}));

const XIAOMI_MODELS = XIAOMI_MODELS_CONFIG.map(m => ({
    id: m.id,
    name: m.name,
    provider: 'xiaomi',
    channel: 'Xiaomi MiMo' as const,
    desc: m.description || '',
    recommended: m.recommended || false,
    vision: m.supportsVision,
    requiredKey: 'xiaomi' as const
}));

// OpenRouter（中转渠道）
const OPENROUTER_MODELS = OPENROUTER_MODELS_CONFIG.map(m => ({
    id: m.id,
    name: m.name,
    provider: m.apiModelId.split('/')[0] || 'openrouter',
    channel: 'OpenRouter' as const,
    desc: m.description || '',
    recommended: m.recommended || false,
    vision: m.supportsVision,
    requiredKey: 'openrouter' as const
}));

// Ollama Cloud（云服务）
const OLLAMA_CLOUD_MODELS = OLLAMA_CLOUD_CONFIG.map(m => ({
    id: m.id,
    name: m.name,
    provider: 'ollama-cloud',
    channel: 'Ollama Cloud' as const,
    desc: m.description || '',
    recommended: m.recommended || false,
    vision: m.supportsVision,
    apiModelId: m.apiModelId,
    requiredKey: 'ollamaApiKey' as const
}));

const GPTSAPI_MODELS = GPTSAPI_MODELS_CONFIG.map(m => ({
    id: m.id,
    name: m.name,
    provider: 'gptsapi',
    channel: 'GPTs API' as const,
    desc: m.description || '',
    recommended: m.recommended || false,
    vision: m.supportsVision,
    requiredKey: 'gptsapi' as const
}));

const DEEPSEEK_MODELS = DEEPSEEK_MODELS_CONFIG.map(m => ({
    id: m.id,
    name: m.name,
    provider: 'deepseek',
    channel: 'DeepSeek' as const,
    desc: m.description || '',
    recommended: m.recommended || false,
    vision: m.supportsVision,
    requiredKey: 'deepseek' as const
}));

const CLOUD_MODELS = [...GPTSAPI_MODELS, ...DEEPSEEK_MODELS, ...GOOGLE_MODELS, ...XIAOMI_MODELS, ...OPENROUTER_MODELS, ...OLLAMA_CLOUD_MODELS];

// ========== 自动拉取最新模型：UI 数据源合并 ==========

/** Agent 对话模型下拉用到的最小能力形态。 */
type CloudModelOption = {
    id: string;
    name: string;
    vision: boolean;
    conversation: boolean;
};

/** 刷新结果消息里显示的 provider 中文/渠道名。 */
const PROVIDER_REFRESH_LABELS: Record<string, string> = {
    gptsapi: 'GPTs API',
    deepseek: 'DeepSeek',
    google: 'Google',
    xiaomi: 'Xiaomi',
    'ollama-cloud': 'Ollama Cloud',
    openrouter: 'OpenRouter'
};

/** 主模型与视觉模型共用的云端候选分组，避免两套下拉列表继续漂移。 */
const CLOUD_MODEL_OPTION_GROUPS = [
    { provider: 'gptsapi', label: 'GPTs API (OpenAI 兼容)' },
    { provider: 'deepseek', label: 'DeepSeek (官方)' },
    { provider: 'google', label: 'Google AI Studio (官方)' },
    { provider: 'xiaomi', label: 'Xiaomi MiMo (官方)' },
    { provider: 'ollama-cloud', label: 'Ollama Cloud (免费额度)' },
    { provider: 'openrouter', label: 'OpenRouter (中转)' }
] as const;

/** 各 cloud provider 的硬编码模型（简化形态），供下拉默认数据源 + 合并去重的「优先层」。 */
const HARDCODED_OPTIONS_BY_PROVIDER: Record<string, CloudModelOption[]> = {
    gptsapi: GPTSAPI_MODELS.map(m => ({ id: m.id, name: m.name, vision: m.vision, conversation: true })),
    deepseek: DEEPSEEK_MODELS.map(m => ({ id: m.id, name: m.name, vision: m.vision, conversation: true })),
    google: GOOGLE_MODELS.map(m => ({ id: m.id, name: m.name, vision: m.vision, conversation: true })),
    xiaomi: XIAOMI_MODELS.map(m => ({ id: m.id, name: m.name, vision: m.vision, conversation: true })),
    openrouter: OPENROUTER_MODELS.map(m => ({ id: m.id, name: m.name, vision: m.vision, conversation: true })),
    'ollama-cloud': OLLAMA_CLOUD_MODELS.map(m => ({ id: m.id, name: m.name, vision: m.vision, conversation: true }))
};

/**
 * 合并某 provider 的硬编码下拉项与本会话拉取到的新模型，按 id 去重，硬编码优先。
 * 离线/无 key/失败时 fetchedNew 为空，自动退化为纯硬编码列表（不清空已有选项）。
 */
function buildProviderOptions(
    provider: string,
    fetchedNew: Record<string, CloudModelOption[]>
): CloudModelOption[] {
    const hardcoded = HARDCODED_OPTIONS_BY_PROVIDER[provider] || [];
    const seen = new Set(hardcoded.map(m => m.id));
    const extras = (fetchedNew[provider] || []).filter(m => !seen.has(m.id));
    return [...hardcoded, ...extras].filter(m => m.conversation);
}

interface SettingsModalProps {
    onClose: () => void;
}

const SKILL_CATEGORY_LABELS: Record<string, string> = {
    image: '图像',
    layout: '排版',
    text: '文本',
    document: '文档',
    batch: '批量',
    analysis: '分析',
    export: '导出',
    replication: '复刻',
    ecommerce: '电商'
};

// 设置页专用的 Skill 中文显示名。只影响这里的展示；
// 声明里的 name 参与能力匹配与路由（conversational.ts 的 match fields），不可直接改中文。
const SKILL_DISPLAY_NAMES: Record<string, string> = {
    'matte-product': '智能抠图',
    'smart-layout': '智能排版',
    'sku-config': 'SKU 配置准备',
    'sku-batch': 'SKU 批量生成',
    'shape-morphing': '形状变形',
    'layout-replication': '版式复刻',
    'design-reference-search': '设计参考检索',
    'visual-analysis': '视觉分析',
    'project-image-analysis': '项目图片分析',
    'layer-management': '图层管理',
    'find-and-edit-element': '查找并编辑元素',
    'agent-panel-bridge': '插件面板桥接',
    'document-management': '文档管理',
    'save-current-template': '保存当前模板',
    'text-font-replace': '文字字体替换',
    'ecommerce-socks-design': '电商袜子设计',
    'main-image-design': '主图设计',
    'detail-page-design': '详情页设计',
    'autonomous-agent': '自主智能体'
};

const BUILTIN_MCP_SERVERS = [
    {
        id: 'builtin-photoshop-host',
        name: 'Photoshop MCP Host',
        transport: 'http',
        endpoint: 'http://127.0.0.1:8768/mcp',
        description: 'Agent 内置 MCP Host，用于暴露 Photoshop UXP 插件工具。'
    },
    {
        id: 'builtin-design-crawler',
        name: 'Design Crawler MCP',
        transport: 'internal',
        endpoint: 'Electron IPC',
        description: 'Agent 内置设计参考爬虫能力，当前由桌面端内部服务提供。'
    }
] as const;

const PREFERENCE_STATUS_LABELS: Record<PreferenceMemoryItem['status'], string> = {
    active: '启用',
    disabled: '已禁用',
    needs_review: '待确认',
    archived: '已归档'
};

const PREFERENCE_SOURCE_LABELS: Record<PreferenceMemoryItem['sourceType'], string> = {
    explicit: '显式偏好',
    inferred: '推断偏好',
    temporary: '临时偏好',
    deprecated: '旧版偏好'
};

const PREFERENCE_CATEGORY_LABELS: Record<PreferenceMemoryItem['category'], string> = {
    font: '字体',
    color: '颜色',
    style: '风格',
    workflow: '工作流',
    interaction: '交互',
    copywriting: '文案',
    layout: '排版',
    unknown: '其他'
};

type PreferenceScopeType = NonNullable<PreferenceMemoryItem['scope']>['type'];

interface PreferenceDraft {
    category: PreferenceMemoryItem['category'];
    value: string;
    label: string;
    sourceNote: string;
    scopeType: PreferenceScopeType;
    scopeId: string;
}

const PREFERENCE_SCOPE_LABELS: Record<PreferenceScopeType, string> = {
    user: '用户级',
    project: '项目级',
    brand: '品牌级',
    session: '会话级'
};

const PREFERENCE_DRAFT_DEFAULT: PreferenceDraft = {
    category: 'style',
    value: '',
    label: '',
    sourceNote: '',
    scopeType: 'user',
    scopeId: ''
};

function preferenceItemToDraft(item: PreferenceMemoryItem): PreferenceDraft {
    return {
        category: item.category,
        value: item.value,
        label: item.label,
        sourceNote: item.sourceNote,
        scopeType: item.scope?.type || 'user',
        scopeId: item.scope?.id || ''
    };
}

function preferenceDraftScope(draft: PreferenceDraft): PreferenceMemoryItem['scope'] {
    const id = draft.scopeId.trim();
    return id ? { type: draft.scopeType, id } : { type: draft.scopeType };
}

function resolvePreferenceScopeId(
    scopeType: PreferenceScopeType,
    existingId: string,
    currentProjectId?: string
): string {
    if (scopeType === 'user') return '';
    if (scopeType === 'project') return currentProjectId || '';
    return existingId;
}

function formatPreferenceProjectBinding(
    scopeId: string,
    currentProjectId?: string,
    currentProjectName?: string
): string {
    if (!scopeId) return '请先打开一个项目';
    if (currentProjectId === scopeId && currentProjectName) return currentProjectName;
    return `项目 ${scopeId}`;
}

interface AgentContextOverviewProps {
    externalKnowledgeSourceCount: number;
    knowledgeStatus: string;
    eagleKnowledgeStatus: 'idle' | 'testing' | 'success' | 'error';
    activeLearningCount: number;
    pendingLearningCount: number;
    activePreferenceCount: number;
    pendingPreferenceCount: number;
    onOpenTab: (tab: 'knowledge' | 'learning' | 'preferences') => void;
}

function AgentContextOverview({
    externalKnowledgeSourceCount,
    knowledgeStatus,
    eagleKnowledgeStatus,
    activeLearningCount,
    pendingLearningCount,
    activePreferenceCount,
    pendingPreferenceCount,
    onOpenTab
}: AgentContextOverviewProps): React.ReactElement {
    return (
        <section className="agent-context-overview" aria-labelledby="agent-context-overview-title">
            <div className="agent-context-overview-header">
                <div>
                    <span className="agent-context-eyebrow">知识与记忆</span>
                    <h3 id="agent-context-overview-title">Agent 可用的知识与记忆</h3>
                    <p>这里展示本机保存的完整内容。实际任务只读取当前作用域；当前指令与项目事实始终优先。</p>
                </div>
                <span className="agent-context-boundary">只读参考 · 不直接执行</span>
            </div>
            <div className="agent-context-source-grid">
                <button type="button" className="agent-context-source-card" onClick={() => onOpenTab('knowledge')}>
                    <span className="agent-context-source-label">知识来源</span>
                    <strong>{formatKnowledgeSourceStatus(knowledgeStatus, externalKnowledgeSourceCount, eagleKnowledgeStatus)}</strong>
                    <span>内置方法论 · Web {externalKnowledgeSourceCount} 个 · Eagle {formatEagleProbeStatus(eagleKnowledgeStatus)}</span>
                </button>
                <button type="button" className="agent-context-source-card" onClick={() => onOpenTab('learning')}>
                    <span className="agent-context-source-label">长期设计记忆</span>
                    <strong>{activeLearningCount} 条已采用</strong>
                    <span>{pendingLearningCount} 条待你复核</span>
                </button>
                <button type="button" className="agent-context-source-card" onClick={() => onOpenTab('preferences')}>
                    <span className="agent-context-source-label">用户偏好</span>
                    <strong>{activePreferenceCount} 条启用</strong>
                    <span>{pendingPreferenceCount} 条旧版候选待确认</span>
                </button>
            </div>
            <div className="agent-context-save-policy">
                <span>知识来源配置：点击底部“保存设置”后生效</span>
                <span>学习复核与用户偏好：操作后立即保存</span>
            </div>
        </section>
    );
}

function formatKnowledgeSourceStatus(
    status: string,
    externalSourceCount: number,
    eagleStatus: AgentContextOverviewProps['eagleKnowledgeStatus']
): string {
    if (status === 'ready' || eagleStatus === 'success') return '外部来源可用';
    if (externalSourceCount > 0 || eagleStatus === 'idle' || eagleStatus === 'testing') {
        return '外部来源待检查';
    }
    return '仅使用内置方法论';
}

function formatEagleProbeStatus(status: AgentContextOverviewProps['eagleKnowledgeStatus']): string {
    if (status === 'success') return '可用';
    if (status === 'error') return '不可用';
    if (status === 'testing') return '检查中';
    return '未检查';
}

function knowledgeProbeBadgeClass(status: AgentContextOverviewProps['eagleKnowledgeStatus']): string {
    if (status === 'success') return 'success';
    if (status === 'error') return 'warning';
    return '';
}

function formatCapabilityStatus(value: unknown): string {
    const status = String(value || '').trim().toLowerCase();
    if (status === 'ready' || status === 'ok' || status === 'available' || status === 'supported') return '可用';
    if (status === 'watch' || status === 'testing' || status === 'checking') return '需检查';
    if (status === 'disabled') return '未启用';
    if (status === 'unsupported') return '不支持';
    if (status === 'unknown' || !status) return '未确认';
    if (status === 'stream') return '流式';
    if (status === 'non_stream' || status === 'non-stream') return '非流式';
    return String(value);
}

// ========== 智能分割模型配置 ==========
interface SegmentationModel {
    id: string;
    name: string;
    description: string;
    size: string;
    downloadUrl: string;
    mirrorUrl?: string;  // 中国镜像
    fileName: string;
    folder: string;
    required: boolean;
    feature: string;  // 功能说明
}

// 推荐的模型配置（最佳实践：文本定位 + 精确分割）
const SEGMENTATION_MODELS: SegmentationModel[] = [
    {
        id: 'birefnet',
        name: 'BiRefNet',
        description: '高精度边缘分割',
        feature: '精确分割 + 边缘细化',
        size: '~176MB',
        downloadUrl: 'https://huggingface.co/onnx-community/BiRefNet/resolve/main/onnx/model.onnx',
        mirrorUrl: 'https://hf-mirror.com/onnx-community/BiRefNet/resolve/main/onnx/model.onnx',
        fileName: 'birefnet.onnx',
        folder: 'birefnet',
        required: true
    },
    {
        id: 'yolo-world',
        name: 'YOLO-World',
        description: '开放词汇目标检测',
        feature: '文本定位 + 目标检测',
        size: '~48MB',
        downloadUrl: 'https://huggingface.co/x1yiis/yolo-world-onnx/resolve/main/yolov8s-worldv2.onnx',
        mirrorUrl: 'https://hf-mirror.com/x1yiis/yolo-world-onnx/resolve/main/yolov8s-worldv2.onnx',
        fileName: 'yolov8s-worldv2.onnx',
        folder: 'yolo-world',
        required: false
    },
    {
        id: 'sam-encoder',
        name: 'MobileSAM Encoder',
        description: '交互式分割编码器',
        feature: '选区分割 - 图像特征提取',
        size: '~36MB',
        downloadUrl: 'https://huggingface.co/vietanhdev/mobile-sam-onnx/resolve/main/mobile_sam_image_encoder.onnx',
        mirrorUrl: 'https://hf-mirror.com/vietanhdev/mobile-sam-onnx/resolve/main/mobile_sam_image_encoder.onnx',
        fileName: 'mobile_sam_encoder.onnx',
        folder: 'sam',
        required: false
    },
    {
        id: 'sam-decoder',
        name: 'MobileSAM Decoder',
        description: '交互式分割解码器',
        feature: '选区分割 - Box Prompt 分割',
        size: '~16MB',
        downloadUrl: 'https://huggingface.co/vietanhdev/mobile-sam-onnx/resolve/main/mobile_sam_mask_decoder.onnx',
        mirrorUrl: 'https://hf-mirror.com/vietanhdev/mobile-sam-onnx/resolve/main/mobile_sam_mask_decoder.onnx',
        fileName: 'mobile_sam_decoder.onnx',
        folder: 'sam',
        required: false
    }
];

// 模型管理组件
const SegmentationModelManager: React.FC = () => {
    const [modelStatus, setModelStatus] = useState<Record<string, 'installed' | 'missing' | 'downloading'>>({});
    const [downloadProgress, setDownloadProgress] = useState<Record<string, number>>({});

    // 检查模型状态
    const checkModelStatus = async () => {
        const api = window.designEcho as any;
        if (!api?.checkSegmentModelExists) return;
        
        const status: Record<string, 'installed' | 'missing'> = {};
        for (const model of SEGMENTATION_MODELS) {
            try {
                const exists = await api.checkSegmentModelExists(model.folder, model.fileName);
                status[model.id] = exists ? 'installed' : 'missing';
            } catch {
                status[model.id] = 'missing';
            }
        }
        setModelStatus(status);
    };

    useEffect(() => {
        checkModelStatus();
    }, []);

    // 下载模型
    const handleDownload = async (model: SegmentationModel) => {
        const api = window.designEcho as any;
        if (!api?.downloadSegmentModel) {
            // 降级：打开浏览器下载
            if (api?.openExternal) {
                api.openExternal(model.downloadUrl);
            } else {
                window.open(model.downloadUrl, '_blank');
            }
            return;
        }

        setModelStatus(prev => ({ ...prev, [model.id]: 'downloading' }));
        setDownloadProgress(prev => ({ ...prev, [model.id]: 0 }));

        try {
            await api.downloadSegmentModel({
                url: model.downloadUrl,
                folder: model.folder,
                fileName: model.fileName,
                onProgress: (progress: number) => {
                    setDownloadProgress(prev => ({ ...prev, [model.id]: progress }));
                }
            });
            setModelStatus(prev => ({ ...prev, [model.id]: 'installed' }));
        } catch (e: any) {
            console.error('下载失败:', e);
            setModelStatus(prev => ({ ...prev, [model.id]: 'missing' }));
            alert(`下载失败: ${e.message}\n\n请手动下载模型文件。`);
        }
    };

    // 打开模型目录
    const openModelsFolder = () => {
        const api = window.designEcho as any;
        if (api?.openModelsFolder) {
            api.openModelsFolder();
        }
    };

    const getStatusBadge = (modelId: string) => {
        const status = modelStatus[modelId];
        if (status === 'installed') {
            return <span style={{ color: '#10b981', fontSize: '12px' }}>✅ 已安装</span>;
        }
        if (status === 'downloading') {
            const progress = downloadProgress[modelId] || 0;
            return <span style={{ color: '#3b82f6', fontSize: '12px' }}>⏳ 下载中 {progress}%</span>;
        }
        return <span style={{ color: '#ef4444', fontSize: '12px' }}>❌ 未安装</span>;
    };

    return (
        <div className="model-manager">
            {/* 功能说明 */}
            <div style={{ 
                marginBottom: '16px', 
                padding: '12px 16px', 
                background: 'linear-gradient(135deg, rgba(59, 130, 246, 0.1), rgba(16, 185, 129, 0.1))',
                borderRadius: '8px',
                border: '1px solid rgba(59, 130, 246, 0.2)'
            }}>
                <div style={{ fontSize: '13px', fontWeight: 600, marginBottom: '8px', color: 'var(--de-text)' }}>
                    ✨ 智能分割流程
                </div>
                <div style={{ fontSize: '12px', color: 'var(--de-text-secondary)', lineHeight: 1.6 }}>
                    <span style={{ color: '#3b82f6' }}>文本定位</span> (YOLO-World) → 
                    <span style={{ color: '#10b981' }}> 目标检测</span> → 
                    <span style={{ color: '#8b5cf6' }}> 精确分割</span> (BiRefNet) → 
                    <span style={{ color: '#f59e0b' }}> 边缘细化</span>
                </div>
            </div>

            {/* 顶部操作栏 */}
            <div style={{ marginBottom: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '13px', color: 'var(--de-text-secondary)' }}>
                    总计约 224MB（BiRefNet 必需，YOLO-World 可选）
                </span>
                <button
                    onClick={openModelsFolder}
                    style={{
                        padding: '4px 12px',
                        fontSize: '11px',
                        background: 'var(--de-bg-tertiary)',
                        border: '1px solid var(--de-border)',
                        borderRadius: '4px',
                        cursor: 'pointer',
                        color: 'var(--de-text)'
                    }}
                >
                    📂 打开模型目录
                </button>
            </div>

            {/* 模型列表 */}
            {SEGMENTATION_MODELS.map(model => (
                <div
                    key={model.id}
                    style={{
                        padding: '16px',
                        background: 'var(--de-bg-secondary)',
                        borderRadius: '8px',
                        marginBottom: '12px',
                        border: `1px solid ${model.required ? 'rgba(59, 130, 246, 0.3)' : 'var(--de-border)'}`
                    }}
                >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                        <div>
                            <span style={{ fontWeight: 600, fontSize: '14px' }}>{model.name}</span>
                            {model.required ? (
                                <span style={{ 
                                    marginLeft: '8px', 
                                    fontSize: '10px', 
                                    padding: '2px 6px', 
                                    background: '#3b82f6', 
                                    color: 'white', 
                                    borderRadius: '4px' 
                                }}>
                                    必需
                                </span>
                            ) : (
                                <span style={{ 
                                    marginLeft: '8px', 
                                    fontSize: '10px', 
                                    padding: '2px 6px', 
                                    background: '#6b7280', 
                                    color: 'white', 
                                    borderRadius: '4px' 
                                }}>
                                    推荐
                                </span>
                            )}
                        </div>
                        {getStatusBadge(model.id)}
                    </div>
                    <p style={{ fontSize: '12px', color: 'var(--de-text-secondary)', margin: '0 0 4px 0' }}>
                        {model.description} · {model.size}
                    </p>
                    <p style={{ fontSize: '11px', color: '#10b981', margin: '0 0 12px 0' }}>
                        功能: {model.feature}
                    </p>
                    {modelStatus[model.id] !== 'installed' && (
                        <div style={{ display: 'flex', gap: '8px' }}>
                            <button
                                onClick={() => handleDownload(model)}
                                disabled={modelStatus[model.id] === 'downloading'}
                                style={{
                                    padding: '8px 16px',
                                    fontSize: '12px',
                                    background: modelStatus[model.id] === 'downloading' ? 'var(--de-bg-tertiary)' : '#3b82f6',
                                    color: 'white',
                                    border: 'none',
                                    borderRadius: '6px',
                                    cursor: modelStatus[model.id] === 'downloading' ? 'not-allowed' : 'pointer',
                                    fontWeight: 500
                                }}
                            >
                                {modelStatus[model.id] === 'downloading' ? '下载中...' : '⬇️ 下载'}
                            </button>
                            {model.mirrorUrl && (
                                <button
                                    onClick={() => window.open(model.mirrorUrl, '_blank')}
                                    style={{
                                        padding: '8px 12px',
                                        fontSize: '11px',
                                        background: 'transparent',
                                        color: 'var(--de-text-secondary)',
                                        border: '1px solid var(--de-border)',
                                        borderRadius: '6px',
                                        cursor: 'pointer'
                                    }}
                                >
                                    🇨🇳 镜像
                                </button>
                            )}
                        </div>
                    )}
                </div>
            ))}

            <details style={{ marginTop: '16px', fontSize: '12px', color: '#888' }}>
                <summary style={{ cursor: 'pointer', marginBottom: '8px' }}>📖 手动安装说明</summary>
                <ol style={{ margin: 0, paddingLeft: '20px', lineHeight: 1.8 }}>
                    <li>点击"打开模型目录"按钮</li>
                    <li>从 Hugging Face 或镜像站下载模型文件</li>
                    <li>将文件放入对应文件夹：
                        <ul style={{ marginTop: '4px', paddingLeft: '16px' }}>
                            <li><code>birefnet/birefnet.onnx</code> (必需)</li>
                            <li><code>yolo-world/yolov8s-worldv2.onnx</code> (推荐)</li>
                        </ul>
                    </li>
                    <li>重启 Agent 应用</li>
                </ol>
            </details>
        </div>
    );
};

export const SettingsModal: React.FC<SettingsModalProps> = ({ onClose }) => {
    const {
        apiKeys, setApiKeys,
        modelPreferences, setModelPreferences,
        morphingSettings, setMorphingSettings,
        integrationSettings, setIntegrationSettings,
        designKnowledgeSettings, setDesignKnowledgeSettings,
        designDimensionSpec, setDesignDimensionSpec, resetDesignDimensionSpec,
        currentProject,
        upsertDynamicModels,
        theme, setTheme
    } = useAppStore();
    const resolvedDimensionSpec = normalizeDesignDimensionSpec(designDimensionSpec);
    // 数字尺寸输入用本地草稿态：打字期间不做归一化/clamp（避免"输入1440被实时 clamp 成上限8000"这类干扰），
    // 失焦时才提交（合法正数写入 store，留空则不写→走预设）；上下限归一化只在消费端 normalizeDesignDimensionSpec 执行。
    const [dimensionDrafts, setDimensionDrafts] = useState<Record<string, string>>({});
    const dimensionNumberInputProps = (draftKey: string, resolvedValue: number, commit: (n: number) => void) => ({
        type: 'number' as const,
        value: dimensionDrafts[draftKey] !== undefined ? dimensionDrafts[draftKey] : String(resolvedValue),
        onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
            setDimensionDrafts((drafts) => ({ ...drafts, [draftKey]: e.target.value })),
        onBlur: (e: React.FocusEvent<HTMLInputElement>) => {
            const raw = e.target.value.trim();
            setDimensionDrafts((drafts) => {
                const next = { ...drafts };
                delete next[draftKey];
                return next;
            });
            if (raw === '') return; // 留空 → 不写，走预设
            const n = Number(raw);
            if (Number.isFinite(n) && n > 0) commit(n);
        }
    });

    // 在系统浏览器中打开链接
    const openExternalLink = (url: string) => {
        const designEcho = (window as any).designEcho;
        if (designEcho?.openExternal) {
            designEcho.openExternal(url);
        } else {
            // 降级：在新窗口打开
            window.open(url, '_blank');
        }
    };
    
    // ========== 状态 ==========
    const [activeTab, setActiveTab] = useState<SettingsTab>('ai-models');
    const activeTabPanelId = getSettingsPanelId(activeTab);

    const focusSettingsTab = (tab: SettingsTab) => {
        window.requestAnimationFrame(() => {
            document.getElementById(getSettingsTabId(tab))?.focus();
        });
    };

    const handleTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, tab: SettingsTab) => {
        const currentIndex = SETTINGS_TABS.findIndex((item) => item.id === tab);
        if (currentIndex < 0) return;

        let nextIndex = currentIndex;
        if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
            nextIndex = (currentIndex + 1) % SETTINGS_TABS.length;
        } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
            nextIndex = (currentIndex - 1 + SETTINGS_TABS.length) % SETTINGS_TABS.length;
        } else if (event.key === 'Home') {
            nextIndex = 0;
        } else if (event.key === 'End') {
            nextIndex = SETTINGS_TABS.length - 1;
        } else {
            return;
        }

        event.preventDefault();
        const nextTab = SETTINGS_TABS[nextIndex].id;
        setActiveTab(nextTab);
        focusSettingsTab(nextTab);
    };
    const [localKeys, setLocalKeys] = useState({
        openrouter: apiKeys.openrouter || '',
        anthropic: apiKeys.anthropic || '',
        google: apiKeys.google || '',
        xiaomi: apiKeys.xiaomi || '',
        openai: apiKeys.openai || '',
        gptsapi: apiKeys.gptsapi || '',
        ollamaUrl: apiKeys.ollamaUrl || 'http://localhost:11434',
        deepseek: apiKeys.deepseek || '',
        ollamaApiKey: apiKeys.ollamaApiKey || '',  // Ollama 云服务 API Key
        bfl: apiKeys.bfl || '',  // Black Forest Labs (FLUX) API Key
        volcengineJimengAccessKeyId: apiKeys.volcengineJimengAccessKeyId || '',
        volcengineJimengSecretAccessKey: apiKeys.volcengineJimengSecretAccessKey || '',
        volcengineSeedreamApiKey: apiKeys.volcengineSeedreamApiKey || '',
        volcengineTosRegion: apiKeys.volcengineTosRegion || 'cn-beijing',
        volcengineTosEndpoint: apiKeys.volcengineTosEndpoint || 'tos-s3-cn-beijing.volces.com',
        volcengineTosBucket: apiKeys.volcengineTosBucket || '',
        volcengineTosPublicBaseUrl: apiKeys.volcengineTosPublicBaseUrl || '',
        volcengineTosKeyPrefix: apiKeys.volcengineTosKeyPrefix || 'designecho/jimeng-i2i',
    });
    // 修复已删除的模型配置
    const fixDeletedModels = (prefs: typeof modelPreferences) => {
        const validLocalIds = OLLAMA_MODELS.map(m => m.id);
        const fixedPrefs = { ...prefs, preferredLocalModels: { ...prefs.preferredLocalModels } };
        let needsFix = false;
        
        // 检查本地模型偏好中是否有无效的模型
        Object.entries(prefs.preferredLocalModels).forEach(([key, modelId]) => {
            // 检查 local- 前缀（新格式）和 ollama- 前缀（旧格式）
            const isLocalModel = modelId.startsWith('local-') || modelId.startsWith('ollama-');
            
            if (isLocalModel && !validLocalIds.includes(modelId)) {
                console.warn(`[Settings] 模型 ${modelId} 不存在于有效列表中，替换为默认值`);
                
                // 使用统一配置中的默认值（新格式 local-xxx）
                const defaultValue = DEFAULT_MODEL_PREFERENCES.preferredLocalModels[key as keyof typeof DEFAULT_MODEL_PREFERENCES.preferredLocalModels];
                (fixedPrefs.preferredLocalModels as any)[key] = defaultValue || validLocalIds[0];
                needsFix = true;
            }
        });
        
        return { prefs: fixedPrefs, needsFix };
    };
    
    const { prefs: fixedModelPrefs, needsFix } = fixDeletedModels(modelPreferences);
    const [localPrefs, setLocalPrefs] = useState(fixedModelPrefs);
    const [localIntegration, setLocalIntegration] = useState(integrationSettings);
    const [localDesignKnowledge, setLocalDesignKnowledge] = useState(
        normalizeDesignKnowledgeSettings(designKnowledgeSettings)
    );
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    const [preferenceItems, setPreferenceItems] = useState<PreferenceMemoryItem[]>(() => getMemoryService().listPreferenceItems());
    const [preferenceMessage, setPreferenceMessage] = useState('');
    const [preferenceEditorOpen, setPreferenceEditorOpen] = useState(false);
    const [editingPreferenceId, setEditingPreferenceId] = useState<string | null>(null);
    const [preferenceDraft, setPreferenceDraft] = useState<PreferenceDraft>(PREFERENCE_DRAFT_DEFAULT);
    const [preferenceImportText, setPreferenceImportText] = useState('');
    const [preferenceExportText, setPreferenceExportText] = useState('');
    const [contextMemoryRevision, setContextMemoryRevision] = useState(0);

    function handleContextMemoryChanged(): void {
        setContextMemoryRevision((revision) => revision + 1);
    }

    useEffect(() => {
        setLocalIntegration(integrationSettings);
    }, [integrationSettings]);

    useEffect(() => {
        setLocalDesignKnowledge(normalizeDesignKnowledgeSettings(designKnowledgeSettings));
    }, [designKnowledgeSettings]);

    const visibleSkills = getUserFacingSkills();
    const enabledSkillCount = visibleSkills.filter(
        (skill) => localIntegration.skills?.[skill.id]?.enabled !== false
    ).length;
    const enabledMcpCount = localIntegration.mcpServers.filter((server) => server.enabled).length;
    const activePreferenceCount = preferenceItems.filter((item) => item.status === 'active').length;
    const reviewPreferenceCount = preferenceItems.filter((item) => item.status === 'needs_review').length;
    const disabledPreferenceCount = preferenceItems.filter((item) => item.status === 'disabled').length;
    const archivedPreferenceCount = preferenceItems.filter((item) => item.status === 'archived').length;
    const persistedDesignMemoryItems = getMemoryService().listPersistedDesignMemoryItems({ limit: 200 });
    const activeLearningCount = persistedDesignMemoryItems.filter((item) => item.status === 'active').length;
    const pendingLearningCount = persistedDesignMemoryItems.filter((item) => item.status === 'needs_review').length;
    const externalKnowledgeSourceCount = Number(localDesignKnowledge.xiaomiWebSearch.enabled)
        + Number(localDesignKnowledge.searxng.enabled);
    const designKnowledgeSummary = buildDesignKnowledgeSettingsSummary(localDesignKnowledge);
    const designKnowledgeSelectedModel = getModelById(
        localPrefs.orchestrator?.primaryModel || localPrefs.preferredCloudModels.layoutAnalysis
    );
    const designKnowledgeRuntimeCapability = buildDesignKnowledgeRuntimeCapabilitySummary({
        settings: localDesignKnowledge,
        model: designKnowledgeSelectedModel
    });
    const settingsTabCounts: Partial<Record<SettingsTab, number>> = {
        learning: pendingLearningCount > 0 ? pendingLearningCount : activeLearningCount,
        preferences: reviewPreferenceCount > 0 ? reviewPreferenceCount : activePreferenceCount
    };
    const skillGroups = Object.entries(
        visibleSkills.reduce<Record<string, typeof visibleSkills>>((groups, skill) => {
            const category = skill.category || 'other';
            if (!groups[category]) groups[category] = [];
            groups[category].push(skill);
            return groups;
        }, {})
    );
    // 如果需要修复，自动保存
    useEffect(() => {
        if (needsFix) {
            setModelPreferences(fixedModelPrefs);
            window.designEcho?.setModelPreferences?.(fixedModelPrefs);
            console.log('[Settings] 已自动修复模型配置');
        }
    }, []);
    
    // Ollama 状态
    const [ollamaStatus, setOllamaStatus] = useState<'checking' | 'online' | 'offline'>('checking');
    const [installedModels, setInstalledModels] = useState<string[]>([]);
    
    
    // API 测试状态 - OpenRouter
    const [apiTestStatus, setApiTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
    const [apiTestMessage, setApiTestMessage] = useState('');
    
    // API 测试状态 - Google AI Studio
    const [googleApiTestStatus, setGoogleApiTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
    const [googleApiTestMessage, setGoogleApiTestMessage] = useState('');
    
    // API 测试状态 - Ollama Cloud
    const [ollamaCloudTestStatus, setOllamaCloudTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
    const [ollamaCloudTestMessage, setOllamaCloudTestMessage] = useState('');

    // API 测试状态 - DeepSeek 官方
    const [deepSeekTestStatus, setDeepSeekTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
    const [deepSeekTestMessage, setDeepSeekTestMessage] = useState('');
    
    // API 测试状态 - BFL (Black Forest Labs)
    const [bflTestStatus, setBflTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
    const [bflTestMessage, setBflTestMessage] = useState('');

    // 自动拉取最新模型：本会话拉到的新模型（硬编码里没有的），按 provider 归档
    const [fetchedModelsByProvider, setFetchedModelsByProvider] = useState<Record<string, CloudModelOption[]>>({});
    // 各 provider 的刷新按钮状态机（与 test 按钮范式一致）
    const [modelRefreshStatus, setModelRefreshStatus] = useState<Record<string, 'idle' | 'loading' | 'success' | 'error'>>({});
    const [modelRefreshMessage, setModelRefreshMessage] = useState<Record<string, string>>({});

    // API 测试状态 - 火山即梦
    const [jimengTestStatus, setJimengTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
    const [jimengTestMessage, setJimengTestMessage] = useState('');

    // API 测试状态 - Seedream
    const [seedreamTestStatus, setSeedreamTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
    const [seedreamTestMessage, setSeedreamTestMessage] = useState('');

    // 设计知识 SearXNG 健康检查状态
    const [designKnowledgeTestStatus, setDesignKnowledgeTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
    const [designKnowledgeTestMessage, setDesignKnowledgeTestMessage] = useState('');
    const [eagleKnowledgeTestStatus, setEagleKnowledgeTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
    const [eagleKnowledgeTestMessage, setEagleKnowledgeTestMessage] = useState('');
    
    // 本地模型测试状态
    const [modelTestStatus, setModelTestStatus] = useState<'idle' | 'testing'>('idle');
    const [modelTestResults, setModelTestResults] = useState<Record<string, { status: 'success' | 'error' | 'pending'; message: string }>>({});
    
    // Ollama 模型下载状态
    const [ollamaDownloading, setOllamaDownloading] = useState<Record<string, boolean>>({});
    const [ollamaDownloadMessages, setOllamaDownloadMessages] = useState<Record<string, string>>({});
    
    // 抠图使用本地 ONNX 模型（BiRefNet + YOLO-World）

    // ========== Effects ==========
    
    // 检查 Ollama 状态
    useEffect(() => {
        const checkOllama = async () => {
            try {
                const response = await fetch(`${localKeys.ollamaUrl}/api/tags`);
                if (response.ok) {
                    const data = await response.json();
                    setInstalledModels(data.models?.map((m: any) => m.name) || []);
                    setOllamaStatus('online');
                } else {
                    setOllamaStatus('offline');
                }
            } catch {
                setOllamaStatus('offline');
            }
        };
        checkOllama();
    }, [localKeys.ollamaUrl]);


    // ESC 键关闭
    useEffect(() => {
        const handleEsc = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', handleEsc);
        return () => window.removeEventListener('keydown', handleEsc);
    }, [onClose]);

    // ========== 处理函数 ==========
    
    const handleBackdropClick = (e: React.MouseEvent) => {
        if (e.target === e.currentTarget) onClose();
    };

    const createMcpServerDraft = (transport: 'stdio' | 'http') => ({
        id: typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
            ? crypto.randomUUID()
            : `mcp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name: transport === 'stdio' ? 'New MCP Server' : 'New MCP Endpoint',
        transport,
        enabled: true,
        command: transport === 'stdio' ? 'node' : '',
        args: [],
        url: transport === 'http' ? 'http://127.0.0.1:3000/mcp' : '',
        notes: ''
    });

    const handleToggleSkill = (skillId: string, enabled: boolean) => {
        setLocalIntegration((prev) => ({
            ...prev,
            skills: {
                ...prev.skills,
                [skillId]: { enabled }
            }
        }));
    };

    const handleAddMcpServer = (transport: 'stdio' | 'http') => {
        setLocalIntegration((prev) => ({
            ...prev,
            mcpServers: [...prev.mcpServers, createMcpServerDraft(transport)]
        }));
    };

    const handleUpdateMcpServer = (
        id: string,
        patch: Partial<(typeof localIntegration.mcpServers)[number]>
    ) => {
        setLocalIntegration((prev) => ({
            ...prev,
            mcpServers: prev.mcpServers.map((server) =>
                server.id === id ? { ...server, ...patch } : server
            )
        }));
    };

    const handleRemoveMcpServer = (id: string) => {
        setLocalIntegration((prev) => ({
            ...prev,
            mcpServers: prev.mcpServers.filter((server) => server.id !== id)
        }));
    };

    const handleUpdateDesignKnowledgeSearxng = (
        patch: Partial<typeof localDesignKnowledge.searxng>
    ) => {
        setLocalDesignKnowledge((prev) => normalizeDesignKnowledgeSettings({
            ...prev,
            searxng: {
                ...prev.searxng,
                ...patch
            }
        }));
    };

    const handleUpdateDesignKnowledgeXiaomiWebSearch = (
        patch: Partial<typeof localDesignKnowledge.xiaomiWebSearch>
    ) => {
        setLocalDesignKnowledge((prev) => normalizeDesignKnowledgeSettings({
            ...prev,
            xiaomiWebSearch: {
                ...prev.xiaomiWebSearch,
                ...patch
            }
        }));
    };

    const refreshPreferenceItems = () => {
        setPreferenceItems(getMemoryService().listPreferenceItems());
    };

    const handleCreatePreference = () => {
        setEditingPreferenceId(null);
        setPreferenceDraft(PREFERENCE_DRAFT_DEFAULT);
        setPreferenceEditorOpen(true);
        setPreferenceMessage('');
    };

    const handleEditPreference = (item: PreferenceMemoryItem) => {
        setEditingPreferenceId(item.id);
        setPreferenceDraft(preferenceItemToDraft(item));
        setPreferenceEditorOpen(true);
        setPreferenceMessage('');
    };

    const handleCancelPreferenceEdit = () => {
        setEditingPreferenceId(null);
        setPreferenceDraft(PREFERENCE_DRAFT_DEFAULT);
        setPreferenceEditorOpen(false);
    };

    const handleSavePreferenceDraft = () => {
        const value = preferenceDraft.value.trim();
        if (!value) {
            setPreferenceMessage('偏好值不能为空。');
            return;
        }
        if (preferenceDraft.scopeType === 'project' && !preferenceDraft.scopeId.trim()) {
            setPreferenceMessage('请先打开一个项目，再保存项目级偏好。');
            return;
        }
        if ((preferenceDraft.scopeType === 'brand' || preferenceDraft.scopeType === 'session')
            && !preferenceDraft.scopeId.trim()) {
            setPreferenceMessage('品牌级或会话级偏好需要填写作用域 ID。');
            return;
        }

        try {
            const payload = {
                category: preferenceDraft.category,
                value,
                label: preferenceDraft.label.trim() || undefined,
                sourceNote: preferenceDraft.sourceNote.trim() || undefined,
                scope: preferenceDraftScope(preferenceDraft)
            };
            const updated = editingPreferenceId
                ? getMemoryService().updatePreferenceItem(editingPreferenceId, {
                    ...payload,
                    sourceType: 'explicit',
                    status: 'active'
                })
                : getMemoryService().upsertExplicitPreference(payload);
            refreshPreferenceItems();
            setPreferenceEditorOpen(false);
            setEditingPreferenceId(null);
            setPreferenceDraft(PREFERENCE_DRAFT_DEFAULT);
            setPreferenceMessage(`已保存偏好：${updated.label}`);
        } catch (error: any) {
            setPreferenceMessage(error?.message || '保存偏好失败。');
        }
    };

    const handleExportPreferences = async () => {
        const snapshot = getMemoryService().exportPreferences();
        const text = JSON.stringify(snapshot, null, 2);
        setPreferenceExportText(text);
        try {
            await navigator.clipboard?.writeText(text);
            setPreferenceMessage('已导出偏好 JSON，并尝试复制到剪贴板。');
        } catch {
            setPreferenceMessage('已导出偏好 JSON，可从文本框复制。');
        }
    };

    const handleImportPreferences = () => {
        if (!preferenceImportText.trim()) {
            setPreferenceMessage('请先粘贴需要导入的偏好 JSON。');
            return;
        }
        try {
            const result = getMemoryService().importPreferences(preferenceImportText, { mode: 'merge' });
            refreshPreferenceItems();
            setPreferenceMessage(`已导入 ${result.importedCount} 条偏好，更新 ${result.replacedExistingCount} 条，跳过 ${result.skippedCount} 条。`);
        } catch (error: any) {
            setPreferenceMessage(error?.message || '导入偏好失败。');
        }
    };

    const handleTogglePreference = (item: PreferenceMemoryItem) => {
        const nextEnabled = item.status !== 'active';
        const updated = getMemoryService().setPreferenceEnabled(item.id, nextEnabled);
        refreshPreferenceItems();
        setPreferenceMessage(nextEnabled ? `已启用偏好：${updated.label}` : `已禁用偏好：${updated.label}`);
    };

    const handleArchivePreference = (item: PreferenceMemoryItem) => {
        const updated = getMemoryService().archivePreference(item.id);
        refreshPreferenceItems();
        setPreferenceMessage(`已归档偏好：${updated.label}`);
    };

    const handleClearInferredPreferences = () => {
        const result = getMemoryService().clearInferredPreferences();
        refreshPreferenceItems();
        setPreferenceMessage(`已归档 ${result.archivedCount} 条待确认推断偏好。`);
    };

    const handleSave = async () => {
        setSaving(true);
        try {
            setApiKeys(localKeys);
            setModelPreferences(localPrefs);
            setIntegrationSettings(localIntegration);
            await window.designEcho?.setApiKeys(localKeys);
            await window.designEcho?.setModelPreferences?.(localPrefs);
            // 保存形态统一设置到主进程
            if (morphingSettings) {
                await window.designEcho?.setMorphingSettings?.(morphingSettings);
            }
            setSaved(true);
            setTimeout(() => setSaved(false), 2000);
        } catch (error) {
            console.error('Failed to save settings:', error);
        } finally {
            setSaving(false);
        }
    };

    const handleTestDesignKnowledge = async () => {
        const settings = normalizeDesignKnowledgeSettings(localDesignKnowledge);

        if (!settings.searxng.enabled) {
            setDesignKnowledgeTestStatus('error');
            setDesignKnowledgeTestMessage('请先启用 SearXNG 设计知识搜索。');
            return;
        }

        if (!settings.searxng.endpoint) {
            setDesignKnowledgeTestStatus('error');
            setDesignKnowledgeTestMessage('请先填写 SearXNG endpoint，例如 http://127.0.0.1:8080。');
            return;
        }

        setDesignKnowledgeTestStatus('testing');
        setDesignKnowledgeTestMessage('正在检查 SearXNG endpoint...');

        try {
            if (!window.designEcho?.probeDesignKnowledgeSearxng) {
                throw new Error('当前版本不支持设计知识健康检查。');
            }

            const result = await window.designEcho.probeDesignKnowledgeSearxng(settings);
            if (result.success && result.status === 'ok') {
                setDesignKnowledgeTestStatus('success');
                setDesignKnowledgeTestMessage(`SearXNG 已响应。HTTP ${result.httpStatus || 200}`);
            } else {
                const warnings = Array.isArray(result.warnings) ? result.warnings.join(' ') : '';
                setDesignKnowledgeTestStatus('error');
                setDesignKnowledgeTestMessage(result.error || warnings || `SearXNG 状态：${result.status || 'unavailable'}`);
            }
        } catch (error: any) {
            setDesignKnowledgeTestStatus('error');
            setDesignKnowledgeTestMessage(error?.message || 'SearXNG 健康检查失败。');
        }

        setTimeout(() => setDesignKnowledgeTestStatus('idle'), 7000);
    };

    const handleTestEagleKnowledge = async () => {
        setEagleKnowledgeTestStatus('testing');
        setEagleKnowledgeTestMessage('正在检查 Eagle 只读知识连接...');
        try {
            if (!window.designEcho?.probeDesignKnowledgeEagleReadonly) {
                throw new Error('当前版本不支持 Eagle 只读知识检查。');
            }
            const result = await window.designEcho.probeDesignKnowledgeEagleReadonly({ enabled: true });
            if (result.success && result.status === 'ok') {
                setEagleKnowledgeTestStatus('success');
                setEagleKnowledgeTestMessage('Eagle 素材库已连接；只读取索引，不会修改素材。');
                return;
            }
            setEagleKnowledgeTestStatus('error');
            setEagleKnowledgeTestMessage(result.error || result.warnings.join(' ') || 'Eagle 只读知识连接不可用。');
        } catch (error: any) {
            setEagleKnowledgeTestStatus('error');
            setEagleKnowledgeTestMessage(error?.message || 'Eagle 只读知识检查失败。');
        }
    };

    const handleTestApi = async () => {
        const apiKey = localKeys.openrouter?.trim();
        if (!apiKey) {
            setApiTestStatus('error');
            setApiTestMessage('请先输入 API Key');
            return;
        }
        
        setApiTestStatus('testing');
        setApiTestMessage('正在测试...');
        
        try {
            const response = await fetch('https://openrouter.ai/api/v1/models', {
                method: 'GET',
                headers: { 'Authorization': `Bearer ${apiKey}` }
            });
            
            if (response.ok) {
                const data = await response.json();
                setApiTestStatus('success');
                setApiTestMessage(`✅ 连接成功！可用 ${data?.data?.length || 0} 个模型`);
            } else if (response.status === 401) {
                setApiTestStatus('error');
                setApiTestMessage('❌ API Key 无效');
            } else {
                setApiTestStatus('error');
                setApiTestMessage(`❌ 测试失败 (${response.status})`);
            }
        } catch {
            setApiTestStatus('error');
            setApiTestMessage('❌ 网络连接失败');
        }
        
        setTimeout(() => setApiTestStatus('idle'), 5000);
    };

    /**
     * 从某 provider 官方接口拉取最新模型，合并进会话内可选列表。
     * 失败/无 key/离线时优雅降级：保留已有硬编码列表，仅提示错误，不清空选项。
     */
    // provider 模型拉取。silent=true 时成功静默（仅落盘 + 更新下拉，不显示 loading/success 提示），
    // 用于"打开设置页自动刷新"；失败始终提示（让用户知道某渠道没拉到，但已保留现有列表）。
    const handleRefreshProviderModels = async (
        provider: ModelProvider,
        options?: { silent?: boolean }
    ) => {
        const silent = options?.silent === true;

        if (!window.designEcho?.listProviderModels) {
            if (!silent) {
                setModelRefreshStatus(s => ({ ...s, [provider]: 'error' }));
                setModelRefreshMessage(m => ({ ...m, [provider]: '当前版本不支持自动拉取模型' }));
                setTimeout(() => setModelRefreshStatus(s => ({ ...s, [provider]: 'idle' })), 6000);
            }
            return;
        }

        if (!silent) {
            setModelRefreshStatus(s => ({ ...s, [provider]: 'loading' }));
            setModelRefreshMessage(m => ({ ...m, [provider]: '正在拉取最新模型...' }));
        }

        try {
            const result = await window.designEcho.listProviderModels(provider);
            if (!result?.success) {
                setModelRefreshStatus(s => ({ ...s, [provider]: 'error' }));
                setModelRefreshMessage(m => ({
                    ...m,
                    [provider]: result?.error || '拉取失败，已保留现有模型列表'
                }));
                setTimeout(() => setModelRefreshStatus(s => ({ ...s, [provider]: 'idle' })), 6000);
                return;
            }

            // 合并：硬编码作能力覆盖层，拉取的新 id 补全。新模型转下拉简化形态。
            const merged = mergeFetchedProviderModels(
                provider,
                result.models || [],
                getModelsByProvider(provider)
            );
            const newIdSet = new Set(merged.newModelIds);
            const newModelConfigs = merged.models.filter(m => newIdSet.has(m.id));
            const newOptions: CloudModelOption[] = newModelConfigs
                .map(m => ({
                    id: m.id,
                    name: m.name,
                    vision: m.supportsVision,
                    conversation: isConversationModelConfig(m)
                }));

            // 落盘动态模型（完整 ModelConfig，含正确 apiModelId）：持久化 + 注入进程内注册表，
            // 让 getModelById 能查到带点 apiModelId（修复 slug 反推丢点的调用 bug）。
            upsertDynamicModels(provider, newModelConfigs);
            setFetchedModelsByProvider(prev => ({ ...prev, [provider]: newOptions }));
            if (!silent) {
                setModelRefreshStatus(s => ({ ...s, [provider]: 'success' }));
                setModelRefreshMessage(m => ({
                    ...m,
                    [provider]: merged.newCount > 0
                        ? `✅ 新增 ${merged.newConversationModelIds.length} 个对话模型；隔离 ${merged.newNonConversationModelIds.length} 个非对话模型`
                        : '✅ 已是最新，无新增模型'
                }));
            }
        } catch (error: any) {
            setModelRefreshStatus(s => ({ ...s, [provider]: 'error' }));
            setModelRefreshMessage(m => ({
                ...m,
                [provider]: error?.message || '拉取异常，已保留现有模型列表'
            }));
        }

        // 始终安排清除（silent 成功时无 status 可清，无害；失败/手动提示 6 秒后消失）
        setTimeout(() => setModelRefreshStatus(s => ({ ...s, [provider]: 'idle' })), 6000);
    };

    // 打开设置页时自动拉取各渠道最新模型 id（仅对已配置 Key 的 provider；并发、静默成功、失败才提示、不重入）。
    // 取代手动刷新按钮：进入即刷新，模型下拉与动态注册表直接更新，也顺带恢复"选中的已保存模型"显示。
    const autoRefreshStartedRef = useRef(false);
    useEffect(() => {
        if (autoRefreshStartedRef.current) return;  // 防 StrictMode 双触发 / 重入
        autoRefreshStartedRef.current = true;
        const candidates: ModelProvider[] = [
            ...(apiKeys.gptsapi?.trim() ? ['gptsapi' as ModelProvider] : []),
            ...(apiKeys.deepseek?.trim() ? ['deepseek' as ModelProvider] : []),
            ...(apiKeys.google?.trim() ? ['google' as ModelProvider] : []),
            ...(apiKeys.xiaomi?.trim() ? ['xiaomi' as ModelProvider] : []),
            ...(apiKeys.ollamaApiKey?.trim() ? ['ollama-cloud' as ModelProvider] : []),
            ...(apiKeys.openrouter?.trim() ? ['openrouter' as ModelProvider] : []),
        ];
        // 并发拉取，各自独立降级（失败保留现有列表，不阻塞设置页渲染）
        candidates.forEach(provider => { void handleRefreshProviderModels(provider, { silent: true }); });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const handleTestDeepSeek = async () => {
        const apiKey = localKeys.deepseek?.trim();

        if (!apiKey) {
            setDeepSeekTestStatus('error');
            setDeepSeekTestMessage('请先输入 DeepSeek 官方 API Key');
            return;
        }

        setDeepSeekTestStatus('testing');
        setDeepSeekTestMessage('正在调用 DeepSeek 官方文本聊天接口...');

        try {
            if (!window.designEcho?.testDeepSeek) {
                throw new Error('当前版本不支持 DeepSeek 测试');
            }

            const result = await window.designEcho.testDeepSeek(apiKey);
            if (result.success) {
                const usageText = result.usage
                    ? ` 输入 ${result.usage.inputTokens} / 输出 ${result.usage.outputTokens} tokens`
                    : '';
                setDeepSeekTestStatus('success');
                setDeepSeekTestMessage(result.message || `连接成功。${usageText}`);
            } else {
                setDeepSeekTestStatus('error');
                setDeepSeekTestMessage(result.error || 'DeepSeek 测试失败');
            }
        } catch (err: any) {
            setDeepSeekTestStatus('error');
            setDeepSeekTestMessage(err?.message || 'DeepSeek 测试失败');
        }

        setTimeout(() => setDeepSeekTestStatus('idle'), 5000);
    };

    const handleTestGoogleApi = async () => {
        const apiKey = localKeys.google?.trim();
        if (!apiKey) {
            setGoogleApiTestStatus('error');
            setGoogleApiTestMessage('请先输入 API Key');
            return;
        }
        
        setGoogleApiTestStatus('testing');
        setGoogleApiTestMessage('正在测试...');
        
        try {
            // 使用 Google AI Studio API 列出模型
            const response = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`,
                { method: 'GET' }
            );
            
            if (response.ok) {
                const data = await response.json();
                const modelCount = data?.models?.length || 0;
                setGoogleApiTestStatus('success');
                setGoogleApiTestMessage(`✅ 连接成功！可用 ${modelCount} 个模型`);
            } else if (response.status === 400 || response.status === 403) {
                setGoogleApiTestStatus('error');
                setGoogleApiTestMessage('❌ API Key 无效或无权限');
            } else {
                const errorData = await response.json().catch(() => ({}));
                setGoogleApiTestStatus('error');
                setGoogleApiTestMessage(`❌ 测试失败: ${errorData?.error?.message || response.status}`);
            }
        } catch {
            setGoogleApiTestStatus('error');
            setGoogleApiTestMessage('❌ 网络连接失败');
        }
        
        setTimeout(() => setGoogleApiTestStatus('idle'), 5000);
    };

    // 测试 Ollama Cloud API
    // 注意：Ollama 官方没有云端托管服务，这里测试的是第三方托管或自建服务
    const handleTestOllamaCloudApi = async () => {
        const apiKey = localKeys.ollamaApiKey?.trim();
        if (!apiKey) {
            setOllamaCloudTestStatus('error');
            setOllamaCloudTestMessage('请先输入 API Key');
            return;
        }
        
        setOllamaCloudTestStatus('testing');
        setOllamaCloudTestMessage('正在验证...');
        
        try {
            // 通过主进程调用 API 进行测试（避免 CORS 问题）
            const designEcho = (window as any).designEcho;
            if (designEcho?.testOllamaCloudApi) {
                const result = await designEcho.testOllamaCloudApi(apiKey);
                if (result.success) {
                    setOllamaCloudTestStatus('success');
                    setOllamaCloudTestMessage(result.message || '✅ API Key 有效');
                } else {
                    setOllamaCloudTestStatus('error');
                    setOllamaCloudTestMessage(result.error || '❌ 验证失败');
                }
            } else {
                // 备用方案：本地验证格式
                // Ollama Cloud API Key 通常是 UUID 格式或类似格式
                if (apiKey.length >= 20) {
                    setOllamaCloudTestStatus('success');
                    setOllamaCloudTestMessage('✅ API Key 格式有效（将在使用时验证）');
                } else {
                    setOllamaCloudTestStatus('error');
                    setOllamaCloudTestMessage('❌ API Key 格式不正确（长度不足）');
                }
            }
        } catch (err: any) {
            setOllamaCloudTestStatus('error');
            setOllamaCloudTestMessage(`❌ ${err.message || '验证失败'}`);
        }
        
        setTimeout(() => setOllamaCloudTestStatus('idle'), 5000);
    };

    // 测试 BFL (Black Forest Labs) API
    const handleTestBflApi = async () => {
        const apiKey = localKeys.bfl?.trim();
        if (!apiKey) {
            setBflTestStatus('error');
            setBflTestMessage('请先输入 API Key');
            return;
        }
        
        setBflTestStatus('testing');
        setBflTestMessage('正在验证...');

        try {
            const designEcho = (window as any).designEcho;
            if (designEcho?.bfl?.testApiKey) {
                setApiKeys({ bfl: apiKey });
                await window.designEcho?.setApiKeys({ bfl: apiKey });
                // 使用新的 BFL Service API
                const result = await designEcho.bfl.testApiKey(apiKey);
                if (result.success) {
                    setBflTestStatus('success');
                    setBflTestMessage(result.message || '✅ API Key 有效');
                } else {
                    setBflTestStatus('error');
                    setBflTestMessage(result.error || '❌ 验证失败');
                }
            } else {
                // 备用方案：检查格式
                if (apiKey.length >= 30) {
                    setBflTestStatus('success');
                    setBflTestMessage('✅ API Key 格式有效（将在使用时验证）');
                } else {
                    setBflTestStatus('error');
                    setBflTestMessage('❌ API Key 格式不正确');
                }
            }
        } catch (err: any) {
            setBflTestStatus('error');
            setBflTestMessage(`❌ ${err.message || '验证失败'}`);
        }
        
        setTimeout(() => setBflTestStatus('idle'), 5000);
    };

    const handleTestJimengApi = async () => {
        const accessKeyId = localKeys.volcengineJimengAccessKeyId?.trim();
        const secretAccessKey = localKeys.volcengineJimengSecretAccessKey?.trim();
        if (!accessKeyId || !secretAccessKey) {
            setJimengTestStatus('error');
            setJimengTestMessage('请先输入 Access Key ID 和 Secret Access Key');
            return;
        }

        setJimengTestStatus('testing');
        setJimengTestMessage('正在验证鉴权和提交链...');

        try {
            const designEcho = window.designEcho as any;
            if (!designEcho?.testVolcengineJimengCredentials) {
                throw new Error('当前版本不支持即梦 API 测试');
            }
            const result = await designEcho.testVolcengineJimengCredentials(accessKeyId, secretAccessKey);
            if (result.success) {
                setJimengTestStatus('success');
                setJimengTestMessage(result.message || '✅ 鉴权和提交链已通过');
            } else {
                setJimengTestStatus('error');
                setJimengTestMessage(result.error || '❌ 验证失败');
            }
        } catch (err: any) {
            setJimengTestStatus('error');
            setJimengTestMessage(`❌ ${err?.message || '验证失败'}`);
        }

        setTimeout(() => setJimengTestStatus('idle'), 5000);
    };

    const handleTestSeedreamApi = async () => {
        const apiKey = localKeys.volcengineSeedreamApiKey?.trim();
        if (!apiKey) {
            setSeedreamTestStatus('error');
            setSeedreamTestMessage('请先输入 Seedream API Key');
            return;
        }

        setSeedreamTestStatus('testing');
        setSeedreamTestMessage('正在验证...');

        try {
            const designEcho = window.designEcho as any;
            if (!designEcho?.testVolcengineSeedreamApiKey) {
                throw new Error('当前版本不支持 Seedream API 测试');
            }
            const result = await designEcho.testVolcengineSeedreamApiKey(apiKey);
            if (result.success) {
                setSeedreamTestStatus('success');
                setSeedreamTestMessage(result.message || '✅ API Key 可用');
            } else {
                setSeedreamTestStatus('error');
                setSeedreamTestMessage(result.error || '❌ 验证失败');
            }
        } catch (err: any) {
            setSeedreamTestStatus('error');
            setSeedreamTestMessage(`❌ ${err?.message || '验证失败'}`);
        }

        setTimeout(() => setSeedreamTestStatus('idle'), 5000);
    };

    // 测试选中的本地模型
    const testSelectedModels = async () => {
        setModelTestStatus('testing');
        const results: Record<string, { status: 'success' | 'error' | 'pending'; message: string }> = {};
        
        // 获取当前选中的所有本地模型（支持 local- 和 ollama- 两种格式）
        const modelsToTest = new Set<string>();
        Object.values(localPrefs.preferredLocalModels).forEach(modelId => {
            if (modelId.startsWith('local-') || modelId.startsWith('ollama-')) {
                modelsToTest.add(modelId);
            }
        });
        
        // 初始化所有模型为 pending 状态
        modelsToTest.forEach(modelId => {
            results[modelId] = { status: 'pending', message: '等待测试...' };
        });
        setModelTestResults({ ...results });
        
        // 逐个测试模型
        for (const modelId of modelsToTest) {
            // 从配置中获取 Ollama 模型名称（apiModelId）
            const modelConfig = OLLAMA_MODELS.find(m => m.id === modelId);
            const modelName = modelConfig?.apiModelId || modelId.replace('ollama-', '').replace('local-', '');
            results[modelId] = { status: 'pending', message: '正在测试...' };
            setModelTestResults({ ...results });
            
            try {
                // 先检查模型是否存在
                const showResponse = await fetch('http://localhost:11434/api/show', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name: modelName })
                });
                
                if (!showResponse.ok) {
                    if (showResponse.status === 404) {
                        results[modelId] = { status: 'error', message: '❌ 模型未下载' };
                    } else {
                        const errorText = await showResponse.text().catch(() => '');
                        results[modelId] = { 
                            status: 'error', 
                            message: `❌ 模型检查失败: ${errorText.substring(0, 50) || showResponse.status}` 
                        };
                    }
                    setModelTestResults({ ...results });
                    continue;
                }
                
                // 调用 Ollama API 测试模型
                const response = await fetch('http://localhost:11434/api/generate', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        model: modelName,
                        prompt: '你好',
                        stream: false,
                        options: { num_predict: 10 }  // 只生成少量 token 用于测试
                    })
                });
                
                if (response.ok) {
                    const data = await response.json();
                    if (data.response) {
                        results[modelId] = { 
                            status: 'success', 
                            message: `✅ 可用 - ${data.response.substring(0, 30)}...`
                        };
                    } else {
                        results[modelId] = { status: 'error', message: '⚠️ 响应异常' };
                    }
                } else if (response.status === 404) {
                    results[modelId] = { status: 'error', message: '❌ 模型未下载' };
                } else {
                    // 获取详细错误信息
                    const errorData = await response.json().catch(() => ({}));
                    const errorMsg = errorData.error || `HTTP ${response.status}`;
                    
                    // 处理常见错误
                    if (errorMsg.includes('out of memory') || errorMsg.includes('OOM')) {
                        results[modelId] = { status: 'error', message: '❌ 显存不足，请关闭其他模型后重试' };
                    } else if (errorMsg.includes('loading')) {
                        results[modelId] = { status: 'pending', message: '⏳ 模型加载中，请稍后重试' };
                    } else {
                        results[modelId] = { status: 'error', message: `❌ ${errorMsg.substring(0, 50)}` };
                    }
                }
            } catch (error: any) {
                if (error.message?.includes('Failed to fetch')) {
                    results[modelId] = { status: 'error', message: '❌ Ollama 未运行' };
                } else {
                    results[modelId] = { status: 'error', message: `❌ ${error.message}` };
                }
            }
            
            setModelTestResults({ ...results });
        }
        
        setModelTestStatus('idle');
    };

    // 监听 Ollama 下载进度
    useEffect(() => {
        const designEcho = (window as any).designEcho;
        if (!designEcho?.onOllamaPullProgress) return;
        
        const cleanup = designEcho.onOllamaPullProgress((data: { modelName: string; progress: number; status: string }) => {
            const modelId = `ollama-${data.modelName}`;
            const progressText = data.progress > 0 
                ? `⏳ ${data.status} ${data.progress}%` 
                : `⏳ ${data.status}`;
            setOllamaDownloadMessages(prev => ({ ...prev, [modelId]: progressText }));
        });
        
        return cleanup;
    }, []);
    
    // 下载 Ollama 模型（后台下载，有进度）
    const handleDownloadOllamaModel = async (modelId: string) => {
        // 从 modelId 获取实际的 Ollama 模型名称
        const modelConfig = OLLAMA_MODELS.find(m => m.id === modelId);
        if (!modelConfig) {
            setOllamaDownloadMessages(prev => ({ ...prev, [modelId]: '❌ 未找到模型配置' }));
            return;
        }
        
        // 使用配置中的 apiModelId（正确的 Ollama 模型名称）
        const modelName = modelConfig.apiModelId || modelId.replace('ollama-', '');
        
        setOllamaDownloading(prev => ({ ...prev, [modelId]: true }));
        setOllamaDownloadMessages(prev => ({ ...prev, [modelId]: '⏳ 连接 Ollama...' }));
        
        try {
            const designEcho = (window as any).designEcho;
            if (!designEcho?.pullOllamaModel) {
                throw new Error('下载功能不可用');
            }
            
            const result = await designEcho.pullOllamaModel(modelName);
            
            if (result.success) {
                setOllamaDownloadMessages(prev => ({ ...prev, [modelId]: '✅ 下载完成！' }));
                // 更新测试结果
                setModelTestResults(prev => ({
                    ...prev,
                    [modelId]: { status: 'success', message: '✅ 已安装' }
                }));
                // 刷新已安装模型列表
                if (designEcho?.listOllamaModels) {
                    const listResult = await designEcho.listOllamaModels();
                    if (listResult.success && listResult.models) {
                        const modelNames = listResult.models.map((m: any) => m.name || m.model);
                        setInstalledModels(modelNames);
                    }
                }
            } else {
                setOllamaDownloadMessages(prev => ({ 
                    ...prev, 
                    [modelId]: `❌ ${result.error || '下载失败'}` 
                }));
            }
        } catch (error: any) {
            setOllamaDownloadMessages(prev => ({ 
                ...prev, 
                [modelId]: `❌ ${error.message || '下载失败'}` 
            }));
        } finally {
            setOllamaDownloading(prev => ({ ...prev, [modelId]: false }));
        }
    };
    
    // 在终端中下载 Ollama 模型（可以看到详细进度）
    const handleDownloadOllamaModelInTerminal = async (modelId: string) => {
        // 从配置中获取正确的 Ollama 模型名称
        const modelConfig = OLLAMA_MODELS.find(m => m.id === modelId);
        const modelName = modelConfig?.apiModelId || modelId.replace('ollama-', '');
        
        try {
            const designEcho = (window as any).designEcho;
            if (!designEcho?.pullOllamaModelInTerminal) {
                throw new Error('终端下载功能不可用');
            }
            
            const result = await designEcho.pullOllamaModelInTerminal(modelName);
            
            if (result.success) {
                setOllamaDownloadMessages(prev => ({ 
                    ...prev, 
                    [modelId]: '📺 已在终端中开始下载，请查看终端窗口' 
                }));
            } else {
                setOllamaDownloadMessages(prev => ({ 
                    ...prev, 
                    [modelId]: `❌ ${result.error || '启动失败'}` 
                }));
            }
        } catch (error: any) {
            setOllamaDownloadMessages(prev => ({ 
                ...prev, 
                [modelId]: `❌ ${error.message || '启动失败'}` 
            }));
        }
    };

    // ========== 渲染 ==========
    
    return (
        <div className="modal-backdrop" onClick={handleBackdropClick}>
            <div
                className="settings-modal"
                role="dialog"
                aria-modal="true"
                aria-labelledby="settings-modal-title"
            >
                {/* 头部 */}
                <div className="modal-header">
                    <h2 id="settings-modal-title">设置</h2>
                    <button type="button" className="close-btn" onClick={onClose} aria-label="关闭设置">×</button>
                </div>

                {/* Tab 导航 */}
                <div className="tabs-nav" role="tablist" aria-label="设置分类">
                    {SETTINGS_TABS.map((tab) => {
                        const selected = activeTab === tab.id;
                        return (
                            <button
                                key={tab.id}
                                type="button"
                                id={getSettingsTabId(tab.id)}
                                className={`tab-btn ${selected ? 'active' : ''}`}
                                role="tab"
                                aria-selected={selected}
                                aria-controls={getSettingsPanelId(tab.id)}
                                tabIndex={selected ? 0 : -1}
                                onClick={() => setActiveTab(tab.id)}
                                onKeyDown={(event) => handleTabKeyDown(event, tab.id)}
                            >
                                <span className="tab-label">{tab.label}</span>
                                {settingsTabCounts[tab.id] !== undefined && (
                                    <span className="tab-count" aria-label={`${settingsTabCounts[tab.id]} 条`}>
                                        {settingsTabCounts[tab.id]}
                                    </span>
                                )}
                            </button>
                        );
                    })}
                </div>

                {/* Tab 内容 */}
                <div
                    className="modal-content"
                    id={activeTabPanelId}
                    role="tabpanel"
                    aria-labelledby={getSettingsTabId(activeTab)}
                    tabIndex={0}
                >
                    {/* ==================== 设计知识 Tab ==================== */}
                    {activeTab === 'knowledge' && (
                        <div className="tab-content">
                            <AgentContextOverview
                                externalKnowledgeSourceCount={externalKnowledgeSourceCount}
                                knowledgeStatus={designKnowledgeRuntimeCapability.status}
                                eagleKnowledgeStatus={eagleKnowledgeTestStatus}
                                activeLearningCount={activeLearningCount}
                                pendingLearningCount={pendingLearningCount}
                                activePreferenceCount={activePreferenceCount}
                                pendingPreferenceCount={reviewPreferenceCount}
                                onOpenTab={setActiveTab}
                            />
                            <div className="config-section">
                                <div className="section-header">
                                    <h3 className="section-title">外部知识来源</h3>
                                    <span className={`badge ${designKnowledgeSummary.status === 'ready' ? 'success' : 'warning'}`}>
                                        {designKnowledgeSummary.status === 'ready' ? '已就绪' : '未就绪'}
                                    </span>
                                </div>
                                <p className="section-desc">
                                    这里配置外部只读来源。检索结果会经过治理后作为设计参考，并保留来源说明；不会直接生成 Photoshop 操作。
                                </p>

                                <div className="integration-card" style={{ marginBottom: '16px' }}>
                                    <div className="integration-card-header">
                                        <div>
                                            <div className="integration-card-title">当前模型能力</div>
                                            <div className="integration-card-subtitle">
                                                只读摘要；用于判断当前模型是否支持工具流、公开推理显示和模型原生知识搜索。
                                            </div>
                                        </div>
                                        <span className={`badge ${designKnowledgeRuntimeCapability.status === 'ready' ? 'success' : 'warning'}`}>
                                            {formatCapabilityStatus(designKnowledgeRuntimeCapability.status)}
                                        </span>
                                    </div>
                                    <div className="integration-summary-grid knowledge-capability-grid" style={{ marginTop: '12px' }}>
                                        <div className="summary-stat-card">
                                            <span className="summary-stat-value">{designKnowledgeRuntimeCapability.selectedModel?.name || '未识别'}</span>
                                            <span className="summary-stat-label">当前规划模型</span>
                                        </div>
                                        <div className="summary-stat-card">
                                            <span className="summary-stat-value">{formatCapabilityStatus(designKnowledgeRuntimeCapability.providerObservation.toolStream.mode)}</span>
                                            <span className="summary-stat-label">工具流模式</span>
                                        </div>
                                        <div className="summary-stat-card">
                                            <span className="summary-stat-value">{formatCapabilityStatus(designKnowledgeRuntimeCapability.providerObservation.providerThinkingDelta.status)}</span>
                                            <span className="summary-stat-label">模型提供方思考流</span>
                                        </div>
                                        <div className="summary-stat-card">
                                            <span className="summary-stat-value">{formatCapabilityStatus(designKnowledgeRuntimeCapability.providerNativeWebSearch.status)}</span>
                                            <span className="summary-stat-label">小米 Web Search</span>
                                        </div>
                                    </div>
                                </div>

                                <div className="integration-card" style={{ marginBottom: '16px' }}>
                                    <div className="integration-card-header">
                                        <div>
                                            <div className="integration-card-title">Eagle 素材库（只读）</div>
                                            <div className="integration-card-subtitle">
                                                读取 Eagle 索引作为创意参考；不会修改 Eagle 素材，也不会直接运行 Photoshop。
                                            </div>
                                        </div>
                                        <span className={`badge ${knowledgeProbeBadgeClass(eagleKnowledgeTestStatus)}`}>
                                            {formatEagleProbeStatus(eagleKnowledgeTestStatus)}
                                        </span>
                                    </div>
                                    <div className="knowledge-source-action-row">
                                        <button
                                            className="btn btn-secondary"
                                            type="button"
                                            onClick={handleTestEagleKnowledge}
                                            disabled={eagleKnowledgeTestStatus === 'testing'}
                                        >
                                            {eagleKnowledgeTestStatus === 'testing' ? '检查中...' : '检查连接'}
                                        </button>
                                        {eagleKnowledgeTestMessage && (
                                            <span
                                                className={`test-message ${eagleKnowledgeTestStatus}`}
                                                role="status"
                                                aria-live="polite"
                                            >
                                                {eagleKnowledgeTestMessage}
                                            </span>
                                        )}
                                    </div>
                                </div>

                                <div className="integration-card" style={{ marginBottom: '16px' }}>
                                    <div className="integration-card-header">
                                        <div>
                                            <div className="integration-card-title">小米官方 Web Search</div>
                                            <div className="integration-card-subtitle">
                                                模型原生工具，仅在小米官方模型提供方和支持模型上允许进入请求计划；当前不会自动搜索。
                                            </div>
                                        </div>
                                        <label className="toggle-row">
                                            <input
                                                type="checkbox"
                                                checked={localDesignKnowledge.xiaomiWebSearch.enabled}
                                                onChange={(e) => handleUpdateDesignKnowledgeXiaomiWebSearch({ enabled: e.target.checked })}
                                                style={{ width: '16px', height: '16px', accentColor: 'var(--de-primary)' }}
                                            />
                                            <span>启用</span>
                                        </label>
                                    </div>
                                    <div className="mcp-grid">
                                        <div className="form-group" style={{ marginBottom: 0 }}>
                                            <label>关键词数量</label>
                                            <input
                                                className="input"
                                                type="number"
                                                min={1}
                                                max={5}
                                                value={localDesignKnowledge.xiaomiWebSearch.maxKeyword}
                                                onChange={(e) => handleUpdateDesignKnowledgeXiaomiWebSearch({ maxKeyword: Number(e.target.value) })}
                                            />
                                        </div>
                                        <div className="form-group" style={{ marginBottom: 0 }}>
                                            <label>结果数量</label>
                                            <input
                                                className="input"
                                                type="number"
                                                min={1}
                                                max={10}
                                                value={localDesignKnowledge.xiaomiWebSearch.limit}
                                                onChange={(e) => handleUpdateDesignKnowledgeXiaomiWebSearch({ limit: Number(e.target.value) })}
                                            />
                                        </div>
                                        <div className="form-group" style={{ marginBottom: 0 }}>
                                            <label>用户位置</label>
                                            <input
                                                className="input"
                                                value={localDesignKnowledge.xiaomiWebSearch.userLocation}
                                                onChange={(e) => handleUpdateDesignKnowledgeXiaomiWebSearch({ userLocation: e.target.value })}
                                                placeholder="例如 China"
                                            />
                                        </div>
                                        <label className="toggle-row" style={{ alignSelf: 'end', minHeight: '42px' }}>
                                            <input
                                                type="checkbox"
                                                checked={localDesignKnowledge.xiaomiWebSearch.forceSearch}
                                                onChange={(e) => handleUpdateDesignKnowledgeXiaomiWebSearch({ forceSearch: e.target.checked })}
                                                style={{ width: '16px', height: '16px', accentColor: 'var(--de-primary)' }}
                                            />
                                            <span>强制搜索</span>
                                        </label>
                                        <div className="form-group" style={{ marginBottom: 0, gridColumn: '1 / -1' }}>
                                            <label>providerNativeWebSearch</label>
                                            <code className="integration-code">{formatCapabilityStatus(designKnowledgeRuntimeCapability.providerNativeWebSearch.status)}</code>
                                        </div>
                                    </div>
                                </div>

                                <div className="integration-card">
                                    <div className="integration-card-header">
                                        <div>
                                            <div className="integration-card-title">SearXNG 本地 Web 搜索</div>
                                            <div className="integration-card-subtitle">
                                                可选 endpoint；DesignEcho 不启动、不停止、不管理 Docker / Harbor / SearXNG。
                                            </div>
                                        </div>
                                        <label className="toggle-row">
                                            <input
                                                type="checkbox"
                                                checked={localDesignKnowledge.searxng.enabled}
                                                onChange={(e) => handleUpdateDesignKnowledgeSearxng({ enabled: e.target.checked })}
                                                style={{ width: '16px', height: '16px', accentColor: 'var(--de-primary)' }}
                                            />
                                            <span>启用</span>
                                        </label>
                                    </div>

                                    <div className="mcp-grid">
                                        <div className="form-group" style={{ marginBottom: 0, gridColumn: '1 / -1' }}>
                                            <label>SearXNG endpoint</label>
                                            <input
                                                className="input"
                                                value={localDesignKnowledge.searxng.endpoint}
                                                onChange={(e) => handleUpdateDesignKnowledgeSearxng({ endpoint: e.target.value })}
                                                placeholder="例如 http://127.0.0.1:8080"
                                            />
                                        </div>
                                        <div className="form-group" style={{ marginBottom: 0 }}>
                                            <label>语言</label>
                                            <input
                                                className="input"
                                                value={localDesignKnowledge.searxng.language}
                                                onChange={(e) => handleUpdateDesignKnowledgeSearxng({ language: e.target.value })}
                                                placeholder="zh-CN"
                                            />
                                        </div>
                                        <div className="form-group" style={{ marginBottom: 0 }}>
                                            <label>安全搜索</label>
                                            <select
                                                className="select"
                                                value={localDesignKnowledge.searxng.safeSearch}
                                                onChange={(e) => handleUpdateDesignKnowledgeSearxng({ safeSearch: Number(e.target.value) as 0 | 1 | 2 })}
                                            >
                                                <option value={0}>关闭</option>
                                                <option value={1}>中等</option>
                                                <option value={2}>严格</option>
                                            </select>
                                        </div>
                                        <div className="form-group" style={{ marginBottom: 0 }}>
                                            <label>超时 ms</label>
                                            <input
                                                className="input"
                                                type="number"
                                                min={1000}
                                                max={30000}
                                                value={localDesignKnowledge.searxng.timeoutMs}
                                                onChange={(e) => handleUpdateDesignKnowledgeSearxng({ timeoutMs: Number(e.target.value) })}
                                            />
                                        </div>
                                        <div className="form-group" style={{ marginBottom: 0 }}>
                                            <label>状态</label>
                                            <code className="integration-code">{formatCapabilityStatus(designKnowledgeSummary.status)}</code>
                                        </div>
                                    </div>

                                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginTop: '16px', flexWrap: 'wrap' }}>
                                        <button
                                            className="btn btn-secondary"
                                            type="button"
                                            onClick={handleTestDesignKnowledge}
                                            disabled={designKnowledgeTestStatus === 'testing'}
                                        >
                                            {designKnowledgeTestStatus === 'testing' ? '测试中...' : '测试连接'}
                                        </button>
                                        {designKnowledgeTestMessage && (
                                            <span
                                                className={`test-message ${designKnowledgeTestStatus}`}
                                                role="status"
                                                aria-live="polite"
                                            >
                                                {designKnowledgeTestMessage}
                                            </span>
                                        )}
                                    </div>

                                    {designKnowledgeSummary.warnings.length > 0 && (
                                        <div className="integration-empty-state" style={{ marginTop: '16px' }}>
                                            {designKnowledgeSummary.warnings.map((warning) => (
                                                <div key={warning}>{warning}</div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}

                    {/* ==================== 设计学习复核 Tab ==================== */}
                    {activeTab === 'learning' && (
                        <>
                            <div className="tab-content">
                                <div className="config-section">
                                    <div className="section-header">
                                        <h3 className="section-title">学习与复核</h3>
                                        <span className="badge" style={{ background: '#2563eb' }}>手动控制</span>
                                    </div>
                                    <p className="section-desc">
                                        学习任务只在明确点击后运行；新增经验会先进入复核队列，确认后才会成为长期设计知识。
                                    </p>
                                    <DesignLearningRuntimeSettingsPanel onMemoryChanged={handleContextMemoryChanged} />
                                </div>
                            </div>
                            <DesignLearningReviewSettingsPanel
                                onMemoryChanged={handleContextMemoryChanged}
                                refreshRevision={contextMemoryRevision}
                            />
                        </>
                    )}

                    {/* ==================== 知识来源 Tab（自知识库页迁入，单一归属） ==================== */}
                    {activeTab === 'knowledge-sources' && (
                        <div className="tab-content">
                            <KnowledgeSourceManagementPanel />
                        </div>
                    )}

                    {/* ==================== 用户偏好 Tab（自知识库页迁入，单一归属） ==================== */}
                    {activeTab === 'user-preferences' && (
                        <div className="tab-content">
                            <UserPreferencesPanel />
                        </div>
                    )}

                    {/* ==================== 用户偏好 Tab ==================== */}
                    {activeTab === 'preferences' && (
                        <div className="tab-content">
                            <div className="config-section">
                                <div className="section-header">
                                    <h3 className="section-title">用户偏好记忆</h3>
                                    <span className="badge" style={{ background: activePreferenceCount > 0 ? '#059669' : '#6b7280' }}>
                                        {activePreferenceCount} 条启用
                                    </span>
                                </div>
                                <p className="section-desc">
                                    这里管理 Agent 可参考的本地偏好。待确认和已禁用的偏好不会进入设计知识，也不会直接触发 Photoshop 操作。
                                </p>

                                <div className="integration-summary-grid" style={{ marginBottom: '16px' }}>
                                    <div className="summary-stat-card">
                                        <span className="summary-stat-value">{activePreferenceCount}</span>
                                        <span className="summary-stat-label">启用偏好</span>
                                    </div>
                                    <div className="summary-stat-card">
                                        <span className="summary-stat-value">{reviewPreferenceCount}</span>
                                        <span className="summary-stat-label">待确认推断</span>
                                    </div>
                                    <div className="summary-stat-card">
                                        <span className="summary-stat-value">{disabledPreferenceCount}</span>
                                        <span className="summary-stat-label">已禁用</span>
                                    </div>
                                    <div className="summary-stat-card">
                                        <span className="summary-stat-value">{archivedPreferenceCount}</span>
                                        <span className="summary-stat-label">已归档</span>
                                    </div>
                                </div>

                                <div className="integration-card" style={{ marginBottom: '16px' }}>
                                    <div className="integration-card-header">
                                        <div>
                                            <div className="integration-card-title">偏好维护</div>
                                            <div className="integration-card-subtitle">
                                                只有显式偏好会直接启用；旧版推断候选仍需人工确认。
                                            </div>
                                        </div>
                                        <div className="preference-actions">
                                            <button
                                                className="btn btn-primary"
                                                type="button"
                                                onClick={handleCreatePreference}
                                            >
                                                新增偏好
                                            </button>
                                            <button
                                                className="btn btn-secondary"
                                                type="button"
                                                onClick={handleExportPreferences}
                                            >
                                                导出偏好
                                            </button>
                                            <button
                                                className="btn btn-secondary"
                                                type="button"
                                                onClick={handleClearInferredPreferences}
                                                disabled={reviewPreferenceCount === 0}
                                            >
                                                清理待确认
                                            </button>
                                        </div>
                                    </div>
                                    {preferenceMessage && (
                                        <div
                                            className="test-message success"
                                            style={{ marginTop: '12px' }}
                                            role="status"
                                            aria-live="polite"
                                        >
                                            {preferenceMessage}
                                        </div>
                                    )}
                                </div>

                                {preferenceEditorOpen && (
                                    <div className="integration-card preference-editor-card" style={{ marginBottom: '16px' }}>
                                        <div className="integration-card-header">
                                            <div>
                                                <div className="integration-card-title">
                                                    {editingPreferenceId ? '编辑偏好' : '新增偏好'}
                                                </div>
                                                <div className="integration-card-subtitle">
                                                    用于记录明确偏好；仍以当前任务、商品事实和平台规范为准。
                                                </div>
                                            </div>
                                        </div>
                                        <div className="preference-editor-grid">
                                            <div className="form-group" style={{ marginBottom: 0 }}>
                                                <label>分类</label>
                                                <select
                                                    className="select"
                                                    value={preferenceDraft.category}
                                                    onChange={(event) => setPreferenceDraft((prev) => ({
                                                        ...prev,
                                                        category: event.target.value as PreferenceMemoryItem['category']
                                                    }))}
                                                >
                                                    {Object.entries(PREFERENCE_CATEGORY_LABELS).map(([value, label]) => (
                                                        <option key={value} value={value}>{label}</option>
                                                    ))}
                                                </select>
                                            </div>
                                            <div className="form-group" style={{ marginBottom: 0 }}>
                                                <label>作用域</label>
                                                <select
                                                    className="select"
                                                    value={preferenceDraft.scopeType}
                                                    onChange={(event) => {
                                                        const scopeType = event.target.value as PreferenceScopeType;
                                                        setPreferenceDraft((prev) => ({
                                                            ...prev,
                                                            scopeType,
                                                            scopeId: resolvePreferenceScopeId(
                                                                scopeType,
                                                                prev.scopeId,
                                                                currentProject?.id
                                                            )
                                                        }));
                                                    }}
                                                >
                                                    {Object.entries(PREFERENCE_SCOPE_LABELS).map(([value, label]) => (
                                                        <option key={value} value={value}>{label}</option>
                                                    ))}
                                                </select>
                                            </div>
                                            <div className="form-group" style={{ marginBottom: 0 }}>
                                                <label>{preferenceDraft.scopeType === 'project' ? '绑定项目' : '作用域 ID'}</label>
                                                {preferenceDraft.scopeType === 'project' ? (
                                                    <div className={`preference-scope-readonly ${preferenceDraft.scopeId ? '' : 'is-empty'}`}>
                                                        {formatPreferenceProjectBinding(
                                                            preferenceDraft.scopeId,
                                                            currentProject?.id,
                                                            currentProject?.name
                                                        )}
                                                    </div>
                                                ) : (
                                                    <input
                                                        className="input"
                                                        value={preferenceDraft.scopeId}
                                                        disabled={preferenceDraft.scopeType === 'user'}
                                                        placeholder={preferenceDraft.scopeType === 'user' ? '对所有项目生效' : '填写品牌或会话 ID'}
                                                        onChange={(event) => setPreferenceDraft((prev) => ({
                                                            ...prev,
                                                            scopeId: event.target.value
                                                        }))}
                                                    />
                                                )}
                                            </div>
                                            <div className="form-group" style={{ marginBottom: 0 }}>
                                                <label>偏好值</label>
                                                <input
                                                    className="input"
                                                    value={preferenceDraft.value}
                                                    placeholder="例如 高级灰、低广告感文案、阿里巴巴普惠体"
                                                    onChange={(event) => setPreferenceDraft((prev) => ({
                                                        ...prev,
                                                        value: event.target.value
                                                    }))}
                                                />
                                            </div>
                                            <div className="form-group" style={{ marginBottom: 0 }}>
                                                <label>显示名称</label>
                                                <input
                                                    className="input"
                                                    value={preferenceDraft.label}
                                                    placeholder="可选，不填则自动生成"
                                                    onChange={(event) => setPreferenceDraft((prev) => ({
                                                        ...prev,
                                                        label: event.target.value
                                                    }))}
                                                />
                                            </div>
                                            <div className="form-group" style={{ marginBottom: 0, gridColumn: '1 / -1' }}>
                                                <label>来源说明</label>
                                                <textarea
                                                    className="input"
                                                    rows={3}
                                                    value={preferenceDraft.sourceNote}
                                                    placeholder="说明这个偏好来自哪次明确要求或验收结论"
                                                    onChange={(event) => setPreferenceDraft((prev) => ({
                                                        ...prev,
                                                        sourceNote: event.target.value
                                                    }))}
                                                />
                                            </div>
                                        </div>
                                        <div className="preference-form-actions">
                                            <button className="btn btn-primary" type="button" onClick={handleSavePreferenceDraft}>
                                                保存偏好
                                            </button>
                                            <button className="btn btn-secondary" type="button" onClick={handleCancelPreferenceEdit}>
                                                取消
                                            </button>
                                        </div>
                                    </div>
                                )}

                                <div className="integration-card preference-import-export-card" style={{ marginBottom: '16px' }}>
                                    <div className="integration-card-header">
                                        <div>
                                            <div className="integration-card-title">导入偏好</div>
                                            <div className="integration-card-subtitle">
                                                导入只接受结构化偏好 JSON；无效字段会被丢弃，默认合并到当前记忆。
                                            </div>
                                        </div>
                                        <button
                                            className="btn btn-secondary"
                                            type="button"
                                            onClick={handleImportPreferences}
                                        >
                                            导入偏好
                                        </button>
                                    </div>
                                    <textarea
                                        className="input preference-json-textarea"
                                        rows={4}
                                        value={preferenceImportText}
                                        placeholder="粘贴 designecho-preferences/v1 JSON"
                                        onChange={(event) => setPreferenceImportText(event.target.value)}
                                    />
                                    {preferenceExportText && (
                                        <textarea
                                            className="input preference-json-textarea"
                                            rows={4}
                                            value={preferenceExportText}
                                            readOnly
                                            style={{ marginTop: '12px' }}
                                        />
                                    )}
                                </div>

                                {preferenceItems.length === 0 ? (
                                    <div className="integration-empty-state">
                                        还没有本地偏好。后续由你明确设置的偏好会显示在这里。
                                    </div>
                                ) : (
                                    <div className="preference-list">
                                        {preferenceItems.map((item) => (
                                            <div key={item.id} className={`preference-card preference-card-${item.status}`}>
                                                <div className="preference-card-main">
                                                    <div className="preference-title-row">
                                                        <span className="preference-title">{item.label}</span>
                                                        <span className={`badge preference-status-${item.status}`}>
                                                            {PREFERENCE_STATUS_LABELS[item.status]}
                                                        </span>
                                                    </div>
                                                    <div className="preference-meta">
                                                        <span>{PREFERENCE_CATEGORY_LABELS[item.category]}</span>
                                                        <span>{PREFERENCE_SOURCE_LABELS[item.sourceType]}</span>
                                                        <span>
                                                            {PREFERENCE_SCOPE_LABELS[item.scope?.type || 'user']}
                                                            {item.scope?.id ? `：${item.scope.id}` : ''}
                                                        </span>
                                                        <span>使用 {item.usageCount || 0} 次</span>
                                                    </div>
                                                    <p className="preference-source-note">{item.sourceNote}</p>
                                                </div>
                                                <div className="preference-actions">
                                                    {item.status !== 'archived' && (
                                                        <button
                                                            className="btn btn-secondary"
                                                            type="button"
                                                            onClick={() => handleEditPreference(item)}
                                                        >
                                                            编辑
                                                        </button>
                                                    )}
                                                    {item.status !== 'archived' && (
                                                        <button
                                                            className="btn btn-secondary"
                                                            type="button"
                                                            onClick={() => handleTogglePreference(item)}
                                                        >
                                                            {item.status === 'active'
                                                                ? '禁用'
                                                                : item.sourceType === 'inferred' || item.status === 'needs_review'
                                                                    ? '确认并启用'
                                                                    : '启用'}
                                                        </button>
                                                    )}
                                                    {item.status !== 'archived' && (
                                                        <button
                                                            className="btn btn-secondary"
                                                            type="button"
                                                            onClick={() => handleArchivePreference(item)}
                                                        >
                                                            归档
                                                        </button>
                                                    )}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {/* ==================== MCP / Skills Tab ==================== */}
                    {activeTab === 'integrations' && (
                        <div className="tab-content">
                            <div className="config-section">
                                <div className="section-header">
                                    <h3 className="section-title">集成控制台</h3>
                                    <span className="badge" style={{ background: '#2563eb' }}>统一管理</span>
                                </div>
                                <p className="section-desc">
                                    这里作为 Skills 与 MCP 的单一配置入口。Skill 开关会直接影响智能体可选能力；MCP 先统一管理配置和启用状态，后续运行器接线也应以这里为唯一数据源。
                                </p>
                                <div className="integration-summary-grid">
                                    <div className="summary-stat-card">
                                        <span className="summary-stat-value">{enabledSkillCount} / {visibleSkills.length}</span>
                                        <span className="summary-stat-label">启用 Skills</span>
                                    </div>
                                    <div className="summary-stat-card">
                                        <span className="summary-stat-value">{enabledMcpCount} / {localIntegration.mcpServers.length}</span>
                                        <span className="summary-stat-label">启用外部 MCP</span>
                                    </div>
                                    <div className="summary-stat-card">
                                        <span className="summary-stat-value">{BUILTIN_MCP_SERVERS.length}</span>
                                        <span className="summary-stat-label">内置 MCP</span>
                                    </div>
                                </div>
                            </div>

                            <div className="config-section">
                                <div className="section-header">
                                    <h3 className="section-title">Skills</h3>
                                    <span className="badge" style={{ background: '#0f766e' }}>影响智能体决策</span>
                                </div>
                                <p className="section-desc">
                                    关闭某个 Skill 后，统一智能体不会再把它当成可选执行路径。这里显示声明、分类、依赖工具和本地处理接线状态。
                                </p>
                                <div className="skill-group-stack">
                                    {skillGroups.map(([category, skills]) => (
                                        <div className="integration-card" key={category}>
                                            <div className="integration-card-header">
                                                <div>
                                                    <div className="integration-card-title">
                                                        {SKILL_CATEGORY_LABELS[category] || category}
                                                    </div>
                                                    <div className="integration-card-subtitle">
                                                        {skills.length} 个技能
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="skill-list">
                                                {skills.map((skill) => {
                                                    const enabled = localIntegration.skills?.[skill.id]?.enabled !== false;
                                                    const executor = getSkillExecutor(skill.id);
                                                    return (
                                                        <label className={`skill-item-row ${enabled ? '' : 'disabled'}`} key={skill.id}>
                                                            <input
                                                                type="checkbox"
                                                                checked={enabled}
                                                                onChange={(e) => handleToggleSkill(skill.id, e.target.checked)}
                                                                style={{ width: '16px', height: '16px', accentColor: 'var(--de-primary)' }}
                                                            />
                                                            <div style={{ flex: 1, minWidth: 0 }}>
                                                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '6px' }}>
                                                                    <span style={{ fontWeight: 600 }}>{SKILL_DISPLAY_NAMES[skill.id] || skill.name}</span>
                                                                    <span className="mini-badge">{skill.id}</span>
                                                                    <span className="mini-badge">{skill.requiredTools.length} tools</span>
                                                                    <span className={`mini-badge ${executor ? 'success' : 'warning'}`}>
                                                                        {executor ? '已接处理逻辑' : '仅声明'}
                                                                    </span>
                                                                </div>
                                                                <div style={{ fontSize: '12px', color: 'var(--de-text-secondary)', lineHeight: 1.55 }}>
                                                                    {skill.description}
                                                                </div>
                                                            </div>
                                                        </label>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <div className="config-section">
                                <div className="section-header">
                                    <h3 className="section-title">MCP</h3>
                                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                                        <button className="btn btn-secondary" type="button" onClick={() => handleAddMcpServer('stdio')}>
                                            + 添加 Stdio
                                        </button>
                                        <button className="btn btn-secondary" type="button" onClick={() => handleAddMcpServer('http')}>
                                            + 添加 HTTP
                                        </button>
                                    </div>
                                </div>
                                <p className="section-desc">
                                    内置 MCP 能力用于 Photoshop 与桌面端桥接；外部 MCP 服务器在这里登记 transport、命令、参数或 URL，避免后续继续散落在代码里硬编码。
                                </p>

                                <div className="integration-card" style={{ marginBottom: '16px' }}>
                                    <div className="integration-card-header">
                                        <div>
                                            <div className="integration-card-title">内置 MCP</div>
                                            <div className="integration-card-subtitle">系统提供，作为只读能力展示</div>
                                        </div>
                                    </div>
                                    <div className="builtin-mcp-list">
                                        {BUILTIN_MCP_SERVERS.map((server) => (
                                            <div className="builtin-mcp-item" key={server.id}>
                                                <div style={{ minWidth: 0 }}>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '6px' }}>
                                                        <span style={{ fontWeight: 600 }}>{server.name}</span>
                                                        <span className="mini-badge success">内置</span>
                                                        <span className="mini-badge">{server.transport}</span>
                                                    </div>
                                                    <div style={{ fontSize: '12px', color: 'var(--de-text-secondary)', marginBottom: '6px' }}>
                                                        {server.description}
                                                    </div>
                                                    <code className="integration-code">{server.endpoint}</code>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                <div className="integration-card">
                                    <div className="integration-card-header">
                                        <div>
                                            <div className="integration-card-title">外部 MCP 服务器</div>
                                            <div className="integration-card-subtitle">可新增、编辑、禁用和删除</div>
                                        </div>
                                    </div>
                                    {localIntegration.mcpServers.length === 0 ? (
                                        <div className="integration-empty-state">
                                            <div style={{ fontWeight: 600, marginBottom: '6px' }}>还没有外部 MCP 服务器</div>
                                            <div style={{ fontSize: '12px', color: 'var(--de-text-secondary)' }}>
                                                先从常用的 Stdio 或 HTTP 入口开始登记，例如本地 Node Proxy、内部工具服务或 HTTP MCP 网关。知识来源请在主工作区的“知识库”中管理。
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="mcp-server-stack">
                                            {localIntegration.mcpServers.map((server) => (
                                                <div className="mcp-server-card" key={server.id}>
                                                    <div className="mcp-server-header">
                                                        <div className="toggle-row">
                                                            <input
                                                                type="checkbox"
                                                                checked={server.enabled}
                                                                onChange={(e) => handleUpdateMcpServer(server.id, { enabled: e.target.checked })}
                                                                style={{ width: '16px', height: '16px', accentColor: 'var(--de-primary)' }}
                                                            />
                                                            <span style={{ fontWeight: 600 }}>启用此服务器</span>
                                                        </div>
                                                        <button
                                                            className="btn btn-secondary"
                                                            type="button"
                                                            onClick={() => handleRemoveMcpServer(server.id)}
                                                        >
                                                            删除
                                                        </button>
                                                    </div>
                                                    <div className="mcp-grid">
                                                        <div className="form-group" style={{ marginBottom: 0 }}>
                                                            <label>名称</label>
                                                            <input
                                                                className="input"
                                                                value={server.name}
                                                                onChange={(e) => handleUpdateMcpServer(server.id, { name: e.target.value })}
                                                                placeholder="例如本地设计工具 MCP"
                                                            />
                                                        </div>
                                                        <div className="form-group" style={{ marginBottom: 0 }}>
                                                            <label>Transport</label>
                                                            <select
                                                                className="select"
                                                                value={server.transport}
                                                                onChange={(e) => handleUpdateMcpServer(server.id, {
                                                                    transport: e.target.value as 'stdio' | 'http',
                                                                    command: e.target.value === 'stdio' ? (server.command || 'node') : '',
                                                                    url: e.target.value === 'http' ? (server.url || 'http://127.0.0.1:3000/mcp') : ''
                                                                })}
                                                            >
                                                                <option value="stdio">stdio</option>
                                                                <option value="http">http</option>
                                                            </select>
                                                        </div>
                                                        {server.transport === 'stdio' ? (
                                                            <>
                                                                <div className="form-group" style={{ marginBottom: 0 }}>
                                                                    <label>命令</label>
                                                                    <input
                                                                        className="input"
                                                                        value={server.command || ''}
                                                                        onChange={(e) => handleUpdateMcpServer(server.id, { command: e.target.value })}
                                                                        placeholder="node"
                                                                    />
                                                                </div>
                                                                <div className="form-group" style={{ marginBottom: 0 }}>
                                                                    <label>参数（每行一个）</label>
                                                                    <textarea
                                                                        className="input"
                                                                        value={(server.args || []).join('\n')}
                                                                        onChange={(e) => handleUpdateMcpServer(server.id, {
                                                                            args: e.target.value
                                                                                .split(/\r?\n/)
                                                                                .map((line) => line.trim())
                                                                                .filter(Boolean)
                                                                        })}
                                                                        placeholder="C:/path/to/mcp-proxy.js"
                                                                        style={{ minHeight: '88px', resize: 'vertical' }}
                                                                    />
                                                                </div>
                                                            </>
                                                        ) : (
                                                            <div className="form-group" style={{ marginBottom: 0, gridColumn: '1 / -1' }}>
                                                                <label>URL</label>
                                                                <input
                                                                    className="input"
                                                                    value={server.url || ''}
                                                                    onChange={(e) => handleUpdateMcpServer(server.id, { url: e.target.value })}
                                                                    placeholder="http://127.0.0.1:41596/mcp"
                                                                />
                                                            </div>
                                                        )}
                                                        <div className="form-group" style={{ marginBottom: 0, gridColumn: '1 / -1' }}>
                                                            <label>备注</label>
                                                            <textarea
                                                                className="input"
                                                                value={server.notes || ''}
                                                                onChange={(e) => handleUpdateMcpServer(server.id, { notes: e.target.value })}
                                                                placeholder="记录用途、依赖应用、示例命令或接入边界"
                                                                style={{ minHeight: '72px', resize: 'vertical' }}
                                                            />
                                                        </div>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}

                    {/* ==================== 常规设置 Tab ==================== */}
                    {activeTab === 'general' && (
                        <div className="tab-content">
                            <div className="settings-section-kicker">执行与交付</div>
                            <div className="config-section">
                                <div className="section-header">
                                    <h3 className="section-title">设计尺寸规范</h3>
                                    <button className="btn-secondary" style={{ fontSize: 12 }} onClick={resetDesignDimensionSpec}>
                                        恢复预设
                                    </button>
                                </div>
                                <p className="section-desc">
                                    Agent 规划、详情页校验和导出默认值都按这里的规范执行；留空字段走预设。
                                    同名文档可存在等比放大的工作版（倍率见下），导出按基准宽交付。
                                </p>
                                <div className="form-grid">
                                    <label className="form-field">
                                        <span>详情页基准宽（px）</span>
                                        <input
                                            {...dimensionNumberInputProps(
                                                'detailBaseWidth',
                                                resolvedDimensionSpec.detailPage.baseWidth,
                                                (n) => setDesignDimensionSpec({
                                                    detailPage: { ...resolvedDimensionSpec.detailPage, baseWidth: n }
                                                })
                                            )}
                                        />
                                    </label>
                                    <label className="form-field">
                                        <span>可接受宽度变体（逗号分隔）</span>
                                        <input
                                            type="text"
                                            value={resolvedDimensionSpec.detailPage.acceptableWidths.join(', ')}
                                            onChange={(e) => setDesignDimensionSpec({
                                                detailPage: {
                                                    ...resolvedDimensionSpec.detailPage,
                                                    acceptableWidths: e.target.value.split(/[,，\s]+/).map(Number).filter((n) => n > 0)
                                                }
                                            })}
                                        />
                                    </label>
                                    <label className="form-field">
                                        <span>主图宽（px）</span>
                                        <input
                                            {...dimensionNumberInputProps(
                                                'mainImageWidth',
                                                resolvedDimensionSpec.mainImage.width,
                                                (n) => setDesignDimensionSpec({
                                                    mainImage: { ...resolvedDimensionSpec.mainImage, width: n }
                                                })
                                            )}
                                        />
                                    </label>
                                    <label className="form-field">
                                        <span>主图高（px）</span>
                                        <input
                                            {...dimensionNumberInputProps(
                                                'mainImageHeight',
                                                resolvedDimensionSpec.mainImage.height,
                                                (n) => setDesignDimensionSpec({
                                                    mainImage: { ...resolvedDimensionSpec.mainImage, height: n }
                                                })
                                            )}
                                        />
                                    </label>
                                    <label className="form-field">
                                        <span>放大工作版倍率（逗号分隔）</span>
                                        <input
                                            type="text"
                                            value={resolvedDimensionSpec.workingScaleFactors.join(', ')}
                                            onChange={(e) => setDesignDimensionSpec({
                                                workingScaleFactors: e.target.value.split(/[,，\s]+/).map(Number).filter((n) => n > 0)
                                            })}
                                        />
                                    </label>
                                    <label className="form-field">
                                        <span>导出默认（格式 / JPEG 质量 1-12）</span>
                                        <div className="export-defaults-row">
                                            <select
                                                value={resolvedDimensionSpec.exportDefaults.format}
                                                onChange={(e) => setDesignDimensionSpec({
                                                    exportDefaults: { ...resolvedDimensionSpec.exportDefaults, format: e.target.value as 'jpeg' | 'png' }
                                                })}
                                            >
                                                <option value="jpeg">JPEG</option>
                                                <option value="png">PNG</option>
                                            </select>
                                            <input
                                                min={1}
                                                max={12}
                                                {...dimensionNumberInputProps(
                                                    'exportQuality',
                                                    resolvedDimensionSpec.exportDefaults.quality,
                                                    (n) => setDesignDimensionSpec({
                                                        exportDefaults: { ...resolvedDimensionSpec.exportDefaults, quality: n }
                                                    })
                                                )}
                                            />
                                        </div>
                                    </label>
                                </div>
                            </div>

                            {/* 外观设置 */}
                            <div className="config-section">
                                <h3 className="section-title">外观</h3>
                                <div style={{
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    alignItems: 'center',
                                    padding: '16px',
                                    background: 'var(--de-bg-light)',
                                    borderRadius: '8px',
                                    border: '1px solid var(--de-border)'
                                }}>
                                    <div>
                                        <div style={{ fontWeight: 500, marginBottom: '4px' }}>主题</div>
                                        <div style={{ fontSize: '12px', color: 'var(--de-text-secondary)' }}>
                                            选择界面外观主题
                                        </div>
                                    </div>
                                    <select
                                        className="select"
                                        value={theme}
                                        onChange={(e) => setTheme(e.target.value as 'light' | 'dark' | 'system')}
                                        style={{
                                            width: '120px',
                                            padding: '8px 12px',
                                            borderRadius: '6px',
                                            border: '1px solid var(--de-border)',
                                            background: 'var(--de-bg)',
                                            color: 'var(--de-text)',
                                            cursor: 'pointer'
                                        }}
                                    >
                                        <option value="system">跟随系统</option>
                                        <option value="dark">深色</option>
                                        <option value="light">浅色</option>
                                    </select>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* ==================== AI 模型 Tab ==================== */}
                    {activeTab === 'ai-models' && (
                        <div className="tab-content">
                            {/* 模型模式选择 */}
                            <div className="config-section">
                                <h3 className="section-title">运行模式</h3>
                                <div className="mode-cards">
                                    <div
                                        className={`mode-card ${localPrefs.mode === 'local' ? 'active' : ''}`}
                                        onClick={() => setLocalPrefs(p => ({ ...p, mode: 'local' }))}
                                    >
                                        <div className="mode-header">
                                            <span className="mode-icon">🏠</span>
                                            <span className="mode-name">本地模式</span>
                                            {ollamaStatus === 'online' && <span className="badge success">在线</span>}
                                            {ollamaStatus === 'offline' && <span className="badge error">离线</span>}
                                        </div>
                                        <p className="mode-desc">使用 Ollama 运行本地 LLM，完全免费</p>
                                    </div>

                                    <div
                                        className={`mode-card ${localPrefs.mode === 'cloud' ? 'active' : ''}`}
                                        onClick={() => setLocalPrefs(p => ({ ...p, mode: 'cloud' }))}
                                    >
                                        <div className="mode-header">
                                            <span className="mode-icon">☁️</span>
                                            <span className="mode-name">云端模式</span>
                                            {localKeys.openrouter && <span className="badge success">已配置</span>}
                                        </div>
                                        <p className="mode-desc">通过 OpenRouter 使用 Claude/GPT-4o 等</p>
                                    </div>
                                    
                                    <div 
                                        className={`mode-card ${localPrefs.mode === 'auto' ? 'active' : ''}`}
                                        onClick={() => setLocalPrefs(p => ({ ...p, mode: 'auto' }))}
                                    >
                                        <div className="mode-header">
                                            <span className="mode-icon">🔄</span>
                                            <span className="mode-name">自动模式</span>
                                        </div>
                                        <p className="mode-desc">同时显示本地与云端候选，按下方模型分工使用已选模型</p>
                                    </div>
                                </div>
                            </div>

                            {/* 主模型负责规划与执行，视觉模型按需提供视觉事实。 */}
                            <div className="config-section">
                                <h3 className="section-title">模型分工</h3>
                                <p className="section-desc">
                                    主模型负责理解目标、规划、文案和 Photoshop 工具调用；视觉模型只在需要看图、读取画布或视觉质检时介入。两者可以相同，也可以自由组合。
                                </p>
                                <div className="task-models">
                                    <div className="task-model-item">
                                        <label>
                                            <TaskIcon type="brain" />
                                            <span className="task-name">主模型</span>
                                        </label>
                                        <div className="task-model-field" style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                            <select
                                                className="select"
                                                value={localPrefs.primaryModel}
                                                onChange={e => setLocalPrefs(p => ({ ...p, primaryModel: e.target.value }))}
                                            >
                                                {/* 兜底：当前主模型不在可见选项里（跨运行模式 / 动态拉取重置）时补一项，
                                                    避免 select 静默回退到第一项，让用户误以为主模型被改。 */}
                                                {(() => {
                                                    const current = localPrefs.primaryModel;
                                                    if (!current) return null;
                                                    const visibleIds = new Set<string>();
                                                    if (localPrefs.mode === 'local' || localPrefs.mode === 'auto') {
                                                        OLLAMA_MODELS.forEach(m => visibleIds.add(m.id));
                                                    }
                                                    if (localPrefs.mode === 'cloud' || localPrefs.mode === 'auto') {
                                                        ['gptsapi', 'deepseek', 'google', 'xiaomi', 'ollama-cloud', 'openrouter'].forEach(pv => {
                                                            buildProviderOptions(pv, fetchedModelsByProvider).forEach(m => visibleIds.add(m.id));
                                                        });
                                                    }
                                                    if (visibleIds.has(current)) return null;
                                                    const known = getModelById(current);
                                                    return (
                                                        <optgroup label="当前主模型">
                                                            <option value={current}>
                                                                {known?.name || current}
                                                            </option>
                                                        </optgroup>
                                                    );
                                                })()}
                                                {/* 云端对话模型（cloud / auto 时展示，auto 云端优先） */}
                                                {(localPrefs.mode === 'cloud' || localPrefs.mode === 'auto') && (
                                                    <>
                                                        {CLOUD_MODEL_OPTION_GROUPS.map(group => (
                                                            <optgroup key={group.provider} label={group.label}>
                                                                {buildProviderOptions(group.provider, fetchedModelsByProvider).map(m => (
                                                                    <option key={m.id} value={m.id}>
                                                                        {m.name}
                                                                    </option>
                                                                ))}
                                                            </optgroup>
                                                        ))}
                                                    </>
                                                )}
                                                {/* 本地对话模型（local / auto 时展示） */}
                                                {(localPrefs.mode === 'local' || localPrefs.mode === 'auto') && (
                                                    <optgroup label="本地模型 (Ollama)">
                                                        {OLLAMA_MODELS.map(m => (
                                                            <option key={m.id} value={m.id}>
                                                                {m.name}
                                                            </option>
                                                        ))}
                                                    </optgroup>
                                                )}
                                            </select>
                                            <span style={{ fontSize: '11px', color: 'var(--de-text-secondary, #888)' }}>
                                                负责主 Agent 的推理、规划、文案与工具执行。
                                            </span>
                                            {!isConversationModelId(localPrefs.primaryModel) && (
                                                <span className="status-text warning">
                                                    当前选择不是对话模型，不能作为 Agent 主模型；请改选支持文本对话的模型。
                                                </span>
                                            )}
                                        </div>
                                    </div>

                                    <div className="task-model-item">
                                        <label>
                                            <TaskIcon type="eye" />
                                            <span className="task-name">视觉模型</span>
                                        </label>
                                        <div className="task-model-field" style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                            <select
                                                className="select"
                                                value={localPrefs.visualModel}
                                                onChange={e => setLocalPrefs(p => ({ ...p, visualModel: e.target.value }))}
                                            >
                                                {(() => {
                                                    const current = localPrefs.visualModel;
                                                    if (!current) return null;
                                                    const visibleIds = new Set<string>();
                                                    if (localPrefs.mode === 'local' || localPrefs.mode === 'auto') {
                                                        OLLAMA_MODELS.filter(m => m.vision).forEach(m => visibleIds.add(m.id));
                                                    }
                                                    if (localPrefs.mode === 'cloud' || localPrefs.mode === 'auto') {
                                                        CLOUD_MODEL_OPTION_GROUPS.forEach(group => {
                                                            buildProviderOptions(group.provider, fetchedModelsByProvider)
                                                                .filter(m => m.vision)
                                                                .forEach(m => visibleIds.add(m.id));
                                                        });
                                                    }
                                                    if (visibleIds.has(current)) return null;
                                                    const known = getModelById(current);
                                                    return (
                                                        <optgroup label="当前视觉模型">
                                                            <option value={current}>
                                                                {known?.name || current}
                                                            </option>
                                                        </optgroup>
                                                    );
                                                })()}
                                                {(localPrefs.mode === 'cloud' || localPrefs.mode === 'auto') && (
                                                    <>
                                                        {CLOUD_MODEL_OPTION_GROUPS.map(group => {
                                                            const visualOptions = buildProviderOptions(group.provider, fetchedModelsByProvider)
                                                                .filter(m => m.vision);
                                                            if (visualOptions.length === 0) return null;
                                                            return (
                                                                <optgroup key={group.provider} label={group.label}>
                                                                    {visualOptions.map(m => (
                                                                        <option key={m.id} value={m.id}>
                                                                            {m.name}
                                                                        </option>
                                                                    ))}
                                                                </optgroup>
                                                            );
                                                        })}
                                                    </>
                                                )}
                                                {(localPrefs.mode === 'local' || localPrefs.mode === 'auto') && (
                                                    <optgroup label="本地视觉模型 (Ollama)">
                                                        {OLLAMA_MODELS.filter(m => m.vision).map(m => (
                                                            <option key={m.id} value={m.id}>
                                                                {m.name}
                                                            </option>
                                                        ))}
                                                    </optgroup>
                                                )}
                                            </select>
                                            <span style={{ fontSize: '11px', color: 'var(--de-text-secondary, #888)' }}>
                                                仅在用户图片、画布快照、素材理解和视觉质检时调用；观察结果会交回主模型裁决。
                                            </span>
                                            {!isConversationModelId(localPrefs.visualModel) && (
                                                <span className="status-text warning">
                                                    当前选择属于图片生成或其他非对话模型，不能承担视觉理解。
                                                </span>
                                            )}
                                            {isConversationModelId(localPrefs.visualModel) && !isVisionCapableModelId(localPrefs.visualModel) && (
                                                <span className="status-text warning">
                                                    当前视觉模型未声明读图能力，视觉任务会如实中止而不会假装看过图片。
                                                </span>
                                            )}
                                            {localPrefs.primaryModel === localPrefs.visualModel && isVisionCapableModelId(localPrefs.primaryModel) && (
                                                <span className="status-text success">当前复用同一个全模态模型，不产生视觉转述。</span>
                                            )}
                                        </div>
                                    </div>

                                    {/* 模型思考开关：仅当主模型支持用户可控 thinking 时显示，避免给不支持的模型显无效开关 */}
                                    {isModelThinkingUserControllable(localPrefs.primaryModel) && (
                                        <div className="task-model-item" style={{ marginTop: '4px' }}>
                                            <label>
                                                <TaskIcon type="brain" />
                                                <span className="task-name">模型思考</span>
                                            </label>
                                            <div className="task-model-field" style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                                <label className="toggle-row">
                                                    <input
                                                        type="checkbox"
                                                        checked={localPrefs.thinking?.enabled !== false}
                                                        onChange={e => setLocalPrefs(p => ({
                                                            ...p,
                                                            thinking: { ...(p.thinking ?? { enabled: true }), enabled: e.target.checked }
                                                        }))}
                                                        style={{ width: '16px', height: '16px', accentColor: 'var(--de-primary)' }}
                                                    />
                                                    <span>向支持的模型请求原生推理 / Thinking 输出</span>
                                                </label>
                                                <span style={{ fontSize: '11px', color: 'var(--de-text-secondary, #888)' }}>
                                                    当前主模型思考格式：{getModelThinkingDisplayName(localPrefs.primaryModel)}
                                                </span>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* 本地模型配置 */}
                            {(localPrefs.mode === 'local' || localPrefs.mode === 'auto') && (
                                <div className="config-section local-section">
                                    <div className="section-header">
                                        <h3 className="section-title">🏠 本地模型 (Ollama)</h3>
                                        <div className="ollama-status">
                                            {ollamaStatus === 'online' ? (
                                                <span className="status-text success">✓ 已连接</span>
                                            ) : (
                                                <span className="status-text error">✗ 未连接</span>
                                            )}
                                        </div>
                                    </div>
                                    
                                    {/* Ollama 服务地址配置 */}
                                    <div className="form-group ollama-url-group" style={{ marginBottom: '16px' }}>
                                        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                                            <span>服务地址</span>
                                            {ollamaStatus === 'checking' && <span className="badge">检测中...</span>}
                                        </label>
                                        <div style={{ display: 'flex', gap: '8px' }}>
                                            <input
                                                type="text"
                                                className="input"
                                                placeholder="http://localhost:11434"
                                                value={localKeys.ollamaUrl}
                                                onChange={e => setLocalKeys(k => ({ ...k, ollamaUrl: e.target.value }))}
                                                style={{ flex: 1 }}
                                            />
                                            <button
                                                className="btn btn-sm"
                                                onClick={async () => {
                                                    setOllamaStatus('checking');
                                                    try {
                                                        const response = await fetch(`${localKeys.ollamaUrl}/api/tags`);
                                                        if (response.ok) {
                                                            const data = await response.json();
                                                            setInstalledModels(data.models?.map((m: any) => m.name) || []);
                                                            setOllamaStatus('online');
                                                        } else {
                                                            setOllamaStatus('offline');
                                                        }
                                                    } catch {
                                                        setOllamaStatus('offline');
                                                    }
                                                }}
                                                style={{ padding: '6px 12px' }}
                                            >
                                                🔄 检测
                                            </button>
                                        </div>
                                        <p className="hint" style={{ marginTop: '4px', fontSize: '11px', color: '#888' }}>
                                            默认地址: http://localhost:11434
                                        </p>
                                    </div>
                                    
                                    {ollamaStatus === 'offline' && (
                                        <div className="alert warning">
                                            <p>Ollama 服务未运行。请先安装并启动 Ollama：</p>
                                            <code>ollama serve</code>
                                        </div>
                                    )}

                                    {/* 旧能力槽下拉已下线：主模型与视觉模型统一在上方「模型分工」区选择。 */}

                                    {/* 已安装模型 */}
                                    {installedModels.length > 0 && (
                                        <div className="installed-list">
                                            <span className="installed-label">已安装：</span>
                                            {installedModels.map(m => (
                                                <span key={m} className="installed-tag">{m}</span>
                                            ))}
                                        </div>
                                    )}
                                    
                                    {/* 模型测试按钮 */}
                                    <div className="model-test-section" style={{ marginTop: '16px', padding: '12px', background: 'rgba(255,255,255,0.03)', borderRadius: '8px' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '10px' }}>
                                            <button 
                                                className="btn btn-secondary"
                                                onClick={testSelectedModels}
                                                disabled={modelTestStatus === 'testing' || ollamaStatus === 'offline'}
                                                style={{ 
                                                    padding: '8px 16px',
                                                    fontSize: '13px',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '6px'
                                                }}
                                            >
                                                {modelTestStatus === 'testing' ? (
                                                    <>⏳ 正在测试...</>
                                                ) : (
                                                    <>🧪 测试选中的模型</>
                                                )}
                                            </button>
                                            <span style={{ fontSize: '12px', color: '#888' }}>
                                                验证模型是否可用
                                            </span>
                                        </div>
                                        
                                        {/* 测试结果 */}
                                        {Object.keys(modelTestResults).length > 0 && (
                                            <div className="test-results" style={{ 
                                                display: 'flex', 
                                                flexDirection: 'column', 
                                                gap: '6px',
                                                fontSize: '12px'
                                            }}>
                                                {Object.entries(modelTestResults).map(([modelId, result]) => {
                                                    const isNotDownloaded = result.message.includes('模型未下载');
                                                    const isDownloading = ollamaDownloading[modelId];
                                                    const downloadMsg = ollamaDownloadMessages[modelId];
                                                    
                                                    return (
                                                    <div 
                                                        key={modelId} 
                                                        style={{ 
                                                            display: 'flex', 
                                                            alignItems: 'center', 
                                                            gap: '8px',
                                                            padding: '6px 10px',
                                                            background: result.status === 'success' ? 'rgba(16,185,129,0.1)' : 
                                                                       result.status === 'error' ? 'rgba(239,68,68,0.1)' : 
                                                                       'rgba(255,255,255,0.05)',
                                                            borderRadius: '4px',
                                                            borderLeft: `3px solid ${
                                                                result.status === 'success' ? '#10b981' : 
                                                                result.status === 'error' ? '#ef4444' : 
                                                                '#6b7280'
                                                            }`
                                                        }}
                                                    >
                                                        <span style={{ fontWeight: 500, minWidth: '120px' }}>
                                                            {OLLAMA_MODELS.find(m => m.id === modelId)?.name || modelId}
                                                        </span>
                                                        <span style={{ 
                                                            color: result.status === 'success' ? '#10b981' : 
                                                                   result.status === 'error' ? '#ef4444' : 
                                                                       '#9ca3af',
                                                                flex: 1
                                                        }}>
                                                                {downloadMsg || result.message}
                                                        </span>
                                                            {/* 下载按钮 - 当模型未下载时显示 */}
                                                            {isNotDownloaded && !isDownloading && !downloadMsg?.includes('✅') && !downloadMsg?.includes('📺') && (
                                                                <div style={{ display: 'flex', gap: '4px' }}>
                                                                    <button
                                                                        onClick={() => handleDownloadOllamaModel(modelId)}
                                                                        title="在后台下载，可以继续使用应用"
                                                                        style={{
                                                                            padding: '2px 8px',
                                                                            fontSize: '11px',
                                                                            background: 'linear-gradient(135deg, #3b82f6, #8b5cf6)',
                                                                            border: 'none',
                                                                            borderRadius: '4px',
                                                                            color: '#fff',
                                                                            cursor: 'pointer',
                                                                            whiteSpace: 'nowrap'
                                                                        }}
                                                                    >
                                                                        📥 下载
                                                                    </button>
                                                                    <button
                                                                        onClick={() => handleDownloadOllamaModelInTerminal(modelId)}
                                                                        title="在终端中下载，可以看到详细进度"
                                                                        style={{
                                                                            padding: '2px 8px',
                                                                            fontSize: '11px',
                                                                            background: 'rgba(255,255,255,0.1)',
                                                                            border: '1px solid rgba(255,255,255,0.2)',
                                                                            borderRadius: '4px',
                                                                            color: '#9ca3af',
                                                                            cursor: 'pointer',
                                                                            whiteSpace: 'nowrap'
                                                                        }}
                                                                    >
                                                                        📺 终端
                                                                    </button>
                                                    </div>
                                                            )}
                                                            {isDownloading && (
                                                                <span style={{ 
                                                                    fontSize: '11px', 
                                                                    color: '#60a5fa'
                                                                }}>
                                                                    {downloadMsg || '⏳ 下载中...'}
                                                                </span>
                                                            )}
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}

                            {/* 云端模型配置 */}
                            {(localPrefs.mode === 'cloud' || localPrefs.mode === 'auto') && (() => {
                                // 主模型与视觉模型可能来自不同供应商，两者所需密钥都必须提示。
                                const selectedModels = [localPrefs.primaryModel, localPrefs.visualModel];
                                const needsGoogle = selectedModels.some(m => m?.startsWith('google-'));
                                const needsXiaomi = selectedModels.some(m => m?.startsWith('xiaomi-'));
                                const needsOpenRouter = selectedModels.some(m => m?.startsWith('openrouter-'));
                                const needsOllamaCloud = selectedModels.some(m => m?.startsWith('ollama-cloud-'));
                                const needsGPTsAPI = selectedModels.some(m => m?.startsWith('gptsapi-'));
                                const needsDeepSeek = selectedModels.some(m => m?.startsWith('deepseek-'));
                                
                                const hasGoogle = !!(localKeys.google && localKeys.google.length > 10);
                                const hasXiaomi = !!(localKeys.xiaomi && localKeys.xiaomi.length > 10);
                                const hasOpenRouter = !!(localKeys.openrouter && localKeys.openrouter.length > 10);
                                const hasOllamaCloud = !!(localKeys.ollamaApiKey && localKeys.ollamaApiKey.length > 10);
                                const hasGPTsAPI = !!(localKeys.gptsapi && localKeys.gptsapi.length > 10);
                                const hasDeepSeek = !!(localKeys.deepseek && localKeys.deepseek.length > 10);
                                
                                const missingKeys: string[] = [];
                                if (needsGoogle && !hasGoogle) missingKeys.push('Google AI Studio');
                                if (needsXiaomi && !hasXiaomi) missingKeys.push('Xiaomi MiMo');
                                if (needsOpenRouter && !hasOpenRouter) missingKeys.push('OpenRouter');
                                if (needsOllamaCloud && !hasOllamaCloud) missingKeys.push('Ollama Cloud');
                                if (needsGPTsAPI && !hasGPTsAPI) missingKeys.push('GPTs API');
                                if (needsDeepSeek && !hasDeepSeek) missingKeys.push('DeepSeek');
                                
                                const hasMissingKeys = missingKeys.length > 0;
                                
                                return (
                                <div className="config-section cloud-section">
                                    <div className="section-header">
                                        <h3 className="section-title">☁️ 云端模型</h3>
                                        {hasMissingKeys && (
                                            <span className="status-text warning">需要配置 API Key</span>
                                        )}
                                    </div>

                                    {hasMissingKeys && (
                                        <div className="alert info">
                                            请先在「API 密钥」页面配置 {missingKeys.join(' / ')} API Key
                                        </div>
                                    )}

                                    {/* 旧能力槽下拉与思考开关已上移到「模型分工」区。 */}

                                    {/* 推荐模型 */}
                                    <div className="recommended-models">
                                        <span className="recommended-label">推荐模型：</span>
                                        {CLOUD_MODELS.filter(m => m.recommended).slice(0, 4).map(m => (
                                            <span key={m.id} className="recommended-tag">{m.name.replace(' (官方)', '')}</span>
                                        ))}
                                    </div>

                                    {/* 自动拉取最新模型：每个 provider 一个刷新按钮 */}
                                    <div className="refresh-models-section" style={{ marginTop: '16px', padding: '12px', background: 'rgba(255,255,255,0.03)', borderRadius: '8px' }}>
                                        <div style={{ fontSize: '12px', color: '#888' }}>
                                            打开设置时已自动从各渠道官方接口拉取最新模型 id（仅对已配置 Key 的渠道，合并进上方下拉，按 id 去重；失败保留现有列表）
                                        </div>
                                        {Object.entries(modelRefreshMessage)
                                            .filter(([provider]) => (modelRefreshStatus[provider] || 'idle') !== 'idle' && modelRefreshMessage[provider])
                                            .map(([provider, message]) => {
                                                const status = modelRefreshStatus[provider] || 'idle';
                                                return (
                                                    <div
                                                        key={provider}
                                                        style={{
                                                            marginTop: '8px',
                                                            fontSize: '12px',
                                                            color: status === 'error' ? '#ef4444' : status === 'success' ? '#10b981' : '#9ca3af'
                                                        }}
                                                    >
                                                        {PROVIDER_REFRESH_LABELS[provider] || provider}：{message}
                                                    </div>
                                                );
                                            })}
                                    </div>
                                </div>
                                );
                            })()}
                        </div>
                    )}

                    {/* ==================== 图像处理 Tab ==================== */}
                    {activeTab === 'image-models' && (
                        <div className="tab-content">
                            {/* ==================== 智能分割模型 ==================== */}
                            <div className="config-section" style={{ marginBottom: '24px' }}>
                                <div className="section-header">
                                    <h3 className="section-title">✂️ 智能分割模型</h3>
                                    <span className="badge" style={{ background: '#10b981' }}>本地运行</span>
                                </div>
                                <p className="section-desc">
                                    使用 <strong>BiRefNet</strong> 本地 ONNX 模型实现 Photoshop 级别的智能分割。
                                    支持<strong>语义分割</strong>（识别所有对象）和<strong>选区分割</strong>（识别选区内主体）。
                                </p>
                                <SegmentationModelManager />
                            </div>

                            {/* ==================== 分割功能说明 ==================== */}
                            <div className="config-section" style={{ marginBottom: '24px' }}>
                                <div className="section-header">
                                    <h3 className="section-title">📋 功能说明</h3>
                                </div>
                                <div style={{ display: 'grid', gap: '12px' }}>
                                    <div style={{ 
                                        padding: '12px 16px', 
                                        background: 'var(--de-bg-secondary)', 
                                        borderRadius: '8px',
                                        border: '1px solid var(--de-border)'
                                    }}>
                                        <div style={{ fontWeight: 600, fontSize: '13px', marginBottom: '4px' }}>
                                            🎯 语义分割
                                        </div>
                                        <div style={{ fontSize: '12px', color: 'var(--de-text-secondary)' }}>
                                            自动识别画布中所有对象，类似 Photoshop "选择主体" 功能
                                        </div>
                                    </div>
                                    <div style={{ 
                                        padding: '12px 16px', 
                                        background: 'var(--de-bg-secondary)', 
                                        borderRadius: '8px',
                                        border: '1px solid var(--de-border)'
                                    }}>
                                        <div style={{ fontWeight: 600, fontSize: '13px', marginBottom: '4px' }}>
                                            ✏️ 选区分割
                                        </div>
                                        <div style={{ fontSize: '12px', color: 'var(--de-text-secondary)' }}>
                                            识别当前选区范围内的主体，精确控制分割区域
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* ==================== API 密钥 Tab ==================== */}
                    {activeTab === 'api-keys' && (
                        <div className="tab-content">
                            <div className="config-section api-section xiaomi">
                                <div className="section-header">
                                    <h3 className="section-title">🟠 Xiaomi MiMo</h3>
                                    {localKeys.xiaomi && <span className="badge success">已配置</span>}
                                </div>
                                <p className="section-desc">
                                    官方 OpenAI 兼容接入，可直接使用 MiMo V2.5 Pro / MiMo V2.5。其中 V2.5 适合参考图理解与设计复刻。
                                </p>

                                <div className="form-group">
                                    <label>API Key</label>
                                    <input
                                        type="password"
                                        className="input"
                                        placeholder="输入 Xiaomi MiMo API Key..."
                                        value={localKeys.xiaomi}
                                        onChange={e => setLocalKeys(k => ({ ...k, xiaomi: e.target.value }))}
                                    />
                                    <button
                                        type="button"
                                        className="link-btn"
                                        onClick={() => openExternalLink('https://platform.xiaomimimo.com/docs/zh-CN/api/chat/openai-api')}
                                    >
                                        查看接入文档 →
                                    </button>
                                </div>
                            </div>

                            {/* OpenRouter */}
                            <div className="config-section api-section openrouter">
                                <div className="section-header">
                                    <h3 className="section-title">🌐 OpenRouter</h3>
                                    <span className="badge" style={{ background: '#6366f1' }}>可选增强</span>
                                </div>
                                <p className="section-desc">
                                    配置后可使用 OpenRouter 对话模型，并为 UXP 局部重绘启用 Nano Banana Pro（Gemini 3 Pro Image Preview）。
                                </p>
                                
                                <div className="form-group">
                                    <label>API Key</label>
                                    <div className="input-with-action">
                                        <input
                                            type="password"
                                            className="input"
                                            placeholder="sk-or-..."
                                            value={localKeys.openrouter}
                                            onChange={e => setLocalKeys(k => ({ ...k, openrouter: e.target.value }))}
                                        />
                                        <button
                                            className={`btn btn-test ${apiTestStatus}`}
                                            onClick={handleTestApi}
                                            disabled={apiTestStatus === 'testing'}
                                        >
                                            {apiTestStatus === 'testing' ? '测试中...' : '测试'}
                                        </button>
                                    </div>
                                    {apiTestMessage && (
                                        <div className={`test-result ${apiTestStatus}`}>{apiTestMessage}</div>
                                    )}
                                    <button type="button" className="link-btn" onClick={() => openExternalLink('https://openrouter.ai/keys')}>
                                        获取 API Key →
                                    </button>
                                </div>
                            </div>

                            <div className="config-section api-section gptsapi">
                                <div className="section-header">
                                    <h3 className="section-title">🧭 GPTs API</h3>
                                    {localKeys.gptsapi && <span className="badge success">已配置</span>}
                                </div>
                                <p className="section-desc">
                                    使用统一的 GPTs API Key 接入 Claude Sonnet 4.6，并为 UXP 图生图提供 Gemini 3 Pro Image Preview 能力
                                </p>
                                
                                <div className="form-group">
                                    <label>API Key</label>
                                    <input
                                        type="password"
                                        className="input"
                                        placeholder="sk-..."
                                        value={localKeys.gptsapi}
                                        onChange={e => setLocalKeys(k => ({ ...k, gptsapi: e.target.value }))}
                                    />
                                    <button type="button" className="link-btn" onClick={() => openExternalLink('https://api2.gptsapi.net/tutorial')}>
                                        查看接入文档 →
                                    </button>
                                </div>
                            </div>

                            <div className="config-section api-section deepseek">
                                <div className="section-header">
                                    <h3 className="section-title">🟢 DeepSeek</h3>
                                    {localKeys.deepseek && <span className="badge success">已配置</span>}
                                </div>
                                <p className="section-desc">
                                    DeepSeek 官方 API，OpenAI 兼容地址为 https://api.deepseek.com。当前接入 deepseek-v4-pro 文本聊天和流式；不声明视觉能力。
                                </p>

                                <div className="form-group">
                                    <label>API Key</label>
                                    <div className="input-with-action">
                                        <input
                                            type="password"
                                            className="input"
                                            placeholder="sk-..."
                                            value={localKeys.deepseek}
                                            onChange={e => setLocalKeys(k => ({ ...k, deepseek: e.target.value }))}
                                        />
                                        <button
                                            className={`btn btn-test ${deepSeekTestStatus}`}
                                            onClick={handleTestDeepSeek}
                                            disabled={deepSeekTestStatus === 'testing'}
                                        >
                                            {deepSeekTestStatus === 'testing' ? '测试中...' : '测试'}
                                        </button>
                                    </div>
                                    {deepSeekTestMessage && (
                                        <div className={`test-result ${deepSeekTestStatus}`}>{deepSeekTestMessage}</div>
                                    )}
                                    <button type="button" className="link-btn" onClick={() => openExternalLink('https://platform.deepseek.com/api_keys')}>
                                        获取 API Key →
                                    </button>
                                </div>
                            </div>

                            {/* Google AI Studio 官方渠道 */}
                            <div className="config-section api-section google">
                                <div className="section-header">
                                    <h3 className="section-title">🔷 Google AI Studio</h3>
                                    <span className="badge" style={{ background: '#4285f4' }}>官方渠道</span>
                                </div>
                                <p className="section-desc">
                                    官方 API，支持 Gemini 2.5/2.0/1.5 Flash/Pro 全系列模型
                                </p>
                                
                                <div className="form-group">
                                    <label>API Key</label>
                                    <div className="input-with-action">
                                    <input
                                            type="password"
                                        className="input"
                                            placeholder="AIza..."
                                            value={localKeys.google}
                                            onChange={e => setLocalKeys(k => ({ ...k, google: e.target.value }))}
                                        />
                                        <button
                                            className={`btn btn-test ${googleApiTestStatus}`}
                                            onClick={handleTestGoogleApi}
                                            disabled={googleApiTestStatus === 'testing'}
                                        >
                                            {googleApiTestStatus === 'testing' ? '测试中...' : '测试'}
                                        </button>
                                    </div>
                                    {googleApiTestMessage && (
                                        <div className={`test-result ${googleApiTestStatus}`}>{googleApiTestMessage}</div>
                                    )}
                                    <button type="button" className="link-btn" onClick={() => openExternalLink('https://aistudio.google.com/apikey')}>
                                        获取 API Key →
                                    </button>
                                </div>
                            </div>

                            {/* Ollama 云服务 */}
                            <div className="config-section api-section ollama-cloud">
                                <div className="section-header">
                                    <h3 className="section-title">🦙 Ollama (云服务)</h3>
                                    {localKeys.ollamaApiKey && <span className="badge success">已配置</span>}
                                </div>
                                <p className="section-desc">
                                    使用 Ollama 云端服务，提供免费体验额度
                                </p>
                                
                                <div className="form-group">
                                    <label>
                                        Ollama API Key
                                        <span className="label-hint">云端调用，无需本地部署</span>
                                    </label>
                                    <div className="input-with-action">
                                        <input
                                            type="password"
                                            className="input"
                                            placeholder="输入 Ollama API Key..."
                                            value={localKeys.ollamaApiKey}
                                            onChange={e => setLocalKeys(k => ({ ...k, ollamaApiKey: e.target.value }))}
                                        />
                                        <button
                                            className={`btn btn-test ${ollamaCloudTestStatus}`}
                                            onClick={handleTestOllamaCloudApi}
                                            disabled={ollamaCloudTestStatus === 'testing'}
                                        >
                                            {ollamaCloudTestStatus === 'testing' ? '测试中...' : '测试'}
                                        </button>
                                    </div>
                                    {ollamaCloudTestMessage && (
                                        <div className={`test-result ${ollamaCloudTestStatus}`}>{ollamaCloudTestMessage}</div>
                                    )}
                                    <button type="button" className="link-btn" onClick={() => openExternalLink('https://ollama.com')}>
                                        获取 API Key →
                                    </button>
                                </div>
                            </div>

                            {/* BFL (Black Forest Labs) - FLUX 图像生成 */}
                            <div className="config-section api-section bfl">
                                <div className="section-header">
                                    <h3 className="section-title">🎨 Black Forest Labs (FLUX)</h3>
                                    {localKeys.bfl && <span className="badge success">已配置</span>}
                                </div>
                                <p className="section-desc">
                                    FLUX 系列图像生成模型，支持文生图、图生图、局部重绘等
                                </p>
                                
                                <div className="form-group">
                                    <label>
                                        BFL API Key
                                        <span className="label-hint">用于 FLUX 图像生成</span>
                                    </label>
                                    <div className="input-with-action">
                                        <input
                                            type="password"
                                            className="input"
                                            placeholder="输入 BFL API Key..."
                                            value={localKeys.bfl}
                                            onChange={e => setLocalKeys(k => ({ ...k, bfl: e.target.value }))}
                                        />
                                        <button
                                            className={`btn btn-test ${bflTestStatus}`}
                                            onClick={handleTestBflApi}
                                            disabled={bflTestStatus === 'testing'}
                                        >
                                            {bflTestStatus === 'testing' ? '测试中...' : '测试'}
                                        </button>
                                    </div>
                                    {bflTestMessage && (
                                        <div className={`test-result ${bflTestStatus}`}>{bflTestMessage}</div>
                                    )}
                                    <div className="bfl-models-info">
                                        <span className="info-title">支持的模型：</span>
                                        <span className="model-tags">
                                            <span className="tag">FLUX.2 [max]</span>
                                            <span className="tag">FLUX.2 [pro]</span>
                                            <span className="tag">FLUX.2 [klein]</span>
                                            <span className="tag">Inpainting</span>
                                        </span>
                                    </div>
                                    <button type="button" className="link-btn" onClick={() => openExternalLink('https://bfl.ai/')}>
                                        获取 API Key →
                                    </button>
                                </div>
                            </div>

                            <div className="config-section api-section direct">
                                <div className="section-header">
                                    <h3 className="section-title">🌋 即梦AI（局部重绘）</h3>
                                    {localKeys.volcengineJimengAccessKeyId && localKeys.volcengineJimengSecretAccessKey && (
                                        <span className="badge success">已填写</span>
                                    )}
                                </div>
                                <p className="section-desc">
                                    按火山即梦AI OpenAPI 接入局部重绘。这里使用 Access Key ID 和 Secret Access Key，不使用 Ark API Key。测试按钮会验证鉴权和真实提交链。
                                </p>
                                <div className="form-group">
                                    <label>Access Key ID</label>
                                    <input
                                        type="password"
                                        className="input"
                                        placeholder="输入 Access Key ID..."
                                        value={localKeys.volcengineJimengAccessKeyId}
                                        onChange={e => setLocalKeys(k => ({ ...k, volcengineJimengAccessKeyId: e.target.value }))}
                                    />
                                </div>
                                <div className="form-group">
                                    <label>Secret Access Key</label>
                                    <div className="input-with-action">
                                        <input
                                            type="password"
                                            className="input"
                                            placeholder="输入 Secret Access Key..."
                                            value={localKeys.volcengineJimengSecretAccessKey}
                                            onChange={e => setLocalKeys(k => ({ ...k, volcengineJimengSecretAccessKey: e.target.value }))}
                                        />
                                        <button
                                            className={`btn btn-test ${jimengTestStatus}`}
                                            onClick={handleTestJimengApi}
                                            disabled={jimengTestStatus === 'testing'}
                                        >
                                            {jimengTestStatus === 'testing' ? '测试中...' : '测试'}
                                        </button>
                                    </div>
                                    {jimengTestMessage && (
                                        <div className={`test-result ${jimengTestStatus}`}>{jimengTestMessage}</div>
                                    )}
                                </div>
                                <button type="button" className="link-btn" onClick={() => openExternalLink('https://console.volcengine.com/iam/keymanage/')}>
                                    Access Key 管理 →
                                </button>
                            </div>

                            <div className="config-section api-section direct">
                                <div className="section-header">
                                    <h3 className="section-title">🪣 TOS（即梦 4.6 图生图输入托管）</h3>
                                    {localKeys.volcengineTosBucket && localKeys.volcengineTosPublicBaseUrl && (
                                        <span className="badge success">已填写</span>
                                    )}
                                </div>
                                <p className="section-desc">
                                    即梦图片 4.6 官方图生图使用 <code>image_urls</code> 入参，这里配置 TOS 公网桶用于上传 UXP 抓到的输入图。当前实现默认复用上面的即梦 Access Key ID / Secret Access Key。
                                </p>
                                <div className="form-group">
                                    <label>TOS Region</label>
                                    <input
                                        type="text"
                                        className="input"
                                        placeholder="例如：cn-beijing"
                                        value={localKeys.volcengineTosRegion}
                                        onChange={e => setLocalKeys(k => ({ ...k, volcengineTosRegion: e.target.value }))}
                                    />
                                </div>
                                <div className="form-group">
                                    <label>TOS Endpoint</label>
                                    <input
                                        type="text"
                                        className="input"
                                        placeholder="例如：tos-s3-cn-beijing.volces.com"
                                        value={localKeys.volcengineTosEndpoint}
                                        onChange={e => setLocalKeys(k => ({ ...k, volcengineTosEndpoint: e.target.value }))}
                                    />
                                </div>
                                <div className="form-group">
                                    <label>TOS Bucket</label>
                                    <input
                                        type="text"
                                        className="input"
                                        placeholder="输入公开可读的 Bucket 名称..."
                                        value={localKeys.volcengineTosBucket}
                                        onChange={e => setLocalKeys(k => ({ ...k, volcengineTosBucket: e.target.value }))}
                                    />
                                </div>
                                <div className="form-group">
                                    <label>TOS Public Base URL</label>
                                    <input
                                        type="text"
                                        className="input"
                                        placeholder="例如：https://your-bucket.tos-cn-beijing.volces.com"
                                        value={localKeys.volcengineTosPublicBaseUrl}
                                        onChange={e => setLocalKeys(k => ({ ...k, volcengineTosPublicBaseUrl: e.target.value }))}
                                    />
                                </div>
                                <div className="form-group">
                                    <label>对象前缀（可选）</label>
                                    <input
                                        type="text"
                                        className="input"
                                        placeholder="designecho/jimeng-i2i"
                                        value={localKeys.volcengineTosKeyPrefix}
                                        onChange={e => setLocalKeys(k => ({ ...k, volcengineTosKeyPrefix: e.target.value }))}
                                    />
                                </div>
                                <p className="section-desc" style={{ marginTop: 8 }}>
                                    需要保证 Bucket 或对象具备公网读取能力，否则即梦 4.6 无法拉取输入图。
                                </p>
                            </div>

                            <div className="config-section api-section direct">
                                <div className="section-header">
                                    <h3 className="section-title">🖼️ Seedream 5.0（图生图）</h3>
                                    {localKeys.volcengineSeedreamApiKey && (
                                        <span className="badge success">已填写</span>
                                    )}
                                </div>
                                <p className="section-desc">
                                    Seedream 图生图走方舟图片生成 API。这里需要填写 Ark API Key，不是即梦的 Access Key ID / Secret Access Key。当前默认服务地域为华北 2（北京）。
                                </p>
                                <div className="form-group">
                                    <label>Seedream API Key</label>
                                    <div className="input-with-action">
                                        <input
                                            type="password"
                                            className="input"
                                            placeholder="输入 Seedream API Key..."
                                            value={localKeys.volcengineSeedreamApiKey}
                                            onChange={e => setLocalKeys(k => ({ ...k, volcengineSeedreamApiKey: e.target.value }))}
                                        />
                                        <button
                                            className={`btn btn-test ${seedreamTestStatus}`}
                                            onClick={handleTestSeedreamApi}
                                            disabled={seedreamTestStatus === 'testing'}
                                        >
                                            {seedreamTestStatus === 'testing' ? '测试中...' : '测试'}
                                        </button>
                                    </div>
                                    {seedreamTestMessage && (
                                        <div className={`test-result ${seedreamTestStatus}`}>{seedreamTestMessage}</div>
                                    )}
                                </div>
                                <button type="button" className="link-btn" onClick={() => openExternalLink('https://console.volcengine.com/ark/region:ark+cn-beijing/apikey')}>
                                    打开 Ark API 管理 →
                                </button>
                                <p className="section-desc" style={{ marginTop: 8 }}>
                                    登录后前往「资源管理 &gt; API Key 管理」创建 LAS API Key。
                                </p>
                            </div>

                            {/* 直连 API（折叠） */}
                            <details className="config-section api-section direct">
                                <summary className="section-header clickable">
                                    <h3 className="section-title">🔗 其他直连 API（可选）</h3>
                                    <span className="expand-hint">展开配置</span>
                                </summary>
                                <div className="direct-apis">
                                    <p className="section-desc">
                                        如果不使用 OpenRouter，可以直接配置各厂商 API
                                    </p>
                                    
                                    <div className="form-group">
                                        <label>Anthropic API Key</label>
                                        <input
                                            type="password"
                                            className="input"
                                            placeholder="sk-ant-..."
                                            value={localKeys.anthropic}
                                            onChange={e => setLocalKeys(k => ({ ...k, anthropic: e.target.value }))}
                                        />
                                    </div>
                                    
                                    <div className="form-group">
                                        <label>OpenAI API Key</label>
                                        <input
                                            type="password"
                                            className="input"
                                            placeholder="sk-..."
                                            value={localKeys.openai}
                                            onChange={e => setLocalKeys(k => ({ ...k, openai: e.target.value }))}
                                        />
                                    </div>
                                </div>
                            </details>
                        </div>
                    )}
                </div>

                {/* 底部 */}
                <div className="modal-footer">
                    <button className="btn btn-secondary" onClick={onClose}>关闭</button>
                    <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
                        {saving ? '保存中...' : saved ? '✓ 已保存' : '保存设置'}
                    </button>
                </div>
            </div>

        </div>
    );
};
