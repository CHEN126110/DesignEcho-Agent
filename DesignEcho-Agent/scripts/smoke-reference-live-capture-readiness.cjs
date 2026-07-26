#!/usr/bin/env node

const { execFileSync } = require('child_process');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function runReadiness(extraEnv = {}) {
  const env = { ...process.env, ...extraEnv };
  delete env.DESIGNECHO_LIVE_REFERENCE_REPLICATION_UI;
  delete env.DESIGNECHO_LIVE_REFERENCE_REPLICATION_REAL_PHOTOSHOP;
  delete env.DESIGNECHO_LIVE_REFERENCE_REPLICATION_TAKEOVER;
  const output = execFileSync(process.execPath, [
    path.join(ROOT, 'scripts', 'report-reference-live-capture-readiness.cjs'),
    '--json',
    '--id',
    'rr-002-neutral-quality-card-text-layout'
  ], {
    cwd: ROOT,
    env,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024
  });
  return JSON.parse(output);
}

try {
  const report = runReadiness();
  assert(report.success === true, 'readiness report should succeed');
  assert(report.mode === 'read-only-preflight', 'readiness mode should be read-only-preflight');
  assert(report.readyForLiveCapture === false, 'default readiness should be blocked without explicit live flags');
  assert(report.defaultSafe === true, 'readiness report should be default-safe');
  assert(report.doesNotCallModel === true, 'readiness report must not call models');
  assert(report.doesNotTouchPhotoshop === true, 'readiness report must not touch Photoshop');
  assert(report.doesNotWriteScreenshot === true, 'readiness report must not write screenshots');
  assert(report.benchmarkCase.caseId === 'rr-002-neutral-quality-card-text-layout', 'case id should be preserved');
  assert(report.benchmarkCase.referenceImageExists === true, 'default neutral reference image should exist');
  assert(report.blockers.some((item) => item.includes('DESIGNECHO_LIVE_REFERENCE_REPLICATION_UI=1')), 'missing live UI flag blocker should be visible');
  assert(report.blockers.some((item) => item.includes('DESIGNECHO_LIVE_REFERENCE_REPLICATION_REAL_PHOTOSHOP=1')), 'missing real Photoshop flag blocker should be visible');
  assert(report.blockers.some((item) => item.includes('DESIGNECHO_LIVE_REFERENCE_REPLICATION_TAKEOVER=1')), 'missing takeover flag blocker should be visible');
  assert(report.commands.runWhenReady.includes('benchmark:reference-replication:capture-live'), 'run command should be visible');

  console.log(JSON.stringify({
    success: true,
    readyForLiveCapture: report.readyForLiveCapture,
    blockerCount: report.blockers.length,
    defaultSafe: report.defaultSafe
  }, null, 2));
} catch (error) {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
}
