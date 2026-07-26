#!/usr/bin/env node

const path = require('path');
const assert = require('assert');

require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '..', 'tsconfig.main.json')
});

const {
  buildDesignLearningDailyWorkflowRequest
} = require('../src/shared/design-learning-daily-workflow.ts');

function assertSafePayload(value, label) {
  const text = JSON.stringify(value);
  assert(!/data:image|"rawImage"|"rawImages"|"imageBase64"|"base64"|"buffer"|"bytes"|"pixels"/i.test(text), `${label} must not expose raw image payloads`);
  assert(!/\bconfidence\b|置信/i.test(text), `${label} must not expose ungrounded confidence fields`);
  assert(!/[A-Za-z]:[\\/]/.test(text), `${label} must not expose local filesystem paths`);
}

const ready = buildDesignLearningDailyWorkflowRequest({
  date: '2026-05-29',
  cadence: 'daily',
  topics: ['袜子主图', 'SKU 色卡'],
  sourceAvailability: {
    eagleReadonly: true,
    webSearch: true,
    projectCases: true,
    visualAnalysis: true
  },
  adapterAvailability: {
    eagleReadonly: true,
    webSearch: true,
    projectCases: true,
    analyzeReference: true
  },
  maxReferences: 6
});

assert.strictEqual(ready.version, 'design-learning-daily-workflow/v0');
assert.strictEqual(ready.status, 'ready_for_runtime');
assert.deepStrictEqual(
  ready.requiredAdapters.sort(),
  ['analyzeReference', 'eagleReadonly', 'projectCases', 'webSearch'].sort(),
  'daily workflow should declare all injected adapters required by available sources'
);
assert.strictEqual(ready.blockedAdapters.length, 0);
assert.strictEqual(ready.runtimePolicy.requiresInjectedProviders, true);
assert.strictEqual(ready.runtimePolicy.doesNotRunPhotoshop, true);
assert.strictEqual(ready.runtimePolicy.doesNotWriteEagle, true);
assert.strictEqual(ready.memoryPolicy.prepareCandidatesOnly, true);
assert.strictEqual(ready.memoryPolicy.persistOnlyAfterReview, true);
assert.strictEqual(ready.safety.canRunPhotoshop, false);
assert.strictEqual(ready.safety.canWriteEagle, false);
assert.strictEqual(ready.safety.canPersistMemory, false);
assertSafePayload(ready, 'ready workflow');

const collectOnly = buildDesignLearningDailyWorkflowRequest({
  date: '2026-05-29',
  sourceAvailability: {
    eagleReadonly: true,
    webSearch: false,
    projectCases: false,
    visualAnalysis: false
  },
  adapterAvailability: {
    eagleReadonly: true
  }
});

assert.strictEqual(collectOnly.status, 'ready_collect_references_only');
assert(collectOnly.requiredAdapters.includes('eagleReadonly'));
assert(collectOnly.requiredAdapters.includes('analyzeReference'));
assert(collectOnly.blockedAdapters.some((item) => item.adapter === 'analyzeReference'));
assert(collectOnly.blockers.includes('visual_analysis_adapter_required'));
assertSafePayload(collectOnly, 'collect-only workflow');

const blocked = buildDesignLearningDailyWorkflowRequest({
  date: '2026-05-29',
  sourceAvailability: {
    eagleReadonly: false,
    webSearch: false,
    projectCases: false,
    visualAnalysis: true
  },
  adapterAvailability: {
    analyzeReference: true
  }
});

assert.strictEqual(blocked.status, 'blocked_no_reference_sources');
assert(blocked.blockers.includes('reference_source_required'));
assert.strictEqual(blocked.requiredAdapters.length, 0);
assertSafePayload(blocked, 'blocked workflow');

console.log(JSON.stringify({
  success: true,
  checks: [
    'daily learning workflow declares injected providers without calling them',
    'missing visual analysis limits the run to reference collection only',
    'missing reference sources block daily learning without fake data',
    'workflow cannot write Photoshop, Eagle, or persistent memory directly',
    'workflow payload contains no raw image data, local paths, or confidence fields'
  ]
}, null, 2));
