#!/usr/bin/env node

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function run(args, expectSuccess = true) {
  try {
    const output = execFileSync('node', ['scripts/check-reference-quality-claim-gate.cjs', ...args], {
      cwd: process.cwd(),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 64 * 1024 * 1024
    });
    if (!expectSuccess) {
      throw new Error(`Expected gate command to fail: ${args.join(' ')}`);
    }
    return { status: 0, output, json: JSON.parse(output) };
  } catch (error) {
    if (expectSuccess) throw error;
    return {
      status: error.status,
      output: `${error.stdout || ''}${error.stderr || ''}`
    };
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

const report = run(['--json']).json;
assert(report.success === true, 'quality claim gate should produce a report');
assert(report.policy.readOnly === true, 'quality claim gate must be read-only');
assert(report.policy.doesNotRunPhotoshop === true, 'quality claim gate must not run Photoshop');
assert(report.policy.doesNotCallModel === true, 'quality claim gate must not call a model');
assert(report.policy.doesNotMutateCases === true, 'quality claim gate must not mutate benchmark cases');
assert(report.gate.allowedToClaim === false, 'current benchmark suite must not be claim-ready');
assert(report.gate.evidenceSummary.designQualityEligible === 0, 'current suite should have zero quality-eligible cases');
assert(report.gate.blockers.some((item) => item.includes('design quality eligible cases')), 'gate should explain missing eligible cases');
assert(report.gate.boundary.pixelProbeIsDiagnosticOnly === true, 'pixel probe boundary must remain explicit');

const requireReady = run(['--json', '--require-ready'], false);
assert(requireReady.status === 2, 'require-ready should fail while suite is not ready');
assert(requireReady.output.includes('"allowedToClaim": false'), 'failed require-ready output should expose allowedToClaim false');

const tmpBenchmarkDir = path.join(process.cwd(), 'tmp', 'reference-quality-claim-gate-smoke');
const casesDir = path.join(tmpBenchmarkDir, 'cases');
const assetsDir = path.join(tmpBenchmarkDir, 'assets');
const resultsDir = path.join(tmpBenchmarkDir, 'results');
fs.mkdirSync(casesDir, { recursive: true });
fs.mkdirSync(assetsDir, { recursive: true });
fs.mkdirSync(resultsDir, { recursive: true });

const caseId = 'rr-smoke-real-quality-candidate';
fs.writeFileSync(path.join(assetsDir, 'real-reference.png'), 'reference');
fs.writeFileSync(path.join(resultsDir, 'real-result.png'), 'result');
writeJson(path.join(tmpBenchmarkDir, 'cases.manifest.json'), {
  suite: 'reference-replication',
  version: 1,
  status: 'temporary-smoke',
  template: 'case-template.json',
  caseDirectory: 'cases',
  cases: [
    {
      id: caseId,
      name: 'Smoke real quality candidate',
      status: 'reviewed',
      file: `cases/${caseId}.json`
    }
  ]
});
writeJson(path.join(casesDir, `${caseId}.json`), {
  id: caseId,
  name: 'Smoke real quality candidate',
  status: 'reviewed',
  referenceImage: {
    path: 'assets/real-reference.png',
    description: 'Smoke-only real reference fixture name without synthetic markers'
  },
  scenario: {
    category: 'poster-layout',
    source: {
      providedBy: 'real-commercial-reference'
    },
    notes: 'temporary smoke benchmark for positive quality gate path'
  },
  execution: {
    visionModel: 'smoke',
    logicModel: 'smoke',
    autoCreateDocument: true,
    templateApply: false
  },
  outputs: {
    documentName: 'smoke.psd',
    resultScreenshot: 'results/real-result.png',
    notes: 'Smoke-only result'
  },
  expectedElements: [
    {
      id: 'headline',
      kind: 'text',
      content: 'Smoke',
      expectedBox: { x: 10, y: 10, width: 100, height: 30 }
    }
  ],
  score: {
    structure: 0.9,
    placement: 0.9,
    textHierarchy: 0.9,
    editability: 0.9,
    overall: 0.9
  },
  verification: {
    buildVerified: true,
    manualVerified: true,
    reviewedAt: '2026-05-12T00:00:00.000Z',
    reviewer: 'smoke'
  },
  acceptance: {
    requiredEvidence: ['editable-text-layers', 'bounds-qa', 'screenshot-pixel-probe', 'manual-review'],
    mustRemainEditable: true,
    boundsQa: {
      minOkRatio: 0.8,
      maxMismatch: 0,
      maxUnverified: 0
    },
    screenshotPixelProbe: {
      enabled: true,
      targetSize: { width: 460, height: 460 },
      thresholds: {
        maxMae: 35,
        maxHighDeltaRatio: 0.25,
        minDarkJaccard: 0.45
      },
      boundary: 'Pixel probe is diagnostic evidence only. It does not prove high-fidelity design quality.',
      rawImagesRedacted: true
    }
  }
});
writeJson(path.join(process.cwd(), 'tmp', `${caseId}-result-evidence.json`), {
  success: true,
  caseId,
  referenceImage: {
    relativePath: 'assets/real-reference.png'
  },
  resultScreenshot: {
    absolutePath: path.join(resultsDir, 'real-result.png'),
    normalizedSnapshotPath: path.join(process.cwd(), 'tmp', `${caseId}-normalized.png`)
  },
  manualReviewRequired: true,
  qualityClaimCandidateAfterManualReview: true,
  commands: {
    recordResultAfterManualReview: 'npm run benchmark:reference-replication:record-result -- --id rr-smoke-real-quality-candidate'
  },
  pixelProbe: {
    status: 'ok',
    rawImagesRedacted: true,
    boundary: 'This is diagnostic evidence only, not a high-fidelity aesthetic acceptance.'
  }
});

const positive = run(['--json', '--require-ready', '--benchmark-dir', tmpBenchmarkDir]).json;
assert(positive.gate.allowedToClaim === true, 'quality gate should allow a fully verified non-synthetic non-FEX case');
assert(positive.gate.eligibleCases.length === 1, 'positive smoke should expose one eligible case');

console.log(JSON.stringify({
  success: true,
  checks: [
    'quality claim gate is read-only',
    'current suite is not claim-ready',
    'require-ready fails when there are no eligible real cases',
    'temporary fully verified real-case suite passes require-ready',
    'pixel probe remains diagnostic-only'
  ]
}, null, 2));
