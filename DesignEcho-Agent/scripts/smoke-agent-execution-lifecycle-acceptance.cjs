const path = require('path');

require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '..', 'tsconfig.main.json')
});

const {
  buildAgentRequestLifecycle
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'agent-request-lifecycle.ts'));
const {
  isAgentExecutionLifecycleBoundaryOk
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'agent-execution-lifecycle.ts'));
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

function makeCase() {
  return {
    id: 'agent-execution-lifecycle-acceptance-case',
    title: 'Agent execution lifecycle acceptance smoke',
    userInput: '帮我调整图层顺序',
    mode: 'desktop_bridge',
    tags: ['agent', 'execution-lifecycle', 'acceptance'],
    expectation: {
      route: 'skill_execution',
      skillId: 'layer-management',
      executionKind: 'deterministic_skill',
      shouldUseTools: true
    }
  };
}

function makeLifecycle() {
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
    routeSource: 'deterministic_route',
    route: 'skill_execution',
    skillId: 'layer-management',
    executionKind: 'deterministic_skill',
    reason: '测试用 lifecycle 记录。',
    blockers: [],
    warnings: []
  });
}

const acceptanceCase = makeCase();
const bundle = buildAgentRunDebugBundle({
  acceptanceCase,
  lifecycle: makeLifecycle(),
  executionSummary: {
    status: 'completed',
    toolCallCount: 1,
    successfulToolCalls: 1,
    failedToolCalls: 0
  },
  tools: [
    {
      name: 'reorderLayer',
      success: true,
      durationMs: 12
    }
  ],
  visibleThinking: []
});
const report = evaluateAgentAcceptance(acceptanceCase, bundle);
const debugExport = buildAgentAcceptanceDebugExport({ bundle, report });

assert(
  report.runRecords.agentExecutionLifecycleSnapshot?.version === 'agent-execution-lifecycle/v0',
  'acceptance report should expose agent execution lifecycle snapshot',
  report.runRecords
);
assert(
  report.runRecords.agentExecutionLifecycleSnapshot?.phase === 'completed',
  'completed execution summary should map lifecycle snapshot to completed phase',
  report.runRecords.agentExecutionLifecycleSnapshot
);
assert(
  report.runRecords.agentExecutionLifecycleSnapshot?.toolState.toolCallCount === 1,
  'lifecycle snapshot should preserve tool count state',
  report.runRecords.agentExecutionLifecycleSnapshot
);
assert(
  isAgentExecutionLifecycleBoundaryOk(report.runRecords.agentExecutionLifecycleSnapshot) === true,
  'acceptance report lifecycle snapshot should keep no-provider/no-Photoshop boundary',
  report.runRecords.agentExecutionLifecycleSnapshot
);
assert(
  debugExport.acceptanceDiagnostics.agentExecutionLifecycleSnapshot?.phase === 'completed',
  'debug export should expose agent execution lifecycle snapshot',
  debugExport.acceptanceDiagnostics
);
assert(
  debugExport.acceptanceDiagnostics.executionLifecycleBoundaryOk === true,
  'debug export should expose execution lifecycle boundary status',
  debugExport.acceptanceDiagnostics
);
assert(
  report.runRecords.agentExecutionLifecycleSnapshot?.isProviderThinking === false,
  'execution lifecycle snapshot must not claim provider thinking',
  report.runRecords.agentExecutionLifecycleSnapshot
);
assert(
  Array.isArray(bundle.visibleThinking) && bundle.visibleThinking.length === 0,
  'execution lifecycle state must not be persisted as visible thinking',
  bundle
);

const serialized = JSON.stringify({ report, debugExport });
assert(!serialized.includes('正在准备'), 'lifecycle acceptance bridge must not emit fake waiting copy');
assert(!serialized.includes('等待响应'), 'lifecycle acceptance bridge must not emit fake waiting copy');
assert(!serialized.includes('请求已发送'), 'lifecycle acceptance bridge must not emit fake waiting copy');
assert(!serialized.includes('模型真实思考'), 'lifecycle acceptance bridge must not claim model thinking');

console.log(JSON.stringify({
  success: true,
  checks: [
    'acceptance report exposes execution lifecycle snapshot',
    'debug export exposes execution lifecycle snapshot and boundary status',
    'snapshot keeps no-provider no-Photoshop no-model-reasoning boundaries',
    'snapshot does not enter visible thinking'
  ]
}, null, 2));
