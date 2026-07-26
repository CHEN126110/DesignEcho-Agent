#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const memoryStore = new Map();
global.localStorage = {
  getItem: (key) => memoryStore.has(key) ? memoryStore.get(key) : null,
  setItem: (key, value) => memoryStore.set(key, String(value)),
  removeItem: (key) => memoryStore.delete(key),
  clear: () => memoryStore.clear()
};

require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '..', 'tsconfig.main.json')
});

const repoRoot = path.resolve(__dirname, '..');

const {
  buildSkuColorCardRetouchStrategy
} = require(path.join(repoRoot, 'src', 'shared', 'sku-color-card-retouch-strategy.ts'));

const {
  buildSkuBatchPlannerContext
} = require(path.join(repoRoot, 'src', 'renderer', 'services', 'skill-executors', 'design-planner-context.ts'));

function assertNoUnsafePayload(value, label) {
  const serialized = JSON.stringify(value || {});
  const forbidden = [
    'confidence',
    '置信',
    'raw-image-payload',
    'base64-image-payload',
    'data:image/',
    'C:\\private\\sku',
    'D:\\DesignEchoDemo'
  ];
  const found = forbidden.filter((token) => serialized.includes(token));
  assert.strictEqual(found.length, 0, `${label} leaked unsafe markers: ${found.join(', ')}`);
}

function assertRetouchStrategy(strategy, label) {
  assert.strictEqual(strategy.version, 'sku-color-card-retouch-strategy/v0', `${label} version mismatch`);
  assert.strictEqual(strategy.status, 'ready_for_strategy_review', `${label} should be ready for strategy review`);
  assert.strictEqual(strategy.noPhotoshopWrites, true, `${label} must be readonly`);
  assert.strictEqual(strategy.mustNotExecutePhotoshop, true, `${label} must not execute Photoshop`);
  assert.strictEqual(strategy.canClaimDesignComplete, false, `${label} must not claim design complete`);
  assert.strictEqual(strategy.canClaimOutputQuality, false, `${label} must not claim output quality`);
  assert(strategy.shapeStrategy.unifiedPoseTargets.includes('aligned_cuff_top'), `${label} should align cuff top`);
  assert(strategy.shapeStrategy.fidelityBoundaries.includes('preserve_special_cuff_shape'), `${label} should preserve special cuff shape`);
  assert(strategy.shapeStrategy.reviewRequirements.includes('cuff_shape_manual_review_required'), `${label} should require cuff review`);
  assert(strategy.lightStrategy.methods.includes('neutral_gray_dodge_burn_review'), `${label} should include neutral gray light review`);
  assert(strategy.lightStrategy.textureProtection.includes('preserve_knit_texture_detail'), `${label} should preserve knit texture`);
  assert(strategy.shadowStrategy.methods.includes('multiply_shadow_layer_review'), `${label} should include multiply shadow layer review`);
  assert(strategy.shadowStrategy.whiteFieldPolicy.includes('separate_product_from_shadow_after_white_point'), `${label} should describe white field shadow separation`);
  assert(strategy.strategyInputPatch.skuColorCardRetouchStrategy, `${label} should expose strategy input patch`);
  assert(strategy.reviewRequirements.includes('shape_consistency_review_required'), `${label} should require shape consistency review`);
  assert(strategy.reviewRequirements.includes('lighting_consistency_review_required'), `${label} should require lighting consistency review`);
  assert(strategy.reviewRequirements.includes('shadow_consistency_review_required'), `${label} should require shadow consistency review`);
  assertNoUnsafePayload(strategy, label);
}

const directStrategy = buildSkuColorCardRetouchStrategy({
  userText: '制作精修 SKU 色卡，袜子形态统一，光影自然，阴影单独正片叠底；花边罗口不能强行统一。C:\\private\\sku\\raw.png',
  colorCount: 5,
  comboSizes: [2, 3, 4],
  sourceHints: ['SKU.psb', '阴影组B', 'data:image/png;base64,private']
});
assertRetouchStrategy(directStrategy, 'direct SKU color card retouch strategy');
assert.strictEqual(directStrategy.summary.colorCount, 5, 'direct strategy should preserve color count');
assert(directStrategy.limitations.some((item) => item.includes('不直接执行')), 'direct strategy should explain no direct execution');

const planner = buildSkuBatchPlannerContext({
  userInput: '帮我做 SKU 色卡，要求形态统一、光影自然、阴影自然，同时花边罗口不能失真。',
  params: {
    skuColorCardRetouchIntent: true,
    skuPlacementTarget: {
      canvas: { width: 1600, height: 1000 },
      box: { x: 120, y: 220, width: 240, height: 560 },
      safeBox: { x: 80, y: 160, width: 1440, height: 760 },
      slotRole: 'sku-color-card-item',
      executionTool: 'custom-adapter'
    },
    knowledgeResults: [{
      id: 'local-memory:sku-retouch-preference',
      title: 'SKU 色卡偏好：统一形态与柔和阴影',
      intent: 'rule',
      sourceType: 'local_case',
      summary: '用户偏好精修 SKU 色卡：统一袜身形态，保留针织纹理，阴影轻柔自然。',
      sourceNotes: ['记忆类型：user_preference'],
      tags: ['design-memory', 'user_preference', 'style', 'sku-retouch'],
      allowedUses: ['prompt_context', 'user_reference'],
      sourceLevel: 'local_case',
      sourceRank: 90
    }]
  },
  context: {
    userInput: '帮我做 SKU 色卡，要求形态统一、光影自然、阴影自然，同时花边罗口不能失真。',
    projectContext: {
      projectPath: 'D:/DesignEchoDemo/C-1163'
    }
  },
  projectPath: 'D:/DesignEchoDemo/C-1163',
  comboSizes: [2, 3, 4],
  colorCount: 5,
  totalCombinations: 16,
  processedSizeCount: 0
});

assert(planner.skuColorCardRetouchStrategy, 'SKU planner should expose skuColorCardRetouchStrategy');
assertRetouchStrategy(planner.skuColorCardRetouchStrategy, 'planner SKU color card retouch strategy');
assert(
  planner.output.planInputs.constraints.some((item) => item.includes('skuColorCardRetouchStrategy=ready_for_strategy_review')),
  'planner constraints should include color-card retouch strategy status'
);
assertNoUnsafePayload(planner, 'planner retouch evidence');

const executorSource = fs.readFileSync(path.join(repoRoot, 'src', 'renderer', 'services', 'skill-executors', 'sku-batch.executor.ts'), 'utf8');
assert(executorSource.includes('skuColorCardRetouchStrategy'), 'SKU executor result data should expose skuColorCardRetouchStrategy');
assert(!/skuLayout[\s\S]{0,1200}skuColorCardRetouchStrategy/.test(executorSource), 'retouch strategy must not be passed into skuLayout params');

const plannerSource = fs.readFileSync(path.join(repoRoot, 'src', 'renderer', 'services', 'skill-executors', 'design-planner-context.ts'), 'utf8');
assert(plannerSource.includes('buildSkuColorCardRetouchStrategy'), 'planner evidence should build SKU color card retouch strategy');
assert(!plannerSource.includes('executeToolCall('), 'planner evidence must not execute tools');

const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
assert(packageJson.scripts['smoke:sku:color-card-retouch-strategy'], 'package.json should expose SKU color-card retouch strategy smoke');
assert(
  packageJson.scripts['maintenance:preflight'].includes('smoke:sku:color-card-retouch-strategy'),
  'maintenance preflight should include SKU color-card retouch strategy smoke'
);

console.log(JSON.stringify({
  success: true,
  checks: [
    'SKU color-card retouch strategy covers shape consistency, lighting consistency, shadow handling and cuff-preservation boundaries',
    'SKU planner exposes skuColorCardRetouchStrategy as readonly design strategy evidence',
    'SKU executor exposes skuColorCardRetouchStrategy result data without passing it into skuLayout params',
    'retouch strategy redacts raw image payloads, local paths and confidence fields',
    'package maintenance runs the SKU color-card retouch strategy smoke'
  ]
}, null, 2));
