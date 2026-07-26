#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SMOKE_DIR = path.join(ROOT, 'tmp', 'reference-result-evidence-smoke');
const BENCHMARK_DIR = path.join(SMOKE_DIR, 'benchmark');
const EVIDENCE_JSON = path.join(SMOKE_DIR, 'evidence.json');
const BLOCKED_EVIDENCE_JSON = path.join(SMOKE_DIR, 'blocked-evidence.json');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function runNode(args, options = {}) {
  return execFileSync(process.execPath, args, {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    stdio: options.stdio || ['ignore', 'pipe', 'pipe']
  });
}

function main() {
  runNode([path.join(ROOT, 'scripts', 'smoke-reference-result-evidence.cjs')]);
  const output = runNode([
    path.join(ROOT, 'scripts', 'validate-reference-result-evidence.cjs'),
    '--benchmark-dir', BENCHMARK_DIR,
    '--evidence-json', EVIDENCE_JSON
  ]);
  const parsed = JSON.parse(output);
  assert(parsed.ok === true, 'expected valid evidence report to pass');
  assert(parsed.manualReviewRequired === true, 'manual review must remain required');

  const blockedOutput = runNode([
    path.join(ROOT, 'scripts', 'validate-reference-result-evidence.cjs'),
    '--benchmark-dir', BENCHMARK_DIR,
    '--evidence-json', BLOCKED_EVIDENCE_JSON
  ]);
  const blockedParsed = JSON.parse(blockedOutput);
  assert(blockedParsed.ok === true, 'expected blocked-source evidence to pass while remaining non-candidate');
  assert(blockedParsed.qualityClaimCandidateAfterManualReview === false, 'unknown source evidence must remain non-candidate');

  const tamperedBlockedPath = path.join(SMOKE_DIR, 'tampered-blocked-evidence.json');
  const tamperedBlocked = JSON.parse(fs.readFileSync(BLOCKED_EVIDENCE_JSON, 'utf8'));
  tamperedBlocked.qualityClaimCandidateAfterManualReview = true;
  fs.writeFileSync(tamperedBlockedPath, `${JSON.stringify(tamperedBlocked, null, 2)}\n`, 'utf8');

  let blockedCandidateRejected = false;
  try {
    runNode([
      path.join(ROOT, 'scripts', 'validate-reference-result-evidence.cjs'),
      '--benchmark-dir', BENCHMARK_DIR,
      '--evidence-json', tamperedBlockedPath
    ]);
  } catch (error) {
    blockedCandidateRejected = /qualityClaimCandidateAfterManualReview/.test(String(error.stdout || error.stderr || error.message || error));
  }
  assert(blockedCandidateRejected, 'tampered unknown-source quality candidate should fail');

  const tamperedPath = path.join(SMOKE_DIR, 'tampered-evidence.json');
  const tampered = JSON.parse(fs.readFileSync(EVIDENCE_JSON, 'utf8'));
  tampered.manualReviewRequired = false;
  fs.writeFileSync(tamperedPath, `${JSON.stringify(tampered, null, 2)}\n`, 'utf8');

  let failedAsExpected = false;
  try {
    runNode([
      path.join(ROOT, 'scripts', 'validate-reference-result-evidence.cjs'),
      '--benchmark-dir', BENCHMARK_DIR,
      '--evidence-json', tamperedPath
    ]);
  } catch (error) {
    failedAsExpected = /manualReviewRequired/.test(String(error.stdout || error.stderr || error.message || error));
  }
  assert(failedAsExpected, 'tampered evidence without manualReviewRequired should fail');

  console.log(JSON.stringify({
    ok: true,
    caseId: parsed.caseId,
    pixelProbeStatus: parsed.pixelProbeStatus,
    tamperRejected: failedAsExpected,
    blockedCandidateRejected
  }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
}
