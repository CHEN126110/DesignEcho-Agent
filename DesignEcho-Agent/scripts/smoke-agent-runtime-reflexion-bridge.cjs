'use strict';

/**
 * smoke: legacy Agent runtime consumes v5 ReAct + Reflexion contract
 *
 * This guards the migration bridge:
 * - the existing renderer Agent loop must consume the v5 loop contract as
 *   data-driven runtime guidance, not as a hidden hardcoded answer.
 * - failed quality verification must produce a Reflexion handoff that a next
 *   ReAct round can consume.
 */

const assert = require('assert');
const path = require('path');

require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '..', 'tsconfig.json'),
  compilerOptions: {
    module: 'CommonJS',
    moduleResolution: 'node'
  }
});

const { Agent } = require(path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'agent-runtime', 'agent.ts'));

function createExecutionIntentControlPlane() {
  return {
    version: 'agent-intent-control-plane/v0',
    requestKind: 'execute_skill',
    toolScope: 'write_photoshop',
    shouldUseConversationalPath: false,
    allowsDeterministicRoute: true,
    allowsRouterModel: true,
    allowsAutonomousExecution: false,
    requiresClarificationBeforeTools: false,
    reason: 'runtime reflexion bridge smoke exercises failed quality-gate handoff.',
    userVisibleSummary: '测试执行意图。',
    matchedSignals: ['smoke_runtime_reflexion_bridge']
  };
}

function createLoopContract() {
  return {
    version: 'react-reflexion-loop/v0',
    r0: {
      owner: 'R0',
      skillId: 'ecommerce.detail_page',
      taskType: 'ecommerce.detail_page.v1',
      runtimeStages: ['R0', 'R1', 'R2', 'R3', 'R4', 'E1', 'R5', 'E2']
    },
    reactLoop: {
      owner: 'R0',
      phases: [
        { phase: 'reason', owner: 'R0', purpose: 'judge next step' },
        { phase: 'act', owner: 'E1', purpose: 'call executable tools only' },
        { phase: 'observe', owner: 'R2', purpose: 'read tool evidence' },
        { phase: 'evaluate', owner: 'R5', purpose: 'quality-gate current result' }
      ],
      toolBoundary: {
        availableTools: ['photoshop.read.getDocumentSummary'],
        forbiddenTools: ['photoshop.raw.batchPlay']
      }
    },
    qualityGate: {
      owner: 'R5',
      passTarget: 'user_confirmation_or_delivery',
      failTarget: 'reflexion'
    },
    reflexion: {
      owner: 'R5',
      onQualityGateFailure: {
        analyzeFailure: true,
        locateStage: true,
        generateNextRoundConstraints: true,
        reenterLoop: 'react'
      }
    }
  };
}

function createToolCapabilityBridge() {
  return {
    version: 'legacy-tool-capability-bridge/v0',
    skillId: 'ecommerce.detail_page',
    taskType: 'ecommerce.detail_page.v1',
    entries: [
      {
        capability: 'photoshop.read.getDocumentSummary',
        executableTools: ['getDocumentInfo'],
        status: 'mapped'
      }
    ],
    mappedCapabilities: ['photoshop.read.getDocumentSummary'],
    unmappedCapabilities: [],
    executableTools: ['getDocumentInfo']
  };
}

function createRuntimeStagePlan() {
  return {
    version: 'runtime-stage-plan/v0',
    skillId: 'ecommerce.detail_page',
    taskType: 'ecommerce.detail_page.v1',
    steps: [
      {
        stage: 'R0',
        owner: 'R0',
        objective: '选择 Skill 并制定阶段计划。',
        requiredEvidence: ['skill_manifest_selected', 'stage_plan_created'],
        allowedToolCapabilities: [],
        failureTarget: 'reflexion'
      },
      {
        stage: 'R5',
        owner: 'R5',
        objective: '执行 Quality Gate。',
        requiredEvidence: ['quality_gate_report'],
        allowedToolCapabilities: [],
        failureTarget: 'reflexion'
      }
    ],
    exitCriteria: ['review 通过且无 required fix']
  };
}

function createAgent(options) {
  const {
    callModel,
    executeTool,
    runtimeLoopContract = createLoopContract(),
    runtimeStagePlan = createRuntimeStagePlan(),
    toolCapabilityBridge = createToolCapabilityBridge(),
    reflexionHandoff,
    callbacks = {}
  } = options;

  return new Agent(
    {
      systemPrompt: 'Test agent. Follow runtime contracts.',
      tools: [
        {
          name: 'getDocumentInfo',
          description: 'Inspect current document',
          inputSchema: { type: 'object', properties: {} }
        }
      ],
      modelId: 'test-model',
      maxIterations: 4,
      runtimeLoopContract,
      runtimeStagePlan,
      toolCapabilityBridge,
      ...(reflexionHandoff ? { reflexionHandoff } : {}),
      toolDecisionContext: {
        intentControlPlane: createExecutionIntentControlPlane(),
        photoshopConnected: true,
        hasDocument: true,
        hasImageInput: false
      },
      callbacks
    },
    callModel,
    executeTool || (async (_name, params) => ({ success: true, params }))
  );
}

async function runCase(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
  } catch (error) {
    console.error(`  ✗ ${name}`);
    throw error;
  }
}

async function main() {
  console.log('smoke: agent-runtime-reflexion-bridge');

  await runCase('injects v5 loop contract into the model context without changing executable tool names', async () => {
    let firstMessages;
    let firstTools;
    const agent = createAgent({
      callModel: async (_modelId, messages, tools) => {
        firstMessages = messages;
        firstTools = tools;
        return { content: '这里只做说明。', toolCalls: [] };
      }
    });

    const result = await agent.run('请检查当前详情页设计。');
    assert.strictEqual(result.success, true);
    assert.ok(firstMessages[0].content.includes('react-reflexion-loop/v0'), firstMessages[0].content);
    assert.ok(firstMessages[0].content.includes('runtime-stage-plan/v0'), firstMessages[0].content);
    assert.ok(firstMessages[0].content.includes('R0: 选择 Skill'), firstMessages[0].content);
    assert.ok(firstMessages[0].content.includes('ecommerce.detail_page'), firstMessages[0].content);
    assert.ok(firstMessages[0].content.includes('Reason / Act / Observe / Evaluate'), firstMessages[0].content);
    assert.ok(firstMessages[0].content.includes('legacy-tool-capability-bridge/v0'), firstMessages[0].content);
    assert.ok(firstMessages[0].content.includes('photoshop.read.getDocumentSummary -> getDocumentInfo'), firstMessages[0].content);
    assert.deepStrictEqual(firstTools.map((tool) => tool.name), ['getDocumentInfo']);
  });

  await runCase('failed verification produces Reflexion handoff for the next ReAct round', async () => {
    let callCount = 0;
    const agent = createAgent({
      callModel: async () => {
        callCount += 1;
        if (callCount === 1) {
          return {
            content: '先读取文档。',
            toolCalls: [{ id: 'tool-1', name: 'getDocumentInfo', arguments: {} }]
          };
        }
        return { content: '我已处理完成。', toolCalls: [] };
      },
      executeTool: async () => ({ success: false, error: '文档读取失败' })
    });

    const result = await agent.run('请检查当前详情页设计。');
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.executionSummary.status, 'failed');
    assert.strictEqual(result.executionSummary.reflexionHandoff.status, 'reflexion_required');
    assert.strictEqual(result.executionSummary.reflexionHandoff.reenterLoop, 'react');
    assert.ok(
      result.executionSummary.reflexionHandoff.nextRoundConstraints.length > 0,
      JSON.stringify(result.executionSummary.reflexionHandoff)
    );
    assert.strictEqual(result.data.runtimeLoopContract.version, 'react-reflexion-loop/v0');
    assert.strictEqual(result.data.runtimeStagePlan.version, 'runtime-stage-plan/v0');
    assert.strictEqual(result.data.toolCapabilityBridge.version, 'legacy-tool-capability-bridge/v0');
  });

  await runCase('incoming Reflexion handoff is fed into the next model context', async () => {
    let firstSystemPrompt = '';
    const agent = createAgent({
      reflexionHandoff: {
        version: 'quality-gate-reflexion-handoff/v0',
        status: 'reflexion_required',
        sourceOwner: 'R5',
        targetStage: 'R4',
        reenterLoop: 'react',
        failureAnalysis: ['首屏主次层级不清晰。'],
        strategyAdjustments: ['重新收敛首屏布局。'],
        nextRoundConstraints: ['下一轮必须先修正首屏层级，再执行 Photoshop 写入。']
      },
      callModel: async (_modelId, messages) => {
        firstSystemPrompt = messages[0].content;
        return { content: '下一轮将先修正首屏层级。', toolCalls: [] };
      }
    });

    await agent.run('继续上一轮详情页设计。');
    assert.ok(firstSystemPrompt.includes('quality-gate-reflexion-handoff/v0'), firstSystemPrompt);
    assert.ok(firstSystemPrompt.includes('下一轮必须先修正首屏层级'), firstSystemPrompt);
  });
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
