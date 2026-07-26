#!/usr/bin/env node
'use strict';

/**
 * 文档状态误判链与门禁误伤修复的回归护栏。
 *
 * 背景（2026-07-25 AGENT-DOCSTATE-AND-GATE-FIX-001）：用户已打开模板 PSD，
 * Agent「读取文档信息」因瞬时故障（modal/超时/PS 忙）失败后，被二次探测升级成
 * "没有打开的文档"断言并禁止复核，导致零写入收尾。本 smoke 钉住以下纪律：
 *
 * 1. 只有结构化证据（documentState:'absent' / errorCode:'no_active_document'）能断言无文档；
 *    探测未知必须保持中性，且中性文案不得包含「无文档恢复」分支的触发字样。
 * 2. UXP getDocumentInfo 把 modal/超时类失败透出 retryable，不伪装成无文档。
 * 3. 多主选择互斥：Eagle 多选组在页面切换与任何新唯一主选时都被清理；
 *    multiple_primary_selections 的 throw 不被吞成笼统"运行异常"。
 * 4. respect_system_boundary 有明确收尾分支，不整轮硬停进笼统文案。
 * 5. 「下一步」去重按状态前缀结尾匹配，不复读结论。
 * 6. 零写入运行豁免「写后结构读回/跨屏视觉复核」检查。
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const agentRoot = path.resolve(__dirname, '..');
const uxpRoot = path.resolve(agentRoot, '..', 'DesignEcho-UXP');

function readAgent(relativePath) {
  return fs.readFileSync(path.join(agentRoot, relativePath), 'utf8');
}
function readUxp(relativePath) {
  return fs.readFileSync(path.join(uxpRoot, relativePath), 'utf8');
}

const NO_DOCUMENT_TRIGGER = /没有打开的文档|没有活动文档|no active document/i;

// ---------- 1. tool-executor：结构化探测 + 中性未知文案 ----------
const executor = readAgent('src/renderer/services/tool-executor.service.ts');
assert(executor.includes('probeCurrentDocumentPresence'), 'executor must use a structured document presence probe');
assert(
  executor.includes("result?.documentState === 'absent' || result?.errorCode === 'no_active_document'"),
  'absent may only be asserted from structured UXP evidence'
);
assert(executor.includes('（经结构化确认）'), 'absent claims must be marked as structurally confirmed');

const unknownSuffix = '文档状态暂时无法确认：本次失败不代表文档已关闭（Photoshop 可能正忙），可稍后重试确认。';
assert(executor.includes(unknownSuffix), 'unknown presence must stay neutral in the failure suffix');
assert(!NO_DOCUMENT_TRIGGER.test(unknownSuffix), 'neutral suffix must not contain the no-document trigger phrase');

const writePreflightHold = '本次写入已暂缓；这不代表文档已关闭，请稍后重试。';
assert(executor.includes(writePreflightHold), 'write preflight must hold (not misreport) on unknown presence');
assert(!NO_DOCUMENT_TRIGGER.test(writePreflightHold), 'write preflight hold must not claim no document');

// ---------- 2. UXP getDocumentInfo：modal/超时透出 retryable ----------
const uxpGetDocumentInfo = readUxp('src/tools/canvas/get-document-info.ts');
assert(uxpGetDocumentInfo.includes('retryable'), 'UXP must expose retryable semantics for transient failures');
assert(/busyLike[\s\S]*modal|modal[\s\S]*busyLike/.test(uxpGetDocumentInfo), 'UXP must classify modal/busy rejections');
const uxpBusyText = 'Photoshop 正忙或处于模态状态，暂时无法读取文档信息；这不代表文档不存在，请稍后重试。';
assert(uxpGetDocumentInfo.includes(uxpBusyText), 'UXP busy copy must explain transience honestly');
assert(!NO_DOCUMENT_TRIGGER.test(uxpBusyText), 'UXP busy copy must not contain the no-document trigger phrase');
assert(
  uxpGetDocumentInfo.includes("observationCode === 'no_active_document' ? 'absent' : 'unknown'"),
  'UXP must keep absent strictly bound to no_active_document'
);

// ---------- 3. Workbench：Eagle 多选组随唯一主选清理 + executor 透出可操作文案 ----------
const workbench = readAgent('src/renderer/components/DesignAgentWorkbench.tsx');
const groupClearCount = (workbench.match(/setSelectedEagleAssetGroup\(null\)/g) || []).length;
assert(groupClearCount >= 3, 'Eagle asset group must be cleared on page switch and on every new primary selection');

const autonomousExecutor = readAgent('src/renderer/services/skill-executors/autonomous-agent.executor.ts');
assert(
  autonomousExecutor.includes('operating_context_ambiguous_primary_selection'),
  'ambiguous primary selection must surface its actionable message instead of a generic failure'
);
assert(
  autonomousExecutor.includes('处理过程中出现运行异常'),
  'generic runtime failure fallback must remain for unknown failures'
);

// ---------- 4. agent.ts：respect_system_boundary 明确收尾分支 ----------
const agent = readAgent('src/renderer/services/agent-runtime/agent.ts');
assert(
  agent.includes("toolDecisionContract.nextAction === 'respect_system_boundary'"),
  'respect_system_boundary must have an explicit graceful-ending branch'
);
assert(
  agent.includes('Photoshop 连接不可用'),
  'system boundary ending must tell the user what is missing and how to recover'
);

// ---------- 5. 「下一步」去重按结尾匹配剥掉状态前缀 ----------
assert(
  agent.includes('summaryKey.endsWith(blockerKey)'),
  'verification next-step dedupe must strip the status prefix via endsWith matching'
);

// ---------- 6. 零写入豁免写后检查 ----------
assert(
  agent.includes("check.key !== 'fresh_structure_snapshot' && check.key !== 'fresh_visual_evaluation'"),
  'zero-mutation runs must be exempt from post-write structure/visual checks'
);
assert(
  agent.includes('effectiveEvaluationProfile'),
  'the zero-mutation exemption must flow through an effective profile, not mutate the shared one'
);

console.log(JSON.stringify({
  success: true,
  checks: [
    'absent is only asserted from structured UXP evidence; unknown presence stays neutral',
    'neutral copies never contain the no-document trigger phrase',
    'UXP surfaces retryable semantics for modal/busy rejections',
    'Eagle asset group is cleared on page switch and new primary selections',
    'ambiguous primary selection surfaces an actionable message',
    'respect_system_boundary ends gracefully with a clear recovery copy',
    'verification next-step dedupe strips the status prefix',
    'zero-mutation runs skip post-write structure/visual checks via an effective profile'
  ]
}, null, 2));
