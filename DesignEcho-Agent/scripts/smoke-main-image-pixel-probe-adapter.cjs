#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '..', 'tsconfig.main.json')
});

const repoRoot = path.resolve(__dirname, '..');
const tmpDir = path.join(repoRoot, 'tmp', 'main-image-pixel-probe-adapter');
fs.mkdirSync(tmpDir, { recursive: true });

const {
  buildMainImageScreenshotQa
} = require(path.join(repoRoot, 'src', 'shared', 'main-image-screenshot-qa.ts'));
const {
  buildMainImageScreenshotProbeReadiness
} = require(path.join(repoRoot, 'src', 'shared', 'main-image-screenshot-probe-readiness.ts'));
const {
  ResourceManagerService
} = require(path.join(repoRoot, 'src', 'main', 'services', 'resource-manager-service.ts'));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertIncludes(value, needle, message) {
  assert(String(value || '').includes(needle), message || `Expected value to include ${needle}`);
}

function assertNoImagePayload(value, label) {
  const text = JSON.stringify(value);
  for (const forbidden of ['base64', 'imageData', 'data:image/', '"buffer"']) {
    assert(!text.includes(forbidden), `${label} leaked ${forbidden}`);
  }
}

function assertNoMojibake(text, label) {
  const signals = [
    '\u9359',
    '\u93c8',
    '\u951b',
    '\u95c8',
    '\u7f01',
    '\u20ac',
    '\ufffd',
    '\u9428',
    '\u6d93',
    '\u95c2',
    '\u7efe',
    '\u9225',
    '\u4fd9'
  ];
  for (const signal of signals) {
    assert(!String(text).includes(signal), `${label} contains mojibake signal ${JSON.stringify(signal)}`);
  }
}

const service = new ResourceManagerService();
const referencePath = path.join(tmpDir, 'reference.png');
const sameResultPath = path.join(tmpDir, 'same-result.png');
const differentResultPath = path.join(tmpDir, 'different-result.png');
const missingPath = path.join(tmpDir, 'missing-result.png');

const sizePlan = {
  sizeKey: '128',
  targetSize: { width: 128, height: 128 },
  subjectSize: { width: 80, height: 80 },
  scale: 1,
  targetX: 24,
  targetY: 24,
  decisionReason: 'pixel probe smoke',
  smartLayoutPlanned: false,
  quickExportPlanned: true,
  quickExportOutputPath: sameResultPath
};

const toolResults = [
  { toolName: 'quickExport[128]', result: { success: true, outputPath: sameResultPath } }
];

const cases = [];

async function record(name, fn) {
  try {
    await fn();
    cases.push({ name, status: 'pass' });
  } catch (error) {
    cases.push({ name, status: 'fail', error: error.message });
    throw error;
  }
}

async function createFixtureImages() {
  const overlay = {
    input: Buffer.from(
      `<svg width="128" height="128"><rect x="24" y="24" width="80" height="80" fill="black"/></svg>`
    ),
    top: 0,
    left: 0
  };
  await sharp({ create: { width: 128, height: 128, channels: 3, background: 'white' } })
    .composite([overlay])
    .png()
    .toFile(referencePath);
  fs.copyFileSync(referencePath, sameResultPath);
  await sharp({ create: { width: 128, height: 128, channels: 3, background: 'white' } })
    .png()
    .toFile(differentResultPath);
}

async function main() {
  await createFixtureImages();

  await record('compare-identical-files-returns-ok', async () => {
    const result = await service.compareImageFiles(referencePath, sameResultPath, {
      targetSize: { width: 128, height: 128 }
    });
    assert(result.success === true, 'identical compare should succeed');
    assert(result.status === 'ok', `expected ok, got ${result.status}`);
    assert(result.rawImagesRedacted === true, 'compare result must be redacted');
    assert(result.mae === 0, `expected mae 0, got ${result.mae}`);
    assertNoImagePayload(result, 'identical compare');
  });

  await record('compare-different-files-returns-watch', async () => {
    const result = await service.compareImageFiles(referencePath, differentResultPath, {
      targetSize: { width: 128, height: 128 }
    });
    assert(result.success === true, 'different compare should still return diagnostics');
    assert(result.status === 'watch', `expected watch, got ${result.status}`);
    assert(result.rawImagesRedacted === true, 'watch result must be redacted');
    assert(Number(result.mae) > 0, 'watch result should include non-zero mae');
    assertNoImagePayload(result, 'different compare');
  });

  await record('missing-result-returns-unverified', async () => {
    const result = await service.compareImageFiles(referencePath, missingPath, {
      targetSize: { width: 128, height: 128 }
    });
    assert(result.success === false, 'missing result should not succeed');
    assert(result.status === 'unverified', `expected unverified, got ${result.status}`);
    assert(result.rawImagesRedacted === true, 'missing result must be redacted');
  });

  await record('pixel-probe-ok-still-needs-manual-review', async () => {
    const pixelProbe = await service.compareImageFiles(referencePath, sameResultPath, {
      targetSize: { width: 128, height: 128 }
    });
    const qa = buildMainImageScreenshotQa({
      sizePlans: [sizePlan],
      toolResults,
      pixelProbe: {
        mode: 'pixel-probe',
        status: pixelProbe.status,
        mae: pixelProbe.mae,
        rmse: pixelProbe.rmse,
        highDeltaRatio: pixelProbe.highDeltaRatio,
        darkJaccard: pixelProbe.darkJaccard,
        softDarkJaccard: pixelProbe.softDarkJaccard,
        summary: pixelProbe.summary,
        boundary: pixelProbe.boundary,
        rawImagesRedacted: pixelProbe.rawImagesRedacted
      }
    });
    assert(qa.stage === 'needs_manual_review', `expected needs_manual_review, got ${qa.stage}`);
    assert(qa.status === 'needs_review', `expected needs_review, got ${qa.status}`);
    const readiness = buildMainImageScreenshotProbeReadiness({
      screenshotQa: qa,
      sizePlans: [sizePlan],
      fileProbes: [{
        path: sameResultPath,
        status: 'ok',
        exists: true,
        isFile: true,
        dimensions: { width: 128, height: 128 },
        rawImagesRedacted: true
      }],
      referenceImagePath: referencePath
    });
    assert(readiness.stage === 'needs_manual_review', `expected readiness needs_manual_review, got ${readiness.stage}`);
  });

  await record('executor-and-ipc-wiring-is-present', async () => {
    const executor = fs.readFileSync(path.join(repoRoot, 'src/renderer/services/skill-executors/main-image.executor.ts'), 'utf8');
    const serviceSource = fs.readFileSync(path.join(repoRoot, 'src/main/services/resource-manager-service.ts'), 'utf8');
    const handlers = fs.readFileSync(path.join(repoRoot, 'src/main/ipc-handlers/resource-handlers.ts'), 'utf8');
    const preload = fs.readFileSync(path.join(repoRoot, 'src/main/preload.ts'), 'utf8');
    const types = fs.readFileSync(path.join(repoRoot, 'src/renderer/types.d.ts'), 'utf8');
    assertIncludes(executor, 'compareMainImageResultToReference', 'executor should have pixel probe adapter');
    assertIncludes(executor, 'compareImageFiles', 'executor should call compareImageFiles');
    assert(!executor.includes("executeToolCall('getCanvasSnapshot'"), 'main-image pixel probe must not add Photoshop snapshot tool calls');
    assertIncludes(serviceSource, 'compareImageFiles', 'resource service should expose compareImageFiles');
    assertIncludes(handlers, 'resource:compareImageFiles', 'IPC handler should expose compareImageFiles');
    assertIncludes(preload, 'compareImageFiles', 'preload should expose compareImageFiles');
    assertIncludes(types, 'compareImageFiles', 'renderer types should expose compareImageFiles');
  });

  await record('source-and-output-have-no-mojibake', async () => {
    const files = [
      'src/main/services/resource-manager-service.ts',
      'src/main/ipc-handlers/resource-handlers.ts',
      'src/main/preload.ts',
      'src/renderer/types.d.ts',
      'src/renderer/services/skill-executors/main-image.executor.ts',
      'scripts/smoke-main-image-pixel-probe-adapter.cjs'
    ];
    for (const file of files) {
      assertNoMojibake(fs.readFileSync(path.join(repoRoot, file), 'utf8'), file);
    }
  });

  const report = {
    success: true,
    cases,
    report: {
      json: path.join(repoRoot, 'tmp', 'main-image-pixel-probe-adapter-smoke.json'),
      md: path.join(repoRoot, 'tmp', 'main-image-pixel-probe-adapter-smoke.md')
    }
  };
  fs.writeFileSync(report.report.json, JSON.stringify(report, null, 2), 'utf8');
  fs.writeFileSync(
    report.report.md,
    [
      '# Main Image Pixel Probe Adapter Smoke',
      '',
      ...cases.map((item) => `- ${item.status}: ${item.name}`)
    ].join('\n'),
    'utf8'
  );
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
