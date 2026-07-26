#!/usr/bin/env node
'use strict';

const assert = require('assert');
const path = require('path');

const root = path.resolve(__dirname, '..');

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
  project: path.join(root, 'tsconfig.main.json')
});

const { Agent } = require(path.join(root, 'src', 'renderer', 'services', 'agent-runtime', 'agent.ts'));
const {
  buildAutonomousExecutionDecisionForEngine
} = require(path.join(root, 'src', 'shared', 'agent-intent-control-plane.ts'));

const searchTool = {
  name: 'searchEagleReferences',
  description: 'Read-only design reference search fixture.',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string' }
    },
    required: ['query']
  }
};

function createAgent(input) {
  return new Agent(
    {
      systemPrompt: 'Performance budget enforcement smoke.',
      tools: [searchTool],
      modelId: input.modelId || 'test-model',
      maxIterations: 8,
      requireInitialToolCall: false,
      performanceBudget: input.performanceBudget,
      toolDecisionContext: {
        intentControlPlane: buildAutonomousExecutionDecisionForEngine('performance budget smoke'),
        photoshopConnected: input.photoshopConnected === true,
        hasDocument: input.hasDocument === true,
        hasImageInput: false
      },
      callbacks: {}
    },
    input.callModel,
    input.executeTool
  );
}

async function main() {
  let modelCalls = 0;
  let externalToolCalls = 0;
  const modelBudgetAgent = createAgent({
    performanceBudget: {
      maxModelCalls: 1,
      maxToolCalls: 5,
      maxVisionCandidates: 0,
      maxVisualAnalyses: 0,
      maxFullResolutionImageReads: 0,
      softTimeBudgetMs: 60_000
    },
    callModel: async () => {
      modelCalls += 1;
      return {
        content: '先检索一条只读参考，再继续判断。',
        toolCalls: [{
          id: `model-budget-${modelCalls}`,
          name: 'searchEagleReferences',
          arguments: { query: '详情页信息层级' }
        }]
      };
    },
    executeTool: async () => {
      externalToolCalls += 1;
      return { success: true, results: [{ id: 'fixture-1' }] };
    }
  });
  const modelBudgetResult = await modelBudgetAgent.run('检索参考并继续设计');
  assert.strictEqual(modelCalls, 1);
  assert.strictEqual(externalToolCalls, 1);
  assert.strictEqual(modelBudgetResult.data.performanceBudget.dimension, 'model_calls');
  assert.strictEqual(modelBudgetResult.data.performanceBudget.modelCalls, 1);
  // 预算耗尽必须报诚实的 stopReason，不能冒充「迭代耗尽」——否则卡片「原因」误导用户。
  assert.strictEqual(modelBudgetResult.stopReason, 'performance_budget', `budget exhaustion must not mislabel as max_iterations: ${modelBudgetResult.stopReason}`);

  modelCalls = 0;
  externalToolCalls = 0;
  const toolBudgetAgent = createAgent({
    performanceBudget: {
      maxModelCalls: 5,
      maxToolCalls: 1,
      maxVisionCandidates: 0,
      maxVisualAnalyses: 0,
      maxFullResolutionImageReads: 0,
      softTimeBudgetMs: 60_000
    },
    callModel: async () => {
      modelCalls += 1;
      return {
        content: '并行读取两组参考候选。',
        toolCalls: [
          {
            id: 'tool-budget-1',
            name: 'searchEagleReferences',
            arguments: { query: '参考一' }
          },
          {
            id: 'tool-budget-2',
            name: 'searchEagleReferences',
            arguments: { query: '参考二' }
          }
        ]
      };
    },
    executeTool: async () => {
      externalToolCalls += 1;
      return { success: true, results: [{ id: `fixture-${externalToolCalls}` }] };
    }
  });
  const toolBudgetResult = await toolBudgetAgent.run('读取两组参考候选');
  assert.strictEqual(modelCalls, 1);
  assert.strictEqual(externalToolCalls, 1);
  assert.strictEqual(toolBudgetResult.data.performanceBudget.dimension, 'tool_calls');
  assert.strictEqual(toolBudgetResult.data.performanceBudget.toolCalls, 1);

  modelCalls = 0;
  externalToolCalls = 0;
  const timeBudgetAgent = createAgent({
    performanceBudget: {
      maxModelCalls: 5,
      maxToolCalls: 5,
      maxVisionCandidates: 0,
      maxVisualAnalyses: 0,
      maxFullResolutionImageReads: 0,
      softTimeBudgetMs: 0
    },
    callModel: async () => {
      modelCalls += 1;
      return { content: '不应调用', toolCalls: [] };
    },
    executeTool: async () => {
      externalToolCalls += 1;
      return { success: true };
    }
  });
  const timeBudgetResult = await timeBudgetAgent.run('时间预算探针');
  assert.strictEqual(modelCalls, 0);
  assert.strictEqual(externalToolCalls, 0);
  assert.strictEqual(timeBudgetResult.data.performanceBudget.dimension, 'soft_time');

  let openingObservationCalls = 0;
  const noVisionOpeningAgent = createAgent({
    photoshopConnected: true,
    hasDocument: true,
    performanceBudget: {
      maxModelCalls: 1,
      maxToolCalls: 5,
      maxVisionCandidates: 0,
      maxVisualAnalyses: 0,
      maxFullResolutionImageReads: 0,
      softTimeBudgetMs: 60_000
    },
    callModel: async () => ({
      content: '当前任务不需要自动读取画布。',
      toolCalls: []
    }),
    executeTool: async () => {
      openingObservationCalls += 1;
      return {
        success: true,
        elements: [{ id: 1, name: 'fixture' }],
        imageData: 'ZmFrZS1vcGVuaW5nLWltYWdl',
        mimeType: 'image/png'
      };
    }
  });
  const noVisionOpeningResult = await noVisionOpeningAgent.run('按既有 SKU 规则继续处理');
  assert.strictEqual(openingObservationCalls, 0, 'zero visual budgets must skip the automatic opening snapshot');
  assert.strictEqual(
    noVisionOpeningResult.toolCallLog.some((entry) => entry.origin === 'harness_opening_observation'),
    false,
    'skipped opening snapshot must not enter the Tool ledger'
  );

  const observedImageCounts = [];
  const visualBudgetAgent = createAgent({
    modelId: 'local-llava-13b',
    performanceBudget: {
      maxModelCalls: 3,
      maxToolCalls: 1,
      maxVisionCandidates: 1,
      maxVisualAnalyses: 1,
      maxFullResolutionImageReads: 0,
      softTimeBudgetMs: 60_000
    },
    callModel: async (_modelId, messages) => {
      const imageCount = messages.reduce((count, message) => (
        count + (message.contentBlocks || []).filter((block) => block.type === 'image').length
      ), 0);
      observedImageCounts.push(imageCount);
      return { content: '已根据本轮允许读取的附件给出简要说明。', toolCalls: [] };
    },
    executeTool: async () => ({ success: true })
  });
  await visualBudgetAgent.run('概括附件中的视觉信息', [
    { data: 'ZmFrZS1pbWFnZS0x', mediaType: 'image/png' },
    { data: 'ZmFrZS1pbWFnZS0y', mediaType: 'image/png' }
  ]);
  assert.strictEqual(observedImageCounts[0], 1, 'primary model must receive only the capped visual candidate count');
  assert.strictEqual(visualBudgetAgent.performanceVisionCandidateCount, 1);
  assert.strictEqual(visualBudgetAgent.performanceVisualAnalysisCount, 1);

  await assert.rejects(
    () => visualBudgetAgent.callModelWithAccounting(
      'local-llava-13b',
      [{ role: 'user', content: 'second visual analysis' }],
      [],
      {},
      { visualAnalysis: true }
    ),
    (error) => error?.code === 'agent_visual_analysis_budget_exhausted'
  );

  console.log(JSON.stringify({
    success: true,
    checks: [
      'maxModelCalls stops the real Agent loop before a second model request',
      'maxToolCalls blocks excess parallel Tool calls before external execution',
      'softTimeBudgetMs stops the real Agent loop before new work',
      'zero vision candidate and visual analysis budgets skip the automatic opening snapshot',
      'maxVisionCandidates truncates real multimodal input before the provider call',
      'maxVisualAnalyses blocks a second real visual model judgment'
    ],
    boundary: 'Skill requests resources; Agent runtime enforces the effective capped budget.'
  }, null, 2));
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
