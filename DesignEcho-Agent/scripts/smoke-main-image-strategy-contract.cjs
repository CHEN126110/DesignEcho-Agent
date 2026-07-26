#!/usr/bin/env node

require('ts-node').register({
  transpileOnly: true,
  compilerOptions: {
    target: 'ES2020',
    module: 'CommonJS',
    moduleResolution: 'node',
    esModuleInterop: true,
    skipLibCheck: true
  }
});

const path = require('path');

const ROOT = path.resolve(__dirname, '..');

const {
  buildEcommerceSocksChildStrategyPacketSet
} = require(path.join(ROOT, 'src', 'shared', 'ecommerce-socks-child-strategy-packets.ts'));
const {
  buildEcommerceSocksChildStrategyReviewGate
} = require(path.join(ROOT, 'src', 'shared', 'ecommerce-socks-child-strategy-review-gate.ts'));
const {
  buildEcommerceSocksStrategyCheckpoint
} = require(path.join(ROOT, 'src', 'shared', 'ecommerce-socks-strategy-checkpoint.ts'));
const {
  buildMainImageAgentDraftPlan
} = require(path.join(ROOT, 'src', 'shared', 'main-image-agent-draft-plan.ts'));
const {
  buildMainImageStrategyContract
} = require(path.join(ROOT, 'src', 'shared', 'main-image-strategy-contract.ts'));

function assert(condition, message, details) {
  if (!condition) {
    const suffix = details ? `\n${JSON.stringify(details, null, 2)}` : '';
    throw new Error(`${message}${suffix}`);
  }
}

function assertNoRawPayload(value, label) {
  const serialized = JSON.stringify(value);
  const forbidden = ['raw-image-payload', 'base64-image-payload', 'data:image/'];
  const found = forbidden.filter((token) => serialized.includes(token));
  assert(found.length === 0, `${label} must not retain raw image-like payloads: ${found.join(', ')}`, value);
}

const readinessInputs = {
  designStandards: true,
  knowledgeRecipeSource: true,
  assetUnderstanding: true,
  imagePlacementPlan: true,
  photoshopToolPlan: true,
  qaAcceptancePlan: true,
  performanceBudget: true
};

const strategyInputs = {
  heroSubjectPolicy: true,
  assetSelectionPolicy: true,
  imagePlacementPolicy: true,
  smartScalingPolicy: true,
  copyRolePolicy: true,
  exportAcceptancePolicy: true,
  performanceBudget: true
};

function buildReviewGate(overrides = {}) {
  const checkpoint = buildEcommerceSocksStrategyCheckpoint({
    userCheckpointConfirmed: true,
    deliverables: ['main-image', 'detail-page', 'sku'],
    strategyInputsBySkill: {
      'main-image-design': readinessInputs,
      'detail-page-design': readinessInputs,
      'sku-batch': readinessInputs
    }
  });
  const packetSet = buildEcommerceSocksChildStrategyPacketSet({ strategyCheckpoint: checkpoint });
  return buildEcommerceSocksChildStrategyReviewGate({
    packetSet,
    userReviewedStrategyPackets: true,
    acknowledgedStrategyBoundaries: true,
    approvedSkillIds: ['main-image-design', 'detail-page-design', 'sku-batch'],
    ...overrides
  });
}

const readyDraftInput = {
  userText: '帮我做一张袜子主图',
  imageType: 'click',
  currentDocument: { id: 1, name: 'SKU.psb', width: 1200, height: 1200 },
  subjectBounds: { left: 180, top: 160, right: 930, bottom: 980, width: 750, height: 820 },
  sizePlans: [{
    sizeKey: '800',
    targetSize: { width: 800, height: 800 },
    subjectSize: { width: 750, height: 820 },
    scale: 0.68,
    targetX: 112,
    targetY: 96,
    decisionReason: 'main image guideline scale 68%',
    layoutCandidateScore: 83,
    layoutCandidateReason: 'subject centered',
    smartLayoutPlanned: true,
    quickExportPlanned: true
  }],
  copyCandidates: ['轻薄透气，春夏出行更自在'],
  outputDir: 'C:/Exports',
  toolNames: ['getDocumentInfo', 'getSubjectBounds', 'smartLayout[800]', 'quickExport[800]']
};

async function run() {
  const noGate = buildMainImageStrategyContract({
    userIntent: '帮我做主图',
    parentReviewGate: null,
    strategyInputs
  });
  assert(noGate.status === 'blocked_missing_parent_review_gate', 'missing parent review gate should block main-image strategy', noGate);
  assert(noGate.canModifyMainImageStrategy === false, 'missing gate must not allow strategy changes', noGate);

  const deniedGate = buildReviewGate({ deniedSkillIds: ['main-image-design'] });
  const deniedContract = buildMainImageStrategyContract({
    userIntent: '帮我做主图',
    parentReviewGate: deniedGate,
    strategyInputs
  });
  assert(deniedContract.status === 'blocked_parent_review_not_approved', 'denied parent gate should block main-image strategy', deniedContract);
  assert(deniedContract.parentGateStatus === 'rejected_by_user', 'parent gate status should be preserved', deniedContract);

  const missingInputContract = buildMainImageStrategyContract({
    userIntent: '帮我做主图',
    parentReviewGate: buildReviewGate(),
    strategyInputs: {
      ...strategyInputs,
      smartScalingPolicy: false,
      exportAcceptancePolicy: 'raw-image-payload'
    }
  });
  assert(missingInputContract.status === 'blocked_missing_strategy_inputs', 'missing strategy inputs should block main-image strategy', missingInputContract);
  assert(missingInputContract.missingInputs.includes('smartScalingPolicy'), 'missing smartScalingPolicy should be explicit', missingInputContract);
  assert(missingInputContract.missingInputs.includes('exportAcceptancePolicy'), 'unsafe raw payload input should not count as provided', missingInputContract);
  assertNoRawPayload(missingInputContract, 'missing input contract');

  const readyContract = buildMainImageStrategyContract({
    userIntent: '帮我做主图',
    parentReviewGate: buildReviewGate(),
    strategyInputs
  });
  assert(readyContract.status === 'ready_for_main_image_strategy_design', 'ready contract should allow strategy design', readyContract);
  assert(readyContract.canModifyMainImageStrategy === true, 'ready contract can modify main-image strategy');
  assert(readyContract.canClaimOutputQuality === false, 'ready contract cannot claim output quality');
  assert(readyContract.noPhotoshopWrites === true, 'ready contract must not write Photoshop');
  assert(readyContract.requiredDecisions.includes('hero_subject_selection'), 'main-image strategy must require hero subject selection');
  assert(readyContract.requiredDecisions.includes('image_placement_and_smart_scaling'), 'main-image strategy must require smart scaling');

  const draft = buildMainImageAgentDraftPlan({
    ...readyDraftInput,
    strategyReviewGate: buildReviewGate(),
    strategyInputs
  });
  assert(draft.mainImageStrategyContract.version === 'main-image-strategy-contract/v0', 'agent draft should expose main-image strategy contract', draft);
  assert(draft.mainImageStrategyContract.status === 'ready_for_main_image_strategy_design', 'agent draft should carry ready strategy contract', draft.mainImageStrategyContract);
  assert(draft.mainImageStrategyContract.canClaimOutputQuality === false, 'agent draft strategy contract must not claim output quality', draft.mainImageStrategyContract);
  assertNoRawPayload(draft.mainImageStrategyContract, 'agent draft main-image strategy contract');

  console.log(JSON.stringify({
    success: true,
    checks: [
      'main-image strategy contract blocks without parent review gate',
      'main-image strategy contract blocks when parent review rejected or not approved',
      'main-image strategy contract requires concrete strategy inputs',
      'ready strategy contract still cannot write Photoshop or claim output quality',
      'mainImageAgentDraft exposes the strategy contract as read-only context'
    ]
  }, null, 2));
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
