#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const sourcePath = path.resolve(__dirname, '../src/tools/layer/clipping-mask-info.ts');
const source = fs.readFileSync(sourcePath, 'utf8');

assert(
  /function\s+isLayerClipped\s*\(/.test(source),
  'getClippingMaskInfo should centralize clipped-state detection in isLayerClipped()',
);
assert(
  /isClippingMask\s*===\s*true/.test(source),
  'getClippingMaskInfo should read Photoshop DOM isClippingMask state, not only the older clipped alias',
);
assert(
  /const\s+isClipped\s*=\s*isLayerClipped\(layer\)/.test(source),
  'single-layer clipping readback should use isLayerClipped(layer)',
);
assert(
  /isLayerClipped\(siblings\[i\]\)/.test(source),
  'base detection should use isLayerClipped() for sibling traversal',
);
assert(
  /isLayerClipped\(layers\[j\]\)/.test(source),
  'document-level clipping group detection should use isLayerClipped() for clipped layers',
);

console.log('[smoke-clipping-mask-info-state-property] pass');
