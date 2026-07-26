#!/usr/bin/env node

const path = require('path');

require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '..', 'tsconfig.main.json')
});

const repoRoot = path.resolve(__dirname, '..');

const {
  runMainImageLiveExecutor
} = require(path.join(repoRoot, 'src', 'shared', 'main-image-live-executor-runner.ts'));
const {
  buildMainImageLiveExecutorCheckpoint
} = require(path.join(repoRoot, 'src', 'shared', 'main-image-live-executor-checkpoint.ts'));
const {
  buildMainImageStrategyInputs
} = require(path.join(repoRoot, 'src', 'shared', 'main-image-strategy-input-builder.ts'));

function assert(condition, message, details) {
  if (!condition) {
    const suffix = details ? `\n${JSON.stringify(details, null, 2)}` : '';
    throw new Error(`${message}${suffix}`);
  }
}

function assertNoRawPayload(value, label) {
  const serialized = JSON.stringify(value);
  const forbidden = ['raw-image-payload', 'base64-image-payload', 'data:image/'];
  const found = forbidden.filter((token) => serialized.includes(token));
  assert(found.length === 0, `${label} must redact raw image-like payloads: ${found.join(', ')}`, value);
}

const selectedAsset = {
  id: 'asset-1',
  name: 'white-slouch-socks-01.jpg',
  path: 'C:/project/assets/white-slouch-socks-01.jpg',
  role: 'project-image',
  width: 1600,
  height: 1600
};

const sizePlans = [
  {
    sizeKey: 'tmall-1x1-main-image',
    targetSize: { width: 1440, height: 1440 },
    subjectSize: { width: 1180, height: 720 },
    scale: 0.72,
    targetX: 130,
    targetY: 420,
    decisionReason: '1:1 square main image source size',
    smartLayoutPlanned: true,
    quickExportPlanned: true
  },
  {
    sizeKey: 'tmall-3x4-main-image',
    targetSize: { width: 1440, height: 1920 },
    subjectSize: { width: 1180, height: 720 },
    scale: 0.72,
    targetX: 130,
    targetY: 680,
    decisionReason: '3:4 vertical main image source size',
    smartLayoutPlanned: true,
    quickExportPlanned: true
  },
  {
    sizeKey: 'tmall-1200-main-image',
    targetSize: { width: 1440, height: 2560 },
    subjectSize: { width: 1180, height: 720 },
    scale: 0.72,
    targetX: 130,
    targetY: 920,
    decisionReason: '1200 folder 9:16 long vertical main image source size',
    smartLayoutPlanned: true,
    quickExportPlanned: true
  }
];

function buildReadyCheckpoint() {
  const strategy = buildMainImageStrategyInputs({
    userText: 'raw-image-payload 看项目图片理解袜子款式，制作点击图和转化图 data:image/png;base64,abc',
    imageType: 'click',
    selectedAsset,
    projectAssets: [selectedAsset],
    subjectBounds: { left: 250, top: 360, right: 1330, bottom: 980, width: 1080, height: 620 },
    sizePlans,
    copyCandidates: ['轻薄堆叠，春夏更自在'],
    outputDir: 'C:/Exports',
    toolNames: [
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
      'getAcceptanceSnapshot',
      'quickExport'
    ],
    allowPendingRatioExecution: true,
    visionSignal: {
      source: 'vision-model',
      assetRef: { id: 'asset-1', path: 'C:/project/assets/white-slouch-socks-01.jpg', name: 'white-slouch-socks-01.jpg' },
      productType: '堆堆袜',
      subjectSummary: '白色堆堆袜，松弛褶皱感，适合春夏清爽穿搭主图 raw-image-payload',
      backgroundSummary: '浅色背景，模特脚部局部露出',
      sourceNotes: ['视觉模型：白色堆堆袜', '视觉模型：褶皱袜筒和清爽穿搭氛围']
    },
    userCheckpointApproved: true
  });

  return buildMainImageLiveExecutorCheckpoint({
    requestPackage: strategy.liveExecutorRequestPackage,
    approvedLiveExecution: true,
    executionScope: 'disposable-document',
    photoshopConnection: {
      connected: true,
      documentWriteAvailable: true,
      source: 'smoke',
      currentDocumentId: 'disposable-doc',
      activeDocumentName: 'smoke-live-main-image.psd'
    }
  });
}

function makeAdapter(options = {}) {
  const toolCalls = [];
  const readbackCalls = [];
  return {
    toolCalls,
    readbackCalls,
    async executeOperation(request) {
      toolCalls.push(request.tool);
      if (options.failTool === request.tool) {
        return {
          success: false,
          summary: `failed ${request.tool}`,
          error: `forced ${request.tool} failure`,
          actualResult: null
        };
      }
      return {
        success: true,
        summary: `executed ${request.tool}`,
        actualResult: {
          layerId: `${request.tool}-layer-${toolCalls.length}`,
          actualBounds: request.payloadPreview.destinationBox || { left: 0, top: 0, right: 100, bottom: 100 },
          rawPayload: 'data:image/png;base64,should-not-leak'
        }
      };
    },
    async readbackAfterOperation(request, toolName, operationResult) {
      readbackCalls.push(`${request.requestId}:${toolName}`);
      if (options.failReadbackTool === toolName) {
        return {
          success: false,
          summary: `failed readback ${toolName}`,
          error: `forced ${toolName} failure`
        };
      }
      return {
        success: true,
        summary: `read ${toolName}`,
        data: {
          requestId: request.requestId,
          toolName,
          actualBounds: operationResult.actualResult?.actualBounds || null
        }
      };
    },
    async captureFinalAcceptanceSnapshot() {
      if (options.failSnapshot) {
        return {
          success: false,
          summary: 'snapshot failed',
          error: 'forced snapshot failure'
        };
      }
      return {
        success: true,
        summary: 'snapshot captured',
        data: {
          documentId: 'disposable-doc',
          layerCount: toolCalls.length
        }
      };
    }
  };
}

async function run() {
  const missing = await runMainImageLiveExecutor({});
  assert(missing.status === 'blocked_missing_checkpoint', 'missing checkpoint must block', missing);
  assert(missing.executedOperationCount === 0, 'missing checkpoint must not execute operations', missing);
  assert(missing.canClaimOutputQuality === false, 'missing checkpoint must not claim quality', missing);

  const checkpoint = buildReadyCheckpoint();
  assert(checkpoint.status === 'ready_for_live_executor_run', 'fixture checkpoint should be ready', checkpoint);

  const noAdapter = await runMainImageLiveExecutor({ checkpoint });
  assert(noAdapter.status === 'blocked_missing_tool_adapter', 'ready checkpoint still needs explicit tool adapter', noAdapter);
  assert(noAdapter.executedOperationCount === 0, 'no adapter must not execute', noAdapter);

  const activeScope = await runMainImageLiveExecutor({
    checkpoint: {
      ...checkpoint,
      runGuard: {
        ...checkpoint.runGuard,
        executionScope: 'active-document'
      }
    },
    adapter: makeAdapter()
  });
  assert(activeScope.status === 'blocked_non_disposable_scope', 'active document should be blocked by default', activeScope);

  const adapter = makeAdapter();
  const passed = await runMainImageLiveExecutor({ checkpoint, adapter });
  assert(passed.status === 'completed_requires_review', 'successful live run should still require review', passed);
  assert(passed.executedOperationCount === checkpoint.operationCount, 'all operations should execute', passed);
  assert(passed.failedOperationCount === 0, 'successful run should have no failed operations', passed);
  assert(passed.finalAcceptanceSnapshot?.success === true, 'successful run should capture final snapshot', passed);
  assert(passed.verificationReport.status === 'needs_review', 'successful run still needs manual QA review', passed);
  assert(passed.canClaimOutputQuality === false, 'successful runner must not claim output quality without manual QA', passed);
  assert(passed.canClaimDesignComplete === false, 'successful runner must not claim design complete', passed);
  assert(passed.operationResults.every((item) => item.readbackResults.length > 0), 'each operation should have readback record', passed);
  assert(adapter.toolCalls.length === checkpoint.operationCount, 'adapter tool calls should match operation count', adapter);
  assert(adapter.readbackCalls.length > 0, 'adapter should be asked for readbacks', adapter);
  assertNoRawPayload(passed, 'passed live runner result');

  const toolFailure = await runMainImageLiveExecutor({
    checkpoint,
    adapter: makeAdapter({ failTool: 'transformLayer' })
  });
  assert(toolFailure.status === 'failed_operation', 'tool failure should stop the live runner', toolFailure);
  assert(toolFailure.failedOperationCount === 1, 'tool failure count mismatch', toolFailure);
  assert(toolFailure.finalAcceptanceSnapshot === null, 'failed operation must skip final snapshot', toolFailure);

  const readbackFailure = await runMainImageLiveExecutor({
    checkpoint,
    adapter: makeAdapter({ failReadbackTool: 'getLayerProperties' })
  });
  assert(readbackFailure.status === 'failed_readback', 'readback failure should stop the live runner', readbackFailure);
  assert(readbackFailure.failedReadbackCount > 0, 'readback failure count expected', readbackFailure);

  const snapshotFailure = await runMainImageLiveExecutor({
    checkpoint,
    adapter: makeAdapter({ failSnapshot: true })
  });
  assert(snapshotFailure.status === 'failed_final_snapshot', 'final snapshot failure should fail runner', snapshotFailure);

  console.log(JSON.stringify({
    success: true,
    checks: [
      'runner blocks without checkpoint',
      'runner blocks without explicit tool adapter',
      'runner blocks active-document scope by default',
      'runner executes fake adapter operations and readbacks in order',
      'runner records actualResult only from adapter output and redacts raw payloads',
      'runner stops on operation failure',
      'runner stops on readback failure',
      'runner fails when final acceptance snapshot is missing',
      'runner never claims output quality or design completion without manual QA'
    ]
  }, null, 2));
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
