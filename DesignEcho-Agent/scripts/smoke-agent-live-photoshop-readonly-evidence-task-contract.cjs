#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const RUNNER = path.join(ROOT, 'scripts', 'run-agent-live-photoshop-readonly-evidence-task.cjs');

function assert(condition, message, details = null) {
  if (!condition) {
    const suffix = details ? `\n${JSON.stringify(details, null, 2)}` : '';
    throw new Error(`${message}${suffix}`);
  }
}

function main() {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert(
    pkg.scripts?.['smoke:agent:live-photoshop-readonly-evidence-task'] === 'node scripts/run-agent-live-photoshop-readonly-evidence-task.cjs',
    'package script smoke:agent:live-photoshop-readonly-evidence-task must point to the live Agent Photoshop readonly evidence runner.'
  );
  assert(
    pkg.scripts?.['smoke:agent:live-photoshop-readonly-evidence-task:contract'] === 'node scripts/smoke-agent-live-photoshop-readonly-evidence-task-contract.cjs',
    'package script smoke:agent:live-photoshop-readonly-evidence-task:contract must point to this contract smoke.'
  );
  assert(fs.existsSync(RUNNER), 'live Agent Photoshop readonly evidence runner is missing.', { RUNNER });

  const source = fs.readFileSync(RUNNER, 'utf8');
  assert(source.includes('new Agent('), 'runner must use the real Agent runtime.');
  assert(source.includes('new ModelService('), 'runner must use ModelService for real model tool calls.');
  assert(source.includes('.chatWithTools('), 'runner must call ModelService.chatWithTools.');
  assert(source.includes('executeToolCall('), 'runner must execute through the real tool executor.');
  assert(source.includes('selectTools(TOOL_NAMES)'), 'runner must use a bounded executable tool subset.');
  assert(source.includes('requiredSignals'), 'runner must verify concrete readback signals.');
  for (const toolName of [
    'diagnoseState',
    'getDocumentSnapshot',
    'getAnnotatedSnapshot',
    'getElementMapping',
    'analyzeLayout',
    'detectLayerIssues',
    'getScreenSnapshots',
    'getScreenSnapshotsWithOverlay',
    'resolveFontName'
  ]) {
    assert(source.includes(toolName), `runner must cover ${toolName}.`);
  }
  assert(source.includes('buildSingleScreenFixture('), 'runner must construct explicit screen evidence for screen snapshot tools.');
  assert(source.includes('findToolWithScreensArg('), 'runner must require screen tools to receive explicit screens data.');
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
    checks: [
      'runner uses real Agent runtime',
      'runner uses ModelService.chatWithTools',
      'runner executes through real tool executor',
      'runner is guarded by --live',
      'runner covers readonly evidence, diagnostic, screen snapshot, and font resolver tools',
      'runner has no scripted tool_calls'
    ]
  }, null, 2));
}

main();
