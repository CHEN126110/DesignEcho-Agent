#!/usr/bin/env node

const path = require('path');

require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '..', 'tsconfig.main.json')
});

const repoRoot = path.resolve(__dirname, '..');

const {
  buildMainImageMemoryContext
} = require(path.join(repoRoot, 'src', 'shared', 'main-image-memory-context.ts'));
const {
  buildMainImageStrategyInputs
} = require(path.join(repoRoot, 'src', 'shared', 'main-image-strategy-input-builder.ts'));

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

const readySizePlans = [{
  sizeKey: '800',
  targetSize: { width: 800, height: 800 },
  subjectSize: { width: 760, height: 820 },
  scale: 0.67,
  targetX: 118,
  targetY: 92,
  decisionReason: 'main image guideline scale 67%',
  layoutCandidateScore: 84,
  layoutCandidateReason: 'subject centered with copy safe area',
  smartLayoutPlanned: true,
  quickExportPlanned: true
}];

const readyContext = {
  userText: '帮我用这张袜子图做主图，保持干净高级',
  imageType: 'click',
  currentDocument: { id: 1, name: 'SKU.psb', width: 1200, height: 1200 },
  selectedAsset: {
    id: 'asset-1',
    name: 'white-socks.jpg',
    path: 'C:/project/assets/white-socks.jpg',
    width: 1600,
    height: 1600,
    role: 'selected-project-image'
  },
  projectAssets: [
    { name: 'white-socks.jpg', path: 'C:/project/assets/white-socks.jpg', role: 'selected-project-image' }
  ],
  subjectBounds: { left: 170, top: 150, right: 930, bottom: 970, width: 760, height: 820 },
  sizePlans: readySizePlans,
  copyCandidates: ['轻薄透气，春夏出行更自在'],
  outputDir: 'C:/Exports',
  toolNames: ['getDocumentInfo', 'getLayerBounds', 'smartLayout[800]', 'quickExport[800]'],
  visionSignal: {
    source: 'vision-model',
    assetRef: { id: 'asset-1', path: 'C:/project/assets/white-socks.jpg', name: 'white-socks.jpg' },
    productType: '堆堆袜',
    subjectSummary: '白色袜子主体，适合白底主图 raw-image-payload data:image/png;base64,abc',
    backgroundSummary: '简洁浅色背景',
    confidence: 0.72,
    sourceNotes: ['视觉模型返回商品类型与主体描述']
  }
};

const localMemoryKnowledge = [
  {
    id: 'local-memory:user-preference-style-clean',
    title: '偏好风格：浅色干净',
    intent: 'rule',
    sourceType: 'local_case',
    summary: '用户偏好风格为 浅色干净，可影响策略排序，但不能替代视觉上下文。',
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
    sourceRank: 52,
    updatedAt: '2026-05-26T00:00:00.000Z'
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
    sourceRank: 52,
    updatedAt: '2026-05-26T00:00:00.000Z'
  },
  {
    id: 'local-memory:user-preference-export-format-jpg',
    title: '默认导出格式：jpg',
    intent: 'rule',
    sourceType: 'local_case',
    summary: '用户工作流默认导出格式为 jpg。',
    sourceNotes: ['记忆类型：user_preference', '来源：manual_setting', 'manual_setting：来自用户工作流偏好设置。'],
    tags: ['design-memory', 'user_preference', 'manual_setting', 'workflow', 'export', 'jpg'],
    allowedUses: ['prompt_context', 'user_reference'],
    sourceLevel: 'local_case',
    sourceRank: 76,
    updatedAt: '2026-05-26T00:00:00.000Z'
  },
  {
    id: 'local-memory:blocked-direct-action',
    title: '不能进入策略的动作',
    intent: 'reference',
    sourceType: 'local_case',
    summary: '该项只能用于直接 Photoshop 动作。',
    sourceNotes: ['should be filtered'],
    tags: ['design-memory', 'user_preference'],
    allowedUses: ['direct_photoshop_action'],
    sourceLevel: 'local_case',
    sourceRank: 100
  },
  {
    id: 'web:external-reference',
    title: '外部主图参考',
    intent: 'reference',
    sourceType: 'web_page',
    summary: '外部网页参考不是本地记忆。',
    sourceNotes: ['Source URL: https://example.com'],
    tags: ['socks'],
    allowedUses: ['prompt_context', 'user_reference'],
    sourceLevel: 'external_snippet',
    sourceRank: 70
  }
];

function run() {
  const memoryContext = buildMainImageMemoryContext({
    userText: 'raw-image-payload 帮我做主图 data:image/png;base64,abc',
    knowledgeResults: localMemoryKnowledge
  });

  assert(memoryContext.version === 'main-image-memory-context/v0', 'memory context version mismatch', memoryContext);
  assert(memoryContext.status === 'available', 'local memory should be available', memoryContext);
  assert(memoryContext.noPhotoshopWrites === true, 'memory context must be read-only', memoryContext);
  assert(memoryContext.mustNotExecutePhotoshop === true, 'memory context must not execute Photoshop', memoryContext);
  assert(memoryContext.canClaimOutputQuality === false, 'memory context cannot claim output quality', memoryContext);
  assert(memoryContext.canClaimDesignComplete === false, 'memory context cannot claim design complete', memoryContext);
  assert(memoryContext.preferenceSummary.sourceResultCount === 4, 'only usable local design memories should be counted', memoryContext.preferenceSummary);
  assert(memoryContext.preferenceSummary.stylePreferences.includes('浅色干净'), 'style preference should be extracted', memoryContext.preferenceSummary);
  assert(memoryContext.preferenceSummary.typographyPreferences.includes('阿里巴巴普惠体'), 'font preference should be extracted', memoryContext.preferenceSummary);
  assert(memoryContext.preferenceSummary.colorPreferences.includes('奶白'), 'color preference should be extracted', memoryContext.preferenceSummary);
  assert(memoryContext.preferenceSummary.workflowPreferences.some((item) => item.includes('jpg')), 'workflow preference should be extracted', memoryContext.preferenceSummary);
  assert(memoryContext.warnings.some((item) => item.includes('历史操作')), 'inferred memory should require review warning', memoryContext.warnings);
  assert(memoryContext.strategyInputPatch.copyRolePolicy.designMemory.sourceResultCount === 4, 'memory should expose a copyRolePolicy patch', memoryContext.strategyInputPatch);
  assertNoRawPayload(memoryContext, 'main-image memory context');
  assertNoConfidence(memoryContext, 'main-image memory context');

  const strategy = buildMainImageStrategyInputs({
    ...readyContext,
    knowledgeResults: localMemoryKnowledge
  });

  assert(strategy.mainImageMemoryContext.status === 'available', 'strategy input should include memory context', strategy.mainImageMemoryContext);
  assert(strategy.strategyInputs.copyRolePolicy.designMemory.stylePreferences.includes('浅色干净'), 'copyRolePolicy should receive structured memory context', strategy.strategyInputs.copyRolePolicy);
  assert(strategy.strategyInputs.copyRolePolicy.referenceCount === 1, 'external references should remain separate from local memory context', strategy.strategyInputs.copyRolePolicy);
  assert(strategy.strategyInputs.copyRolePolicy.designMemory.sourceResultCount === 4, 'memory count should stay separate from reference count', strategy.strategyInputs.copyRolePolicy);
  assert(strategy.strategyInputs.performanceBudget.memorySourceCount === 4, 'performance budget should expose local memory source count', strategy.strategyInputs.performanceBudget);
  assert(strategy.mainImageMemoryContext.preferenceSummary.sourceIds.length === 4, 'strategy should retain the real memory source ids', strategy.mainImageMemoryContext.preferenceSummary);
  assert(!Object.prototype.hasOwnProperty.call(strategy, 'sourceNotes'), 'strategy builder should not fabricate module self-notes', strategy);
  assertNoRawPayload(strategy.mainImageMemoryContext, 'strategy memory context');
  assertNoConfidence(strategy.strategyInputs.copyRolePolicy, 'memory-enriched copyRolePolicy');

  const empty = buildMainImageMemoryContext({ userText: '帮我做主图', knowledgeResults: [localMemoryKnowledge[5]] });
  assert(empty.status === 'not_available', 'non-local knowledge must not become memory context', empty);
  assert(empty.preferenceSummary.sourceResultCount === 0, 'empty memory result count should be zero', empty.preferenceSummary);

  console.log(JSON.stringify({
    success: true,
    checks: [
      'local_case memory becomes explicit mainImageMemoryContext',
      'memory context reaches copyRolePolicy as structured designMemory',
      'memory context is counted separately from referenceCount',
      'memory context remains read-only and cannot claim quality',
      'confidence and raw image payloads are redacted from memory context'
    ]
  }, null, 2));
}

try {
  run();
} catch (error) {
  console.error(error);
  process.exit(1);
}
