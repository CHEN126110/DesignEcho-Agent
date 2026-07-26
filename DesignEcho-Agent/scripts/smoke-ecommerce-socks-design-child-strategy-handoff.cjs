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
  buildEcommerceSocksStrategyCheckpoint
} = require(path.join(ROOT, 'src', 'shared', 'ecommerce-socks-strategy-checkpoint.ts'));
const {
  buildEcommerceSocksChildStrategyPacketSet
} = require(path.join(ROOT, 'src', 'shared', 'ecommerce-socks-child-strategy-packets.ts'));
const {
  buildEcommerceSocksChildStrategyReviewGate
} = require(path.join(ROOT, 'src', 'shared', 'ecommerce-socks-child-strategy-review-gate.ts'));
const {
  buildEcommerceSocksChildStrategyHandoff
} = require(path.join(ROOT, 'src', 'shared', 'ecommerce-socks-child-strategy-handoff.ts'));
const {
  getSkillExecutor
} = require(path.join(ROOT, 'src', 'renderer', 'services', 'skill-executors', 'index.ts'));

function assert(condition, message, details) {
  if (!condition) {
    const suffix = details ? `\n${JSON.stringify(details, null, 2)}` : '';
    throw new Error(`${message}${suffix}`);
  }
}

function assertNoUnsafePayload(value, label) {
  const serialized = JSON.stringify(value);
  const forbidden = [
    'raw-image-payload',
    'base64-image-payload',
    'data:image/',
    '<tool_call',
    'needs_model_design_decision',
    'direct_response',
    'clarification_needed'
  ];
  const found = forbidden.filter((token) => serialized.includes(token));
  assert(found.length === 0, `${label} must not expose unsafe payload markers: ${found.join(', ')}`, value);
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

function buildReadyPacketSet() {
  const checkpoint = buildEcommerceSocksStrategyCheckpoint({
    userCheckpointConfirmed: true,
    deliverables: ['main-image', 'detail-page', 'sku'],
    strategyInputsBySkill: {
      'main-image-design': {
        ...allInputsReady,
        rawReferenceImage: 'raw-image-payload'
      },
      'detail-page-design': allInputsReady,
      'sku-batch': allInputsReady
    }
  });
  return buildEcommerceSocksChildStrategyPacketSet({ strategyCheckpoint: checkpoint });
}

async function run() {
  const packetSet = buildReadyPacketSet();
  const blockedGate = buildEcommerceSocksChildStrategyReviewGate({ packetSet });
  const blockedHandoff = buildEcommerceSocksChildStrategyHandoff({
    packetSet,
    reviewGate: blockedGate,
    userIntent: '帮我做一整套袜子电商设计'
  });

  assert(blockedHandoff.version === 'ecommerce-socks-child-strategy-handoff/v0', 'handoff version must be stable', blockedHandoff);
  assert(blockedHandoff.status === 'blocked_by_review_gate', 'handoff must block before user strategy review approval', blockedHandoff);
  assert(blockedHandoff.canUseAsChildStrategyInput === false, 'blocked handoff cannot be consumed by child skills', blockedHandoff);
  assert(blockedHandoff.mustNotExecuteChildSkills === true, 'handoff must not execute child skills', blockedHandoff);
  assert(blockedHandoff.noPhotoshopWrites === true, 'handoff must not write Photoshop', blockedHandoff);

  const approvedGate = buildEcommerceSocksChildStrategyReviewGate({
    packetSet,
    userReviewedStrategyPackets: true,
    acknowledgedStrategyBoundaries: true,
    approvedSkillIds: ['main-image-design', 'detail-page-design', 'sku-batch']
  });
  const handoff = buildEcommerceSocksChildStrategyHandoff({
    packetSet,
    reviewGate: approvedGate,
    userIntent: '帮我做一整套袜子电商设计',
    projectPath: 'D:/demo/socks-project',
    memoryStrategy: {
      version: 'business-skill-memory-strategy/v0',
      summary: '用户偏好干净、克制、适合电商转化的袜子设计。',
      rawImage: 'data:image/png;base64,unsafe'
    },
    placementIntelligenceBySkill: {
      'main-image-design': {
        version: 'design-placement-intelligence/v0',
        status: 'ready',
        summary: { candidateCount: 2 },
        rawCandidateImage: 'base64-image-payload'
      }
    }
  });

  assert(handoff.status === 'ready_for_child_strategy_input', 'approved review gate should prepare child strategy handoff', handoff);
  assert(handoff.canUseAsChildStrategyInput === true, 'approved handoff can be consumed as child strategy input', handoff);
  assert(handoff.handoffs.length === 3, 'handoff should prepare all three child strategy patches', handoff);
  assert(handoff.canClaimDesignComplete === false, 'handoff cannot claim design completion', handoff);
  assert(handoff.mustNotExecuteChildSkills === true, 'handoff still must not execute child skills', handoff);

  const mainImage = handoff.handoffs.find((item) => item.skillId === 'main-image-design');
  const detailPage = handoff.handoffs.find((item) => item.skillId === 'detail-page-design');
  const sku = handoff.handoffs.find((item) => item.skillId === 'sku-batch');

  assert(mainImage?.strategyInputPatch?.scenario === 'main-image', 'main image handoff should expose scenario-specific patch', mainImage);
  assert(mainImage.strategyInputPatch.heroSubject.required === true, 'main image handoff should require hero subject selection', mainImage);
  assert(mainImage.strategyInputPatch.placement.requiresSmartScaling === true, 'main image handoff should require smart scaling review', mainImage);
  assert(detailPage?.strategyInputPatch?.scenario === 'detail-page', 'detail page handoff should expose scenario-specific patch', detailPage);
  assert(detailPage.strategyInputPatch.screenStoryline.required === true, 'detail page handoff should require screen storyline planning', detailPage);
  assert(sku?.strategyInputPatch?.scenario === 'sku', 'SKU handoff should expose scenario-specific patch', sku);
  assert(sku.strategyInputPatch.combinationPolicy.includeSelfSelectNotesByDefault === true, 'SKU handoff should preserve self-select note default', sku);
  assert(sku.strategyInputPatch.exportAcceptance.requiresReadback === true, 'SKU handoff should require export readback', sku);
  assertNoUnsafePayload(handoff, 'approved child strategy handoff');

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
      },
      businessSkillMemoryStrategy: {
        version: 'business-skill-memory-strategy/v0',
        summary: '偏好干净自然、符合袜子电商转化。'
      },
      designPlacementIntelligenceBySkill: {
        'sku-batch': {
          version: 'design-placement-intelligence/v0',
          status: 'ready'
        }
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
    result.data?.ecommerceSocksChildStrategyHandoff?.version === 'ecommerce-socks-child-strategy-handoff/v0',
    'executor should expose child strategy handoff evidence',
    result.data
  );
  assert(
    result.data.ecommerceSocksDesign.childStrategyHandoff === result.data.ecommerceSocksChildStrategyHandoff,
    'entry evidence should reference the same child strategy handoff',
    result.data
  );
  assert(
    result.data.ecommerceSocksChildStrategyHandoff.canUseAsChildStrategyInput === true,
    'executor handoff should be ready after explicit user review approval',
    result.data.ecommerceSocksChildStrategyHandoff
  );
  assert(
    result.data.ecommerceSocksChildStrategyHandoff.mustNotExecuteChildSkills === true,
    'executor handoff must not execute child skills',
    result.data.ecommerceSocksChildStrategyHandoff
  );
  assertNoUnsafePayload(result.data.ecommerceSocksChildStrategyHandoff, 'executor child strategy handoff');

  console.log(JSON.stringify({
    success: true,
    checks: [
      'child strategy handoff blocks before review gate approval',
      'approved review gate creates per-child strategy input patches',
      'main-image/detail-page/SKU patches preserve scenario-specific responsibilities',
      'handoff remains readonly and does not execute child skills or write Photoshop',
      'executor exposes handoff evidence without unsafe raw payloads'
    ]
  }, null, 2));
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
