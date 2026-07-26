'use strict';

/**
 * smoke: 完成观察门禁（治幻觉式完成）——红线1-4。
 *
 * 分三部分：
 * (1) 纯函数单元判定：no_mutation / has_observation / export_only / single_self_verifying_mechanical /
 *     mutation_without_observation，以及只有最后一次写入后的 inspect / read 才被判为观察（红线3）。
 * (2) 执行器重入循环复现（红线4）：用【真实】的 evaluateCompletionObservationGate 与
 *     【真实】的 decideQualityAwareReflexionReentry，忠实复现 autonomous-agent.executor.ts:1619-1706
 *     的重入循环控制流，断言"有 mutation 零观察 → needs_review 且不重跑（模型只被调 1 次、原 mutation
 *     只发生 1 次、handoff 被抑制）"；并用一个真实质量失败的对照组证明重入循环本身仍会返工（未被误关）。
 * (3) 源码接线断言：agent.ts 确实调门禁、置终态旗标、handoff 顶部据旗标短路；preflight 已 export
 *     SIMPLE_MECHANICAL_GUARDED_TOOLS；门禁模块用 classifyAgentToolExecution 带参分类；且 handoff
 *     生产点唯一（防未来新增第二条 handoff 生产路径绕过旗标短路）。
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');

require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(repoRoot, 'tsconfig.main.json')
});

const { evaluateCompletionObservationGate } = require(
  path.resolve(repoRoot, 'src', 'shared', 'completion-observation-gate.ts')
);
const { decideQualityAwareReflexionReentry } = require(
  path.resolve(repoRoot, 'src', 'shared', 'reflexion-reentry-policy.ts')
);
const { buildPhotoshopHistoryTransition } = require(
  path.resolve(repoRoot, 'src', 'shared', 'photoshop-history-state-ref.ts')
);

function check(name, fn) {
  fn();
  console.log(`  ✓ ${name}`);
}

function documentResult(documentId, extra = {}) {
  return {
    success: true,
    documentInfo: { id: documentId, name: `doc-${documentId}` },
    ...extra
  };
}

console.log('smoke: completion-observation-gate');

// ---------- (1) 纯函数单元判定 ----------
check('no_mutation：纯只读运行不适用门禁', () => {
  const g = evaluateCompletionObservationGate([
    { name: 'getLayerHierarchy', arguments: {}, succeeded: true }
  ]);
  assert.strictEqual(g.downgrade, false);
  assert.strictEqual(g.terminal, false);
  assert.strictEqual(g.reason, 'no_mutation');
});

check('has_observation：最后一次修改后读过文档 → 不降级', () => {
  const g = evaluateCompletionObservationGate([
    { name: 'duplicateLayer', arguments: { layerId: 1 }, succeeded: true },
    { name: 'moveLayer', arguments: { layerId: 1 }, succeeded: true },
    { name: 'getLayerHierarchy', arguments: {}, succeeded: true }
  ]);
  assert.strictEqual(g.observationCount, 1);
  assert.strictEqual(g.downgrade, false);
  assert.strictEqual(g.reason, 'has_observation');
});

check('开工观察早于修改 → 不能冒充写后复核', () => {
  const g = evaluateCompletionObservationGate([
    { name: 'getAnnotatedSnapshot', arguments: {}, succeeded: true },
    { name: 'duplicateLayer', arguments: { layerId: 1 }, succeeded: true },
    { name: 'moveLayer', arguments: { layerId: 1 }, succeeded: true }
  ]);
  assert.strictEqual(g.observationCount, 0);
  assert.strictEqual(g.downgrade, true);
  assert.strictEqual(g.reason, 'mutation_without_observation');
});

check('两次修改之间的观察 → 被最后一次修改作废', () => {
  const g = evaluateCompletionObservationGate([
    { name: 'duplicateLayer', arguments: { layerId: 1 }, succeeded: true },
    { name: 'getLayerHierarchy', arguments: {}, succeeded: true },
    { name: 'moveLayer', arguments: { layerId: 1 }, succeeded: true }
  ]);
  assert.strictEqual(g.observationCount, 0);
  assert.strictEqual(g.downgrade, true);
});

check('save/export 不改变画布版本 → 保留此前写后观察', () => {
  const g = evaluateCompletionObservationGate([
    { name: 'duplicateLayer', arguments: { layerId: 1 }, succeeded: true },
    { name: 'getLayerHierarchy', arguments: {}, succeeded: true },
    { name: 'saveDocument', arguments: {}, succeeded: true }
  ]);
  assert.strictEqual(g.observationCount, 1);
  assert.strictEqual(g.downgrade, false);
  assert.strictEqual(g.reason, 'has_observation');
});

check('跨文档读取不能验证最后一次画布修改', () => {
  const g = evaluateCompletionObservationGate([
    { name: 'placeImage', arguments: { path: 'p.png' }, result: documentResult(101), succeeded: true },
    { name: 'switchDocument', arguments: { documentId: 202 }, result: documentResult(202), succeeded: true },
    { name: 'getDocumentInfo', arguments: {}, result: documentResult(202), succeeded: true }
  ]);
  assert.strictEqual(g.observationCount, 0);
  assert.strictEqual(g.downgrade, true);
  assert.strictEqual(g.reason, 'mutation_without_observation');
});

check('项目记忆读取不能取得 Photoshop 写后复核信用', () => {
  const g = evaluateCompletionObservationGate([
    { name: 'placeImage', arguments: { path: 'p.png' }, result: documentResult(101), succeeded: true },
    { name: 'getDesignProjectState', arguments: {}, result: { success: true, state: {} }, succeeded: true }
  ]);
  assert.strictEqual(g.observationCount, 0);
  assert.strictEqual(g.downgrade, true);
});

check('export_only：mutation 全是导出（零观察）→ 豁免（红线2 / V0-6 导出=只读）', () => {
  const g = evaluateCompletionObservationGate([
    { name: 'exportMainImageDocuments', arguments: { outputDir: 'x' }, succeeded: true },
    { name: 'quickExport', arguments: { outputPath: 'y.png' }, succeeded: true }
  ]);
  assert.strictEqual(g.mutationCount, 2);
  assert.strictEqual(g.observationCount, 0);
  assert.strictEqual(g.downgrade, false);
  assert.strictEqual(g.reason, 'export_only');
});

check('single_self_verifying_mechanical：单个简单机械 mutation（零观察）→ 豁免（红线2）', () => {
  const g = evaluateCompletionObservationGate([
    { name: 'renameLayer', arguments: { layerId: 1, name: 'A' }, succeeded: true }
  ]);
  assert.strictEqual(g.mutationCount, 1);
  assert.strictEqual(g.downgrade, false);
  assert.strictEqual(g.reason, 'single_self_verifying_mechanical');
});

check('单个机械写入后保存仍保留机械豁免', () => {
  const g = evaluateCompletionObservationGate([
    { name: 'renameLayer', arguments: { layerId: 1, name: 'A' }, succeeded: true },
    { name: 'saveDocument', arguments: {}, succeeded: true }
  ]);
  assert.strictEqual(g.mutationCount, 2);
  assert.strictEqual(g.downgrade, false);
  assert.strictEqual(g.reason, 'single_self_verifying_mechanical');
});

check('executor 子 Agent 按潜在 Photoshop 写入处理', () => {
  const g = evaluateCompletionObservationGate([
    { name: 'delegateToAgent', arguments: { role: 'executor', task: '移动图层' }, succeeded: true }
  ]);
  assert.strictEqual(g.mutationCount, 1);
  assert.strictEqual(g.downgrade, true);
  assert.strictEqual(g.reason, 'mutation_without_observation');
});

check('mutation_without_observation：多步写入 + 零观察 → 降级且终态', () => {
  const g = evaluateCompletionObservationGate([
    { name: 'duplicateLayer', arguments: { layerId: 1 }, succeeded: true },
    { name: 'moveLayer', arguments: { layerId: 1 }, succeeded: true }
  ]);
  assert.strictEqual(g.observationCount, 0);
  assert.strictEqual(g.mutationCount, 2);
  assert.strictEqual(g.downgrade, true);
  assert.strictEqual(g.terminal, true);
  assert.strictEqual(g.reason, 'mutation_without_observation');
});

check('单个非机械写入（如 placeImage，零观察）→ 降级（不在简单机械白名单）', () => {
  const g = evaluateCompletionObservationGate([
    { name: 'placeImage', arguments: { path: 'p.png' }, succeeded: true }
  ]);
  assert.strictEqual(g.mutationCount, 1);
  assert.strictEqual(g.downgrade, true);
  assert.strictEqual(g.reason, 'mutation_without_observation');
});

check('红线3：inspect 模式技能（带 args）被判为观察，不被漏算', () => {
  const layerInspect = evaluateCompletionObservationGate([
    { name: 'duplicateLayer', arguments: { layerId: 1 }, succeeded: true },
    { name: 'moveLayer', arguments: { layerId: 1 }, succeeded: true },
    { name: 'layer-management', arguments: { action: 'inspect' }, succeeded: true }
  ]);
  assert.strictEqual(layerInspect.observationCount, 1, 'layer-management action:inspect 应计为观察');
  assert.strictEqual(layerInspect.downgrade, false);

  const skuList = evaluateCompletionObservationGate([
    { name: 'duplicateLayer', arguments: { layerId: 1 }, succeeded: true },
    { name: 'moveLayer', arguments: { layerId: 1 }, succeeded: true },
    { name: 'skuLayout', arguments: { action: 'listLayerSets' }, succeeded: true }
  ]);
  assert.strictEqual(skuList.observationCount, 1, 'skuLayout action:listLayerSets 应计为观察');
  assert.strictEqual(skuList.downgrade, false);
});

check('失败调用不计观察也不计 mutation', () => {
  const g = evaluateCompletionObservationGate([
    { name: 'getLayerHierarchy', arguments: {}, succeeded: false },
    { name: 'duplicateLayer', arguments: { layerId: 1 }, succeeded: true },
    { name: 'moveLayer', arguments: { layerId: 1 }, succeeded: true }
  ]);
  assert.strictEqual(g.observationCount, 0, '失败的读取不算观察');
  assert.strictEqual(g.downgrade, true);
});

check('失败但 Host 版本已变化的写调用仍重置写后观察', () => {
  const g = evaluateCompletionObservationGate([
    { name: 'duplicateLayer', arguments: { layerId: 1 }, result: documentResult(101), succeeded: true },
    { name: 'getLayerHierarchy', arguments: {}, result: documentResult(101), succeeded: true },
    {
      name: 'moveLayer',
      arguments: { layerId: 1 },
      succeeded: false,
      result: {
        success: false,
        error: 'tool failed after mutating Photoshop',
        photoshopHistoryTransition: buildPhotoshopHistoryTransition(
          { historyStateRef: { documentId: 101, historyStateId: 10 } },
          { historyStateRef: { documentId: 101, historyStateId: 11 } }
        )
      }
    }
  ]);
  assert.strictEqual(g.mutationCount, 2);
  assert.strictEqual(g.observationCount, 0);
  assert.strictEqual(g.downgrade, true);
  assert.strictEqual(g.reason, 'mutation_without_observation');
});

check('失败但动作已执行的写调用保守作为旧观察失效屏障', () => {
  const g = evaluateCompletionObservationGate([
    { name: 'getLayerHierarchy', arguments: {}, result: documentResult(101), succeeded: true },
    {
      name: 'moveLayer',
      arguments: { layerId: 1 },
      succeeded: false,
      result: {
        success: false,
        toolActionCompleted: true,
        error: 'acceptance failed after action'
      }
    }
  ]);
  assert.strictEqual(g.mutationCount, 1);
  assert.strictEqual(g.observationCount, 0);
  assert.strictEqual(g.downgrade, true);
});

// ---------- (2) 执行器重入循环复现（红线4） ----------
// 忠实复现 autonomous-agent.executor.ts:1619-1706 的控制流：
//   while (!result.cancelled) { ...; const reflexionHandoff = data?.reflexionHandoff || summary?.reflexionHandoff;
//     const d = decideQualityAwareReflexionReentry({...}); if (!d.shouldReenter || !reflexionHandoff) break; ...run() }
// 用真实门禁 + 真实决策函数驱动，不绕过重入循环。
function runExecutorReentryLoop(makeResult) {
  let runCount = 0;
  const mutationLog = [];
  let reflexionReentryCount = 0;
  let previousReflexionFailureSignature;
  const designScorecardHistory = [];

  let result = makeResult(++runCount, mutationLog);
  while (!result.cancelled) {
    const awaitingUserConfirmation = result.stopReason === 'awaiting_user_confirmation'
      || (result.data && result.data.awaitingUserConfirmation === true);
    if (awaitingUserConfirmation) break;
    const latestScorecard = result.executionSummary && result.executionSummary.designScorecard;
    if (latestScorecard) designScorecardHistory.push(latestScorecard);
    const reflexionHandoff = (result.data && result.data.reflexionHandoff)
      || (result.executionSummary && result.executionSummary.reflexionHandoff);
    const reentryDecision = decideQualityAwareReflexionReentry({
      handoff: reflexionHandoff,
      priorReentryCount: reflexionReentryCount,
      cancelled: false,
      previousFailureSignature: previousReflexionFailureSignature,
      scorecardHistory: designScorecardHistory
    });
    if (!reentryDecision.shouldReenter || !reflexionHandoff) break;
    reflexionReentryCount = reentryDecision.reentryCount;
    previousReflexionFailureSignature = reentryDecision.failureSignature;
    result = makeResult(++runCount, mutationLog);
  }
  return { runCount, mutationLog, result };
}

// 每轮 run 的产物构造，复刻 agent.ts 契约：门禁降级 → status=needs_review + downgradedByObservationGate
// → handoff 被抑制（undefined）；这正是 buildQualityGateReflexionHandoff 顶部短路要落地的行为。
function makeObservationGateRun(runIndex, mutationLog) {
  // 模拟"复制这个图层"：多步写入、零观察。每次 run 施加一次 mutation（用于验证"只发生 1 次"）。
  mutationLog.push(`duplicateLayer#run${runIndex}`);
  const toolCallLog = [
    { name: 'duplicateLayer', arguments: { layerId: 1 }, result: { success: true } },
    { name: 'moveLayer', arguments: { layerId: 1 }, result: { success: true } }
  ];
  const gate = evaluateCompletionObservationGate(
    toolCallLog.map((e) => ({ name: e.name, arguments: e.arguments, succeeded: e.result.success !== false }))
  );
  const downgraded = gate.downgrade; // baseStatus 本会是 completed
  const status = downgraded ? 'needs_review' : 'completed';
  // 红线1：终态降级 → 抑制 handoff（与 agent.ts buildQualityGateReflexionHandoff 顶部短路一致）。
  const reflexionHandoff = downgraded ? undefined : {
    status: 'reflexion_required',
    failureAnalysis: ['x'],
    nextRoundConstraints: ['y']
  };
  return {
    cancelled: false,
    stopReason: 'final_response',
    toolCallLog,
    executionSummary: { status, downgradedByObservationGate: downgraded, reflexionHandoff },
    data: reflexionHandoff ? { reflexionHandoff } : undefined
  };
}

check('红线4：有 mutation 零观察 → needs_review 且不重跑（run=1、mutation=1、handoff 被抑制）', () => {
  const { runCount, mutationLog, result } = runExecutorReentryLoop(makeObservationGateRun);
  assert.strictEqual(runCount, 1, '门禁降级是终态，模型只应被调 1 次（绝不重放原任务）');
  assert.strictEqual(mutationLog.length, 1, '原 mutation 只应发生 1 次（绝不重复置入/复制）');
  assert.strictEqual(result.executionSummary.status, 'needs_review');
  assert.strictEqual(result.executionSummary.downgradedByObservationGate, true);
  assert.strictEqual(result.executionSummary.reflexionHandoff, undefined, '终态降级必须抑制 handoff');
});

// 对照组：真实质量失败（有观察、非门禁降级）→ handoff 存在 → 重入循环仍会返工（证明没把循环误关）。
function makeGenuineFailureRun(runIndex, mutationLog) {
  mutationLog.push(`renderLayout#run${runIndex}`);
  const toolCallLog = [
    { name: 'renderLayout', arguments: {}, result: { success: true } },
    { name: 'getLayerHierarchy', arguments: {}, result: { success: true } }
  ];
  const gate = evaluateCompletionObservationGate(
    toolCallLog.map((e) => ({ name: e.name, arguments: e.arguments, succeeded: e.result.success !== false }))
  );
  assert.strictEqual(gate.downgrade, false, '对照组有观察，门禁不应降级');
  // 稳定失败签名：第 1 次重入后，第 2 次因 max_reentries/no_progress 停 → 总 run 数应为 2。
  const reflexionHandoff = {
    status: 'reflexion_required',
    failureAnalysis: ['设计质量未达标'],
    nextRoundConstraints: ['补齐设计依据后重排']
  };
  return {
    cancelled: false,
    stopReason: 'final_response',
    toolCallLog,
    executionSummary: { status: 'needs_review', downgradedByObservationGate: false, reflexionHandoff },
    data: { reflexionHandoff }
  };
}

check('对照组：真实质量失败仍会自动返工（重入循环未被误关，run=2 后达上限停）', () => {
  const { runCount } = runExecutorReentryLoop(makeGenuineFailureRun);
  assert.strictEqual(runCount, 2, '真实 reflexion_required 应触发 1 次返工（初次 + 1 重入），随后达上限/无进展即停');
});

// ---------- (3) 源码接线断言 ----------
const agentSource = fs.readFileSync(
  path.resolve(repoRoot, 'src', 'renderer', 'services', 'agent-runtime', 'agent.ts'), 'utf8');
const preflightSource = fs.readFileSync(
  path.resolve(repoRoot, 'src', 'shared', 'agent-tool-execution-preflight.ts'), 'utf8');
const gateSource = fs.readFileSync(
  path.resolve(repoRoot, 'src', 'shared', 'completion-observation-gate.ts'), 'utf8');

function assertOrdered(source, tokens, message) {
  let cursor = -1;
  for (const token of tokens) {
    const pos = source.indexOf(token, cursor + 1);
    assert.ok(pos > cursor, `${message}\nmissing/out-of-order: ${token}`);
    cursor = pos;
  }
}

check('preflight 已导出 SIMPLE_MECHANICAL_GUARDED_TOOLS（单一事实源）', () => {
  assert.ok(preflightSource.includes('export const SIMPLE_MECHANICAL_GUARDED_TOOLS = new Set(['));
});

check('门禁模块用 classifyAgentToolExecution 带参分类（红线3口径一致）', () => {
  assert.ok(gateSource.includes('classifyAgentToolExecution(name, call?.arguments)'));
  assert.ok(gateSource.includes('isAgentToolExecutionGuarded(name, call?.arguments)'));
  assert.ok(gateSource.includes('SIMPLE_MECHANICAL_GUARDED_TOOLS'));
});

check('agent.ts 调门禁、只在 otherwise-completed 时降级、置终态旗标', () => {
  assert.ok(agentSource.includes("import { evaluateCompletionObservationGate } from '../../../shared/completion-observation-gate';"));
  assertOrdered(agentSource, [
    'const completionObservationGate = evaluateCompletionObservationGate(',
    'const baseStatus = this.resolveExecutionStatus(',
    "const downgradedByObservationGate = baseStatus === 'completed' && completionObservationGate.downgrade;",
    "const status: AgentExecutionSummary['status'] = downgradedByObservationGate ? 'needs_review' : baseStatus;",
    '...(downgradedByObservationGate ? { downgradedByObservationGate: true } : {}),'
  ], 'agent.ts 必须在基础状态判定后据门禁降级并写入终态旗标');
});

check('红线1：buildQualityGateReflexionHandoff 顶部据终态旗标短路（先于其余判定）', () => {
  assertOrdered(agentSource, [
    'private buildQualityGateReflexionHandoff(summary: AgentExecutionSummary)',
    'if (summary.downgradedByObservationGate) {',
    'return undefined;',
    "if (summary.status === 'completed'"
  ], 'handoff 抑制必须在 completed/cancelled 判定之前，确保门禁降级是真终态');
});

// 硬化断言（并入 design-alpha 核验必改建议）：reflexion handoff 的生产点必须唯一。
// 两处 handoff 赋值（executionSummary.reflexionHandoff = / data.reflexionHandoff =）都仅派生自
// buildRunResult 内那一次 this.buildQualityGateReflexionHandoff(...) 结果；若未来有人新增第二条
// handoff 生产路径，会绕过顶部旗标短路（红线1失效）——本断言让这种回归立即变红。
check('红线1硬化：handoff 生产点唯一（this.buildQualityGateReflexionHandoff 仅出现 1 次）', () => {
  const matches = agentSource.match(/this\.buildQualityGateReflexionHandoff\(/g) || [];
  assert.strictEqual(
    matches.length, 1,
    `handoff 生产点必须唯一，实际出现 ${matches.length} 次；新增的生产路径可能绕过 downgradedByObservationGate 旗标短路`
  );
});

console.log('\ncompletion-observation-gate smoke passed');
