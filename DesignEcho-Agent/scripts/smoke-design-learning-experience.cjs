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
  buildDesignLearningDailyResearchPlan,
  buildDesignLearningExperienceIndex,
  designLearningExperiencesToMemoryItems,
  isDesignLearningExperiencePayloadSafe
} = require('../src/shared/design-learning-experience.ts');

const {
  buildEagleVisualCaseIndexFromReadonlyKnowledge
} = require('../src/shared/eagle-visual-case-index.ts');

const {
  searchDesignMemoryKnowledge
} = require('../src/shared/design-memory-knowledge.ts');

const {
  normalizeEagleReadonlyKnowledgeResults
} = require('../src/shared/eagle-readonly-knowledge.ts');

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
    'D:/Eagle/library',
    'C:/Users/'
  ];
  const found = forbidden.filter((token) => text.includes(token));
  assert(found.length === 0, `${label} should not expose unsafe payloads, confidence markers or local paths: ${found.join(', ')}`, value);
}

function buildVisualCaseIndex() {
  const readonlyKnowledge = normalizeEagleReadonlyKnowledgeResults(
    { query: 'socks ecommerce references', limit: 5 },
    [
      {
        id: 'eagle-clean-socks-main',
        name: 'clean-socks-main-reference.jpg',
        ext: 'jpg',
        tags: ['socks', 'main-image', 'white-background', 'soft-shadow', 'clean-layout'],
        folders: ['Ecommerce References', 'Socks'],
        width: 1440,
        height: 1440,
        annotation: 'Five socks aligned with generous white space.',
        filePath: 'D:/Eagle/library/clean-socks-main-reference.jpg',
        thumbnailPath: 'D:/Eagle/library/.thumb/clean-socks-main-reference.jpg',
        url: 'https://example.com/clean-socks-main',
        updatedAt: '2026-05-29T00:00:00.000Z'
      }
    ],
    { sourceTool: 'item_query', nowIso: '2026-05-29T00:00:00.000Z' }
  );
  return buildEagleVisualCaseIndexFromReadonlyKnowledge(readonlyKnowledge, {
    purpose: 'design_reference',
    requestedBy: 'smoke-design-learning'
  });
}

function run() {
  const dailyPlan = buildDesignLearningDailyResearchPlan({
    date: '2026-05-29',
    cadence: 'daily',
    topics: ['袜子主图', 'SKU 色卡精修', '详情页首屏'],
    sourceAvailability: {
      eagleReadonly: true,
      webSearch: true,
      projectCases: true,
      visualAnalysis: true
    },
    maxReferences: 6
  });

  assert(dailyPlan.version === 'design-learning-daily-research-plan/v0', 'daily learning plan should expose stable version', dailyPlan);
  assert(dailyPlan.status === 'ready_for_runtime', 'daily learning plan should be ready when sources are available', dailyPlan);
  assert(dailyPlan.cadence === 'daily', 'daily learning plan should preserve daily cadence', dailyPlan);
  assert(dailyPlan.steps.some((step) => step.kind === 'collect_references' && step.sources.includes('eagle_readonly')), 'daily plan should include Eagle readonly reference collection', dailyPlan.steps);
  assert(dailyPlan.steps.some((step) => step.kind === 'collect_references' && step.sources.includes('web_search')), 'daily plan should include web search as a source when available', dailyPlan.steps);
  assert(dailyPlan.steps.some((step) => step.kind === 'analyze_reference_design'), 'daily plan should require design analysis, not just collecting', dailyPlan.steps);
  assert(dailyPlan.steps.some((step) => step.kind === 'extract_reusable_experience'), 'daily plan should extract reusable experience', dailyPlan.steps);
  assert(dailyPlan.boundaries.doesNotExecuteSearch === true, 'plan builder must not execute search by itself', dailyPlan.boundaries);
  assert(dailyPlan.boundaries.doesNotCallProvider === true, 'plan builder must not call a provider by itself', dailyPlan.boundaries);
  assert(dailyPlan.boundaries.noPhotoshopWrites === true, 'daily plan must not write Photoshop', dailyPlan.boundaries);
  assertNoUnsafePayload(dailyPlan, 'daily learning plan');

  const noSourcePlan = buildDesignLearningDailyResearchPlan({
    date: '2026-05-29',
    cadence: 'daily',
    topics: ['袜子主图'],
    sourceAvailability: {},
    maxReferences: 6
  });
  assert(noSourcePlan.status === 'blocked_no_reference_sources', 'daily plan should block when no reference sources are available', noSourcePlan);
  assert(noSourcePlan.steps.length === 0, 'blocked daily plan must not fabricate runtime steps', noSourcePlan);

  const visualCaseIndex = buildVisualCaseIndex();
  const experienceIndex = buildDesignLearningExperienceIndex({
    generatedAt: '2026-05-29T00:30:00.000Z',
    sourceLabel: 'daily-reference-learning',
    visualCaseIndex,
    observations: [
      {
        referenceId: 'eagle-case:eagle-clean-socks-main',
        analysisSource: 'model_visual_analysis',
        observedAt: '2026-05-29T00:25:00.000Z',
        productCategory: 'socks',
        designType: 'main-image',
        summary: '白底袜子主图通过整齐重复、柔和阴影和充足留白建立干净可信的 SKU 视觉。',
        strengths: [
          {
            aspect: 'composition',
            observation: '五只袜子沿同一视觉基线排列，顶部编号和底部色名形成稳定阅读节奏。',
            reason: '重复节奏降低比较成本，用户能快速看出颜色差异和组合关系。',
            suitableFor: ['多色 SKU 色卡', '需要快速比较颜色的主图']
          },
          {
            aspect: 'lighting',
            observation: '阴影很轻但方向一致，白袜仍保留边缘和针织纹理。',
            reason: '统一阴影让白底不漂浮，纹理保留能提升真实感。',
            suitableFor: ['白底主图', '浅色袜子色卡']
          },
          {
            aspect: 'spacing',
            observation: '主体之间保持等距留白，数字、商品和色名上下分区明确。',
            reason: '留白把信息分层，避免用户把色名、编号和商品主体混在一起。',
            suitableFor: ['电商主图', 'SKU 组合说明图']
          }
        ],
        suitableScenarios: ['袜子 SKU 色卡', '淘宝天猫白底主图', '需要强调颜色完整性的组合图'],
        avoidWhen: ['花边罗口或异形袜口需要展示差异时，不应强行统一袜口形态。'],
        reusableHeuristics: [
          '同款多色产品优先统一主体基线、顶部高度和阴影方向，再保留颜色与材质差异。',
          '白底浅色产品必须保留边缘、接触阴影和纹理，不要为了白场把产品抹平。',
          '编号、主体、色名应按垂直信息层分区，避免文字贴近商品边缘。'
        ],
        reviewStatus: 'needs_human_review'
      }
    ]
  });

  assert(experienceIndex.version === 'design-learning-experience/v0', 'experience index should expose stable version', experienceIndex);
  assert(experienceIndex.status === 'ready_for_review', 'strong observations should produce reviewable experiences', experienceIndex);
  assert(experienceIndex.summary.recordCount === 1, 'experience index should contain one learned record', experienceIndex.summary);
  assert(experienceIndex.summary.memoryCandidateCount === 1, 'experience index should expose memory candidates', experienceIndex.summary);
  const record = experienceIndex.records[0];
  assert(record.title.includes('clean-socks-main-reference'), 'experience title should preserve reference trace', record);
  assert(record.whatLooksGood.length >= 3, 'experience should explain what looks good', record);
  assert(record.whyItWorks.length >= 3, 'experience should explain why it works', record);
  assert(record.suitableScenarios.includes('袜子 SKU 色卡'), 'experience should keep suitable scenarios', record);
  assert(record.avoidWhen.some((item) => item.includes('花边罗口')), 'experience should preserve when not to use the pattern', record);
  assert(record.reusableHeuristics.length >= 3, 'experience should extract reusable heuristics', record);
  assert(record.reviewStatus === 'needs_human_review', 'learning output should remain review-gated before becoming durable rule', record);
  assert(record.canBecomeMemory === true, 'reviewable experience should be convertible into memory candidate', record);
  assert(experienceIndex.boundaries.noPhotoshopWrites === true, 'experience builder must not write Photoshop', experienceIndex.boundaries);
  assert(experienceIndex.boundaries.doesNotWriteEagle === true, 'experience builder must not write Eagle', experienceIndex.boundaries);
  assert(experienceIndex.boundaries.doesNotCallProvider === true, 'experience builder must not call provider', experienceIndex.boundaries);
  assert(experienceIndex.boundaries.doesNotExecuteSearch === true, 'experience builder must not execute search', experienceIndex.boundaries);
  assert(isDesignLearningExperiencePayloadSafe(experienceIndex), 'experience index should pass safety check', experienceIndex);
  const unsafeLocalPathPayload = { source: '%USERPROFILE%/Desktop/reference.png' };
  assert(isDesignLearningExperiencePayloadSafe(unsafeLocalPathPayload) === false, 'payload safety should reject local paths on first check', unsafeLocalPathPayload);
  assert(isDesignLearningExperiencePayloadSafe(unsafeLocalPathPayload) === false, 'payload safety should reject local paths on repeated checks', unsafeLocalPathPayload);
  assertNoUnsafePayload(experienceIndex, 'experience index');

  const memoryItems = designLearningExperiencesToMemoryItems(experienceIndex, {
    scope: { type: 'user', id: 'default' },
    now: '2026-05-29T00:35:00.000Z'
  });
  assert(memoryItems.length === 1, 'experience index should convert to one memory candidate', memoryItems);
  assert(memoryItems[0].kind === 'visual_case', 'learning memory should remain a visual_case before approval', memoryItems[0]);
  assert(memoryItems[0].status === 'needs_review', 'unreviewed learning memory must not be top-level active', memoryItems[0]);
  assert(memoryItems[0].source === 'imported_case', 'learning memory should preserve imported case source', memoryItems[0]);
  assert(memoryItems[0].sourceNotes.some((item) => item.status === 'needs_review'), 'learning memory source note should require review before durable use', memoryItems[0]);
  const searchableBeforeReview = searchDesignMemoryKnowledge(
    { query: '袜子 SKU 色卡', intents: ['reference'], sourceTypes: ['local_case'], limit: 5 },
    memoryItems
  );
  assert(searchableBeforeReview.length === 0, 'unreviewed learning memory must not enter active design knowledge search', searchableBeforeReview);
  assertNoUnsafePayload(memoryItems, 'learning memory candidates');

  const weakIndex = buildDesignLearningExperienceIndex({
    generatedAt: '2026-05-29T00:40:00.000Z',
    sourceLabel: 'weak-learning',
    visualCaseIndex,
    observations: [
      {
        referenceId: 'eagle-case:eagle-clean-socks-main',
        analysisSource: 'metadata_only',
        observedAt: '2026-05-29T00:40:00.000Z',
        summary: '看起来不错。',
        strengths: [],
        suitableScenarios: [],
        reusableHeuristics: []
      }
    ]
  });
  assert(weakIndex.status === 'blocked_missing_analysis', 'weak observation must not fabricate learning experience', weakIndex);
  assert(weakIndex.records.length === 0, 'weak observation should not produce records', weakIndex);
  assert(weakIndex.summary.memoryCandidateCount === 0, 'weak observation should not produce memory candidates', weakIndex);

  const packageJson = JSON.parse(read('package.json'));
  assert(packageJson.scripts['smoke:design-learning:experience'], 'package script should expose design learning experience smoke');
  assert(packageJson.scripts['maintenance:preflight'].includes('smoke:design-learning:experience'), 'maintenance preflight should include design learning smoke');

  const boundaries = read('scripts/report-change-boundaries.cjs');
  assert(boundaries.includes('design-learning-experience'), 'change boundary matcher should include design learning experience');
  assert(boundaries.includes('smoke:design-learning:experience'), 'change boundary validation should include design learning smoke');

  const hygiene = read('scripts/validate-maintenance-hygiene.cjs');
  assert(hygiene.includes('smoke-design-learning-experience.cjs'), 'maintenance hygiene should check design learning smoke');

  console.log(JSON.stringify({
    success: true,
    checks: [
      'daily learning plan is schedulable but does not execute search/provider/Photoshop by itself',
      'learning experience records require visual/design analysis with reasons and suitable scenarios',
      'weak metadata-only references do not fabricate reusable experience',
      'reviewable experience converts to needs-review visual_case memory candidates',
      'payload safety blocks raw images, local paths and confidence markers',
      'package, preflight, change-boundary and maintenance hygiene wiring are present'
    ]
  }, null, 2));
}

try {
  run();
} catch (error) {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
}
