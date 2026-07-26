#!/usr/bin/env node

const path = require('path');

require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '..', 'tsconfig.main.json')
});

const repoRoot = path.resolve(__dirname, '..');

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
  assert(found.length === 0, `${label} must not retain raw image-like payloads: ${found.join(', ')}`, value);
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

const readyInput = {
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
};

const readyStrategy = buildMainImageStrategyInputs(readyInput);
const readyRequestPackage = readyStrategy.liveExecutorRequestPackage;

function run() {
  const missing = buildMainImageLiveExecutorCheckpoint({});
  assert(missing.version === 'main-image-live-executor-checkpoint/v0', 'version mismatch', missing);
  assert(missing.status === 'blocked_missing_request_package', 'missing request package should block', missing);
  assert(missing.canStartLiveExecutor === false, 'missing request package must not start live executor', missing);
  assert(missing.noPhotoshopWrites === true, 'checkpoint helper must be read-only', missing);
  assert(missing.mustNotExecutePhotoshop === true, 'checkpoint helper must not execute Photoshop', missing);
  assert(missing.operationCount === 0, 'missing checkpoint must not contain operation requests', missing);

  const requestNotReady = buildMainImageStrategyInputs({ ...readyInput, userCheckpointApproved: false }).liveExecutorRequestPackage;
  const blockedRequest = buildMainImageLiveExecutorCheckpoint({
    requestPackage: requestNotReady,
    approvedLiveExecution: true,
    photoshopConnection: { connected: true, documentWriteAvailable: true, source: 'smoke' }
  });
  assert(blockedRequest.status === 'blocked_request_not_ready', 'non-ready request package should block checkpoint', blockedRequest);
  assert(blockedRequest.canStartLiveExecutor === false, 'non-ready request must not start executor', blockedRequest);

  const missingApproval = buildMainImageLiveExecutorCheckpoint({
    requestPackage: readyRequestPackage,
    photoshopConnection: { connected: true, documentWriteAvailable: true, source: 'smoke' }
  });
  assert(missingApproval.status === 'blocked_requires_explicit_checkpoint', 'live checkpoint should require explicit approval', missingApproval);

  const disconnected = buildMainImageLiveExecutorCheckpoint({
    requestPackage: readyRequestPackage,
    approvedLiveExecution: true,
    photoshopConnection: { connected: false, documentWriteAvailable: false, source: 'smoke' }
  });
  assert(disconnected.status === 'blocked_photoshop_unavailable', 'checkpoint should block unavailable Photoshop', disconnected);

  const ready = buildMainImageLiveExecutorCheckpoint({
    requestPackage: readyRequestPackage,
    approvedLiveExecution: true,
    executionScope: 'disposable-document',
    photoshopConnection: {
      connected: true,
      documentWriteAvailable: true,
      source: 'smoke',
      activeDocumentId: 123,
      activeDocumentName: 'smoke-live-main-image.psd'
    }
  });
  assert(ready.status === 'ready_for_live_executor_run', 'ready checkpoint should allow a separate live runner', ready);
  assert(ready.canStartLiveExecutor === true, 'ready checkpoint should allow live runner startup', ready);
  assert(ready.checkpointOnly === true, 'checkpoint output must remain checkpoint-only', ready);
  assert(ready.mustNotExecutePhotoshop === true, 'checkpoint builder itself must not execute Photoshop', ready);
  assert(ready.operationCount === readyRequestPackage.operationCount, 'checkpoint should preserve operation count', ready);
  assert(ready.operationRequests.every((item) => item.actualResult === null), 'checkpoint must not fabricate actual Photoshop results', ready);
  assert(ready.runGuard.stopOnFirstFailure === true, 'live runner should stop on first failure', ready);
  assert(ready.runGuard.requireReadbackAfterEachOperation === true, 'live runner should read back after each operation', ready);
  assert(ready.runGuard.requireFinalAcceptanceSnapshot === true, 'live runner should require final acceptance snapshot', ready);
  assert(ready.runGuard.requireManualReviewBeforeQualityClaim === true, 'manual review should gate quality claims', ready);
  assert(ready.readbackTools.includes('getAcceptanceSnapshot'), 'checkpoint should require acceptance snapshot tool', ready);
  assert(ready.readbackRequirements.length > 0, 'checkpoint should preserve readback requirements', ready);
  assert(ready.verificationReport.status === 'needs_review', 'ready checkpoint still needs review because no live run has happened', ready);
  assertNoRawPayload(ready, 'ready checkpoint');

  console.log(JSON.stringify({
    success: true,
    checks: [
      'missing request package blocks live checkpoint',
      'non-ready request package blocks live checkpoint',
      'explicit approval is required before live execution',
      'Photoshop connection and document write capability are required',
      'ready checkpoint can start a separate live runner without executing Photoshop itself',
      'checkpoint preserves operation requests without fabricating actual results',
      'checkpoint requires readback after each operation, final acceptance snapshot and manual review'
    ]
  }, null, 2));
}

try {
  run();
} catch (error) {
  console.error(error);
  process.exit(1);
}
