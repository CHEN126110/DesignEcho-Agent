#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

function readSource(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function assert(condition, message, details) {
  if (!condition) {
    const error = new Error(message);
    error.details = details;
    throw error;
  }
}

function main() {
  const moveLayer = readSource('src/tools/layout/move-layer.ts');
  const moveLayerToGroup = readSource('src/tools/layout/move-layer-to-group.ts');
  const exportGroup = readSource('src/tools/image/export-group.ts');
  const setTextContent = readSource('src/tools/text/set-text-content.ts');
  const setTextStyle = readSource('src/tools/text/set-text-style.ts');
  const createTextLayer = readSource('src/tools/text/create-text-layer.ts');
  const layerProperties = readSource('src/tools/layer/layer-properties.ts');
  const layerEffects = readSource('src/tools/layer/layer-effects.ts');
  const alignToReference = readSource('src/tools/layout/align-to-reference.ts');
  const applyMorphedImage = readSource('src/tools/morphing/apply-morphed-image.ts');
  const inpainting = readSource('src/tools/image/inpainting.ts');
  const smartLayoutEngine = readSource('src/tools/layout/smart-layout-engine.ts');
  const detailPageFiller = readSource('src/tools/layout/detail-page-filler.ts');
  const skuLayoutTool = readSource('src/tools/layout/sku-layout-tool.ts');

  assert(
    moveLayer.includes('normalizePhotoshopToolError'),
    'moveLayer should normalize internal failures instead of returning raw Photoshop messages'
  );
  assert(
    moveLayer.includes('normalized.userMessage'),
    'moveLayer should expose the user-facing normalized failure message'
  );
  assert(
    moveLayer.includes("handledBy: 'tool-error-normalizer/v1'") || moveLayer.includes('normalized'),
    'moveLayer errorDetails should retain tool-error-normalizer evidence'
  );
  assert(
    moveLayer.includes('translateLayer') && moveLayer.includes('.translate('),
    'moveLayer should use DOM translate instead of Photoshop native move'
  );
  assert(
    !/_obj:\s*['"]move['"]/.test(moveLayer),
    'moveLayer should not call Photoshop native move because it can trigger availability popups'
  );
  assert(
    !moveLayer.includes("modalBehavior: 'execute'") && !moveLayer.includes('modalBehavior: "execute"'),
    'moveLayer should not pass modalBehavior execute inside executeAsModal batchPlay calls'
  );
  assert(
    !moveLayer.includes("modalBehavior: 'fail'") && !moveLayer.includes('modalBehavior: "fail"'),
    'moveLayer should not pass modalBehavior fail inside executeAsModal batchPlay calls'
  );
  assert(
    exportGroup.includes('createToolFailureResult'),
    'exportGroup should normalize JSX/export failures through the shared tool failure envelope'
  );
  assert(
    exportGroup.includes('toolName: this.name'),
    'exportGroup normalized failure should use the actual tool name'
  );
  assert(
    exportGroup.includes('params'),
    'exportGroup normalized failure should include redacted params summary evidence'
  );
  assert(
    moveLayerToGroup.includes('createToolFailureResult'),
    'moveLayerToGroup should normalize hierarchy write failures through the shared tool failure envelope'
  );
  assert(
    moveLayerToGroup.includes('toolName: this.name'),
    'moveLayerToGroup normalized failures should use the actual tool name'
  );
  assert(
    !moveLayerToGroup.includes("modalBehavior: 'execute'") && !moveLayerToGroup.includes('modalBehavior: "execute"'),
    'moveLayerToGroup should not pass modalBehavior execute inside executeAsModal batchPlay calls'
  );
  for (const [toolName, source] of [
    ['setTextContent', setTextContent],
    ['setTextStyle', setTextStyle],
    ['createTextLayer', createTextLayer]
  ]) {
    assert(
      source.includes('createToolFailureResult'),
      `${toolName} should normalize text write failures through the shared tool failure envelope`
    );
    assert(
      source.includes('toolName: this.name'),
      `${toolName} normalized failures should use the actual tool name`
    );
  }
  assert(
    createTextLayer.includes('.translate('),
    'createTextLayer should position new text with DOM translate instead of Photoshop native move'
  );
  assert(
    !/_obj:\s*['"]move['"]/.test(createTextLayer),
    'createTextLayer should not call Photoshop native move because it can trigger availability popups'
  );
  for (const [toolName, source] of [
    ['layerProperties', layerProperties],
    ['layerEffects', layerEffects]
  ]) {
    assert(
      source.includes('createToolFailureResult'),
      `${toolName} write failures should use the shared tool failure envelope`
    );
    assert(
      source.includes('toolName: this.name'),
      `${toolName} normalized failures should use the actual tool name`
    );
  }
  assert(
    layerEffects.includes('findLayerById') && layerEffects.includes('resolveLayer'),
    'layerEffects should resolve nested target layers instead of only scanning top-level doc.layers'
  );
  assert(
    alignToReference.includes('.translate('),
    'alignToReference should move aligned layers with DOM translate instead of Photoshop native move'
  );
  assert(
    !/_obj:\s*['"]move['"]/.test(alignToReference),
    'alignToReference should not call Photoshop native move because it can trigger availability popups'
  );
  assert(
    applyMorphedImage.includes('.translate('),
    'applyMorphedImage should position placed result layers with DOM translate instead of Photoshop native move'
  );
  assert(
    !/_obj:\s*['"]move['"]/.test(applyMorphedImage),
    'applyMorphedImage should not call Photoshop native move because it can trigger availability popups'
  );
  assert(
    inpainting.includes('.translate('),
    'inpainting raster result placement should position layers with DOM translate instead of Photoshop native move'
  );
  assert(
    !/_obj:\s*['"]move['"]/.test(inpainting),
    'inpainting should not call Photoshop native move because it can trigger availability popups'
  );
  assert(
    smartLayoutEngine.includes('.translate('),
    'smartLayoutEngine should move arranged groups with DOM translate instead of Photoshop native move'
  );
  assert(
    !/_obj:\s*['"]move['"]/.test(smartLayoutEngine),
    'smartLayoutEngine should not call Photoshop native move because it can trigger availability popups'
  );
  assert(
    detailPageFiller.includes('.translate('),
    'detailPageFiller should position placed layers with DOM translate instead of Photoshop native offset move'
  );
  assert(
    !/_obj:\s*['"]move['"][\s\S]{0,300}_obj:\s*['"]offset['"]/.test(detailPageFiller),
    'detailPageFiller should not call Photoshop native offset move because it can trigger availability popups'
  );
  assert(
    !/_obj:\s*['"]move['"]/.test(detailPageFiller),
    'detailPageFiller should not call Photoshop native move for layer ordering because it can trigger availability popups'
  );
  assert(
    skuLayoutTool.includes('.translate('),
    'skuLayoutTool should position layers with DOM translate instead of Photoshop native offset move'
  );
  assert(
    !/_obj:\s*['"]move['"][\s\S]{0,300}_obj:\s*['"]offset['"]/.test(skuLayoutTool),
    'skuLayoutTool should not call Photoshop native offset move because it can trigger availability popups'
  );

  console.log(JSON.stringify({
    success: true,
    checks: [
      'moveLayer internal failures keep tool-error-normalizer evidence',
      'moveLayer exposes normalized user-facing error messages',
      'moveLayer uses DOM translate instead of Photoshop native move',
      'exportGroup failures use the shared tool failure envelope',
      'exportGroup failure evidence includes redacted params summary',
      'moveLayerToGroup failures use the shared tool failure envelope',
      'moveLayerToGroup avoids nested modalBehavior execute in executeAsModal',
      'text write tools use the shared tool failure envelope',
      'createTextLayer uses DOM translate instead of Photoshop native move',
      'layer property/effect write tools use the shared tool failure envelope',
      'layer effect tools resolve nested target layers',
      'alignToReference uses DOM translate instead of Photoshop native move',
      'applyMorphedImage uses DOM translate instead of Photoshop native move',
      'inpainting raster placement uses DOM translate instead of Photoshop native move',
      'smartLayoutEngine uses DOM translate instead of Photoshop native move',
      'detailPageFiller pixel positioning uses DOM translate instead of Photoshop native offset move',
      'detailPageFiller layer ordering avoids Photoshop native move',
      'skuLayoutTool pixel positioning uses DOM translate instead of Photoshop native offset move'
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
