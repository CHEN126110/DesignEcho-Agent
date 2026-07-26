#!/usr/bin/env node

const path = require('path');

require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '..', 'tsconfig.main.json')
});

const repoRoot = path.resolve(__dirname, '..');

const {
  buildMainImageDesignReadinessReport
} = require(path.join(repoRoot, 'src', 'shared', 'main-image-design-readiness-report.ts'));
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

const visualSignal = {
  source: 'vision-model',
  assetRef: { id: 'asset-1', path: 'C:/project/assets/white-slouch-socks-01.jpg', name: 'white-slouch-socks-01.jpg' },
  productType: '堆堆袜',
  subjectSummary: '白色堆堆袜，松弛褶皱感，适合春夏清爽穿搭主图 raw-image-payload data:image/png;base64,abc',
  backgroundSummary: '浅色背景，模特脚部局部露出',
  confidence: 0.82,
  sourceNotes: ['视觉模型：白色堆堆袜', '视觉模型：褶皱袜筒和清爽穿搭氛围']
};

const sizePlans = [{
  sizeKey: 'tmall-1x1-main-image',
  targetSize: { width: 1440, height: 1440 },
  subjectSize: { width: 1180, height: 720 },
  scale: 0.72,
  targetX: 130,
  targetY: 420,
  decisionReason: '1:1 square main image source size',
  smartLayoutPlanned: true,
  quickExportPlanned: true
}];

const readyStrategy = buildMainImageStrategyInputs({
  userText: '看项目图片理解袜子款式，制作多个点击图和转化图',
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
    'placeImage',
    'transformLayer',
    'getDocumentInfo',
    'getLayerBounds',
    'getAcceptanceSnapshot',
    'quickExport'
  ],
  visionSignal: visualSignal
});

function buildPassedQaReport() {
  return {
    reportVersion: 'main-image-qa-report/v0',
    scenario: 'main-image',
    status: 'passed',
    stage: 'passed',
    qualityClaim: {
      allowed: true,
      reason: 'fixture QA passed',
      blockers: [],
      requiredInputs: [],
      boundary: 'fixture only'
    },
    resultImageSummary: {
      resultImageCount: 1,
      resultImageNames: ['result.jpg'],
      fileProbeCount: 1,
      okFileProbeCount: 1,
      targetMode: 'reference',
      pixelProbeStatus: 'ok',
      manualReviewDecision: 'approved'
    },
    blockers: [],
    warnings: [],
    limitations: [],
    sourceNotes: []
  };
}

function buildExecutorReadyStrategy(strategy) {
  return {
    ...strategy,
    status: 'ready_for_strategy_contract',
    missingInputs: [],
    blockers: [],
    warnings: [],
    productionExecutorDryRunPreview: {
      ...strategy.productionExecutorDryRunPreview,
      status: 'completed_dry_run',
      operationCount: 1,
      operationResults: [{
        id: 'dry-run-001',
        requestId: 'request-001',
        tool: 'createDocument',
        phase: 'document',
        status: 'dry_run_recorded',
        payloadPreview: {},
        requiredReadback: ['documentInfo'],
        requiredPostRunReadbackTools: ['getDocumentInfo'],
        sourceContextIds: ['fixture'],
        executionBoundary: 'fixture dry-run only',
        actualResult: null
      }],
      blockers: [],
      warnings: []
    }
  };
}

function run() {
  const missing = buildMainImageDesignReadinessReport({});
  assert(missing.version === 'main-image-design-readiness-report/v0', 'version mismatch', missing);
  assert(missing.status === 'blocked_missing_strategy_inputs', 'missing strategy context should block readiness', missing);
  assert(missing.canEnterLiveExecutor === false, 'missing strategy must not enter live executor', missing);
  assert(missing.canClaimOutputQuality === false, 'missing strategy must not claim output quality', missing);
  assert(missing.canClaimDesignComplete === false, 'missing strategy must not claim design complete', missing);
  assert(missing.noPhotoshopWrites === true, 'readiness report must be read-only', missing);
  assert(missing.mustNotExecutePhotoshop === true, 'readiness report must not execute Photoshop', missing);
  assertNoRawPayload(missing, 'missing readiness report');

  assert(readyStrategy.status === 'ready_for_strategy_contract', 'fixture strategy should be ready', readyStrategy);
  const builderReport = readyStrategy.designReadinessReport;
  assert(builderReport, 'strategy builder should expose design readiness report', readyStrategy);
  assert(builderReport.status === 'blocked_executor_dry_run_not_ready', 'builder report should expose dry-run readiness instead of pretending executor is ready', builderReport);
  assert(builderReport.canEnterLiveExecutor === false, 'blocked dry-run must not enter live executor', builderReport);
  assert(builderReport.readinessChecks.some((check) => check.id === 'executor-dry-run' && check.status === 'needs_review'), 'dry-run check should be visible', builderReport);
  assertNoRawPayload(builderReport, 'builder readiness report');

  const executorReadyStrategy = buildExecutorReadyStrategy(readyStrategy);
  const waitingCheckpoint = buildMainImageDesignReadinessReport({
    strategyInputContext: executorReadyStrategy
  });
  assert(waitingCheckpoint.status === 'waiting_for_user_checkpoint', 'executor-ready strategy should wait for user checkpoint before live executor', waitingCheckpoint);
  assert(waitingCheckpoint.canEnterLiveExecutor === false, 'without checkpoint live executor must stay blocked', waitingCheckpoint);
  assert(waitingCheckpoint.requiresUserCheckpoint === true, 'checkpoint should be required', waitingCheckpoint);
  assert(waitingCheckpoint.readinessChecks.some((check) => check.id === 'user-checkpoint' && check.status === 'needs_review'), 'checkpoint check should be visible', waitingCheckpoint);
  assertNoRawPayload(waitingCheckpoint, 'waiting checkpoint readiness report');

  const approved = buildMainImageDesignReadinessReport({
    strategyInputContext: executorReadyStrategy,
    userCheckpointApproved: true
  });
  assert(approved.status === 'ready_for_live_executor', 'approved strategy should be ready for live executor', approved);
  assert(approved.canEnterLiveExecutor === true, 'approved strategy can enter live executor', approved);
  assert(approved.canClaimOutputQuality === false, 'executor readiness still cannot claim output quality', approved);
  assert(approved.canClaimDesignComplete === false, 'executor readiness still cannot claim design complete', approved);
  assertNoRawPayload(approved, 'approved readiness report');

  const qaReady = buildMainImageDesignReadinessReport({
    strategyInputContext: executorReadyStrategy,
    qaReport: buildPassedQaReport(),
    userCheckpointApproved: true
  });
  assert(qaReady.status === 'quality_claim_ready', 'passed QA should mark quality claim readiness', qaReady);
  assert(qaReady.canClaimOutputQuality === true, 'passed QA can allow output quality claim', qaReady);
  assert(qaReady.canClaimDesignComplete === false, 'quality claim still should not become full design completion', qaReady);
  assertNoRawPayload(qaReady, 'qa-ready readiness report');

  console.log(JSON.stringify({
    success: true,
    checks: [
      'main-image design readiness blocks missing strategy context',
      'ready strategy waits for explicit user checkpoint before live executor',
      'approved readiness can enter live executor without writing Photoshop',
      'passed QA can allow output quality claim without claiming design completion',
      'strategy input builder exposes designReadinessReport'
    ]
  }, null, 2));
}

try {
  run();
} catch (error) {
  console.error(error);
  process.exit(1);
}
