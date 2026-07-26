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

global.localStorage = {
  data: new Map(),
  getItem(key) { return this.data.has(key) ? this.data.get(key) : null; },
  setItem(key, value) { this.data.set(key, String(value)); },
  removeItem(key) { this.data.delete(key); },
  clear() { this.data.clear(); },
};

const {
  buildEditableConfirmationInteractiveCard,
  validateEditableConfirmationValue,
  buildEditableConfirmationApprovedMemory,
} = require('../src/shared/editable-confirmation-interactive-card.ts');
const MemoryService = require('../src/renderer/services/memory.service.ts').default;

const card = buildEditableConfirmationInteractiveCard({
  id: 'design-plan-card-test',
  title: '确认设计规划',
  description: '确认或修改后继续执行。',
  fields: [
    { id: 'goal', label: '设计目标', type: 'long_text', required: true, value: '做一张突出透气和弹力的袜子主图' },
    { id: 'style', label: '视觉风格', type: 'short_text', required: true, value: 'ins 风、清爽' },
    { id: 'mustReview', label: '导出前复核', type: 'boolean', value: 'false' },
  ],
  projectId: 'C-1194',
  memoryEnabled: true,
  memoryKind: 'project_rule',
  tags: ['design-plan', 'interactive-card'],
});

assert.strictEqual(card.version, 'interactive-card/v0');
assert.strictEqual(card.kind, 'editable_confirmation');
assert.strictEqual(card.payload.version, 'editable-confirmation/v0');
assert.strictEqual(card.memoryPolicy?.enabled, true);
assert.strictEqual(card.memoryPolicy?.mode, 'approved_content');
assert.strictEqual(card.memoryPolicy?.scope?.type, 'project');
assert.strictEqual(card.payload.initialValue.values.mustReview, false);

const valid = validateEditableConfirmationValue(card.payload, {
  values: {
    goal: '突出透气和弹力，优先用真实产品图',
    style: 'ins 风、清爽、留白',
    mustReview: true,
  },
});
assert.strictEqual(valid.canSubmit, true, JSON.stringify(valid, null, 2));
assert.strictEqual(valid.normalizedValue.values.goal, '突出透气和弹力，优先用真实产品图');
assert.strictEqual(valid.normalizedValue.values.mustReview, true);

const invalid = validateEditableConfirmationValue(card.payload, {
  values: {
    goal: '',
    style: 'ins 风',
  },
});
assert.strictEqual(invalid.canSubmit, false);
assert(invalid.issues.some((issue) => issue.code === 'required_field_empty' && issue.path === 'values.goal'));

const memory = buildEditableConfirmationApprovedMemory({
  card,
  value: valid.normalizedValue,
  confirmedBy: 'user',
  confirmedAt: '2026-06-17T00:00:00.000Z',
});
assert.strictEqual(memory.kind, 'project_rule');
assert.strictEqual(memory.source, 'accepted_output');
assert(memory.tags.includes('interactive-card'));
assert(memory.tags.includes('design-plan'));
assert(memory.summary.includes('设计目标'));
assert(!JSON.stringify(memory).includes('E:\\\\WERKE'), 'memory must not persist local source paths');

const memoryService = new MemoryService();
assert.strictEqual(typeof memoryService.upsertDesignMemoryItem, 'undefined', 'generic active-memory upsert must not remain public');
const persistedMemory = memoryService.recordUserConfirmedDesignMemoryItem(memory);
assert.strictEqual(persistedMemory.status, 'active');
assert.strictEqual(memoryService.listPersistedDesignMemoryItems({ status: 'active' }).length, 1);
assert.throws(
  () => memoryService.recordUserConfirmedDesignMemoryItem({
    ...memory,
    id: 'unconfirmed-active-memory',
    sourceNotes: [{ source: 'model-output', summary: '模型自行决定保存', status: 'active' }],
  }),
  /只有用户在交互确认卡中明确确认/,
  'unreviewed model output must not bypass the learning review gate through the user-confirmed memory writer',
);

const toolSchemas = fs.readFileSync(
  path.resolve(__dirname, '../src/renderer/services/agent-runtime/tool-schemas.ts'),
  'utf8',
);
const toolExecutor = fs.readFileSync(
  path.resolve(__dirname, '../src/renderer/services/tool-executor.service.ts'),
  'utf8',
);
const chatPanel = fs.readFileSync(
  path.resolve(__dirname, '../src/renderer/components/ChatPanel.tsx'),
  'utf8',
);
const block = fs.readFileSync(
  path.resolve(__dirname, '../src/renderer/components/message/blocks/InteractiveCardBlock.tsx'),
  'utf8',
);
const packageJson = fs.readFileSync(
  path.resolve(__dirname, '../package.json'),
  'utf8',
);

assert(/DEFAULT_AGENT_TOOL_NAMES\s*=\s*\[\s*['"]createInteractiveCard['"]/.test(toolSchemas), 'createInteractiveCard should be in the default Agent tool list');
assert(toolSchemas.includes('editable_confirmation'), 'Agent tool schema should expose editable_confirmation');
assert(toolExecutor.includes('buildEditableConfirmationInteractiveCard'), 'tool executor should create editable confirmation cards');
assert(chatPanel.includes('isEditableConfirmationCard'), 'ChatPanel should accept editable confirmation submissions');
assert(chatPanel.includes('buildEditableConfirmationApprovedMemory'), 'ChatPanel should persist approved editable card memory');
assert(block.includes('EditableConfirmationCardView'), 'message UI should render editable confirmation cards');
assert(packageJson.includes('"smoke:interactive-card:editable-confirmation"'), 'package should expose editable card smoke');

// 治理审计(2026-07-01) 线上事故回归钉桩：fields 是模型在 createInteractiveCard 工具调用里
// 现场生成的自由文本，工具层 schema 不强制"choice 必须有非空 options"或"value 必须属于
// options"。此前一次真实 SKU 任务里，模型生成的卡片出现了 choice 字段 options 为空、
// 以及 value 与 options 不匹配两种情况，导致卡片在用户交互前就展示"不能为空"/"不是可选项"
// 等相互矛盾的报错，且渲染出一个没有任何选项的空下拉框。
const malformedCard = buildEditableConfirmationInteractiveCard({
  id: 'malformed-card-regression-test',
  title: 'SKU组合确认',
  fields: [
    { id: 'task_type', label: '任务类型', type: 'choice', required: true, value: '', options: [] },
    { id: 'combo_size', label: '组合大小', type: 'choice', value: '5双装', options: [{ value: '2', label: '2双装' }, { value: '3', label: '3双装' }] },
  ],
});

const taskTypeField = malformedCard.payload.fields.find((f) => f.id === 'task_type');
const comboSizeField = malformedCard.payload.fields.find((f) => f.id === 'combo_size');

assert.strictEqual(taskTypeField?.type, 'short_text', 'choice field with empty options must degrade to short_text, not render a broken empty dropdown');
assert.strictEqual(taskTypeField?.options, undefined, 'degraded field must not carry a stale empty options array');
assert.strictEqual(comboSizeField?.type, 'choice', 'choice field with valid non-empty options must stay a choice field');
assert.strictEqual(comboSizeField?.value, '2', 'choice field whose default value is not among its options must fall back to the first option, not keep an invalid literal');

const malformedValidation = validateEditableConfirmationValue(malformedCard.payload, malformedCard.payload.initialValue);
const issueCodes = malformedValidation.issues.map((issue) => issue.code);
assert(!issueCodes.includes('choice_value_not_allowed'), 'a repaired card must not still report choice_value_not_allowed on its own initial value before any user interaction');
assert.deepStrictEqual(issueCodes, ['required_field_empty'], 'the only remaining issue should be the honest "required field still empty" case, not a self-contradictory options mismatch');

console.log('[smoke-interactive-card-editable-confirmation] pass');
