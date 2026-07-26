'use strict';

/**
 * smoke: 意图声明影子对比（V2「意图交给 Agent 理解」P1 核心）。
 *
 * (1) 纯记录器 recordIntentShadowDivergence 的四类分歧判定 + summarize 计数。
 * (2) declareDesignIntent 分类中性性：classifyAgentToolExecution 判 stateful_context（非
 *     read_only_observation）——它声明上下文、不观察画面，绝不能被完成门禁当成“改后已复核”观察。
 * (3) 纪律放行：设计纪律 active 时，declareDesignIntent 在建画布前/后都被放行（不被拦），
 *     证明 CORE/PRE_DOCUMENT/EXPOSED 三集注册生效。
 * (4) 影子隔离源码断言：declareDesignIntent handler 只写 data.shadowDeclaredDesignTaskTypeId（不写
 *     declaredDesignTaskTypeId）；executor 用独立 helper 读影子字段、且影子采样置于 designBehaviorLog.push 之后
 *     （每次工具调用独立算）。
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
require('ts-node').register({ transpileOnly: true, project: path.resolve(ROOT, 'tsconfig.main.json') });

const {
  recordIntentShadowDivergence,
  isNotableIntentDivergence,
  summarizeIntentShadowLog
} = require(path.resolve(ROOT, 'src', 'shared', 'intent-shadow-diagnostics.ts'));
const { classifyAgentToolExecution } = require(path.resolve(ROOT, 'src', 'shared', 'agent-tool-execution-preflight.ts'));
const {
  evaluateDesignToolStateGuard,
  resolveDesignDisciplineContext,
  createDesignDisciplineState
} = require(path.resolve(ROOT, 'src', 'shared', 'design-discipline-runtime.ts'));

function check(name, fn) { fn(); console.log(`  ✓ ${name}`); }
console.log('smoke: intent-declaration-shadow');

// ---------- (1) 纯记录器 ----------
check('earlier_activation：影子(模型声明)激活、真实(关键词门)未激活——关键词漏判早窗口样本', () => {
  const r = recordIntentShadowDivergence(
    { active: false, source: 'keyword_or_footprint' },
    { active: true, taskTypeId: 'ecommerce.main_image.v1', source: 'model_declaration' }
  );
  assert.strictEqual(r.divergenceKind, 'earlier_activation');
  assert.strictEqual(isNotableIntentDivergence(r), true);
});

check('task_type_mismatch：两侧都激活但 taskType 不同（关键词判X、模型声明Y）', () => {
  const r = recordIntentShadowDivergence(
    { active: true, taskTypeId: 'ecommerce.detail_page.v1', source: 'keyword_or_footprint' },
    { active: true, taskTypeId: 'ecommerce.main_image.v1', source: 'model_declaration' }
  );
  assert.strictEqual(r.divergenceKind, 'task_type_mismatch');
  assert.strictEqual(isNotableIntentDivergence(r), true);
});

check('shadow_missing_declaration：真实已激活但影子无声明（信息项，非漏判）', () => {
  const r = recordIntentShadowDivergence(
    { active: true, taskTypeId: 'ecommerce.main_image.v1', source: 'keyword_or_footprint' },
    { active: false, source: 'none' }
  );
  assert.strictEqual(r.divergenceKind, 'shadow_missing_declaration');
  assert.strictEqual(isNotableIntentDivergence(r), false);
});

check('agree：两侧同 taskType，或都不激活', () => {
  const same = recordIntentShadowDivergence(
    { active: true, taskTypeId: 'ecommerce.main_image.v1' },
    { active: true, taskTypeId: 'ecommerce.main_image.v1' }
  );
  assert.strictEqual(same.divergenceKind, 'agree');
  const neither = recordIntentShadowDivergence({ active: false }, { active: false });
  assert.strictEqual(neither.divergenceKind, 'agree');
});

check('summarizeIntentShadowLog 计数正确', () => {
  const log = [
    recordIntentShadowDivergence({ active: false }, { active: true, taskTypeId: 'ecommerce.main_image.v1' }),
    recordIntentShadowDivergence({ active: false }, { active: true, taskTypeId: 'ecommerce.detail_page.v1' }),
    recordIntentShadowDivergence({ active: true, taskTypeId: 'a' }, { active: true, taskTypeId: 'b' }),
    recordIntentShadowDivergence({ active: false }, { active: false })
  ];
  const s = summarizeIntentShadowLog(log);
  assert.strictEqual(s.earlier_activation, 2);
  assert.strictEqual(s.task_type_mismatch, 1);
  assert.strictEqual(s.agree, 1);
});

// ---------- (2) 分类中性性（关键：不得被完成门禁当成观察） ----------
check('declareDesignIntent 判 stateful_context（中性），不是 read_only_observation（否则会假满足“改后必看”）', () => {
  const kind = classifyAgentToolExecution('declareDesignIntent', { taskTypeId: 'ecommerce.main_image.v1' });
  assert.strictEqual(kind, 'stateful_context', `got ${kind}`);
  assert.notStrictEqual(kind, 'read_only_observation', '声明工具不能被当成画面观察');
});

// ---------- (3) 纪律放行（三集注册生效） ----------
check('设计纪律 active 时 declareDesignIntent 建画布前/后均放行（不被拦）', () => {
  const ctx = resolveDesignDisciplineContext({ taskText: '帮我做详情页', isCreativeDesignIntent: true });
  assert.ok(ctx.active, '详情页应激活纪律');
  const preDoc = evaluateDesignToolStateGuard({
    context: ctx, state: createDesignDisciplineState({ designKnowledgeReadCount: 0 }), toolName: 'declareDesignIntent'
  });
  assert.strictEqual(preDoc, null, '建画布前声明意图应放行');
  const postDoc = evaluateDesignToolStateGuard({
    context: ctx,
    state: createDesignDisciplineState({ documentCreated: true, layoutRendered: true, designKnowledgeReadCount: 1 }),
    toolName: 'declareDesignIntent'
  });
  assert.strictEqual(postDoc, null, '建画布后声明意图也应放行');
});

// ---------- (4) 影子隔离源码断言 ----------
const executorSrc = fs.readFileSync(
  path.resolve(ROOT, 'src', 'renderer', 'services', 'tool-executor.service.ts'), 'utf8');
const agentExecutorSrc = fs.readFileSync(
  path.resolve(ROOT, 'src', 'renderer', 'services', 'skill-executors', 'autonomous-agent.executor.ts'), 'utf8');

check('handler 只写影子字段 shadowDeclaredDesignTaskTypeId，不写 declaredDesignTaskTypeId（影子隔离）', () => {
  const caseIdx = executorSrc.indexOf("case 'declareDesignIntent':");
  assert.ok(caseIdx > 0, 'declareDesignIntent handler 应存在');
  const caseBody = executorSrc.slice(caseIdx, caseIdx + 1400);
  assert.ok(caseBody.includes('shadowDeclaredDesignTaskTypeId'), 'handler 应返回 shadowDeclaredDesignTaskTypeId');
  assert.ok(!/data:\s*\{[^}]*\bdeclaredDesignTaskTypeId\b/.test(caseBody),
    'handler 绝不能在 data 里返回 declaredDesignTaskTypeId（否则会触发 bind 即时激活，破坏影子隔离）');
  assert.ok(caseBody.includes('isRegisteredDesignTaskTypeId'), 'handler 应校验已注册 id');
});

check('declareDesignIntent 登记为 Renderer 本地工具，不会落入 Photoshop MCP', () => {
  const localToolsIdx = executorSrc.indexOf('const RENDERER_LOCAL_TOOLS');
  const dispatchIdx = executorSrc.indexOf('if (RENDERER_LOCAL_TOOLS.includes(toolName))');
  const localToolsBlock = executorSrc.slice(localToolsIdx, localToolsIdx + 1200);
  assert.ok(localToolsIdx > 0 && dispatchIdx > localToolsIdx, '应存在 Renderer 本地工具分发');
  assert.ok(localToolsBlock.includes("'declareDesignIntent'"), 'declareDesignIntent 必须在本地工具表');
});

check('executor 用独立 helper 读影子字段、且影子采样置于 designBehaviorLog.push 之后（每次调用独立算）', () => {
  assert.ok(agentExecutorSrc.includes('readShadowDeclaredDesignTaskTypeIdFromToolResult'),
    'executor 应有独立影子读取 helper');
  assert.ok(/data\.shadowDeclaredDesignTaskTypeId/.test(agentExecutorSrc), 'helper 应读 data.shadowDeclaredDesignTaskTypeId');
  const pushIdx = agentExecutorSrc.indexOf('designBehaviorLog.push({ name: toolName, result })');
  const sampleIdx = agentExecutorSrc.indexOf('readShadowDeclaredDesignTaskTypeIdFromToolResult(result)');
  assert.ok(pushIdx > 0 && sampleIdx > pushIdx, '影子采样应在 designBehaviorLog.push 之后（缓存短路之外，逐调用采样）');
  assert.ok(agentExecutorSrc.includes('recordIntentShadowDivergence('), 'executor 应调用纯记录器');
});

global.window = { location: { search: '' }, designEcho: {} };
const { executeToolCall } = require(path.resolve(
  ROOT,
  'src',
  'renderer',
  'services',
  'tool-executor.service.ts'
));

executeToolCall('declareDesignIntent', {
  taskTypeId: 'ecommerce.sku_color_card.v1',
  rationale: '本地 Harness 分发 smoke'
}).then((result) => {
  check('SKU 色卡任务类型可由本地 Harness 声明，不访问 Photoshop registry', () => {
    assert.strictEqual(result.success, true, JSON.stringify(result));
    assert.strictEqual(result.data?.shadowDeclaredDesignTaskTypeId, 'ecommerce.sku_color_card.v1');
  });
  console.log('\nintent-declaration-shadow smoke passed');
}).catch((error) => {
  console.error(error?.stack || error);
  process.exit(1);
});
