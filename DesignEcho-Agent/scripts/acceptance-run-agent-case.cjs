#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

require('ts-node').register({
  transpileOnly: true,
  compilerOptions: {
    target: 'ES2020',
    module: 'CommonJS',
    moduleResolution: 'node',
    esModuleInterop: true,
    skipLibCheck: true
  }
});

const {
  buildAgentRunDebugBundle,
  buildAgentRunDebugBundleFromMessage,
  evaluateAgentAcceptance,
  formatAgentAcceptanceReportMarkdown
} = require('../src/shared/agent-acceptance-contracts.ts');
const { buildAgentRequestLifecycle } = require('../src/shared/agent-request-lifecycle.ts');

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function layer(id, name, index, kind = 'pixel', overrides = {}) {
  return {
    id,
    name,
    kind,
    visible: true,
    locked: false,
    opacity: 100,
    blendMode: 'normal',
    depth: 0,
    index,
    parentId: null,
    parentName: null,
    path: name,
    selected: false,
    bounds: {
      left: 20 + index * 10,
      top: 20 + index * 10,
      right: 220 + index * 10,
      bottom: 120 + index * 10,
      width: 200,
      height: 100
    },
    ...overrides
  };
}

function snapshot(layers) {
  return {
    success: true,
    hasDocument: true,
    generatedAt: '2026-05-15T00:00:00.000Z',
    document: {
      id: 1,
      name: 'acceptance-smoke.psd',
      width: 800,
      height: 800,
      mode: 'RGB'
    },
    selectedLayerIds: [],
    layers,
    summary: {
      totalLayers: layers.length,
      selectedLayers: 0,
      hiddenLayers: 0,
      lockedLayers: 0,
      textLayers: layers.filter((item) => item.kind === 'text').length,
      groupLayers: 0,
      smartObjectLayers: 0,
      shapeLayers: 0,
      pixelLayers: layers.filter((item) => item.kind === 'pixel').length,
      truncated: false
    },
    warnings: []
  };
}

function makeLifecycle(acceptanceCase, overrides) {
  return buildAgentRequestLifecycle({
    userInput: acceptanceCase.userInput,
    context: {
      isPluginConnected: true,
      photoshopContext: {
        hasDocument: true,
        documentName: 'acceptance-smoke.psd',
        activeLayerName: '图层 1',
        layerCount: 3
      },
      projectContext: {
        projectPath: 'C:/DesignEcho/test-project',
        projectImageCount: 8
      }
    },
    ...overrides
  });
}

function makeExecutionSummary(overrides) {
  return {
    status: 'completed',
    stopReason: 'final_response',
    iterations: 1,
    toolCallCount: 0,
    successfulToolCalls: 0,
    failedToolCalls: 0,
    acceptanceVerified: 0,
    acceptanceFailed: 0,
    acceptanceNeedsReview: 0,
    noDocumentChangeRisks: 0,
    blockers: [],
    warnings: [],
    summaryText: '合成验收样本完成。',
    ...overrides
  };
}

function buildSyntheticCases() {
  const chatCase = {
    id: 'agent-acceptance-chat-no-photoshop',
    title: '普通问候不应进入 Photoshop 执行链',
    userInput: '你好啊',
    mode: 'offline',
    tags: ['chat', 'routing'],
    expectation: {
      route: 'direct_response',
      executionKind: 'none',
      shouldUseTools: false,
      shouldChangeDocument: false,
      expectedExecutionStatus: 'completed',
      maxIterations: 0,
      maxToolCalls: 0
    }
  };

  const saveCase = {
    id: 'agent-acceptance-save-psd-document-management',
    title: '保存 PSD 请求应走 document-management',
    userInput: '帮我把详情页文档保存到项目的PSD中',
    mode: 'offline',
    tags: ['document', 'routing'],
    expectation: {
      route: 'skill_execution',
      routeSource: 'deterministic_route',
      skillId: 'document-management',
      executionKind: 'deterministic_skill',
      shouldUseTools: true,
      shouldChangeDocument: false,
      expectedExecutionStatus: 'completed',
      maxIterations: 1,
      maxToolCalls: 2
    }
  };

  const layerCase = {
    id: 'agent-acceptance-layer-order-document-change',
    title: '图层排序请求应走 layer-management 并产生结构变化证据',
    userInput: '把图层的颜色从浅到深，从上到下调整图层顺序',
    mode: 'offline',
    tags: ['layer-management', 'photoshop'],
    expectation: {
      route: 'skill_execution',
      routeSource: 'deterministic_route',
      skillId: 'layer-management',
      executionKind: 'deterministic_skill',
      shouldUseTools: true,
      shouldChangeDocument: true,
      expectedExecutionStatus: 'completed',
      maxIterations: 1,
      maxToolCalls: 3
    }
  };

  const before = snapshot([
    layer(1, '深色', 0),
    layer(2, '中灰', 1),
    layer(3, '浅色', 2)
  ]);
  const after = snapshot([
    layer(1, '深色', 2),
    layer(2, '中灰', 1),
    layer(3, '浅色', 0)
  ]);

  return [
    {
      acceptanceCase: chatCase,
      bundle: buildAgentRunDebugBundle({
        acceptanceCase: chatCase,
        lifecycle: makeLifecycle(chatCase, {
          routeSource: 'lightweight_intent',
          route: 'direct_response',
          intentSummary: '普通问候，直接回复。',
          reason: '轻量意图识别为普通聊天。'
        }),
        executionSummary: makeExecutionSummary({ iterations: 0 }),
        visibleThinking: [],
        visibleMessages: ['你好。我可以回答问题，也可以执行 Photoshop 任务。']
      })
    },
    {
      acceptanceCase: saveCase,
      bundle: buildAgentRunDebugBundleFromMessage({
        acceptanceCase: saveCase,
        message: {
          content: '文档已保存。',
          agentRequestLifecycle: makeLifecycle(saveCase, {
            routeSource: 'deterministic_route',
            route: 'skill_execution',
            skillId: 'document-management',
            executionKind: 'deterministic_skill',
            intentSummary: '保存当前详情页 PSD 到项目目录。',
            reason: '命中高确定性文档管理路由。'
          }),
          executionSummary: makeExecutionSummary({
            iterations: 1,
            toolCallCount: 1,
            successfulToolCalls: 1,
            summaryText: '文档保存操作完成。'
          }),
          thinkingSteps: [
            {
              type: 'tool',
              content: '工具完成：saveDocument',
              toolName: 'saveDocument',
              toolResult: {
                success: true,
                acceptance: { status: 'not_applicable' }
              }
            }
          ]
        }
      })
    },
    {
      acceptanceCase: layerCase,
      bundle: buildAgentRunDebugBundle({
        acceptanceCase: layerCase,
        lifecycle: makeLifecycle(layerCase, {
          routeSource: 'deterministic_route',
          route: 'skill_execution',
          skillId: 'layer-management',
          executionKind: 'deterministic_skill',
          intentSummary: '按图层颜色明度调整堆叠顺序。',
          reason: '命中图层管理确定性路由。'
        }),
        executionSummary: makeExecutionSummary({
          iterations: 1,
          toolCallCount: 2,
          successfulToolCalls: 2,
          acceptanceVerified: 1,
          summaryText: '图层排序完成并发现结构变化。'
        }),
        tools: [
          { name: 'getLayerHierarchy', success: true, durationMs: 80 },
          { name: 'reorderLayer', success: true, durationMs: 140, acceptanceStatus: 'collected' }
        ],
        beforeSnapshot: before,
        afterSnapshot: after,
        visibleThinking: ['我会先读取图层层级，再按明度调整顺序。'],
        visibleMessages: ['图层顺序已调整。']
      })
    }
  ];
}

function writeOutputs(payload) {
  const outDir = path.join(__dirname, '..', 'tmp', 'acceptance');
  ensureDir(outDir);

  const jsonPath = path.join(outDir, 'agent-acceptance-smoke.json');
  const mdPath = path.join(outDir, 'agent-acceptance-smoke.md');
  fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2), 'utf8');

  const lines = [
    '# Agent Acceptance Smoke',
    '',
    `- success: ${payload.success}`,
    `- cases: ${payload.reports.length}`,
    ''
  ];
  for (const report of payload.reports) {
    lines.push(formatAgentAcceptanceReportMarkdown(report));
  }
  fs.writeFileSync(mdPath, lines.join('\n'), 'utf8');

  return { json: jsonPath, md: mdPath };
}

function run() {
  const syntheticCases = buildSyntheticCases();
  const reports = syntheticCases.map(({ acceptanceCase, bundle }) => {
    return evaluateAgentAcceptance(acceptanceCase, bundle);
  });
  const success = reports.every((report) => report.status === 'passed');
  const output = {
    success,
    reports,
    bundles: syntheticCases.map((item) => item.bundle)
  };
  const report = writeOutputs(output);

  return {
    success,
    report,
    cases: reports.map((item) => ({
      id: item.caseId,
      status: item.status,
      issueLayers: item.issueLayers,
      summary: item.summary
    }))
  };
}

try {
  const result = run();
  console.log(JSON.stringify(result, null, 2));
  if (!result.success) process.exit(1);
} catch (error) {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
}
