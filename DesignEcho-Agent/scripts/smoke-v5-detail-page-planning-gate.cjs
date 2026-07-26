'use strict';

/**
 * smoke: v5 详情页规划门禁决策 + PlannerModelCaller 联动（GPT 决策 4 核心证明，2026-06-24）
 *
 * 守护接入硬契约：模拟 ChatPanel v5 分支"据门禁决策调/不调规划模型"，断言
 * **blocked / structure_only 时规划模型调用数 = 0**；full 时放行调用一次；
 * structure_only 渲染 skeleton 卡片、blocked 渲染三动作卡片；preset 缺失 fail-closed 回退 blocked。
 */

const assert = require('assert');
const path = require('path');

require('ts-node').register({
    transpileOnly: true,
    project: path.resolve(__dirname, '..', 'tsconfig.main.json')
});

const RT = path.resolve(__dirname, '..', 'src', 'shared', 'agent-runtime-v5');
const { decideDetailPagePlanning } = require(path.join(RT, 'detail-page-planning-gate.ts'));
const {
    setPlannerModelCaller,
    getPlannerModelCaller,
    resetPlannerModelCaller,
    createCountingPlannerModelCaller,
    invokeAndCollect
} = require(path.join(RT, 'planner-model-caller.ts'));
//  import 详情页 preset 文件以触发自注册（structure_only 取 preset 必需）
require(path.join(RT, 'manifests', 'detail-page.structure-preset.ts'));

let passed = 0;
async function check(name, fn) {
    await fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
}

const CURRENT_SET = 'sha256:' + 'b'.repeat(64);
const context = { projectId: 'p1', conversationId: 'c1', taskType: 'ecommerce.detail_page.v1', sourceRevision: 1 };

function trustedEntry() {
    return { insight: { provenance: {
        fileSha256: 'sha256:' + 'a'.repeat(64),
        assetSetHash: CURRENT_SET,
        modelProfile: 'vision.reference',
        providerModel: 'google-gemini-3-flash',
        promptVersion: 'visual-evidence/v1',
        analysisSchemaVersion: 'visual-evidence-set/1.0.0',
        capabilityStatus: 'real'
    } } };
}

/** 模拟 ChatPanel v5 分支：据门禁决策决定是否调规划模型，返回决策 + 实际调用次数。 */
async function simulateV5Branch(gateInput, ctx, visualBootstrapReady) {
    const spy = createCountingPlannerModelCaller({ content: 'planned' });
    setPlannerModelCaller(spy);
    const decision = decideDetailPagePlanning({ gate: gateInput, context: ctx || context, visualBootstrapReady: Boolean(visualBootstrapReady) });
    if (decision.planningMode === 'full') {
        //  放行：ChatPanel 会调规划模型（经收口后的单一 invoke）
        await invokeAndCollect(getPlannerModelCaller(), { callId: 'plan-1', modelProfile: 'reasoning.default', modelId: 'm', messages: [{ role: 'user', content: 'plan' }] }, { delivery: 'stream' });
    }
    //  blocked / structure_only：渲染 decision.card，不调任何规划模型
    return { decision, callerCalls: spy.invokeCalls };
}

async function main() {
    console.log('v5 详情页规划门禁决策 smoke');

    await check('GPT 核心：缺证据 + 无 fallback → blocked，规划模型调用=0，渲染三动作卡片', async () => {
        const { decision, callerCalls } = await simulateV5Branch({ hasFilenames: true });
        assert.strictEqual(decision.planningMode, 'blocked');
        assert.strictEqual(callerCalls, 0);
        assert.strictEqual(decision.card.kind, 'visual-evidence.blocked');
        assert.strictEqual(decision.card.actions.length, 3);
    });

    await check('GPT 核心：用户选 structure_only → 规划模型调用=0，渲染 skeleton 卡片', async () => {
        const { decision, callerCalls } = await simulateV5Branch({ hasFilenames: true, fallbackMode: 'structure_only' });
        assert.strictEqual(decision.planningMode, 'structure_only');
        assert.strictEqual(callerCalls, 0);
        assert.strictEqual(decision.card.kind, 'structure-only.skeleton');
        assert.strictEqual(decision.card.payload.modules.length, 8);
    });

    await check('full（verified_visual）→ 放行规划，规划模型调用=1', async () => {
        const { decision, callerCalls } = await simulateV5Branch({
            visualInsightCache: { entries: [trustedEntry()] },
            freshAnalysis: true,
            currentAssetSetHash: CURRENT_SET
        });
        assert.strictEqual(decision.planningMode, 'full');
        assert.strictEqual(callerCalls, 1);
    });

    await check('分析按钮：visualBootstrapReady=false → disabled+理由', async () => {
        const { decision } = await simulateV5Branch({ hasFilenames: true }, context, false);
        const analyze = decision.card.actions.find((a) => a.actionId === 'RUN_PROJECT_VISUAL_ANALYSIS');
        assert.strictEqual(analyze.state, 'disabled');
        assert.ok(analyze.disabledReason);
    });

    await check('fail-closed：structure_only 但 preset 缺失（未知 taskType）→ 回退 blocked', async () => {
        const { decision, callerCalls } = await simulateV5Branch(
            { hasFilenames: true, fallbackMode: 'structure_only' },
            { projectId: 'p1', conversationId: 'c1', taskType: 'ecommerce.unknown.v1', sourceRevision: 1 }
        );
        assert.strictEqual(decision.planningMode, 'blocked');
        assert.strictEqual(callerCalls, 0);
    });

    await check('structure_only 骨架经 Claim Guard（buildStructureOnlyPlan 干净）→ 不抛错', async () => {
        //  decideDetailPagePlanning 内部 assertStructureOnlyPlanClean，若骨架不干净会抛错
        const { decision } = await simulateV5Branch({ hasFilenames: true, fallbackMode: 'structure_only' });
        assert.strictEqual(decision.planningMode, 'structure_only');
    });

    resetPlannerModelCaller();
    console.log(`\n详情页规划门禁决策 smoke 全部通过：${passed} 项`);
}

main().catch((e) => { console.error(e); process.exit(1); });
