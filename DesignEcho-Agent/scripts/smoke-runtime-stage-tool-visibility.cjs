#!/usr/bin/env node
/* eslint-disable no-console */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

if (!globalThis.window) globalThis.window = {};
const memoryStorage = new Map();
if (!globalThis.localStorage) {
  globalThis.localStorage = {
    getItem: (key) => memoryStorage.has(String(key)) ? memoryStorage.get(String(key)) : null,
    setItem: (key, value) => memoryStorage.set(String(key), String(value)),
    removeItem: (key) => memoryStorage.delete(String(key)),
    clear: () => memoryStorage.clear()
  };
}
globalThis.window.localStorage = globalThis.localStorage;

require('ts-node').register({
  transpileOnly: true,
  project: path.join(ROOT, 'tsconfig.main.json')
});

const {
  RUNTIME_PLANNING_CONTEXT_CAPABILITIES,
  buildRuntimeStagePlan,
  isRuntimeStageToolVisible
} = require(path.join(ROOT, 'src', 'shared', 'agent-runtime-v5', 'runtime-stage-plan.ts'));
const {
  classifyAgentToolExecution
} = require(path.join(ROOT, 'src', 'shared', 'agent-tool-execution-preflight.ts'));
const {
  selectPreferredLegacyToolsForCapabilities
} = require(path.join(ROOT, 'src', 'shared', 'agent-runtime-v5', 'tool-capability-bridge.ts'));
const {
  MAIN_IMAGE_MANIFEST
} = require(path.join(ROOT, 'src', 'shared', 'agent-runtime-v5', 'manifests', 'main-image.manifest.ts'));
const {
  DETAIL_PAGE_MANIFEST
} = require(path.join(ROOT, 'src', 'shared', 'agent-runtime-v5', 'manifests', 'detail-page.manifest.ts'));
const {
  SKU_BATCH_MANIFEST
} = require(path.join(ROOT, 'src', 'shared', 'agent-runtime-v5', 'manifests', 'sku-batch.manifest.ts'));
const {
  getDefaultAgentTools
} = require(path.join(ROOT, 'src', 'renderer', 'services', 'agent-runtime', 'tool-schemas.ts'));
const {
  buildSkillToolSchemas
} = require(path.join(ROOT, 'src', 'renderer', 'services', 'skill-executors', 'skill-tools.ts'));

function main() {
  // 逐 manifest 循环验证「声明阶段 R1/R3/R4 不泄漏写/交付工具」——只适用于走完整声明流的创意任务。
  // 结构化任务（sku-batch）已改精简阶段链、无 R1/R3/R4/E2 声明门，不属本循环覆盖面；
  // 下方对 isRuntimeStageToolVisible 的函数级断言仍覆盖全部阶段（含结构化任务实际经过的 R0/R2/E1/R5）。
  const manifests = [MAIN_IMAGE_MANIFEST, DETAIL_PAGE_MANIFEST];
  const stageSummaries = [];
  for (const manifest of manifests) {
    const plan = buildRuntimeStagePlan(manifest);
    const r1 = plan.steps.find((step) => step.stage === 'R1');
    const r3 = plan.steps.find((step) => step.stage === 'R3');
    const r4 = plan.steps.find((step) => step.stage === 'R4');
    const r5 = plan.steps.find((step) => step.stage === 'R5');
    const e2 = plan.steps.find((step) => step.stage === 'E2');
    assert.deepStrictEqual(r1.allowedToolCapabilities, [...RUNTIME_PLANNING_CONTEXT_CAPABILITIES]);
    assert.deepStrictEqual(r3.allowedToolCapabilities, [...RUNTIME_PLANNING_CONTEXT_CAPABILITIES]);
    assert(!r1.allowedToolCapabilities.some((capabilityId) => capabilityId.startsWith('skill.')));
    assert(!r1.allowedToolCapabilities.some((capabilityId) => capabilityId.startsWith('delivery.')));
    assert(!r1.allowedToolCapabilities.some((capabilityId) => capabilityId.startsWith('photoshop.sandbox.')));
    assert(!r4.allowedToolCapabilities.some((capabilityId) => capabilityId.startsWith('delivery.')));
    assert(!r4.allowedToolCapabilities.some((capabilityId) => capabilityId.startsWith('photoshop.sandbox.')));
    assert(!r5.allowedToolCapabilities.some((capabilityId) => capabilityId.startsWith('delivery.')));
    assert(!r5.allowedToolCapabilities.some((capabilityId) => capabilityId.startsWith('photoshop.sandbox.')));
    assert(e2.allowedToolCapabilities.every((capabilityId) => capabilityId.startsWith('delivery.')));
    stageSummaries.push({
      skillId: manifest.skill_id,
      taskType: manifest.task_type,
      r1CapabilityCount: r1.allowedToolCapabilities.length,
      r3CapabilityCount: r3.allowedToolCapabilities.length
    });
  }

  const executableToolNames = [
    ...getDefaultAgentTools(),
    ...buildSkillToolSchemas()
  ].map((tool) => tool.name);
  const preferredTools = selectPreferredLegacyToolsForCapabilities({
    capabilityIds: RUNTIME_PLANNING_CONTEXT_CAPABILITIES,
    executableToolNames
  });
  assert(preferredTools.length <= RUNTIME_PLANNING_CONTEXT_CAPABILITIES.length);
  for (const requiredTool of [
    'createInteractiveCard',
    'declareDesignIntent',
    'listProjectResources',
    'searchProjectResources',
    'getDesignPrinciples',
    'searchEagleReferences',
    'getDesignProjectState',
    'getDocumentInfo',
    'getAnnotatedSnapshot',
    'getLayerHierarchy'
  ]) {
    assert(preferredTools.includes(requiredTool), `missing planning context provider: ${requiredTool}`);
  }
  for (const forbiddenTool of [
    'createDocument',
    'placeImage',
    'renderLayout',
    'saveDocument',
    'quickExport',
    'main-image-design',
    'detail-page-design',
    'sku-batch'
  ]) {
    assert(!preferredTools.includes(forbiddenTool), `planning stage exposed execution Tool: ${forbiddenTool}`);
  }

  const serializedCapabilities = JSON.stringify(RUNTIME_PLANNING_CONTEXT_CAPABILITIES);
  assert(!/main.image|detail.page|sku/i.test(serializedCapabilities));

  function visible(stage, toolName, harnessControl = false) {
    return isRuntimeStageToolVisible({
      stage,
      toolName,
      toolKind: classifyAgentToolExecution(toolName, {}),
      harnessControl
    });
  }

  assert.strictEqual(visible('R1', 'getDocumentInfo'), true);
  assert.strictEqual(visible('R2', 'searchEagleReferences'), true);
  assert.strictEqual(visible('R3', 'switchDocument'), true);
  assert.strictEqual(visible('R4', 'renderLayout'), false);
  assert.strictEqual(visible('R4', 'undo'), false);
  assert.strictEqual(visible('R4', 'requestAgentCapabilities', true), true);
  assert.strictEqual(visible('E1', 'renderLayout'), true);
  assert.strictEqual(visible('R5', 'getAcceptanceSnapshot'), true);
  assert.strictEqual(visible('R5', 'saveDocument'), false);
  assert.strictEqual(visible('E2', 'saveDocument'), true);
  assert.strictEqual(visible('E2', 'createRectangle'), false);

  const agentSource = fs.readFileSync(
    path.join(ROOT, 'src', 'renderer', 'services', 'agent-runtime', 'agent.ts'),
    'utf8'
  );
  assert(agentSource.includes('this.runtimeSession?.stageState.currentStage'));
  assert(!agentSource.includes('isRuntimePlanningComplete()'));
  assert(!agentSource.includes('buildPlanningContextToolSubset()'));

  console.log(JSON.stringify({
    success: true,
    version: 'runtime-stage-tool-visibility-smoke/v0',
    stageSummaries,
    planningContextCapabilities: RUNTIME_PLANNING_CONTEXT_CAPABILITIES,
    preferredTools,
    boundaries: {
      categoryNeutral: true,
      taskTextParsed: false,
      currentStageOwnedVisibility: true,
      exposesPhotoshopWritesBeforeR4: false,
      exposesBusinessSkillBeforeR4: false,
      onePreferredProviderPerCapability: true,
      grantsPermission: false
    }
  }, null, 2));
}

main();
