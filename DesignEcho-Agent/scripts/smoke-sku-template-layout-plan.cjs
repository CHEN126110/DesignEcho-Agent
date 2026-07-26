#!/usr/bin/env node

const assert = require('assert');
const path = require('path');

require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '..', 'tsconfig.main.json')
});

const {
  buildSkuTemplateLayoutPlan
} = require('../src/shared/sku-template-layout-plan.ts');
const {
  buildSkuTemplateLayoutPreflightFromRuntimeInspection
} = require('../src/shared/sku-auto-layout-executor-policy.ts');

function slot(index, name, width, height, extra = {}) {
  return {
    layerId: index + 1,
    name,
    kind: 'solidColor',
    sourceType: 'rectangle_region',
    panelIndex: index,
    bounds: {
      left: 0,
      top: index * 500,
      right: width,
      bottom: index * 500 + height,
      width,
      height
    },
    ...extra
  };
}

function inspection(mode, slots) {
  return {
    schema: 'sku-template-layout-inspection/v2',
    templateName: '4双装.tif',
    mode,
    slotCount: slots.length,
    slots,
    blockers: [],
    warnings: []
  };
}

const orderedPlan = buildSkuTemplateLayoutPlan({
  expectedItemCount: 4,
  inspection: inspection('ordered_slots', [
    slot(0, '1', 200, 300, { sourceType: 'group_slot' }),
    slot(1, '2', 200, 300, { sourceType: 'group_slot' }),
    slot(2, '3', 200, 300, { sourceType: 'group_slot' }),
    slot(3, '4', 200, 300, { sourceType: 'group_slot' })
  ])
});
assert.strictEqual(orderedPlan.status, 'ready');
assert.strictEqual(orderedPlan.placementMethod, 'one_to_one_slots');
assert.deepStrictEqual(orderedPlan.regionCapacities, [1, 1, 1, 1]);

const orderedMismatch = buildSkuTemplateLayoutPlan({
  expectedItemCount: 4,
  inspection: inspection('ordered_slots', [slot(0, '1', 200, 300), slot(1, '2', 200, 300)])
});
assert.strictEqual(orderedMismatch.status, 'blocked');
assert.deepStrictEqual(orderedMismatch.regionCapacities, []);

const singleRegionPlan = buildSkuTemplateLayoutPlan({
  expectedItemCount: 4,
  inspection: inspection('legacy_single_region', [slot(0, '矩形 1', 800, 400)])
});
assert.strictEqual(singleRegionPlan.status, 'ready');
assert.strictEqual(singleRegionPlan.placementMethod, 'region_composition');
assert.deepStrictEqual(singleRegionPlan.regionCapacities, [4]);

// 用户截图同类结构：上方区域面积约为下方区域 3 倍，应稳定得到“上 3、下 1”。
const screenshotLikeInspection = inspection('legacy_multi_regions', [
  slot(0, '2', 770, 380),
  slot(1, '1', 250, 380)
]);
const screenshotLikePlan = buildSkuTemplateLayoutPlan({
  expectedItemCount: 4,
  inspection: screenshotLikeInspection
});
assert.strictEqual(screenshotLikePlan.status, 'ready');
assert.strictEqual(screenshotLikePlan.confidence, 'high');
assert.strictEqual(screenshotLikePlan.capacitySource, 'geometry_weight');
assert.deepStrictEqual(screenshotLikePlan.regionCapacities, [3, 1]);

const runtimePreflight = buildSkuTemplateLayoutPreflightFromRuntimeInspection({
  templateDoc: { name: '4双装.tif', width: 800, height: 800 },
  expectedItemCount: 4,
  inspection: screenshotLikeInspection
});
assert.deepStrictEqual(runtimePreflight.layoutPlan.regionCapacities, [3, 1]);
assert.strictEqual(runtimePreflight.layoutPlan.status, 'ready');

const metadataPlan = buildSkuTemplateLayoutPlan({
  expectedItemCount: 4,
  inspection: inspection('legacy_multi_regions', [
    slot(0, '[SKU:区域占位1:容量3]', 500, 300),
    slot(1, '[SKU:区域占位2:容量1]', 500, 300)
  ])
});
assert.strictEqual(metadataPlan.capacitySource, 'template_metadata');
assert.deepStrictEqual(metadataPlan.regionCapacities, [3, 1]);
assert.strictEqual(metadataPlan.status, 'ready');

const ambiguousPlan = buildSkuTemplateLayoutPlan({
  expectedItemCount: 4,
  inspection: inspection('legacy_multi_regions', [
    slot(0, '矩形 1', 300, 300),
    slot(1, '矩形 2', 300, 300),
    slot(2, '矩形 3', 300, 300)
  ])
});
assert.strictEqual(ambiguousPlan.status, 'needs_visual_confirmation');
assert.strictEqual(ambiguousPlan.requiresVisualConfirmation, true);
assert.deepStrictEqual(ambiguousPlan.regionCapacities, [2, 1, 1]);

const impossiblePlan = buildSkuTemplateLayoutPlan({
  expectedItemCount: 2,
  inspection: inspection('legacy_multi_regions', [
    slot(0, '矩形 1', 300, 300),
    slot(1, '矩形 2', 300, 300),
    slot(2, '矩形 3', 300, 300)
  ])
});
assert.strictEqual(impossiblePlan.status, 'blocked');

assert.deepStrictEqual(screenshotLikePlan.boundaries, {
  writesPhotoshop: false,
  grantsToolPermission: false,
  claimsDesignQuality: false
});

console.log(JSON.stringify({
  success: true,
  checks: [
    '6.3 ordered slots stay one color per slot',
    '6.0 single region carries the full combo',
    'screenshot-like 4-pair geometry resolves to [3,1]',
    'declared capacity metadata overrides geometry',
    'ambiguous geometry requires visual confirmation',
    'impossible region allocation blocks before Photoshop writes'
  ]
}, null, 2));
