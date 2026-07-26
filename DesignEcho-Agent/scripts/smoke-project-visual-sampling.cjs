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
  buildProjectAssetIndex
} = require('../src/shared/project-asset-index.ts');
const {
  buildProjectVisualSamplingCacheKey,
  buildProjectVisualSamplingPlan
} = require('../src/shared/project-visual-sampling.ts');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertNoMojibake(value, label) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  const signals = [String.fromCharCode(0x9359), String.fromCharCode(0x7487), '\ufffd'];
  for (const signal of signals) {
    assert(!text.includes(signal), `${label} contains mojibake signal ${JSON.stringify(signal)}`);
  }
}

function fixtureFiles() {
  return [
    {
      path: 'C:/fixture/source/model-wear-01.jpg',
      relativePath: 'source/model-wear-01.jpg',
      width: 5464,
      height: 8192,
      sizeBytes: 12_000_000
    },
    {
      path: 'C:/fixture/source/detail-knit-01.jpg',
      relativePath: 'source/detail-knit-01.jpg',
      width: 3200,
      height: 2400,
      sizeBytes: 6_000_000
    },
    {
      path: 'C:/fixture/color/白色.jpg',
      relativePath: 'color/白色.jpg',
      width: 2000,
      height: 2000,
      sizeBytes: 2_000_000
    },
    {
      path: 'C:/fixture/main-image/output-800.jpg',
      relativePath: 'main-image/output-800.jpg',
      width: 800,
      height: 800,
      sizeBytes: 800_000
    },
    {
      path: 'C:/fixture/PSD/template.psd',
      relativePath: 'PSD/template.psd',
      sizeBytes: 30_000_000
    }
  ];
}

function buildIndex() {
  return buildProjectAssetIndex({
    projectPath: 'C:/fixture',
    projectName: 'visual-sampling-fixture',
    folderMappings: {
      source: 'source',
      color: 'source',
      'main-image': 'mainImage',
      PSD: 'psd'
    },
    files: fixtureFiles()
  });
}

function run() {
  const index = buildIndex();
  assert(index.visionCandidates.length >= 3, 'fixture should produce visual candidates');
  assert(!index.visionCandidates.some((item) => item.path.includes('output-800')), 'visual candidates should exclude outputs');

  const mainImagePlan = buildProjectVisualSamplingPlan({
    assetIndex: index,
    scenario: 'main-image',
    maxCandidates: 2,
    nowIso: '2026-05-14T00:00:00.000Z'
  });
  assert(mainImagePlan.planVersion === 'project-visual-sampling/v0', 'plan version should be stable');
  assert(mainImagePlan.mode === 'bounded-metadata-plan', 'plan must be bounded metadata only');
  assert(mainImagePlan.selectedCandidates.length === 2, 'maxCandidates should cap selected candidates');
  assert(mainImagePlan.cacheSummary.miss === 2, 'uncached candidates should be cache misses');
  assert(mainImagePlan.cacheSummary.shouldAnalyze === 2, 'cache miss should require visual analysis');
  assert(mainImagePlan.limitations.some((item) => item.includes('不读取图片像素')), 'plan must declare no pixel reads');
  assert(mainImagePlan.limitations.some((item) => item.includes('不得编造')), 'plan must prohibit fabricated visual conclusions');
  assert(mainImagePlan.sourceRecords.length > 0, 'plan should retain source records');
  assert(
    mainImagePlan.selectedCandidates.every((item) => item.requiredObservations.length > 0 && item.selectionNotes.length > 0),
    'selected candidates should expose required observations and selection notes'
  );
  assert(!JSON.stringify(mainImagePlan).includes('"evidence"'), 'visual sampling output must not expose a generic evidence field');

  const firstAsset = index.assets.find((asset) => asset.id === mainImagePlan.selectedCandidates[0].assetId);
  assert(firstAsset, 'selected candidate should map to an indexed asset');

  const cacheKey = buildProjectVisualSamplingCacheKey(firstAsset);
  const cachedPlan = buildProjectVisualSamplingPlan({
    assetIndex: index,
    scenario: 'main-image',
    maxCandidates: 1,
    nowIso: '2026-05-14T00:00:00.000Z',
    cachedInsights: [{
      cacheKey,
      assetId: firstAsset.id,
      path: firstAsset.path,
      updatedAt: '2026-05-13T00:00:00.000Z',
      expiresAt: '2026-05-15T00:00:00.000Z',
      insight: {
        assetId: firstAsset.id,
        path: firstAsset.path,
        summary: '仅用于测试的真实缓存摘要，不代表设计质量通过。',
        capturedAt: '2026-05-13T00:00:00.000Z'
      }
    }]
  });
  assert(cachedPlan.cacheSummary.hit === 1, 'valid cached insight should be a hit');
  assert(cachedPlan.cacheSummary.shouldAnalyze === 0, 'cache hit should not require analysis in this plan');

  const volatileAssetIdPlan = buildProjectVisualSamplingPlan({
    assetIndex: index,
    scenario: 'main-image',
    maxCandidates: 1,
    nowIso: '2026-05-14T00:00:00.000Z',
    cachedInsights: [{
      cacheKey: 'project-visual:old-scan-order',
      assetId: firstAsset.id,
      path: 'C:/fixture/source/moved-or-different-file.jpg',
      updatedAt: '2026-05-13T00:00:00.000Z',
      expiresAt: '2026-05-15T00:00:00.000Z',
      insight: {
        assetId: firstAsset.id,
        path: 'C:/fixture/source/moved-or-different-file.jpg',
        summary: 'assetId 相同但路径不同的旧缓存，不能命中当前候选。'
      }
    }]
  });
  assert(volatileAssetIdPlan.cacheSummary.miss === 1, 'volatile assetId alone must not produce a cache hit');
  assert(volatileAssetIdPlan.cacheSummary.shouldAnalyze === 1, 'volatile assetId cache mismatch should require analysis');

  const stalePlan = buildProjectVisualSamplingPlan({
    assetIndex: index,
    scenario: 'main-image',
    maxCandidates: 1,
    nowIso: '2026-05-14T00:00:00.000Z',
    cachedInsights: [{
      cacheKey,
      assetId: firstAsset.id,
      path: firstAsset.path,
      updatedAt: '2026-05-10T00:00:00.000Z',
      expiresAt: '2026-05-11T00:00:00.000Z',
      insight: {
        assetId: firstAsset.id,
        path: firstAsset.path,
        summary: '过期缓存'
      }
    }]
  });
  assert(stalePlan.cacheSummary.stale === 1, 'expired cached insight should be stale');
  assert(stalePlan.cacheSummary.shouldAnalyze === 1, 'stale cache should require re-analysis');
  assertNoMojibake({ mainImagePlan, cachedPlan, stalePlan, volatileAssetIdPlan }, 'project visual sampling plans');

  console.log(JSON.stringify({
    ok: true,
    selected: mainImagePlan.selectedCandidates.length,
    cacheSummary: mainImagePlan.cacheSummary,
    cachedSummary: cachedPlan.cacheSummary,
    volatileAssetIdSummary: volatileAssetIdPlan.cacheSummary,
    staleSummary: stalePlan.cacheSummary
  }, null, 2));
}

run();
