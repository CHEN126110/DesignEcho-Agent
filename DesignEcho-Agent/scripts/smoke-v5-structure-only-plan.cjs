'use strict';

/**
 * smoke: v5 structure_only 确定性骨架 + Skill Preset + Claim Guard（按 GPT 纠偏定稿，2026-06-24）
 *
 * 守护 GPT P0 smoke #22-26 + 纠偏：骨架由详情页 Skill preset 白名单确定性生成（与 design-task-types
 * 解耦、不调模型）；混入 title/body/sellingPoint 被拒；非占位/非 preset 占位符被拒；
 * **intent 文本被篡改（塞产品事实）被 Claim Guard 精确核对拒绝**；约束放开被拒；永不进 Quality Gate / PS 任务。
 */

const assert = require('assert');
const path = require('path');

require('ts-node').register({
    transpileOnly: true,
    project: path.resolve(__dirname, '..', 'tsconfig.main.json')
});

const RT = path.resolve(__dirname, '..', 'src', 'shared', 'agent-runtime-v5');
const structureOnly = require(path.join(RT, 'structure-only-plan.ts'));
const {
    buildStructureOnlyPlan,
    detectStructureOnlyClaimLeakage,
    assertStructureOnlyPlanClean,
    getStructureSkillPreset,
    STRUCTURE_ONLY_PLACEHOLDERS
} = structureOnly;
//  详情页 preset 属于 Skill 自己的文件（import 即自注册到通用 registry），通用 Runtime 不内置它
const { DETAIL_PAGE_STRUCTURE_PRESET } = require(path.join(RT, 'manifests', 'detail-page.structure-preset.ts'));

let passed = 0;
function check(name, fn) {
    fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
}

const preset = DETAIL_PAGE_STRUCTURE_PRESET;
const plan0 = () => buildStructureOnlyPlan({ preset, projectId: 'p1', sourceRevision: 1 });

console.log('v5 structure_only 骨架 smoke');

check('前置：详情页 preset 为 8 模块白名单，import 后经 registry 可按 taskType 取到', () => {
    assert.strictEqual(getStructureSkillPreset('ecommerce.detail_page.v1'), preset);
    assert.strictEqual(preset.modules.length, 8);
});
check('GPT#9 详情页八模块不在通用 Runtime 代码中定义（structure-only-plan 不导出该常量）', () => {
    assert.strictEqual(structureOnly.DETAIL_PAGE_STRUCTURE_PRESET, undefined);
});
check('GPT#20 未知 taskType 的 preset 缺失 → getStructureSkillPreset 返回 undefined（fail-closed）', () => {
    assert.strictEqual(getStructureSkillPreset('ecommerce.unknown_task.v1'), undefined);
});

//  ---- GPT#22：确定性骨架由 Skill preset 生成（解耦 design-task-types、不调模型）----
check('GPT#22 由 Skill preset 确定性生成、按 order 排列', () => {
    const plan = plan0();
    assert.strictEqual(plan.outputScope, 'structure_only');
    assert.strictEqual(plan.capabilityStatus, 'fallback');
    assert.strictEqual(plan.presetId, preset.presetId);
    assert.strictEqual(plan.modules.length, 8);
    assert.deepStrictEqual(plan.modules.map((m) => m.order), [1, 2, 3, 4, 5, 6, 7, 8]);
    assert.strictEqual(plan.modules[0].moduleType, 'hero_kv');
    assert.strictEqual(plan.modules[7].moduleType, 'brand_trust');
});
check('GPT#22 每个模块只含结构字段（含键值 intent），无文案字段', () => {
    const plan = plan0();
    const allowed = new Set(['moduleId', 'moduleType', 'order', 'intent', 'requiredInputSlots', 'placeholders']);
    for (const m of plan.modules) {
        for (const key of Object.keys(m)) assert.ok(allowed.has(key), `非结构字段：${key}`);
        assert.ok(m.intent && typeof m.intent.key === 'string' && typeof m.intent.text === 'string');
        for (const ph of m.placeholders) assert.ok(STRUCTURE_ONLY_PLACEHOLDERS.includes(ph), `非白名单占位符：${ph}`);
    }
});
check('解耦验证：本模块不依赖 design-task-types（preset 自带 intent 文本）', () => {
    //  require 缓存里不应因 structure-only-plan 而加载 design-task-types
    const loaded = Object.keys(require.cache).some((k) => k.endsWith(path.join('shared', 'design-task-types.ts')));
    assert.strictEqual(loaded, false, 'structure-only-plan 不应 import design-task-types');
});
check('确定性：相同输入生成相同骨架', () => {
    const a = buildStructureOnlyPlan({ preset, projectId: 'p1', sourceRevision: 1, planId: 'x' });
    const b = buildStructureOnlyPlan({ preset, projectId: 'p1', sourceRevision: 1, planId: 'x' });
    assert.deepStrictEqual(a, b);
});

//  ---- Claim Guard：干净骨架通过 ----
check('Claim Guard：确定性骨架对照 preset 通过', () => {
    const plan = plan0();
    const r = detectStructureOnlyClaimLeakage(plan, preset);
    assert.strictEqual(r.valid, true, JSON.stringify(r.violations));
    assert.doesNotThrow(() => assertStructureOnlyPlanClean(plan, preset));
});

//  ---- GPT 核心纠偏：intent 篡改塞产品事实 → 被精确核对拒绝 ----
check('纠偏：intent 被改成产品宣称 → STRUCTURE_ONLY_INTENT_TAMPERED', () => {
    const plan = plan0();
    plan.modules[0].intent.text = '突出白色过膝袜的柔软保暖和不勒脚'; //  GPT 举的跳过检查例子
    const r = detectStructureOnlyClaimLeakage(plan, preset);
    assert.strictEqual(r.valid, false);
    assert.ok(r.violations.some((v) => v.code === 'STRUCTURE_ONLY_INTENT_TAMPERED' && v.jsonPointer.includes('/intent')));
});
check('纠偏：moduleType 被改 → INTENT_TAMPERED', () => {
    const plan = plan0();
    plan.modules[1].moduleType = 'material';
    const r = detectStructureOnlyClaimLeakage(plan, preset);
    assert.ok(r.violations.some((v) => v.code === 'STRUCTURE_ONLY_INTENT_TAMPERED'));
});
check('纠偏：未知 moduleId（不在 preset）→ STRUCTURE_ONLY_UNKNOWN_MODULE', () => {
    const plan = plan0();
    plan.modules.push({ moduleId: 'detail-99-promo', moduleType: 'unknown', order: 9, intent: { key: 'x', text: 'y' }, requiredInputSlots: [], placeholders: [] });
    const r = detectStructureOnlyClaimLeakage(plan, preset);
    assert.ok(r.violations.some((v) => v.code === 'STRUCTURE_ONLY_UNKNOWN_MODULE'));
});

//  ---- GPT#23：title/body/sellingPoint 被拒 ----
check('GPT#23 混入 title → STRUCTURE_ONLY_PRODUCT_CLAIM', () => {
    const plan = plan0();
    plan.modules[0].title = '白色过膝长袜';
    const r = detectStructureOnlyClaimLeakage(plan, preset);
    assert.ok(r.violations.some((v) => v.code === 'STRUCTURE_ONLY_PRODUCT_CLAIM' && v.jsonPointer.includes('/title')));
});
check('GPT#23 混入 body → assertStructureOnlyPlanClean 抛错', () => {
    const plan = plan0();
    plan.modules[2].body = '采用进口羊毛，全天舒适';
    assert.throws(() => assertStructureOnlyPlanClean(plan, preset), /STRUCTURE_ONLY_CLAIM_LEAKAGE/);
});

//  ---- GPT#24：占位符必须既在白名单、又是该 preset 模块子集 ----
check('GPT#24 非白名单占位符 [[PRICE]] → INVALID_PLACEHOLDER', () => {
    const plan = plan0();
    plan.modules[0].placeholders.push('[[PRICE]]');
    const r = detectStructureOnlyClaimLeakage(plan, preset);
    assert.ok(r.violations.some((v) => v.code === 'STRUCTURE_ONLY_INVALID_PLACEHOLDER'));
});
check('GPT#24 白名单内但非该 preset 模块的占位符 → INVALID_PLACEHOLDER', () => {
    const plan = plan0();
    plan.modules[0].placeholders.push('[[COLOR_VARIANTS]]'); //  白名单内，但 hero_kv 不允许
    const r = detectStructureOnlyClaimLeakage(plan, preset);
    assert.ok(r.violations.some((v) => v.code === 'STRUCTURE_ONLY_INVALID_PLACEHOLDER'));
});

//  ---- GPT#25-26：约束收紧 ----
check('GPT#25 structure_only 永远不能进入 Quality Gate', () => {
    assert.strictEqual(plan0().constraints.qualityGateEligible, false);
});
check('GPT#26 structure_only 计划不携带 Photoshop 执行权限', () => {
    assert.strictEqual(Object.prototype.hasOwnProperty.call(plan0().constraints, 'photoshopExecutionAllowed'), false);
});
check('内容约束被放开（visualClaimsAllowed=true）→ CONSTRAINT_VIOLATION', () => {
    const tampered = JSON.parse(JSON.stringify(plan0()));
    tampered.constraints = Object.assign({}, tampered.constraints, { visualClaimsAllowed: true });
    const r = detectStructureOnlyClaimLeakage(tampered, preset);
    assert.ok(r.violations.some((v) => v.code === 'STRUCTURE_ONLY_CONSTRAINT_VIOLATION'));
});

console.log(`\nstructure_only 骨架 smoke 全部通过：${passed} 项`);
