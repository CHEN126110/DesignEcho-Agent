#!/usr/bin/env node
/* eslint-disable no-console */

/**
 * CLI：聚合项目运行档案的工具调用级指标（Harness v1 · H4）
 * 用法：node scripts/agent-run-metrics.cjs <项目路径或runs目录>
 * 输出：可读摘要 + tmp/agent-run-metrics.json
 * 纯读：不写项目目录、不改档案。
 */

const fs = require('fs');
const path = require('path');
require('ts-node').register({ transpileOnly: true, project: path.resolve(__dirname, '..', 'tsconfig.main.json') });
const { aggregateAgentRunMetrics } = require(path.resolve(__dirname, '..', 'src', 'shared', 'agent-run-eval.ts'));

function resolveRunsDir(input) {
    const target = path.resolve(String(input || ''));
    if (!fs.existsSync(target)) return { error: `路径不存在：${target}` };
    if (path.basename(target) === 'runs') return { runsDir: target };
    const nested = path.join(target, '.designecho', 'runs');
    if (fs.existsSync(nested)) return { runsDir: nested };
    return { error: `未找到运行档案目录：${target} 下没有 .designecho/runs/（该项目还没有任何运行记录）` };
}

const arg = process.argv[2];
if (!arg) {
    console.error('用法：node scripts/agent-run-metrics.cjs <项目路径或runs目录>');
    process.exit(1);
}
const resolved = resolveRunsDir(arg);
if (resolved.error) {
    console.error(resolved.error);
    process.exit(1);
}
const files = fs.readdirSync(resolved.runsDir).filter((name) => name.startsWith('run-') && name.endsWith('.json'));
const records = files
    .map((name) => {
        try { return JSON.parse(fs.readFileSync(path.join(resolved.runsDir, name), 'utf8')); }
        catch { console.warn(`跳过无法解析的档案：${name}`); return null; }
    })
    .filter(Boolean);

const metrics = aggregateAgentRunMetrics(records);
const outDir = path.resolve(__dirname, '..', 'tmp');
fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, 'agent-run-metrics.json');
fs.writeFileSync(outFile, JSON.stringify(metrics, null, 2), 'utf8');

console.log(`运行档案：${metrics.runCount} 次（成功 ${metrics.successRuns} / 未完成 ${metrics.unfinishedRuns} / 质量硬拦 ${metrics.qualityHardBlockedRuns}）`);
console.log(`工具调用：${metrics.totalToolCalls} 次（写类 ${metrics.writeToolCalls}），平均迭代 ${metrics.avgIterations}`);
console.log(`停机分布：${Object.entries(metrics.stopReasons).map(([k, v]) => `${k}×${v}`).join('，') || '无'}`);
if (metrics.worstTools.length > 0) {
    console.log(`失败最多的工具：${metrics.worstTools.join('、')}`);
    for (const tool of metrics.tools.filter((t) => t.failures > 0).slice(0, 5)) {
        console.log(`  - ${tool.name}: ${tool.failures}/${tool.calls} 失败（${Math.round(tool.failureRate * 100)}%）${Object.keys(tool.topFailureCodes).length ? ' 码: ' + Object.entries(tool.topFailureCodes).map(([c, n]) => `${c}×${n}`).join(',') : ''}`);
    }
} else {
    console.log('没有失败的工具调用。');
}
console.log(`完整指标已写入：${outFile}`);
