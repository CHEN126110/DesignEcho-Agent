#!/usr/bin/env node
'use strict';

/**
 * generated public-plan 是 Harness 的能力中立执行信封，不是详情页/主图固定工作流。
 *
 * 本 smoke 钉住三类边界：
 * 1. Engine 不再根据品类合成 createDocument → renderLayout、默认画布或占位文案；
 * 2. 公开计划只规范白名单、完整参数、可回放顺序、审批和读回，不注入详情页 stage plan；
 * 3. direct_loop / public_plan 由 executionAuthorization 决定；模型路由不得升级 candidate_only，
 *    但合法 R0 通用设计 execute 声明可以纠正本地对象信号造成的 read_only 假阴性。
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const enginePath = path.join(root, 'src', 'renderer', 'services', 'design-agent', 'engine.ts');
const source = fs.readFileSync(enginePath, 'utf8');

let passed = 0;
function check(name, assertion) {
  assertion();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

function functionBody(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `缺少函数 ${name}`);
  const next = source.indexOf('\nfunction ', start + 10);
  return source.slice(start, next >= 0 ? next : source.length);
}

console.log('smoke: agent-public-plan-capability-envelope');

check('删除按品类合成固定草稿操作的 Engine helper', () => {
  for (const forbidden of [
    'isFreshTemporaryDraftIntent',
    'isFreshDetailPageDraftIntent',
    'resolveFreshDraftCanvasSize',
    'buildFreshTemporaryDraftOperationRequests',
    'ensureFreshTemporaryDraftPublicPlanPayload'
  ]) {
    assert.ok(!source.includes(forbidden), forbidden);
  }
});

check('不再内置默认画布、默认标题或固定卖点', () => {
  for (const forbidden of [
    '电商设计草稿',
    "['核心卖点', '舒适体验', '品质细节']",
    'create-temp-draft-document',
    'render-temp-draft-layout'
  ]) {
    assert.ok(!source.includes(forbidden), forbidden);
  }
});

check('模型 operationRequests 原样进入规范化和安全校验，不被 Engine 替换', () => {
  assert.ok(source.includes('publicPlanPayload = normalizeAgentTaskPublicPlanResponse(response);'));
  assert.ok(!source.includes('? ensureFreshTemporaryDraftPublicPlanPayload('));
});

check('public-plan prompt 明确能力中立且不强迫固定 Tool 路线', () => {
  assert.ok(source.includes('operationRequests 是能力中立的执行信封'));
  assert.ok(source.includes('不预设 createDocument、renderLayout 或任何固定工具顺序'));
  assert.ok(source.includes('已有文档可直接编辑时不要为了套流程重复新建文档'));
  assert.ok(!source.includes('operationRequests 必须包含 createDocument 和 renderLayout'));
  assert.ok(!source.includes('writeToolAllowlist 至少包含 createDocument、renderLayout'));
});

check('公共计划不注入详情页 stagePlan 方法论', () => {
  assert.ok(!source.includes('buildDetailPageCreativeStagePlanPromptSection'));
  assert.ok(!source.includes('targetDocumentName="详情页"'));
  assert.ok(source.includes('本公共计划不得自行注入某个品类的阶段计划'));
});

check('Harness 仍保留白名单、完整参数、审批、可回放和读回约束', () => {
  assert.ok(source.includes('const allowedToolSet = new Set(proposedWriteTools);'));
  assert.ok(source.includes('requiresUserConfirmation: true'));
  assert.ok(source.includes('runtimeOperationRequests: normalizeAgentTaskPublicPlanOperationRequests('));
  assert.ok(source.includes('collectAgentTaskPublicPlanOperationParamBlockers(operationRequests)'));
  assert.ok(source.includes('approval?.approveGeneratedPublicPlan === true'));
  assert.ok(source.includes('approval.userConfirmed === true'));
  assert.ok(source.includes('const allowConfirmedAutonomousRuntime = !shouldRunGeneratedPublicPlan'));
  assert.ok(source.includes('readbackTargets 不得为空'));
});

check('模型不得升级 candidate_only；合法 R0 设计 execute 只纠正 read_only 假阴性', () => {
  const body = functionBody('buildAutonomousRuntimeDecisionForAgentChoice');
  assert.ok(body.includes('executionAuthorization: source.executionAuthorization'));
  assert.ok(body.includes("source.requestKind === 'read_only_inspect'"));
  assert.ok(body.includes("source.toolScope === 'read_only'"));
  assert.ok(body.includes("modelDecision.mode === 'execute'"));
  assert.ok(body.includes('isRegisteredDesignTaskTypeId(modelDecision.taskTypeId)'));
  assert.ok(body.includes("toolScope: structuredDesignWrite ? 'write_photoshop' : source.toolScope"));
});

check('direct_loop/public_plan 影子判据只看 executionAuthorization', () => {
  const shadowStart = source.indexOf('const authorizationApproach: PublicPlanRoutingApproach');
  assert.ok(shadowStart >= 0);
  const shadowBlock = source.slice(shadowStart, shadowStart + 900);
  assert.ok(shadowBlock.includes('hasConfirmedToolExecutionAuthorization(intentControlPlane)'));
  assert.ok(shadowBlock.includes("? 'direct_loop'"));
  assert.ok(shadowBlock.includes(": 'public_plan'"));
  assert.ok(!shadowBlock.includes('matchedSignals'));
  assert.ok(!shadowBlock.includes('isSelfResolvableAutonomousIntent'));
  assert.ok(!shadowBlock.includes('keywordApproach'));
  assert.ok(!source.includes('isSelfResolvableAutonomousIntent'));
  assert.ok(!source.includes('isSelfResolvableAutonomousContextTask'));
});

check('route 进度文案由授权态驱动，不把小型/品类信号当 direct-loop 许可', () => {
  const routeStart = source.indexOf("if (modelDecision?.route === 'autonomous_agent'");
  const routeEnd = source.indexOf('// ── Route 14:', routeStart);
  const routeBlock = source.slice(routeStart, routeEnd);
  assert.ok(routeBlock.includes('const hasExecutionAuthorization = hasConfirmedToolExecutionAuthorization(intentControlPlane);'));
  assert.ok(routeBlock.includes("hasExecutionAuthorization ? '准备处理任务' : '整理设计计划'"));
  assert.ok(!routeBlock.includes('isSelfResolvableAutonomousContextTask'));
  assert.ok(!routeBlock.includes('明确的小型'));
});

console.log(`\n✅ agent-public-plan-capability-envelope 全部通过（${passed} 项）`);
