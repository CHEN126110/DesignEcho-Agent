#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const outDir = path.join(root, 'tmp', 'image-safety-smoke');
const tscScript = path.join(root, 'node_modules', 'typescript', 'bin', 'tsc');

function runTsc() {
  fs.rmSync(outDir, { recursive: true, force: true });
  execFileSync(process.execPath, [
    tscScript,
    'src/core/image-safety.ts',
    '--target', 'ES2020',
    '--module', 'commonjs',
    '--outDir', outDir,
    '--skipLibCheck'
  ], {
    cwd: root,
    stdio: 'pipe'
  });
}

function assert(condition, message, details) {
  if (!condition) {
    const error = new Error(message);
    error.details = details;
    throw error;
  }
}

function main() {
  runTsc();
  const {
    resolveImageResultFormatHint,
    validateImageBytesForPhotoshop
  } = require(path.join(outDir, 'image-safety.js'));

  const validPng = fs.readFileSync(path.join(root, 'icons', 'dark.png'));
  const truncatedPng = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0x01, 0x02, 0x03
  ]);
  const brokenJpeg = Buffer.from([0xff, 0xd8, 0x00, 0x01, 0x02]);
  const minimalValidJpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);

  const validPngResult = validateImageBytesForPhotoshop(validPng, { sourceLabel: 'valid png' });
  const truncatedPngResult = validateImageBytesForPhotoshop(truncatedPng, { sourceLabel: 'truncated png' });
  const brokenJpegResult = validateImageBytesForPhotoshop(brokenJpeg, { sourceLabel: 'broken jpg' });
  const mismatchedHintResult = validateImageBytesForPhotoshop(minimalValidJpeg, {
    formatHint: 'png',
    sourceLabel: 'valid jpeg with stale hint'
  });
  const jpegPathFormat = resolveImageResultFormatHint({
    declaredFormat: 'png',
    filePath: 'C:/temp/image-to-image-result.jpeg',
    fallbackFormat: 'png'
  });

  assert(validPngResult.ok, 'valid PNG should pass preflight', validPngResult);
  assert(!truncatedPngResult.ok, 'truncated PNG should be rejected before Photoshop', truncatedPngResult);
  assert(!brokenJpegResult.ok, 'broken JPEG should be rejected before Photoshop', brokenJpegResult);
  assert(
    mismatchedHintResult.ok && mismatchedHintResult.format === 'jpeg',
    'real JPEG bytes should override a stale PNG format hint',
    mismatchedHintResult
  );
  assert(jpegPathFormat === 'jpeg', 'result file extension should override stale metadata for file-backed placement');

  fs.rmSync(outDir, { recursive: true, force: true });
  console.log(JSON.stringify({
    success: true,
    checks: [
      'valid PNG passes image safety preflight',
      'truncated PNG is rejected before Photoshop placeEvent',
      'broken JPEG is rejected before Photoshop placeEvent',
      'real image bytes override stale format hints',
      'file-backed result format resolves from the actual file extension'
    ]
  }, null, 2));
}

try {
  main();
} catch (error) {
  fs.rmSync(outDir, { recursive: true, force: true });
  console.error(JSON.stringify({
    success: false,
    error: error && error.message ? error.message : String(error),
    details: error && error.details ? error.details : undefined
  }, null, 2));
  process.exit(1);
}
