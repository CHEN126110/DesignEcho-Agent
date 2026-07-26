#!/usr/bin/env node

const path = require('path');

require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '..', 'tsconfig.main.json')
});

const {
  BUSINESS_SKILL_READINESS_CONTRACT_REQUIRED_INPUTS,
  buildBusinessSkillReadinessContract
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'business-skill-readiness-contract.ts'));

function assert(condition, message, details) {
  if (!condition) {
    const suffix = details ? `\n${JSON.stringify(details, null, 2)}` : '';
    throw new Error(`${message}${suffix}`);
  }
}

function assertNoRawPayload(value, label) {
  const serialized = JSON.stringify(value);
  assert(!serialized.includes('raw-image-payload'), `${label} must not retain raw image payload`, value);
  assert(!serialized.includes('base64-image-payload'), `${label} must not retain base64 image payload`, value);
  assert(!serialized.includes('data:image/'), `${label} must not retain data URLs`, value);
}

const required = BUSINESS_SKILL_READINESS_CONTRACT_REQUIRED_INPUTS;
assert(required.includes('designStandards'), 'required inputs must include design standards', required);
assert(required.includes('knowledgeRecipeSource'), 'required inputs must include knowledge or recipe source', required);
assert(required.includes('assetUnderstanding'), 'required inputs must include asset understanding', required);
assert(required.includes('imagePlacementPlan'), 'required inputs must include image placement/smart scaling plan', required);
assert(required.includes('photoshopToolPlan'), 'required inputs must include Photoshop tool plan', required);
assert(required.includes('qaAcceptancePlan'), 'required inputs must include QA acceptance plan', required);
assert(required.includes('performanceBudget'), 'required inputs must include performance budget', required);

const blocked = buildBusinessSkillReadinessContract({
  skillId: 'main-image-design',
  userCheckpointConfirmed: false,
  strategyInputs: {
    designStandards: true,
    knowledgeRecipeSource: false,
    assetUnderstanding: false,
    imagePlacementPlan: false,
    photoshopToolPlan: false,
    qaAcceptancePlan: false,
    performanceBudget: false,
    rawReferenceImage: 'raw-image-payload',
    dataUrl: 'data:image/png;base64,base64-image-payload'
  },
  riskFlags: {
    fexBenchmarkOnly: true,
    toolOnlyPanelFeature: true
  }
});

assert(blocked.version === 'business-skill-readiness-contract/v0', 'version must be stable', blocked);
assert(blocked.status === 'blocked_missing_user_checkpoint', 'missing user checkpoint should block first', blocked);
assert(blocked.canModifyBusinessStrategy === false, 'blocked readiness must not allow strategy modification', blocked);
assert(blocked.canClaimDesignQuality === false, 'readiness contract must not claim design quality', blocked);
assert(blocked.missingInputs.includes('assetUnderstanding'), 'blocked readiness must require asset understanding', blocked);
assert(blocked.missingInputs.includes('imagePlacementPlan'), 'blocked readiness must require image placement plan', blocked);
assert(blocked.implementationCheckpoint?.status === 'blocked_needs_user_checkpoint', 'readiness should reuse implementation checkpoint', blocked);
assert(blocked.warnings.includes('fex_benchmark_does_not_establish_business_strategy_readiness'), 'FEX-only warning must survive', blocked);
assert(blocked.warnings.includes('tool_only_panel_feature_does_not_establish_agent_skill_strategy_readiness'), 'panel-only warning must survive', blocked);
assert(blocked.boundaries.includes('This readiness contract does not change Photoshop write order.'), 'must preserve no-write boundary', blocked);
assertNoRawPayload(blocked, 'blocked readiness');

const missingInputs = buildBusinessSkillReadinessContract({
  skillId: 'detail-page-design',
  userCheckpointConfirmed: true,
  strategyInputs: {
    designStandards: true,
    knowledgeRecipeSource: true,
    assetUnderstanding: true,
    imagePlacementPlan: false,
    photoshopToolPlan: true,
    qaAcceptancePlan: true,
    performanceBudget: true
  }
});

assert(missingInputs.status === 'blocked_missing_strategy_inputs', 'missing placement plan should block strategy readiness', missingInputs);
assert(missingInputs.missingInputs.join(',') === 'imagePlacementPlan', 'only placement plan should be missing', missingInputs);
assert(missingInputs.canModifyBusinessStrategy === false, 'missing one input still cannot modify strategy', missingInputs);

const ready = buildBusinessSkillReadinessContract({
  skillId: 'sku-batch',
  userCheckpointConfirmed: true,
  strategyInputs: {
    designStandards: true,
    knowledgeRecipeSource: true,
    assetUnderstanding: true,
    imagePlacementPlan: true,
    photoshopToolPlan: true,
    qaAcceptancePlan: true,
    performanceBudget: true
  }
});

assert(ready.status === 'ready_for_strategy_design', 'all inputs and checkpoint should make strategy ready', ready);
assert(ready.canModifyBusinessStrategy === true, 'ready contract can modify strategy', ready);
assert(ready.canClaimDesignQuality === false, 'ready contract still cannot claim design quality', ready);
assert(ready.missingInputs.length === 0, 'ready contract should have no missing inputs', ready);
assert(ready.implementationCheckpoint?.canChangeBusinessStrategy === true, 'implementation checkpoint should agree with ready contract', ready);
assert(ready.requiredOutputs.includes('DesignBrief'), 'strategy readiness should require DesignBrief output', ready);
assert(ready.requiredOutputs.includes('VerificationReport'), 'strategy readiness should require VerificationReport output', ready);
assertNoRawPayload(ready, 'ready readiness');

console.log(JSON.stringify({
  success: true,
  requiredInputs: required,
  checkedStatuses: [blocked.status, missingInputs.status, ready.status],
  checks: [
    'requires user checkpoint before business strategy changes',
    'requires design standards, knowledge, asset understanding, placement, Photoshop plan, QA and performance budget',
    'reuses existing implementation checkpoint instead of creating a competing gate',
    'rejects FEX-only and UXP-panel-only evidence as strategy evidence',
    'redacts raw image-like payloads and does not change Photoshop behavior'
  ]
}, null, 2));
