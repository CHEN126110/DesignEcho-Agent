'use strict';

const assert = require('assert');
const path = require('path');

if (!globalThis.window) globalThis.window = {};
const memoryStorage = new Map();
if (!globalThis.localStorage) {
  globalThis.localStorage = {
    getItem: (key) => memoryStorage.has(String(key)) ? memoryStorage.get(String(key)) : null,
    setItem: (key, value) => memoryStorage.set(String(key), String(value)),
    removeItem: (key) => memoryStorage.delete(String(key)),
    clear: () => memoryStorage.clear()
  };
}
globalThis.window.localStorage = globalThis.localStorage;

require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '..', 'tsconfig.main.json')
});

const root = path.resolve(__dirname, '..');
const {
  buildRuntimeDeliveryReceipt,
  verifyRuntimeDelivery,
  readRuntimeDeliveryReceipt
} = require(path.join(root, 'src', 'shared', 'agent-runtime-v5', 'runtime-delivery-receipt.ts'));
const {
  resolveRuntimeExecutionTarget
} = require(path.join(root, 'src', 'shared', 'agent-runtime-v5', 'runtime-execution-target.ts'));
const {
  Agent
} = require(path.join(root, 'src', 'renderer', 'services', 'agent-runtime', 'agent.ts'));

const SOURCE_REF = { documentId: 101, historyStateId: 3001 };
const OTHER_REVISION_REF = { documentId: 101, historyStateId: 3002 };
const REOPENED_DOCUMENT_REF = { documentId: 303, historyStateId: 3001 };

const receipt = buildRuntimeDeliveryReceipt({
  status: 'ready',
  outputs: ['editable_design_document', 'replication_report'],
  resultRefs: [
    'workflow:layout-replication:document-change',
    'workflow:layout-replication:replication-report'
  ],
  sourceHistoryStateRef: SOURCE_REF
});
assert.strictEqual(receipt.status, 'ready');
assert.strictEqual(receipt.version, 'runtime-delivery-receipt/v1');
assert.deepStrictEqual(receipt.sourceHistoryStateRef, SOURCE_REF);
assert.strictEqual(receipt.boundaries.completesDeliveryByItself, false);
assert.strictEqual(readRuntimeDeliveryReceipt({ success: true }), undefined);
assert.deepStrictEqual(
  readRuntimeDeliveryReceipt({ data: { runtimeDeliveryReceipt: receipt } }),
  receipt
);
const legacyReceipt = readRuntimeDeliveryReceipt({
  data: {
    runtimeDeliveryReceipt: {
      ...receipt,
      version: 'runtime-delivery-receipt/v0',
      sourceHistoryStateRef: undefined
    }
  }
});
assert.strictEqual(legacyReceipt.status, 'incomplete');
assert.strictEqual(legacyReceipt.version, 'runtime-delivery-receipt/v1');

const targetA = resolveRuntimeExecutionTarget({ result: { data: { documentId: 101 } } });
const targetB = resolveRuntimeExecutionTarget({ result: { documentInfo: { id: 202 } } });
const previewA = resolveRuntimeExecutionTarget({ result: { documentInfo: { id: 101 } } });
const requiredOutputs = ['editable_design_document', 'preview', 'replication_report'];

const receiptAlone = verifyRuntimeDelivery({
  requiredOutputs,
  receipt,
  receiptTarget: targetA
});
assert.strictEqual(receiptAlone.status, 'incomplete');
assert.deepStrictEqual(receiptAlone.missingOutputs, requiredOutputs);

const crossTargetPreview = verifyRuntimeDelivery({
  requiredOutputs,
  receipt,
  receiptTarget: targetA,
  reviewedPreviewTarget: targetB,
  reviewedPreviewHistoryStateRef: SOURCE_REF
});
assert.strictEqual(crossTargetPreview.status, 'incomplete');
assert.strictEqual(crossTargetPreview.reviewedPreviewBound, false);

const complete = verifyRuntimeDelivery({
  requiredOutputs,
  receipt,
  receiptTarget: targetA,
  reviewedPreviewTarget: previewA,
  reviewedPreviewHistoryStateRef: SOURCE_REF
});
assert.strictEqual(complete.status, 'passed');
assert.strictEqual(complete.targetBound, true);
assert.strictEqual(complete.reviewedPreviewBound, true);
assert.strictEqual(complete.sourceHistoryStateBound, true);
assert.deepStrictEqual(complete.missingOutputs, []);
assert(complete.confirmedOutputs.includes('delivery_record'));
assert.strictEqual(complete.boundaries.qualityVerdictAuthority, false);

const sameDocumentDifferentRevision = verifyRuntimeDelivery({
  requiredOutputs,
  receipt,
  receiptTarget: targetA,
  reviewedPreviewTarget: previewA,
  reviewedPreviewHistoryStateRef: OTHER_REVISION_REF
});
assert.strictEqual(sameDocumentDifferentRevision.status, 'incomplete');
assert.strictEqual(sameDocumentDifferentRevision.reviewedPreviewBound, true);
assert.strictEqual(sameDocumentDifferentRevision.sourceHistoryStateBound, false);

const reopenedDocument = verifyRuntimeDelivery({
  requiredOutputs,
  receipt,
  receiptTarget: targetA,
  reviewedPreviewTarget: previewA,
  reviewedPreviewHistoryStateRef: REOPENED_DOCUMENT_REF
});
assert.strictEqual(reopenedDocument.status, 'incomplete');
assert.strictEqual(reopenedDocument.sourceHistoryStateBound, false);

const issueReceipt = buildRuntimeDeliveryReceipt({
  status: 'ready',
  outputs: ['editable_design_document'],
  resultRefs: ['workflow:document-change'],
  issues: ['仍有失败元素']
});
assert.strictEqual(issueReceipt.status, 'incomplete');

function createDeliveryTraceHarness(requiredDeliveryOutputs, toolCallLog) {
  const agent = new Agent(
    {
      systemPrompt: 'Runtime delivery receipt integration smoke.',
      tools: [],
      modelId: 'test-model',
      maxIterations: 1,
      callbacks: {}
    },
    async () => ({ content: 'unused', toolCalls: [] }),
    async () => ({ success: true })
  );
  const traceEvents = [];
  agent.resolveRuntimeDesignBriefEffectiveContract = () => ({
    deliveryOutputs: requiredDeliveryOutputs
  });
  agent.appendStageTraceEvent = (event) => traceEvents.push(event);
  agent.toolCallLog = toolCallLog;
  return {
    append: () => agent.appendDeliveryStageTraceIfEligible({
      designVerdict: { status: 'passed' }
    }),
    traceEvents
  };
}

function buildReceiptLog() {
  return {
    name: 'layout-replication',
    arguments: {},
    result: {
      success: true,
      data: {
        documentId: 101,
        runtimeDeliveryReceipt: receipt
      }
    }
  };
}

function buildReviewedPreviewLog() {
  return {
    name: 'getCanvasSnapshot',
    arguments: {},
    result: {
      success: true,
      documentInfo: { id: 101 },
      historyStateRef: SOURCE_REF,
      agentVisualObservation: {
        version: 'agent-visual-observation/v1',
        status: 'observed_by_primary',
        reviewed: true,
        observer: 'primary_model',
        strategy: 'primary-self',
        toolName: 'getCanvasSnapshot'
      }
    }
  };
}

const rawSaveWithDeclaredOutputs = createDeliveryTraceHarness(
  requiredOutputs,
  [{ name: 'saveDocument', arguments: {}, result: { success: true } }]
);
rawSaveWithDeclaredOutputs.append();
assert.deepStrictEqual(
  rawSaveWithDeclaredOutputs.traceEvents,
  [],
  'Manifest 声明 requiredOutputs 时，普通 save_export 不能替代结构化 delivery receipt。'
);

const freshReceipt = createDeliveryTraceHarness(
  requiredOutputs,
  [buildReceiptLog(), buildReviewedPreviewLog()]
);
freshReceipt.append();
assert.strictEqual(freshReceipt.traceEvents.length, 1);
assert.strictEqual(freshReceipt.traceEvents[0].stage, 'E2');
assert.strictEqual(freshReceipt.traceEvents[0].outcome, 'passed');

const wrongRevisionReceipt = createDeliveryTraceHarness(
  requiredOutputs,
  [buildReceiptLog(), {
    ...buildReviewedPreviewLog(),
    result: {
      ...buildReviewedPreviewLog().result,
      historyStateRef: OTHER_REVISION_REF
    }
  }]
);
wrongRevisionReceipt.append();
assert.deepStrictEqual(
  wrongRevisionReceipt.traceEvents,
  [],
  '同一文档但 Host revision 不同的预览不能推进 E2。'
);

const rawSaveWithoutSourceRef = createDeliveryTraceHarness(
  [],
  [buildReviewedPreviewLog(), { name: 'saveDocument', arguments: {}, result: { success: true, documentId: 101 } }]
);
rawSaveWithoutSourceRef.append();
assert.deepStrictEqual(rawSaveWithoutSourceRef.traceEvents, []);

const rawSaveWithExactSourceRef = createDeliveryTraceHarness(
  [],
  [
    buildReviewedPreviewLog(),
    {
      name: 'saveDocument',
      arguments: {},
      result: { success: true, sourceHistoryStateRef: SOURCE_REF }
    }
  ]
);
rawSaveWithExactSourceRef.append();
assert.strictEqual(rawSaveWithExactSourceRef.traceEvents.length, 1);
assert.strictEqual(rawSaveWithExactSourceRef.traceEvents[0].stage, 'E2');

for (const laterMutation of [
  {
    name: 'setTextContent',
    arguments: { layerId: 9, text: 'receipt 后的新文案' },
    result: { success: true, data: { documentId: 101 } }
  },
  {
    name: 'saveDocument',
    arguments: {},
    result: { success: true, data: { documentId: 101 } }
  }
]) {
  const staleReceipt = createDeliveryTraceHarness(
    requiredOutputs,
    [buildReceiptLog(), laterMutation, buildReviewedPreviewLog()]
  );
  staleReceipt.append();
  assert.deepStrictEqual(
    staleReceipt.traceEvents,
    [],
    `receipt 后发生 ${laterMutation.name} 时，旧 receipt 必须失效。`
  );
}

console.log(JSON.stringify({
  success: true,
  receiptStatus: receipt.status,
  receiptAlone: receiptAlone.status,
  crossTargetPreview: crossTargetPreview.status,
  complete: complete.status,
  sameDocumentDifferentRevision: sameDocumentDifferentRevision.status,
  legacyReceipt: legacyReceipt.status,
  rawSaveWithDeclaredOutputs: 'rejected',
  rawSaveWithoutSourceRef: 'rejected',
  rawSaveWithExactSourceRef: rawSaveWithExactSourceRef.traceEvents[0]?.outcome,
  freshReceiptIntegration: freshReceipt.traceEvents[0]?.outcome,
  staleReceiptAfterWrite: 'rejected',
  staleReceiptAfterSave: 'rejected',
  boundary: 'explicit workflow receipt + same-target reviewed preview; declared outputs reject raw save; later writes invalidate stale receipt'
}, null, 2));
