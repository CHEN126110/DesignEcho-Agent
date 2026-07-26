#!/usr/bin/env node

const path = require('path');

require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '..', 'tsconfig.main.json')
});

const {
  buildAgentRequestLifecycle
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'agent-request-lifecycle.ts'));
const {
  buildAgentResumableTaskContract
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'agent-resumable-task-contract.ts'));
const {
  buildAgentResumeExecutionPolicy
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'agent-resume-execution-policy.ts'));
const {
  buildAgentResumeContextGate,
  buildAgentResumeContextRefreshRun,
  runAgentResumeReadonlyContextExecutor
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'agent-resume-context-pipeline.ts'));
const {
  buildAgentResumePlanningResult
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'agent-resume-planning.ts'));
const {
  buildAgentResumeExecutionGate
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'agent-resume-execution-gate.ts'));
const {
  buildAgentResumeControlledExecutionRequest,
  runAgentResumeControlledExecutionRunner
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'agent-resume-controlled-execution.ts'));
const { DesignAgentEngine } = require(path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'design-agent', 'engine.ts'));

function assert(condition, message, details) {
  if (!condition) {
    const suffix = details ? `\n${JSON.stringify(details, null, 2)}` : '';
    throw new Error(`${message}${suffix}`);
  }
}

function makeLifecycle(overrides = {}) {
  return buildAgentRequestLifecycle({
    userInput: overrides.userInput || '帮我把图层从浅到深排序',
    context: {
      isPluginConnected: overrides.isPluginConnected !== false,
      photoshopContext: {
        hasDocument: overrides.hasDocument !== false,
        documentName: 'C-1141.psd',
        layerCount: 4
      }
    },
    routeSource: overrides.routeSource || 'deterministic_route',
    route: overrides.route || 'skill_execution',
    skillId: Object.prototype.hasOwnProperty.call(overrides, 'skillId') ? overrides.skillId : 'layer-management',
    executionKind: overrides.executionKind || 'deterministic_skill',
    reason: '测试用 lifecycle 记录。',
    blockers: overrides.blockers || []
  });
}

function assertBoundary(contract) {
  assert(contract.contextOnly === true, 'contract must be context-only', contract);
  assert(contract.mustNotRunProvider === true, 'contract must not run provider', contract);
  assert(contract.mustNotRunPhotoshop === true, 'contract must not run Photoshop', contract);
  assert(contract.mustNotClaimTaskCompletion === true, 'contract must not claim task completion', contract);
  assert(contract.requiresModelReconfirmation === true, 'contract must require model reconfirmation', contract);
}

function assertPolicyBoundary(policy) {
  assert(policy.controlContextOnly === true, 'policy must be control-context only', policy);
  assert(policy.writesPerformed === false, 'policy must not perform writes', policy);
  assert(policy.shouldAutoExecute === false, 'policy must not auto execute', policy);
  assert(policy.shouldRunPhotoshop === false, 'policy must not run Photoshop', policy);
  assert(policy.mustNotClaimTaskCompletion === true, 'policy must not claim task completion', policy);
}

function assertContextGateBoundary(gate) {
  assert(gate.controlContextOnly === true, 'context gate must be control-context only', gate);
  assert(gate.writesPerformed === false, 'context gate must not perform writes', gate);
  assert(gate.mustNotRunWriteTools === true, 'context gate must not run write tools', gate);
  assert(gate.mustNotClaimTaskCompletion === true, 'context gate must not claim completion', gate);
}

function assertRefreshRunBoundary(run) {
  assert(run.controlContextOnly === true, 'context refresh run must be control-context only', run);
  assert(run.writesPerformed === false, 'context refresh run must not perform writes', run);
  assert(run.rawPayloadRedacted === true, 'context refresh run must redact raw payloads', run);
  assert(run.mustNotRunWriteTools === true, 'context refresh run must not run write tools', run);
  assert(run.mustNotClaimTaskCompletion === true, 'context refresh run must not claim completion', run);
}

function assertReadonlyExecutorBoundary(result) {
  assert(result.controlContextOnly === true, 'readonly executor must be control-context only', result);
  assert(result.writesPerformed === false, 'readonly executor must not perform writes', result);
  assert(result.rawPayloadRedacted === true, 'readonly executor must mark raw payloads as redacted', result);
  assert(result.mustNotRunWriteTools === true, 'readonly executor must not run write tools', result);
  assert(result.mustNotClaimTaskCompletion === true, 'readonly executor must not claim completion', result);
}

function assertResumePlanningBoundary(result) {
  assert(result.controlContextOnly === true, 'resume planning must be control-context only', result);
  assert(result.writesPerformed === false, 'resume planning must not perform writes', result);
  assert(result.rawPayloadRedacted === true, 'resume planning must mark raw payloads as redacted', result);
  assert(result.shouldRunPhotoshop === false, 'resume planning must not run Photoshop', result);
  assert(result.mustNotRunWriteTools === true, 'resume planning must not run write tools', result);
  assert(result.mustNotClaimTaskCompletion === true, 'resume planning must not claim completion', result);
  assert(result.requiresExplicitExecutionApproval === true, 'resume planning must require explicit execution approval', result);
}

function assertResumeExecutionGateBoundary(result) {
  assert(result.writesPerformed === false, 'resume execution gate must not perform writes', result);
  assert(result.rawPayloadRedacted === true, 'resume execution gate must mark raw payloads as redacted', result);
  assert(result.shouldRunPhotoshop === false, 'resume execution gate must not run Photoshop itself', result);
  assert(result.mustNotRunWriteTools === true, 'resume execution gate must not run write tools itself', result);
  assert(result.mustNotClaimTaskCompletion === true, 'resume execution gate must not claim completion', result);
  assert(result.requiresExplicitUserApproval === true, 'resume execution gate must require explicit user approval', result);
  assert(result.requiresWriteToolWhitelist === true, 'resume execution gate must require a write tool whitelist', result);
  assert(result.requiresReadbackTargets === true, 'resume execution gate must require readback targets', result);
}

function assertControlledExecutionRequestBoundary(result) {
  assert(result.writesPerformed === false, 'controlled execution request must not perform writes', result);
  assert(result.rawPayloadRedacted === true, 'controlled execution request must mark raw payloads as redacted', result);
  assert(result.shouldRunPhotoshop === false, 'controlled execution request must not run Photoshop itself', result);
  assert(result.mustNotRunWriteTools === true, 'controlled execution request must not run write tools itself', result);
  assert(result.mustNotClaimTaskCompletion === true, 'controlled execution request must not claim completion', result);
  assert(result.requiresControlledRunner === true, 'controlled execution request must require a controlled runner', result);
  assert(result.requiresReadbackAfterEachWrite === true, 'controlled execution request must require readback after each write', result);
}

function assertControlledExecutionRunnerBoundary(result) {
  assert(result.writesPerformed === false, 'controlled execution runner must not perform writes by default', result);
  assert(result.verificationStatus === 'not_run', 'controlled execution runner must not report verification by default', result);
  assert(result.rawPayloadRedacted === true, 'controlled execution runner must mark raw payloads as redacted', result);
  assert(result.shouldRunPhotoshop === false, 'controlled execution runner must not run Photoshop by default', result);
  assert(result.mustNotClaimTaskCompletion === true, 'controlled execution runner must not claim completion', result);
  assert(result.executedWriteTools.length === 0, 'controlled execution runner must not record write execution by default', result);
}

function assertControlledExecutionFakeRunnerBoundary(result) {
  assert(result.writesPerformed === false, 'controlled fake runner must not report real Photoshop writes', result);
  assert(result.rawPayloadRedacted === true, 'controlled fake runner must mark raw payloads as redacted', result);
  assert(result.shouldRunPhotoshop === false, 'controlled fake runner must not run Photoshop', result);
  assert(result.mustNotRunWriteTools === true, 'controlled fake runner must not run real Photoshop write tools', result);
  assert(result.mustNotClaimTaskCompletion === true, 'controlled fake runner must not claim completion', result);
  assert(result.executionTarget === 'fake-adapter', 'controlled fake runner must expose fake adapter target', result);
  assert(result.fakeAdapterOnly === true, 'controlled fake runner must remain fake-adapter only', result);
}

function assertControlledExecutionLiveRunnerBoundary(result) {
  assert(result.writesPerformed === true, 'controlled live runner must report live writes after adapter execution', result);
  assert(result.executionState === 'completed', 'controlled live runner must report completed execution', result);
  assert(result.verificationStatus === 'passed', 'controlled live runner must report passed readback verification', result);
  assert(result.rawPayloadRedacted === true, 'controlled live runner must mark raw payloads as redacted', result);
  assert(result.shouldRunPhotoshop === true, 'controlled live runner must expose Photoshop execution only after explicit authorization', result);
  assert(result.mustNotRunWriteTools === false, 'controlled live runner should allow writes only through the injected adapter', result);
  assert(result.mustNotClaimTaskCompletion === true, 'controlled live runner must not claim completion', result);
  assert(result.executionTarget === 'live-photoshop', 'controlled live runner must expose live target', result);
  assert(result.fakeAdapterOnly === false, 'controlled live runner must not be marked fake-adapter only', result);
}

const notRequested = buildAgentResumableTaskContract({
  userInput: '你好',
  conversationHistory: []
});
assert(notRequested.status === 'not_requested', 'non-continuation should not request resume', notRequested);
assert(notRequested.canResumeExecution === false, 'non-continuation cannot resume', notRequested);
assertBoundary(notRequested);
const notRequestedPolicy = buildAgentResumeExecutionPolicy(notRequested);
assert(notRequestedPolicy.action === 'ignore', 'non-continuation policy should ignore resume', notRequestedPolicy);
assertPolicyBoundary(notRequestedPolicy);

const noHistory = buildAgentResumableTaskContract({
  userInput: '继续',
  conversationHistory: []
});
assert(noHistory.status === 'blocked_no_history', 'continuation without history should block', noHistory);
assert(noHistory.canResumeExecution === false, 'no-history continuation cannot resume', noHistory);
assertBoundary(noHistory);
const noHistoryPolicy = buildAgentResumeExecutionPolicy(noHistory);
assert(noHistoryPolicy.action === 'block_and_explain', 'no-history policy should block and explain', noHistoryPolicy);
assert(noHistoryPolicy.requiresUserClarification === true, 'no-history policy should require clarification', noHistoryPolicy);
assertPolicyBoundary(noHistoryPolicy);

const noStructuredLifecycle = buildAgentResumableTaskContract({
  userInput: '继续下一项',
  conversationHistory: [
    { role: 'user', content: '先做意图边界收口' },
    { role: 'assistant', content: '已完成一部分。' }
  ]
});
assert(noStructuredLifecycle.status === 'ready_for_model_contextual_reply', 'missing lifecycle should only allow contextual reply', noStructuredLifecycle);
assert(noStructuredLifecycle.canResumeExecution === false, 'missing lifecycle cannot resume execution', noStructuredLifecycle);
assertBoundary(noStructuredLifecycle);
const noStructuredLifecyclePolicy = buildAgentResumeExecutionPolicy(noStructuredLifecycle);
assert(noStructuredLifecyclePolicy.action === 'reply_with_context', 'missing lifecycle policy should allow contextual reply only', noStructuredLifecyclePolicy);
assert(noStructuredLifecyclePolicy.mayCallModelForUserReply === true, 'missing lifecycle policy may call model for reply', noStructuredLifecyclePolicy);
assertPolicyBoundary(noStructuredLifecyclePolicy);
const noStructuredLifecycleGate = buildAgentResumeContextGate({
  policy: noStructuredLifecyclePolicy,
  photoshopConnected: true,
  hasDocument: true
});
assert(noStructuredLifecycleGate.status === 'blocked_policy_not_resumable', 'non-resumable policy should block context gate', noStructuredLifecycleGate);
assertContextGateBoundary(noStructuredLifecycleGate);
const noStructuredLifecycleRefreshRun = buildAgentResumeContextRefreshRun({ gate: noStructuredLifecycleGate });
assert(noStructuredLifecycleRefreshRun.status === 'blocked_gate_not_refreshable', 'non-resumable gate should block refresh runner', noStructuredLifecycleRefreshRun);
assertRefreshRunBoundary(noStructuredLifecycleRefreshRun);

const directResponse = buildAgentResumableTaskContract({
  userInput: '继续',
  conversationHistory: [
    { role: 'user', content: '你是什么模型？' },
    {
      role: 'assistant',
      content: '我是 DesignEcho。',
      metadata: {
        agentRequestLifecycle: makeLifecycle({
          userInput: '你是什么模型？',
          routeSource: 'lightweight_intent',
          route: 'direct_response',
          skillId: undefined,
          executionKind: 'none'
        })
      }
    }
  ]
});
assert(directResponse.status === 'blocked_last_turn_not_executable', 'direct response should not resume as execution', directResponse);
assertBoundary(directResponse);
const directResponsePolicy = buildAgentResumeExecutionPolicy(directResponse);
assert(directResponsePolicy.action === 'block_and_explain', 'direct response policy should block execution resume', directResponsePolicy);
assertPolicyBoundary(directResponsePolicy);

const completedSkill = buildAgentResumableTaskContract({
  userInput: '继续',
  conversationHistory: [
    { role: 'user', content: '帮我关闭文档不保存' },
    {
      role: 'assistant',
      content: '已关闭。',
      metadata: {
        agentRequestLifecycle: makeLifecycle({
          userInput: '帮我关闭文档不保存',
          skillId: 'document-management'
        }),
        executionSummary: { status: 'completed' }
      }
    }
  ]
});
assert(completedSkill.status === 'blocked_last_turn_completed', 'completed skill should not blindly continue', completedSkill);
assertBoundary(completedSkill);
const completedSkillPolicy = buildAgentResumeExecutionPolicy(completedSkill);
assert(completedSkillPolicy.action === 'block_and_explain', 'completed skill policy should block resume', completedSkillPolicy);
assert(completedSkillPolicy.requiresUserClarification === true, 'completed skill policy should require new target', completedSkillPolicy);
assertPolicyBoundary(completedSkillPolicy);

const failedSkill = buildAgentResumableTaskContract({
  userInput: '继续',
  conversationHistory: [
    { role: 'user', content: '帮我做 SKU' },
    {
      role: 'assistant',
      content: '执行失败。',
      success: false,
      metadata: {
        agentRequestLifecycle: makeLifecycle({
          userInput: '帮我做 SKU',
          skillId: 'sku-batch'
        }),
        executionSummary: { status: 'failed' }
      }
    }
  ]
});
assert(failedSkill.status === 'blocked_last_turn_failed', 'failed skill should require recovery planning', failedSkill);
assertBoundary(failedSkill);
const failedSkillPolicy = buildAgentResumeExecutionPolicy(failedSkill);
assert(failedSkillPolicy.action === 'block_and_explain', 'failed skill policy should block and explain', failedSkillPolicy);
assert(failedSkillPolicy.requiresExplicitExecutionPlan === true, 'failed skill policy should require recovery plan', failedSkillPolicy);
assertPolicyBoundary(failedSkillPolicy);

const resumableCandidate = buildAgentResumableTaskContract({
  userInput: '继续',
  conversationHistory: [
    { role: 'user', content: '把图层从浅到深排序' },
    {
      role: 'assistant',
      content: '读取了图层结构，还没有完成排序。',
      metadata: {
        agentRequestLifecycle: makeLifecycle({
          userInput: '把图层从浅到深排序',
          skillId: 'layer-management'
        })
      }
    }
  ]
});
assert(resumableCandidate.status === 'candidate_for_execution_resume', 'unfinished executable lifecycle should be resume candidate', resumableCandidate);
assert(resumableCandidate.canResumeExecution === true, 'candidate should allow resume decision', resumableCandidate);
assert(resumableCandidate.previousSkillId === 'layer-management', 'candidate should preserve skill id', resumableCandidate);
assertBoundary(resumableCandidate);
const resumableCandidatePolicy = buildAgentResumeExecutionPolicy(resumableCandidate);
assert(resumableCandidatePolicy.action === 'resume_candidate_needs_model_decision', 'candidate policy should require model decision', resumableCandidatePolicy);
assert(resumableCandidatePolicy.requiresFreshPhotoshopContext === true, 'candidate policy should require fresh Photoshop context', resumableCandidatePolicy);
assert(resumableCandidatePolicy.requiresExplicitExecutionPlan === true, 'candidate policy should require explicit execution plan', resumableCandidatePolicy);
assertPolicyBoundary(resumableCandidatePolicy);
const disconnectedGate = buildAgentResumeContextGate({
  policy: resumableCandidatePolicy,
  photoshopConnected: false,
  hasDocument: true
});
assert(disconnectedGate.status === 'blocked_missing_photoshop_connection', 'disconnected context should block resume gate', disconnectedGate);
assertContextGateBoundary(disconnectedGate);
const missingDocumentGate = buildAgentResumeContextGate({
  policy: resumableCandidatePolicy,
  photoshopConnected: true,
  hasDocument: false
});
assert(missingDocumentGate.status === 'blocked_missing_document', 'missing document should block resume gate', missingDocumentGate);
assertContextGateBoundary(missingDocumentGate);
const refreshGate = buildAgentResumeContextGate({
  policy: resumableCandidatePolicy,
  photoshopConnected: true,
  hasDocument: true,
  hasProject: true,
  hasFreshPhotoshopSnapshot: false,
  hasFreshProjectSnapshot: false
});
assert(refreshGate.status === 'ready_for_readonly_context_refresh', 'candidate should request readonly refresh before planning', refreshGate);
assert(refreshGate.canRequestReadOnlyRefresh === true, 'refresh gate should allow readonly refresh request', refreshGate);
assert(refreshGate.requiredObservations.includes('document_snapshot'), 'refresh gate should require document snapshot observation', refreshGate);
assertContextGateBoundary(refreshGate);
const waitingRefreshRun = buildAgentResumeContextRefreshRun({ gate: refreshGate });
assert(waitingRefreshRun.status === 'waiting_for_readonly_observations', 'refresh runner should wait when no readonly observations exist', waitingRefreshRun);
assert(waitingRefreshRun.canRequestReadOnlyRefresh === true, 'refresh runner should expose readonly refresh request ability', waitingRefreshRun);
assert(waitingRefreshRun.allowedReadOnlyTools.includes('getDocumentSnapshot'), 'refresh runner should expose readonly document snapshot tool', waitingRefreshRun);
assert(waitingRefreshRun.missingObservations.includes('document_snapshot'), 'refresh runner should list missing document snapshot observation', waitingRefreshRun);
assertRefreshRunBoundary(waitingRefreshRun);
const partialRefreshRun = buildAgentResumeContextRefreshRun({
  gate: refreshGate,
  context: {
    documentInfo: { name: 'C-1141.psd' },
    documentSnapshot: { layerCount: 4 }
  }
});
assert(partialRefreshRun.status === 'partial_readonly_observations', 'refresh runner should reject partial readonly observations', partialRefreshRun);
assert(partialRefreshRun.receivedObservations.includes('document_info'), 'partial refresh run should record received observations', partialRefreshRun);
assert(partialRefreshRun.missingObservations.includes('layer_hierarchy'), 'partial refresh run should record missing layer hierarchy observation', partialRefreshRun);
assert(partialRefreshRun.canEnterResumePlanning === false, 'partial refresh run must not enter planning', partialRefreshRun);
assertRefreshRunBoundary(partialRefreshRun);
const completeRefreshRun = buildAgentResumeContextRefreshRun({
  gate: refreshGate,
  context: {
    documentInfo: { name: 'C-1141.psd' },
    documentSnapshot: { layerCount: 4 },
    layerHierarchy: [{ id: 1, name: '深色' }],
    acceptanceSnapshot: { hasDocument: true },
    projectContextSnapshot: { projectPath: 'C:\\Project\\C-1141' }
  }
});
assert(completeRefreshRun.status === 'fresh_context_ready', 'complete readonly context should prepare resume planning', completeRefreshRun);
assert(completeRefreshRun.canEnterResumePlanning === true, 'complete readonly context should allow resume planning', completeRefreshRun);
assert(completeRefreshRun.mustNotRunWriteTools === true, 'complete readonly context still must not write tools', completeRefreshRun);
assertRefreshRunBoundary(completeRefreshRun);
const planningGate = buildAgentResumeContextGate({
  policy: resumableCandidatePolicy,
  photoshopConnected: true,
  hasDocument: true,
  hasProject: true,
  hasFreshPhotoshopSnapshot: true,
  hasFreshProjectSnapshot: true
});
assert(planningGate.status === 'ready_for_resume_planning', 'fresh context should allow resume planning', planningGate);
assert(planningGate.canEnterResumePlanning === true, 'fresh context should enter resume planning', planningGate);
assertContextGateBoundary(planningGate);
const planningRefreshRun = buildAgentResumeContextRefreshRun({ gate: planningGate });
assert(planningRefreshRun.status === 'fresh_context_ready', 'planning gate should map to fresh context runner status', planningRefreshRun);
assert(planningRefreshRun.canEnterResumePlanning === true, 'planning gate runner should allow resume planning', planningRefreshRun);
assertRefreshRunBoundary(planningRefreshRun);

const waitingResumePlanning = buildAgentResumePlanningResult({
  contract: resumableCandidate,
  policy: resumableCandidatePolicy,
  gate: planningGate,
  refreshRun: planningRefreshRun
});
const noPlanExecutionGate = buildAgentResumeExecutionGate({
  planning: waitingResumePlanning
});
assert(noPlanExecutionGate.version === 'agent-resume-execution-gate/v0', 'resume execution gate should expose a stable version', noPlanExecutionGate);
assert(noPlanExecutionGate.status === 'blocked_resume_plan_not_available', 'execution gate should block until a model resume plan exists', noPlanExecutionGate);
assert(noPlanExecutionGate.canDispatchWriteTools === false, 'execution gate must not dispatch write tools without a model plan', noPlanExecutionGate);
assertResumeExecutionGateBoundary(noPlanExecutionGate);

const nonExecutableResumePlanning = buildAgentResumePlanningResult({
  contract: resumableCandidate,
  policy: resumableCandidatePolicy,
  gate: planningGate,
  refreshRun: planningRefreshRun,
  modelPlanText: JSON.stringify({
    planSummary: '基于最新只读上下文重新规划。',
    readonlyFindings: ['当前文档存在', '图层层级已读取'],
    nextAction: '生成可审查执行计划',
    photoshopWritesAllowed: false
  })
});
const nonExecutableGate = buildAgentResumeExecutionGate({
  planning: nonExecutableResumePlanning
});
assert(nonExecutableGate.status === 'blocked_missing_executable_resume_plan', 'execution gate should block model plans without explicit executable plan', nonExecutableGate);
assert(nonExecutableGate.canDispatchWriteTools === false, 'non-executable model plan must not dispatch write tools', nonExecutableGate);
assertResumeExecutionGateBoundary(nonExecutableGate);

const executableResumePlanPayload = {
  planSummary: '基于最新只读上下文恢复图层排序。',
  readonlyFindings: ['当前文档存在', '图层层级已读取'],
  nextAction: '等待用户确认后执行可审查写入计划',
  photoshopWritesAllowed: false,
  proposedExecutionPlan: {
    objective: '把颜色图层从浅到深排序。',
    steps: [
      {
        toolName: 'reorderLayer',
        params: { layerIds: [101, 103, 102], order: 'light-to-dark' },
        paramsSummary: '按只读层级中确认的目标图层 id 调整堆叠顺序。'
      }
    ],
    writeToolWhitelist: ['reorderLayer'],
    readbackTargets: ['getLayerHierarchy', 'getAcceptanceSnapshot'],
    requiresUserApproval: true
  }
};
const executableResumePlanning = buildAgentResumePlanningResult({
  contract: resumableCandidate,
  policy: resumableCandidatePolicy,
  gate: planningGate,
  refreshRun: planningRefreshRun,
  modelPlanText: JSON.stringify(executableResumePlanPayload)
});
const pendingApprovalGate = buildAgentResumeExecutionGate({
  planning: executableResumePlanning,
  allowedWriteTools: ['reorderLayer']
});
assert(pendingApprovalGate.status === 'blocked_pending_user_approval', 'execution gate should block valid plans until explicit user approval', pendingApprovalGate);
assert(pendingApprovalGate.proposedWriteTools.includes('reorderLayer'), 'execution gate should expose proposed whitelisted write tools', pendingApprovalGate);
assert(pendingApprovalGate.readbackTargets.includes('getAcceptanceSnapshot'), 'execution gate should expose required readback targets', pendingApprovalGate);
assert(pendingApprovalGate.canDispatchWriteTools === false, 'pending user approval must not dispatch write tools', pendingApprovalGate);
assertResumeExecutionGateBoundary(pendingApprovalGate);

const approvedExecutionGate = buildAgentResumeExecutionGate({
  planning: executableResumePlanning,
  allowedWriteTools: ['reorderLayer'],
  userApprovedExecution: true
});
assert(approvedExecutionGate.status === 'ready_for_approved_execution', 'execution gate should become ready only after explicit user approval and whitelist validation', approvedExecutionGate);
assert(approvedExecutionGate.canDispatchWriteTools === true, 'approved execution gate can create an approved write dispatch request', approvedExecutionGate);
assertResumeExecutionGateBoundary(approvedExecutionGate);

const blockedControlledRequest = buildAgentResumeControlledExecutionRequest({
  executionGate: pendingApprovalGate
});
assert(blockedControlledRequest.version === 'agent-resume-controlled-execution-request/v0', 'controlled execution request should expose a stable version', blockedControlledRequest);
assert(blockedControlledRequest.status === 'blocked_execution_gate_not_ready', 'controlled request should block until the execution gate is approved', blockedControlledRequest);
assert(blockedControlledRequest.canStartControlledRunner === false, 'blocked controlled request must not start a runner', blockedControlledRequest);
assertControlledExecutionRequestBoundary(blockedControlledRequest);

const disabledControlledRequest = buildAgentResumeControlledExecutionRequest({
  executionGate: approvedExecutionGate
});
assert(disabledControlledRequest.status === 'blocked_execution_disabled', 'controlled request should stay disabled by default even after gate approval', disabledControlledRequest);
assert(disabledControlledRequest.canStartControlledRunner === false, 'disabled controlled request must not start a runner', disabledControlledRequest);
assertControlledExecutionRequestBoundary(disabledControlledRequest);

const readyControlledRequest = buildAgentResumeControlledExecutionRequest({
  executionGate: approvedExecutionGate,
  enableControlledExecutionRequest: true
});
assert(readyControlledRequest.status === 'ready_for_controlled_runner', 'controlled request should become ready only after explicit request packaging opt-in', readyControlledRequest);
assert(readyControlledRequest.canStartControlledRunner === true, 'ready controlled request can start a dry-run controlled runner', readyControlledRequest);
assert(readyControlledRequest.operationRequests.length === 1, 'controlled request should package planned operation requests', readyControlledRequest);
assert(readyControlledRequest.operationRequests[0].toolName === 'reorderLayer', 'controlled request should preserve the approved write tool name', readyControlledRequest);
assert(readyControlledRequest.readbackTargets.includes('getAcceptanceSnapshot'), 'controlled request should preserve readback targets', readyControlledRequest);
assertControlledExecutionRequestBoundary(readyControlledRequest);

const blockedControlledRun = runAgentResumeControlledExecutionRunner({
  request: disabledControlledRequest
});
assert(blockedControlledRun.status === 'blocked_request_not_ready', 'controlled runner should block non-ready requests', blockedControlledRun);
assert(blockedControlledRun.plannedWriteTools.includes('reorderLayer'), 'blocked runner should preserve planned write tools for diagnostics', blockedControlledRun);
assertControlledExecutionRunnerBoundary(blockedControlledRun);

const dryRunControlledRun = runAgentResumeControlledExecutionRunner({
  request: readyControlledRequest
});
assert(dryRunControlledRun.version === 'agent-resume-controlled-execution-runner/v0', 'controlled runner should expose a stable version', dryRunControlledRun);
assert(dryRunControlledRun.status === 'completed_dry_run', 'controlled runner should default to a dry-run package without Photoshop writes', dryRunControlledRun);
assert(dryRunControlledRun.shouldRunPhotoshop === false, 'dry-run controlled runner must not run Photoshop', dryRunControlledRun);
assert(dryRunControlledRun.mustNotRunWriteTools === true, 'dry-run controlled runner must not run write tools', dryRunControlledRun);
assert(dryRunControlledRun.readbackTargets.includes('getLayerHierarchy'), 'dry-run controlled runner should carry readback targets', dryRunControlledRun);
assertControlledExecutionRunnerBoundary(dryRunControlledRun);

const missingFakeAdapterRun = runAgentResumeControlledExecutionRunner({
  request: readyControlledRequest,
  executionTarget: 'fake-adapter'
});
assert(missingFakeAdapterRun.status === 'blocked_adapter_required', 'fake controlled runner should require an injected adapter', missingFakeAdapterRun);
assert(missingFakeAdapterRun.executedWriteTools.length === 0, 'missing adapter must not execute operation requests', missingFakeAdapterRun);
assertControlledExecutionFakeRunnerBoundary(missingFakeAdapterRun);

const fakeAdapter = {
  calls: [],
  readbacks: [],
  runWriteOperation: (operation) => {
    fakeAdapter.calls.push(operation);
    return { success: true, data: { operationId: operation.operationId, fakeLayerOrder: [101, 103, 102] } };
  },
  readbackAfterOperation: (operation, target) => {
    fakeAdapter.readbacks.push({ operation, target });
    return { success: true, data: { target, operationId: operation.operationId, fake: true } };
  }
};
const fakeAdapterRun = runAgentResumeControlledExecutionRunner({
  request: readyControlledRequest,
  executionTarget: 'fake-adapter',
  adapter: fakeAdapter
});
assert(fakeAdapterRun.status === 'completed_fake_adapter_verified', 'fake controlled runner should execute operation requests and readbacks', fakeAdapterRun);
assert(fakeAdapter.calls.length === 1, 'fake adapter should receive the planned operation exactly once', fakeAdapter.calls);
assert(fakeAdapter.readbacks.length === readyControlledRequest.readbackTargets.length, 'fake runner should read back every requested target after the operation', fakeAdapter.readbacks);
assert(fakeAdapterRun.executedWriteTools.join(',') === 'reorderLayer', 'fake runner should record attempted fake write tools', fakeAdapterRun);
assert(fakeAdapterRun.operationResults.length === 1 && fakeAdapterRun.operationResults[0].success === true, 'fake runner should record operation result details', fakeAdapterRun);
assert(fakeAdapterRun.readbackResults.length === 2 && fakeAdapterRun.readbackResults.every((item) => item.success === true), 'fake runner should record per-target readback results', fakeAdapterRun);
assert(fakeAdapterRun.executionState === 'completed', 'completed fake runner must report completed execution', fakeAdapterRun);
assert(fakeAdapterRun.verificationStatus === 'passed', 'completed fake runner must report passed readback verification', fakeAdapterRun);
assertControlledExecutionFakeRunnerBoundary(fakeAdapterRun);

const failingFakeAdapterRun = runAgentResumeControlledExecutionRunner({
  request: readyControlledRequest,
  executionTarget: 'fake-adapter',
  adapter: {
    runWriteOperation: () => ({ success: false, error: 'fake reorder failed' }),
    readbackAfterOperation: () => ({ success: true })
  }
});
assert(failingFakeAdapterRun.status === 'failed_write_operation', 'fake controlled runner should stop on write operation failure', failingFakeAdapterRun);
assert(String(failingFakeAdapterRun.operationResults[0]?.error || '').includes('fake reorder failed'), 'fake controlled runner should preserve write failure reason', failingFakeAdapterRun);
assert(failingFakeAdapterRun.readbackResults.length === 0, 'fake controlled runner should not read back after failed write operation', failingFakeAdapterRun);
assertControlledExecutionFakeRunnerBoundary(failingFakeAdapterRun);

const missingReadbackFakeAdapterRun = runAgentResumeControlledExecutionRunner({
  request: readyControlledRequest,
  executionTarget: 'fake-adapter',
  adapter: {
    runWriteOperation: () => ({ success: true })
  }
});
assert(missingReadbackFakeAdapterRun.status === 'blocked_readback_adapter_required', 'fake controlled runner should require readback adapter before fake writes', missingReadbackFakeAdapterRun);
assert(missingReadbackFakeAdapterRun.executedWriteTools.length === 0, 'missing readback adapter must block before fake writes', missingReadbackFakeAdapterRun);
assertControlledExecutionFakeRunnerBoundary(missingReadbackFakeAdapterRun);

const failingReadbackFakeAdapterRun = runAgentResumeControlledExecutionRunner({
  request: readyControlledRequest,
  executionTarget: 'fake-adapter',
  adapter: {
    runWriteOperation: () => ({ success: true }),
    readbackAfterOperation: (_operation, target) => (
      target === 'getLayerHierarchy'
        ? { success: true, data: { target } }
        : { success: false, error: 'acceptance readback failed' }
    )
  }
});
assert(failingReadbackFakeAdapterRun.status === 'failed_readback', 'fake controlled runner should fail when step readback fails', failingReadbackFakeAdapterRun);
assert(String(failingReadbackFakeAdapterRun.readbackResults[1]?.error || '').includes('acceptance readback failed'), 'fake controlled runner should preserve readback failure reason', failingReadbackFakeAdapterRun);
assert(failingReadbackFakeAdapterRun.executionState === 'failed', 'failed fake readback must report failed execution state', failingReadbackFakeAdapterRun);
assert(failingReadbackFakeAdapterRun.verificationStatus === 'failed', 'failed fake readback must report failed verification', failingReadbackFakeAdapterRun);
assertControlledExecutionFakeRunnerBoundary(failingReadbackFakeAdapterRun);

const livePermissionWithoutTargetRun = runAgentResumeControlledExecutionRunner({
  request: readyControlledRequest,
  allowPhotoshopWrites: true,
  adapter: {
    runWriteOperation: () => ({ success: true }),
    readbackAfterOperation: () => ({ success: true })
  }
});
assert(livePermissionWithoutTargetRun.status === 'completed_dry_run', 'write permission alone must not switch runner into live Photoshop target', livePermissionWithoutTargetRun);
assert(livePermissionWithoutTargetRun.executedWriteTools.length === 0, 'write permission without live target must not record executed write tools', livePermissionWithoutTargetRun);
assertControlledExecutionRunnerBoundary(livePermissionWithoutTargetRun);

const liveWriteWithoutPermissionRun = runAgentResumeControlledExecutionRunner({
  request: readyControlledRequest,
  executionTarget: 'live-photoshop'
});
assert(liveWriteWithoutPermissionRun.status === 'blocked_live_write_permission_missing', 'live runner should require explicit write permission even when target is live Photoshop', liveWriteWithoutPermissionRun);
assert(liveWriteWithoutPermissionRun.executedWriteTools.length === 0, 'live runner without permission must not record executed write tools', liveWriteWithoutPermissionRun);
assertControlledExecutionRunnerBoundary(liveWriteWithoutPermissionRun);

const liveMissingAdapterRun = runAgentResumeControlledExecutionRunner({
  request: readyControlledRequest,
  executionTarget: 'live-photoshop',
  allowPhotoshopWrites: true
});
assert(liveMissingAdapterRun.status === 'blocked_live_adapter_required', 'live runner should require an injected adapter before Photoshop writes', liveMissingAdapterRun);
assert(liveMissingAdapterRun.executedWriteTools.length === 0, 'live runner without adapter must not record executed write tools', liveMissingAdapterRun);
assertControlledExecutionRunnerBoundary(liveMissingAdapterRun);

const missingParamsLiveRequest = {
  ...readyControlledRequest,
  operationRequests: readyControlledRequest.operationRequests.map((operation) => ({
    operationId: operation.operationId,
    toolName: operation.toolName,
    paramsSummary: operation.paramsSummary,
    readbackTargets: [...operation.readbackTargets]
  }))
};
let liveMissingParamsAdapterCalls = 0;
const liveMissingParamsRun = runAgentResumeControlledExecutionRunner({
  request: missingParamsLiveRequest,
  executionTarget: 'live-photoshop',
  allowPhotoshopWrites: true,
  adapter: {
    runWriteOperation: () => {
      liveMissingParamsAdapterCalls += 1;
      return { success: true };
    },
    readbackAfterOperation: () => ({ success: true })
  }
});
assert(liveMissingParamsRun.status === 'blocked_live_operation_params_required', 'live runner should require replayable params before adapter execution', liveMissingParamsRun);
assert(liveMissingParamsAdapterCalls === 0, 'live runner must block missing params before calling adapter', liveMissingParamsRun);
assert(liveMissingParamsRun.executedWriteTools.length === 0, 'live runner missing params must not record executed write tools', liveMissingParamsRun);
assertControlledExecutionRunnerBoundary(liveMissingParamsRun);

const liveAdapter = {
  calls: [],
  readbacks: [],
  runWriteOperation: (operation) => {
    liveAdapter.calls.push(operation);
    return { success: true, data: { operationId: operation.operationId, layerIds: operation.params?.layerIds || [] } };
  },
  readbackAfterOperation: (operation, target) => {
    liveAdapter.readbacks.push({ operation, target });
    return { success: true, data: { target, operationId: operation.operationId, liveAdapter: true } };
  }
};
const liveAdapterRun = runAgentResumeControlledExecutionRunner({
  request: readyControlledRequest,
  executionTarget: 'live-photoshop',
  allowPhotoshopWrites: true,
  adapter: liveAdapter
});
assert(liveAdapterRun.status === 'completed_live_adapter_verified', 'live runner should execute through injected adapter after permission and params gates', liveAdapterRun);
assert(liveAdapter.calls.length === 1, 'live adapter should receive planned operation exactly once', liveAdapter.calls);
assert(liveAdapter.readbacks.length === readyControlledRequest.readbackTargets.length, 'live runner should read back every requested target after operation', liveAdapter.readbacks);
assert(liveAdapterRun.executedWriteTools.join(',') === 'reorderLayer', 'live runner should record adapter-executed write tools', liveAdapterRun);
assert(liveAdapterRun.operationResults.length === 1 && liveAdapterRun.operationResults[0].success === true, 'live runner should record operation result details', liveAdapterRun);
assert(liveAdapterRun.readbackResults.length === 2 && liveAdapterRun.readbackResults.every((item) => item.success === true), 'live runner should record per-target readback results', liveAdapterRun);
assertControlledExecutionLiveRunnerBoundary(liveAdapterRun);

const unsafeWriteResumePlanning = buildAgentResumePlanningResult({
  contract: resumableCandidate,
  policy: resumableCandidatePolicy,
  gate: planningGate,
  refreshRun: planningRefreshRun,
  modelPlanText: JSON.stringify({
    ...executableResumePlanPayload,
    photoshopWritesAllowed: true
  })
});
const unsafeWriteGate = buildAgentResumeExecutionGate({
  planning: unsafeWriteResumePlanning,
  allowedWriteTools: ['reorderLayer'],
  userApprovedExecution: true
});
assert(unsafeWriteGate.status === 'blocked_model_plan_requested_writes', 'execution gate should block model plans that claim Photoshop writes are already allowed', unsafeWriteGate);
assert(unsafeWriteGate.canDispatchWriteTools === false, 'unsafe model write claims must not dispatch write tools', unsafeWriteGate);
assertResumeExecutionGateBoundary(unsafeWriteGate);

const unlistedToolResumePlanning = buildAgentResumePlanningResult({
  contract: resumableCandidate,
  policy: resumableCandidatePolicy,
  gate: planningGate,
  refreshRun: planningRefreshRun,
  modelPlanText: JSON.stringify({
    ...executableResumePlanPayload,
    proposedExecutionPlan: {
      ...executableResumePlanPayload.proposedExecutionPlan,
      writeToolWhitelist: ['executeScript']
    }
  })
});
const unlistedToolGate = buildAgentResumeExecutionGate({
  planning: unlistedToolResumePlanning,
  allowedWriteTools: ['reorderLayer'],
  userApprovedExecution: true
});
assert(unlistedToolGate.status === 'blocked_write_tool_not_allowed', 'execution gate should block write tools outside the runtime whitelist', unlistedToolGate);
assert(unlistedToolGate.blockedWriteTools.includes('executeScript'), 'execution gate should report blocked write tools', unlistedToolGate);
assertResumeExecutionGateBoundary(unlistedToolGate);

async function runEngineAttachmentCase() {
  const engine = new DesignAgentEngine();
  let callModelCount = 0;
  const result = await engine.run({
    userInput: '继续下一项',
    conversationHistory: [
      { role: 'user', content: '先做意图边界收口' },
      { role: 'assistant', content: '已完成矩阵。' }
    ],
    isPluginConnected: true,
    photoshopContext: {
      hasDocument: true,
      documentName: 'test.psd',
      layerCount: 2
    }
  }, {
    callModel: async () => {
      callModelCount += 1;
      return { text: '继续上一轮意图边界收口，但不直接调用 Photoshop。' };
    }
  });

  const contract = result?.data?.agentResumableTaskContract;
  const policy = result?.data?.agentResumeExecutionPolicy;
  const gate = result?.data?.agentResumeContextGate;
  const refreshRun = result?.data?.agentResumeContextRefreshRun;
  assert(result.success === true, 'engine continuation should stay successful direct response', result);
  assert(callModelCount === 1, 'engine continuation should consult model once', { callModelCount });
  assert(contract?.version === 'agent-resumable-task-contract/v0', 'engine should attach resumable task contract', result);
  assert(contract.status === 'ready_for_model_contextual_reply', 'engine contract should not fabricate executable resume', contract);
  assertBoundary(contract);
  assert(policy?.version === 'agent-resume-execution-policy/v0', 'engine should attach resume execution policy', result);
  assert(policy.action === 'reply_with_context', 'engine policy should match contract status', policy);
  assertPolicyBoundary(policy);
  assert(gate?.version === 'agent-resume-context-gate/v0', 'engine should attach resume context gate', result);
  assert(gate.status === 'blocked_policy_not_resumable', 'engine gate should block non-resumable continuation', gate);
  assertContextGateBoundary(gate);
  assert(refreshRun?.version === 'agent-resume-context-refresh-runner/v0', 'engine should attach resume context refresh run', result);
  assert(refreshRun.status === 'blocked_gate_not_refreshable', 'engine refresh run should block non-resumable continuation', refreshRun);
  assertRefreshRunBoundary(refreshRun);
}

async function runEngineReadonlyResumePlanningCase() {
  const engine = new DesignAgentEngine();
  const callModelPurposes = [];
  const result = await engine.run({
    userInput: '继续',
    conversationHistory: [
      { role: 'user', content: '把图层从浅到深排序' },
      {
        role: 'assistant',
        content: '读取了图层结构，还没有完成排序。',
        metadata: {
          agentRequestLifecycle: makeLifecycle({
            userInput: '把图层从浅到深排序',
            skillId: 'layer-management'
          })
        }
      }
    ],
    isPluginConnected: true,
    photoshopContext: {
      hasDocument: true,
      documentName: 'C-1141.psd',
      layerCount: 4
    },
    projectContext: {
      projectPath: 'C:\\Project\\C-1141'
    },
    resumeReadonlyToolHandlers: {
      getDocumentInfo: () => ({ name: 'C-1141.psd', width: 1242, height: 1660 }),
      getDocumentSnapshot: () => ({ layerCount: 4, activeLayerName: '浅色' }),
      getLayerHierarchy: () => [{ id: 1, name: '浅色' }, { id: 2, name: '深色' }],
      getAcceptanceSnapshot: () => ({ hasDocument: true, writeToolsUsed: 0 }),
      getProjectContextSnapshot: () => ({ projectPath: 'C:\\Project\\C-1141', assetCount: 8 })
    }
  }, {
    callModel: async (_messages, options) => {
      callModelPurposes.push(options?.purpose || 'unknown');
      if (options?.purpose === 'resume_planning') {
        return {
          text: JSON.stringify({
            planSummary: '基于最新只读上下文重新规划图层排序，等待用户确认后再写入。',
            readonlyFindings: ['当前文档 C-1141.psd 已读取', '图层层级已读取'],
            nextAction: '等待明确执行确认',
            photoshopWritesAllowed: false,
            proposedExecutionPlan: {
              objective: '把颜色图层从浅到深排序。',
              steps: [
                {
                  toolName: 'reorderLayer',
                  paramsSummary: '按只读图层层级确认目标图层后调整堆叠顺序。'
                }
              ],
              writeToolWhitelist: ['reorderLayer'],
              readbackTargets: ['getLayerHierarchy', 'getAcceptanceSnapshot'],
              requiresUserApproval: true
            }
          })
        };
      }
      return { text: '我会先刷新当前 Photoshop 与项目上下文，再重新规划恢复步骤。' };
    }
  });

  const contract = result?.data?.agentResumableTaskContract;
  const policy = result?.data?.agentResumeExecutionPolicy;
  const gate = result?.data?.agentResumeContextGate;
  const refreshRun = result?.data?.agentResumeContextRefreshRun;
  const readonlyExecutor = result?.data?.agentResumeReadonlyContextExecutor;
  const resumePlanning = result?.data?.agentResumePlanning;
  const resumeExecutionGate = result?.data?.agentResumeExecutionGate;
  const controlledExecutionRequest = result?.data?.agentResumeControlledExecutionRequest;
  const controlledExecutionRunner = result?.data?.agentResumeControlledExecutionRunner;

  assert(result.success === true, 'engine resumable continuation should stay successful direct response', result);
  assert(contract?.status === 'candidate_for_execution_resume', 'engine should preserve executable resume candidate', contract);
  assert(policy?.action === 'resume_candidate_needs_model_decision', 'engine should keep resume candidate behind model decision policy', policy);
  assert(gate?.status === 'ready_for_readonly_context_refresh', 'engine should request readonly context before planning', gate);
  assert(refreshRun?.status === 'fresh_context_ready', 'engine should refresh readonly context before resume planning', refreshRun);
  assert(refreshRun.canEnterResumePlanning === true, 'engine should allow planning only after fresh readonly context', refreshRun);
  assert(readonlyExecutor?.version === 'agent-resume-readonly-context-executor/v0', 'engine should export readonly executor diagnostics', result);
  assert(readonlyExecutor.status === 'completed_readonly_refresh', 'engine should run injected readonly tools before planning', readonlyExecutor);
  assert(readonlyExecutor.completedTools.includes('getDocumentSnapshot'), 'engine should run the document snapshot readonly tool', readonlyExecutor);
  assert(resumePlanning?.version === 'agent-resume-planning/v0', 'engine should export resume planning diagnostics', result);
  assert(resumePlanning.status === 'model_resume_plan_available', 'engine should call model after readonly context is fresh', resumePlanning);
  assert(resumePlanning.readonlyContextStatus === 'fresh_context_ready', 'resume planning should be based on fresh readonly context', resumePlanning);
  assert(resumePlanning.modelPurpose === 'resume_planning', 'resume planning should use the dedicated model purpose', resumePlanning);
  assertResumePlanningBoundary(resumePlanning);
  assert(resumeExecutionGate?.version === 'agent-resume-execution-gate/v0', 'engine should export resume execution gate diagnostics', result);
  assert(resumeExecutionGate.status === 'blocked_pending_user_approval', 'engine should block execution after model plan until explicit user approval', resumeExecutionGate);
  assert(resumeExecutionGate.canDispatchWriteTools === false, 'engine must not dispatch write tools from continuation by default', resumeExecutionGate);
  assert(resumeExecutionGate.proposedWriteTools.includes('reorderLayer'), 'engine should preserve proposed write whitelist for review', resumeExecutionGate);
  assertResumeExecutionGateBoundary(resumeExecutionGate);
  assert(controlledExecutionRequest?.version === 'agent-resume-controlled-execution-request/v0', 'engine should export controlled execution request diagnostics', result);
  assert(controlledExecutionRequest.status === 'blocked_execution_gate_not_ready', 'engine controlled execution request should block while gate waits for user approval', controlledExecutionRequest);
  assert(controlledExecutionRequest.canStartControlledRunner === false, 'engine must not start controlled runner from default continuation', controlledExecutionRequest);
  assertControlledExecutionRequestBoundary(controlledExecutionRequest);
  assert(controlledExecutionRunner?.version === 'agent-resume-controlled-execution-runner/v0', 'engine should export controlled execution runner diagnostics', result);
  assert(controlledExecutionRunner.status === 'blocked_request_not_ready', 'engine controlled execution runner should stay blocked by default', controlledExecutionRunner);
  assertControlledExecutionRunnerBoundary(controlledExecutionRunner);
  assert(callModelPurposes.includes('resume_planning'), 'engine should invoke model resume planning after readonly refresh', { callModelPurposes });
}

async function runEngineReadonlyResumePlanningBlockedCase() {
  const engine = new DesignAgentEngine();
  const callModelPurposes = [];
  const result = await engine.run({
    userInput: '继续',
    conversationHistory: [
      { role: 'user', content: '把图层从浅到深排序' },
      {
        role: 'assistant',
        content: '读取了图层结构，还没有完成排序。',
        metadata: {
          agentRequestLifecycle: makeLifecycle({
            userInput: '把图层从浅到深排序',
            skillId: 'layer-management'
          })
        }
      }
    ],
    isPluginConnected: true,
    photoshopContext: {
      hasDocument: true,
      documentName: 'C-1141.psd',
      layerCount: 4
    },
    projectContext: {
      projectPath: 'C:\\Project\\C-1141'
    },
    resumeReadonlyToolHandlers: {
      getDocumentInfo: () => ({ name: 'C-1141.psd' })
    }
  }, {
    callModel: async (_messages, options) => {
      callModelPurposes.push(options?.purpose || 'unknown');
      return { text: '直接回复不会替代只读恢复规划。' };
    }
  });

  const refreshRun = result?.data?.agentResumeContextRefreshRun;
  const readonlyExecutor = result?.data?.agentResumeReadonlyContextExecutor;
  const resumePlanning = result?.data?.agentResumePlanning;
  const resumeExecutionGate = result?.data?.agentResumeExecutionGate;
  const controlledExecutionRequest = result?.data?.agentResumeControlledExecutionRequest;
  const controlledExecutionRunner = result?.data?.agentResumeControlledExecutionRunner;

  assert(readonlyExecutor?.status === 'blocked_missing_readonly_tools', 'engine should block resume planning when readonly handlers are missing', readonlyExecutor);
  assert(readonlyExecutor.missingTools.includes('getDocumentSnapshot'), 'engine should identify missing readonly handler', readonlyExecutor);
  assert(refreshRun?.status === 'waiting_for_readonly_observations', 'engine should not mark context fresh when readonly executor is blocked', refreshRun);
  assert(resumePlanning?.status === 'blocked_readonly_context_not_ready', 'engine should block model resume planning without fresh readonly context', resumePlanning);
  assertResumePlanningBoundary(resumePlanning);
  assert(resumeExecutionGate?.status === 'blocked_resume_plan_not_available', 'engine should block execution gate when resume planning is unavailable', resumeExecutionGate);
  assert(resumeExecutionGate.canDispatchWriteTools === false, 'blocked execution gate must not dispatch write tools', resumeExecutionGate);
  assertResumeExecutionGateBoundary(resumeExecutionGate);
  assert(controlledExecutionRequest?.status === 'blocked_execution_gate_not_ready', 'engine controlled execution request should block when execution gate is unavailable', controlledExecutionRequest);
  assertControlledExecutionRequestBoundary(controlledExecutionRequest);
  assert(controlledExecutionRunner?.status === 'blocked_request_not_ready', 'engine controlled execution runner should block when request is unavailable', controlledExecutionRunner);
  assertControlledExecutionRunnerBoundary(controlledExecutionRunner);
  assert(!callModelPurposes.includes('resume_planning'), 'engine must not request model resume planning without fresh readonly context', { callModelPurposes });
}

async function runReadonlyExecutorCase() {
  const notReadyExecutor = await runAgentResumeReadonlyContextExecutor({
    refreshRun: noStructuredLifecycleRefreshRun
  });
  assert(notReadyExecutor.status === 'blocked_refresh_run_not_ready', 'readonly executor should block when refresh run is not ready', notReadyExecutor);
  assertReadonlyExecutorBoundary(notReadyExecutor);

  const missingToolsExecutor = await runAgentResumeReadonlyContextExecutor({
    refreshRun: waitingRefreshRun,
    tools: {
      getDocumentInfo: () => ({ name: 'C-1141.psd' })
    }
  });
  assert(missingToolsExecutor.status === 'blocked_missing_readonly_tools', 'readonly executor should block missing read-only tools', missingToolsExecutor);
  assert(missingToolsExecutor.missingTools.includes('getDocumentSnapshot'), 'readonly executor should list missing tools', missingToolsExecutor);
  assertReadonlyExecutorBoundary(missingToolsExecutor);

  const completedExecutor = await runAgentResumeReadonlyContextExecutor({
    refreshRun: waitingRefreshRun,
    tools: {
      getDocumentInfo: () => ({ name: 'C-1141.psd' }),
      getDocumentSnapshot: () => ({ layerCount: 4 }),
      getLayerHierarchy: () => [{ id: 1, name: '浅色' }],
      getAcceptanceSnapshot: () => ({ hasDocument: true }),
      getProjectContextSnapshot: () => ({ projectPath: 'C:\\Project\\C-1141' })
    }
  });
  assert(completedExecutor.status === 'completed_readonly_refresh', 'readonly executor should complete injected read-only tools', completedExecutor);
  assert(completedExecutor.completedTools.length === waitingRefreshRun.allowedReadOnlyTools.length, 'readonly executor should complete all requested tools', completedExecutor);
  assert(completedExecutor.context?.documentInfo?.name === 'C-1141.psd', 'readonly executor should return injected readonly context', completedExecutor);
  assertReadonlyExecutorBoundary(completedExecutor);

  const failedExecutor = await runAgentResumeReadonlyContextExecutor({
    refreshRun: waitingRefreshRun,
    tools: {
      getDocumentInfo: () => ({ name: 'C-1141.psd' }),
      getDocumentSnapshot: () => {
        throw new Error('snapshot unavailable');
      },
      getLayerHierarchy: () => [],
      getAcceptanceSnapshot: () => ({}),
      getProjectContextSnapshot: () => ({})
    }
  });
  assert(failedExecutor.status === 'failed_readonly_refresh', 'readonly executor should report read-only tool failure', failedExecutor);
  assert(failedExecutor.failedTools[0]?.toolName === 'getDocumentSnapshot', 'readonly executor should identify failed read-only tool', failedExecutor);
  assertReadonlyExecutorBoundary(failedExecutor);
}

Promise.all([
  runEngineAttachmentCase(),
  runEngineReadonlyResumePlanningCase(),
  runEngineReadonlyResumePlanningBlockedCase(),
  runReadonlyExecutorCase()
])
  .then(() => {
    console.log(JSON.stringify({
      success: true,
      checks: [
        'non-continuation requests do not create resume intent',
        'continuation without history is blocked',
        'history without lifecycle allows only model contextual reply',
        'direct response and completed skill cannot be blindly resumed',
        'failed skill requires recovery planning',
        'unfinished executable lifecycle becomes a resume candidate with model reconfirmation',
        'DesignAgentEngine attaches resumable task contract to continuation direct responses',
        'DesignAgentEngine attaches safe resume execution policy to continuation direct responses',
        'DesignAgentEngine attaches no-write resume context gate to continuation direct responses',
        'DesignAgentEngine attaches a write-free readonly context refresh runner to continuation direct responses',
        'DesignAgentEngine runs readonly context executor before resumable continuation planning',
        'DesignAgentEngine calls model resume planning only after fresh readonly context',
        'DesignAgentEngine blocks model resume plans behind explicit execution gate and user approval',
        'DesignAgentEngine exports controlled execution request and runner diagnostics without default Photoshop writes',
        'readonly context executor runs only injected read-only tools and blocks missing tools',
        'contract, policy, context gate, refresh runner, readonly executor, resume planning, execution gate and controlled runner expose explicit write state and cannot run provider or Photoshop by default'
      ]
    }, null, 2));
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
