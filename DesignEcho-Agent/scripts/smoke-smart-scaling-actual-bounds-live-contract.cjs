#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PACKAGE_JSON = path.join(ROOT, 'package.json');
const LIVE_SCRIPT = path.join(ROOT, 'scripts', 'smoke-smart-scaling-actual-bounds-live.cjs');

function assert(condition, message, details) {
  if (!condition) {
    const suffix = details ? `\n${JSON.stringify(details, null, 2)}` : '';
    throw new Error(`${message}${suffix}`);
  }
}

function readText(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function main() {
  const packageJson = JSON.parse(readText(PACKAGE_JSON));
  const scripts = packageJson.scripts || {};

  assert(
    scripts['smoke:smart-scaling:actual-bounds-live'] === 'node scripts/smoke-smart-scaling-actual-bounds-live.cjs',
    'package.json must expose smoke:smart-scaling:actual-bounds-live',
    { actual: scripts['smoke:smart-scaling:actual-bounds-live'] }
  );

  assert(fs.existsSync(LIVE_SCRIPT), 'live actual-bounds smoke script must exist', { LIVE_SCRIPT });

  const source = readText(LIVE_SCRIPT);
  const requiredSnippets = [
    'DOC_PREFIX',
    'createDocument',
    'placeImage',
    'transformLayer',
    'moveLayer',
    'moveLayerToGroup',
    'getLayerProperties',
    'plannedBounds',
    'actualBounds',
    'maxAbsDeviation',
    'failurePathResults',
    'expectedFailure',
    'tolerancePx',
    'noDesignQualityClaim',
    'cleanup.closeDisposableWithoutSaving'
  ];

  for (const snippet of requiredSnippets) {
    assert(source.includes(snippet), `live actual-bounds smoke must contain ${snippet}`);
  }

  assert(
    /closeDocument[\s\S]*save:\s*false/.test(source),
    'live actual-bounds smoke must close disposable document without saving'
  );
  assert(
    /DesignEchoSmartScalingActualBoundsLive/.test(source),
    'live actual-bounds smoke must use a clearly disposable document prefix'
  );
  assert(
    !/canClaimDesignComplete:\s*true/.test(source) && !/canClaimOutputQuality:\s*true/.test(source),
    'actual-bounds smoke must not claim design completion or visual quality'
  );

  console.log(JSON.stringify({
    success: true,
    checks: [
      'package script is registered',
      'live script exists',
      'live script uses disposable document prefix',
      'live script writes place/transform/move/readback evidence',
      'live script compares plannedBounds and actualBounds',
      'live script closes disposable document without saving',
      'live script does not claim design quality'
    ]
  }, null, 2));
}

main();
