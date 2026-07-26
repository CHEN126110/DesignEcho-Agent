#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TMP_DIR = path.join(ROOT, 'tmp');
const REPORT_JSON = path.join(TMP_DIR, 'agent-live-photoshop-layout-history-task.json');
const REPORT_MD = path.join(TMP_DIR, 'agent-live-photoshop-layout-history-task.md');
const DEFAULT_MODEL_ID = 'local-qwen2.5-7b';
const DEFAULT_TIMEOUT_MS = 180_000;
const CANVAS = { width: 760, height: 520 };

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
  project: path.resolve(ROOT, 'tsconfig.main.json')
});

const { Agent } = require(path.join(ROOT, 'src', 'renderer', 'services', 'agent-runtime', 'agent.ts'));
const { selectTools } = require(path.join(ROOT, 'src', 'renderer', 'services', 'agent-runtime', 'tool-schemas.ts'));
const { executeToolCall } = require(path.join(ROOT, 'src', 'renderer', 'services', 'tool-executor.service.ts'));
const { ModelService } = require(path.join(ROOT, 'src', 'main', 'services', 'model-service.ts'));
const {
  buildAgentIntentControlPlaneDecision
} = require(path.join(ROOT, 'src', 'shared', 'agent-intent-control-plane.ts'));

const TOOL_NAMES = [
  'createDocument',
  'listDocuments',
  'closeDocument',
  'getDocumentInfo',
  'getLayerHierarchy',
  'getLayerBounds',
  'getAcceptanceSnapshot',
  'renderLayout',
  'alignToReference',
  'batchRenameLayers',
  'undo',
  'redo',
  'openProjectFile'
];

function hasArg(name) {
  return process.argv.includes(name);
}

function getArgValue(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  const value = process.argv[index + 1];
  if (!value || value.startsWith('--')) return fallback;
  return value;
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function compact(value, maxLength = 320) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > maxLength ? `${text.slice(0, maxLength - 3)}...` : text;
}

function normalizeArgs(args) {
  return args && typeof args === 'object' ? args : {};
}

function firstNumber(...values) {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return undefined;
}

function summarizeResult(result) {
  const out = result && typeof result === 'object' ? result : {};
  return {
    success: out.success !== false,
    error: out.error ? compact(out.error) : undefined,
    message: out.message ? compact(out.message) : undefined,
    documentId: firstNumber(out.documentId, out.activeDocumentId, out.document?.id, out.data?.documentId),
    documentName: out.documentName ?? out.document?.name ?? out.name ?? undefined,
    layerId: firstNumber(out.layerId, out.layer?.id, out.data?.layerId, out.data?.layer?.id),
    createdLayerIds: Array.isArray(out.createdLayerIds) ? out.createdLayerIds.filter((id) => typeof id === 'number') : undefined,
    renamedCount: Array.isArray(out.renamedLayers) ? out.renamedLayers.length : undefined,
    originalBounds: out.originalBounds,
    newBounds: out.newBounds,
    newSubjectCenter: out.newSubjectCenter,
    openedFile: out.openedFile,
    filePath: out.filePath,
    acceptanceStatus: out.acceptance?.assertionStatus ?? out.acceptance?.status,
    acceptanceVerified: out.acceptance?.verified
  };
}

function summarizeToolCallLog(log) {
  return (Array.isArray(log) ? log : []).map((entry) => ({
    name: entry.name,
    arguments: normalizeArgs(entry.arguments),
    result: summarizeResult(entry.result)
  }));
}

function renderMarkdown(report) {
  const lines = [
    '# Agent Live Photoshop Layout History Task',
    '',
    `- success: ${report.success}`,
    `- skipped: ${Boolean(report.skipped)}`,
    `- mode: ${report.mode}`,
    `- modelId: ${report.modelId || ''}`,
    `- documentName: ${report.documentName || ''}`,
    `- alignedLayerId: ${report.alignedLayerId ?? ''}`,
    `- openAfter: ${Boolean(report.document?.openAfter)}`,
    '',
    '## Tool Feedback',
    '',
    `- toolCount: ${report.agent?.toolCount || 0}`,
    `- failedToolCount: ${report.agent?.failedToolCount || 0}`,
    `- toolNames: ${(report.agent?.toolNames || []).join(', ')}`,
    ''
  ];

  for (const tool of report.tools || []) {
    lines.push(`- ${tool.name}: ${tool.result.success ? 'success' : 'failed'}`);
    if (tool.arguments?.layerId !== undefined) lines.push(`  argument.layerId: ${tool.arguments.layerId}`);
    if (tool.arguments?.layerIds) lines.push(`  argument.layerIds: ${tool.arguments.layerIds.join(', ')}`);
    if (tool.arguments?.query) lines.push(`  argument.query: ${tool.arguments.query}`);
    if (tool.result.error) lines.push(`  error: ${tool.result.error}`);
    if (tool.result.renamedCount !== undefined) lines.push(`  renamedCount: ${tool.result.renamedCount}`);
    if (tool.result.openedFile) lines.push(`  openedFile: ${tool.result.openedFile}`);
  }

  if (report.requiredSignals?.length) {
    lines.push('', '## Required Signals', '');
    for (const signal of report.requiredSignals) lines.push(`- ${signal.name}: ${signal.passed ? 'pass' : 'fail'}`);
  }

  if (report.blockers?.length) {
    lines.push('', '## Blockers', '');
    for (const blocker of report.blockers) lines.push(`- ${blocker}`);
  }

  lines.push('', '## Boundaries', '');
  for (const boundary of report.boundaries || []) lines.push(`- ${boundary}`);
  return `${lines.join('\n')}\n`;
}

function writeReport(report) {
  ensureDir(TMP_DIR);
  fs.writeFileSync(REPORT_JSON, JSON.stringify(report, null, 2), 'utf8');
  fs.writeFileSync(REPORT_MD, renderMarkdown(report), 'utf8');
}

function buildPartialReport(input) {
  return {
    success: false,
    partial: true,
    skipped: false,
    mode: 'live-agent-real-model-real-photoshop-layout-history',
    generatedAt: new Date().toISOString(),
    modelId: input.modelId,
    documentName: input.documentName,
    agent: input.agent || {
      toolCount: input.tools.length,
      failedToolCount: input.tools.filter((tool) => tool.result?.success === false).length,
      toolNames: input.tools.map((tool) => tool.name)
    },
    tools: input.tools,
    events: input.events,
    report: { json: REPORT_JSON, md: REPORT_MD },
    boundaries: [
      'Partial report: the live layout/history runner failed or was interrupted before final assertions.',
      'Tool calls in this report are real Agent/tool-executor feedback collected before interruption.'
    ]
  };
}

async function listOllamaModels() {
  const response = await fetch('http://127.0.0.1:11434/api/tags');
  if (!response.ok) throw new Error(`Ollama tags HTTP ${response.status}`);
  const payload = await response.json();
  return Array.isArray(payload.models) ? payload.models : [];
}

function modelApiName(modelId) {
  if (modelId === 'local-qwen2.5-14b') return 'qwen2.5:14b';
  if (modelId === 'local-qwen2.5-7b') return 'qwen2.5:7b';
  if (modelId === 'local-qwen2.5-32b') return 'qwen2.5:32b';
  if (modelId === 'local-deepseek-coder-v2-16b') return 'deepseek-coder-v2:16b';
  return modelId.replace(/^local-/, '').replace(/-/g, ':');
}

async function ensureModelAvailable(modelId) {
  const wanted = modelApiName(modelId);
  const models = await listOllamaModels();
  const names = models.map((item) => String(item.name || '').trim());
  if (!names.includes(wanted)) {
    throw new Error(`本地 Ollama 没有模型 ${wanted}。可用模型: ${names.join(', ')}`);
  }
  return { wanted, names };
}

async function safeExecuteTool(toolName, params) {
  try {
    return await executeToolCall(toolName, params);
  } catch (error) {
    return {
      success: false,
      error: error?.message || String(error),
      thrown: true
    };
  }
}

function buildTask(documentName, openQuery) {
  return [
    '这是一次真实 Photoshop 布局、批量重命名、对齐和历史工具验收，工具选择由你自己决定，不要使用固定脚本思路。',
    '这里不是复杂设计任务，不需要长篇规划说明；如果运行时需要说明，只给一句执行目的，然后继续执行真实动作。',
    '如果你已经判断下一步要处理画面，请直接执行真实动作；不要把操作清单或参数说明当作结果。',
    `请创建一个 ${CANVAS.width}x${CANVAS.height} 的临时文档，名称必须是 ${documentName}。`,
    `生成一版可编辑版式，canvas 必须是 { width: ${CANVAS.width}, height: ${CANVAS.height} }，blocks 至少包含 background、title、subtitle、selling-point 四类。`,
    '版式里的可见文案必须是真实短文案，例如 title: Layout Probe，subtitle: Agent controlled layout，selling-point: Readback before alignment；不要写内部规划话术。',
    '生成版式后必须读取图层结构或图层边界，取得系统确认的图层编号。',
    '选择一个由版式生成产生的可移动可见图层，对齐到画布中心附近。必须使用已确认图层编号，scalePercent: 100，targetCenterX: 380，targetCenterY: 260，subjectOffsetX: 0，subjectOffsetY: 0。',
    '选择至少两个已确认图层编号进行批量重命名，pattern 必须是 Agent Batch {n}，startNumber: 1。',
    '批量重命名后调用 getLayerHierarchy 或 getAcceptanceSnapshot 读回复核。',
    '然后调用 undo steps: 1，再调用 getLayerHierarchy 或 getAcceptanceSnapshot 读回；再调用 redo steps: 1，并再次读回复核。',
    `查询并尝试打开项目文件 "${openQuery}"，并如实反馈成功或失败，不要假装文件已打开。`,
    '最后关闭这个临时文档，不保存 PSD。',
    '最后请用事实反馈真实处理动作、成功/失败状态、批量重命名结果、撤销重做读回情况和项目文件打开结果。'
  ].join('\n');
}

async function cleanupStaleDisposableDocuments() {
  const list = await safeExecuteTool('listDocuments', { includeDetails: false });
  const documents = Array.isArray(list?.documents) ? list.documents : [];
  const stale = documents.filter((doc) => /^AgentLiveLayoutHistory-\d+/.test(String(doc?.name || '')));
  const closed = [];
  for (const doc of stale) {
    const result = await safeExecuteTool('closeDocument', { documentId: doc.id, save: false });
    closed.push({ id: doc.id, name: doc.name, success: result?.success !== false, error: result?.error });
  }
  return { probe: list, closed };
}

function hasSuccessfulTool(tools, toolName) {
  return tools.some((tool) => tool.name === toolName && tool.result?.success !== false);
}

function firstSuccessfulTool(tools, toolName) {
  return tools.find((tool) => tool.name === toolName && tool.result?.success !== false);
}

function createdLayerIdsFromRenderLayout(tools) {
  const render = firstSuccessfulTool(tools, 'renderLayout');
  return Array.isArray(render?.result?.createdLayerIds) ? render.result.createdLayerIds : [];
}

function findToolWithLayerArg(tools, toolName, layerId) {
  return tools.find((tool) => (
    tool.name === toolName
    && tool.result?.success !== false
    && typeof layerId === 'number'
    && Number(tool.arguments?.layerId) === layerId
  ));
}

function findBatchRenameWithLayerIds(tools, candidateIds) {
  return tools.find((tool) => {
    if (tool.name !== 'batchRenameLayers' || tool.result?.success === false) return false;
    const ids = Array.isArray(tool.arguments?.layerIds) ? tool.arguments.layerIds.map(Number) : [];
    return ids.length >= 2 && ids.every((id) => candidateIds.includes(id));
  });
}

function findAlignToReferenceWithLayerId(tools, candidateIds) {
  return tools.find((tool) => (
    tool.name === 'alignToReference'
    && tool.result?.success !== false
    && candidateIds.includes(Number(tool.arguments?.layerId))
    && Number(tool.arguments?.targetCenterX) === 380
    && Number(tool.arguments?.targetCenterY) === 260
  ));
}

async function main() {
  if (hasArg('--self-test')) {
    const sample = {
      success: true,
      mode: 'self-test',
      agent: { toolCount: 3, failedToolCount: 0, toolNames: ['renderLayout', 'alignToReference', 'batchRenameLayers'] },
      tools: [
        { name: 'renderLayout', arguments: { canvas: CANVAS, blocks: [] }, result: { success: true, createdLayerIds: [2, 3] } },
        { name: 'alignToReference', arguments: { layerId: 2, scalePercent: 100, targetCenterX: 380, targetCenterY: 260, subjectOffsetX: 0, subjectOffsetY: 0 }, result: { success: true } },
        { name: 'batchRenameLayers', arguments: { layerIds: [2, 3], pattern: 'Agent Batch {n}', startNumber: 1 }, result: { success: true, renamedCount: 2 } }
      ],
      requiredSignals: [{ name: 'self-test-contract', passed: true }],
      boundaries: ['self-test does not touch Photoshop or models']
    };
    writeReport(sample);
    console.log(JSON.stringify({ success: true, report: { json: REPORT_JSON, md: REPORT_MD } }, null, 2));
    return;
  }

  if (!hasArg('--live')) {
    const skipped = {
      success: true,
      skipped: true,
      mode: 'guarded-live-agent-photoshop-layout-history',
      reason: 'Run with --live to allow a real model to call real Photoshop layout/history tools against a disposable document.',
      requiredFlag: '--live',
      report: { json: REPORT_JSON, md: REPORT_MD },
      boundaries: [
        'Default execution does not touch a live model or Photoshop.',
        'Live mode uses a disposable document and still reports failures honestly.'
      ]
    };
    writeReport(skipped);
    console.log(JSON.stringify(skipped, null, 2));
    return;
  }

  const modelId = getArgValue('--model', process.env.DESIGNECHO_LIVE_AGENT_LAYOUT_HISTORY_MODEL || DEFAULT_MODEL_ID);
  const timeoutMs = Number(getArgValue('--timeout-ms', process.env.DESIGNECHO_LIVE_AGENT_LAYOUT_HISTORY_TIMEOUT_MS || DEFAULT_TIMEOUT_MS));
  const openQuery = getArgValue('--open-query', process.env.DESIGNECHO_LIVE_AGENT_OPEN_PROJECT_QUERY || 'AgentLiveLayoutHistory');
  const stamp = Date.now();
  const documentName = getArgValue('--document-name', `AgentLiveLayoutHistory-${stamp}`);

  const blockers = [];
  let ollama = null;
  try {
    ollama = await ensureModelAvailable(modelId);
  } catch (error) {
    blockers.push(error?.message || String(error));
  }

  const tools = selectTools(TOOL_NAMES);
  const missingTools = TOOL_NAMES.filter((name) => !tools.some((tool) => tool.name === name));
  if (missingTools.length > 0) blockers.push(`Agent tool schema missing: ${missingTools.join(', ')}`);

  if (blockers.length > 0) {
    const blocked = {
      success: false,
      skipped: false,
      mode: 'blocked-live-agent-photoshop-layout-history',
      modelId,
      blockers,
      report: { json: REPORT_JSON, md: REPORT_MD },
      boundaries: ['Blocked before live Photoshop writes; no success is claimed.']
    };
    writeReport(blocked);
    console.log(JSON.stringify(blocked, null, 2));
    process.exit(1);
    return;
  }

  const startedAt = Date.now();
  const cleanupBefore = await cleanupStaleDisposableDocuments();
  if (cleanupBefore.probe?.success === false) {
    const blocked = {
      success: false,
      skipped: false,
      mode: 'blocked-live-agent-photoshop-layout-history',
      modelId,
      blockers: [`Photoshop tool runtime unavailable before live run: ${cleanupBefore.probe.error || 'unknown error'}`],
      cleanupBefore,
      report: { json: REPORT_JSON, md: REPORT_MD },
      boundaries: ['Blocked before creating a disposable document; no Photoshop write success is claimed.']
    };
    writeReport(blocked);
    console.log(JSON.stringify(blocked, null, 2));
    process.exit(1);
    return;
  }

  const modelService = new ModelService({ ollamaUrl: 'http://127.0.0.1:11434' });
  const liveEvents = [];
  const liveTools = [];
  const writePartial = (extra = {}) => {
    writeReport(buildPartialReport({
      modelId,
      documentName,
      tools: liveTools,
      events: liveEvents,
      agent: extra.agent
    }));
  };
  writePartial();

  const callbacks = {
    onStep: (step) => {
      liveEvents.push({
        kind: step.kind,
        title: step.title,
        detail: step.detail,
        status: step.status,
        toolName: step.toolName
      });
      if (step.kind === 'model_response' || step.kind === 'warning' || step.kind === 'stopped') writePartial();
    },
    onToolStart: (toolName) => console.log(`[agent-live-layout-history:tool:start] ${toolName}`),
    onToolComplete: (toolName, result) => {
      console.log(`[agent-live-layout-history:tool:${result?.success === false ? 'fail' : 'pass'}] ${toolName}`);
      liveTools.push({ name: toolName, result: summarizeResult(result) });
      writePartial();
    }
  };

  const task = buildTask(documentName, openQuery);
  const agent = new Agent(
    {
      systemPrompt: [
        '你是一个谨慎的 Photoshop 布局、历史和文件上下文工具 Agent。',
        '你必须根据用户目标自主选择工具；不要输出空泛计划后停止。',
        '决定处理画面时必须直接执行真实动作；不要只输出“准备执行”或说明文字来代替处理。',
        '这个任务必须真实调用工具；第一轮应直接创建临时文档。',
        '简单工具验收不需要长篇规划说明，但写入前要有明确目标，写入后要读回复核。',
        '对齐和批量重命名必须使用读回或系统返回的已确认图层编号。',
        'undo/redo 之后必须读回状态。',
        '项目文件打开依赖当前项目和真实文件搜索；失败时如实报告，不要假成功。',
        '如果工具失败，停止掩盖并直接报告失败原因。'
      ].join('\n'),
      tools,
      modelId,
      maxIterations: 20,
      requireInitialToolCall: false,
      toolDecisionContext: {
        intentControlPlane: buildAgentIntentControlPlaneDecision({
          userInput: task,
          hasImageInput: false,
          hasDocument: true,
          photoshopConnected: true
        }),
        photoshopConnected: true,
        hasDocument: true,
        hasImageInput: false
      },
      callbacks
    },
    (selectedModelId, messages, toolSchemas, options) => modelService.chatWithTools(
      selectedModelId,
      messages,
      toolSchemas,
      {
        maxTokens: 1536,
        temperature: 0.1,
        timeoutMs: options?.timeoutMs || timeoutMs
      }
    ),
    safeExecuteTool
  );

  const runResult = await agent.run(task);
  const toolSummaries = summarizeToolCallLog(runResult.toolCallLog);
  const toolNames = toolSummaries.map((entry) => entry.name);
  const failedTools = toolSummaries.filter((entry) => entry.result.success === false);
  const createdLayerIds = createdLayerIdsFromRenderLayout(toolSummaries);
  const alignTool = findAlignToReferenceWithLayerId(toolSummaries, createdLayerIds);
  const alignedLayerId = Number(alignTool?.arguments?.layerId);
  const batchRenameTool = findBatchRenameWithLayerIds(toolSummaries, createdLayerIds);

  let documentsBeforeCleanup = null;
  let documentsAfterCleanup = null;
  let cleanup = null;
  try {
    const list = await safeExecuteTool('listDocuments', { includeDetails: false });
    documentsBeforeCleanup = Array.isArray(list?.documents) ? list.documents : [];
    const openDocs = documentsBeforeCleanup.filter((doc) => String(doc?.name || '') === documentName);
    const closed = [];
    for (const openDoc of openDocs) {
      if (!openDoc?.id) continue;
      const closeResult = await safeExecuteTool('closeDocument', { documentId: openDoc.id, save: false });
      closed.push({ id: openDoc.id, name: openDoc.name, success: closeResult?.success !== false, error: closeResult?.error });
    }
    cleanup = openDocs.length > 0 ? { success: closed.every((item) => item.success), closed } : null;
    const postCleanupList = await safeExecuteTool('listDocuments', { includeDetails: false });
    documentsAfterCleanup = Array.isArray(postCleanupList?.documents) ? postCleanupList.documents : [];
  } catch (error) {
    cleanup = { success: false, error: error?.message || String(error) };
    documentsAfterCleanup = documentsBeforeCleanup;
  }

  const readbackCount = toolSummaries.filter((tool) => (
    ['getLayerHierarchy', 'getLayerBounds', 'getAcceptanceSnapshot', 'getDocumentInfo'].includes(tool.name)
    && tool.result?.success !== false
  )).length;

  const requiredSignals = [
    { name: 'created-document', passed: hasSuccessfulTool(toolSummaries, 'createDocument') },
    { name: 'rendered-layout', passed: hasSuccessfulTool(toolSummaries, 'renderLayout') && createdLayerIds.length >= 2 },
    { name: 'readback-before-writes', passed: hasSuccessfulTool(toolSummaries, 'getLayerHierarchy') || hasSuccessfulTool(toolSummaries, 'getLayerBounds') },
    { name: 'aligned-real-layer-id', passed: Boolean(alignTool && findToolWithLayerArg(toolSummaries, 'alignToReference', alignedLayerId)) },
    { name: 'batch-renamed-explicit-layer-ids', passed: Boolean(batchRenameTool) },
    { name: 'undo-called', passed: hasSuccessfulTool(toolSummaries, 'undo') },
    { name: 'redo-called', passed: hasSuccessfulTool(toolSummaries, 'redo') },
    { name: 'readback-after-history', passed: readbackCount >= 3 },
    { name: 'openProjectFile-called', passed: hasSuccessfulTool(toolSummaries, 'openProjectFile') },
    { name: 'document-not-left-open', passed: Array.isArray(documentsAfterCleanup) && !documentsAfterCleanup.some((doc) => String(doc?.name || '') === documentName) },
    { name: 'no-failed-tools', passed: failedTools.length === 0 }
  ];
  const success = requiredSignals.every((item) => item.passed);

  const report = {
    success,
    skipped: false,
    mode: 'live-agent-real-model-real-photoshop-layout-history',
    modelId,
    ollama,
    documentName,
    openQuery,
    createdLayerIds,
    alignedLayerId: Number.isFinite(alignedLayerId) ? alignedLayerId : undefined,
    durationMs: Date.now() - startedAt,
    agent: {
      success: runResult.success,
      stopReason: runResult.stopReason,
      executionStatus: runResult.executionSummary?.status,
      summaryText: runResult.executionSummary?.summaryText,
      blockers: runResult.executionSummary?.blockers || [],
      warnings: runResult.executionSummary?.warnings || [],
      iterations: runResult.iterations,
      toolCount: toolSummaries.length,
      failedToolCount: failedTools.length,
      toolNames
    },
    document: {
      openBeforeCleanup: Array.isArray(documentsBeforeCleanup) && documentsBeforeCleanup.some((doc) => String(doc?.name || '') === documentName),
      openAfter: Array.isArray(documentsAfterCleanup) && documentsAfterCleanup.some((doc) => String(doc?.name || '') === documentName),
      cleanup,
      cleanupBefore
    },
    requiredSignals,
    tools: toolSummaries,
    finalMessage: runResult.message,
    report: { json: REPORT_JSON, md: REPORT_MD },
    boundaries: [
      'This runner uses a real model through ModelService.chatWithTools; tool calls are not pre-scripted.',
      'The executable tool set is scoped to layout/history/file-context operations so layerId and history-state mistakes are diagnosable.',
      'openProjectFile depends on a selected project and real project files; live failures are reported as failures, not hidden.',
      'Passing this runner proves this bounded Agent layout/history task, not all Photoshop capabilities or open-ended design quality.'
    ]
  };

  writeReport(report);
  console.log(JSON.stringify({
    success: report.success,
    mode: report.mode,
    modelId,
    createdLayerIds,
    alignedLayerId: report.alignedLayerId,
    toolNames,
    failedTools: failedTools.map((item) => ({ name: item.name, error: item.result.error })),
    requiredSignals,
    document: report.document,
    report: report.report
  }, null, 2));

  if (!success) process.exit(1);
}

main().catch((error) => {
  const failed = {
    success: false,
    skipped: false,
    mode: 'live-agent-real-model-real-photoshop-layout-history',
    generatedAt: new Date().toISOString(),
    error: error?.stack || error?.message || String(error),
    report: { json: REPORT_JSON, md: REPORT_MD },
    boundaries: ['Unhandled runner failure; no live success is claimed.']
  };
  writeReport(failed);
  console.error(failed.error);
  process.exit(1);
});
