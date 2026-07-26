'use strict';

// 守护：动态模型注册表 + getModelById 回退。验证从 provider 官方接口拉取并 slug 化内部 id 的
// 动态模型，注入注册表后能被 getModelById 查到「完整 ModelConfig（含带点的真实 apiModelId）」，
// 不再走调用层从 slug 内部 id 反推 apiModelId（slug 不可逆，反推必丢点 → 请求错误模型名）。
//
// 这是「动态拉取模型」正确性 bug 的根治回归：锁死注册表路径，锁死 slug 反推不复活。

const assert = require('assert');
const path = require('path');

require('ts-node').register({
    transpileOnly: true,
    project: path.resolve(__dirname, '..', 'tsconfig.main.json')
});

const {
    setDynamicModels,
    getDynamicModelById,
    getDynamicModels,
    clearDynamicModels
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'config', 'dynamic-model-registry.ts'));

const { mergeFetchedProviderModels } = require(
    path.resolve(__dirname, '..', 'src', 'shared', 'config', 'provider-model-merge.ts')
);

const { getModelById, getModelsByProvider } = require(
    path.resolve(__dirname, '..', 'src', 'shared', 'config', 'models.config.ts')
);

let passed = 0;
function check(name, fn) {
    clearDynamicModels(); // 每个用例从干净注册表开始，避免相互污染
    fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
}

console.log('smoke: dynamic-model-registry');

// 真实回归值：xiaomi 拉到的新模型 apiModelId 带点，slug 后内部 id 把点抹成横线。
const DOTTED_API_MODEL_ID = 'mimo-v2.5-pro-ultraspeed';
const SLUGGED_INTERNAL_ID = 'xiaomi-mimo-v2-5-pro-ultraspeed';

function mergeXiaomiNewModels() {
    const merged = mergeFetchedProviderModels(
        'xiaomi',
        [{ apiModelId: DOTTED_API_MODEL_ID }],
        getModelsByProvider('xiaomi')
    );
    const newIdSet = new Set(merged.newModelIds);
    return merged.models.filter((m) => newIdSet.has(m.id));
}

check('注入后 getModelById 返回带点 apiModelId（真实回归值，不走 slug 反推）', () => {
    const newModels = mergeXiaomiNewModels();
    assert.ok(newModels.length >= 1, 'merge 应产出至少一个新模型');
    const target = newModels.find((m) => m.id === SLUGGED_INTERNAL_ID);
    assert.ok(target, `merge 内部 id 应为 ${SLUGGED_INTERNAL_ID}`);
    assert.strictEqual(target.apiModelId, DOTTED_API_MODEL_ID, 'merge 完整保留带点 apiModelId');

    setDynamicModels(newModels);

    const looked = getModelById(SLUGGED_INTERNAL_ID);
    assert.ok(looked, 'getModelById 应能查到动态模型');
    assert.strictEqual(
        looked.apiModelId,
        DOTTED_API_MODEL_ID,
        'getModelById 返回的 apiModelId 必须带点（下游 adapter 据此发请求）'
    );
    assert.strictEqual(looked.provider, 'xiaomi');
});

check('slug 不可逆：从 slug 内部 id 无法还原带点 apiModelId（锁死反推路径不复活）', () => {
    // 调用层历史上的反推：modelId.replace('xiaomi-','')
    const reconstructed = SLUGGED_INTERNAL_ID.replace('xiaomi-', '');
    assert.strictEqual(reconstructed, 'mimo-v2-5-pro-ultraspeed', '反推得到的是丢点的错误名');
    assert.notStrictEqual(
        reconstructed,
        DOTTED_API_MODEL_ID,
        'slug 后无法还原点号——证明只能靠注册表，不能靠字符串反推'
    );
    // 正路：注册表返回真实 apiModelId，与反推结果不同。
    setDynamicModels(mergeXiaomiNewModels());
    assert.strictEqual(getModelById(SLUGGED_INTERNAL_ID).apiModelId, DOTTED_API_MODEL_ID);
    assert.notStrictEqual(getModelById(SLUGGED_INTERNAL_ID).apiModelId, reconstructed);
});

check('静态硬编码模型不被动态注册表覆盖（ALL_MODELS 优先）', () => {
    const staticModels = getModelsByProvider('xiaomi');
    assert.ok(staticModels.length >= 1, '应有硬编码 xiaomi 模型');
    const staticOne = staticModels[0];

    // 用同 id 但被篡改 apiModelId 的恶意条目尝试覆盖。
    setDynamicModels([{ ...staticOne, apiModelId: 'tampered-should-not-win' }]);

    const looked = getModelById(staticOne.id);
    assert.ok(looked, '静态模型应查得到');
    assert.strictEqual(
        looked.apiModelId,
        staticOne.apiModelId,
        '静态 apiModelId 必须优先于动态注册表（getModelById 先查 ALL_MODELS）'
    );
    assert.notStrictEqual(looked.apiModelId, 'tampered-should-not-win');
});

check('clear 后回退：动态模型不再可查，未注入时 getModelById 对 slug id 返回 undefined', () => {
    setDynamicModels(mergeXiaomiNewModels());
    assert.ok(getModelById(SLUGGED_INTERNAL_ID), '注入后可查');
    clearDynamicModels();
    assert.strictEqual(
        getModelById(SLUGGED_INTERNAL_ID),
        undefined,
        'clear 后动态模型应查不到（回退到只剩硬编码）'
    );
});

check('setDynamicModels 整体替换 + 去重 + 基本校验（id/apiModelId 非空）', () => {
    const a = { id: 'xiaomi-a', name: 'A', source: 'cloud', provider: 'xiaomi', apiModelId: 'a.1', roles: ['general'], capabilities: ['text-generation'], supportsVision: false, supportsStreaming: true, maxTokens: 4096 };
    const aDup = { ...a, name: 'A-dup', apiModelId: 'a.2' }; // 同 id，后者覆盖
    const missingApi = { ...a, id: 'xiaomi-b', apiModelId: '' }; // apiModelId 空 → 不可注册
    const missingId = { ...a, id: '', apiModelId: 'c.1' }; // id 空 → 不可注册

    setDynamicModels([a, aDup, missingApi, missingId]);

    const all = getDynamicModels();
    assert.strictEqual(all.length, 1, '去重 + 过滤后只剩一条可注册模型');
    assert.strictEqual(getDynamicModelById('xiaomi-a').apiModelId, 'a.2', '同 id 后者为准');
    assert.strictEqual(getDynamicModelById('xiaomi-a').usageKind, 'conversation', '旧动态模型应在注册入口补用途分类');
    assert.strictEqual(getDynamicModelById('xiaomi-a').supportsToolUse, false, '旧动态模型未经证实的 Tool 能力必须收紧');
    assert.strictEqual(getDynamicModelById('xiaomi-b'), undefined, 'apiModelId 空被拒绝');
    assert.strictEqual(getDynamicModelById(''), undefined, 'id 空被拒绝');

    // 整体替换：第二次 set 完全替换第一次。
    setDynamicModels([]);
    assert.strictEqual(getDynamicModels().length, 0, 'set([]) 整体清空');
});

check('旧图片生成模型即使带伪造 text/vision/tool 能力，也会在注册入口重新分类', () => {
    setDynamicModels([{
        id: 'gptsapi-gpt-image-1',
        name: 'GPT Image 1',
        source: 'cloud',
        provider: 'gptsapi',
        apiModelId: 'gpt-image-1',
        roles: ['general', 'vision'],
        capabilities: ['text-generation'],
        supportsVision: true,
        supportsToolUse: true,
        supportsStreaming: true,
        maxTokens: 8192
    }]);
    const migrated = getDynamicModelById('gptsapi-gpt-image-1');
    assert.strictEqual(migrated.usageKind, 'image-generation');
    assert.strictEqual(migrated.supportsVision, false);
    assert.strictEqual(migrated.supportsToolUse, false);
    assert.ok(!migrated.capabilities.includes('text-generation'));
});

check('非数组 / 缺省输入安全降级', () => {
    setDynamicModels(null);
    assert.strictEqual(getDynamicModels().length, 0, 'null 安全降级为空');
    setDynamicModels(undefined);
    assert.strictEqual(getDynamicModels().length, 0, 'undefined 安全降级为空');
    assert.strictEqual(getDynamicModelById('anything'), undefined);
});

clearDynamicModels();
console.log(`\n✅ dynamic-model-registry smoke 全部通过（${passed} 项）`);
