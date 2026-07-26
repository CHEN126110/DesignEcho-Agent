#!/usr/bin/env node

const path = require('path');

require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '..', 'tsconfig.main.json')
});

function assert(condition, message, details) {
  if (!condition) {
    const error = new Error(message);
    error.details = details;
    throw error;
  }
}

function assertThrows(fn, message, matcher) {
  try {
    fn();
  } catch (error) {
    if (matcher) {
      assert(matcher(error), message, error);
    }
    return error;
  }
  throw new Error(message);
}

function createLocalStorageMock() {
  const data = new Map();
  return {
    getItem(key) {
      return data.has(key) ? data.get(key) : null;
    },
    setItem(key, value) {
      data.set(key, String(value));
    },
    removeItem(key) {
      data.delete(key);
    },
    clear() {
      data.clear();
    }
  };
}

global.localStorage = createLocalStorageMock();

const MemoryService = require('../src/renderer/services/memory.service.ts').default;

const service = new MemoryService();

[
  'listPreferenceItems',
  'upsertExplicitPreference',
  'updatePreferenceItem',
  'setPreferenceEnabled',
  'archivePreference',
  'clearInferredPreferences',
  'clearPreferences',
  'recordPreferenceUsed',
  'exportPreferences',
  'importPreferences'
].forEach((methodName) => {
  assert(typeof service[methodName] === 'function', `MemoryService must expose ${methodName}`);
});

assert(
  typeof service.learnPreference === 'undefined',
  'MemoryService must not infer long-term user preferences from tool execution parameters'
);

function importLegacyInferredPreference(target, category, value, label) {
  target.importPreferences({
    version: 'designecho-preferences/v1',
    preferenceItems: [{
      category,
      value,
      label,
      sourceType: 'inferred',
      status: 'needs_review',
      sourceNote: '旧版本迁移的推断候选，必须由用户确认后才能启用。',
      scope: { type: 'user' }
    }]
  }, { mode: 'merge' });
}

importLegacyInferredPreference(service, 'font', '思源黑体', '旧版字体推断候选');
let items = service.listPreferenceItems();
const inferredFont = items.find((item) => item.category === 'font' && item.value === '思源黑体');
assert(inferredFont, 'legacy inferred preferences must remain reviewable after migration', items);
assert(inferredFont.sourceType === 'inferred', 'migrated inferred preferences must stay marked inferred', inferredFont);
assert(inferredFont.status === 'needs_review', 'migrated inferred preferences must require review before use', inferredFont);

let knowledge = service.getDesignKnowledgeResults({
  query: '思源黑体 字体',
  intents: ['rule'],
  sourceTypes: ['local_case'],
  limit: 10
});
assert(
  knowledge.every((item) => !JSON.stringify(item).includes('思源黑体')),
  'needs_review inferred preferences must not enter design knowledge evidence',
  knowledge
);

const explicit = service.upsertExplicitPreference({
  category: 'font',
  value: '阿里巴巴普惠体',
  label: '常用标题字体',
  sourceNote: '用户明确要求标题优先使用阿里巴巴普惠体。'
});
assert(explicit.status === 'active', 'explicit preferences must be active by default', explicit);
const immediateReload = new MemoryService();
assert(
  immediateReload.listPreferenceItems({ includeLegacy: false }).some((item) => item.id === explicit.id),
  'explicit preferences must be durable before the write method returns'
);

knowledge = service.getDesignKnowledgeResults({
  query: '阿里巴巴普惠体 标题',
  intents: ['rule'],
  sourceTypes: ['local_case'],
  limit: 10
});
assert(
  knowledge.some((item) => JSON.stringify(item).includes('阿里巴巴普惠体')),
  'active explicit preferences must enter local design knowledge evidence',
  knowledge
);

const projectScoped = service.upsertExplicitPreference({
  category: 'style',
  value: '高级灰',
  label: 'C-1160 项目主图风格',
  sourceNote: '用户明确要求 C-1160 主图优先使用高级灰和低广告感排版。',
  scope: { type: 'project', id: 'C-1160' }
});
assert(projectScoped.scope?.type === 'project' && projectScoped.scope?.id === 'C-1160', 'project preference must keep project scope', projectScoped);

const sameValueOtherProject = service.upsertExplicitPreference({
  category: 'style',
  value: '高级灰',
  label: 'C-1159 项目主图风格',
  sourceNote: '另一个项目可以保存同值偏好，但不能覆盖 C-1160。',
  scope: { type: 'project', id: 'C-1159' }
});
assert(
  projectScoped.id !== sameValueOtherProject.id,
  'same category/value preferences must not collide across scopes',
  { projectScoped, sameValueOtherProject }
);

assertThrows(
  () => service.updatePreferenceItem(sameValueOtherProject.id, {
    category: 'style',
    value: '高级灰',
    scope: { type: 'project', id: 'C-1160' }
  }),
  'updatePreferenceItem must reject cross-scope edits that would overwrite an existing preference',
  (error) => String(error?.message || '').includes('目标偏好已存在')
);
items = service.listPreferenceItems({ includeLegacy: false });
assert(
  items.some((item) => item.id === projectScoped.id && item.label === 'C-1160 项目主图风格')
    && items.some((item) => item.id === sameValueOtherProject.id && item.label === 'C-1159 项目主图风格'),
  'conflicting cross-scope edit must not overwrite either existing preference',
  items
);

let scopedKnowledge = service.getDesignKnowledgeResults({
  query: '高级灰 主图',
  intents: ['rule'],
  sourceTypes: ['local_case'],
  limit: 10
}, { scope: { type: 'project', id: 'C-1160' } });
assert(
  scopedKnowledge.some((item) => JSON.stringify(item).includes('C-1160 项目主图风格')),
  'matching project-scope preference must enter project knowledge evidence',
  scopedKnowledge
);
assert(
  scopedKnowledge.every((item) => !JSON.stringify(item).includes('C-1159 项目主图风格')),
  'other project-scope preference must not leak into the requested project',
  scopedKnowledge
);

scopedKnowledge = service.getDesignKnowledgeResults({
  query: 'C-1160 主图',
  intents: ['rule'],
  sourceTypes: ['local_case'],
  limit: 10
}, { scope: { type: 'project', id: 'C-1159' } });
assert(
  scopedKnowledge.every((item) => !JSON.stringify(item).includes('C-1160 项目主图风格')),
  'wrong project scope must not expose another project preference',
  scopedKnowledge
);

const confirmedInferred = service.updatePreferenceItem(inferredFont.id, {
  sourceType: 'explicit',
  status: 'active',
  sourceNote: '用户在偏好面板中确认该字体可以作为标题候选。',
  scope: { type: 'user' }
});
assert(confirmedInferred.sourceType === 'explicit', 'updatePreferenceItem must support confirming inferred preferences', confirmedInferred);
knowledge = service.getDesignKnowledgeResults({
  query: '思源黑体 字体',
  intents: ['rule'],
  sourceTypes: ['local_case'],
  limit: 10
});
assert(
  knowledge.some((item) => JSON.stringify(item).includes('思源黑体')),
  'confirmed inferred preference must enter design knowledge evidence',
  knowledge
);

const beforeUsageCount = Number(projectScoped.usageCount || 0);
const usedPreference = service.recordPreferenceUsed(projectScoped.id);
assert(usedPreference.usageCount === beforeUsageCount + 1, 'recordPreferenceUsed must increment usage count', usedPreference);
assert(Number(usedPreference.lastUsedAt) > 0, 'recordPreferenceUsed must set lastUsedAt', usedPreference);

importLegacyInferredPreference(service, 'color', '暖白', '旧版颜色推断候选');
const inferredColor = service.listPreferenceItems().find((item) => item.category === 'color' && item.value === '暖白');
assert(inferredColor, 'migrated inferred color preference should remain confirmable', service.listPreferenceItems());
const confirmedColor = service.setPreferenceEnabled(inferredColor.id, true);
assert(confirmedColor.sourceType === 'explicit', 'enabling an inferred preference must confirm it as explicit', confirmedColor);
assert(
  confirmedColor.sourceNote.includes('确认'),
  'confirmed inferred preference must keep auditable confirmation evidence',
  confirmedColor
);

const exported = service.exportPreferences();
const exportedText = JSON.stringify(exported);
assert(exported.version === 'designecho-preferences/v1', 'exportPreferences must return a versioned snapshot', exported);
assert(Array.isArray(exported.preferenceItems), 'exportPreferences must include preferenceItems array', exported);
assert(!exportedText.includes('confidence'), 'exportPreferences must not export confidence fields');
assert(!exportedText.includes('置信'), 'exportPreferences must not export confidence wording');
assert(!exportedText.includes('raw-image-payload'), 'exportPreferences must redact raw payload markers');
assert(!exportedText.includes('data:image/'), 'exportPreferences must redact data image payload markers');

const importer = new MemoryService();
const mergeResult = importer.importPreferences({
  ...exported,
  preferenceItems: [
    ...exported.preferenceItems,
    {
      category: 'copywriting',
      value: '低广告感文案 data:image/png;base64,abc123 raw-image-payload',
      label: '低广告感文案',
      sourceType: 'explicit',
      status: 'active',
      sourceNote: '用户明确要求文案少夸张词，不写置信度。',
      confidence: 0.99,
      scope: { type: 'brand', id: 'demo-brand' }
    }
  ]
}, { mode: 'merge' });
assert(
  mergeResult.importedCount + mergeResult.replacedExistingCount >= exported.preferenceItems.length,
  'importPreferences merge must import or reconcile every valid preference',
  mergeResult
);
assert(JSON.stringify(importer.listPreferenceItems()).includes('低广告感文案'), 'importPreferences must import explicit Chinese preference values');
assert(!JSON.stringify(importer.listPreferenceItems()).includes('confidence'), 'importPreferences must drop confidence fields');
assert(!JSON.stringify(importer.listPreferenceItems()).includes('raw-image-payload'), 'importPreferences must redact raw payload markers');

const userCopywriting = importer.upsertExplicitPreference({
  category: 'copywriting',
  value: '少用夸张词',
  label: '用户级文案偏好',
  scope: { type: 'user' }
});
importer.importPreferences({
  version: 'designecho-preferences/v1',
  preferenceItems: [{
    id: userCopywriting.id,
    category: 'copywriting',
    value: '少用夸张词',
    label: 'C-1160 文案偏好',
    sourceType: 'explicit',
    status: 'active',
    sourceNote: '畸形导入样例：外部 id 伪装成用户级 id，但 scope 指向项目级。',
    scope: { type: 'project', id: 'C-1160' }
  }]
}, { mode: 'merge' });
const importedAfterBadId = importer.listPreferenceItems({ includeLegacy: false });
assert(
  importedAfterBadId.some((item) => item.id === userCopywriting.id && item.scope?.type === 'user' && item.label === '用户级文案偏好'),
  'importPreferences must not let external ids overwrite existing user-scope preferences',
  importedAfterBadId
);
assert(
  importedAfterBadId.some((item) => item.value === '少用夸张词' && item.scope?.type === 'project' && item.scope?.id === 'C-1160' && item.id !== userCopywriting.id),
  'importPreferences must recompute canonical ids from imported category/value/scope',
  importedAfterBadId
);

const replaceResult = importer.importPreferences({
  version: 'designecho-preferences/v1',
  preferenceItems: [{
    category: 'layout',
    value: '首屏主视觉居中',
    label: '详情页首屏布局',
    sourceType: 'explicit',
    status: 'active',
    sourceNote: '用户确认后保留的详情页排版偏好。',
    scope: { type: 'user' }
  }]
}, { mode: 'replace' });
assert(replaceResult.mode === 'replace', 'importPreferences must report replace mode', replaceResult);
assert(
  importer.listPreferenceItems().some((item) => item.value === '首屏主视觉居中')
    && importer.listPreferenceItems().every((item) => item.value !== '低广告感文案'),
  'replace import must replace structured preferenceItems instead of appending forever',
  importer.listPreferenceItems()
);

const disabled = service.setPreferenceEnabled(explicit.id, false);
assert(disabled.status === 'disabled', 'setPreferenceEnabled(false) must disable a preference', disabled);
knowledge = service.getDesignKnowledgeResults({
  query: '阿里巴巴普惠体 标题',
  intents: ['rule'],
  sourceTypes: ['local_case'],
  limit: 10
});
assert(
  knowledge.every((item) => !JSON.stringify(item).includes('阿里巴巴普惠体')),
  'disabled preferences must not enter design knowledge evidence',
  knowledge
);

importLegacyInferredPreference(service, 'style', '浅色干净', '旧版风格推断候选');
const inferredClear = service.clearInferredPreferences();
assert(inferredClear.archivedCount >= 1, 'clearInferredPreferences must archive inferred review items', inferredClear);
items = service.listPreferenceItems();
assert(
  items.some((item) => item.category === 'style' && item.value === '浅色干净' && item.status === 'archived'),
  'cleared inferred preferences should remain auditable as archived items',
  items
);

const clearResult = service.clearPreferences({ includeLegacy: true, statuses: ['disabled', 'archived'] });
assert(clearResult.archivedCount >= 1, 'clearPreferences must return structured cleanup counts', clearResult);
assert(!JSON.stringify(service.listPreferenceItems()).includes('confidence'), 'preference contract must not expose confidence fields');
assert(!JSON.stringify(service.listPreferenceItems()).includes('置信'), 'preference contract must not expose confidence wording');

global.localStorage.setItem('designecho-memory', JSON.stringify({
  version: 0,
  patterns: [],
  preferenceItems: []
}));
const migratedPartialState = new MemoryService();
assert(
  Array.isArray(migratedPartialState.getPreferences().design.preferredFonts),
  'partial legacy storage must be normalized onto the current preference schema'
);
assert(
  Array.isArray(migratedPartialState.listPreferenceItems()),
  'partial legacy storage must not crash preference reads'
);

console.log(JSON.stringify({
  success: true,
  checks: [
    'tool execution cannot create long-term preference candidates',
    'legacy inferred preferences remain reviewable but inactive',
    'active explicit preferences are exported as local design knowledge evidence',
    'project scoped preferences do not leak across projects',
    'preference records can be edited, exported, imported, and usage-counted',
    'preference writes are immediately durable and partial legacy state is normalized',
    'disabled preferences are excluded from design knowledge evidence',
    'inferred preferences can be archived without clearing all memory',
    'preference contract avoids confidence fields'
  ]
}, null, 2));
