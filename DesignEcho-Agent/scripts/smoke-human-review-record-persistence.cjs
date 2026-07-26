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
    },
    dump() {
      return Object.fromEntries(data.entries());
    }
  };
}

global.localStorage = createLocalStorageMock();

const MemoryService = require('../src/renderer/services/memory.service.ts').default;
const {
  buildHumanReviewIntake
} = require('../src/shared/human-review-intake.ts');

const service = new MemoryService();

[
  'recordHumanReview',
  'listHumanReviewRecords'
].forEach((methodName) => {
  assert(typeof service[methodName] === 'function', `MemoryService must expose ${methodName}`);
});

const approvedIntake = buildHumanReviewIntake({
  scenario: 'main-image',
  source: {
    kind: 'qa_report',
    stage: 'needs_manual_review',
    summary: '结果图已完成，data:image/png;base64,AAAA 和 C:\\tmp\\unsafe.png 不应进入台账'
  },
  draft: {
    decision: 'approved',
    reviewer: '设计负责人',
    score: 0.91,
    notes: [
      '构图稳定',
      'rawImage 和 base64-image-payload 需要被脱敏',
      'C:\\素材\\原图.psd 不能写入持久化记录'
    ]
  },
  generatedAt: '2026-05-27T08:00:00.000Z'
});

const record = service.recordHumanReview({
  projectId: 'C-1160',
  recordId: 'review-c-1160-approved',
  recordedAt: '2026-05-27T08:00:01.000Z',
  intake: approvedIntake
});

assert(record.recordVersion === 'human-review-record/v0', 'record should use versioned contract', record);
assert(record.status === 'recorded_approved', 'approved intake should persist as approved record', record);
assert(record.canPersist === true, 'approved record should be persistable', record);
assert(record.qualityClaim.allowed === false, 'record must not claim final design quality', record);
assert(record.canClaimDesignQuality === false, 'record must keep quality claim disabled', record);
assert(record.canRunProvider === false, 'record must not run provider', record);
assert(record.canRunPhotoshop === false, 'record must not run Photoshop', record);

let records = service.listHumanReviewRecords({ projectId: 'C-1160' });
assert(records.length === 1, 'record should be listed under the project', records);
assert(records[0].recordId === 'review-c-1160-approved', 'record id should be preserved', records);

const reloaded = new MemoryService();
records = reloaded.listHumanReviewRecords({ projectId: 'C-1160' });
assert(records.length === 1, 'record should survive service reload from localStorage', records);
assert(records[0].sourceFingerprint && records[0].sourceFingerprint.length >= 8, 'record should keep source fingerprint', records[0]);

const invalidIntake = buildHumanReviewIntake({
  scenario: 'main-image',
  source: null,
  draft: { decision: 'approved', reviewer: '设计负责人', score: 0.9 },
  generatedAt: '2026-05-27T08:01:00.000Z'
});

assertThrows(
  () => service.recordHumanReview({
    projectId: 'C-1160',
    recordId: 'review-c-1160-invalid',
    recordedAt: '2026-05-27T08:01:01.000Z',
    intake: invalidIntake
  }),
  'invalid intake must not be persisted as a review record',
  (error) => String(error?.message || '').includes('记录人工复核失败')
);

records = service.listHumanReviewRecords({ projectId: 'C-1160' });
assert(records.length === 1, 'invalid review should not add a persisted record', records);

const serialized = JSON.stringify({
  record,
  records,
  localStorage: global.localStorage.dump()
});
for (const forbidden of ['confidence', '置信', 'data:image', 'rawImage', 'base64-image-payload', 'C:\\tmp', 'C:\\素材']) {
  assert(!serialized.includes(forbidden), `human review record persistence must not expose forbidden marker: ${forbidden}`);
}

console.log(JSON.stringify({
  success: true,
  checks: [
    'MemoryService exposes human review record persistence methods',
    'valid human review intake persists and reloads as human-review-record/v0',
    'invalid intake is rejected and does not add records',
    'persisted human review records keep provider, Photoshop and final quality claims disabled',
    'raw/base64 image payload markers and local paths are redacted before persistence'
  ]
}, null, 2));
