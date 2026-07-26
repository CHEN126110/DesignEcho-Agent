'use strict';

/**
 * smoke: v5 视觉观察 / 结构草案展示卡片契约（按 GPT 混合方案，2026-06-24）
 *
 * 守护：复用 InteractiveCardDefinition 外壳但强类型独立契约、kind 命名空间化、三恢复动作、
 * "分析项目图片"按钮在 bootstrap 未就绪时禁用并给理由、骨架由 StructureOnlyPlan 单向映射、
 * 卡片只读不反向成数据源。
 */

const assert = require('assert');
const path = require('path');

require('ts-node').register({
    transpileOnly: true,
    project: path.resolve(__dirname, '..', 'tsconfig.main.json')
});

const RT = path.resolve(__dirname, '..', 'src', 'shared', 'agent-runtime-v5');
const {
    buildVisualObservationBlockedCard,
    buildStructureOnlySkeletonCard,
    VISUAL_OBSERVATION_CARD_SUBMIT_ACTION
} = require(path.join(RT, 'visual-observation-card.ts'));
const { buildVisualObservationRequiredBlocker } = require(path.join(RT, 'visual-observation-gate.ts'));
const { buildStructureOnlyPlan } = require(path.join(RT, 'structure-only-plan.ts'));
const { DETAIL_PAGE_STRUCTURE_PRESET } = require(path.join(RT, 'manifests', 'detail-page.structure-preset.ts'));

let passed = 0;
function check(name, fn) {
    fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
}

const context = { projectId: 'p1', conversationId: 'c1', taskType: 'ecommerce.detail_page.v1', sourceRevision: 1 };
const blocker = buildVisualObservationRequiredBlocker();

console.log('v5 视觉观察卡片契约 smoke');

//  ---- blocked 卡片 ----
check('blocked 卡片：bootstrap 未就绪 → 分析按钮 disabled + 理由，另两动作 enabled', () => {
    const card = buildVisualObservationBlockedCard({ blocker, context, visualBootstrapReady: false });
    assert.strictEqual(card.kind, 'visual-observation.blocked');
    assert.strictEqual(card.submitAction, VISUAL_OBSERVATION_CARD_SUBMIT_ACTION);
    assert.deepStrictEqual(card.payload.blocker, blocker);
    const analyze = card.actions.find((a) => a.actionId === 'RUN_PROJECT_VISUAL_ANALYSIS');
    assert.strictEqual(analyze.state, 'disabled');
    assert.ok(analyze.disabledReason && analyze.disabledReason.code === 'VISUAL_BOOTSTRAP_NOT_READY');
    assert.strictEqual(card.actions.find((a) => a.actionId === 'SELECT_PRODUCT_IMAGES').state, 'enabled');
    assert.strictEqual(card.actions.find((a) => a.actionId === 'VIEW_STRUCTURE_SKELETON').state, 'enabled');
});
check('blocked 卡片：bootstrap 就绪 → 分析按钮 enabled', () => {
    const card = buildVisualObservationBlockedCard({ blocker, context, visualBootstrapReady: true });
    const analyze = card.actions.find((a) => a.actionId === 'RUN_PROJECT_VISUAL_ANALYSIS');
    assert.strictEqual(analyze.state, 'enabled');
    assert.strictEqual(analyze.disabledReason, undefined);
});
check('blocked 卡片：恰好三个恢复动作', () => {
    const card = buildVisualObservationBlockedCard({ blocker, context, visualBootstrapReady: false });
    assert.strictEqual(card.actions.length, 3);
});

//  ---- structure-only skeleton 卡片 ----
const plan = buildStructureOnlyPlan({ preset: DETAIL_PAGE_STRUCTURE_PRESET, projectId: 'p1', sourceRevision: 1 });

check('skeleton 卡片：由 StructureOnlyPlan 单向映射出 8 模块视图', () => {
    const card = buildStructureOnlySkeletonCard({ plan, context });
    assert.strictEqual(card.kind, 'structure-only.skeleton');
    assert.strictEqual(card.payload.outputScope, 'structure_only');
    assert.strictEqual(card.payload.capabilityStatus, 'fallback');
    assert.strictEqual(card.payload.modules.length, 8);
    assert.deepStrictEqual(card.actions, []); //  草案卡片无动作（只读展示）
    const kv = card.payload.modules[0];
    assert.strictEqual(kv.moduleId, 'detail-01-kv');
    assert.strictEqual(kv.intentText, '第一眼建立产品认知与点击理由'); //  来自 preset
    assert.ok(kv.placeholders.includes('[[PRODUCT_NAME]]'));
});
check('skeleton 卡片：intentText 取自 preset、不含产品事实', () => {
    const card = buildStructureOnlySkeletonCard({ plan, context });
    for (let i = 0; i < card.payload.modules.length; i += 1) {
        assert.strictEqual(card.payload.modules[i].intentText, plan.modules[i].intent.text);
    }
});

//  ---- 禁止卡片反向成数据源 ----
check('禁止反向数据源：修改卡片 payload 不影响原 plan（深拷贝映射）', () => {
    const card = buildStructureOnlySkeletonCard({ plan, context });
    card.payload.modules[0].intentText = '篡改：白色过膝袜超柔软';
    card.payload.modules[0].placeholders.push('[[PRICE]]');
    //  原 plan 不被污染
    assert.strictEqual(plan.modules[0].intent.text, '第一眼建立产品认知与点击理由');
    assert.ok(!plan.modules[0].placeholders.includes('[[PRICE]]'));
});

//  ---- 命名空间 kind 与统一提交入口 ----
check('kind 命名空间化、不复用泛化 confirm/edit/blocked', () => {
    const b = buildVisualObservationBlockedCard({ blocker, context, visualBootstrapReady: false });
    const s = buildStructureOnlySkeletonCard({ plan, context });
    for (const k of [b.kind, s.kind]) {
        assert.ok(k.includes('.'), `kind 应命名空间化：${k}`);
        assert.ok(!['confirm', 'edit', 'blocked'].includes(k));
    }
    assert.strictEqual(b.submitAction, s.submitAction); //  统一窄入口
});

console.log(`\nvisual-observation-card smoke 全部通过：${passed} 项`);
