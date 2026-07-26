#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const sourcePath = path.join(root, 'src', 'tools', 'image', 'place-image.ts');

function assert(condition, message, details) {
  if (!condition) {
    const error = new Error(message);
    error.details = details;
    throw error;
  }
}

function main() {
  const source = fs.readFileSync(sourcePath, 'utf8');

  assert(
    source.includes('export class PlaceImageTool'),
    'PlaceImageTool should exist'
  );
  assert(
    source.includes('createToolFailureResult'),
    'PlaceImageTool should return normalized tool failure payloads'
  );
  assert(
    !source.includes("modalBehavior: 'fail'"),
    'PlaceImageTool must not pass modalBehavior fail inside executeAsModal scopes'
  );
  assert(
    source.includes('synchronousExecution: true'),
    'PlaceImageTool batchPlay calls should use synchronous execution inside executeAsModal'
  );
  assert(
    source.includes("dialogOptions: 'dontDisplay'"),
    'PlaceImageTool batchPlay descriptors should suppress Photoshop native dialogs'
  );
  assert(
    source.includes('translateLayerWithoutNativeMove') && source.includes('.translate('),
    'PlaceImageTool should position placed layers with DOM translate'
  );
  assert(
    !/_obj:\s*['"]move['"]/.test(source),
    'PlaceImageTool must not call Photoshop native move because it can trigger availability popups'
  );
  assert(
    !source.includes('error.message || error'),
    'PlaceImageTool must not collapse structured Photoshop errors into raw error.message'
  );
  assert(
    source.includes('popupPrevented'),
    'PlaceImageTool should preserve popup-prevention diagnostics for failed placement'
  );
  assert(
    source.includes('targetBounds') && source.includes('normalizeTargetBounds') && source.includes('fitLayerToTargetBounds'),
    'PlaceImageTool should support targetBounds for layout-aware multi-image placement'
  );
  assert(
    source.includes('transformLayerPercent') && source.includes('targetFit'),
    'PlaceImageTool should scale placed layers into target bounds without Photoshop native move'
  );
  assert(
    source.includes('layerOrder') && source.includes('movePlacedLayerBelowText'),
    'PlaceImageTool should support layerOrder belowText so placed images do not cover editable copy'
  );

  console.log(JSON.stringify({
    success: true,
    checks: [
      'PlaceImageTool uses normalized failures',
      'PlaceImageTool avoids modalBehavior fail inside executeAsModal',
      'PlaceImageTool suppresses native Photoshop dialogs on descriptors',
      'PlaceImageTool avoids Photoshop native move for positioning',
      'PlaceImageTool preserves popup-prevention diagnostics',
      'PlaceImageTool supports targetBounds placement',
      'PlaceImageTool supports below-text image stacking'
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
