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
  buildAgentExecutionLifecycleSnapshot,
  isAgentExecutionLifecycleBoundaryOk
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'agent-execution-lifecycle.ts'));

function assert(condition, message, details) {
  if (!condition) {
    const suffix = details ? `\n${JSON.stringify(details, null, 2)}` : '';
    throw new Error(`${message}${suffix}`);
  }
}

function makeLifecycle(overrides = {}) {
  return buildAgentRequestLifecycle({
    userInput: overrides.userInput || '帮我调整图层顺序',
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
    skillParams: overrides.skillParams,
    executionKind: overrides.executionKind || 'deterministic_skill',
    reason: '测试用 lifecycle 记录。',
    blockers: overrides.blockers || [],
    warnings: overrides.warnings || []
  });
}

function assertBoundary(snapshot) {
  assert(snapshot.projectionOnly === true, 'snapshot must be projection-only', snapshot);
  assert(snapshot.userVisible === true, 'snapshot must be user visible', snapshot);
  assert(snapshot.isProviderThinking === false, 'snapshot must not claim provider thinking', snapshot);
  assert(snapshot.canClaimModelReasoning === false, 'snapshot must not claim model reasoning', snapshot);
  assert(snapshot.canClaimTaskCompletion === false, 'snapshot must not claim task completion', snapshot);
  assert(snapshot.mustNotRunProvider === true, 'snapshot must not run provider', snapshot);
  assert(snapshot.mustNotRunPhotoshop === true, 'snapshot must not run Photoshop', snapshot);
  assert(isAgentExecutionLifecycleBoundaryOk(snapshot) === true, 'boundary helper should pass', snapshot);
}

const initial = buildAgentExecutionLifecycleSnapshot({
  visibleActivity: {
    title: '当前执行',
    kind: 'router',
    agentId: 'agent-router',
    agentLabel: 'Agent Router',
    source: 'initial',
    userVisible: true,
    showAsThinking: false,
    isProviderThinking: false,
    canClaimModelReasoning: false
  }
});
assert(initial.phase === 'routing', 'missing lifecycle should show routing phase', initial);
assert(initial.actor.label === 'Agent Router', 'initial actor should be Agent Router', initial);
assert(initial.requiredNextConditions.includes('agent_request_lifecycle_required'), 'missing lifecycle should require a lifecycle record', initial);
assertBoundary(initial);

const skillReady = buildAgentExecutionLifecycleSnapshot({
  lifecycle: makeLifecycle(),
  visibleActivity: {
    title: '当前执行',
    kind: 'skill',
    agentId: 'layer-management',
    agentLabel: 'Layer Management',
    source: 'skill_event',
    userVisible: true,
    showAsThinking: false,
    isProviderThinking: false,
    canClaimModelReasoning: false
  },
  status: 'running',
  toolCallCount: 0
});
assert(skillReady.phase === 'executing_skill', 'deterministic skill should show executing_skill phase', skillReady);
assert(skillReady.actor.id === 'layer-management', 'skill actor should come from visible activity', skillReady);
assert(skillReady.route.skillId === 'layer-management', 'snapshot should preserve skill id', skillReady);
assertBoundary(skillReady);

const toolRunning = buildAgentExecutionLifecycleSnapshot({
  lifecycle: makeLifecycle(),
  status: 'running',
  toolCallCount: 2,
  activeToolName: 'reorderLayer'
});
assert(toolRunning.phase === 'executing_tools', 'active tool state should show executing_tools phase', toolRunning);
assert(toolRunning.toolState.activeToolName === 'reorderLayer', 'active tool name should be preserved', toolRunning);
assertBoundary(toolRunning);

const blocked = buildAgentExecutionLifecycleSnapshot({
  lifecycle: makeLifecycle({
    isPluginConnected: false,
    hasDocument: false
  }),
  status: 'running'
});
assert(blocked.phase === 'waiting_for_context', 'blocked lifecycle should show waiting_for_context phase', blocked);
assert(blocked.blockers.length > 0, 'blocked lifecycle should expose blockers', blocked);
assertBoundary(blocked);

const completedChat = buildAgentExecutionLifecycleSnapshot({
  lifecycle: makeLifecycle({
    route: 'direct_response',
    routeSource: 'model_router',
    skillId: undefined,
    executionKind: 'none'
  }),
  status: 'completed',
  toolCallCount: 0
});
assert(completedChat.phase === 'completed', 'completed direct response should show completed phase', completedChat);
assert(completedChat.route.route === 'direct_response', 'direct response route should be preserved', completedChat);
assert(completedChat.toolState.toolCallCount === 0, 'chat response should have no tools', completedChat);
assertBoundary(completedChat);

const awaitingConfirmation = buildAgentExecutionLifecycleSnapshot({
  lifecycle: makeLifecycle(),
  status: 'awaiting_confirmation',
  toolCallCount: 1,
  activeToolName: 'createInteractiveCard'
});
assert(awaitingConfirmation.phase === 'awaiting_confirmation', 'confirmation pause must not project as running', awaitingConfirmation);
assert(awaitingConfirmation.statusLabel === '等待确认', 'confirmation pause should use the correct label', awaitingConfirmation);
assert(awaitingConfirmation.requiredNextConditions.includes('user_confirmation_required'), 'confirmation pause should require user confirmation', awaitingConfirmation);
assertBoundary(awaitingConfirmation);

const needsReview = buildAgentExecutionLifecycleSnapshot({
  lifecycle: makeLifecycle(),
  status: 'needs_review',
  toolCallCount: 2
});
assert(needsReview.phase === 'needs_review', 'review terminal must not project as running', needsReview);
assert(needsReview.statusLabel === '需要复核', 'review terminal should use the correct label', needsReview);
assert(needsReview.requiredNextConditions.includes('review_or_followup_required'), 'review terminal should require review or follow-up', needsReview);
assertBoundary(needsReview);

const attachedImageLifecycle = makeLifecycle({
  userInput: '理解一下图片',
  isPluginConnected: false,
  hasDocument: false,
  skillId: 'visual-analysis',
  skillParams: { sourceType: 'attached_image' }
});
assert(attachedImageLifecycle.execution.requiresPhotoshop === false, 'attached image analysis must not require Photoshop', attachedImageLifecycle);
assert(attachedImageLifecycle.execution.canStart === true, 'attached image analysis should start without Photoshop', attachedImageLifecycle);
assert(attachedImageLifecycle.blockers.length === 0, 'attached image analysis should not inherit Photoshop blockers', attachedImageLifecycle);

const activeDocumentLifecycle = makeLifecycle({
  userInput: '分析当前画布',
  isPluginConnected: false,
  hasDocument: false,
  skillId: 'visual-analysis',
  skillParams: { sourceType: 'active_document' }
});
assert(activeDocumentLifecycle.execution.requiresPhotoshop === true, 'active document analysis must require Photoshop', activeDocumentLifecycle);
assert(activeDocumentLifecycle.execution.canStart === false, 'active document analysis should wait for Photoshop', activeDocumentLifecycle);
assert(activeDocumentLifecycle.blockers.length > 0, 'active document analysis should expose Photoshop blockers', activeDocumentLifecycle);

const referenceSearchLifecycle = makeLifecycle({
  userInput: '帮我找袜子详情页参考',
  isPluginConnected: false,
  hasDocument: false,
  skillId: 'design-reference-search'
});
assert(referenceSearchLifecycle.execution.requiresPhotoshop === false, 'reference search requirement should come from the skill declaration', referenceSearchLifecycle);
assert(referenceSearchLifecycle.execution.canStart === true, 'reference search should start without Photoshop', referenceSearchLifecycle);

const textOnlyBusinessIdentityLifecycle = makeLifecycle({
  userInput: '帮我修改详情页第三屏文案',
  routeSource: 'model_router',
  route: 'autonomous_agent',
  skillId: 'autonomous-agent',
  executionKind: 'autonomous_agent',
  skillParams: {
    userTask: '帮我修改详情页第三屏文案',
    skillParams: {}
  }
});
assert(textOnlyBusinessIdentityLifecycle.decision.selectedSkillId === undefined, 'task text alone must not declare a selected Skill', textOnlyBusinessIdentityLifecycle);
assert(textOnlyBusinessIdentityLifecycle.decision.taskType === undefined, 'task text alone must not declare a taskType', textOnlyBusinessIdentityLifecycle);
assert(textOnlyBusinessIdentityLifecycle.decision.workMode === undefined, 'task text alone must not declare a workMode', textOnlyBusinessIdentityLifecycle);

const serialized = JSON.stringify({
  initial,
  skillReady,
  toolRunning,
  blocked,
  completedChat,
  awaitingConfirmation,
  needsReview,
  attachedImageLifecycle,
  activeDocumentLifecycle,
  referenceSearchLifecycle,
  textOnlyBusinessIdentityLifecycle
});
assert(!serialized.includes('正在准备'), 'snapshot must not contain fake waiting copy');
assert(!serialized.includes('等待响应'), 'snapshot must not contain fake waiting copy');
assert(!serialized.includes('模型真实思考'), 'snapshot must not claim model thinking');

console.log(JSON.stringify({
  success: true,
  checks: [
    'missing lifecycle remains a routing state without fake thinking',
    'deterministic skill lifecycle maps to executing_skill',
    'active tool state maps to executing_tools',
    'blocked Photoshop context maps to waiting_for_context',
    'completed direct response maps to completed',
    'confirmation and review terminals do not project as running',
    'skill declarations externalize Photoshop runtime requirements',
    'attached image analysis starts without Photoshop while active document analysis remains guarded',
    'business Skill, taskType and workMode are accepted only from structured lifecycle fields',
    'snapshot boundary forbids provider, Photoshop and model-reasoning claims'
  ]
}, null, 2));
