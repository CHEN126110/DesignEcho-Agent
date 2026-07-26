#!/usr/bin/env node

require('ts-node').register({
  transpileOnly: true,
  project: require('path').resolve(__dirname, '..', 'tsconfig.main.json')
});

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');

const {
  buildDesignLearningDailyResearchPlan
} = require('../src/shared/design-learning-experience.ts');
const {
  runDesignLearningRuntime
} = require('../src/shared/design-learning-runtime-runner.ts');
const {
  eagleReadonlyKnowledgeToDesignLearningRuntimeReferences,
  isPublicRuntimeReferencePayloadSafe
} = require('../src/shared/eagle-design-learning-runtime-provider.ts');
const {
  normalizeEagleReadonlyKnowledgeResults
} = require('../src/shared/eagle-readonly-knowledge.ts');

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
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
    'confidence',
    '置信',
    'C:\\Users\\',
    'D:\\Eagle\\library',
    'Local file reference',
    'Thumbnail reference'
  ];
  const found = forbidden.filter((token) => text.includes(token));
  assert.strictEqual(found.length, 0, `${label} must not expose unsafe payloads, confidence markers or local paths: ${found.join(', ')}`);
}

function sampleReadonlyKnowledge() {
  return normalizeEagleReadonlyKnowledgeResults(
    {
      query: '袜子 SKU 色卡 光影 排版',
      limit: 4
    },
    [
      {
        id: 'sock-card-clean',
        name: '袜子 SKU 色卡整齐排版.jpg',
        ext: 'jpg',
        tags: ['socks', 'sku', 'color-card', 'soft-shadow'],
        folders: ['Ecommerce References', 'Socks'],
        width: 1600,
        height: 1000,
        annotation: '五色袜子统一袜口基线、间距和接触阴影。',
        filePath: 'D:\\Eagle\\library\\sock-card-clean.jpg',
        thumbnailPath: 'D:\\Eagle\\library\\.thumb\\sock-card-clean.jpg',
        imageBase64: 'data:image/png;base64,should-not-leak',
        confidence: 0.99
      },
      {
        id: 'sock-card-clean',
        name: '重复项.jpg',
        ext: 'jpg',
        tags: ['duplicate'],
        filePath: 'D:\\Eagle\\library\\duplicate.jpg'
      }
    ],
    {
      sourceTool: 'item_query',
      nowIso: '2026-06-02T00:00:00.000Z'
    }
  );
}

async function run() {
  const adapter = eagleReadonlyKnowledgeToDesignLearningRuntimeReferences(sampleReadonlyKnowledge(), {
    maxItems: 4,
    requestedBy: 'smoke-design-learning-eagle-runtime-provider',
    generatedAt: '2026-06-02T00:00:00.000Z'
  });

  assert(adapter.boundaries.readonly === true, 'adapter should preserve readonly boundary');
  assert(adapter.boundaries.doesNotExposeLocalPaths === true, 'adapter must declare public local-path redaction boundary');
  assert(adapter.boundaries.requiresVisualAnalysisBeforeMemory === true, 'adapter must require visual analysis before memory');
  assert(adapter.visualCaseSummary.caseCount === 2, 'adapter should summarize source visual cases before dedupe');
  assert(adapter.references.length === 1, 'adapter should dedupe references by Eagle case id');
  assert(adapter.references[0].referenceId === 'eagle-case:sock-card-clean', 'adapter should expose stable visual case id');
  assert(adapter.references[0].sourceType === 'eagle_visual_case', 'adapter should map to Eagle visual case runtime source type');
  assert(adapter.references[0].tags.includes('visual-learning'), 'adapter should tag learning references');
  assert(adapter.references[0].tags.includes('soft-shadow'), 'adapter should preserve safe Eagle tags');
  assert(adapter.references[0].sourceUrl === 'eagle://item/sock-card-clean', 'adapter may keep safe Eagle item URLs without exposing local paths');
  assert(isPublicRuntimeReferencePayloadSafe(adapter.references), 'public references should pass payload safety helper');
  assertNoUnsafePayload(adapter.references, 'Eagle runtime references');

  const plan = buildDesignLearningDailyResearchPlan({
    date: '2026-06-02',
    cadence: 'daily',
    topics: ['袜子 SKU 色卡', '光影统一'],
    sourceAvailability: {
      eagleReadonly: true,
      webSearch: false,
      projectCases: false,
      visualAnalysis: true
    },
    maxReferences: 2
  });
  const analyzedReferenceIds = [];
  const runtime = await runDesignLearningRuntime({
    plan,
    generatedAt: '2026-06-02T00:10:00.000Z',
    sourceProviders: {
      eagleReadonly: async () => adapter.references
    },
    analyzeReference: async (reference) => {
      analyzedReferenceIds.push(reference.referenceId);
      return {
        referenceId: reference.referenceId,
        analysisSource: 'eagle-private-visual-analysis-adapter',
        observedAt: '2026-06-02T00:11:00.000Z',
        productCategory: 'socks',
        designType: 'sku-color-card',
        summary: '袜子色卡通过统一袜口基线、稳定间距和柔和接触阴影形成干净可信的 SKU 展示。',
        strengths: [
          {
            aspect: 'composition',
            observation: '袜口基线统一，五个色块的视觉节奏稳定。',
            reason: '同品类颜色并排时，统一基线和间距能降低比较成本。',
            suitableFor: ['SKU 色卡', '多色组合展示']
          },
          {
            aspect: 'lighting',
            observation: '接触阴影方向一致，白底仍保留真实体积。',
            reason: '统一阴影能避免每个颜色看起来像来自不同拍摄条件。',
            suitableFor: ['白底图', '精修 SKU']
          }
        ],
        suitableScenarios: ['袜子 SKU 色卡', '基础款多色展示', '白底商品对比'],
        avoidWhen: ['花边袜口形态差异很大且需要突出款式差异时，不应强行统一袜口。'],
        reusableHeuristics: ['优先统一袜口基线', '保持接触阴影方向一致', '浅色袜子避免白场压掉纹理'],
        reviewStatus: 'needs_human_review',
        sourceNotes: ['source=eagle_private_path_visual_analysis'],
        limitations: ['Eagle 案例仍需人工复核后才能成为长期经验。']
      };
    },
    scope: { type: 'user', id: 'default' }
  });

  assert.deepStrictEqual(analyzedReferenceIds, ['eagle-case:sock-card-clean'], 'runtime analyzer should resolve the image by stable Eagle identity without a Renderer path');
  assert(runtime.status === 'completed_ready_for_review', 'runtime should learn from Eagle refs when a private image path and analyzer are available');
  assert(runtime.memoryCandidates.length === 1, 'runtime should prepare exactly one needs-review memory candidate');
  assert(runtime.memoryCandidates[0].status === 'needs_review', 'Eagle learning must stay needs_review before user/model review');
  assert(runtime.canWriteEagle === false && runtime.canRunPhotoshop === false && runtime.canPersistMemory === false, 'runtime must keep side effects disabled');
  assertNoUnsafePayload({
    referenceCandidates: runtime.referenceCandidates,
    observations: runtime.observations,
    experienceIndex: runtime.experienceIndex,
    memoryCandidates: runtime.memoryCandidates
  }, 'Eagle learning runtime public result');

  const packageJson = JSON.parse(read('package.json'));
  assert(packageJson.scripts['smoke:design-learning:eagle-runtime-provider'], 'package.json should expose Eagle runtime provider smoke');

  console.log(JSON.stringify({
    success: true,
    checks: [
      'Eagle readonly knowledge converts into public runtime references without local paths or raw payloads',
      'Eagle visual analysis is addressed by stable item identity without exposing private paths to Renderer',
      'Eagle learning references can produce needs-review memory candidates after visual analysis',
      'runtime output and memory candidates do not expose local paths, raw images or confidence markers',
      'Eagle learning stays read-only and cannot write Eagle, Photoshop or active memory'
    ]
  }, null, 2));
}

run().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
