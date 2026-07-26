#!/usr/bin/env node
'use strict';

const assert = require('assert');
const path = require('path');

require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '..', 'tsconfig.json'),
  compilerOptions: { module: 'CommonJS', moduleResolution: 'node' }
});

const root = path.resolve(__dirname, '..');
const {
  governDesignKnowledgeResult
} = require(path.join(root, 'src', 'shared', 'design-knowledge-governance.ts'));
const {
  KNOWLEDGE_SELECTION_CONTEXT_VERSION,
  MAX_KNOWLEDGE_SELECTION_REFERENCES,
  createKnowledgeSelectionReference,
  normalizeKnowledgeSelectionReferences,
  upsertKnowledgeSelectionReference
} = require(path.join(root, 'src', 'shared', 'knowledge-selection-context.ts'));

const NOW = '2026-07-19T08:00:00.000Z';

function buildResult(id, options = {}) {
  return governDesignKnowledgeResult({
    id,
    title: options.title || `Knowledge ${id}`,
    intent: 'rule',
    sourceType: options.sourceType || 'manual_rule',
    summary: options.summary || '保持信息层级和商品真实纹理。',
    sourceNotes: ['reviewed fixture'],
    tags: ['governed'],
    allowedUses: options.allowedUses || ['prompt_context', 'user_reference'],
    sourceLevel: 'curated_rule',
    sourceRank: 80
  }, {
    provenance: 'bundled_curated',
    sourceRevision: options.sourceRevision || `${id}-v1`,
    retrievedAt: NOW,
    expiresAt: options.expiresAt,
    lifecycleStatus: options.lifecycleStatus
  });
}

const selected = createKnowledgeSelectionReference(buildResult('layout-rule', {
  summary: 'C:\\Users\\designer\\secret.png data:image/png;base64,AAAA 请保持层级。'
}), NOW);
assert.strictEqual(selected.ok, true);
assert.strictEqual(selected.reference.version, KNOWLEDGE_SELECTION_CONTEXT_VERSION);
assert.strictEqual(selected.reference.freshness, 'current');
assert.match(selected.reference.bindingRef, /^knowledge-binding-/);
assert(!selected.reference.contextExcerpt.includes('C:\\Users'));
assert(!selected.reference.contextExcerpt.includes('data:image'));
assert(!selected.reference.contextExcerpt.toLowerCase().includes('base64'));

const stale = createKnowledgeSelectionReference(buildResult('stale-rule', {
  expiresAt: '2026-07-18T08:00:00.000Z'
}), NOW);
assert.strictEqual(stale.ok, false);
assert.match(stale.reason, /过期|复核/);

const withdrawn = createKnowledgeSelectionReference(buildResult('withdrawn-rule', {
  lifecycleStatus: 'withdrawn'
}), NOW);
assert.strictEqual(withdrawn.ok, false);

const promptOnly = createKnowledgeSelectionReference(buildResult('prompt-only-rule', {
  allowedUses: ['prompt_context']
}), NOW);
assert.strictEqual(promptOnly.ok, false);

let references = [];
for (let index = 0; index < MAX_KNOWLEDGE_SELECTION_REFERENCES + 2; index += 1) {
  const next = createKnowledgeSelectionReference(buildResult(`rule-${index}`), NOW);
  references = upsertKnowledgeSelectionReference(references, next.reference);
}
assert.strictEqual(references.length, MAX_KNOWLEDGE_SELECTION_REFERENCES);
assert.strictEqual(references[0].resultId, `rule-${MAX_KNOWLEDGE_SELECTION_REFERENCES + 1}`);

const replacement = {
  ...references[0],
  title: '更新后的标题'
};
references = upsertKnowledgeSelectionReference(references, replacement);
assert.strictEqual(references.length, MAX_KNOWLEDGE_SELECTION_REFERENCES);
assert.strictEqual(references.filter((item) => item.bindingRef === replacement.bindingRef).length, 1);
assert.strictEqual(references[0].title, '更新后的标题');

const normalized = normalizeKnowledgeSelectionReferences([
  ...references,
  { version: 'legacy-selection/v0', title: 'legacy' },
  { ...references[0], sourceRevision: '' }
]);
assert.strictEqual(normalized.length, MAX_KNOWLEDGE_SELECTION_REFERENCES);
assert(normalized.every((item) => item.version === KNOWLEDGE_SELECTION_CONTEXT_VERSION));
assert(normalized.every((item) => item.useRole === 'general'));

// 用途声明：合法值透传、缺省与非法值归一为 general
const withInsights = createKnowledgeSelectionReference(buildResult('insight-rule'), NOW, {
  useRole: 'layout',
  insights: {
    whatLooksGood: ['主体占比六成显得稳'],
    whyItWorks: ['留白给商品呼吸感'],
    reusableHeuristics: ['标题保持两级以内'],
    avoidWhen: ['强促销页面']
  }
});
assert.strictEqual(withInsights.ok, true);
assert.strictEqual(withInsights.reference.useRole, 'layout');
assert(withInsights.reference.insightsExcerpt.startsWith('可复用启发：'), 'layout role must prioritize reusableHeuristics');
assert(withInsights.reference.insightsExcerpt.includes('为什么有效：'));

const forbiddenReference = createKnowledgeSelectionReference(buildResult('forbidden-rule'), NOW, {
  useRole: 'forbidden',
  insights: { avoidWhen: ['背景明度贴近袜口'], whyItWorks: ['不优先的字段'] }
});
assert.strictEqual(forbiddenReference.reference.useRole, 'forbidden');
assert(forbiddenReference.reference.insightsExcerpt.startsWith('避免情况：'), 'forbidden role must prioritize avoidWhen');

const defaultRole = createKnowledgeSelectionReference(buildResult('default-role-rule'), NOW);
assert.strictEqual(defaultRole.reference.useRole, 'general');
assert.strictEqual(defaultRole.reference.insightsExcerpt, undefined);

const invalidRole = createKnowledgeSelectionReference(buildResult('invalid-role-rule'), NOW, { useRole: 'everything' });
assert.strictEqual(invalidRole.reference.useRole, 'general');

// 洞察摘要同样剥离本地路径与图像载荷，且总量有界
const dirtyInsights = createKnowledgeSelectionReference(buildResult('dirty-insights-rule'), NOW, {
  insights: { whyItWorks: ['见 C:\\Users\\designer\\secret.png 与 data:image/png;base64,AAAA'] }
});
assert(!dirtyInsights.reference.insightsExcerpt.includes('C:\\Users'));
assert(!dirtyInsights.reference.insightsExcerpt.toLowerCase().includes('base64'));

const longInsights = createKnowledgeSelectionReference(buildResult('long-insights-rule'), NOW, {
  insights: {
    whyItWorks: ['其一' + '长'.repeat(400), '其二' + '长'.repeat(400), '其三' + '长'.repeat(400)],
    reusableHeuristics: ['甲' + '冗'.repeat(400), '乙' + '冗'.repeat(400), '丙' + '冗'.repeat(400)]
  }
});
assert(longInsights.reference.insightsExcerpt.length <= 720, 'insights excerpt must stay bounded');

const roleNormalized = normalizeKnowledgeSelectionReferences([
  { ...withInsights.reference, useRole: 'bogus-role' },
  { ...forbiddenReference.reference }
], NOW);
assert.strictEqual(roleNormalized.length, 2);
assert.strictEqual(roleNormalized[0].useRole, 'general');
assert.strictEqual(roleNormalized[1].useRole, 'forbidden');
assert(roleNormalized[1].insightsExcerpt.includes('避免情况：'));

console.log(JSON.stringify({
  success: true,
  checks: [
    'only current governed user-reference knowledge can be selected',
    'selection excerpts redact local paths and image payloads',
    'stale, withdrawn and disallowed knowledge fail closed',
    'request references are deduplicated and capped',
    'normalization rejects malformed or legacy references',
    'use role defaults to general and invalid roles fail closed to general',
    'insights excerpts stay bounded, redacted and prioritized by use role'
  ]
}, null, 2));
