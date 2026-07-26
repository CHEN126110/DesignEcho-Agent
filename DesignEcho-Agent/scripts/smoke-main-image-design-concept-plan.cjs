#!/usr/bin/env node

const path = require('path');

require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '..', 'tsconfig.main.json')
});

const repoRoot = path.resolve(__dirname, '..');

const {
  buildMainImageDesignConceptPlan
} = require(path.join(repoRoot, 'src', 'shared', 'main-image-design-concept-plan.ts'));
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

const visionSignal = {
  source: 'vision-model',
  assetRef: { id: 'asset-1', path: 'C:/project/assets/white-slouch-socks-01.jpg', name: 'white-slouch-socks-01.jpg' },
  productType: '堆堆袜',
  subjectSummary: '白色堆堆袜，松弛褶皱感，适合春夏清爽穿搭主图',
  backgroundSummary: '浅色背景，模特脚部局部露出',
  styleHints: ['白色', '松弛褶皱', '春夏穿搭'],
  sourceNotes: ['视觉模型：白色堆堆袜', '视觉模型：褶皱袜筒和清爽穿搭氛围']
};

const agentDesignDecision = {
  styleKeywords: ['松弛堆叠', '浅色干净'],
  recommendedTone: '清爽、可信、低广告感',
  backgroundDirection: '模型决策：浅色干净背景，保留足够留白，突出袜子轮廓和纹理。',
  clickVisualHooks: ['罗口轮廓', '上脚氛围'],
  conversionVisualHooks: ['透气纹理', '袜口舒适感'],
  clickLayoutFocus: '模型决策：主体靠中上，标题避开袜口细节。',
  conversionLayoutFocus: '模型决策：主体与卖点分区，保留材质细节放大位。',
  clickCopyRole: '模型决策：短标题强调第一眼清爽感。',
  conversionCopyRole: '模型决策：说明透气纹理和袜口舒适体验。'
};

const readyContext = {
  userText: '帮我用这张袜子图做主图，突出轻薄透气和春夏搭配感',
  imageType: 'click',
  currentDocument: { id: 1, name: 'SKU.psb', width: 1200, height: 1200 },
  selectedAsset,
  projectAssets: [selectedAsset],
  subjectBounds: { left: 170, top: 150, right: 930, bottom: 970, width: 760, height: 820 },
  sizePlans: [{
    sizeKey: '800',
    targetSize: { width: 800, height: 800 },
    subjectSize: { width: 760, height: 820 },
    scale: 0.67,
    targetX: 118,
    targetY: 92,
    decisionReason: 'main image guideline scale 67%',
    smartLayoutPlanned: true,
    quickExportPlanned: true
  }],
  copyCandidates: ['轻薄堆叠，春夏更自在', '柔软袜口，不勒脚踝'],
  outputDir: 'C:/Exports',
  toolNames: ['getDocumentInfo', 'getLayerBounds', 'smartLayout[800]', 'quickExport[800]'],
  visionSignal,
  agentDesignDecision
};

function run() {
  const missing = buildMainImageDesignConceptPlan({});
  assert(missing.status === 'blocked_missing_design_core', 'missing design core should block concept plan', missing);
  assert(missing.noPhotoshopWrites === true, 'concept plan must be read-only', missing);
  assert(missing.mustNotExecutePhotoshop === true, 'concept plan must not execute Photoshop', missing);
  assertNoUnsupportedScore(missing, 'missing concept plan');

  const strategy = buildMainImageStrategyInputs(readyContext);
  const concept = strategy.designConceptPlan;
  assert(concept, 'strategy input builder should expose design concept plan', strategy);
  assert(concept.status === 'ready_design_concept_plan', 'ready strategy should produce design concept plan', concept);
  assert(concept.variantConcepts.length === 5, 'concept plan should cover 800/750 click+conversion and 1200 click only', concept.variantConcepts);
  assert(concept.variantConcepts.some((item) => item.folderKey === '1200' && item.imageType === 'click'), '1200 click concept missing', concept.variantConcepts);
  assert(!concept.variantConcepts.some((item) => item.folderKey === '1200' && item.imageType === 'conversion'), '1200 conversion concept must not exist', concept.variantConcepts);
  assert(concept.variantConcepts.every((item) => item.visualHierarchy.length >= 3), 'each concept should include visual hierarchy', concept.variantConcepts);
  assert(concept.variantConcepts.every((item) => item.copySlots.length > 0), 'each concept should include copy slots', concept.variantConcepts);
  assert(concept.variantConcepts.every((item) => item.factClaims.length > 0), 'each concept should include product fact claims', concept.variantConcepts);
  assert(concept.backgroundDirection === agentDesignDecision.backgroundDirection, 'background direction must come from agent decision instead of keyword inference', concept);
  assert(concept.sharedConcept.tone === agentDesignDecision.recommendedTone, 'tone must preserve agent decision', concept.sharedConcept);
  assert(
    strategy.projectStyleStrategy.variantPlan.clickImages[0].visualHook === agentDesignDecision.clickVisualHooks[0],
    'click visual hook must come from agent decision',
    strategy.projectStyleStrategy.variantPlan.clickImages[0]
  );
  assert(
    strategy.projectStyleStrategy.variantPlan.conversionImages[0].layoutFocus === agentDesignDecision.conversionLayoutFocus,
    'conversion layout focus must come from agent decision',
    strategy.projectStyleStrategy.variantPlan.conversionImages[0]
  );
  assert(strategy.strategyInputs.imagePlacementPolicy.designConceptStatus === 'ready_design_concept_plan', 'image placement policy should carry concept status', strategy.strategyInputs.imagePlacementPolicy);
  assert(strategy.strategyInputs.copyRolePolicy.designConceptVariantCount === concept.variantConcepts.length, 'copy policy should carry concept variant count', strategy.strategyInputs.copyRolePolicy);
  assert(strategy.strategyInputs.exportAcceptancePolicy.designConceptVariantCount === concept.variantConcepts.length, 'export policy should carry concept variant count', strategy.strategyInputs.exportAcceptancePolicy);
  assertNoRawPayload(concept, 'ready concept plan');
  assertNoUnsupportedScore(concept, 'ready concept plan');

  const blocked = buildMainImageDesignConceptPlan({
    designCorePlan: strategy.designCorePlan,
    projectStyleStrategy: {
      ...strategy.projectStyleStrategy,
      status: 'needs_vision',
      projectStyleUnderstanding: {
        ...strategy.projectStyleStrategy.projectStyleUnderstanding,
        semanticStatus: 'needs_vision',
        visualContext: {
          readiness: 'missing',
          source: 'missing',
          assetMatch: false,
          usableFields: [],
          reason: 'test missing visual context'
        }
      },
      variantPlan: { clickImages: [], conversionImages: [] }
    },
    copyStrategy: strategy.copyStrategy,
    variantPlacementStrategy: strategy.variantPlacementStrategy
  });
  assert(blocked.status === 'blocked_missing_visual_context', 'concept plan must block metadata-only style context', blocked);
  assert(blocked.variantConcepts.length === 0, 'blocked concept plan must not fabricate variants', blocked);

  console.log(JSON.stringify({
    success: true,
    checks: [
      'design concept plan is read-only and blocks missing design core',
      'ready concept plan covers 800/750 click+conversion and 1200 click only',
      'concept plan carries visual hierarchy, background direction, copy slots and fact claims',
      'strategy input builder carries concept status into placement, copy and export policies',
      'blocked concept plan does not fabricate variants without visual context'
    ]
  }, null, 2));
}

try {
  run();
} catch (error) {
  console.error(error);
  process.exit(1);
}
