#!/usr/bin/env node
'use strict';

/**
 * SKU 确认续跑边界：
 * - ChatPanel 只提交结构化 card submission，并绑定原 pending continuation；
 * - SKU Skill 自己解释 slot → 真实颜色和自选备注；
 * - 历史确认文本解析只保留兼容，不再是当前 UI 的执行桥；
 * - 确认不会重新进入自然语言路由或第二套模型规划。
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
function read(relativePath) {
    return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}
function assert(condition, message) {
    if (condition) return;
    console.error(`[FAIL] ${message}`);
    process.exit(1);
}

const chatPanel = read('src/renderer/components/ChatPanel.tsx');
const engine = read('src/renderer/services/design-agent/engine.ts');
const executor = read('src/renderer/services/skill-executors/sku-batch.executor.ts');

assert(chatPanel.includes('buildInteractiveCardSubmissionDecision'),
    'ChatPanel 必须从来源消息解析原 continuation');
assert(chatPanel.includes('claimInteractiveContinuationOperation'),
    'ChatPanel 必须在续跑前把确认登记到持久化操作账本');
assert(chatPanel.includes('interactiveContinuationRequest: decision.request'),
    'ChatPanel 必须提交结构化 continuation request');
assert(chatPanel.indexOf('await send({') < chatPanel.lastIndexOf('finalizeResumedInteractiveCardSubmission(decision)'),
    '业务卡必须在承接执行结束后再标记为已消费');
assert(chatPanel.includes('!interactiveContinuationRequest && (userInput || imageToSend)'),
    '确认续跑不得新增一条合成 user message');
assert(!chatPanel.includes('formatSkuConfirmedCombosForResume'),
    '当前 UI 不得再把结构化组合降级成可解析文本');

assert(engine.includes('if (context.interactiveContinuationRequest)'),
    'Engine 必须在普通路由前识别 continuation');
assert(engine.includes('resolveInteractiveContinuationOperationRequest'),
    'Engine 必须从操作账本恢复权威 operation，不能依赖可变对话消息');
assert(engine.includes('getInteractiveContinuationOperation'),
    'Engine 必须先读取冻结的 continuation envelope 再校验');
assert(engine.includes('beginInteractiveContinuationOperation'),
    'Engine 必须先从持久化账本取得唯一执行权');
assert(engine.includes('executeSkillTool(resolution.skillId'),
    'Engine 必须通过统一 Skill 执行入口续接原能力，保留设置与执行点门禁');
assert(engine.includes('settleInteractiveContinuationOperation'),
    'Engine 必须在执行后结算持久化账本，禁止崩溃后自动重放');
assert(
    engine.indexOf('getInteractiveContinuationOperation(request.continuationId)')
        < engine.indexOf('resolveInteractiveContinuationOperationRequest({')
    && engine.indexOf('resolveInteractiveContinuationOperationRequest({')
        < engine.indexOf('beginInteractiveContinuationOperation({')
    && engine.indexOf('beginInteractiveContinuationOperation({')
        < engine.indexOf('executeSkillTool(resolution.skillId'),
    'Engine 必须先校验冻结 envelope，再在执行前最后一刻取得唯一执行权'
);

assert(executor.includes('function resolveStructuredSkuComboConfirmation'),
    'SKU Skill 必须有结构化确认 consumer');
assert(executor.includes('validateSkuComboEditorValue(card.payload, submission.value)'),
    '结构化提交必须由原卡片 payload 再校验');
assert(executor.includes('resolveStructuredSkuComboConfirmation(params, validColors)'),
    'SKU 执行路径必须消费结构化 submission');
assert(executor.includes('confirmedResumeCombos = structuredComboConfirmation.combos'),
    '结构化确认组合必须拥有最高优先级');
assert(executor.includes('structuredComboConfirmation.generateSelfSelectNotes'),
    '自选备注开关必须从结构化提交承接');
assert(executor.includes('structuredComboConfirmation.provided'),
    '结构化提交必须直接标记确认已通过，避免重复出卡');

assert(executor.includes('function parseConfirmedSkuCombosFromResumeText'),
    '历史会话文本兼容解析暂时保留');
assert(!executor.includes('planSkuIntentWithModel'),
    'SKU 执行器不应二次调用模型重解释主 Agent 已规划的需求');
assert(!executor.includes('modelPlan'),
    'SKU 执行器不应保留第二套模型计划分支');

console.log('[smoke-sku-confirmed-combo-resume] passed');
