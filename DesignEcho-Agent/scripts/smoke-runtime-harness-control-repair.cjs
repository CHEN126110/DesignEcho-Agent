#!/usr/bin/env node
/* eslint-disable no-console */

'use strict';

const assert = require('assert');
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
const { createRuntimeSessionIdentityForPlan } = require('./runtime-session-smoke-fixture.cjs');

const { Agent } = require(path.join(ROOT, 'src', 'renderer', 'services', 'agent-runtime', 'agent.ts'));
const {
  resolveAutonomousCapabilityRuntime
} = require(path.join(ROOT, 'src', 'renderer', 'services', 'skill-executors', 'autonomous-agent.executor.ts'));
const {
  DECLARE_DESIGN_BRIEF_TOOL_NAME
} = require(path.join(ROOT, 'src', 'shared', 'agent-runtime-v5', 'runtime-design-brief-declaration.ts'));
const {
  buildAutonomousExecutionDecisionForEngine
} = require(path.join(ROOT, 'src', 'shared', 'agent-intent-control-plane.ts'));

function fixtureInputSources(manifest) {
  return manifest.required_inputs.map((inputKey) => {
    const sourceKind = manifest.input_sources[inputKey]?.[0];
    assert(sourceKind, `Manifest input ${inputKey} must declare at least one source kind.`);
    return {
      sourceKind,
      inputKeys: [inputKey]
    };
  });
}

function validBrief(manifest) {
  const inputSources = fixtureInputSources(manifest);
  const inputRefs = inputSources.map((source) => (
    `input:${source.inputKeys[0]}:${source.sourceKind}`
  ));
  return {
    taskGoal: '验证无效 R1 声明能够在有界修复后通过。',
    deliverables: ['结构化 Brief'],
    outputRequirements: ['不执行 Photoshop'],
    constraints: [],
    inputCoverage: manifest.required_inputs.map((inputKey, index) => ({
      inputKey,
      status: 'provided',
      contextRefs: [inputRefs[index]]
    })),
    contextRefs: ['context:user_goal', 'context:skill_manifest', ...inputRefs]
  };
}

async function main() {
  const runtime = resolveAutonomousCapabilityRuntime({ declaredSkillId: 'main-image-design' });
  const bundle = runtime.runtimeContractBundle;
  assert(bundle);
  const task = '读取当前 fixture 文档，并声明主图任务 Brief；本测试不执行 Photoshop。';
  const externalCalls = [];
  const events = [];
  let modelCallCount = 0;
  const agent = new Agent(
    {
      systemPrompt: 'Harness control repair smoke.',
      tools: runtime.capabilitySession.activeTools,
      modelId: 'fixture-model',
      maxIterations: 4,
      runtimeLoopContract: bundle.runtimeLoopContract,
      runtimeStagePlan: bundle.stagePlan,
      runtimeDesignBriefAvailableInputSources: fixtureInputSources(bundle.manifest),
      runtimeSessionIdentity: createRuntimeSessionIdentityForPlan(bundle.stagePlan, 'repair'),
      toolCapabilityBridge: bundle.toolCapabilityBridge,
      getCapabilityResolution: () => runtime.capabilitySession.getResolution(),
      getActiveCapabilityIdsForTool: (toolName) => runtime.capabilitySession.getActiveCapabilityIdsForTool(toolName),
      toolDecisionContext: {
        intentControlPlane: buildAutonomousExecutionDecisionForEngine('repair smoke'),
        photoshopConnected: true,
        hasDocument: true,
        hasImageInput: false
      },
      callbacks: {
        onStep: (event) => events.push(event)
      }
    },
    async (_modelId, _messages, tools) => {
      modelCallCount += 1;
      if (modelCallCount === 1) {
        assert(tools.length < 20);
        return {
          content: '先读取文档并提交 Brief。',
          toolCalls: [
            { id: 'read-doc', name: 'getDocumentInfo', arguments: {} },
            {
              id: 'invalid-brief',
              name: DECLARE_DESIGN_BRIEF_TOOL_NAME,
              arguments: {
                ...validBrief(bundle.manifest),
                contextRefs: undefined
              }
            }
          ]
        };
      }
      if (modelCallCount === 2) {
        assert.deepStrictEqual(tools.map((tool) => tool.name), [DECLARE_DESIGN_BRIEF_TOOL_NAME]);
        return {
          content: '根据 Harness issue 修正 Brief，不重复读取。',
          toolCalls: [{
            id: 'repaired-brief',
            name: DECLARE_DESIGN_BRIEF_TOOL_NAME,
            arguments: validBrief(bundle.manifest)
          }]
        };
      }
      return { content: 'Brief 已修正；本测试不执行 Photoshop 或声明设计完成。', toolCalls: [] };
    },
    async (toolName) => {
      externalCalls.push(toolName);
      if (toolName === 'getAnnotatedSnapshot') {
        return { success: true, elements: [{ id: 1, name: 'fixture' }] };
      }
      if (toolName === 'getDocumentInfo') {
        return { success: true, documentId: 1, name: 'fixture.psd' };
      }
      throw new Error(`Unexpected external Tool: ${toolName}`);
    }
  );

  const result = await agent.run(task);
  const briefCalls = result.toolCallLog.filter((entry) => entry.name === DECLARE_DESIGN_BRIEF_TOOL_NAME);
  assert.strictEqual(briefCalls.length, 2);
  assert.strictEqual(briefCalls[0].result.code, 'runtime_design_brief_declaration_invalid');
  assert.strictEqual(briefCalls[1].result.readiness, 'ready');
  assert.strictEqual(result.data.runtimeDesignBriefDeclaration.readiness, 'ready');
  assert.deepStrictEqual(externalCalls.slice(0, 2), ['getAnnotatedSnapshot', 'getDocumentInfo']);
  assert.strictEqual(externalCalls.filter((name) => name === 'getAnnotatedSnapshot').length, 1);
  assert.ok(
    externalCalls.slice(2).every((name) => name === 'getDocumentInfo'),
    `repair may only append Runtime final document reads: ${JSON.stringify(externalCalls)}`
  );
  assert(events.some((event) => event.issue === 'runtime_design_brief_declaration_invalid'));

  console.log(JSON.stringify({
    success: true,
    modelCallCount,
    briefAttempts: briefCalls.length,
    repairToolSurface: [DECLARE_DESIGN_BRIEF_TOOL_NAME],
    externalCalls,
    boundaries: {
      repairIsBounded: true,
      repeatsOpeningSnapshotRead: false,
      finalDocumentReadAllowed: true,
      executesPhotoshop: false,
      grantsPermission: false,
      claimsQuality: false
    }
  }, null, 2));
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exit(1);
});
