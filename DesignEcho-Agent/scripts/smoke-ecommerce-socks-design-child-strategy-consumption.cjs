#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '..', 'tsconfig.main.json')
});

const repoRoot = path.resolve(__dirname, '..');
const localStorageData = new Map();
global.localStorage = {
  getItem: (key) => localStorageData.has(key) ? localStorageData.get(key) : null,
  setItem: (key, value) => localStorageData.set(key, String(value)),
  removeItem: (key) => localStorageData.delete(key),
  clear: () => localStorageData.clear()
};

const {
  buildEcommerceSocksStrategyCheckpoint
} = require(path.join(repoRoot, 'src', 'shared', 'ecommerce-socks-strategy-checkpoint.ts'));
const {
  buildEcommerceSocksChildStrategyPacketSet
} = require(path.join(repoRoot, 'src', 'shared', 'ecommerce-socks-child-strategy-packets.ts'));
const {
  buildEcommerceSocksChildStrategyReviewGate
} = require(path.join(repoRoot, 'src', 'shared', 'ecommerce-socks-child-strategy-review-gate.ts'));
const {
  buildEcommerceSocksChildStrategyHandoff
} = require(path.join(repoRoot, 'src', 'shared', 'ecommerce-socks-child-strategy-handoff.ts'));
const {
  buildEcommerceSocksChildStrategyInput
} = require(path.join(repoRoot, 'src', 'shared', 'ecommerce-socks-child-strategy-consumer.ts'));
const {
  buildMainImageAgentDraftPlan
} = require(path.join(repoRoot, 'src', 'shared', 'main-image-agent-draft-plan.ts'));
const {
  buildDetailPagePlannerContext,
  buildSkuBatchPlannerContext
} = require(path.join(repoRoot, 'src', 'renderer', 'services', 'skill-executors', 'design-planner-context.ts'));

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function assert(condition, message, details) {
  if (!condition) {
    const suffix = details ? `\n${JSON.stringify(details, null, 2)}` : '';
    throw new Error(`${message}${suffix}`);
  }
}

function assertNoUnsafePayload(value, label) {
  const serialized = JSON.stringify(value || {});
  const forbidden = [
    'raw-image-payload',
    'base64-image-payload',
    'data:image/',
    '<tool_call',
    'direct_response',
    'clarification_needed',
    'needs_model_design_decision',
    'C:\\\\',
    'D:\\\\',
    'D:/'
  ];
  const found = forbidden.filter((token) => serialized.includes(token));
  assert(found.length === 0, `${label} should not expose unsafe payload markers: ${found.join(', ')}`, value);
}

const allInputsReady = {
  designStandards: true,
  knowledgeRecipeSource: true,
  assetUnderstanding: true,
  imagePlacementPlan: true,
  photoshopToolPlan: true,
  qaAcceptancePlan: true,
  performanceBudget: true
};

function buildApprovedFixture() {
  const checkpoint = buildEcommerceSocksStrategyCheckpoint({
    userCheckpointConfirmed: true,
    deliverables: ['main-image', 'detail-page', 'sku'],
    strategyInputsBySkill: {
      'main-image-design': allInputsReady,
      'detail-page-design': allInputsReady,
      'sku-batch': allInputsReady
    }
  });
  const packetSet = buildEcommerceSocksChildStrategyPacketSet({ strategyCheckpoint: checkpoint });
  const reviewGate = buildEcommerceSocksChildStrategyReviewGate({
    packetSet,
    userReviewedStrategyPackets: true,
    acknowledgedStrategyBoundaries: true,
    approvedSkillIds: ['main-image-design', 'detail-page-design', 'sku-batch']
  });
  const handoff = buildEcommerceSocksChildStrategyHandoff({
    packetSet,
    reviewGate,
    userIntent: '帮我做一整套袜子电商设计 direct_response',
    projectPath: 'D:/DesignEchoDemo/C-1163',
    memoryStrategy: {
      version: 'business-skill-memory-strategy/v0',
      status: 'ready_for_strategy_review',
      summary: '用户偏好干净、柔和阴影、适合袜子转化图。',
      rawPayload: 'data:image/png;base64,unsafe'
    }
  });
  return { handoff, reviewGate };
}

function buildPlannerContext() {
  return {
    userInput: '帮我做一整套袜子电商设计',
    photoshopContext: {
      hasDocument: true,
      documentName: 'SKU.psb',
      canvasSize: { width: 1440, height: 1440 }
    },
    projectContext: {
      projectPath: 'D:/DesignEchoDemo/C-1163',
      sampleImagePaths: ['D:/DesignEchoDemo/C-1163/素材/白色.jpg']
    }
  };
}

function run() {
  const { handoff, reviewGate } = buildApprovedFixture();

  const blockedInput = buildEcommerceSocksChildStrategyInput({
    handoff: null,
    skillId: 'main-image-design',
    expectedScenario: 'main-image'
  });
  assert(blockedInput.status === 'missing_parent_handoff', 'missing handoff should be explicit', blockedInput);
  assert(blockedInput.canUseAsChildStrategyInput === false, 'missing handoff cannot be consumed', blockedInput);

  const mainInput = buildEcommerceSocksChildStrategyInput({
    handoff,
    skillId: 'main-image-design',
    expectedScenario: 'main-image'
  });
  assert(mainInput.status === 'ready_for_child_planner', 'main-image child input should be ready', mainInput);
  assert(mainInput.strategyInputPatch.scenario === 'main-image', 'main-image child input should keep scenario patch', mainInput);
  assert(mainInput.strategyInputsPatch.heroSubjectPolicy, 'main-image child input should map hero subject policy', mainInput);
  assert(mainInput.strategyInputsPatch.imagePlacementPolicy?.requiresSmartScaling === true, 'main-image child input should map placement policy', mainInput.strategyInputsPatch);
  assert(mainInput.strategyInputsPatch.copyRolePolicy?.mustUseProjectContextForCopy === true, 'main-image child input should require project-context copy policy', mainInput.strategyInputsPatch);
  assert(mainInput.strategyInputsPatch.copyRolePolicy?.mustUseSupportedSellingPoints === true, 'main-image child input should reject unsupported selling points', mainInput.strategyInputsPatch);
  assert(mainInput.strategyInputsPatch.performanceBudget?.source === 'ecommerce-socks-parent-handoff', 'main-image child input should provide performance budget strategy', mainInput.strategyInputsPatch);
  assertNoUnsafePayload(mainInput, 'main-image child strategy input');

  const draft = buildMainImageAgentDraftPlan({
    userText: '帮我做主图',
    imageType: 'click',
    projectAssets: [],
    subjectBounds: null,
    sizePlans: [],
    strategyReviewGate: reviewGate,
    ecommerceSocksChildStrategyInput: mainInput,
    strategyInputs: mainInput.strategyInputsPatch
  });
  assert(draft.ecommerceSocksChildStrategyInput === mainInput, 'main-image draft should expose consumed ecommerce socks child input', draft);
  assert(
    draft.mainImageStrategyContract.status === 'ready_for_main_image_strategy_design',
    'main-image strategy contract should consume parent handoff strategy inputs without executing Photoshop',
    draft.mainImageStrategyContract
  );
  assert(draft.mainImageStrategyContract.noPhotoshopWrites === true, 'main-image contract must remain readonly', draft.mainImageStrategyContract);

  const detailPlanner = buildDetailPagePlannerContext({
    userInput: '帮我做详情页',
    params: { ecommerceSocksChildStrategyHandoff: handoff },
    context: buildPlannerContext(),
    projectPath: 'D:/DesignEchoDemo/C-1163',
    screenCount: 5,
    mode: 'inspect',
    readinessMode: 'needs_review',
    screenPlanCount: 5
  });
  assert(
    detailPlanner.ecommerceSocksChildStrategyInput.status === 'ready_for_child_planner',
    'detail-page planner should consume ecommerce socks handoff',
    detailPlanner.ecommerceSocksChildStrategyInput
  );
  assert(
    detailPlanner.ecommerceSocksChildStrategyInput.strategyInputsPatch.screenStorylinePolicy?.required === true,
    'detail-page child input should expose storyline policy',
    detailPlanner.ecommerceSocksChildStrategyInput
  );
  assertNoUnsafePayload(detailPlanner.ecommerceSocksChildStrategyInput, 'detail-page child strategy input');

  const skuPlanner = buildSkuBatchPlannerContext({
    userInput: '帮我做 SKU',
    params: { ecommerceSocksChildStrategyHandoff: handoff },
    context: buildPlannerContext(),
    projectPath: 'D:/DesignEchoDemo/C-1163',
    comboSizes: [2, 3, 4],
    colorCount: 5,
    totalCombinations: 16,
    processedSizeCount: 0
  });
  assert(
    skuPlanner.ecommerceSocksChildStrategyInput.status === 'ready_for_child_planner',
    'SKU planner should consume ecommerce socks handoff',
    skuPlanner.ecommerceSocksChildStrategyInput
  );
  assert(
    skuPlanner.ecommerceSocksChildStrategyInput.strategyInputsPatch.combinationPolicy?.includeSelfSelectNotesByDefault === true,
    'SKU child input should preserve self-select note default',
    skuPlanner.ecommerceSocksChildStrategyInput
  );
  assert(
    skuPlanner.ecommerceSocksChildStrategyInput.strategyInputsPatch.sourcePolicy?.preferProjectSkuPsdOrPsb === true,
    'SKU child input should preserve project-first source policy',
    skuPlanner.ecommerceSocksChildStrategyInput
  );
  assertNoUnsafePayload(skuPlanner.ecommerceSocksChildStrategyInput, 'SKU child strategy input');

  const plannerSource = read('src/renderer/services/skill-executors/design-planner-context.ts');
  assert(plannerSource.includes('buildEcommerceSocksChildStrategyInput'), 'planner evidence should build child strategy input from parent handoff');
  assert(!plannerSource.includes('executeToolCall('), 'planner evidence helper must not execute Photoshop tools');

  const mainImageSource = read('src/renderer/services/skill-executors/main-image.executor.ts');
  assert(mainImageSource.includes('ecommerceSocksChildStrategyInput'), 'main-image executor should expose consumed child strategy input');
  const detailSource = read('src/renderer/services/skill-executors/detail-page.executor.ts');
  assert(detailSource.includes('ecommerceSocksChildStrategyInput'), 'detail-page executor should expose consumed child strategy input');
  const skuSource = read('src/renderer/services/skill-executors/sku-batch.executor.ts');
  assert(skuSource.includes('ecommerceSocksChildStrategyInput'), 'SKU executor should expose consumed child strategy input');

  const packageJson = JSON.parse(read('package.json'));
  assert(packageJson.scripts['smoke:ecommerce-socks-design:child-strategy-consumption'], 'package script should expose child strategy consumption smoke');

  console.log(JSON.stringify({
    success: true,
    checks: [
      'child strategy consumption blocks missing parent handoff explicitly',
      'main-image child planner maps approved parent handoff into strategy contract inputs',
      'detail-page child planner consumes screen storyline and QA strategy input',
      'SKU child planner consumes combination, self-select note and project-source strategy input',
      'child strategy consumption remains readonly, redacted and wired into package/scripts'
    ]
  }, null, 2));
}

run();
