const path = require('path');
require('ts-node').register({ transpileOnly: true, project: path.resolve(__dirname, '..', 'tsconfig.main.json') });

const {
  buildAgentRunDebugBundleFromMessage,
  evaluateAgentAcceptance
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'agent-acceptance-contracts.ts'));

function assert(condition, message, details) {
  if (!condition) throw new Error(`${message}${details ? `\n${JSON.stringify(details, null, 2)}` : ''}`);
}

function evaluateWithExecutionPlanIntake(intake) {
  const acceptanceCase = {
    id: 'diagnostic-intake-smoke',
    title: 'Acceptance diagnostic intake smoke',
    userInput: '帮我做详情页',
    mode: 'offline',
    tags: ['acceptance', 'diagnostic-intake'],
    expectation: { shouldUseTools: false }
  };
  const bundle = buildAgentRunDebugBundleFromMessage({
    acceptanceCase,
    message: {
      content: '已记录执行计划检查。',
      agentDiagnosticRecord: {
        version: 'agent-diagnostic-record/v0',
        recordKeys: ['businessSkillExecutionPlanIntake'],
        payloadRedacted: true,
        warnings: [],
        businessSkillExecutionPlanIntake: intake
      }
    }
  });
  return evaluateAgentAcceptance(acceptanceCase, bundle);
}

const validReport = evaluateWithExecutionPlanIntake({
  status: 'ready',
  runRecordOnly: true,
  userVisible: false,
  canClaimDesignQuality: false,
  requiredNextChecks: ['photoshop_readback'],
  blockers: []
});
assert(validReport.runRecords.businessSkillExecutionPlanIntake?.status === 'ready', 'acceptance should expose the actual verification intake', validReport);
assert(!Object.prototype.hasOwnProperty.call(validReport.runRecords, 'businessSkillVisualObservationControlDecision'), 'removed visual control decision must not be exported', validReport);

const invalidReport = evaluateWithExecutionPlanIntake({
  status: 'ready',
  runRecordOnly: false,
  userVisible: false,
  canClaimDesignQuality: false,
  requiredNextChecks: [],
  blockers: []
});
assert(invalidReport.status === 'failed', 'invalid execution-plan intake boundary should fail acceptance', invalidReport);
assert(invalidReport.blockers.some((item) => item.includes('control-only')), 'acceptance should explain the actual intake boundary failure', invalidReport);

console.log(JSON.stringify({
  success: true,
  checks: [
    'acceptance evaluates the actual execution-plan verification intake',
    'removed visual control decision is absent from run records',
    'invalid verification intake boundaries still fail acceptance'
  ]
}, null, 2));
