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
  buildMainImageProductionExecutorDryRunPreview
} = require(path.join(repoRoot, 'src', 'shared', 'main-image-production-executor-dry-run.ts'));
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

function assertSafePhotoshopDocumentNames(production) {
  const forbiddenNamePattern = /[\\/:*?"<>|]/;
  const unsafeDocuments = production.documents.filter((document) => forbiddenNamePattern.test(document.name));
  assert(unsafeDocuments.length === 0, 'production document names must be safe Photoshop document names', unsafeDocuments);
  const unsafeExportSpecs = production.exportSpecs.filter((spec) => forbiddenNamePattern.test(spec.documentName));
  assert(unsafeExportSpecs.length === 0, 'export specs must reference safe Photoshop document names', unsafeExportSpecs);
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
  assertSafePhotoshopDocumentNames(production);
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

function buildReadyDryRunBridge() {
  return buildMainImageProductionExecutorDispatchPlan({
    productionExecutorHandoff: buildReadyHandoff('dry-run'),
    availableToolNames: allBridgeTools,
    mode: 'dry-run-bridge'
  });
}

function run() {
  const missingBridge = buildMainImageProductionExecutorDryRunPreview({});
  assert(missingBridge.status === 'blocked_missing_dispatch_plan', 'missing dispatch plan should block dry-run preview', missingBridge);
  assert(missingBridge.operationResults.length === 0, 'missing bridge must not fabricate operations', missingBridge);
  assert(missingBridge.noPhotoshopWrites === true, 'missing bridge dry-run must stay read-only', missingBridge);

  const blockedBridge = buildMainImageProductionExecutorDispatchPlan({});
  const blockedDryRun = buildMainImageProductionExecutorDryRunPreview({
    productionExecutorDispatchPlan: blockedBridge
  });
  assert(blockedDryRun.status === 'blocked_dispatch_plan_not_ready', 'blocked dispatch plan should not become a dry-run result', blockedDryRun);
  assert(blockedDryRun.dispatchStatus === 'blocked_missing_handoff', 'blocked dry-run should preserve the dispatch status', blockedDryRun);
  assert(blockedDryRun.operationResults.length === 0, 'blocked bridge must not produce dry-run operations', blockedDryRun);

  const dryRunBridge = buildReadyDryRunBridge();
  const dryRun = buildMainImageProductionExecutorDryRunPreview({
    productionExecutorDispatchPlan: dryRunBridge
  });
  assert(dryRun.status === 'completed_dry_run', 'ready dry-run bridge should produce dry-run operation record', dryRun);
  assert(dryRun.mode === 'dry-run', 'executor dry-run record should stay dry-run only', dryRun);
  assert(dryRun.operationCount === dryRunBridge.executorQueue.length, 'dry-run operation count should mirror bridge queue', dryRun);
  assert(dryRun.operationResults.length === dryRunBridge.executorQueue.length, 'dry-run operations should mirror bridge queue', dryRun);
  assert(dryRun.operationResults.every((item) => item.status === 'dry_run_recorded'), 'all operations should be recorded but not executed', dryRun.operationResults);
  assert(dryRun.operationResults.every((item) => item.actualResult === null), 'dry-run must not fabricate actual Photoshop results', dryRun.operationResults);
  assert(dryRun.readbackPlan.requiredTools.includes('getAcceptanceSnapshot'), 'dry-run should preserve required post-run readback tools', dryRun.readbackPlan);
  assert(dryRun.readbackPlan.requiresActualBounds === true, 'dry-run should retain actual bounds readback requirement', dryRun.readbackPlan);
  assert(dryRun.canClaimOutputQuality === false, 'dry-run must not claim output quality', dryRun);
  assert(dryRun.canClaimDesignComplete === false, 'dry-run must not claim design completion', dryRun);
  assert(dryRun.mustNotExecutePhotoshop === true, 'dry-run helper must not execute Photoshop', dryRun);
  assertNoRawPayload(dryRun, 'main-image production executor dry-run');

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
  const liveDryRun = buildMainImageProductionExecutorDryRunPreview({
    productionExecutorDispatchPlan: liveBridge
  });
  assert(liveDryRun.status === 'blocked_dispatch_plan_not_ready', 'dry-run adapter should not consume a live executor dispatch plan', liveDryRun);
  assert(liveDryRun.blockers.includes('dry_run_bridge_status_required'), 'live bridge rejection should be explicit', liveDryRun);

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
  assert(strategyInputs.productionExecutorDryRunPreview, 'strategy input builder should expose executor dry-run record', strategyInputs);
  assert(strategyInputs.productionExecutorDryRunPreview.status === 'blocked_dispatch_plan_not_ready', 'strategy builder default dry-run should stay blocked until dispatch is ready', strategyInputs.productionExecutorDryRunPreview);
  assert(strategyInputs.productionExecutorDryRunPreview.operationResults.length === 0, 'strategy builder must not emit dry-run operations by default', strategyInputs.productionExecutorDryRunPreview);

  console.log(JSON.stringify({
    success: true,
    checks: [
      'dry-run blocks missing bridge record',
      'dry-run refuses non-ready or live executor bridge record',
      'dry-run records bridge queue without Photoshop writes',
      'dry-run preserves readback plan without fabricating actual results',
      'strategy input builder exposes dry-run record without changing execution'
    ]
  }, null, 2));
}

try {
  run();
} catch (error) {
  console.error(error);
  process.exit(1);
}
