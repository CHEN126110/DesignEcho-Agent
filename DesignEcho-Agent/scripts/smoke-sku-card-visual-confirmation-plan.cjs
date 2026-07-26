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

const {
  buildSkuCardVisualConfirmationPlan
} = require('../src/shared/sku-card-visual-confirmation-plan.ts');

function assert(condition, message, details) {
  if (!condition) {
    throw new Error(`${message}${details ? `\n${JSON.stringify(details, null, 2)}` : ''}`);
  }
}

function candidate(id, overrides = {}) {
  return {
    assetId: id,
    path: `C:/fixture/6036/平铺/${id}.jpg`,
    relativePath: `6036/平铺/${id}.jpg`,
    role: 'raw-product-still',
    score: 105,
    recommendedUse: 'primary_sku_card',
    needsVisualConfirmation: true,
    visualObservationStatus: 'missing_insight',
    reasons: ['平铺素材更适合 SKU 卡片选图。'],
    warnings: [],
    ...overrides
  };
}

const report = {
  version: 'sku-card-asset-candidates/v0',
  mode: 'card-style',
  status: 'needs_visual_confirmation',
  candidateCount: 5,
  visualInsightCoverage: {
    totalCacheEntries: 4,
    entriesWithInsight: 4,
    selectedCandidateCount: 5,
    matchedCandidateCount: 0,
    candidatesNeedingConfirmation: 4
  },
  candidates: [
    candidate('fresh-1'),
    candidate('fresh-2'),
    candidate('ready', {
      needsVisualConfirmation: false,
      visualObservationStatus: 'matched_insight'
    }),
    candidate('reference', {
      recommendedUse: 'reference_only'
    }),
    candidate('fresh-3')
  ],
  blockers: [],
  warnings: ['SKU 卡片候选仍需视觉模型或人工确认主体完整度、颜色清晰度和裁切风险。'],
  limitations: [],
  sourceRecords: []
};

const plan = buildSkuCardVisualConfirmationPlan({
  skuCardAssetCandidateReport: report,
  maxCandidates: 2
});

assert(plan.planVersion === 'project-visual-sampling/v0', 'plan should reuse visual sampling contract', plan);
assert(plan.scenario === 'sku', 'plan scenario should be sku', plan);
assert(plan.selectedCandidates.length === 2, 'plan should cap SKU candidates', plan);
assert(plan.cacheSummary.shouldAnalyze === 2, 'selected SKU candidates should require analysis', plan);
assert(plan.sourceRecords.length > 0, 'SKU confirmation plan should retain source records', plan);
assert(plan.sourceRecords.every((record) => record.source.includes('/')), 'SKU confirmation source records should point to actual candidate paths', plan.sourceRecords);
assert(!JSON.stringify(plan).includes('"evidence"'), 'SKU confirmation plan must not expose a generic evidence field', plan);
assert(plan.skippedCandidateCount === 1, 'plan should count skipped unconfirmed SKU candidates', plan);
assert(plan.selectedCandidates.every((item) => item.shouldAnalyze === true), 'all selected candidates should require visual analysis', plan);
assert(
  plan.selectedCandidates.every((item) => item.cacheKey.startsWith('sku-card-visual:')),
  'SKU visual confirmation candidates should use a dedicated cache key prefix',
  plan
);
assert(
  plan.selectedCandidates.every((item) => item.requiredObservations.some((line) => line.includes('完整单只'))),
  'required observations should ask for product completeness, not only metadata',
  plan
);
assert(
  plan.warnings.some((item) => item.includes('没有命中当前 SKU 候选')),
  'stale cache coverage should be carried into the confirmation plan',
  plan
);
assert(
  !JSON.stringify(plan).includes('E:\\\\WERKE\\\\C-1194'),
  'shared SKU visual confirmation plan must not hardcode exam paths'
);

const emptyPlan = buildSkuCardVisualConfirmationPlan({
  skuCardAssetCandidateReport: {
    ...report,
    candidates: [
      candidate('ready-only', {
        needsVisualConfirmation: false,
        visualObservationStatus: 'matched_insight'
      })
    ],
    visualInsightCoverage: {
      totalCacheEntries: 1,
      entriesWithInsight: 1,
      selectedCandidateCount: 1,
      matchedCandidateCount: 1,
      candidatesNeedingConfirmation: 0
    }
  }
});

assert(emptyPlan.selectedCandidates.length === 0, 'ready candidates should not be re-analyzed', emptyPlan);
assert(emptyPlan.cacheSummary.shouldAnalyze === 0, 'empty plan should not request analysis', emptyPlan);

console.log(JSON.stringify({
  ok: true,
  selected: plan.selectedCandidates.map((item) => item.path),
  skippedCandidateCount: plan.skippedCandidateCount,
  emptyShouldAnalyze: emptyPlan.cacheSummary.shouldAnalyze
}, null, 2));
