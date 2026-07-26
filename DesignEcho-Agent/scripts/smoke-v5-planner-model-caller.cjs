'use strict';

/**
 * smoke: v5 PlannerModelCaller 单一 invoke 事件流（按 GPT 修正 2，2026-06-25）
 *
 * 守护：对外只 invoke；未绑定 fail-fast；stream/buffered 都产生同类标准事件；
 * 每 callId 恰一 terminal event；provider.completed 非 terminal；invokeAndCollect 累积/失败处理；
 * 注入计数（接入 spy 基础）。
 */

const assert = require('assert');
const path = require('path');

require('ts-node').register({
    transpileOnly: true,
    project: path.resolve(__dirname, '..', 'tsconfig.main.json')
});

const RT = path.resolve(__dirname, '..', 'src', 'shared', 'agent-runtime-v5');
const {
    getPlannerModelCaller,
    setPlannerModelCaller,
    resetPlannerModelCaller,
    isPlannerModelCallerConfigured,
    createCountingPlannerModelCaller,
    invokeAndCollect,
    isTerminalEvent,
    TERMINAL_EVENT_TYPES
} = require(path.join(RT, 'planner-model-caller.ts'));

let passed = 0;
async function check(name, fn) {
    await fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
}

const reqOf = (callId) => ({ callId, modelProfile: 'reasoning.default', modelId: 'm', messages: [{ role: 'user', content: 'hi' }] });

async function collect(caller, request, options) {
    const evs = [];
    for await (const e of caller.invoke(request, options)) evs.push(e);
    return evs;
}

async function main() {
    console.log('v5 PlannerModelCaller invoke smoke');

    await check('GPT#10 PlannerModelCaller 对外只有 invoke 方法', () => {
        const spy = createCountingPlannerModelCaller({ content: 'x' });
        const keys = Object.keys(spy).filter((k) => typeof spy[k] === 'function');
        assert.deepStrictEqual(keys, ['invoke']);
    });

    await check('未绑定：isConfigured=false，invoke 消费时 fail-fast 抛错', async () => {
        resetPlannerModelCaller();
        assert.strictEqual(isPlannerModelCallerConfigured(), false);
        await assert.rejects(() => collect(getPlannerModelCaller(), reqOf('c0'), { delivery: 'stream' }), /未绑定/);
    });

    await check('GPT#3 stream 模式产生标准事件序列（started…content.delta…completed）', async () => {
        const spy = createCountingPlannerModelCaller({ content: 'hello', thinking: 'think' });
        setPlannerModelCaller(spy);
        const evs = await collect(getPlannerModelCaller(), reqOf('c1'), { delivery: 'stream' });
        const types = evs.map((e) => e.type);
        assert.strictEqual(types[0], 'started');
        assert.ok(types.includes('content.delta'));
        assert.ok(types.includes('reasoning.delta'));
        assert.strictEqual(types[types.length - 1], 'completed');
        assert.ok(evs.every((e) => e.callId === 'c1'));
    });

    await check('GPT#4 buffered 模式产生相同类型的标准事件', async () => {
        const spy = createCountingPlannerModelCaller({ content: 'buffered-text' });
        setPlannerModelCaller(spy);
        const evs = await collect(getPlannerModelCaller(), reqOf('c2'), { delivery: 'buffered' });
        const types = evs.map((e) => e.type);
        assert.strictEqual(types[0], 'started');
        assert.strictEqual(types[types.length - 1], 'completed');
        assert.strictEqual(spy.lastDelivery, 'buffered');
    });

    await check('GPT#5 每个 callId 恰好一个 terminal event', async () => {
        const spy = createCountingPlannerModelCaller({ content: 'x' });
        setPlannerModelCaller(spy);
        const evs = await collect(getPlannerModelCaller(), reqOf('c3'), { delivery: 'stream' });
        const terminals = evs.filter((e) => isTerminalEvent(e));
        assert.strictEqual(terminals.length, 1);
        assert.deepStrictEqual([...TERMINAL_EVENT_TYPES].sort(), ['cancelled', 'completed', 'failed']);
    });

    await check('GPT#6 provider.completed 不是 terminal event', async () => {
        const spy = createCountingPlannerModelCaller({ content: 'x' });
        setPlannerModelCaller(spy);
        const evs = await collect(getPlannerModelCaller(), reqOf('c4'), { delivery: 'stream' });
        const pc = evs.find((e) => e.type === 'provider.completed');
        assert.ok(pc);
        assert.strictEqual(isTerminalEvent(pc), false);
    });

    await check('invokeAndCollect 累积 content/thinking → { text, thinking }', async () => {
        const spy = createCountingPlannerModelCaller({ content: 'answer', thinking: 'reason' });
        setPlannerModelCaller(spy);
        const r = await invokeAndCollect(getPlannerModelCaller(), reqOf('c5'), { delivery: 'stream' });
        assert.strictEqual(r.text, 'answer');
        assert.strictEqual(r.thinking, 'reason');
        assert.strictEqual(r.cancelled, false);
    });

    await check('GPT#8 failed 事件 → invokeAndCollect 抛错', async () => {
        const spy = createCountingPlannerModelCaller({ fail: { code: 'PROVIDER_ERROR', message: 'boom' } });
        setPlannerModelCaller(spy);
        await assert.rejects(() => invokeAndCollect(getPlannerModelCaller(), reqOf('c6'), { delivery: 'stream' }), /boom/);
    });

    await check('GPT#9 单次 invokeAndCollect → 逻辑调用计数 1', async () => {
        const spy = createCountingPlannerModelCaller({ content: 'x' });
        setPlannerModelCaller(spy);
        await invokeAndCollect(getPlannerModelCaller(), reqOf('c7'), { delivery: 'stream' });
        assert.strictEqual(spy.invokeCalls, 1);
    });

    await check('GPT#10 blocked 场景：不调用 invoke → invokeCalls=0', async () => {
        const spy = createCountingPlannerModelCaller({ content: 'should-not-call' });
        setPlannerModelCaller(spy);
        const planningMode = 'blocked';
        if (planningMode !== 'blocked') {
            await invokeAndCollect(getPlannerModelCaller(), reqOf('c8'), { delivery: 'stream' });
        }
        assert.strictEqual(spy.invokeCalls, 0);
    });

    await check('reset 隔离：复位后回到未绑定', () => {
        setPlannerModelCaller(createCountingPlannerModelCaller({ content: 'x' }));
        resetPlannerModelCaller();
        assert.strictEqual(isPlannerModelCallerConfigured(), false);
    });

    resetPlannerModelCaller();
    console.log(`\nPlannerModelCaller invoke smoke 全部通过：${passed} 项`);
}

main().catch((e) => { console.error(e); process.exit(1); });
