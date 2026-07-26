#!/usr/bin/env node
/* eslint-disable no-console */

/**
 * CLI：把一次失败运行档案转成回归用例骨架（Harness v1 · H4）
 * 用法：node scripts/run-record-to-regression.cjs <run-record.json> [输出目录=evals/golden-cases]
 * 骨架只如实记录失败现场（目标/路由/失败步骤/卡点），期望行为留空待人工补全——不臆造。
 */

const fs = require('fs');
const path = require('path');
require('ts-node').register({ transpileOnly: true, project: path.resolve(__dirname, '..', 'tsconfig.main.json') });
const { buildRegressionCaseFromRunRecord } = require(path.resolve(__dirname, '..', 'src', 'shared', 'agent-run-eval.ts'));

const recordPath = process.argv[2];
if (!recordPath || !fs.existsSync(recordPath)) {
    console.error('用法：node scripts/run-record-to-regression.cjs <run-record.json> [输出目录]');
    console.error(recordPath ? `文件不存在：${recordPath}` : '未提供档案路径');
    process.exit(1);
}
let record;
try {
    record = JSON.parse(fs.readFileSync(recordPath, 'utf8'));
} catch (error) {
    console.error(`档案解析失败：${error.message}`);
    process.exit(1);
}
const outcome = buildRegressionCaseFromRunRecord(record);
if (!outcome.ok) {
    console.error(`不能转为回归用例：${outcome.reason}`);
    process.exit(1);
}
const outDir = path.resolve(process.argv[3] || path.join(__dirname, '..', 'evals', 'golden-cases'));
fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, `${outcome.skeleton.caseId}.json`);
fs.writeFileSync(outFile, JSON.stringify(outcome.skeleton, null, 2), 'utf8');
console.log(`回归用例骨架已生成：${outFile}`);
console.log(`标题：${outcome.skeleton.title}`);
console.log(`失败步骤 ${outcome.skeleton.reproduction.failedToolSteps.length} 个；卡点 ${outcome.skeleton.reproduction.blockersAtFailure.length} 条。`);
console.log('提醒：expected 三项为空，请人工补全成功标准/必须行为/禁止行为后纳入回归集。');
