#!/usr/bin/env node

const path = require('path');
const fs = require('fs');
require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '..', 'tsconfig.main.json')
});

const {
  buildAgentReActObservationFromPublicPlanRun,
  buildAgentReActObservationFromSkillResult,
  resolveSkillExecutionOutcome
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'agent-react-observation-contract.ts'));

function assert(condition, message, details) {
  if (!condition) {
    const error = new Error(message);
    error.details = details;
    throw error;
  }
}

const mismatchRun = {
  version: 'agent-task-public-plan-controlled-runner/v0',
  status: 'failed_readback',
  executionTarget: 'live-photoshop',
  blockers: ['画面里暂时没有看到「弹力贴合」。'],
  warnings: [],
  observationDiff: {
    version: 'agent-task-public-plan-observation-diff/v0',
    status: 'mismatch',
    expectedVisibleCopy: ['舒适透气运动袜', '吸汗速干', '弹力贴合'],
    observedVisibleCopy: ['舒适透气运动袜', '吸汗速干'],
    missingVisibleCopy: ['弹力贴合'],
    nextAction: 'repair_missing_visible_copy',
    userVisibleSummary: '画面里暂时没有看到「弹力贴合」。'
  }
};

const completedRun = {
  version: 'agent-task-public-plan-controlled-runner/v0',
  status: 'completed_live_adapter_verified',
  executionTarget: 'live-photoshop',
  blockers: [],
  warnings: [],
  operationResults: [{ operationId: 'op-1', toolName: 'renderLayout', success: true }],
  readbackResults: [{ operationId: 'op-1', toolName: 'getLayerHierarchy', target: 'layer_hierarchy', success: true }]
};

const mismatchObservation = buildAgentReActObservationFromPublicPlanRun(mismatchRun);
assert(mismatchObservation.version === 'agent-react-observation/v0', 'observation contract version should be stable');
assert(mismatchObservation.kind === 'public_plan', 'public plan run should be wrapped as public_plan observation');
assert(mismatchObservation.status === 'needs_repair', 'missing visible copy should require repair, not finish');
assert(mismatchObservation.nextAction === 'repair', 'missing visible copy should route back to repair decision');
assert(
  mismatchObservation.details.some((item) => /弹力贴合/.test(item)),
  'missing visible copy should be preserved as evidence',
  mismatchObservation
);

const completedObservation = buildAgentReActObservationFromPublicPlanRun(completedRun);
assert(completedObservation.status === 'completed', 'verified public plan run should be completed action observation');
assert(completedObservation.nextAction === 'decide_next', 'completed action should still return to main Agent for next decision');

const skillObservation = buildAgentReActObservationFromSkillResult({
  skillId: 'sku-batch',
  result: {
    success: true,
    message: 'SKU 色卡素材已经准备好。',
    data: {
      preserved: true
    }
  }
});
assert(skillObservation.kind === 'skill', 'skill executor result should be wrapped as skill observation');
assert(skillObservation.status === 'needs_decision', 'legacy success only proves execution and must not claim task completion');
assert(skillObservation.nextAction === 'decide_next', 'executed skill should return control to main Agent');
assert(
  skillObservation.details.some((item) => /SKU 色卡素材已经准备好/.test(item)),
  'skill message should become observation evidence'
);
const legacySuccessOutcome = resolveSkillExecutionOutcome({
  success: true,
  message: '执行器没有报错。'
});
assert(legacySuccessOutcome.status === 'executed', 'legacy success true should resolve to executed, never completed');

const runtimeVerifiedOutcome = resolveSkillExecutionOutcome({
  success: true,
  message: '统一 Agent Runtime 已完成并验收。',
  executionSummary: {
    status: 'completed',
    blockers: [],
    warnings: [],
    successfulToolCalls: 3,
    acceptanceVerified: 1
  }
});
assert(runtimeVerifiedOutcome.status === 'completed', 'an evidence-backed Runtime completion may become completed');

const explicitCompletedObservation = buildAgentReActObservationFromSkillResult({
  skillId: 'sku-batch',
  result: {
    success: true,
    message: '全部 SKU 已写入、读回并通过验收。',
    skillOutcome: {
      version: 'skill-execution-outcome/v0',
      status: 'completed',
      summary: '全部 SKU 已写入、读回并通过验收。',
      outputs: ['写后读回 12/12 通过。'],
      blockers: [],
      warnings: [],
      sourceStatus: 'completed_live_verified'
    }
  }
});
assert(explicitCompletedObservation.status === 'completed', 'an explicit completed Skill outcome may become completed observation');
assert(explicitCompletedObservation.details.some((item) => /12\/12/.test(item)), 'explicit completion outputs should be preserved');
const contradictoryCompletedOutcome = resolveSkillExecutionOutcome({
  success: false,
  error: 'write_failed',
  skillOutcome: {
    version: 'skill-execution-outcome/v0',
    status: 'completed',
    summary: '不应采信的完成声明。',
    outputs: [],
    blockers: [],
    warnings: []
  }
});
assert(contradictoryCompletedOutcome.status === 'failed', 'fatal execution evidence must override a contradictory completion claim');

const failedSkillObservation = buildAgentReActObservationFromSkillResult({
  skillId: 'find-edit-element',
  result: {
    success: false,
    message: '候选图层不唯一，需要确认目标。',
    error: 'ambiguous_target'
  }
});
assert(failedSkillObservation.status === 'failed', 'fatal skill result should remain a failed observation');
assert(failedSkillObservation.nextAction === 'decide_next', 'ambiguous skill result should not be treated as final failure');
assert(
  failedSkillObservation.blockers.some((item) => /候选图层不唯一|ambiguous_target/.test(item)),
  'failed skill result should preserve blocker evidence'
);

const continuedSkillObservation = buildAgentReActObservationFromSkillResult({
  skillId: 'sku-color-card',
  result: {
    success: true,
    message: 'SKU 色卡结构草稿已生成。',
    data: {
      agentReActContinuation: {
        status: 'needs_decision',
        summary: '需要先看图调整商品主体大小与裁切。',
        details: ['已取得写后快照。'],
        warnings: ['固定 contain 不是最终设计。'],
        nextAction: 'decide_next',
        sourceStatus: 'structure_ready'
      }
    }
  }
});
assert(continuedSkillObservation.status === 'needs_decision', 'skill continuation should override successful action completion');
assert(continuedSkillObservation.summary.includes('调整商品主体'), 'skill continuation summary should reach the next Agent iteration');
assert(continuedSkillObservation.warnings.some((item) => item.includes('不是最终设计')), 'skill continuation warnings should be preserved');
assert(continuedSkillObservation.sourceStatus === 'structure_ready', 'skill continuation source status should remain auditable');

const awaitingConfirmationObservation = buildAgentReActObservationFromSkillResult({
  skillId: 'sku-batch',
  result: {
    success: true,
    message: '组合已经生成，等待用户确认。',
    data: {
      status: 'pending_user_confirmation'
    }
  }
});
assert(awaitingConfirmationObservation.status === 'blocked', 'pending confirmation should not be treated as completion');
assert(awaitingConfirmationObservation.nextAction === 'ask_user', 'pending confirmation should route to user confirmation');

const engineSource = fs.readFileSync(
  path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'design-agent', 'engine.ts'),
  'utf8'
);
const skillToolsSource = fs.readFileSync(
  path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'skill-executors', 'skill-tools.ts'),
  'utf8'
);
const skillRegistrySource = fs.readFileSync(
  path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'skill-executors', 'registry.ts'),
  'utf8'
);
assert(
  engineSource.includes('buildAgentReActObservationFromPublicPlanRun'),
  'design engine should wrap public plan execution as ReAct observation'
);
assert(
  engineSource.includes('buildAgentReActObservationFromSkillResult'),
  'design engine should wrap deterministic skill execution as ReAct observation'
);
assert(
  engineSource.includes('agentReActObservation'),
  'design engine should attach ReAct observation to AgentResult data'
);
assert(
  skillToolsSource.includes('buildAgentReActObservationFromSkillResult'),
  'skill tools exposed inside autonomous loop should wrap skill results as ReAct observations'
);
assert(
  skillToolsSource.includes('agentReActObservation'),
  'workflow bridge results should expose ReAct observation to the next model iteration'
);
assert(
  skillRegistrySource.includes('resolveSkillExecutionOutcome'),
  'unified skill registry should attach the structured outcome truth'
);
assert(
  !skillRegistrySource.includes("result.success ? '能力完成'"),
  'registry must not display legacy success true as skill completion'
);

console.log(JSON.stringify({
  success: true,
  checks: [
    'public plan mismatch becomes repair observation',
    'public plan completion returns to main Agent decision',
    'legacy skill success remains executed and returns to main Agent decision',
    'explicit Skill outcome or verified Runtime summary can claim completed',
    'fatal execution evidence rejects contradictory completion claim',
    'skill failure preserves blocker evidence',
    'skill continuation keeps structure draft in Agent decision loop',
    'pending skill confirmation routes to ask user',
    'registry no longer derives completion from success boolean',
    'design engine attaches observations to execution results',
    'autonomous loop skill tools attach observations to tool results'
  ]
}, null, 2));
