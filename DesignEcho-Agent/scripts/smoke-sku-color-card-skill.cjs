'use strict';

const assert = require('assert');
const path = require('path');

require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '..', 'tsconfig.main.json')
});

const root = path.resolve(__dirname, '..');
const {
  buildInternalSkuColorCardGeometry,
  buildSkuColorCardPlan,
  isSkuColorCardClippingReadbackVerified,
  resolveSkuColorCardSources
} = require(path.join(root, 'src', 'shared', 'sku-color-card-skill.ts'));
const { getSkillById } = require(path.join(root, 'src', 'shared', 'skills', 'skill-declarations.ts'));
const { getManifestByLegacySkillId } = require(path.join(root, 'src', 'shared', 'agent-runtime-v5', 'skill-runtime.ts'));

const sources = [
  { filePath: 'E:\\project\\蓝条纹.jpg' },
  { filePath: 'E:\\project\\咖条纹.jpg' },
  { filePath: 'E:\\project\\奶白黑条纹.jpg' },
  { filePath: 'E:\\project\\黑色白条纹.jpg' }
];

function buildAsset(pathValue, id) {
  const normalized = pathValue.replace(/\\/g, '/');
  return {
    id,
    path: pathValue,
    relativePath: normalized.split('/').slice(-2).join('/'),
    name: normalized.split('/').pop(),
    extension: '.jpg',
    folderRole: 'source',
    role: 'color-single',
    comboColors: [],
    isImage: true,
    isDesignDocument: false,
    isOutput: false,
    needsVision: false,
    confidence: 1,
    reasons: [],
    classificationNotes: []
  };
}

const assetIndex = {
  assets: [
    buildAsset('E:\\project\\颜色图\\蓝条纹.jpg', 'blue'),
    buildAsset('E:\\project\\颜色图\\咖条纹.jpg', 'brown'),
    buildAsset('E:\\project\\颜色图\\奶白黑条纹.jpg', 'cream'),
    buildAsset('E:\\project\\颜色图\\黑色白条纹.jpg', 'black'),
    buildAsset('E:\\project\\拍摄图\\2026-02-09 193529.jpg', 'timestamp')
  ]
};

const exactResolution = resolveSkuColorCardSources({
  sources: [
    { filePath: 'E:\\project\\拍摄图\\2026-02-09 193529.jpg', colorName: '蓝条纹' },
    { filePath: '', colorName: '咖条纹' },
    { filePath: '', colorName: '奶白黑条纹' },
    { filePath: '', colorName: '黑色白条纹' }
  ],
  assetIndex,
  userInput: '按蓝条纹、咖条纹、奶白黑条纹、黑色白条纹排列'
});
assert.strictEqual(exactResolution.status, 'resolved');
assert.deepStrictEqual(exactResolution.sources.map((source) => source.filePath), [
  'E:\\project\\颜色图\\蓝条纹.jpg',
  'E:\\project\\颜色图\\咖条纹.jpg',
  'E:\\project\\颜色图\\奶白黑条纹.jpg',
  'E:\\project\\颜色图\\黑色白条纹.jpg'
]);
assert.ok(exactResolution.items.every((item) => item.method === 'project_exact_name'));

const explicitPathResolution = resolveSkuColorCardSources({
  sources: [{ filePath: 'E:\\project\\拍摄图\\2026-02-09 193529.jpg', colorName: '蓝条纹' }],
  assetIndex,
  userInput: '请用 E:\\project\\拍摄图\\2026-02-09 193529.jpg 作为蓝条纹'
});
assert.strictEqual(explicitPathResolution.status, 'resolved');
assert.strictEqual(explicitPathResolution.sources[0].filePath, 'E:\\project\\拍摄图\\2026-02-09 193529.jpg');
assert.strictEqual(explicitPathResolution.items[0].method, 'user_explicit_path');

const ambiguousResolution = resolveSkuColorCardSources({
  sources: [{ filePath: '', colorName: '蓝条纹' }],
  assetIndex: {
    assets: [
      buildAsset('E:\\project\\A\\蓝条纹.jpg', 'blue-a'),
      buildAsset('E:\\project\\B\\蓝条纹.png', 'blue-b')
    ]
  }
});
assert.strictEqual(ambiguousResolution.status, 'blocked');
assert.strictEqual(ambiguousResolution.sources[0].filePath, '');
assert.ok(ambiguousResolution.blockers.some((blocker) => blocker.includes('存在 2 张')));
const plan = buildSkuColorCardPlan({
  projectPath: 'E:\\project',
  sources
});

assert.strictEqual(plan.version, 'sku-color-card-skill/v1');
assert.strictEqual(plan.status, 'ready');
assert.strictEqual(plan.canExecute, true);
assert.deepStrictEqual(plan.canvas, { width: 1500, height: 1500, backgroundColor: 'white' });
assert.ok(plan.outputPath.replace(/\\/g, '/').endsWith('/PSD/SKU.psb'));
assert.deepStrictEqual(plan.slots.map((slot) => slot.source.colorName), [
  '蓝条纹',
  '咖条纹',
  '奶白黑条纹',
  '黑色白条纹'
]);
assert.deepStrictEqual(plan.slots.map((slot) => slot.groupName), plan.slots.map((slot) => slot.source.colorName));
assert.ok(plan.slots.every((slot) => slot.cardBounds.width === 250 && slot.cardBounds.height === 380));
assert.ok(plan.slots.every((slot) => slot.indexText && slot.indexText.content === String(slot.index)));
assert.deepStrictEqual(plan.indexReference, {
  enabled: true,
  groupName: '参考组',
  purpose: 'display_only',
  excludeFromColorGroups: true
});
assert.strictEqual(plan.cardStyle.cornerRadius, 10);
assert.ok(plan.requiredTools.includes('convertToSmartObject'));
assert.ok(plan.requiredTools.includes('editSmartObjectContents'));
assert.ok(plan.requiredTools.includes('getClippingMaskInfo'));
assert.ok(plan.requiredTools.includes('getLayerBounds'));
assert.ok(plan.requiredTools.includes('setTextStyle'));
assert.ok(plan.requiredTools.includes('moveLayer'));
assert.ok(plan.requiredTools.includes('getCanvasSnapshot'));
assert.ok(plan.requiredTools.includes('fitLayerSubjectToRegion'));
assert.ok(plan.requiredTools.includes('transformLayer'));

const internal = buildInternalSkuColorCardGeometry({ width: 800, height: 1216 });
assert.deepStrictEqual(internal.label, {
  x: 448,
  y: 32,
  width: 320,
  height: 115,
  cornerRadius: 32
});
assert.deepStrictEqual(internal.image, { x: 0, y: 0, width: 800, height: 1216 });
const shortLabel = buildInternalSkuColorCardGeometry({ width: 250, height: 380, labelText: '蓝条纹' });
const longLabel = buildInternalSkuColorCardGeometry({ width: 250, height: 380, labelText: '奶白黑条纹' });
assert.strictEqual(shortLabel.text.fontSize, 20);
assert.strictEqual(shortLabel.text.x, 148);
assert.strictEqual(longLabel.text.fontSize, 16);
assert.ok(longLabel.text.fontSize < shortLabel.text.fontSize);
assert.strictEqual(isSkuColorCardClippingReadbackVerified({ isClipped: true }), true);
assert.strictEqual(isSkuColorCardClippingReadbackVerified({ success: true, data: { isClipped: true } }), true);
assert.strictEqual(isSkuColorCardClippingReadbackVerified({ success: false, isClipped: true }), false);
assert.strictEqual(isSkuColorCardClippingReadbackVerified({ isClipped: false }), false);

const duplicate = buildSkuColorCardPlan({
  projectPath: 'E:\\project',
  sources: [
    { filePath: 'E:\\project\\A.jpg', colorName: '同名' },
    { filePath: 'E:\\project\\B.jpg', colorName: '同名' }
  ]
});
assert.strictEqual(duplicate.status, 'blocked_invalid_sources');
assert.ok(duplicate.blockers.some((blocker) => blocker.includes('颜色名称重复')));

const overflow = buildSkuColorCardPlan({
  projectPath: 'E:\\project',
  sources,
  layout: { cardWidth: 500, columns: 4 }
});
assert.strictEqual(overflow.status, 'blocked_layout_overflow');
assert.strictEqual(overflow.canExecute, false);

const withoutIndex = buildSkuColorCardPlan({
  projectPath: 'E:\\project',
  sources,
  layout: { showIndexNumbers: false }
});
assert.strictEqual(withoutIndex.indexReference.enabled, false);
assert.ok(withoutIndex.slots.every((slot) => slot.indexText === null));

const declaration = getSkillById('sku-color-card');
assert.ok(declaration);
assert.strictEqual(declaration.kind, 'workflow');
assert.strictEqual(declaration.controlledRouteEntry, 'autonomous-react-loop');
assert.ok(declaration.requiredTools.includes('convertToSmartObject'));

const manifest = getManifestByLegacySkillId('sku-color-card');
assert.ok(manifest);
assert.strictEqual(manifest.skill_id, 'ecommerce.sku_color_card');
assert.strictEqual(manifest.review_rubric_ref, 'rubrics/sku-color-card.v1');
assert.ok(manifest.available_tools.includes('photoshop.sandbox.editSmartObject'));
assert.ok(manifest.required_model_profiles.includes('vision.reference'));

const fs = require('fs');
const skuBatchSource = fs.readFileSync(
  path.join(root, 'src', 'renderer', 'services', 'skill-executors', 'sku-batch.executor.ts'),
  'utf8'
);
assert.ok(skuBatchSource.includes("runSkill('sku-color-card'"));
assert.ok(!skuBatchSource.includes('sku-card-source-create-document'));
assert.ok(!skuBatchSource.includes('sku-card-source-place-image-'));
assert.ok(skuBatchSource.includes('requiresVisualAdjustment'));
assert.ok(skuBatchSource.includes('agentReActContinuation'));

const colorCardExecutorSource = fs.readFileSync(
  path.join(root, 'src', 'renderer', 'services', 'skill-executors', 'sku-color-card.executor.ts'),
  'utf8'
);
assert.ok(colorCardExecutorSource.includes("'normalize-color-group-root'"));
assert.ok(colorCardExecutorSource.includes('targetGroupId: 0'));
assert.ok(colorCardExecutorSource.includes("'create-index-reference-group'"));
assert.ok(colorCardExecutorSource.includes("'normalize-index-reference-group-root'"));
assert.ok(colorCardExecutorSource.includes('targetGroupId: referenceGroupId'));
assert.ok(!colorCardExecutorSource.includes("'group-index-text'"));
assert.ok(colorCardExecutorSource.includes("targetFit: 'contain'"));
assert.ok(!colorCardExecutorSource.includes("targetFit: 'cover'"));
assert.ok(colorCardExecutorSource.includes("'fit-label-text-size'"));
assert.ok(colorCardExecutorSource.includes("'center-label-text'"));
assert.ok(colorCardExecutorSource.includes("'verify-centered-label-text'"));
assert.ok(colorCardExecutorSource.includes("status: 'structure_ready'"));
assert.ok(colorCardExecutorSource.includes('visualAdjustmentHandoff'));
assert.ok(colorCardExecutorSource.includes('若主体检测失败或超时'));
assert.ok(colorCardExecutorSource.includes('agentReActContinuation'));
assert.ok(colorCardExecutorSource.includes("callTool('createDocument', {"));
assert.ok(colorCardExecutorSource.includes('name: plan.documentName'));
assert.ok(colorCardExecutorSource.includes('width: plan.canvas.width'));
assert.ok(!colorCardExecutorSource.includes('confirmNewDocumentDespiteExisting'));
assert.ok(!skuBatchSource.includes('confirmNewDocumentDespiteExisting'));

console.log(JSON.stringify({
  success: true,
  sourceCount: plan.slots.length,
  outputPath: plan.outputPath,
  cardSize: plan.slots[0].cardBounds,
  internalLabel: internal.label,
  boundaries: {
    callsPhotoshop: false,
    writesProjectFiles: false,
    usesIndependentSkill: true,
    legacySkuBatchDelegates: true
  }
}, null, 2));
