#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '..', 'tsconfig.main.json')
});

const root = path.resolve(__dirname, '..');
const {
  buildSkuHumanReviewBinding,
  buildSkuHumanReviewCard,
  buildSkuHumanReviewIntakeFromCard,
  buildSkuHumanReviewTarget,
  validateSkuHumanReviewCardValue
} = require(path.join(root, 'src', 'shared', 'sku-human-review.ts'));
const {
  normalizeHumanReviewRecord
} = require(path.join(root, 'src', 'shared', 'human-review-record.ts'));
const {
  adaptDesignEvaluationRecordsFromToolResults
} = require(path.join(root, 'src', 'shared', 'agent-runtime-v5', 'design-evaluation-result-adapters.ts'));
const {
  SKU_BATCH_EVALUATION_PROFILE_ID,
  getDesignEvaluationProfileById
} = require(path.join(root, 'src', 'shared', 'agent-runtime-v5', 'design-evaluation-profiles.ts'));

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
const MemoryService = require(path.join(root, 'src', 'renderer', 'services', 'memory.service.ts')).default;

function exportReadback(shaSuffix = '1') {
  return {
    version: 'sku-export-readback/v0',
    status: 'ready_for_review',
    expectedExportCount: 2,
    fileProbeCount: 2,
    okFileProbeCount: 2,
    failedFileProbeCount: 0,
    missingFileProbeCount: 0,
    dimensionMismatchCount: 0,
    fileProbes: [
      {
        fileName: '2双装.png',
        success: true,
        byteLength: 12001,
        dimensions: { width: 800, height: 800 },
        sha256: `aaaaaaaaaaaaaaa${shaSuffix}`,
        rawImagesRedacted: true
      },
      {
        fileName: '3双装.png',
        success: true,
        byteLength: 14002,
        dimensions: { width: 800, height: 800 },
        sha256: `bbbbbbbbbbbbbbb${shaSuffix}`,
        rawImagesRedacted: true
      }
    ],
    boundaries: {
      readonly: true,
      rawImagesRedacted: true,
      doesNotClaimDesignQuality: true,
      doesNotRunPhotoshop: true
    }
  };
}

function recordFromCard(service, card, value, timestamp) {
  const validation = validateSkuHumanReviewCardValue(card.payload, value);
  assert.strictEqual(validation.canSubmit, true, validation.blockers.join('; '));
  const intake = buildSkuHumanReviewIntakeFromCard({
    card,
    value: validation.normalizedValue,
    generatedAt: timestamp
  });
  return service.recordHumanReview({
    projectId: card.payload.target.projectFingerprint,
    intake,
    recordedAt: timestamp
  });
}

function byKey(result) {
  return new Map(result.records.map((record) => [record.key, record]));
}

console.log('smoke: sku-human-review-writeback');

const target = buildSkuHumanReviewTarget({
  projectIdentity: 'C:\\UXP\\projects\\C-1160',
  exportReadback: exportReadback('1')
});
assert.strictEqual(target.status, 'ready_for_review');
assert.strictEqual(target.canRequestHumanReview, true);
assert.match(target.projectFingerprint, /^project-[a-f0-9]{16}$/);
assert.match(target.subject.fingerprint, /^review-subject-[a-f0-9]{16}$/);
assert.strictEqual(target.outputDigestCount, 2);

const sameTarget = buildSkuHumanReviewTarget({
  projectIdentity: 'c:/uxp/projects/c-1160/',
  exportReadback: {
    ...exportReadback('1'),
    fileProbes: [...exportReadback('1').fileProbes].reverse()
  }
});
assert.strictEqual(sameTarget.subject.fingerprint, target.subject.fingerprint, 'probe order and path separators must not change the target');

const missingDigestTarget = buildSkuHumanReviewTarget({
  projectIdentity: 'C:\\UXP\\projects\\C-1160',
  exportReadback: {
    ...exportReadback('1'),
    fileProbes: exportReadback('1').fileProbes.map((probe, index) => index === 0 ? { ...probe, sha256: undefined } : probe)
  }
});
assert.strictEqual(missingDigestTarget.status, 'blocked_missing_output_digest');
assert.strictEqual(missingDigestTarget.canRequestHumanReview, false);

const card = buildSkuHumanReviewCard({
  target,
  requirements: ['核对商品形态与真实颜色', '核对阴影和排版一致性']
});
assert.ok(card);
assert.strictEqual(card.kind, 'sku_human_review');
assert.strictEqual(card.submitAction, 'submitSkuHumanReviewCard');

const missingReviewer = validateSkuHumanReviewCardValue(card.payload, {
  decision: 'approved',
  score: 0.9
});
assert.strictEqual(missingReviewer.canSubmit, false);
assert.ok(missingReviewer.blockers.some((item) => item.includes('复核人')));

const missingScore = validateSkuHumanReviewCardValue(card.payload, {
  decision: 'approved',
  reviewer: '设计负责人'
});
assert.strictEqual(missingScore.canSubmit, false);
assert.ok(missingScore.blockers.some((item) => item.includes('评分')));

const service = new MemoryService();
const approvedRecord = recordFromCard(service, card, {
  decision: 'approved',
  reviewer: '设计负责人',
  score: 0.93,
  notes: ['商品真实，色差与排版一致']
}, '2026-07-12T10:00:00.000Z');
assert.strictEqual(approvedRecord.status, 'recorded_approved');
assert.strictEqual(approvedRecord.source.subject.fingerprint, target.subject.fingerprint);
assert.match(approvedRecord.integrityFingerprint, /^hr-integrity-[a-f0-9]{16}$/);

const reloaded = new MemoryService();
const restored = reloaded.listHumanReviewRecords({
  projectId: target.projectFingerprint,
  scenario: 'sku',
  subjectFingerprint: target.subject.fingerprint
});
assert.strictEqual(restored.length, 1, 'bound review must survive local persistence');

const approvedBinding = buildSkuHumanReviewBinding({ target, record: restored[0] });
assert.strictEqual(approvedBinding.status, 'fresh_review_approved');
assert.strictEqual(approvedBinding.canSatisfyHumanReviewCheck, true);
assert.strictEqual(approvedBinding.freshness.recordIntegrityVerified, true);

const changedTarget = buildSkuHumanReviewTarget({
  projectIdentity: 'C:\\UXP\\projects\\C-1160',
  exportReadback: exportReadback('2')
});
const staleBinding = buildSkuHumanReviewBinding({ target: changedTarget, record: restored[0] });
assert.strictEqual(staleBinding.status, 'stale_review_ignored');
assert.strictEqual(staleBinding.canSatisfyHumanReviewCheck, false);

const tamperedRecord = {
  ...restored[0],
  review: { ...restored[0].review, decision: 'rejected' }
};
assert.strictEqual(normalizeHumanReviewRecord(tamperedRecord), undefined, 'integrity mismatch must reject a modified persisted record');
const invalidBinding = buildSkuHumanReviewBinding({ target, record: tamperedRecord });
assert.strictEqual(invalidBinding.status, 'invalid_review_ignored');

const rejectedRecord = recordFromCard(service, card, {
  decision: 'rejected',
  reviewer: '设计负责人',
  notes: ['颜色失真，需要重做']
}, '2026-07-12T10:01:00.000Z');
const rejectedBinding = buildSkuHumanReviewBinding({ target, record: rejectedRecord });
assert.strictEqual(rejectedBinding.status, 'fresh_review_rejected');
assert.strictEqual(rejectedBinding.canSatisfyHumanReviewCheck, false);

const profile = getDesignEvaluationProfileById(SKU_BATCH_EVALUATION_PROFILE_ID);
assert.ok(profile);
const baseData = {
  skuDeliverySummary: {
    version: 'sku-delivery-summary/v0',
    status: 'completed',
    totalCombos: 1,
    noteCount: 0,
    warningCount: 0
  },
  skuExecutionManifest: [{ status: 'ready', comboCount: 1, plannedActions: ['combo'], blockers: [] }],
  skuExportReadback: {
    ...exportReadback('1'),
    fileProbes: exportReadback('1').fileProbes.map((probe) => ({
      ...probe,
      visualMetrics: { rawImagesRedacted: true }
    }))
  },
  skuVisualReviewIntake: {
    version: 'sku-visual-review-intake/v0',
    status: 'human_review_recorded',
    blockers: [],
    humanReview: { decision: 'approved' }
  }
};
const approvedEvaluation = adaptDesignEvaluationRecordsFromToolResults({
  profile,
  toolResults: [{
    name: 'sku-batch',
    result: { success: true, data: { ...baseData, skuHumanReviewBinding: approvedBinding } }
  }]
});
assert.strictEqual(byKey(approvedEvaluation).get('sku_product_truth').status, 'passed');

const spoofedEvaluation = adaptDesignEvaluationRecordsFromToolResults({
  profile,
  toolResults: [{
    name: 'sku-batch',
    result: {
      success: true,
      data: {
        ...baseData,
        skuHumanReviewBinding: buildSkuHumanReviewBinding({ target })
      }
    }
  }]
});
assert.strictEqual(byKey(spoofedEvaluation).get('sku_product_truth').status, 'needs_review', 'unbound intake approval must not pass');

const executor = fs.readFileSync(path.join(root, 'src', 'renderer', 'services', 'skill-executors', 'sku-batch.executor.ts'), 'utf8');
const chatPanel = fs.readFileSync(path.join(root, 'src', 'renderer', 'components', 'ChatPanel.tsx'), 'utf8');
const cardView = fs.readFileSync(path.join(root, 'src', 'renderer', 'components', 'message', 'blocks', 'InteractiveCardBlock.tsx'), 'utf8');
const adapter = fs.readFileSync(path.join(root, 'src', 'shared', 'agent-runtime-v5', 'design-evaluation-result-adapters.ts'), 'utf8');
assert.ok(executor.includes('buildSkuHumanReviewTarget') && executor.includes('skuHumanReviewBinding'));
assert.ok(executor.includes('listHumanReviewRecords') && executor.includes('interactiveCards: [skuHumanReviewCard]'));
assert.ok(chatPanel.includes("case 'submitSkuHumanReviewCard'") && chatPanel.includes('recordHumanReview'));
assert.ok(cardView.includes("card.kind === 'sku_human_review'") && cardView.includes('写入本批次复核记录'));
assert.ok(adapter.includes("binding?.version !== 'sku-human-review-binding/v0'"));
assert.ok(!adapter.includes("intake.status === 'human_review_recorded' && decision === 'approved'"));

const serialized = JSON.stringify({ target, card, approvedRecord, approvedBinding });
for (const forbidden of ['C:\\UXP', 'projects\\C-1160', 'aaaaaaaaaaaaaaaa', 'bbbbbbbbbbbbbbbb', 'data:image', '"rawImage":']) {
  assert.ok(!serialized.includes(forbidden), `public review artifacts must redact raw identity marker: ${forbidden}`);
}

console.log(JSON.stringify({
  success: true,
  checks: [
    'SKU review target binds stable anonymous project identity and every export content digest',
    'missing hashes block review card creation instead of falling back to file names',
    'approved/rejected review records persist with subject and integrity fingerprints',
    'same output restores approved review while changed output invalidates stale review',
    'tampered persisted record is rejected by integrity verification',
    'Evaluation adapter trusts only freshness-verified SKU review binding',
    'dedicated UI submission writes review deterministically without model or Photoshop execution'
  ]
}, null, 2));
