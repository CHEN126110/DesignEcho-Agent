'use strict';

const assert = require('assert');
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '..', 'tsconfig.main.json')
});

const root = path.resolve(__dirname, '..');
const {
  evaluateAgentNoRedoProviderProbe
} = require(path.join(root, 'src', 'shared', 'agent-no-redo-provider-probe.ts'));

const reuseSpec = {
  id: 'reuse',
  expectedPolicy: 'reuse_completed_step',
  expectedPriorStepId: 'prior-opacity',
  maxDeclarations: 1
};
const redoSpec = {
  id: 'redo',
  expectedPolicy: 'redo_required',
  expectedPriorStepId: 'prior-opacity',
  maxDeclarations: 1
};
const noMapSpec = {
  id: 'no-map',
  expectedPolicy: 'none',
  maxDeclarations: 1
};

function mapping(policy = 'reuse_completed_step', priorStepId = 'prior-opacity', currentStepId = 'current-action') {
  return { currentStepId, priorStepId, policy };
}

function planEvent(mappings = [], overrides = {}) {
  return {
    name: 'declareRuntimeActionPlan',
    success: true,
    planControl: {
      status: 'validated',
      mappings,
      issueCodes: [],
      modelAuthored: true,
      harnessValidatedOnly: true,
      executesTools: false,
      blocksTools: false,
      skipsTools: false,
      schedulerAuthority: false
    },
    ...overrides
  };
}

function evaluate(spec, events) {
  return evaluateAgentNoRedoProviderProbe({ spec, events });
}

function assertVerdict(label, result, status, verdict) {
  assert.strictEqual(result.status, status, `${label}: ${JSON.stringify(result, null, 2)}`);
  assert.strictEqual(result.verdict, verdict, `${label}: ${JSON.stringify(result, null, 2)}`);
}

const exactReuse = evaluate(reuseSpec, [planEvent([mapping()])]);
assertVerdict('exact reuse', exactReuse, 'passed', 'exact_reuse');

const exactRedo = evaluate(redoSpec, [planEvent([mapping('redo_required')])]);
assertVerdict('exact redo', exactRedo, 'passed', 'exact_redo');

const correctNoMapping = evaluate(noMapSpec, [planEvent([])]);
assertVerdict('correct no mapping', correctNoMapping, 'passed', 'correct_no_mapping');

const missing = evaluate(reuseSpec, []);
assertVerdict('missing declaration', missing, 'failed', 'missing_declaration');

const repeated = evaluate(reuseSpec, [planEvent([mapping()]), planEvent([mapping()])]);
assertVerdict('repeated declaration', repeated, 'failed', 'repeated_declaration');

const invalid = evaluate(reuseSpec, [planEvent([], {
  success: false,
  planControl: {
    ...planEvent().planControl,
    status: 'invalid',
    issueCodes: ['resume_mapping_prior_step_pending']
  }
})]);
assertVerdict('invalid declaration', invalid, 'failed', 'invalid_declaration');
assert.deepStrictEqual(invalid.validationIssueCodes, ['resume_mapping_prior_step_pending']);

const boundaryInvalid = evaluate(reuseSpec, [planEvent([mapping()], {
  planControl: { ...planEvent([mapping()]).planControl, skipsTools: true }
})]);
assertVerdict('boundary invalid', boundaryInvalid, 'failed', 'boundary_record_invalid');

const unsafe = evaluate(reuseSpec, [{ name: 'setLayerOpacity', success: false }]);
assertVerdict('unsafe Tool', unsafe, 'failed', 'unsafe_tool_observed');

const omitted = evaluate(reuseSpec, [planEvent([])]);
assertVerdict('mapping omitted', omitted, 'failed', 'mapping_omitted');

const falseEquivalence = evaluate(noMapSpec, [planEvent([mapping()])]);
assertVerdict('false equivalence', falseEquivalence, 'failed', 'false_equivalence');

const wrongPrior = evaluate(reuseSpec, [planEvent([mapping('reuse_completed_step', 'prior-other')])]);
assertVerdict('wrong prior', wrongPrior, 'failed', 'wrong_prior_step');

const wrongPolicy = evaluate(reuseSpec, [planEvent([mapping('redo_required')])]);
assertVerdict('wrong policy', wrongPolicy, 'failed', 'wrong_policy');

const overMapped = evaluate(reuseSpec, [planEvent([
  mapping(),
  mapping('reuse_completed_step', 'prior-layout', 'current-layout')
])]);
assertVerdict('over mapped', overMapped, 'failed', 'over_mapped');

const poisonedInput = planEvent([mapping()], {
  rawArguments: {
    apiKey: 'api-key-must-not-export',
    path: 'C:/secret/project.psd',
    fullPlan: { goal: 'must-not-export' }
  },
  providerText: 'provider-text-must-not-export'
});
const redacted = evaluate(reuseSpec, [poisonedInput]);
assertVerdict('redacted allowlist', redacted, 'passed', 'exact_reuse');
const serialized = JSON.stringify(redacted);
for (const secret of [
  'api-key-must-not-export',
  'C:/secret/project.psd',
  'must-not-export',
  'provider-text-must-not-export'
]) {
  assert(!serialized.includes(secret), `probe result leaked ${secret}`);
}
assert.strictEqual(redacted.boundaries.containsRawArguments, false);
assert.strictEqual(redacted.boundaries.containsFullPlan, false);
assert.strictEqual(redacted.boundaries.containsProviderText, false);
assert.strictEqual(redacted.boundaries.evaluatesFreeText, false);
assert.strictEqual(redacted.boundaries.executesTools, false);

const evaluatorSource = fs.readFileSync(
  path.join(root, 'src', 'shared', 'agent-no-redo-provider-probe.ts'),
  'utf8'
);
assert(!/taskText|详情页|主图|SKU|sku-batch|detail-page-design|main-image-design/i.test(evaluatorSource));
assert(!evaluatorSource.includes('executeTool('));
assert(!evaluatorSource.includes('arguments:'));

const runnerSource = fs.readFileSync(
  path.join(root, 'scripts', 'acceptance-run-agent-real-provider-case.cjs'),
  'utf8'
);
assert(runnerSource.includes("process.argv.includes('--no-redo-probe')"));
assert(runnerSource.includes("DESIGNECHO_CHAT_TEST_FAKE_PHOTOSHOP: '1'"));
assert(runnerSource.includes('tools: [runtime.tool]'));
assert(runnerSource.includes("purpose: 'agent_no_redo_provider_probe'"));
assert(runnerSource.includes('validateRuntimeActionPlanDeclaration'));
assert(runnerSource.includes('evaluateAgentNoRedoProviderProbe'));
assert(runnerSource.includes('Returned Tool calls were converted to allowlisted validation events and never executed.'));
assert(runnerSource.includes('DESIGNECHO_REAL_PROVIDER_AGENT_ACCEPTANCE_ALLOW_API'));
assert(!runnerSource.includes('executeToolCall('));

const runtimeSelfTest = spawnSync(
  process.execPath,
  [
    path.join(root, 'scripts', 'acceptance-run-agent-real-provider-case.cjs'),
    '--no-redo-probe',
    '--no-redo-probe-self-test'
  ],
  {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      DESIGNECHO_REAL_PROVIDER_AGENT_ACCEPTANCE: '0',
      DESIGNECHO_REAL_PROVIDER_AGENT_ACCEPTANCE_ALLOW_API: '0'
    }
  }
);
assert.strictEqual(runtimeSelfTest.status, 0, runtimeSelfTest.stderr || runtimeSelfTest.stdout);
assert(runtimeSelfTest.stdout.includes('offline-no-redo-provider-runtime-self-test'));
assert(runtimeSelfTest.stdout.includes('"providerCalled": false'));
assert(runtimeSelfTest.stdout.includes('"toolExecuted": false'));
assert(runtimeSelfTest.stdout.includes('"verdict": "exact_reuse"'));
assert(runtimeSelfTest.stdout.includes('"verdict": "exact_redo"'));
assert(runtimeSelfTest.stdout.includes('"verdict": "correct_no_mapping"'));

console.log(JSON.stringify({
  success: true,
  passed: {
    exactReuse: exactReuse.verdict,
    exactRedo: exactRedo.verdict,
    correctNoMapping: correctNoMapping.verdict
  },
  failed: {
    missing: missing.verdict,
    repeated: repeated.verdict,
    invalid: invalid.verdict,
    boundaryInvalid: boundaryInvalid.verdict,
    unsafe: unsafe.verdict,
    omitted: omitted.verdict,
    falseEquivalence: falseEquivalence.verdict,
    wrongPrior: wrongPrior.verdict,
    wrongPolicy: wrongPolicy.verdict,
    overMapped: overMapped.verdict
  },
  recordBoundary: 'allowlisted mapping ids, policies, validation issue codes and counts only',
  providerBoundary: 'existing double API opt-in + isolated Electron + fake Photoshop + no Tool execution'
}, null, 2));
