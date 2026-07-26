#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const TMP_DIR = path.join(ROOT, 'tmp', 'reference-evidence-pipeline-smoke');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function runPipeline(benchmarkDir) {
  const output = execFileSync(process.execPath, [
    path.join(ROOT, 'scripts', 'report-reference-evidence-pipeline.cjs'),
    '--benchmark-dir', benchmarkDir,
    '--json'
  ], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024
  });
  return JSON.parse(output);
}

function main() {
  fs.rmSync(TMP_DIR, { recursive: true, force: true });
  const benchmarkDir = path.join(TMP_DIR, 'benchmark');
  fs.mkdirSync(path.join(benchmarkDir, 'assets'), { recursive: true });
  fs.mkdirSync(path.join(benchmarkDir, 'cases'), { recursive: true });
  fs.mkdirSync(path.join(benchmarkDir, 'results'), { recursive: true });
  fs.writeFileSync(path.join(benchmarkDir, 'assets', 'ref.png'), 'fake-image', 'utf8');
  fs.writeFileSync(path.join(benchmarkDir, 'results', 'result.png'), 'fake-result', 'utf8');

  writeJson(path.join(benchmarkDir, 'cases.manifest.json'), {
    suite: 'reference-replication',
    cases: [
      {
        id: 'rr-pipeline-no-result',
        name: 'No result',
        status: 'reference_captured',
        file: 'cases/rr-pipeline-no-result.json'
      },
      {
        id: 'rr-pipeline-has-result',
        name: 'Has result',
        status: 'reference_captured',
        file: 'cases/rr-pipeline-has-result.json'
      },
      {
        id: 'rr-pipeline-unknown-source',
        name: 'Unknown source',
        status: 'reference_captured',
        file: 'cases/rr-pipeline-unknown-source.json'
      },
      {
        id: 'rr-pipeline-invalid-evidence',
        name: 'Invalid evidence',
        status: 'reference_captured',
        file: 'cases/rr-pipeline-invalid-evidence.json'
      }
    ]
  });
  const baseCase = {
    status: 'reference_captured',
    referenceImage: { path: 'assets/ref.png' },
    scenario: {
      category: 'poster-layout',
      source: { providedBy: 'real-commercial-reference' },
      canvas: { width: 120, height: 80 }
    },
    outputs: { resultScreenshot: '' },
    score: {
      structure: null,
      placement: null,
      textHierarchy: null,
      editability: null,
      overall: null
    },
    verification: {
      buildVerified: false,
      manualVerified: false
    }
  };
  writeJson(path.join(benchmarkDir, 'cases', 'rr-pipeline-no-result.json'), {
    ...baseCase,
    id: 'rr-pipeline-no-result',
    name: 'No result'
  });
  writeJson(path.join(benchmarkDir, 'cases', 'rr-pipeline-has-result.json'), {
    ...baseCase,
    id: 'rr-pipeline-has-result',
    name: 'Has result',
    outputs: { resultScreenshot: 'results/result.png' }
  });
  writeJson(path.join(benchmarkDir, 'cases', 'rr-pipeline-unknown-source.json'), {
    ...baseCase,
    id: 'rr-pipeline-unknown-source',
    name: 'Unknown source',
    scenario: {
      ...baseCase.scenario,
      source: { providedBy: 'unknown' }
    }
  });
  writeJson(path.join(benchmarkDir, 'cases', 'rr-pipeline-invalid-evidence.json'), {
    ...baseCase,
    id: 'rr-pipeline-invalid-evidence',
    name: 'Invalid evidence',
    outputs: { resultScreenshot: 'results/result.png' }
  });
  writeJson(path.join(ROOT, 'tmp', 'rr-pipeline-invalid-evidence-result-evidence.json'), {
    success: true,
    caseId: 'rr-pipeline-invalid-evidence',
    manualReviewRequired: false,
    pixelProbe: {
      status: 'ok',
      rawImagesRedacted: true,
      boundary: 'diagnostic only'
    }
  });

  const report = runPipeline(benchmarkDir);
  const noResult = report.cases.find((item) => item.caseId === 'rr-pipeline-no-result');
  const hasResult = report.cases.find((item) => item.caseId === 'rr-pipeline-has-result');
  const unknownSource = report.cases.find((item) => item.caseId === 'rr-pipeline-unknown-source');
  const invalidEvidence = report.cases.find((item) => item.caseId === 'rr-pipeline-invalid-evidence');

  assert(report.success === true, 'pipeline report should succeed for readable cases');
  assert(noResult.stage === 'awaiting_result_screenshot', `unexpected no-result stage: ${noResult.stage}`);
  assert(noResult.commands.captureLive.includes('benchmark:reference-replication:capture-live'), 'no-result case should expose capture-live command');
  assert(noResult.sourceEligibleForQualityClaim === true, 'explicit real source should be source-eligible after missing evidence is completed');
  assert(noResult.qualityClaimCandidate === false, 'case without result evidence must not be a quality candidate yet');
  assert(hasResult.stage === 'awaiting_result_evidence', `unexpected has-result stage: ${hasResult.stage}`);
  assert(hasResult.commands.evaluateResult.includes('benchmark:reference-replication:evaluate-result'), 'has-result case should expose evaluate-result command');
  assert(unknownSource.qualityClaimCandidate === false, 'unknown source must not become quality candidate');
  assert(unknownSource.sourceEligibleForQualityClaim === false, 'unknown source must not be source-eligible');
  assert(unknownSource.warnings.some((item) => item.includes('source kind')), 'unknown source should carry source-kind warning');
  assert(invalidEvidence.stage === 'invalid_result_evidence', `unexpected invalid evidence stage: ${invalidEvidence.stage}`);
  assert(invalidEvidence.blockers.some((item) => item.includes('invalid result evidence report')), 'invalid evidence should be blocked');
  assert(report.policy.doesNotRunPhotoshop === true, 'pipeline report must be read-only');
  assert(report.policy.doesNotMutateCases === true, 'pipeline report must not mutate cases');
  assert(report.qualityClaimGate?.allowedToClaim === false, 'pipeline should expose blocked quality gate for incomplete fixture');
  assert(report.qualityClaimGate?.blockerCount >= 1, 'pipeline should expose quality gate blockers');
  assert(report.qualityClaimGate?.hasValidEvidenceReportBlocker === true, 'pipeline should expose missing valid evidence report blocker');
  assert(report.qualityClaimGate?.hasManualReviewBlocker === true, 'pipeline should expose missing manual review blocker');

  console.log(JSON.stringify({
    ok: true,
    stageCounts: report.stageCounts,
    qualityGateAllowed: report.qualityClaimGate.allowedToClaim,
    noResultNext: noResult.nextAction,
    hasResultNext: hasResult.nextAction
  }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
}
