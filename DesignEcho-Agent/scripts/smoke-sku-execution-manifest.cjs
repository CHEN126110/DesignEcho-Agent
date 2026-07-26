#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const agentRoot = path.resolve(__dirname, '..');
const executorPath = path.join(agentRoot, 'src', 'renderer', 'services', 'skill-executors', 'sku-batch.executor.ts');
const packagePath = path.join(agentRoot, 'package.json');

const source = fs.readFileSync(executorPath, 'utf8');
const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));

const manifestIndex = source.indexOf('const skuExecutionManifest');
const processingLoopIndex = source.lastIndexOf('for (const [sizeStr, combos] of Object.entries(combosBySize))');

assert(manifestIndex >= 0, 'SKU executor should build a skuExecutionManifest before running per-size Photoshop work');
assert(processingLoopIndex >= 0, 'SKU executor should keep a per-size execution loop');
assert(
  manifestIndex < processingLoopIndex,
  'skuExecutionManifest must be prepared before the per-size execution loop starts'
);
assert(
  source.includes('type ResolvedSkuExecutionAssets'),
  'SKU executor should model pre-resolved combo/note template documents per size'
);
assert(
  source.includes('const resolvedSkuAssetsBySize = new Map<number, ResolvedSkuExecutionAssets>();'),
  'SKU executor should cache pre-resolved SKU assets before execution'
);
assert(
  source.includes('const resolveComboTemplateDocument'),
  'SKU executor should extract combo template resolution out of the execution loop'
);
assert(
  source.includes('const resolveNoteTemplateDocument'),
  'SKU executor should extract note template resolution out of the execution loop'
);
assert(
  source.includes('const resolvedAssets = resolvedSkuAssetsBySize.get(size);'),
  'SKU per-size execution should consume the pre-resolved asset cache'
);
assert(
  source.includes('skuExecutionManifest,'),
  'SKU result data should expose the execution manifest for UI/review panels'
);
assert(
  packageJson.scripts['smoke:sku:execution-manifest'],
  'package.json should expose smoke:sku:execution-manifest'
);

console.log(JSON.stringify({
  success: true,
  checks: [
    'SKU executor builds a user-visible execution manifest before Photoshop mutations',
    'SKU combo and note templates are pre-resolved before the per-size execution loop',
    'per-size execution consumes the pre-resolved asset cache instead of planning while running',
    'SKU result data exposes skuExecutionManifest for UI and review consumers'
  ]
}, null, 2));
