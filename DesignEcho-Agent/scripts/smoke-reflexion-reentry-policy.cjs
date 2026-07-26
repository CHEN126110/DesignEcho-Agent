// 守护：Reflexion 重入决策（纯逻辑）。验证「阶段审核失败→带约束自动重跑」的护栏：
// 无 handoff / not_required / 已取消 / 超重入上限 / 无可执行约束 / 无进展 → 不重入；
// 正常情况 → 重入并注入下一轮约束。接线（executor 外层）单独实现，本 smoke 不依赖运行时。
//
// 语义扩展说明（2026-07 合流，用户拍板：质量返工 ≤3 轮、超限升级人工）：
// 基础策略 decideReflexionReentry 的语义与保守默认（≤1）不变，本文件既有桩全部保留；
// 涨分放宽到 ≤3 只走新增的 decideQualityAwareReflexionReentry（与质量停机控制器取更严格者），
// 其行为由 scripts/smoke-quality-loop-wiring.cjs 专门钉桩。本文件只追加合流常量的不变量。

const path = require('path');

require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '..', 'tsconfig.main.json')
});

const {
  decideReflexionReentry,
  buildReflexionFailureSignature,
  buildReflexionReentryMessage,
  DEFAULT_MAX_REFLEXION_REENTRIES,
  QUALITY_IMPROVING_MAX_REFLEXION_REENTRIES,
  decideQualityAwareReflexionReentry,
  isWarningOnlyNeedsReviewTerminal
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'reflexion-reentry-policy.ts'));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const baseHandoff = {
  status: 'reflexion_required',
  failureAnalysis: ['产物停在排版，没有设计感'],
  nextRoundConstraints: ['先补设计依据再开稿'],
  strategyAdjustments: []
};

// 软复核不是失败返工：没有 blocker 时保留首轮成果，不从头重放 mutation。
assert(
  isWarningOnlyNeedsReviewTerminal({ status: 'needs_review', blockers: [] }) === true,
  'warning-only needs_review 应作为终态复核边界'
);
assert(
  isWarningOnlyNeedsReviewTerminal({ status: 'needs_review', blockers: ['真实质量阻断'] }) === false,
  '带 blocker 的 needs_review 仍可进入失败处置'
);
assert(
  isWarningOnlyNeedsReviewTerminal({ status: 'failed', blockers: [] }) === false,
  'failed 不能被软复核规则吞掉'
);

// 正常重入：注入约束、计数 +1
const ok = decideReflexionReentry({ handoff: baseHandoff, priorReentryCount: 0, maxReentries: 1 });
assert(ok.shouldReenter === true && ok.reason === 'reentry', '有约束且未超限应重入');
assert(ok.injectedConstraints.includes('先补设计依据再开稿'), '应注入下一轮约束');
assert(ok.reentryCount === 1, '重入计数应 +1');

// 护栏：无 handoff
assert(decideReflexionReentry({ priorReentryCount: 0, maxReentries: 1 }).reason === 'no_handoff', '无 handoff 不重入');

// 护栏：not_required
assert(
  decideReflexionReentry({ handoff: { status: 'not_required' }, priorReentryCount: 0, maxReentries: 1 }).reason === 'not_required',
  'not_required 不重入'
);

// 护栏：已取消
assert(
  decideReflexionReentry({ handoff: baseHandoff, priorReentryCount: 0, maxReentries: 1, cancelled: true }).reason === 'cancelled',
  '已取消不重入'
);

// 护栏：超重入上限（防死循环）
assert(
  decideReflexionReentry({ handoff: baseHandoff, priorReentryCount: 1, maxReentries: 1 }).reason === 'max_reentries_reached',
  '达到重入上限不重入'
);

// 护栏：无可执行约束（重跑没新方向）
assert(
  decideReflexionReentry({
    handoff: { status: 'reflexion_required', failureAnalysis: ['x'], nextRoundConstraints: [], strategyAdjustments: [] },
    priorReentryCount: 0, maxReentries: 1
  }).reason === 'no_actionable_constraints',
  '无可执行约束不重入'
);

// 护栏：无进展（失败签名与上轮相同 → 原地打转）
const sig = buildReflexionFailureSignature(baseHandoff);
assert(sig.length > 0, '失败签名应非空');
assert(
  decideReflexionReentry({ handoff: baseHandoff, priorReentryCount: 0, maxReentries: 2, previousFailureSignature: sig }).reason === 'no_progress',
  '失败签名相同（无进展）不重入'
);

// 护栏：当前运行已经由循环判定 no_progress，不得从头自动重跑原任务
assert(
  decideReflexionReentry({
    handoff: baseHandoff,
    priorReentryCount: 0,
    maxReentries: 2,
    stopReason: 'no_progress'
  }).reason === 'no_progress',
  '当前运行已无进展时不应自动重入'
);
assert(
  decideQualityAwareReflexionReentry({
    handoff: baseHandoff,
    priorReentryCount: 0,
    scorecardHistory: [],
    stopReason: 'no_progress'
  }).reason === 'no_progress',
  '质量合流策略也必须遵守当前运行无进展停机'
);

// 防御性阶段边界：R0 是 planning owner，质量 Reflexion 不得把原始需求从头重跑。
const planningOwnerHandoff = {
  ...baseHandoff,
  targetStage: 'R0'
};
assert(
  decideReflexionReentry({
    handoff: planningOwnerHandoff,
    priorReentryCount: 0,
    maxReentries: 2
  }).reason === 'planning_owner_required',
  'targetStage=R0 时应交还 planning owner，不能进入质量返工'
);
assert(
  decideQualityAwareReflexionReentry({
    handoff: planningOwnerHandoff,
    priorReentryCount: 0,
    scorecardHistory: []
  }).reason === 'planning_owner_required',
  '质量合流策略也必须拒绝 targetStage=R0 的 handoff'
);

// 失败签名不同 → 允许重入（有新方向）
const handoff2 = { status: 'reflexion_required', failureAnalysis: ['另一个问题'], nextRoundConstraints: ['另一个约束'] };
assert(
  decideReflexionReentry({ handoff: handoff2, priorReentryCount: 0, maxReentries: 2, previousFailureSignature: sig }).shouldReenter === true,
  '失败签名不同应允许重入'
);

// 默认上限保守（基础策略不回退：涨分放宽到 ≤3 只走 quality-aware 合流决策，不改这里）
assert(DEFAULT_MAX_REFLEXION_REENTRIES === 1, '默认自动重入上限应为 1（保守防失控）');
assert(QUALITY_IMPROVING_MAX_REFLEXION_REENTRIES === 3, '涨分放宽上限应为 3（用户拍板：质量返工 ≤3 轮）');

// 合流决策存在且无评分历史时完全退回基础策略（行为与旧接线一致）
const qualityFallback = decideQualityAwareReflexionReentry({
  handoff: baseHandoff, priorReentryCount: 1, scorecardHistory: []
});
assert(
  qualityFallback.shouldReenter === false && qualityFallback.reason === 'max_reentries_reached',
  '无评分历史时合流决策应退回基础上限（≤1）'
);

// 注入消息含复盘原因 + 约束
const msg = buildReflexionReentryMessage(baseHandoff, ok);
assert(msg.includes('复盘') && msg.includes('产物停在排版，没有设计感') && msg.includes('先补设计依据再开稿'), '注入消息应含复盘原因与约束');

console.log('[smoke-reflexion-reentry-policy] passed');
