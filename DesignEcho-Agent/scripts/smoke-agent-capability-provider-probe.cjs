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
  buildAgentRunDebugBundleFromMessage
} = require(path.join(root, 'src', 'shared', 'agent-acceptance-contracts.ts'));
const {
  evaluateAgentCapabilityProviderProbe
} = require(path.join(root, 'src', 'shared', 'agent-capability-provider-probe.ts'));

const baseSpec = {
  id: 'project-asset-read',
  expectedCapabilityIds: ['project.read.analyzeAssetContent'],
  acceptableAlternativeSets: [['skill.project-image-analysis']],
  forbiddenCapabilityPrefixes: ['photoshop.write.', 'delivery.export.'],
  maxControlRequests: 1
};

function capabilityRecord(overrides = {}) {
  return {
    status: 'activated',
    requestedCapabilityIds: ['project.read.analyzeAssetContent'],
    activatedCapabilityIds: ['project.read.analyzeAssetContent'],
    changesModelVisibleSchemasOnly: true,
    executesPhotoshop: false,
    grantsPermission: false,
    countsAsObservation: false,
    countsAsTaskProgress: false,
    ...overrides
  };
}

function controlEvent(overrides = {}) {
  return {
    name: 'requestAgentCapabilities',
    success: true,
    capabilityControl: capabilityRecord(),
    ...overrides
  };
}

function evaluate(toolEvents, spec = baseSpec) {
  return evaluateAgentCapabilityProviderProbe({ spec, toolEvents });
}

function assertVerdict(name, actual, status, verdict) {
  assert.strictEqual(actual.status, status, `${name}: ${JSON.stringify(actual, null, 2)}`);
  assert.strictEqual(actual.verdict, verdict, `${name}: ${JSON.stringify(actual, null, 2)}`);
}

const exact = evaluate([controlEvent()]);
assertVerdict('exact minimal', exact, 'passed', 'exact_minimal');

const alternative = evaluate([controlEvent({
  capabilityControl: capabilityRecord({
    requestedCapabilityIds: ['skill.project-image-analysis'],
    activatedCapabilityIds: ['skill.project-image-analysis']
  })
})]);
assertVerdict('acceptable alternative', alternative, 'passed', 'acceptable_alternative');

const overRequested = evaluate([controlEvent({
  capabilityControl: capabilityRecord({
    requestedCapabilityIds: [
      'project.read.analyzeAssetContent',
      'project.read.recommendAssets'
    ],
    activatedCapabilityIds: [
      'project.read.analyzeAssetContent',
      'project.read.recommendAssets'
    ]
  })
})]);
assertVerdict('over requested', overRequested, 'failed', 'over_requested');

const wrong = evaluate([controlEvent({
  capabilityControl: capabilityRecord({
    requestedCapabilityIds: ['observation.read.describeImage'],
    activatedCapabilityIds: ['observation.read.describeImage']
  })
})]);
assertVerdict('wrong capability', wrong, 'failed', 'wrong_capability');

const repeated = evaluate([controlEvent(), controlEvent()]);
assertVerdict('repeated control request', repeated, 'failed', 'repeated_control_request');

const activationFailed = evaluate([controlEvent({
  success: false,
  capabilityControl: capabilityRecord({ status: 'rejected', activatedCapabilityIds: [] })
})]);
assertVerdict('activation failed', activationFailed, 'failed', 'activation_failed');

const partialActivation = evaluate([controlEvent({
  capabilityControl: capabilityRecord({ activatedCapabilityIds: [] })
})]);
assertVerdict('partial activation', partialActivation, 'failed', 'activation_failed');

const invalidBoundary = evaluate([controlEvent({
  capabilityControl: capabilityRecord({ grantsPermission: true })
})]);
assertVerdict('invalid control boundary', invalidBoundary, 'failed', 'boundary_invalid');

const forbidden = evaluate([controlEvent({
  capabilityControl: capabilityRecord({
    requestedCapabilityIds: ['photoshop.write.deleteLayer'],
    activatedCapabilityIds: ['photoshop.write.deleteLayer']
  })
})]);
assertVerdict('forbidden request', forbidden, 'failed', 'forbidden_capability_requested');

const unsafeTool = evaluate([
  controlEvent(),
  { name: 'analyzeAssetContent', success: true }
]);
assertVerdict('unsafe Tool observed', unsafeTool, 'failed', 'unsafe_tool_observed');

const missing = evaluate([]);
assertVerdict('missing control request', missing, 'failed', 'missing_control_request');

const bundle = buildAgentRunDebugBundleFromMessage({
  acceptanceCase: {
    id: 'capability-record-redaction',
    title: 'Capability record redaction',
    userInput: 'probe',
    mode: 'offline',
    tags: ['capability-probe'],
    expectation: { shouldUseTools: true, shouldChangeDocument: false }
  },
  message: {
    thinkingSteps: [
      {
        toolName: 'requestAgentCapabilities',
        toolResult: {
          success: true,
          data: {
            ...capabilityRecord(),
            reason: 'sensitive-reason-must-not-export',
            filePath: 'C:/secret/project.png',
            apiKey: 'api-key-must-not-export'
          }
        }
      },
      {
        toolName: 'getDocumentInfo',
        toolResult: {
          success: true,
          data: {
            filePath: 'C:/secret/document.psd',
            apiKey: 'another-api-key'
          }
        }
      }
    ]
  },
  generatedAt: '2026-07-10T00:00:00.000Z'
});

assert.deepStrictEqual(bundle.tools[0].capabilityControl, capabilityRecord());
assert.strictEqual(bundle.tools[1].capabilityControl, undefined);
const serializedBundle = JSON.stringify(bundle);
for (const secret of [
  'sensitive-reason-must-not-export',
  'C:/secret/project.png',
  'api-key-must-not-export',
  'C:/secret/document.psd',
  'another-api-key'
]) {
  assert(!serializedBundle.includes(secret), `acceptance bundle leaked ${secret}`);
}

const runnerSource = fs.readFileSync(
  path.join(root, 'scripts', 'acceptance-run-agent-real-provider-case.cjs'),
  'utf8'
);
assert(runnerSource.includes("process.argv.includes('--capability-probe')"));
assert(runnerSource.includes("DESIGNECHO_CHAT_TEST_FAKE_PHOTOSHOP: '1'"));
assert(runnerSource.includes('evaluateAgentCapabilityProviderProbe'));
assert(runnerSource.includes('tools: capabilitySession.activeTools'));
assert(runnerSource.includes('capabilitySession.requestCapabilities(requestedCapabilityIds)'));
assert(runnerSource.includes('Any Tool other than requestAgentCapabilities fails the probe.'));
assert(runnerSource.includes('DESIGNECHO_REAL_PROVIDER_AGENT_ACCEPTANCE_ALLOW_API'));

console.log(JSON.stringify({
  success: true,
  verdicts: {
    exact: exact.verdict,
    alternative: alternative.verdict,
    overRequested: overRequested.verdict,
    wrong: wrong.verdict,
    repeated: repeated.verdict,
    activationFailed: activationFailed.verdict,
    partialActivation: partialActivation.verdict,
    invalidBoundary: invalidBoundary.verdict,
    forbidden: forbidden.verdict,
    unsafeTool: unsafeTool.verdict,
    missing: missing.verdict
  },
  recordBoundary: 'allowlisted Capability control fields only',
  providerBoundary: 'guarded by existing double API opt-in; fake Photoshop required'
}, null, 2));
