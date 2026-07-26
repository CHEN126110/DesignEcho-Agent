'use strict';

/**
 * smoke: public-plan 路由影子对比（V2「让模型先推理再决定是否走 public-plan」P1）。
 *
 * (1) 纯记录器 recordPublicPlanRoutingDivergence 四类判定 + summarize 计数。
 * (2) task-classifier 源码断言:executionApproach 收窄到两态、仅 route=autonomous_agent 保留(不碰 direct_answer/clarify)。
 * (3) engine 源码断言:影子对比【只落证据、不改真实路由】——基准来自 executionAuthorization，
 *     不再读取品类/自决信号白名单；shadow 块不写 statusFor/status。
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
require('ts-node').register({ transpileOnly: true, project: path.resolve(ROOT, 'tsconfig.main.json') });

const {
  recordPublicPlanRoutingDivergence,
  summarizePublicPlanRoutingLog
} = require(path.resolve(ROOT, 'src', 'shared', 'intent-shadow-diagnostics.ts'));

function check(name, fn) { fn(); console.log(`  ✓ ${name}`); }
console.log('smoke: public-plan-routing-shadow');

// ---------- (1) 纯记录器 ----------
check('model_skips_plan：模型判 direct_loop、candidate_only 授权仍要求 public_plan', () => {
  const r = recordPublicPlanRoutingDivergence('public_plan', 'direct_loop');
  assert.strictEqual(r.divergenceKind, 'model_skips_plan');
  assert.strictEqual(r.authorizationApproach, 'public_plan');
  assert.strictEqual(r.modelApproach, 'direct_loop');
});
check('model_wants_plan：模型判 public_plan、confirmed_tool_required 授权允许直接进循环', () => {
  assert.strictEqual(recordPublicPlanRoutingDivergence('direct_loop', 'public_plan').divergenceKind, 'model_wants_plan');
});
check('agree：两侧一致', () => {
  assert.strictEqual(recordPublicPlanRoutingDivergence('direct_loop', 'direct_loop').divergenceKind, 'agree');
  assert.strictEqual(recordPublicPlanRoutingDivergence('public_plan', 'public_plan').divergenceKind, 'agree');
});
check('model_no_opinion：模型没给判定（undefined/非法）→ 不作数', () => {
  assert.strictEqual(recordPublicPlanRoutingDivergence('public_plan', undefined).divergenceKind, 'model_no_opinion');
  assert.strictEqual(recordPublicPlanRoutingDivergence('public_plan', 'garbage').divergenceKind, 'model_no_opinion');
});
check('summarizePublicPlanRoutingLog 计数正确', () => {
  const log = [
    recordPublicPlanRoutingDivergence('public_plan', 'direct_loop'),
    recordPublicPlanRoutingDivergence('public_plan', 'direct_loop'),
    recordPublicPlanRoutingDivergence('direct_loop', 'public_plan'),
    recordPublicPlanRoutingDivergence('direct_loop', 'direct_loop'),
    recordPublicPlanRoutingDivergence('public_plan', undefined)
  ];
  const s = summarizePublicPlanRoutingLog(log);
  assert.strictEqual(s.model_skips_plan, 2);
  assert.strictEqual(s.model_wants_plan, 1);
  assert.strictEqual(s.agree, 1);
  assert.strictEqual(s.model_no_opinion, 1);
});

// ---------- (2) task-classifier 收窄源码断言 ----------
const classifierSrc = fs.readFileSync(
  path.resolve(ROOT, 'src', 'renderer', 'services', 'agent-orchestration', 'task-classifier.ts'), 'utf8');
check('ModelTaskRoute.executionApproach 只有 direct_loop/public_plan 两态（不含 direct_answer/clarify）', () => {
  assert.ok(/executionApproach\?:\s*'direct_loop'\s*\|\s*'public_plan'/.test(classifierSrc), '类型应为两态');
  assert.ok(!/executionApproach[\s\S]{0,60}'direct_answer'/.test(classifierSrc), '不应含 direct_answer');
  assert.ok(!/executionApproach[\s\S]{0,60}'clarify'/.test(classifierSrc), '不应含 clarify');
});
check('executionApproach 仅在 route=autonomous_agent 时保留（收窄作用域）', () => {
  assert.ok(/route === 'autonomous_agent'[\s\S]{0,200}executionApproach/.test(classifierSrc)
    || /executionApproach\s*=\s*route === 'autonomous_agent'/.test(classifierSrc),
    '解析应把 executionApproach 收窄到 autonomous_agent');
});

// ---------- (3) engine 只影子不改路由源码断言 ----------
const engineSrc = fs.readFileSync(
  path.resolve(ROOT, 'src', 'renderer', 'services', 'design-agent', 'engine.ts'), 'utf8');
check('engine 按 executionAuthorization 调用 recordPublicPlanRoutingDivergence 做影子对比', () => {
  assert.ok(engineSrc.includes('recordPublicPlanRoutingDivergence('), 'engine 应调用纯影子记录器');
  assert.ok(engineSrc.includes('const authorizationApproach: PublicPlanRoutingApproach'),
    '影子基准应命名为 authorizationApproach');
  assert.ok(/authorizationApproach:[\s\S]{0,180}hasConfirmedToolExecutionAuthorization\(intentControlPlane\)/.test(engineSrc),
    'authorizationApproach 应由执行授权判定');
});
check('影子块只落证据、不写 statusFor/status（不改真实路由）', () => {
  // 提取影子块（从注释到 modelDecision.executionApproach 使用），断言其内不给 status/statusFor/agentTaskPlan 赋值。
  const idx = engineSrc.indexOf('recordPublicPlanRoutingDivergence(');
  assert.ok(idx > 0);
  const block = engineSrc.slice(idx - 900, idx + 400);
  assert.ok(!/\b(status|agentTaskPlan|forcePublicPlanGeneration)\s*=/.test(block),
    '影子块不得给 status/agentTaskPlan/forcePublicPlanGeneration 赋值（P1 零真实路由改动）');
  assert.ok(!/matchedSignals|isSelfResolvableAutonomousIntent|keywordApproach/.test(block),
    '影子基准不得退回品类/自决信号白名单');
  assert.ok(/console\.info\('\[public-plan-routing-shadow\]'/.test(engineSrc), '分歧应落 console.info 证据');
});

console.log('\npublic-plan-routing-shadow smoke passed');
