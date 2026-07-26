#!/usr/bin/env node

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
  buildBusinessSkillMemoryContext
} = require(path.join(repoRoot, 'src', 'shared', 'business-skill-memory-context.ts'));
const {
  buildDetailPagePlannerContext,
  buildSkuBatchPlannerContext
} = require(path.join(repoRoot, 'src', 'renderer', 'services', 'skill-executors', 'design-planner-context.ts'));

function assert(condition, message, details) {
  if (!condition) {
    const suffix = details ? `\n${JSON.stringify(details, null, 2)}` : '';
    throw new Error(`${message}${suffix}`);
  }
}

function assertNoRawPayload(value, label) {
  const serialized = JSON.stringify(value);
  const forbidden = ['raw-image-payload', 'base64-image-payload', 'data:image/'];
  const found = forbidden.filter((token) => serialized.includes(token));
  assert(found.length === 0, `${label} must not retain raw image-like payloads: ${found.join(', ')}`, value);
}

function assertNoConfidence(value, label) {
  const serialized = JSON.stringify(value);
  assert(!serialized.includes('"confidence"') && !serialized.includes('置信'), `${label} must not expose confidence fields`, value);
}

const localMemoryKnowledge = [
  {
    id: 'local-memory:user-preference-style-clean',
    title: '偏好风格：浅色干净',
    intent: 'rule',
    sourceType: 'local_case',
    summary: '用户偏好风格为 浅色干净，可影响策略排序，但不能替代视觉证据。',
    sourceNotes: ['记忆类型：user_preference', '来源：manual_setting', 'manual_setting：来自用户偏好设置。'],
    tags: ['design-memory', 'user_preference', 'manual_setting', 'style', '浅色干净'],
    allowedUses: ['prompt_context', 'user_reference'],
    sourceLevel: 'local_case',
    sourceRank: 78,
    updatedAt: '2026-05-26T00:00:00.000Z'
  },
  {
    id: 'local-memory:user-preference-font-puhuiti',
    title: '常用字体：阿里巴巴普惠体',
    intent: 'rule',
    sourceType: 'local_case',
    summary: '用户历史操作中多次使用或记录了字体 阿里巴巴普惠体，只能作为排版候选偏好。',
    sourceNotes: ['记忆类型：user_preference', '来源：inferred_from_operations', 'inferred_from_operations：来自本地记忆的字体偏好，未等同于当前任务要求。'],
    tags: ['design-memory', 'user_preference', 'inferred_from_operations', 'font', 'typography', '阿里巴巴普惠体'],
    allowedUses: ['prompt_context', 'user_reference'],
    sourceLevel: 'local_case',
    sourceRank: 52
  },
  {
    id: 'local-memory:user-preference-color-ecru',
    title: '常用颜色：奶白',
    intent: 'rule',
    sourceType: 'local_case',
    summary: '用户历史操作中记录了颜色 奶白，只能作为配色候选偏好。',
    sourceNotes: ['记忆类型：user_preference', '来源：inferred_from_operations', 'inferred_from_operations：来自本地记忆的颜色偏好，不能覆盖商品、品牌或平台规范。'],
    tags: ['design-memory', 'user_preference', 'inferred_from_operations', 'color', '奶白'],
    allowedUses: ['prompt_context', 'user_reference'],
    sourceLevel: 'local_case',
    sourceRank: 52
  },
  {
    id: 'local-memory:approved-learning-socks-card',
    title: '袜子 SKU 色卡整齐排布经验',
    intent: 'reference',
    sourceType: 'local_case',
    summary: '整齐重复、统一阴影和充足留白适合基础袜 SKU 色卡和白底组合展示；好处是降低颜色对比时的视觉噪音。',
    sourceNotes: [
      '记忆类型：visual_case',
      '来源：imported_case',
      'design-learning-experience：reference=eagle-case:socks-card; heuristics=3',
      'design-learning-review：review=approved; reviewer=designer'
    ],
    tags: ['design-memory', 'visual_case', 'imported_case', 'design-learning', 'reviewed-design-learning', 'socks', 'sku', 'white-background', 'soft-shadow'],
    allowedUses: ['prompt_context', 'user_reference', 'recipe_hint'],
    sourceLevel: 'local_case',
    sourceRank: 80,
    updatedAt: '2026-06-02T00:00:00.000Z'
  },
  {
    id: 'local-memory:blocked-direct-action',
    title: '不能进入策略的动作',
    intent: 'reference',
    sourceType: 'local_case',
    summary: '该项只能用于直接 Photoshop 动作 raw-image-payload data:image/png;base64,abc。',
    sourceNotes: ['should be filtered'],
    tags: ['design-memory', 'user_preference'],
    allowedUses: ['direct_photoshop_action'],
    sourceLevel: 'local_case',
    sourceRank: 100
  }
];

function run() {
  const detailContext = buildBusinessSkillMemoryContext({
    scenario: 'detail-page',
    userText: '帮我做详情页，保持浅色干净',
    knowledgeResults: localMemoryKnowledge
  });
  assert(detailContext.version === 'business-skill-memory-context/v0', 'business memory context version mismatch', detailContext);
  assert(detailContext.scenario === 'detail-page', 'detail context scenario mismatch', detailContext);
  assert(detailContext.status === 'available', 'detail page memory should be available', detailContext);
  assert(detailContext.preferenceSummary.sourceResultCount === 4, 'detail page should count only usable local memories', detailContext.preferenceSummary);
  assert(detailContext.preferenceSummary.stylePreferences.includes('浅色干净'), 'detail page should extract style preference', detailContext.preferenceSummary);
  assert(detailContext.preferenceSummary.typographyPreferences.includes('阿里巴巴普惠体'), 'detail page should extract typography preference', detailContext.preferenceSummary);
  assert(detailContext.preferenceSummary.colorPreferences.includes('奶白'), 'detail page should extract color preference', detailContext.preferenceSummary);
  assert(detailContext.preferenceSummary.learningCaseHints.length === 1, 'approved design-learning visual cases should become learningCaseHints', detailContext.preferenceSummary);
  assert(detailContext.preferenceSummary.learningCaseHints[0].title.includes('袜子 SKU 色卡'), 'learningCaseHints should retain safe designer-facing title', detailContext.preferenceSummary.learningCaseHints);
  assert(detailContext.strategyInputPatch.designMemory.sourceResultCount === 4, 'detail context should expose generic designMemory patch', detailContext.strategyInputPatch);
  assert(detailContext.strategyInputPatch.designMemory.learningCaseHints.length === 1, 'learningCaseHints should flow into strategy input patch', detailContext.strategyInputPatch);
  assert(detailContext.noPhotoshopWrites === true && detailContext.mustNotExecutePhotoshop === true, 'detail context must be read-only', detailContext);
  assert(!Object.prototype.hasOwnProperty.call(detailContext, 'sourceNotes'), 'memory context must not fabricate module self-notes', detailContext);
  assertNoRawPayload(detailContext, 'detail page business memory context');
  assertNoConfidence(detailContext, 'detail page business memory context');

  const skuContext = buildBusinessSkillMemoryContext({
    scenario: 'sku',
    userText: '帮我做 SKU 和自选备注',
    knowledgeResults: localMemoryKnowledge
  });
  assert(skuContext.scenario === 'sku', 'SKU context scenario mismatch', skuContext);
  assert(skuContext.preferenceSummary.sourceResultCount === 4, 'SKU should count only usable local memories', skuContext.preferenceSummary);
  assert(skuContext.preferenceSummary.learningCaseHints.length === 1, 'SKU should receive approved learning case hints for strategy ranking only', skuContext.preferenceSummary);
  assert(skuContext.limitations.some((item) => item.includes('不能改变 SKU 自选备注')), 'SKU context should preserve note intent boundary', skuContext.limitations);
  assert(skuContext.limitations.some((item) => item.includes('已复核设计学习经验只能影响候选排序')), 'SKU context should keep learning case boundary', skuContext.limitations);
  assertNoRawPayload(skuContext, 'SKU business memory context');
  assertNoConfidence(skuContext, 'SKU business memory context');
  assert(!Object.prototype.hasOwnProperty.call(skuContext, 'sourceNotes'), 'SKU memory context must not fabricate module self-notes', skuContext);

  const detailPlanner = buildDetailPagePlannerContext({
    userInput: '帮我做详情页',
    params: { knowledgeResults: localMemoryKnowledge },
    context: { projectContext: { projectPath: 'C:/project' } },
    projectPath: 'C:/project',
    screenCount: 8,
    mode: 'inspect',
    readinessMode: 'inspect',
    screenPlanCount: 0
  });
  assert(detailPlanner.businessSkillMemoryContext?.scenario === 'detail-page', 'detail planner should expose business memory context', detailPlanner.businessSkillMemoryContext);
  assert(detailPlanner.businessSkillMemoryContext.preferenceSummary.sourceResultCount === 4, 'detail planner memory count mismatch', detailPlanner.businessSkillMemoryContext);
  assert(detailPlanner.businessSkillMemoryContext.preferenceSummary.learningCaseHints.length === 1, 'detail planner should expose approved learning case hints', detailPlanner.businessSkillMemoryContext);
  assertNoConfidence(detailPlanner.businessSkillMemoryContext, 'detail planner memory context');

  const skuPlanner = buildSkuBatchPlannerContext({
    userInput: '帮我做 SKU 自选备注',
    params: { knowledgeResults: localMemoryKnowledge },
    context: { projectContext: { projectPath: 'C:/project' } },
    projectPath: 'C:/project',
    comboSizes: [2, 3, 4],
    colorCount: 5,
    totalCombinations: 30,
    processedSizeCount: 0
  });
  assert(skuPlanner.businessSkillMemoryContext?.scenario === 'sku', 'SKU planner should expose business memory context', skuPlanner.businessSkillMemoryContext);
  assert(skuPlanner.businessSkillMemoryContext.preferenceSummary.sourceResultCount === 4, 'SKU planner memory count mismatch', skuPlanner.businessSkillMemoryContext);
  assert(skuPlanner.businessSkillMemoryContext.preferenceSummary.learningCaseHints.length === 1, 'SKU planner should expose approved learning case hints', skuPlanner.businessSkillMemoryContext);
  assert(
    skuPlanner.businessSkillMemoryContext.limitations.some((item) => item.includes('不能改变 SKU 自选备注')),
    'SKU planner memory context must preserve note boundary',
    skuPlanner.businessSkillMemoryContext
  );
  assertNoRawPayload(skuPlanner.businessSkillMemoryContext, 'SKU planner memory context');
  assertNoConfidence(skuPlanner.businessSkillMemoryContext, 'SKU planner memory context');

  console.log(JSON.stringify({
    success: true,
    checks: [
      'detail-page and SKU consume local_case preferences as structured businessSkillMemoryContext',
      'business memory evidence stays read-only and optional',
      'direct Photoshop actions and raw image payloads are filtered',
      'SKU memory evidence preserves self-select note intent boundaries',
      'approved design-learning visual cases become learningCaseHints without becoming tool params',
      'detail/SKU planner evidence exposes memory without tool execution'
    ]
  }, null, 2));
}

try {
  run();
} catch (error) {
  console.error(error);
  process.exit(1);
}
