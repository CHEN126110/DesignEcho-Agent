'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '..', 'tsconfig.main.json')
});

const root = path.resolve(__dirname, '..');
const runtimeRoot = path.join(root, 'src', 'shared', 'agent-runtime-v5');
const rendererRuntimeRoot = path.join(root, 'src', 'renderer', 'services', 'agent-runtime');
const executorRoot = path.join(root, 'src', 'renderer', 'services', 'skill-executors');

const { listSkillManifests } = require(path.join(runtimeRoot, 'skill-runtime.ts'));
const { validateSkillPackageContracts } = require(path.join(runtimeRoot, 'skill-package-contract.ts'));
const { SKILL_REGISTRY } = require(path.join(root, 'src', 'shared', 'skills', 'skill-declarations.ts'));
const { createAgentCapabilitySession } = require(path.join(rendererRuntimeRoot, 'capability-session.ts'));
const {
  DELEGATE_TOOL,
  TEAM_PIPELINE_TOOL,
  getDefaultAgentTools
} = require(path.join(rendererRuntimeRoot, 'tool-schemas.ts'));
const { buildSkillToolSchemas } = require(path.join(executorRoot, 'skill-tools.ts'));

const manifests = listSkillManifests();
const workflowBridgeTools = buildSkillToolSchemas();
const candidateTools = [
  ...getDefaultAgentTools(),
  DELEGATE_TOOL,
  TEAM_PIPELINE_TOOL,
  ...workflowBridgeTools
];
const workflowBridgeNames = workflowBridgeTools.map((tool) => tool.name);
const resolutions = new Map(manifests.map((manifest) => {
  const session = createAgentCapabilitySession({
    candidateTools,
    workflowBridgeNames,
    requestedTaskType: manifest.task_type,
    manifest
  });
  return [manifest.skill_id, session.getResolution()];
}));

const report = validateSkillPackageContracts({
  manifests,
  declarations: SKILL_REGISTRY,
  resolutions
});

assert.strictEqual(report.version, 'skill-package-contract-report/v0');
assert.strictEqual(report.status, 'valid', JSON.stringify(report.issues, null, 2));
assert.strictEqual(report.packageCount, manifests.length);
assert.strictEqual(report.validPackageCount, manifests.length);
assert.strictEqual(report.invalidPackageCount, 0);
assert(report.results.every((result) => result.requestedCapabilityKinds.length === 6));
assert(report.results.every((result) => result.boundaries.manifestIsSource === true));
assert(report.results.every((result) => result.boundaries.createsRegistry === false));
assert(report.results.every((result) => result.boundaries.claimsLiveE2E === false));

const invalidManifest = {
  ...manifests[0],
  skill_id: 'fixture.invalid',
  task_type: 'fixture.invalid.v1',
  version: 'latest',
  required_inputs: [],
  optional_inputs: [],
  // 同时触发两个负向 code：缺最小必需阶段 R5（runtime_stage_missing）+ R2 排在 R1 前（runtime_stage_order_invalid）。
  runtime_stages: ['R0', 'R2', 'R1', 'E1'],
  legacy_skill_ids: [],
  available_tools: ['unknown.action'],
  forbidden_tools: ['unknown.action'],
  knowledge_refs: [],
  primary_method_tool_ref: 'tool:fixture.missing',
  memory_refs: [],
  evaluation_refs: [],
  policy_refs: [],
  review_rubric_ref: undefined,
  work_mode_contracts: {
    edit_existing: {
      required_inputs: ['existing_document'],
      optional_inputs: [],
      delivery_outputs: ['updated_document'],
      exit_criteria: ['fixture only'],
      review_rubric_ref: 'rubrics/fixture-mode.v1'
    }
  },
  delivery_outputs: [],
  exit_criteria: []
};
const invalidReport = validateSkillPackageContracts({
  manifests: [invalidManifest],
  declarations: SKILL_REGISTRY,
  resolutions: new Map()
});
assert.strictEqual(invalidReport.status, 'invalid');
const invalidCodes = new Set(invalidReport.issues.map((issue) => issue.code));
for (const expected of [
  'invalid_version',
  'required_input_missing',
  'runtime_stage_missing',
  'runtime_stage_order_invalid',
  'tool_allow_deny_overlap',
  'capability_kind_missing',
  'primary_method_tool_unbound',
  'review_rubric_unbound',
  'delivery_contract_missing',
  'exit_criteria_missing',
  'capability_resolution_missing'
]) {
  assert(invalidCodes.has(expected), `missing negative issue: ${expected}`);
}
assert(invalidReport.issues.some((issue) => (
  issue.path === 'work_mode_contracts.edit_existing.review_rubric_ref'
  && issue.code === 'review_rubric_unbound'
)));

const validatorSource = fs.readFileSync(
  path.join(runtimeRoot, 'skill-package-contract.ts'),
  'utf8'
);
assert(!/main.?image|detail.?page|sku/i.test(validatorSource));
assert(!validatorSource.includes('executeTool('));
assert(!validatorSource.includes('new Map(input.manifests.map'));

console.log(JSON.stringify({
  success: true,
  packageCount: report.packageCount,
  validPackages: report.results.map((result) => ({
    skillId: result.skillId,
    taskType: result.taskType,
    declarationIds: result.declarationIds,
    capabilityKinds: result.requestedCapabilityKinds
  })),
  negativeIssueCodes: Array.from(invalidCodes).sort(),
  boundaries: report.boundaries
}, null, 2));
