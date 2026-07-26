#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

const RUNNERS = [
  'run-agent-live-photoshop-tool-task.cjs',
  'run-agent-live-photoshop-layer-effects-task.cjs',
  'run-agent-live-photoshop-layer-management-task.cjs',
  'run-agent-live-photoshop-adjustment-clipping-task.cjs',
  'run-agent-live-photoshop-readonly-evidence-task.cjs',
  'run-agent-live-photoshop-layout-history-task.cjs',
  'run-agent-live-photoshop-detail-page-workflow-task.cjs',
  'run-agent-live-photoshop-serial-suite-task.cjs'
];

const FORBIDDEN = [
  'tool_calls',
  'Markdown',
  'Reflexion',
  'preflight',
  '工具契约',
  '质量门禁',
  '内部门禁',
  '调试字段',
  '工具调用',
  '工具名称',
  '参数列表',
  '必须调用',
  '返回真实',
  '真实 layerId',
  '真实 groupId',
  '关键 layerId',
  '关键 groupId',
  '不要猜测 layerId',
  '阶段 R1',
  '阶段 R2',
  '阶段 R3',
  '阶段 R4',
  '阶段 R5'
];

function assert(condition, message, details = null) {
  if (!condition) {
    const suffix = details ? `\n${JSON.stringify(details, null, 2)}` : '';
    throw new Error(`${message}${suffix}`);
  }
}

function extractDesignerFacingBlocks(source) {
  const blocks = [];
  const taskFunctionMatch = source.match(/function buildTask[\s\S]*?^}/m);
  if (taskFunctionMatch) blocks.push(taskFunctionMatch[0]);
  const stageBuilderMatch = source.match(/function buildLayerManagementStages[\s\S]*?function buildStageDesignRetryTask/);
  if (stageBuilderMatch) blocks.push(stageBuilderMatch[0]);
  const retryTaskMatch = source.match(/function buildStageDesignRetryTask[\s\S]*?async function main/);
  if (retryTaskMatch) blocks.push(retryTaskMatch[0]);
  for (const match of source.matchAll(/systemPrompt:\s*\[[\s\S]*?\]\.join\('\\n'\)/g)) {
    blocks.push(match[0]);
  }
  return blocks.join('\n');
}

function main() {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert(
    pkg.scripts?.['smoke:agent:live-photoshop-runners-language-boundary'] === 'node scripts/smoke-agent-live-photoshop-runners-language-boundary.cjs',
    'package script smoke:agent:live-photoshop-runners-language-boundary must point to this smoke.'
  );

  const checked = [];
  for (const file of RUNNERS) {
    const fullPath = path.join(ROOT, 'scripts', file);
    assert(fs.existsSync(fullPath), 'live Photoshop runner is missing.', { file });
    const source = fs.readFileSync(fullPath, 'utf8');
    const designerFacing = extractDesignerFacingBlocks(source);
    assert(designerFacing.trim(), 'runner must expose designer-facing task or system prompt blocks for checking.', { file });
    for (const forbidden of FORBIDDEN) {
      assert(!designerFacing.includes(forbidden), 'designer-facing live runner text leaked engineering wording.', {
        file,
        forbidden
      });
    }
    checked.push(file);
  }

  console.log(JSON.stringify({ success: true, checked }, null, 2));
}

main();
