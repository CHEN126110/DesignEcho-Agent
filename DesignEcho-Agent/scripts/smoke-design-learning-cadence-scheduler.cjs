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
  buildDesignLearningCadenceSchedule
} = require('../src/shared/design-learning-cadence-scheduler.ts');

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
    'C:\\Users\\',
    'D:\\Eagle\\library'
  ];
  const found = forbidden.filter((token) => text.includes(token));
  assert(found.length === 0, `${label} must not expose unsafe payloads, score markers or local paths: ${found.join(', ')}`, value);
}

function run() {
  const ready = buildDesignLearningCadenceSchedule({
    now: '2026-05-29T08:00:00.000Z',
    cadence: 'daily',
    lastRunAt: '2026-05-28T05:30:00.000Z',
    preferredTopics: ['袜子主图', 'SKU 色卡精修', '袜子主图'],
    knowledgeGaps: ['花边罗口形态统一边界', '详情页首屏视觉节奏'],
    recentRejectedTopics: ['过度渐变背景'],
    sourceAvailability: {
      eagleReadonly: true,
      webSearch: true,
      projectCases: true,
      visualAnalysis: true
    },
    maxReferences: 6
  });

  assert(ready.version === 'design-learning-cadence-scheduler/v0', 'scheduler should expose a stable version', ready);
  assert(ready.status === 'ready_to_run', 'daily scheduler should be due after the cadence interval', ready);
  assert(ready.due === true, 'ready schedule should be due', ready);
  assert(ready.runRequest?.plan?.version === 'design-learning-daily-research-plan/v0', 'ready schedule should include a daily research plan', ready.runRequest);
  assert(ready.runRequest.canRunRuntime === true, 'ready schedule should be runnable by the injected runtime runner', ready.runRequest);
  assert(ready.runRequest.mustReviewBeforePersisting === true, 'daily learning must require review before persisting memory', ready.runRequest);
  assert(ready.topics.includes('袜子主图'), 'scheduler should preserve user preferred topics', ready.topics);
  assert(ready.topics.includes('花边罗口形态统一边界'), 'scheduler should turn knowledge gaps into research topics', ready.topics);
  assert(!ready.topics.includes('过度渐变背景'), 'scheduler should avoid recently rejected topics', ready.topics);
  assert(ready.boundaries.doesNotExecuteSearch === true, 'scheduler must not execute search itself', ready.boundaries);
  assert(ready.boundaries.doesNotCallProvider === true, 'scheduler must not call providers itself', ready.boundaries);
  assert(ready.boundaries.noPhotoshopWrites === true, 'scheduler must not write Photoshop', ready.boundaries);
  assert(ready.boundaries.doesNotWriteEagle === true, 'scheduler must not write Eagle', ready.boundaries);
  assert(ready.boundaries.doesNotPersistMemory === true, 'scheduler must not persist memory', ready.boundaries);
  assert(ready.limitations.some((item) => item.includes('复核')), 'scheduler should state review-before-persisting limitations', ready.limitations);
  assertNoUnsafePayload(ready, 'ready cadence schedule');

  const notDue = buildDesignLearningCadenceSchedule({
    now: '2026-05-29T08:00:00.000Z',
    cadence: 'daily',
    lastRunAt: '2026-05-29T07:00:00.000Z',
    preferredTopics: ['袜子主图'],
    sourceAvailability: {
      eagleReadonly: true,
      webSearch: true,
      projectCases: true,
      visualAnalysis: true
    }
  });
  assert(notDue.status === 'not_due', 'recent daily learning should not run again immediately', notDue);
  assert(notDue.due === false, 'not_due schedule should not be due', notDue);
  assert(!notDue.runRequest, 'not_due schedule must not fabricate a runtime request', notDue);

  const manual = buildDesignLearningCadenceSchedule({
    now: '2026-05-29T08:00:00.000Z',
    cadence: 'manual',
    preferredTopics: ['袜子详情页'],
    sourceAvailability: {
      eagleReadonly: true,
      visualAnalysis: true
    }
  });
  assert(manual.status === 'waiting_manual_trigger', 'manual cadence should wait for explicit trigger', manual);
  assert(manual.due === false, 'manual cadence should not auto-run', manual);
  assert(!manual.runRequest, 'manual cadence should not create automatic runtime request', manual);

  const blocked = buildDesignLearningCadenceSchedule({
    now: '2026-05-29T08:00:00.000Z',
    cadence: 'daily',
    preferredTopics: ['袜子主图'],
    sourceAvailability: {
      visualAnalysis: true
    }
  });
  assert(blocked.status === 'blocked_no_reference_sources', 'scheduler should block when no reference sources are available', blocked);
  assert(blocked.due === false, 'blocked schedule is not runnable', blocked);
  assert(blocked.blockers.includes('reference_source_required'), 'blocked schedule should expose reference source blocker', blocked.blockers);

  const unsafe = buildDesignLearningCadenceSchedule({
    now: '2026-05-29T08:00:00.000Z',
    cadence: 'daily',
    lastRunAt: '2026-05-28T05:30:00.000Z',
    preferredTopics: [
      '%USERPROFILE%\\Desktop\\secret.png',
      'data:image/png;base64,AAAA',
      'SKU 色卡'
    ],
    sourceAvailability: {
      eagleReadonly: true,
      visualAnalysis: true
    }
  });
  assert(!unsafe.topics.some((item) => item.includes('C:\\Users\\') || item.includes('data:image')), 'scheduler should remove unsafe topic payloads', unsafe.topics);
  assert(unsafe.topics.includes('SKU 色卡'), 'scheduler should keep safe topics while dropping unsafe ones', unsafe.topics);
  assertNoUnsafePayload(unsafe, 'unsafe-topic cadence schedule');

  const packageJson = JSON.parse(read('package.json'));
  assert(packageJson.scripts['smoke:design-learning:cadence-scheduler'], 'package script should expose design learning cadence scheduler smoke');
  assert(packageJson.scripts['maintenance:preflight'].includes('smoke:design-learning:cadence-scheduler'), 'maintenance preflight should include design learning cadence scheduler smoke');

  const boundaries = read('scripts/report-change-boundaries.cjs');
  assert(boundaries.includes('design-learning-cadence-scheduler'), 'change boundary matcher should include design learning cadence scheduler');
  assert(boundaries.includes('smoke:design-learning:cadence-scheduler'), 'change boundary validation should include cadence scheduler smoke');

  const hygiene = read('scripts/validate-maintenance-hygiene.cjs');
  assert(hygiene.includes('smoke-design-learning-cadence-scheduler.cjs'), 'maintenance hygiene should check design learning cadence scheduler smoke');

  console.log(JSON.stringify({
    success: true,
    checks: [
      'daily cadence scheduler turns preferences and knowledge gaps into research topics',
      'scheduler creates a runtime request only when due and reference sources are available',
      'manual and not-due schedules do not fabricate runtime requests',
      'scheduler never executes search, calls providers, writes Eagle, writes Photoshop or persists memory',
      'unsafe raw image payloads, local paths and score markers are removed',
      'package, preflight, change-boundary and maintenance hygiene wiring are present'
    ]
  }, null, 2));
}

run();
