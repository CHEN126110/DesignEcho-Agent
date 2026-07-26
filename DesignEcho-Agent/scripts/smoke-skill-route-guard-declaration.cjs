'use strict';

/**
 * smoke: 「模型路由不得直执」护栏的声明单一来源钉桩（Set 收敛治理）
 *
 * 背景：engine.ts 原以硬编码 CREATIVE_DRAFT_CONTROLLED_SKILL_DENYLIST（7 技能）在
 * isModelSkillExecutionCompatibleWithIntentBoundary 执行点阻止模型路由直执这些技能
 *（它们必须经 Agent 自主 ReAct 循环执行——这是护栏不是脚本，不删除，只收敛来源）。
 * 治理后名单收敛为声明单一来源：SkillDeclaration.modelDirectExecution === 'forbidden'，
 * 派生 helper isModelDirectExecutionForbiddenSkill / getModelDirectExecutionForbiddenSkillIds。
 *
 * 钉桩内容（防回潮/防静默放行）：
 *  ① 受控技能全部在派生等价集内——尤其 SKU 系列（用户拍板红线：防退回脚本直调）。
 *  ② engine 源码不再包含该硬编码 Set，且消费点改读派生 helper。
 *  ③ 派生集与治理基线逐一相等（双向）：声明漏填=静默放行、声明多填=静默扩权，都拦。
 *  ④ engine 的 main-image-template-authoring / detail-page-template-authoring 旧措辞重定向
 *     字面量原样保留（CLAUDE.md 明示的有意保留项，防被顺手清理）。
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '..', 'tsconfig.json'),
  compilerOptions: {
    module: 'CommonJS',
    moduleResolution: 'node'
  }
});

const {
  isModelDirectExecutionForbiddenSkill,
  getModelDirectExecutionForbiddenSkillIds
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'skills', 'skill-declarations.ts'));

const ENGINE_PATH = path.resolve(
  __dirname, '..', 'src', 'renderer', 'services', 'design-agent', 'engine.ts'
);

// 与原 engine 硬编码 denylist 逐一对应，并纳入后续明确受控业务 Skill 的治理基线。
// + find-and-edit-element（2026-07-07 真机病例扩入：直执时多候选分支以一句
// 「候选图层不唯一」终结任务——定位/消歧必须在循环里进行）。
const EXPECTED_FORBIDDEN_SKILL_IDS = [
  'document-management',
  'sku-batch',
  'sku-color-card',
  'main-image-design',
  'detail-page-design',
  'ecommerce-socks-design',
  'sku-config',
  'project-image-analysis',
  'find-and-edit-element',
  'layout-replication'
];

function main() {
  console.log('smoke: skill-route-guard-declaration');

  // ① 受控技能全部在派生等价集内
  for (const skillId of EXPECTED_FORBIDDEN_SKILL_IDS) {
    assert.strictEqual(
      isModelDirectExecutionForbiddenSkill(skillId),
      true,
      `技能 ${skillId} 必须声明 modelDirectExecution: 'forbidden'（模型路由不得直执，须经自主循环）`
    );
  }
  console.log(`  ✓ ${EXPECTED_FORBIDDEN_SKILL_IDS.length} 个技能全部在派生等价集内`);

  // ①-红线：sku-batch 必须在集内（用户拍板：防退回脚本直调）
  assert.strictEqual(
    isModelDirectExecutionForbiddenSkill('sku-batch'),
    true,
    'sku-batch 必须禁止模型路由直执（用户拍板红线：SKU 必须经 Agent 自主循环，防退回脚本直调）'
  );
  console.log('  ✓ sku-batch 红线独立钉桩通过');

  // ③ 派生集与治理基线逐一相等（双向：漏填=静默放行、多填=静默扩权）
  const derived = getModelDirectExecutionForbiddenSkillIds().slice().sort();
  const expected = EXPECTED_FORBIDDEN_SKILL_IDS.slice().sort();
  assert.deepStrictEqual(
    derived,
    expected,
    `派生集与治理基线不相等：派生=[${derived.join(', ')}] 期望=[${expected.join(', ')}]。`
      + '若是有意增删受控技能，请同步更新本 smoke 的基线清单并说明理由。'
  );
  console.log('  ✓ 派生集与治理基线双向相等');

  // 对照组：未声明技能不得被误判为禁止直执
  for (const skillId of ['matte-product', 'layer-management', 'autonomous-agent', 'not-a-skill']) {
    assert.strictEqual(
      isModelDirectExecutionForbiddenSkill(skillId),
      false,
      `技能 ${skillId} 未声明 modelDirectExecution，不应被判为禁止直执`
    );
  }
  console.log('  ✓ 未声明技能不受影响（对照组通过）');

  // ② engine 源码不再含硬编码 Set，消费点改读派生 helper
  const engineSource = fs.readFileSync(ENGINE_PATH, 'utf8');
  assert.ok(
    !engineSource.includes('CREATIVE_DRAFT_CONTROLLED_SKILL_DENYLIST.has('),
    'engine.ts 不得再消费硬编码 CREATIVE_DRAFT_CONTROLLED_SKILL_DENYLIST Set'
  );
  assert.ok(
    !/CREATIVE_DRAFT_CONTROLLED_SKILL_DENYLIST\s*=\s*new Set/.test(engineSource),
    'engine.ts 不得再定义硬编码 CREATIVE_DRAFT_CONTROLLED_SKILL_DENYLIST Set（名单单一来源=技能声明）'
  );
  assert.ok(
    engineSource.includes('isModelDirectExecutionForbiddenSkill('),
    'engine.ts 必须以 isModelDirectExecutionForbiddenSkill 派生 helper 作为护栏消费点'
  );
  console.log('  ✓ engine 源码已无硬编码 Set，消费点=派生 helper');

  // ④ 旧措辞重定向字面量原样保留（有意保留项，不是死代码）
  assert.ok(
    engineSource.includes("'main-image-template-authoring'")
      && engineSource.includes("'detail-page-template-authoring'"),
    'engine.ts 的 template-authoring 旧措辞重定向字面量必须原样保留（CLAUDE.md 明示别清理）'
  );
  console.log('  ✓ template-authoring 旧措辞重定向字面量仍在');

  console.log('smoke: skill-route-guard-declaration 全部通过');
}

main();
