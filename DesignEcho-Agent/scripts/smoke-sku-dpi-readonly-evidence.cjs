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
  buildSkuBatchPlannerContext
} = require(path.join(repoRoot, 'src', 'renderer', 'services', 'skill-executors', 'design-planner-context.ts'));

const {
  buildEagleVisualCaseIndexFromReadonlyKnowledge
} = require(path.join(repoRoot, 'src', 'shared', 'eagle-visual-case-index.ts'));

const {
  normalizeEagleReadonlyKnowledgeResults
} = require(path.join(repoRoot, 'src', 'shared', 'eagle-readonly-knowledge.ts'));

const {
  buildProjectAssetIndex
} = require(path.join(repoRoot, 'src', 'shared', 'project-asset-index.ts'));

const {
  buildProjectVisualSamplingCacheKey,
  buildProjectVisualSamplingPlan
} = require(path.join(repoRoot, 'src', 'shared', 'project-visual-sampling.ts'));

const {
  buildProjectVisualInsightCacheReadResult
} = require(path.join(repoRoot, 'src', 'shared', 'project-visual-insight-cache.ts'));

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
    'data:image',
    'raw-image-payload',
    'base64-image-payload',
    '"base64"',
    '"imageBase64"',
    '"rawImage"',
    '"rawImages"',
    '"buffer"',
    '"bytes"',
    '"pixels"',
    '"confidence"',
    '置信'
  ];
  const found = forbidden.filter((token) => serialized.includes(token));
  assert(found.length === 0, `${label} should not expose raw image payloads or confidence fields: ${found.join(', ')}`, value);
}

function buildFixture() {
  const assetIndex = buildProjectAssetIndex({
    projectPath: 'D:/DesignEchoDemo/C-1160',
    projectName: 'C-1160',
    files: [
      {
        path: 'D:/DesignEchoDemo/C-1160/素材/白色.jpg',
        relativePath: '素材/白色.jpg',
        name: '白色.jpg',
        extension: '.jpg',
        width: 1000,
        height: 1600,
        folderRole: 'source'
      },
      {
        path: 'D:/DesignEchoDemo/C-1160/素材/黑色.jpg',
        relativePath: '素材/黑色.jpg',
        name: '黑色.jpg',
        extension: '.jpg',
        width: 1000,
        height: 1600,
        folderRole: 'source'
      },
      {
        path: 'D:/DesignEchoDemo/C-1160/SKU/2双装/白色+黑色.jpg',
        relativePath: 'SKU/2双装/白色+黑色.jpg',
        name: '白色+黑色.jpg',
        extension: '.jpg',
        width: 1200,
        height: 1200,
        folderRole: 'sku'
      }
    ]
  });
  const colorAsset = assetIndex.assets.find((asset) => asset.role === 'color-single');
  assert(colorAsset, 'fixture should produce a color-single SKU candidate', assetIndex);
  const cacheKey = buildProjectVisualSamplingCacheKey(colorAsset);
  const visualInsightCache = buildProjectVisualInsightCacheReadResult({
    source: 'provided-options',
    exists: true,
    entries: [{
      cacheKey,
      assetId: colorAsset.id,
      path: colorAsset.path,
      insight: {
        assetId: colorAsset.id,
        path: colorAsset.path,
        summary: 'Single sock color card source on white background with soft shadow and visible knit texture.',
        productType: 'socks',
        scene: 'SKU color single',
        material: 'cotton knit',
        styleTags: ['socks', 'sku', 'color-single', 'clean-layout'],
        modelId: 'fixture-vision',
        rawImage: 'raw-image-payload'
      }
    }]
  });
  const visualSamplingPlan = buildProjectVisualSamplingPlan({
    assetIndex,
    scenario: 'sku',
    maxCandidates: 2,
    cachedInsights: visualInsightCache.entries,
    nowIso: '2026-05-27T00:00:00.000Z'
  });
  const readonlyKnowledge = normalizeEagleReadonlyKnowledgeResults(
    { query: 'socks SKU color card clean layout', limit: 4 },
    [{
      id: 'eagle-sku-1',
      name: 'socks-sku-color-card-reference.jpg',
      tags: ['socks', 'sku', 'color-single', 'clean-layout'],
      folders: ['SKU References'],
      width: 1600,
      height: 1000,
      annotation: 'SKU color card reference with unified shape and consistent spacing.',
      filePath: 'D:/Eagle/library/socks-sku-color-card-reference.jpg',
      imageBase64: 'data:image/png;base64,should-not-leak'
    }],
    { sourceTool: 'item_query', nowIso: '2026-05-27T00:00:00.000Z' }
  );
  const visualCaseIndex = buildEagleVisualCaseIndexFromReadonlyKnowledge(readonlyKnowledge, {
    purpose: 'design_reference',
    requestedBy: 'smoke-sku-dpi-readonly-evidence'
  });

  return {
    assetIndex,
    visualSamplingPlan,
    visualInsightCache,
    visualCaseIndex
  };
}

function buildBaseInput(fixture, params = {}) {
  return {
    userInput: '帮我做 SKU，先根据项目素材规划色卡候选和置入，不执行 Photoshop。',
    params,
    context: {
      userInput: '帮我做 SKU，先根据项目素材规划色卡候选和置入，不执行 Photoshop。',
      projectContext: {
        projectPath: 'D:/DesignEchoDemo/C-1160',
        assetIndex: fixture.assetIndex,
        visualSamplingPlan: fixture.visualSamplingPlan,
        visualInsightCache: fixture.visualInsightCache
      }
    },
    projectPath: 'D:/DesignEchoDemo/C-1160',
    comboSizes: [2, 3, 4],
    colorCount: 5,
    totalCombinations: 15,
    processedSizeCount: 0
  };
}

function run() {
  const fixture = buildFixture();
  const missingTargetPlanner = buildSkuBatchPlannerContext(buildBaseInput(fixture, {
    eagleVisualCaseIndex: fixture.visualCaseIndex
  }));
  const missingTargetDpi = missingTargetPlanner.skuDesignPlacementIntelligence;
  assert(missingTargetDpi, 'SKU planner should expose skuDesignPlacementIntelligence even when target evidence is missing', missingTargetPlanner);
  assert(missingTargetDpi.scenario === 'sku', 'SKU DPI should keep scenario=sku', missingTargetDpi);
  assert(missingTargetDpi.status === 'blocked', 'SKU DPI should block when no explicit SKU placement target exists', missingTargetDpi);
  assert(missingTargetDpi.blockers.includes('placement_target_required'), 'SKU DPI should not fabricate Photoshop slot geometry', missingTargetDpi.blockers);
  assert(missingTargetDpi.canClaimDesignQuality === false, 'blocked SKU DPI still cannot claim design quality', missingTargetDpi);

  const placementTarget = {
    canvas: { width: 1600, height: 1000 },
    box: { x: 170, y: 260, width: 220, height: 520 },
    safeBox: { x: 120, y: 180, width: 1360, height: 680 },
    slotRole: 'sku-color-card-item',
    executionTool: 'custom-adapter'
  };
  const planner = buildSkuBatchPlannerContext(buildBaseInput(fixture, {
    skuPlacementTarget: placementTarget,
    eagleVisualCaseIndex: fixture.visualCaseIndex,
    knowledgeResults: [{
      id: 'local-memory:sku-clean-layout',
      title: '偏好风格：clean-layout',
      intent: 'rule',
      sourceType: 'local_case',
      summary: '用户明确偏好 clean-layout 的 SKU 色卡排版。',
      sourceNotes: ['记忆类型：user_preference', '来源：manual_setting'],
      tags: ['design-memory', 'user_preference', 'manual_setting', 'style', 'clean-layout'],
      allowedUses: ['prompt_context', 'user_reference'],
      sourceLevel: 'local_case',
      sourceRank: 88
    }]
  }));

  const dpi = planner.skuDesignPlacementIntelligence;
  assert(dpi, 'SKU planner should expose skuDesignPlacementIntelligence', planner);
  assert(planner.businessSkillDesignPlacementIntelligence === dpi, 'common business skill DPI field should reference SKU DPI', planner);
  assert(dpi.version === 'design-placement-intelligence/v0', 'SKU DPI should expose stable version', dpi);
  assert(dpi.scenario === 'sku', 'SKU DPI should keep scenario=sku', dpi);
  assert(dpi.boundaries.readonly === true, 'SKU DPI must be readonly', dpi.boundaries);
  assert(dpi.boundaries.noPhotoshopWrites === true, 'SKU DPI must not write Photoshop', dpi.boundaries);
  assert(dpi.boundaries.doesNotCallVisionModel === true, 'SKU DPI must not call a vision model', dpi.boundaries);
  assert(dpi.boundaries.doesNotReturnRawImages === true, 'SKU DPI must not expose raw images', dpi.boundaries);
  assert(dpi.boundaries.doesNotClaimDesignQuality === true, 'SKU DPI must not claim quality', dpi.boundaries);
  assert(dpi.canClaimDesignQuality === false, 'SKU DPI cannot claim final design quality', dpi);
  assert(dpi.summary.candidateCount > 0, 'SKU DPI should produce candidates from readonly project context', dpi.summary);
  assert(dpi.candidates[0].asset.role === 'color-single', 'SKU DPI should prefer color-single candidates', dpi.candidates[0].asset);
  assert(dpi.candidates[0].visualObservation.status === 'cached_insight', 'SKU DPI should use cached visual insight', dpi.candidates[0]);
  assert(dpi.candidates[0].caseMatch.matchedCaseIds.includes('eagle-case:eagle-sku-1'), 'SKU DPI should attach Eagle case metadata when tags match', dpi.candidates[0].caseMatch);
  assert(dpi.candidates[0].preferenceMatch?.status === 'matched', 'SKU DPI should consume memory context for candidate ranking', dpi.candidates[0].preferenceMatch);
  assert(
    dpi.candidates[0].scorecard.items.some((item) => item.id === 'user-preference-match' && item.points > 0),
    'SKU DPI scorecard should include user preference matching',
    dpi.candidates[0].scorecard
  );
  assert(dpi.candidates[0].reviewRequirements.some((item) => item.type === 'subject_bounds_required'), 'SKU DPI should still require subject bounds review', dpi.candidates[0].reviewRequirements);
  assert(dpi.candidates[0].reviewRequirements.some((item) => item.type === 'actual_bounds_readback_required'), 'SKU DPI should require actualBounds readback after execution', dpi.candidates[0].reviewRequirements);

  assertNoUnsafePayload(planner, 'SKU planner DPI evidence');

  const skuExecutor = read('src/renderer/services/skill-executors/sku-batch.executor.ts');
  assert(skuExecutor.includes('success: processedSizes.length > 0'), 'SKU executor should preserve existing success criterion');
  assert(skuExecutor.includes('designPlanner'), 'SKU executor should keep designPlanner in result data');

  const helper = read('src/renderer/services/skill-executors/design-planner-context.ts');
  assert(!helper.includes('executeToolCall('), 'planner evidence helper must not execute tools');
  assert(!helper.includes('analyzeAssetContent('), 'planner evidence helper must not call visual analysis');
  assert(!helper.includes('runProjectVisualInsightCacheFill('), 'planner evidence helper must not fill visual insight cache');

  const packageJson = JSON.parse(read('package.json'));
  assert(packageJson.scripts['smoke:sku:dpi-readonly-evidence'], 'package script should expose SKU DPI smoke');

  console.log(JSON.stringify({
    success: true,
    checks: [
      'SKU planner exposes readonly DesignPlacementIntelligence evidence',
      'SKU DPI consumes ProjectAssetIndex, VisualSamplingPlan, VisualInsightCache and Eagle visual case metadata',
      'SKU DPI blocks without explicit placement target instead of fabricating Photoshop slots',
      'SKU DPI preserves SKU executor success criteria and stays out of write parameters',
      'SKU DPI payload does not expose confidence or raw image fields'
    ]
  }, null, 2));
}

run();
