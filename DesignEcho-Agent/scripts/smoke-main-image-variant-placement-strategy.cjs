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
  buildMainImageVariantPlacementStrategy
} = require(path.join(repoRoot, 'src', 'shared', 'main-image-variant-placement-strategy.ts'));
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

const projectAssets = [
  selectedAsset,
  {
    id: 'asset-2',
    name: 'model-foot-detail.jpg',
    path: 'C:/project/assets/model-foot-detail.jpg',
    role: 'project-image',
    width: 1600,
    height: 1200
  }
];

const visualSignal = {
  source: 'vision-model',
  assetRef: { id: 'asset-1', path: 'C:/project/assets/white-slouch-socks-01.jpg', name: 'white-slouch-socks-01.jpg' },
  productType: '堆堆袜',
  subjectSummary: '白色堆堆袜，松弛褶皱感，适合春夏清爽穿搭主图',
  backgroundSummary: '浅色背景，模特脚部局部露出',
  confidence: 0.8,
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
    sizeKey: '800',
    targetSize: { width: 800, height: 800 },
    subjectSize: { width: 680, height: 420 },
    scale: 0.62,
    targetX: 70,
    targetY: 232,
    decisionReason: 'main image guideline scale 62%',
    layoutCandidateScore: 78,
    layoutCandidateReason: 'square main image hero sock placement',
    smartLayoutPlanned: true,
    quickExportPlanned: true
  },
  {
    sizeKey: '1200',
    targetSize: { width: 1200, height: 1200 },
    subjectSize: { width: 1020, height: 630 },
    scale: 0.94,
    targetX: 90,
    targetY: 348,
    decisionReason: 'large square hero placement',
    smartLayoutPlanned: true,
    quickExportPlanned: false
  }
];

function buildVisualContextStyle() {
  return buildMainImageProjectStyleStrategy({
    userText: '看项目图片理解袜子款式，制作多个点击图和转化图',
    projectAssets,
    selectedAsset,
    visionSignal: visualSignal,
    desiredClickImageCount: 2,
    desiredConversionImageCount: 1
  });
}

function run() {
  const metadataOnlyStyle = buildMainImageProjectStyleStrategy({
    userText: '根据项目图片做袜子主图 raw-image-payload data:image/png;base64,abc',
    projectAssets,
    selectedAsset
  });
  const blocked = buildMainImageVariantPlacementStrategy({
    projectStyleStrategy: metadataOnlyStyle,
    selectedAsset,
    subjectBounds,
    sizePlans
  });

  assert(blocked.version === 'main-image-variant-placement-strategy/v0', 'version mismatch', blocked);
  assert(blocked.status === 'blocked_missing_visual_context', 'metadata-only style must block variant placement', blocked);
  assert(blocked.variantPlacementPlans.length === 0, 'blocked strategy must not produce placement plans', blocked);
  assert(blocked.blockers.includes('main_image_visual_context_required'), 'blocked strategy must explain visual context requirement', blocked);
  assert(blocked.noPhotoshopWrites === true, 'variant placement strategy must be read-only', blocked);
  assert(blocked.mustNotExecutePhotoshop === true, 'variant placement strategy must not execute Photoshop', blocked);
  assertNoRawPayload(blocked, 'blocked variant placement strategy');

  const visualContextStyle = buildVisualContextStyle();
  const ready = buildMainImageVariantPlacementStrategy({
    userText: '做多个点击图和转化图',
    projectStyleStrategy: visualContextStyle,
    selectedAsset,
    subjectBounds,
    sizePlans
  });

  assert(ready.status === 'ready_variant_placement_plan', 'visual-context style should produce variant placement plan', ready);
  assert(ready.variantPlacementPlans.length === 6, '2 click + 1 conversion variants across 2 sizes should produce 6 plans', ready);
  assert(ready.variantPlacementPlans.some((plan) => plan.variantImageType === 'click'), 'should include click placement plans', ready);
  assert(ready.variantPlacementPlans.some((plan) => plan.variantImageType === 'conversion'), 'should include conversion placement plans', ready);
  assert(ready.variantPlacementPlans.every((plan) => plan.placementPlan.designType === 'main-image'), 'all placement plans should use main-image design type', ready);
  assert(ready.variantPlacementPlans.every((plan) => plan.placementPlan.execution.tool === 'transformLayer'), 'placement plans should map to transformLayer readback plan only', ready);
  assert(ready.variantPlacementPlans.every((plan) => plan.placementPlan.execution.requiredReadback.includes('actualBounds')), 'all plans must require actualBounds readback', ready);
  assert(ready.variantPlacementPlans.every((plan) => plan.placementPlan.limitations.some((text) => text.includes('不是 Photoshop 执行结果'))), 'plans must keep no-execution limitation', ready);
  assert(ready.verificationPolicy.requiredReadback.includes('screenshot'), 'ready strategy should require screenshot QA before quality claims', ready);
  assert(ready.canClaimDesignComplete === false, 'variant placement cannot claim design complete', ready);
  assert(ready.canClaimOutputQuality === false, 'variant placement cannot claim output quality', ready);
  assertNoRawPayload(ready, 'ready variant placement strategy');

  const missingBounds = buildMainImageVariantPlacementStrategy({
    projectStyleStrategy: visualContextStyle,
    selectedAsset,
    sizePlans
  });

  assert(missingBounds.status === 'blocked_missing_subject_bounds', 'missing subject bounds must block smart placement', missingBounds);
  assert(missingBounds.variantPlacementPlans.length === 0, 'missing bounds must not fabricate placement plans', missingBounds);

  const strategyInputs = buildMainImageStrategyInputs({
    userText: '做多个点击图和转化图',
    imageType: 'click',
    selectedAsset,
    projectAssets,
    subjectBounds,
    sizePlans,
    copyCandidates: ['清爽堆叠，春夏更自在'],
    outputDir: 'C:/Exports',
    toolNames: ['getDocumentInfo', 'getSubjectBounds', 'smartLayout[800]'],
    visionSignal: visualSignal
  });

  assert(strategyInputs.variantPlacementStrategy, 'strategy input builder should expose variant placement strategy context', strategyInputs);
  assert(strategyInputs.variantPlacementStrategy.status === 'ready_variant_placement_plan', 'builder should carry ready variant placement strategy', strategyInputs.variantPlacementStrategy);
  assert(strategyInputs.strategyInputs.smartScalingPolicy.variantPlacementStrategyStatus === 'ready_variant_placement_plan', 'smart scaling policy should reference variant placement strategy status', strategyInputs.strategyInputs.smartScalingPolicy);
  assert(
    strategyInputs.strategyInputs.imagePlacementPolicy.variantPlacementPlanCount === strategyInputs.variantPlacementStrategy.variantPlacementPlans.length,
    'placement policy should reference variant placement plan count',
    strategyInputs.strategyInputs.imagePlacementPolicy
  );

  console.log(JSON.stringify({
    success: true,
    checks: [
      'metadata-only style blocks main-image variant placement',
      'visual-context style plus selected asset, subject bounds and size plans produces click/conversion placement plans',
      'placement plans consume image placement core and require Photoshop readback instead of claiming execution',
      'strategy input builder exposes variantPlacementStrategy',
      'raw image payloads are redacted'
    ]
  }, null, 2));
}

try {
  run();
} catch (error) {
  console.error(error);
  process.exit(1);
}
