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

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function exists(relativePath) {
  return fs.existsSync(path.join(repoRoot, relativePath));
}

function assert(condition, message, details) {
  if (!condition) {
    const suffix = details ? `\n${JSON.stringify(details, null, 2)}` : '';
    throw new Error(`${message}${suffix}`);
  }
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

function buildCandidate(overrides = {}) {
  return {
    id: 'design-learning-settings-review-fixture',
    kind: 'visual_case',
    scope: { type: 'user' },
    status: 'needs_review',
    source: 'imported_case',
    title: '袜子色卡排版学习候选',
    summary: '统一袜口高度、留出稳定底部标签区域，让 SKU 色卡更容易比较。',
    sourceNotes: [{
      source: 'design-learning-experience',
      summary: 'reference=eagle-case:sku-color-card; review=needs_human_review',
      status: 'needs_review'
    }],
    tags: ['design-learning', 'sku', 'color-card'],
    appliesTo: ['reference', 'recipe'],
    allowedUses: ['prompt_context', 'recipe_hint'],
    sourceRank: 0,
    createdAt: '2026-06-01T09:00:00.000Z',
    updatedAt: '2026-06-01T09:00:00.000Z',
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

function run() {
  const settingsPath = 'src/renderer/components/SettingsModal.tsx';
  const panelPath = 'src/renderer/components/DesignLearningReviewSettingsPanel.tsx';
  const learningCenterPath = 'src/renderer/components/KnowledgeLearningCenter.tsx';
  const workbenchPath = 'src/renderer/components/DesignAgentWorkbench.tsx';
  const memoryServicePath = 'src/renderer/services/memory.service.ts';

  assert(exists(panelPath), 'Design learning review settings panel should exist');

  const settings = read(settingsPath);
  const panel = read(panelPath);
  const learningCenter = read(learningCenterPath);
  const workbench = read(workbenchPath);
  const memoryServiceSource = read(memoryServicePath);

  const settingsTabConfig = settings.match(/const SETTINGS_TABS:[\s\S]*?= \[([\s\S]*?)\n\];/)?.[1] || '';
  assert(!settingsTabConfig.includes("id: 'learning'"), 'Visible Settings tabs must not expose the migrated learning review entry');
  assert(learningCenter.includes('<DesignLearningReviewSettingsPanel'), 'Knowledge Learning Center must delegate review UI to the existing panel');
  assert(learningCenter.includes('getMemoryService().subscribe'), 'Knowledge Learning Center must refresh when managed knowledge changes');

  assert(panel.includes('getDesignLearningMemoryReviewQueueView'), 'learning review panel must read a safe queue view through MemoryService');
  assert(panel.includes("listPersistedDesignMemoryItems({") && panel.includes("status: 'active'"), 'learning settings must keep approved knowledge visible after review');
  assert(panel.includes('已采用的长期设计记忆'), 'learning settings must label the approved memory list for users');
  assert(panel.includes('reviewDesignLearningMemoryCandidateById'), 'learning review panel must persist review decisions through MemoryService');
  assert(panel.includes('学习复核'), 'learning review panel must use user-facing Chinese copy');
  assert(panel.includes('批准') && panel.includes('拒绝') && panel.includes('稍后'), 'learning review panel must expose approve/reject/keep-later actions');
  assert(!panel.includes('localStorage.'), 'learning review panel must not directly access localStorage');
  assert(!panel.includes('window.designEcho'), 'learning review panel must not call desktop, Eagle, provider or Photoshop bridge APIs');
  assert(!panel.includes('runManual') && !panel.includes('prepareOnAppStart'), 'review UI must not trigger design-learning runtime execution');
  assertNoUnsafePayload(panel, 'learning review panel source');

  assert(memoryServiceSource.includes('reviewDesignLearningMemoryCandidateById('), 'MemoryService must expose candidate-id review method');

  assert(!workbench.includes('DesignLearningReviewSettingsPanel'), 'Workbench should not embed design-learning review UI in the default chat surface');
  assert(!workbench.includes('getDesignLearningMemoryReviewQueueView'), 'Workbench should not load learning review queue in the default chat surface');
  assert(!workbench.includes('reviewDesignLearningMemoryCandidateById'), 'Workbench should not expose learning review actions in the default chat surface');

  global.localStorage = createLocalStorageMock();
  const MemoryService = require(path.join(repoRoot, memoryServicePath)).default;
  const service = new MemoryService();
  service.recordDesignLearningMemoryReview({
    candidate: buildCandidate({
      summary: '%USERPROFILE%\\Desktop\\unsafe.png data:image/png;base64,AAAA confidence 不应出现在设置复核入口。'
    }),
    decision: 'needs_review',
    reviewer: 'design-learning-settings-smoke',
    notes: ['等待知识库复核'],
    reviewedAt: '2026-06-01T09:05:00.000Z'
  });
  const before = service.getDesignLearningMemoryReviewQueueView({ limit: 5 });
  assert(before.items.length === 1, 'review settings queue should expose one pending learning candidate', before);
  assertNoUnsafePayload(before, 'review queue before settings action');

  const approved = service.reviewDesignLearningMemoryCandidateById({
    candidateId: 'design-learning-settings-review-fixture',
    decision: 'approved',
    reviewer: 'knowledge-library-learning-review',
    notes: ['知识库批准为可用设计经验。'],
    reviewedAt: '2026-06-01T09:10:00.000Z'
  });
  assert(approved.status === 'promoted_active', 'candidate-id review should promote approved learning candidate', approved);
  assert(service.getDesignLearningMemoryReviewQueueView({ limit: 5 }).items.length === 0, 'approved candidate should leave needs_review queue');
  assert(service.getDesignKnowledgeResults({
    query: '袜子 SKU 色卡',
    intents: ['reference'],
    sourceTypes: ['local_case'],
    limit: 5
  }).length === 1, 'approved candidate should enter active local design knowledge');

  const packageJson = JSON.parse(read('package.json'));
  assert(packageJson.scripts['smoke:design-learning:review-settings-entry'], 'package script should expose learning review settings smoke');
  assert(packageJson.scripts['maintenance:preflight'].includes('smoke:design-learning:review-settings-entry'), 'maintenance preflight should include learning review settings smoke');

  const boundaries = read('scripts/report-change-boundaries.cjs');
  assert(boundaries.includes('smoke:design-learning:review-settings-entry'), 'change boundary validation should include learning review settings smoke');
  assert(boundaries.includes('DesignLearningReviewSettingsPanel'), 'change boundary matcher should include learning review settings panel');

  const hygiene = read('scripts/validate-maintenance-hygiene.cjs');
  assert(hygiene.includes('smoke-design-learning-review-settings-entry.cjs'), 'maintenance hygiene should check learning review settings smoke');
  assert(hygiene.includes('DesignEcho-Agent/src/renderer/components/DesignLearningReviewSettingsPanel.tsx'), 'maintenance hygiene should track learning review settings panel');

  console.log(JSON.stringify({
    success: true,
    checks: [
      'visible Settings tabs no longer expose learning review',
      'Knowledge Learning Center delegates review UI to the existing component',
      'review actions use MemoryService and do not call runtime/provider/Photoshop APIs',
      'Workbench default chat surface does not embed the learning review queue',
      'candidate-id review can approve a needs_review candidate into active local design knowledge',
      'UI and service views avoid raw image payloads, local paths and confidence markers',
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
