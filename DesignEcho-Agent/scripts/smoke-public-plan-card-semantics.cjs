#!/usr/bin/env node

'use strict';

const fs = require('fs');
const Module = require('module');
const path = require('path');
const ts = require('typescript');

const ROOT = path.resolve(__dirname, '..');
require('ts-node').register({
  transpileOnly: true,
  project: path.join(ROOT, 'tsconfig.json'),
  compilerOptions: {
    module: 'CommonJS',
    moduleResolution: 'node'
  }
});

function assert(condition, message, details) {
  if (condition) return;
  const suffix = details ? `\n${JSON.stringify(details, null, 2)}` : '';
  throw new Error(`${message}${suffix}`);
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
    if (request === '../ThinkingProcess' || request === '../../services/tool-display-info') {
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

function createMessage(approved) {
  return {
    id: approved ? 'approved-plan' : 'pending-plan',
    role: 'assistant',
    content: '已整理本轮处理计划。',
    timestamp: 1777259000060,
    agentTaskPublicPlanExecutionRequest: {
      version: 'agent-task-public-plan-execution-request/v0',
      status: 'blocked_pending_user_confirmation',
      requestId: 'public-plan-semantics',
      proposedWriteTools: ['createTextLayer'],
      readbackTargets: ['acceptance_snapshot'],
      publicPlanSummary: '先读取目标图层和现有文案，再生成候选并按用户选择替换。',
      executionPlanSummary: '读取目标组、生成候选、确认后替换并复核。',
      operationRequests: [],
      blockers: [],
      warnings: []
    },
    ...(approved ? {
      agentTaskPublicPlanApprovalRecord: {
        version: 'agent-task-public-plan-approval-record/v0',
        status: 'approved_controlled_execution_request'
      }
    } : {})
  };
}

function findPlanCard(converted) {
  return converted.blocks.find((block) => (
    block.type === 'card'
    && /处理计划|设计方案/.test(String(block.title || ''))
  ));
}

const { convertLegacyMessage } = loadParserExports();
const pending = convertLegacyMessage(createMessage(false));
const approved = convertLegacyMessage(createMessage(true));
const pendingCard = findPlanCard(pending);
const approvedCard = findPlanCard(approved);

assert(pendingCard?.title === '处理计划待确认', '待确认卡片必须准确标记为处理计划，而不是笼统的设计方案。', pending);
assert(approvedCard?.title === '处理计划已确认', '确认后的卡片必须沿用处理计划语义。', approved);
assert(
  pendingCard.actions?.some((action) => action.action === 'confirmPublicPlan'),
  '待确认处理计划必须保留确认动作。',
  pendingCard
);

console.log(JSON.stringify({
  success: true,
  checks: [
    'pending public-plan card is labeled as handling plan',
    'approved public-plan card preserves handling-plan semantics',
    'pending card keeps explicit confirmation action'
  ]
}, null, 2));
