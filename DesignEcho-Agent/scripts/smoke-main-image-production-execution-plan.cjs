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

function buildProfile() {
  return buildMainImagePlatformSizeProfile({
    platform: 'tmall',
    productCategory: 'socks'
  });
}

function buildVisualContextStyle() {
  return buildMainImageProjectStyleStrategy({
    userText: '看项目图片理解袜子款式，制作多个点击图和转化图',
    projectAssets,
    selectedAsset,
    visionSignal: visualSignal,
    desiredClickImageCount: 2,
    desiredConversionImageCount: 2
  });
}

function buildProductionAndPlacement() {
  const profile = buildProfile();
  const style = buildVisualContextStyle();
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

  return { profile, style, production, placement };
}

function flattenOperations(record) {
  return record.documents.flatMap((document) => document.operations);
}

function run() {
  const { production, placement } = buildProductionAndPlacement();
  const execution = buildMainImageProductionExecutionPlan({
    productionDocumentStructure: production,
    variantPlacementStrategy: placement,
    selectedAsset,
    outputDir: 'C:/Exports'
  });

  assert(execution.version === 'main-image-production-execution-plan/v0', 'execution plan version mismatch', execution);
  assert(execution.status === 'ready_execution_plan', '800/750/1200 project-rule profile should produce a ready execution plan', execution);
  assert(execution.documents.length === production.documents.length, 'execution plan should mirror one planned document per production document', execution);
  assert(execution.exportSpecs.length === production.exportSpecs.length, 'execution plan should preserve group-scoped export specs', execution);
  assert(execution.pendingConfirmations.length === 0, '1200 project rule should not be treated as pending third-ratio confirmation', execution);
  assert(execution.canExecuteWithoutReview === true, 'ready project-rule profile can proceed to review-gated executor handoff', execution);
  assert(execution.noPhotoshopWrites === true, 'execution plan record must be read-only', execution);
  assert(execution.mustNotExecutePhotoshop === true, 'execution plan record must not execute Photoshop', execution);
  assert(execution.canClaimDesignComplete === false, 'execution plan cannot claim design completion', execution);
  assert(execution.canClaimOutputQuality === false, 'execution plan cannot claim output quality', execution);

  const operations = flattenOperations(execution);
  const toolNames = new Set(operations.map((operation) => operation.tool));
  for (const tool of ['createDocument', 'createGroup', 'placeImage', 'transformLayer', 'exportGroup']) {
    assert(toolNames.has(tool), `execution plan should include ${tool} operation`, execution);
  }

  const documentOperations = execution.documents.map((document) => document.operations[0]?.tool);
  assert(documentOperations.every((tool) => tool === 'createDocument'), 'each document plan should start with createDocument', execution);

  const childGroupCount = production.documents.reduce((total, document) => (
    total + document.parentGroups.reduce((docTotal, group) => docTotal + group.childGroups.length, 0)
  ), 0);
  const transformOperations = operations.filter((operation) => operation.tool === 'transformLayer');
  assert(transformOperations.length === childGroupCount, 'each child group should get one transformLayer operation', {
    childGroupCount,
    transformCount: transformOperations.length
  });
  assert(transformOperations.every((operation) => operation.destinationBox && !operation.actualBounds), 'planned destinationBox must be separate from missing actualBounds', transformOperations);
  assert(transformOperations.every((operation) => operation.requiredReadback.includes('actualBounds')), 'transform operations must require actualBounds readback', transformOperations);
  assert(transformOperations.every((operation) => operation.placementPlanId), 'transform operations must link to placement plan record', transformOperations);

  const exportOperations = operations.filter((operation) => operation.tool === 'exportGroup');
  assert(exportOperations.length === production.exportSpecs.length, 'each export spec should have an exportGroup operation', {
    exportSpecCount: production.exportSpecs.length,
    exportOperationCount: exportOperations.length
  });
  assert(exportOperations.every((operation) => Array.isArray(operation.groupPath) && operation.groupPath.length === 2), 'export operations should target parent/child group path', exportOperations);

  const blockedMissingPlacement = buildMainImageProductionExecutionPlan({
    productionDocumentStructure: production,
    selectedAsset
  });
  assert(blockedMissingPlacement.status === 'blocked_missing_variant_placement_strategy', 'missing placement strategy should block execution plan record', blockedMissingPlacement);
  assert(blockedMissingPlacement.documents.length === 0, 'blocked execution record must not fabricate document operations', blockedMissingPlacement);

  const blockedMissingAsset = buildMainImageProductionExecutionPlan({
    productionDocumentStructure: production,
    variantPlacementStrategy: placement
  });
  assert(blockedMissingAsset.status === 'blocked_missing_selected_asset', 'missing selected asset should block execution plan record', blockedMissingAsset);
  assert(blockedMissingAsset.documents.length === 0, 'missing asset must block operations', blockedMissingAsset);

  assertNoRawPayload(execution, 'production execution plan');

  const strategyInputs = buildMainImageStrategyInputs({
    userText: '看项目图片理解袜子款式，制作多个点击图和转化图',
    imageType: 'click',
    selectedAsset,
    projectAssets,
    subjectBounds,
    sizePlans,
    copyCandidates: ['轻薄堆叠，春夏更自在'],
    outputDir: 'C:/Exports',
    toolNames: ['createDocument', 'createGroup', 'placeImage', 'transformLayer', 'exportGroup'],
    visionSignal: visualSignal,
    mainImagePlatformProfile: buildProfile()
  });

  assert(strategyInputs.productionExecutionPlan, 'strategy input builder should expose production execution plan record', strategyInputs);
  assert(strategyInputs.productionExecutionPlan.status === 'ready_execution_plan', 'builder should carry ready execution plan status', strategyInputs.productionExecutionPlan);
  assert(strategyInputs.strategyInputs.exportAcceptancePolicy.productionExecutionPlanStatus === 'ready_execution_plan', 'export policy should reference execution plan status', strategyInputs.strategyInputs.exportAcceptancePolicy);
  assert(strategyInputs.strategyInputs.exportAcceptancePolicy.plannedOperationCount > 0, 'export policy should expose planned operation count', strategyInputs.strategyInputs.exportAcceptancePolicy);

  console.log(JSON.stringify({
    success: true,
    checks: [
      'production execution plan mirrors production document structure',
      'planned Photoshop operations stay read-only record',
      'transform operations link child groups to placement plans',
      'destinationBox remains distinct from actualBounds',
      '1200/9:16 project-rule profile is included without conversion exports',
      'strategy input builder exposes productionExecutionPlan'
    ]
  }, null, 2));
}

try {
  run();
} catch (error) {
  console.error(error);
  process.exit(1);
}
