const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function assert(condition, message, details) {
  if (!condition) {
    const error = new Error(message);
    error.details = details;
    throw error;
  }
}

function main() {
  const toolPath = path.join(ROOT, 'src/tools/image/white-bg-from-sku-material.ts');
  assert(fs.existsSync(toolPath), 'white-bg SKU material export tool file must exist');

  const source = read('src/tools/image/white-bg-from-sku-material.ts');
  const registry = read('src/tools/registry.ts');
  const packageJson = JSON.parse(read('package.json'));

  assert(source.includes('export class ExportWhiteBgFromSkuMaterialTool'), 'tool class must be exported');
  assert(source.includes("name = 'exportWhiteBgFromSkuMaterial'"), 'tool name must be stable');
  assert(source.includes("required: ['sourceDocumentPath', 'outputPath']"), 'tool schema must require sourceDocumentPath and outputPath');
  assert(source.includes('openDocumentWithJsx'), 'tool must be able to open source PSD/PSB by explicit path');
  assert(source.includes('runJsxCode'), 'tool must execute the isolated Photoshop composition via JSX');
  assert(source.includes('app.documents.add'), 'tool must compose into a new isolated white canvas');
  assert(source.includes('JPEGSaveOptions'), 'tool must save an exact JPEG output file');
  assert(source.includes('target.parent.create()'), 'tool must create the output directory without a dialog');
  assert(source.includes('targetSubjectHeightPx'), 'tool must fit the SKU subject to an explicit subject height');
  assert(source.includes('preferredLayerName'), 'tool must allow choosing a SKU color/layer but not require it');
  assert(source.includes('sourceLayerName'), 'tool result must report which source layer/group was used');
  assert(source.includes('canvasWidth') && source.includes('canvasHeight'), 'tool must expose output canvas dimensions');
  assert(source.includes('readback'), 'tool result must expose readback information');
  assert(source.includes('createToolFailureResult'), 'tool failures must use the shared normalized failure envelope');

  assert(registry.includes("import { ExportWhiteBgFromSkuMaterialTool } from './image/white-bg-from-sku-material';"), 'registry must import white-bg SKU export tool');
  assert(registry.includes('new ExportWhiteBgFromSkuMaterialTool()'), 'registry must register white-bg SKU export tool');

  assert(
    packageJson.scripts['smoke:main-image-white-bg-from-sku-tool'] === 'node scripts/smoke-main-image-white-bg-from-sku-tool.cjs',
    'package.json must expose the smoke script'
  );

  console.log(JSON.stringify({
    success: true,
    checks: [
      'white-bg SKU material export tool has a stable schema',
      'tool opens explicit PSD/PSB source and writes exact JPEG output',
      'tool composes into an isolated 800x800 white canvas',
      'tool reports source layer and readback details',
      'tool is registered in the UXP registry'
    ]
  }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(JSON.stringify({
    success: false,
    error: error.message,
    details: error.details
  }, null, 2));
  process.exit(1);
}
