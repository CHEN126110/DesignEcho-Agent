#!/usr/bin/env node

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
  buildDesignMemoryItemsFromUserPreferences,
  designMemoryItemToKnowledgeResult,
  searchDesignMemoryKnowledge
} = require(path.join(repoRoot, 'src', 'shared', 'design-memory-knowledge.ts'));

const {
  searchLocalDesignKnowledge
} = require(path.join(repoRoot, 'src', 'shared', 'design-knowledge-search.ts'));

const MemoryService = require(path.join(repoRoot, 'src', 'renderer', 'services', 'memory.service.ts')).default;

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
  assert(found.length === 0, `${label} must not leak raw image payload markers: ${found.join(', ')}`, value);
}

function assertNoConfidence(value, label) {
  const serialized = JSON.stringify(value);
  assert(!serialized.includes('"confidence"') && !serialized.includes('置信'), `${label} must not expose confidence fields`, value);
}

const now = '2026-05-26T00:00:00.000Z';

const explicitPreference = {
  id: 'pref-low-ad-tone',
  kind: 'user_preference',
  scope: { type: 'user', id: 'default' },
  status: 'active',
  source: 'explicit_user_feedback',
  title: '偏好：低广告感文案',
  summary: '用户明确要求主图和详情页文案保持低广告感，避免夸张促销腔。',
  sourceNotes: [{
    source: 'user-feedback',
    summary: '用户说“不要太广告感，真实一点”。',
    status: 'active'
  }],
  tags: ['copywriting', 'main-image', 'low-ad-tone'],
  appliesTo: ['copywriting'],
  allowedUses: ['prompt_context', 'user_reference', 'direct_photoshop_action'],
  sourceRank: 95,
  updatedAt: now
};

function run() {
  const result = designMemoryItemToKnowledgeResult(explicitPreference);
  assert(result, 'active explicit preference should convert to knowledge result');
  assert(result.id === 'local-memory:pref-low-ad-tone', 'memory result id should be stable', result);
  assert(result.sourceType === 'local_case', 'memory result should use local_case source type', result);
  assert(result.sourceLevel === 'local_case', 'memory result should expose local_case source level', result);
  assert(result.sourceRank === 95, 'memory result should preserve bounded source rank', result);
  assert(result.allowedUses.includes('prompt_context'), 'memory result should allow prompt context', result);
  assert(result.allowedUses.includes('user_reference'), 'memory result should allow user reference', result);
  assert(!result.allowedUses.includes('direct_photoshop_action'), 'memory result must drop direct Photoshop action use', result);
  assertNoConfidence(result, 'single memory knowledge result');
  assertNoRawPayload(result, 'single memory knowledge result');

  const projectRule = designMemoryItemToKnowledgeResult({
    ...explicitPreference,
    id: 'project-rule-source',
    kind: 'project_rule',
    title: '项目规则来源',
    summary: '交付前保持商品真实纹理。'
  });
  assert(projectRule.tags.includes('non-executable-rule-source'), 'project_rule memory must be tagged as a non-executable source', projectRule);
  assert(projectRule.sourceNotes.some((entry) => entry.includes('不是质量门禁、交付审批或工具权限')), 'project_rule memory must expose its Policy boundary', projectRule);

  const disabled = designMemoryItemToKnowledgeResult({
    ...explicitPreference,
    id: 'disabled-pref',
    status: 'disabled'
  });
  assert(disabled === undefined, 'disabled memory item should not become knowledge evidence', disabled);

  const expired = designMemoryItemToKnowledgeResult({
    ...explicitPreference,
    id: 'expired-pref',
    expiresAt: '2026-05-25T00:00:00.000Z'
  });
  assert(expired === undefined, 'expired memory item should not become knowledge evidence', expired);

  const preferenceItems = buildDesignMemoryItemsFromUserPreferences(
    {
      design: {
        preferredFonts: ['阿里巴巴普惠体', 'raw-image-payload 字体'],
        preferredColors: ['#ffffff', 'data:image/png;base64,abc'],
        preferredStyles: ['浅色干净', '低广告感']
      },
      workflow: {
        defaultExportFormat: 'jpg',
        defaultExportQuality: 90
      }
    },
    { scope: { type: 'user', id: 'default' }, now }
  );
  assert(preferenceItems.length >= 5, 'preference snapshot should produce memory items', preferenceItems);
  assert(preferenceItems.every((item) => item.status === 'active'), 'generated preference memory should be active', preferenceItems);
  assert(preferenceItems.some((item) => item.source === 'inferred_from_operations'), 'operation-derived preferences should retain their source type', preferenceItems);
  assert(preferenceItems.some((item) => item.source === 'manual_setting'), 'manual settings should retain their source type', preferenceItems);
  assertNoRawPayload(preferenceItems, 'generated preference memory items');
  assertNoConfidence(preferenceItems, 'generated preference memory items');

  const memorySearch = searchDesignMemoryKnowledge(
    {
      query: '主图 低广告感',
      intents: ['copywriting'],
      sourceTypes: ['local_case'],
      limit: 5
    },
    [
      explicitPreference,
      { ...explicitPreference, id: 'disabled-copy', status: 'disabled' },
      { ...explicitPreference, id: 'benchmark-main-image', kind: 'benchmark_case', source: 'benchmark', appliesTo: ['reference'], title: '白袜主图 benchmark 案例', summary: '浅色背景和主体放大通过人工验收。' }
    ]
  );
  assert(memorySearch.length === 1, 'memory search should filter by intent, status, query and source type', memorySearch);
  assert(memorySearch[0].id === 'local-memory:pref-low-ad-tone', 'memory search should return matching explicit preference', memorySearch);
  assertNoConfidence(memorySearch, 'memory search results');

  const noLocalCase = searchDesignMemoryKnowledge(
    { query: '主图', sourceTypes: ['manual_rule'], limit: 5 },
    [explicitPreference]
  );
  assert(noLocalCase.length === 0, 'memory provider should only answer local_case source type', noLocalCase);

  const localKnowledge = searchLocalDesignKnowledge({
    query: '低广告感 主图',
    sourceTypes: ['local_case'],
    memoryItems: [explicitPreference],
    limit: 5
  });
  assert(localKnowledge.providerSummary.localCase === 1, 'local search should count memory local_case results', localKnowledge.providerSummary);
  assert(localKnowledge.results[0]?.id === 'local-memory:pref-low-ad-tone', 'local design knowledge should include memory result', localKnowledge);
  assert(localKnowledge.results[0]?.allowedUses.every((use) => use !== 'direct_photoshop_action'), 'local memory result must not include direct action use', localKnowledge.results[0]);
  assertNoConfidence(localKnowledge, 'local knowledge response with memory');

  const memory = new MemoryService();
  memory.updatePreferences({
    design: {
      preferredFonts: ['阿里巴巴普惠体'],
      preferredColors: ['#f8f8f8'],
      preferredStyles: ['浅色干净']
    },
    workflow: {
      defaultExportFormat: 'jpg'
    }
  });
  const serviceMemoryItems = memory.getDesignMemoryItems({
    scope: { type: 'user', id: 'renderer-smoke' },
    now
  });
  assert(serviceMemoryItems.some((item) => item.title.includes('浅色干净')), 'renderer memory service should export preference memory items', serviceMemoryItems);
  assertNoConfidence(serviceMemoryItems, 'renderer memory service memory items');

  const serviceKnowledge = memory.getDesignKnowledgeResults({
    query: '浅色 主图',
    sourceTypes: ['local_case'],
    limit: 5
  }, {
    scope: { type: 'user', id: 'renderer-smoke' },
    now
  });
  assert(serviceKnowledge.some((item) => item.sourceType === 'local_case'), 'renderer memory service should export DesignKnowledgeResult local_case evidence', serviceKnowledge);
  assert(serviceKnowledge.every((item) => !item.allowedUses.includes('direct_photoshop_action')), 'renderer memory knowledge must not allow direct Photoshop actions', serviceKnowledge);
  assertNoConfidence(serviceKnowledge, 'renderer memory service knowledge results');

  console.log(JSON.stringify({
    success: true,
    checks: [
      'active design memory converts to DesignKnowledgeResult local_case evidence',
      'disabled and expired memory items are filtered out',
      'legacy user preferences produce evidence-marked memory items',
      'memory search filters by intent, source type and query without confidence fields',
      'searchLocalDesignKnowledge can include memory local_case evidence without Photoshop actions',
      'renderer memory service exports preference memory as DesignKnowledgeResult evidence'
    ]
  }, null, 2));
}

try {
  run();
} catch (error) {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
}
