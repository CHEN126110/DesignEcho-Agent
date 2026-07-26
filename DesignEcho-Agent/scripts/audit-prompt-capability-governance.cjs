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
const executorPath = path.join(
  root,
  'src',
  'renderer',
  'services',
  'skill-executors',
  'autonomous-agent.executor.ts'
);
const contextCompilerPath = path.join(runtimeRoot, 'runtime-context-compiler.ts');
const { validatePromptCapabilityGovernance } = require(
  path.join(runtimeRoot, 'prompt-capability-governance.ts')
);

function declaration(promptId, input) {
  return {
    promptId,
    version: '1.0.0',
    fixedSequence: false,
    createsIndependentRuntimeState: false,
    grantsToolPermission: false,
    executesTools: false,
    advancesRuntimeStage: false,
    declaresCompletion: false,
    ...input
  };
}

const candidateMappings = [
  declaration('P-01', { owner: 'model', implementation: 'model_prompt', authority: 'declarative', scope: 'capability', activation: 'runtime_conditioned', stages: ['R1'], capabilityKinds: ['skill'] }),
  declaration('P-02', { owner: 'runtime', implementation: 'deterministic_code', authority: 'declarative', scope: 'capability', activation: 'runtime_conditioned', stages: ['R0'], capabilityKinds: ['skill', 'policy'] }),
  declaration('P-03', { owner: 'model', implementation: 'model_prompt', authority: 'declarative', scope: 'capability', activation: 'runtime_conditioned', stages: ['R4'], capabilityKinds: ['skill', 'policy'] }),
  declaration('P-04', { owner: 'model', implementation: 'model_prompt', authority: 'declarative', scope: 'capability', activation: 'on_demand', stages: ['R2'], capabilityKinds: ['knowledge', 'tool'] }),
  declaration('P-05', { owner: 'memory', implementation: 'hybrid', authority: 'advisory', scope: 'capability', activation: 'on_demand', stages: ['R2', 'R3'], capabilityKinds: ['knowledge', 'memory', 'policy'] }),
  declaration('P-06', { owner: 'skill', implementation: 'model_prompt', authority: 'declarative', scope: 'capability', activation: 'runtime_conditioned', stages: ['R3'], capabilityKinds: ['knowledge', 'skill'] }),
  declaration('P-07', { owner: 'skill', implementation: 'model_prompt', authority: 'declarative', scope: 'capability', activation: 'runtime_conditioned', stages: ['R3'], capabilityKinds: ['knowledge', 'skill'] }),
  declaration('P-08', { owner: 'skill', implementation: 'model_prompt', authority: 'declarative', scope: 'capability', activation: 'runtime_conditioned', stages: ['R4'], capabilityKinds: ['skill', 'evaluation'] }),
  declaration('P-09', { owner: 'skill', implementation: 'model_prompt', authority: 'declarative', scope: 'skill', activation: 'on_demand', stages: ['R3', 'R4'], capabilityKinds: ['knowledge', 'skill', 'evaluation'], skillIds: ['ecommerce.main_image'] }),
  declaration('P-10', { owner: 'skill', implementation: 'model_prompt', authority: 'declarative', scope: 'skill', activation: 'on_demand', stages: ['R3', 'R4'], capabilityKinds: ['knowledge', 'skill', 'evaluation'], skillIds: ['ecommerce.detail_page'] }),
  declaration('P-11', { owner: 'skill', implementation: 'model_prompt', authority: 'declarative', scope: 'skill', activation: 'on_demand', stages: ['R3', 'R4'], capabilityKinds: ['knowledge', 'skill', 'evaluation'], skillIds: ['ecommerce.sku_batch'] }),
  declaration('P-12', { owner: 'skill', implementation: 'model_prompt', authority: 'declarative', scope: 'skill', activation: 'on_demand', stages: ['R3', 'R4'], capabilityKinds: ['knowledge', 'skill', 'evaluation'], skillIds: ['candidate.brand_kv'] }),
  declaration('P-13', { owner: 'model', implementation: 'model_prompt', authority: 'declarative', scope: 'capability', activation: 'runtime_conditioned', stages: ['R4'], capabilityKinds: ['skill', 'tool', 'policy'] }),
  declaration('P-14', { owner: 'runtime', implementation: 'deterministic_code', authority: 'execution', scope: 'capability', activation: 'on_demand', stages: ['E1'], capabilityKinds: ['tool', 'policy'], executesTools: true, advancesRuntimeStage: true }),
  declaration('P-15', { owner: 'runtime', implementation: 'hybrid', authority: 'declarative', scope: 'capability', activation: 'on_demand', stages: ['E1'], capabilityKinds: ['tool', 'evaluation'] }),
  declaration('P-16', { owner: 'evaluation', implementation: 'model_prompt', authority: 'declarative', scope: 'capability', activation: 'runtime_conditioned', stages: ['R5'], capabilityKinds: ['evaluation', 'policy'] }),
  declaration('P-17', { owner: 'model', implementation: 'model_prompt', authority: 'advisory', scope: 'capability', activation: 'runtime_conditioned', stages: ['R5', 'R4'], capabilityKinds: ['skill', 'evaluation'] }),
  declaration('P-18', { owner: 'runtime', implementation: 'deterministic_code', authority: 'completion', scope: 'capability', activation: 'runtime_conditioned', stages: ['E2'], capabilityKinds: ['evaluation', 'policy'], advancesRuntimeStage: true, declaresCompletion: true }),
  declaration('P-19', { owner: 'memory', implementation: 'hybrid', authority: 'advisory', scope: 'capability', activation: 'on_demand', stages: ['E2'], capabilityKinds: ['memory', 'policy'] }),
  declaration('P-20', { owner: 'runtime', implementation: 'hybrid', authority: 'advisory', scope: 'capability', activation: 'runtime_conditioned', stages: ['R1', 'R2', 'R3', 'R4', 'E1', 'R5', 'E2'], capabilityKinds: ['memory', 'policy'] })
];

const report = validatePromptCapabilityGovernance({ declarations: candidateMappings });
assert.strictEqual(report.status, 'valid', JSON.stringify(report.issues, null, 2));
assert.strictEqual(report.declarationCount, 20);
assert.strictEqual(report.validCount, 20);
assert.strictEqual(report.invalidCount, 0);
assert.strictEqual(report.boundaries.createsPromptRegistry, false);
assert.strictEqual(report.boundaries.createsWorkflowRuntime, false);
assert.strictEqual(report.boundaries.createsCapabilityResolver, false);
assert.strictEqual(report.boundaries.grantsPermission, false);
assert.strictEqual(report.boundaries.executesTools, false);
assert.strictEqual(report.boundaries.declaresCompletion, false);

const negativeReport = validatePromptCapabilityGovernance({
  declarations: [
    declaration('NEG-FIXED', { owner: 'model', implementation: 'model_prompt', authority: 'declarative', scope: 'capability', activation: 'always', stages: ['R1'], capabilityKinds: ['skill'], fixedSequence: true, createsIndependentRuntimeState: true }),
    declaration('NEG-EXEC', { owner: 'model', implementation: 'model_prompt', authority: 'execution', scope: 'capability', activation: 'on_demand', stages: ['E1'], capabilityKinds: ['tool'], grantsToolPermission: true, executesTools: true, advancesRuntimeStage: true }),
    declaration('NEG-DONE', { owner: 'evaluation', implementation: 'hybrid', authority: 'completion', scope: 'capability', activation: 'runtime_conditioned', stages: ['E2'], capabilityKinds: ['evaluation'], declaresCompletion: true }),
    declaration('NEG-GLOBAL', { owner: 'skill', implementation: 'model_prompt', authority: 'declarative', scope: 'global', activation: 'always', stages: ['R3'], capabilityKinds: ['skill'], skillIds: ['ecommerce.main_image'] }),
    declaration('NEG-SKILL', { owner: 'skill', implementation: 'model_prompt', authority: 'declarative', scope: 'skill', activation: 'always', stages: ['R3'], capabilityKinds: ['skill'] })
  ]
});
const negativeIssueCodes = new Set(negativeReport.issues.map((issue) => issue.code));
for (const code of [
  'fixed_sequence_forbidden',
  'independent_runtime_state_forbidden',
  'model_prompt_execution_authority',
  'model_prompt_grants_permission',
  'model_prompt_executes_tools',
  'model_prompt_advances_stage',
  'execution_requires_deterministic_code',
  'model_prompt_completion_authority',
  'model_prompt_declares_completion',
  'completion_requires_deterministic_code',
  'global_prompt_skill_binding',
  'skill_scope_missing_skill_id',
  'skill_prompt_always_active'
]) {
  assert(negativeIssueCodes.has(code), `negative fixture must expose ${code}`);
}

const executorSource = fs.readFileSync(executorPath, 'utf8');
const systemPromptStart = executorSource.indexOf('function buildBaseSystemPrompt');
const capabilityPromptStart = executorSource.indexOf('function buildBaseCapabilityPolicyPrompt');
assert(systemPromptStart >= 0 && capabilityPromptStart > systemPromptStart);
const systemPromptSource = executorSource.slice(systemPromptStart, capabilityPromptStart);
for (const forbidden of [
  'runDesignTeamPipeline',
  'delegateToAgent',
  'scene-analyst',
  'searchProjectResources',
  'getAcceptanceSnapshot',
  'createTextLayer',
  'detail-page',
  'main-image',
  'SKU'
]) {
  assert(!systemPromptSource.includes(forbidden), `global System Prompt must not embed ${forbidden}`);
}
assert(executorSource.includes("id: 'policy.execution-discipline'"));
assert(executorSource.includes('content: baseCapabilityPolicyPrompt'));
assert(executorSource.includes("slot: 'capability_policy'"));

const contextCompilerSource = fs.readFileSync(contextCompilerPath, 'utf8');
assert(contextCompilerSource.includes('policySeparatedFromData: true'));
assert(contextCompilerSource.includes('externalContentDataOnly: true'));
assert(contextCompilerSource.includes('grantsPermission: false'));
assert(contextCompilerSource.includes('executesTools: false'));

console.log(JSON.stringify({
  success: true,
  mappedPromptCandidates: report.declarationCount,
  validPromptCandidates: report.validCount,
  negativeIssueCodes: Array.from(negativeIssueCodes).sort(),
  productionBoundaries: {
    globalSystemPromptCategoryNeutral: true,
    capabilityPolicySeparated: true,
    contextTrustCompilerRequired: true,
    createsPromptRegistry: false,
    createsWorkflowRuntime: false,
    grantsPermission: false,
    executesTools: false,
    declaresCompletion: false
  }
}, null, 2));
