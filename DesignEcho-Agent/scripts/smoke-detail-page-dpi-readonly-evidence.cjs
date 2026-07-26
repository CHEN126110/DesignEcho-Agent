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
  buildDetailPagePlannerContext
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
        path: 'D:/DesignEchoDemo/C-1160/素材/ZQL_0001.jpg',
        relativePath: '素材/ZQL_0001.jpg',
        name: 'ZQL_0001.jpg',
        extension: '.jpg',
        width: 1200,
        height: 1800,
        folderRole: 'source'
      },
      {
        path: 'D:/DesignEchoDemo/C-1160/素材/白色短袜细节.jpg',
        relativePath: '素材/白色短袜细节.jpg',
        name: '白色短袜细节.jpg',
        extension: '.jpg',
        width: 1400,
        height: 1400,
        folderRole: 'source'
      }
    ]
  });
  const detailAsset = assetIndex.assets.find((asset) => asset.role === 'raw-detail-closeup' || asset.role === 'color-single');
  assert(detailAsset, 'fixture should produce a detail-page visual candidate', assetIndex);
  const cacheKey = buildProjectVisualSamplingCacheKey(detailAsset);
  const visualInsightCache = buildProjectVisualInsightCacheReadResult({
    source: 'provided-options',
    exists: true,
    entries: [{
      cacheKey,
      assetId: detailAsset.id,
      path: detailAsset.path,
      insight: {
        assetId: detailAsset.id,
        path: detailAsset.path,
        summary: 'Soft cotton sock close-up with visible rib texture, suitable for detail-page material explanation.',
        productType: 'socks',
        scene: 'detail close-up',
        material: 'cotton rib knit',
        styleTags: ['socks', 'detail-page', 'cotton-texture', 'clean-layout'],
        modelId: 'fixture-vision',
        rawImage: 'raw-image-payload'
      }
    }]
  });
  const visualSamplingPlan = buildProjectVisualSamplingPlan({
    assetIndex,
    scenario: 'detail-page',
    maxCandidates: 2,
    cachedInsights: visualInsightCache.entries,
    nowIso: '2026-05-27T00:00:00.000Z'
  });
  const readonlyKnowledge = normalizeEagleReadonlyKnowledgeResults(
    { query: 'socks detail page cotton texture clean layout', limit: 4 },
    [{
      id: 'eagle-detail-1',
      name: 'socks-detail-page-texture-reference.jpg',
      tags: ['socks', 'detail-page', 'cotton-texture', 'clean-layout'],
      folders: ['Detail Page References'],
      width: 790,
      height: 1400,
      annotation: 'Detail page reference with close-up texture and clean spacing.',
      filePath: 'D:/Eagle/library/socks-detail-page-texture-reference.jpg',
      imageBase64: 'data:image/png;base64,should-not-leak'
    }],
    { sourceTool: 'item_query', nowIso: '2026-05-27T00:00:00.000Z' }
  );
  const visualCaseIndex = buildEagleVisualCaseIndexFromReadonlyKnowledge(readonlyKnowledge, {
    purpose: 'design_reference',
    requestedBy: 'smoke-detail-page-dpi-readonly-evidence'
  });

  return {
    assetIndex,
    visualSamplingPlan,
    visualInsightCache,
    visualCaseIndex
  };
}

function run() {
  const fixture = buildFixture();
  const placementTarget = {
    canvas: { width: 790, height: 2400 },
    box: { x: 64, y: 320, width: 662, height: 680 },
    safeBox: { x: 40, y: 120, width: 710, height: 2140 },
    slotRole: 'detail-page-product-closeup',
    executionTool: 'fillDetailPage'
  };
  const planner = buildDetailPagePlannerContext({
    userInput: '帮我做详情页，先根据项目图片规划选图和置入，不执行 Photoshop。',
    params: {
      detailPagePlacementTarget: placementTarget,
      eagleVisualCaseIndex: fixture.visualCaseIndex,
      knowledgeResults: [{
        id: 'local-memory:detail-clean-layout',
        title: '偏好风格：clean-layout',
        intent: 'rule',
        sourceType: 'local_case',
        summary: '用户明确偏好 clean-layout 的详情页排版。',
        sourceNotes: ['记忆类型：user_preference', '来源：manual_setting'],
        tags: ['design-memory', 'user_preference', 'manual_setting', 'style', 'clean-layout'],
        allowedUses: ['prompt_context', 'user_reference'],
        sourceLevel: 'local_case',
        sourceRank: 88
      }]
    },
    context: {
      userInput: '帮我做详情页，先根据项目图片规划选图和置入，不执行 Photoshop。',
      photoshopContext: {
        hasDocument: true,
        documentName: '详情页模板.psb',
        canvasSize: { width: 790, height: 2400 }
      },
      projectContext: {
        projectPath: 'D:/DesignEchoDemo/C-1160',
        assetIndex: fixture.assetIndex,
        visualSamplingPlan: fixture.visualSamplingPlan,
        visualInsightCache: fixture.visualInsightCache
      }
    },
    projectPath: 'D:/DesignEchoDemo/C-1160',
    screenCount: 3,
    mode: 'inspect',
    readinessMode: 'needs_review',
    screenPlanCount: 3
  });

  const dpi = planner.detailPageDesignPlacementIntelligence;
  assert(dpi, 'detail-page planner should expose detailPageDesignPlacementIntelligence', planner);
  assert(planner.businessSkillDesignPlacementIntelligence === dpi, 'common business skill DPI field should reference detail-page DPI', planner);
  assert(dpi.version === 'design-placement-intelligence/v0', 'detail-page DPI should expose stable version', dpi);
  assert(dpi.scenario === 'detail-page', 'detail-page DPI should keep scenario=detail-page', dpi);
  assert(dpi.boundaries.readonly === true, 'detail-page DPI must be readonly', dpi.boundaries);
  assert(dpi.boundaries.noPhotoshopWrites === true, 'detail-page DPI must not write Photoshop', dpi.boundaries);
  assert(dpi.boundaries.doesNotCallVisionModel === true, 'detail-page DPI must not call a vision model', dpi.boundaries);
  assert(dpi.boundaries.doesNotReturnRawImages === true, 'detail-page DPI must not expose raw images', dpi.boundaries);
  assert(dpi.boundaries.doesNotClaimDesignQuality === true, 'detail-page DPI must not claim quality', dpi.boundaries);
  assert(dpi.canClaimDesignQuality === false, 'detail-page DPI cannot claim final design quality', dpi);
  assert(dpi.summary.candidateCount > 0, 'detail-page DPI should produce candidates from readonly project context', dpi.summary);
  assert(dpi.candidates[0].visualObservation.status === 'cached_insight', 'detail-page DPI should use cached visual insight', dpi.candidates[0]);
  assert(dpi.candidates[0].placementPlan.execution.tool === 'fillDetailPage', 'detail-page DPI should preserve explicit readonly target tool', dpi.candidates[0].placementPlan.execution);
  assert(dpi.candidates[0].caseMatch.matchedCaseIds.includes('eagle-case:eagle-detail-1'), 'detail-page DPI should attach Eagle case metadata when tags match', dpi.candidates[0].caseMatch);
  assert(dpi.candidates[0].preferenceMatch?.status === 'matched', 'detail-page DPI should consume memory context for candidate ranking', dpi.candidates[0].preferenceMatch);
  assert(
    dpi.candidates[0].scorecard.items.some((item) => item.id === 'user-preference-match' && item.points > 0),
    'detail-page DPI scorecard should include user preference matching',
    dpi.candidates[0].scorecard
  );
  assert(dpi.candidates[0].reviewRequirements.some((item) => item.type === 'subject_bounds_required'), 'detail-page DPI should still require subject bounds review', dpi.candidates[0].reviewRequirements);
  assert(dpi.candidates[0].reviewRequirements.some((item) => item.type === 'actual_bounds_readback_required'), 'detail-page DPI should require actualBounds readback after execution', dpi.candidates[0].reviewRequirements);
  assert(dpi.candidates[0].reviewRequirements.some((item) => item.type === 'screenshot_or_manual_review_required'), 'detail-page DPI should require screenshot or manual review before quality claim', dpi.candidates[0].reviewRequirements);

  assertNoUnsafePayload(planner, 'detail-page planner DPI evidence');

  const detailExecutor = read('src/renderer/services/skill-executors/detail-page.executor.ts');
  assert(detailExecutor.includes("callTool('fillDetailPage', { plan: planToApply }"), 'detail-page executor should keep fillDetailPage params scoped to planToApply');
  assert(!detailExecutor.includes('detailPageDesignPlacementIntelligence: planToApply'), 'DPI must not be injected into fillDetailPage plan');

  const packageJson = JSON.parse(read('package.json'));
  assert(packageJson.scripts['smoke:detail-page:dpi-readonly-evidence'], 'package script should expose detail-page DPI smoke');

  console.log(JSON.stringify({
    success: true,
    checks: [
      'detail-page planner exposes readonly DesignPlacementIntelligence evidence',
      'detail-page DPI consumes ProjectAssetIndex, VisualSamplingPlan, VisualInsightCache and Eagle visual case metadata',
      'detail-page DPI stays out of fillDetailPage Photoshop write params',
      'detail-page DPI cannot claim design quality and keeps subject bounds/readback/manual review requirements',
      'detail-page DPI payload does not expose confidence or raw image fields'
    ]
  }, null, 2));
}

run();
