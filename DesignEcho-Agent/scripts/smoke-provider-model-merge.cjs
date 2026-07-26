'use strict';

// 守护：provider 模型自动获取的合并层。验证「已知配置作能力覆盖层 + 官方拉取作最新 id 全集」
// 的确定性合并：已知模型保留能力、新模型按用途追加、vision/tool 只接受接口明确能力、
// thinking 不按模型名猜测、非对话模型隔离、不丢已知、去重。

const assert = require('assert');
const path = require('path');

require('ts-node').register({
    transpileOnly: true,
    project: path.resolve(__dirname, '..', 'tsconfig.main.json')
});

const { mergeFetchedProviderModels } = require(
    path.resolve(__dirname, '..', 'src', 'shared', 'config', 'provider-model-merge.ts')
);
const { buildPrimaryModelOptionGroups } = require(
    path.resolve(__dirname, '..', 'src', 'shared', 'config', 'primary-model-options.ts')
);

let passed = 0;
function check(name, fn) { fn(); passed += 1; console.log(`  ✓ ${name}`); }

function knownModel(apiModelId, supportsVision, extra) {
    return {
        id: 'gptsapi-' + apiModelId,
        name: apiModelId,
        source: 'cloud',
        provider: 'gptsapi',
        requiredApiKey: 'gptsapi',
        apiModelId,
        roles: ['general'],
        capabilities: ['text-generation'],
        supportsVision: Boolean(supportsVision),
        supportsStreaming: true,
        maxTokens: 4096,
        ...(extra || {})
    };
}

console.log('smoke: provider-model-merge');

check('已知模型命中：保留硬编码能力，不新增、不被保守默认覆盖', () => {
    const known = [knownModel('gpt-5.4-pro', true, {
        supportsToolUse: true,
        pricing: { inputPerMillion: 1, outputPerMillion: 2 }
    })];
    const r = mergeFetchedProviderModels('gptsapi', [{ apiModelId: 'gpt-5.4-pro' }], known);
    assert.strictEqual(r.newCount, 0, '命中已知不应新增');
    assert.strictEqual(r.models.length, 1);
    assert.strictEqual(r.models[0].supportsVision, true, '保留硬编码 vision');
    assert.ok(r.models[0].pricing, '保留硬编码 pricing');
});

check('新模型追加：id 用 provider 前缀+slug，补 requiredApiKey 且不伪造 Tool 能力', () => {
    const known = [knownModel('gpt-5.4-pro', true)];
    const r = mergeFetchedProviderModels('gptsapi', [{ apiModelId: 'gpt-6-mini' }], known);
    assert.strictEqual(r.newCount, 1);
    const nm = r.models.find((m) => m.apiModelId === 'gpt-6-mini');
    assert.ok(nm, '新模型应被加入');
    assert.strictEqual(nm.id, 'gptsapi-gpt-6-mini', 'id = provider-slug');
    assert.strictEqual(nm.requiredApiKey, 'gptsapi', '补 requiredApiKey');
    assert.strictEqual(nm.source, 'cloud');
    assert.strictEqual(nm.supportsToolUse, false, 'Provider 未声明时不得默认支持工具');
    assert.strictEqual(nm.usageKind, 'conversation', '未知但无非对话信号的新模型暂按对话用途处理');
    assert.strictEqual(nm.usageConfidence, 'assumed', '能力元数据缺失时必须标记为待确认');
});

check('图片生成模型隔离：保留注册信息，但不得冒充对话/视觉理解/工具模型', () => {
    const r = mergeFetchedProviderModels('gptsapi', [
        {
            apiModelId: 'gpt-image-1',
            inputModalities: ['text', 'image'],
            outputModalities: ['image'],
            supportsVision: true,
            supportsToolUse: true
        },
        { apiModelId: 'google/imagen-3.0-generate-002' }
    ], []);
    assert.strictEqual(r.newConversationModelIds.length, 0, '图片生成模型不能进入对话候选');
    assert.strictEqual(r.newNonConversationModelIds.length, 2, '两个图片生成模型都应被隔离');
    for (const model of r.models) {
        assert.strictEqual(model.usageKind, 'image-generation');
        assert.strictEqual(model.supportsVision, false, '能接收参考图不代表能输出视觉理解文本');
        assert.strictEqual(model.supportsToolUse, false, '非对话模型不得声明 Agent 工具调用能力');
        assert.ok(!model.capabilities.includes('text-generation'), '非对话模型不得伪造文本生成能力');
    }
});

check('Embedding / 重排模型隔离，供应商文本输出元数据可确认对话模型', () => {
    const r = mergeFetchedProviderModels('openrouter', [
        { apiModelId: 'vendor/text-embedding-4', supportedMethods: ['embedContent'] },
        { apiModelId: 'vendor/rerank-v3', declaredKind: 'reranking' },
        {
            apiModelId: 'vendor/new-chat-pro',
            outputModalities: ['text'],
            supportedMethods: ['chat.completions']
        }
    ], []);
    const embedding = r.models.find((model) => model.apiModelId === 'vendor/text-embedding-4');
    const reranker = r.models.find((model) => model.apiModelId === 'vendor/rerank-v3');
    const chat = r.models.find((model) => model.apiModelId === 'vendor/new-chat-pro');
    assert.strictEqual(embedding.usageKind, 'embedding');
    assert.strictEqual(reranker.usageKind, 'reranking');
    assert.strictEqual(chat.usageKind, 'conversation');
    assert.strictEqual(chat.usageConfidence, 'metadata');
    assert.deepStrictEqual(r.newConversationModelIds, [chat.id]);
});

check('高速 MiMo 新模型仍可作为待确认对话模型，不被图片生成过滤误伤', () => {
    const r = mergeFetchedProviderModels('xiaomi', [{ apiModelId: 'mimo-v2.5-pro-ultraspeed' }], []);
    assert.strictEqual(r.models[0].usageKind, 'conversation');
    assert.strictEqual(r.models[0].usageConfidence, 'assumed');
    assert.deepStrictEqual(r.newConversationModelIds, [r.models[0].id]);
    const option = buildPrimaryModelOptionGroups('cloud', r.models)
        .flatMap((group) => group.options)
        .find((candidate) => candidate.id === r.models[0].id);
    assert.strictEqual(option.name, r.models[0].name, '模型候选只展示原始名称，不拼接能力解释后缀');
});

check('聊天快捷主模型候选复用用途分类，排除非对话动态模型', () => {
    const r = mergeFetchedProviderModels('gptsapi', [
        { apiModelId: 'vendor/new-chat-model', outputModalities: ['text'] },
        { apiModelId: 'gpt-image-1', outputModalities: ['image'] }
    ], []);
    const optionIds = buildPrimaryModelOptionGroups('cloud', r.models)
        .flatMap((group) => group.options.map((option) => option.id));
    assert.ok(optionIds.includes('gptsapi-vendor-new-chat-model'), '对话模型应进入快捷候选');
    assert.ok(!optionIds.includes('gptsapi-gpt-image-1'), '图片生成模型不得进入快捷候选');
});

check('vision 不按名称授予：接口未给时即使是 gemini 也不冒充可读图', () => {
    const g = mergeFetchedProviderModels('google', [{ apiModelId: 'gemini-9-flash' }], []);
    assert.strictEqual(g.models[0].supportsVision, false, 'gemini 名称不能授予 vision');
    assert.ok(!g.models[0].roles.includes('vision'), '未声明视觉能力时不能加入 vision 角色');
    const d = mergeFetchedProviderModels('deepseek', [{ apiModelId: 'deepseek-v5' }], []);
    assert.strictEqual(d.models[0].supportsVision, false, '普通文本模型同样不具备 vision');
});

check('接口给的能力优先于命名提示', () => {
    const a = mergeFetchedProviderModels('deepseek', [{ apiModelId: 'deepseek-v5', supportsVision: true }], []);
    assert.strictEqual(a.models[0].supportsVision, true, '接口给的 vision=true 优先');
    const b = mergeFetchedProviderModels('google', [{ apiModelId: 'gemini-text-only', supportsVision: false }], []);
    assert.strictEqual(b.models[0].supportsVision, false, '接口明确 false 优先于命名提示');
});

check('已知模型即使本次没拉到也保留（不丢）', () => {
    const known = [knownModel('gpt-5.4-pro', true)];
    const r = mergeFetchedProviderModels('gptsapi', [{ apiModelId: 'gpt-6-mini' }], known);
    assert.ok(r.models.some((m) => m.apiModelId === 'gpt-5.4-pro'), '已知模型应保留');
    assert.ok(r.models.some((m) => m.apiModelId === 'gpt-6-mini'), '新模型应加入');
});

check('去重与空输入安全', () => {
    const dup = mergeFetchedProviderModels('gptsapi', [{ apiModelId: 'x' }, { apiModelId: 'x' }], []);
    assert.strictEqual(dup.newCount, 1, '重复 id 只加一次');
    const empty = mergeFetchedProviderModels('gptsapi', [], [knownModel('a', false)]);
    assert.strictEqual(empty.models.length, 1, '空拉取保留已知');
    assert.strictEqual(empty.newCount, 0);
    const nullish = mergeFetchedProviderModels('gptsapi', null, []);
    assert.strictEqual(nullish.models.length, 0, 'null fetched 安全降级');
});

check('thinking 接口能力优先：OpenRouter supportsThinking=true → 合并后 thinking.supported & reasoning_content', () => {
    const r = mergeFetchedProviderModels('openrouter', [
        { apiModelId: 'some/random-model', supportsThinking: true, thinkingFormat: 'reasoning_content' }
    ], []);
    const nm = r.models.find((m) => m.apiModelId === 'some/random-model');
    assert.ok(nm, '新模型应被加入');
    assert.ok(nm.thinking, '接口给了 thinking 应写入 thinking 配置');
    assert.strictEqual(nm.thinking.supported, true, 'thinking.supported=true');
    assert.strictEqual(nm.thinking.format, 'reasoning_content', 'format=reasoning_content');
});

check('thinking 接口给 supportsThinking 但缺 format → 默认 reasoning_content', () => {
    const r = mergeFetchedProviderModels('openrouter', [{ apiModelId: 'x/y-think', supportsThinking: true }], []);
    const nm = r.models.find((m) => m.apiModelId === 'x/y-think');
    assert.strictEqual(nm.thinking.format, 'reasoning_content', '缺 format 用默认 reasoning_content');
});

check('thinking 不按模型名猜测：id 含 r1/reasoning/o1/qwq 但接口没给能力 → 无 thinking 字段', () => {
    const r1 = mergeFetchedProviderModels('deepseek', [{ apiModelId: 'deepseek-r1' }], []);
    assert.strictEqual(r1.models[0].thinking, undefined, 'r1 不能仅靠命名提示 thinking');
    const reasoning = mergeFetchedProviderModels('openrouter', [{ apiModelId: 'foo/reasoning-pro' }], []);
    assert.strictEqual(reasoning.models[0].thinking, undefined, 'reasoning 不能仅靠命名提示 thinking');
    const o1 = mergeFetchedProviderModels('gptsapi', [{ apiModelId: 'o1-preview' }], []);
    assert.strictEqual(o1.models[0].thinking, undefined, 'o1 不能仅靠命名提示 thinking');
    const qwq = mergeFetchedProviderModels('openrouter', [{ apiModelId: 'qwen/qwq-32b' }], []);
    assert.strictEqual(qwq.models[0].thinking, undefined, 'qwq 不能仅靠命名提示 thinking');
});

check('thinking 普通文本模型不命名提示，且无 thinking 字段', () => {
    const plain = mergeFetchedProviderModels('deepseek', [{ apiModelId: 'deepseek-v5' }], []);
    assert.strictEqual(plain.models[0].thinking, undefined, '普通文本模型不应有 thinking');
    const gpt = mergeFetchedProviderModels('gptsapi', [{ apiModelId: 'gpt-6-mini' }], []);
    assert.strictEqual(gpt.models[0].thinking, undefined, 'gpt-6-mini 不应有 thinking');
});

console.log(`\n✅ provider-model-merge smoke 全部通过（${passed} 项）`);
