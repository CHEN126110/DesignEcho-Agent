#!/usr/bin/env node

const fs = require('fs');
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
  buildBusinessSkillMemoryStrategy
} = require(path.join(repoRoot, 'src', 'shared', 'business-skill-memory-strategy.ts'));
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
    summary: '用户偏好风格为 浅色干净，适合电商页面保持白底、干净、轻阴影。',
    sourceNotes: ['记忆类型：user_preference', '来源：manual_setting'],
    tags: ['design-memory', 'user_preference', 'manual_setting', 'style', '浅色干净'],
    allowedUses: ['prompt_context', 'user_reference'],
    sourceLevel: 'local_case',
    sourceRank: 90
  },
  {
    id: 'local-memory:user-preference-font-puhuiti',
    title: '常用字体：阿里巴巴普惠体',
    intent: 'rule',
    sourceType: 'local_case',
    summary: '用户偏好偏现代、清晰的中文电商字体。',
    sourceNotes: ['记忆类型：user_preference', '来源：manual_setting'],
    tags: ['design-memory', 'user_preference', 'manual_setting', 'font', 'typography', '阿里巴巴普惠体'],
    allowedUses: ['prompt_context', 'user_reference'],
    sourceLevel: 'local_case',
    sourceRank: 80
  },
  {
    id: 'local-memory:user-preference-color-ecru',
    title: '常用颜色：奶白',
    intent: 'rule',
    sourceType: 'local_case',
    summary: '用户偏好奶白和柔和浅色，不应覆盖商品真实颜色。',
    sourceNotes: ['记忆类型：user_preference', '来源：manual_setting'],
    tags: ['design-memory', 'user_preference', 'manual_setting', 'color', '奶白'],
    allowedUses: ['prompt_context', 'user_reference'],
    sourceLevel: 'local_case',
    sourceRank: 70
  },
  {
    id: 'local-memory:user-preference-copy-short',
    title: '文案偏好：短句直接',
    intent: 'copywriting',
    sourceType: 'local_case',
    summary: '详情页和 SKU 辅助文字优先短句直接，不堆长段说明。',
    sourceNotes: ['记忆类型：user_preference', '来源：manual_setting'],
    tags: ['design-memory', 'user_preference', 'manual_setting', 'copywriting'],
    allowedUses: ['prompt_context', 'user_reference'],
    sourceLevel: 'local_case',
    sourceRank: 60
  },
  {
    id: 'local-memory:blocked-direct-action',
    title: '不能进入策略的动作',
    intent: 'reference',
    sourceType: 'local_case',
    summary: 'direct Photoshop action raw-image-payload data:image/png;base64,abc',
    sourceNotes: ['should be filtered'],
    tags: ['design-memory', 'user_preference'],
    allowedUses: ['direct_photoshop_action'],
    sourceLevel: 'local_case',
    sourceRank: 100
  }
];

function assertDetailStrategy(strategy) {
  assert(strategy.version === 'business-skill-memory-strategy/v0', 'detail strategy version mismatch', strategy);
  assert(strategy.scenario === 'detail-page', 'detail strategy scenario mismatch', strategy);
  assert(strategy.status === 'ready_for_strategy_review', 'detail strategy should be ready for review', strategy);
  assert(strategy.memoryContextStatus === 'available', 'detail strategy should preserve memory context status', strategy);
  assert(strategy.strategyDirectives.some((item) => item.category === 'style' && item.values.includes('浅色干净')), 'detail strategy should include style directive', strategy);
  assert(strategy.strategyDirectives.some((item) => item.category === 'typography' && item.values.includes('阿里巴巴普惠体')), 'detail strategy should include typography directive', strategy);
  assert(strategy.strategyDirectives.some((item) => item.category === 'color' && item.values.includes('奶白')), 'detail strategy should include color directive', strategy);
  assert(strategy.strategyDirectives.some((item) => item.category === 'copywriting' && item.values.some((value) => value.includes('短句直接'))), 'detail strategy should include copywriting directive', strategy);
  assert(strategy.reviewRequirements.includes('memory_strategy_review_required'), 'detail strategy should require memory review', strategy);
  assert(strategy.reviewRequirements.includes('detail_template_structure_must_be_preserved'), 'detail strategy should preserve template structure', strategy);
  assert(strategy.mustNotExecutePhotoshop === true, 'detail strategy must not execute Photoshop', strategy);
  assert(strategy.mustNotChangeExecutionParams === true, 'detail strategy must not change Photoshop params', strategy);
  assert(strategy.canClaimOutputQuality === false && strategy.canClaimDesignComplete === false, 'detail strategy must not claim quality', strategy);
  assert(strategy.strategyInputPatch.designMemoryStrategy.directiveCount === strategy.strategyDirectives.length, 'detail strategy input patch should summarize directives', strategy);
  assert(!Object.prototype.hasOwnProperty.call(strategy, 'sourceNotes'), 'memory strategy must not fabricate module self-notes', strategy);
  assertNoRawPayload(strategy, 'detail strategy');
  assertNoConfidence(strategy, 'detail strategy');
}

function assertSkuStrategy(strategy) {
  assert(strategy.version === 'business-skill-memory-strategy/v0', 'SKU strategy version mismatch', strategy);
  assert(strategy.scenario === 'sku', 'SKU strategy scenario mismatch', strategy);
  assert(strategy.status === 'ready_for_strategy_review', 'SKU strategy should be ready for review', strategy);
  assert(strategy.reviewRequirements.includes('memory_strategy_review_required'), 'SKU strategy should require memory review', strategy);
  assert(strategy.reviewRequirements.includes('sku_self_select_note_policy_must_be_preserved'), 'SKU strategy should preserve self-select notes', strategy);
  assert(strategy.reviewRequirements.includes('sku_configured_combinations_must_be_preserved'), 'SKU strategy should preserve configured combinations', strategy);
  assert(strategy.skuBoundaries.mustPreserveSelfSelectNotes === true, 'SKU strategy must preserve self-select notes', strategy);
  assert(strategy.skuBoundaries.mustPreserveConfiguredCombinations === true, 'SKU strategy must preserve configured combinations', strategy);
  assert(strategy.skuBoundaries.mustPreserveProjectAssets === true, 'SKU strategy must preserve project assets', strategy);
  assert(strategy.mustNotExecutePhotoshop === true, 'SKU strategy must not execute Photoshop', strategy);
  assert(strategy.mustNotChangeExecutionParams === true, 'SKU strategy must not change Photoshop params', strategy);
  assert(!Object.prototype.hasOwnProperty.call(strategy, 'sourceNotes'), 'SKU memory strategy must not fabricate module self-notes', strategy);
  assertNoRawPayload(strategy, 'SKU strategy');
  assertNoConfidence(strategy, 'SKU strategy');
}

function run() {
  const detailMemoryContext = buildBusinessSkillMemoryContext({
    scenario: 'detail-page',
    userText: '帮我做详情页，保持浅色干净',
    knowledgeResults: localMemoryKnowledge
  });
  const detailStrategy = buildBusinessSkillMemoryStrategy({
    scenario: 'detail-page',
    memoryContext: detailMemoryContext
  });
  assertDetailStrategy(detailStrategy);

  const skuMemoryContext = buildBusinessSkillMemoryContext({
    scenario: 'sku',
    userText: '帮我做 SKU 和对应自选备注',
    knowledgeResults: localMemoryKnowledge
  });
  const skuStrategy = buildBusinessSkillMemoryStrategy({
    scenario: 'sku',
    memoryContext: skuMemoryContext
  });
  assertSkuStrategy(skuStrategy);

  const emptyStrategy = buildBusinessSkillMemoryStrategy({
    scenario: 'detail-page',
    memoryContext: buildBusinessSkillMemoryContext({
      scenario: 'detail-page',
      userText: '帮我做详情页',
      knowledgeResults: []
    })
  });
  assert(emptyStrategy.status === 'not_available', 'empty memory strategy should be unavailable', emptyStrategy);
  assert(emptyStrategy.strategyDirectives.length === 0, 'empty memory strategy should not fabricate directives', emptyStrategy);
  assert(emptyStrategy.reviewRequirements.includes('current_task_context_required'), 'empty memory strategy should require current context', emptyStrategy);

  const detailPlanner = buildDetailPagePlannerContext({
    userInput: '帮我做详情页',
    params: { knowledgeResults: localMemoryKnowledge },
    context: { projectContext: { projectPath: 'C:/project' } },
    projectPath: 'C:/project',
    screenCount: 8,
    mode: 'execute',
    readinessMode: 'ready',
    screenPlanCount: 8
  });
  assertDetailStrategy(detailPlanner.businessSkillMemoryStrategy);
  assertDetailStrategy(detailPlanner.detailPageMemoryStrategy);

  const skuPlanner = buildSkuBatchPlannerContext({
    userInput: '帮我做 SKU 自选备注',
    params: { knowledgeResults: localMemoryKnowledge },
    context: { projectContext: { projectPath: 'C:/project' } },
    projectPath: 'C:/project',
    comboSizes: [2, 3, 4],
    colorCount: 5,
    totalCombinations: 16,
    processedSizeCount: 0
  });
  assertSkuStrategy(skuPlanner.businessSkillMemoryStrategy);
  assertSkuStrategy(skuPlanner.skuMemoryStrategy);

  const detailExecutorSource = fs.readFileSync(path.join(repoRoot, 'src', 'renderer', 'services', 'skill-executors', 'detail-page.executor.ts'), 'utf8');
  assert(detailExecutorSource.includes('businessSkillMemoryStrategy'), 'detail-page executor result data should expose businessSkillMemoryStrategy');
  assert(detailExecutorSource.includes('detailPageMemoryStrategy'), 'detail-page executor result data should expose detailPageMemoryStrategy');
  assert(!/fillDetailPage[\s\S]{0,1200}businessSkillMemoryStrategy/.test(detailExecutorSource), 'detail memory strategy must not be passed into fillDetailPage params');

  const skuExecutorSource = fs.readFileSync(path.join(repoRoot, 'src', 'renderer', 'services', 'skill-executors', 'sku-batch.executor.ts'), 'utf8');
  assert(skuExecutorSource.includes('businessSkillMemoryStrategy'), 'SKU executor result data should expose businessSkillMemoryStrategy');
  assert(skuExecutorSource.includes('skuMemoryStrategy'), 'SKU executor result data should expose skuMemoryStrategy');
  assert(!/skuLayout[\s\S]{0,1200}businessSkillMemoryStrategy/.test(skuExecutorSource), 'SKU memory strategy must not be passed into skuLayout params');

  console.log(JSON.stringify({
    success: true,
    checks: [
      'detail-page and SKU memory context is converted into readonly strategy input contracts',
      'strategy input patch is reviewable and does not modify Photoshop execution params',
      'SKU strategy preserves self-select notes, configured combinations and project assets',
      'planner and executor data expose strategy contracts for downstream review',
      'raw image payload and confidence fields are blocked'
    ]
  }, null, 2));
}

try {
  run();
} catch (error) {
  console.error(error);
  process.exit(1);
}
