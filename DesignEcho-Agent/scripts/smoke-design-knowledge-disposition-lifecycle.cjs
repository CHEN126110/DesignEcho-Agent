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
  applyDesignKnowledgeDispositions,
  createDesignKnowledgeDisposition,
  governDesignKnowledgeResult
} = require(path.join(root, 'src', 'shared', 'design-knowledge-governance.ts'));

const NOW = '2026-07-19T08:00:00.000Z';

function buildVersion(sourceRevision, summary, sourceType = 'eagle_library') {
  return governDesignKnowledgeResult({
    id: 'shared-reference-id',
    title: '商品主图参考',
    intent: 'reference',
    sourceType,
    summary,
    sourceNotes: ['source metadata only'],
    tags: ['reference'],
    allowedUses: ['prompt_context', 'user_reference'],
    sourceLevel: 'local_case',
    sourceRank: 60
  }, {
    provenance: sourceType === 'eagle_library' ? 'local_snapshot' : 'external_snapshot',
    sourceRevision,
    retrievedAt: NOW
  });
}

const eagleV1 = buildVersion('eagle-item-v1', '绿色背景的单品构图。');
const disposition = createDesignKnowledgeDisposition(eagleV1, {
  reason: '构图质量较差，暂不作为设计参考。',
  now: NOW
});
assert.strictEqual(disposition.status, 'disabled');
assert.strictEqual(disposition.sourceRevision, 'eagle-item-v1');
assert.strictEqual(disposition.contentFingerprint, eagleV1.governance.contentFingerprint);

const exact = applyDesignKnowledgeDispositions([eagleV1], [disposition]);
assert.deepStrictEqual(exact.visibleResults, []);
assert.deepStrictEqual(exact.disabledResults.map((item) => item.id), ['shared-reference-id']);

const eagleV2 = buildVersion('eagle-item-v2', '更新后的红色背景单品构图。');
const updated = applyDesignKnowledgeDispositions([eagleV1, eagleV2], [disposition]);
assert.deepStrictEqual(updated.disabledResults.map((item) => item.governance.sourceRevision), ['eagle-item-v1']);
assert.deepStrictEqual(updated.visibleResults.map((item) => item.governance.sourceRevision), ['eagle-item-v2']);

const sameRevisionNewContent = buildVersion('eagle-item-v1', '来源修正后的全新内容。');
const fingerprintScoped = applyDesignKnowledgeDispositions([sameRevisionNewContent], [disposition]);
assert.strictEqual(fingerprintScoped.visibleResults.length, 1);

const webSameId = buildVersion('web-page-v1', '网页中的参考摘要。', 'web_page');
const sourceScoped = applyDesignKnowledgeDispositions([webSameId], [disposition]);
assert.strictEqual(sourceScoped.visibleResults.length, 1);

const restored = applyDesignKnowledgeDispositions([eagleV1], []);
assert.strictEqual(restored.visibleResults.length, 1);
assert.strictEqual(restored.disabledResults.length, 0);

console.log(JSON.stringify({
  success: true,
  checks: [
    'a user disposition disables only the exact source version and fingerprint',
    'an updated source revision reappears for review',
    'corrected content is not hidden by an old fingerprint tombstone',
    'same ids from other sources remain visible',
    'removing the disposition restores the knowledge non-destructively'
  ]
}, null, 2));
