const path = require('path');
require('ts-node').register({ transpileOnly: true, project: path.resolve(__dirname, '..', 'tsconfig.main.json') });

const { buildAgentDiagnosticRecord } = require(path.resolve(__dirname, '..', 'src', 'shared', 'agent-diagnostic-record.ts'));
const {
  buildAgentRunDebugBundleFromMessage,
  evaluateAgentAcceptance
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'agent-acceptance-contracts.ts'));

function assert(condition, message, details) {
  if (!condition) throw new Error(`${message}${details ? `\n${JSON.stringify(details, null, 2)}` : ''}`);
}

const diagnosticRecord = buildAgentDiagnosticRecord({
  businessVisualContext: {
    version: 'business-skill-visual-context/v0',
    scenario: 'detail-page',
    status: 'needs_visual_insight',
    requiredInputs: ['visual_understanding'],
    warnings: ['image summary is missing'],
    observations: [],
    rawImageBase64: 'should-be-redacted'
  },
  businessSkillVisualObservationControlDecision: {
    decision: 'legacy-control-should-not-survive'
  },
  arbitraryRuntimeBlob: { shouldNotLeak: true }
});

assert(diagnosticRecord, 'supported visual context should create a diagnostic record');
assert(diagnosticRecord.recordKeys.includes('businessVisualContext'), 'visual context should remain available to diagnostics', diagnosticRecord);
assert(!diagnosticRecord.recordKeys.includes('businessSkillVisualObservationControlDecision'), 'deleted control decision key must be rejected', diagnosticRecord);
assert(!Object.prototype.hasOwnProperty.call(diagnosticRecord, 'businessSkillVisualObservationControlDecision'), 'deleted control decision must not survive as an optional field', diagnosticRecord);
assert(!JSON.stringify(diagnosticRecord).includes('should-be-redacted'), 'diagnostic record should redact raw image payloads', diagnosticRecord);
assert(!Object.prototype.hasOwnProperty.call(diagnosticRecord, 'arbitraryRuntimeBlob'), 'diagnostic record should ignore arbitrary runtime blobs', diagnosticRecord);
assert(buildAgentDiagnosticRecord({ businessVisualObservationGate: { status: 'legacy' } }) === undefined, 'diagnostics must not retain a compatibility read for the legacy gate field');

const acceptanceCase = {
  id: 'business-visual-context-diagnostic-smoke',
  title: 'Business visual context diagnostic smoke',
  userInput: '帮我做一个详情页',
  mode: 'offline',
  tags: ['business-skill', 'diagnostic-record'],
  expectation: { shouldUseTools: false }
};
const bundle = buildAgentRunDebugBundleFromMessage({
  acceptanceCase,
  message: {
    content: '已记录当前素材上下文。',
    agentDiagnosticRecord: diagnosticRecord
  }
});
const report = evaluateAgentAcceptance(acceptanceCase, bundle);
assert(bundle.diagnosticRecord.recordKeys.includes('businessVisualContext'), 'debug bundle should preserve visual context', bundle.diagnosticRecord);
assert(!report.runRecords.diagnosticRecordKeys.includes('businessSkillVisualObservationControlDecision'), 'acceptance report must not expose the deleted control key', report);

console.log(JSON.stringify({
  success: true,
  checks: [
    'diagnostics preserve visual context without restoring execution authority',
    'deleted visual control decision is rejected rather than retained for compatibility',
    'raw image payload-like fields remain redacted'
  ]
}, null, 2));
