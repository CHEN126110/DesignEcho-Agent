#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const OUT_PATH = path.join(ROOT, 'tmp', 'reference-live-capture-guard-result.png');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function runGuard() {
  fs.rmSync(OUT_PATH, { force: true });
  const env = { ...process.env };
  delete env.DESIGNECHO_LIVE_REFERENCE_REPLICATION_UI;
  delete env.DESIGNECHO_LIVE_REFERENCE_REPLICATION_REAL_PHOTOSHOP;
  delete env.DESIGNECHO_LIVE_REFERENCE_REPLICATION_TAKEOVER;
  delete env.DESIGNECHO_LIVE_REFERENCE_REPLICATION_CAPTURE_RESULT;

  const output = execFileSync(process.execPath, [
    path.join(ROOT, 'scripts', 'smoke-chat-ui-reference-replication-live.cjs'),
    '--id', 'rr-002-neutral-quality-card-text-layout',
    '--capture-result',
    '--result-screenshot', OUT_PATH
  ], {
    cwd: ROOT,
    env,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024
  });

  const parsed = JSON.parse(output);
  assert(parsed.success === true, 'guard run should succeed without live execution');
  assert(parsed.skipped === true, 'guard run should be skipped by default');
  assert(parsed.mode === 'guarded-default', `unexpected mode: ${parsed.mode}`);
  assert(parsed.caseId === 'rr-002-neutral-quality-card-text-layout', 'case id should be preserved in guard output');
  assert(parsed.captureRequested === true, 'capture request should be visible in guard output');
  assert(!fs.existsSync(OUT_PATH), 'guard run must not write a result screenshot');

  return parsed;
}

try {
  const result = runGuard();
  console.log(JSON.stringify({
    ok: true,
    mode: result.mode,
    caseId: result.caseId,
    captureRequested: result.captureRequested,
    screenshotWritten: fs.existsSync(OUT_PATH)
  }, null, 2));
} catch (error) {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
}
