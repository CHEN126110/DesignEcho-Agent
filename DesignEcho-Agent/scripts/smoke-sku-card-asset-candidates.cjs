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

const {
  buildSkuCardAssetCandidateReport
} = require('../src/shared/sku-card-asset-candidates.ts');
const {
  buildProjectVisualInsightCacheReadResult
} = require('../src/shared/project-visual-insight-cache.ts');

function assert(condition, message, details) {
  if (!condition) {
    throw new Error(`${message}${details ? `\n${JSON.stringify(details, null, 2)}` : ''}`);
  }
}

function asset(id, relativePath, role, width, height, confidence = 0.78) {
  return {
    id,
    path: `C:/fixture/${relativePath}`,
    relativePath,
    name: relativePath.split('/').pop(),
    extension: '.jpg',
    sizeBytes: 10_000_000,
    width,
    height,
    aspectRatio: width && height ? width / height : undefined,
    folderRole: 'source',
    role,
    comboColors: [],
    isImage: true,
    isDesignDocument: false,
    isOutput: role.includes('output'),
    needsVision: true,
    confidence,
    reasons: ['fixture'],
    classificationNotes: []
  };
}

const report = buildSkuCardAssetCandidateReport({
  assetIndex: {
    indexVersion: 'project-asset-index/v0',
    generatedFrom: 'file-metadata',
    summary: {
      totalFiles: 4,
      totalImages: 4,
      totalDesignDocuments: 0,
      roleCounts: {},
      folderRoleCounts: {},
      extensionCounts: { '.jpg': 4 },
      colorNames: [],
      skuConfigCount: 0
    },
    assets: [
      asset('flat-square', '6036/平铺/flat-square.jpg', 'raw-product-still', 4284, 4284),
      asset('model', '6036/模特/model.jpg', 'raw-model-wear', 4284, 5712),
      asset('detail', '6036/平铺/detail-close.jpg', 'raw-detail-closeup', 4284, 4284),
      asset('output', 'SKU/2双装/old.jpg', 'sku-output', 800, 800)
    ],
    representativeSamples: {},
    visionCandidates: [],
    skillReadiness: [],
    warnings: [],
    limitations: [],
    sourceRecords: []
  },
  maxCandidates: 3
});

assert(report.version === 'sku-card-asset-candidates/v0', 'version mismatch', report);
assert(report.mode === 'card-style', 'mode should be card-style', report);
assert(!Object.prototype.hasOwnProperty.call(report, 'sourceRecords'), 'candidate report should not fabricate module self-records', report);
assert(!JSON.stringify(report).includes('"evidence"'), 'candidate report must not expose a generic evidence field', report);
assert(report.candidates.length === 3, 'report should cap candidates and exclude SKU output', report);
assert(report.candidates[0].assetId === 'flat-square', 'flat square product still should rank first', report);
assert(
  report.candidates.some((item) => item.assetId === 'model' && item.recommendedUse === 'reference_only'),
  'model image should be reference only',
  report
);
assert(report.blockers.length === 0, 'fixture should not be blocked', report);
assert(report.limitations.some((line) => line.includes('不读取图片像素')), 'limitations should state no pixel reads', report);
assert(!JSON.stringify(report).includes('E:\\\\WERKE\\\\C-1194'), 'shared report must not hardcode exam project path');

const insightCache = buildProjectVisualInsightCacheReadResult({
  source: 'provided-options',
  exists: true,
  entries: [
    {
      cacheKey: 'flat',
      assetId: 'flat-square',
      path: 'C:/fixture/6036/平铺/flat-square.jpg',
      insight: {
        assetId: 'flat-square',
        path: 'C:/fixture/6036/平铺/flat-square.jpg',
        summary: '单只袜子完整平铺，主体完整，适合 SKU 卡片。',
        productType: '短筒袜',
        scene: '平铺单品',
        styleTags: ['单只', '完整主体', 'SKU卡片可用']
      }
    },
    {
      cacheKey: 'detail',
      assetId: 'detail',
      path: 'C:/fixture/6036/平铺/detail-close.jpg',
      insight: {
        assetId: 'detail',
        path: 'C:/fixture/6036/平铺/detail-close.jpg',
        summary: '袜口和面料局部特写，不是完整单品。',
        productType: '短筒袜',
        scene: '局部特写',
        styleTags: ['特写', '局部', '纹理']
      }
    },
    {
      cacheKey: 'group',
      assetId: 'group',
      path: 'C:/fixture/6036/平铺/group.jpg',
      insight: {
        assetId: 'group',
        path: 'C:/fixture/6036/平铺/group.jpg',
        summary: '多只袜子合照，适合作为款式参考，不适合直接做单张 SKU 色卡。',
        productType: '短筒袜',
        scene: '组合合照',
        styleTags: ['多只', '合照', '参考']
      }
    }
  ]
});

const visualReport = buildSkuCardAssetCandidateReport({
  assetIndex: {
    indexVersion: 'project-asset-index/v0',
    generatedFrom: 'file-metadata',
    summary: {
      totalFiles: 3,
      totalImages: 3,
      totalDesignDocuments: 0,
      roleCounts: {},
      folderRoleCounts: {},
      extensionCounts: { '.jpg': 3 },
      colorNames: [],
      skuConfigCount: 0
    },
    assets: [
      asset('detail', '6036/平铺/detail-close.jpg', 'raw-product-still', 4284, 4284),
      asset('group', '6036/平铺/group.jpg', 'raw-product-still', 4284, 4284),
      asset('flat-square', '6036/平铺/flat-square.jpg', 'raw-product-still', 4284, 4284)
    ],
    representativeSamples: {},
    visionCandidates: [],
    skillReadiness: [],
    warnings: [],
    limitations: [],
    sourceRecords: []
  },
  visualInsightCache: insightCache,
  maxCandidates: 3
});
const flatVisual = visualReport.candidates.find((item) => item.assetId === 'flat-square');
const detailVisual = visualReport.candidates.find((item) => item.assetId === 'detail');
const groupVisual = visualReport.candidates.find((item) => item.assetId === 'group');
assert(visualReport.status === 'ready_for_selection', 'cached visual insight should allow ready SKU card selection', visualReport);
assert(visualReport.candidates[0]?.assetId === 'flat-square', 'complete single product should outrank detail and group images', visualReport);
assert(flatVisual?.recommendedUse === 'primary_sku_card', 'complete single product should be primary', visualReport);
assert(flatVisual?.needsVisualConfirmation === false, 'usable cached visual observation should clear visual confirmation for primary product', visualReport);
assert(detailVisual?.recommendedUse === 'reference_only', 'detail close-up should be reference only', visualReport);
assert(groupVisual?.recommendedUse === 'reference_only', 'multi-product group image should be reference only', visualReport);
assert(
  detailVisual.score < flatVisual.score && groupVisual.score < flatVisual.score,
  'visual insight should demote close-up and group images below complete single product',
  visualReport
);

const unknownRuntimeInsightCache = buildProjectVisualInsightCacheReadResult({
  source: 'provided-options',
  exists: true,
  entries: [
    {
      cacheKey: 'runtime-unknown-flat',
      assetId: 'runtime-unknown-flat',
      path: 'C:/fixture/6036/平铺/runtime-unknown-flat.jpg',
      insight: {
        assetId: 'runtime-unknown-flat',
        path: 'C:/fixture/6036/平铺/runtime-unknown-flat.jpg',
        summary: '米色波点短袜搭配精美包装的完整平铺图，适合 SKU 卡片。',
        productType: '短筒袜',
        scene: '平铺单品',
        styleTags: ['完整主体', '平铺', 'SKU卡片可用']
      }
    }
  ]
});

const unknownRuntimeAsset = {
  ...asset('runtime-unknown-flat', '6036/平铺/runtime-unknown-flat.jpg', 'unknown', 4284, 4284, 0.3),
  folderRole: 'unknown',
  reasons: ['runtime fixture did not map folder role']
};

const unknownRuntimeReport = buildSkuCardAssetCandidateReport({
  assetIndex: {
    indexVersion: 'project-asset-index/v0',
    generatedFrom: 'file-metadata',
    summary: {
      totalFiles: 1,
      totalImages: 1,
      totalDesignDocuments: 0,
      roleCounts: { unknown: 1 },
      folderRoleCounts: { unknown: 1 },
      extensionCounts: { '.jpg': 1 },
      colorNames: [],
      skuConfigCount: 0
    },
    assets: [unknownRuntimeAsset],
    representativeSamples: {},
    visionCandidates: [],
    skillReadiness: [],
    warnings: ['未发现明确原始素材或颜色单品，业务 skill 选择需要补充上下文。'],
    limitations: [],
    sourceRecords: []
  },
  visualInsightCache: unknownRuntimeInsightCache,
  maxCandidates: 3
});
const unknownRuntimeCandidate = unknownRuntimeReport.candidates.find((item) => item.assetId === 'runtime-unknown-flat');
assert(
  unknownRuntimeReport.status === 'ready_for_selection',
  'unknown runtime assets with flat-lay path and concrete visual insight should become ready SKU card candidates',
  unknownRuntimeReport
);
assert(
  unknownRuntimeCandidate?.recommendedUse === 'primary_sku_card'
    && unknownRuntimeCandidate.needsVisualConfirmation === false,
  'visual-confirmed unknown flat-lay asset should be accepted as a primary SKU card source',
  unknownRuntimeReport
);

const staleRuntimeInsightCache = buildProjectVisualInsightCacheReadResult({
  source: 'provided-options',
  exists: true,
  entries: [
    {
      cacheKey: 'stale-flat',
      assetId: 'fresh-flat',
      path: 'C:/fixture/6036/平铺/old-folder/fresh-flat.jpg',
      insight: {
        assetId: 'fresh-flat',
        path: 'C:/fixture/6036/平铺/old-folder/fresh-flat.jpg',
        summary: '单只袜子完整平铺，主体完整，适合 SKU 卡片。',
        productType: '短筒袜',
        scene: '平铺单品',
        styleTags: ['完整主体', 'SKU卡片可用']
      }
    }
  ]
});

const staleCacheReport = buildSkuCardAssetCandidateReport({
  assetIndex: {
    indexVersion: 'project-asset-index/v0',
    generatedFrom: 'file-metadata',
    summary: {
      totalFiles: 1,
      totalImages: 1,
      totalDesignDocuments: 0,
      roleCounts: { 'raw-product-still': 1 },
      folderRoleCounts: { source: 1 },
      extensionCounts: { '.jpg': 1 },
      colorNames: [],
      skuConfigCount: 0
    },
    assets: [
      asset('fresh-flat', '6036/平铺/fresh-flat.jpg', 'raw-product-still', 4284, 4284)
    ],
    representativeSamples: {},
    visionCandidates: [],
    skillReadiness: [],
    warnings: [],
    limitations: [],
    sourceRecords: []
  },
  visualInsightCache: staleRuntimeInsightCache,
  maxCandidates: 3
});

assert(
  staleCacheReport.status === 'needs_visual_confirmation',
  'stale or moved visual cache entries must not confirm current SKU candidates',
  staleCacheReport
);
assert(
  staleCacheReport.visualInsightCoverage.entriesWithInsight === 1
    && staleCacheReport.visualInsightCoverage.matchedCandidateCount === 0,
  'candidate report should expose stale visual cache coverage instead of only cache totals',
  staleCacheReport
);
assert(
  staleCacheReport.warnings.some((item) => item.includes('没有命中当前 SKU 候选')),
  'stale visual cache should produce a user-understandable refresh warning',
  staleCacheReport
);

const countedGroupInsightCache = buildProjectVisualInsightCacheReadResult({
  source: 'provided-options',
  exists: true,
  entries: [
    {
      cacheKey: 'four-socks',
      assetId: 'four-socks',
      path: 'C:/fixture/6036/平铺/four-socks.jpg',
      insight: {
        assetId: 'four-socks',
        path: 'C:/fixture/6036/平铺/four-socks.jpg',
        summary: '四双不同颜色的波点袜子平铺展示，适合作为款式参考。',
        productType: '短筒袜',
        scene: '组合平铺',
        styleTags: ['四双', '组合', '平铺']
      }
    },
    {
      cacheKey: 'four-styles',
      assetId: 'four-styles',
      path: 'C:/fixture/6036/平铺/four-styles.jpg',
      insight: {
        assetId: 'four-styles',
        path: 'C:/fixture/6036/平铺/four-styles.jpg',
        summary: '四款不同颜色的商品平铺展示，不是单个颜色槽。',
        productType: '短筒袜',
        scene: '多款组合',
        styleTags: ['四款', '多款']
      }
    },
    {
      cacheKey: 'single-flat',
      assetId: 'single-flat',
      path: 'C:/fixture/6036/平铺/single-flat.jpg',
      insight: {
        assetId: 'single-flat',
        path: 'C:/fixture/6036/平铺/single-flat.jpg',
        summary: '单只波点短袜完整平铺，主体完整，适合 SKU 卡片。',
        productType: '短筒袜',
        scene: '平铺单品',
        styleTags: ['单只', '完整主体', 'SKU卡片可用']
      }
    }
  ]
});

const countedGroupReport = buildSkuCardAssetCandidateReport({
  assetIndex: {
    indexVersion: 'project-asset-index/v0',
    generatedFrom: 'file-metadata',
    summary: {
      totalFiles: 3,
      totalImages: 3,
      totalDesignDocuments: 0,
      roleCounts: { 'raw-product-still': 3 },
      folderRoleCounts: { source: 3 },
      extensionCounts: { '.jpg': 3 },
      colorNames: [],
      skuConfigCount: 0
    },
    assets: [
      asset('four-socks', '6036/平铺/four-socks.jpg', 'raw-product-still', 4284, 4284),
      asset('four-styles', '6036/平铺/four-styles.jpg', 'raw-product-still', 4284, 4284),
      asset('single-flat', '6036/平铺/single-flat.jpg', 'raw-product-still', 4284, 4284)
    ],
    representativeSamples: {},
    visionCandidates: [],
    skillReadiness: [],
    warnings: [],
    limitations: [],
    sourceRecords: []
  },
  visualInsightCache: countedGroupInsightCache,
  maxCandidates: 3
});

const countedSingle = countedGroupReport.candidates.find((item) => item.assetId === 'single-flat');
const countedFourSocks = countedGroupReport.candidates.find((item) => item.assetId === 'four-socks');
const countedFourStyles = countedGroupReport.candidates.find((item) => item.assetId === 'four-styles');
assert(countedSingle?.recommendedUse === 'primary_sku_card', 'single full flat-lay should remain primary', countedGroupReport);
assert(
  countedFourSocks?.recommendedUse === 'reference_only'
    && countedFourStyles?.recommendedUse === 'reference_only',
  'counted multi-item visual text like four socks/four styles should be reference only, not accepted as SKU color sources',
  countedGroupReport
);
assert(
  countedSingle.score > countedFourSocks.score && countedSingle.score > countedFourStyles.score,
  'single SKU source should outrank counted group references',
  countedGroupReport
);

const modelReturnedSingleProductMainCache = buildProjectVisualInsightCacheReadResult({
  source: 'provided-options',
  exists: true,
  entries: [
    {
      cacheKey: 'single-pair',
      assetId: 'single-pair',
      path: 'C:/fixture/6036/平铺/候选组/single-pair.jpg',
      insight: {
        assetId: 'single-pair',
        path: 'C:/fixture/6036/平铺/候选组/single-pair.jpg',
        summary: '一双米白色粉色波点短袜，木质背景上的商品图；主体：一双米白色粉色波点短袜；类别：product_main',
        productType: '一双米白色粉色波点短袜',
        scene: 'hero image',
        styleTags: ['product_main', 'direct_use']
      }
    },
    {
      cacheKey: 'single-product-main',
      assetId: 'single-product-main',
      path: 'C:/fixture/6036/平铺/候选组/single-product-main.jpg',
      insight: {
        assetId: 'single-product-main',
        path: 'C:/fixture/6036/平铺/候选组/single-product-main.jpg',
        summary: '米色波点短袜的场景化商品摆拍图；主体：米色波点短袜；类别：product_main',
        productType: '米色波点短袜',
        scene: 'hero image',
        styleTags: ['product_main']
      }
    },
    {
      cacheKey: 'generic-product-main',
      assetId: 'generic-product-main',
      path: 'C:/fixture/6036/平铺/generic-product-main.jpg',
      insight: {
        assetId: 'generic-product-main',
        path: 'C:/fixture/6036/平铺/generic-product-main.jpg',
        summary: '白色波点袜子的商品主图；主体：白色波点袜子；类别：product_main',
        productType: '白色波点袜子',
        scene: 'hero image',
        styleTags: ['product_main']
      }
    },
    {
      cacheKey: 'handheld-scene',
      assetId: 'handheld-scene',
      path: 'C:/fixture/6036/平铺/handheld-scene.jpg',
      insight: {
        assetId: 'handheld-scene',
        path: 'C:/fixture/6036/平铺/handheld-scene.jpg',
        summary: '手拿波点袜子的场景图；主体：波点中筒袜；类别：scene',
        productType: '波点中筒袜',
        scene: 'hero image',
        styleTags: ['scene', 'lifestyle']
      }
    },
    {
      cacheKey: 'four-product-main',
      assetId: 'four-product-main',
      path: 'C:/fixture/6036/平铺/候选组/four-product-main.jpg',
      insight: {
        assetId: 'four-product-main',
        path: 'C:/fixture/6036/平铺/候选组/four-product-main.jpg',
        summary: '四双不同颜色的波点袜子，主体清晰；类别：product_main',
        productType: '四双波点短袜',
        scene: 'hero image',
        styleTags: ['product_main']
      }
    }
  ]
});

const modelReturnedSingleProductMainReport = buildSkuCardAssetCandidateReport({
  assetIndex: {
    indexVersion: 'project-asset-index/v0',
    generatedFrom: 'file-metadata',
    summary: {
      totalFiles: 3,
      totalImages: 3,
      totalDesignDocuments: 0,
      roleCounts: { 'raw-product-still': 3 },
      folderRoleCounts: { source: 3 },
      extensionCounts: { '.jpg': 3 },
      colorNames: [],
      skuConfigCount: 0
    },
    assets: [
      asset('single-pair', '6036/平铺/候选组/single-pair.jpg', 'raw-product-still', 4284, 4284),
      asset('single-product-main', '6036/平铺/候选组/single-product-main.jpg', 'raw-product-still', 4284, 4284),
      asset('generic-product-main', '6036/平铺/generic-product-main.jpg', 'raw-product-still', 4284, 4284),
      asset('handheld-scene', '6036/平铺/handheld-scene.jpg', 'raw-product-still', 4284, 4284),
      asset('four-product-main', '6036/平铺/候选组/four-product-main.jpg', 'raw-product-still', 4284, 4284)
    ],
    representativeSamples: {},
    visionCandidates: [],
    skillReadiness: [],
    warnings: [],
    limitations: [],
    sourceRecords: []
  },
  visualInsightCache: modelReturnedSingleProductMainCache,
  maxCandidates: 5
});
const modelSinglePair = modelReturnedSingleProductMainReport.candidates.find((item) => item.assetId === 'single-pair');
const modelSingleProductMain = modelReturnedSingleProductMainReport.candidates.find((item) => item.assetId === 'single-product-main');
const modelGenericProductMain = modelReturnedSingleProductMainReport.candidates.find((item) => item.assetId === 'generic-product-main');
const modelHandheldScene = modelReturnedSingleProductMainReport.candidates.find((item) => item.assetId === 'handheld-scene');
const modelFourProductMain = modelReturnedSingleProductMainReport.candidates.find((item) => item.assetId === 'four-product-main');
assert(
  modelSinglePair?.recommendedUse === 'primary_sku_card'
    && modelSinglePair.needsVisualConfirmation === false,
  'visual model wording "one pair/product_main/direct_use" should confirm a single SKU source',
  modelReturnedSingleProductMainReport
);
assert(
  modelSingleProductMain?.recommendedUse === 'primary_sku_card'
    && modelSingleProductMain.needsVisualConfirmation === false,
  'visual model product_main wording can confirm a SKU source only when supported by a same-folder flat-lay sequence signal',
  modelReturnedSingleProductMainReport
);
assert(
  modelGenericProductMain?.needsVisualConfirmation === true,
  'generic product_main wording outside a same-folder SKU sequence should still require visual confirmation',
  modelReturnedSingleProductMainReport
);
assert(
  modelHandheldScene?.recommendedUse === 'reference_only',
  'handheld or scene-only images should not become SKU color-card sources',
  modelReturnedSingleProductMainReport
);
assert(
  modelFourProductMain?.recommendedUse === 'reference_only',
  'product_main wording must not override counted multi-item group detection',
  modelReturnedSingleProductMainReport
);

const nestedSequenceReport = buildSkuCardAssetCandidateReport({
  assetIndex: {
    indexVersion: 'project-asset-index/v0',
    generatedFrom: 'file-metadata',
    summary: {
      totalFiles: 9,
      totalImages: 9,
      totalDesignDocuments: 0,
      roleCounts: { 'raw-product-still': 9 },
      folderRoleCounts: { source: 9 },
      extensionCounts: { '.jpg': 9 },
      colorNames: [],
      skuConfigCount: 0
    },
    assets: [
      asset('root-1', '6036/平铺/2026-05-30 084545.jpg', 'raw-product-still', 4284, 4284),
      asset('root-2', '6036/平铺/2026-05-30 084723.jpg', 'raw-product-still', 4284, 4284),
      asset('root-3', '6036/平铺/2026-05-30 084827.jpg', 'raw-product-still', 4284, 4284),
      asset('root-4', '6036/平铺/2026-05-30 085009.jpg', 'raw-product-still', 4284, 4284),
      asset('root-5', '6036/平铺/2026-05-30 085103.jpg', 'raw-product-still', 4284, 4284),
      asset('nested-1', '6036/平铺/候选组/2026-05-30 084229.jpg', 'raw-product-still', 4284, 4284),
      asset('nested-2', '6036/平铺/候选组/2026-05-30 084249.jpg', 'raw-product-still', 4284, 4284),
      asset('nested-3', '6036/平铺/候选组/2026-05-30 084255.jpg', 'raw-product-still', 4284, 4284),
      asset('nested-4', '6036/平铺/候选组/2026-05-30 084300.jpg', 'raw-product-still', 4284, 4284)
    ],
    representativeSamples: {},
    visionCandidates: [],
    skillReadiness: [],
    warnings: [],
    limitations: [],
    sourceRecords: []
  },
  maxCandidates: 4
});

assert(
  nestedSequenceReport.candidates.length === 4
    && nestedSequenceReport.candidates.every((item) => item.assetId.startsWith('nested-')),
  'same-folder square flat-lay sequence should be prioritized for visual confirmation before generic root flat-lay overflow',
  nestedSequenceReport
);
assert(
  nestedSequenceReport.candidates.every((item) => item.needsVisualConfirmation === true),
  'same-folder sequence priority must not bypass visual confirmation',
  nestedSequenceReport
);
assert(
  nestedSequenceReport.candidates.every((item) => item.reasons.some((reason) => reason.includes('同一平铺子目录'))),
  'same-folder sequence priority should be visible in candidate reasons',
  nestedSequenceReport
);

console.log(JSON.stringify({
  ok: true,
  top: report.candidates[0],
  candidateCount: report.candidates.length,
  visualTop: visualReport.candidates[0],
  unknownRuntimeTop: unknownRuntimeReport.candidates[0],
  staleCoverage: staleCacheReport.visualInsightCoverage,
  countedGroupUses: countedGroupReport.candidates.map((item) => ({
    assetId: item.assetId,
    recommendedUse: item.recommendedUse
  })),
  modelReturnedSingleProductMainUses: modelReturnedSingleProductMainReport.candidates.map((item) => ({
    assetId: item.assetId,
    recommendedUse: item.recommendedUse,
    needsVisualConfirmation: item.needsVisualConfirmation,
    skuColorName: item.skuColorName
  })),
  nestedSequenceTop: nestedSequenceReport.candidates.map((item) => item.assetId)
}, null, 2));
