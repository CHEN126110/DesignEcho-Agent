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
  const blocked = buildEcommerceSocksStrategyCheckpoint({
    userCheckpointConfirmed: false,
    deliverables: ['main-image', 'detail-page', 'sku'],
    strategyInputsBySkill: {
      'main-image-design': {
        ...allInputsReady,
        rawReferenceImage: 'raw-image-payload',
        dataUrl: 'data:image/png;base64,base64-image-payload'
      },
      'detail-page-design': allInputsReady,
      'sku-batch': allInputsReady
    }
  });

  assert(blocked.version === 'ecommerce-socks-strategy-checkpoint/v0', 'version must be stable', blocked);
  assert(blocked.status === 'blocked_missing_user_checkpoint', 'missing user checkpoint should block parent strategy checkpoint', blocked);
  assert(blocked.canStartChildStrategyDesign === false, 'blocked checkpoint must not allow child strategy design', blocked);
  assert(blocked.noPhotoshopWrites === true, 'strategy checkpoint must not write Photoshop', blocked);
  assert(blocked.canClaimDesignComplete === false, 'strategy checkpoint must not claim design completion', blocked);
  assert(blocked.childReadiness.length === 3, 'strategy checkpoint must cover all three requested child skills', blocked);
  assert(blocked.requiredDiscussionTopics.includes('imagePlacementPlan'), 'checkpoint must require image placement/smart scaling discussion', blocked);
  assert(blocked.requiredDiscussionTopics.includes('performanceBudget'), 'checkpoint must require performance budget discussion', blocked);
  assertNoRawPayload(blocked, 'blocked strategy checkpoint');

  const missingInputs = buildEcommerceSocksStrategyCheckpoint({
    userCheckpointConfirmed: true,
    deliverables: ['main-image', 'detail-page', 'sku'],
    strategyInputsBySkill: {
      'main-image-design': allInputsReady,
      'detail-page-design': {
        ...allInputsReady,
        imagePlacementPlan: false
      },
      'sku-batch': allInputsReady
    }
  });

  assert(
    missingInputs.status === 'blocked_missing_child_strategy_inputs',
    'one missing child input should block the parent checkpoint',
    missingInputs
  );
  assert(
    missingInputs.blockedChildren.some((item) => item.skillId === 'detail-page-design'),
    'blocked checkpoint should identify the child skill with missing evidence',
    missingInputs
  );
  assert(missingInputs.canStartChildStrategyDesign === false, 'missing child evidence blocks strategy design', missingInputs);

  const ready = buildEcommerceSocksStrategyCheckpoint({
    userCheckpointConfirmed: true,
    deliverables: ['main-image', 'detail-page', 'sku'],
    strategyInputsBySkill: {
      'main-image-design': allInputsReady,
      'detail-page-design': allInputsReady,
      'sku-batch': allInputsReady
    }
  });

  assert(ready.status === 'ready_for_child_strategy_design', 'complete child evidence should make checkpoint ready', ready);
  assert(ready.canStartChildStrategyDesign === true, 'ready checkpoint may start child strategy design', ready);
  assert(ready.canClaimDesignComplete === false, 'ready strategy checkpoint still cannot claim design completion', ready);
  assert(ready.childReadiness.every((item) => item.contract.canModifyBusinessStrategy === true), 'each child readiness contract should agree', ready);
  assertNoRawPayload(ready, 'ready strategy checkpoint');

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
    result.data?.ecommerceSocksStrategyCheckpoint?.version === 'ecommerce-socks-strategy-checkpoint/v0',
    'executor should expose parent strategy checkpoint evidence',
    result.data
  );
  assert(
    result.data.ecommerceSocksDesign.strategyCheckpoint === result.data.ecommerceSocksStrategyCheckpoint,
    'entry evidence should reference the same strategy checkpoint',
    result.data
  );
  assert(
    result.data.ecommerceSocksStrategyCheckpoint.canClaimDesignComplete === false,
    'executor strategy checkpoint cannot claim design completion',
    result.data.ecommerceSocksStrategyCheckpoint
  );
  assertNoRawPayload(result.data.ecommerceSocksStrategyCheckpoint, 'executor strategy checkpoint');

  console.log(JSON.stringify({
    success: true,
    checks: [
      'parent strategy checkpoint requires user checkpoint before child strategy work',
      'parent strategy checkpoint aggregates all child readiness contracts',
      'missing child strategy input blocks the parent checkpoint',
      'ready parent checkpoint still cannot claim design completion',
      'executor exposes strategy checkpoint evidence without executing child skills or writing Photoshop'
    ]
  }, null, 2));
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
