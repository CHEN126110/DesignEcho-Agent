#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

require('ts-node').register({ transpileOnly: true, project: path.resolve(__dirname, '..', 'tsconfig.main.json') });

const root = path.resolve(__dirname, '..');
const {
  assessDesignKnowledgeFreshness,
  buildBundledKnowledgeArtifactRecord,
  governDesignKnowledgeResult,
  governExternalDesignKnowledgeResult,
  selectDesignKnowledgeResultsForUse
} = require(path.join(root, 'src', 'shared', 'design-knowledge-governance.ts'));
const {
  normalizeExternalDesignKnowledgeResults,
  searchLocalDesignKnowledge
} = require(path.join(root, 'src', 'shared', 'design-knowledge-search.ts'));
const {
  designMemoryItemToKnowledgeResult
} = require(path.join(root, 'src', 'shared', 'design-memory-knowledge.ts'));
const {
  buildAgentResponseKnowledgeBundle
} = require(path.join(root, 'src', 'shared', 'agent-response-knowledge.ts'));
const {
  planDesignTask
} = require(path.join(root, 'src', 'shared', 'design-planner.ts'));

const NOW = '2026-07-12T12:00:00.000Z';

function check(name, fn) {
  fn();
  console.log(`  ✓ ${name}`);
}

function baseResult(overrides = {}) {
  return {
    id: 'knowledge-fixture-1',
    title: '排版参考',
    intent: 'rule',
    sourceType: 'manual_rule',
    summary: '标题与正文需要形成清晰层级。',
    sourceNotes: ['内部整理的排版原则。'],
    tags: ['typography'],
    allowedUses: ['prompt_context', 'user_reference'],
    sourceLevel: 'curated_rule',
    sourceRank: 80,
    ...overrides
  };
}

function governedLocal(overrides = {}) {
  return governDesignKnowledgeResult(baseResult(overrides), {
    provenance: 'bundled_curated',
    sourceRevision: 'bundle-design-knowledge-v1',
    retrievedAt: '2026-07-01T00:00:00.000Z'
  });
}

console.log('smoke: design-knowledge-governance');

check('Bundled curated knowledge has a stable current binding', () => {
  const result = governedLocal();
  assert.match(result.governance.contentFingerprint, /^knowledge-content-[a-f0-9]{16}$/);
  assert.match(result.governance.integrityFingerprint, /^knowledge-integrity-[a-f0-9]{16}$/);
  assert.strictEqual(assessDesignKnowledgeFreshness(result, NOW), 'current');
});

check('External knowledge becomes stale after its explicit expiry', () => {
  const result = governExternalDesignKnowledgeResult(baseResult({ sourceType: 'web_page', intent: 'trend' }), {
    retrievedAt: '2026-07-10T00:00:00.000Z',
    expiresAt: '2026-07-11T00:00:00.000Z',
    sourceRevision: 'web-snapshot-v1'
  });
  assert.strictEqual(assessDesignKnowledgeFreshness(result, NOW), 'stale');
});

check('Withdrawn and superseded knowledge cannot be used', () => {
  const withdrawn = governDesignKnowledgeResult(baseResult({ id: 'withdrawn' }), {
    provenance: 'bundled_curated', sourceRevision: 'bundle-v1', retrievedAt: NOW, lifecycleStatus: 'withdrawn'
  });
  const superseded = governDesignKnowledgeResult(baseResult({ id: 'superseded' }), {
    provenance: 'bundled_curated', sourceRevision: 'bundle-v1', retrievedAt: NOW,
    lifecycleStatus: 'superseded', supersededBy: 'bundle-v2'
  });
  const selection = selectDesignKnowledgeResultsForUse([withdrawn, superseded], { now: NOW, purpose: 'planning' });
  assert.strictEqual(selection.usableResults.length, 0);
  assert.strictEqual(selection.blockedResults.length, 2);
  assert.strictEqual(selection.snapshot.counts.withdrawnOrSuperseded, 2);
});

check('Content tampering invalidates the knowledge binding', () => {
  const result = governedLocal();
  const tampered = { ...result, summary: '被修改后的规则内容。' };
  assert.strictEqual(assessDesignKnowledgeFreshness(tampered, NOW), 'invalid');
});

check('Lifecycle or expiry tampering invalidates governance integrity', () => {
  const result = governedLocal();
  const tampered = { ...result, governance: { ...result.governance, lifecycleStatus: 'withdrawn' } };
  assert.strictEqual(assessDesignKnowledgeFreshness(tampered, NOW), 'invalid');
});

check('Legacy unversioned knowledge is review-only and not prompt context', () => {
  const legacy = baseResult({ id: 'legacy' });
  const selection = selectDesignKnowledgeResultsForUse([legacy], { now: NOW, purpose: 'prompt_context' });
  assert.strictEqual(selection.usableResults.length, 0);
  assert.strictEqual(selection.reviewResults.length, 1);
  assert.strictEqual(selection.snapshot.counts.legacyUnversioned, 1);
});

check('Allowed-use scope is enforced independently from freshness', () => {
  const userReferenceOnly = governedLocal({ id: 'reference-only', allowedUses: ['user_reference'] });
  const planning = selectDesignKnowledgeResultsForUse([userReferenceOnly], { now: NOW, purpose: 'planning' });
  const reference = selectDesignKnowledgeResultsForUse([userReferenceOnly], { now: NOW, purpose: 'user_reference' });
  assert.strictEqual(planning.usableResults.length, 0);
  assert.strictEqual(reference.usableResults.length, 1);
});

check('Usage snapshot is digest-only, grants no permission and carries no quality decision', () => {
  const result = governExternalDesignKnowledgeResult(baseResult({
    sourceType: 'web_page',
    sourceUrl: 'https://example.com/design?token=secret',
    summary: 'PRIVATE KNOWLEDGE BODY'
  }), { retrievedAt: NOW, sourceRevision: 'web-v1' });
  const snapshot = selectDesignKnowledgeResultsForUse([result], {
    query: 'PRIVATE QUERY', now: NOW, purpose: 'planning'
  }).snapshot;
  const serialized = JSON.stringify(snapshot);
  assert.strictEqual(snapshot.doesNotGrantToolPermission, true);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(snapshot, 'doesNotProveQuality'), false);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(snapshot, 'qualityStatus'), false);
  assert.ok(!serialized.includes('PRIVATE KNOWLEDGE BODY'));
  assert.ok(!serialized.includes('PRIVATE QUERY'));
  assert.ok(!serialized.includes('token=secret'));
});

check('Bundled methodology artifacts receive the same non-authorizing binding', () => {
  const record = buildBundledKnowledgeArtifactRecord({
    id: 'design-principles:all', title: '通用设计原则',
    summary: '构图、色彩、层级与排版方法论正文。', sourceRevision: 'design-principles-v1'
  });
  assert.strictEqual(record.governance.provenance, 'bundled_curated');
  assert.strictEqual(record.usageSnapshot.counts.usable, 1);
  assert.strictEqual(record.usageSnapshot.doesNotGrantToolPermission, true);
  assert.ok(!JSON.stringify(record.usageSnapshot).includes('方法论正文'));
});

check('All bundled methodology Tool returns expose governance and usage snapshots', () => {
  const source = fs.readFileSync(path.join(root, 'src', 'renderer', 'services', 'tool-executor.service.ts'), 'utf8');
  for (const toolName of ['getMainImageDesignFramework', 'getDetailPageDesignFramework', 'getDesignPrinciples']) {
    const start = source.indexOf(`case '${toolName}'`);
    const end = source.indexOf('\n            case ', start + 10);
    const block = source.slice(start, end > start ? end : source.length);
    assert.ok(block.includes('buildBundledKnowledgeArtifactRecord'), `${toolName} missing governed artifact binding`);
    assert.ok(block.includes('knowledgeGovernance'), `${toolName} missing governance return`);
    assert.ok(block.includes('knowledgeUsageSnapshot'), `${toolName} missing usage snapshot return`);
  }
});

check('Local bundled search emits governed current results and a snapshot', () => {
  const response = searchLocalDesignKnowledge({ query: '详情页', intents: ['rule'], sourceTypes: ['manual_rule'], limit: 5 });
  assert.ok(response.results.length > 0);
  assert.ok(response.results.every((item) => assessDesignKnowledgeFreshness(item, NOW) === 'current'));
  assert.strictEqual(response.knowledgeUsageSnapshot.counts.usable, response.results.length);
});

check('External normalization emits governed snapshots with bounded source metadata', () => {
  const [result] = normalizeExternalDesignKnowledgeResults({ query: '海报', limit: 1 }, [{
    id: 'external-1', title: '外部参考', sourceType: 'web_page', summary: '外部摘要',
    sourceUrl: 'https://example.com/post?api_key=hidden', updatedAt: NOW
  }]);
  assert.strictEqual(assessDesignKnowledgeFreshness(result, NOW), 'current');
  assert.ok(!result.governance.sourceRevision.includes('api_key'));
});

check('Reviewed Design Memory emits governed local knowledge', () => {
  const result = designMemoryItemToKnowledgeResult({
    id: 'memory-1', kind: 'user_preference', scope: { type: 'user' }, status: 'active',
    source: 'explicit_user_feedback', title: '低广告感', summary: '避免过度营销。',
    sourceNotes: [{ source: 'user-feedback', summary: '用户明确提出。', status: 'active' }],
    allowedUses: ['prompt_context', 'user_reference'], updatedAt: '2026-07-11T00:00:00.000Z'
  });
  assert(result);
  assert.strictEqual(result.governance.provenance, 'local_reviewed');
  assert.strictEqual(assessDesignKnowledgeFreshness(result, NOW), 'current');
});

check('Planner admits only current governed knowledge and records the binding snapshot', () => {
  const current = governedLocal({ id: 'current-planner' });
  const stale = governExternalDesignKnowledgeResult(baseResult({ id: 'stale-planner', sourceType: 'web_page' }), {
    retrievedAt: '2026-07-01T00:00:00.000Z', expiresAt: '2026-07-02T00:00:00.000Z'
  });
  const output = planDesignTask({ userText: '设计一张海报', knowledgeResults: [current, stale, baseResult({ id: 'legacy-planner' })] });
  assert.deepStrictEqual(output.selectedContext.knowledge.map((item) => item.id), ['current-planner']);
  assert.strictEqual(output.selectedContext.knowledgeUsageSnapshot.counts.total, 3);
  assert.ok(output.warnings.some((warning) => warning.includes('过期或缺少版本')));
});

check('Response knowledge excludes stale and unversioned local cases', () => {
  const currentMemory = designMemoryItemToKnowledgeResult({
    id: 'response-current', kind: 'user_preference', scope: { type: 'user' }, status: 'active',
    source: 'explicit_user_feedback', title: '真实感', summary: '保持商品真实纹理。',
    sourceNotes: [{ source: 'user-feedback', summary: 'explicit_user_feedback', status: 'active' }],
    allowedUses: ['prompt_context'], updatedAt: '2026-07-11T00:00:00.000Z'
  });
  const staleMemory = governDesignKnowledgeResult({ ...currentMemory, id: 'response-stale', governance: undefined }, {
    provenance: 'local_reviewed', sourceRevision: 'memory-stale-v1',
    retrievedAt: '2026-07-10T00:00:00.000Z', expiresAt: '2026-07-11T00:00:00.000Z'
  });
  const bundle = buildAgentResponseKnowledgeBundle({
    userText: '如何设计',
    knowledgeResults: [currentMemory, staleMemory, baseResult({ id: 'response-legacy', sourceType: 'local_case', sourceLevel: 'local_case' })]
  });
  assert.strictEqual(bundle.knowledge.contextItems.length, 1);
  assert.strictEqual(bundle.knowledge.usageSnapshot.counts.total, 3);
  assert.match(bundle.knowledge.boundary, /过期、撤回、被取代、篡改或无版本知识被排除/);
});

console.log('smoke-design-knowledge-governance passed (15 checks)');
