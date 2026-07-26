const path = require('path');
require('ts-node').register({ transpileOnly: true, project: path.resolve(__dirname, '..', 'tsconfig.main.json') });

const {
  buildAgentRunDebugBundle,
  buildAgentRunDebugBundleFromMessage,
  evaluateAgentAcceptance
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'agent-acceptance-contracts.ts'));
const { buildAgentRequestLifecycle } = require(path.resolve(__dirname, '..', 'src', 'shared', 'agent-request-lifecycle.ts'));
const {
  buildAgentAcceptanceDebugExport
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'agent-acceptance-export.ts'));

function assert(condition, message, details) {
  if (!condition) {
    const suffix = details ? `\n${JSON.stringify(details, null, 2)}` : '';
    throw new Error(`${message}${suffix}`);
  }
}

function makeCase(id, expectation = {}) {
  return {
    id,
    title: 'Acceptance triage smoke',
    userInput: '帮我把详情页文档保存到项目的PSD中',
    mode: 'offline',
    tags: ['acceptance', 'triage'],
    expectation: {
      route: 'skill_execution',
      routeSource: 'deterministic_route',
      skillId: 'document-management',
      executionKind: 'deterministic_skill',
      shouldUseTools: true,
      expectedExecutionStatus: 'completed',
      maxToolCalls: 2,
      ...expectation
    }
  };
}

function lifecycleFor(acceptanceCase, overrides = {}) {
  return buildAgentRequestLifecycle({
    userInput: acceptanceCase.userInput,
    context: {
      isPluginConnected: true,
      photoshopContext: {
        hasDocument: true,
        documentName: 'acceptance-triage.psd',
        layerCount: 1
      }
    },
    ...overrides
  });
}

const routingCase = makeCase('triage-routing-failure');
const routingBundle = buildAgentRunDebugBundle({
  acceptanceCase: routingCase,
  lifecycle: lifecycleFor(routingCase, {
    routeSource: 'lightweight_intent',
    route: 'direct_response',
    reason: 'Misrouted as ordinary chat.'
  }),
  executionSummary: {
    status: 'completed',
    iterations: 0,
    toolCallCount: 0,
    successfulToolCalls: 0,
    failedToolCalls: 0,
    warnings: []
  },
  visibleMessages: ['我理解你的需求。']
});
const routingReport = evaluateAgentAcceptance(routingCase, routingBundle);
const routingExport = buildAgentAcceptanceDebugExport({ bundle: routingBundle, report: routingReport });

assert(
  routingExport.acceptanceTriage,
  'debug export should include acceptanceTriage',
  routingExport
);
assert(
  routingExport.acceptanceTriage.status === 'blocked',
  'routing failure should be triaged as blocked',
  routingExport.acceptanceTriage
);
assert(
  routingExport.acceptanceTriage.primaryIssueLayer === 'routing',
  'routing mismatch should select routing as the primary issue layer',
  routingExport.acceptanceTriage
);
assert(
  routingExport.acceptanceTriage.owner === 'agent_control_plane',
  'routing failures should be owned by the agent control plane',
  routingExport.acceptanceTriage
);
assert(
  routingExport.acceptanceTriage.nextActions.some((item) => item.includes('routing')),
  'routing triage should include a routing-focused next action',
  routingExport.acceptanceTriage
);

const diagnosticCase = makeCase('triage-diagnostic-boundary', {
  shouldUseTools: false
});
const diagnosticBundle = buildAgentRunDebugBundleFromMessage({
  acceptanceCase: diagnosticCase,
  message: {
    content: '需要补充画面观察后再判断设计质量。',
    agentDiagnosticRecord: {
      version: 'agent-diagnostic-record/v0',
      recordKeys: ['businessSkillExecutionPlanIntake'],
      payloadRedacted: true,
      warnings: [],
      businessSkillExecutionPlanIntake: {
        status: 'ready',
        runRecordOnly: false,
        userVisible: false,
        canClaimDesignQuality: false,
        requiredNextChecks: [],
        blockers: []
      }
    }
  }
});
const diagnosticReport = evaluateAgentAcceptance(diagnosticCase, diagnosticBundle);
const diagnosticExport = buildAgentAcceptanceDebugExport({ bundle: diagnosticBundle, report: diagnosticReport });

assert(
  diagnosticExport.acceptanceTriage.status === 'blocked',
  'diagnostic boundary violation should be triaged as blocked',
  diagnosticExport.acceptanceTriage
);
assert(
  diagnosticExport.acceptanceTriage.primaryIssueLayer === 'verification',
  'diagnostic boundary violations should be owned by verification',
  diagnosticExport.acceptanceTriage
);
assert(
  diagnosticExport.acceptanceTriage.designQualityClaimAllowed === false,
  'triage should keep design quality claims disabled for developer diagnostics',
  diagnosticExport.acceptanceTriage
);
assert(
  diagnosticExport.acceptanceTriage.verificationBoundary === 'diagnostic_checks_invalid',
  'triage should classify invalid diagnostic check boundaries',
  diagnosticExport.acceptanceTriage
);

const cleanCase = makeCase('triage-passed-document-management');
const cleanBundle = buildAgentRunDebugBundle({
  acceptanceCase: cleanCase,
  lifecycle: lifecycleFor(cleanCase, {
    routeSource: 'deterministic_route',
    route: 'skill_execution',
    skillId: 'document-management',
    executionKind: 'deterministic_skill',
    reason: 'Matched document-management route.'
  }),
  executionSummary: {
    status: 'completed',
    iterations: 1,
    toolCallCount: 1,
    successfulToolCalls: 1,
    failedToolCalls: 0,
    warnings: []
  },
  tools: [
    {
      name: 'saveDocument',
      success: true
    }
  ],
  visibleMessages: ['文档已保存。']
});
const cleanReport = evaluateAgentAcceptance(cleanCase, cleanBundle);
const cleanExport = buildAgentAcceptanceDebugExport({ bundle: cleanBundle, report: cleanReport });

assert(
  cleanExport.acceptanceTriage.status === 'ok',
  'passed report should be triaged as ok',
  cleanExport.acceptanceTriage
);
assert(
  cleanExport.acceptanceTriage.primaryIssueLayer === 'none',
  'passed report should not fabricate an issue layer',
  cleanExport.acceptanceTriage
);
assert(
  cleanExport.acceptanceTriage.nextActions.length === 0,
  'passed report should not fabricate next actions',
  cleanExport.acceptanceTriage
);

console.log(JSON.stringify({
  success: true,
  checks: [
    'debug export includes acceptanceTriage',
    'routing failures map to agent_control_plane ownership',
    'verification intake boundary violations map to verification ownership',
    'passed reports do not fabricate issues or next actions'
  ]
}, null, 2));
