#!/usr/bin/env node

require('ts-node').register({
  transpileOnly: true,
  compilerOptions: {
    target: 'ES2020',
    module: 'CommonJS',
    moduleResolution: 'node',
    esModuleInterop: true,
    skipLibCheck: true
  }
});

const fs = require('fs');
const path = require('path');
const {
  normalizeImageGenerationResultFormat
} = require('../src/shared/image-generation-result-format.ts');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function main() {
  assert(normalizeImageGenerationResultFormat('jpeg') === 'jpeg', 'jpeg should remain jpeg');
  assert(normalizeImageGenerationResultFormat('jpg') === 'jpeg', 'jpg should normalize to jpeg');
  assert(normalizeImageGenerationResultFormat('image/png') === 'png', 'PNG MIME type should normalize to png');
  assert(normalizeImageGenerationResultFormat('tiff') === null, 'unsupported formats should require PNG transcoding');

  const handlerPath = path.join(__dirname, '..', 'src', 'main', 'uxp-handlers', 'image-to-image-handlers.ts');
  const handlerSource = fs.readFileSync(handlerPath, 'utf8');
  assert(handlerSource.includes('outputFormat,'), 'image-to-image response metadata should include the real output format');
  assert(
    handlerSource.includes('persistImageToTempFile(persistedImageBuffer, outputFormat)'),
    'persisted result extension should match the normalized output format'
  );

  console.log(JSON.stringify({
    success: true,
    checks: [
      'JPEG/JPG/PNG formats normalize consistently',
      'unsupported provider formats fall back to PNG transcoding',
      'image-to-image result metadata carries its real persisted format'
    ]
  }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(JSON.stringify({
    success: false,
    error: error && error.message ? error.message : String(error)
  }, null, 2));
  process.exit(1);
}
