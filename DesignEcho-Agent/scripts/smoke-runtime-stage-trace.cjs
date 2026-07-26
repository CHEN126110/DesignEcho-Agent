'use strict';

const assert = require('assert');
const path = require('path');

require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '..', 'tsconfig.main.json')
});

const root = path.resolve(__dirname, '..');
const {
  appendRuntimeStageTraceEvent,
  buildRuntimeStageTraceDigest,
  createRuntimeStageTrace,
  runtimeStageTraceToEvaluationEvents
} = require(path.join(root, 'src', 'shared', 'agent-runtime-v5', 'runtime-stage-trace.ts'));
const {
  buildRuntimeStageStateFromEvaluation
} = require(path.join(root, 'src', 'shared', 'agent-runtime-v5', 'runtime-stage-state.ts'));
const {
  buildRuntimeStagePlan,
  canAttachedImageObservationSatisfyRuntimeR2
} = require(path.join(root, 'src', 'shared', 'agent-runtime-v5', 'runtime-stage-plan.ts'));
const {
  createRuntimeSessionIdentity
} = require(path.join(root, 'src', 'shared', 'agent-runtime-v5', 'runtime-session.ts'));
const {
  GENERAL_DESIGN_MANIFEST
} = require(path.join(root, 'src', 'shared', 'agent-runtime-v5', 'manifests', 'general-design.manifest.ts'));
const {
  REFERENCE_REPLICATION_MANIFEST
} = require(path.join(root, 'src', 'shared', 'agent-runtime-v5', 'manifests', 'reference-replication.manifest.ts'));
const {
  DECLARE_DESIGN_BRIEF_TOOL_NAME
} = require(path.join(root, 'src', 'shared', 'agent-runtime-v5', 'runtime-design-brief-declaration.ts'));
const {
  DECLARE_DESIGN_STRATEGY_TOOL_NAME
} = require(path.join(root, 'src', 'shared', 'agent-runtime-v5', 'runtime-design-strategy-declaration.ts'));
const {
  CURRENT_R3_STRATEGY_REF,
  DECLARE_RUNTIME_ACTION_PLAN_TOOL_NAME
} = require(path.join(root, 'src', 'shared', 'agent-runtime-v5', 'runtime-action-plan-declaration.ts'));
const {
  createAgentCapabilitySession,
  REQUEST_AGENT_CAPABILITIES_TOOL_NAME
} = require(path.join(root, 'src', 'renderer', 'services', 'agent-runtime', 'capability-session.ts'));
const { Agent } = require(path.join(root, 'src', 'renderer', 'services', 'agent-runtime', 'agent.ts'));
const {
  buildAgentIntentControlPlaneDecision
} = require(path.join(root, 'src', 'shared', 'agent-intent-control-plane.ts'));

const plan = buildRuntimeStagePlan(GENERAL_DESIGN_MANIFEST);
const referencePlan = buildRuntimeStagePlan(REFERENCE_REPLICATION_MANIFEST);
assert.strictEqual(canAttachedImageObservationSatisfyRuntimeR2(plan), false);
assert.strictEqual(canAttachedImageObservationSatisfyRuntimeR2(referencePlan), true);
assert.strictEqual(canAttachedImageObservationSatisfyRuntimeR2(undefined), false);

function validStrategy() {
  return {
    stageGoal: '在保留当前结构的前提下完成最小画面调整并读回验证。',
    objective: {
      primaryGoal: '完成目标图层的可验证调整。',
      secondaryGoals: ['保持其他图层不变'],
      targetAudienceSummary: '需要核对结构化执行结果的用户。'
    },
    messageArchitecture: {
      primaryMessage: '只调整目标图层。',
      supportingMessages: [],
      supportingFacts: ['当前文档已经读取。'],
      objectionsToResolve: ['调整后是否可读回']
    },
    copyDirection: {
      toneKeywords: ['清晰'],
      headlineOptions: [],
      subtitleOptions: [],
      tagOptions: [],
      prohibitedClaims: []
    },
    visualDirection: {
      moodKeywords: ['克制'],
      paletteIntent: ['保持现有色彩。'],
      typographyIntent: ['保持现有文字。'],
      compositionIntent: ['只做最小图层变换。'],
      imageTreatment: ['不改变图像内容。'],
      density: 'medium'
    },
    constraints: ['只修改目标图层。'],
    contextRefs: ['context:user_goal', 'context:design_brief', 'context:readback'],
    assumptions: [],
    missingInputs: []
  };
}

function validActionPlan() {
  return {
    planGoal: '执行最小图层变换，并立即读取图层结构验证。',
    strategyRef: CURRENT_R3_STRATEGY_REF,
    contextRefs: ['context:user_goal', 'context:design_strategy', 'context:readback'],
    steps: [
      {
        stepId: 'transform-target',
        kind: 'mutate',
        goal: '执行目标图层的最小位置调整。',
        dependsOn: [],
        capabilityRefs: ['photoshop.sandbox.transformLayer'],
        inputContextRefs: ['context:design_strategy', 'context:readback'],
        expectedOutcomes: ['document_change'],
        completionCriteria: ['目标图层发生预期调整。'],
        failurePolicy: 'retry_after_observation'
      },
      {
        stepId: 'verify-target',
        kind: 'verify',
        goal: '读取图层结构确认调整结果。',
        dependsOn: ['transform-target'],
        capabilityRefs: ['photoshop.read.inspectLayers'],
        inputContextRefs: ['context:design_strategy'],
        expectedOutcomes: ['readback'],
        completionCriteria: ['结构读回存在。'],
        failurePolicy: 'enter_reflexion'
      }
    ],
    missingInputs: []
  };
}

function append(trace, event) {
  return appendRuntimeStageTraceEvent({ plan, trace, event });
}

function passedVerdict() {
  return {
    version: 'design-quality-verdict/v0',
    status: 'passed',
    source: 'contract+scorecard',
    contractStatus: 'completed',
    contractFailedRequirementIds: [],
    blockers: [],
    warnings: [],
    summary: '结构化质量门已通过'
  };
}

let trace = createRuntimeStageTrace(plan);
trace = append(trace, {
  stage: 'R1',
  source: 'brief_declaration',
  outcome: 'passed',
  observedOutcomes: ['required_inputs_checked', 'blocking_inputs_identified'],
  iteration: 1
});
trace = append(trace, {
  stage: 'R4',
  source: 'action_plan_declaration',
  outcome: 'passed',
  observedOutcomes: ['preview_or_action_plan', 'stage_output_candidate', 'C:\\private\\secret.txt'],
  iteration: 1,
  toolName: 'setLayerOpacity C:\\private\\secret.psd',
  toolKind: 'photoshop_write'
});
trace = append(trace, {
  stage: 'R2',
  source: 'tool_result',
  outcome: 'passed',
  observedOutcomes: ['project_context_observed', 'visual_or_readback_observation'],
  iteration: 2,
  toolName: 'getLayerHierarchy',
  toolKind: 'read_only_observation'
});
trace = append(trace, {
  stage: 'E1',
  source: 'tool_result',
  outcome: 'missing_required_outcomes',
  observedOutcomes: ['tool_action_result'],
  iteration: 2,
  toolName: 'setLayerOpacity',
  toolKind: 'photoshop_write'
});
trace = append(trace, {
  stage: 'E1',
  source: 'tool_result',
  outcome: 'passed',
  observedOutcomes: ['tool_observation_recorded'],
  iteration: 2,
  toolName: 'getLayerHierarchy',
  toolKind: 'read_only_observation'
});
trace = append(trace, {
  stage: 'E2',
  source: 'delivery_result',
  outcome: 'passed',
  observedOutcomes: ['user_confirmation_or_delivery_record'],
  iteration: 3,
  toolName: 'quickExport',
  toolKind: 'save_export'
});

const serialized = JSON.stringify(trace);
assert.strictEqual(trace.version, 'runtime-stage-trace/v0');
assert.strictEqual(trace.events.length, 6);
assert.strictEqual(trace.boundaries.containsToolArguments, false);
assert.strictEqual(trace.boundaries.containsToolResults, false);
assert.strictEqual(trace.boundaries.containsModelText, false);
assert(!serialized.includes('C:\\private'));
assert(!serialized.includes('secret.psd'));
assert(!serialized.includes('secret.txt'));
assert(!serialized.includes('arguments'));
assert(!serialized.includes('resultPayload'));

const state = buildRuntimeStageStateFromEvaluation({
  plan,
  observedEvents: runtimeStageTraceToEvaluationEvents(trace),
  executionSummary: {
    status: 'completed',
    designVerdict: passedVerdict()
  }
});
const e1 = state.stages.find((stage) => stage.stage === 'E1');
assert.strictEqual(e1.status, 'passed');
assert.deepStrictEqual(e1.observedOutcomes.sort(), ['tool_action_result', 'tool_observation_recorded']);
assert.strictEqual(state.status, 'completed');
assert.strictEqual(state.currentStage, undefined);
assert.strictEqual(state.stages.find((stage) => stage.stage === 'R3').status, 'unobserved');

const digest = buildRuntimeStageTraceDigest({ plan, trace, state });
assert.strictEqual(digest.status, 'incomplete');
assert(digest.missingStages.includes('R3'));
assert(digest.outOfOrderCount > 0);
assert.strictEqual(digest.traceBackedTransitionCount, trace.events.length);
assert.strictEqual(digest.unbackedTransitionCount, 0);
assert.strictEqual(digest.traceEventWithoutTransitionCount, 0);
assert.strictEqual(digest.boundaries.shadowOnly, true);
assert.strictEqual(digest.boundaries.changesTaskResult, false);

let capped = createRuntimeStageTrace(plan);
for (let index = 0; index < 125; index += 1) {
  capped = append(capped, {
    stage: 'R1',
    source: 'brief_declaration',
    outcome: 'passed',
    observedOutcomes: ['required_inputs_checked', 'blocking_inputs_identified'],
    iteration: index
  });
}
assert.strictEqual(capped.events.length, capped.boundaries.maxEvents);
assert.strictEqual(capped.droppedEventCount, 5);
assert(capped.issues.includes('trace_event_limit_reached'));

const source = require('fs').readFileSync(
  path.join(root, 'src', 'shared', 'agent-runtime-v5', 'runtime-stage-trace.ts'),
  'utf8'
);
assert(!/detailPage|mainImage|sku/i.test(source));
assert(!source.includes('executeTool('));
const agentSource = require('fs').readFileSync(
  path.join(root, 'src', 'renderer', 'services', 'agent-runtime', 'agent.ts'),
  'utf8'
);
assert(/recordToolResultStageTrace[\s\S]*isAgentHarnessControlTool\(call\.name\)/.test(agentSource));
assert(agentSource.includes('canAttachedImageObservationSatisfyRuntimeR2(this.config.runtimeStagePlan)'));

async function runAgentTraceIntegration() {
  const task = '请在当前文档调整目标图层，读回确认结果后再结束';
  let modelCallCount = 0;
  const executedTools = [];
  const capabilityActivationStatuses = [];
  const modelToolSnapshots = [];
  const candidateTools = [
    { name: 'getDocumentInfo', description: 'Read document.', inputSchema: { type: 'object', properties: {} } },
    {
      name: 'transformLayer',
      description: 'Transform a layer.',
      inputSchema: {
        type: 'object',
        properties: { layerId: { type: 'number' }, x: { type: 'number' }, y: { type: 'number' } },
        required: ['layerId', 'x', 'y']
      }
    },
    { name: 'getLayerHierarchy', description: 'Read layers.', inputSchema: { type: 'object', properties: {} } }
  ];
  const capabilitySession = createAgentCapabilitySession({
    candidateTools,
    requestedTaskType: GENERAL_DESIGN_MANIFEST.task_type,
    manifest: GENERAL_DESIGN_MANIFEST
  });
  const agent = new Agent(
    {
      systemPrompt: 'Stage trace integration smoke.',
      tools: capabilitySession.activeTools,
      modelId: 'test-model',
      maxIterations: 8,
      runtimeStagePlan: plan,
      runtimeSessionIdentity: createRuntimeSessionIdentity({
        now: '2026-07-13T04:10:00.000Z',
        nonce: 'stage-trace-agent',
        skillId: plan.skillId,
        taskType: plan.taskType
      }),
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
    async (_modelId, _messages, tools) => {
      modelCallCount += 1;
      modelToolSnapshots.push(tools.map((tool) => tool.name));
      if (modelCallCount === 1) {
        return {
          content: '先读取当前文档，确认目标存在后再修改。',
          toolCalls: [{ id: 'read-document', name: 'getDocumentInfo', arguments: {} }]
        };
      }
      if (modelCallCount === 2) {
        return {
          content: '当前文档已经读取，先声明设计简报和输入覆盖。',
          toolCalls: [{
            id: 'declare-brief',
            name: DECLARE_DESIGN_BRIEF_TOOL_NAME,
            arguments: {
              taskGoal: '调整当前目标图层并读取结果。',
              deliverables: ['可编辑文档状态'],
              outputRequirements: ['调整后必须读取结构确认'],
              constraints: ['只修改目标图层'],
              inputCoverage: [{
                inputKey: 'goal',
                status: 'provided',
                contextRefs: ['input:goal:user_goal']
              }],
              contextRefs: ['context:user_goal', 'context:readback', 'input:goal:user_goal']
            }
          }]
        };
      }
      if (modelCallCount === 3) {
        return {
          content: '基于 Brief 和读回观察声明当前设计策略。',
          toolCalls: [{
            id: 'declare-strategy',
            name: DECLARE_DESIGN_STRATEGY_TOOL_NAME,
            arguments: validStrategy()
          }]
        };
      }
      if (modelCallCount === 4) {
        return {
          content: '策略已经明确，先只装载行动计划真正需要的变换与结构读回能力。',
          toolCalls: [{
            id: 'request-execution-capabilities',
            name: REQUEST_AGENT_CAPABILITIES_TOOL_NAME,
            arguments: {
              capabilityIds: [
                'photoshop.sandbox.transformLayer',
                'photoshop.read.inspectLayers'
              ],
              reason: '执行目标图层的最小变换，并在写入后读取图层结构确认。'
            }
          }]
        };
      }
      if (modelCallCount === 5) {
        return {
          content: '所需能力已就绪，基于策略声明动态行动计划，不用工具名替代 Capability。',
          toolCalls: [{
            id: 'declare-action-plan',
            name: DECLARE_RUNTIME_ACTION_PLAN_TOOL_NAME,
            arguments: validActionPlan()
          }]
        };
      }
      if (modelCallCount === 6) {
        return {
          content: '所需能力已装载，现在移动目标图层；完成后立即读取图层结构复核。',
          toolCalls: [
            { id: 'transform-target', name: 'transformLayer', arguments: { layerId: 7, x: 12, y: 8 } },
            { id: 'read-layers', name: 'getLayerHierarchy', arguments: {} }
          ]
        };
      }
      return { content: '本轮操作已结束，结果仍需按结构化质量结论确认。', toolCalls: [] };
    },
    async (toolName, params) => {
      executedTools.push(toolName);
      if (toolName === REQUEST_AGENT_CAPABILITIES_TOOL_NAME) {
        const activation = capabilitySession.requestCapabilities(params.capabilityIds || []);
        capabilityActivationStatuses.push(activation.status);
        return {
          success: activation.status !== 'rejected',
          data: {
            ...activation,
            countsAsObservation: false,
            countsAsTaskProgress: false
          }
        };
      }
      if (toolName === 'getAnnotatedSnapshot') {
        return { success: true, elements: [{ id: 7, name: '目标图层' }] };
      }
      if (toolName === 'getDocumentInfo') {
        return {
          success: true,
          observedAt: '2026-07-16T00:00:00.000Z',
          documentState: 'present',
          document: { id: 1, name: 'runtime-stage-trace.psd', activeLayerId: 7, activeLayerName: '目标图层' }
        };
      }
      if (toolName === 'transformLayer') return { success: true, layerId: 7, x: 12, y: 8 };
      if (toolName === 'getLayerHierarchy') return { success: true, layers: [{ id: 7, x: 12, y: 8 }] };
      return { success: false, error: 'unexpected Tool' };
    }
  );
  const result = await agent.run(task);
  assert(executedTools.includes('getAnnotatedSnapshot'));
  assert(executedTools.includes('getDocumentInfo'));
  assert(
    executedTools.includes('transformLayer'),
    JSON.stringify({ executedTools, capabilityActivationStatuses, modelToolSnapshots }, null, 2)
  );
  assert(
    executedTools.includes('getLayerHierarchy'),
    JSON.stringify({ executedTools, capabilityActivationStatuses, modelToolSnapshots }, null, 2)
  );
  assert.deepStrictEqual(capabilityActivationStatuses, ['activated']);
  const runtimeTrace = result.data.runtimeStageTrace;
  assert(runtimeTrace.events.some((event) => event.stage === 'R1'));
  assert(runtimeTrace.events.some((event) => event.stage === 'R2'));
  assert(runtimeTrace.events.some((event) => event.stage === 'R4'));
  assert(runtimeTrace.events.some((event) => event.stage === 'E1'));
  assert(runtimeTrace.events.some((event) => event.stage === 'R3'));
  const runtimeSerialized = JSON.stringify(runtimeTrace);
  assert(!runtimeSerialized.includes('layerId'));
  assert(!runtimeSerialized.includes('"x"'));
  assert(!runtimeSerialized.includes('本轮操作已结束'));
  assert(!result.executionSummary.runtimeStageTraceDigest.missingStages.includes('R3'));
  assert(!result.executionSummary.runtimeStageTraceDigest.missingStages.includes('R4'));
  assert.strictEqual(result.executionSummary.runtimeStageTraceDigest.unbackedTransitionCount, 0);
  assert.strictEqual(
    result.executionSummary.runtimeStageTraceDigest.traceEventWithoutTransitionCount,
    0,
    'Agent integration must not pre-record future-stage Tool events without matching transitions'
  );
  assert.notStrictEqual(
    result.executionSummary.runtimeStageTraceDigest.status,
    'inconsistent',
    'Agent integration Stage Trace must stay internally consistent'
  );
  return {
    executedTools,
    traceStatus: result.executionSummary.runtimeStageTraceDigest.status,
    traceEvents: result.executionSummary.runtimeStageTraceDigest.eventCount,
    missingStages: result.executionSummary.runtimeStageTraceDigest.missingStages
  };
}

runAgentTraceIntegration().then((agentIntegration) => {
  console.log(JSON.stringify({
    success: true,
    eventCount: trace.events.length,
    accumulatedE1Outcomes: e1.observedOutcomes,
    digest: {
      status: digest.status,
      observedStages: digest.observedStages,
      missingStages: digest.missingStages,
      outOfOrderCount: digest.outOfOrderCount,
      unbackedTransitionCount: digest.unbackedTransitionCount
    },
    cap: {
      kept: capped.events.length,
      dropped: capped.droppedEventCount
    },
    agentIntegration,
    boundary: 'shadow-only, redacted, category-neutral, no Tool dispatch'
  }, null, 2));
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
