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
  buildBusinessSkillMemoryContext
} = require('../src/shared/business-skill-memory-context.ts');

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

function assertNoUnsafePayload(value, label) {
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
    '"confidence"',
    '置信'
  ];
  const found = forbidden.filter((token) => text.includes(token));
  assert(found.length === 0, `${label} should not expose unsafe payload or confidence markers: ${found.join(', ')}`, value);
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
        path: 'D:/DesignEchoDemo/C-1160/素材/黑色短袜.jpg',
        relativePath: '素材/黑色短袜.jpg',
        name: '黑色短袜.jpg',
        extension: '.jpg',
        width: 1600,
        height: 1200,
        folderRole: 'source'
      }
    ]
  });
  const whiteAsset = assetIndex.assets.find((asset) => asset.name === '白色短袜.jpg');
  const blackAsset = assetIndex.assets.find((asset) => asset.name === '黑色短袜.jpg');
  assert(whiteAsset && blackAsset, 'fixture should create white and black product assets', assetIndex.assets);

  const whiteCacheKey = buildProjectVisualSamplingCacheKey(whiteAsset);
  const blackCacheKey = buildProjectVisualSamplingCacheKey(blackAsset);
  const visualInsightCache = buildProjectVisualInsightCacheReadResult({
    source: 'provided-options',
    exists: true,
    entries: [
      {
        cacheKey: whiteCacheKey,
        assetId: whiteAsset.id,
        path: whiteAsset.path,
        insight: {
          assetId: whiteAsset.id,
          path: whiteAsset.path,
          summary: 'Clean white socks with soft shadow on a bright white background.',
          productType: 'socks',
          scene: 'studio white background',
          material: 'cotton texture',
          styleTags: ['浅色干净', 'white-background', 'soft-shadow'],
          modelId: 'fixture-vision'
        }
      },
      {
        cacheKey: blackCacheKey,
        assetId: blackAsset.id,
        path: blackAsset.path,
        insight: {
          assetId: blackAsset.id,
          path: blackAsset.path,
          summary: 'Black socks on dark fabric background with strong contrast.',
          productType: 'socks',
          scene: 'dark background',
          material: 'cotton texture',
          styleTags: ['dark-contrast', 'black-background'],
          modelId: 'fixture-vision'
        }
      }
    ]
  });
  const visualSamplingPlan = buildProjectVisualSamplingPlan({
    assetIndex,
    scenario: 'main-image',
    maxCandidates: 4,
    cachedInsights: visualInsightCache.entries,
    nowIso: '2026-05-28T00:00:00.000Z'
  });
  const memoryContext = buildBusinessSkillMemoryContext({
    scenario: 'main-image',
    userText: '主图偏好浅色干净、白底、柔和阴影',
    knowledgeResults: [
      {
        id: 'local-memory:user-preference-style-clean',
        title: '偏好风格：浅色干净',
        intent: 'rule',
        sourceType: 'local_case',
        summary: '用户明确偏好浅色干净、白底、柔和阴影的电商视觉。',
        sourceNotes: ['记忆类型：user_preference', '来源：manual_setting'],
        tags: ['design-memory', 'user_preference', 'manual_setting', 'style', '浅色干净', 'white-background', 'soft-shadow'],
        allowedUses: ['prompt_context', 'user_reference'],
        sourceLevel: 'local_case',
        sourceRank: 88,
        updatedAt: '2026-05-28T00:00:00.000Z'
      },
      {
        id: 'local-memory:approved-learning-white-socks-card',
        title: '白底袜子主图学习经验',
        intent: 'reference',
        sourceType: 'local_case',
        summary: '白底、柔和阴影、浅色干净的袜子主图适合基础款展示；好处是产品边界清楚，颜色和材质更容易被用户判断。',
        sourceNotes: [
          '记忆类型：visual_case',
          '来源：imported_case',
          'design-learning-experience：reference=eagle-case:white-socks; heuristics=3',
          'design-learning-review：review=approved; reviewer=designer'
        ],
        tags: ['design-memory', 'visual_case', 'imported_case', 'design-learning', 'reviewed-design-learning', 'socks', 'white-background', 'soft-shadow', '浅色干净'],
        allowedUses: ['prompt_context', 'user_reference', 'recipe_hint'],
        sourceLevel: 'local_case',
        sourceRank: 84,
        updatedAt: '2026-06-02T00:00:00.000Z'
      }
    ]
  });
  return {
    assetIndex,
    visualSamplingPlan,
    visualInsightCache,
    memoryContext
  };
}

function run() {
  const fixture = buildFixture();
  const plan = buildDesignPlacementIntelligencePlan({
    scenario: 'main-image',
    assetIndex: fixture.assetIndex,
    visualSamplingPlan: fixture.visualSamplingPlan,
    visualInsightCache: fixture.visualInsightCache,
    memoryContext: fixture.memoryContext,
    target: {
      canvas: { width: 1440, height: 1440 },
      box: { x: 180, y: 220, width: 960, height: 900 },
      safeBox: { x: 120, y: 160, width: 1120, height: 1020 },
      slotRole: 'hero-product'
    }
  });

  assert(plan.version === 'design-placement-intelligence/v0', 'DPI candidate ranking should keep stable version', plan);
  assert(plan.candidates.length >= 2, 'DPI should rank more than one placement candidate', plan);
  assert(plan.selectedCandidateId, 'DPI should expose selectedCandidateId after ranking', plan);
  const selected = plan.candidates.find((candidate) => candidate.candidateId === plan.selectedCandidateId);
  assert(selected, 'selectedCandidateId should point to an existing candidate', plan);
  assert(selected.asset.name === '白色短袜.jpg', 'preference-matched white-background candidate should rank first', plan.candidates.map((candidate) => ({
    name: candidate.asset.name,
    totalScore: candidate.scorecard.totalScore,
    selected: candidate.candidateId === plan.selectedCandidateId,
    preferenceMatch: candidate.preferenceMatch
  })));
  assert(selected.preferenceMatch?.status === 'matched', 'selected candidate should expose matched preferences', selected);
  assert(selected.preferenceMatch.matchedPreferences.includes('浅色干净'), 'selected candidate should list matched user preference', selected.preferenceMatch);
  assert(selected.preferenceMatch.matchedCategories.includes('learning-case'), 'selected candidate should match approved design-learning visual case hints', selected.preferenceMatch);
  assert(selected.preferenceMatch.matchedLearningCaseIds.includes('local-memory:approved-learning-white-socks-card'), 'selected candidate should expose matched learning case id for audit', selected.preferenceMatch);
  assert(
    selected.scorecard.items.some((item) => item.id === 'user-preference-match' && item.points > 0),
    'scorecard should include a positive preference/learning match item',
    selected.scorecard
  );
  const darkCandidate = plan.candidates.find((candidate) => candidate.asset.name === '黑色短袜.jpg');
  assert(darkCandidate, 'fixture should keep dark candidate for comparison', plan.candidates);
  assert(
    selected.scorecard.totalScore > darkCandidate.scorecard.totalScore,
    'matched preference candidate should outrank non-matching candidate',
    { selected: selected.scorecard, dark: darkCandidate.scorecard }
  );
  assert(plan.reviewRequirements.some((item) => item.type === 'preference_match_review_required'), 'plan should require review before preferences affect final quality claim', plan.reviewRequirements);
  assert(plan.canClaimDesignQuality === false, 'preference ranking must not claim design quality', plan);
  assert(plan.boundaries.noPhotoshopWrites === true, 'preference ranking must not write Photoshop', plan.boundaries);
  assert(isDesignPlacementIntelligencePayloadSafe(plan), 'DPI preference ranking payload should pass safety check', plan);
  assertNoUnsafePayload(plan, 'DPI preference ranking plan');

  const packageJson = JSON.parse(read('package.json'));
  assert(packageJson.scripts['smoke:design-placement:candidate-ranking'], 'package script should expose DPI candidate ranking smoke');

  console.log(JSON.stringify({
    success: true,
    checks: [
      'DPI ranks multiple candidates with user preference evidence',
      'approved design-learning visual case hints affect candidate ranking evidence',
      'matched preference candidate is selected without changing Photoshop execution',
      'preference scorecard remains explainable and does not use confidence fields',
      'preference ranking requires review before any design quality claim',
      'raw/base64 image payloads are not exposed'
    ]
  }, null, 2));
}

run();
