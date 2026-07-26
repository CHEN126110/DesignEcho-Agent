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
  buildMainImagePlannerContext
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

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function buildFixture() {
  const assetIndex = buildProjectAssetIndex({
    projectPath: 'D:/DesignEchoDemo/C-1160',
    projectName: 'C-1160',
    files: [
      {
        path: 'D:/DesignEchoDemo/C-1160/素材/白色短袜.jpg',
        relativePath: '素材/白色短袜.jpg',
        name: '白色短袜.jpg',
        extension: '.jpg',
        width: 1600,
        height: 1200,
        folderRole: 'source'
      },
      {
        path: 'D:/DesignEchoDemo/C-1160/素材/细节纹理.jpg',
        relativePath: '素材/细节纹理.jpg',
        name: '细节纹理.jpg',
        extension: '.jpg',
        width: 1200,
        height: 1200,
        folderRole: 'source'
      }
    ]
  });
  const productAsset = assetIndex.assets.find((asset) => asset.role === 'color-single' || asset.role === 'raw-product-still');
  assert(productAsset, 'fixture should produce a product asset candidate', assetIndex);
  const cacheKey = buildProjectVisualSamplingCacheKey(productAsset);
  const visualInsightCache = buildProjectVisualInsightCacheReadResult({
    source: 'provided-options',
    exists: true,
    entries: [{
      cacheKey,
      assetId: productAsset.id,
      path: productAsset.path,
      insight: {
        assetId: productAsset.id,
        path: productAsset.path,
        summary: 'Clean white short sock product still with soft shadow and cotton texture.',
        productType: 'socks',
        scene: 'studio product still',
        material: 'cotton',
        styleTags: ['clean-layout', 'soft-shadow', 'white-background'],
        modelId: 'fixture-vision',
        rawImage: 'raw-image-payload'
      }
    }]
  });
  const visualSamplingPlan = buildProjectVisualSamplingPlan({
    assetIndex,
    scenario: 'main-image',
    maxCandidates: 2,
    cachedInsights: visualInsightCache.entries,
    nowIso: '2026-05-27T00:00:00.000Z'
  });
  const readonlyKnowledge = normalizeEagleReadonlyKnowledgeResults(
    { query: 'socks main image clean layout', limit: 4 },
    [{
      id: 'eagle-main-image-1',
      name: 'clean-socks-main-image-reference.jpg',
      tags: ['socks', 'main-image', 'clean-layout', 'soft-shadow'],
      folders: ['Main Image References'],
      width: 1440,
      height: 1440,
      annotation: 'Clean socks hero reference with white space and soft shadow.',
      filePath: 'D:/Eagle/library/clean-socks-main-image-reference.jpg',
      imageBase64: 'data:image/png;base64,should-not-leak'
    }],
    { sourceTool: 'item_query', nowIso: '2026-05-27T00:00:00.000Z' }
  );
  const visualCaseIndex = buildEagleVisualCaseIndexFromReadonlyKnowledge(readonlyKnowledge, {
    purpose: 'design_reference',
    requestedBy: 'smoke-main-image-dpi-readonly-evidence'
  });

  return {
    assetIndex,
    productAsset,
    visualSamplingPlan,
    visualInsightCache,
    visualCaseIndex
  };
}

function run() {
  const fixture = buildFixture();
  const sizePlans = [{
    sizeKey: '800',
    targetSize: { width: 1440, height: 1440 },
    subjectSize: { width: 820, height: 980 },
    scale: 0.72,
    targetX: 425,
    targetY: 368,
    decisionReason: 'main image DPI readonly smoke target',
    smartLayoutPlanned: true,
    quickExportPlanned: false
  }];
  const planner = buildMainImagePlannerContext({
    params: {
      userIntent: '帮我看项目图片做主图，先规划选图和置入，不执行 Photoshop。',
      eagleVisualCaseIndex: fixture.visualCaseIndex,
      knowledgeResults: [{
        id: 'local-memory:main-clean-layout',
        title: '偏好风格：clean-layout',
        intent: 'rule',
        sourceType: 'local_case',
        summary: '用户明确偏好 clean-layout 和 soft-shadow 的主图视觉。',
        sourceNotes: ['记忆类型：user_preference', '来源：manual_setting'],
        tags: ['design-memory', 'user_preference', 'manual_setting', 'style', 'clean-layout', 'soft-shadow'],
        allowedUses: ['prompt_context', 'user_reference'],
        sourceLevel: 'local_case',
        sourceRank: 88
      }]
    },
    context: {
      userInput: '帮我看项目图片做主图，先规划选图和置入，不执行 Photoshop。',
      projectContext: {
        projectPath: 'D:/DesignEchoDemo/C-1160',
        selectedProjectImagePath: fixture.productAsset.path,
        sampleImagePaths: [fixture.productAsset.path],
        assetIndex: fixture.assetIndex,
        visualSamplingPlan: fixture.visualSamplingPlan,
        visualInsightCache: fixture.visualInsightCache
      }
    },
    docInfo: {
      success: true,
      name: '主图-800.psb',
      width: 1440,
      height: 1440
    },
    imageType: 'click',
    sizeKeys: ['800'],
    sizePlans,
    subjectBounds: { left: 220, top: 180, right: 1040, bottom: 1160, width: 820, height: 980 },
    copyCandidates: ['一体成型，柔软贴脚'],
    toolNames: []
  });

  const dpi = planner.mainImageDesignPlacementIntelligence;
  assert(dpi, 'planner should expose mainImageDesignPlacementIntelligence evidence', planner);
  assert(dpi.version === 'design-placement-intelligence/v0', 'DPI evidence should expose stable version', dpi);
  assert(dpi.boundaries.readonly === true, 'DPI evidence must be readonly', dpi.boundaries);
  assert(dpi.boundaries.noPhotoshopWrites === true, 'DPI evidence must not write Photoshop', dpi.boundaries);
  assert(dpi.boundaries.doesNotCallVisionModel === true, 'DPI evidence must not call a vision model', dpi.boundaries);
  assert(dpi.canClaimDesignQuality === false, 'DPI evidence must not claim design quality', dpi);
  assert(dpi.summary.candidateCount > 0, 'DPI evidence should produce candidates from project context', dpi.summary);
  assert(dpi.candidates[0].visualObservation.status === 'cached_insight', 'DPI candidate should use cached visual insight', dpi.candidates[0]);
  assert(dpi.candidates[0].placementPlan.inputDetail === 'metadata', 'DPI must not invent subjectBox from tags or cached summary', dpi.candidates[0].placementPlan);
  assert(dpi.candidates[0].reviewRequirements.some((item) => item.type === 'subject_bounds_required'), 'DPI candidate should still require subject bounds review', dpi.candidates[0].reviewRequirements);
  assert(dpi.candidates[0].reviewRequirements.some((item) => item.type === 'actual_bounds_readback_required'), 'DPI candidate should require actualBounds readback after execution', dpi.candidates[0].reviewRequirements);
  assert(dpi.candidates[0].caseMatch.matchedCaseIds.includes('eagle-case:eagle-main-image-1'), 'DPI should attach Eagle case metadata when tags match', dpi.candidates[0].caseMatch);
  assert(dpi.candidates[0].preferenceMatch?.status === 'matched', 'main-image DPI should consume memory context for candidate ranking', dpi.candidates[0].preferenceMatch);
  assert(
    dpi.candidates[0].scorecard.items.some((item) => item.id === 'user-preference-match' && item.points > 0),
    'main-image DPI scorecard should include user preference matching',
    dpi.candidates[0].scorecard
  );

  const draft = planner.mainImageAgentDraft;
  assert(draft.mainImageDesignPlacementIntelligence === dpi, 'agent draft should keep the same DPI plan object', draft);
  assert(
    draft.mainImageStrategyInputBundle.designPlacementIntelligencePlan === dpi,
    'strategy input bundle should expose the DPI plan without recomputing or executing',
    draft.mainImageStrategyInputBundle
  );
  assert(
    !Object.prototype.hasOwnProperty.call(draft.mainImageStrategyInputBundle, 'sourceNotes'),
    'strategy input bundle should not fabricate a DPI self-summary',
    draft.mainImageStrategyInputBundle
  );
  assert(
    draft.mainImageStrategyInputBundle.limitations.some((item) => item.includes('DesignPlacementIntelligence')),
    'strategy limitations should keep DPI quality boundary visible',
    draft.mainImageStrategyInputBundle.limitations
  );

  assertNoUnsafePayload(dpi, 'main-image planner DPI evidence');
  assertNoUnsafePayload(draft.mainImageStrategyInputBundle.designPlacementIntelligencePlan, 'strategy input DPI plan');

  const packageJson = JSON.parse(read('package.json'));
  assert(packageJson.scripts['smoke:main-image:dpi-readonly-evidence'], 'package script should expose main-image DPI smoke');

  console.log(JSON.stringify({
    success: true,
    checks: [
      'main-image planner consumes DesignPlacementIntelligence from project context',
      'DPI evidence remains readonly and does not call Photoshop or vision',
      'DPI evidence is visible to agent draft and strategy input evidence',
      'DPI stays evidence-only and cannot claim design quality',
      'DPI payload does not expose confidence or raw image fields'
    ]
  }, null, 2));
}

run();
