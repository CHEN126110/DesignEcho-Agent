'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '..', 'tsconfig.main.json')
});

const root = path.resolve(__dirname, '..');
const { createRuntimeSessionIdentityForPlan } = require('./runtime-session-smoke-fixture.cjs');
const {
  CURRENT_R3_STRATEGY_REF,
  DECLARE_RUNTIME_ACTION_PLAN_TOOL_NAME
} = require(path.join(root, 'src', 'shared', 'agent-runtime-v5', 'runtime-action-plan-declaration.ts'));
const {
  appendRuntimeActionPlanExecutionObservation,
  createRuntimeActionPlanExecutionJournal
} = require(path.join(root, 'src', 'shared', 'agent-runtime-v5', 'runtime-action-plan-observation.ts'));
const {
  resolveRuntimeExecutionTarget
} = require(path.join(root, 'src', 'shared', 'agent-runtime-v5', 'runtime-execution-target.ts'));
const {
  buildRuntimeActionPlanDeclarationFingerprint,
  buildRuntimeActionPlanReconciliationDigest,
  reconcileRuntimeActionPlanExecution
} = require(path.join(root, 'src', 'shared', 'agent-runtime-v5', 'runtime-action-plan-reconciliation.ts'));
const {
  DECLARE_DESIGN_BRIEF_TOOL_NAME
} = require(path.join(root, 'src', 'shared', 'agent-runtime-v5', 'runtime-design-brief-declaration.ts'));
const {
  DECLARE_DESIGN_STRATEGY_TOOL_NAME,
  validateRuntimeDesignStrategyDeclaration
} = require(path.join(root, 'src', 'shared', 'agent-runtime-v5', 'runtime-design-strategy-declaration.ts'));
const { buildRuntimeStagePlan } = require(path.join(root, 'src', 'shared', 'agent-runtime-v5', 'runtime-stage-plan.ts'));
const { GENERAL_DESIGN_MANIFEST } = require(path.join(root, 'src', 'shared', 'agent-runtime-v5', 'manifests', 'general-design.manifest.ts'));
const {
  createAgentCapabilitySession,
  REQUEST_AGENT_CAPABILITIES_TOOL_NAME
} = require(path.join(root, 'src', 'renderer', 'services', 'agent-runtime', 'capability-session.ts'));
const { Agent } = require(path.join(root, 'src', 'renderer', 'services', 'agent-runtime', 'agent.ts'));
const {
  buildAgentIntentControlPlaneDecision
} = require(path.join(root, 'src', 'shared', 'agent-intent-control-plane.ts'));

function buildPlan(overrides = {}) {
  return {
    version: 'runtime-action-plan-declaration/v0',
    source: 'model_tool_call',
    readiness: 'ready',
    payload: {
      planGoal: '先形成语义版面，再实施最小调整并读回复核。',
      strategyRef: CURRENT_R3_STRATEGY_REF,
      contextRefs: ['context:user_goal', 'context:design_strategy'],
      steps: [
        {
          stepId: 'compose-layout',
          kind: 'compose_dsl',
          goal: '形成语义版面。',
          dependsOn: [],
          capabilityRefs: ['design.general'],
          inputContextRefs: ['context:design_strategy'],
          expectedOutcomes: ['design_dsl'],
          completionCriteria: ['语义关系完整。'],
          failurePolicy: 'replan'
        },
        {
          stepId: 'apply-change',
          kind: 'mutate',
          goal: '实施最小调整。',
          dependsOn: ['compose-layout'],
          capabilityRefs: ['photoshop.write.setLayerOpacity'],
          inputContextRefs: ['context:design_strategy'],
          expectedOutcomes: ['document_change'],
          completionCriteria: ['产生预期文档变化。'],
          failurePolicy: 'retry_after_observation'
        },
        {
          stepId: 'verify-change',
          kind: 'verify',
          goal: '读回调整后的状态。',
          dependsOn: ['apply-change'],
          capabilityRefs: ['photoshop.read.inspectLayers'],
          inputContextRefs: ['context:design_strategy'],
          expectedOutcomes: ['readback'],
          completionCriteria: ['完成新鲜读回。'],
          failurePolicy: 'enter_reflexion'
        }
      ],
      designDsl: {
        compositionIntent: '主体承担主要视觉重量。',
        regions: [{
          regionId: 'primary-visual',
          role: 'primary_visual',
          bounds: { x: 0, y: 0, width: 1, height: 1 },
          zIndex: 0,
          alignment: { horizontal: 'center', vertical: 'center' },
          overflow: 'clip'
        }],
        elements: [],
        readingOrder: ['primary-visual'],
        constraints: ['保持核心信息可见。']
      },
      missingInputs: []
    },
    missingCapabilityRefs: [],
    graph: {
      acyclic: true,
      rootStepIds: ['compose-layout'],
      terminalStepIds: ['verify-change'],
      parallelGroups: []
    },
    boundaries: {
      modelAuthored: true,
      harnessValidatedOnly: true,
      strategyAligned: true,
      categoryNeutral: true,
      semanticDslOnly: true,
      shadowOnly: true,
      executable: false,
      schedulerAuthority: false,
      autoActivatesCapabilities: false,
      executesTools: false,
      grantsPermission: false,
      countsAsTaskProgress: false,
      countsAsQualityPass: false
    },
    ...overrides
  };
}

const TEST_TARGET_A = resolveRuntimeExecutionTarget({ result: { documentId: 101 } });
const TEST_TARGET_B = resolveRuntimeExecutionTarget({ result: { documentId: 202 } });

function append(journal, capabilityRefs, toolKind, outcome = 'succeeded', iteration = 1, target = TEST_TARGET_A) {
  const readbackOfMutationSequence = toolKind === 'read_only_observation' && target
    ? [...journal.observations].reverse().find((entry) => (
      entry.operationKind === 'photoshop_write'
      && entry.outcome === 'succeeded'
      && entry.target?.documentRef === target.documentRef
    ))?.sequence
    : undefined;
  return appendRuntimeActionPlanExecutionObservation({
    journal,
    observation: {
      capabilityRefs,
      toolKind,
      outcome,
      iteration,
      ...(target ? { target } : {}),
      ...(readbackOfMutationSequence ? { readbackOfMutationSequence } : {})
    }
  });
}

function step(result, stepId) {
  return result.steps.find((entry) => entry.stepId === stepId);
}

function containsForbiddenExecutionKey(value) {
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some(containsForbiddenExecutionKey);
  const forbidden = new Set(['toolName', 'arguments', 'result', 'toolResult', 'layerId']);
  return Object.entries(value).some(([key, nested]) => (
    forbidden.has(key) || containsForbiddenExecutionKey(nested)
  ));
}

let journal = createRuntimeActionPlanExecutionJournal();
journal = append(journal, ['photoshop.write.setLayerOpacity'], 'photoshop_write');
journal = append(journal, ['photoshop.read.inspectLayers'], 'read_only_observation');
const complete = reconcileRuntimeActionPlanExecution({ declaration: buildPlan(), journal });
assert.strictEqual(complete.status, 'completed');
assert.deepStrictEqual(complete.attributions.map((entry) => entry.stepId), ['apply-change', 'verify-change']);
assert(complete.steps.every((entry) => entry.status === 'completed'));
assert.strictEqual(complete.verificationBindings.length, 1);
assert.deepStrictEqual(complete.verificationBindings[0], {
  mutationObservationSequence: 1,
  mutationStepId: 'apply-change',
  readbackObservationSequence: 2,
  readbackStepId: 'verify-change',
  targetRef: TEST_TARGET_A.documentRef
});
assert.strictEqual(complete.metrics.mutationReadbackBindingCount, 1);
assert.strictEqual(step(complete, 'compose-layout').declarationOutcomeUsed, true);
assert.strictEqual(complete.boundaries.schedulerAuthority, false);
assert.strictEqual(complete.boundaries.evaluatesCompletionCriteriaText, false);
assert.strictEqual(complete.boundaries.countsAsQualityPass, false);

const qualityOutcomePlan = buildPlan();
qualityOutcomePlan.payload.steps[2] = {
  ...qualityOutcomePlan.payload.steps[2],
  expectedOutcomes: ['readback', 'quality_report']
};
const qualityOutcomeMissing = reconcileRuntimeActionPlanExecution({
  declaration: qualityOutcomePlan,
  journal
});
assert.strictEqual(qualityOutcomeMissing.status, 'in_progress');
assert.strictEqual(step(qualityOutcomeMissing, 'verify-change').status, 'in_progress');
assert.deepStrictEqual(step(qualityOutcomeMissing, 'verify-change').missingExpectedOutcomes, ['quality_report']);

let recoveryJournal = createRuntimeActionPlanExecutionJournal();
recoveryJournal = append(recoveryJournal, ['photoshop.write.setLayerOpacity'], 'photoshop_write', 'failed');
recoveryJournal = append(recoveryJournal, ['photoshop.write.setLayerOpacity'], 'photoshop_write');
recoveryJournal = append(recoveryJournal, ['photoshop.read.inspectLayers'], 'read_only_observation');
const recovered = reconcileRuntimeActionPlanExecution({ declaration: buildPlan(), journal: recoveryJournal });
assert.strictEqual(recovered.status, 'completed');
assert.strictEqual(step(recovered, 'apply-change').attempts, 2);
assert.strictEqual(step(recovered, 'apply-change').failedAttempts, 1);
assert.strictEqual(step(recovered, 'apply-change').recovered, true);
assert.strictEqual(recovered.metrics.recoveredStepCount, 1);

let outOfOrderJournal = createRuntimeActionPlanExecutionJournal();
outOfOrderJournal = append(outOfOrderJournal, ['photoshop.read.inspectLayers'], 'read_only_observation');
outOfOrderJournal = append(outOfOrderJournal, ['photoshop.write.setLayerOpacity'], 'photoshop_write');
outOfOrderJournal = append(outOfOrderJournal, ['photoshop.read.inspectLayers'], 'read_only_observation');
const outOfOrder = reconcileRuntimeActionPlanExecution({ declaration: buildPlan(), journal: outOfOrderJournal });
assert.strictEqual(outOfOrder.status, 'needs_review');
assert.strictEqual(outOfOrder.attributions[0].outcome, 'dependency_blocked');
assert.strictEqual(outOfOrder.metrics.dependencyBlockedObservationCount, 1);
assert(outOfOrder.steps.every((entry) => entry.status === 'completed'));

const ambiguousPlan = buildPlan();
ambiguousPlan.payload.steps = [
  { ...ambiguousPlan.payload.steps[1], stepId: 'change-a', dependsOn: [] },
  { ...ambiguousPlan.payload.steps[1], stepId: 'change-b', dependsOn: [] }
];
let ambiguousJournal = createRuntimeActionPlanExecutionJournal();
ambiguousJournal = append(ambiguousJournal, ['photoshop.write.setLayerOpacity'], 'photoshop_write');
const ambiguous = reconcileRuntimeActionPlanExecution({ declaration: ambiguousPlan, journal: ambiguousJournal });
assert.strictEqual(ambiguous.status, 'needs_review');
assert.strictEqual(ambiguous.attributions[0].outcome, 'ambiguous');
assert.deepStrictEqual(ambiguous.attributions[0].candidateStepIds, ['change-a', 'change-b']);
assert(ambiguous.steps.every((entry) => entry.attempts === 0));

let driftJournal = createRuntimeActionPlanExecutionJournal();
driftJournal = append(driftJournal, ['photoshop.write.unknownCapability'], 'photoshop_write');
const drift = reconcileRuntimeActionPlanExecution({ declaration: buildPlan(), journal: driftJournal });
assert.strictEqual(drift.attributions[0].outcome, 'unmatched');
assert.strictEqual(drift.metrics.unmatchedObservationCount, 1);

let crossTargetJournal = createRuntimeActionPlanExecutionJournal();
crossTargetJournal = append(
  crossTargetJournal,
  ['photoshop.write.setLayerOpacity'],
  'photoshop_write',
  'succeeded',
  1,
  TEST_TARGET_A
);
crossTargetJournal = append(
  crossTargetJournal,
  ['photoshop.read.inspectLayers'],
  'read_only_observation',
  'succeeded',
  2,
  TEST_TARGET_B
);
const crossTarget = reconcileRuntimeActionPlanExecution({ declaration: buildPlan(), journal: crossTargetJournal });
assert.strictEqual(crossTarget.verificationBindings.length, 0);
assert.strictEqual(step(crossTarget, 'verify-change').status, 'in_progress');
assert.deepStrictEqual(step(crossTarget, 'verify-change').missingExpectedOutcomes, ['readback']);

let missingTargetJournal = createRuntimeActionPlanExecutionJournal();
missingTargetJournal = append(
  missingTargetJournal,
  ['photoshop.write.setLayerOpacity'],
  'photoshop_write',
  'succeeded',
  1,
  null
);
const missingTarget = reconcileRuntimeActionPlanExecution({ declaration: buildPlan(), journal: missingTargetJournal });
assert.strictEqual(missingTarget.metrics.unboundStateChangeCount, 1);
assert.strictEqual(step(missingTarget, 'apply-change').status, 'in_progress');
assert.deepStrictEqual(step(missingTarget, 'apply-change').missingExpectedOutcomes, ['document_change']);

let repeatJournal = createRuntimeActionPlanExecutionJournal();
repeatJournal = append(repeatJournal, ['photoshop.write.setLayerOpacity'], 'photoshop_write');
repeatJournal = append(repeatJournal, ['photoshop.write.setLayerOpacity'], 'photoshop_write');
const repeated = reconcileRuntimeActionPlanExecution({ declaration: buildPlan(), journal: repeatJournal });
assert.strictEqual(repeated.attributions[1].outcome, 'repeat_after_completion');
assert.strictEqual(repeated.metrics.repeatAfterCompletionCount, 1);

const notReady = buildPlan({ readiness: 'needs_capability', missingCapabilityRefs: ['photoshop.write.setLayerOpacity'] });
const notReadyResult = reconcileRuntimeActionPlanExecution({ declaration: notReady, journal: recoveryJournal });
assert.strictEqual(notReadyResult.status, 'plan_not_ready');
assert.strictEqual(notReadyResult.attributions.length, 0);

let capped = createRuntimeActionPlanExecutionJournal();
for (let index = 0; index < 125; index += 1) {
  capped = append(capped, ['photoshop.write.setLayerOpacity'], 'photoshop_write', 'succeeded', index + 1);
}
assert.strictEqual(capped.observations.length, 120);
assert.strictEqual(capped.droppedObservationCount, 5);
assert.strictEqual(capped.boundaries.containsToolNames, false);
assert.strictEqual(containsForbiddenExecutionKey(capped), false);

const digest = buildRuntimeActionPlanReconciliationDigest(recovered);
assert.strictEqual(digest.version, 'runtime-action-plan-reconciliation-digest/v0');
assert.strictEqual(recovered.declarationFingerprint, buildRuntimeActionPlanDeclarationFingerprint(buildPlan()));
assert.strictEqual(digest.declarationFingerprint, recovered.declarationFingerprint);
assert.deepStrictEqual(digest.recoveredStepIds, ['apply-change']);
assert.strictEqual(digest.boundaries.resumeAdvisoryOnly, true);
assert(!Object.prototype.hasOwnProperty.call(digest, 'steps'));
assert(!Object.prototype.hasOwnProperty.call(digest, 'attributions'));

const candidateTools = [
  { name: 'getDocumentInfo', description: 'Read document.', inputSchema: { type: 'object', properties: {} } },
  { name: 'getLayerHierarchy', description: 'Read layers.', inputSchema: { type: 'object', properties: {} } },
  { name: 'setLayerOpacity', description: 'Change opacity.', inputSchema: { type: 'object', properties: { opacity: { type: 'number' } }, required: ['opacity'] } }
];
const mappingSession = createAgentCapabilitySession({
  candidateTools,
  requestedTaskType: GENERAL_DESIGN_MANIFEST.task_type,
  manifest: GENERAL_DESIGN_MANIFEST
});
assert.deepStrictEqual(mappingSession.getActiveCapabilityIdsForTool('setLayerOpacity'), []);
mappingSession.requestCapabilities(['photoshop.write.setLayerOpacity']);
assert.deepStrictEqual(
  mappingSession.getActiveCapabilityIdsForTool('setLayerOpacity'),
  ['photoshop.write.setLayerOpacity']
);
assert(!mappingSession.getActiveCapabilityIdsForTool('getLayerHierarchy').includes('photoshop.read.inspectLayers'));
mappingSession.requestCapabilities(['photoshop.read.inspectLayers']);
assert(mappingSession.getActiveCapabilityIdsForTool('getLayerHierarchy').includes('photoshop.read.inspectLayers'));
assert.deepStrictEqual(mappingSession.getActiveCapabilityIdsForTool('notRegistered'), []);

function strategyArguments() {
  return {
    stageGoal: '基于当前文档形成克制且可复核的调整策略。',
    objective: {
      primaryGoal: '建立清晰层级。',
      secondaryGoals: ['保持真实素材质感'],
      targetAudienceSummary: '需要快速理解核心信息的用户。',
    },
    messageArchitecture: {
      primaryMessage: '核心价值先被看到。',
      supportingMessages: [],
      supportingFacts: ['当前结构已读取。'],
      objectionsToResolve: ['层级是否清晰']
    },
    copyDirection: {
      toneKeywords: ['清晰'],
      headlineOptions: ['聚焦核心'],
      subtitleOptions: [],
      tagOptions: [],
      prohibitedClaims: ['无依据承诺']
    },
    visualDirection: {
      moodKeywords: ['克制'],
      paletteIntent: ['强调色只服务焦点。'],
      typographyIntent: ['标题与说明形成层级。'],
      compositionIntent: ['主体承担主要重量。'],
      imageTreatment: ['保留真实纹理。'],
      density: 'medium'
    },
    constraints: ['不改变素材事实。'],
    contextRefs: ['context:user_goal', 'context:readback'],
    assumptions: [],
    missingInputs: []
  };
}

function planArguments() {
  return buildPlan().payload;
}

function briefArguments() {
  return {
    taskGoal: '基于当前文档形成计划并完成可复核调整。',
    deliverables: ['可编辑文档状态'],
    outputRequirements: ['写入后必须读回复核'],
    constraints: ['不改变未指定内容'],
    inputCoverage: [{
      inputKey: 'goal',
      status: 'provided',
      contextRefs: ['input:goal:user_goal']
    }],
    contextRefs: ['context:user_goal', 'context:skill_manifest', 'input:goal:user_goal']
  };
}

function documentInfoFixture() {
  return {
    success: true,
    observedAt: '2026-07-16T00:00:00.000Z',
    documentState: 'present',
    document: { id: 1, name: 'runtime-action-plan.psd', activeLayerId: 7, activeLayerName: '目标图层' }
  };
}

const strategyFixtureValidation = validateRuntimeDesignStrategyDeclaration({
  value: strategyArguments(),
  allowedContextRefs: ['context:user_goal', 'context:readback']
});
assert.strictEqual(strategyFixtureValidation.ok, true, JSON.stringify(strategyFixtureValidation.issues));

async function runAgentIntegration() {
  const task = '请先形成动态计划，再把当前目标图层不透明度调整为 80%，失败时修正后读回复核';
  const capabilitySession = createAgentCapabilitySession({
    candidateTools,
    requestedTaskType: GENERAL_DESIGN_MANIFEST.task_type,
    manifest: GENERAL_DESIGN_MANIFEST
  });
  const externalCalls = [];
  const presentations = [];
  let opacityAttempts = 0;
  let modelCallCount = 0;
  const agent = new Agent(
    {
      systemPrompt: 'Action-plan reconciliation integration smoke.',
      tools: capabilitySession.activeTools,
      modelId: 'test-model',
      maxIterations: 12,
      agentTaskPlan: {
        allowedToolScope: 'write_photoshop',
        designBrief: { goal: task },
        executionPlan: {
          mode: 'tool_execution',
          canExecuteTools: true
        }
      },
      taskPlanPresentationScope: {
        conversationId: 'conversation:reconciliation-smoke',
        projectId: 'project:reconciliation-smoke'
      },
      runtimeStagePlan: buildRuntimeStagePlan(GENERAL_DESIGN_MANIFEST),
      runtimeSessionIdentity: createRuntimeSessionIdentityForPlan(
        buildRuntimeStagePlan(GENERAL_DESIGN_MANIFEST),
        'reconciliation'
      ),
      getCapabilityResolution: () => capabilitySession.getResolution(),
      getActiveCapabilityIdsForTool: (toolName) => capabilitySession.getActiveCapabilityIdsForTool(toolName),
      getOnDemandActivatedCapabilityIds: () => capabilitySession.getOnDemandActivatedCapabilityIds(),
      toolDecisionContext: {
        intentControlPlane: buildAgentIntentControlPlaneDecision({ userInput: task }),
        photoshopConnected: true,
        hasDocument: true
      },
      callbacks: {
        onTaskPlanPresentation: (presentation) => {
          presentations.push(presentation);
          if (presentations.length === 1) {
            throw new Error('fixture presentation callback failure');
          }
        }
      }
    },
    async (_modelId, _messages, tools) => {
      modelCallCount += 1;
      if (modelCallCount === 1) {
        return { content: '先读取文档。', toolCalls: [{ id: 'read-doc', name: 'getDocumentInfo', arguments: {} }] };
      }
      if (modelCallCount === 2) {
        return {
          content: '记录当前 Design Brief。',
          toolCalls: [{ id: 'brief', name: DECLARE_DESIGN_BRIEF_TOOL_NAME, arguments: briefArguments() }]
        };
      }
      if (modelCallCount === 3) {
        return {
          content: '记录策略。',
          toolCalls: [{ id: 'strategy', name: DECLARE_DESIGN_STRATEGY_TOOL_NAME, arguments: strategyArguments() }]
        };
      }
      if (modelCallCount === 4) {
        assert(tools.some((tool) => tool.name === DECLARE_RUNTIME_ACTION_PLAN_TOOL_NAME));
        return {
          content: '声明计划并报告能力缺口。',
          toolCalls: [{ id: 'plan-needs-capability', name: DECLARE_RUNTIME_ACTION_PLAN_TOOL_NAME, arguments: planArguments() }]
        };
      }
      if (modelCallCount === 5) {
        return {
          content: '显式装载最小能力。',
          toolCalls: [{
            id: 'activate-opacity',
            name: REQUEST_AGENT_CAPABILITIES_TOOL_NAME,
            arguments: {
              capabilityIds: [
                'photoshop.write.setLayerOpacity',
                'photoshop.read.inspectLayers'
              ]
            }
          }]
        };
      }
      if (modelCallCount === 6) {
        return {
          content: '能力就绪后重新声明计划。',
          toolCalls: [{ id: 'plan-ready', name: DECLARE_RUNTIME_ACTION_PLAN_TOOL_NAME, arguments: planArguments() }]
        };
      }
      if (modelCallCount === 7 || modelCallCount === 8) {
        return {
          content: modelCallCount === 7 ? '实施调整。' : '根据失败事实修正后重试。',
          toolCalls: [{ id: `opacity-${modelCallCount}`, name: 'setLayerOpacity', arguments: { layerId: 7, opacity: 80 } }]
        };
      }
      if (modelCallCount === 9) {
        return {
          content: '读回复核。',
          toolCalls: [{ id: 'verify', name: 'getLayerHierarchy', arguments: {} }]
        };
      }
      return { content: '执行事实已记录，质量结论仍由独立评价决定。', toolCalls: [] };
    },
    async (toolName, args) => {
      if (toolName === REQUEST_AGENT_CAPABILITIES_TOOL_NAME) {
        const activation = capabilitySession.requestCapabilities(args.capabilityIds || []);
        return { success: activation.status !== 'rejected', data: activation };
      }
      externalCalls.push(toolName);
      if (toolName === 'getAnnotatedSnapshot') {
        return { success: true, elements: [{ id: 7, name: '目标图层' }] };
      }
      if (toolName === 'getDocumentInfo') return documentInfoFixture();
      if (toolName === 'setLayerOpacity') {
        opacityAttempts += 1;
        return opacityAttempts === 1
          ? { success: false, code: 'fixture_write_failed', error: 'fixture write failed' }
          : { success: true };
      }
      if (toolName === 'getLayerHierarchy') return { success: true, layers: [{ id: 7 }] };
      throw new Error(`Unexpected Tool: ${toolName}`);
    }
  );
  const result = await agent.run(task);
  const reconciliation = result.data.runtimeActionPlanReconciliation;
  const runtimeTaskSnapshot = result.data.runtimeTaskSnapshot;
  const reconciliationDigest = result.executionSummary.runtimeActionPlanReconciliationDigest;
  assert(reconciliation, JSON.stringify(result.data, null, 2));
  assert(runtimeTaskSnapshot, JSON.stringify(result.data, null, 2));
  assert(reconciliationDigest, JSON.stringify(result.executionSummary, null, 2));
  assert.strictEqual(reconciliation.status, 'completed');
  assert.strictEqual(reconciliation.metrics.recoveredStepCount, 1);
  assert.strictEqual(reconciliation.metrics.observationCount, 3);
  assert.strictEqual(reconciliation.metrics.mutationReadbackBindingCount, 1);
  assert.strictEqual(reconciliation.verificationBindings.length, 1);
  assert.deepStrictEqual(reconciliation.attributions.map((entry) => entry.stepId), [
    'apply-change', 'apply-change', 'verify-change'
  ]);
  assert.deepStrictEqual(reconciliationDigest.recoveredStepIds, ['apply-change']);
  assert.strictEqual(reconciliationDigest.boundaries.changesTaskResult, false);
  assert.strictEqual(runtimeTaskSnapshot.identity.sessionId, result.executionSummary.runtimeSessionDigest.sessionId);
  assert.strictEqual(runtimeTaskSnapshot.identity.runId, result.executionSummary.runtimeSessionDigest.runId);
  assert.strictEqual(runtimeTaskSnapshot.outcome.status, result.executionSummary.status);
  assert.deepStrictEqual(runtimeTaskSnapshot.actionPlan.steps.map((entry) => entry.status), [
    'completed', 'completed', 'completed'
  ]);
  assert.strictEqual(runtimeTaskSnapshot.execution.mutationReadbackBindingCount, 1);
  assert.strictEqual(runtimeTaskSnapshot.execution.mutationReadbackBindings.length, 1);
  assert.strictEqual(runtimeTaskSnapshot.boundaries.grantsPermission, false);
  assert.strictEqual(runtimeTaskSnapshot.boundaries.changesTaskResult, false);
  assert.strictEqual(result.executionSummary.runtimeTaskSnapshot, undefined,
    'full snapshot must remain out of the persisted execution summary');
  assert.notStrictEqual(result.executionSummary.designVerdict?.status, 'passed');
  assert.strictEqual(
    result.executionSummary.runtimeStageState.stages.find((entry) => entry.stage === 'E1').status,
    'passed'
  );
  assert.strictEqual(result.executionSummary.runtimeSessionDigest.accounting.modelCallCount, modelCallCount);
  assert.strictEqual(result.executionSummary.runtimeSessionDigest.accounting.unreportedUsageCallCount, modelCallCount);
  assert.strictEqual(result.executionSummary.runtimeSessionDigest.accounting.inputTokens, 0);
  assert.strictEqual(result.executionSummary.runtimeSessionDigest.accounting.boundaries.missingUsageNotEstimated, true);
  assert.strictEqual(presentations.length, 4,
    `expected one pending projection and three step status updates: ${JSON.stringify(presentations, null, 2)}`);
  assert.strictEqual(presentations[0].identity.conversationId, 'conversation:reconciliation-smoke');
  assert.strictEqual(presentations[0].identity.projectId, 'project:reconciliation-smoke');
  assert(presentations[0].steps.every((step) => step.status === 'pending'));
  assert(presentations[3].steps.some((step) => step.status === 'completed'));
  const presentationJson = JSON.stringify(presentations);
  assert(!/contextRefs|observedOutcomes|boundaries|capabilityRefs|completionCriteria|attributions/.test(presentationJson),
    `presentation leaked runtime internals: ${presentationJson}`);
  const modelToolResults = result.messages
    .filter((message) => message.role === 'tool_result')
    .flatMap((message) => message.toolResults || []);
  assert(modelToolResults.length > 0);
  assert(modelToolResults.every((entry) => entry.output?.contextEnvelope?.slot === 'tool_observation'));
  assert(modelToolResults.every((entry) => entry.output?.contextEnvelope?.grantsPermission === false));
  assert.strictEqual(containsForbiddenExecutionKey(reconciliation), false);
  assert(!JSON.stringify(reconciliation).includes('fixture write failed'));
  assert.deepStrictEqual(externalCalls, [
    'getAnnotatedSnapshot',
    'getDocumentInfo',
    'setLayerOpacity',
    'setLayerOpacity',
    'getLayerHierarchy'
  ]);
  return {
    modelCallCount,
    externalCalls,
    status: reconciliation.status,
    recoveredStepIds: reconciliationDigest.recoveredStepIds,
    completedStepIds: reconciliationDigest.completedStepIds,
    executionStatus: result.executionSummary.status,
    qualityStatus: result.executionSummary.designVerdict?.status
  };
}

async function runPlanGenerationResetIntegration() {
  const task = '请形成计划，执行一次调整，然后重新规划并核对新代次不会继承旧动作';
  const capabilitySession = createAgentCapabilitySession({
    candidateTools,
    requestedTaskType: GENERAL_DESIGN_MANIFEST.task_type,
    manifest: GENERAL_DESIGN_MANIFEST
  });
  capabilitySession.requestCapabilities([
    'photoshop.write.setLayerOpacity',
    'photoshop.read.inspectLayers'
  ]);
  let modelCallCount = 0;
  const agent = new Agent(
    {
      systemPrompt: 'Action-plan generation reset smoke.',
      tools: capabilitySession.activeTools,
      modelId: 'test-model',
      maxIterations: 10,
      runtimeStagePlan: buildRuntimeStagePlan(GENERAL_DESIGN_MANIFEST),
      runtimeSessionIdentity: createRuntimeSessionIdentityForPlan(
        buildRuntimeStagePlan(GENERAL_DESIGN_MANIFEST),
        'reconciliation-reset'
      ),
      getCapabilityResolution: () => capabilitySession.getResolution(),
      getActiveCapabilityIdsForTool: (toolName) => capabilitySession.getActiveCapabilityIdsForTool(toolName),
      getOnDemandActivatedCapabilityIds: () => capabilitySession.getOnDemandActivatedCapabilityIds(),
      toolDecisionContext: {
        intentControlPlane: buildAgentIntentControlPlaneDecision({ userInput: task }),
        photoshopConnected: true,
        hasDocument: true
      },
      callbacks: {}
    },
    async (_modelId, _messages, modelTools) => {
      modelCallCount += 1;
      if (modelCallCount === 1) {
        return { content: '读取文档。', toolCalls: [{ id: 'reset-read', name: 'getDocumentInfo', arguments: {} }] };
      }
      if (modelCallCount === 2) {
        return {
          content: '记录当前 Design Brief。',
          toolCalls: [{ id: 'reset-brief', name: DECLARE_DESIGN_BRIEF_TOOL_NAME, arguments: briefArguments() }]
        };
      }
      if (modelCallCount === 3) {
        return {
          content: '记录策略。',
          toolCalls: [{ id: 'reset-strategy', name: DECLARE_DESIGN_STRATEGY_TOOL_NAME, arguments: strategyArguments() }]
        };
      }
      if (modelCallCount === 4) {
        return {
          content: '记录首个计划。',
          toolCalls: [{ id: `reset-plan-${modelCallCount}`, name: DECLARE_RUNTIME_ACTION_PLAN_TOOL_NAME, arguments: planArguments() }]
        };
      }
      if (modelCallCount === 5) {
        return {
          content: '执行首个计划的调整。',
          toolCalls: [{ id: 'reset-write', name: 'setLayerOpacity', arguments: { layerId: 7, opacity: 80 } }]
        };
      }
      if (modelCallCount === 6) {
        assert.strictEqual(
          modelTools.some((tool) => tool.name === DECLARE_RUNTIME_ACTION_PLAN_TOOL_NAME),
          false,
          'E1 must not expose the R4 action-plan declaration Tool'
        );
        // 真正的跨 Stage 回退由 Runtime Session / Reflexion 负责；这里直接调用声明消费者，
        // 只验证新计划代次会清空旧执行观察，不为测试恢复越权模型工具面。
        const redeclaration = await agent.executeRuntimeActionPlanDeclaration(planArguments());
        assert.strictEqual(redeclaration.success, true);
        return {
          content: '读取新计划下的结构。',
          toolCalls: [{ id: 'reset-verify', name: 'getLayerHierarchy', arguments: {} }]
        };
      }
      return { content: '新计划代次证据已记录。', toolCalls: [] };
    },
    async (toolName) => {
      if (toolName === 'getAnnotatedSnapshot') return { success: true, elements: [{ id: 7 }] };
      if (toolName === 'getDocumentInfo') return documentInfoFixture();
      if (toolName === 'setLayerOpacity') return { success: true };
      if (toolName === 'getLayerHierarchy') return { success: true, layers: [{ id: 7 }] };
      throw new Error(`Unexpected Tool: ${toolName}`);
    }
  );
  const result = await agent.run(task);
  const reconciliation = result.data.runtimeActionPlanReconciliation;
  assert(reconciliation, JSON.stringify(result.data, null, 2));
  assert.strictEqual(reconciliation.metrics.observationCount, 1,
    'redeclared plan must discard the previous generation write observation');
  assert.strictEqual(reconciliation.metrics.dependencyBlockedObservationCount, 1);
  assert.strictEqual(step(reconciliation, 'apply-change').status, 'ready');
  assert.strictEqual(step(reconciliation, 'verify-change').status, 'blocked_by_dependency');
  assert.strictEqual(reconciliation.attributions[0].outcome, 'dependency_blocked');
  return {
    observationCount: reconciliation.metrics.observationCount,
    dependencyBlockedObservationCount: reconciliation.metrics.dependencyBlockedObservationCount,
    applyStatus: step(reconciliation, 'apply-change').status,
    verifyStatus: step(reconciliation, 'verify-change').status
  };
}

const reconciliationSource = fs.readFileSync(
  path.join(root, 'src', 'shared', 'agent-runtime-v5', 'runtime-action-plan-reconciliation.ts'),
  'utf8'
);
const observationSource = fs.readFileSync(
  path.join(root, 'src', 'shared', 'agent-runtime-v5', 'runtime-action-plan-observation.ts'),
  'utf8'
);
assert(!/taskText|detailPage|mainImage|sku/i.test(reconciliationSource));
assert(!/详情页|主图|SKU/.test(reconciliationSource));
assert(!reconciliationSource.includes('executeTool('));
assert(!observationSource.includes('toolName'));
assert(!observationSource.includes('arguments:'));

Promise.all([runAgentIntegration(), runPlanGenerationResetIntegration()])
  .then(([agentIntegration, generationReset]) => {
    console.log(JSON.stringify({
      success: true,
      complete: {
        status: complete.status,
        stepStatuses: complete.steps.map((entry) => `${entry.stepId}:${entry.status}`)
      },
      recovery: {
        status: recovered.status,
        recoveredStepCount: recovered.metrics.recoveredStepCount
      },
      drift: {
        outOfOrder: outOfOrder.metrics.dependencyBlockedObservationCount,
        ambiguous: ambiguous.metrics.ambiguousObservationCount,
        unmatched: drift.metrics.unmatchedObservationCount,
        repeated: repeated.metrics.repeatAfterCompletionCount
      },
      boundedJournal: {
        kept: capped.observations.length,
        dropped: capped.droppedObservationCount
      },
      agentIntegration,
      generationReset,
      boundary: 'shadow-only Capability attribution; no scheduler, retry, Tool-name inference, task progress or quality authority'
    }, null, 2));
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
