#!/usr/bin/env node

require('ts-node').register({
  transpileOnly: true,
  compilerOptions: {
    target: 'ES2020',
    module: 'CommonJS',
    moduleResolution: 'node',
    esModuleInterop: true,
    skipLibCheck: true
  }
});

const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const {
  buildDesignLearningMemoryReviewQueueView
} = require('../src/shared/design-learning-memory-review-queue.ts');
const MemoryService = require('../src/renderer/services/memory.service.ts').default;

function assert(condition, message, details) {
  if (!condition) {
    const suffix = details ? `\n${JSON.stringify(details, null, 2)}` : '';
    throw new Error(`${message}${suffix}`);
  }
}

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function designLearningCandidate(overrides = {}) {
  return {
    id: 'design-learning-memory-queue-fixture',
    kind: 'visual_case',
    scope: { type: 'project', id: 'C-1166' },
    status: 'needs_review',
    source: 'imported_case',
    title: '袜子 SKU 色卡学习候选',
    summary: '%USERPROFILE%\\Desktop\\unsafe.png data:image/png;base64,AAAA confidence 这段不能出现在复核队列。',
    sourceNotes: [{
      source: 'design-learning-experience',
      summary: 'reference=D:\\Eagle\\library\\case.png; review=needs_human_review; confidence=0.93',
      status: 'needs_review'
    }],
    tags: ['design-learning', 'visual-case', 'sku', 'raw-image-payload'],
    appliesTo: ['reference', 'recipe'],
    allowedUses: ['prompt_context', 'user_reference'],
    sourceRank: 0,
    createdAt: '2026-06-01T08:00:00.000Z',
    updatedAt: '2026-06-01T08:05:00.000Z',
    ...overrides
  };
}

function assertNoUnsafePayload(value, label) {
  const text = JSON.stringify(value);
  const forbidden = [
    'data:image',
    'raw-image-payload',
    'base64-image-payload',
    '"base64"',
    '"imageBase64"',
    '"rawImage"',
    '"rawImages"',
    '"buffer"',
    '"bytes"',
    '"pixels"',
    '"confidence"',
    'confidence=',
    '置信',
    'C:\\Users\\',
    'D:\\Eagle\\library'
  ];
  const found = forbidden.filter((token) => text.includes(token));
  assert(found.length === 0, `${label} must not expose unsafe payloads, score markers or local paths: ${found.join(', ')}`, value);
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

function run() {
  const queue = buildDesignLearningMemoryReviewQueueView({
    items: [
      designLearningCandidate(),
      designLearningCandidate({ id: 'approved-should-hide', status: 'active' }),
      designLearningCandidate({ id: 'disabled-should-hide', status: 'disabled' }),
      designLearningCandidate({
        id: 'manual-setting-should-hide',
        source: 'manual_setting',
        tags: ['design-learning'],
        sourceNotes: [{ source: 'manual-setting', summary: 'not a learning case', status: 'needs_review' }]
      })
    ],
    scope: { type: 'project', id: 'C-1166' },
    limit: 8
  });

  assert(queue.version === 'design-learning-memory-review-queue/v0', 'queue view should expose stable version', queue);
  assert(queue.status === 'ready', 'queue should be ready when there are pending candidates', queue);
  assert(queue.summary.pendingCount === 1, 'queue should expose only pending design-learning candidates', queue.summary);
  assert(queue.items.length === 1, 'queue should hide active, disabled and non-learning items', queue.items);
  assert(queue.items[0].candidateId === 'design-learning-memory-queue-fixture', 'queue item should keep stable candidate id', queue.items[0]);
  assert(queue.items[0].actions.approve === true, 'queue item should expose approve action', queue.items[0].actions);
  assert(queue.items[0].actions.reject === true, 'queue item should expose reject action', queue.items[0].actions);
  assert(queue.items[0].actions.keepForLater === true, 'queue item should expose keep-for-later action', queue.items[0].actions);
  assert(!('sourceRank' in queue.items[0]), 'queue item should not expose ranking or internal scoring fields', queue.items[0]);
  assert(queue.boundaries.readonly === true, 'queue builder should be readonly', queue.boundaries);
  assert(queue.boundaries.doesNotPersistMemory === true, 'queue builder should not persist by itself', queue.boundaries);
  assert(queue.boundaries.doesNotCallProvider === true, 'queue builder should not call providers', queue.boundaries);
  assertNoUnsafePayload(queue, 'review queue view');

  global.localStorage = createLocalStorageMock();
  const memoryService = new MemoryService();
  assert(typeof memoryService.getDesignLearningMemoryReviewQueueView === 'function', 'MemoryService should expose design learning review queue view');
  memoryService.recordDesignLearningMemoryReview({
    candidate: designLearningCandidate({
      summary: 'D:\\Eagle\\library\\unsafe.jpg data:image/png;base64,BBBB confidence 不能进入队列视图。'
    }),
    decision: 'needs_review',
    reviewer: 'design-learning-queue-smoke',
    notes: ['稍后复核'],
    reviewedAt: '2026-06-01T08:10:00.000Z'
  });
  const persistedQueue = memoryService.getDesignLearningMemoryReviewQueueView({
    scope: { type: 'project', id: 'C-1166' },
    limit: 5
  });
  assert(persistedQueue.items.length === 1, 'MemoryService queue view should read pending persisted learning memory', persistedQueue);
  assert(persistedQueue.items[0].candidateId === 'design-learning-memory-queue-fixture', 'MemoryService queue should keep candidate id', persistedQueue.items[0]);
  assertNoUnsafePayload(persistedQueue, 'MemoryService review queue view');

  const packageJson = JSON.parse(read('package.json'));
  assert(packageJson.scripts['smoke:design-learning:memory-review-queue'], 'package script should expose review queue smoke');
  assert(packageJson.scripts['maintenance:preflight'].includes('smoke:design-learning:memory-review-queue'), 'maintenance preflight should include review queue smoke');

  const boundaries = read('scripts/report-change-boundaries.cjs');
  assert(boundaries.includes('smoke:design-learning:memory-review-queue'), 'change boundary validation should include review queue smoke');
  assert(boundaries.includes('design-learning-memory-review-queue'), 'change boundary matcher should include review queue source');

  const hygiene = read('scripts/validate-maintenance-hygiene.cjs');
  assert(hygiene.includes('smoke-design-learning-memory-review-queue.cjs'), 'maintenance hygiene should check review queue smoke');

  console.log(JSON.stringify({
    success: true,
    checks: [
      'review queue view includes only pending design-learning candidates',
      'review queue view hides active, disabled and non-learning memory',
      'review queue view exposes approve, reject and keep-for-later actions',
      'review queue view redacts raw image payloads, local paths and score markers',
      'review queue builder is readonly and does not persist or call providers',
      'MemoryService exposes persisted design-learning candidates as the same safe queue view',
      'package, preflight, change-boundary and maintenance hygiene wiring are present'
    ]
  }, null, 2));
}

try {
  run();
} catch (error) {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
}
