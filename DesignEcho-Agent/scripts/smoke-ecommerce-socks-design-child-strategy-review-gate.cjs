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
  getSkillExecutor
} = require(path.join(ROOT, 'src', 'renderer', 'services', 'skill-executors', 'index.ts'));

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

const allInputsReady = {
  designStandards: true,
  knowledgeRecipeSource: true,
  assetUnderstanding: true,
  imagePlacementPlan: true,
  photoshopToolPlan: true,
  qaAcceptancePlan: true,
  performanceBudget: true
};

function buildPacketSet(userCheckpointConfirmed) {
  const checkpoint = buildEcommerceSocksStrategyCheckpoint({
    userCheckpointConfirmed,
    deliverables: ['main-image', 'detail-page', 'sku'],
    strategyInputsBySkill: {
      'main-image-design': allInputsReady,
      'detail-page-design': allInputsReady,
      'sku-batch': allInputsReady
    }
  });
  return buildEcommerceSocksChildStrategyPacketSet({
    strategyCheckpoint: checkpoint
  });
}

async function run() {
  const blockedGate = buildEcommerceSocksChildStrategyReviewGate({
    packetSet: buildPacketSet(false),
    userReviewedStrategyPackets: true,
    acknowledgedStrategyBoundaries: true,
    approvedSkillIds: ['main-image-design', 'detail-page-design', 'sku-batch']
  });

  assert(blockedGate.version === 'ecommerce-socks-child-strategy-review-gate/v0', 'review gate version must be stable', blockedGate);
  assert(blockedGate.status === 'blocked_packet_set_not_ready', 'blocked packet set should block strategy review gate', blockedGate);
  assert(blockedGate.canStartChildStrategyDesign === false, 'blocked review gate cannot start child strategy design', blockedGate);
  assert(blockedGate.blockers.includes('packet_set_not_ready'), 'blocked review gate should report packet_set_not_ready', blockedGate);

  const awaitingReviewGate = buildEcommerceSocksChildStrategyReviewGate({
    packetSet: buildPacketSet(true)
  });

  assert(awaitingReviewGate.status === 'awaiting_user_strategy_review', 'ready packets should still wait for user review', awaitingReviewGate);
  assert(awaitingReviewGate.missingSkillApprovals.length === 3, 'all three child skill approvals should be missing', awaitingReviewGate);
  assert(awaitingReviewGate.canStartChildStrategyDesign === false, 'review is required before strategy design can start', awaitingReviewGate);

  const awaitingBoundaryGate = buildEcommerceSocksChildStrategyReviewGate({
    packetSet: buildPacketSet(true),
    userReviewedStrategyPackets: true,
    approvedSkillIds: ['main-image-design', 'detail-page-design', 'sku-batch']
  });

  assert(awaitingBoundaryGate.status === 'awaiting_boundary_acknowledgement', 'boundary acknowledgement should be required', awaitingBoundaryGate);
  assert(awaitingBoundaryGate.blockers.includes('boundary_acknowledgement_missing'), 'missing boundary acknowledgement should be explicit', awaitingBoundaryGate);

  const deniedGate = buildEcommerceSocksChildStrategyReviewGate({
    packetSet: buildPacketSet(true),
    userReviewedStrategyPackets: true,
    acknowledgedStrategyBoundaries: true,
    deniedSkillIds: ['detail-page-design'],
    approvedSkillIds: ['main-image-design', 'sku-batch']
  });

  assert(deniedGate.status === 'rejected_by_user', 'user denial should reject strategy gate', deniedGate);
  assert(deniedGate.canStartChildStrategyDesign === false, 'denied gate cannot start strategy design', deniedGate);

  const approvedGate = buildEcommerceSocksChildStrategyReviewGate({
    packetSet: buildPacketSet(true),
    userReviewedStrategyPackets: true,
    acknowledgedStrategyBoundaries: true,
    approvedSkillIds: ['main-image-design', 'detail-page-design', 'sku-batch']
  });

  assert(approvedGate.status === 'approved_for_child_strategy_design', 'all confirmations should approve child strategy design', approvedGate);
  assert(approvedGate.canStartChildStrategyDesign === true, 'approved gate can start child strategy design', approvedGate);
  assert(approvedGate.canClaimDesignComplete === false, 'approved gate cannot claim design completion', approvedGate);
  assert(approvedGate.noPhotoshopWrites === true, 'approved gate must not write Photoshop', approvedGate);
  assert(approvedGate.requiredDecisionCount === 9, 'three packets should require nine strategy decisions', approvedGate);
  assertNoRawPayload(approvedGate, 'approved review gate');

  const executor = getSkillExecutor('ecommerce-socks-design');
  assert(executor, 'ecommerce-socks-design executor should be registered');

  const result = await executor.execute({
    params: {
      userIntent: '帮我做一整套袜子电商设计',
      deliverables: ['main-image', 'detail-page', 'sku'],
      userCheckpointConfirmed: true,
      userReviewedChildStrategyPackets: true,
      acknowledgeChildStrategyBoundaries: true,
      approvedChildStrategySkills: ['main-image-design', 'detail-page-design', 'sku-batch'],
      strategyInputsBySkill: {
        'main-image-design': allInputsReady,
        'detail-page-design': allInputsReady,
        'sku-batch': allInputsReady
      }
    },
    callbacks: {
      onStep: () => undefined,
      onMessage: () => undefined,
      onProgress: () => undefined
    },
    context: {
      userInput: '帮我做一整套袜子电商设计',
      isPluginConnected: true,
      conversationHistory: [],
      projectContext: {
        projectPath: 'D:/demo/socks-project',
        projectImageCount: 12
      },
      photoshopContext: {
        hasDocument: true,
        documentName: 'SKU.psb'
      }
    }
  });

  assert(
    result.data?.ecommerceSocksChildStrategyReviewGate?.version === 'ecommerce-socks-child-strategy-review-gate/v0',
    'executor should expose child strategy review gate evidence',
    result.data
  );
  assert(
    result.data.ecommerceSocksDesign.childStrategyReviewGate === result.data.ecommerceSocksChildStrategyReviewGate,
    'entry evidence should reference the same child strategy review gate',
    result.data
  );
  assert(
    result.data.ecommerceSocksChildStrategyReviewGate.canStartChildStrategyDesign === true,
    'executor review gate should allow strategy design only after explicit review approval',
    result.data.ecommerceSocksChildStrategyReviewGate
  );
  assert(
    result.data.ecommerceSocksChildStrategyReviewGate.canClaimDesignComplete === false,
    'executor review gate must not claim design completion',
    result.data.ecommerceSocksChildStrategyReviewGate
  );
  assertNoRawPayload(result.data.ecommerceSocksChildStrategyReviewGate, 'executor child strategy review gate');

  console.log(JSON.stringify({
    success: true,
    checks: [
      'review gate blocks when child strategy packet set is not ready',
      'review gate requires explicit user review and boundary acknowledgement',
      'review gate requires per-child strategy approval',
      'approved review gate still cannot claim design completion or write Photoshop',
      'executor exposes review gate evidence without changing child skill strategy'
    ]
  }, null, 2));
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
