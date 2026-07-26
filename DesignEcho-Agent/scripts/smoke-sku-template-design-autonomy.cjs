#!/usr/bin/env node

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
  buildAgentIntentControlPlaneDecision
} = require('../src/shared/agent-intent-control-plane.ts');
const {
  isSkuExecutionRequestText,
  isSkuTemplateDesignRequestText
} = require('../src/shared/sku-intent-params.ts');
const {
  buildDesignerAgentDecisionContract
} = require('../src/shared/designer-agent-decision-contract.ts');
const {
  fastDeterministicRoute,
  isSkuIntent
} = require('../src/renderer/services/agent-orchestration/routing.ts');
// SKU 模板设计移交归 Skill executor 所有；测试必须装载真实 executor 注册入口，
// 不能再依赖通用 skill-tools bridge 内的品类分支。
require('../src/renderer/services/skill-executors/index.ts');
const {
  executeSkillTool
} = require('../src/renderer/services/skill-executors/skill-tools.ts');

function assert(condition, message, detail) {
  if (!condition) {
    const error = new Error(message);
    if (detail !== undefined) error.detail = detail;
    throw error;
  }
}

function summarizeRoute(input) {
  const decision = buildAgentIntentControlPlaneDecision({ userInput: input });
  const route = fastDeterministicRoute(input);
  return {
    input,
    decision,
    route,
    isSkuIntent: isSkuIntent(input),
    isSkuExecutionRequest: isSkuExecutionRequestText(input),
    isSkuTemplateDesignRequest: isSkuTemplateDesignRequestText(input)
  };
}

async function main() {
  const templateDesign = summarizeRoute('基于我们项目中的 SKU 色卡素材创建一个排版模板，模板覆盖 2-3-4 双装组合以及对应自选备注。');
  assert(
    templateDesign.isSkuTemplateDesignRequest === true,
    'SKU template design request should be detected as design work.',
    templateDesign
  );
  assert(
    templateDesign.decision.requestKind === 'autonomous_execution',
    'SKU template design request should enter autonomous design instead of controlled batch execution.',
    templateDesign
  );
  assert(
    templateDesign.route === null || templateDesign.route?.skillId !== 'sku-batch',
    'SKU template design request must not deterministically route to sku-batch.',
    templateDesign
  );

  const genericTemplateFollowup = summarizeRoute('就是通用的SKU设计模板');
  assert(
    genericTemplateFollowup.isSkuTemplateDesignRequest === true,
    'Short generic SKU design-template follow-up should still be detected as template design work.',
    genericTemplateFollowup
  );
  assert(
    genericTemplateFollowup.decision.requestKind === 'autonomous_execution',
    'Short generic SKU design-template follow-up should stay autonomous instead of falling back to chat clarification.',
    genericTemplateFollowup
  );
  assert(
    genericTemplateFollowup.route === null || genericTemplateFollowup.route?.skillId !== 'sku-batch',
    'Short generic SKU design-template follow-up must not deterministically route to sku-batch.',
    genericTemplateFollowup
  );

  const templateDesignSkillToolResult = await executeSkillTool('sku-batch', {
    userIntent: templateDesign.input,
    comboSizes: [2, 3, 4],
    generateNotes: true
  }, {
    context: {
      userInput: templateDesign.input
    }
  });
  assert(
    templateDesignSkillToolResult.success === false
      && templateDesignSkillToolResult.data?.status === 'pending_sku_template_design_agent_decision',
    'Autonomous tool loop must hand SKU template design back to the Agent instead of executing sku-batch.',
    templateDesignSkillToolResult
  );
  assert(
    templateDesignSkillToolResult.data?.skuWorkflowStagePlan?.canEnterControlledBatchSkill === false,
    'The skill-tool handoff must preserve the SKU workflow stage plan for the Agent.',
    templateDesignSkillToolResult
  );
  // 评审修复 2026-07-03（F1 入口B）：Skill-owned 移交观察必须携带声明式任务类型 id，
  // 让自主循环包装器在移交时（首次 createDocument 之前）确定性激活设计纪律与参考先行门禁。
  assert(
    templateDesignSkillToolResult.data?.declaredDesignTaskTypeId === 'ecommerce.sku_template.v1',
    'The skill-tool handoff must carry declaredDesignTaskTypeId for deterministic discipline activation.',
    templateDesignSkillToolResult
  );

  const skuDesignerContract = buildDesignerAgentDecisionContract({
    userTask: templateDesign.input,
    scenario: 'sku',
    hasProjectVisualObservation: true
  });
  const skuDecisionOptionIds = skuDesignerContract.decisionOptions.map((item) => item.id);
  assert(
    skuDecisionOptionIds.includes('inspect_sku_resources')
      && skuDecisionOptionIds.includes('design_sku_template')
      && skuDecisionOptionIds.includes('confirm_sku_combos')
      && skuDecisionOptionIds.includes('run_sku_batch_production'),
    'SKU template design should expose multiple Agent-owned choices instead of a single script path.',
    { skuDecisionOptionIds, promptSection: skuDesignerContract.promptSection }
  );
  assert(
    skuDesignerContract.promptSection.includes('不是固定流程'),
    'Designer contract should explicitly say decision options are not a fixed flow.',
    skuDesignerContract.promptSection
  );

  const missingTemplateProduction = summarizeRoute('项目中存在 SKU 色卡素材，但是没有模板，需要做模板，规格是 2-3-4 双装以及自选备注，并生成对应组合图。');
  assert(
    missingTemplateProduction.decision.requestKind === 'autonomous_execution',
    'Mixed SKU production that includes missing-template design should enter autonomous design first.',
    missingTemplateProduction
  );
  assert(
    missingTemplateProduction.route === null || missingTemplateProduction.route?.skillId !== 'sku-batch',
    'Mixed SKU production with template creation should not let sku-batch auto-create a template.',
    missingTemplateProduction
  );

  const confirmedProduction = summarizeRoute('我已确认 SKU 组合：2双：1+2；3双：1+2+3；4双：1+2+3+4。请继续生成 SKU 组合图和自选备注。');
  assert(
    confirmedProduction.isSkuTemplateDesignRequest === false,
    'Confirmed SKU production should not be treated as template design.',
    confirmedProduction
  );
  assert(
    confirmedProduction.decision.requestKind === 'autonomous_execution'
      && confirmedProduction.decision.executionAuthorization === 'confirmed_tool_required',
    'Confirmed SKU production should enter Agent ReAct with confirmed execution authorization, not bypass Agent as direct skill execution.',
    confirmedProduction
  );
  assert(
    confirmedProduction.route?.skillId === 'sku-batch',
    'Confirmed SKU production should still route to sku-batch.',
    confirmedProduction
  );

  console.log(JSON.stringify({ ok: true }, null, 2));
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  if (error && error.detail !== undefined) {
    console.error(JSON.stringify(error.detail, null, 2));
  }
  process.exit(1);
});
