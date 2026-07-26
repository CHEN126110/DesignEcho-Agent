#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const RUNNER = path.join(ROOT, 'scripts', 'run-agent-live-photoshop-serial-suite-task.cjs');

const REQUIRED_TOOLS = [
  'addGlow',
  'addGradientOverlay',
  'alignLayers',
  'clearLayerEffects',
  'convertToSmartObject',
  'createEllipse',
  'distributeLayers',
  'duplicateSmartObject',
  'exportGroup',
  'getAllTextLayers',
  'getCanvasSnapshot',
  'getSmartObjectInfo',
  'getSmartObjectLayers',
  'getTextContent',
  'getTextStyle',
  'groupLayers',
  'moveLayer',
  'placeImage',
  'quickScale',
  'reorderLayer',
  'replaceLayerContent',
  'saveDocument',
  'setBlendMode',
  'setLayerFill',
  'setTextContent',
  'setTextStyle',
  'smartSave',
  'transformLayer',
  'ungroupLayers'
];

function assert(condition, message, details = null) {
  if (!condition) {
    const suffix = details ? `\n${JSON.stringify(details, null, 2)}` : '';
    throw new Error(`${message}${suffix}`);
  }
}

function main() {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert(
    pkg.scripts?.['smoke:agent:live-photoshop-serial-suite-task'] === 'node scripts/run-agent-live-photoshop-serial-suite-task.cjs',
    'package script smoke:agent:live-photoshop-serial-suite-task must point to the live Agent Photoshop serial suite runner.'
  );
  assert(
    pkg.scripts?.['smoke:agent:live-photoshop-serial-suite-task:contract'] === 'node scripts/smoke-agent-live-photoshop-serial-suite-task-contract.cjs',
    'package script smoke:agent:live-photoshop-serial-suite-task:contract must point to this contract smoke.'
  );
  assert(fs.existsSync(RUNNER), 'live Agent Photoshop serial suite runner is missing.', { RUNNER });

  const source = fs.readFileSync(RUNNER, 'utf8');
  assert(source.includes('new Agent('), 'runner must use the real Agent runtime.');
  assert(source.includes('new ModelService('), 'runner must use ModelService for real model tool calls.');
  assert(source.includes('.chatWithTools('), 'runner must call ModelService.chatWithTools.');
  assert(source.includes('executeToolCall('), 'runner must execute through the real tool executor.');
  assert(source.includes('selectTools(TOOL_NAMES)'), 'runner must use a bounded executable tool subset.');
  assert(source.includes('writeFixturePng('), 'runner must create a disposable image fixture for image placement tools.');
  assert(source.includes('requiredSignals'), 'runner must verify concrete tool/readback signals.');
  for (const toolName of REQUIRED_TOOLS) {
    assert(source.includes(toolName), `runner must cover ${toolName}.`);
  }
  assert(source.includes('--live'), 'runner must guard live model/Photoshop execution behind --live.');
  assert(!source.includes('buildScriptedModel'), 'runner must not use a scripted model.');
  assert(!source.includes('makeToolCall('), 'runner must not pre-script tool calls.');
  assert(!source.includes('toolCalls: ['), 'runner must not return fixed tool_calls from a fake model.');

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
    requiredTools: REQUIRED_TOOLS.length,
    checks: [
      'runner uses real Agent runtime',
      'runner uses ModelService.chatWithTools',
      'runner executes through real tool executor',
      'runner is guarded by --live',
      'runner covers all formerly scripted-live-only Photoshop tools',
      'runner has no scripted tool_calls'
    ]
  }, null, 2));
}

main();
