#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function readUtf8(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function run() {
  const agentRoot = path.resolve(__dirname, '..');
  const workspaceRoot = path.resolve(agentRoot, '..');
  const uxpRoot = path.join(workspaceRoot, 'DesignEcho-UXP');
  const snapshotSourcePath = path.join(uxpRoot, 'src/tools/canvas/screen-snapshot.ts');
  const webpackConfigPath = path.join(uxpRoot, 'webpack.config.js');

  const snapshotSource = readUtf8(snapshotSourcePath);
  const webpackConfig = readUtf8(webpackConfigPath);

  assert(
    /OVERLAY_SNAPSHOT_TOOL_VERSION\s*=\s*['"]screen-overlay-v2-diagnostic['"]/.test(snapshotSource),
    'Expected overlay snapshot diagnostic tool version to stay explicit.'
  );
  assert(
    snapshotSource.includes('pixel-rgb-imaging-encoder'),
    'Expected overlay snapshot renderer to stay on the pixel RGB Imaging API path.'
  );
  assert(
    /function\s+rgbaToRgb8\s*\(/.test(snapshotSource),
    'Expected RGBA-to-RGB conversion helper to exist.'
  );
  assert(
    /function\s+drawOverlayRectOnRgb\s*\(/.test(snapshotSource),
    'Expected direct RGB overlay drawing helper to exist.'
  );
  assert(
    /async\s+function\s+encodeRgbToBase64\s*\(/.test(snapshotSource),
    'Expected Imaging API encoder helper to exist.'
  );
  assert(
    snapshotSource.includes('imaging.createImageDataFromBuffer') && snapshotSource.includes('imaging.encodeImageData'),
    'Expected overlay snapshot encoding to go through Photoshop Imaging API.'
  );
  assert(
    !/createOverlayCanvas\s*\(/.test(snapshotSource),
    'Overlay snapshot must not depend on the removed createOverlayCanvas path.'
  );
  assert(
    !/document\.createElement\s*\(\s*['"]canvas['"]\s*\)/.test(snapshotSource),
    'Overlay snapshot must not create DOM canvas in UXP runtime.'
  );
  assert(
    !/new\s+OffscreenCanvas\s*\(/.test(snapshotSource),
    'Overlay snapshot must not depend on OffscreenCanvas in UXP runtime.'
  );
  assert(
    !/\.(toDataURL|convertToBlob)\s*\(/.test(snapshotSource),
    'Overlay snapshot must not use browser canvas export APIs.'
  );
  assert(
    /success:\s*snapshots\.length\s*>\s*0/.test(snapshotSource),
    'Screen snapshot tools must fail explicitly when no snapshot is generated.'
  );
  assert(
    /errors:\s*errors\.length\s*>\s*0\s*\?\s*errors\s*:\s*undefined/.test(snapshotSource),
    'Screen snapshot tools must return diagnostic errors when capture fails.'
  );

  assert(
    /entry:\s*{[\s\S]*runtime:\s*['"]\.\/src\/index\.ts['"][\s\S]*index:\s*['"]\.\/src\/index\.ts['"][\s\S]*}/.test(webpackConfig),
    'Expected webpack to emit both runtime and index entry bundles.'
  );
  assert(
    /filename:\s*['"]\[name\]\.js['"]/.test(webpackConfig),
    'Expected webpack output filename to keep entry bundle names stable.'
  );
  assert(
    /splitChunks:\s*false/.test(webpackConfig) && /runtimeChunk:\s*false/.test(webpackConfig),
    'Expected webpack to avoid split/runtime chunks for UXP compatibility.'
  );

  return {
    success: true,
    contract: 'reference-overlay-snapshot',
    checkedFiles: [
      path.relative(workspaceRoot, snapshotSourcePath).replace(/\\/g, '/'),
      path.relative(workspaceRoot, webpackConfigPath).replace(/\\/g, '/')
    ],
    guarantees: [
      'overlay screenshots use direct pixel RGB composition',
      'overlay screenshots encode through Photoshop Imaging API',
      'browser canvas export paths stay out of the UXP runtime',
      'zero-snapshot results fail explicitly with diagnostics',
      'UXP build emits both runtime.js and index.js entry bundles'
    ]
  };
}

try {
  console.log(JSON.stringify(run(), null, 2));
} catch (error) {
  console.error(error.message || error);
  process.exit(1);
}
