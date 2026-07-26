const path = require('path');
require('ts-node').register({ transpileOnly: true, project: path.resolve(__dirname, '..', 'tsconfig.main.json') });

const {
  buildAgentRunDebugBundleFromMessage,
  evaluateAgentAcceptance
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'agent-acceptance-contracts.ts'));
const { buildAgentAcceptanceDebugExport } = require(path.resolve(__dirname, '..', 'src', 'shared', 'agent-acceptance-export.ts'));

function assert(condition, message, details) {
  if (!condition) throw new Error(`${message}${details ? `\n${JSON.stringify(details, null, 2)}` : ''}`);
}

const acceptanceCase = {
  id: 'diagnostic-export-intake',
  title: 'Acceptance diagnostic export smoke',
  userInput: '帮我做详情页',
  mode: 'desktop_bridge',
  tags: ['acceptance', 'desktop-export'],
  expectation: { shouldUseTools: false }
};
const bundle = buildAgentRunDebugBundleFromMessage({
  acceptanceCase,
  message: {
    content: '已记录版式放置检查。',
    agentDiagnosticRecord: {
      version: 'agent-diagnostic-record/v0',
      recordKeys: ['businessSkillImagePlacementVerificationIntake'],
      payloadRedacted: true,
      warnings: [],
      businessSkillImagePlacementVerificationIntake: {
        status: 'ready',
        readOnly: true,
        userVisible: false,
        canClaimDesignQuality: false,
        requiredNextChecks: ['canvas_snapshot'],
        blockers: []
      }
    }
  }
});
const report = evaluateAgentAcceptance(acceptanceCase, bundle);
const debugExport = buildAgentAcceptanceDebugExport({ bundle, report });

assert(debugExport.acceptanceDiagnostics.version === 'agent-acceptance-diagnostics/v0', 'debug export should include diagnostics', debugExport);
assert(debugExport.acceptanceDiagnostics.imagePlacementIntakeBoundaryOk === true, 'debug export should evaluate image placement intake', debugExport.acceptanceDiagnostics);
assert(debugExport.acceptanceDiagnostics.businessSkillImagePlacementVerificationIntake?.status === 'ready', 'debug export should preserve the verification intake', debugExport.acceptanceDiagnostics);
assert(!Object.prototype.hasOwnProperty.call(debugExport.acceptanceDiagnostics, 'businessSkillVisualObservationControlDecision'), 'deleted visual control decision must not be exported', debugExport.acceptanceDiagnostics);
assert(!Object.prototype.hasOwnProperty.call(debugExport.acceptanceDiagnostics, 'qualityClaimBoundaryOk'), 'deleted control-specific boundary must not remain', debugExport.acceptanceDiagnostics);
assert(!Object.prototype.hasOwnProperty.call(debugExport.acceptanceDiagnostics, 'resultOnlyBoundaryOk'), 'deleted control-specific boundary must not remain', debugExport.acceptanceDiagnostics);
assert(debugExport.bundle === bundle && debugExport.report === report, 'debug export should preserve bundle and report objects');

console.log(JSON.stringify({
  success: true,
  checks: [
    'debug export reports actual verification intake boundaries',
    'deleted visual control decision and its derived boundary fields are absent',
    'debug export preserves existing bundle and report objects'
  ]
}, null, 2));
