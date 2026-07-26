'use strict';

// 守护：Agent 工具循环通道「思考打通」的两条纪律——
// (1) thinking 门控：undefined 表示调用方使用默认偏好，不应被 adapter 当作关闭；
//     只有明确 false 才下发 thinking:{type:'disabled'}。
// (2) reasoning_content 历史回传：仅在开启思考且历史 assistant 带 reasoningContent 时按 provider 回写
//     （deepseek/xiaomi→reasoning_content，openrouter→reasoning，openai/gptsapi 不回写）；首轮无 reasoning 不塞空字段。
// 同时校验 parseResponse 同时识别 reasoning_content 与 openrouter 的 reasoning。

const assert = require('assert');
const path = require('path');

require('ts-node').register({
    transpileOnly: true,
    project: path.resolve(__dirname, '..', 'tsconfig.main.json')
});

const { OpenAIAdapter } = require(
    path.resolve(__dirname, '..', 'src', 'main', 'services', 'provider-adapters', 'openai-adapter.ts')
);

let passed = 0;
function check(name, fn) { fn(); passed += 1; console.log(`  ✓ ${name}`); }

const NO_TOOLS = [];
function userMsg() { return { role: 'user', content: 'hi' }; }
function assistantWithToolCall(reasoningContent) {
    return {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'c1', name: 'foo', arguments: {} }],
        ...(reasoningContent ? { reasoningContent } : {})
    };
}
function findAssistant(formatted) {
    return (formatted.messages || []).find((m) => m.role === 'assistant');
}

console.log('smoke: tool-channel-thinking (OpenAIAdapter 思考门控 + reasoning 回写)');

// ===== 门控：非思考路径不被破坏 =====
check('deepseek + thinkingEnabled undefined → 不下发 disabled（尊重默认开启偏好）', () => {
    const f = new OpenAIAdapter('deepseek').formatMessages([userMsg()], NO_TOOLS, {});
    assert.strictEqual(f.thinking, undefined);
});

check('deepseek + thinkingEnabled=false → thinking disabled', () => {
    const f = new OpenAIAdapter('deepseek').formatMessages([userMsg()], NO_TOOLS, { thinkingEnabled: false });
    assert.deepStrictEqual(f.thinking, { type: 'disabled' });
});

check('deepseek + thinkingEnabled=true → 不下发 disabled（用默认 reasoning）', () => {
    const f = new OpenAIAdapter('deepseek').formatMessages([userMsg()], NO_TOOLS, { thinkingEnabled: true });
    assert.strictEqual(f.thinking, undefined);
});

check('deepseek + thinkingEnabled=true + 官方 requestParams → 原样下发', () => {
    const f = new OpenAIAdapter('deepseek').formatMessages([userMsg()], NO_TOOLS, {
        thinkingEnabled: true,
        thinkingRequestParams: { thinking: { type: 'enabled' }, reasoning_effort: 'high' }
    });
    assert.deepStrictEqual(f.thinking, { type: 'enabled' });
    assert.strictEqual(f.reasoning_effort, 'high');
});

check('xiaomi + thinkingEnabled undefined → 不下发 disabled（尊重默认开启偏好）', () => {
    const f = new OpenAIAdapter('xiaomi').formatMessages([userMsg()], NO_TOOLS, {});
    assert.strictEqual(f.thinking, undefined);
});

check('xiaomi + thinkingEnabled=false → thinking disabled', () => {
    const f = new OpenAIAdapter('xiaomi').formatMessages([userMsg()], NO_TOOLS, { thinkingEnabled: false });
    assert.deepStrictEqual(f.thinking, { type: 'disabled' });
});

check('openai（普通）→ 不下发 thinking 字段', () => {
    const f = new OpenAIAdapter('openai').formatMessages([userMsg()], NO_TOOLS, { thinkingEnabled: false });
    assert.strictEqual(f.thinking, undefined);
});

// ===== reasoning_content 历史回传 =====
check('deepseek + thinking开 + 历史 reasoningContent → 回写 reasoning_content', () => {
    const f = new OpenAIAdapter('deepseek').formatMessages([assistantWithToolCall('思考过程X')], NO_TOOLS, { thinkingEnabled: true });
    const am = findAssistant(f);
    assert.strictEqual(am.reasoning_content, '思考过程X');
    assert.strictEqual(am.reasoning, undefined);
});

check('openrouter + thinking开 + 历史 reasoningContent → 回写 reasoning', () => {
    const f = new OpenAIAdapter('openrouter').formatMessages([assistantWithToolCall('思考Y')], NO_TOOLS, { thinkingEnabled: true });
    const am = findAssistant(f);
    assert.strictEqual(am.reasoning, '思考Y');
    assert.strictEqual(am.reasoning_content, undefined);
});

check('thinking关 → 不回写 reasoning（即使历史有）', () => {
    const f = new OpenAIAdapter('deepseek').formatMessages([assistantWithToolCall('思考Z')], NO_TOOLS, { thinkingEnabled: false });
    const am = findAssistant(f);
    assert.strictEqual(am.reasoning_content, undefined);
});

check('首轮无 reasoningContent → assistant 不带空 reasoning_content', () => {
    const f = new OpenAIAdapter('deepseek').formatMessages([assistantWithToolCall(undefined)], NO_TOOLS, { thinkingEnabled: true });
    const am = findAssistant(f);
    assert.strictEqual(am.reasoning_content, undefined);
});

check('gptsapi + thinking开 + reasoningContent → 不回写（provider 不吃该字段）', () => {
    const f = new OpenAIAdapter('gptsapi').formatMessages([assistantWithToolCall('思考')], NO_TOOLS, { thinkingEnabled: true });
    const am = findAssistant(f);
    assert.strictEqual(am.reasoning_content, undefined);
    assert.strictEqual(am.reasoning, undefined);
});

// ===== parseResponse 识别两种 reasoning 字段 =====
check('parseResponse reasoning_content → thinking', () => {
    const r = new OpenAIAdapter('deepseek').parseResponse({ choices: [{ message: { content: 'ok', reasoning_content: '推理A' } }] });
    assert.strictEqual(r.thinking, '推理A');
});

check('parseResponse reasoning（openrouter 风格）→ thinking', () => {
    const r = new OpenAIAdapter('openrouter').parseResponse({ choices: [{ message: { content: 'ok', reasoning: '推理B' } }] });
    assert.strictEqual(r.thinking, '推理B');
});

check('parseResponse 无 reasoning → thinking 不设', () => {
    const r = new OpenAIAdapter('openai').parseResponse({ choices: [{ message: { content: 'ok' } }] });
    assert.strictEqual(r.thinking, undefined);
});

console.log(`\n✅ tool-channel-thinking smoke 全部通过（${passed} 项）`);
