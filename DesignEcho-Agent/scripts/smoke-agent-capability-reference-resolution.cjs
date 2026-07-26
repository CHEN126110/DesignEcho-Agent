'use strict';

/**
 * 六类 Capability 引用解析回归。
 *
 * 只检查 provider 身份、类型与 schema 边界；不调用模型、不执行 Tool、
 * 不读取 provider 内容，也不把缺失 rubric 补造成成功评价能力。
 */

const assert = require('assert');
const path = require('path');

require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '..', 'tsconfig.main.json')
});

const root = path.resolve(__dirname, '..');
const runtimeRoot = path.join(root, 'src', 'shared', 'agent-runtime-v5');
const rendererRuntimeRoot = path.join(root, 'src', 'renderer', 'services', 'agent-runtime');
const executorRoot = path.join(root, 'src', 'renderer', 'services', 'skill-executors');

const { getManifestByTaskType } = require(path.join(runtimeRoot, 'skill-runtime.ts'));
const { createAgentCapabilitySession } = require(path.join(rendererRuntimeRoot, 'capability-session.ts'));
const {
  DELEGATE_TOOL,
  TEAM_PIPELINE_TOOL,
  getDefaultAgentTools
} = require(path.join(rendererRuntimeRoot, 'tool-schemas.ts'));
const { buildSkillToolSchemas } = require(path.join(executorRoot, 'skill-tools.ts'));

const workflowBridgeTools = buildSkillToolSchemas();
const candidateTools = [
  ...getDefaultAgentTools(),
  DELEGATE_TOOL,
  TEAM_PIPELINE_TOOL,
  ...workflowBridgeTools
];
const workflowBridgeNames = workflowBridgeTools.map((tool) => tool.name);

function createSession(manifest, additionalCapabilityProviders) {
  return createAgentCapabilitySession({
    candidateTools,
    workflowBridgeNames,
    manifest,
    additionalCapabilityProviders
  });
}

function check(name, fn) {
  fn();
  console.log(`  ✓ ${name}`);
}

console.log('smoke: agent-capability-reference-resolution');

const genericManifest = getManifestByTaskType('design.generic.v1');
const genericSession = createSession(genericManifest);

check('generic manifest resolves all six Capability kinds against real providers', () => {
  const resolution = genericSession.getResolution();
  const reference = resolution.referenceResolution;
  assert.strictEqual(resolution.status, 'resolved', JSON.stringify(resolution.issues, null, 2));
  assert.strictEqual(reference.version, 'runtime-capability-reference-resolution/v0');
  assert.strictEqual(reference.status, 'resolved');
  assert.strictEqual(reference.metrics.unavailableCount, 0);
  for (const kind of ['knowledge', 'skill', 'tool', 'memory', 'evaluation', 'policy']) {
    assert.ok(reference.metrics.byKind[kind].requested > 0, `${kind} must be requested`);
    assert.strictEqual(
      reference.metrics.byKind[kind].resolved,
      reference.metrics.byKind[kind].requested,
      `${kind} must be provider-backed`
    );
  }
});

check('non-executable providers never become Tool schemas', () => {
  const resolution = genericSession.getResolution();
  const activeToolNames = genericSession.activeTools.map((tool) => tool.name);
  for (const provider of resolution.referenceResolution.providers) {
    if (['memory', 'evaluation', 'policy'].includes(provider.kind)) {
      assert.strictEqual(provider.exposedAsToolSchema, false, JSON.stringify(provider));
      assert.ok(!activeToolNames.includes(provider.capabilityId), provider.capabilityId);
    }
  }
  const knowledgeProvider = resolution.referenceResolution.providers.find((provider) => (
    provider.kind === 'knowledge'
    && provider.source === 'knowledge_tool_semantics'
  ));
  assert.ok(knowledgeProvider, 'knowledge reference must still resolve to a real provider');
  assert.strictEqual(
    knowledgeProvider.exposedAsToolSchema,
    false,
    'generic startup must not eagerly expose professional knowledge actions'
  );

  const providerToolName = knowledgeProvider.capabilityId.replace(/^tool:/, '');
  const onDemandEntry = genericSession.inventory.find((entry) => (
    entry.providerToolNames.includes(providerToolName)
    && resolution.onDemandCapabilityIds.includes(entry.capabilityId)
  ));
  assert.ok(onDemandEntry, 'resolved knowledge provider must remain reachable on demand');

  const knowledgeSession = createSession(genericManifest);
  const activation = knowledgeSession.requestCapabilities([onDemandEntry.capabilityId]);
  assert.strictEqual(activation.status, 'activated', JSON.stringify(activation.issues));
  assert.ok(activation.resolution.referenceResolution.providers.some((provider) => (
    provider.capabilityId === knowledgeProvider.capabilityId
    && provider.exposedAsToolSchema === true
  )), 'requested knowledge action must become an active Tool schema');
});

check('real business Evaluation Profile providers resolve all manifest references', () => {
  const expected = [
    ['ecommerce.main_image.v1', 'rubrics/main-image.v1'],
    ['ecommerce.detail_page.v1', 'rubrics/detail-page.v1'],
    ['ecommerce.sku_color_card.v1', 'rubrics/sku-color-card.v1'],
    ['ecommerce.sku_batch.v1', 'rubrics/sku-batch.v1']
  ];
  for (const [taskType, missingRubric] of expected) {
    const session = createSession(getManifestByTaskType(taskType));
    const resolution = session.getResolution();
    assert.strictEqual(resolution.status, 'resolved', JSON.stringify(resolution.issues));
    assert.strictEqual(resolution.referenceResolution.status, 'resolved', taskType);
    assert.deepStrictEqual(resolution.referenceResolution.unavailable.evaluationRefs, []);
    assert.ok(resolution.referenceResolution.providers.some((provider) => (
      provider.capabilityId === missingRubric
      && provider.kind === 'evaluation'
      && provider.exposedAsToolSchema === false
    )));
    assert.ok(session.activeTools.length > 1, 'Evaluation provider must not erase existing action schemas');
  }
});

check('an actually missing rubric still downgrades reference truth', () => {
  const missingRubric = 'rubrics/future-missing.v1';
  const manifest = {
    ...genericManifest,
    evaluation_refs: [...genericManifest.evaluation_refs, missingRubric],
    review_rubric_ref: missingRubric
  };
  const resolution = createSession(manifest).getResolution();
  assert.strictEqual(resolution.status, 'partial');
  assert.ok(resolution.referenceResolution.unavailable.evaluationRefs.includes(missingRubric));
  assert.ok(resolution.issues.some((issue) => (
    issue.code === 'capability_reference_unavailable'
    && issue.capabilityId === missingRubric
  )));
});

check('a real Profile referenced by the wrong Skill is rejected as scope mismatch', () => {
  const profileId = 'rubrics/main-image.v1';
  const manifest = {
    ...genericManifest,
    evaluation_refs: [...genericManifest.evaluation_refs, profileId],
    review_rubric_ref: profileId
  };
  const resolution = createSession(manifest).getResolution();
  assert.strictEqual(resolution.status, 'partial');
  assert.ok(resolution.referenceResolution.unavailable.evaluationRefs.includes(profileId));
  assert.ok(resolution.issues.some((issue) => (
    issue.code === 'capability_reference_scope_mismatch'
    && issue.capabilityId === profileId
  )));
});

check('wrong-kind and unknown references remain explicit without string inference', () => {
  const manifest = {
    ...genericManifest,
    memory_refs: [
      ...genericManifest.memory_refs,
      'design-quality-verdict/v0'
    ],
    knowledge_refs: [
      ...genericManifest.knowledge_refs,
      'tool:futureMissingKnowledge'
    ]
  };
  const resolution = createSession(manifest).getResolution();
  assert.ok(resolution.issues.some((issue) => (
    issue.code === 'capability_reference_kind_mismatch'
    && issue.capabilityId === 'design-quality-verdict/v0'
  )));
  assert.ok(resolution.issues.some((issue) => (
    issue.code === 'capability_reference_unavailable'
    && issue.capabilityId === 'tool:futureMissingKnowledge'
  )));
  assert.ok(resolution.referenceResolution.unavailable.memoryRefs.includes('design-quality-verdict/v0'));
  assert.ok(resolution.referenceResolution.unavailable.knowledgeRefs.includes('tool:futureMissingKnowledge'));
});

check('extension providers resolve identity without injecting schemas', () => {
  const customEvaluationId = 'evaluation.custom-layout/v1';
  const manifest = {
    ...genericManifest,
    evaluation_refs: [...genericManifest.evaluation_refs, customEvaluationId]
  };
  const beforeNames = genericSession.activeTools.map((tool) => tool.name);
  const session = createSession(manifest, [{
    capabilityId: customEvaluationId,
    kind: 'evaluation',
    providerId: 'plugin:custom-layout-evaluator',
    source: 'runtime_contract',
    exposure: 'evaluation_gate',
    exposedAsToolSchema: true
  }]);
  const provider = session.getResolution().referenceResolution.providers.find((entry) => (
    entry.capabilityId === customEvaluationId
  ));
  assert.ok(provider);
  assert.strictEqual(provider.source, 'extension_provider');
  assert.strictEqual(provider.exposedAsToolSchema, false);
  assert.deepStrictEqual(session.activeTools.map((tool) => tool.name), beforeNames);
});

check('unsafe extension identity is rejected without leaking a path or secret label', () => {
  const customEvaluationId = 'evaluation.poison/v1';
  const manifest = {
    ...genericManifest,
    evaluation_refs: [...genericManifest.evaluation_refs, customEvaluationId]
  };
  const resolution = createSession(manifest, [{
    capabilityId: customEvaluationId,
    kind: 'evaluation',
    providerId: 'C:\\private\\api-key.txt',
    source: 'runtime_contract',
    exposure: 'evaluation_gate',
    exposedAsToolSchema: false
  }]).getResolution();
  const serialized = JSON.stringify(resolution);
  assert.ok(resolution.issues.some((issue) => (
    issue.code === 'capability_reference_unavailable'
    && issue.capabilityId === customEvaluationId
  )));
  assert.ok(!serialized.includes('C:\\private'));
  assert.ok(!serialized.includes('api-key'));
});

check('on-demand action activation updates Tool references only', () => {
  const before = genericSession.getResolution();
  const capabilityId = before.onDemandCapabilityIds.find((candidateId) => (
    genericSession.inventory.find((entry) => entry.capabilityId === candidateId)?.kind === 'tool'
  ));
  assert.ok(capabilityId, 'expected an on-demand Tool capability');
  const beforeToolCount = before.referenceResolution.metrics.byKind.tool.requested;
  const beforeNonExecutable = {
    memory: before.referenceResolution.metrics.byKind.memory.requested,
    evaluation: before.referenceResolution.metrics.byKind.evaluation.requested,
    policy: before.referenceResolution.metrics.byKind.policy.requested
  };
  const activation = genericSession.requestCapabilities([capabilityId]);
  assert.strictEqual(activation.status, 'activated', JSON.stringify(activation.issues));
  const after = activation.resolution.referenceResolution.metrics.byKind;
  assert.strictEqual(after.tool.requested, beforeToolCount + 1);
  assert.deepStrictEqual({
    memory: after.memory.requested,
    evaluation: after.evaluation.requested,
    policy: after.policy.requested
  }, beforeNonExecutable);
});

console.log(JSON.stringify({
  success: true,
  version: genericSession.getResolution().referenceResolution.version,
  genericMetrics: genericSession.getResolution().referenceResolution.metrics,
  businessEvaluationProfiles: [
    'rubrics/main-image.v1',
    'rubrics/detail-page.v1',
    'rubrics/sku-color-card.v1',
    'rubrics/sku-batch.v1'
  ],
  boundaries: {
    executesTools: false,
    callsProvider: false,
    grantsPermission: false,
    claimsEvaluationPassed: false
  }
}, null, 2));
