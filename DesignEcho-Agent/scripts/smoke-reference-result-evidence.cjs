#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const sharp = require('sharp');

const ROOT = path.resolve(__dirname, '..');
const TMP_DIR = path.join(ROOT, 'tmp', 'reference-result-evidence-smoke');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
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

async function main() {
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
        id: 'rr-smoke-real-source',
        name: 'Smoke real source result evidence',
        status: 'reference_captured',
        file: 'cases/rr-smoke-real-source.json'
      },
      {
        id: 'rr-smoke-unknown-source',
        name: 'Smoke unknown source result evidence',
        status: 'reference_captured',
        file: 'cases/rr-smoke-unknown-source.json'
      }
    ]
  });
  const baseCase = {
    status: 'reference_captured',
    referenceImage: {
      path: 'assets/fixture.png',
      description: 'Smoke fixture'
    },
    scenario: {
      category: 'poster-layout',
      canvas: { width: 120, height: 80 },
      source: { providedBy: 'unknown' }
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
  };
  writeJson(path.join(casesDir, 'rr-smoke-real-source.json'), {
    ...baseCase,
    id: 'rr-smoke-real-source',
    name: 'Smoke real source result evidence',
    scenario: {
      ...baseCase.scenario,
      source: { providedBy: 'real-commercial-reference' }
    }
  });
  writeJson(path.join(casesDir, 'rr-smoke-unknown-source.json'), {
    ...baseCase,
    id: 'rr-smoke-unknown-source',
    name: 'Smoke unknown source result evidence',
    scenario: {
      ...baseCase.scenario,
      source: { providedBy: 'unknown' }
    }
  });

  const jsonOut = path.join(TMP_DIR, 'evidence.json');
  const mdOut = path.join(TMP_DIR, 'evidence.md');
  const output = execFileSync(process.execPath, [
    path.join(ROOT, 'scripts', 'evaluate-reference-replication-result.cjs'),
    '--benchmark-dir', benchmarkDir,
    '--id', 'rr-smoke-real-source',
    '--result-screenshot', resultPath,
    '--output-json', jsonOut,
    '--output-md', mdOut,
    '--reviewer', 'smoke'
  ], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024
  });
  const parsed = JSON.parse(output);
  const report = JSON.parse(fs.readFileSync(jsonOut, 'utf8'));
  const markdown = fs.readFileSync(mdOut, 'utf8');

  assert(parsed.success === true, 'result evidence command should succeed');
  assert(parsed.pixelProbeStatus === 'ok', `expected ok pixel probe, got ${parsed.pixelProbeStatus}`);
  assert(report.manualReviewRequired === true, 'manual review must remain required');
  assert(report.scenario.sourceKind === 'real-commercial-reference', 'real-source evidence should preserve explicit source kind');
  assert(report.qualityClaimCandidateAfterManualReview === true, 'explicit real source can become a candidate after manual review');
  assert(report.pixelProbe.rawImagesRedacted === true, 'raw images must stay redacted');
  assert(markdown.includes('Pixel probe is diagnostic only'), 'markdown must preserve pixel-probe boundary');
  assert(markdown.includes('Only explicit real reference source kinds'), 'markdown must preserve source-kind boundary');
  assert(markdown.includes('benchmark:reference-replication:record-result'), 'markdown must include record-result command');

  const blockedJsonOut = path.join(TMP_DIR, 'blocked-evidence.json');
  const blockedMdOut = path.join(TMP_DIR, 'blocked-evidence.md');
  execFileSync(process.execPath, [
    path.join(ROOT, 'scripts', 'evaluate-reference-replication-result.cjs'),
    '--benchmark-dir', benchmarkDir,
    '--id', 'rr-smoke-unknown-source',
    '--result-screenshot', resultPath,
    '--output-json', blockedJsonOut,
    '--output-md', blockedMdOut,
    '--reviewer', 'smoke'
  ], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024
  });
  const blockedReport = JSON.parse(fs.readFileSync(blockedJsonOut, 'utf8'));
  assert(blockedReport.scenario.sourceKind === 'unknown', 'blocked evidence should preserve unknown source');
  assert(blockedReport.qualityClaimCandidateAfterManualReview === false, 'unknown source must not become quality candidate');

  console.log(JSON.stringify({
    ok: true,
    pixelProbeStatus: parsed.pixelProbeStatus,
    manualReviewRequired: report.manualReviewRequired,
    blockedSourceCandidate: blockedReport.qualityClaimCandidateAfterManualReview,
    outputs: parsed.outputs
  }, null, 2));
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
