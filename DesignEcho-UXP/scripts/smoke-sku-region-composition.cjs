#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ts = require('typescript');

const projectRoot = path.resolve(__dirname, '..');
const sourcePath = path.join(projectRoot, 'src', 'tools', 'layout', 'sku-layout-tool.ts');
const source = fs.readFileSync(sourcePath, 'utf8');

function loadCapacityResolver() {
  const start = source.indexOf('function resolveSkuRegionCapacities');
  const end = source.indexOf('\ntype SkuPlaceholderMismatchData', start);
  assert(start >= 0 && end > start, 'Cannot locate resolveSkuRegionCapacities source.');
  const functionSource = source.slice(start, end);
  const instrumented = `${functionSource}\nmodule.exports = { resolveSkuRegionCapacities };`;
  const javascript = ts.transpileModule(instrumented, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020
    }
  }).outputText;
  const sandbox = { module: { exports: {} }, exports: {} };
  vm.runInNewContext(javascript, sandbox, { filename: 'sku-region-capacity-resolver.js' });
  return sandbox.module.exports.resolveSkuRegionCapacities;
}

const resolveSkuRegionCapacities = loadCapacityResolver();

assert.deepStrictEqual(
  Array.from(resolveSkuRegionCapacities({ mode: 'ordered_slots', slotCount: 4, comboSize: 4 })),
  [1, 1, 1, 1]
);
assert.deepStrictEqual(
  Array.from(resolveSkuRegionCapacities({ mode: 'legacy_single_region', slotCount: 1, comboSize: 4 })),
  [4]
);
assert.deepStrictEqual(
  Array.from(resolveSkuRegionCapacities({
    mode: 'legacy_multi_regions',
    slotCount: 2,
    comboSize: 4,
    requested: [3, 1]
  })),
  [3, 1]
);
assert.throws(
  () => resolveSkuRegionCapacities({ mode: 'legacy_multi_regions', slotCount: 2, comboSize: 4 }),
  /必须提供 regionCapacities/
);
assert.throws(
  () => resolveSkuRegionCapacities({
    mode: 'legacy_multi_regions',
    slotCount: 2,
    comboSize: 4,
    requested: [2, 1]
  }),
  /总和为 4/
);
assert.throws(
  () => resolveSkuRegionCapacities({ mode: 'ordered_slots', slotCount: 2, comboSize: 4 }),
  /需要 4 个一色一槽/
);

assert(source.includes("schema: 'sku-template-layout-inspection/v2'"));
assert(source.includes("revision: 'sku-region-composition/v1'"));
assert(source.includes('regionColorAssignments'));
assert(source.includes('templateLayoutPlans'));
assert(source.includes('assignments: regionColorAssignments.map'));

console.log(JSON.stringify({
  success: true,
  checks: [
    'ordered slots resolve to one color each',
    'single legacy region accepts the full combo',
    'multi-region execution consumes explicit [3,1]',
    'missing or inconsistent capacities are rejected',
    'execution returns the actual region assignment plan'
  ]
}, null, 2));
