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

function collectFieldPaths(value, fieldName, pathLabel = '$') {
  if (!value || typeof value !== 'object') return [];
  const paths = [];
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      paths.push(...collectFieldPaths(item, fieldName, `${pathLabel}[${index}]`));
    });
    return paths;
  }
  for (const [key, child] of Object.entries(value)) {
    const childPath = `${pathLabel}.${key}`;
    if (key === fieldName) paths.push(childPath);
    paths.push(...collectFieldPaths(child, fieldName, childPath));
  }
  return paths;
}

function assertNoConfidenceField(value, label) {
  const paths = collectFieldPaths(value, 'confidence');
  assert(paths.length === 0, `${label} output JSON must not contain confidence fields`, { paths, value });
}

const projectAssets = [
  {
    id: 'asset-1',
    name: 'white-slouch-socks-01.jpg',
    path: 'C:/project/assets/white-slouch-socks-01.jpg',
    role: 'project-image',
    width: 1600,
    height: 1600
  },
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
  assetRef: {
    id: 'asset-1',
    path: 'C:/project/assets/white-slouch-socks-01.jpg',
    name: 'white-slouch-socks-01.jpg'
  },
  productType: '堆堆袜',
  subjectSummary: '白色堆堆袜，松弛褶皱感，适合春夏清爽穿搭主图',
  backgroundSummary: '浅色背景，模特脚部局部露出',
  styleHints: ['白色', '褶皱袜筒'],
  sourceNotes: ['视觉模型：白色堆堆袜', '视觉模型：褶皱袜筒和清爽穿搭氛围']
};

const agentDesignDecision = {
  styleKeywords: ['松弛堆叠', '浅色干净'],
  recommendedTone: '模型决策：清爽、可信、低广告感',
  backgroundDirection: '模型决策：浅色干净背景，保留足够留白。',
  clickVisualHooks: ['罗口轮廓', '上脚氛围', '颜色与轮廓'],
  conversionVisualHooks: ['透气纹理', '袜口舒适感'],
  clickLayoutFocus: '模型决策：主体靠中上，标题避开袜口细节。',
  conversionLayoutFocus: '模型决策：主体与卖点分区，保留材质细节放大位。',
  clickCopyRole: '模型决策：短标题强调第一眼清爽感。',
  conversionCopyRole: '模型决策：说明透气纹理和袜口舒适体验。',
  referenceQueries: ['模型决策：白色堆堆袜 主图 参考']
};

const sizePlans = [{
  sizeKey: '800',
  targetSize: { width: 800, height: 800 },
  subjectSize: { width: 760, height: 820 },
  scale: 0.67,
  targetX: 118,
  targetY: 92,
  decisionReason: 'main image guideline scale 67%',
  smartLayoutPlanned: true,
  quickExportPlanned: true
}];

function run() {
  const metadataOnly = buildMainImageProjectStyleStrategy({
    userText: '用户说明这是白色堆堆袜，请做几张点击图和转化图 raw-image-payload data:image/png;base64,abc',
    projectAssets,
    selectedAsset: projectAssets[0],
    desiredClickImageCount: 2,
    desiredConversionImageCount: 2
  });

  assert(metadataOnly.version === 'main-image-project-style-strategy/v0', 'version mismatch', metadataOnly);
  assert(metadataOnly.status === 'needs_vision', 'metadata-only project style must require vision before style claims', metadataOnly);
  assert(metadataOnly.projectStyleUnderstanding.productType === 'unknown', 'metadata-only must not guess product type', metadataOnly);
  assert(metadataOnly.projectStyleUnderstanding.visualContext.readiness === 'missing', 'user description must remain a user fact, not visual analysis', metadataOnly);
  assert(metadataOnly.variantPlan.clickImages.length === 0, 'metadata-only must not generate click image variants', metadataOnly);
  assert(metadataOnly.variantPlan.conversionImages.length === 0, 'metadata-only must not generate conversion image variants', metadataOnly);
  assert(metadataOnly.referenceResearchPlan.status === 'planned_not_run', 'reference search must be a plan, not a fabricated result', metadataOnly);
  assert(metadataOnly.noPhotoshopWrites === true, 'style strategy must be read-only', metadataOnly);
  assert(metadataOnly.mustNotExecutePhotoshop === true, 'style strategy must not execute Photoshop', metadataOnly);
  assertNoRawPayload(metadataOnly, 'metadata-only project style context');
  assertNoConfidenceField(metadataOnly, 'metadata-only project style context');

  const readyWithVisualContext = buildMainImageProjectStyleStrategy({
    userText: '看项目图片理解袜子款式，查找参考，制作多个点击图和转化图',
    projectAssets,
    selectedAsset: projectAssets[0],
    visionSignal: visualSignal,
    agentDesignDecision,
    desiredClickImageCount: 3,
    desiredConversionImageCount: 2,
    referenceHints: [
      { title: '清爽白袜电商主图参考', source: 'manual-reference-note', url: 'https://example.com/ref' }
    ]
  });

  assert(readyWithVisualContext.status === 'ready_visual_context', 'asset-bound visual context should be ready', readyWithVisualContext);
  assert(readyWithVisualContext.projectStyleUnderstanding.productType === '堆堆袜', 'visual product type should be preserved', readyWithVisualContext);
  assert(readyWithVisualContext.projectStyleUnderstanding.visualContext.source === 'vision-model', 'visual source should be preserved', readyWithVisualContext);
  assert(readyWithVisualContext.projectStyleUnderstanding.visualContext.assetMatch === true, 'visual context must match selected asset', readyWithVisualContext);
  assert(readyWithVisualContext.designDirection.objectives.includes('click-image'), 'design direction should include click-image objective', readyWithVisualContext);
  assert(readyWithVisualContext.designDirection.objectives.includes('conversion-image'), 'design direction should include conversion-image objective', readyWithVisualContext);
  assert(readyWithVisualContext.designDirection.styleKeywords[0] === agentDesignDecision.styleKeywords[0], 'style keywords must come from agent decision', readyWithVisualContext.designDirection);
  assert(readyWithVisualContext.designDirection.recommendedTone === agentDesignDecision.recommendedTone, 'recommended tone must come from agent decision', readyWithVisualContext.designDirection);
  assert(readyWithVisualContext.referenceResearchPlan.querySeeds[0] === agentDesignDecision.referenceQueries[0], 'reference query must use agent decision when provided', readyWithVisualContext.referenceResearchPlan);
  assert(readyWithVisualContext.variantPlan.clickImages.length === 3, 'should plan requested click image variants', readyWithVisualContext);
  assert(readyWithVisualContext.variantPlan.conversionImages.length === 2, 'should plan requested conversion image variants', readyWithVisualContext);
  assert(readyWithVisualContext.variantPlan.clickImages.every((item) => item.imageType === 'click'), 'click variants should be typed', readyWithVisualContext);
  assert(readyWithVisualContext.variantPlan.conversionImages.every((item) => item.imageType === 'conversion'), 'conversion variants should be typed', readyWithVisualContext);
  assert(readyWithVisualContext.variantPlan.clickImages[0].visualHook === agentDesignDecision.clickVisualHooks[0], 'click visual hook must come from agent decision', readyWithVisualContext.variantPlan.clickImages[0]);
  assert(readyWithVisualContext.variantPlan.conversionImages[0].copyRole === agentDesignDecision.conversionCopyRole, 'conversion copy role must come from agent decision', readyWithVisualContext.variantPlan.conversionImages[0]);
  assert(readyWithVisualContext.canClaimDesignComplete === false, 'variant strategy cannot claim design complete', readyWithVisualContext);
  assert(readyWithVisualContext.canClaimOutputQuality === false, 'variant strategy cannot claim output quality', readyWithVisualContext);
  assertNoRawPayload(readyWithVisualContext, 'ready project style context');
  assertNoConfidenceField(readyWithVisualContext, 'ready project style context');

  const strategyInputs = buildMainImageStrategyInputs({
    userText: '做几张点击图和转化图',
    imageType: 'click',
    selectedAsset: projectAssets[0],
    projectAssets,
    subjectBounds: { left: 170, top: 150, right: 930, bottom: 970, width: 760, height: 820 },
    sizePlans,
    copyCandidates: ['清爽堆叠，春夏更自在'],
    outputDir: 'C:/Exports',
    toolNames: ['getDocumentInfo', 'getSubjectBounds', 'smartLayout[800]'],
    visionSignal: visualSignal,
    agentDesignDecision
  });

  assert(strategyInputs.projectStyleStrategy, 'strategy input builder should expose project style context', strategyInputs);
  assert(strategyInputs.projectStyleStrategy.status === 'ready_visual_context', 'strategy builder should carry visual context', strategyInputs);
  assert(strategyInputs.strategyInputs.copyRolePolicy.projectStyleStrategyStatus === 'ready_visual_context', 'copy policy should reference project style status', strategyInputs.strategyInputs.copyRolePolicy);
  assertNoRawPayload(strategyInputs.projectStyleStrategy, 'builder project style context');
  assertNoConfidenceField(strategyInputs.projectStyleStrategy, 'builder project style context');

  console.log(JSON.stringify({
    success: true,
    checks: [
      'metadata-only project images cannot produce sock style claims or variants',
      'asset-bound visual context can produce click and conversion image variant plans',
      'reference research is planned context, not fabricated search results',
      'project style strategy is read-only and cannot execute Photoshop',
      'main-image strategy input builder exposes projectStyleStrategy'
    ]
  }, null, 2));
}

try {
  run();
} catch (error) {
  console.error(error);
  process.exit(1);
}
