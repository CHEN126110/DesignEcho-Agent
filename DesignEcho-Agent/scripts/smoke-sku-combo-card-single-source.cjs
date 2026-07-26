#!/usr/bin/env node
'use strict';

/**
 * smoke: SKU 组合确认卡单一来源（治理2026-07-01 根因修复）
 *
 * 背景（真实缺陷）：
 *  用户"帮我做SKU"时弹出的组合卡偏离预期、且提交也无法完成 SKU。根因是存在一条"影子路径"——
 *  createInteractiveCard(cardKind='sku_combo_editor') 会用【模型自己传入】的 colorSlots/组合建卡，
 *  完全不跑规范生成器、也绕过整个 sku-batch 管线，于是得到空/臆造的组合卡，提交也接不回出图。
 *  更糟的是工具清单描述还主动误导模型"SKU 组合用 cardKind='sku_combo_editor'"，与 schema 里
 *  "do NOT use this for SKU work" 自相矛盾。
 *
 * 修复口径：SKU 组合确认卡只能有【单一来源】= sku-batch 技能（经生成器 + buildSkuComboConfirmationRequest
 *  把真实组合预填进可编辑组合表）。createInteractiveCard 不再承担 SKU 组合卡：
 *   ① tool-schemas.ts 的 createInteractiveCard enum 移除 'sku_combo_editor'（模型无法请求）。
 *   ② tool-executor.service.ts 的 sku_combo_editor 分支改为"明确拒绝并指路 sku-batch"（不静默兜底建空卡）。
 *   ③ 工具清单描述不再宣传 sku_combo_editor，改为指路 sku-batch（与 schema 描述一致，消除矛盾）。
 *   ④ sku-batch 正路（buildSkuComboConfirmationRequest → buildSkuComboEditorInteractiveCard）保持完好。
 *
 * 本 smoke 用源码契约钉桩锁住修复（不 import 带 window 依赖的执行器）。
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
function read(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }
function assert(cond, msg) { if (!cond) { console.error(`[FAIL] ${msg}`); process.exit(1); } }

const toolSchemas = read('src/renderer/services/agent-runtime/tool-schemas.ts');
const toolExecutor = read('src/renderer/services/tool-executor.service.ts');
const confirmationRequest = read('src/shared/sku-combo-confirmation-request.ts');

// ① createInteractiveCard 的 cardKind enum 不得再包含 sku_combo_editor
const enumMatch = toolSchemas.match(/cardKind:\s*\{\s*type:\s*'string',\s*enum:\s*\[([^\]]*)\]/);
assert(enumMatch, '应能在 tool-schemas.ts 找到 createInteractiveCard 的 cardKind enum');
assert(!/sku_combo_editor/.test(enumMatch[1]),
    'createInteractiveCard 的 cardKind enum 不得再包含 sku_combo_editor（模型不得自建 SKU 组合卡）');
assert(/editable_confirmation/.test(enumMatch[1]) && /generic_confirmation/.test(enumMatch[1]),
    'createInteractiveCard 仍应保留 editable_confirmation/generic_confirmation 两种通用卡');

// ② tool-executor 的 sku_combo_editor 分支必须是"拒绝并指路"，不得再建卡
const branchIdx = toolExecutor.indexOf("cardKind === 'sku_combo_editor'");
assert(branchIdx >= 0, 'tool-executor 应仍显式拦截 sku_combo_editor（防御纵深）');
const branchSlice = toolExecutor.slice(branchIdx, branchIdx + 900);
assert(/success:\s*false/.test(branchSlice),
    'sku_combo_editor 分支应返回 success:false（拒绝而非静默兜底建卡）');
assert(/sku-batch/.test(branchSlice) && /requireSkuComboConfirmation/.test(branchSlice),
    'sku_combo_editor 拒绝信息应明确指路 sku-batch（requireSkuComboConfirmation=true）');
assert(!/buildSkuComboEditorInteractiveCard\(/.test(branchSlice),
    'sku_combo_editor 分支不得再调用 buildSkuComboEditorInteractiveCard 建影子卡');
assert(!/buildSkuComboEditorInteractiveCard/.test(toolExecutor),
    'tool-executor 不应再引用 buildSkuComboEditorInteractiveCard（影子路径已铲除、导入已清理）');

// ③ 工具清单描述不得再宣传 sku_combo_editor，且应指路 sku-batch（消除与 schema 的矛盾）
const listDescIdx = toolExecutor.indexOf("name: 'createInteractiveCard'");
assert(listDescIdx >= 0, '应能在 tool-executor 找到 createInteractiveCard 的工具清单描述');
const listDescSlice = toolExecutor.slice(listDescIdx, listDescIdx + 900);
assert(!/sku_combo_editor/.test(listDescSlice),
    'createInteractiveCard 工具清单描述不得再出现 sku_combo_editor（此前误导模型自建 SKU 卡）');
assert(/sku-batch/.test(listDescSlice),
    'createInteractiveCard 工具清单描述应指路 sku-batch 承担 SKU 组合确认');

// schema 描述也应保持"禁止用于 SKU"的告警（单一来源的另一半防线）
const schemaDescMatch = toolSchemas.match(/name:\s*'createInteractiveCard',\s*description:\s*'([^']*)'/);
assert(schemaDescMatch, '应能读到 createInteractiveCard 的 schema 描述');
assert(/sku-batch/i.test(schemaDescMatch[1]) && /do NOT use this for SKU/i.test(schemaDescMatch[1]),
    'createInteractiveCard 的 schema 描述应仍明确禁止用于 SKU 并指路 sku-batch');

// ④ sku-batch 正路必须保持完好：仍用生成器组合 + buildSkuComboEditorInteractiveCard 预填建卡
assert(/buildSkuComboEditorInteractiveCard\(/.test(confirmationRequest),
    'sku-batch 正路（buildSkuComboConfirmationRequest）应仍用 buildSkuComboEditorInteractiveCard 建真实组合卡');
assert(/combosBySize/.test(confirmationRequest) && /initialValue/.test(confirmationRequest),
    'sku-batch 正路应把生成器算出的 combosBySize 预填进卡的 initialValue（组合来自生成器而非模型即兴）');

console.log('[smoke-sku-combo-card-single-source] passed');
