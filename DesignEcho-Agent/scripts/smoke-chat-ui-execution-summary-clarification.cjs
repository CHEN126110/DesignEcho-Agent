#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const Module = require('module');
const ts = require('typescript');

require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '..', 'tsconfig.json'),
  compilerOptions: {
    module: 'CommonJS',
    moduleResolution: 'node'
  }
});

const ROOT = path.resolve(__dirname, '..');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function loadParserExports() {
  const filename = path.join(ROOT, 'src/renderer/components/message/parser.ts');
  const source = fs.readFileSync(filename, 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
      jsx: ts.JsxEmit.React
    },
    fileName: filename
  });

  const parserModule = new Module(filename, module);
  parserModule.filename = filename;
  parserModule.paths = Module._nodeModulePaths(path.dirname(filename));

  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === '../../services/tool-display-info') {
      return {
        getToolDisplayInfo: (toolName) => ({
          name: toolName,
          icon: 'T',
          description: toolName
        })
      };
    }
    if (request === '../../../shared/chat-response-cleaner') {
      return require(path.join(ROOT, 'src/shared/chat-response-cleaner.ts'));
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    parserModule._compile(compiled.outputText, `${filename}.js`);
  } finally {
    Module._load = originalLoad;
  }

  return parserModule.exports;
}

function executionSummary(overrides = {}) {
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
    summaryText: '本轮最终回复已生成。',
    ...overrides
  };
}

function message(overrides = {}) {
  return {
    id: `msg-${Math.random().toString(36).slice(2)}`,
    role: 'assistant',
    timestamp: Date.now(),
    content: '',
    ...overrides
  };
}

function collectCards(rendered) {
  return (rendered.blocks || []).filter((block) => block.type === 'card');
}

function main() {
  const { convertLegacyMessage } = loadParserExports();

  const clarification = convertLegacyMessage(message({
    content: [
      '是的，我会做详情页。当前项目路径是：[local-path-redacted]，如果你需要我开始做详情页，请告诉我：',
      '- **产品类型**（袜子、服装、家居等）',
      '- **需求**（从零创建模板 / 填充已有模板 / 根据项目素材自动生成）',
      '有了这些信息我就可以立即开工。'
    ].join('\n'),
    executionSummary: executionSummary()
  }));
  const clarificationCards = collectCards(clarification);
  assert(
    !clarificationCards.some((card) => card.title === '处理结果：已完成' || card.variant === 'success'),
    `clarification reply must not render a green completed card: ${clarificationCards.map((card) => `${card.title}/${card.variant}`).join(', ')}`
  );
  assert(
    JSON.stringify(clarification.blocks).includes('产品类型') && JSON.stringify(clarification.blocks).includes('需求'),
    'clarification content should remain visible after suppressing the execution summary card.'
  );

  const completed = convertLegacyMessage(message({
    id: 'msg-completed-with-tool-evidence',
    content: '已完成处理，已生成结果并完成检查。',
    executionSummary: executionSummary({
      toolCallCount: 1,
      successfulToolCalls: 1,
      acceptanceVerified: 1,
      summaryText: '处理完成。'
    })
  }));
  const completedCards = collectCards(completed);
  assert(
    completedCards.some((card) => card.title === '处理结果：已完成' && card.variant === 'success'),
    `completed tool result should still render the completed card: ${completedCards.map((card) => `${card.title}/${card.variant}`).join(', ')}`
  );

  console.log('smoke-chat-ui-execution-summary-clarification: 2/2 checks passed');
}

main();
