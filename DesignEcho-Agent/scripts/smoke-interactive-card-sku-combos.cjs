#!/usr/bin/env node

require('ts-node').register({
  transpileOnly: true,
  compilerOptions: {
    module: 'CommonJS',
    moduleResolution: 'node',
  },
});

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const {
  addSkuComboToEditorValue,
  buildSkuComboEditorInteractiveCard,
  parseSkuComboText,
  removeSkuComboFromEditorValue,
  moveSkuComboInEditorValue,
  updateSkuComboColorSlotLabel,
  validateSkuComboEditorValue,
  buildSkuComboApprovedRecipeMemory,
} = require('../src/shared/sku-combo-interactive-card.ts');

const card = buildSkuComboEditorInteractiveCard({
  id: 'sku-card-test',
  title: '确认 SKU 组合',
  colorSlots: [
    { slot: 1, label: '奶白' },
    { slot: 2, label: '粉色' },
    { slot: 3, label: '浅咖' },
    { slot: 4, label: '灰色' },
    { slot: 5, label: '蓝色' },
  ],
  requiredSizes: [2, 3, 4],
  initialValue: {
    groups: [
      { size: 2, combos: [[1, 2], [3, 4]] },
      { size: 3, combos: [[1, 2, 3]] },
      { size: 4, combos: [[1, 2, 3, 4]] },
    ],
    generateSelfSelectNotes: true,
  },
  projectId: 'C-1194',
});

assert.strictEqual(card.version, 'interactive-card/v0');
assert.strictEqual(card.kind, 'sku_combo_editor');
assert.strictEqual(card.payload.version, 'sku-combo-editor/v0');
assert.strictEqual(card.memoryPolicy?.enabled, true);
assert.strictEqual(card.memoryPolicy?.mode, 'approved_recipe');
assert.deepStrictEqual(parseSkuComboText('1+2\n3+4', 2), [[1, 2], [3, 4]]);
assert.deepStrictEqual(parseSkuComboText('1+x+2', 2), [], 'legacy text parsing must reject an invalid line instead of hiding a token');
assert.deepStrictEqual(parseSkuComboText('1+2+3', 2), [], 'legacy text parsing must reject a size mismatch');

const valid = validateSkuComboEditorValue(card.payload, {
  groups: [
    { size: 2, combos: [[1, 2], [3, 4]] },
    { size: 3, combos: [[1, 2, 3]] },
    { size: 4, combos: [[1, 2, 3, 4]] },
  ],
  generateSelfSelectNotes: true,
});
assert.strictEqual(valid.valid, true, JSON.stringify(valid, null, 2));
assert.strictEqual(valid.canSubmit, true);
assert.deepStrictEqual(valid.normalizedValue.groups[0].combos[0], [1, 2]);
assert.deepStrictEqual(valid.normalizedValue.colorSlots, card.payload.colorSlots, 'legacy values should inherit editable color slots from the card payload');

const renamedColor = updateSkuComboColorSlotLabel(valid.normalizedValue, 2, '樱花粉');
assert.strictEqual(renamedColor.changed, true);
assert.strictEqual(renamedColor.reason, 'updated_color');
assert.strictEqual(renamedColor.value.colorSlots.find((slot) => slot.slot === 2).label, '樱花粉');
assert.strictEqual(valid.normalizedValue.colorSlots.find((slot) => slot.slot === 2).label, '粉色', 'rename must not mutate the source value');
const renamedValidation = validateSkuComboEditorValue(card.payload, renamedColor.value);
assert.strictEqual(renamedValidation.canSubmit, true);
assert.strictEqual(renamedValidation.normalizedValue.colorSlots.find((slot) => slot.slot === 2).label, '樱花粉');

const emptyColorLabel = validateSkuComboEditorValue(card.payload, {
  ...valid.normalizedValue,
  colorSlots: valid.normalizedValue.colorSlots.map((slot) => slot.slot === 2 ? { ...slot, label: '' } : slot),
});
assert.strictEqual(emptyColorLabel.canSubmit, false);
assert(emptyColorLabel.issues.some((issue) => issue.code === 'empty_color_label'));

const duplicateColorLabel = validateSkuComboEditorValue(card.payload, {
  ...valid.normalizedValue,
  colorSlots: valid.normalizedValue.colorSlots.map((slot) => slot.slot === 2 ? { ...slot, label: '奶白' } : slot),
});
assert.strictEqual(duplicateColorLabel.canSubmit, false);
assert(duplicateColorLabel.issues.some((issue) => issue.code === 'duplicate_color_label'));

const invalidUnknownColor = validateSkuComboEditorValue(card.payload, {
  groups: [
    { size: 2, combos: [[1, 6]] },
    { size: 3, combos: [[1, 2, 3]] },
    { size: 4, combos: [[1, 2, 3, 4]] },
  ],
});
assert.strictEqual(invalidUnknownColor.valid, false);
assert(invalidUnknownColor.issues.some((issue) => issue.code === 'unknown_color_slot' && issue.message.includes('6')));
assert.strictEqual(invalidUnknownColor.canSubmit, false);

const invalidSizeMismatch = validateSkuComboEditorValue(card.payload, {
  groups: [
    { size: 2, combos: [[1, 2, 3]] },
    { size: 3, combos: [[1, 2, 3]] },
    { size: 4, combos: [[1, 2, 3, 4]] },
  ],
});
assert.strictEqual(invalidSizeMismatch.valid, false);
assert(invalidSizeMismatch.issues.some((issue) => issue.code === 'combo_size_mismatch'));

const duplicate = validateSkuComboEditorValue(card.payload, {
  groups: [
    { size: 2, combos: [[1, 2], [1, 2]] },
    { size: 3, combos: [[1, 2, 3]] },
    { size: 4, combos: [[1, 2, 3, 4]] },
  ],
});
assert.strictEqual(duplicate.valid, false);
assert(duplicate.issues.some((issue) => issue.code === 'duplicate_combo'));

const reorderedDuplicate = validateSkuComboEditorValue(card.payload, {
  groups: [
    { size: 2, combos: [[1, 2], [2, 1]] },
    { size: 3, combos: [[1, 2, 3]] },
    { size: 4, combos: [[1, 2, 3, 4]] },
  ],
});
assert.strictEqual(reorderedDuplicate.valid, false);
assert(reorderedDuplicate.issues.some((issue) => issue.code === 'duplicate_combo'), 'reordered colors must share the executor multiset identity');

const repeatedColor = validateSkuComboEditorValue(card.payload, {
  groups: [
    { size: 2, combos: [[1, 1]] },
    { size: 3, combos: [[1, 2, 3]] },
    { size: 4, combos: [[1, 2, 3, 4]] },
  ],
});
assert.strictEqual(repeatedColor.valid, true, 'same-color multi-pair combos remain valid');

const mutationSource = valid.normalizedValue;
const added = addSkuComboToEditorValue(mutationSource, 2, [5, 1]);
assert.strictEqual(added.changed, true);
assert.strictEqual(added.reason, 'added');
assert.deepStrictEqual(added.value.groups[0].combos.at(-1), [5, 1]);
assert.strictEqual(mutationSource.groups[0].combos.length, 2, 'add must not mutate the source value');

const duplicateAdd = addSkuComboToEditorValue(added.value, 2, [5, 1]);
assert.strictEqual(duplicateAdd.changed, false);
assert.strictEqual(duplicateAdd.reason, 'duplicate');
assert.strictEqual(duplicateAdd.value, added.value, 'duplicate add should preserve the canonical value reference');

const reorderedDuplicateAdd = addSkuComboToEditorValue(added.value, 2, [1, 5]);
assert.strictEqual(reorderedDuplicateAdd.changed, false);
assert.strictEqual(reorderedDuplicateAdd.reason, 'duplicate');

const invalidDraft = addSkuComboToEditorValue(added.value, 3, [1, 2]);
assert.strictEqual(invalidDraft.changed, false);
assert.strictEqual(invalidDraft.reason, 'invalid_combo');

const removed = removeSkuComboFromEditorValue(added.value, 2, 2);
assert.strictEqual(removed.changed, true);
assert.strictEqual(removed.reason, 'removed');
assert.strictEqual(removed.value.groups[0].combos.length, 2);
assert.strictEqual(added.value.groups[0].combos.length, 3, 'remove must not mutate the source value');

// 组合顺序拖拽重排：组内 fromIndex → toIndex；不可变、不跨组、越界/未变化如实报错。
const beforeMove = added.value.groups[0].combos.map((c) => c.join('+'));
const moved = moveSkuComboInEditorValue(added.value, 2, 2, 0);
assert.strictEqual(moved.changed, true);
assert.strictEqual(moved.reason, 'reordered');
assert.deepStrictEqual(moved.value.groups[0].combos[0], [5, 1], 'moved combo lands at the target index');
assert.deepStrictEqual(
  added.value.groups[0].combos.map((c) => c.join('+')),
  beforeMove,
  'move must not mutate the source value',
);
const moveSame = moveSkuComboInEditorValue(added.value, 2, 1, 1);
assert.strictEqual(moveSame.changed, false);
assert.strictEqual(moveSame.reason, 'unchanged');
const moveOutOfRange = moveSkuComboInEditorValue(added.value, 2, 0, 9);
assert.strictEqual(moveOutOfRange.changed, false);
assert.strictEqual(moveOutOfRange.reason, 'invalid_index');
const moveMissingGroup = moveSkuComboInEditorValue(added.value, 7, 0, 0);
assert.strictEqual(moveMissingGroup.changed, false);
assert.strictEqual(moveMissingGroup.reason, 'missing_group');

const memory = buildSkuComboApprovedRecipeMemory({
  card,
  value: renamedValidation.normalizedValue,
  scope: { type: 'project', id: 'C-1194' },
  confirmedBy: 'user',
});
assert.strictEqual(memory.kind, 'approved_recipe');
assert.strictEqual(memory.source, 'accepted_output');
assert.strictEqual(memory.status, 'active');
assert(memory.tags.includes('sku'));
assert(memory.tags.includes('interactive-card'));
assert(memory.summary.includes('2双'));
assert(memory.summary.includes('2:樱花粉'), 'approved recipe memory should preserve the user-confirmed color label');
assert(!JSON.stringify(memory).includes('E:\\\\WERKE'), 'memory must not persist local source paths');

const cardViewSource = fs.readFileSync(path.resolve(
  __dirname,
  '../src/renderer/components/message/blocks/InteractiveCardBlock.tsx'
), 'utf8');
const skuViewStart = cardViewSource.indexOf('const SkuComboEditorCardView');
const skuViewEnd = cardViewSource.indexOf('function buildEditableInitialValue');
assert(skuViewStart >= 0 && skuViewEnd > skuViewStart, 'SKU card view source slice should exist');
const skuView = cardViewSource.slice(skuViewStart, skuViewEnd);
assert(skuView.includes('useState<SkuComboEditorValue>'), 'SKU card must edit the structured value directly');
assert(!skuView.includes('groupText'), 'SKU card must not keep textarea text as a second source of truth');
assert(!skuView.includes('<textarea'), 'SKU card should use drag/click composition instead of manual combo textareas');
assert(!skuView.includes('draftBySize'), 'the unified composer must own one visible draft instead of one hidden draft per size');
assert(cardViewSource.includes('application/x-designecho-sku-color-slot'), 'SKU drag must use a scoped custom MIME type');
assert(skuView.includes('draggable'), 'color slots should be draggable');
assert(skuView.includes('onDrop='), 'size targets should accept color drops');
assert.strictEqual((skuView.match(/className="sku-combo-drop-zone"/g) || []).length, 1, 'SKU card should render exactly one unified drop zone');
// 产品决策（用户 2026-07-24）：SKU 卡取消颜色改名与「选双数」模式，改为「拖几个颜色=几双装、点确认即加」。
// 以下三条把该简化锁进合同，防止误回加已删控件。
assert(!skuView.includes('sku-color-slot-edit') && !skuView.includes('updateSkuComboColorSlotLabel'),
  'color rename removed per product decision; names come pre-filled from the generator');
assert(!skuView.includes('sku-combo-size-switch'),
  'size selector removed; combo size is derived from the number of colors dragged');
assert(skuView.includes('commitDraftCombo') && skuView.includes('sku-combo-commit-draft'),
  'user commits a combo explicitly by dragged-color count (拖几个=几双装) instead of pre-selecting a size');
assert(skuView.includes('handleComboDrop') && skuView.includes('moveSkuComboInEditorValue'),
  'added combos can be reordered by drag within their size group (拖拽调整组合顺序)');
assert(skuView.includes('aria-live="polite"'), 'drag/click changes should be announced accessibly');
assert(skuView.includes('hasDraft'), 'unfinished drafts must not be silently submitted');

const cardStyleSource = fs.readFileSync(path.resolve(
  __dirname,
  '../src/renderer/components/message/MessageRenderer.css'
), 'utf8');
assert(cardStyleSource.includes('.sku-combo-composer.is-drag-over'), 'the unified drop target must expose a visible drag-over state');
assert(cardStyleSource.includes('@media (prefers-reduced-motion: reduce)'), 'SKU interaction motion must respect reduced motion');

const skuExecutorSource = fs.readFileSync(path.resolve(
  __dirname,
  '../src/renderer/services/skill-executors/sku-batch.executor.ts'
), 'utf8');
assert(skuExecutorSource.includes("from '../../../shared/sku-combo-identity'"), 'card and executor must share one combo identity algorithm');
assert(skuExecutorSource.includes('return buildSkuComboMultisetIdentity(combo'), 'executor dedupe must consume the shared multiset identity');
assert(skuExecutorSource.includes('validation.normalizedValue.colorSlots || card.payload.colorSlots'), 'SKU executor must consume confirmed color names with legacy payload fallback');

console.log('[smoke-interactive-card-sku-combos] pass');
