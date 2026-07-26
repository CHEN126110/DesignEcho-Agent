#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const sourcePath = path.join(root, 'src', 'tools', 'image', 'inpainting.ts');
const entrySourcePath = path.join(root, 'src', 'index.ts');

function assert(condition, message, details) {
  if (!condition) {
    const error = new Error(message);
    error.details = details;
    throw error;
  }
}

function main() {
  const source = fs.readFileSync(sourcePath, 'utf8');
  const entrySource = fs.readFileSync(entrySourcePath, 'utf8');
  const classStart = source.indexOf('export class ApplyRasterImageResultTool');
  assert(classStart >= 0, 'ApplyRasterImageResultTool should exist');
  const classBody = source.slice(classStart);

  const importChecks = [
    'assertImageBytesSafeForPhotoshop',
    'bytesFromBase64ImagePayload',
    'readFileEntryBytes',
    'arrayBufferFromBytes'
  ];

  for (const symbol of importChecks) {
    assert(
      source.includes(symbol),
      `ApplyRasterImageResultTool should use ${symbol} from image-safety before Photoshop placeEvent`
    );
  }

  assert(
    source.includes("from '../../core/image-safety'"),
    'ApplyRasterImageResultTool should import shared image-safety helpers'
  );
  assert(
    !classBody.includes('atob('),
    'ApplyRasterImageResultTool should not manually decode base64 because it bypasses shared image safety'
  );
  assert(
    classBody.includes('readFileEntryBytes(fileEntry, storage)'),
    'ApplyRasterImageResultTool should preflight filePath bytes before createSessionToken/placeEvent'
  );
  assert(
    classBody.includes('bytesFromBase64ImagePayload(params.imageData'),
    'ApplyRasterImageResultTool should decode base64 through shared image safety helper'
  );
  assert(
    classBody.includes('assertImageBytesSafeForPhotoshop(bytes'),
    'ApplyRasterImageResultTool should validate encoded bytes before temp write/placeEvent'
  );
  assert(
    classBody.includes('arrayBufferFromBytes(bytes'),
    'ApplyRasterImageResultTool should write temporary encoded bytes through shared ArrayBuffer helper'
  );
  assert(
    source.includes('function buildSelectionReadDescriptor'),
    'selection reads should use a shared no-dialog descriptor helper'
  );
  assert(
    source.includes("dialogOptions: 'dontDisplay'"),
    'selection read descriptors should suppress Photoshop native dialogs'
  );
  assert(
    source.includes('READ_ONLY_SELECTION_BATCH_PLAY_OPTIONS'),
    'selection reads should use shared synchronous read-only batchPlay options'
  );
  assert(
    entrySource.includes('normalizedPayload.image.length > 0 || normalizedPayload.imageFromBinary'),
    'inpainting request validation should accept image payloads sent through the binary transport'
  );
  assert(
    entrySource.includes('normalizedPayload.mask.length > 0 || normalizedPayload.maskFromBinary'),
    'inpainting request validation should accept mask payloads sent through the binary transport'
  );
  assert(
    !entrySource.includes('if (!normalizedPayload.image || !normalizedPayload.mask)'),
    'inpainting request validation should not reject intentionally emptied inline fields after binary upload'
  );
  assert(
    classBody.includes("writeMode: 'new-layer'") && classBody.includes('sourceDocumentPreserved: true'),
    'inpainting writeback should explicitly report non-destructive new-layer behavior'
  );

  console.log(JSON.stringify({
    success: true,
    checks: [
      'ApplyRasterImageResultTool imports shared image-safety helpers',
      'filePath encoded image results are preflighted before Photoshop placeEvent',
      'base64 encoded image results are decoded and validated through shared image-safety',
      'manual atob decoding is not used in ApplyRasterImageResultTool',
      'selection reads use shared no-dialog batchPlay descriptors',
      'binary inpainting image and mask transports pass request validation',
      'writeback reports non-destructive new-layer behavior'
    ]
  }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(JSON.stringify({
    success: false,
    error: error && error.message ? error.message : String(error),
    details: error && error.details ? error.details : undefined
  }, null, 2));
  process.exit(1);
}
