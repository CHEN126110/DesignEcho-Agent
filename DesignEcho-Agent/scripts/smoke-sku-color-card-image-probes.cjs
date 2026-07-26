#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '..', 'tsconfig.main.json')
});

const agentRoot = path.resolve(__dirname, '..');
const tmpDir = path.join(agentRoot, 'tmp', 'sku-color-card-image-probes');
fs.mkdirSync(tmpDir, { recursive: true });

const {
  buildSkuExportReadback
} = require(path.join(agentRoot, 'src', 'shared', 'sku-export-readback.ts'));
const {
  buildSkuColorCardRetouchStrategy
} = require(path.join(agentRoot, 'src', 'shared', 'sku-color-card-retouch-strategy.ts'));
const {
  buildSkuColorCardImageProbeReview
} = require(path.join(agentRoot, 'src', 'shared', 'sku-color-card-image-probes.ts'));
const {
  ResourceManagerService
} = require(path.join(agentRoot, 'src', 'main', 'services', 'resource-manager-service.ts'));

function assertNoPrivatePayload(value, label) {
  const serialized = JSON.stringify(value);
  const forbidden = [
    'confidence',
    '置信',
    'raw-image-payload',
    'base64-image-payload',
    'data:image/',
    tmpDir.replace(/\//g, '\\'),
    tmpDir.replace(/\\/g, '/')
  ];
  const found = forbidden.filter((token) => token && serialized.includes(token));
  assert(found.length === 0, `${label} leaked private payload markers: ${found.join(', ')}`);
}

async function createSockLikeFixture(filePath, fillColor, shadowOpacity = 0.26) {
  const svg = `
<svg width="800" height="800" viewBox="0 0 800 800" xmlns="http://www.w3.org/2000/svg">
  <rect width="800" height="800" fill="#ffffff"/>
  <ellipse cx="430" cy="625" rx="150" ry="34" fill="#777777" opacity="${shadowOpacity}"/>
  <path d="M325 130 h142 c18 0 28 10 28 28 v285 c0 43 28 68 78 86 l54 19 c48 17 72 45 67 85 -7 55 -60 86 -135 75 l-174 -26 c-83 -13 -128 -57 -119 -119 l37 -264 c6 -42 7 -84 7 -127 0 -26 8 -42 15 -42z" fill="${fillColor}"/>
  <path d="M330 160 h136" stroke="#000000" stroke-opacity="0.16" stroke-width="8"/>
  <path d="M342 210 h110 M342 248 h114 M342 286 h116 M348 324 h116 M356 362 h116 M372 400 h105 M392 438 h88 M432 525 h145 M390 585 h222" stroke="#000000" stroke-opacity="0.12" stroke-width="4"/>
</svg>`;
  await sharp(Buffer.from(svg)).png().toFile(filePath);
}

async function main() {
  const whitePath = path.join(tmpDir, '白色.jpg');
  const grayPath = path.join(tmpDir, '浅灰.jpg');
  const blackPath = path.join(tmpDir, '黑色.jpg');
  await createSockLikeFixture(whitePath, '#f4f4ee', 0.24);
  await createSockLikeFixture(grayPath, '#9a9a9a', 0.26);
  await createSockLikeFixture(blackPath, '#222222', 0.28);

  const service = new ResourceManagerService();
  const probes = [
    await service.probeImageFile(whitePath),
    await service.probeImageFile(grayPath),
    await service.probeImageFile(blackPath)
  ];
  assert(probes.every((probe) => probe.success), 'fixtures should be probeable');
  assert(probes.every((probe) => probe.visualMetrics?.rawImagesRedacted === true), 'resource probe should expose redacted visualMetrics');
  assert(probes.every((probe) => probe.visualMetrics?.nonWhiteBounds), 'visualMetrics should expose non-white bounds');
  assert(probes.every((probe) => typeof probe.visualMetrics?.textureContrastScore === 'number'), 'visualMetrics should expose texture contrast score');

  const exportReadback = buildSkuExportReadback({
    expectedExportPaths: [whitePath, grayPath, blackPath],
    fileProbes: probes,
    expectedDimensions: { width: 800, height: 800 }
  });
  assert.strictEqual(exportReadback.status, 'ready_for_review');
  assert(exportReadback.fileProbes.every((probe) => probe.visualMetrics?.rawImagesRedacted === true), 'readback should preserve redacted visual metrics');
  assertNoPrivatePayload(exportReadback, 'export readback with visual metrics');

  const retouchStrategy = buildSkuColorCardRetouchStrategy({
    userText: 'SKU 色卡需要形态统一、光影自然、正片叠底阴影和特殊罗口保真',
    colorCount: 3,
    comboSizes: [2, 3, 4],
    sourceHints: ['SKU.psb']
  });
  const review = buildSkuColorCardImageProbeReview({
    exportReadback,
    colorCardRetouchStrategy: retouchStrategy,
    generatedAt: '2026-05-29T02:40:00.000Z'
  });
  assert(review.status === 'ready_for_review' || review.status === 'ready_for_review_with_warnings', `unexpected review status ${review.status}`);
  assert.strictEqual(review.summary.metricProbeCount, 3);
  assert(review.probeRequirements.some((item) => item.includes('轮廓探针')), 'probe requirements should include contour review');
  assert(review.probeRequirements.some((item) => item.includes('阴影探针')), 'probe requirements should include shadow review');
  assert(review.reviewSignals.some((item) => item.includes('主体中心')), 'review signals should include alignment spread');
  assert.strictEqual(review.qualityClaim.allowed, false);
  assert.strictEqual(review.boundaries.doesNotRunPhotoshop, true);
  assert.strictEqual(review.boundaries.rawImagesRedacted, true);
  assertNoPrivatePayload(review, 'image probe review');

  const missingMetricsReview = buildSkuColorCardImageProbeReview({
    exportReadback: {
      ...exportReadback,
      fileProbes: exportReadback.fileProbes.map(({ visualMetrics, ...probe }) => probe)
    },
    colorCardRetouchStrategy: retouchStrategy
  });
  assert.strictEqual(missingMetricsReview.status, 'needs_visual_metrics');
  assert(missingMetricsReview.blockers.some((item) => item.includes('visualMetrics')), 'missing metrics should be explicit');
  assertNoPrivatePayload(missingMetricsReview, 'missing metrics review');

  const executorSource = fs.readFileSync(
    path.join(agentRoot, 'src', 'renderer', 'services', 'skill-executors', 'sku-batch.executor.ts'),
    'utf8'
  );
  const packageJson = JSON.parse(fs.readFileSync(path.join(agentRoot, 'package.json'), 'utf8'));
  assert(executorSource.includes('buildSkuColorCardImageProbeReview'), 'SKU executor should build image probe review');
  assert(executorSource.includes('skuColorCardImageProbeReview'), 'SKU executor result data should expose image probe review');
  assert(packageJson.scripts['smoke:sku:color-card-image-probes'], 'package.json should expose smoke:sku:color-card-image-probes');
  assert(packageJson.scripts['maintenance:preflight'].includes('smoke:sku:color-card-image-probes'), 'maintenance preflight should include SKU color-card image probes smoke');

  console.log(JSON.stringify({
    success: true,
    checks: [
      'resource probe extracts redacted visualMetrics without returning image payloads',
      'SKU export readback preserves redacted visual metrics for review contracts',
      'SKU color-card image probe review summarizes contour, edge, lighting, shadow and texture signals',
      'missing visual metrics block probe review instead of fabricating image analysis',
      'SKU executor exposes skuColorCardImageProbeReview and maintenance preflight runs the smoke'
    ]
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
