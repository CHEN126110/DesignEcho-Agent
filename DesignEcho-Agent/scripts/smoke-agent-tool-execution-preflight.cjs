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

const { Agent } = require(path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'agent-runtime', 'agent.ts'));
const {
  buildAgentToolExecutionPreflight,
  classifyAgentToolExecution,
  requiresUserVisiblePreActionRationaleForToolCalls
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'agent-tool-execution-preflight.ts'));
const {
  buildAgentIntentControlPlaneDecision
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'agent-intent-control-plane.ts'));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function writeIntentContext(userInput) {
  return {
    intentControlPlane: buildAgentIntentControlPlaneDecision({
      userInput,
      hasImageInput: false,
      hasDocument: true,
      photoshopConnected: true
    }),
    photoshopConnected: true,
    hasDocument: true
  };
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeReport(payload) {
  const outDir = path.join(__dirname, '..', 'tmp');
  ensureDir(outDir);
  const jsonPath = path.join(outDir, 'agent-tool-execution-preflight-smoke.json');
  const mdPath = path.join(outDir, 'agent-tool-execution-preflight-smoke.md');
  fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2), 'utf8');
  fs.writeFileSync(mdPath, [
    '# Agent Tool Execution Preflight Smoke',
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

function createAgent({ callModel, executeTool, callbacks = {}, maxIterations = 4, toolDecisionContext }) {
  return new Agent(
    {
      systemPrompt: 'Test autonomous agent.',
      tools: [
        { name: 'getDocumentInfo', description: 'Read document info', inputSchema: { type: 'object', properties: {} } },
        { name: 'getLayerHierarchy', description: 'Read layer tree', inputSchema: { type: 'object', properties: {} } },
        { name: 'createTextLayer', description: 'Create text', inputSchema: { type: 'object', properties: {} } },
        { name: 'saveDocument', description: 'Save document', inputSchema: { type: 'object', properties: {} } },
        { name: 'generateImage', description: 'Generate image', inputSchema: { type: 'object', properties: {} } },
        { name: 'searchDesigns', description: 'Search design references', inputSchema: { type: 'object', properties: {} } },
        { name: 'fetchWebPageDesignContent', description: 'Fetch design reference page', inputSchema: { type: 'object', properties: {} } }
      ],
      modelId: 'test-model',
      maxIterations,
      requireInitialToolCall: false,
      toolDecisionContext,
      callbacks
    },
    callModel,
    executeTool || (async (name, params) => ({ success: true, name, params }))
  );
}

async function main() {
  const cases = [];

  cases.push(await runCase('tool-classification-is-conservative', async () => {
    assert(classifyAgentToolExecution('getDocumentInfo') === 'read_only_observation', 'getDocumentInfo should be a read-only observation');
    assert(classifyAgentToolExecution('createTextLayer') === 'photoshop_write', 'createTextLayer should be Photoshop write');
    assert(classifyAgentToolExecution('saveDocument') === 'save_export', 'saveDocument should be save/export');
    assert(classifyAgentToolExecution('exportGroup') === 'save_export', 'exportGroup should be save/export');
    assert(classifyAgentToolExecution('generateImage') === 'external_generation', 'generateImage should not be ordinary read-only');
    assert(classifyAgentToolExecution('searchDesigns') === 'knowledge_search', 'searchDesigns should be knowledge search');
    assert(classifyAgentToolExecution('fetchWebPageDesignContent') === 'knowledge_search', 'fetchWebPageDesignContent should be knowledge search');
    assert(classifyAgentToolExecution('getSmartObjectLayers', { autoOpen: false }) === 'read_only_observation',
      'Smart Object inspection without opening contents should remain read-only');
    assert(classifyAgentToolExecution('getSmartObjectLayers', { autoOpen: true }) === 'stateful_context',
      'autoOpen Smart Object inspection changes the active document context');
    assert(classifyAgentToolExecution('delegateToAgent', { role: 'critic' }) === 'stateful_context',
      'read-only teammate delegation should remain context state');
    assert(classifyAgentToolExecution('delegateToAgent', { role: 'executor' }) === 'photoshop_write',
      'executor delegation must be treated as a potential Photoshop write');
    return {
      getDocumentInfo: classifyAgentToolExecution('getDocumentInfo'),
      createTextLayer: classifyAgentToolExecution('createTextLayer'),
      saveDocument: classifyAgentToolExecution('saveDocument'),
      generateImage: classifyAgentToolExecution('generateImage'),
      searchDesigns: classifyAgentToolExecution('searchDesigns'),
      fetchWebPageDesignContent: classifyAgentToolExecution('fetchWebPageDesignContent'),
      smartObjectAutoOpen: classifyAgentToolExecution('getSmartObjectLayers', { autoOpen: true }),
      executorDelegation: classifyAgentToolExecution('delegateToAgent', { role: 'executor' })
    };
  }));

  cases.push(await runCase('first-round-write-tool-without-document-read-is-blocked', async () => {
    const preflight = buildAgentToolExecutionPreflight({
      assistantContent: '我会创建文字图层，并在完成后检查图层结果。',
      toolCalls: [{
        name: 'createTextLayer',
        arguments: { content: '自选备注', x: 100, y: 100 }
      }]
    });
    assert(preflight.status === 'blocked', `expected blocked, got ${preflight.status}`);
    assert(preflight.blockedTool && preflight.blockedTool.name === 'createTextLayer', `blocked tool should be createTextLayer: ${JSON.stringify(preflight)}`);
    assert(preflight.blockers.some((item) => item.includes('尚未读取目标 Photoshop 文档或画面')), `blocked message should name the missing document read: ${JSON.stringify(preflight)}`);
    return {
      status: preflight.status,
      blockedTool: preflight.blockedTool,
      blockers: preflight.blockers
    };
  }));

  cases.push(await runCase('read-only-tool-can-execute-before-write-gate', async () => {
    let executeCalls = 0;
    const agent = createAgent({
      callModel: async (_modelId, _messages, _tools) => {
        if (executeCalls === 0) {
          return {
            content: '',
            toolCalls: [{ id: 'inspect', name: 'getDocumentInfo', arguments: {} }]
          };
        }
        return { content: '已完成检查。', toolCalls: [] };
      },
      executeTool: async () => {
        executeCalls += 1;
        return { success: true, document: { name: 'test.psd' } };
      }
    });

    const result = await agent.run('只检查当前文档');
    assert(executeCalls === 1, `read-only tool should execute once, got ${executeCalls}`);
    assert(result.stopReason === 'final_response', `expected final_response, got ${result.stopReason}`);
    return {
      executeCalls,
      stopReason: result.stopReason
    };
  }));

  cases.push(await runCase('model-cannot-inject-private-target-guard-into-read-call', async () => {
    let modelCalls = 0;
    let executedArguments;
    const fakeGuard = {
      expectedDocumentId: 999,
      expectedActiveLayerId: 998,
      observationTool: 'model_fabrication'
    };
    const originalCall = {
      id: 'fake-read-guard',
      name: 'getDocumentInfo',
      arguments: { __designEchoTargetGuard: fakeGuard }
    };
    const agent = createAgent({
      callModel: async () => {
        modelCalls += 1;
        return modelCalls === 1
          ? { content: '', toolCalls: [originalCall] }
          : { content: '已完成检查。', toolCalls: [] };
      },
      executeTool: async (_name, params) => {
        executedArguments = params;
        return { success: true, document: { id: 611, name: '真实文档.psd' } };
      }
    });

    const result = await agent.run('读取当前文档');
    assert(executedArguments?.__designEchoTargetGuard === undefined, `read execution must strip model-fabricated private guard: ${JSON.stringify(executedArguments)}`);
    assert(originalCall.arguments.__designEchoTargetGuard === fakeGuard, 'sanitization must not mutate the provider response object');
    assert(result.toolCallLog.every((entry) => entry.arguments?.__designEchoTargetGuard === undefined), `fabricated private guard must not enter toolCallLog: ${JSON.stringify(result.toolCallLog)}`);
    return { stopReason: result.stopReason, executedArguments, log: result.toolCallLog };
  }));

  cases.push(await runCase('knowledge-search-tool-does-not-require-photoshop-read', async () => {
    const preflight = buildAgentToolExecutionPreflight({
      assistantContent: '我会检索设计参考，并把可用方向整理给你确认。',
      toolCalls: [{ name: 'searchDesigns', arguments: { query: 'minimal socks ecommerce main image' } }]
    });
    assert(preflight.status === 'ready', `expected ready, got ${preflight.status}`);
    assert(preflight.ready === true, 'knowledge search should be ready');
    assert(preflight.tools[0].kind === 'knowledge_search', `expected knowledge_search, got ${preflight.tools[0].kind}`);
    assert(preflight.blockers.length === 0, `knowledge search should not have blockers: ${JSON.stringify(preflight.blockers)}`);
    assert(preflight.warnings.length === 0, `knowledge search should not be surfaced as a Photoshop read warning: ${JSON.stringify(preflight.warnings)}`);
    return preflight;
  }));

  cases.push(await runCase('reference-replication-workflow-can-create-an-independent-target-without-prior-document-read', async () => {
    const preflight = buildAgentToolExecutionPreflight({
      assistantContent: '我会创建独立海报画布，按参考图生成可编辑版式，然后读取画布快照复核结果。',
      toolCalls: [{
        name: 'layout-replication',
        arguments: {
          outputMode: 'apply',
          autoCreateDocument: true,
          userIntent: '参考这张详情页做海报'
        }
      }]
    });
    assert(preflight.status === 'ready', `reference replication should self-create its target: ${JSON.stringify(preflight)}`);
    assert(preflight.ready === true, 'reference replication preflight should be ready');
    assert(preflight.preconditions.hasPriorDocumentRead === false, 'the workflow must not fabricate a prior document read');
    assert(preflight.blockers.length === 0, `unexpected blockers: ${JSON.stringify(preflight.blockers)}`);
    return preflight;
  }));

  cases.push(await runCase('fresh-create-document-establishes-document-state-for-render-layout', async () => {
    const preflight = buildAgentToolExecutionPreflight({
      assistantContent: '我会在新建画布上一次生成整张详情页版式，然后读取快照复核文字和布局。',
      completedToolCalls: [{
        name: 'createDocument',
        result: {
          success: true,
          documentId: 101,
          document: { id: 101, name: '测试详情页', width: 790, height: 2400 }
        }
      }],
      toolCalls: [{
        name: 'renderLayout',
        arguments: {
          canvas: { width: 790, height: 2400 },
          blocks: [
            { role: 'background', content: '#111827', heightRatio: 1 },
            { role: 'title', content: '舒适透气运动袜', heightRatio: 0.12 },
            { role: 'selling-point', content: '吸汗速干', heightRatio: 0.1 }
          ]
        }
      }]
    });
    assert(preflight.status === 'ready', `renderLayout after successful createDocument should be ready: ${JSON.stringify(preflight)}`);
    assert(Object.keys(preflight).sort().join(',') === 'blockers,preconditions,ready,status,tools,warnings', `preflight should expose only concrete execution fields: ${JSON.stringify(preflight)}`);
    assert(preflight.preconditions.hasPriorDocumentRead === true, `createDocument should establish fresh document state: ${JSON.stringify(preflight.preconditions)}`);
    assert(preflight.preconditions.priorReadTools.includes('createDocument'), `prior reads should name createDocument: ${JSON.stringify(preflight.preconditions)}`);
    return {
      status: preflight.status,
      preconditions: preflight.preconditions,
      blockers: preflight.blockers
    };
  }));

  cases.push(await runCase('latest-identity-bearing-document-observation-wins-target-guard', async () => {
    const preflight = buildAgentToolExecutionPreflight({
      assistantContent: '',
      requiresUserVisiblePreActionRationale: false,
      completedToolCalls: [
        {
          name: 'getDocumentInfo',
          result: {
            success: true,
            document: { id: 401, name: '旧文档.psd', activeLayerId: 41 }
          }
        },
        {
          name: 'createTextLayer',
          result: {
            success: true,
            documentId: 999,
            layerId: 99
          }
        },
        {
          name: 'getAcceptanceSnapshot',
          result: {
            success: true,
            hasDocument: true,
            document: { id: 402, name: '当前文档.psd' },
            historyStateRef: { documentId: 402, historyStateId: 8402 }
          }
        }
      ],
      toolCalls: [{ name: 'createTextLayer', arguments: { content: '目标文档守卫' } }]
    });
    assert(preflight.status === 'ready', `identity-bearing observation should permit the write: ${JSON.stringify(preflight)}`);
    assert(preflight.preconditions.targetGuard?.expectedDocumentId === 402, `latest real document observation should win: ${JSON.stringify(preflight.preconditions.targetGuard)}`);
    assert(preflight.preconditions.targetGuard?.observationTool === 'getAcceptanceSnapshot', `guard should identify its observation tool: ${JSON.stringify(preflight.preconditions.targetGuard)}`);
    assert(preflight.preconditions.targetGuard?.expectedHistoryStateRef?.historyStateId === 8402, `guard should carry the exact observed Host revision: ${JSON.stringify(preflight.preconditions.targetGuard)}`);
    assert(preflight.preconditions.targetGuard?.expectedActiveLayerId === undefined, `active layer must not be carried from an older document observation: ${JSON.stringify(preflight.preconditions.targetGuard)}`);
    return preflight.preconditions;
  }));

  cases.push(await runCase('acceptance-after-transition-refreshes-next-write-target-guard', async () => {
    const preflight = buildAgentToolExecutionPreflight({
      assistantContent: '',
      requiresUserVisiblePreActionRationale: false,
      completedToolCalls: [
        {
          name: 'getDocumentInfo',
          result: {
            success: true,
            document: { id: 406, name: '连续写入.psd', activeLayerId: 45 },
            historyStateRef: { documentId: 406, historyStateId: 8500 }
          }
        },
        {
          name: 'createRectangle',
          result: {
            success: true,
            documentId: 406,
            layerId: 46,
            photoshopHistoryTransition: {
              version: 'photoshop-history-transition/v1',
              basis: 'acceptance_snapshot_pair',
              before: { documentId: 406, historyStateId: 8500 },
              after: { documentId: 406, historyStateId: 8501 },
              mutationObserved: true,
              documentChanged: false
            }
          }
        }
      ],
      toolCalls: [{ name: 'createTextLayer', arguments: { content: '第二次写入' } }]
    });
    assert(preflight.status === 'ready', `after transition should ground the next write: ${JSON.stringify(preflight)}`);
    assert(preflight.preconditions.targetGuard?.expectedDocumentId === 406, `after transition should preserve document identity: ${JSON.stringify(preflight.preconditions.targetGuard)}`);
    assert(preflight.preconditions.targetGuard?.expectedHistoryStateRef?.historyStateId === 8501, `after transition should refresh the exact Host revision: ${JSON.stringify(preflight.preconditions.targetGuard)}`);
    assert(preflight.preconditions.targetGuard?.observationTool === 'createRectangle:acceptance_after', `guard should identify the acceptance-after source: ${JSON.stringify(preflight.preconditions.targetGuard)}`);
    return preflight.preconditions;
  }));

  cases.push(await runCase('failed-write-cross-document-commit-requires-a-fresh-read', async () => {
    const preflight = buildAgentToolExecutionPreflight({
      assistantContent: '',
      requiresUserVisiblePreActionRationale: false,
      completedToolCalls: [
        {
          name: 'getDocumentInfo',
          result: {
            success: true,
            document: { id: 406, activeLayerId: 45 },
            historyStateRef: { documentId: 406, historyStateId: 8500 }
          }
        },
        {
          name: 'createRectangle',
          result: {
            success: false,
            error: 'document switched during the write',
            photoshopMutationCommit: {
              version: 'photoshop-mutation-commit/v1',
              basis: 'same_execute_as_modal',
              bindingStrength: 'document_revision',
              before: { documentId: 406, historyStateId: 8500, activeLayerId: 45 },
              after: { documentId: 407, historyStateId: 8600, activeLayerId: 55 },
              toolActionCompleted: false,
              mutationObserved: false,
              documentChanged: false
            }
          }
        }
      ],
      toolCalls: [{ name: 'createTextLayer', arguments: { content: '不能继承旧文档读取' } }]
    });
    assert(preflight.status === 'blocked', `cross-document failed write must require a new read: ${JSON.stringify(preflight)}`);
    assert(preflight.preconditions.targetGuard === undefined, `cross-document commit must not mint a guard for the unobserved document: ${JSON.stringify(preflight.preconditions)}`);
    return { status: preflight.status, blockers: preflight.blockers };
  }));

  cases.push(await runCase('successful-create-document-cross-document-transition-produces-the-new-target', async () => {
    const preflight = buildAgentToolExecutionPreflight({
      assistantContent: '',
      requiresUserVisiblePreActionRationale: false,
      completedToolCalls: [
        {
          name: 'getDocumentInfo',
          result: {
            success: true,
            document: { id: 410 },
            historyStateRef: { documentId: 410, historyStateId: 8700 }
          }
        },
        {
          name: 'createDocument',
          result: {
            success: true,
            documentId: 411,
            photoshopHistoryTransition: {
              version: 'photoshop-history-transition/v1',
              basis: 'acceptance_snapshot_pair',
              before: { documentId: 410, historyStateId: 8700 },
              after: { documentId: 411, historyStateId: 8800 },
              mutationObserved: false,
              documentChanged: false
            }
          }
        }
      ],
      toolCalls: [{ name: 'createTextLayer', arguments: { content: '新建文档允许继续' } }]
    });
    assert(preflight.status === 'ready', `successful createDocument may establish its controlled new target: ${JSON.stringify(preflight)}`);
    assert(preflight.preconditions.targetGuard?.expectedDocumentId === 411, `new document guard must use the created document: ${JSON.stringify(preflight.preconditions)}`);
    assert(preflight.preconditions.targetGuard?.expectedHistoryStateRef?.historyStateId === 8800, `new document guard must use the post-create Host revision: ${JSON.stringify(preflight.preconditions)}`);
    return preflight.preconditions;
  }));

  cases.push(await runCase('active-layer-guard-is-omitted-after-a-successful-write-mutates-selection', async () => {
    const preflight = buildAgentToolExecutionPreflight({
      assistantContent: '',
      requiresUserVisiblePreActionRationale: false,
      completedToolCalls: [
        {
          name: 'getDocumentInfo',
          result: { success: true, document: { id: 405, name: '连续写入.psd', activeLayerId: 45 } }
        },
        {
          name: 'createRectangle',
          result: { success: true, documentId: 405, layerId: 46 }
        }
      ],
      toolCalls: [{ name: 'createTextLayer', arguments: { content: '第二次写入' } }]
    });
    assert(preflight.status === 'ready', `document guard should remain usable after a write: ${JSON.stringify(preflight)}`);
    assert(preflight.preconditions.targetGuard?.expectedDocumentId === 405, `document identity should remain grounded: ${JSON.stringify(preflight.preconditions.targetGuard)}`);
    assert(preflight.preconditions.targetGuard?.expectedActiveLayerId === undefined, `write-before-write must not reuse the stale pre-write active layer: ${JSON.stringify(preflight.preconditions.targetGuard)}`);
    return preflight.preconditions;
  }));

  cases.push(await runCase('write-result-and-layer-id-do-not-fabricate-document-target-guard', async () => {
    const preflight = buildAgentToolExecutionPreflight({
      assistantContent: '',
      requiresUserVisiblePreActionRationale: false,
      completedToolCalls: [
        {
          name: 'createRectangle',
          result: { success: true, documentId: 801, layerId: 81 }
        },
        {
          name: 'getLayerProperties',
          result: { success: true, id: 82, layerId: 82, name: '这是图层 ID，不是文档 ID' }
        }
      ],
      toolCalls: [{ name: 'setLayerOpacity', arguments: { layerId: 82, opacity: 70 } }]
    });
    assert(preflight.preconditions.hasPriorDocumentRead === true, `successful whitelisted read remains a prior document read: ${JSON.stringify(preflight.preconditions)}`);
    assert(preflight.preconditions.targetGuard === undefined, `ordinary write documentId and read layer id must not become a document target: ${JSON.stringify(preflight.preconditions.targetGuard)}`);
    assert(preflight.status === 'blocked', `write must fail closed when prior reads do not carry document identity: ${JSON.stringify(preflight)}`);
    assert(preflight.blockers.some((item) => item.includes('documentId')), `blocker should require an identity-bearing read: ${JSON.stringify(preflight.blockers)}`);
    return { status: preflight.status, preconditions: preflight.preconditions, blockers: preflight.blockers };
  }));

  cases.push(await runCase('document-context-transition-clears-older-target-observation', async () => {
    const switched = buildAgentToolExecutionPreflight({
      assistantContent: '',
      requiresUserVisiblePreActionRationale: false,
      completedToolCalls: [
        {
          name: 'getDocumentInfo',
          result: { success: true, document: { id: 811, name: 'A.psd', activeLayerId: 81 } }
        },
        {
          name: 'switchDocument',
          result: { success: true, document: { id: 812, name: 'B.psd' } }
        },
        {
          name: 'getLayerHierarchy',
          result: { success: true, hierarchy: [] }
        }
      ],
      toolCalls: [{ name: 'createTextLayer', arguments: { content: 'B 文档文字' } }]
    });
    assert(switched.preconditions.targetGuard === undefined, `switchDocument must be an identity barrier until a new stable read: ${JSON.stringify(switched.preconditions)}`);
    assert(switched.status === 'blocked', `write after switch without identity-bearing read must fail closed: ${JSON.stringify(switched)}`);

    const unstableCreate = buildAgentToolExecutionPreflight({
      assistantContent: '',
      requiresUserVisiblePreActionRationale: false,
      completedToolCalls: [
        {
          name: 'getDocumentInfo',
          result: { success: true, document: { id: 821, name: '旧文档.psd' } }
        },
        {
          name: 'createDocument',
          result: { success: true, document: { name: '新文档', width: 800, height: 800 } }
        }
      ],
      toolCalls: [{ name: 'createTextLayer', arguments: { content: '新文档文字' } }]
    });
    assert(unstableCreate.preconditions.targetGuard === undefined, `createDocument without stable id must clear the old target: ${JSON.stringify(unstableCreate.preconditions)}`);
    assert(unstableCreate.status === 'blocked', `write after identity-less createDocument must fail closed: ${JSON.stringify(unstableCreate)}`);
    return {
      switched: { status: switched.status, blockers: switched.blockers },
      unstableCreate: { status: unstableCreate.status, blockers: unstableCreate.blockers }
    };
  }));

  cases.push(await runCase('explicit-save-export-target-counts-as-verification-target', async () => {
    const preflight = buildAgentToolExecutionPreflight({
      assistantContent: '现在导出 PNG 文件。',
      completedToolCalls: [
        {
          name: 'createDocument',
          result: {
            success: true,
            documentId: 201,
            document: { id: 201, name: '导出验证', width: 720, height: 420 }
          }
        },
        {
          name: 'alignToReference',
          result: {
            success: true,
            newSubjectCenter: { x: 360, y: 210 }
          }
        }
      ],
      toolCalls: [{
        name: 'quickExport',
        arguments: {
          outputPath: 'C:/DesignEcho/DesignEcho-Agent/tmp/export-target-verification.png',
          format: 'png'
        }
      }]
    });
    assert(preflight.status === 'ready', `quickExport with explicit outputPath and prior document state should be ready: ${JSON.stringify(preflight)}`);
    assert(preflight.preconditions.hasVerificationTarget === true, `explicit outputPath should count as export verification target: ${JSON.stringify(preflight.preconditions)}`);
    assert(preflight.preconditions.hasPriorDocumentRead === true, `prior createDocument should establish the document target: ${JSON.stringify(preflight.preconditions)}`);
    return {
      status: preflight.status,
      preconditions: preflight.preconditions,
      blockers: preflight.blockers
    };
  }));

  cases.push(await runCase('basic-tool-write-can-use-same-turn-readback-without-public-plan', async () => {
    const preflight = buildAgentToolExecutionPreflight({
      assistantContent: '',
      requiresUserVisiblePreActionRationale: false,
      completedToolCalls: [{
        name: 'createDocument',
        result: {
          success: true,
          documentId: 301,
          document: { id: 301, name: '基础工具验证', width: 520, height: 360 }
        }
      }, {
        name: 'createRectangle',
        result: { success: true, layerId: 2, layerName: '已创建图层' }
      }],
      toolCalls: [{
        name: 'setLayerOpacity',
        arguments: { layerId: 2, opacity: 74 }
      }],
      verificationToolCalls: [
        { name: 'setLayerOpacity', arguments: { layerId: 2, opacity: 74 } },
        { name: 'getLayerProperties', arguments: { layerId: 2 } }
      ]
    });
    assert(preflight.status === 'ready', `basic tool write with same-turn readback should be ready: ${JSON.stringify(preflight)}`);
    assert(preflight.preconditions.hasUserVisiblePreActionRationale === false, `pre-action rationale should not be faked for simple tool tasks: ${JSON.stringify(preflight.preconditions)}`);
    assert(preflight.preconditions.hasVerificationTarget === true, `same-turn readback should count as verification target: ${JSON.stringify(preflight.preconditions)}`);
    return {
      status: preflight.status,
      preconditions: preflight.preconditions,
      blockers: preflight.blockers
    };
  }));

  cases.push(await runCase('basic-tool-write-can-start-without-prewritten-verification-copy', async () => {
    const preflight = buildAgentToolExecutionPreflight({
      assistantContent: '',
      requiresUserVisiblePreActionRationale: false,
      completedToolCalls: [{
        name: 'createDocument',
        result: {
          success: true,
          documentId: 302,
          document: { id: 302, name: '基础工具验证', width: 520, height: 360 }
        }
      }, {
        name: 'getLayerProperties',
        result: { success: true, layerId: 2, layerName: '已确认图层' }
      }],
      toolCalls: [{
        name: 'setLayerOpacity',
        arguments: { layerId: 2, opacity: 74 }
      }]
    });
    assert(preflight.status === 'ready', `basic tool write should not be blocked only because no visible verification copy was written first: ${JSON.stringify(preflight)}`);
    assert(!preflight.blockers.some((item) => item.includes('动手前判断')), `basic tool write should not require pre-action rationale: ${JSON.stringify(preflight.blockers)}`);
    assert(preflight.preconditions.hasVerificationTarget === false, `preflight should not fabricate a verification target: ${JSON.stringify(preflight.preconditions)}`);
    return {
      status: preflight.status,
      preconditions: preflight.preconditions,
      blockers: preflight.blockers
    };
  }));

  cases.push(await runCase('layer-target-id-must-come-from-completed-layer-result', async () => {
    const blocked = buildAgentToolExecutionPreflight({
      assistantContent: '',
      requiresUserVisiblePreActionRationale: false,
      completedToolCalls: [
        {
          name: 'createDocument',
          result: {
            success: true,
            documentId: 303,
            document: { id: 303, name: '基础工具验证', width: 520, height: 360 }
          }
        },
        {
          name: 'createRectangle',
          result: {
            success: true,
            layerId: 2,
            layerName: 'Agent Effects Shape'
          }
        }
      ],
      toolCalls: [{ name: 'setLayerOpacity', arguments: { layerId: 1, opacity: 74 } }],
      verificationToolCalls: [
        { name: 'setLayerOpacity', arguments: { layerId: 1, opacity: 74 } },
        { name: 'getLayerProperties', arguments: { layerId: 1 } }
      ]
    });
    assert(blocked.status === 'blocked', `guessed layerId should be blocked: ${JSON.stringify(blocked)}`);
    assert(blocked.blockers.some((item) => item.includes('layerId') && item.includes('1')), `blocked message should name unknown layerId: ${JSON.stringify(blocked.blockers)}`);
    assert(blocked.preconditions.knownLayerIds.includes(2), `known layer IDs should include createRectangle result: ${JSON.stringify(blocked.preconditions)}`);

    const ready = buildAgentToolExecutionPreflight({
      assistantContent: '',
      requiresUserVisiblePreActionRationale: false,
      completedToolCalls: [
        {
          name: 'createDocument',
          result: { success: true, documentId: 303, document: { id: 303, name: '基础工具验证' } }
        },
        ...blocked.preconditions.knownLayerIds.map((id) => ({
          name: 'getLayerProperties',
          result: { success: true, layerId: id, layerName: 'Agent Effects Shape' }
        }))
      ],
      toolCalls: [{ name: 'setLayerOpacity', arguments: { layerId: 2, opacity: 74 } }],
      verificationToolCalls: [
        { name: 'setLayerOpacity', arguments: { layerId: 2, opacity: 74 } },
        { name: 'getLayerProperties', arguments: { layerId: 2 } }
      ]
    });
    assert(ready.status === 'ready', `confirmed layerId should be ready: ${JSON.stringify(ready)}`);
    return {
      blocked: {
        status: blocked.status,
        blockers: blocked.blockers,
        preconditions: blocked.preconditions
      },
      ready: {
        status: ready.status,
        preconditions: ready.preconditions
      }
    };
  }));

  cases.push(await runCase('explicit-layer-id-is-blocked-when-no-layer-result-exists', async () => {
    const preflight = buildAgentToolExecutionPreflight({
      assistantContent: '',
      requiresUserVisiblePreActionRationale: false,
      completedToolCalls: [{
        name: 'createDocument',
        result: { success: true, documentId: 304, document: { id: 304, name: '无图层结果.psd' } }
      }],
      toolCalls: [{ name: 'setLayerOpacity', arguments: { layerId: 44, opacity: 50 } }]
    });
    assert(preflight.preconditions.knownLayerIds.length === 0, `fixture should have no known layer ids: ${JSON.stringify(preflight.preconditions)}`);
    assert(preflight.status === 'blocked', `explicit layerId must fail closed when known set is empty: ${JSON.stringify(preflight)}`);
    assert(preflight.blockers.some((item) => item.includes('layerId') && item.includes('44')), `blocker should name the ungrounded layer id: ${JSON.stringify(preflight.blockers)}`);
    return { status: preflight.status, preconditions: preflight.preconditions, blockers: preflight.blockers };
  }));

  cases.push(await runCase('known-layer-ids-are-scoped-after-latest-document-observation', async () => {
    const preflight = buildAgentToolExecutionPreflight({
      assistantContent: '',
      requiresUserVisiblePreActionRationale: false,
      completedToolCalls: [
        {
          name: 'getDocumentInfo',
          result: { success: true, document: { id: 901, name: 'A.psd', activeLayerId: 91 } }
        },
        {
          name: 'getLayerProperties',
          result: { success: true, layerId: 92, layerName: 'A 文档图层' }
        },
        {
          name: 'getDocumentInfo',
          result: { success: true, document: { id: 902, name: 'B.psd', activeLayerId: 93 } }
        }
      ],
      toolCalls: [{ name: 'setLayerOpacity', arguments: { layerId: 92, opacity: 60 } }]
    });
    assert(preflight.preconditions.targetGuard?.expectedDocumentId === 902, `latest document B must own the guard: ${JSON.stringify(preflight.preconditions)}`);
    assert(preflight.preconditions.knownLayerIds.includes(93), `B active layer should remain known: ${JSON.stringify(preflight.preconditions.knownLayerIds)}`);
    assert(!preflight.preconditions.knownLayerIds.includes(92), `A layer id must be discarded after observing document B: ${JSON.stringify(preflight.preconditions.knownLayerIds)}`);
    assert(preflight.status === 'blocked', `A layer id must not pass under B target guard: ${JSON.stringify(preflight)}`);
    assert(preflight.blockers.some((item) => item.includes('layerId') && item.includes('92')), `blocker should identify the stale layer id: ${JSON.stringify(preflight.blockers)}`);
    return { status: preflight.status, preconditions: preflight.preconditions, blockers: preflight.blockers };
  }));

  cases.push(await runCase('pre-action-rationale-requirement-is-decided-from-tool-batch', async () => {
    const simpleBatchRequiresRationale = requiresUserVisiblePreActionRationaleForToolCalls([
      { name: 'setLayerOpacity', arguments: { layerId: 2, opacity: 74 } },
      { name: 'getLayerProperties', arguments: { layerId: 2 } }
    ]);
    const readonlyLayerLocationBatchRequiresRationale = requiresUserVisiblePreActionRationaleForToolCalls([
      { name: 'getAllTextLayers', arguments: {} },
      { name: 'getLayerBounds', arguments: { layerId: 303 } }
    ]);
    const designBatchRequiresRationale = requiresUserVisiblePreActionRationaleForToolCalls([
      { name: 'renderLayout', arguments: { canvas: { width: 790, height: 2400 }, blocks: [] } },
      { name: 'getAcceptanceSnapshot', arguments: {} }
    ]);
    assert(simpleBatchRequiresRationale === false, 'simple mechanical Photoshop tool batch should not require a pre-action rationale label.');
    assert(readonlyLayerLocationBatchRequiresRationale === false, 'read-only text layer location inspection should not require a pre-action rationale label.');
    assert(designBatchRequiresRationale === true, 'design/layout tool batch should require a user-visible pre-action rationale.');
    return {
      simpleBatchRequiresRationale,
      readonlyLayerLocationBatchRequiresRationale,
      designBatchRequiresRationale
    };
  }));

  cases.push(await runCase('required-next-tool-can-use-recovery-context-as-verification-target', async () => {
    const preflight = buildAgentToolExecutionPreflight({
      assistantContent: '我会用 renderLayout 一次生成整张版式。',
      completedToolCalls: [
        {
          name: 'createDocument',
          result: {
            success: true,
            documentId: 102,
            document: { id: 102, name: '测试详情页', width: 790, height: 2400 }
          }
        },
        {
          name: 'getAcceptanceSnapshot',
          result: {
            success: false,
            error: '请先用 renderLayout 一次生成整张详情页主结构，再置入补充图片、截图复核或保存。',
            nextRequiredTool: 'renderLayout',
            nextRequiredToolReason: 'fresh detail-page document must receive its one-shot layout before snapshot reads'
          }
        }
      ],
      toolCalls: [{
        name: 'renderLayout',
        arguments: {
          canvas: { width: 790, height: 2400 },
          blocks: [
            { role: 'background', content: '#111827', heightRatio: 1 },
            { role: 'title', content: '舒适透气运动袜', heightRatio: 0.12 }
          ]
        }
      }]
    });
    assert(preflight.status === 'ready', `required next tool should not be blocked by missing explicit verification wording: ${JSON.stringify(preflight)}`);
    assert(preflight.preconditions.hasVerificationTarget === true, `recovery context should count as verification context: ${JSON.stringify(preflight.preconditions)}`);
    return {
      status: preflight.status,
      preconditions: preflight.preconditions,
      blockers: preflight.blockers
    };
  }));

  cases.push(await runCase('prior-read-without-public-plan-still-blocks-write', async () => {
    const preflight = buildAgentToolExecutionPreflight({
      assistantContent: '',
      toolCalls: [{ name: 'createTextLayer', arguments: { content: '备注', x: 10, y: 10 } }],
      completedToolCalls: [{ name: 'getDocumentInfo', result: { success: true } }]
    });
    assert(preflight.status === 'blocked', `expected blocked, got ${preflight.status}`);
    assert(preflight.blockers.some((item) => item.includes('缺少给用户可见的动手前判断')), `blocked message should require a user-visible pre-action rationale: ${JSON.stringify(preflight)}`);
    return {
      status: preflight.status,
      blockers: preflight.blockers
    };
  }));

  cases.push(await runCase('same-batch-read-then-write-can-pass-after-observation', async () => {
    let modelCalls = 0;
    const executed = [];
    const steps = [];
    let writeExecutionArguments;
    const originalToolCalls = [
      { id: 'batch-read', name: 'getDocumentInfo', arguments: {} },
      { id: 'batch-write', name: 'createTextLayer', arguments: { content: '自选备注', x: 120, y: 120 } }
    ];
    const agent = createAgent({
      callModel: async () => {
        modelCalls += 1;
        if (modelCalls === 1) {
          return {
            content: '我会先读取文档信息，然后创建备注文字图层，完成后用工具验收图层结果。',
            toolCalls: originalToolCalls
          };
        }
        return { content: '已完成并复核。', toolCalls: [] };
      },
      executeTool: async (name, params) => {
        executed.push(name);
        if (name === 'createTextLayer') {
          writeExecutionArguments = params;
          return {
            success: true,
            layerId: 10,
            acceptance: {
              enabled: true,
              verified: true,
              assertionStatus: 'passed',
              noDocumentChangeRisk: false
            }
          };
        }
        return {
          success: true,
          document: { id: 610, name: 'test.psd', activeLayerId: 77 }
        };
      },
      callbacks: {
        onStep: (step) => steps.push(step)
      },
      toolDecisionContext: writeIntentContext('帮我加一个备注文字')
    });

    const result = await agent.run('创建一个自选备注文字层');
    const taskTools = executed.filter((name) => name !== 'getAnnotatedSnapshot');
    assert(taskTools.join(',') === 'getDocumentInfo,createTextLayer', `expected read then write after opening observation, got ${executed.join(',')}`);
    assert(result.stopReason === 'final_response', `expected final_response, got ${result.stopReason}`);
    assert(result.toolCallLog.length === 2, `expected two executed tools, got ${result.toolCallLog.length}`);
    assert(writeExecutionArguments?.__designEchoTargetGuard?.expectedDocumentId === 610, `write execution should receive the private document guard: ${JSON.stringify(writeExecutionArguments)}`);
    assert(writeExecutionArguments?.__designEchoTargetGuard?.expectedActiveLayerId === 77, `implicit-layer write should receive the last observed active layer: ${JSON.stringify(writeExecutionArguments)}`);
    assert(writeExecutionArguments?.__designEchoTargetGuard?.observationTool === 'getDocumentInfo', `guard should carry its real observation source: ${JSON.stringify(writeExecutionArguments)}`);
    assert(originalToolCalls.every((call) => call.arguments.__designEchoTargetGuard === undefined), `private guard must not mutate model tool calls: ${JSON.stringify(originalToolCalls)}`);
    assert(result.toolCallLog.every((entry) => entry.arguments?.__designEchoTargetGuard === undefined), `private guard must not enter toolCallLog arguments: ${JSON.stringify(result.toolCallLog)}`);
    assert(!JSON.stringify(steps).includes('__designEchoTargetGuard'), `private guard must not enter user-visible argument summaries: ${JSON.stringify(steps)}`);
    return {
      modelCalls,
      executed,
      stopReason: result.stopReason,
      executionStatus: result.executionSummary && result.executionSummary.status,
      guardedDocumentId: writeExecutionArguments.__designEchoTargetGuard.expectedDocumentId
    };
  }));

  cases.push(await runCase('later-write-rederives-guard-and-explicit-layer-id-omits-active-layer-guard', async () => {
    let modelCalls = 0;
    let documentReadCount = 0;
    const writeGuards = [];
    const agent = createAgent({
      callModel: async () => {
        modelCalls += 1;
        if (modelCalls === 1) {
          return {
            content: '我会逐次确认目标文档，再写入文字，并在每次写入后检查结果。',
            toolCalls: [
              { id: 'read-a', name: 'getDocumentInfo', arguments: {} },
              { id: 'write-a', name: 'createTextLayer', arguments: { content: 'A' } },
              { id: 'read-b', name: 'getDocumentInfo', arguments: {} },
              { id: 'write-b', name: 'createTextLayer', arguments: { content: 'B', layerId: 72 } }
            ]
          };
        }
        return { content: '已完成并复核。', toolCalls: [] };
      },
      executeTool: async (name, params) => {
        if (name === 'getDocumentInfo') {
          documentReadCount += 1;
          return documentReadCount === 1
            ? { success: true, document: { id: 710, name: 'A.psd', activeLayerId: 71 } }
            : { success: true, document: { id: 720, name: 'B.psd', activeLayerId: 72 } };
        }
        if (name === 'createTextLayer') {
          writeGuards.push(params.__designEchoTargetGuard);
        }
        return {
          success: true,
          layerId: 72,
          acceptance: {
            enabled: true,
            verified: true,
            assertionStatus: 'passed',
            noDocumentChangeRisk: false
          }
        };
      },
      toolDecisionContext: writeIntentContext('在两个已确认目标中分别添加文字')
    });

    const result = await agent.run('逐次读取当前文档并添加文字');
    assert(result.stopReason === 'final_response', `expected final_response, got ${result.stopReason}: ${result.message}`);
    assert(writeGuards.length === 2, `expected two guarded writes, got ${JSON.stringify(writeGuards)}`);
    assert(writeGuards[0]?.expectedDocumentId === 710 && writeGuards[0]?.expectedActiveLayerId === 71, `first write should use first observation: ${JSON.stringify(writeGuards)}`);
    assert(writeGuards[1]?.expectedDocumentId === 720, `later write should rederive from the latest observation: ${JSON.stringify(writeGuards)}`);
    assert(writeGuards[1]?.expectedActiveLayerId === undefined, `explicit layerId should not require active-layer identity: ${JSON.stringify(writeGuards)}`);
    return { writeGuards, toolCallCount: result.toolCallLog.length };
  }));

  cases.push(await runCase('workflow-bridge-validates-then-strips-private-target-guard', async () => {
    const executorSource = fs.readFileSync(
      path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'skill-executors', 'autonomous-agent.executor.ts'),
      'utf8'
    );
    const branchStart = executorSource.indexOf('if (isSkillToolName(toolName)) {');
    const branchEnd = executorSource.indexOf('// H3：外部内容', branchStart);
    assert(branchStart >= 0 && branchEnd > branchStart, 'workflow bridge execution branch should remain inspectable');
    const bridgeBranch = executorSource.slice(branchStart, branchEnd);
    assert(bridgeBranch.includes("executeToolCall('getDocumentInfo'"), 'workflow bridge must ask the UXP guard owner to validate the current target before entering the Skill');
    assert(bridgeBranch.includes('[DESIGN_ECHO_TARGET_GUARD_ARGUMENT]: privateTargetGuard'), 'workflow bridge target check must forward the exact private guard contract');
    assert(bridgeBranch.includes('executeSkillTool(toolName, skillBusinessParams'), 'workflow bridge must pass guard-free business params into Skill normalization/execution');
    assert(!bridgeBranch.includes('executeSkillTool(toolName, toolParams'), 'workflow bridge must not leak the private guard into Skill params');
    return {
      validatesWithUxpOwner: true,
      stripsBeforeSkill: true
    };
  }));

  cases.push(await runCase('save-export-requires-document-read-plan-and-verification', async () => {
    const preflight = buildAgentToolExecutionPreflight({
      assistantContent: '直接保存。',
      toolCalls: [{ name: 'saveDocument', arguments: { format: 'psd' } }],
      completedToolCalls: []
    });
    assert(preflight.status === 'blocked', `expected blocked, got ${preflight.status}`);
    assert(preflight.blockers.some((item) => item.includes('尚未读取目标 Photoshop 文档或画面')), `missing document read blocker: ${JSON.stringify(preflight)}`);
    return {
      status: preflight.status,
      blockers: preflight.blockers
    };
  }));

  cases.push(await runCase('generate-image-is-not-ordinary-readonly-but-does-not-trigger-photoshop-write-gate', async () => {
    const preflight = buildAgentToolExecutionPreflight({
      assistantContent: '',
      toolCalls: [{ name: 'generateImage', arguments: { prompt: 'product background' } }],
      completedToolCalls: []
    });
    assert(preflight.status === 'ready', `expected ready, got ${preflight.status}`);
    assert(preflight.tools[0].kind === 'external_generation', `expected external_generation, got ${preflight.tools[0].kind}`);
    assert(preflight.warnings.some((item) => item.includes('不是普通只读工具')), `expected warning, got ${JSON.stringify(preflight.warnings)}`);
    return {
      status: preflight.status,
      kind: preflight.tools[0].kind,
      warnings: preflight.warnings
    };
  }));

  const payload = { success: cases.every((item) => item.status === 'pass'), cases };
  const serialized = JSON.stringify(payload);
  const forbiddenDecisionScoreWords = [String.fromCharCode(99, 111, 110, 102, 105, 100, 101, 110, 99, 101), String.fromCharCode(32622, 20449)];
  assert(!forbiddenDecisionScoreWords.some((word) => serialized.includes(word)), `preflight output must not expose decision score wording: ${serialized}`);
  assert(!serialized.includes(String.fromCodePoint(0xfffd)), 'report should not contain replacement characters');
  const report = writeReport(payload);
  console.log(JSON.stringify({ ...payload, report }, null, 2));
  process.exit(payload.success ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
