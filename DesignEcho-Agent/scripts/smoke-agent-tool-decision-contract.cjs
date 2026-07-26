const fs = require('fs');
const path = require('path');

require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '..', 'tsconfig.json'),
  compilerOptions: {
    module: 'CommonJS',
    moduleResolution: 'node'
  }
});

const {
  buildAgentToolDecisionContract,
  formatAgentToolDecisionContractBlocker
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'agent-tool-decision-contract.ts'));
const {
  buildAgentIntentControlPlaneDecision
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'agent-intent-control-plane.ts'));
const {
  Agent
} = require(path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'agent-runtime', 'agent.ts'));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeReport(payload) {
  const outDir = path.join(__dirname, '..', 'tmp');
  ensureDir(outDir);
  const jsonPath = path.join(outDir, 'agent-tool-decision-contract-smoke.json');
  const mdPath = path.join(outDir, 'agent-tool-decision-contract-smoke.md');
  fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2), 'utf8');
  fs.writeFileSync(mdPath, [
    '# Agent Tool Decision Contract Smoke',
    '',
    `- success: ${payload.success}`,
    '',
    ...payload.cases.flatMap((item) => [
      `## ${item.name}`,
      `- status: ${item.status}`,
      item.details ? `- details: ${item.details}` : '',
      ''
    ])
  ].join('\n'), 'utf8');
  return { json: jsonPath, md: mdPath };
}

async function runCase(name, fn) {
  try {
    const details = await fn();
    return { name, status: 'pass', details: JSON.stringify(details) };
  } catch (error) {
    return {
      name,
      status: 'fail',
      details: error && error.stack ? error.stack : String(error)
    };
  }
}

function decisionFor(userInput) {
  return buildAgentIntentControlPlaneDecision({ userInput });
}

function baseRuntime(overrides = {}) {
  return {
    availableTools: [
      'getDocumentInfo',
      'getLayerHierarchy',
      'listDocuments',
      'createDocument',
      'createRectangle',
      'createTextLayer',
      'createGroup',
      'renderLayout',
      'saveDocument',
      'generateImage',
      'searchDesigns',
      'fetchWebPageDesignContent'
    ],
    photoshopConnected: true,
    hasDocument: true,
    ...overrides
  };
}

async function main() {
  const cases = [];

  cases.push(await runCase('decision-contract-does-not-own-execution-sequence-preflight', async () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, '..', 'src', 'shared', 'agent-tool-decision-contract.ts'),
      'utf8'
    );
    assert(!source.includes('buildAgentToolExecutionPreflight'), 'eligibility contract must not call execution preflight');
    assert(!source.includes('same_batch_tool_decision_contract'), 'eligibility contract must not fabricate same-batch evidence');
    return { executionSequenceOwner: 'agent-tool-execution-preflight' };
  }));

  cases.push(await runCase('all-next-turn-tool-restrictions-use-one-recovery-directive-writer', async () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'agent-runtime', 'agent.ts'),
      'utf8'
    );
    assert(!source.includes('nextToolNameAllowlistForIteration'), 'legacy next-turn allowlist state must be retired');
    assert(!source.includes('activeToolNameAllowlistForIteration'), 'legacy active allowlist state must be retired');
    const pendingWrites = source.match(/this\.pendingRecoveryDirective\s*=/g) || [];
    assert(pendingWrites.length === 3, `pending directive may only be reset, consumed and written by its scheduler: ${pendingWrites.length}`);
    const scheduledCalls = source.match(/this\.scheduleRecoveryDirective\(\{/g) || [];
    assert(scheduledCalls.length === 8, `all eight recovery paths must use the scheduler: ${scheduledCalls.length}`);
    return { pendingWrites: pendingWrites.length, scheduledRecoveryPaths: scheduledCalls.length };
  }));

  cases.push(await runCase('structured-intent-decision-is-consumed-before-any-fallback-inference', async () => {
    const agentSource = fs.readFileSync(
      path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'agent-runtime', 'agent.ts'),
      'utf8'
    );
    const conversationalSource = fs.readFileSync(
      path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'agent-orchestration', 'conversational.ts'),
      'utf8'
    );
    const executorSource = fs.readFileSync(
      path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'skill-executors', 'autonomous-agent.executor.ts'),
      'utf8'
    );
    const agentInferenceCalls = agentSource.match(/buildAgentIntentControlPlaneDecision\(\{/g) || [];
    const conversationalInferenceCalls = conversationalSource.match(/buildAgentIntentControlPlaneDecision\(\{/g) || [];
    assert(agentInferenceCalls.length === 1, `Agent may infer intent only once at run start: ${agentInferenceCalls.length}`);
    assert(conversationalInferenceCalls.length === 1, `conversational path may infer only when no signed decision was supplied: ${conversationalInferenceCalls.length}`);
    assert(executorSource.indexOf('isCompleteAgentIntentControlPlaneDecision(provided)')
      < executorSource.indexOf('const fallback = buildAgentIntentControlPlaneDecision'),
    'executor must consume a complete signed decision before constructing fallback inference');
    return { agentInferenceCalls: 1, conversationalInferenceCalls: 1 };
  }));

  cases.push(await runCase('harness-control-declarations-do-not-require-an-open-photoshop-document', async () => {
    const input = '参考这张详情页做海报，保持文字可编辑';
    const harnessTools = [
      'declareDesignBrief',
      'declareDesignStrategy',
      'declareRuntimeActionPlan'
    ];
    const contract = buildAgentToolDecisionContract({
      userInput: input,
      intentControlPlane: decisionFor(input),
      toolCalls: harnessTools.map((name) => ({ name, arguments: {} })),
      runtime: baseRuntime({
        availableTools: harnessTools,
        photoshopConnected: true,
        hasDocument: false
      })
    });
    assert(contract.status === 'ready', `expected ready, got ${contract.status}`);
    assert(contract.nextAction === 'execute_tools', `expected execute_tools, got ${contract.nextAction}`);
    assert(contract.blockers.length === 0, `expected no blockers, got ${JSON.stringify(contract.blockers)}`);
    return { harnessTools, hasDocument: false };
  }));

  cases.push(await runCase('reference-replication-can-auto-create-its-target-document', async () => {
    const input = '参考这张详情页做海报，保持文字可编辑';
    const contract = buildAgentToolDecisionContract({
      userInput: input,
      intentControlPlane: decisionFor(input),
      toolCalls: [{
        name: 'layout-replication',
        arguments: {
          outputMode: 'apply',
          autoCreateDocument: true,
          userIntent: input
        }
      }],
      runtime: baseRuntime({
        availableTools: ['layout-replication'],
        photoshopConnected: true,
        hasDocument: false
      })
    });
    assert(contract.status === 'ready', `expected ready, got ${contract.status}`);
    assert(contract.nextAction === 'execute_tools', `expected execute_tools, got ${contract.nextAction}`);
    assert(contract.blockers.length === 0, `expected no blockers, got ${JSON.stringify(contract.blockers)}`);
    return { tool: 'layout-replication', hasDocument: false };
  }));

  cases.push(await runCase('workflow-created-document-refreshes-runtime-before-snapshot-readback', async () => {
    const input = '参考这张详情页做海报，完成后读取画布快照';
    const contract = buildAgentToolDecisionContract({
      userInput: input,
      intentControlPlane: decisionFor(input),
      toolCalls: [{ name: 'getCanvasSnapshot', arguments: { maxSize: 1600 } }],
      completedToolCalls: [{
        name: 'layout-replication',
        result: {
          success: true,
          data: {
            createdDocument: true,
            outputIntent: { artifactKind: 'poster', topology: 'single_canvas' }
          }
        }
      }],
      runtime: baseRuntime({
        availableTools: ['getCanvasSnapshot'],
        photoshopConnected: true,
        hasDocument: false
      })
    });
    assert(contract.status === 'ready', `workflow-created document should enable readback: ${JSON.stringify(contract)}`);
    assert(contract.nextAction === 'execute_tools', `expected execute_tools, got ${contract.nextAction}`);
    assert(contract.blockers.length === 0, `unexpected blockers: ${JSON.stringify(contract.blockers)}`);
    return { status: contract.status, nextAction: contract.nextAction };
  }));

  cases.push(await runCase('chat-only-intent-blocks-tool-candidates', async () => {
    const contract = buildAgentToolDecisionContract({
      userInput: '你可以做什么？',
      intentControlPlane: decisionFor('你可以做什么？'),
      assistantContent: '我会查看当前文档。',
      toolCalls: [{ name: 'getDocumentInfo', arguments: {} }],
      runtime: baseRuntime()
    });
    assert(contract.status === 'blocked', `expected blocked, got ${contract.status}`);
    assert(contract.nextAction === 'model_replan_without_tools', `expected model_replan_without_tools, got ${contract.nextAction}`);
    assert(contract.blockers.some((item) => item.code === 'intent_scope_disallows_tools'), `missing scope blocker: ${JSON.stringify(contract)}`);
    const formatted = formatAgentToolDecisionContractBlocker(contract);
    assert(formatted.includes('本轮不会改动画面'), 'formatted blocker should explain that no document operation will run');
    assert(!/intent_scope|direct_response|clarification_needed|tool_decision/i.test(formatted), 'formatted blocker should not expose internal route terms');
    return contract;
  }));

  cases.push(await runCase('read-only-intent-blocks-write-tool', async () => {
    const contract = buildAgentToolDecisionContract({
      userInput: '帮我看看当前文档有多少个图层',
      intentControlPlane: decisionFor('帮我看看当前文档有多少个图层'),
      assistantContent: '我会先查看图层，然后创建文字并检查结果。',
      toolCalls: [{ name: 'createTextLayer', arguments: { content: '备注', x: 10, y: 10 } }],
      runtime: baseRuntime()
    });
    assert(contract.status === 'blocked', `expected blocked, got ${contract.status}`);
    assert(contract.blockers.some((item) => item.code === 'tool_scope_exceeds_intent'), `missing scope blocker: ${JSON.stringify(contract)}`);
    return contract;
  }));

  cases.push(await runCase('unknown-tool-is-blocked-before-runtime-execution', async () => {
    const contract = buildAgentToolDecisionContract({
      userInput: '帮我生成SKU',
      intentControlPlane: decisionFor('帮我生成SKU'),
      assistantContent: '我会先读取项目，再执行 SKU。',
      toolCalls: [{ name: 'nonExistingTool', arguments: {} }],
      runtime: baseRuntime()
    });
    assert(contract.status === 'blocked', `expected blocked, got ${contract.status}`);
    assert(contract.blockers.some((item) => item.code === 'tool_unavailable'), `missing unavailable blocker: ${JSON.stringify(contract)}`);
    return contract;
  }));

  cases.push(await runCase('photoshop-write-blocks-when-photoshop-disconnected', async () => {
    const contract = buildAgentToolDecisionContract({
      userInput: '帮我把文字改成新品上市',
      intentControlPlane: decisionFor('帮我把文字改成新品上市'),
      assistantContent: '我会修改文字并回读结果。',
      toolCalls: [{ name: 'createTextLayer', arguments: { content: '新品上市' } }],
      runtime: baseRuntime({ photoshopConnected: false, hasDocument: false })
    });
    assert(contract.status === 'blocked', `expected blocked, got ${contract.status}`);
    assert(contract.blockers.some((item) => item.code === 'photoshop_not_connected'), `missing photoshop blocker: ${JSON.stringify(contract)}`);
    const formatted = formatAgentToolDecisionContractBlocker(contract);
    assert(!/工具\s*\w+/iu.test(formatted), `formatted blocker should not expose implementation tool names: ${formatted}`);
    assert(!formatted.includes('createTextLayer'), `formatted blocker should not expose raw tool id: ${formatted}`);
    return contract;
  }));

  cases.push(await runCase('complex-design-write-delegates-sequence-discipline-to-execution-preflight', async () => {
    const contract = buildAgentToolDecisionContract({
      userInput: '生成一张详情页基础版式',
      intentControlPlane: decisionFor('生成一张详情页基础版式'),
      assistantContent: '',
      toolCalls: [{ name: 'renderLayout', arguments: { canvas: { width: 790, height: 2400 }, blocks: [] } }],
      runtime: baseRuntime(),
      completedToolCalls: [{
        name: 'createDocument',
        result: {
          success: true,
          documentId: 402,
          document: { id: 402, name: '详情页基础版式', width: 790, height: 2400 }
        }
      }]
    });
    assert(contract.status === 'ready', `eligibility should be ready before execution preflight: ${JSON.stringify(contract)}`);
    assert(!Object.prototype.hasOwnProperty.call(contract, 'evidence'), 'eligibility contract must not publish execution evidence');
    return contract;
  }));

  cases.push(await runCase('simple-photoshop-tool-batch-does-not-require-pre-action-rationale-when-readback-is-planned', async () => {
    const contract = buildAgentToolDecisionContract({
      userInput: '创建一个文字图层，完成后读取图层结构',
      intentControlPlane: {
        ...decisionFor('创建一个文字图层，完成后读取图层结构'),
        matchedSignals: ['smoke_non_basic_autonomous_execution']
      },
      assistantContent: '',
      toolCalls: [
        { name: 'createTextLayer', arguments: { content: '备注', x: 10, y: 10 } },
        { name: 'getLayerHierarchy', arguments: {} }
      ],
      runtime: baseRuntime(),
      completedToolCalls: [{
        name: 'createDocument',
        result: {
          success: true,
          documentId: 401,
          document: { id: 401, name: '基础工具验证', width: 520, height: 360 }
        }
      }]
    });
    assert(contract.status === 'ready', `basic Photoshop write with readback should be ready: ${JSON.stringify(contract)}`);
    assert(contract.allowedToolCalls.length === 2, `eligibility contract should preserve both calls: ${JSON.stringify(contract)}`);
    return contract;
  }));

  cases.push(await runCase('simple-photoshop-tool-batch-can-start-without-visible-verification-copy', async () => {
    const contract = buildAgentToolDecisionContract({
      userInput: '创建临时文档、矩形、文字和图层组，完成后再读回检查',
      intentControlPlane: decisionFor('创建临时文档、矩形、文字和图层组，完成后再读回检查'),
      assistantContent: '',
      toolCalls: [
        { name: 'listDocuments', arguments: { includeDetails: false } },
        { name: 'createDocument', arguments: { width: 720, height: 480, name: '基础工具验证' } },
        { name: 'createRectangle', arguments: { x: 88, y: 104, width: 310, height: 190, name: 'Agent Evidence Card' } },
        { name: 'createTextLayer', arguments: { content: 'Evidence Snapshot Title', x: 118, y: 154, fontSize: 34 } },
        { name: 'createGroup', arguments: { groupName: 'Agent Evidence Screen Group' } }
      ],
      runtime: baseRuntime()
    });
    assert(contract.status === 'ready', `simple Photoshop batch should be allowed to start without a visible verification sentence: ${JSON.stringify(contract)}`);
    assert(!Object.prototype.hasOwnProperty.call(contract, 'evidence'), 'eligibility contract must not fake verification evidence');
    return contract;
  }));

  cases.push(await runCase('tool-call-text-negation-does-not-disable-photoshop-write-tools', async () => {
    const userInput = [
      '阶段 R2：只处理矩形图层的重命名和入组。',
      '第一轮必须优先返回 renameLayer 和 moveLayerToGroup 这两个真实 tool_calls；不要把“执行工具”和参数写成 Markdown 文本。',
      '用 renameLayer 把 layerId=5 的矩形图层改名为 Agent Renamed Rectangle。',
      '用 moveLayerToGroup 把 layerId=5 移动到 targetGroupId=3 的 Agent Managed Group 里面。',
      '完成后调用 getLayerHierarchy 复核重命名和入组结果。'
    ].join('\n');
    const intent = decisionFor(userInput);
    assert(intent.toolScope === 'write_photoshop', `tool-call text negation should not disable write tools: ${JSON.stringify(intent)}`);
    const contract = buildAgentToolDecisionContract({
      userInput,
      intentControlPlane: intent,
      assistantContent: '我将重命名并移动图层，完成后用图层层级复核。',
      toolCalls: [
        { name: 'renameLayer', arguments: { layerId: 5, newName: 'Agent Renamed Rectangle' } },
        { name: 'moveLayerToGroup', arguments: { layerId: 5, targetGroupId: 3, position: 'inside' } },
        { name: 'getLayerHierarchy', arguments: {} }
      ],
      runtime: baseRuntime({
        availableTools: ['renameLayer', 'moveLayerToGroup', 'getLayerHierarchy'],
        photoshopConnected: true,
        hasDocument: true
      }),
      completedToolCalls: [{
        name: 'getLayerHierarchy',
        result: { success: true, documentName: 'AgentLiveLayerManagement-test' }
      }]
    });
    assert(contract.status === 'ready', `rename/move stage should be ready: ${JSON.stringify(contract)}`);
    return { intent, contract };
  }));

  cases.push(await runCase('read-then-write-with-plan-and-evidence-is-ready', async () => {
    const contract = buildAgentToolDecisionContract({
      userInput: '帮我加一个备注文字',
      intentControlPlane: decisionFor('帮我加一个备注文字'),
      assistantContent: '我会先读取当前文档，再创建备注文字，完成后回读图层结果并截图复核。',
      toolCalls: [
        { name: 'getDocumentInfo', arguments: {} },
        { name: 'createTextLayer', arguments: { content: '备注' } }
      ],
      runtime: baseRuntime()
    });
    assert(contract.status === 'ready', `expected ready, got ${contract.status}: ${JSON.stringify(contract.blockers)}`);
    assert(contract.allowedToolCalls.length === 2, `expected two allowed calls, got ${contract.allowedToolCalls.length}`);
    assert(contract.nextAction === 'execute_tools', `expected execute_tools, got ${contract.nextAction}`);
    return contract;
  }));

  cases.push(await runCase('completed-list-documents-evidence-refreshes-document-runtime-state', async () => {
    const contract = buildAgentToolDecisionContract({
      userInput: '帮我读取当前文档图层结构',
      intentControlPlane: decisionFor('帮我读取当前文档图层结构'),
      assistantContent: '我会先确认已打开文档，再读取当前文档的图层结构用于后续判断。',
      completedToolCalls: [{
        name: 'listDocuments',
        result: {
          success: true,
          documents: [
            { id: 7334, name: 'Agent真实基础工具链验证-反馈修复', active: true }
          ]
        }
      }],
      toolCalls: [{ id: 'hierarchy-after-list', name: 'getLayerHierarchy', arguments: {} }],
      runtime: baseRuntime({
        hasDocument: false,
        availableTools: ['listDocuments', 'getLayerHierarchy']
      })
    });
    assert(contract.status === 'ready', `listDocuments evidence should refresh stale hasDocument=false: ${JSON.stringify(contract)}`);
    assert(contract.nextAction === 'execute_tools', `expected execute_tools, got ${contract.nextAction}`);
    assert(!contract.blockers.some((item) => item.code === 'photoshop_document_required'), `should not keep stale document blocker: ${JSON.stringify(contract.blockers)}`);
    return contract;
  }));

  cases.push(await runCase('read-only-inspection-allows-document-switch-context-tool', async () => {
    const contract = buildAgentToolDecisionContract({
      userInput: '切换到文档 7334 并读取图层结构',
      intentControlPlane: decisionFor('切换到文档 7334 并读取图层结构'),
      assistantContent: '我会先切换到指定已打开文档，再读取图层结构并检查目标图层是否存在。',
      completedToolCalls: [{
        name: 'listDocuments',
        result: {
          success: true,
          documents: [
            { id: 7334, name: 'Agent真实基础工具链验证-反馈修复', active: false },
            { id: 7435, name: 'Agent效果与导出验证-协议修复', active: true }
          ]
        }
      }],
      toolCalls: [
        { id: 'switch-doc', name: 'switchDocument', arguments: { documentId: 7334 } },
        { id: 'read-hierarchy', name: 'getLayerHierarchy', arguments: {} }
      ],
      runtime: baseRuntime({
        hasDocument: false,
        availableTools: ['listDocuments', 'switchDocument', 'getLayerHierarchy']
      })
    });
    assert(contract.status === 'ready', `read-only document switch should be allowed as context action: ${JSON.stringify(contract)}`);
    assert(contract.allowedToolCalls.length === 2, `expected switch + hierarchy calls, got ${contract.allowedToolCalls.length}`);
    assert(!contract.blockers.some((item) => item.code === 'tool_scope_exceeds_intent'), `switchDocument should not exceed read-only intent: ${JSON.stringify(contract.blockers)}`);
    assert(!contract.blockers.some((item) => item.code === 'photoshop_document_required'), `switchDocument should not require an already connected document: ${JSON.stringify(contract.blockers)}`);
    return contract;
  }));

  cases.push(await runCase('write-before-read-is-left-to-execution-preflight', async () => {
    const contract = buildAgentToolDecisionContract({
      userInput: '帮我加一个备注文字',
      intentControlPlane: decisionFor('帮我加一个备注文字'),
      assistantContent: '我会创建备注文字，然后读取当前文档并截图复核。',
      toolCalls: [
        { name: 'createTextLayer', arguments: { content: '备注' } },
        { name: 'getDocumentInfo', arguments: {} }
      ],
      runtime: baseRuntime()
    });
    assert(contract.status === 'ready', `eligibility should not duplicate read-before-write preflight: ${JSON.stringify(contract)}`);
    assert(!Object.prototype.hasOwnProperty.call(contract, 'evidence'), 'eligibility contract must not own prior-document evidence');
    return contract;
  }));

  cases.push(await runCase('external-generation-is-separated-from-photoshop-write', async () => {
    const contract = buildAgentToolDecisionContract({
      userInput: '帮我生成一个背景参考图',
      intentControlPlane: decisionFor('帮我生成一个背景参考图'),
      assistantContent: '我会生成一张背景参考图，完成后让你确认是否采用。',
      toolCalls: [{ name: 'generateImage', arguments: { prompt: 'clean product background' } }],
      runtime: baseRuntime({ photoshopConnected: false, hasDocument: false })
    });
    assert(contract.status === 'ready', `expected ready, got ${contract.status}: ${JSON.stringify(contract.blockers)}`);
    assert(contract.warnings.some((item) => item.includes('external_generation')), `expected external generation warning: ${JSON.stringify(contract)}`);
    return contract;
  }));

  cases.push(await runCase('reference-search-intent-authorizes-knowledge-search-without-photoshop', async () => {
    const intentControlPlane = decisionFor('找一些极简袜子主图设计参考');
    assert(intentControlPlane.requestKind === 'execute_skill', `expected execute_skill, got ${intentControlPlane.requestKind}`);
    assert(intentControlPlane.toolScope === 'knowledge_search', `expected knowledge_search, got ${intentControlPlane.toolScope}`);
    const contract = buildAgentToolDecisionContract({
      userInput: '找一些极简袜子主图设计参考',
      intentControlPlane,
      assistantContent: '我会先检索极简袜子主图参考，并整理可用于设计判断的方向。',
      toolCalls: [{ name: 'searchDesigns', arguments: { query: 'minimal socks ecommerce main image reference' } }],
      runtime: baseRuntime({ photoshopConnected: false, hasDocument: false })
    });
    assert(contract.status === 'ready', `expected ready, got ${contract.status}: ${JSON.stringify(contract.blockers)}`);
    assert(contract.nextAction === 'execute_tools', `expected execute_tools, got ${contract.nextAction}`);
    assert(contract.candidateTools[0].scope === 'knowledge_search', `expected knowledge_search scope: ${JSON.stringify(contract.candidateTools)}`);
    assert(!contract.blockers.some((item) => item.code === 'photoshop_not_connected' || item.code === 'photoshop_document_required'), `knowledge search must not be Photoshop-gated: ${JSON.stringify(contract.blockers)}`);
    return contract;
  }));

  cases.push(await runCase('knowledge-search-intent-blocks-photoshop-write-tool', async () => {
    const contract = buildAgentToolDecisionContract({
      userInput: '找一些极简袜子主图设计参考',
      intentControlPlane: decisionFor('找一些极简袜子主图设计参考'),
      assistantContent: '我会创建一层文字并截图复核。',
      toolCalls: [{ name: 'createTextLayer', arguments: { content: '参考方向' } }],
      runtime: baseRuntime()
    });
    assert(contract.status === 'blocked', `expected blocked, got ${contract.status}`);
    assert(contract.blockers.some((item) => item.code === 'tool_scope_exceeds_intent'), `missing scope blocker: ${JSON.stringify(contract)}`);
    const formatted = formatAgentToolDecisionContractBlocker(contract);
    assert(!/createTextLayer|工具\s*\w+/iu.test(formatted), `formatted scope blocker should not expose implementation tool names: ${formatted}`);
    return contract;
  }));

  cases.push(await runCase('autonomous-design-can-start-with-knowledge-search-when-photoshop-is-unavailable', async () => {
    const intentControlPlane = decisionFor('把当前主图优化得更高级');
    assert(intentControlPlane.toolScope === 'write_photoshop', `expected write_photoshop intent, got ${intentControlPlane.toolScope}`);
    const contract = buildAgentToolDecisionContract({
      userInput: '把当前主图优化得更高级',
      intentControlPlane,
      assistantContent: '我会先检索可参考的电商主图视觉方向，再决定是否需要进入 Photoshop 修改。',
      toolCalls: [{ name: 'searchDesigns', arguments: { query: 'premium ecommerce socks main image visual reference' } }],
      runtime: baseRuntime({ photoshopConnected: false, hasDocument: false })
    });
    assert(contract.status === 'ready', `expected ready, got ${contract.status}: ${JSON.stringify(contract.blockers)}`);
    assert(contract.candidateTools[0].scope === 'knowledge_search', `expected knowledge_search scope: ${JSON.stringify(contract.candidateTools)}`);
    assert(!contract.blockers.some((item) => item.code === 'photoshop_not_connected' || item.code === 'photoshop_document_required'), `search first should not require Photoshop: ${JSON.stringify(contract.blockers)}`);
    return contract;
  }));

  cases.push(await runCase('agent-runtime-replans-chat-only-tool-call-without-executor', async () => {
    const executedTools = [];
    let modelCallCount = 0;
    const agent = new Agent(
      {
        systemPrompt: 'Test agent.',
        tools: [{
          name: 'getDocumentInfo',
          description: 'Read document info',
          inputSchema: { type: 'object', properties: {} }
        }],
        modelId: 'test-model',
        maxIterations: 2,
        requireInitialToolCall: true,
        toolDecisionContext: {
          intentControlPlane: decisionFor('你可以做什么？'),
          photoshopConnected: true,
          hasDocument: true
        },
        callbacks: {}
      },
      async () => {
        modelCallCount += 1;
        if (modelCallCount === 1) {
          return {
            content: '我会先查看当前文档。',
            toolCalls: [{ id: 'call-1', name: 'getDocumentInfo', arguments: {} }]
          };
        }
        if (modelCallCount === 2) {
          return {
            content: '我可以协助这些设计工作：主图、点击图、转化图和白底图规划、SKU 组合图和自选备注、详情页设计。你可以直接提出主图、SKU、详情页、项目图片理解、文档保存或图层调整需求；我会先判断它属于对话、只读检查还是需要进入处理流程。',
            toolCalls: []
          };
        }
        return {
          content: '可以。你问能力时，我会先把边界说清楚；你明确要处理项目文件时，我再按任务进入对应流程。',
          toolCalls: []
        };
      },
      async (toolName) => {
        executedTools.push(toolName);
        return { success: true };
      }
    );
    const result = await agent.run('你可以做什么？');
    assert(!executedTools.includes('getDocumentInfo'), `model-requested tool must not execute: ${JSON.stringify(executedTools)}`);
    assert(executedTools.every((toolName) => toolName === 'getAnnotatedSnapshot'), `only opening observation may execute: ${JSON.stringify(executedTools)}`);
    assert(modelCallCount === 3, `chat-only tool call should retry once when the model returns a canned menu, got ${modelCallCount}`);
    assert(result.success === true, `expected successful direct response after replan, got ${result.success}: ${result.message}`);
    assert(result.stopReason === 'final_response', `expected final_response, got ${result.stopReason}`);
    assert(!result.error, `direct replan should not surface an internal error: ${result.error}`);
    assert(result.message.includes('你问能力时'), `expected replanned visible answer: ${result.message}`);
    for (const forbidden of ['我可以协助这些设计工作', '工具决策契约', 'agent_tool_decision_contract_blocked', 'tool_preflight_blocked', 'direct_response', 'clarification_needed', '<tool_call>']) {
      assert(!result.message.includes(forbidden), `direct replan message must not expose ${forbidden}: ${result.message}`);
    }
    return {
      stopReason: result.stopReason,
      executedTools,
      modelCallCount,
      message: result.message
    };
  }));

  cases.push(await runCase('agent-runtime-replans-readonly-write-tool-to-read-tool', async () => {
    const executedTools = [];
    let modelCallCount = 0;
    const agent = new Agent(
      {
        systemPrompt: 'Test agent.',
        tools: [
          {
            name: 'getLayerHierarchy',
            description: 'Read layer hierarchy',
            inputSchema: { type: 'object', properties: {} }
          },
          {
            name: 'createTextLayer',
            description: 'Create a text layer',
            inputSchema: { type: 'object', properties: { content: { type: 'string' } } }
          }
        ],
        modelId: 'test-model',
        maxIterations: 4,
        requireInitialToolCall: true,
        toolDecisionContext: {
          intentControlPlane: decisionFor('帮我看看当前文档有多少个图层'),
          photoshopConnected: true,
          hasDocument: true
        },
        callbacks: {}
      },
      async (_modelId, _messages, tools) => {
        modelCallCount += 1;
        const toolNames = tools.map((tool) => tool.name);
        if (modelCallCount === 1) {
          assert(toolNames.includes('createTextLayer'), 'first model call should see the normal tool list');
          return {
            content: '我会创建一个统计文字。',
            toolCalls: [{ id: 'write-1', name: 'createTextLayer', arguments: { content: '图层统计' } }]
          };
        }
        if (modelCallCount === 2) {
          assert(toolNames.includes('getLayerHierarchy'), 'replan should keep read-only tool available');
          assert(!toolNames.includes('createTextLayer'), 'replan should remove write tool from available tools');
          return {
            content: '我改为只读取图层结构来统计。',
            toolCalls: [{ id: 'read-1', name: 'getLayerHierarchy', arguments: {} }]
          };
        }
        return {
          content: '当前文档共有 5 个图层，其中包含 2 个顶层组。',
          toolCalls: []
        };
      },
      async (toolName, params) => {
        executedTools.push({ toolName, params });
        return { success: true, layerCount: 5, topLevelGroupCount: 2 };
      }
    );
    const result = await agent.run('帮我看看当前文档有多少个图层');
    const taskTools = executedTools.filter((entry) => entry.toolName !== 'getAnnotatedSnapshot');
    assert(taskTools.length === 1, `expected one task tool execution after opening observation, got ${JSON.stringify(executedTools)}`);
    assert(taskTools[0].toolName === 'getLayerHierarchy', `expected getLayerHierarchy, got ${taskTools[0].toolName}`);
    assert(modelCallCount === 3, `expected write attempt, readonly replan, final response; got ${modelCallCount}`);
    assert(result.success === true, `expected successful read-only result, got ${result.success}: ${result.message}`);
    assert(result.stopReason === 'final_response', `expected final_response, got ${result.stopReason}`);
    for (const forbidden of ['createTextLayer', '工具决策契约', 'agent_tool_decision_contract_blocked', 'tool_preflight_blocked']) {
      assert(!result.message.includes(forbidden), `read-only replan message must not expose ${forbidden}: ${result.message}`);
    }
    return {
      stopReason: result.stopReason,
      modelCallCount,
      executedTools,
      message: result.message
    };
  }));

  cases.push(await runCase('agent-runtime-blocked-boundary-copy-stays-user-facing', async () => {
    let executedToolCount = 0;
    const progressEvents = [];
    const stepTexts = [];
    const agent = new Agent(
      {
        systemPrompt: 'Test agent.',
        tools: [{
          name: 'createTextLayer',
          description: 'Create a text layer',
          inputSchema: { type: 'object', properties: { content: { type: 'string' } } }
        }],
        modelId: 'test-model',
        maxIterations: 2,
        requireInitialToolCall: true,
        toolDecisionContext: {
          intentControlPlane: decisionFor('帮我把文字改成新品上市'),
          photoshopConnected: false,
          hasDocument: false
        },
        callbacks: {
          onProgress: (message) => progressEvents.push(String(message || '')),
          onStep: (step) => {
            stepTexts.push(String(step?.title || ''));
            stepTexts.push(String(step?.detail || ''));
          }
        }
      },
      async () => ({
        content: '我会修改文字并回读结果。',
        toolCalls: [{ id: 'write-1', name: 'createTextLayer', arguments: { content: '新品上市' } }]
      }),
      async () => {
        executedToolCount += 1;
        return { success: true };
      }
    );
    const result = await agent.run('帮我把文字改成新品上市');
    assert(executedToolCount === 0, `blocked boundary must not execute tools, got ${executedToolCount}`);
    assert(result.success === false, `expected blocked result, got success=${result.success}`);
    assert(result.stopReason === 'tool_preflight_blocked', `expected tool_preflight_blocked, got ${result.stopReason}`);
    const primaryVisibleText = [result.message, ...progressEvents].join('\n');
    for (const forbidden of ['工具调用', 'createTextLayer']) {
      assert(!primaryVisibleText.includes(forbidden), `blocked runtime primary copy must not expose ${forbidden}: ${primaryVisibleText}`);
    }
    const visibleText = [primaryVisibleText, ...stepTexts].join('\n');
    for (const forbidden of ['工具决策契约', '工具执行前置检查', '任务完成契约', 'agent_tool_decision_contract', 'agent_tool_execution_preflight', 'tool_call', '协议回填', '对应关系']) {
      assert(!visibleText.includes(forbidden), `blocked runtime visible copy must not expose ${forbidden}: ${visibleText}`);
    }
    assert(!stepTexts.join('\n').includes('createTextLayer'), `runtime step copy should use designer-facing operation names: ${stepTexts.join('\n')}`);
    return {
      stopReason: result.stopReason,
      message: result.message,
      progressEvents,
      stepTexts
    };
  }));

  const payload = { success: cases.every((item) => item.status === 'pass'), cases };
  const serialized = JSON.stringify(payload);
  const forbiddenWords = [String.fromCharCode(99, 111, 110, 102, 105, 100, 101), String.fromCharCode(32622, 20449)];
  assert(!forbiddenWords.some((word) => serialized.includes(word)), `contract output must not expose unsupported decision score wording: ${serialized}`);
  assert(!serialized.includes(String.fromCodePoint(0xfffd)), 'report should not contain replacement characters');
  const report = writeReport(payload);
  console.log(JSON.stringify({ ...payload, report }, null, 2));
  process.exit(payload.success ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
