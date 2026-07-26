#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '..', 'tsconfig.main.json')
});

const repoRoot = path.resolve(__dirname, '..');
const tmpDir = path.join(repoRoot, 'tmp', 'main-image-screenshot-probe-readiness');
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
  assert(String(value || '').includes(needle), message || `Expected ${JSON.stringify(value)} to include ${needle}`);
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

const resultPath = path.join(tmpDir, 'main-image-800.png');
const referencePath = path.join(tmpDir, 'main-image-reference.png');
const mismatchPath = path.join(tmpDir, 'main-image-mismatch.png');
const service = new ResourceManagerService();

const baseSizePlan = {
  sizeKey: '800',
  targetSize: { width: 800, height: 800 },
  subjectSize: { width: 520, height: 680 },
  scale: 0.74,
  targetX: 140,
  targetY: 72,
  decisionReason: '主图 guideline scale 74%',
  smartLayoutPlanned: true,
  quickExportPlanned: true,
  quickExportOutputPath: resultPath
};

const passingToolResults = [
  { toolName: 'quickExport[800]', result: { success: true, outputPath: resultPath } }
];

const cases = [];

async function record(name, fn) {
  try {
    cases.push({ name, status: 'pass', details: await fn() });
  } catch (error) {
    cases.push({ name, status: 'fail', error: error && error.message ? error.message : String(error) });
  }
}

function buildQa(extra = {}) {
  return buildMainImageScreenshotQa({
    sizePlans: [baseSizePlan],
    toolResults: passingToolResults,
    ...extra
  });
}

async function main() {
  await sharp({
    create: {
      width: 800,
      height: 800,
      channels: 3,
      background: { r: 248, g: 248, b: 244 }
    }
  }).png().toFile(resultPath);
  fs.copyFileSync(resultPath, referencePath);
  await sharp({
    create: {
      width: 640,
      height: 640,
      channels: 3,
      background: { r: 245, g: 245, b: 245 }
    }
  }).png().toFile(mismatchPath);

  await record('resource-probe-returns-redacted-file-metadata', async () => {
    const probe = await service.probeImageFile(resultPath);
    assert(probe.success === true, `expected probe success, got ${probe.error || probe.status}`);
    assert(probe.status === 'ok', `expected ok, got ${probe.status}`);
    assert(probe.dimensions.width === 800 && probe.dimensions.height === 800, 'unexpected dimensions');
    assert(probe.rawImagesRedacted === true, 'raw images must be redacted');
    assert(!('base64' in probe), 'probe must not return base64');
    return { status: probe.status, dimensions: probe.dimensions, rawImagesRedacted: probe.rawImagesRedacted };
  });

  await record('needs-probe-target-when-only-result-file-is-ready', async () => {
    const qa = buildQa();
    const probe = await service.probeImageFile(resultPath);
    const readiness = buildMainImageScreenshotProbeReadiness({
      screenshotQa: qa,
      sizePlans: [baseSizePlan],
      fileProbes: [probe]
    });
    assert(readiness.stage === 'needs_probe_target', `expected needs_probe_target, got ${readiness.stage}`);
    assert(readiness.status === 'needs_review', `expected needs_review, got ${readiness.status}`);
    assert(readiness.warnings.some((item) => item.includes('缺少参考图')), 'reference target warning absent');
    return { stage: readiness.stage, target: readiness.probeTarget.mode };
  });

  await record('ready-for-pixel-probe-when-reference-image-is-known', async () => {
    const qa = buildQa();
    const probe = await service.probeImageFile(resultPath);
    const readiness = buildMainImageScreenshotProbeReadiness({
      screenshotQa: qa,
      sizePlans: [baseSizePlan],
      fileProbes: [probe],
      referenceImagePath: referencePath
    });
    assert(readiness.stage === 'ready_for_pixel_probe', `expected ready_for_pixel_probe, got ${readiness.stage}`);
    assert(readiness.probeTarget.mode === 'reference-image', 'expected reference-image probe target');
    return { stage: readiness.stage, target: readiness.probeTarget.mode };
  });

  await record('explicit-result-context-flows-into-readiness', async () => {
    const qa = buildMainImageScreenshotQa({
      sizePlans: [{ ...baseSizePlan, quickExportPlanned: false, quickExportOutputPath: undefined }],
      toolResults: [],
      resultImageRecord: {
        plannedExportCount: 1,
        successfulExportCount: 1,
        resultPaths: [resultPath],
        missingOutputPathCount: 0,
        sources: ['controlledProduct.exportGroup.actualResult']
      }
    });
    const probe = await service.probeImageFile(resultPath);
    const readiness = buildMainImageScreenshotProbeReadiness({
      screenshotQa: qa,
      sizePlans: [baseSizePlan],
      fileProbes: [probe],
      referenceImagePath: referencePath
    });
    assert(qa.stage === 'needs_pixel_probe', `expected screenshot QA needs_pixel_probe, got ${qa.stage}`);
    assert(readiness.stage === 'ready_for_pixel_probe', `expected ready_for_pixel_probe, got ${readiness.stage}`);
    assert(readiness.probeTarget.mode === 'reference-image', 'expected explicit context to keep reference-image target');
    return { qaStage: qa.stage, readinessStage: readiness.stage };
  });

  await record('pixel-probe-ok-still-needs-manual-review', async () => {
    const qa = buildQa({
      pixelProbe: {
        mode: 'pixel-probe',
        status: 'ok',
        mae: 3,
        highDeltaRatio: 0.01,
        darkJaccard: 0.91,
        rawImagesRedacted: true,
        boundary: 'diagnostic only'
      }
    });
    const probe = await service.probeImageFile(resultPath);
    const readiness = buildMainImageScreenshotProbeReadiness({
      screenshotQa: qa,
      sizePlans: [baseSizePlan],
      fileProbes: [probe],
      referenceImagePath: referencePath
    });
    assert(readiness.stage === 'needs_manual_review', `expected needs_manual_review, got ${readiness.stage}`);
    assert(readiness.status === 'needs_review', `expected needs_review, got ${readiness.status}`);
    return { stage: readiness.stage };
  });

  await record('passes-only-when-screenshot-qa-has-passed', async () => {
    const manualReview = { decision: 'approved', score: 0.9, reviewer: 'smoke' };
    const qa = buildQa({
      pixelProbe: {
        mode: 'pixel-probe',
        status: 'ok',
        mae: 3,
        highDeltaRatio: 0.01,
        darkJaccard: 0.91,
        rawImagesRedacted: true,
        boundary: 'diagnostic only'
      },
      manualReview
    });
    const probe = await service.probeImageFile(resultPath);
    const readiness = buildMainImageScreenshotProbeReadiness({
      screenshotQa: qa,
      sizePlans: [baseSizePlan],
      fileProbes: [probe],
      referenceImagePath: referencePath
    });
    assert(qa.stage === 'passed', `expected screenshot QA passed, got ${qa.stage}`);
    assert(readiness.stage === 'passed', `expected readiness passed, got ${readiness.stage}`);
    return { stage: readiness.stage };
  });

  await record('blocks-missing-result-file', async () => {
    const qa = buildQa();
    const missingPath = path.join(tmpDir, 'missing.png');
    const probe = await service.probeImageFile(missingPath);
    const readiness = buildMainImageScreenshotProbeReadiness({
      screenshotQa: qa,
      sizePlans: [baseSizePlan],
      fileProbes: [{ ...probe, path: resultPath }],
      referenceImagePath: referencePath
    });
    assert(readiness.stage === 'blocked', `expected blocked, got ${readiness.stage}`);
    assert(readiness.blockers.some((item) => item.includes('不可用于截图探针')), 'missing file blocker absent');
    return { stage: readiness.stage, blockers: readiness.blockers.length };
  });

  await record('warns-on-dimension-mismatch-without-overclaim', async () => {
    const mismatchPlan = { ...baseSizePlan, quickExportOutputPath: mismatchPath };
    const qa = buildMainImageScreenshotQa({
      sizePlans: [mismatchPlan],
      toolResults: [{ toolName: 'quickExport[800]', result: { success: true, outputPath: mismatchPath } }]
    });
    const probe = await service.probeImageFile(mismatchPath);
    const readiness = buildMainImageScreenshotProbeReadiness({
      screenshotQa: qa,
      sizePlans: [baseSizePlan],
      fileProbes: [probe],
      referenceImagePath: referencePath
    });
    assert(readiness.warnings.some((item) => item.includes('尺寸与计划尺寸不一致')), 'dimension warning absent');
    assert(readiness.stage !== 'passed', 'dimension mismatch must not pass');
    return { stage: readiness.stage, warnings: readiness.warnings.length };
  });

  await record('blocks-raw-image-leak-in-file-probe', async () => {
    const qa = buildQa();
    const probe = await service.probeImageFile(resultPath);
    const readiness = buildMainImageScreenshotProbeReadiness({
      screenshotQa: qa,
      sizePlans: [baseSizePlan],
      fileProbes: [{ ...probe, rawImagesRedacted: false }],
      referenceImagePath: referencePath
    });
    assert(readiness.stage === 'blocked', `expected blocked, got ${readiness.stage}`);
    assert(readiness.blockers.some((item) => item.includes('rawImagesRedacted=true')), 'raw image redaction blocker absent');
    return { stage: readiness.stage };
  });

  await record('executor-and-ipc-wiring-is-present', async () => {
    const executor = fs.readFileSync(path.join(repoRoot, 'src/renderer/services/skill-executors/main-image.executor.ts'), 'utf8');
    const resourceHandlers = fs.readFileSync(path.join(repoRoot, 'src/main/ipc-handlers/resource-handlers.ts'), 'utf8');
    const preload = fs.readFileSync(path.join(repoRoot, 'src/main/preload.ts'), 'utf8');
    const types = fs.readFileSync(path.join(repoRoot, 'src/renderer/types.d.ts'), 'utf8');
    const reportScript = fs.readFileSync(path.join(repoRoot, 'scripts/report-main-image-screenshot-probe-readiness.cjs'), 'utf8');
    const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
    assertIncludes(executor, 'buildMainImageControlledProductQaBundle', 'executor should obtain probe readiness from the unified QA bundle');
    assertIncludes(executor, 'mainImageScreenshotProbeReadiness', 'executor missing readiness data');
    assertIncludes(resourceHandlers, 'resource:probeImageFile', 'resource handler missing probeImageFile');
    assertIncludes(preload, 'probeImageFile', 'preload missing probeImageFile');
    assertIncludes(types, 'probeImageFile', 'renderer type missing probeImageFile');
    assertIncludes(reportScript, 'main-image-screenshot-probe-readiness', 'readiness report script missing report id');
    assert(pkg.scripts['smoke:main-image:screenshot-probe-readiness'], 'package script missing readiness smoke');
    assert(pkg.scripts['maintenance:main-image:screenshot-probe-readiness'], 'package script missing readiness maintenance report');
    assertIncludes(pkg.scripts['maintenance:preflight'], 'smoke:main-image:screenshot-probe-readiness', 'maintenance preflight missing readiness smoke');
    return { wired: true };
  });

  await record('source-and-output-have-no-mojibake', async () => {
    const files = [
      'src/shared/main-image-screenshot-probe-readiness.ts',
      'src/main/services/resource-manager-service.ts',
      'src/main/ipc-handlers/resource-handlers.ts',
      'src/main/preload.ts',
      'src/renderer/types.d.ts',
      'src/renderer/services/skill-executors/main-image.executor.ts'
    ];
    for (const file of files) {
      assertNoMojibake(fs.readFileSync(path.join(repoRoot, file), 'utf8'), file);
    }
    const readiness = buildMainImageScreenshotProbeReadiness({
      screenshotQa: buildQa(),
      sizePlans: [baseSizePlan],
      fileProbes: [await service.probeImageFile(resultPath)]
    });
    assertNoMojibake(JSON.stringify(readiness, null, 2), 'readiness output');
    return { files: files.length, stage: readiness.stage };
  });

  const report = {
    generatedAt: new Date().toISOString(),
    success: cases.every((item) => item.status === 'pass'),
    cases
  };

  const jsonPath = path.join(repoRoot, 'tmp', 'main-image-screenshot-probe-readiness-smoke.json');
  const mdPath = path.join(repoRoot, 'tmp', 'main-image-screenshot-probe-readiness-smoke.md');
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), 'utf8');
  fs.writeFileSync(mdPath, [
    '# Main Image Screenshot Probe Readiness Smoke',
    '',
    `success: ${report.success}`,
    '',
    ...cases.map((item) => `- ${item.name}: ${item.status}${item.error ? ` - ${item.error}` : ''}`)
  ].join('\n'), 'utf8');

  console.log(JSON.stringify({
    success: report.success,
    cases: cases.map(({ name, status, error }) => ({ name, status, error })),
    report: { json: jsonPath, md: mdPath }
  }, null, 2));

  process.exit(report.success ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
