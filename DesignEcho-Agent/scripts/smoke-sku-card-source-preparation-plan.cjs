#!/usr/bin/env node

require('ts-node').register({
  transpileOnly: true,
  compilerOptions: {
    target: 'ES2020',
    module: 'CommonJS',
    moduleResolution: 'node',
    esModuleInterop: true,
    skipLibCheck: true
  }
});

const fs = require('fs');
const path = require('path');

const {
  buildSkuCardSourcePreparationPlan
} = require('../src/shared/sku-card-source-preparation-plan.ts');

const projectRoot = path.resolve(__dirname, '..');
const skuExecutorSource = fs.readFileSync(
  path.join(projectRoot, 'src', 'renderer', 'services', 'skill-executors', 'sku-batch.executor.ts'),
  'utf8'
);
const skuColorCardExecutorSource = fs.readFileSync(
  path.join(projectRoot, 'src', 'renderer', 'services', 'skill-executors', 'sku-color-card.executor.ts'),
  'utf8'
);

function assert(condition, message, details) {
  if (!condition) {
    throw new Error(`${message}${details ? `\n${JSON.stringify(details, null, 2)}` : ''}`);
  }
}

const readyCandidateReport = {
  version: 'sku-card-asset-candidates/v0',
  mode: 'card-style',
  status: 'ready_for_selection',
  candidateCount: 3,
  candidates: [
    {
      assetId: 'flat-white',
      path: 'E:/fixture/source/white.jpg',
      relativePath: 'source/white.jpg',
      role: 'raw-product-still',
      score: 118,
      recommendedUse: 'primary_sku_card',
      needsVisualConfirmation: false,
      skuColorName: '奶白',
      reasons: ['视觉观察显示主体完整，适合 SKU 卡片置入。'],
      warnings: []
    },
    {
      assetId: 'flat-black',
      path: 'E:/fixture/source/black.jpg',
      relativePath: 'source/black.jpg',
      role: 'raw-product-still',
      score: 114,
      recommendedUse: 'secondary_sku_card',
      needsVisualConfirmation: false,
      skuColorName: '黑色',
      reasons: ['视觉观察显示主体完整，适合 SKU 卡片置入。'],
      warnings: []
    },
    {
      assetId: 'detail',
      path: 'E:/fixture/source/detail.jpg',
      relativePath: 'source/detail.jpg',
      role: 'raw-detail-closeup',
      score: 34,
      recommendedUse: 'reference_only',
      needsVisualConfirmation: false,
      reasons: [],
      warnings: []
    }
  ],
  blockers: [],
  warnings: [],
  limitations: [],
  sourceRecords: []
};

const ready = buildSkuCardSourcePreparationPlan({
  projectPath: 'E:/fixture/project',
  skuCardAssetCandidateReport: readyCandidateReport,
  maxSources: 4
});

assert(ready.status === 'ready_for_preparation', 'ready visual candidates should produce a source preparation plan', ready);
assert(ready.canRunPhotoshopWrites === true, 'ready plan should explicitly allow controlled Photoshop writes', ready);
assert(ready.outputDocumentPath.replace(/\\/g, '/').endsWith('/PSD/SKU-card-source.psb'), 'output should target a non-destructive project SKU card source document', ready);
assert(ready.selectedSources.length === 2, 'reference-only images must not become source groups', ready);
assert(ready.selectedSources.map((item) => item.colorName).join(',') === '1,2', 'default color group names should be stable numeric slots', ready);
assert(ready.selectedSources.map((item) => item.displayName).join(',') === '奶白,黑色', 'source plan should preserve user-facing color names separately from numeric slots', ready);

const blockedByMinimumColorSlots = buildSkuCardSourcePreparationPlan({
  projectPath: 'E:/fixture/project',
  skuCardAssetCandidateReport: readyCandidateReport,
  maxSources: 4,
  minimumSourceCount: 4
});
assert(
  blockedByMinimumColorSlots.status === 'blocked_candidates_not_ready',
  'SKU source preparation should block when confirmed source count is below required color slots',
  blockedByMinimumColorSlots
);
assert(
  blockedByMinimumColorSlots.blockers.some((item) => item.includes('至少 4 个颜色槽') && item.includes('当前只有 2 个')),
  'minimum color slot blocker should be user-understandable',
  blockedByMinimumColorSlots
);

const equalScoreColorOrder = buildSkuCardSourcePreparationPlan({
  projectPath: 'E:/fixture/project',
  skuCardAssetCandidateReport: {
    ...readyCandidateReport,
    candidateCount: 4,
    candidates: [
      {
        ...readyCandidateReport.candidates[0],
        assetId: 'gray',
        path: 'E:/fixture/source/gray.jpg',
        relativePath: 'source/gray.jpg',
        skuColorName: '灰色',
        score: 133
      },
      {
        ...readyCandidateReport.candidates[0],
        assetId: 'pink',
        path: 'E:/fixture/source/pink.jpg',
        relativePath: 'source/pink.jpg',
        skuColorName: '粉色',
        score: 133
      },
      {
        ...readyCandidateReport.candidates[0],
        assetId: 'coffee',
        path: 'E:/fixture/source/coffee.jpg',
        relativePath: 'source/coffee.jpg',
        skuColorName: '浅咖',
        score: 133
      },
      {
        ...readyCandidateReport.candidates[0],
        assetId: 'cream',
        path: 'E:/fixture/source/cream.jpg',
        relativePath: 'source/cream.jpg',
        skuColorName: '奶白',
        score: 133
      }
    ]
  },
  maxSources: 4,
  minimumSourceCount: 4
});
assert(
  equalScoreColorOrder.selectedSources.map((item) => `${item.colorName}:${item.displayName}`).join('|') === '1:奶白|2:粉色|3:浅咖|4:灰色',
  'equal-score color card sources should use stable buyer-facing color order before numeric slots',
  equalScoreColorOrder
);

const toolNames = ready.toolRequests.map((item) => item.toolName);
for (const required of ['createDocument', 'createGroup', 'createRectangle', 'placeImage', 'createClippingMask', 'moveLayerToGroup', 'createTextLayer', 'switchDocument', 'getDocumentInfo', 'saveDocument', 'getAcceptanceSnapshot']) {
  assert(toolNames.includes(required), `source preparation plan should include ${required}`, ready);
}
assert(
  ready.toolRequests.some((item) => item.toolName === 'createRectangle' && item.params?.name === '1-色卡底'),
  'source preparation should create a visible card background for each color source',
  ready
);
assert(
  ready.toolRequests.some((item) => item.toolName === 'placeImage' && item.params?.targetBounds && item.params?.targetFit === 'cover'),
  'source preparation should place product images into a fixed card image area',
  ready
);
assert(
  ready.toolRequests.some((item) => item.toolName === 'createClippingMask' && item.params?.layerIdSource === 'previous_placeImage_result'),
  'source preparation should clip each product image to its card background',
  ready
);
assert(
  toolNames.indexOf('createClippingMask') > toolNames.indexOf('placeImage')
    && toolNames.indexOf('createClippingMask') < toolNames.lastIndexOf('createTextLayer'),
  'source preparation should create the clipping mask before adding label and number layers above the product image',
  ready
);
assert(
  ready.toolRequests.some((item) => item.toolName === 'createTextLayer' && item.params?.content === '奶白'),
  'source preparation should add user-facing color labels on the color card',
  ready
);
assert(
  ready.toolRequests.some((item) => item.toolName === 'createTextLayer' && item.params?.content === '1'),
  'source preparation should add stable numeric slot labels on the color card',
  ready
);
assert(
  toolNames.indexOf('switchDocument') > toolNames.lastIndexOf('moveLayerToGroup')
    && toolNames.indexOf('switchDocument') < toolNames.indexOf('saveDocument')
    && toolNames.indexOf('getDocumentInfo') < toolNames.indexOf('saveDocument'),
  'source preparation should reactivate and read back the created document before saving',
  ready
);
assert(
  ready.toolRequests.find((item) => item.toolName === 'saveDocument')?.params?.path === ready.outputDocumentPath,
  'saveDocument request should use the planned output path',
  ready
);
assert(!JSON.stringify(ready).includes('C-1194'), 'plan must not hardcode the exam project path', ready);
assert(!JSON.stringify(ready).includes('C-1137'), 'plan must not hardcode the reference project path', ready);
assert(
  skuExecutorSource.includes("runSkill('sku-color-card'")
    && /callTool\(\s*'createClippingMask'[\s\S]{0,220}layerId:\s*imageLayerId/.test(skuColorCardExecutorSource)
    && /callTool\(\s*'getClippingMaskInfo'[\s\S]{0,220}layerId:\s*imageLayerId/.test(skuColorCardExecutorSource),
  'SKU source preparation must delegate to the color-card Skill, which applies and reads back the product clipping mask',
  { excerpt: skuColorCardExecutorSource.match(/const clippingResult[\s\S]{0,900}/)?.[0] || '' }
);
assert(
  skuExecutorSource.includes('委派 SKU 色卡能力')
    && skuColorCardExecutorSource.includes('检查 SKU 色卡输入与结构')
    && skuColorCardExecutorSource.includes('制作色卡')
    && skuColorCardExecutorSource.includes('色卡结构已确认')
    && skuColorCardExecutorSource.includes('已读回智能对象、商品图剪切关系'),
  'SKU source preparation must expose source intake, delegated execution and clipping/readback checks instead of showing only tool rows'
);
assert(
  /sources:\s*plan\.selectedSources\.map/.test(skuExecutorSource)
    && /detail:\s*`\$\{slot\.source\.colorName\}\s*←\s*\$\{slot\.source\.filePath\}`/.test(skuColorCardExecutorSource)
    && skuColorCardExecutorSource.includes('isSkuColorCardClippingReadbackVerified(clippingReadback)'),
  'SKU source preparation visible steps must be grounded in selected sources, source paths and clipping-mask readback data'
);

const blockedByVisual = buildSkuCardSourcePreparationPlan({
  projectPath: 'E:/fixture/project',
  skuCardAssetCandidateReport: {
    ...readyCandidateReport,
    status: 'needs_visual_confirmation',
    candidates: readyCandidateReport.candidates.map((candidate) => ({
      ...candidate,
      needsVisualConfirmation: candidate.recommendedUse !== 'reference_only'
    }))
  }
});
assert(blockedByVisual.status === 'blocked_candidates_not_ready', 'unconfirmed candidates must block source preparation', blockedByVisual);
assert(blockedByVisual.canRunPhotoshopWrites === false, 'blocked visual plan must not allow Photoshop writes', blockedByVisual);
assert(blockedByVisual.blockers.some((item) => item.includes('视觉确认')), 'visual blocker should be user-understandable', blockedByVisual);

const blockedByProject = buildSkuCardSourcePreparationPlan({
  projectPath: '',
  skuCardAssetCandidateReport: readyCandidateReport
});
assert(blockedByProject.status === 'blocked_missing_project_path', 'missing project path must block source preparation', blockedByProject);
assert(blockedByProject.toolRequests.length === 0, 'blocked plan must not include write requests', blockedByProject);

console.log(JSON.stringify({
  ok: true,
  readyStatus: ready.status,
  selectedSources: ready.selectedSources.length,
  blockedStatus: blockedByVisual.status
}, null, 2));
