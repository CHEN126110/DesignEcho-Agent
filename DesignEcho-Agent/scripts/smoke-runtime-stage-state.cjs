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
  applyRuntimeStageEvaluation,
  buildRuntimeStageStateFromEvaluation,
  createRuntimeStageState
} = require(path.join(root, 'src', 'shared', 'agent-runtime-v5', 'runtime-stage-state.ts'));
const {
  buildRuntimeStagePlan
} = require(path.join(root, 'src', 'shared', 'agent-runtime-v5', 'runtime-stage-plan.ts'));
const {
  createRuntimeSessionIdentity
} = require(path.join(root, 'src', 'shared', 'agent-runtime-v5', 'runtime-session.ts'));
const {
  GENERAL_DESIGN_MANIFEST
} = require(path.join(root, 'src', 'shared', 'agent-runtime-v5', 'manifests', 'general-design.manifest.ts'));
const {
  DECLARE_DESIGN_BRIEF_TOOL_NAME
} = require(path.join(root, 'src', 'shared', 'agent-runtime-v5', 'runtime-design-brief-declaration.ts'));
const { Agent } = require(path.join(root, 'src', 'renderer', 'services', 'agent-runtime', 'agent.ts'));

const plan = buildRuntimeStagePlan(GENERAL_DESIGN_MANIFEST);

function verdict(status, overrides = {}) {
  return {
    version: 'design-quality-verdict/v0',
    status,
    source: status === 'not_applicable' ? 'none' : 'contract+scorecard',
    contractStatus: 'completed',
    contractFailedRequirementIds: [],
    blockers: status === 'failed' ? ['主体真实性未通过'] : [],
    warnings: status === 'needs_review' || status === 'passed_unverified' ? ['质量结果需要复核'] : [],
    summary: `verdict=${status}`,
    ...overrides
  };
}

function handoff(targetStage) {
  return {
    version: 'quality-gate-reflexion-handoff/v0',
    status: 'reflexion_required',
    sourceOwner: 'R5',
    targetStage,
    reenterLoop: 'react',
    failureAnalysis: ['质量红线未通过'],
    strategyAdjustments: ['调整主体处理'],
    nextRoundConstraints: ['保持产品真实性']
  };
}

const initial = createRuntimeStageState(plan);
assert.strictEqual(initial.version, 'runtime-stage-state/v0');
assert.strictEqual(initial.status, 'active');
assert.strictEqual(initial.currentStage, 'R0');
assert(initial.stages.every((stage) => stage.status === 'unobserved'));
assert.strictEqual(initial.boundaries.executesTools, false);
assert.strictEqual(initial.boundaries.changesTaskResult, false);

const afterR0 = applyRuntimeStageEvaluation({
  plan,
  state: initial,
  event: {
    stage: 'R0',
    outcome: 'passed',
    observedOutcomes: ['skill_manifest_selected', 'stage_plan_created']
  }
});
assert.strictEqual(afterR0.status, 'active');
assert.strictEqual(afterR0.currentStage, 'R1');
assert.strictEqual(afterR0.transitions[0].decision, 'advance');
assert.strictEqual(afterR0.stages.find((stage) => stage.stage === 'R0').status, 'passed');

const missingOutcomes = applyRuntimeStageEvaluation({
  plan,
  state: afterR0,
  event: {
    stage: 'R1',
    outcome: 'passed',
    observedOutcomes: ['required_inputs_checked']
  }
});
assert.strictEqual(missingOutcomes.status, 'awaiting_outcomes');
assert.strictEqual(missingOutcomes.currentStage, 'R1');
assert.strictEqual(missingOutcomes.transitions[1].decision, 'await_outcome_or_review');
assert.deepStrictEqual(missingOutcomes.transitions[1].missingOutcomes, ['blocking_inputs_identified']);
assert(missingOutcomes.issues.some((issue) => issue.startsWith('stage_pass_downgraded_missing_outcomes:R1')));

const reactFailure = applyRuntimeStageEvaluation({
  plan,
  state: createRuntimeStageState(plan),
  event: {
    stage: 'E1',
    outcome: 'failed',
    observedOutcomes: ['tool_action_result'],
    reason: '工具结果未达到阶段目标'
  }
});
assert.strictEqual(reactFailure.status, 'active');
assert.strictEqual(reactFailure.currentStage, 'E1');
assert.strictEqual(reactFailure.transitions[0].decision, 'continue_react');

const reflexionFailure = applyRuntimeStageEvaluation({
  plan,
  state: createRuntimeStageState(plan),
  event: {
    stage: 'R5',
    outcome: 'failed',
    observedOutcomes: ['quality_gate_report', 'stage_evaluation'],
    verdict: verdict('failed'),
    reflexionHandoff: handoff('R4')
  }
});
assert.strictEqual(reflexionFailure.status, 'reflexion_required');
assert.strictEqual(reflexionFailure.currentStage, 'R4');
assert.strictEqual(reflexionFailure.transitions[0].decision, 'enter_reflexion');

const invalidTarget = applyRuntimeStageEvaluation({
  plan,
  state: createRuntimeStageState(plan),
  event: {
    stage: 'R5',
    outcome: 'failed',
    observedOutcomes: ['quality_gate_report', 'stage_evaluation'],
    verdict: verdict('failed'),
    reflexionHandoff: handoff('X9')
  }
});
assert.strictEqual(invalidTarget.currentStage, 'R5');
assert(invalidTarget.issues.includes('reflexion_target_not_in_plan:X9'));

const passedState = buildRuntimeStageStateFromEvaluation({
  plan,
  executionSummary: {
    status: 'completed',
    stopReason: 'final_response',
    designVerdict: verdict('passed', { overallScore: 92 })
  }
});
assert.strictEqual(passedState.status, 'active');
assert.strictEqual(passedState.currentStage, 'E2');
assert.strictEqual(passedState.transitions.at(-1).decision, 'advance');
assert.strictEqual(passedState.stages.find((stage) => stage.stage === 'E2').status, 'unobserved');

const unverifiedState = buildRuntimeStageStateFromEvaluation({
  plan,
  executionSummary: {
    status: 'completed',
    stopReason: 'final_response',
    designVerdict: verdict('passed_unverified')
  }
});
assert.strictEqual(unverifiedState.status, 'awaiting_outcomes');
assert.strictEqual(unverifiedState.currentStage, 'R5');
assert.strictEqual(unverifiedState.transitions.at(-1).decision, 'await_outcome_or_review');

const failedState = buildRuntimeStageStateFromEvaluation({
  plan,
  executionSummary: {
    status: 'needs_review',
    stopReason: 'final_response',
    blockers: ['主体真实性未通过'],
    designVerdict: verdict('failed')
  },
  reflexionHandoff: handoff('R4')
});
assert.strictEqual(failedState.status, 'reflexion_required');
assert.strictEqual(failedState.currentStage, 'R4');

const confirmationState = buildRuntimeStageStateFromEvaluation({
  plan,
  executionSummary: {
    status: 'awaiting_confirmation',
    stopReason: 'awaiting_user_confirmation'
  }
});
assert.strictEqual(confirmationState.status, 'awaiting_confirmation');
assert.strictEqual(confirmationState.currentStage, 'E2');
assert.strictEqual(confirmationState.transitions.at(-1).decision, 'await_user_confirmation');

const cancelledState = buildRuntimeStageStateFromEvaluation({
  plan,
  executionSummary: {
    status: 'cancelled',
    stopReason: 'cancelled'
  }
});
assert.strictEqual(cancelledState.status, 'cancelled');
assert.strictEqual(cancelledState.transitions.at(-1).decision, 'stop_cancelled');

const completedPlanState = applyRuntimeStageEvaluation({
  plan,
  state: passedState,
  event: {
    stage: 'E2',
    outcome: 'passed',
    observedOutcomes: ['user_confirmation_or_delivery_record']
  }
});
assert.strictEqual(completedPlanState.status, 'completed');
assert.strictEqual(completedPlanState.currentStage, undefined);
assert.strictEqual(completedPlanState.transitions.at(-1).decision, 'complete');

const stageStateSource = fs.readFileSync(
  path.join(root, 'src', 'shared', 'agent-runtime-v5', 'runtime-stage-state.ts'),
  'utf8'
);
for (const categoryToken of ['detail-page', 'main-image', 'sku-batch', '详情页', '主图', 'SKU']) {
  assert(!stageStateSource.includes(categoryToken), `Stage State must stay category-neutral: ${categoryToken}`);
}
assert(!stageStateSource.includes('executeTool'));

const agentSource = fs.readFileSync(
  path.join(root, 'src', 'renderer', 'services', 'agent-runtime', 'agent.ts'),
  'utf8'
);
assert(!agentSource.includes('buildRuntimeStageStateFromEvaluation'));
assert(agentSource.includes('finalizeRuntimeSession'));
assert(agentSource.includes('applyRuntimeSessionStageEvaluation'));
assert(agentSource.includes('executionSummary.runtimeStageState = runtimeStageState'));
assert(agentSource.includes('designVerdict = buildDesignVerdict'));
assert(agentSource.includes('projectRuntimeSessionCompletion'));
assert(!agentSource.includes('Runtime Session 的 R5 尚未通过'));
assert(!agentSource.includes('Runtime Session 的 E2 尚无真实交付结果'));
assert(!agentSource.includes("runtimeStageState.status !== 'completed'"));

const runRecordSource = fs.readFileSync(
  path.join(root, 'src', 'shared', 'agent-run-record.ts'),
  'utf8'
);
assert(runRecordSource.includes('stageStateDigestOnly: true'));
assert(runRecordSource.includes('verdictStatus'));

async function runAgentIntegration() {
  const task = '请基于当前目标建立通用设计简报，后续执行等简报确认后再继续';
  let modelCallCount = 0;
  const externalToolCalls = [];
  const agent = new Agent(
    {
      systemPrompt: 'Stage State integration smoke.',
      tools: [{
        name: 'createDocument',
        description: 'Create a disposable test document.',
        inputSchema: {
          type: 'object',
          properties: {
            width: { type: 'number' },
            height: { type: 'number' }
          },
          required: ['width', 'height']
        }
      }],
      modelId: 'test-model',
      maxIterations: 3,
      runtimeStagePlan: plan,
      runtimeSessionIdentity: createRuntimeSessionIdentity({
        now: '2026-07-13T04:00:00.000Z',
        nonce: 'stage-state-agent',
        skillId: plan.skillId,
        taskType: plan.taskType
      }),
      taskCompletionContext: {
        skillId: 'main-image-design',
        intentMode: 'execute',
        imageCount: 0
      },
      callbacks: {}
    },
    async () => {
      modelCallCount += 1;
      if (modelCallCount === 1) {
        return {
          content: '先声明通用设计任务的目标和必需输入。',
          toolCalls: [{
            id: 'declare-brief',
            name: DECLARE_DESIGN_BRIEF_TOOL_NAME,
            arguments: {
              taskGoal: '从零设计一张通用促销海报。',
              deliverables: ['可编辑设计文档', '预览'],
              outputRequirements: ['1080 × 1080 画布', '写入后需要复核'],
              constraints: ['不编造商品事实'],
              inputCoverage: [{
                inputKey: 'goal',
                status: 'provided',
                contextRefs: ['input:goal:user_goal']
              }],
              contextRefs: ['context:user_goal', 'context:skill_manifest', 'input:goal:user_goal']
            }
          }]
        };
      }
      return { content: '当前没有形成可验证设计产物。', toolCalls: [] };
    },
    async (toolName) => {
      externalToolCalls.push(toolName);
      if (toolName === 'getAnnotatedSnapshot') {
        return { success: true, elements: [{ id: 7, name: '测试图层' }] };
      }
      return toolName === 'createDocument'
        ? { success: true, documentId: 1, message: '测试画布已创建' }
        : { success: false, error: 'unexpected Tool execution' };
    }
  );
  const result = await agent.run(task);
  assert.deepStrictEqual(externalToolCalls, ['getAnnotatedSnapshot'], 'Brief control must not leak to the external Tool executor');
  assert.strictEqual(result.executionSummary.designVerdict, undefined, 'Brief-only control work must not fabricate a quality verdict');
  assert(result.executionSummary.runtimeStageState, JSON.stringify(result.executionSummary, null, 2));
  assert(result.executionSummary.runtimeStageTraceDigest, JSON.stringify(result.executionSummary, null, 2));
  assert(result.data.runtimeStageTrace, JSON.stringify(result.data, null, 2));
  assert(result.data.runtimeDesignBriefDeclaration, JSON.stringify(result.data, null, 2));
  assert(result.data.runtimeStageTrace.events.some((event) => event.stage === 'R1'));
  assert(!result.data.runtimeStageTrace.events.some((event) => event.stage === 'R4'));
  assert(!result.data.runtimeStageTrace.events.some((event) => event.stage === 'E1'));
  assert(!result.data.runtimeStageTrace.events.some((event) => event.stage === 'R3'));
  assert(result.executionSummary.runtimeStageTraceDigest.missingStages.includes('R4'));
  const serializedTrace = JSON.stringify(result.data.runtimeStageTrace);
  assert(!serializedTrace.includes('1080'));
  assert(!serializedTrace.includes('arguments'));
  assert(!serializedTrace.includes('测试画布已创建'));
  assert.strictEqual(result.executionSummary.runtimeStageState.version, 'runtime-stage-state/v0');
  assert.strictEqual(result.executionSummary.runtimeStageState.boundaries.changesTaskResult, false);
  assert.strictEqual(result.data.runtimeStageState.version, 'runtime-stage-state/v0');
  assert(result.executionSummary.runtimeStageState.transitions.length >= 2);

  console.log(JSON.stringify({
    success: true,
    planStages: plan.steps.map((step) => step.stage),
    transitions: {
      pass: passedState.transitions.at(-1).decision,
      missingRequiredOutcomes: unverifiedState.transitions.at(-1).decision,
      failed: failedState.transitions.at(-1).decision,
      confirmation: confirmationState.transitions.at(-1).decision,
      cancelled: cancelledState.transitions.at(-1).decision,
      finalDelivery: completedPlanState.transitions.at(-1).decision
    },
    agentIntegration: {
      executionStatus: result.executionSummary.status,
      verdictStatus: result.executionSummary.designVerdict?.status || 'not_evaluated',
      stageStateStatus: result.executionSummary.runtimeStageState.status,
      currentStage: result.executionSummary.runtimeStageState.currentStage,
      traceStatus: result.executionSummary.runtimeStageTraceDigest.status,
      traceEvents: result.executionSummary.runtimeStageTraceDigest.eventCount,
      traceMissingStages: result.executionSummary.runtimeStageTraceDigest.missingStages
    },
    boundary: 'evaluation-only Stage State; no Tool dispatch and no task-result override'
  }, null, 2));
}

async function runNoReferenceR2RecoveryIntegration() {
  const task = '请根据当前打开的文档完成通用设计任务';
  let modelCallCount = 0;
  const externalToolCalls = [];
  const modelToolSnapshots = [];
  const agent = new Agent(
    {
      systemPrompt: 'No-reference R2 recovery integration smoke.',
      tools: [{
        name: 'getDocumentInfo',
        description: 'Read the current Photoshop document.',
        inputSchema: { type: 'object', properties: {} }
      }],
      modelId: 'test-model',
      maxIterations: 4,
      performanceBudget: {
        maxModelCalls: 4,
        maxToolCalls: 2,
        maxVisionCandidates: 0,
        maxVisualAnalyses: 0,
        maxFullResolutionImageReads: 0,
        softTimeBudgetMs: 60_000
      },
      runtimeStagePlan: plan,
      runtimeSessionIdentity: createRuntimeSessionIdentity({
        now: '2026-07-22T06:00:00.000Z',
        nonce: 'stage-state-r2-recovery',
        skillId: plan.skillId,
        taskType: plan.taskType
      }),
      toolDecisionContext: {
        photoshopConnected: true,
        hasDocument: true
      },
      callbacks: {}
    },
    async (_modelId, _messages, tools) => {
      modelCallCount += 1;
      const toolNames = tools.map((tool) => tool.name);
      modelToolSnapshots.push(toolNames);
      if (modelCallCount === 1) {
        return {
          content: '需求已经明确，先提交完整设计简报。',
          toolCalls: [{
            id: 'declare-brief-first',
            name: DECLARE_DESIGN_BRIEF_TOOL_NAME,
            arguments: {
              taskGoal: '基于当前文档完成通用设计任务。',
              deliverables: ['可编辑设计结果'],
              outputRequirements: ['写入后复核'],
              constraints: ['保持现有文档结构'],
              inputCoverage: [{
                inputKey: 'goal',
                status: 'provided',
                contextRefs: ['input:goal:user_goal']
              }],
              contextRefs: ['context:user_goal', 'input:goal:user_goal']
            }
          }]
        };
      }
      if (modelCallCount === 2) {
        return { content: '简报已经明确。', toolCalls: [] };
      }
      if (modelCallCount === 3) {
        assert(
          toolNames.includes('getDocumentInfo'),
          `R2 recovery must expose one read-only observation provider: ${JSON.stringify(modelToolSnapshots)}`
        );
        assert(
          !toolNames.includes('declareReferenceBrief'),
          'a Skill without reference_policy must not be forced through Reference Brief'
        );
        return {
          content: '读取当前文档，取得推进策略所需的最小上下文。',
          toolCalls: [{ id: 'read-r2-document', name: 'getDocumentInfo', arguments: {} }]
        };
      }
      return { content: '当前阶段已经取得文档上下文。', toolCalls: [] };
    },
    async (toolName) => {
      externalToolCalls.push(toolName);
      if (toolName === 'getDocumentInfo') {
        return {
          success: true,
          observedAt: '2026-07-22T06:00:01.000Z',
          documentState: 'present',
          document: { id: 1, name: 'r2-recovery.psd', activeLayerId: 2, activeLayerName: '产品图' }
        };
      }
      return { success: false, error: 'unexpected Tool execution' };
    }
  );
  const result = await agent.run(task);
  assert.deepStrictEqual(externalToolCalls, ['getDocumentInfo']);
  assert(!externalToolCalls.includes('getAnnotatedSnapshot'));
  assert(result.data.runtimeStageTrace.events.some((event) => (
    event.stage === 'R2'
      && event.outcome === 'passed'
      && event.toolName === 'getDocumentInfo'
  )), JSON.stringify(result.data.runtimeStageTrace, null, 2));
  assert(!result.executionSummary.runtimeStageTraceDigest.missingStages.includes('R2'));
  assert.strictEqual(result.executionSummary.runtimeStageTraceDigest.traceEventWithoutTransitionCount, 0);
  return {
    modelCallCount,
    externalToolCalls,
    recoveryToolNames: modelToolSnapshots[2],
    r2Passed: true
  };
}

async function main() {
  await runAgentIntegration();
  const noReferenceR2Recovery = await runNoReferenceR2RecoveryIntegration();
  console.log(JSON.stringify({ noReferenceR2Recovery }, null, 2));
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
