#!/usr/bin/env node

const path = require('path');

require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '..', 'tsconfig.main.json')
});

const fs = require('fs');
const repoRoot = path.resolve(__dirname, '..');

const {
  buildDesignLearningDailyResearchPlan
} = require('../src/shared/design-learning-experience.ts');

const {
  runDesignLearningRuntime
} = require('../src/shared/design-learning-runtime-runner.ts');

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
    '置信',
    'C:\\Users\\',
    'D:\\Eagle\\library'
  ];
  const found = forbidden.filter((token) => text.includes(token));
  assert(found.length === 0, `${label} must not expose unsafe payloads, confidence markers or local paths: ${found.join(', ')}`, value);
}

function buildPlan() {
  return buildDesignLearningDailyResearchPlan({
    date: '2026-05-29',
    cadence: 'daily',
    topics: ['袜子主图', 'SKU 色卡精修'],
    sourceAvailability: {
      eagleReadonly: true,
      webSearch: true,
      projectCases: true,
      visualAnalysis: true
    },
    maxReferences: 3
  });
}

async function run() {
  const plan = buildPlan();
  const callLog = [];
  const result = await runDesignLearningRuntime({
    plan,
    generatedAt: '2026-05-29T03:00:00.000Z',
    sourceProviders: {
      eagleReadonly: async ({ topics, maxItems }) => {
        callLog.push(`eagle:${topics.join('/')}:${maxItems}`);
        return [{
          referenceId: 'eagle-sock-white-card',
          title: '白底袜子 SKU 色卡',
          sourceType: 'eagle_visual_case',
          tags: ['socks', 'sku', 'white-background'],
          sourceUrl: 'eagle://item/eagle-sock-white-card'
        }];
      },
      webSearch: async () => {
        callLog.push('web');
        return [{
          referenceId: 'web-clean-sock-main-image',
          title: 'Clean Sock Main Image',
          sourceType: 'external_reference',
          tags: ['main-image', 'clean-layout'],
          sourceUrl: 'https://example.com/sock-reference'
        }];
      },
      projectCases: async () => {
        callLog.push('project');
        return [{
          referenceId: 'project-c1163-current',
          title: 'C-1163 项目案例',
          sourceType: 'manual_reference',
          tags: ['project-case', 'c1163'],
          sourceUrl: '%USERPROFILE%\\unsafe\\case.jpg'
        }];
      }
    },
    analyzeReference: async (reference) => {
      callLog.push(`analyze:${reference.referenceId}`);
      return {
        referenceId: reference.referenceId,
        analysisSource: 'runtime-visual-analysis-adapter',
        observedAt: '2026-05-29T03:01:00.000Z',
        productCategory: 'socks',
        designType: reference.tags.includes('sku') ? 'sku-color-card' : 'main-image-reference',
        summary: `${reference.title} 通过统一节奏、自然阴影和清晰留白形成干净可信的商品视觉。`,
        strengths: [
          {
            aspect: 'composition',
            observation: '主体重复节奏整齐，视觉扫描成本低。',
            reason: '同类商品并排时，统一基线和间距能降低比较成本。',
            suitableFor: ['sku-color-card', 'main-image']
          },
          {
            aspect: 'lighting',
            observation: '阴影柔和且方向一致，白底不显脏。',
            reason: '稳定接触阴影能保留真实感，同时不抢商品主体。',
            suitableFor: ['white-background', 'product-reference']
          }
        ],
        suitableScenarios: ['袜子 SKU 色卡', '白底主图', '低广告感商品展示'],
        avoidWhen: ['强情绪海报', '背景场景化详情页首屏'],
        reusableHeuristics: ['统一袜口基线', '保留柔和接触阴影', '浅色商品需避免高光溢出'],
        reviewStatus: 'needs_human_review',
        sourceNotes: [`source=${reference.sourceType}`],
        limitations: ['需要人工复核是否适合当前品牌。']
      };
    }
  });

  assert(result.version === 'design-learning-runtime-runner/v0', 'runtime runner should expose stable version', result);
  assert(result.status === 'completed_ready_for_review', 'runtime runner should complete when providers and analysis succeed', result);
  assert(result.referenceCandidates.length === 3, 'runtime runner should collect bounded references from all enabled sources', result.referenceCandidates);
  assert(result.experienceIndex?.status === 'ready_for_review', 'runtime runner should build a learning experience index', result.experienceIndex);
  assert(result.memoryCandidates.length === 3, 'runtime runner should prepare needs-review memory candidates', result.memoryCandidates);
  assert(result.memoryCandidates.every((item) => item.status === 'needs_review'), 'runtime memory candidates must stay needs_review before review', result.memoryCandidates);
  assert(result.boundaries.doesNotWriteEagle === true, 'runtime runner must not write Eagle', result.boundaries);
  assert(result.boundaries.noPhotoshopWrites === true, 'runtime runner must not write Photoshop', result.boundaries);
  assert(result.boundaries.doesNotPersistMemory === true, 'runtime runner must not persist memory by itself', result.boundaries);
  assert(result.boundaries.searchCallsRequireInjection === true, 'runtime runner search calls must require injected adapters', result.boundaries);
  assert(result.boundaries.providerCallsRequireInjection === true, 'runtime runner provider calls must require injected adapters', result.boundaries);
  assert(result.canRunPhotoshop === false && result.canWriteEagle === false && result.canPersistMemory === false, 'runtime runner must keep execution side effects disabled', result);
  assert(callLog.includes('web') && callLog.includes('project') && callLog.some((item) => item.startsWith('eagle:')), 'runtime should call injected source providers only', callLog);
  assertNoUnsafePayload(result, 'successful runtime result');

  const visualCaseResult = await runDesignLearningRuntime({
    plan,
    generatedAt: '2026-05-29T03:02:00.000Z',
    sourceProviders: {
      projectCases: async () => [{
        referenceId: 'project-visual-case',
        title: '项目视觉案例',
        sourceType: 'manual_reference',
        tags: ['project-case']
      }]
    },
    analyzeReference: async (reference) => ({
      referenceId: reference.referenceId,
      analysisSource: 'runtime-visual-analysis-adapter',
      summary: '主体、留白与阴影形成清晰的商品层级。',
      strengths: [
        { aspect: 'composition', observation: '主体突出', reason: '四周留白稳定', suitableFor: ['main-image'] },
        { aspect: 'lighting', observation: '阴影自然', reason: '保留商品接触感', suitableFor: ['product-reference'] }
      ],
      suitableScenarios: ['主图'],
      reusableHeuristics: ['主体与边缘保持安全距离'],
      visualCase: {
        previewDataUrl: 'data:image/png;base64,AAA',
        sourceKind: 'project_image',
        subjectRect: { x: 0.2, y: 0.2, w: 0.6, h: 0.6 },
        showCompositionGrid: true,
        caption: '项目图 · 视觉案例'
      }
    })
  });
  assert(
    visualCaseResult.memoryCandidates[0]?.visualCase?.caption === '项目图 · 视觉案例',
    'runtime observation normalization must preserve the sanitized visual case for review',
    visualCaseResult.memoryCandidates
  );

  const noAnalysis = await runDesignLearningRuntime({
    plan,
    generatedAt: '2026-05-29T03:05:00.000Z',
    sourceProviders: {
      eagleReadonly: async () => [{ referenceId: 'eagle-only', title: 'Eagle only', sourceType: 'eagle_visual_case', tags: ['socks'] }]
    }
  });
  assert(noAnalysis.status === 'blocked_missing_visual_analysis', 'runtime should block when references exist but no analysis adapter is available', noAnalysis);
  assert(noAnalysis.memoryCandidates.length === 0, 'blocked runtime must not prepare memory candidates', noAnalysis);

  const empty = await runDesignLearningRuntime({
    plan,
    generatedAt: '2026-05-29T03:10:00.000Z',
    sourceProviders: {
      eagleReadonly: async () => [],
      webSearch: async () => [],
      projectCases: async () => []
    },
    analyzeReference: async () => {
      throw new Error('should not analyze empty reference set');
    }
  });
  assert(empty.status === 'blocked_no_references', 'runtime should block when no providers return references', empty);
  assert(empty.experienceIndex === undefined, 'empty runtime should not fabricate experience index', empty);

  const weak = await runDesignLearningRuntime({
    plan,
    generatedAt: '2026-05-29T03:15:00.000Z',
    sourceProviders: {
      eagleReadonly: async () => [{ referenceId: 'weak-eagle-case', title: 'Only Metadata', sourceType: 'eagle_visual_case', tags: ['socks'] }]
    },
    analyzeReference: async (reference) => ({
      referenceId: reference.referenceId,
      analysisSource: 'metadata-only',
      summary: '只有文件名和标签，不足以说明为什么好看。',
      strengths: [{ aspect: 'tag', observation: '有 socks 标签', reason: '' }],
      suitableScenarios: [],
      reusableHeuristics: []
    })
  });
  assert(weak.status === 'blocked_missing_visual_analysis', 'weak metadata-only analysis must not become learning experience', weak);
  assert(weak.memoryCandidates.length === 0, 'weak metadata-only analysis must not prepare memory candidates', weak);

  const completeMetadataOnly = await runDesignLearningRuntime({
    plan,
    generatedAt: '2026-05-29T03:16:00.000Z',
    sourceProviders: {
      eagleReadonly: async () => [{ referenceId: 'complete-metadata-only', title: 'Metadata Complete', sourceType: 'eagle_visual_case', tags: ['socks', 'layout'] }]
    },
    analyzeReference: async (reference) => ({
      referenceId: reference.referenceId,
      analysisSource: 'metadata-only',
      summary: '结构字段看似完整，但只有标签和标题，不能说明为什么好看。',
      strengths: [
        {
          aspect: 'tag-layout',
          observation: '标签显示 layout。',
          reason: '这只是元数据标签，不是视觉观察理由。',
          suitableFor: ['metadata-review']
        },
        {
          aspect: 'tag-socks',
          observation: '标签显示 socks。',
          reason: '这只是商品类目标签，不是设计成立理由。',
          suitableFor: ['metadata-review']
        }
      ],
      suitableScenarios: ['元数据整理'],
      reusableHeuristics: ['不要把标签当设计经验'],
      reviewStatus: 'needs_human_review',
      sourceNotes: ['metadata-only']
    })
  });
  assert(completeMetadataOnly.status === 'blocked_missing_visual_analysis', 'complete metadata-only analysis must still be blocked', completeMetadataOnly);
  assert(completeMetadataOnly.memoryCandidates.length === 0, 'complete metadata-only analysis must not prepare memory candidates', completeMetadataOnly);

  const unsafeObservationPayload = await runDesignLearningRuntime({
    plan,
    generatedAt: '2026-05-29T03:17:00.000Z',
    sourceProviders: {
      eagleReadonly: async () => [{ referenceId: 'unsafe-extra-fields', title: 'Unsafe Extra Fields', sourceType: 'eagle_visual_case', tags: ['socks', 'sku'] }],
      webSearch: async () => [],
      projectCases: async () => []
    },
    analyzeReference: async (reference) => ({
      referenceId: reference.referenceId,
      analysisSource: 'runtime-visual-analysis-adapter',
      summary: '有效观察中夹带不应进入结果的原始字段。',
      strengths: [
        {
          aspect: 'composition',
          observation: '主体基线统一。',
          reason: '统一基线降低比较成本。',
          suitableFor: ['sku-color-card']
        },
        {
          aspect: 'lighting',
          observation: '阴影方向一致。',
          reason: '统一阴影保持真实感。',
          suitableFor: ['white-background']
        }
      ],
      suitableScenarios: ['SKU 色卡'],
      reusableHeuristics: ['统一基线', '统一阴影方向'],
      sourceNotes: ['safe-source-note'],
      rawImage: 'raw-image-payload',
      imageBase64: 'data:image/png;base64,abcd',
      localPath: '%USERPROFILE%\\Desktop\\secret.png',
      confidence: 0.99
    })
  });
  assert(unsafeObservationPayload.status === 'completed_ready_for_review', 'safe known fields should still produce reviewable learning', unsafeObservationPayload);
  assertNoUnsafePayload(unsafeObservationPayload, 'runtime result with unsafe extra observation fields');

  const packageJson = JSON.parse(read('package.json'));
  assert(packageJson.scripts['smoke:design-learning:runtime-runner'], 'package script should expose design learning runtime runner smoke');
  assert(packageJson.scripts['maintenance:preflight'].includes('smoke:design-learning:runtime-runner'), 'maintenance preflight should include design learning runtime runner smoke');

  const boundaries = read('scripts/report-change-boundaries.cjs');
  assert(boundaries.includes('design-learning-runtime-runner'), 'change boundary matcher should include design learning runtime runner');
  assert(boundaries.includes('smoke:design-learning:runtime-runner'), 'change boundary validation should include design learning runtime runner smoke');

  const hygiene = read('scripts/validate-maintenance-hygiene.cjs');
  assert(hygiene.includes('smoke-design-learning-runtime-runner.cjs'), 'maintenance hygiene should check design learning runtime runner smoke');

  console.log(JSON.stringify({
    success: true,
    checks: [
      'runtime runner calls injected Eagle/web/project reference providers and analysis adapter',
      'runtime runner builds design-learning-experience index and needs-review memory candidates',
      'runtime runner blocks missing references and missing analysis instead of fabricating learning',
      'runtime runner blocks complete metadata-only analysis instead of treating tags as design experience',
      'runtime runner does not write Eagle, write Photoshop or persist memory by itself',
      'raw/base64 image payload markers, confidence fields, extra adapter fields and local paths are redacted',
      'package, preflight, change-boundary and maintenance hygiene wiring are present'
    ]
  }, null, 2));
}

run().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
