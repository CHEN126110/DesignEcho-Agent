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

const allRequiredTools = ['createDocument', 'createGroup', 'placeImage', 'transformLayer', 'exportGroup'];

function buildProfile() {
  return buildMainImagePlatformSizeProfile({
    platform: 'tmall',
    productCategory: 'socks'
  });
}

function buildProductionExecutionPlan() {
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

function run() {
  const executionPlan = buildProductionExecutionPlan();
  const plannedOperationCount = executionPlan.plannedOperationCount;

  const missingPlan = buildMainImageProductionExecutorHandoff({});
  assert(missingPlan.status === 'blocked_missing_execution_plan', 'missing execution plan should block handoff', missingPlan);
  assert(missingPlan.toolRequests.length === 0, 'missing execution plan must not fabricate tool requests', missingPlan);
  assert(missingPlan.noPhotoshopWrites === true, 'missing plan handoff must stay read-only', missingPlan);
  assert(missingPlan.canClaimDesignComplete === false, 'missing plan cannot claim design complete', missingPlan);

  const defaultDryRun = buildMainImageProductionExecutorHandoff({
    productionExecutionPlan: executionPlan,
    availableToolNames: allRequiredTools,
    outputDir: 'C:/Exports'
  });
  assert(defaultDryRun.status === 'ready_for_dry_run', '800/750/1200 project-rule plan should be ready for dry-run handoff by default', defaultDryRun);
  assert(defaultDryRun.pendingConfirmations.length === 0, 'project-rule 1200 should not create pending confirmations', defaultDryRun);
  assert(defaultDryRun.toolRequests.length === plannedOperationCount, 'default dry-run should mirror planned operations', defaultDryRun);

  const missingCapability = buildMainImageProductionExecutorHandoff({
    productionExecutionPlan: executionPlan,
    availableToolNames: allRequiredTools.filter((tool) => tool !== 'exportGroup'),
    outputDir: 'C:/Exports',
    approvedPendingConfirmations: true
  });
  assert(missingCapability.status === 'blocked_missing_tool_capability', 'missing exportGroup should block handoff', missingCapability);
  assert(missingCapability.missingToolNames.includes('exportGroup'), 'missing tool should be named explicitly', missingCapability);
  assert(missingCapability.toolRequests.length === 0, 'missing capability must not emit handoff requests', missingCapability);

  const dryRun = buildMainImageProductionExecutorHandoff({
    productionExecutionPlan: executionPlan,
    availableToolNames: allRequiredTools,
    outputDir: 'C:/Exports',
    approvedPendingConfirmations: true,
    mode: 'dry-run'
  });
  assert(dryRun.status === 'ready_for_dry_run', 'approved plan with all tools should be ready for dry-run', dryRun);
  assert(dryRun.canRunDryRun === true, 'dry-run handoff should be runnable as dry-run only', dryRun);
  assert(dryRun.canRunExecutor === false, 'dry-run handoff should not enable executor writes', dryRun);
  assert(dryRun.toolRequests.length === plannedOperationCount, 'dry-run should mirror planned operation count', {
    plannedOperationCount,
    toolRequestCount: dryRun.toolRequests.length
  });
  assert(dryRun.toolRequests[0].tool === 'createDocument', 'first request should create the document', dryRun.toolRequests[0]);
  assert(dryRun.toolRequests.some((request) => request.tool === 'transformLayer' && request.requiredReadback.includes('actualBounds')), 'transform requests must require actualBounds readback', dryRun.toolRequests);
  assert(dryRun.toolRequests.every((request) => request.executionBoundary.includes('not executed')), 'dry-run requests must declare they are not executed', dryRun.toolRequests);
  assert(dryRun.noPhotoshopWrites === true, 'dry-run must not write Photoshop', dryRun);
  assert(dryRun.mustNotExecutePhotoshop === true, 'dry-run helper must not execute Photoshop', dryRun);
  assert(dryRun.canClaimOutputQuality === false, 'dry-run cannot claim output quality', dryRun);
  assertNoRawPayload(dryRun, 'executor handoff dry-run');

  const executorHandoff = buildMainImageProductionExecutorHandoff({
    productionExecutionPlan: executionPlan,
    availableToolNames: allRequiredTools,
    outputDir: 'C:/Exports',
    approvedPendingConfirmations: true,
    mode: 'executor-handoff'
  });
  assert(executorHandoff.status === 'ready_for_executor_handoff', 'executor mode should prepare a handoff manifest', executorHandoff);
  assert(executorHandoff.canRunExecutor === true, 'executor handoff should be marked ready for a separate executor', executorHandoff);
  assert(executorHandoff.mustNotExecutePhotoshop === true, 'handoff helper still must not execute Photoshop itself', executorHandoff);
  assert(executorHandoff.toolRequests.length === plannedOperationCount, 'executor handoff should preserve request count', executorHandoff);

  const strategyInputs = buildMainImageStrategyInputs({
    userText: '看项目图片理解袜子款式，制作多个点击图和转化图',
    imageType: 'click',
    selectedAsset,
    projectAssets,
    subjectBounds,
    sizePlans,
    copyCandidates: ['轻薄堆叠，春夏更自在'],
    outputDir: 'C:/Exports',
    toolNames: allRequiredTools,
    visionSignal: visualSignal,
    mainImagePlatformProfile: buildProfile()
  });
  assert(strategyInputs.productionExecutorHandoff, 'strategy input builder should expose executor handoff record', strategyInputs);
  assert(strategyInputs.productionExecutorHandoff.status === 'ready_for_dry_run', 'strategy builder should produce dry-run handoff for the confirmed 800/750/1200 structure', strategyInputs.productionExecutorHandoff);
  assert(strategyInputs.productionExecutorHandoff.toolRequests.length === strategyInputs.productionExecutionPlan.plannedOperationCount, 'strategy builder dry-run handoff should mirror planned operations', strategyInputs.productionExecutorHandoff);

  console.log(JSON.stringify({
    success: true,
    checks: [
      'executor handoff blocks missing execution plans',
      '800/750/1200 project-rule plan is ready for dry-run handoff',
      'missing Photoshop tool capability blocks request emission',
      'dry-run mirrors planned operations without Photoshop writes',
      'executor handoff remains a manifest and does not execute Photoshop',
      'strategy input builder exposes productionExecutorHandoff without changing execution'
    ]
  }, null, 2));
}

try {
  run();
} catch (error) {
  console.error(error);
  process.exit(1);
}
