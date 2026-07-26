#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '..', 'tsconfig.main.json')
});

const ROOT = path.resolve(__dirname, '..');
const runtime = require(path.join(ROOT, 'src', 'shared', 'agent-runtime-v5', 'runtime-session.ts'));
const { buildRuntimeStagePlan } = require(path.join(ROOT, 'src', 'shared', 'agent-runtime-v5', 'runtime-stage-plan.ts'));
const { GENERAL_DESIGN_MANIFEST } = require(path.join(ROOT, 'src', 'shared', 'agent-runtime-v5', 'manifests', 'general-design.manifest.ts'));
const { buildAgentRunRecord, validateAgentRunRecordForPersist } = require(path.join(ROOT, 'src', 'shared', 'agent-run-record.ts'));
const { buildRunRecordResumeBrief } = require(path.join(ROOT, 'src', 'shared', 'agent-run-resume.ts'));
const { Agent } = require(path.join(ROOT, 'src', 'renderer', 'services', 'agent-runtime', 'agent.ts'));
const {
  DECLARE_DESIGN_BRIEF_TOOL_NAME
} = require(path.join(ROOT, 'src', 'shared', 'agent-runtime-v5', 'runtime-design-brief-declaration.ts'));
const {
  DECLARE_DESIGN_STRATEGY_TOOL_NAME
} = require(path.join(ROOT, 'src', 'shared', 'agent-runtime-v5', 'runtime-design-strategy-declaration.ts'));

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

function evaluate(session, plan, stage, outcome, observedOutcomes) {
  return runtime.applyRuntimeSessionStageEvaluation({
    session,
    plan,
    event: { stage, outcome, observedOutcomes, reason: `smoke:${stage}` }
  });
}

function observe(session, plan, stage, source, outcome, observedOutcomes) {
  return runtime.appendRuntimeSessionObservation({
    session,
    plan,
    event: { stage, source, outcome, observedOutcomes }
  });
}

function advanceToR5(session, plan) {
  let next = evaluate(session, plan, 'R1', 'passed', ['required_inputs_checked', 'blocking_inputs_identified']);
  next = evaluate(next, plan, 'R2', 'passed', ['project_context_observed', 'visual_or_readback_observation']);
  next = evaluate(next, plan, 'R3', 'passed', ['design_strategy_recorded', 'stage_goal_defined']);
  next = evaluate(next, plan, 'R4', 'passed', ['preview_or_action_plan', 'stage_output_candidate']);
  next = evaluate(next, plan, 'E1', 'missing_required_outcomes', ['tool_action_result']);
  next = evaluate(next, plan, 'E1', 'passed', ['tool_observation_recorded']);
  return next;
}

const plan = buildRuntimeStagePlan(GENERAL_DESIGN_MANIFEST);
const firstIdentity = runtime.createRuntimeSessionIdentity({
  now: '2026-07-13T01:02:03.456Z',
  nonce: 'same-nonce',
  skillId: plan.skillId,
  taskType: plan.taskType
});

console.log('smoke: runtime-session');

check('首代 identity 合法且 generation=1', () => {
  const validation = runtime.validateRuntimeSessionIdentity(firstIdentity);
  assert.strictEqual(validation.ok, true, JSON.stringify(validation.issues));
  assert.strictEqual(firstIdentity.generation, 1);
  assert.strictEqual(firstIdentity.parentRunId, undefined);
});

const secondIdentity = runtime.advanceRuntimeSessionIdentity({
  previous: firstIdentity,
  now: '2026-07-13T01:02:03.456Z',
  nonce: 'same-nonce'
});

check('同毫秒同 nonce 的下一代仍有唯一 runId 与正确 parent', () => {
  assert.strictEqual(secondIdentity.sessionId, firstIdentity.sessionId);
  assert.strictEqual(secondIdentity.generation, 2);
  assert.notStrictEqual(secondIdentity.runId, firstIdentity.runId);
  assert.strictEqual(secondIdentity.parentRunId, firstIdentity.runId);
});

let session = runtime.createRuntimeSession({ identity: firstIdentity, plan });

check('Session 创建时只由 manifest + plan 推进 R0', () => {
  assert.strictEqual(session.stageState.stages.find((stage) => stage.stage === 'R0').status, 'passed');
  assert.strictEqual(session.stageState.currentStage, 'R1');
  assert.strictEqual(session.stageTrace.events.length, 0);
});

check('完成状态投影由 Runtime Session 单一解释且不泄漏内部阶段枚举', () => {
  const projection = runtime.projectRuntimeSessionCompletion({
    executionStatus: 'completed',
    stageState: session.stageState
  });
  assert.strictEqual(projection.status, 'needs_review');
  assert.strictEqual(projection.reasonCode, 'runtime_outcomes_incomplete');
  assert.strictEqual(projection.summaryText, '这稿先做到这里。');
  assert.notStrictEqual(projection.summaryText, projection.blocker);
  assert(!/Runtime|R5|E2|unobserved/i.test(`${projection.summaryText} ${projection.blocker}`));
  assert.strictEqual(projection.boundaries.doesNotAdvanceStage, true);
});

check('已是失败或需复核的摘要不被 Runtime completion projection 二次改判', () => {
  for (const status of ['failed', 'needs_review', 'cancelled', 'awaiting_confirmation']) {
    const projection = runtime.projectRuntimeSessionCompletion({
      executionStatus: status,
      stageState: session.stageState
    });
    assert.strictEqual(projection.status, status);
    assert.strictEqual(projection.changed, false);
    assert.strictEqual(projection.blocker, undefined);
  }
});

check('质量通过但交付结果缺失时使用设计语言提示交付验收', () => {
  let deliveryPending = advanceToR5(runtime.createRuntimeSession({ identity: firstIdentity, plan }), plan);
  deliveryPending = evaluate(
    deliveryPending,
    plan,
    'R5',
    'passed',
    ['quality_gate_report', 'stage_evaluation']
  );
  const projection = runtime.projectRuntimeSessionCompletion({
    executionStatus: 'completed',
    stageState: deliveryPending.stageState
  });
  assert.strictEqual(projection.reasonCode, 'delivery_result_incomplete');
  assert(projection.blocker.includes('还没导出'));
  assert(!/Runtime|R5|E2|unobserved/i.test(projection.blocker));
});

session = observe(
  session,
  plan,
  'R2',
  'tool_result',
  'passed',
  ['project_context_observed', 'visual_or_readback_observation']
);

check('R1 前的提前 R2 observation 只进 Trace，不推进 Stage', () => {
  assert.strictEqual(session.stageTrace.events.length, 1);
  assert.strictEqual(session.stageState.currentStage, 'R1');
  assert.strictEqual(session.stageState.stages.find((stage) => stage.stage === 'R2').status, 'unobserved');
});

const outOfOrderEvaluation = evaluate(
  session,
  plan,
  'E1',
  'passed',
  ['tool_action_result', 'tool_observation_recorded']
);

check('越序评价记录 issue 但不能改变 currentStage', () => {
  assert.strictEqual(outOfOrderEvaluation.stageState.currentStage, 'R1');
  assert.strictEqual(outOfOrderEvaluation.stageState.stages.find((stage) => stage.stage === 'E1').status, 'unobserved');
  assert(outOfOrderEvaluation.issues.some((issue) => issue.includes('stage_mismatch')));
});

session = evaluate(session, plan, 'R1', 'passed', ['required_inputs_checked', 'blocking_inputs_identified']);
session = evaluate(session, plan, 'R2', 'passed', ['project_context_observed', 'visual_or_readback_observation']);
session = evaluate(session, plan, 'R3', 'passed', ['design_strategy_recorded', 'stage_goal_defined']);
session = evaluate(session, plan, 'R4', 'passed', ['preview_or_action_plan', 'stage_output_candidate']);

check('受信 R1/R2/R3/R4 评价按当前阶段推进到 E1', () => {
  assert.strictEqual(session.stageState.currentStage, 'E1');
  assert.strictEqual(session.stageState.stages.find((stage) => stage.stage === 'R4').status, 'passed');
});

const beforeR4Session = runtime.createRuntimeSession({
  identity: runtime.createRuntimeSessionIdentity({
    now: '2026-07-13T01:30:00.000Z',
    nonce: 'before-r4-gate',
    skillId: plan.skillId,
    taskType: plan.taskType
  }),
  plan
});

check('执行点 Gate 在 R4 ready 前阻断状态变更且不执行 Tool', () => {
  const gate = runtime.evaluateRuntimeSessionToolExecutionGate({
    session: beforeR4Session,
    toolName: 'setLayerOpacity',
    toolKind: 'photoshop_write'
  });
  assert.strictEqual(gate.allowed, false);
  assert.strictEqual(gate.code, 'runtime_session_r4_not_ready');
  assert.strictEqual(gate.boundaries.executesTools, false);
});

session = observe(session, plan, 'E1', 'tool_result', 'missing_required_outcomes', ['tool_action_result']);
session = evaluate(session, plan, 'E1', 'missing_required_outcomes', ['tool_action_result']);

check('单个状态变更 Tool 只有操作结果，不能把 E1 推进到 R5', () => {
  assert.strictEqual(session.stageState.currentStage, 'E1');
  assert.strictEqual(session.stageState.stages.find((stage) => stage.stage === 'E1').status, 'needs_review');
});

session = observe(session, plan, 'E1', 'tool_result', 'passed', ['tool_observation_recorded']);
session = evaluate(session, plan, 'E1', 'passed', ['tool_observation_recorded']);

check('操作结果与后续读回观察聚合后才推进 E1→R5', () => {
  assert.strictEqual(session.stageState.currentStage, 'R5');
  assert.strictEqual(session.stageState.stages.find((stage) => stage.stage === 'E1').status, 'passed');
});

check('E2 只允许交付类 save_export，不重新开放 Photoshop 设计写入', () => {
  const e2Session = evaluate(
    session,
    plan,
    'R5',
    'passed',
    ['quality_gate_report', 'stage_evaluation']
  );
  assert.strictEqual(e2Session.stageState.currentStage, 'E2');
  const saveGate = runtime.evaluateRuntimeSessionToolExecutionGate({
    session: e2Session,
    toolName: 'saveDocument',
    toolKind: 'save_export'
  });
  const writeGate = runtime.evaluateRuntimeSessionToolExecutionGate({
    session: e2Session,
    toolName: 'createRectangle',
    toolKind: 'photoshop_write'
  });
  assert.strictEqual(saveGate.allowed, true);
  assert.strictEqual(writeGate.allowed, false);
});

session = observe(session, plan, 'E2', 'delivery_result', 'passed', ['user_confirmation_or_delivery_record']);
const passedVerdict = {
  version: 'design-quality-verdict/v0',
  status: 'passed',
  source: 'contract+scorecard',
  contractStatus: 'completed',
  contractFailedRequirementIds: [],
  scorecardGate: 'passed',
  blockers: [],
  warnings: [],
  summary: '质量复核与交付结果完整。'
};
session = runtime.finalizeRuntimeSession({
  session,
  plan,
  executionSummary: { status: 'completed', designVerdict: passedVerdict }
});

check('R5 passed 后才消费 E2 delivery result 并完成本代', () => {
  assert.strictEqual(session.stageState.status, 'completed');
  assert.strictEqual(session.stageState.stages.find((stage) => stage.stage === 'R5').status, 'passed');
  assert.strictEqual(session.stageState.stages.find((stage) => stage.stage === 'E2').status, 'passed');
  assert.strictEqual(session.finalized, true);
});

check('阶段结果完整的 completed Session 不被错误降级', () => {
  const projection = runtime.projectRuntimeSessionCompletion({
    executionStatus: 'completed',
    stageState: session.stageState
  });
  assert.strictEqual(projection.status, 'completed');
  assert.strictEqual(projection.changed, false);
  assert.strictEqual(projection.summaryText, undefined);
  assert.strictEqual(projection.blocker, undefined);
});

let confirmationSession = runtime.createRuntimeSession({
  identity: runtime.createRuntimeSessionIdentity({
    now: '2026-07-13T02:00:00.000Z',
    nonce: 'confirmation',
    skillId: plan.skillId,
    taskType: plan.taskType
  }),
  plan
});
confirmationSession = runtime.finalizeRuntimeSession({
  session: confirmationSession,
  plan,
  executionSummary: { status: 'awaiting_confirmation' }
});

check('普通确认卡只暂停当前 R1，不跳到 E2', () => {
  assert.strictEqual(confirmationSession.stageState.currentStage, 'R1');
  assert.strictEqual(confirmationSession.stageState.status, 'awaiting_confirmation');
  assert.strictEqual(confirmationSession.stageState.stages.find((stage) => stage.stage === 'E2').status, 'unobserved');
});

let earlyReflexionSession = runtime.createRuntimeSession({
  identity: runtime.createRuntimeSessionIdentity({
    now: '2026-07-13T02:30:00.000Z',
    nonce: 'early-reflexion',
    skillId: plan.skillId,
    taskType: plan.taskType
  }),
  plan
});
earlyReflexionSession = evaluate(earlyReflexionSession, plan, 'R1', 'passed', ['required_inputs_checked', 'blocking_inputs_identified']);
earlyReflexionSession = evaluate(earlyReflexionSession, plan, 'R2', 'passed', ['project_context_observed', 'visual_or_readback_observation']);
earlyReflexionSession = evaluate(earlyReflexionSession, plan, 'R3', 'passed', ['design_strategy_recorded', 'stage_goal_defined']);
earlyReflexionSession = evaluate(earlyReflexionSession, plan, 'R4', 'passed', ['preview_or_action_plan', 'stage_output_candidate']);
earlyReflexionSession = runtime.finalizeRuntimeSession({
  session: earlyReflexionSession,
  plan,
  executionSummary: { status: 'failed', blockers: ['执行阶段未完成'] },
  reflexionHandoff: {
    version: 'quality-gate-reflexion-handoff/v0',
    status: 'reflexion_required',
    sourceOwner: 'R5',
    targetStage: 'R4',
    reenterLoop: 'react',
    failureAnalysis: ['执行阶段未完成'],
    strategyAdjustments: ['复核计划后继续'],
    nextRoundConstraints: ['保留现有画面']
  }
});

check('E1 提前失败不能越序伪造 R5 评价', () => {
  assert.strictEqual(earlyReflexionSession.finalized, true);
  assert.strictEqual(earlyReflexionSession.stageState.status, 'active');
  assert.strictEqual(earlyReflexionSession.stageState.currentStage, 'E1');
  assert.strictEqual(earlyReflexionSession.stageState.stages.find((stage) => stage.stage === 'R5').status, 'unobserved');
  assert(!earlyReflexionSession.stageState.issues.some((issue) => issue.includes('out_of_order_stage_observation')));
});

let r1StalledSession = runtime.createRuntimeSession({
  identity: runtime.createRuntimeSessionIdentity({
    now: '2026-07-13T02:45:00.000Z',
    nonce: 'r1-stalled-finalize',
    skillId: plan.skillId,
    taskType: plan.taskType
  }),
  plan
});
r1StalledSession = runtime.finalizeRuntimeSession({
  session: r1StalledSession,
  plan,
  executionSummary: { status: 'failed', blockers: ['设计简报尚未形成'] },
  reflexionHandoff: {
    version: 'quality-gate-reflexion-handoff/v0',
    status: 'reflexion_required',
    sourceOwner: 'R5',
    targetStage: 'R4',
    reenterLoop: 'react',
    failureAnalysis: ['设计简报尚未形成'],
    strategyAdjustments: ['继续完成当前简报'],
    nextRoundConstraints: ['不要跳过 R1']
  }
});

check('R1 停滞收尾保留 R1 且不生成 R5 Trace', () => {
  assert.strictEqual(r1StalledSession.stageState.currentStage, 'R1');
  assert.strictEqual(r1StalledSession.stageState.stages.find((stage) => stage.stage === 'R5').status, 'unobserved');
  assert(!r1StalledSession.stageState.issues.some((issue) => issue.includes('out_of_order_stage_observation')));
});

let failedSession = runtime.createRuntimeSession({
  identity: runtime.createRuntimeSessionIdentity({
    now: '2026-07-13T03:00:00.000Z',
    nonce: 'reflexion',
    skillId: plan.skillId,
    taskType: plan.taskType
  }),
  plan
});
failedSession = advanceToR5(failedSession, plan);
failedSession = runtime.finalizeRuntimeSession({
  session: failedSession,
  plan,
  executionSummary: { status: 'failed', blockers: ['布局未通过'] },
  reflexionHandoff: {
    version: 'quality-gate-reflexion-handoff/v0',
    status: 'reflexion_required',
    sourceOwner: 'R5',
    targetStage: 'R4',
    reenterLoop: 'react',
    failureAnalysis: ['布局未通过'],
    strategyAdjustments: ['重新规划布局'],
    nextRoundConstraints: ['重新声明计划'],
  }
});

const failedNextIdentity = runtime.advanceRuntimeSessionIdentity({
  previous: failedSession.identity,
  now: '2026-07-13T03:00:01.000Z',
  nonce: 'reflexion-next'
});
const nextGeneration = runtime.advanceRuntimeSessionGeneration({
  previous: failedSession,
  identity: failedNextIdentity,
  plan
});

check('Reflexion 新代保留上游 State、失效 R4 下游并保持同 sessionId / 单调 generation', () => {
  assert.strictEqual(nextGeneration.identity.sessionId, failedSession.identity.sessionId);
  assert.strictEqual(nextGeneration.identity.generation, 2);
  assert.strictEqual(nextGeneration.identity.parentRunId, failedSession.identity.runId);
  assert.strictEqual(nextGeneration.stageState.currentStage, 'R4');
  assert.strictEqual(nextGeneration.stageState.stages.find((stage) => stage.stage === 'R3').status, 'passed');
  assert.strictEqual(nextGeneration.stageState.stages.find((stage) => stage.stage === 'R4').status, 'unobserved');
  assert.strictEqual(nextGeneration.stageState.stages.find((stage) => stage.stage === 'R5').status, 'unobserved');
  assert.strictEqual(nextGeneration.finalized, false);
  assert.strictEqual(nextGeneration.stageTrace.events.length, 0);
});

const sessionDigest = runtime.buildRuntimeSessionDigest({ session, plan });
const record = buildAgentRunRecord({
  now: '2026-07-13T01:02:09.000Z',
  goal: '同一任务',
  runtimeSessionIdentity: session.identity,
  result: {
    success: true,
    iterations: 2,
    toolCallLog: [],
    executionSummary: {
      status: 'completed',
      runtimeSessionDigest: sessionDigest,
      runtimeStageState: session.stageState
    }
  }
});

check('Run Record 复用预签发 runId/session/generation，不再收尾另造身份', () => {
  assert.strictEqual(record.runId, session.identity.runId);
  assert.strictEqual(record.runtimeSession.sessionId, session.identity.sessionId);
  assert.strictEqual(record.runtimeSession.generation, session.identity.generation);
  assert.strictEqual(record.boundaries.runtimeSessionDigestOnly, true);
  assert.strictEqual(validateAgentRunRecordForPersist(record).ok, true);
});

check('Run Record 拒绝 Session 与主键不一致', () => {
  const invalid = { ...record, runId: 'run-conflict' };
  assert.strictEqual(validateAgentRunRecordForPersist(invalid).ok, false);
});

const unfinishedRecord = buildAgentRunRecord({
  now: '2026-07-13T01:02:09.000Z',
  goal: '同一任务未完成',
  runtimeSessionIdentity: session.identity,
  result: {
    success: false,
    iterations: 2,
    stopReason: 'max_iterations',
    toolCallLog: [],
    executionSummary: {
      status: 'needs_review',
      runtimeSessionDigest: sessionDigest,
      runtimeStageState: session.stageState
    }
  }
});
const resumeBrief = buildRunRecordResumeBrief({
  records: [unfinishedRecord],
  nowMs: Date.parse('2026-07-13T01:03:09.000Z')
});

check('跨用户轮 Resume 暴露来源身份但明确不自动继承 Session', () => {
  assert.strictEqual(resumeBrief.sourceSessionId, session.identity.sessionId);
  assert.strictEqual(resumeBrief.sourceGeneration, session.identity.generation);
  assert(resumeBrief.brief.includes('不会因档案较新而自动继承'));
});

check('生产 Agent 已退役收尾 Stage State 全量重建', () => {
  const agentSource = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'services', 'agent-runtime', 'agent.ts'), 'utf8');
  const sessionSource = fs.readFileSync(path.join(ROOT, 'src', 'shared', 'agent-runtime-v5', 'runtime-session.ts'), 'utf8');
  assert(!agentSource.includes('buildRuntimeStageStateFromEvaluation'));
  assert(agentSource.includes('finalizeRuntimeSession'));
  assert(agentSource.includes('evaluateRuntimeSessionToolExecutionGate'));
  assert(sessionSource.includes('runtime_session_r4_not_ready'));
});

check('生产 executor 签发身份并跨 Reflexion 推进 generation', () => {
  const source = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'services', 'skill-executors', 'autonomous-agent.executor.ts'), 'utf8');
  assert(source.includes('createRuntimeSessionIdentity'));
  assert(source.includes('advanceRuntimeSessionIdentity'));
  assert(source.includes('advanceRuntimeSessionGeneration'));
  assert(source.includes('runtimeSessionIdentity'));
});

function validStrategy() {
  return {
    stageGoal: '建立清晰焦点并保持可编辑结构。',
    objective: {
      primaryGoal: '让用户快速理解核心信息。',
      secondaryGoals: ['保持真实素材质感'],
      targetAudienceSummary: '需要快速读取信息的目标用户。'
    },
    messageArchitecture: {
      primaryMessage: '核心内容优先。',
      supportingMessages: ['辅助信息不争夺第一层级。'],
      supportingFacts: ['当前文档已读取。'],
      objectionsToResolve: ['主体是否突出']
    },
    copyDirection: {
      toneKeywords: ['清晰'],
      headlineOptions: ['聚焦核心'],
      subtitleOptions: [],
      tagOptions: [],
      prohibitedClaims: ['未经核验的承诺']
    },
    visualDirection: {
      moodKeywords: ['简洁'],
      paletteIntent: ['中性色承载主体。'],
      typographyIntent: ['建立明显层级。'],
      compositionIntent: ['主体承担主要视觉重量。'],
      imageTreatment: ['保护真实纹理。'],
      density: 'medium'
    },
    constraints: ['不改变素材事实。'],
    contextRefs: ['context:user_goal', 'context:opening_observation'],
    assumptions: [],
    missingInputs: []
  };
}

async function runR4ExecutionGateIntegration() {
  let modelCallCount = 0;
  const externalCalls = [];
  const identity = runtime.createRuntimeSessionIdentity({
    now: '2026-07-13T06:00:00.000Z',
    nonce: 'r4-execution-gate',
    skillId: plan.skillId,
    taskType: plan.taskType
  });
  const agent = new Agent(
    {
      systemPrompt: 'Runtime Session R4 gate integration smoke.',
      tools: [{
        name: 'setLayerOpacity',
        description: 'Change layer opacity.',
        inputSchema: {
          type: 'object',
          properties: {
            layerId: { type: 'number' },
            opacity: { type: 'number' }
          },
          required: ['layerId', 'opacity']
        }
      }],
      modelId: 'fixture-model',
      maxIterations: 5,
      runtimeStagePlan: plan,
      runtimeSessionIdentity: identity,
      toolDecisionContext: {
        photoshopConnected: true,
        hasDocument: true
      },
      callbacks: {}
    },
    async () => {
      modelCallCount += 1;
      if (modelCallCount === 1) {
        return {
          content: '先声明任务目标与输入。',
          toolCalls: [{
            id: 'brief',
            name: DECLARE_DESIGN_BRIEF_TOOL_NAME,
            arguments: {
              taskGoal: '调整当前图层并读回复核。',
              deliverables: ['可编辑结果'],
              outputRequirements: ['写入后读回'],
              constraints: ['只改目标图层'],
              inputCoverage: [{
                inputKey: 'goal',
                status: 'provided',
                contextRefs: ['input:goal:user_goal']
              }],
              contextRefs: ['input:goal:user_goal', 'context:skill_manifest']
            }
          }]
        };
      }
      if (modelCallCount === 2) {
        return {
          content: '基于真实观察声明设计策略。',
          toolCalls: [{
            id: 'strategy',
            name: DECLARE_DESIGN_STRATEGY_TOOL_NAME,
            arguments: validStrategy()
          }]
        };
      }
      if (modelCallCount === 3) {
        return {
          content: '现在直接修改目标图层。',
          toolCalls: [{
            id: 'write-before-plan',
            name: 'setLayerOpacity',
            arguments: { layerId: 7, opacity: 80 }
          }]
        };
      }
      return { content: '写入被阻断，本轮停止。', toolCalls: [] };
    },
    async (toolName) => {
      externalCalls.push(toolName);
      if (toolName === 'getAnnotatedSnapshot') {
        return { success: true, elements: [{ id: 7, name: '目标图层' }] };
      }
      if (toolName === 'setLayerOpacity') {
        return { success: true };
      }
      return { success: false, error: 'unexpected tool' };
    }
  );
  const result = await agent.run('调整当前图层，但必须先形成计划。');
  const blockedWrite = result.toolCallLog.find((entry) => entry.name === 'setLayerOpacity');
  return { result, blockedWrite, externalCalls, modelCallCount };
}

runR4ExecutionGateIntegration().then(({ result, blockedWrite, externalCalls, modelCallCount }) => {
  check('生产 Agent 在 R4 前不触达外部 Photoshop 写调用', () => {
    assert(!externalCalls.includes('setLayerOpacity'));
    assert.strictEqual(result.data.runtimeSession.stageState.currentStage, 'R4');
    assert(modelCallCount >= 3);
    if (blockedWrite) {
      assert.strictEqual(blockedWrite.result.code, 'runtime_session_r4_not_ready');
    }
  });
  check('R5/E2 未通过时生产结果不能声明 completed', () => {
    assert.notStrictEqual(result.executionSummary.status, 'completed');
    assert.notStrictEqual(result.data.runtimeSession.stageState.status, 'completed');
  });
  check('R4 停滞不伪造 R5 Reflexion，也不生成越级 evolution intake', () => {
    assert.strictEqual(result.data.runtimeSession.stageState.currentStage, 'R4');
    assert.strictEqual(
      result.data.runtimeSession.stageState.stages.find((stage) => stage.stage === 'R5').status,
      'unobserved'
    );
    assert.strictEqual(result.data.reflexionHandoff, undefined);
    assert.strictEqual(result.data.runtimeEvolutionIntake, undefined);
  });
  console.log(`\n✅ runtime-session smoke 全部通过（${passed} 项）`);
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
