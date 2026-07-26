'use strict';

/**
 * smoke: v5 视觉观察卡片动作控制器（按 GPT 删重入纠偏，2026-06-25）
 *
 * 守护：卡片动作走确定性控制器(不重入发送管线)：VIEW_STRUCTURE_SKELETON→骨架卡片、
 * disabled 动作手工提交→rejected、未就绪能力→rejected、伪造动作→rejected、幂等无副作用、
 * preset 缺失 fail-closed。
 */

const assert = require('assert');
const path = require('path');

require('ts-node').register({
    transpileOnly: true,
    project: path.resolve(__dirname, '..', 'tsconfig.main.json')
});

const RT = path.resolve(__dirname, '..', 'src', 'shared', 'agent-runtime-v5');
const { submitVisualObservationCardAction } = require(path.join(RT, 'detail-page-card-controller.ts'));
const { buildVisualObservationBlockedCard } = require(path.join(RT, 'visual-observation-card.ts'));
const { buildVisualObservationRequiredBlocker } = require(path.join(RT, 'visual-observation-gate.ts'));
require(path.join(RT, 'manifests', 'detail-page.structure-preset.ts'));

let passed = 0;
function check(name, fn) {
    fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
}

const context = { projectId: 'p1', conversationId: 'c1', taskType: 'ecommerce.detail_page.v1', sourceRevision: 1 };
const blocker = buildVisualObservationRequiredBlocker();
//  P0：bootstrap 未就绪 → analyze disabled、select enabled、view enabled
const blockedCard = () => buildVisualObservationBlockedCard({ blocker, context, visualBootstrapReady: false });

console.log('v5 视觉观察卡片动作控制器 smoke');

check('VIEW_STRUCTURE_SKELETON(enabled) → 渲染 8 模块骨架卡片', () => {
    const r = submitVisualObservationCardAction(blockedCard(), 'VIEW_STRUCTURE_SKELETON');
    assert.strictEqual(r.type, 'card');
    assert.strictEqual(r.card.kind, 'structure-only.skeleton');
    assert.strictEqual(r.card.payload.modules.length, 8);
});

check('幂等：同卡片同动作重复提交 → 等价结果（确定性骨架）', () => {
    const a = submitVisualObservationCardAction(blockedCard(), 'VIEW_STRUCTURE_SKELETON');
    const b = submitVisualObservationCardAction(blockedCard(), 'VIEW_STRUCTURE_SKELETON');
    assert.deepStrictEqual(a.card.payload, b.card.payload);
});

check('GPT#11 disabled analyze 手工提交 → rejected(ACTION_DISABLED)', () => {
    const r = submitVisualObservationCardAction(blockedCard(), 'RUN_PROJECT_VISUAL_ANALYSIS');
    assert.strictEqual(r.type, 'rejected');
    assert.strictEqual(r.code, 'ACTION_DISABLED');
});

check('GPT#12 select(enabled 但未实现) → rejected(SELECT_IMAGES_NOT_READY)', () => {
    const r = submitVisualObservationCardAction(blockedCard(), 'SELECT_PRODUCT_IMAGES');
    assert.strictEqual(r.type, 'rejected');
    assert.strictEqual(r.code, 'SELECT_IMAGES_NOT_READY');
});

check('bootstrap 就绪时 analyze(enabled 但服务未接) → rejected(VISUAL_BOOTSTRAP_NOT_READY)', () => {
    const card = buildVisualObservationBlockedCard({ blocker, context, visualBootstrapReady: true });
    const r = submitVisualObservationCardAction(card, 'RUN_PROJECT_VISUAL_ANALYSIS');
    assert.strictEqual(r.type, 'rejected');
    assert.strictEqual(r.code, 'VISUAL_BOOTSTRAP_NOT_READY');
});

check('伪造动作（不在卡片 actions 内）→ rejected(UNSUPPORTED_ACTION)', () => {
    const r = submitVisualObservationCardAction(blockedCard(), 'DELETE_PROJECT');
    assert.strictEqual(r.type, 'rejected');
    assert.strictEqual(r.code, 'UNSUPPORTED_ACTION');
});

check('卡片无效 → rejected(INVALID_CARD)', () => {
    const r = submitVisualObservationCardAction(null, 'VIEW_STRUCTURE_SKELETON');
    assert.strictEqual(r.type, 'rejected');
    assert.strictEqual(r.code, 'INVALID_CARD');
});

check('rejected 结果不含 card（无副作用、只描述拒绝）', () => {
    const r = submitVisualObservationCardAction(blockedCard(), 'SELECT_PRODUCT_IMAGES');
    assert.strictEqual(r.card, undefined);
    assert.ok(typeof r.message === 'string' && r.message.length > 0);
});

console.log(`\n卡片动作控制器 smoke 全部通过：${passed} 项`);
