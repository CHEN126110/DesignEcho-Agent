#!/usr/bin/env node

const { execFileSync } = require('child_process');
const {
  CHECKED_REFERENCE_QUALITY_GATE_REPORTS
} = require('./lib/reference-quality-gate-consistency.cjs');

function runJson(args) {
  const output = execFileSync('node', args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  return JSON.parse(output);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function gateFromBlockers(gate) {
  const blockers = Array.isArray(gate?.blockers) ? gate.blockers : [];
  return {
    allowedToClaim: Boolean(gate?.allowedToClaim),
    blockerCount: Number(gate?.blockerCount ?? blockers.length),
    hasExplicitRealSourceBlocker: gate?.hasExplicitRealSourceBlocker ?? blockers.some((item) => item.includes('explicit real-source cases')),
    hasResultScreenshotBlocker: gate?.hasResultScreenshotBlocker ?? blockers.includes('no real result screenshot evidence recorded'),
    hasValidEvidenceReportBlocker: gate?.hasValidEvidenceReportBlocker ?? blockers.includes('no valid result evidence report recorded'),
    hasBuildVerificationBlocker: gate?.hasBuildVerificationBlocker ?? blockers.includes('no build/execution verification recorded'),
    hasManualReviewBlocker: gate?.hasManualReviewBlocker ?? blockers.includes('no manual review recorded'),
    hasCompleteScoreBlocker: gate?.hasCompleteScoreBlocker ?? blockers.includes('no complete 0..1 score set recorded')
  };
}

function assertSameGate(label, actual, expected) {
  for (const [key, expectedValue] of Object.entries(expected)) {
    assert(
      actual[key] === expectedValue,
      `${label}.${key} should equal ${expectedValue}, got ${actual[key]}`
    );
  }
}

const readiness = runJson(['scripts/report-reference-replication-readiness.cjs', '--json']);
const pipeline = runJson(['scripts/report-reference-evidence-pipeline.cjs', '--json']);
const status = runJson(['scripts/report-reference-replication-status.cjs', '--json']);
const cockpit = runJson(['scripts/report-project-cockpit.cjs', '--json', '--limit', '3']);
const architecture = runJson(['scripts/report-agent-architecture.cjs', '--json']);
const qualityGate = runJson(['scripts/check-reference-quality-claim-gate.cjs', '--json']);

const canonical = gateFromBlockers(qualityGate.gate);
const reports = {
  readiness: gateFromBlockers(readiness.qualityClaimGate),
  pipeline: gateFromBlockers(pipeline.qualityClaimGate),
  status: gateFromBlockers(status.qualityClaimGate),
  cockpit: gateFromBlockers(cockpit.referenceReplication?.qualityClaimGate),
  architecture: gateFromBlockers(architecture.referenceQualityClaimGate)
};

const consistencyReports = {
  readiness: readiness.qualityGateConsistency,
  pipeline: pipeline.qualityGateConsistency,
  status: status.qualityGateConsistency,
  cockpit: cockpit.referenceReplication?.qualityGateConsistency,
  architecture: architecture.referenceQualityGateConsistency
};

assert(canonical.allowedToClaim === false, 'current benchmark suite should remain quality-claim blocked');
assert(canonical.blockerCount >= 1, 'canonical gate should expose at least one blocker');
assert(canonical.hasResultScreenshotBlocker === true, 'canonical gate should expose missing result screenshot blocker');
assert(canonical.hasManualReviewBlocker === true, 'canonical gate should expose missing manual review blocker');

for (const [label, gate] of Object.entries(reports)) {
  assertSameGate(label, gate, canonical);
}

for (const [label, consistency] of Object.entries(consistencyReports)) {
  assert(consistency?.smokeAvailable === true, `${label}.qualityGateConsistency.smokeAvailable should be true`);
  assert(consistency?.smokeInPreflight === true, `${label}.qualityGateConsistency.smokeInPreflight should be true`);
  for (const reportName of CHECKED_REFERENCE_QUALITY_GATE_REPORTS) {
    const key = `checks${reportName[0].toUpperCase()}${reportName.slice(1)}`;
    assert(consistency?.[key] === true, `${label}.qualityGateConsistency.${key} should be true`);
  }
}

console.log(JSON.stringify({
  success: true,
  canonical,
  checkedReports: Object.keys(reports),
  consistencyMetadataReports: Object.keys(consistencyReports)
}, null, 2));
