#!/usr/bin/env node
'use strict';

const assert = require('assert');
// Scoped-change verification records stay category-neutral and fail closed.
const path = require('path');

require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '..', 'tsconfig.main.json')
});

const root = path.resolve(__dirname, '..');
const {
  buildRuntimeScopedChangeVerificationRecords,
  buildRuntimeScopedVisualReviewVerificationRecords
} = require(path.join(root, 'src', 'shared', 'agent-runtime-v5', 'runtime-scoped-change-records.ts'));

function acceptanceResult(options = {}) {
  const targetLayerId = 31;
  const changedLayerIds = options.unexpectedChange
    ? [targetLayerId, 99]
    : [targetLayerId];
  const assertionStatus = options.assertionStatus || 'passed';
  return {
    success: true,
    acceptance: {
      enabled: true,
      verified: assertionStatus === 'passed' && options.verified !== false,
      noDocumentChangeRisk: false,
      assertionStatus,
      assertions: [{
        id: 'setTextContent.content',
        status: assertionStatus,
        ...(options.omitExpected ? {} : { expected: '新文案' }),
        actual: assertionStatus === 'passed' ? '新文案' : '旧文案',
        scope: options.inferredScope ? 'inferred from active layer' : `explicit layer ids: ${targetLayerId}`,
        affectedLayerIds: [targetLayerId]
      }],
      before: { summary: { truncated: options.truncatedBefore === true } },
      after: { summary: { truncated: false } },
      diff: {
        comparable: true,
        summary: { added: 0, removed: 0, changed: changedLayerIds.length },
        addedLayerIds: [],
        removedLayerIds: [],
        changedLayers: changedLayerIds.map((id) => ({ id, changes: ['text'] }))
      }
    }
  };
}

function unscopedMutationResult() {
  return {
    success: true,
    acceptance: {
      enabled: true,
      verified: true,
      noDocumentChangeRisk: false,
      before: { summary: { truncated: false } },
      after: { summary: { truncated: false } },
      diff: {
        comparable: true,
        summary: { added: 1, removed: 0, changed: 0 },
        addedLayerIds: [99],
        removedLayerIds: [],
        changedLayers: []
      }
    }
  };
}

assert.deepStrictEqual(buildRuntimeScopedChangeVerificationRecords([]), []);

const passed = buildRuntimeScopedChangeVerificationRecords([
  { name: 'setTextContent', result: acceptanceResult() }
]);
assert.deepStrictEqual(passed.map((record) => [record.key, record.status]), [
  ['requested_change_applied', 'passed'],
  ['outside_scope_preserved', 'passed']
]);

const mismatch = buildRuntimeScopedChangeVerificationRecords([
  { name: 'setTextContent', result: acceptanceResult({ assertionStatus: 'failed' }) }
]);
assert.strictEqual(mismatch.find((record) => record.key === 'requested_change_applied').status, 'failed');
assert.strictEqual(mismatch.find((record) => record.key === 'outside_scope_preserved').status, 'passed');

const unexpected = buildRuntimeScopedChangeVerificationRecords([
  { name: 'setTextContent', result: acceptanceResult({ unexpectedChange: true }) }
]);
assert.strictEqual(unexpected.find((record) => record.key === 'requested_change_applied').status, 'passed');
assert.strictEqual(unexpected.find((record) => record.key === 'outside_scope_preserved').status, 'failed');

const implicitTarget = buildRuntimeScopedChangeVerificationRecords([
  { name: 'setTextContent', result: acceptanceResult({ inferredScope: true, omitExpected: true }) }
]);
assert.strictEqual(implicitTarget.find((record) => record.key === 'requested_change_applied').status, 'needs_review');
assert.strictEqual(implicitTarget.find((record) => record.key === 'outside_scope_preserved').status, 'needs_review');

const truncatedDiff = buildRuntimeScopedChangeVerificationRecords([
  { name: 'setTextContent', result: acceptanceResult({ truncatedBefore: true }) }
]);
assert.strictEqual(truncatedDiff.find((record) => record.key === 'requested_change_applied').status, 'needs_review');
assert.strictEqual(truncatedDiff.find((record) => record.key === 'outside_scope_preserved').status, 'needs_review');

const laterUnscopedMutation = buildRuntimeScopedChangeVerificationRecords([
  { name: 'setTextContent', result: acceptanceResult() },
  { name: 'createRectangle', result: unscopedMutationResult() }
]);
assert.strictEqual(laterUnscopedMutation.find((record) => record.key === 'requested_change_applied').status, 'needs_review');
assert.strictEqual(laterUnscopedMutation.find((record) => record.key === 'outside_scope_preserved').status, 'needs_review');

const missingVisualReview = buildRuntimeScopedVisualReviewVerificationRecords([
  { name: 'setTextContent', result: acceptanceResult() }
], { hasFreshVisualEvaluation: false });
assert.deepStrictEqual(missingVisualReview.map((record) => [record.key, record.status]), [
  ['fresh_visual_evaluation', 'needs_review']
]);
assert.deepStrictEqual(buildRuntimeScopedVisualReviewVerificationRecords([
  { name: 'setTextContent', result: acceptanceResult() }
], { hasFreshVisualEvaluation: true }), []);

console.log(JSON.stringify({
  success: true,
  checks: [
    'ordinary Tool success without acceptance produces no scoped-change verification record',
    'explicit target assertion plus comparable before/after diff proves the requested mutation',
    'assertion mismatch fails requested_change_applied',
    'changes outside assertion target ids fail outside_scope_preserved',
    'implicit targets cannot prove either scoped-edit criterion',
    'truncated before/after snapshots cannot prove target or collateral safety',
    'a later mutation without explicit scope assertions invalidates an earlier scoped pass',
    'pixel-visible scoped mutations require a fresh visual review while a fresh review avoids duplicate records'
  ],
  boundary: 'category-neutral acceptance records; no task-text inference and no ordinary Tool-success shortcut'
}, null, 2));
