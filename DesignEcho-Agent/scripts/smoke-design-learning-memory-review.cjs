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
  reviewDesignLearningMemoryCandidate
} = require('../src/shared/design-learning-memory-review.ts');

const {
  searchDesignMemoryKnowledge
} = require('../src/shared/design-memory-knowledge.ts');

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function assert(condition, message, details) {
  if (!condition) {
    const suffix = details ? `\n${JSON.stringify(details, null, 2)}` : '';
    throw new Error(`${message}${suffix}`);
  }
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
    '置信',
    'C:/Users/',
    'D:/Eagle/library'
  ];
  const found = forbidden.filter((token) => text.includes(token));
  assert(found.length === 0, `${label} should not expose unsafe payloads, confidence markers or local paths: ${found.join(', ')}`, value);
}

function buildCandidate() {
  return {
    id: 'design-learning-memory-fixture',
    kind: 'visual_case',
    scope: { type: 'user', id: 'default' },
    status: 'needs_review',
    source: 'imported_case',
    title: '白底袜子主图学习经验',
    summary: '参考图通过整齐重复、统一阴影和充足留白建立干净可信的 SKU 视觉。',
    sourceNotes: [{
      source: 'design-learning-experience',
      summary: 'reference=eagle-case:fixture; review=needs_human_review; heuristics=3',
      status: 'needs_review'
    }],
    tags: ['design-learning', 'visual-case', 'socks', 'white-background'],
    appliesTo: ['reference', 'recipe'],
    allowedUses: ['prompt_context', 'user_reference', 'recipe_hint'],
    sourceRank: 0,
    createdAt: '2026-05-29T01:00:00.000Z',
    updatedAt: '2026-05-29T01:00:00.000Z'
  };
}

function run() {
  const candidate = buildCandidate();
  const pending = reviewDesignLearningMemoryCandidate({
    candidate,
    decision: 'needs_review',
    reviewer: 'designer',
    notes: ['需要再看同类袜子主图样本。'],
    reviewedAt: '2026-05-29T01:05:00.000Z'
  });

  assert(pending.version === 'design-learning-memory-review/v0', 'review result should expose stable version', pending);
  assert(pending.status === 'kept_needs_review', 'needs_review decision should keep candidate pending', pending);
  assert(pending.reviewedItem.status === 'needs_review', 'pending decision must keep top-level needs_review', pending.reviewedItem);
  assert(pending.reviewedItem.sourceNotes.some((item) => item.status === 'needs_review' && item.source === 'design-learning-review'), 'pending review should append a needs_review source note', pending.reviewedItem);
  assert(pending.boundaries.doesNotPersistMemory === true, 'review builder must not persist memory by itself', pending.boundaries);
  assert(pending.boundaries.noPhotoshopWrites === true, 'review builder must not write Photoshop', pending.boundaries);
  assertNoUnsafePayload(pending, 'pending review');

  const pendingSearch = searchDesignMemoryKnowledge(
    { query: '袜子 主图', intents: ['reference'], sourceTypes: ['local_case'], limit: 5 },
    [pending.reviewedItem]
  );
  assert(pendingSearch.length === 0, 'pending learning review must not become active search result', pendingSearch);

  const approved = reviewDesignLearningMemoryCandidate({
    candidate,
    decision: 'approved',
    reviewer: 'designer',
    notes: ['可作为袜子白底主图参考经验。'],
    reviewedAt: '2026-05-29T01:10:00.000Z'
  });

  assert(approved.status === 'promoted_active', 'approved decision should promote candidate', approved);
  assert(approved.reviewedItem.status === 'active', 'approved candidate should become active memory', approved.reviewedItem);
  assert(approved.reviewedItem.sourceRank >= 70, 'approved candidate should regain useful source rank', approved.reviewedItem);
  assert(approved.reviewedItem.sourceNotes.some((item) => item.status === 'active' && item.summary.includes('approved')), 'approved review should append an active source note', approved.reviewedItem);
  assert(approved.qualityClaim.allowed === false, 'approval still must not claim design quality', approved.qualityClaim);
  assertNoUnsafePayload(approved, 'approved review');

  const approvedSearch = searchDesignMemoryKnowledge(
    { query: '袜子 主图', intents: ['reference'], sourceTypes: ['local_case'], limit: 5 },
    [approved.reviewedItem]
  );
  assert(approvedSearch.length === 1, 'approved learning memory should enter active design memory search', approvedSearch);

  const rejected = reviewDesignLearningMemoryCandidate({
    candidate,
    decision: 'rejected',
    reviewer: 'designer',
    notes: ['这个参考不适合当前品牌。'],
    reviewedAt: '2026-05-29T01:12:00.000Z'
  });

  assert(rejected.status === 'rejected_disabled', 'rejected decision should disable candidate', rejected);
  assert(rejected.reviewedItem.status === 'disabled', 'rejected candidate should stay out of active memory', rejected.reviewedItem);
  assert(rejected.reviewedItem.sourceNotes.some((item) => item.status === 'disabled' && item.summary.includes('rejected')), 'rejected review should append a disabled source note', rejected.reviewedItem);
  const rejectedSearch = searchDesignMemoryKnowledge(
    { query: '袜子 主图', intents: ['reference'], sourceTypes: ['local_case'], limit: 5 },
    [rejected.reviewedItem]
  );
  assert(rejectedSearch.length === 0, 'rejected learning memory must not enter active design memory search', rejectedSearch);
  assertNoUnsafePayload(rejected, 'rejected review');

  const invalid = reviewDesignLearningMemoryCandidate({
    candidate: { ...candidate, source: 'manual_setting' },
    decision: 'approved',
    reviewer: 'designer',
    notes: ['should block'],
    reviewedAt: '2026-05-29T01:15:00.000Z'
  });
  assert(invalid.status === 'blocked_invalid_candidate', 'non learning candidate must be blocked', invalid);
  assert(invalid.reviewedItem.status === 'needs_review', 'invalid candidate must not be promoted', invalid.reviewedItem);

  const packageJson = JSON.parse(read('package.json'));
  assert(packageJson.scripts['smoke:design-learning:memory-review'], 'package script should expose design learning memory review smoke');
  assert(packageJson.scripts['maintenance:preflight'].includes('smoke:design-learning:memory-review'), 'maintenance preflight should include design learning memory review smoke');

  const boundaries = read('scripts/report-change-boundaries.cjs');
  assert(boundaries.includes('design-learning-memory-review'), 'change boundary matcher should include design learning memory review');
  assert(boundaries.includes('smoke:design-learning:memory-review'), 'change boundary validation should include design learning memory review smoke');

  const hygiene = read('scripts/validate-maintenance-hygiene.cjs');
  assert(hygiene.includes('smoke-design-learning-memory-review.cjs'), 'maintenance hygiene should check design learning memory review smoke');

  console.log(JSON.stringify({
    success: true,
    checks: [
      'needs-review learning candidates stay non-active',
      'approved learning candidates are promoted to active memory',
      'rejected learning candidates are disabled',
      'invalid non-learning candidates cannot be promoted',
      'review contract does not persist memory or write Eagle/Photoshop',
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
