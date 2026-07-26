#!/usr/bin/env node

const path = require('path');

require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '..', 'tsconfig.main.json')
});

const repoRoot = path.resolve(__dirname, '..');

const {
  createMainImageLivePhotoshopToolAdapter
} = require(path.join(repoRoot, 'src', 'renderer', 'services', 'skill-executors', 'main-image-live-photoshop-tool-adapter.ts'));
const {
  buildMainImageLivePhotoshopAdapterContract
} = require(path.join(repoRoot, 'src', 'shared', 'main-image-live-photoshop-adapter-contract.ts'));
const {
  runMainImageLiveExecutor
} = require(path.join(repoRoot, 'src', 'shared', 'main-image-live-executor-runner.ts'));

function assert(condition, message, details) {
  if (!condition) {
    const suffix = details ? `\n${JSON.stringify(details, null, 2)}` : '';
    throw new Error(`${message}${suffix}`);
  }
}

function createOperation(index, requestId, tool, phase, payloadPreview, groupPath = []) {
  return {
    id: `live-request-${String(index).padStart(3, '0')}-${requestId}`,
    sourceDryRunId: `dry-run-${String(index).padStart(3, '0')}-${requestId}`,
    requestId,
    tool,
    phase,
    documentName: 'smoke-disposable-doc',
    groupPath,
    payloadPreview,
    requiredReadback: tool === 'transformLayer' ? ['actualBounds'] : ['documentInfo'],
    requiredPostRunReadbackTools: tool === 'transformLayer'
      ? ['getLayerProperties']
      : ['getDocumentInfo', 'getLayerHierarchy'],
    sourceContextIds: ['smoke'],
    dispatchBoundary: 'smoke-only',
    actualResult: null
  };
}

function buildCheckpoint() {
  const operationRequests = [
    createOperation(1, 'create-doc', 'createDocument', 'document', {
      documentName: 'smoke-disposable-doc',
      canvasSize: { width: 800, height: 800 }
    }),
    createOperation(2, 'create-parent-group', 'createGroup', 'group', {
      groupPath: ['click_conversion_group']
    }, ['click_conversion_group']),
    createOperation(3, 'create-child-group', 'createGroup', 'group', {
      groupPath: ['click_conversion_group', 'click_1x1_variant']
    }, ['click_conversion_group', 'click_1x1_variant']),
    createOperation(4, 'place-hero', 'placeImage', 'asset', {
      groupPath: ['click_conversion_group', 'click_1x1_variant'],
      asset: {
        name: 'white-sock.jpg',
        path: 'C:/project/assets/white-sock.jpg'
      }
    }, ['click_conversion_group', 'click_1x1_variant']),
    createOperation(5, 'transform-hero', 'transformLayer', 'transform', {
      scalePercent: 82,
      destinationBox: {
        left: 120,
        top: 240,
        right: 620,
        bottom: 640,
        width: 500,
        height: 400
      }
    }, ['click_conversion_group', 'click_1x1_variant']),
    createOperation(6, 'export-child-group', 'exportGroup', 'export', {
      groupPath: ['click_conversion_group', 'click_1x1_variant'],
      outputDir: 'C:/Exports',
      exportSpecId: 'click_1x1',
      exportSize: { width: 800, height: 800 }
    }, ['click_conversion_group', 'click_1x1_variant'])
  ];

  return {
    version: 'main-image-live-executor-checkpoint/v0',
    skillId: 'main-image-design',
    scene: 'ecommerce-socks',
    status: 'ready_for_live_executor_run',
    canStartLiveExecutor: true,
    checkpointOnly: true,
    noPhotoshopWrites: true,
    mustNotExecutePhotoshop: true,
    liveExecutionRequiresSeparateRunner: true,
    canClaimOutputQuality: false,
    canClaimDesignComplete: false,
    operationRequests,
    operationCount: operationRequests.length,
    readbackTools: ['getDocumentInfo', 'getLayerHierarchy', 'getLayerProperties', 'getAcceptanceSnapshot'],
    readbackRequirements: ['documentInfo', 'actualBounds'],
    runGuard: {
      executionScope: 'disposable-document',
      approvedLiveExecution: true,
      photoshopConnected: true,
      documentWriteAvailable: true,
      maxOperationCount: 20,
      stopOnFirstFailure: true,
      requireReadbackAfterEachOperation: true,
      requireFinalAcceptanceSnapshot: true,
      requireManualReviewBeforeQualityClaim: true,
      failurePolicy: 'smoke'
    },
    blockers: [],
    warnings: [],
    limitations: [],
    sourceNotes: [],
    verificationReport: {
      reportId: 'smoke',
      scenario: 'main-image',
      status: 'passed',
      scope: 'task',
      summary: 'smoke',
      checks: [],
      blockers: [],
      warnings: [],
      limitations: [],
      sourceNotes: []
    }
  };
}

function buildTwoDocumentSameGroupPathCheckpoint() {
  const operationRequests = [
    createOperation(1, 'doc-a', 'createDocument', 'document', {
      documentName: 'doc-a',
      canvasSize: { width: 800, height: 800 }
    }),
    createOperation(2, 'doc-a-parent', 'createGroup', 'group', {
      groupPath: ['点击图']
    }, ['点击图']),
    createOperation(3, 'doc-a-child', 'createGroup', 'group', {
      groupPath: ['点击图', '点击图-1']
    }, ['点击图', '点击图-1']),
    createOperation(4, 'doc-b', 'createDocument', 'document', {
      documentName: 'doc-b',
      canvasSize: { width: 800, height: 800 }
    }),
    createOperation(5, 'doc-b-parent', 'createGroup', 'group', {
      groupPath: ['点击图']
    }, ['点击图']),
    createOperation(6, 'doc-b-child', 'createGroup', 'group', {
      groupPath: ['点击图', '点击图-1']
    }, ['点击图', '点击图-1'])
  ];

  return {
    ...buildCheckpoint(),
    operationRequests,
    operationCount: operationRequests.length
  };
}

function buildReadyContract(checkpoint) {
  return buildMainImageLivePhotoshopAdapterContract({
    checkpoint,
    availableToolNames: [
      'createDocument',
      'createGroup',
      'moveLayerToGroup',
      'placeImage',
      'transformLayer',
      'moveLayer',
      'exportGroup',
      'getDocumentInfo',
      'getLayerHierarchy',
      'getLayerProperties',
      'getAcceptanceSnapshot'
    ]
  });
}

function makeFakeExecuteTool(options = {}) {
  const calls = [];
  let nextLayerId = 100;
  let documentId = 10;

  async function executeTool(toolName, params) {
    calls.push({ toolName, params });
    if (options.failTool === toolName) {
      return { success: false, error: `forced failure: ${toolName}` };
    }
    if (toolName === 'createDocument') {
      return { success: true, documentId: documentId++ };
    }
    if (toolName === 'createGroup') {
      return { success: true, layerId: nextLayerId++ };
    }
    if (toolName === 'placeImage') {
      return { success: true, layerId: nextLayerId++ };
    }
    if (toolName === 'transformLayer') {
      return { success: true, layerId: params.layerId || nextLayerId - 1, actualBounds: { left: 120, top: 240, right: 620, bottom: 640 } };
    }
    if (toolName === 'moveLayer') {
      return { success: true, layerId: params.layerId };
    }
    if (toolName === 'moveLayerToGroup') {
      return { success: true, layerId: params.layerId, newParentId: params.targetGroupId };
    }
    if (toolName === 'exportGroup') {
      return { success: true, outputPath: params.outputPath };
    }
    if (toolName === 'getLayerProperties') {
      return { success: true, properties: { id: params.layerId, bounds: { left: 120, top: 240, right: 620, bottom: 640 } } };
    }
    if (toolName === 'getLayerHierarchy') {
      return { success: true, layers: [] };
    }
    if (toolName === 'getDocumentInfo') {
      return { success: true, id: 10, width: 800, height: 800 };
    }
    if (toolName === 'getAcceptanceSnapshot') {
      return { success: true, document: { id: 10 }, layers: [] };
    }
    return { success: true };
  }

  return { calls, executeTool };
}

function findCall(calls, toolName, predicate = () => true) {
  return calls.find((call) => call.toolName === toolName && predicate(call.params));
}

async function run() {
  const checkpoint = buildCheckpoint();
  const contract = buildReadyContract(checkpoint);
  assert(contract.status === 'ready_for_disposable_photoshop_adapter', 'fixture contract must be adapter-ready', contract);

  const missingApproval = createMainImageLivePhotoshopToolAdapter({
    adapterContract: contract,
    executeTool: async () => ({ success: true }),
    executionScope: 'disposable-document'
  });
  assert(missingApproval.status === 'blocked_requires_explicit_live_approval', 'adapter must require explicit live approval', missingApproval);
  assert(missingApproval.adapter === null, 'blocked adapter must not be returned', missingApproval);

  const activeDocument = createMainImageLivePhotoshopToolAdapter({
    adapterContract: contract,
    executeTool: async () => ({ success: true }),
    approvedLiveAdapterRun: true,
    executionScope: 'active-document'
  });
  assert(activeDocument.status === 'blocked_non_disposable_scope', 'adapter must block non-disposable scope', activeDocument);

  const fake = makeFakeExecuteTool();
  const wired = createMainImageLivePhotoshopToolAdapter({
    adapterContract: contract,
    executeTool: fake.executeTool,
    approvedLiveAdapterRun: true,
    executionScope: 'disposable-document'
  });
  assert(wired.status === 'ready_for_guarded_live_adapter', 'adapter should be ready when all guards pass', wired);
  assert(wired.adapter, 'ready wiring must expose runner adapter', wired);
  assert(wired.canRunProduction === false, 'guarded adapter must not allow production by default', wired);
  assert(wired.canClaimOutputQuality === false, 'guarded adapter must not claim quality', wired);

  const result = await runMainImageLiveExecutor({ checkpoint, adapter: wired.adapter });
  assert(result.status === 'completed_requires_review', 'guarded adapter run should complete but require review', result);
  assert(result.executedOperationCount === checkpoint.operationCount, 'runner should execute every operation', result);
  assert(result.canClaimOutputQuality === false, 'runner result must not claim quality', result);

  assert(findCall(fake.calls, 'createDocument'), 'createDocument should be called', fake.calls);
  assert(findCall(fake.calls, 'createGroup', (params) => params.groupName === 'click_conversion_group'), 'parent group should be created', fake.calls);
  assert(findCall(fake.calls, 'createGroup', (params) => params.groupName === 'click_1x1_variant'), 'child group should be created', fake.calls);
  assert(findCall(fake.calls, 'moveLayerToGroup', (params) => params.targetGroupId === 100), 'child group should move into parent group', fake.calls);
  assert(findCall(fake.calls, 'moveLayerToGroup', (params) => params.targetGroupId === 101), 'placed image should move into child group', fake.calls);
  assert(findCall(fake.calls, 'transformLayer', (params) => params.scaleUniform === 82), 'transform should use planned scale', fake.calls);
  assert(findCall(fake.calls, 'moveLayer', (params) => params.x === 120 && params.y === 240), 'destinationBox should map to moveLayer', fake.calls);
  const exportCall = findCall(fake.calls, 'exportGroup', (params) => String(params.outputPath || '').endsWith('/click_1x1.png'));
  assert(exportCall, 'exportGroup should use deterministic outputPath', fake.calls);
  assert(exportCall.params.layerId === 101, 'exportGroup should resolve planned groupPath to the created Photoshop group layerId', fake.calls);
  assert(!Array.isArray(exportCall.params.groupPath) || exportCall.params.groupPath.length === 0, 'exportGroup should not rely on ambiguous groupPath once runtime layerId is known', fake.calls);
  assert(findCall(fake.calls, 'getAcceptanceSnapshot'), 'final acceptance snapshot should be captured', fake.calls);

  const failureFake = makeFakeExecuteTool({ failTool: 'moveLayer' });
  const failureWired = createMainImageLivePhotoshopToolAdapter({
    adapterContract: contract,
    executeTool: failureFake.executeTool,
    approvedLiveAdapterRun: true,
    executionScope: 'disposable-document'
  });
  const failure = await runMainImageLiveExecutor({ checkpoint, adapter: failureWired.adapter });
  assert(failure.status === 'failed_operation', 'tool failure should fail runner operation', failure);
  assert(failure.canClaimDesignComplete === false, 'failed runner must not claim completion', failure);

  const mismatchCalls = [];
  const mismatchWired = createMainImageLivePhotoshopToolAdapter({
    adapterContract: contract,
    executeTool: async (toolName, params) => {
      mismatchCalls.push({ toolName, params });
      if (toolName === 'createDocument') {
        return {
          success: true,
          documentId: 18010,
          name: 'SKU.psb',
          width: 800,
          height: 800,
          document: {
            id: 18010,
            name: 'SKU.psb',
            width: 800,
            height: 800
          }
        };
      }
      return { success: true, layerId: 999 };
    },
    approvedLiveAdapterRun: true,
    executionScope: 'disposable-document'
  });
  const mismatch = await runMainImageLiveExecutor({ checkpoint, adapter: mismatchWired.adapter });
  assert(mismatch.status === 'failed_operation', 'document identity mismatch should stop the runner at createDocument', mismatch);
  assert(
    mismatch.operationResults[0]?.error?.includes('createDocument_result_mismatch'),
    'createDocument mismatch should be surfaced as the real operation error',
    mismatch
  );
  assert(
    !mismatchCalls.some((call) => call.toolName === 'createGroup'),
    'runner must not continue to create groups in the wrong document after createDocument returns SKU.psb',
    mismatchCalls
  );

  const twoDocumentCheckpoint = buildTwoDocumentSameGroupPathCheckpoint();
  const twoDocumentContract = buildReadyContract(twoDocumentCheckpoint);
  const twoDocumentFake = makeFakeExecuteTool();
  const twoDocumentAdapter = createMainImageLivePhotoshopToolAdapter({
    adapterContract: twoDocumentContract,
    executeTool: twoDocumentFake.executeTool,
    approvedLiveAdapterRun: true,
    executionScope: 'disposable-document'
  });
  const twoDocumentResult = await runMainImageLiveExecutor({
    checkpoint: twoDocumentCheckpoint,
    adapter: twoDocumentAdapter.adapter
  });
  assert(twoDocumentResult.status === 'completed_requires_review', 'same group paths across separate documents should still execute', twoDocumentResult);
  const moveCalls = twoDocumentFake.calls.filter((call) => call.toolName === 'moveLayerToGroup');
  assert(
    moveCalls.some((call) => call.params.layerId === 101 && call.params.targetGroupId === 100),
    'first document child group should move into first document parent group',
    moveCalls
  );
  assert(
    moveCalls.some((call) => call.params.layerId === 103 && call.params.targetGroupId === 102),
    'second document child group must move into second document parent group, not a stale parent id from the first document',
    moveCalls
  );

  console.log(JSON.stringify({
    success: true,
    checks: [
      'guarded adapter blocks missing explicit live approval',
      'guarded adapter blocks non-disposable scope',
      'guarded adapter exposes runner adapter only after all guards pass',
      'adapter maps createDocument/createGroup/placeImage/transformLayer/moveLayer/exportGroup',
      'adapter resolves runtime group and layer ids without leaking placeholders',
      'adapter exports generated groups through stable Photoshop layerId instead of ambiguous groupPath',
      'adapter clears runtime group ids after every newly created disposable document',
      'adapter stops if createDocument returns a different document name instead of continuing in SKU.psb',
      'runner captures readback and final acceptance snapshot',
      'adapter failure propagates to runner failure',
      'adapter never claims production readiness or design quality'
    ]
  }, null, 2));
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
