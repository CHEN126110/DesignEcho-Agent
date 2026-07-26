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

async function run() {
  const blockedCheckpoint = buildEcommerceSocksStrategyCheckpoint({
    userCheckpointConfirmed: false,
    deliverables: ['main-image', 'detail-page', 'sku'],
    strategyInputsBySkill: {
      'main-image-design': allInputsReady,
      'detail-page-design': allInputsReady,
      'sku-batch': allInputsReady
    }
  });
  const blockedPackets = buildEcommerceSocksChildStrategyPacketSet({
    strategyCheckpoint: blockedCheckpoint
  });

  assert(blockedPackets.version === 'ecommerce-socks-child-strategy-packet-set/v0', 'packet set version must be stable', blockedPackets);
  assert(blockedPackets.status === 'blocked_by_strategy_checkpoint', 'blocked parent checkpoint should block child packets', blockedPackets);
  assert(blockedPackets.canStartUserStrategyReview === false, 'blocked packets cannot start user review', blockedPackets);
  assert(blockedPackets.canImplementChildStrategyChanges === false, 'packet set must not implement child strategy changes', blockedPackets);
  assert(blockedPackets.canClaimDesignComplete === false, 'packet set must not claim design completion', blockedPackets);
  assert(blockedPackets.noPhotoshopWrites === true, 'packet set must not write Photoshop', blockedPackets);
  assert(blockedPackets.packets.length === 3, 'packet set should still expose all child packet requirements', blockedPackets);

  const readyCheckpoint = buildEcommerceSocksStrategyCheckpoint({
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
  const readyPackets = buildEcommerceSocksChildStrategyPacketSet({
    strategyCheckpoint: readyCheckpoint
  });

  assert(readyPackets.status === 'ready_for_user_strategy_review', 'ready parent checkpoint should prepare user review packets', readyPackets);
  assert(readyPackets.canStartUserStrategyReview === true, 'ready packet set can start user review', readyPackets);
  assert(readyPackets.canImplementChildStrategyChanges === false, 'ready packet set still cannot change child strategy', readyPackets);
  assert(readyPackets.packets.every((packet) => packet.requiredSections.length === 7), 'each packet should keep all readiness sections', readyPackets);
  assert(
    readyPackets.packets.some((packet) => packet.skillId === 'main-image-design' && packet.requiredDecisions.includes('hero_subject_selection')),
    'main image packet should require hero subject selection decision',
    readyPackets
  );
  assert(
    readyPackets.packets.some((packet) => packet.skillId === 'detail-page-design' && packet.requiredDecisions.includes('screen_storyline_planning')),
    'detail page packet should require screen storyline planning decision',
    readyPackets
  );
  assert(
    readyPackets.packets.some((packet) => packet.skillId === 'sku-batch' && packet.requiredDecisions.includes('sku_combination_policy')),
    'SKU packet should require combination policy decision',
    readyPackets
  );
  assertNoRawPayload(readyPackets, 'ready child strategy packet set');

  const executor = getSkillExecutor('ecommerce-socks-design');
  assert(executor, 'ecommerce-socks-design executor should be registered');

  const result = await executor.execute({
    params: {
      userIntent: '帮我做一整套袜子电商设计',
      deliverables: ['main-image', 'detail-page', 'sku'],
      userCheckpointConfirmed: true,
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
    result.data?.ecommerceSocksChildStrategyPacketSet?.version === 'ecommerce-socks-child-strategy-packet-set/v0',
    'executor should expose child strategy packet set evidence',
    result.data
  );
  assert(
    result.data.ecommerceSocksDesign.childStrategyPacketSet === result.data.ecommerceSocksChildStrategyPacketSet,
    'entry evidence should reference the same child strategy packet set',
    result.data
  );
  assert(
    result.data.ecommerceSocksChildStrategyPacketSet.canImplementChildStrategyChanges === false,
    'executor packet evidence must not allow immediate child strategy implementation',
    result.data.ecommerceSocksChildStrategyPacketSet
  );
  assertNoRawPayload(result.data.ecommerceSocksChildStrategyPacketSet, 'executor child strategy packet set');

  console.log(JSON.stringify({
    success: true,
    checks: [
      'child strategy packets are blocked when parent strategy checkpoint is blocked',
      'ready checkpoint prepares user-review packets for main-image/detail-page/SKU',
      'packets require concrete design decisions without implementing child strategy changes',
      'packets keep no Photoshop writes and no design completion claims',
      'executor exposes packet evidence without executing child skills'
    ]
  }, null, 2));
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
