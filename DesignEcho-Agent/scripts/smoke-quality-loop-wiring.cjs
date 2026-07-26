// 守护：质量停机控制器接线（单一停机口径，2026-07 合流，用户拍板：A7↔A8 质量返工 ≤3 轮、超限升级人工）。
//
// 钉住四条不变量：
// 1) 涨分继续 ≤3 轮：质量分在涨（最近一轮 > 上一轮）时重入上限从 ≤1 放宽到 ≤3，第 4 次必停；
// 2) 停涨即停：连续窗口分数涨不动（< minDelta）→ 质量口径说停即停（哪怕基础护栏还想继续）；
//    失败签名无进展仍即停，不受涨分放宽；
// 3) blocker 转人工文案：停涨/触顶且仍有红线 → escalate_human，文案含人工裁决 + 各轮分数轨迹 + 卡点；
// 4) 诚实失败不伪造：停机文案不宣称完成、指路可达动作；executor 只补说明、不改成败裁决。
//
// 纯逻辑部分直接调 decideQualityAwareReflexionReentry / buildQualityLoopHaltMessage；
// 接线部分对 executor / agent / types 做源码钉桩（scorecard 供给链 + 停机说明接线）。

const path = require('path');
const fs = require('fs');

require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '..', 'tsconfig.main.json')
});

const {
  decideQualityAwareReflexionReentry,
  buildQualityLoopHaltMessage,
  buildReflexionFailureSignature,
  QUALITY_IMPROVING_MAX_REFLEXION_REENTRIES,
  DEFAULT_MAX_REFLEXION_REENTRIES
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'reflexion-reentry-policy.ts'));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

// —— 构造真实结构的评分卡（字段与 DesignScorecard 对齐，纯数据不 mock 行为） ——
function makeAssertionResult(id, rationale, expectedFix, severity) {
  return {
    id,
    dimension: 'composition',
    status: 'fail',
    method: 'deterministic',
    severity: severity || 'major',
    owner: 'layout',
    rationale,
    expectedFix
  };
}

function makeScorecard(overallScore, opts) {
  const options = opts || {};
  return {
    version: 'design-quality-assertion/v0',
    overallScore,
    passed: Boolean(options.passed),
    gate: options.gate || (options.passed ? 'passed' : 'needs_review'),
    coverage: { total: 14, evaluated: 10, uneval: 4, ratio: 0.71, deterministicEvaluated: 8, vlmEvaluated: 2 },
    dimensionScores: [],
    blockers: options.blockers || [],
    failedAssertions: options.failedAssertions || [],
    needsReview: [],
    results: [],
    summary: options.summary || ('设计评分：' + overallScore + ' 分，需复核。')
  };
}

function makeHandoff(tag) {
  return {
    status: 'reflexion_required',
    failureAnalysis: ['第 ' + tag + ' 轮质量未达标：' + tag],
    nextRoundConstraints: ['第 ' + tag + ' 轮返工约束：' + tag],
    strategyAdjustments: []
  };
}

const failedSubject = makeAssertionResult('comp.subject-ratio', '主体占比过小', '放大主体到画面 45%-70%');

console.log('smoke: quality-loop-wiring');

// ==================== 桩 1：涨分继续 ≤3 轮 ====================
{
  // 第 1 次返工：仅 1 轮评分（无可比对象，不放宽），基础上限 1 内允许
  const r1 = decideQualityAwareReflexionReentry({
    handoff: makeHandoff('a'),
    priorReentryCount: 0,
    scorecardHistory: [makeScorecard(50, { failedAssertions: [failedSubject] })]
  });
  assert(r1.shouldReenter === true && r1.reentryCount === 1, '首轮质量未达标应允许第 1 次返工');
  assert(r1.effectiveMaxReentries === DEFAULT_MAX_REFLEXION_REENTRIES, '单轮评分无可比对象，不放宽上限');

  // 第 2 次返工：50→58 在涨（delta ≥ 3），上限放宽到 3
  const historyRising2 = [
    makeScorecard(50, { failedAssertions: [failedSubject] }),
    makeScorecard(58, { failedAssertions: [failedSubject] })
  ];
  const r2 = decideQualityAwareReflexionReentry({
    handoff: makeHandoff('b'),
    priorReentryCount: 1,
    previousFailureSignature: buildReflexionFailureSignature(makeHandoff('a')),
    scorecardHistory: historyRising2
  });
  assert(r2.shouldReenter === true && r2.reentryCount === 2, '质量分在涨应允许第 2 次返工');
  assert(r2.effectiveMaxReentries === QUALITY_IMPROVING_MAX_REFLEXION_REENTRIES, '涨分轮次上限应放宽到 3');
  // continue 沿用既有 buildDesignReflexionConstraints 约束注入（评分卡失败断言的 expectedFix 并入约束）
  assert(r2.injectedConstraints.includes('放大主体到画面 45%-70%'), 'continue 应注入评分卡失败断言的修正约束');
  assert(r2.injectedConstraints.includes('第 b 轮返工约束：b'), 'continue 应保留 handoff 的下一轮约束');

  // 第 3 次返工：58→66 仍在涨
  const historyRising3 = historyRising2.concat([makeScorecard(66, { failedAssertions: [failedSubject] })]);
  const r3 = decideQualityAwareReflexionReentry({
    handoff: makeHandoff('c'),
    priorReentryCount: 2,
    previousFailureSignature: buildReflexionFailureSignature(makeHandoff('b')),
    scorecardHistory: historyRising3
  });
  assert(r3.shouldReenter === true && r3.reentryCount === 3, '质量分持续在涨应允许第 3 次返工');

  // 第 4 次必停：即使仍在涨，也已达用户拍板的返工上限（评分轮预算同步触顶）
  const historyRising4 = historyRising3.concat([makeScorecard(74, { failedAssertions: [failedSubject] })]);
  const r4 = decideQualityAwareReflexionReentry({
    handoff: makeHandoff('d'),
    priorReentryCount: 3,
    previousFailureSignature: buildReflexionFailureSignature(makeHandoff('c')),
    scorecardHistory: historyRising4
  });
  assert(r4.shouldReenter === false, '第 4 次返工必须停止（≤3 轮上限）');
  assert(r4.qualityHalt === 'stop_max_rounds', '触顶且无红线应按 stop_max_rounds 停机');
  console.log('  ✓ 涨分继续 ≤3 轮，第 4 次必停');
}

// ==================== 桩 2：停涨即停（更严格者优先）+ 签名无进展即停 ====================
{
  // 50→51（窗口内仅涨 1 分 < minDelta 3）：基础护栏因涨分还想继续，但质量口径止损 → 停
  const stagnant = [
    makeScorecard(50, { failedAssertions: [failedSubject] }),
    makeScorecard(51, { failedAssertions: [failedSubject] })
  ];
  const halted = decideQualityAwareReflexionReentry({
    handoff: makeHandoff('e'),
    priorReentryCount: 1,
    previousFailureSignature: buildReflexionFailureSignature(makeHandoff('a')),
    scorecardHistory: stagnant
  });
  assert(halted.shouldReenter === false, '停涨必须止损停机');
  assert(halted.reason === 'quality_halt', '基础护栏想继续时由质量口径否决（任一说停即停）');
  assert(halted.qualityHalt === 'stop_no_progress', '停涨且无红线应为 stop_no_progress');

  // 失败签名无进展：分数在涨也不豁免（原地打转即停）
  const sameHandoff = makeHandoff('f');
  const noProgress = decideQualityAwareReflexionReentry({
    handoff: sameHandoff,
    priorReentryCount: 1,
    previousFailureSignature: buildReflexionFailureSignature(sameHandoff),
    scorecardHistory: [
      makeScorecard(50, { failedAssertions: [failedSubject] }),
      makeScorecard(58, { failedAssertions: [failedSubject] })
    ]
  });
  assert(noProgress.shouldReenter === false && noProgress.reason === 'no_progress', '失败签名相同（无进展）即停，不受涨分放宽');

  // 评分通过（防御桩）：质量口径 stop_pass，即使意外仍有 handoff 也不再返工
  const passStop = decideQualityAwareReflexionReentry({
    handoff: makeHandoff('g'),
    priorReentryCount: 0,
    scorecardHistory: [makeScorecard(88, { passed: true, gate: 'passed' })]
  });
  assert(passStop.shouldReenter === false && passStop.qualityHalt === 'stop_pass', '评分已达标不再自动返工');

  // 检查信息不足（gather_observations）：不误杀返工——带约束补测量或画面观察
  const gather = decideQualityAwareReflexionReentry({
    handoff: makeHandoff('h'),
    priorReentryCount: 0,
    scorecardHistory: [makeScorecard(0, { gate: 'incomplete_verification' })]
  });
  assert(gather.shouldReenter === true, '证据不足应继续（去补证据），不直接判死');
  console.log('  ✓ 停涨即停 / 签名无进展即停 / 达标即停 / 证据不足去补证据');
}

// ==================== 桩 3：blocker 转人工文案 ====================
{
  const blocker = makeAssertionResult('overall.above-baseline', '画面停在"产品图+居中文字"排版及格线', '为卖点做视觉化设计而非纯文字陈列', 'blocker');
  const stuckWithBlocker = [
    makeScorecard(50, { blockers: [blocker], failedAssertions: [failedSubject] }),
    makeScorecard(51, { blockers: [blocker], failedAssertions: [failedSubject] })
  ];
  const escalate = decideQualityAwareReflexionReentry({
    handoff: makeHandoff('i'),
    priorReentryCount: 1,
    previousFailureSignature: buildReflexionFailureSignature(makeHandoff('a')),
    scorecardHistory: stuckWithBlocker
  });
  assert(escalate.shouldReenter === false && escalate.qualityHalt === 'escalate_human', '停涨且仍有红线应转人工');

  const message = buildQualityLoopHaltMessage({
    qualityHalt: 'escalate_human',
    reason: escalate.qualityDecision.reason,
    scoreTrajectory: escalate.scoreTrajectory,
    reentryCount: 1,
    latestScorecard: stuckWithBlocker[stuckWithBlocker.length - 1]
  });
  assert(message.includes('人工'), '转人工文案应明确说明需人工裁决');
  assert(message.includes('第 1 轮 50 分') && message.includes('第 2 轮 51 分'), '文案应含各轮分数轨迹');
  assert(message.includes('排版及格线') && message.includes('视觉化设计'), '文案应含卡点与修正建议');
  assert(message.includes('重新评审'), '文案应指路可达动作（人工修正后复评）');
  console.log('  ✓ blocker 转人工文案（卡点 + 分数轨迹 + 指路动作）');
}

// ==================== 桩 4：诚实失败不伪造 ====================
{
  const maxRoundsMessage = buildQualityLoopHaltMessage({
    qualityHalt: 'stop_max_rounds',
    reason: '达到最大轮数仍未达标。',
    scoreTrajectory: [50, 58, 66, 70],
    reentryCount: 3,
    latestScorecard: makeScorecard(70, { failedAssertions: [failedSubject] })
  });
  assert(maxRoundsMessage.includes('不作完成宣称'), '停机文案必须明示不作完成宣称');
  assert(!maxRoundsMessage.includes('已完成'), '停机文案不得出现完成宣称');
  assert(maxRoundsMessage.includes('已自动返工 3 轮'), '文案应如实报告已返工轮数');
  console.log('  ✓ 诚实失败不伪造（不宣称完成、如实报轮数）');
}

// ==================== 桩 5：接线源码钉桩（scorecard 供给链 + 停机说明） ====================
{
  const repoRoot = path.resolve(__dirname, '..');
  const executorSource = fs.readFileSync(
    path.join(repoRoot, 'src', 'renderer', 'services', 'skill-executors', 'autonomous-agent.executor.ts'), 'utf8'
  );
  const agentSource = fs.readFileSync(
    path.join(repoRoot, 'src', 'renderer', 'services', 'agent-runtime', 'agent.ts'), 'utf8'
  );
  const typesSource = fs.readFileSync(
    path.join(repoRoot, 'src', 'renderer', 'services', 'agent-runtime', 'types.ts'), 'utf8'
  );
  const assertionSource = fs.readFileSync(
    path.join(repoRoot, 'src', 'shared', 'design-quality-assertion.ts'), 'utf8'
  );

  function assertIncludes(source, token, message) {
    assert(source.includes(token), message + '（缺 token：' + token + '）');
  }
  function assertOrdered(source, tokens, message) {
    let cursor = -1;
    for (const token of tokens) {
      const position = source.indexOf(token, cursor + 1);
      assert(position > cursor, message + '（缺失或顺序错误 token：' + token + '）');
      cursor = position;
    }
  }

  // executionSummary 契约：可选字段透传 scorecard（agent 收尾 → executor 外层）
  assertIncludes(typesSource, 'designScorecard?: DesignScorecard;', 'AgentExecutionSummary 应有可选 designScorecard 字段');
  assertIncludes(agentSource, 'designScorecard = designEvaluationProfileResult.scorecard;', 'manifest Evaluation Profile 应提供本轮评分卡');
  assertIncludes(agentSource, 'designScorecard = scoreDesignAssertions(assertionResults);', '未迁移任务应保留旧评分入口');
  assertIncludes(agentSource, '...(designScorecard ? { designScorecard } : {}),', '无评分卡时诚实缺席（不补造空卡）');

  // executor 接线：每轮收集评分卡 → 合流决策 → 停机时诚实说明；顺序不可乱
  assertOrdered(executorSource, [
    'const designScorecardHistory: DesignScorecard[] = [];',
    'while (!result.cancelled)',
    'const latestScorecard = result.executionSummary?.designScorecard;',
    'decideQualityAwareReflexionReentry({',
    'scorecardHistory: designScorecardHistory',
    'buildQualityLoopHaltMessage({',
    'result = await createAutonomousAgent().run(reentryTask'
  ], '重入循环应按「收集评分卡 → 合流停机决策 → 停机说明/带约束重跑」接线');
  assertIncludes(
    executorSource,
    "reentryDecision.qualityHalt === 'escalate_human' || reentryDecision.qualityHalt === 'stop_max_rounds'",
    '仅 escalate_human / stop_max_rounds 追加诚实失败说明'
  );
  // 不伪造完成：executor 只补说明，成败裁决仍来自 agent 收尾（success 不被改写）
  assertIncludes(executorSource, 'success: result.success,', 'executor 不得改写 agent 收尾的成败裁决');
  assertIncludes(executorSource, 'qualityHaltNotice ? ', '停机说明应附加到结果消息（诚实失败可见）');
  assert(!executorSource.includes('DEFAULT_MAX_REFLEXION_REENTRIES'), '旧的固定 ≤1 上限直连应被合流决策取代');

  // 双轨说明已更新为合流
  assertIncludes(assertionSource, '已合流', 'evaluateQualityLoopDecision 头注释应更新为已合流');
  assertIncludes(assertionSource, 'decideQualityAwareReflexionReentry', '头注释应指向合流后的单一停机口径入口');
  console.log('  ✓ 接线源码钉桩（供给链 + 停机说明 + 成败裁决不改写）');
}

console.log('\n[smoke-quality-loop-wiring] passed');
