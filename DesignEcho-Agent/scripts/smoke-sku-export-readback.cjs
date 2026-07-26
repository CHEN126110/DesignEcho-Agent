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
const tmpDir = path.join(agentRoot, 'tmp', 'sku-export-readback');
fs.mkdirSync(tmpDir, { recursive: true });

const {
  buildSkuExportReadback,
  sanitizeSkuToolResultsForPublicResult
} = require(path.join(agentRoot, 'src', 'shared', 'sku-export-readback.ts'));
const {
  ResourceManagerService
} = require(path.join(agentRoot, 'src', 'main', 'services', 'resource-manager-service.ts'));

function assertNoRawPayload(value, label) {
  const serialized = JSON.stringify(value);
  const forbidden = [
    'raw-image-payload',
    'base64-image-payload',
    'data:image/',
    tmpDir.replace(/\//g, '\\'),
    tmpDir.replace(/\\/g, '/')
  ];
  const found = forbidden.filter((token) => token && serialized.includes(token));
  assert(found.length === 0, `${label} leaked raw payload or absolute path markers: ${found.join(', ')}`);
}

async function createSkuLikeFixture(filePath, width, height, fillColor = '#b8b8b8', options = {}) {
  const scaleX = width / 800;
  const scaleY = height / 800;
  const backgroundColor = options.backgroundColor || '#ffffff';
  const translateX = typeof options.translateX === 'number' ? options.translateX : width * 0.33;
  const translateY = typeof options.translateY === 'number' ? options.translateY : height * 0.16;
  const sock = `
    <g transform="translate(${translateX} ${translateY}) scale(${scaleX} ${scaleY})">
      <ellipse cx="175" cy="478" rx="120" ry="28" fill="#777777" opacity="0.22"/>
      <path d="M92 0 h132 c18 0 28 10 28 28 v275 c0 42 26 66 75 84 l45 17 c42 16 64 40 60 76 -6 50 -54 78 -122 68 l-158 -24 c-76 -12 -116 -52 -108 -109 l34 -244 c6 -39 7 -79 7 -119 0 -32 7 -52 7 -52z" fill="${fillColor}"/>
      <path d="M102 34 h126 M112 82 h100 M112 120 h104 M118 158 h106 M128 196 h104 M150 234 h80 M190 335 h134 M154 396 h184" stroke="#000000" stroke-opacity="0.14" stroke-width="4"/>
    </g>`;
  const svg = `
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${width}" height="${height}" fill="${backgroundColor}"/>
  ${sock}
</svg>`;
  await sharp(Buffer.from(svg)).jpeg({ quality: 92 }).toFile(filePath);
}

function maxEdgeOccupancy(metrics) {
  const edge = metrics?.edgeOccupancy || {};
  return Math.max(edge.top || 0, edge.right || 0, edge.bottom || 0, edge.left || 0);
}

async function main() {
  const okPath = path.join(tmpDir, '2双-组合01.jpg');
  const notePath = path.join(tmpDir, '2双自选备注.jpg');
  const grayBackgroundPath = path.join(tmpDir, '浅灰背景居中主体.jpg');
  const grayBackgroundClippedPath = path.join(tmpDir, '浅灰背景贴边主体.jpg');
  const missingPath = path.join(tmpDir, '2双-缺失.jpg');
  await createSkuLikeFixture(okPath, 800, 800, '#b8b8b8');
  await createSkuLikeFixture(notePath, 1200, 800, '#d4d4d4');
  await createSkuLikeFixture(grayBackgroundPath, 1000, 1000, '#8a8a8a', {
    backgroundColor: '#eeeeee',
    translateX: 330,
    translateY: 160
  });
  await createSkuLikeFixture(grayBackgroundClippedPath, 1000, 1000, '#8a8a8a', {
    backgroundColor: '#eeeeee',
    translateX: -90,
    translateY: 160
  });

  const service = new ResourceManagerService();
  const okProbe = await service.probeImageFile(okPath);
  const noteProbe = await service.probeImageFile(notePath);
  const grayBackgroundProbe = await service.probeImageFile(grayBackgroundPath);
  const grayBackgroundClippedProbe = await service.probeImageFile(grayBackgroundClippedPath);
  const missingProbe = await service.probeImageFile(missingPath);

  const missingReadback = buildSkuExportReadback({
    expectedExportPaths: [okPath],
    fileProbes: []
  });
  assert(missingReadback.status === 'needs_file_probe', `expected needs_file_probe, got ${missingReadback.status}`);
  assert(missingReadback.blockers.some((item) => item.includes('缺少')), 'missing probe result should explain the blocker');

  const readyReadback = buildSkuExportReadback({
    expectedExportPaths: [okPath],
    fileProbes: [okProbe],
    expectedDimensions: { width: 800, height: 800 }
  });
  assert(readyReadback.status === 'ready_for_review', `expected ready_for_review, got ${readyReadback.status}`);
  assert(readyReadback.okFileProbeCount === 1, 'ok probe should be counted');
  assert(readyReadback.resultFileNames.includes('2双-组合01.jpg'), 'readback should expose only basenames');
  assert(readyReadback.boundaries.doesNotClaimDesignQuality === true, 'readback must not claim design quality');
  assert(readyReadback.boundaries.rawImagesRedacted === true, 'readback must keep raw image payload redacted');
  assertNoRawPayload(readyReadback, 'ready readback');

  const grayBackgroundReadyReadback = buildSkuExportReadback({
    expectedExports: [
      { path: grayBackgroundPath, expectedDimensions: { width: 1000, height: 1000 } }
    ],
    fileProbes: [grayBackgroundProbe]
  });
  assert(
    grayBackgroundReadyReadback.status === 'ready_for_review',
    `light-gray canvas background should not be treated as edge-clipped subject; got ${grayBackgroundReadyReadback.status}: ${grayBackgroundReadyReadback.blockers.join(' | ')}`
  );
  assert(
    maxEdgeOccupancy(grayBackgroundProbe.visualMetrics) <= 0.55,
    `light-gray centered subject should not occupy canvas edges: ${JSON.stringify(grayBackgroundProbe.visualMetrics?.edgeOccupancy)}`
  );

  const grayBackgroundClippedReadback = buildSkuExportReadback({
    expectedExports: [
      { path: grayBackgroundClippedPath, expectedDimensions: { width: 1000, height: 1000 } }
    ],
    fileProbes: [grayBackgroundClippedProbe]
  });
  assert(grayBackgroundClippedReadback.status === 'blocked', `expected light-gray edge-clipped subject blocked, got ${grayBackgroundClippedReadback.status}`);
  assert(grayBackgroundClippedReadback.blockers.some((item) => item.includes('边缘') || item.includes('裁切')), 'light-gray edge-clipped subject should explain visual-metric blocker');

  const perFileReadyReadback = buildSkuExportReadback({
    expectedExports: [
      { path: okPath, expectedDimensions: { width: 800, height: 800 } },
      { path: notePath, expectedDimensions: { width: 1200, height: 800 } }
    ],
    fileProbes: [okProbe, noteProbe]
  });
  assert(perFileReadyReadback.status === 'ready_for_review', `expected per-file ready_for_review, got ${perFileReadyReadback.status}`);
  assert(perFileReadyReadback.dimensionMismatchCount === 0, 'per-file matching dimensions should not be counted as mismatches');
  assertNoRawPayload(perFileReadyReadback, 'per-file ready readback');

  const blankLikeReadback = buildSkuExportReadback({
    expectedExports: [
      { path: okPath, expectedDimensions: { width: 800, height: 800 } }
    ],
    fileProbes: [{
      ...okProbe,
      visualMetrics: {
        sampleSize: { width: 256, height: 256 },
        nonWhitePixelRatio: 0.001,
        edgeOccupancy: { top: 0, right: 0, bottom: 0, left: 0 },
        darkPixelRatio: 0,
        highlightPixelRatio: 0,
        shadowLikePixelRatio: 0,
        rawImagesRedacted: true
      }
    }]
  });
  assert(blankLikeReadback.status === 'blocked', `expected near-blank final image blocked, got ${blankLikeReadback.status}`);
  assert(blankLikeReadback.blockers.some((item) => item.includes('几乎为空') || item.includes('主体像素')), 'near-blank final image should explain visual-metric blocker');

  const clippedLikeReadback = buildSkuExportReadback({
    expectedExports: [
      { path: notePath, expectedDimensions: { width: 1200, height: 800 } }
    ],
    fileProbes: [{
      ...noteProbe,
      visualMetrics: {
        sampleSize: { width: 256, height: 171 },
        nonWhitePixelRatio: 0.42,
        nonWhiteBounds: {
          x: 0,
          y: 0.02,
          width: 255,
          height: 166,
          centerX: 0.5,
          centerY: 0.505,
          widthRatio: 0.996,
          heightRatio: 0.971
        },
        edgeOccupancy: { top: 0.12, right: 0.73, bottom: 0.08, left: 0.68 },
        averageLuma: 180,
        lumaStdDev: 24,
        darkPixelRatio: 0.05,
        highlightPixelRatio: 0.08,
        shadowLikePixelRatio: 0.24,
        textureContrastScore: 8,
        rawImagesRedacted: true
      }
    }]
  });
  assert(clippedLikeReadback.status === 'blocked', `expected edge-clipped final image blocked, got ${clippedLikeReadback.status}`);
  assert(clippedLikeReadback.blockers.some((item) => item.includes('边缘') || item.includes('裁切')), 'edge-clipped final image should explain visual-metric blocker');

  const perFileMismatchReadback = buildSkuExportReadback({
    expectedExports: [
      { path: okPath, expectedDimensions: { width: 750, height: 750 } },
      { path: notePath, expectedDimensions: { width: 1200, height: 800 } }
    ],
    fileProbes: [okProbe, noteProbe]
  });
  assert(perFileMismatchReadback.status === 'blocked', `expected per-file mismatch blocked, got ${perFileMismatchReadback.status}`);
  assert(perFileMismatchReadback.dimensionMismatchCount === 1, 'per-file dimension mismatch should be counted');
  assert(perFileMismatchReadback.blockers.some((item) => item.includes('尺寸不符合预期')), 'per-file mismatch should explain dimensions blocker');
  assertNoRawPayload(perFileMismatchReadback, 'per-file mismatch readback');

  const publicToolResults = sanitizeSkuToolResultsForPublicResult([
    {
      toolName: 'skuLayout-2双',
      result: {
        success: true,
        data: {
          exportedFiles: [
            JSON.stringify({
              status: 'exported_to_temp',
              tempPath: path.join(tmpDir, 'private-temp.jpg'),
              targetDir: tmpDir,
              path: okPath,
              targetName: '2双-组合01.jpg'
            })
          ]
        }
      }
    }
  ]);
  assertNoRawPayload(publicToolResults, 'public tool results');
  assert(!JSON.stringify(publicToolResults).includes('private-temp.jpg') || JSON.stringify(publicToolResults).includes('[local-path-redacted]/private-temp.jpg'), 'public tool results should redact temp paths');

  const blockedReadback = buildSkuExportReadback({
    expectedExportPaths: [okPath, missingPath],
    fileProbes: [okProbe, missingProbe],
    expectedDimensions: { width: 800, height: 800 }
  });
  assert(blockedReadback.status === 'blocked', `expected blocked, got ${blockedReadback.status}`);
  assert(blockedReadback.failedFileProbeCount === 1, 'failed probe should be counted');
  assert(blockedReadback.blockers.some((item) => item.includes('导出文件探针失败')), 'blocked readback should explain failed probe');
  assertNoRawPayload(blockedReadback, 'blocked readback');

  const executorSource = fs.readFileSync(
    path.join(agentRoot, 'src', 'renderer', 'services', 'skill-executors', 'sku-batch.executor.ts'),
    'utf8'
  );
  const packageJson = JSON.parse(fs.readFileSync(path.join(agentRoot, 'package.json'), 'utf8'));
  assert(executorSource.includes('buildSkuExportReadback'), 'SKU executor should build a readback result after exports');
  assert(executorSource.includes('skuExportReadback'), 'SKU result data should expose skuExportReadback');
  assert(executorSource.includes('buildSkuDeliverySummary'), 'SKU executor should build a compact delivery summary for UI output');
  assert(executorSource.includes('skuDeliverySummary'), 'SKU result data should expose skuDeliverySummary for structured rendering');
  assert(executorSource.includes('probeImageFile'), 'SKU executor should use the renderer image probe when available');
  assert(executorSource.includes('expectedExports'), 'SKU executor should pass per-export expected dimensions into the readback check');
  assert(executorSource.includes('sanitizeSkuToolResultsForPublicResult'), 'SKU executor should sanitize public tool results before returning them');
  assert(!executorSource.includes('toolResults: allToolResults,'), 'SKU executor should not return raw allToolResults to UI/result data');
  assert(
    !executorSource.includes("exportFileNames.join('、')"),
    'SKU executor must not flatten every export file name into the main assistant message'
  );
  assert(packageJson.scripts['smoke:sku:export-readback'], 'package.json should expose smoke:sku:export-readback');
  assert(packageJson.scripts['maintenance:preflight'].includes('smoke:sku:export-readback'), 'maintenance preflight should include SKU export readback smoke');

  console.log(JSON.stringify({
    success: true,
    checks: [
      'SKU export readback blocks missing file probes',
      'SKU export readback confirms exported images exist, decode and match expected dimensions',
      'SKU export readback supports per-file expected dimensions for combo and note exports',
      'SKU export readback blocks final images that are near blank or visibly edge-clipped',
      'SKU export readback treats light-gray canvas backgrounds as background, not full-canvas subject',
      'SKU export readback sanitizes SKU layout tool results before UI/result exposure',
      'SKU export readback exposes only basenames and redacted probe metadata',
      'SKU executor exposes skuExportReadback result data and uses probeImageFile when available',
      'SKU export readback smoke is wired into package scripts and maintenance preflight'
    ]
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
