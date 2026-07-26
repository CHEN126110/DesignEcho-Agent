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
  buildSkuWorkflowStagePlan
} = require('../src/shared/sku-workflow-stages.ts');
const {
  buildAgentIntentControlPlaneDecision
} = require('../src/shared/agent-intent-control-plane.ts');
const {
  fastDeterministicRoute
} = require('../src/renderer/services/agent-orchestration/routing.ts');

function assert(condition, message, detail) {
  if (!condition) {
    const error = new Error(message);
    if (detail !== undefined) error.detail = detail;
    throw error;
  }
}

function ids(plan) {
  return plan.stages.map((stage) => stage.id);
}

function assertStageOrder(plan, expectedIds, message) {
  const actualIds = ids(plan);
  assert(
    JSON.stringify(actualIds) === JSON.stringify(expectedIds),
    message,
    { actualIds, expectedIds, plan }
  );
}

function main() {
  const templateRequest = '基于我们项目中的 SKU 色卡素材创建一个排版模板，模板覆盖 2-3-4 双装组合以及对应自选备注。';
  const templatePlan = buildSkuWorkflowStagePlan({
    userInput: templateRequest,
    hasExistingSkuSource: true
  });
  assertStageOrder(
    templatePlan,
    ['inspect_existing_resources', 'design_template', 'confirm_combos'],
    'SKU template request should inspect existing resources, design the template, then confirm combos before production.'
  );
  assert(
    templatePlan.canEnterControlledBatchSkill === false,
    'Template design must not enter controlled batch production before Agent observes the template and combos are confirmed.',
    templatePlan
  );
  assert(
    templatePlan.requiresAgentDecisionBeforeNextStage === true,
    'Template design should require an Agent decision before moving to the next stage.',
    templatePlan
  );
  assert(
    buildSkuWorkflowStagePlan({
      userInput: '先让他基于我们项目中的SKU色卡素材进行创建一个排版模板，模板2-3-4的组合以及对应的自选'
    }).shouldReuseExistingSkuSource === true,
    'SKU stage planner should understand "基于我们项目中的SKU色卡素材" as existing-source reuse.',
    buildSkuWorkflowStagePlan({
      userInput: '先让他基于我们项目中的SKU色卡素材进行创建一个排版模板，模板2-3-4的组合以及对应的自选'
    })
  );
  assert(
    buildAgentIntentControlPlaneDecision({ userInput: templateRequest }).requestKind === 'autonomous_execution',
    'Template design should route to autonomous Agent thinking, not deterministic sku-batch.',
    buildAgentIntentControlPlaneDecision({ userInput: templateRequest })
  );
  assert(
    !fastDeterministicRoute(templateRequest),
    'Template design should not get a deterministic sku-batch route.',
    fastDeterministicRoute(templateRequest)
  );

  const mixedRequest = '项目中存在 SKU 色卡素材，但是没有模板，需要做模板，规格是 2-3-4 双装以及自选备注，并生成对应组合图。';
  const mixedPlan = buildSkuWorkflowStagePlan({ userInput: mixedRequest, hasExistingSkuSource: true });
  assertStageOrder(
    mixedPlan,
    ['inspect_existing_resources', 'design_template', 'confirm_combos'],
    'A mixed request that still lacks a template must stop at design and combo confirmation before batch production.'
  );
  assert(
    mixedPlan.canEnterControlledBatchSkill === false,
    'Missing-template SKU requests must not run batch production in the same decision step.',
    mixedPlan
  );

  const confirmedRequest = '我已确认 SKU 组合：2双：1+2；3双：1+2+3；4双：1+2+3+4。请继续生成 SKU 组合图和自选备注。';
  const confirmedPlan = buildSkuWorkflowStagePlan({
    userInput: confirmedRequest,
    hasExistingSkuSource: true,
    hasConfirmedCombos: true
  });
  assertStageOrder(
    confirmedPlan,
    ['inspect_existing_resources', 'batch_production'],
    'Confirmed SKU production should inspect the real source once, then enter controlled batch production.'
  );
  assert(
    confirmedPlan.canEnterControlledBatchSkill === true,
    'Confirmed combinations may enter controlled batch production.',
    confirmedPlan
  );
  assert(
    buildAgentIntentControlPlaneDecision({ userInput: confirmedRequest }).requestKind === 'autonomous_execution',
    'Confirmed SKU production should enter the autonomous Agent loop; sku-batch remains a controlled workflow bridge inside ReAct.',
    buildAgentIntentControlPlaneDecision({ userInput: confirmedRequest })
  );
  assert(
    fastDeterministicRoute(confirmedRequest)?.skillId === 'sku-batch',
    'Confirmed SKU production should still expose sku-batch as the deterministic capability hint for the ReAct loop.',
    fastDeterministicRoute(confirmedRequest)
  );

  console.log('[smoke-sku-main-workflow-stages] passed');
}

try {
  main();
} catch (error) {
  console.error(error && error.stack ? error.stack : String(error));
  if (error && error.detail !== undefined) {
    console.error(JSON.stringify(error.detail, null, 2));
  }
  process.exit(1);
}
