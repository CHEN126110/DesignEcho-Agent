#!/usr/bin/env node

const path = require('path');

require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '..', 'tsconfig.main.json')
});

const repoRoot = path.resolve(__dirname, '..');

const {
  buildMainImageLiveExecutorRequestPackage
} = require(path.join(repoRoot, 'src', 'shared', 'main-image-live-executor-request.ts'));
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

function run() {
  const missing = buildMainImageLiveExecutorRequestPackage({});
  assert(missing.version === 'main-image-live-executor-request/v0', 'version mismatch', missing);
  assert(missing.status === 'blocked_missing_readiness_report', 'missing readiness should block', missing);
  assert(missing.canDispatchLiveExecutor === false, 'missing readiness must not dispatch', missing);
  assert(missing.noPhotoshopWrites === true, 'request package must be read-only', missing);
  assert(missing.mustNotExecutePhotoshop === true, 'request package must not execute Photoshop', missing);
  assert(missing.canClaimOutputQuality === false, 'request package cannot claim output quality', missing);
  assert(missing.canClaimDesignComplete === false, 'request package cannot claim design complete', missing);
  assertNoRawPayload(missing, 'missing request package');

  const notApproved = buildMainImageStrategyInputs({ ...readyInput, userCheckpointApproved: false });
  assert(
    notApproved.liveExecutorRequestPackage.status === 'blocked_readiness_not_live_executor',
    'without checkpoint request package should remain blocked',
    notApproved.liveExecutorRequestPackage
  );
  assert(notApproved.liveExecutorRequestPackage.operationCount === 0, 'blocked request must not expose operations', notApproved.liveExecutorRequestPackage);

  assert(readyStrategy.designReadinessReport.status === 'ready_for_live_executor', 'fixture should be ready for live executor request', readyStrategy.designReadinessReport);
  const requestPackage = readyStrategy.liveExecutorRequestPackage;
  assert(requestPackage.status === 'ready_for_executor_dispatch', 'approved readiness and dry-run should build dispatch request', requestPackage);
  assert(requestPackage.canDispatchLiveExecutor === true, 'request package should be dispatchable only as a future request', requestPackage);
  assert(requestPackage.operationCount > 0, 'request package should mirror dry-run operations', requestPackage);
  assert(requestPackage.operationRequests.every((item) => item.actualResult === null), 'operation requests must not fabricate actual results', requestPackage);
  assert(requestPackage.acceptancePlan.requiresQaReport === true, 'post-run QA report should be required', requestPackage);
  assert(requestPackage.acceptancePlan.requiresManualReviewBeforeQualityClaim === true, 'manual review should gate quality claim', requestPackage);
  assert(requestPackage.verificationReport.status === 'passed', 'ready package verification should pass readiness only', requestPackage);
  assertNoRawPayload(requestPackage, 'ready request package');

  const blockedDryRun = buildMainImageLiveExecutorRequestPackage({
    designReadinessReport: {
      ...readyStrategy.designReadinessReport,
      status: 'ready_for_live_executor',
      canEnterLiveExecutor: true
    },
    productionExecutorDryRunPreview: {
      ...readyStrategy.productionExecutorDryRunPreview,
      status: 'blocked_bridge_not_ready'
    }
  });
  assert(blockedDryRun.status === 'blocked_dry_run_not_complete', 'non-completed dry run should block request package', blockedDryRun);
  assert(blockedDryRun.operationCount === 0, 'blocked dry run must not produce operation requests', blockedDryRun);

  console.log(JSON.stringify({
    success: true,
    checks: [
      'missing readiness blocks live executor request package',
      'missing user checkpoint keeps strategy builder request package blocked',
      'approved readiness plus completed dry-run builds a dispatch request package',
      'request package mirrors dry-run operations without actual Photoshop results',
      'request package requires post-run QA and manual review before quality claim',
      'raw image-like payloads are redacted'
    ]
  }, null, 2));
}

try {
  run();
} catch (error) {
  console.error(error);
  process.exit(1);
}
