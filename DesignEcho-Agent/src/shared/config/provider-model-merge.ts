/**
 * Provider 模型自动获取——合并层（纯逻辑，可 smoke）。
 *
 * 背景：模型列表此前硬编码在 models.config.ts。provider 出新模型要手动加。
 * 本模块把「从 provider 官方列模型接口拉到的最新 id」与「硬编码已知模型」合并：
 *   - 硬编码已知模型 = 能力覆盖层：提供可靠的 vision / tool / pricing / roles。
 *   - 官方拉取 = 最新 id 全集：让新模型自动出现。
 *   - 二者按 apiModelId 对齐：已知模型保留硬编码能力；新发现模型用拉取能力 +
 *     保守默认补全为完整 ModelConfig。
 *
 * vision / tool 不按模型名猜测：Provider 没有明确返回时，动态模型不能自动获得视觉理解
 * 或 Agent Tool Calling 身份。新模型仍可作为待确认普通对话候选，专项能力需可靠元数据、
 * 人工维护覆盖或后续可审计能力探针。
 *
 * thinking 不做命名提示：只有 provider 标准化层明确给出 supportsThinking=true，才写入
 * thinking 配置，避免把模型名里的 r1/o1/reasoning/qwq 当成官方能力声明。
 *
 * 纯逻辑、无 HTTP / 无 Photoshop / 无 renderer 依赖，可被 smoke 直接验证。
 * HTTP 拉取（per-provider 适配）与 IPC / UI 在别处实现，本模块只做确定性合并。
 */

import {
    classifyModelUsage,
    type ModelUsageKind
} from './model-usage-classification';
import type { ModelConfig, ModelProvider, ModelRole, ApiKeyType, ThinkingFormat } from './models.config';

/**
 * 从某 provider 官方列模型接口拉到、已标准化的单个模型。
 * 能力字段缺失时留 undefined，交给 merge 用「已知覆盖 / 默认 / 命名提示」补全。
 */
export interface FetchedProviderModel {
    apiModelId: string;
    name?: string;
    /** Provider 原始用途声明，例如 model_type / task / type；由集中分类层解释。 */
    declaredKind?: string;
    inputModalities?: string[];
    outputModalities?: string[];
    capabilityNames?: string[];
    supportedMethods?: string[];
    supportsVision?: boolean;
    supportsToolUse?: boolean;
    contextWindow?: number;
    /** 拉取接口明确给出的 thinking 能力（如 OpenRouter supported_parameters 含 reasoning）；缺失时不猜测 */
    supportsThinking?: boolean;
    /** 拉取接口给出 thinking 时的格式（缺省 reasoning_content） */
    thinkingFormat?: ThinkingFormat;
}

export interface MergeFetchedModelsResult {
    /** 合并后的完整模型列表（已知全保留 + 新发现追加），可直接喂设置下拉。 */
    models: ModelConfig[];
    knownCount: number;
    /** 本次新发现（硬编码里没有）的模型数。 */
    newCount: number;
    /** 新发现模型的内部 id 列表（${provider}-${slug}）。 */
    newModelIds: string[];
    /** 新发现且可进入 Agent 主模型/视觉模型候选的对话模型。 */
    newConversationModelIds: string[];
    /** 新发现但属于图片生成、Embedding、重排、音视频或审核用途的模型。 */
    newNonConversationModelIds: string[];
}

/** provider → 所需 apiKey 类型（给新发现模型补 requiredApiKey；不映射的 provider 留 undefined） */
const PROVIDER_REQUIRED_KEY: Partial<Record<ModelProvider, ApiKeyType>> = {
    google: 'google',
    xiaomi: 'xiaomi',
    openrouter: 'openrouter',
    gptsapi: 'gptsapi',
    deepseek: 'deepseek',
    'ollama-cloud': 'ollamaApiKey',
    ollama: 'ollamaUrl',
    openai: 'openai',
    anthropic: 'anthropic'
};

function slugifyModelId(apiModelId: string): string {
    return apiModelId.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function rolesForUsage(usageKind: ModelUsageKind, supportsVision: boolean): ModelRole[] {
    if (usageKind === 'image-generation') return ['image-generation'];
    if (usageKind !== 'conversation') return [];
    return supportsVision ? ['general', 'vision'] : ['general'];
}

function capabilitiesForUsage(usageKind: ModelUsageKind): string[] {
    switch (usageKind) {
        case 'image-generation':
            return ['image-generation'];
        case 'embedding':
            return ['embedding'];
        case 'reranking':
            return ['reranking'];
        case 'audio-processing':
            return ['audio-processing'];
        case 'video-generation':
            return ['video-generation'];
        case 'moderation':
            return ['moderation'];
        case 'conversation':
        default:
            return ['text-generation'];
    }
}

/**
 * v37/v38 持久化的动态模型没有 usageKind，且可能保存了旧合并层猜出的 vision/tool 能力。
 * 旧记录无法区分“Provider 明确声明”与“代码默认猜测”，因此迁移时只保留身份和展示信息，
 * 重新按 apiModelId 做用途分类，并把专项能力收紧到未确认状态。
 */
export function normalizeDynamicModelUsageConfig(model: ModelConfig): ModelConfig {
    if (model.usageKind) return model;
    const usage = classifyModelUsage({ apiModelId: model.apiModelId });
    const isConversation = usage.kind === 'conversation';
    return {
        ...model,
        roles: rolesForUsage(usage.kind, false),
        capabilities: capabilitiesForUsage(usage.kind),
        usageKind: usage.kind,
        usageConfidence: usage.confidence,
        supportsVision: false,
        supportsToolUse: false,
        supportsStreaming: isConversation,
        description: isConversation
            ? '从旧动态模型配置迁移的待确认对话模型；视觉与 Tool 能力需重新验证'
            : `从旧动态模型配置重新识别的${usage.kind}模型；不会进入 Agent 对话模型候选`
    };
}

/**
 * 合并官方拉取的最新模型与硬编码已知模型。确定性、可重复。
 *
 * @param provider 目标 provider
 * @param fetched  官方接口拉到的标准化模型（能力可缺失）
 * @param known    该 provider 的硬编码已知模型（如 getModelsByProvider(provider)），作能力覆盖层
 */
export function mergeFetchedProviderModels(
    provider: ModelProvider,
    fetched: FetchedProviderModel[],
    known: ModelConfig[]
): MergeFetchedModelsResult {
    // 已知模型全部保留（即使本次接口没返回也不丢），它们是可靠的能力覆盖层。
    const merged: ModelConfig[] = [...known];
    const seenApiModelIds = new Set<string>(known.map((m) => m.apiModelId));
    const newModelIds: string[] = [];
    const newConversationModelIds: string[] = [];
    const newNonConversationModelIds: string[] = [];

    for (const item of Array.isArray(fetched) ? fetched : []) {
        const apiModelId = String(item?.apiModelId || '').trim();
        // 已知模型以硬编码能力为准，跳过（不被拉取的保守默认覆盖）。
        if (!apiModelId || seenApiModelIds.has(apiModelId)) continue;
        seenApiModelIds.add(apiModelId);

        const usage = classifyModelUsage({
            apiModelId,
            declaredKind: item.declaredKind,
            inputModalities: item.inputModalities,
            outputModalities: item.outputModalities,
            capabilityNames: item.capabilityNames,
            supportedMethods: item.supportedMethods
        });
        const isConversation = usage.kind === 'conversation';
        // “可以输入图片”只有在对话模型上才代表视觉理解；图片编辑模型不能冒充 VLM。
        const supportsVision = isConversation && item.supportsVision === true;
        const supportsToolUse = isConversation && item.supportsToolUse === true;
        const roles = rolesForUsage(usage.kind, supportsVision);

        // thinking：只接受 provider 标准化层给出的官方/接口能力；都没有则不设（视为不支持）。
        const thinkingFormat: ThinkingFormat | undefined = item.supportsThinking
            ? item.thinkingFormat || 'reasoning_content'
            : undefined;

        const modelId = `${provider}-${slugifyModelId(apiModelId)}`;
        merged.push({
            id: modelId,
            name: item.name || apiModelId,
            source: provider === 'ollama' ? 'local' : 'cloud',
            provider,
            requiredApiKey: PROVIDER_REQUIRED_KEY[provider],
            apiModelId,
            roles,
            capabilities: capabilitiesForUsage(usage.kind),
            usageKind: usage.kind,
            usageConfidence: usage.confidence,
            supportsVision,
            supportsToolUse,
            supportsStreaming: isConversation,
            maxTokens: 8192,
            ...(typeof item.contextWindow === 'number' ? { contextWindow: item.contextWindow } : {}),
            ...(thinkingFormat ? { thinking: { supported: true, format: thinkingFormat } } : {}),
            description: isConversation
                ? `从 provider 官方接口自动获取的对话模型（用途判断：${usage.confidence}，可能需人工校准）`
                : `从 provider 官方接口自动获取的${usage.kind}模型；不会进入 Agent 对话模型候选`
        });
        newModelIds.push(modelId);
        if (isConversation) newConversationModelIds.push(modelId);
        else newNonConversationModelIds.push(modelId);
    }

    return {
        models: merged,
        knownCount: known.length,
        newCount: newModelIds.length,
        newModelIds,
        newConversationModelIds,
        newNonConversationModelIds
    };
}
