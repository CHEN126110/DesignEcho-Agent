#!/usr/bin/env node

const { execFileSync } = require('child_process');
const path = require('path');

function run(command, args, cwd) {
  return execFileSync(command, args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim();
}

function repoRoot() {
  return run('git', ['rev-parse', '--show-toplevel'], process.cwd()).replace(/\\/g, '/');
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function main() {
  const root = repoRoot();
  const agentRoot = path.join(root, 'DesignEcho-Agent');
  const report = JSON.parse(run('node', ['scripts/report-reference-replication-readiness.cjs', '--json'], agentRoot));

  assert(report.success === true, 'readiness report should be successful');
  assert(report.suiteReadyForQualityClaim === false, 'current benchmark suite must not be quality-claim ready');
  assert(report.counts.total >= 5, 'current benchmark suite should include the registered seed cases');
  assert(report.counts.withReferenceImage === report.counts.total, 'all registered seed cases should have reference images');
  assert(report.counts.withResultScreenshot === 0, 'current seed cases should not pretend to have result screenshots');
  assert(report.counts.manualVerified === 0, 'current seed cases should not pretend to have manual review');
  assert(report.counts.designQualityEligible === 0, 'no current seed case should be eligible for design-quality claims');
  assert(report.qualityClaimGate?.allowedToClaim === false, 'readiness should expose blocked quality gate');
  assert(report.qualityClaimGate?.blockerCount >= 1, 'readiness should expose quality gate blocker count');
  assert(report.qualityClaimGate?.hasResultScreenshotBlocker === true, 'readiness should expose missing result screenshot blocker');
  assert(report.qualityClaimGate?.hasValidEvidenceReportBlocker === true, 'readiness should expose missing valid evidence report blocker');
  assert(report.qualityClaimGate?.hasManualReviewBlocker === true, 'readiness should expose missing manual review blocker');
  assert(report.qualityClaimGate?.hasCompleteScoreBlocker === true, 'readiness should expose missing complete score blocker');

  const fex = report.cases.find((item) => item.id === 'rr-001-fex-certificate-text-layout');
  assert(fex, 'FEX fixture should remain visible as a temporary benchmark case');
  assert(fex.temporaryFex === true, 'FEX case must be marked temporary');
  assert(fex.canClaimDesignQuality === false, 'FEX case must not support design-quality claims');
  assert(fex.warnings.some((item) => item.includes('temporary FEX benchmark')), 'FEX case should expose temporary benchmark warning');

  const neutral = report.cases.find((item) => item.id === 'rr-002-neutral-quality-card-text-layout');
  assert(neutral, 'neutral replacement fixture should be present');
  assert(neutral.readiness === 'reference_only', 'neutral case should remain reference_only until result screenshot and review exist');
  assert(neutral.canClaimDesignQuality === false, 'neutral fixture should not support design-quality claims');

  assert(
    String(report.policy.claimBoundary || '').includes('non-synthetic, non-FEX'),
    'claim boundary must explicitly block synthetic/FEX quality claims'
  );
  assert(
    String(report.policy.pixelProbeBoundary || '').includes('diagnostic'),
    'pixel-probe boundary must remain diagnostic'
  );

  console.log(JSON.stringify({
    success: true,
    suiteReadyForQualityClaim: report.suiteReadyForQualityClaim,
    qualityGateAllowed: report.qualityClaimGate.allowedToClaim,
    counts: report.counts,
    readinessCounts: report.readinessCounts,
    checkedCases: [fex.id, neutral.id]
  }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(error.message || error);
  process.exit(1);
}
