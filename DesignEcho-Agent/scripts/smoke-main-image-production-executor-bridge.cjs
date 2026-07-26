#!/usr/bin/env node

const path = require('path');

require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '..', 'tsconfig.main.json')
});

const repoRoot = path.resolve(__dirname, '..');

const {
  buildMainImageProjectStyleStrategy
} = require(path.join(repoRoot, 'src', 'shared', 'main-image-project-style-strategy.ts'));
const {
  buildMainImagePlatformSizeProfile,
  buildMainImageProductionDocumentStructure
} = require(path.join(repoRoot, 'src', 'shared', 'main-image-production-document-structure.ts'));
const {
  buildMainImageVariantPlacementStrategy
} = require(path.join(repoRoot, 'src', 'shared', 'main-image-variant-placement-strategy.ts'));
const {
  buildMainImageProductionExecutionPlan
} = require(path.join(repoRoot, 'src', 'shared', 'main-image-production-execution-plan.ts'));
const {
  buildMainImageProductionExecutorHandoff
} = require(path.join(repoRoot, 'src', 'shared', 'main-image-production-executor-handoff.ts'));
const {
  buildMainImageProductionExecutorDispatchPlan
} = require(path.join(repoRoot, 'src', 'shared', 'main-image-production-executor-bridge.ts'));
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

const projectAssets = [selectedAsset];

const visualSignal = {
  source: 'vision-model',
  assetRef: { id: 'asset-1', path: 'C:/project/assets/white-slouch-socks-01.jpg', name: 'white-slouch-socks-01.jpg' },
  productType: '堆堆袜',
  subjectSummary: '白色堆堆袜，松弛褶皱感，适合春夏清爽穿搭主图',
  backgroundSummary: '浅色背景，模特脚部局部露出',
  sourceNotes: ['视觉模型：白色堆堆袜', '视觉模型：褶皱袜筒和清爽穿搭氛围']
};

const subjectBounds = {
  left: 250,
  top: 360,
  right: 1330,
  bottom: 980,
  width: 1080,
  height: 620
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

const photoshopWriteTools = ['createDocument', 'createGroup', 'moveLayerToGroup', 'placeImage', 'transformLayer', 'moveLayer', 'exportGroup'];
const photoshopReadbackTools = ['getDocumentInfo', 'getLayerHierarchy', 'getLayerProperties', 'getAcceptanceSnapshot'];
const allBridgeTools = [...photoshopWriteTools, ...photoshopReadbackTools];

function buildProfile() {
  return buildMainImagePlatformSizeProfile({
    platform: 'tmall',
    productCategory: 'socks'
  });
}

function buildExecutionPlan() {
  const profile = buildProfile();
  const style = buildMainImageProjectStyleStrategy({
    userText: '看项目图片理解袜子款式，制作多个点击图和转化图',
    projectAssets,
    selectedAsset,
    visionSignal: visualSignal,
    desiredClickImageCount: 2,
    desiredConversionImageCount: 2
  });
  const production = buildMainImageProductionDocumentStructure({
    platformSizeProfile: profile,
    projectStyleStrategy: style
  });
  const placement = buildMainImageVariantPlacementStrategy({
    userText: '看项目图片理解袜子款式，制作多个点击图和转化图',
    projectStyleStrategy: style,
    selectedAsset,
    subjectBounds,
    sizePlans
  });
  return buildMainImageProductionExecutionPlan({
    productionDocumentStructure: production,
    variantPlacementStrategy: placement,
    selectedAsset,
    outputDir: 'C:/Exports'
  });
}

function buildReadyHandoff(mode = 'dry-run') {
  return buildMainImageProductionExecutorHandoff({
    productionExecutionPlan: buildExecutionPlan(),
    availableToolNames: photoshopWriteTools,
    outputDir: 'C:/Exports',
    approvedPendingConfirmations: true,
    mode
  });
}

function run() {
  const missingHandoff = buildMainImageProductionExecutorDispatchPlan({});
  assert(missingHandoff.status === 'blocked_missing_handoff', 'missing handoff should block executor bridge', missingHandoff);
  assert(missingHandoff.executorQueue.length === 0, 'missing handoff must not fabricate executor queue', missingHandoff);
  assert(missingHandoff.noPhotoshopWrites === true, 'missing handoff bridge must stay read-only', missingHandoff);

  const blockedCapabilityHandoff = buildMainImageProductionExecutorHandoff({
    productionExecutionPlan: buildExecutionPlan(),
    availableToolNames: photoshopWriteTools.filter((tool) => tool !== 'exportGroup'),
    outputDir: 'C:/Exports'
  });
  const blockedHandoff = buildMainImageProductionExecutorDispatchPlan({
    productionExecutorHandoff: blockedCapabilityHandoff,
    availableToolNames: allBridgeTools
  });
  assert(blockedHandoff.status === 'blocked_handoff_not_ready', 'bridge should block non-ready handoff record', blockedHandoff);
  assert(blockedHandoff.executorQueue.length === 0, 'blocked handoff must not enter executor queue', blockedHandoff);

  const readyDryRunHandoff = buildReadyHandoff('dry-run');
  const missingReadback = buildMainImageProductionExecutorDispatchPlan({
    productionExecutorHandoff: readyDryRunHandoff,
    availableToolNames: photoshopWriteTools
  });
  assert(missingReadback.status === 'blocked_missing_executor_capability', 'bridge should require readback tools in addition to write tools', missingReadback);
  assert(missingReadback.missingToolNames.includes('getAcceptanceSnapshot'), 'missing readback capability should be explicit', missingReadback);

  const dryRunBridge = buildMainImageProductionExecutorDispatchPlan({
    productionExecutorHandoff: readyDryRunHandoff,
    availableToolNames: allBridgeTools,
    mode: 'dry-run-bridge'
  });
  assert(dryRunBridge.status === 'ready_for_dry_run_bridge', 'ready handoff and capabilities should produce dry-run bridge', dryRunBridge);
  assert(dryRunBridge.canRunDryRunBridge === true, 'dry-run bridge should be runnable as dry-run only', dryRunBridge);
  assert(dryRunBridge.canRunLiveExecutor === false, 'dry-run bridge must not authorize live executor', dryRunBridge);
  assert(dryRunBridge.executorQueue.length === readyDryRunHandoff.toolRequests.length, 'dry-run bridge queue should mirror handoff requests', dryRunBridge);
  assert(dryRunBridge.executorQueue.every((item) => item.requiredPostRunReadbackTools.length > 0), 'each bridge queue item should declare readback requirements', dryRunBridge.executorQueue);
  const illegalReadbackTools = dryRunBridge.executorQueue
    .flatMap((item) => item.requiredPostRunReadbackTools)
    .filter((tool) => photoshopWriteTools.includes(tool));
  assert(
    illegalReadbackTools.length === 0,
    'post-run readback tools must not include mutating Photoshop write tools',
    { illegalReadbackTools, executorQueue: dryRunBridge.executorQueue }
  );
  assert(
    dryRunBridge.requiredToolNames.includes('moveLayerToGroup'),
    'moveLayerToGroup should stay in requiredToolNames for nested group execution, not readback',
    dryRunBridge.requiredToolNames
  );
  assert(dryRunBridge.mustNotExecutePhotoshop === true, 'bridge helper must not execute Photoshop', dryRunBridge);
  assertNoRawPayload(dryRunBridge, 'main-image executor dry-run bridge');

  const liveWithoutApproval = buildMainImageProductionExecutorDispatchPlan({
    productionExecutorHandoff: buildReadyHandoff('executor-handoff'),
    availableToolNames: allBridgeTools,
    mode: 'live-executor-bridge',
    photoshopConnection: {
      connected: true,
      documentWriteAvailable: true,
      source: 'fake-live-preflight'
    }
  });
  assert(liveWithoutApproval.status === 'blocked_requires_user_approval', 'live bridge should require explicit user approval', liveWithoutApproval);

  const liveDisconnected = buildMainImageProductionExecutorDispatchPlan({
    productionExecutorHandoff: buildReadyHandoff('executor-handoff'),
    availableToolNames: allBridgeTools,
    mode: 'live-executor-bridge',
    approvedLiveExecution: true,
    photoshopConnection: {
      connected: false,
      documentWriteAvailable: false,
      source: 'fake-live-preflight'
    }
  });
  assert(liveDisconnected.status === 'blocked_photoshop_unavailable', 'approved live bridge should still block without Photoshop connection', liveDisconnected);

  const liveBridge = buildMainImageProductionExecutorDispatchPlan({
    productionExecutorHandoff: buildReadyHandoff('executor-handoff'),
    availableToolNames: allBridgeTools,
    mode: 'live-executor-bridge',
    approvedLiveExecution: true,
    photoshopConnection: {
      connected: true,
      documentWriteAvailable: true,
      source: 'fake-live-preflight'
    }
  });
  assert(liveBridge.status === 'ready_for_live_executor_bridge', 'approved and connected live bridge should become ready for a separate executor', liveBridge);
  assert(liveBridge.canRunLiveExecutor === true, 'live bridge should authorize a separate executor after all gates pass', liveBridge);
  assert(liveBridge.noPhotoshopWrites === true, 'bridge helper itself must remain read-only even when live bridge is ready', liveBridge);
  assert(liveBridge.mustNotExecutePhotoshop === true, 'bridge helper must not execute Photoshop itself', liveBridge);

  const strategyInputs = buildMainImageStrategyInputs({
    userText: '看项目图片理解袜子款式，制作多个点击图和转化图',
    imageType: 'click',
    selectedAsset,
    projectAssets,
    subjectBounds,
    sizePlans,
    copyCandidates: ['轻薄堆叠，春夏更自在'],
    outputDir: 'C:/Exports',
    toolNames: photoshopWriteTools,
    visionSignal: visualSignal,
    mainImagePlatformProfile: buildProfile()
  });
  assert(strategyInputs.productionExecutorDispatchPlan, 'strategy input builder should expose executor bridge record', strategyInputs);
  assert(strategyInputs.productionExecutorDispatchPlan.status === 'blocked_missing_executor_capability', 'strategy builder default should require readback tools before bridge readiness', strategyInputs.productionExecutorDispatchPlan);
  assert(strategyInputs.productionExecutorDispatchPlan.executorQueue.length === 0, 'strategy builder must not emit executor queue by default', strategyInputs.productionExecutorDispatchPlan);

  console.log(JSON.stringify({
    success: true,
    checks: [
      'bridge blocks missing or non-ready handoff',
      'bridge requires readback tools beyond write tools',
      'bridge keeps mutating tools out of post-run readback tools',
      'dry-run bridge mirrors handoff without Photoshop writes',
      'live bridge requires user approval and Photoshop connection',
      'live bridge remains a readiness bridge and does not execute Photoshop',
      'strategy input builder exposes bridge record without changing execution'
    ]
  }, null, 2));
}

try {
  run();
} catch (error) {
  console.error(error);
  process.exit(1);
}
