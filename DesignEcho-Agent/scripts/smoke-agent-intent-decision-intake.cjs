const path = require('path');

require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '..', 'tsconfig.main.json')
});

const {
  buildAgentIntentDecisionIntake,
  isAgentIntentDecisionBoundaryOk
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'agent-intent-decision-intake.ts'));
const {
  buildAgentRequestLifecycle
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'agent-request-lifecycle.ts'));
const {
  buildAgentRunDebugBundle,
  evaluateAgentAcceptance
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'agent-acceptance-contracts.ts'));
const {
  buildAgentAcceptanceDebugExport
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'agent-acceptance-export.ts'));

function assert(condition, message, details) {
  if (!condition) {
    const suffix = details ? `\n${JSON.stringify(details, null, 2)}` : '';
    throw new Error(`${message}${suffix}`);
  }
}

function makeCase(overrides = {}) {
  return {
    id: overrides.id || 'agent-intent-decision-intake-case',
    title: overrides.title || 'Agent intent decision intake smoke',
    userInput: overrides.userInput || '帮我调整图层顺序',
    mode: overrides.mode || 'desktop_bridge',
    tags: ['agent', 'intent-decision-intake'],
    expectation: {
      route: 'skill_execution',
      skillId: 'layer-management',
      executionKind: 'deterministic_skill',
      shouldUseTools: true,
      ...overrides.expectation
    }
  };
}

function makeLifecycle(overrides = {}) {
  const skillId = Object.prototype.hasOwnProperty.call(overrides, 'skillId')
    ? overrides.skillId
    : 'layer-management';
  return buildAgentRequestLifecycle({
    userInput: '帮我调整图层顺序',
    context: {
      isPluginConnected: true,
      photoshopContext: {
        hasDocument: true,
        documentName: 'C-1141.psd',
        layerCount: 4
      }
    },
    routeSource: overrides.routeSource || 'deterministic_route',
    route: overrides.route || 'skill_execution',
    skillId,
    executionKind: overrides.executionKind || 'deterministic_skill',
    reason: '测试用 lifecycle 记录。',
    blockers: overrides.blockers || [],
    warnings: overrides.warnings || []
  });
}

function assertBoundary(intake) {
  assert(intake.reviewOnly === true, 'intake must be review-only', intake);
  assert(intake.userVisible === false, 'intake must stay hidden', intake);
  assert(intake.canClaimDesignQuality === false, 'intake must not claim design quality', intake);
  assert(intake.mustNotChangeRouting === true, 'intake must not change routing', intake);
  assert(intake.mustNotRunProvider === true, 'intake must not run provider', intake);
  assert(intake.mustNotRunPhotoshop === true, 'intake must not run Photoshop', intake);
  assert(isAgentIntentDecisionBoundaryOk(intake) === true, 'boundary helper should return true', intake);
}

const missingLifecycle = buildAgentIntentDecisionIntake({
  acceptanceCase: makeCase()
});
assert(missingLifecycle.status === 'missing_lifecycle', 'missing lifecycle should be explicit', missingLifecycle);
assert(missingLifecycle.blockers.length > 0, 'missing lifecycle should block routing evidence', missingLifecycle);
assert(missingLifecycle.requiredNextChecks.includes('agent_request_lifecycle_required'), 'missing lifecycle should require a lifecycle record', missingLifecycle);
assertBoundary(missingLifecycle);

const chatOnly = buildAgentIntentDecisionIntake({
  lifecycle: makeLifecycle({
    route: 'direct_response',
    routeSource: 'model_router',
    skillId: undefined,
    executionKind: 'none'
  }),
  acceptanceCase: makeCase({
    expectation: {
      route: 'direct_response',
      skillId: undefined,
      executionKind: 'none',
      shouldUseTools: false
    }
  }),
  executionSummary: {
    toolCallCount: 0
  }
});
assert(chatOnly.status === 'chat_only', 'direct response with no tools should be chat_only', chatOnly);
assertBoundary(chatOnly);

const deterministicSkill = buildAgentIntentDecisionIntake({
  lifecycle: makeLifecycle(),
  acceptanceCase: makeCase(),
  tools: [{ name: 'reorderLayer', success: true }]
});
assert(deterministicSkill.status === 'deterministic_skill_ready', 'matching deterministic skill should be ready', deterministicSkill);
assert(deterministicSkill.blockers.length === 0, 'matching deterministic skill should not add blockers', deterministicSkill);
assertBoundary(deterministicSkill);

const autonomous = buildAgentIntentDecisionIntake({
  lifecycle: makeLifecycle({
    route: 'autonomous_agent',
    routeSource: 'model_router',
    skillId: 'autonomous-agent',
    executionKind: 'autonomous_agent'
  }),
  acceptanceCase: makeCase({
    expectation: {
      route: 'autonomous_agent',
      skillId: 'autonomous-agent',
      executionKind: 'autonomous_agent',
      shouldUseTools: true
    }
  }),
  executionSummary: {
    toolCallCount: 2
  }
});
assert(autonomous.status === 'autonomous_needs_review', 'autonomous route should need review', autonomous);
assert(
  autonomous.requiredNextChecks.includes('autonomous_route_context_and_budget_review'),
  'autonomous route should require context and budget review',
  autonomous
);

const routeMismatch = buildAgentIntentDecisionIntake({
  lifecycle: makeLifecycle({ skillId: 'sku-batch' }),
  acceptanceCase: makeCase()
});
assert(routeMismatch.status === 'route_mismatch', 'skill mismatch should be route_mismatch', routeMismatch);
assert(
  routeMismatch.requiredNextChecks.includes('skill_decision_review_required'),
  'skill mismatch should require skill decision review',
  routeMismatch
);

const toolMismatch = buildAgentIntentDecisionIntake({
  lifecycle: makeLifecycle(),
  acceptanceCase: makeCase(),
  executionSummary: {
    toolCallCount: 0
  }
});
assert(toolMismatch.status === 'blocked_or_missing_context', 'missing expected tool evidence should block completion', toolMismatch);
assert(toolMismatch.requiredNextChecks.includes('tool_call_record_required'), 'tool mismatch should require a tool record', toolMismatch);

const acceptanceCase = makeCase({ id: 'agent-intent-decision-report' });
const bundle = buildAgentRunDebugBundle({
  acceptanceCase,
  lifecycle: makeLifecycle(),
  executionSummary: {
    status: 'completed',
    toolCallCount: 1
  },
  tools: [{ name: 'reorderLayer', success: true }]
});
const report = evaluateAgentAcceptance(acceptanceCase, bundle);
const debugExport = buildAgentAcceptanceDebugExport({ bundle, report });

assert(report.runRecords.agentIntentDecisionIntake?.status === 'deterministic_skill_ready', 'report should expose intent decision intake', report.runRecords);
assert(
  debugExport.acceptanceDiagnostics.agentIntentDecisionIntake?.status === 'deterministic_skill_ready',
  'debug export should expose intent decision intake',
  debugExport.acceptanceDiagnostics
);
assert(
  debugExport.acceptanceDiagnostics.intentDecisionIntakeBoundaryOk === true,
  'debug export should expose boundary result',
  debugExport.acceptanceDiagnostics
);

const serialized = JSON.stringify({
  missingLifecycle,
  chatOnly,
  deterministicSkill,
  autonomous,
  routeMismatch,
  toolMismatch,
  report: report.runRecords.agentIntentDecisionIntake
});
assert(!serialized.includes('正在准备'), 'intake must not contain local pseudo thinking');
assert(!serialized.includes('等待响应'), 'intake must not contain local waiting copy');
assert(!serialized.includes('模型真实思考'), 'intake must not pretend to be model thinking');

console.log(JSON.stringify({
  success: true,
  checks: [
    'missing lifecycle is explicit',
    'chat-only and deterministic-skill statuses are distinct',
    'autonomous route requires review checks',
    'route and tool record mismatches are visible',
    'acceptance report/export carry hidden intent decision intake',
    'no local pseudo-thinking copy is emitted'
  ]
}, null, 2));
