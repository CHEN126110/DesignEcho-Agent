'use strict';

/**
 * smoke: 意图声明地基（V2「意图交给 Agent 理解」P1 前置件）。
 *
 * 覆盖两个自足、零行为翻转的地基：
 * (1) design-task-types 的合法 taskTypeId 枚举供给：listDesignTaskTypeIds 是声明工具的单一来源，
 *     已注册业务类型与通用设计都自动进入 schema，不含未注册的 poster；校验行为一致。
 * (2) design-intent-signal 的纵深防御校验器：提供 isValidTaskTypeId 时，未注册/拼错的声明 id
 *     被安全降级为"未声明"（不进 model_declaration、不产生 isDesign=true 但 spec 缺失的半激活态）；
 *     不提供校验器时保持原行为（向后兼容）。
 */

const assert = require('assert');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
require('ts-node').register({ transpileOnly: true, project: path.resolve(ROOT, 'tsconfig.main.json') });

const {
  listDesignTaskTypeIds,
  isRegisteredDesignTaskTypeId,
  getDesignTaskTypeSpec
} = require(path.resolve(ROOT, 'src', 'shared', 'design-task-types.ts'));
const { resolveDesignIntentSignal } = require(path.resolve(ROOT, 'src', 'shared', 'design-intent-signal.ts'));
const { getDefaultAgentTools } = require(path.resolve(ROOT, 'src', 'renderer', 'services', 'agent-runtime', 'tool-schemas.ts'));

function check(name, fn) { fn(); console.log(`  ✓ ${name}`); }
console.log('smoke: intent-declaration-foundation');

// ---------- (1) 合法 id 枚举供给 ----------
check('listDesignTaskTypeIds 只列已注册品类，且每个都能 getDesignTaskTypeSpec 命中', () => {
  const ids = listDesignTaskTypeIds();
  assert.ok(Array.isArray(ids) && ids.length >= 3, `ids=${JSON.stringify(ids)}`);
  for (const id of ['ecommerce.detail_page.v1', 'ecommerce.main_image.v1', 'ecommerce.sku_template.v1']) {
    assert.ok(ids.includes(id), `应含已注册品类 ${id}`);
    assert.ok(getDesignTaskTypeSpec(id), `${id} 应能查表命中`);
  }
});

check('未注册品类不在枚举内（poster 未注册；声明通道 ≠ 品类覆盖）', () => {
  const ids = listDesignTaskTypeIds();
  assert.ok(!ids.some((id) => /poster|海报/i.test(id)), '注册表当前无 poster 品类');
});

check('declareDesignIntent schema 与任务类型注册表完全一致', () => {
  const ids = listDesignTaskTypeIds();
  const declarationTool = getDefaultAgentTools().find((tool) => tool.name === 'declareDesignIntent');
  const schemaIds = declarationTool?.inputSchema?.properties?.taskTypeId?.enum;
  assert.deepStrictEqual(schemaIds, ids, `schema=${JSON.stringify(schemaIds)} registry=${JSON.stringify(ids)}`);
  assert.ok(ids.includes('ecommerce.sku_color_card.v1'), 'SKU 色卡任务类型不得在声明工具中半隐身');
  assert.ok(ids.includes('design.generic.v1'), '通用设计声明身份不得在 schema 中半隐身');
});

check('isRegisteredDesignTaskTypeId 正确校验合法/非法/空', () => {
  assert.strictEqual(isRegisteredDesignTaskTypeId('ecommerce.main_image.v1'), true);
  assert.strictEqual(isRegisteredDesignTaskTypeId('design.poster.v1'), false, '未注册 id 应为 false');
  assert.strictEqual(isRegisteredDesignTaskTypeId(''), false);
  assert.strictEqual(isRegisteredDesignTaskTypeId(undefined), false);
  assert.strictEqual(isRegisteredDesignTaskTypeId(123), false);
});

// ---------- (2) 信号纵深防御校验器 ----------
check('提供校验器时：已注册声明 id → model_declaration 激活', () => {
  const s = resolveDesignIntentSignal({
    declaredTaskType: 'ecommerce.main_image.v1',
    isValidTaskTypeId: isRegisteredDesignTaskTypeId
  });
  assert.strictEqual(s.isDesign, true);
  assert.strictEqual(s.source, 'model_declaration');
  assert.strictEqual(s.taskTypeId, 'ecommerce.main_image.v1');
});

check('提供校验器时：未注册/幻觉声明 id → 安全降级为未声明（不半激活）', () => {
  const s = resolveDesignIntentSignal({
    declaredTaskType: 'design.poster.v1',
    isValidTaskTypeId: isRegisteredDesignTaskTypeId
  });
  assert.strictEqual(s.isDesign, false, '未注册 id 不应触发 model_declaration');
  assert.strictEqual(s.source, 'none');
  assert.strictEqual(s.taskTypeId, undefined, '不产生 isDesign=true 但 spec 缺失的半激活态');
});

check('不提供校验器时：保持原行为（任何非空声明 id → model_declaration，向后兼容）', () => {
  const s = resolveDesignIntentSignal({ declaredTaskType: 'design.poster.v1' });
  assert.strictEqual(s.isDesign, true, '无校验器时行为不变（向后兼容）');
  assert.strictEqual(s.source, 'model_declaration');
  assert.strictEqual(s.taskTypeId, 'design.poster.v1');
});

check('校验器不影响行为足迹路径（真动手做设计仍激活，与声明无关）', () => {
  const log = [
    { name: 'createDocument', result: { success: true } },
    { name: 'placeImage', result: { success: true } },
    { name: 'setTextContent', result: { success: true } }
  ];
  const s = resolveDesignIntentSignal({ toolCallLog: log, isValidTaskTypeId: isRegisteredDesignTaskTypeId });
  assert.strictEqual(s.isDesign, true);
  assert.strictEqual(s.source, 'tool_footprint');
});

console.log('\nintent-declaration-foundation smoke passed');
