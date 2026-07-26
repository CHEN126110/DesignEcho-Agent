#!/usr/bin/env node

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = process.cwd();
const tmpDir = path.join(root, 'tmp', 'reference-status-smoke');

function run(args = []) {
  const output = execFileSync('node', ['scripts/report-reference-replication-status.cjs', '--json', ...args], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 64 * 1024 * 1024
  });
  return JSON.parse(output);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

const report = run();

assert(report.success === true, 'status report should succeed');
assert(report.policy.readOnly === true, 'status report must be read-only');
assert(report.policy.doesNotRunPhotoshop === true, 'status report must not run Photoshop');
assert(report.policy.doesNotCallModel === true, 'status report must not call a model');
assert(report.policy.doesNotMutateCases === true, 'status report must not mutate cases');
assert(report.conclusion.designQualityClaimAllowed === false, 'current suite must not allow quality claims');
assert(report.conclusion.qualityClaimCandidates === 0, 'current suite should have zero quality candidates');
assert(report.conclusion.sourceEligibleForQualityClaimCases === 0, 'current suite should have zero source-eligible quality cases');
assert(report.conclusion.explicitRealSourceCases === 0, 'current suite should have zero explicit real-source cases');
assert(report.conclusion.sourceCounts['synthetic-fixture'] >= 1, 'status should expose sourceCounts for synthetic fixtures');
assert(report.qualityClaimGate?.blockerCount >= 1, 'status should expose quality gate blocker count');
assert(report.qualityClaimGate?.hasResultScreenshotBlocker === true, 'status should expose missing result screenshot blocker');
assert(report.qualityClaimGate?.hasValidEvidenceReportBlocker === true, 'status should expose missing valid evidence report blocker');
assert(report.qualityClaimGate?.hasManualReviewBlocker === true, 'status should expose missing manual review blocker');
assert(report.qualityClaimGate?.hasCompleteScoreBlocker === true, 'status should expose missing complete score blocker');
assert((report.evidence.pipeline.cases || []).every((item) => item.sourceEligibleForQualityClaim === false), 'current pipeline cases should not be source-eligible');
assert(report.nextActions.some((item) => item.kind === 'quality-boundary'), 'status should include quality-boundary action');
assert(report.nextActions.some((item) => item.kind === 'add-real-commercial-case'), 'status should suggest adding a real commercial case');
assert(report.nextActions.some((item) => item.kind === 'capture-mechanism-evidence'), 'status should suggest capture mechanism evidence');
const realCaseAction = report.nextActions.find((item) => item.kind === 'add-real-commercial-case');
assert(realCaseAction.evidenceChain?.cannotClaimFromIntakeOnly === true, 'real-case intake action must say intake alone cannot claim quality');
assert(realCaseAction.evidenceChain?.requiredOrder?.includes('benchmark:reference-replication:validate-evidence'), 'real-case intake action must include validate-evidence follow-up');
assert(realCaseAction.evidenceChain?.requiredOrder?.includes('benchmark:reference-replication:record-result with manual scores'), 'real-case intake action must include manual score recording follow-up');
assert(realCaseAction.evidenceChain?.requiredOrder?.includes('maintenance:reference-quality-gate'), 'real-case intake action must include quality gate follow-up');
assert(!JSON.stringify(report).includes('已完成高保真复刻'), 'status report must not overclaim completion');

fs.rmSync(tmpDir, { recursive: true, force: true });
const benchmarkDir = path.join(tmpDir, 'benchmark');
fs.mkdirSync(path.join(benchmarkDir, 'assets'), { recursive: true });
fs.mkdirSync(path.join(benchmarkDir, 'results'), { recursive: true });
fs.mkdirSync(path.join(benchmarkDir, 'cases'), { recursive: true });
fs.writeFileSync(path.join(benchmarkDir, 'assets', 'real-ref.png'), 'fake-reference', 'utf8');
fs.writeFileSync(path.join(benchmarkDir, 'results', 'real-result.png'), 'fake-result', 'utf8');
writeJson(path.join(benchmarkDir, 'cases.manifest.json'), {
  suite: 'reference-replication',
  cases: [
    {
      id: 'rr-status-real-incomplete',
      name: 'Real source incomplete',
      status: 'reference_captured',
      file: 'cases/rr-status-real-incomplete.json'
    },
    {
      id: 'rr-status-real-complete',
      name: 'Real source complete',
      status: 'reviewed',
      file: 'cases/rr-status-real-complete.json'
    }
  ]
});
const baseCase = {
  referenceImage: { path: 'assets/real-ref.png' },
  scenario: {
    category: 'poster-layout',
    source: { providedBy: 'real-commercial-reference' },
    canvas: { width: 120, height: 80 }
  },
  expectedElements: [
    { id: 'title', kind: 'text', role: 'headline', expectedBox: { x: 10, y: 10, width: 80, height: 20 } }
  ],
  acceptance: {
    requiredEvidence: ['editable-text-layers', 'bounds-qa', 'screenshot-pixel-probe', 'manual-review']
  }
};
writeJson(path.join(benchmarkDir, 'cases', 'rr-status-real-incomplete.json'), {
  ...baseCase,
  id: 'rr-status-real-incomplete',
  name: 'Real source incomplete',
  outputs: { resultScreenshot: '' },
  verification: { buildVerified: false, manualVerified: false },
  score: { structure: null, placement: null, textHierarchy: null, editability: null, overall: null }
});
writeJson(path.join(benchmarkDir, 'cases', 'rr-status-real-complete.json'), {
  ...baseCase,
  id: 'rr-status-real-complete',
  name: 'Real source complete',
  outputs: { resultScreenshot: 'results/real-result.png' },
  verification: { buildVerified: true, manualVerified: true, reviewedAt: '2026-05-12T00:00:00.000Z' },
  score: { structure: 0.9, placement: 0.9, textHierarchy: 0.9, editability: 0.9, overall: 0.9 }
});
writeJson(path.join(root, 'tmp', 'rr-status-real-complete-result-evidence.json'), {
  success: true,
  caseId: 'rr-status-real-complete',
  referenceImage: {
    relativePath: 'assets/real-ref.png'
  },
  resultScreenshot: {
    absolutePath: path.join(benchmarkDir, 'results', 'real-result.png'),
    normalizedSnapshotPath: path.join(root, 'tmp', 'rr-status-real-complete-normalized.png')
  },
  manualReviewRequired: true,
  qualityClaimCandidateAfterManualReview: true,
  commands: {
    recordResultAfterManualReview: 'npm run benchmark:reference-replication:record-result -- --id rr-status-real-complete'
  },
  pixelProbe: {
    status: 'ok',
    rawImagesRedacted: true,
    boundary: 'Pixel probe is diagnostic evidence only, not high-fidelity aesthetic acceptance.'
  }
});
const fixtureReport = run(['--benchmark-dir', benchmarkDir]);
assert(fixtureReport.conclusion.designQualityClaimAllowed === true, 'fixture suite with one complete real case should allow quality claims');
assert(fixtureReport.qualityClaimGate?.allowedToClaim === true, 'fixture status should expose quality gate allowed state');
assert(fixtureReport.qualityClaimGate?.blockerCount === 0, 'fixture status should expose zero blockers when claims are allowed');
assert(fixtureReport.conclusion.sourceEligibleForQualityClaimCases === 2, 'both real-source fixture cases should be source-eligible');
assert(fixtureReport.conclusion.qualityClaimCandidates === 1, 'only complete real-source fixture case should be a quality candidate');
assert(fixtureReport.evidence.pipeline.cases.find((item) => item.caseId === 'rr-status-real-incomplete')?.qualityClaimCandidate === false, 'incomplete real-source case must not be quality candidate');
assert(fixtureReport.evidence.pipeline.cases.find((item) => item.caseId === 'rr-status-real-complete')?.qualityClaimCandidate === true, 'complete real-source case should be quality candidate');

console.log(JSON.stringify({
  success: true,
  checks: [
    'status report is read-only',
    'status report combines readiness pipeline and quality gate',
    'current suite is not quality-claim-ready',
    'status report separates source eligibility from quality candidate status',
    'status report exposes structured quality gate blockers',
    'status report exposes explicit real-source case counts',
    'fixture status report allows claims only for complete real-source evidence',
    'next actions include quality boundary real case intake and capture evidence',
    'real-case intake next action includes the required evidence-chain order',
    'status report does not overclaim completion'
  ]
}, null, 2));
