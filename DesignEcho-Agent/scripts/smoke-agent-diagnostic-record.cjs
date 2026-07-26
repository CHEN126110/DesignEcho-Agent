const path = require('path');
require('ts-node').register({ transpileOnly: true, project: path.resolve(__dirname, '..', 'tsconfig.main.json') });

const {
  buildAgentDiagnosticRecord
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'agent-diagnostic-record.ts'));
const {
  buildAgentRunDebugBundleFromMessage
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'agent-acceptance-contracts.ts'));

function assert(condition, message, details) {
  if (!condition) {
    const suffix = details ? `\n${JSON.stringify(details, null, 2)}` : '';
    throw new Error(`${message}${suffix}`);
  }
}

const detailPageSkillReadiness = {
  version: 'detail-page-skill-readiness/v0',
  status: 'needs_context',
  canInspect: true,
  canExecute: false,
  requiredNextEvidence: ['project_visual_evidence'],
  blockers: [],
  warnings: ['缺少项目视觉证据'],
  rawImageBase64: 'should-be-redacted',
  nested: {
    imageData: 'should-be-redacted'
  }
};

const diagnosticRecord = buildAgentDiagnosticRecord({
  detailPageSkillReadiness,
  agentResumeReadonlyContextExecutor: {
    version: 'agent-resume-readonly-context-executor/v0',
    status: 'completed_readonly_refresh',
    evidenceOnly: true,
    rawPayloadRedacted: true,
    mustNotRunWriteTools: true,
    evidence: {
      documentSnapshot: {
        rawPayload: 'should-be-redacted',
        rawPayloadRedacted: true
      }
    }
  },
  agentResumePlanning: {
    version: 'agent-resume-planning/v0',
    status: 'model_resume_plan_available',
    evidenceOnly: true,
    rawPayloadRedacted: true,
    shouldRunPhotoshop: false,
    mustNotRunWriteTools: true,
    modelPlanText: '{"photoshopWritesAllowed":false}'
  },
  agentResumeExecutionGate: {
    version: 'agent-resume-execution-gate/v0',
    status: 'blocked_pending_user_approval',
    evidenceOnly: true,
    rawPayloadRedacted: true,
    shouldRunPhotoshop: false,
    mustNotRunWriteTools: true,
    canDispatchWriteTools: false,
    executionPlan: {
      rawPayload: 'should-be-redacted',
      rawPayloadRedacted: true
    }
  },
  agentResumeControlledExecutionRequest: {
    version: 'agent-resume-controlled-execution-request/v0',
    status: 'blocked_execution_gate_not_ready',
    evidenceOnly: true,
    rawPayloadRedacted: true,
    shouldRunPhotoshop: false,
    mustNotRunWriteTools: true,
    operationRequests: [
      {
        toolName: 'reorderLayer',
        params: {
          rawPayload: 'should-be-redacted',
          rawPayloadRedacted: true
        }
      }
    ]
  },
  agentResumeControlledExecutionRunner: {
    version: 'agent-resume-controlled-execution-runner/v0',
    status: 'blocked_request_not_ready',
    evidenceOnly: true,
    rawPayloadRedacted: true,
    shouldRunPhotoshop: false,
    executedWriteTools: [],
    operationRequests: [
      {
        toolName: 'reorderLayer',
        params: {
          rawPayload: 'should-be-redacted',
          rawPayloadRedacted: true
        }
      }
    ]
  },
  skuConfiguredExecutionPlan: {
    schema: 'sku-configured-execution-plan/v0',
    status: 'ready_configured_execution_plan',
    configFileName: '2色SKU.csv',
    comboExecutionCount: 1,
    noteExecutionCount: 1,
    rawPayload: 'should-be-redacted',
    boundaries: {
      readOnly: true,
      claimsDesignQuality: false
    }
  },
  skuExecutionManifest: [
    {
      size: 2,
      comboCount: 1,
      plannedActions: ['combo', 'self-select-note'],
      status: 'ready',
      blockers: []
    }
  ],
  skuExportReadback: {
    schema: 'sku-export-readback/v0',
    status: 'ready_for_review',
    expectedCount: 2,
    readyCount: 2,
    rawImageBase64: 'should-be-redacted',
    fileProbes: [
      {
        fileName: '2双-白色+黑色.jpg',
        status: 'ready_for_review',
        width: 800,
        height: 800
      }
    ]
  },
  skuVisualReviewIntake: {
    version: 'sku-visual-review-intake/v0',
    status: 'ready_for_human_review',
    canClaimDesignQuality: false,
    rawPayload: 'should-be-redacted'
  },
  imageData: 'top-level-raw-image',
  irrelevantRuntimeBlob: { ok: true }
});

assert(diagnosticRecord, 'diagnostic record should be built when a supported key exists');
assert(diagnosticRecord.version === 'agent-diagnostic-record/v0', 'diagnostic record should expose a stable version', diagnosticRecord);
assert(diagnosticRecord.payloadRedacted === true, 'diagnostic record should mark payload redaction', diagnosticRecord);
assert(
  diagnosticRecord.recordKeys.includes('detailPageSkillReadiness'),
  'diagnostic record should list safe record keys',
  diagnosticRecord
);
assert(
  diagnosticRecord.recordKeys.includes('agentResumeReadonlyContextExecutor')
    && diagnosticRecord.recordKeys.includes('agentResumePlanning')
    && diagnosticRecord.recordKeys.includes('agentResumeExecutionGate')
    && diagnosticRecord.recordKeys.includes('agentResumeControlledExecutionRequest')
    && diagnosticRecord.recordKeys.includes('agentResumeControlledExecutionRunner'),
  'diagnostic record should include AGENT-168 resume record keys',
  diagnosticRecord
);
assert(
  diagnosticRecord.recordKeys.includes('skuConfiguredExecutionPlan')
    && diagnosticRecord.recordKeys.includes('skuExecutionManifest')
    && diagnosticRecord.recordKeys.includes('skuExportReadback')
    && diagnosticRecord.recordKeys.includes('skuVisualReviewIntake'),
  'diagnostic record should include SKU execution/readback/review record keys for ChatPanel acceptance',
  diagnosticRecord
);
assert(
  diagnosticRecord.skuConfiguredExecutionPlan?.status === 'ready_configured_execution_plan'
    && diagnosticRecord.skuConfiguredExecutionPlan?.comboExecutionCount === 1
    && diagnosticRecord.skuExecutionManifest?.[0]?.status === 'ready'
    && diagnosticRecord.skuExportReadback?.status === 'ready_for_review'
    && diagnosticRecord.skuVisualReviewIntake?.status === 'ready_for_human_review',
  'diagnostic record should preserve sanitized SKU execution/readback/review status fields',
  diagnosticRecord
);
assert(
  diagnosticRecord.agentResumeReadonlyContextExecutor.rawPayloadRedacted === true
    && diagnosticRecord.agentResumePlanning.rawPayloadRedacted === true
    && diagnosticRecord.agentResumeExecutionGate.rawPayloadRedacted === true
    && diagnosticRecord.agentResumeControlledExecutionRequest.rawPayloadRedacted === true
    && diagnosticRecord.agentResumeControlledExecutionRunner.rawPayloadRedacted === true,
  'diagnostic record should preserve payload-redaction booleans on resume records',
  diagnosticRecord
);
assert(
  !JSON.stringify(diagnosticRecord).includes('should-be-redacted')
    && !JSON.stringify(diagnosticRecord).includes('top-level-raw-image'),
  'diagnostic record should redact raw image payload-like fields',
  diagnosticRecord
);
assert(
  !Object.prototype.hasOwnProperty.call(diagnosticRecord, 'irrelevantRuntimeBlob'),
  'diagnostic record should keep an allowlist instead of copying arbitrary result data',
  diagnosticRecord
);

const bundle = buildAgentRunDebugBundleFromMessage({
  acceptanceCase: {
    id: 'diagnostic-record-smoke',
    title: 'Diagnostic record smoke',
    userInput: '检查详情页模板',
    mode: 'offline',
    tags: ['diagnostic-record'],
    expectation: {
      shouldUseTools: false
    }
  },
  message: {
    content: '已检查，需要补充视觉证据。',
    agentDiagnosticRecord: diagnosticRecord
  }
});

assert(bundle.diagnosticRecord, 'acceptance debug bundle should carry the diagnostic record');
assert(
  bundle.diagnosticRecord.recordKeys.includes('detailPageSkillReadiness'),
  'acceptance debug bundle should keep the detail-page readiness record key',
  bundle.diagnosticRecord
);
assert(
  bundle.diagnosticRecord.recordKeys.includes('agentResumeReadonlyContextExecutor')
    && bundle.diagnosticRecord.recordKeys.includes('agentResumePlanning')
    && bundle.diagnosticRecord.recordKeys.includes('agentResumeExecutionGate')
    && bundle.diagnosticRecord.recordKeys.includes('agentResumeControlledExecutionRequest')
    && bundle.diagnosticRecord.recordKeys.includes('agentResumeControlledExecutionRunner'),
  'acceptance debug bundle should keep AGENT-168 resume record keys',
  bundle.diagnosticRecord
);
assert(
  bundle.diagnosticRecord.recordKeys.includes('skuConfiguredExecutionPlan')
    && bundle.diagnosticRecord.recordKeys.includes('skuExecutionManifest')
    && bundle.diagnosticRecord.recordKeys.includes('skuExportReadback')
    && bundle.diagnosticRecord.recordKeys.includes('skuVisualReviewIntake'),
  'acceptance debug bundle should keep SKU execution/readback/review record keys',
  bundle.diagnosticRecord
);

console.log(JSON.stringify({
  success: true,
  checks: [
    'safe diagnostic record is built from whitelisted result data',
    'raw image payload-like fields are redacted',
    'AGENT-168 resume record keys are preserved',
    'SKU execution/readback/review record keys are preserved for ChatPanel acceptance',
    'acceptance debug bundle preserves the diagnostic record'
  ]
}, null, 2));
