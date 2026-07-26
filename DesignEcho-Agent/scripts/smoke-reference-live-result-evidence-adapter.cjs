#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const sharp = require('sharp');

const ROOT = path.resolve(__dirname, '..');
const TMP_DIR = path.join(ROOT, 'tmp', 'reference-live-result-evidence-adapter-smoke');
const ADAPTER_PATH = path.join(ROOT, 'scripts', 'adapt-reference-live-result-evidence.cjs');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function runNode(args) {
  return execFileSync(process.execPath, args, {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe']
  });
}

function runNodeResult(args) {
  try {
    return { ok: true, output: runNode(args) };
  } catch (error) {
    return {
      ok: false,
      output: [error.stdout || '', error.stderr || '', error.message || String(error)].join('\n')
    };
  }
}

async function createFixtureImage(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  await sharp({
    create: {
      width: 120,
      height: 80,
      channels: 3,
      background: '#ffffff'
    }
  })
    .composite([
      {
        input: Buffer.from(
          `<svg width="120" height="80" xmlns="http://www.w3.org/2000/svg">
            <rect x="14" y="14" width="92" height="12" fill="#111"/>
            <rect x="14" y="40" width="48" height="8" fill="#111"/>
            <rect x="72" y="40" width="34" height="8" fill="#111"/>
          </svg>`
        )
      }
    ])
    .png()
    .toFile(filePath);
}

function assertNoRawLivePayload(value) {
  const serialized = JSON.stringify(value);
  assert(!/data:image/i.test(serialized), 'live report summary must not include data URLs');
  assert(!/base64/i.test(serialized), 'live report summary must not include base64 payload fields');
  assert(!/rawPayload/i.test(serialized), 'live report summary must not include raw payload fields');
  assert(!/very-secret-live-payload/i.test(serialized), 'live report summary must not include raw live payload content');
}

async function createBenchmarkFixture() {
  fs.rmSync(TMP_DIR, { recursive: true, force: true });
  const benchmarkDir = path.join(TMP_DIR, 'benchmark');
  const assetsDir = path.join(benchmarkDir, 'assets');
  const casesDir = path.join(benchmarkDir, 'cases');
  const referencePath = path.join(assetsDir, 'fixture.png');
  const resultPath = path.join(TMP_DIR, 'result.png');

  await createFixtureImage(referencePath);
  fs.copyFileSync(referencePath, resultPath);

  writeJson(path.join(benchmarkDir, 'cases.manifest.json'), {
    suite: 'reference-replication',
    cases: [
      {
        id: 'rr-live-adapter-smoke',
        name: 'Live adapter smoke',
        status: 'reference_captured',
        file: 'cases/rr-live-adapter-smoke.json'
      }
    ]
  });
  writeJson(path.join(casesDir, 'rr-live-adapter-smoke.json'), {
    id: 'rr-live-adapter-smoke',
    name: 'Live adapter smoke',
    status: 'reference_captured',
    referenceImage: {
      path: 'assets/fixture.png',
      description: 'Smoke fixture'
    },
    scenario: {
      category: 'poster-layout',
      canvas: { width: 120, height: 80 },
      source: { providedBy: 'real-commercial-reference' }
    },
    outputs: {
      resultScreenshot: ''
    },
    acceptance: {
      screenshotPixelProbe: {
        targetSize: { width: 120, height: 80 },
        thresholds: {
          maxMae: 1,
          maxHighDeltaRatio: 0.01,
          minDarkJaccard: 0.99
        },
        rawImagesRedacted: true
      }
    }
  });

  return { benchmarkDir, resultPath };
}

function createLiveReport(filePath, resultPath) {
  writeJson(filePath, {
    success: true,
    skipped: false,
    mode: 'live',
    report: path.join(TMP_DIR, 'agent-live-report.md'),
    capturedResultScreenshot: {
      absolutePath: resultPath
    },
    cases: [
      {
        id: 'rr-live-adapter-smoke',
        success: true,
        assertions: {
          documentCreated: true,
          resultScreenshot: true
        },
        rawPayload: 'very-secret-live-payload',
        dataUrl: 'data:image/png;base64,very-secret-live-payload'
      }
    ],
    liveAssertions: {
      photoshopConnected: true,
      resultScreenshotWritten: true,
      rawPayload: 'very-secret-live-payload'
    },
    base64: 'very-secret-live-payload'
  });
}

async function main() {
  const { benchmarkDir, resultPath } = await createBenchmarkFixture();
  const liveReportPath = path.join(TMP_DIR, 'live-report.json');
  const adapterJson = path.join(TMP_DIR, 'adapter-summary.json');
  const adapterMd = path.join(TMP_DIR, 'adapter-summary.md');
  createLiveReport(liveReportPath, resultPath);

  const output = runNode([
    ADAPTER_PATH,
    '--benchmark-dir', benchmarkDir,
    '--id', 'rr-live-adapter-smoke',
    '--live-report', liveReportPath,
    '--output-json', adapterJson,
    '--output-md', adapterMd,
    '--reviewer', 'smoke'
  ]);
  const parsed = JSON.parse(output);
  const summary = readJson(adapterJson);

  assert(parsed.success === true, 'adapter command should report success');
  assert(summary.success === true, 'adapter summary success should be true');
  assert(summary.validation && summary.validation.ok === true, 'validation.ok should be true');
  assert(summary.manualReviewRequired === true, 'manual review must remain required');
  assert(summary.referenceEvidence && fs.existsSync(summary.referenceEvidence.json), 'reference evidence JSON should exist');
  assert(summary.referenceEvidence && fs.existsSync(summary.referenceEvidence.md), 'reference evidence Markdown should exist');
  assertNoRawLivePayload(summary.liveReportSummary);
  assert(
    (summary.boundaries || []).some((item) => /live report success is not reference quality acceptance/i.test(item)),
    'boundaries must state live success is not a quality claim'
  );
  assert(
    String(summary.commands?.recordResultAfterManualReview || '').includes('benchmark:reference-replication:record-result'),
    'adapter summary should expose record-result command'
  );

  const missingReportPath = path.join(TMP_DIR, 'missing-result-live-report.json');
  writeJson(missingReportPath, {
    success: true,
    skipped: false,
    mode: 'live',
    cases: [{ id: 'rr-live-adapter-smoke', success: true }]
  });
  const missingResult = runNodeResult([
    ADAPTER_PATH,
    '--benchmark-dir', benchmarkDir,
    '--id', 'rr-live-adapter-smoke',
    '--live-report', missingReportPath
  ]);
  assert(!missingResult.ok, 'missing result screenshot should fail');
  assert(/result screenshot/i.test(missingResult.output), 'missing result screenshot failure should name result screenshot');

  console.log(JSON.stringify({
    ok: true,
    adapterSuccess: summary.success,
    validationOk: summary.validation.ok,
    manualReviewRequired: summary.manualReviewRequired,
    outputJson: adapterJson
  }, null, 2));
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
