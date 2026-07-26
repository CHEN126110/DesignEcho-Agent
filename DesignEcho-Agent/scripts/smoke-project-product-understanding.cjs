#!/usr/bin/env node

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

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

const root = path.resolve(__dirname, '..');
const {
  buildProjectProductUnderstanding
} = require(path.join(root, 'src', 'shared', 'project-product-understanding.ts'));
const {
  buildProjectDesignUnderstandingSummary
} = require(path.join(root, 'src', 'shared', 'project-design-understanding-summary.ts'));
const {
  buildProjectVisualInsightCacheReadResult
} = require(path.join(root, 'src', 'shared', 'project-visual-insight-cache.ts'));

function asset(id, relativePath, role) {
  return {
    id,
    path: `E:/fixture/${relativePath}`,
    relativePath,
    name: relativePath.split('/').pop(),
    extension: '.jpg',
    sizeBytes: 10_000,
    width: 2000,
    height: 2000,
    aspectRatio: 1,
    folderRole: 'source',
    role,
    comboColors: [],
    isImage: true,
    isDesignDocument: false,
    isOutput: false,
    needsVision: true,
    confidence: 0.8,
    reasons: ['fixture'],
    classificationNotes: []
  };
}

const assetIndex = {
  indexVersion: 'project-asset-index/v0',
  projectName: '任何品类名称都不能成为推断依据',
  projectPath: 'E:/fixture/project',
  generatedFrom: 'file-metadata',
  summary: {
    totalFiles: 5,
    totalImages: 5,
    totalDesignDocuments: 0,
    roleCounts: {},
    folderRoleCounts: {},
    extensionCounts: { '.jpg': 5 },
    colorNames: [],
    skuConfigCount: 0
  },
  assets: [
    asset('color-a', 'sources/a.jpg', 'color-single'),
    asset('still', 'sources/still.jpg', 'raw-product-still'),
    asset('detail', 'sources/detail.jpg', 'raw-detail-closeup'),
    asset('wear', 'sources/wear.jpg', 'raw-model-wear'),
    asset('unknown', 'sources/unknown.jpg', 'unknown')
  ],
  representativeSamples: {},
  visionCandidates: [],
  skillReadiness: [],
  warnings: [],
  limitations: [],
  sourceRecords: []
};

const visualInsightCache = buildProjectVisualInsightCacheReadResult({
  source: 'provided-options',
  exists: true,
  entries: [
    {
      cacheKey: 'color-a',
      path: 'E:/fixture/sources/a.jpg',
      insight: {
        assetId: 'color-a',
        path: 'E:/fixture/sources/a.jpg',
        summary: '单个商品平铺，主体完整。',
        productType: '短筒商品',
        scene: '平铺单品',
        material: '织物观察',
        styleTags: ['清晰', '浅色'],
        sellingPointObservations: ['主体轮廓完整可见']
      }
    },
    {
      cacheKey: 'detail',
      path: 'E:/fixture/sources/detail.jpg',
      insight: {
        assetId: 'detail',
        path: 'E:/fixture/sources/detail.jpg',
        summary: '局部纹理特写。',
        productType: '短筒商品',
        scene: '局部特写',
        material: '织物观察',
        styleTags: ['细节'],
        sellingPointObservations: ['纹理结构可见']
      }
    }
  ]
});

const understanding = buildProjectProductUnderstanding({ assetIndex, visualInsightCache });
assert.strictEqual(understanding.version, 'project-product-understanding/v1');
assert.strictEqual(understanding.layer, 'observed_context');
assert(!Object.prototype.hasOwnProperty.call(understanding, 'sourceRecords'));
assert(!JSON.stringify(understanding).includes('"evidence"'));
assert.deepStrictEqual(understanding.observations.productTypes, ['短筒商品']);
assert.deepStrictEqual(understanding.observations.materials, ['织物观察']);
assert.deepStrictEqual(understanding.observations.scenes, ['平铺单品', '局部特写']);
assert.deepStrictEqual(understanding.observations.styleTags, ['清晰', '浅色', '细节']);
assert.deepStrictEqual(understanding.observations.sellingPointObservations, ['主体轮廓完整可见', '纹理结构可见']);
assert.deepStrictEqual(understanding.assetGroups.skuSourceCandidates.map((item) => item.assetId), ['color-a']);
assert.deepStrictEqual(understanding.assetGroups.productStillCandidates.map((item) => item.assetId), ['still']);
assert.deepStrictEqual(understanding.assetGroups.detailCandidates.map((item) => item.assetId), ['detail']);
assert.deepStrictEqual(understanding.assetGroups.modelWearCandidates.map((item) => item.assetId), ['wear']);
assert.deepStrictEqual(understanding.assetGroups.unclassifiedCandidates.map((item) => item.assetId), ['unknown']);
assert.strictEqual(understanding.coverage.imageAssetCount, 5);
assert.strictEqual(understanding.coverage.visualInsightCount, 2);
assert.strictEqual(understanding.coverage.linkedVisualInsightCount, 2);

const serialized = JSON.stringify(understanding);
for (const forbiddenKey of ['category', 'buyerQuestions', 'designDirections', 'claims', 'deliveryHints']) {
  assert(!serialized.includes(`"${forbiddenKey}"`), `understanding must not author ${forbiddenKey}`);
}

const withoutVision = buildProjectProductUnderstanding({
  assetIndex,
  visualInsightCache: buildProjectVisualInsightCacheReadResult({ source: 'missing', exists: false })
});
assert.deepStrictEqual(withoutVision.observations.productTypes, []);
assert.deepStrictEqual(withoutVision.observations.sellingPointObservations, []);
assert(withoutVision.warnings.some((item) => item.includes('不根据任务文本或文件名补造')));

const summary = buildProjectDesignUnderstandingSummary({
  projectContext: { assetIndex, visualInsightCache }
});
assert.strictEqual(summary.version, 'project-design-understanding-summary/v0');
assert.strictEqual(summary.understanding.version, 'project-product-understanding/v1');
assert(summary.lines.some((item) => item.includes('observedMaterials') && item.includes('织物观察')));
assert(summary.lines.some((item) => item.includes('observedSellingPoints') && item.includes('主体轮廓完整可见')));
assert(!summary.lines.some((item) => /buyerQuestions|designDirections|groundedSellingAngles/.test(item)));

const source = fs.readFileSync(
  path.join(root, 'src', 'shared', 'project-product-understanding.ts'),
  'utf8'
);
assert(!/userRequirementText|taskText|userInput/.test(source));
assert(!/inferCategory|buyerQuestions|designDirections|parseSkuComboSizes/.test(source));
assert(!/袜子|服装|socks|apparel/i.test(source));
assert(!source.includes('executeTool('));

console.log(JSON.stringify({
  success: true,
  observations: understanding.observations,
  assetGroupCounts: Object.fromEntries(
    Object.entries(understanding.assetGroups).map(([key, items]) => [key, items.length])
  ),
  boundary: 'structured observation only; no task-text category inference, R1/R3/R4 authorship, Tool execution, permission or quality authority'
}, null, 2));
