/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const RUNNER = path.join(ROOT, 'scripts', 'run-photoshop-live-tool-smokes.cjs');

function assert(condition, message, details = null) {
  if (!condition) {
    const suffix = details ? `\n${JSON.stringify(details, null, 2)}` : '';
    throw new Error(`${message}${suffix}`);
  }
}

function main() {
  const packageJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert(
    packageJson.scripts?.['smoke:photoshop-live-tools:serial'] === 'node scripts/run-photoshop-live-tool-smokes.cjs',
    'package script smoke:photoshop-live-tools:serial must point at the serial live Photoshop tool runner.'
  );
  assert(
    packageJson.scripts?.['smoke:photoshop-live-tools:serial:contract'] === 'node scripts/smoke-photoshop-live-tool-smokes-contract.cjs',
    'package script smoke:photoshop-live-tools:serial:contract must point at this contract smoke.'
  );
  assert(fs.existsSync(RUNNER), 'serial live Photoshop tool runner is missing.', { RUNNER });

  const source = fs.readFileSync(RUNNER, 'utf8');
  assert(source.includes('LIVE_TOOL_SMOKES'), 'runner must keep an explicit LIVE_TOOL_SMOKES manifest.');
  assert(
    source.includes("script: 'maintenance:photoshop-bridge-health:check:runtime'"),
    'runner bridge health task must require current UXP runtime safety features before live smokes.'
  );
  assert(
    packageJson.scripts?.['maintenance:photoshop-bridge-health:check:runtime']?.includes('createDocument.readbackCandidateValidation'),
    'runtime health gate must require createDocument readback candidate validation before live Photoshop smokes.'
  );
  assert(
    packageJson.scripts?.['maintenance:photoshop-bridge-health:check:runtime']?.includes('toolErrorNormalizer.fontUnavailableCategory'),
    'runtime health gate must require font unavailable categorization before live Photoshop smokes.'
  );
  assert(
    packageJson.scripts?.['maintenance:photoshop-bridge-health:check:runtime']?.includes('saveDocument.rasterExportUsesJsx'),
    'runtime health gate must require JSX raster export before live Photoshop smokes.'
  );
  assert(source.includes('REPORT_JSON'), 'runner must write a JSON usage report.');
  assert(source.includes('REPORT_MD'), 'runner must write a Markdown usage report.');
  assert(source.includes('renderMarkdown'), 'runner must render a human-readable usage report.');
  assert(source.includes('writeReport'), 'runner must persist pass/fail usage feedback before exiting.');
  assert(!source.includes('Promise.all('), 'runner must not use Promise.all for live Photoshop tool smokes.');
  assert(!source.includes('runQueue('), 'runner must not route live Photoshop tool smokes through a concurrent queue.');

  const selfTest = spawnSync(process.execPath, [RUNNER, '--self-test'], {
    cwd: ROOT,
    encoding: 'utf8',
    windowsHide: true
  });
  assert(selfTest.status === 0, 'runner self-test must pass without touching Photoshop.', {
    status: selfTest.status,
    stdout: selfTest.stdout,
    stderr: selfTest.stderr
  });

  console.log('smoke-photoshop-live-tool-smokes-contract passed');
}

main();
