#!/usr/bin/env node

const path = require('path');

require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '..', 'tsconfig.main.json')
});

function assert(condition, message, details) {
  if (!condition) {
    const suffix = details ? `\n${JSON.stringify(details, null, 2)}` : '';
    throw new Error(`${message}${suffix}`);
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

const repoRoot = path.resolve(__dirname, '..');
const MemoryService = require(path.join(repoRoot, 'src', 'renderer', 'services', 'memory.service.ts')).default;
const {
  buildAgentResponseKnowledgeBundle,
  renderAgentResponseKnowledgePromptSection
} = require(path.join(repoRoot, 'src', 'shared', 'agent-response-knowledge.ts'));
const fs = require('fs');

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function buildCandidate(overrides = {}) {
  return {
    id: 'design-learning-persistence-fixture',
    kind: 'visual_case',
    scope: { type: 'user', id: 'default' },
    status: 'needs_review',
    source: 'imported_case',
    title: '袜子白底主图经验候选',
    summary: '整齐重复、统一阴影和充足留白让袜子 SKU 色卡更干净可信。',
    sourceNotes: [{
      source: 'design-learning-experience',
      summary: 'reference=eagle-case:fixture; review=needs_human_review; heuristics=3',
      status: 'needs_review'
    }],
    tags: ['design-learning', 'visual-case', 'socks', 'sku'],
    appliesTo: ['reference'],
    allowedUses: ['prompt_context', 'user_reference', 'recipe_hint'],
    sourceRank: 0,
    createdAt: '2026-05-29T02:00:00.000Z',
    updatedAt: '2026-05-29T02:00:00.000Z',
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
    '置信',
    'C:\\Users\\',
    'D:\\Eagle\\library'
  ];
  const found = forbidden.filter((token) => text.includes(token));
  assert(found.length === 0, `${label} must not expose unsafe payloads, confidence markers or local paths: ${found.join(', ')}`, value);
}

function run() {
  const service = new MemoryService();
  assert(typeof service.recordDesignLearningMemoryReview === 'function', 'MemoryService must expose recordDesignLearningMemoryReview');
  assert(typeof service.listPersistedDesignMemoryItems === 'function', 'MemoryService must expose listPersistedDesignMemoryItems');

  const pending = service.recordDesignLearningMemoryReview({
    candidate: buildCandidate({
      summary: 'data:image/png;base64,AAAA C:\\Users\\unsafe\\ref.png rawImage confidence 不应进入记忆。'
    }),
    decision: 'needs_review',
    reviewer: '设计负责人',
    notes: ['继续观察同类袜子案例。', 'D:\\Eagle\\library\\unsafe.jpg 不能持久化'],
    reviewedAt: '2026-05-29T02:05:00.000Z'
  });
  assert(pending.status === 'kept_needs_review', 'pending learning review should be persisted as needs_review result', pending);
  assert(pending.reviewedItem.status === 'needs_review', 'pending reviewed item must remain needs_review', pending.reviewedItem);

  let stored = service.listPersistedDesignMemoryItems({ source: 'imported_case' });
  assert(stored.length === 1, 'pending learning memory should be stored for later review', stored);
  assert(stored[0].status === 'needs_review', 'stored pending memory must stay needs_review', stored[0]);
  assertNoUnsafePayload({ pending, stored, localStorage: global.localStorage.dump() }, 'pending memory persistence');

  let knowledge = service.getDesignKnowledgeResults({
    query: '袜子 主图',
    intents: ['reference'],
    sourceTypes: ['local_case'],
    limit: 5
  });
  assert(knowledge.length === 0, 'needs_review learning memory must not enter active knowledge search', knowledge);

  const reloadedPending = new MemoryService();
  stored = reloadedPending.listPersistedDesignMemoryItems({ status: 'needs_review' });
  assert(stored.length === 1, 'stored pending learning memory should survive reload', stored);

  const approved = reloadedPending.recordDesignLearningMemoryReview({
    candidate: buildCandidate(),
    decision: 'approved',
    reviewer: '设计负责人',
    notes: ['可以作为袜子白底 SKU 参考经验。'],
    reviewedAt: '2026-05-29T02:10:00.000Z'
  });
  assert(approved.status === 'promoted_active', 'approved learning review should promote stored memory', approved);
  stored = reloadedPending.listPersistedDesignMemoryItems({ status: 'active' });
  assert(stored.length === 1, 'approved learning memory should replace prior pending copy', stored);
  assert(stored[0].sourceRank >= 70, 'approved stored memory should regain source rank', stored[0]);

  knowledge = reloadedPending.getDesignKnowledgeResults({
    query: '袜子 主图',
    intents: ['reference'],
    sourceTypes: ['local_case'],
    limit: 5
  });
  assert(knowledge.length === 1, 'approved learning memory should enter active design knowledge search', knowledge);
  assert(knowledge[0].id === 'local-memory:design-learning-persistence-fixture', 'approved knowledge result should keep stable id', knowledge);
  const responseKnowledgeBundle = buildAgentResponseKnowledgeBundle({
    userText: '帮我做袜子 SKU 色卡',
    knowledgeResults: knowledge,
    skillFacts: [{ id: 'sku-batch', name: 'SKU Batch', visibility: 'user-facing', enabled: true }]
  });
  const responsePromptSection = renderAgentResponseKnowledgePromptSection(responseKnowledgeBundle);
  assert(
    responseKnowledgeBundle.knowledge.contextItems.some((item) => item.title === '袜子白底主图经验候选'),
    'approved learning memory should enter agent response knowledge context',
    responseKnowledgeBundle.knowledge
  );
  assert(
    responsePromptSection.includes('袜子白底主图经验候选') && responsePromptSection.includes('整齐重复'),
    'approved learning memory should render as reusable designer-facing response experience',
    responsePromptSection
  );

  const rejected = reloadedPending.recordDesignLearningMemoryReview({
    candidate: buildCandidate(),
    decision: 'rejected',
    reviewer: '设计负责人',
    notes: ['这个参考不适合当前品牌。'],
    reviewedAt: '2026-05-29T02:15:00.000Z'
  });
  assert(rejected.status === 'rejected_disabled', 'rejected learning review should disable stored memory', rejected);
  stored = reloadedPending.listPersistedDesignMemoryItems({ status: 'disabled' });
  assert(stored.length === 1, 'rejected learning memory should replace prior active copy as disabled', stored);
  knowledge = reloadedPending.getDesignKnowledgeResults({
    query: '袜子 主图',
    intents: ['reference'],
    sourceTypes: ['local_case'],
    limit: 5
  });
  assert(knowledge.length === 0, 'rejected learning memory must not enter active design knowledge search', knowledge);

  assertThrows(
    () => reloadedPending.recordDesignLearningMemoryReview({
      candidate: buildCandidate({ source: 'manual_setting' }),
      decision: 'approved',
      reviewer: '设计负责人',
      reviewedAt: '2026-05-29T02:20:00.000Z'
    }),
    'invalid learning candidate must not be persisted',
    (error) => String(error?.message || '').includes('记录设计学习记忆失败')
  );
  assert(reloadedPending.listPersistedDesignMemoryItems({ source: 'imported_case' }).length === 1, 'blocked review must not add extra stored memory');

  assertNoUnsafePayload({
    rejected,
    stored: reloadedPending.listPersistedDesignMemoryItems({}),
    localStorage: global.localStorage.dump()
  }, 'final learning memory persistence');

  const packageJson = JSON.parse(read('package.json'));
  assert(packageJson.scripts['smoke:design-learning:memory-persistence'], 'package script should expose design learning memory persistence smoke');
  assert(packageJson.scripts['maintenance:preflight'].includes('smoke:design-learning:memory-persistence'), 'maintenance preflight should include design learning memory persistence smoke');

  const boundaries = read('scripts/report-change-boundaries.cjs');
  assert(boundaries.includes('smoke:design-learning:memory-persistence'), 'change boundary validation should include design learning memory persistence smoke');
  assert(boundaries.includes('smoke-design-learning-memory-persistence'), 'change boundary matcher should include design learning memory persistence smoke file');

  const hygiene = read('scripts/validate-maintenance-hygiene.cjs');
  assert(hygiene.includes('smoke-design-learning-memory-persistence.cjs'), 'maintenance hygiene should check design learning memory persistence smoke');

  console.log(JSON.stringify({
    success: true,
    checks: [
      'MemoryService persists design-learning memory review results',
      'needs_review and rejected learning memories stay out of active design knowledge search',
      'approved learning memories are consumed by local design knowledge search',
      'approved learning memories are rendered into agent response knowledge context',
      'blocked review results are rejected before persistence',
      'raw/base64 image payload markers, confidence fields and local paths are redacted before storage',
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
