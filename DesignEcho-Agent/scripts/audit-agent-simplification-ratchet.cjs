#!/usr/bin/env node
'use strict';

/**
 * Agent 简化债务棘轮（第0步·止血）。
 *
 * 立场（对齐 Anthropic「Building Effective Agents」+ 本仓库 gap 文档的四条元原则）：
 *   - Agency 来自模型，harness 别替模型做决策 → 关键词/正则意图分类是「提示词水管工」反模式，只许减不许增。
 *   - 挂在循环上，不写进循环里 → agent.ts 主循环里的续跑/纠偏/停机分支只许减不许增。
 *
 * 契约（仿 audit:executor-generic 债务棘轮）：
 *   - 每个度量有一个「冻结基线」，当前值必须 ≤ 基线，否则审计失败（拦住「乱堆」）。
 *   - 当一次简化真正减少了某度量，请把该度量的基线**下调到新的当前值**——棘轮只能往下走，
 *     不能让减掉的复杂度又悄悄爬回来。基线上调只允许在有明确评审理由时手动进行。
 *
 * 本审计零行为改动、纯静态计数，供 CI / preflight 常态运行。
 */

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

function read(relPath) {
    return fs.readFileSync(path.join(root, relPath), 'utf8');
}

function countMatches(text, pattern) {
    const matches = text.match(pattern);
    return matches ? matches.length : 0;
}

/**
 * 冻结基线（2026-07-23 测得）。简化后请把对应 baseline 下调到新的当前值。
 * 每个度量注明「减它的方向」，让后来者知道该往哪减、而不是往回堆。
 */
const METRICS = [
    {
        id: 'intent_classifier_regex',
        label: '意图分类正则用点（3 个专职分类器文件）',
        baseline: 143,
        reduceHint: '收敛为单一薄路由 + 让模型声明意图承重（declareDesignIntent），退役关键词门。',
        files: [
            'src/renderer/services/agent-orchestration/routing.ts',
            'src/shared/agent-intent-control-plane.ts',
            'src/renderer/services/agent-orchestration/task-classifier.ts'
        ],
        pattern: /\.(test|match|exec)\(|new RegExp/g
    },
    {
        id: 'agent_loop_control_branches',
        label: 'agent.ts 主循环续跑/纠偏/停机分支',
        baseline: 71,
        reduceHint: '把续跑/停机收敛到一小组清晰条件；用外化计划替代循环内隐式续跑推力（挂在循环上，不写进循环里）。',
        files: ['src/renderer/services/agent-runtime/agent.ts'],
        pattern: /RecoveryDirective|ReplanAttempt|RemediationAttempt|applyRequired|applyPromised|no\.?progress|NudgeSent/g
    },
    {
        // Agent 是「设计师」不是「工程师」：用户可见文案不得出现 harness / 测试过程话术
        // （处理状态 / 共处理 N 项 / 已到本轮上限 / 判断次数…）。剩余的是解析旧记录用的兼容路径，只许减。
        id: 'user_facing_harness_jargon',
        label: '用户可见生成器里的工程/测试话术（Agent 应像设计师）',
        baseline: 3,
        reduceHint: '结果说明用设计师口吻说「这稿做到哪一步、下一步怎么办」；工具动作计数与阶段/预算术语只留在开发用运行档案，不进用户界面。',
        files: [
            'src/renderer/services/agent-runtime/agent.ts',
            'src/renderer/components/message/parser.ts',
            'src/shared/agent-runtime-v5/runtime-session.ts'
        ],
        pattern: /处理状态：|共处理 \$?\{?[a-z]|[0-9a-zA-Z}]+ 项已处理|[0-9a-zA-Z}]+ 项未完成|本轮处理上限|本轮处理到达上限|判断次数上限|处理动作上限|本轮没有完成有效处理|本轮没有形成可展示/g
    }
];

let failed = false;
const rows = [];
for (const metric of METRICS) {
    let current = 0;
    for (const file of metric.files) {
        current += countMatches(read(file), metric.pattern);
    }
    const status = current > metric.baseline ? 'FAIL(超基线)'
        : current < metric.baseline ? 'ok(可下调基线)'
            : 'ok(持平)';
    if (current > metric.baseline) failed = true;
    rows.push({ id: metric.id, label: metric.label, baseline: metric.baseline, current, status, reduceHint: metric.reduceHint });
}

console.log('Agent 简化债务棘轮：');
for (const row of rows) {
    console.log(`  [${row.status}] ${row.label}: 当前 ${row.current} / 基线 ${row.baseline}`);
    if (row.status.startsWith('FAIL')) {
        console.error(`    ✗ 又堆复杂度了：不允许新增关键词分类/循环分支。减它的方向 → ${row.reduceHint}`);
    } else if (row.status.startsWith('ok(可下调')) {
        console.log(`    ↓ 已减到 ${row.current}，请把该度量 baseline 下调到 ${row.current}，锁住成果。`);
    }
}

if (failed) {
    console.error('\n[FAIL] Agent 简化棘轮：检测到复杂度上涨。见上方「减它的方向」。');
    process.exitCode = 1;
} else {
    console.log('\n[OK] Agent 简化棘轮通过：水管工面没有上涨。');
}
