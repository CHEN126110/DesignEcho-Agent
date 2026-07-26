#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const RUNNER = path.join(ROOT, 'scripts', 'run-agent-live-photoshop-layer-management-task.cjs');

function assert(condition, message, details = null) {
  if (!condition) {
    const suffix = details ? `\n${JSON.stringify(details, null, 2)}` : '';
    throw new Error(`${message}${suffix}`);
  }
}

function extractStageBlock(source, stageId, nextStageId) {
  const end = nextStageId ? `stageId: '${nextStageId}'` : '];\n}';
  return source.match(new RegExp(`stageId: '${stageId}'[\\s\\S]*?${end.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`))?.[0] || '';
}

function extractTaskBlock(stageSource) {
  return stageSource.match(/task: \[[\s\S]*?\]\.join\('\\n'\)/)?.[0] || '';
}

function main() {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert(
    pkg.scripts?.['smoke:agent:live-photoshop-layer-management-task'] === 'node scripts/run-agent-live-photoshop-layer-management-task.cjs',
    'package script smoke:agent:live-photoshop-layer-management-task must point to the live Agent Photoshop layer-management runner.'
  );
  assert(
    pkg.scripts?.['smoke:agent:live-photoshop-layer-management-task:contract'] === 'node scripts/smoke-agent-live-photoshop-layer-management-task-contract.cjs',
    'package script smoke:agent:live-photoshop-layer-management-task:contract must point to this contract smoke.'
  );
  assert(fs.existsSync(RUNNER), 'live Agent Photoshop layer-management runner is missing.', { RUNNER });

  const source = fs.readFileSync(RUNNER, 'utf8');
  assert(source.includes('new Agent('), 'runner must use the real Agent runtime.');
  assert(source.includes('runAgentStage('), 'runner must execute the long layer-management task as staged real-Agent ReAct rounds.');
  assert(source.includes('runStageWithRequiredTools('), 'runner must re-enter a stage when required real tool evidence is missing.');
  assert(source.includes('buildStageDesignRetryTask('), 'runner must build designer-facing retry tasks instead of scripted tool calls.');
  assert(source.includes('buildLayerManagementStages('), 'runner must build explicit stage goals from real prior evidence.');
  assert(source.includes("stageId: 'setup-document-and-layers'"), 'runner must have a setup stage for document, group, shape, text, and readback.');
  assert(source.includes("stageId: 'rename-and-group-shape'"), 'runner must have a stage for renaming and moving the real shape layer into the real group.');
  assert(source.includes("stageId: 'duplicate-text-layer'"), 'runner must have a stage for duplicating the real text layer before deletion.');
  assert(source.includes("stageId: 'delete-duplicate-layer'"), 'runner must have a narrow stage for deleting only the real duplicate layer and reading back.');
  assert(source.includes("stageId: 'focus-export'"), 'runner must have a separate stage for focusing the renamed shape, readback, and export after deletion.');
  const setupStageSource = extractStageBlock(source, 'setup-document-and-layers', 'rename-and-group-shape');
  assert(setupStageSource.includes('maxIterations: 1'), 'setup stage must be a single create/readback round to avoid duplicate disposable documents.');
  assert(setupStageSource.includes('不要重新创建文档'), 'setup stage must tell the Agent not to repeat document/layer creation after success.');
  const renameStageSource = extractStageBlock(source, 'rename-and-group-shape', 'duplicate-text-layer');
  assert(renameStageSource.includes('requiredToolNames'), 'rename stage must declare required write-tool evidence.');
  assert(renameStageSource.indexOf("'renameLayer'") >= 0 && renameStageSource.indexOf("'moveLayerToGroup'") >= 0, 'rename stage must require rename and move tools.');
  assert(renameStageSource.indexOf("'renameLayer'") < renameStageSource.indexOf("'getLayerHierarchy'"), 'rename stage should expose write tools before readback tools.');
  const duplicateStageSource = extractStageBlock(source, 'duplicate-text-layer', 'delete-duplicate-layer');
  const deleteStageSource = extractStageBlock(source, 'delete-duplicate-layer', 'focus-export');
  assert(deleteStageSource.includes("'getLayerHierarchy'"), 'delete stage must verify deletion through hierarchy readback.');
  assert(!deleteStageSource.includes("'getLayerProperties'"), 'delete stage must not verify a deleted layer by reading properties for the deleted layerId.');
  assert(deleteStageSource.includes("'switchDocument'"), 'delete stage must allow switching back to the disposable document before deletion.');
  assert(deleteStageSource.includes('切换回这个临时文档'), 'delete stage must tell the Agent to switch back to the disposable document before deletion.');
  const focusStageSource = extractStageBlock(source, 'focus-export', null);
  assert(focusStageSource.includes("'switchDocument'"), 'focus/export stage must allow switching back to the disposable document before export.');
  assert(focusStageSource.includes('切换回这个临时文档'), 'focus/export stage must tell the Agent to switch back to the disposable document before export.');
  assert(source.includes('selectTools(stage.toolNames)'), 'each stage must use a bounded tool subset instead of exposing the whole long-chain tool list.');
  assert(source.includes('stageResults'), 'runner report must expose stage-level Agent/tool feedback.');
  assert(source.includes('new ModelService('), 'runner must use ModelService for real model tool calls.');
  assert(source.includes('.chatWithTools('), 'runner must call ModelService.chatWithTools.');
  assert(source.includes('executeToolCall('), 'runner must execute through the real tool executor.');
  assert(source.includes('selectTools(TOOL_NAMES)'), 'runner must use a bounded executable tool subset.');
  assert(source.includes('requiredSignals'), 'runner must verify concrete tool/file signals.');
  assert(source.includes('switchDocument'), 'runner must cover document switching.');
  assert(source.includes('renameLayer'), 'runner must cover layer renaming.');
  assert(source.includes('duplicateLayer'), 'runner must cover layer duplication.');
  assert(source.includes('deleteLayer'), 'runner must cover layer deletion.');
  assert(source.includes('moveLayerToGroup'), 'runner must cover moving a layer into a group.');
  assert(source.includes('focusLayer'), 'runner must cover layer focusing.');
  assert(source.includes('findToolWithLayerArg('), 'runner must require explicit layerId targeting evidence.');
  assert(source.includes('findToolWithGroupArgs('), 'runner must require explicit targetGroupId evidence.');
  assert(source.includes('--live'), 'runner must guard live model/Photoshop execution behind --live.');
  assert(!source.includes('buildScriptedModel'), 'runner must not use a scripted model.');
  assert(!source.includes('makeToolCall('), 'runner must not pre-script tool calls.');
  assert(!source.includes('toolCalls: ['), 'runner must not return fixed tool_calls from a fake model.');
  const designerFacingSource = [
    extractTaskBlock(setupStageSource),
    extractTaskBlock(renameStageSource),
    extractTaskBlock(duplicateStageSource),
    extractTaskBlock(deleteStageSource),
    extractTaskBlock(focusStageSource),
    source.match(/systemPrompt: \[[\s\S]*?\]\.join\('\\n'\)/)?.[0] || '',
    source.match(/function buildStageDesignRetryTask[\s\S]*?async function main/)?.[0] || ''
  ].join('\n');
  for (const forbidden of ['tool_calls', 'Markdown', 'Reflexion', 'preflight', '内部门禁', '调试字段', '阶段 R1', '阶段 R2', '阶段 R3', '阶段 R4', '阶段 R5']) {
    assert(!designerFacingSource.includes(forbidden), `designer-facing Agent task text must not include engineering/debug wording: ${forbidden}`);
  }

  const selfTest = spawnSync(process.execPath, [RUNNER, '--self-test'], {
    cwd: ROOT,
    encoding: 'utf8',
    windowsHide: true
  });
  assert(selfTest.status === 0, 'runner self-test must pass without touching Photoshop or models.', {
    status: selfTest.status,
    stdout: selfTest.stdout,
    stderr: selfTest.stderr
  });

  console.log(JSON.stringify({
    success: true,
    checks: [
      'runner uses real Agent runtime',
      'runner uses ModelService.chatWithTools',
      'runner executes through real tool executor',
      'runner is guarded by --live',
      'runner covers explicit layerId/groupId layer management writes',
      'runner has no scripted tool_calls'
    ]
  }, null, 2));
}

main();
