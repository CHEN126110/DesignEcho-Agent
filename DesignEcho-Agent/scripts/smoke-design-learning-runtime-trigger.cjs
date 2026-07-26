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
const {
  buildDesignLearningRuntimeTrigger
} = require('../src/shared/design-learning-runtime-trigger.ts');

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

function buildReadySchedule() {
  return buildDesignLearningCadenceSchedule({
    now: '2026-05-29T08:00:00.000Z',
    cadence: 'daily',
    lastRunAt: '2026-05-28T05:00:00.000Z',
    preferredTopics: ['袜子主图版式', 'SKU 色卡精修'],
    knowledgeGaps: ['袜子光影统一'],
    sourceAvailability: {
      eagleReadonly: true,
      webSearch: true,
      projectCases: true,
      visualAnalysis: true
    },
    maxReferences: 5
  });
}

function buildBasePolicy(overrides = {}) {
  return {
    enabled: true,
    allowManual: true,
    allowAppStart: true,
    allowScheduledTimer: true,
    reviewQueueAvailable: true,
    ...overrides
  };
}

function buildBaseAdapters(overrides = {}) {
  return {
    eagleReadonlyProvider: true,
    webSearchProvider: true,
    projectCasesProvider: true,
    visualAnalysisAdapter: true,
    ...overrides
  };
}

function run() {
  const readySchedule = buildReadySchedule();
  const appStart = buildDesignLearningRuntimeTrigger({
    triggerSource: 'app_start',
    schedule: readySchedule,
    runtimePolicy: buildBasePolicy(),
    adapterAvailability: buildBaseAdapters(),
    scope: { type: 'user' }
  });

  assert(appStart.version === 'design-learning-runtime-trigger/v0', 'runtime trigger should expose a stable version', appStart);
  assert(appStart.status === 'ready_for_runtime_runner', 'app-start trigger should be ready when schedule, policy and adapters are ready', appStart);
  assert(appStart.canStartRuntime === true, 'ready trigger should be startable', appStart);
  assert(appStart.runtimeEnvelope?.runnerVersion === 'design-learning-runtime-runner/v0', 'trigger should target the learning runtime runner', appStart.runtimeEnvelope);
  assert(appStart.runtimeEnvelope?.runtimeInput?.plan?.version === 'design-learning-daily-research-plan/v0', 'runtime envelope should carry the daily research plan', appStart.runtimeEnvelope);
  assert(appStart.runtimeEnvelope.mustReviewBeforePersisting === true, 'runtime trigger must require review before persistence', appStart.runtimeEnvelope);
  assert(appStart.runtimeEnvelope.shouldRunPhotoshop === false, 'runtime trigger must not write Photoshop', appStart.runtimeEnvelope);
  assert(appStart.runtimeEnvelope.shouldWriteEagle === false, 'runtime trigger must not write Eagle', appStart.runtimeEnvelope);
  assert(appStart.runtimeEnvelope.shouldPersistMemory === false, 'runtime trigger must not persist memory by itself', appStart.runtimeEnvelope);
  assert(appStart.runtimeEnvelope.requiresInjectedReferenceProviders === true, 'runtime trigger should require injected reference providers', appStart.runtimeEnvelope);
  assert(appStart.runtimeEnvelope.requiresInjectedVisualAnalysis === true, 'runtime trigger should require injected visual analysis', appStart.runtimeEnvelope);
  assert(appStart.requiredAdapters.includes('webSearchProvider'), 'ready trigger should list web search provider requirement', appStart.requiredAdapters);
  assert(appStart.requiredAdapters.includes('visualAnalysisAdapter'), 'ready trigger should list visual analysis requirement', appStart.requiredAdapters);
  assertNoUnsafePayload(appStart, 'ready runtime trigger');

  const runtimeDisabled = buildDesignLearningRuntimeTrigger({
    triggerSource: 'app_start',
    schedule: readySchedule,
    runtimePolicy: buildBasePolicy({ enabled: false }),
    adapterAvailability: buildBaseAdapters()
  });
  assert(runtimeDisabled.status === 'blocked_runtime_disabled', 'disabled runtime policy should block the trigger', runtimeDisabled);
  assert(runtimeDisabled.canStartRuntime === false, 'disabled runtime must not start', runtimeDisabled);
  assert(!runtimeDisabled.runtimeEnvelope, 'disabled runtime must not expose a runnable envelope', runtimeDisabled);

  const missingProvider = buildDesignLearningRuntimeTrigger({
    triggerSource: 'app_start',
    schedule: readySchedule,
    runtimePolicy: buildBasePolicy(),
    adapterAvailability: buildBaseAdapters({ webSearchProvider: false })
  });
  assert(missingProvider.status === 'blocked_missing_runtime_adapters', 'missing provider should block runtime start', missingProvider);
  assert(missingProvider.missingAdapters.includes('webSearchProvider'), 'missing provider should be named', missingProvider);
  assert(!missingProvider.runtimeEnvelope, 'missing provider must not expose runtime envelope', missingProvider);

  const missingAnalysis = buildDesignLearningRuntimeTrigger({
    triggerSource: 'scheduled_timer',
    schedule: readySchedule,
    runtimePolicy: buildBasePolicy(),
    adapterAvailability: buildBaseAdapters({ visualAnalysisAdapter: false })
  });
  assert(missingAnalysis.status === 'blocked_missing_runtime_adapters', 'missing visual analysis should block runtime start', missingAnalysis);
  assert(missingAnalysis.missingAdapters.includes('visualAnalysisAdapter'), 'missing visual analysis adapter should be named', missingAnalysis);

  const missingReviewQueue = buildDesignLearningRuntimeTrigger({
    triggerSource: 'scheduled_timer',
    schedule: readySchedule,
    runtimePolicy: buildBasePolicy({ reviewQueueAvailable: false }),
    adapterAvailability: buildBaseAdapters()
  });
  assert(missingReviewQueue.status === 'blocked_review_gate_unavailable', 'missing review queue should block runtime start', missingReviewQueue);
  assert(missingReviewQueue.blockers.includes('review_queue_required'), 'missing review queue blocker should be explicit', missingReviewQueue);

  const notDueSchedule = buildDesignLearningCadenceSchedule({
    now: '2026-05-29T08:00:00.000Z',
    cadence: 'daily',
    lastRunAt: '2026-05-29T07:30:00.000Z',
    preferredTopics: ['袜子主图版式'],
    sourceAvailability: {
      eagleReadonly: true,
      webSearch: true,
      visualAnalysis: true
    }
  });
  const notDueAppStart = buildDesignLearningRuntimeTrigger({
    triggerSource: 'app_start',
    schedule: notDueSchedule,
    runtimePolicy: buildBasePolicy(),
    adapterAvailability: buildBaseAdapters()
  });
  assert(notDueAppStart.status === 'blocked_schedule_not_ready', 'app-start trigger should not override not-due cadence', notDueAppStart);
  assert(!notDueAppStart.runtimeEnvelope, 'not-due trigger must not expose runtime envelope', notDueAppStart);

  const manualOverride = buildDesignLearningRuntimeTrigger({
    triggerSource: 'manual',
    schedule: notDueSchedule,
    runtimePolicy: buildBasePolicy(),
    adapterAvailability: buildBaseAdapters(),
    scope: { type: 'user' }
  });
  assert(manualOverride.status === 'ready_for_runtime_runner', 'manual trigger should be allowed to override a not-due cadence when sources are ready', manualOverride);
  assert(manualOverride.runtimeEnvelope?.runtimeInput?.plan?.topics.includes('袜子主图版式'), 'manual trigger should reuse schedule topics', manualOverride.runtimeEnvelope);
  assert(manualOverride.warnings.includes('manual_trigger_overrode_cadence'), 'manual override should be explicit', manualOverride);

  const blockedSources = buildDesignLearningCadenceSchedule({
    now: '2026-05-29T08:00:00.000Z',
    cadence: 'daily',
    preferredTopics: ['袜子主图版式'],
    sourceAvailability: {
      visualAnalysis: true
    }
  });
  const noSources = buildDesignLearningRuntimeTrigger({
    triggerSource: 'manual',
    schedule: blockedSources,
    runtimePolicy: buildBasePolicy(),
    adapterAvailability: buildBaseAdapters()
  });
  assert(noSources.status === 'blocked_schedule_not_ready', 'manual trigger must not override missing reference source blockers', noSources);
  assert(noSources.blockers.includes('reference_source_required'), 'reference source blocker should be preserved', noSources);

  const manualDisabled = buildDesignLearningRuntimeTrigger({
    triggerSource: 'manual',
    schedule: notDueSchedule,
    runtimePolicy: buildBasePolicy({ allowManual: false }),
    adapterAvailability: buildBaseAdapters()
  });
  assert(manualDisabled.status === 'blocked_runtime_disabled', 'manual trigger should honor policy allowManual=false', manualDisabled);

  const packageJson = JSON.parse(read('package.json'));
  assert(packageJson.scripts['smoke:design-learning:runtime-trigger'], 'package script should expose design learning runtime trigger smoke');
  assert(packageJson.scripts['maintenance:preflight'].includes('smoke:design-learning:runtime-trigger'), 'maintenance preflight should include design learning runtime trigger smoke');

  const boundaries = read('scripts/report-change-boundaries.cjs');
  assert(boundaries.includes('design-learning-runtime-trigger'), 'change boundary matcher should include design learning runtime trigger');
  assert(boundaries.includes('smoke:design-learning:runtime-trigger'), 'change boundary validation should include runtime trigger smoke');

  const hygiene = read('scripts/validate-maintenance-hygiene.cjs');
  assert(hygiene.includes('smoke-design-learning-runtime-trigger.cjs'), 'maintenance hygiene should check design learning runtime trigger smoke');

  console.log(JSON.stringify({
    success: true,
    checks: [
      'runtime trigger turns a due cadence schedule into a controlled runtime runner envelope',
      'manual trigger can explicitly override cadence timing without overriding missing source blockers',
      'runtime trigger blocks disabled policy, missing providers, missing visual analysis and missing review queue',
      'runtime trigger never calls providers, writes Photoshop, writes Eagle or persists memory by itself',
      'runtime trigger output strips unsafe payloads, local paths and score markers',
      'package, preflight, change-boundary and maintenance hygiene wiring are present'
    ]
  }, null, 2));
}

run();
