'use strict';

/**
 * smoke: Agent Runtime v5（代码控制的 R0→R1 意图闭环 + Project State owner-patch）
 * 守护 docs/41_AGENT_RUNTIME_ARCHITECTURE.md（v5.2）的核心契约：
 * - 流程由代码控制（确定性意图采集，不靠模型）；
 * - Project State 写入受 owner / base_revision 约束。
 */

const assert = require('assert');
const path = require('path');

require('ts-node').register({
    transpileOnly: true,
    project: path.resolve(__dirname, '..', 'tsconfig.main.json')
});

const RT = path.resolve(__dirname, '..', 'src', 'shared', 'agent-runtime-v5');
const { applyProjectStatePatch, createEmptyProjectState } = require(path.join(RT, 'project-state-service.ts'));
const { isPathOwnedBy } = require(path.join(RT, 'owner-scopes.ts'));
const { getManifestByTaskType } = require(path.join(RT, 'skill-runtime.ts'));
const { startDesignWorkflow } = require(path.join(RT, 'orchestrator.ts'));

let passed = 0;
function check(name, fn) {
    fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
}

function makePatch(overrides) {
    return Object.assign({
        patch_id: 'p1',
        project_id: 'proj-1',
        workflow_run_id: 'wf-1',
        owner_id: 'R1',
        base_revision: 0,
        operations: [{ op: 'add', path: '/brief/product', value: '过膝袜' }],
        reason: 'test',
        created_at: new Date().toISOString()
    }, overrides);
}

console.log('smoke: agent-runtime-v5');

// ---- Project State Service ----

check('owner 在自己区域写入成功，state_revision 自增', () => {
    const state = createEmptyProjectState('proj-1');
    const result = applyProjectStatePatch(state, makePatch());
    assert.strictEqual(result.applied, true);
    assert.strictEqual(result.state.state_revision, 1);
    assert.strictEqual(result.state.brief.product, '过膝袜');
    assert.strictEqual(state.state_revision, 0, '原状态不可被原地修改');
});

check('owner 越权写入被拒绝（R1 不能写 /product_analysis）', () => {
    const state = createEmptyProjectState('proj-1');
    const result = applyProjectStatePatch(state, makePatch({
        operations: [{ op: 'add', path: '/product_analysis/category', value: '袜子' }]
    }));
    assert.strictEqual(result.applied, false);
    assert.strictEqual(result.rejection.code, 'owner_scope_violation');
});

check('base_revision 不一致被拒绝（乐观锁）', () => {
    let state = createEmptyProjectState('proj-1');
    state = applyProjectStatePatch(state, makePatch()).state; // revision -> 1
    const stale = applyProjectStatePatch(state, makePatch({ base_revision: 0 }));
    assert.strictEqual(stale.applied, false);
    assert.strictEqual(stale.rejection.code, 'revision_conflict');
});

check('owner-scope 表：R0 写 workflow、E1 不能写 brief', () => {
    assert.strictEqual(isPathOwnedBy('R0', '/workflow/status'), true);
    assert.strictEqual(isPathOwnedBy('R1', '/brief/product'), true);
    assert.strictEqual(isPathOwnedBy('E1', '/brief/product'), false);
    assert.strictEqual(isPathOwnedBy('E1', '/storyboard/screens'), true);
});

// ---- Skill Runtime ----

check('detail-page manifest 按 task_type 可查，runtime_stages 含 R0..E2', () => {
    const manifest = getManifestByTaskType('ecommerce.detail_page.v1');
    assert.ok(manifest);
    assert.strictEqual(manifest.skill_id, 'ecommerce.detail_page');
    assert.ok(manifest.runtime_stages.includes('R0') && manifest.runtime_stages.includes('E1'));
    assert.ok(manifest.required_inputs.includes('product') && manifest.required_inputs.includes('asset_source'));
    assert.ok(manifest.forbidden_tools.includes('photoshop.raw.batchPlay'), '必须禁 raw batchPlay');
});

// ---- R0 -> R1 编排（代码控制的确定性意图采集）----

check('「帮我做详情页」(空上下文) → 停在 waiting_user，问 2 个阻塞项', () => {
    const state = createEmptyProjectState('proj-1', '测试项目');
    const r = startDesignWorkflow({
        userInput: '帮我做详情页',
        state,
        context: {},
        idFactory: (() => { let n = 0; return () => `id-${n += 1}`; })(),
        clock: () => '2026-06-23T00:00:00.000Z'
    });
    assert.strictEqual(r.outcome, 'awaiting_user_inputs');
    assert.strictEqual(r.workflowRun.status, 'waiting_user');
    assert.strictEqual(r.workflowRun.current_stage, 'briefing');
    assert.deepStrictEqual(r.missingInputs ?? r.briefing.missingInputs, ['product', 'asset_source']);
    assert.ok(r.briefing.intake.defaultStructure.length >= 6, '应带默认 6-8 屏结构');
    assert.strictEqual(r.briefing.intake.entryOptions.length, 3, '应带 3 个素材入口');
    // 状态被 owner patch 真实写入：/brief 由 R1、/workflow 由 R0
    assert.strictEqual(r.state.brief.task_type, 'ecommerce.detail_page.v1');
    assert.strictEqual(r.state.workflow.status, 'waiting_user');
    assert.ok(r.state.state_revision >= 2, '至少经过 R1 + R0 两次 patch');
});

check('已有文档 + 已给产品 → 无阻塞，进入 ready_for_context_analysis', () => {
    const state = createEmptyProjectState('proj-1');
    const r = startDesignWorkflow({
        userInput: '帮我做详情页',
        state,
        context: { hasPhotoshopDocument: true, providedInputs: { product: '过膝袜' } },
        clock: () => '2026-06-23T00:00:00.000Z'
    });
    assert.strictEqual(r.outcome, 'ready_for_context_analysis');
    assert.strictEqual(r.workflowRun.status, 'running');
    assert.strictEqual(r.briefing.missingInputs.length, 0);
});

check('非设计任务 → not_a_design_task（不抢别的路径）', () => {
    const state = createEmptyProjectState('proj-1');
    const r = startDesignWorkflow({ userInput: '你好', state });
    assert.strictEqual(r.outcome, 'not_a_design_task');
    assert.strictEqual(r.workflowRun, undefined);
});

check('主图任务 → 已有 manifest，进入 R1 输入采集而不是报未实现', () => {
    const state = createEmptyProjectState('proj-1');
    const r = startDesignWorkflow({ userInput: '帮我做主图', state });
    assert.strictEqual(r.outcome, 'awaiting_user_inputs');
    assert.strictEqual(r.workflowRun.skill_id, 'ecommerce.main_image');
    assert.strictEqual(r.workflowRun.current_stage, 'briefing');
    assert.deepStrictEqual(r.briefing.missingInputs, ['product', 'asset_source']);
});

check('平台尺寸缺失走 assumptions 默认假设，不计入阻塞问题', () => {
    const state = createEmptyProjectState('proj-1');
    const r = startDesignWorkflow({
        userInput: '帮我做详情页',
        state,
        context: { hasPhotoshopDocument: true, providedInputs: { product: '过膝袜' } },
        clock: () => '2026-06-23T00:00:00.000Z'
    });
    assert.ok(r.briefing.assumptions.some((a) => /750/.test(a)), 'platform_size 应有默认假设');
    assert.ok(!r.briefing.missingInputs.includes('platform_size'));
});

console.log(`\n✅ agent-runtime-v5 smoke 全部通过（${passed} 项）`);
