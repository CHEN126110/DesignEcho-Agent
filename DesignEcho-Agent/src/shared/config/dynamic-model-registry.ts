/**
 * 进程内「动态模型注册表」覆盖层（纯逻辑，可 smoke）。
 *
 * 背景（根因）：从 provider 官方接口动态拉取的模型，内部 id 由 apiModelId slug 化生成
 * （见 provider-model-merge.ts：`mimo-v2.5-pro` → `xiaomi-mimo-v2-5-pro`，点被抹成横线，
 * 不可逆）。正确的 apiModelId 完整存进 ModelConfig.apiModelId，但 getModelById 此前只查
 * 硬编码 ALL_MODELS，查不到动态模型 → 调用层被迫从内部 id 字符串反推 apiModelId，反推丢点
 * 后请求的是错误模型名（或直接 throw「未知模型」）。
 *
 * 正解：把动态模型的「完整 ModelConfig（含正确 apiModelId）」注册进本表，让 getModelById
 * 未命中硬编码时回退到本表返回完整配置。下游 adapter 早就读 model.apiModelId（带点 id），
 * 故流式 + 非流式两条调用路同时拿到正确模型名，无需任何字符串反推。
 *
 * 进程隔离：renderer 与 main 是两个独立进程，本表是「进程内」覆盖层。renderer 经 store
 * hydrate/upsert 注入；main 经 IPC（列模型成功回灌 + 偏好同步通道）注入。两侧各自维护。
 *
 * 硬约束：
 * - 只 `import type` ModelConfig（不引入值依赖），避免与 models.config 形成运行时循环依赖。
 *   models.config → dynamic-model-registry 是单向值 import；本表 → models.config 仅 type。
 * - 无 HTTP / IO / renderer / Photoshop 依赖，确定性、可被 smoke 直接验证。
 */

import type { ModelConfig } from './models.config';
import { normalizeDynamicModelUsageConfig } from './provider-model-merge';

/** 进程内动态模型注册表：内部 id → 完整 ModelConfig。 */
const dynamicModelsById = new Map<string, ModelConfig>();

/**
 * 校验单个动态模型条目是否可注册。
 * id 与 apiModelId 都必须是非空字符串——apiModelId 缺失会让下游 adapter 拿不到正确模型名，
 * 退回 model.id（slug 后的错误 id），正是本模块要根治的 bug，故在入口拦掉。
 */
function isRegistrableModel(model: ModelConfig | null | undefined): model is ModelConfig {
    if (!model || typeof model !== 'object') return false;
    const id = typeof model.id === 'string' ? model.id.trim() : '';
    const apiModelId = typeof model.apiModelId === 'string' ? model.apiModelId.trim() : '';
    return id.length > 0 && apiModelId.length > 0;
}

/**
 * 用一批动态模型整体替换当前注册表（去重 + 基本校验）。
 *
 * 语义为「整体覆盖」：每次注入都先清空再写入，与 renderer 持久化的「全部 dynamicModels」
 * 快照一致——调用方负责传入完整集合（非增量），避免本表残留已被用户移除的模型。
 * 同一 id 多次出现时，以最后一条为准（去重）。
 *
 * @param models 完整的动态模型集合（含正确 id / apiModelId 的 ModelConfig）
 */
export function setDynamicModels(models: ModelConfig[] | null | undefined): void {
    dynamicModelsById.clear();
    if (!Array.isArray(models)) return;
    for (const model of models) {
        if (!isRegistrableModel(model)) continue;
        const normalized = normalizeDynamicModelUsageConfig(model);
        dynamicModelsById.set(normalized.id.trim(), normalized);
    }
}

/**
 * 按内部 id 查动态模型。命中返回完整 ModelConfig（含正确 apiModelId），未命中返回 undefined。
 * getModelById 在硬编码 ALL_MODELS 未命中时回退到此。
 */
export function getDynamicModelById(id: string): ModelConfig | undefined {
    if (typeof id !== 'string') return undefined;
    const key = id.trim();
    if (!key) return undefined;
    return dynamicModelsById.get(key);
}

/** 返回当前注册表的全部动态模型（拷贝，调用方不可改内部 Map）。 */
export function getDynamicModels(): ModelConfig[] {
    return Array.from(dynamicModelsById.values());
}

/** 清空注册表（测试 / 重置用）。 */
export function clearDynamicModels(): void {
    dynamicModelsById.clear();
}
