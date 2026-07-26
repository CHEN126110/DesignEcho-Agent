/**
 * 主模型候选列表（单一口径）
 *
 * 设置页「AI 模型 · 主模型」下拉与聊天输入栏的主模型快捷选择器需要展示同一份候选
 * （同一运行模式下两处列表一致），不允许两处各造一套模型清单。
 * 这里只维护主 Agent 模型候选；独立视觉模型由设置页按 supportsVision 过滤。
 *
 * 口径定义（与 SettingsModal 主模型下拉逐条对齐）：
 * - 云端候选 = models.config 各 provider 硬编码列表（优先层）+ 动态拉取的新模型（补全层，按 id 去重）。
 *   与 SettingsModal 的 buildProviderOptions(provider, fetchedModelsByProvider) 语义一致：
 *   设置页刷新拉到的新模型会经 upsertDynamicModels 持久化进 store.dynamicModels（按 provider 整体替换），
 *   本模块用这份持久化注册表作为动态补全层——两处最终收敛到同一集合。
 * - 本地候选 = LOCAL_MODELS（Ollama）。
 * - 运行模式过滤：cloud → 只列云端；local → 只列本地；auto → 全列（云端在前，与设置页渲染顺序一致）。
 *
 * 维护约定：provider 分组顺序与 optgroup 标签必须与 SettingsModal.tsx 主模型下拉保持同步；
 * 新增 provider 时两处一起改（模型清单本身始终以 models.config + dynamicModels 为单一来源）。
 */

import {
    DEEPSEEK_MODELS,
    GOOGLE_MODELS,
    GPTSAPI_MODELS,
    LOCAL_MODELS,
    OLLAMA_CLOUD_MODELS,
    OPENROUTER_MODELS,
    XIAOMI_MODELS,
    isConversationModelConfig,
    type ModelConfig,
    type ModelPreferences
} from './models.config';

export interface PrimaryModelOption {
    /** 模型内部 id（写入 modelPreferences.primaryModel 的值） */
    id: string;
    /** 配置里的完整显示名（含 ⭐ 等修饰，展示端可自行缩短） */
    name: string;
}

export interface PrimaryModelOptionGroup {
    /** optgroup 标签，与设置页主模型下拉一致 */
    label: string;
    options: PrimaryModelOption[];
}

/** 云端 provider 分组（顺序与标签与 SettingsModal 主模型下拉一致） */
const CLOUD_PROVIDER_GROUPS: Array<{ provider: string; label: string; hardcoded: ModelConfig[] }> = [
    { provider: 'gptsapi', label: 'GPTs API (OpenAI 兼容)', hardcoded: GPTSAPI_MODELS },
    { provider: 'deepseek', label: 'DeepSeek (官方)', hardcoded: DEEPSEEK_MODELS },
    { provider: 'google', label: 'Google AI Studio (官方)', hardcoded: GOOGLE_MODELS },
    { provider: 'xiaomi', label: 'Xiaomi MiMo (官方)', hardcoded: XIAOMI_MODELS },
    { provider: 'ollama-cloud', label: 'Ollama Cloud (免费额度)', hardcoded: OLLAMA_CLOUD_MODELS },
    { provider: 'openrouter', label: 'OpenRouter (中转)', hardcoded: OPENROUTER_MODELS }
];

const LOCAL_GROUP_LABEL = '本地模型 (Ollama)';

/**
 * 合并某 provider 的硬编码模型与动态拉取模型：硬编码优先，动态项按 id 去重后追加。
 * 与 SettingsModal.buildProviderOptions 同语义（硬编码作能力覆盖层，拉取的新 id 补全）。
 */
function mergeProviderOptions(hardcoded: ModelConfig[], dynamicForProvider: ModelConfig[]): PrimaryModelOption[] {
    const seen = new Set(hardcoded.map(m => m.id));
    const extras = dynamicForProvider.filter(m => !seen.has(m.id));
    return [...hardcoded, ...extras]
        .filter(isConversationModelConfig)
        .map(m => ({
            id: m.id,
            name: m.name
        }));
}

/**
 * 按运行模式构建主模型候选分组。
 *
 * @param mode          modelPreferences.mode（cloud / local / auto）
 * @param dynamicModels store 里持久化的动态拉取模型（完整 ModelConfig，含 provider）；缺省视为无动态项
 */
export function buildPrimaryModelOptionGroups(
    mode: ModelPreferences['mode'],
    dynamicModels?: ModelConfig[] | null
): PrimaryModelOptionGroup[] {
    const dynamicList = Array.isArray(dynamicModels) ? dynamicModels : [];
    const groups: PrimaryModelOptionGroup[] = [];

    if (mode === 'cloud' || mode === 'auto') {
        for (const group of CLOUD_PROVIDER_GROUPS) {
            const dynamicForProvider = dynamicList.filter(m => m?.provider === group.provider);
            const options = mergeProviderOptions(group.hardcoded, dynamicForProvider);
            if (options.length > 0) {
                groups.push({ label: group.label, options });
            }
        }
    }

    if (mode === 'local' || mode === 'auto') {
        const options = LOCAL_MODELS
            .filter(isConversationModelConfig)
            .map(m => ({ id: m.id, name: m.name }));
        if (options.length > 0) {
            groups.push({ label: LOCAL_GROUP_LABEL, options });
        }
    }

    return groups;
}

/** 判断某模型 id 是否在候选分组里（供「当前主模型」兜底项判断，避免 select 静默回退）。 */
export function isModelIdInPrimaryModelOptionGroups(
    groups: PrimaryModelOptionGroup[],
    modelId: string
): boolean {
    if (!modelId) return false;
    return groups.some(group => group.options.some(option => option.id === modelId));
}

/**
 * 输入栏紧凑展示用的模型短名：去掉推荐星标前缀与「(官方)」渠道后缀。
 * 仅影响展示，不改变候选口径（id 与集合仍与设置页一致）。
 */
export function formatPrimaryModelShortName(name: string): string {
    return String(name || '')
        .replace(/^⭐\s*/, '')
        .replace(/\s*\(官方\)\s*$/, '')
        .trim();
}
