#!/usr/bin/env node

const path = require('path');

require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '..', 'tsconfig.main.json')
});

const repoRoot = path.resolve(__dirname, '..');

const {
  buildMainImageCopyStrategy
} = require(path.join(repoRoot, 'src', 'shared', 'main-image-copy-strategy.ts'));
const {
  buildMainImageProjectStyleStrategy
} = require(path.join(repoRoot, 'src', 'shared', 'main-image-project-style-strategy.ts'));
const {
  buildMainImageStrategyInputs
} = require(path.join(repoRoot, 'src', 'shared', 'main-image-strategy-input-builder.ts'));
const {
  formatCopywritingFrameworkForPrompt
} = require(path.join(repoRoot, 'src', 'shared', 'design-copywriting-framework.ts'));

function assert(condition, message, details) {
  if (!condition) {
    const suffix = details ? `\n${JSON.stringify(details, null, 2)}` : '';
    throw new Error(`${message}${suffix}`);
  }
}

function assertNoUnsupportedScore(value, label) {
  const serialized = JSON.stringify(value);
  const forbidden = ['"con' + 'fidence"', 'con' + 'fidence:', String.fromCharCode(32622, 20449)];
  const found = forbidden.filter((token) => serialized.includes(token));
  assert(found.length === 0, `${label} must not serialize unsupported score wording: ${found.join(', ')}`, value);
}

const selectedAsset = {
  id: 'asset-1',
  name: 'white-slouch-socks-01.jpg',
  path: 'C:/project/assets/white-slouch-socks-01.jpg',
  role: 'selected-project-image',
  width: 1600,
  height: 1600
};

const projectAssets = [selectedAsset];

const readyVisionSignal = {
  source: 'vision-model',
  assetRef: { id: 'asset-1', path: 'C:/project/assets/white-slouch-socks-01.jpg', name: 'white-slouch-socks-01.jpg' },
  productType: '堆堆袜',
  subjectSummary: '白色堆堆袜，松弛褶皱感，适合春夏清爽穿搭主图',
  backgroundSummary: '浅色背景，模特脚部局部露出',
  sourceNotes: ['视觉模型：白色堆堆袜', '视觉模型：褶皱袜筒和清爽穿搭氛围']
};

const readyStyle = buildMainImageProjectStyleStrategy({
  userText: '看项目图片理解袜子款式，制作多个点击图和转化图',
  projectAssets,
  selectedAsset,
  visionSignal: readyVisionSignal,
  referenceHints: [{
    title: '袜子春夏主图参考',
    source: 'manual-reference-note',
    note: '浅色背景、主体大、标题短'
  }],
  desiredClickImageCount: 2,
  desiredConversionImageCount: 2
});

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
  const missingStyle = buildMainImageCopyStrategy({
    userText: '帮我做主图文案',
    copyCandidates: ['轻薄堆叠，春夏更自在']
  });
  assert(missingStyle.status === 'blocked_missing_project_style_strategy', 'missing style should block copy strategy', missingStyle);
  assert(missingStyle.blockers.includes('main_image_project_style_strategy_required'), 'missing style blocker mismatch', missingStyle);
  assert(missingStyle.noPhotoshopWrites === true, 'copy strategy must be read-only', missingStyle);
  assert(missingStyle.mustNotExecutePhotoshop === true, 'copy strategy must not execute Photoshop', missingStyle);
  assertNoUnsupportedScore(missingStyle, 'missing-style copy strategy');

  const metadataOnlyStyle = buildMainImageProjectStyleStrategy({
    userText: '做袜子主图',
    projectAssets,
    selectedAsset
  });
  const blockedVision = buildMainImageCopyStrategy({
    userText: '做袜子主图',
    projectStyleStrategy: metadataOnlyStyle,
    copyCandidates: ['春夏更自在']
  });
  assert(blockedVision.status === 'blocked_missing_visual_context', 'metadata-only style should block semantic copy strategy', blockedVision);
  assert(blockedVision.contextChecklist.ready === false, 'metadata-only copy checklist must not be ready', blockedVision);
  assert(blockedVision.candidates.length === 0, 'blocked copy strategy must not accept semantic candidates', blockedVision);
  assertNoUnsupportedScore(blockedVision, 'metadata-only copy strategy');

  const ready = buildMainImageCopyStrategy({
    userText: '帮我做主图，需要轻薄透气和春夏搭配感',
    projectStyleStrategy: readyStyle,
    copyCandidates: ['轻薄堆叠，春夏更自在', '柔软袜口，不勒脚踝']
  });
  assert(ready.version === 'main-image-copy-strategy/v0', 'copy strategy version mismatch', ready);
  assert(ready.status === 'ready_copy_strategy', 'asset-bound visual context should make copy strategy ready', ready);
  assert(ready.contextChecklist.ready === true, 'ready copy strategy should pass context checklist', ready.contextChecklist);
  assert(ready.candidates.length === 2, 'ready copy strategy should keep provided candidates', ready.candidates);
  assert(ready.candidates[0].role === 'click-headline', 'first candidate should be click headline', ready.candidates[0]);
  assert(ready.candidates[1].role === 'conversion-benefit', 'second candidate should be conversion benefit', ready.candidates[1]);
  assert(ready.candidates.every((item) => item.supportNotes.length > 0), 'each candidate should carry support notes', ready.candidates);
  assert(ready.productCopyContext.visualAnchors.length > 0, 'ready copy strategy should expose visual anchors', ready.productCopyContext);
  assert(ready.productCopyContext.productFacts.some((item) => item.includes('堆堆袜')), 'ready copy strategy should expose product facts', ready.productCopyContext);
  assert(ready.productCopyContext.userProblems.length > 0, 'ready copy strategy should translate visual facts into user problems', ready.productCopyContext);
  assert(ready.recommendedTemplates.some((item) => item.id === 'visual-carry'), 'ready copy strategy should recommend visual-carry template', ready.recommendedTemplates);
  assert(ready.textSlotPlan.some((slot) => slot.role === 'click-headline'), 'copy strategy should reserve click headline slot', ready.textSlotPlan);
  assert(ready.textSlotPlan.some((slot) => slot.role === 'conversion-benefit'), 'copy strategy should reserve conversion benefit slot', ready.textSlotPlan);
  assertNoUnsupportedScore(ready, 'ready copy strategy');

  const strategy = buildMainImageStrategyInputs({
    userText: '帮我用这张袜子图做主图',
    imageType: 'click',
    currentDocument: { id: 1, name: 'SKU.psb', width: 1200, height: 1200 },
    projectAssets,
    selectedAsset,
    subjectBounds: { left: 170, top: 150, right: 930, bottom: 970, width: 760, height: 820 },
    sizePlans,
    copyCandidates: ['轻薄堆叠，春夏更自在', '柔软袜口，不勒脚踝'],
    outputDir: 'C:/Exports',
    toolNames: ['getDocumentInfo', 'getLayerBounds', 'smartLayout[800]', 'quickExport[800]'],
    visionSignal: readyVisionSignal
  });
  assert(strategy.copyStrategy, 'strategy input builder should expose copy strategy', strategy);
  assert(strategy.copyStrategy.status === 'ready_copy_strategy', 'strategy input copy strategy should be ready', strategy.copyStrategy);
  assert(strategy.strategyInputs.copyRolePolicy.copyStrategyStatus === 'ready_copy_strategy', 'copyRolePolicy should carry copy strategy status', strategy.strategyInputs.copyRolePolicy);
  assert(Array.isArray(strategy.strategyInputs.copyRolePolicy.recommendedTemplateIds), 'copyRolePolicy should expose recommended templates', strategy.strategyInputs.copyRolePolicy);
  assertNoUnsupportedScore(strategy.copyStrategy, 'strategy builder copy strategy');
  assertNoUnsupportedScore(formatCopywritingFrameworkForPrompt(), 'copywriting framework prompt');

  console.log(JSON.stringify({
    success: true,
    checks: [
      'main-image copy strategy blocks missing style and metadata-only visual context',
      'ready copy strategy links candidates to visual/product/user-problem context',
      'copy strategy exposes editable text slot roles and recommended writing templates',
      'strategy input builder carries copy strategy into copyRolePolicy',
      'serialized copy strategy does not contain unsupported score wording'
    ]
  }, null, 2));
}

try {
  run();
} catch (error) {
  console.error(error);
  process.exit(1);
}
