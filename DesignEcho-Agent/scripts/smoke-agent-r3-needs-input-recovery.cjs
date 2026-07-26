#!/usr/bin/env node
'use strict';

/**
 * R3 策略缺失输入死锁的回归护栏（2026-07-25 实机故障）。
 *
 * 背景：模型在 R3 声明策略时把"需要观察项目摄影图"标为 blocking missingInput，
 * readiness=needs_input → R3 不推进 → 恢复机制把工具集锁进声明工具 → 模型无法
 * 补齐自己声明的输入，只能反复重声明 → no_progress 看门狗收尾（16 轮零写入）。
 *
 * 本 smoke 钉住三层修复：
 * 1. 运行时解锁：R3 needs_input 时两条恢复路径都必须放行只读观察/检索工具，
 *    并指引"先补齐可自行取得的输入，再重新声明"。
 * 2. 声明校验：blocking missingInput → needs_input（行为基座，函数级验证）；
 *    schema 指引明确 blocking 只用于"只能由用户提供"的输入。
 * 3. 校验失败必须带 error/message（实机曾显示"失败（无错误信息）"，模型无法自纠）。
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '..', 'tsconfig.json'),
  compilerOptions: { module: 'CommonJS', moduleResolution: 'node' }
});

const root = path.resolve(__dirname, '..');
const {
  validateRuntimeDesignStrategyDeclaration,
  buildDeclareDesignStrategyToolSchema
} = require(path.join(root, 'src', 'shared', 'agent-runtime-v5', 'runtime-design-strategy-declaration.ts'));

const agentSource = fs.readFileSync(
  path.join(root, 'src', 'renderer', 'services', 'agent-runtime', 'agent.ts'),
  'utf8'
);

function buildStrategyValue(missingInputs) {
  return {
    stageGoal: '先提炼卖点再套版',
    objective: { primaryGoal: '提炼卖点', secondaryGoals: [], targetAudienceSummary: '女童家长' },
    messageArchitecture: {
      primaryMessage: '可爱刺绣中筒袜',
      supportingMessages: [],
      supportingFacts: [],
      objectionsToResolve: []
    },
    copyDirection: {
      toneKeywords: ['清新'],
      headlineOptions: [],
      subtitleOptions: [],
      tagOptions: [],
      prohibitedClaims: []
    },
    visualDirection: {
      moodKeywords: ['清新明亮'],
      paletteIntent: [],
      typographyIntent: [],
      compositionIntent: ['模板套版优先'],
      imageTreatment: [],
      density: 'low'
    },
    constraints: [],
    contextRefs: ['context:user_goal'],
    assumptions: [],
    missingInputs
  };
}

// 2a. blocking missingInput → needs_input；非 blocking → ready（行为基座）
const blocking = validateRuntimeDesignStrategyDeclaration({
  value: buildStrategyValue([
    { inputId: 'need-photo-observation', field: '摄影图视觉观察', question: '还没看过摄影图', severity: 'blocking' }
  ]),
  allowedContextRefs: ['context:user_goal']
});
assert.strictEqual(blocking.ok, true);
assert.strictEqual(blocking.readiness, 'needs_input', 'blocking missingInput must keep strategy at needs_input');

const ready = validateRuntimeDesignStrategyDeclaration({
  value: buildStrategyValue([
    { inputId: 'nice-to-have', field: '可选参考', question: '可选', severity: 'optional' }
  ]),
  allowedContextRefs: ['context:user_goal']
});
assert.strictEqual(ready.ok, true);
assert.strictEqual(ready.readiness, 'ready', 'non-blocking missingInputs must not block readiness');

// 2b. schema 指引：blocking 只用于"只能由用户提供"的输入
const schema = buildDeclareDesignStrategyToolSchema(['context:user_goal']);
assert(
  schema.description.includes('blocking means the input can ONLY be supplied by the user'),
  'tool schema must teach that blocking is reserved for user-only inputs'
);
assert(
  schema.inputSchema.properties.missingInputs.description.includes('user alone can supply'),
  'missingInputs property must repeat the user-only guidance'
);

// 1. 运行时解锁：两条恢复路径都在 R3 needs_input 时放行观察/检索工具
assert(agentSource.includes('resolveR3NeedsInputRecovery'), 'agent must detect R3 needs_input strategy');
assert(agentSource.includes('expandRecoveryToolsForObservableInputs'), 'agent must widen recovery tools for observable gaps');
const expansionCount = (agentSource.match(/expandRecoveryToolsForObservableInputs\(/g) || []).length;
assert(expansionCount >= 3, `both recovery paths must use the expansion (definition + 2 call sites), got ${expansionCount}`);
assert(
  agentSource.includes("kind === 'read_only_observation' || kind === 'knowledge_search'"),
  'observable-gap recovery must allow observation and search tools'
);
assert(
  agentSource.includes('R3 策略声明了阻塞性缺失输入：先补齐可自行取得的输入，再重新声明策略。'),
  'recovery directive must state the gather-first-then-redeclare discipline'
);

// 3. 声明校验失败必须带 error/message
assert(
  agentSource.includes('design_strategy_declaration_invalid: ${validationSummary}')
    && agentSource.includes('Design Strategy 声明未通过结构校验：'),
  'strategy declaration invalid result must carry an actionable error message'
);
assert(
  agentSource.includes('runtime_reference_brief_declaration_invalid: ${validationSummary}')
    && agentSource.includes('Reference Brief 声明未通过结构校验：'),
  'reference brief declaration invalid result must carry an actionable error message'
);

console.log(JSON.stringify({
  success: true,
  checks: [
    'blocking missingInput keeps strategy needs_input; non-blocking stays ready',
    'tool schema teaches blocking = user-only inputs',
    'R3 needs_input unlocks observation/search in both recovery paths',
    'declaration invalid results carry actionable error messages'
  ]
}, null, 2));
