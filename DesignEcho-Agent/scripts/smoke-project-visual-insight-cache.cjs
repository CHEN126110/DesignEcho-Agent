#!/usr/bin/env node

const fs = require('fs');
const os = require('os');
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

const {
  projectContextSnapshotService
} = require('../src/main/services/project-context-snapshot-service.ts');

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

function assertNoRawPayload(value, label) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  for (const forbidden of ['SHOULD_BE_REMOVED', 'base64', 'imageBase64', 'rawImageBase64', 'dataUrl']) {
    assert(!text.includes(forbidden), `${label} should not contain raw image payload key/value ${forbidden}`);
  }
}

function assertNoRawPayloadValue(value, label) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  assert(!text.includes('SHOULD_BE_REMOVED'), `${label} should not contain raw image payload values`);
}

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

function buildFixture(root) {
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(root, { recursive: true });

  writeFile(path.join(root, '.designecho', 'project.json'), JSON.stringify({
    version: '1.0',
    createdAt: '2026-05-15T00:00:00.000Z',
    lastOpenedAt: '2026-05-15T00:00:00.000Z',
    projectPath: root,
    projectName: 'visual-insight-cache-smoke',
    folderMappings: {
      '原图': 'source',
      '主图': 'mainImage',
      'SKU': 'sku',
      '模板文件': 'psd'
    },
    imageClassifications: {}
  }, null, 2));

  writeFile(path.join(root, '原图', '模特穿着', 'model-wear-01.jpg'), 'not-a-real-jpg');
  writeFile(path.join(root, '原图', '细节', 'knit-detail-01.jpg'), 'not-a-real-jpg');
  writeFile(path.join(root, 'SKU', '白色.jpg'), 'not-a-real-jpg');
  writeFile(path.join(root, '主图', '800', 'main-image-output.jpg'), 'not-a-real-jpg');
  writeFile(path.join(root, '模板文件', 'SKU.psb'), 'not-a-real-psb');
}

async function main() {
  const fixtureRoot = path.join(os.tmpdir(), 'designecho-smoke-project-visual-insight-cache');
  buildFixture(fixtureRoot);

  const uncached = await projectContextSnapshotService.build({
    projectPath: fixtureRoot,
    visualSamplingScenario: 'main-image',
    maxVisualSamples: 2
  });
  assert(uncached.visualInsightCache.source === 'missing', 'cache should start as missing');
  assert(uncached.visualInsightCache.summary.totalEntries === 0, 'missing cache should have no entries');
  assert(uncached.visualSamplingPlan.cacheSummary.miss > 0, 'uncached visual plan should require analysis');
  assert(
    uncached.contextSnapshot.unverifiedItems.some((item) => item.includes('视觉模型') || item.includes('VisualInsightCache')),
    'missing cache should remain visible as unverified context'
  );

  const candidate = uncached.visualSamplingPlan.selectedCandidates[0];
  assert(candidate, 'fixture should produce at least one visual candidate');

  const written = await projectContextSnapshotService.writeVisualInsightCache({
    projectPath: fixtureRoot,
    replace: true,
    nowIso: '2026-05-15T00:00:00.000Z',
    entries: [{
      cacheKey: candidate.cacheKey,
      assetId: candidate.assetId,
      path: candidate.path,
      updatedAt: '2026-05-15T00:00:00.000Z',
      insight: {
        assetId: candidate.assetId,
        path: candidate.path,
        summary: '人工确认或视觉模型确认：白色袜子上脚图，可用于主图候选。',
        productType: '袜子',
        scene: '上脚展示',
        material: '针织',
        styleTags: ['白色', '上脚', '基础款'],
        capturedAt: '2026-05-15T00:00:00.000Z',
        modelId: 'smoke-visual-model',
        base64: 'SHOULD_BE_REMOVED',
        rawImageBase64: 'SHOULD_BE_REMOVED'
      }
    }]
  });
  assert(written.success === true, 'cache write should succeed');
  assert(written.readResult.source === 'persisted-project-cache', 'written cache should be persisted');
  assert(written.readResult.summary.entriesWithInsight === 1, 'written cache should include one reusable insight');
  assert(!Object.prototype.hasOwnProperty.call(written.manifest, 'sourceRecords'), 'cache manifest should not fabricate module self-records');
  assert(!JSON.stringify(written.manifest).includes('"evidence"'), 'cache manifest must not expose a generic evidence field');
  assert(written.manifest.warnings.some((item) => item.includes('raw image')), 'cache write should warn when raw payload is removed');
  assertNoRawPayload(written.manifest.entries, 'written visual insight cache entries');
  assertNoRawPayloadValue(written.manifest, 'written visual insight cache manifest');

  await Promise.all(['concurrent-a', 'concurrent-b'].map((cacheKey, index) => (
    projectContextSnapshotService.writeVisualInsightCache({
      projectPath: fixtureRoot,
      entries: [{
        cacheKey,
        assetId: cacheKey,
        path: path.join(fixtureRoot, `${cacheKey}.jpg`),
        updatedAt: `2026-05-15T00:00:0${index + 1}.000Z`,
        insight: {
          assetId: cacheKey,
          path: path.join(fixtureRoot, `${cacheKey}.jpg`),
          summary: `并发画面观察 ${cacheKey}`,
          scene: '商品素材画面',
          capturedAt: `2026-05-15T00:00:0${index + 1}.000Z`
        }
      }]
    })
  )));
  const concurrentCache = await projectContextSnapshotService.readPersistedVisualInsightCache(fixtureRoot);
  assert(
    concurrentCache.entries.some((entry) => entry.cacheKey === 'concurrent-a')
      && concurrentCache.entries.some((entry) => entry.cacheKey === 'concurrent-b'),
    'concurrent visual-insight cache writes must retain both observation entries'
  );

  const cached = await projectContextSnapshotService.build({
    projectPath: fixtureRoot,
    visualSamplingScenario: 'main-image',
    maxVisualSamples: 2
  });
  assert(cached.visualInsightCache.source === 'persisted-project-cache', 'runtime build should read persisted cache');
  assert(cached.visualInsightCache.summary.entriesWithInsight >= 3, 'runtime build should carry original and concurrent persisted insights');
  assert(cached.visualSamplingPlan.cacheSummary.hit >= 1, 'cached visual plan should reuse valid insight');
  assert(
    cached.contextSnapshot.visualInsightCache?.summary.entriesWithInsight === cached.visualInsightCache.summary.entriesWithInsight,
    'ContextSnapshot should carry the complete cache summary'
  );
  assert(
    cached.contextSnapshot.sourceRecords.some((item) => /[\\/]/.test(item.source)),
    'ContextSnapshot should expose actual project or cache paths'
  );
  assert(
    cached.contextSnapshot.sourceRecords.every((item) => item.source !== 'project-visual-insight-cache'),
    'ContextSnapshot should not expose module self-records'
  );

  const disabled = await projectContextSnapshotService.build({
    projectPath: fixtureRoot,
    visualSamplingScenario: 'main-image',
    maxVisualSamples: 2,
    usePersistedVisualInsightCache: false
  });
  assert(disabled.visualInsightCache.source === 'missing', 'explicitly disabled persisted cache should be missing');
  assert(disabled.visualSamplingPlan.cacheSummary.hit === 0, 'disabled cache should not produce cache hits');
  assert(disabled.visualSamplingPlan.cacheSummary.miss > 0, 'disabled cache should require analysis again');

  assertNoMojibake({ uncached, written, concurrentCache, cached, disabled }, 'visual insight cache smoke result');
  assertNoRawPayloadValue({ uncached, written, concurrentCache, cached, disabled }, 'visual insight cache smoke result');

  fs.rmSync(fixtureRoot, { recursive: true, force: true });

  console.log(JSON.stringify({
    ok: true,
    cacheSourceBefore: uncached.visualInsightCache.source,
    cacheSourceAfter: cached.visualInsightCache.source,
    cacheSourceDisabled: disabled.visualInsightCache.source,
    selectedCandidates: uncached.visualSamplingPlan.selectedCandidates.length,
    cachedHits: cached.visualSamplingPlan.cacheSummary.hit,
    rawPayloadRemoved: written.readResult.summary.entriesWithRawPayloadRemoved
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
