#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

function assert(condition, message, details = {}) {
  if (!condition) {
    const error = new Error(message);
    error.details = details;
    throw error;
  }
}

function readText(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function main() {
  const scriptPath = path.join(root, 'scripts', 'smoke-main-image-uxp-toolchain-live.cjs');
  const packageJson = JSON.parse(readText('package.json'));

  assert(fs.existsSync(scriptPath), 'live disposable toolchain smoke script must exist', { scriptPath });
  const source = fs.readFileSync(scriptPath, 'utf8');

  const requiredSnippets = [
    'DESIGNECHO_LIVE_MAIN_IMAGE_UXP_TOOLCHAIN',
    'DESIGNECHO_LIVE_MAIN_IMAGE_UXP_TOOLCHAIN_DISPOSABLE_DOCUMENT',
    'writeSkippedReport',
    'writePreflightReport',
    'buildLocalUxpBundleDiagnostics',
    'runtimeMismatchLikely',
    'manifestMain',
    'bundleToolPresence',
    'createDocument',
    'createGroup',
    'moveLayerToGroup',
    'exportGroup',
    'getLayerHierarchy',
    'getLayerProperties',
    'closeDocument',
    'no design quality claim',
    'does not validate main-image design quality'
  ];
  for (const snippet of requiredSnippets) {
    assert(source.includes(snippet), `live smoke script must include ${snippet}`);
  }

  assert(
    packageJson.scripts?.['smoke:main-image:uxp-toolchain-live'] === 'node scripts/smoke-main-image-uxp-toolchain-live.cjs',
    'package script smoke:main-image:uxp-toolchain-live must point at live smoke'
  );
  assert(
    packageJson.scripts?.['smoke:main-image:uxp-toolchain-live:contract'] === 'node scripts/smoke-main-image-uxp-toolchain-live-contract.cjs',
    'package script smoke:main-image:uxp-toolchain-live:contract must point at contract smoke'
  );

  console.log(JSON.stringify({
    success: true,
    checks: [
      'live smoke script exists',
      'live smoke is guarded by explicit disposable-document flags',
      'live smoke covers moveLayerToGroup and exportGroup',
      'live smoke records readback and cleanup record',
      'live smoke keeps no-quality-claim boundary'
    ]
  }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(JSON.stringify({
    success: false,
    error: error.message,
    details: error.details || null
  }, null, 2));
  process.exit(1);
}
