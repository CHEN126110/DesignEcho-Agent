#!/usr/bin/env node
'use strict';

/**
 * smoke: SKU 组合确认卡前的「按规格严格」模板预检（治理2026-07-02）
 *
 * 背景（真实缺陷，用户实测）：Agent 看过项目文件、知道项目里没有排版模板，却仍然弹出
 * SKU 组合确认卡；用户确认后执行必然失败（执行期 resolveComboTemplateDocument 按规格找不到模板）。
 * 根因：组合确认卡之前的模板门是「宽松计数」(有没有任意模板)，而执行期是「按规格」严格；
 * 真正按规格的 missingTemplateCandidate 只喂给被 shouldAllowSkuCardTemplatePreparation 开关跳过的
 * 准备/设计块，未在默认路径拦截。
 *
 * 修复口径：在【组合确认卡门(shouldRequestSkuComboConfirmation)之前】加一道 per-size 预检，
 * 用与执行【同源同粒度】的判据（hasTemplateCandidate 项目+库 + findOpenedTemplateDocument 已打开），
 * 任一所需规格没有可解析模板就直接失败并指路，不弹卡、不让用户白确认。
 *
 * 本 smoke 用源码契约钉桩（不 import 带 window 依赖的执行器）：
 *  ① 预检存在且用同源同粒度判据；② 预检位置在组合确认卡门之前；③ 失败信息指路且不弹卡。
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const executor = fs.readFileSync(
    path.join(ROOT, 'src/renderer/services/skill-executors/sku-batch.executor.ts'),
    'utf8'
);
function assert(cond, msg) { if (!cond) { console.error(`[FAIL] ${msg}`); process.exit(1); } }

// ① 预检存在：按规格计算不可解析规格
assert(executor.includes('unresolvableComboSizes'),
    '应有 per-size 模板预检（unresolvableComboSizes）');
// 同源同粒度：项目+库(hasTemplateCandidate) + 已打开(findOpenedTemplateDocument)
assert(/unresolvableComboSizes[\s\S]{0,220}hasTemplateCandidate\(size, false\)[\s\S]{0,120}findOpenedTemplateDocument\(\{ size, noteMode: false \}\)/.test(executor),
    '预检应用与执行同源同粒度的判据：hasTemplateCandidate(项目+库) + findOpenedTemplateDocument(已打开)');

// ② 位置：per-size 预检必须在组合确认卡门之前（否则先弹卡再失败，没意义）
const preflightIdx = executor.indexOf('unresolvableComboSizes');
const comboGateIdx = executor.indexOf('const shouldRequestSkuComboConfirmation');
assert(preflightIdx >= 0 && comboGateIdx >= 0, '应能定位 per-size 预检与组合确认卡门');
assert(preflightIdx < comboGateIdx,
    'per-size 模板预检必须在组合确认卡门(shouldRequestSkuComboConfirmation)之前触发');

// ③ 失败即指路、明确不弹卡：返回 success:false + 指出缺失规格 + 状态标记
const block = executor.slice(preflightIdx, comboGateIdx);
assert(/status: 'blocked_missing_per_size_template'/.test(block),
    '预检拦截应返回 status=blocked_missing_per_size_template');
assert(/success: false/.test(block) && /没有可用/.test(block),
    '预检拦截应 success:false 且给出"没有可用模板"的清晰用户信息');
assert(/模板文件|打开对应规格|设计一版可编辑模板/.test(block),
    '预检拦截信息应指路（放模板/打开模板/设计模板），不是空泛失败');

console.log('[smoke-sku-per-size-template-preflight] passed');
