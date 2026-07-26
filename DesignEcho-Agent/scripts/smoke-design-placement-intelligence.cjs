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

const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');

const {
  buildDesignPlacementIntelligencePlan,
  isDesignPlacementIntelligencePayloadSafe
} = require('../src/shared/design-placement-intelligence.ts');

const {
  buildEagleVisualCaseIndexFromReadonlyKnowledge
} = require('../src/shared/eagle-visual-case-index.ts');

const {
  normalizeEagleReadonlyKnowledgeResults
} = require('../src/shared/eagle-readonly-knowledge.ts');

const {
  buildProjectAssetIndex
} = require('../src/shared/project-asset-index.ts');

const {
  buildProjectVisualSamplingCacheKey,
  buildProjectVisualSamplingPlan
} = require('../src/shared/project-visual-sampling.ts');

const {
  buildProjectVisualInsightCacheReadResult
} = require('../src/shared/project-visual-insight-cache.ts');

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function assert(condition, message, details) {
  if (!condition) {
    const suffix = details ? `\n${JSON.stringify(details, null, 2)}` : '';
    throw new Error(`${message}${suffix}`);
  }
}

function assertNoRawImagePayload(value, label) {
  const text = JSON.stringify(value);
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
    '"confidence"'
  ];
  const found = forbidden.filter((token) => text.includes(token));
  assert(found.length === 0, `${label} should not expose raw payloads or confidence fields: ${found.join(', ')}`, value);
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
        path: 'D:/DesignEchoDemo/C-1160/主图/800x800/01.jpg',
        relativePath: '主图/800x800/01.jpg',
        name: '01.jpg',
        extension: '.jpg',
        width: 800,
        height: 800,
        folderRole: 'main-image'
      }
    ]
  });
  const productAsset = assetIndex.assets.find((asset) => asset.role === 'color-single' || asset.role === 'raw-product-still');
  assert(productAsset, 'fixture should produce one product candidate', assetIndex);
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
        summary: 'Clean white ankle sock on bright background; suitable for product hero with soft shadow.',
        productType: 'socks',
        scene: 'studio product still',
        material: 'cotton texture',
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
      id: 'eagle-main-1',
      name: 'clean-socks-main-image-reference.jpg',
      tags: ['socks', 'main-image', 'clean-layout', 'soft-shadow'],
      folders: ['Main Image References'],
      width: 1440,
      height: 1440,
      annotation: 'Clean socks hero reference with ample white space and soft shadow.',
      filePath: 'D:/Eagle/library/clean-socks-main-image-reference.jpg',
      imageBase64: 'data:image/png;base64,should-not-leak'
    }],
    { sourceTool: 'item_query', nowIso: '2026-05-27T00:00:00.000Z' }
  );
  const visualCaseIndex = buildEagleVisualCaseIndexFromReadonlyKnowledge(readonlyKnowledge, {
    purpose: 'design_reference',
    requestedBy: 'smoke-dpi'
  });
  return {
    assetIndex,
    visualSamplingPlan,
    visualInsightCache,
    visualCaseIndex
  };
}

function run() {
  const blocked = buildDesignPlacementIntelligencePlan({
    scenario: 'main-image',
    target: {
      canvas: { width: 1440, height: 1440 },
      box: { x: 160, y: 220, width: 920, height: 880 },
      safeBox: { x: 120, y: 160, width: 1040, height: 980 },
      slotRole: 'hero-product'
    }
  });
  assert(blocked.version === 'design-placement-intelligence/v0', 'DPI plan should expose stable version', blocked);
  assert(blocked.status === 'blocked', 'missing ProjectAssetIndex should block DPI plan', blocked);
  assert(blocked.blockers.includes('project_asset_index_required'), 'blocked plan should explain missing asset index', blocked.blockers);
  assert(blocked.boundaries.noPhotoshopWrites === true, 'blocked plan must not write Photoshop', blocked.boundaries);

  const fixture = buildFixture();
  const noInsightSampling = buildProjectVisualSamplingPlan({
    assetIndex: fixture.assetIndex,
    scenario: 'main-image',
    maxCandidates: 2,
    cachedInsights: [],
    nowIso: '2026-05-27T00:00:00.000Z'
  });
  const needsVisual = buildDesignPlacementIntelligencePlan({
    scenario: 'main-image',
    assetIndex: fixture.assetIndex,
    visualSamplingPlan: noInsightSampling,
    target: {
      canvas: { width: 1440, height: 1440 },
      box: { x: 160, y: 220, width: 920, height: 880 },
      safeBox: { x: 120, y: 160, width: 1040, height: 980 },
      slotRole: 'hero-product'
    }
  });
  assert(needsVisual.status === 'needs_visual_observation', 'missing visual insight should require a visual observation', needsVisual);
  assert(needsVisual.reviewRequirements.some((item) => item.type === 'visual_insight_required'), 'needsVisual should require visual insight', needsVisual.reviewRequirements);

  const plan = buildDesignPlacementIntelligencePlan({
    scenario: 'main-image',
    assetIndex: fixture.assetIndex,
    visualSamplingPlan: fixture.visualSamplingPlan,
    visualInsightCache: fixture.visualInsightCache,
    visualCaseIndex: fixture.visualCaseIndex,
    target: {
      canvas: { width: 1440, height: 1440 },
      box: { x: 160, y: 220, width: 920, height: 880 },
      safeBox: { x: 120, y: 160, width: 1040, height: 980 },
      slotRole: 'hero-product',
      executionTool: 'replaceImagePlaceholder'
    }
  });

  assert(plan.status === 'ready_for_placement_plan', 'cached visual insight should allow placement planning', plan);
  assert(plan.boundaries.readonly === true, 'DPI must remain readonly', plan.boundaries);
  assert(plan.boundaries.noPhotoshopWrites === true, 'DPI must not write Photoshop', plan.boundaries);
  assert(plan.boundaries.doesNotClaimDesignQuality === true, 'DPI must not claim final design quality', plan.boundaries);
  assert(plan.canClaimDesignQuality === false, 'DPI must keep design quality claim disabled', plan);
  assert(plan.candidates.length > 0, 'DPI should produce candidates', plan);
  assert(plan.summary.candidateCount === plan.candidates.length, 'summary should count candidates', plan.summary);
  assert(plan.summary.visualCaseCount === 1, 'summary should count Eagle visual cases', plan.summary);

  const candidate = plan.candidates[0];
  assert(candidate.visualObservation.status === 'cached_insight', 'candidate should use cached visual insight', candidate.visualObservation);
  assert(candidate.caseMatch.matchedCaseIds.includes('eagle-case:eagle-main-1'), 'candidate should match Eagle visual case by tags', candidate.caseMatch);
  assert(candidate.scorecard.totalScore > 0, 'candidate should expose explainable scorecard', candidate.scorecard);
  assert(candidate.scorecard.items.some((item) => item.id === 'visual-observation'), 'scorecard should include visual observation item', candidate.scorecard);
  assert(candidate.placementPlan.version === 'image-placement-core/v0', 'candidate should include Image Placement Core plan', candidate.placementPlan);
  assert(candidate.placementPlan.inputDetail === 'metadata', 'DPI must not invent subjectBox from visual insight or Eagle tags', candidate.placementPlan);
  assert(candidate.placementPlan.status === 'needs_review', 'metadata-only placement must remain needs_review', candidate.placementPlan);
  assert(candidate.reviewRequirements.some((item) => item.type === 'subject_bounds_required'), 'candidate should require subject bounds before quality claim', candidate.reviewRequirements);
  assert(candidate.reviewRequirements.some((item) => item.type === 'actual_bounds_readback_required'), 'candidate should require Photoshop actualBounds after execution', candidate.reviewRequirements);

  assert(isDesignPlacementIntelligencePayloadSafe(plan), 'DPI payload should pass safety check', plan);
  assertNoRawImagePayload(plan, 'DPI plan');

  const packageJson = JSON.parse(read('package.json'));
  assert(packageJson.scripts['smoke:design-placement:intelligence'], 'package script should expose DPI smoke');

  const boundaries = read('scripts/report-change-boundaries.cjs');
  assert(boundaries.includes('smoke:design-placement:intelligence'), 'change boundary validation should include DPI smoke');
  assert(boundaries.includes('design-placement-intelligence'), 'change boundary matcher should include DPI module');

  console.log(JSON.stringify({
    success: true,
    checks: [
      'DPI blocks when project asset index is missing',
      'DPI requires visual observation when candidates have no cached insight',
      'DPI can build placement candidates from ProjectAssetIndex, VisualSamplingPlan, VisualInsightCache and Eagle visual cases',
      'DPI uses Image Placement Core for geometry planning without executing Photoshop',
      'DPI does not invent subjectBox, OCR, colors or composition from tags',
      'DPI exposes scorecard and review requirements without confidence fields',
      'raw/base64 image payloads are not exposed',
      'package script and change boundary validation are wired'
    ]
  }, null, 2));
}

run();
