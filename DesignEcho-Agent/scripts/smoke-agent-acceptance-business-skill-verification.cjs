const path = require('path');
require('ts-node').register({ transpileOnly: true, project: path.resolve(__dirname, '..', 'tsconfig.main.json') });

const {
  buildAgentDiagnosticRecord
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'agent-diagnostic-record.ts'));
const {
  buildAgentRunDebugBundleFromMessage,
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

function makeCase(id) {
  return {
    id,
    title: 'Business skill acceptance verification smoke',
    userInput: '帮我做详情页',
    mode: 'desktop_bridge',
    tags: ['acceptance', 'business-skill-verification'],
    expectation: {
      shouldUseTools: false
    }
  };
}

function makeBusinessSkillExecutionPlanIntake(overrides = {}) {
  return {
    version: 'business-skill-execution-plan-intake/v0',
    skillId: 'detail-page-design',
    status: 'executed_with_trace_needs_verification',
    runRecordOnly: true,
    userVisible: false,
    canClaimDesignQuality: false,
    mustNotChangeBusinessStrategy: true,
    mustNotChangeExecutor: true,
    planSummary: {
      hasDesignAgentOs: true,
      hasExecutionPlan: true,
      stepCount: 3,
      operations: ['placeImage', 'setText'],
      hasExecutionTrace: true,
      toolCallCount: 2,
      successfulToolCalls: 2,
      failedToolCalls: 0,
      hasVerificationReport: false
    },
    sourceRecords: ['design_agent_os_execution_plan', 'design_agent_os_execution_trace'],
    requiredNextChecks: ['screenshot_or_manual_review_required'],
    blockers: [],
    warnings: ['已有工具调用追踪，但仍需要截图、bounds 或人工验收。'],
    limitations: ['该 intake 是隐藏执行记录，不是模型思考，不进入 Pondering。'],
    verificationRefs: [],
    rawImageBase64: 'should-be-redacted',
    ...overrides
  };
}

function makeImagePlacementIntake(overrides = {}) {
  return {
    version: 'business-skill-image-placement-verification-intake/v0',
    skillId: 'detail-page-design',
    status: 'needs_actual_bounds',
    readOnly: true,
    userVisible: false,
    canClaimDesignQuality: false,
    requiredNextChecks: ['photoshop_actual_bounds_required'],
    blockers: [],
    warnings: ['缺少真实 Photoshop actualBounds 或截图。'],
    sourceRecords: [],
    imageData: 'should-be-redacted',
    ...overrides
  };
}

function makeBundle(acceptanceCase, diagnosticRecord) {
  return buildAgentRunDebugBundleFromMessage({
    acceptanceCase,
    message: {
      content: '已生成隐藏运行记录，仍需截图或人工验收。',
      agentDiagnosticRecord: diagnosticRecord
    }
  });
}

const diagnosticRecord = buildAgentDiagnosticRecord({
  businessSkillExecutionPlanIntake: makeBusinessSkillExecutionPlanIntake(),
  businessSkillImagePlacementVerificationIntake: makeImagePlacementIntake(),
  arbitraryRawImagePayload: 'top-level-raw-payload'
});

assert(diagnosticRecord, 'diagnostic record should be built for business skill acceptance intake');
assert(
  diagnosticRecord.recordKeys.includes('businessSkillExecutionPlanIntake'),
  'diagnostic record should include businessSkillExecutionPlanIntake',
  diagnosticRecord
);
assert(
  diagnosticRecord.recordKeys.includes('businessSkillImagePlacementVerificationIntake'),
  'diagnostic record should include businessSkillImagePlacementVerificationIntake',
  diagnosticRecord
);
assert(
  !JSON.stringify(diagnosticRecord).includes('should-be-redacted')
    && !JSON.stringify(diagnosticRecord).includes('top-level-raw-payload'),
  'diagnostic record should redact raw payload-like fields',
  diagnosticRecord
);

const validCase = makeCase('business-skill-verification-valid');
const validBundle = makeBundle(validCase, diagnosticRecord);
const validReport = evaluateAgentAcceptance(validCase, validBundle);
const validExport = buildAgentAcceptanceDebugExport({ bundle: validBundle, report: validReport });

assert(
  validReport.runRecords.businessSkillExecutionPlanIntake?.status === 'executed_with_trace_needs_verification',
  'acceptance report should expose execution plan intake status',
  validReport.runRecords
);
assert(
  validReport.runRecords.businessSkillImagePlacementVerificationIntake?.status === 'needs_actual_bounds',
  'acceptance report should expose image placement intake status',
  validReport.runRecords
);
assert(
  validExport.acceptanceDiagnostics.businessSkillExecutionPlanIntake?.status === 'executed_with_trace_needs_verification',
  'acceptance diagnostics should preserve execution plan intake',
  validExport.acceptanceDiagnostics
);
assert(
  validExport.acceptanceDiagnostics.executionPlanIntakeBoundaryOk === true,
  'acceptance diagnostics should mark execution plan intake boundary as ok',
  validExport.acceptanceDiagnostics
);
assert(
  validExport.acceptanceDiagnostics.imagePlacementIntakeBoundaryOk === true,
  'acceptance diagnostics should mark image placement intake boundary as ok',
  validExport.acceptanceDiagnostics
);
assert(
  validReport.warnings.some((warning) => warning.includes('business skill execution plan verification')),
  'acceptance report should surface execution plan verification as developer warning',
  validReport.warnings
);

const invalidCase = makeCase('business-skill-verification-invalid');
const invalidDiagnosticRecord = buildAgentDiagnosticRecord({
  businessSkillExecutionPlanIntake: makeBusinessSkillExecutionPlanIntake({
    userVisible: true,
    canClaimDesignQuality: true
  })
});
const invalidBundle = makeBundle(invalidCase, invalidDiagnosticRecord);
const invalidReport = evaluateAgentAcceptance(invalidCase, invalidBundle);
const invalidExport = buildAgentAcceptanceDebugExport({ bundle: invalidBundle, report: invalidReport });

assert(
  invalidReport.status === 'failed',
  'acceptance report should fail when business skill intake violates hidden/no-quality boundary',
  invalidReport
);
assert(
  invalidReport.blockers.some((blocker) => blocker.includes('canClaimDesignQuality=false')),
  'acceptance report should explain no-quality-claim boundary violations',
  invalidReport.blockers
);
assert(
  invalidExport.acceptanceDiagnostics.executionPlanIntakeBoundaryOk === false,
  'acceptance diagnostics should expose execution plan intake boundary violation',
  invalidExport.acceptanceDiagnostics
);

console.log(JSON.stringify({
  success: true,
  checks: [
    'business skill execution plan and placement intakes enter developer diagnostics',
    'raw payload-like fields remain redacted',
    'acceptance report and diagnostics expose intake statuses',
    'acceptance report fails hidden/no-quality boundary violations'
  ]
}, null, 2));
