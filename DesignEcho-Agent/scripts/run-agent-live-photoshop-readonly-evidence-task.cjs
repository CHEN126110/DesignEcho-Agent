#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TMP_DIR = path.join(ROOT, 'tmp');
const REPORT_JSON = path.join(TMP_DIR, 'agent-live-photoshop-readonly-evidence-task.json');
const REPORT_MD = path.join(TMP_DIR, 'agent-live-photoshop-readonly-evidence-task.md');
const DEFAULT_MODEL_ID = 'local-qwen2.5-7b';
const DEFAULT_TIMEOUT_MS = 180_000;
const CANVAS = { width: 720, height: 480 };

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
  'createGroup',
  'createRectangle',
  'createTextLayer',
  'moveLayerToGroup',
  'getDocumentInfo',
  'getDocumentSnapshot',
  'diagnoseState',
  'getAnnotatedSnapshot',
  'getLayerHierarchy',
  'getElementMapping',
  'analyzeLayout',
  'detectLayerIssues',
  'getScreenSnapshots',
  'getScreenSnapshotsWithOverlay',
  'resolveFontName'
];

const REQUIRED_READ_TOOLS = [
  'getDocumentInfo',
  'getDocumentSnapshot',
  'diagnoseState',
  'getAnnotatedSnapshot',
  'getLayerHierarchy',
  'getElementMapping',
  'analyzeLayout',
  'detectLayerIssues',
  'getScreenSnapshots',
  'getScreenSnapshotsWithOverlay',
  'resolveFontName'
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

function arrayLength(value) {
  return Array.isArray(value) ? value.length : undefined;
}

function summarizeResult(result) {
  if (Array.isArray(result)) {
    return {
      success: true,
      itemCount: result.length
    };
  }

  const out = result && typeof result === 'object' ? result : {};
  return {
    success: out.success !== false,
    error: out.error ? compact(out.error) : undefined,
    message: out.message ? compact(out.message) : undefined,
    documentId: firstNumber(out.documentId, out.activeDocumentId, out.document?.id, out.data?.documentId),
    documentName: out.documentName ?? out.document?.name ?? out.documentInfo?.name ?? out.name ?? undefined,
    layerId: firstNumber(out.layerId, out.layer?.id, out.groupId, out.data?.layerId, out.data?.layer?.id),
    groupId: firstNumber(out.groupId, out.data?.groupId, out.layer?.id),
    elementCount: arrayLength(out.elements) ?? out.summary?.totalElements,
    layerCount: arrayLength(out.layers) ?? out.documentInfo?.layerCount,
    snapshotCount: arrayLength(out.snapshots),
    issueCount: arrayLength(out.issues),
    base64Present: Boolean(out.snapshot?.base64 || out.imageData || out.snapshots?.some((item) => item?.base64)),
    resolvedFont: out.resolvedFont ?? out.data?.resolvedFont,
    suggestionCount: arrayLength(out.suggestions) ?? arrayLength(out.matches),
    layoutType: out.layout?.type
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
    '# Agent Live Photoshop Readonly Evidence Task',
    '',
    `- success: ${report.success}`,
    `- skipped: ${Boolean(report.skipped)}`,
    `- mode: ${report.mode}`,
    `- modelId: ${report.modelId || ''}`,
    `- documentName: ${report.documentName || ''}`,
    `- screenLayerId: ${report.screenLayerId ?? ''}`,
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
    if (tool.arguments?.screens) lines.push(`  argument.screens: ${tool.arguments.screens.length}`);
    if (tool.arguments?.fontName) lines.push(`  argument.fontName: ${tool.arguments.fontName}`);
    if (tool.result.error) lines.push(`  error: ${tool.result.error}`);
    if (tool.result.snapshotCount !== undefined) lines.push(`  snapshotCount: ${tool.result.snapshotCount}`);
    if (tool.result.elementCount !== undefined) lines.push(`  elementCount: ${tool.result.elementCount}`);
    if (tool.result.layerCount !== undefined) lines.push(`  layerCount: ${tool.result.layerCount}`);
    if (tool.result.layoutType) lines.push(`  layoutType: ${tool.result.layoutType}`);
    if (tool.result.resolvedFont) lines.push(`  resolvedFont: ${tool.result.resolvedFont}`);
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
    mode: 'live-agent-real-model-real-photoshop-readonly-evidence',
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
      'Partial report: the live readonly evidence runner failed or was interrupted before final assertions.',
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

let scopedDisposableDocumentName = '';
let scopedScreenFixture = null;

function isDisposableDocumentName(value) {
  return /^AgentLiveReadonlyEvidence-\d+/.test(String(value || ''));
}

async function listDocumentsForScopedGuard() {
  try {
    const result = await executeToolCall('listDocuments', { includeDetails: false });
    return Array.isArray(result?.documents) ? result.documents : [];
  } catch {
    return [];
  }
}

async function activeDocumentMatchesScopedDisposable() {
  if (!scopedDisposableDocumentName) return true;
  const documents = await listDocumentsForScopedGuard();
  return documents.some((doc) => doc?.isActive && String(doc?.name || '') === scopedDisposableDocumentName);
}

async function closeTargetMatchesScopedDisposable(params) {
  if (!scopedDisposableDocumentName) return true;
  const documentName = String(params?.documentName || '').trim();
  if (documentName) {
    return documentName === scopedDisposableDocumentName || isDisposableDocumentName(documentName);
  }
  const documentId = Number(params?.documentId);
  if (!Number.isFinite(documentId)) return activeDocumentMatchesScopedDisposable();
  const documents = await listDocumentsForScopedGuard();
  const target = documents.find((doc) => Number(doc?.id) === documentId);
  return target ? isDisposableDocumentName(target.name) : false;
}

async function guardScopedDisposableTool(toolName, params) {
  if (!scopedDisposableDocumentName) return null;
  if (toolName === 'createDocument') {
    const requestedName = String(params?.name || '').trim();
    if (requestedName !== scopedDisposableDocumentName) {
      return {
        success: false,
        error: `Runner refused createDocument outside disposable document: ${requestedName || '(missing name)'}`,
        safetyBlocked: true
      };
    }
    return null;
  }
  if (toolName === 'closeDocument') {
    if (await closeTargetMatchesScopedDisposable(params)) return null;
    return {
      success: false,
      error: 'Runner refused to close a non-disposable Photoshop document.',
      safetyBlocked: true
    };
  }
  if (toolName === 'switchDocument') {
    const requestedName = String(params?.documentName || '').trim();
    if (requestedName === scopedDisposableDocumentName) return null;
    return {
      success: false,
      error: `Runner refused switchDocument outside disposable document: ${requestedName || '(missing name)'}`,
      safetyBlocked: true
    };
  }
  const documentScopedTools = new Set(TOOL_NAMES.filter((name) => ![
    'listDocuments',
    'createDocument',
    'resolveFontName'
  ].includes(name)));
  if (documentScopedTools.has(toolName) && !(await activeDocumentMatchesScopedDisposable())) {
    return {
      success: false,
      error: `Runner refused ${toolName} because the active document is not the disposable document.`,
      safetyBlocked: true
    };
  }
  return null;
}

const SCREEN_ARGUMENT_TOOL_NAMES = new Set([
  'detectLayerIssues',
  'getScreenSnapshots',
  'getScreenSnapshotsWithOverlay'
]);

function normalizeScreenBounds(bounds) {
  const fallback = scopedScreenFixture?.bounds || {
    left: 0,
    top: 0,
    right: CANVAS.width,
    bottom: CANVAS.height,
    width: CANVAS.width,
    height: CANVAS.height
  };
  const source = bounds && typeof bounds === 'object' ? bounds : {};
  const left = firstNumber(source.left, fallback.left, 0);
  const top = firstNumber(source.top, fallback.top, 0);
  const right = firstNumber(source.right, fallback.right, CANVAS.width);
  const bottom = firstNumber(source.bottom, fallback.bottom, CANVAS.height);
  return {
    left,
    top,
    right,
    bottom,
    width: firstNumber(source.width, right - left, fallback.width, CANVAS.width),
    height: firstNumber(source.height, bottom - top, fallback.height, CANVAS.height)
  };
}

function normalizeScopedScreen(screen) {
  if (!scopedScreenFixture) return screen;
  const source = screen && typeof screen === 'object' ? screen : {};
  const merged = {
    ...scopedScreenFixture,
    ...source,
    bounds: normalizeScreenBounds(source.bounds),
    copyPlaceholders: Array.isArray(source.copyPlaceholders) ? source.copyPlaceholders : [],
    imagePlaceholders: Array.isArray(source.imagePlaceholders) ? source.imagePlaceholders : []
  };
  if (!Number.isFinite(Number(merged.id))) merged.id = scopedScreenFixture.id;
  if (!Number.isFinite(Number(merged.index))) merged.index = scopedScreenFixture.index;
  if (!String(merged.name || '').trim()) merged.name = scopedScreenFixture.name;
  return merged;
}

function normalizeScopedScreenArguments(toolName, params) {
  if (!scopedScreenFixture || !SCREEN_ARGUMENT_TOOL_NAMES.has(toolName)) return params;
  const source = params && typeof params === 'object' ? params : {};
  const screens = Array.isArray(source.screens) && source.screens.length > 0
    ? source.screens
    : [scopedScreenFixture];
  const normalized = {
    ...source,
    screens: screens.map(normalizeScopedScreen),
    screenIndices: Array.isArray(source.screenIndices) && source.screenIndices.length > 0
      ? source.screenIndices
      : [0]
  };
  if (toolName === 'getScreenSnapshotsWithOverlay' && !Array.isArray(source.placements)) {
    normalized.placements = [];
  }
  if (params && typeof params === 'object') {
    Object.assign(params, normalized);
    return params;
  }
  return normalized;
}

async function safeExecuteTool(toolName, params) {
  try {
    const scopedBlock = await guardScopedDisposableTool(toolName, params || {});
    if (scopedBlock) return scopedBlock;
    return await executeToolCall(toolName, normalizeScopedScreenArguments(toolName, params));
  } catch (error) {
    return {
      success: false,
      error: error?.message || String(error),
      thrown: true
    };
  }
}

function buildSingleScreenFixture(screenLayerId, screenName = 'Agent Evidence Screen') {
  return {
    id: screenLayerId,
    name: screenName,
    index: 0,
    bounds: {
      left: 0,
      top: 0,
      right: CANVAS.width,
      bottom: CANVAS.height,
      width: CANVAS.width,
      height: CANVAS.height
    },
    type: 'CUSTOM',
    order: 0,
    copyPlaceholders: [],
    imagePlaceholders: []
  };
}

function buildReadonlyEvidenceStages(input) {
  const {
    documentName,
    groupId,
    shapeLayerId,
    textLayerId,
    screenFixture
  } = input;

  return [
    {
      stageId: 'setup',
      title: '建立临时画面',
      toolNames: ['listDocuments', 'createDocument', 'createRectangle', 'createTextLayer', 'createGroup', 'getLayerHierarchy'],
      requiredToolNames: ['createDocument', 'createRectangle', 'createTextLayer', 'createGroup', 'getLayerHierarchy'],
      maxIterations: 8,
      maxDesignRetryRounds: 1,
      task: [
        '这是一次 Photoshop 证据读取验收，请直接完成当前小步骤。',
        '这个小步骤只建立临时画面。',
        '先看一眼已打开文档，再创建临时文档。',
        `请创建一个 ${CANVAS.width}x${CANVAS.height} 的临时文档，名称必须是 ${documentName}。`,
        '先创建矩形形状图层，名称必须是 Agent Evidence Card，位置为 x: 88, y: 104, width: 310, height: 190，填充色为 #5F7C8A。',
        '再创建文字图层，内容必须是 Evidence Snapshot Title，位置为 x: 118, y: 154，字号 34。',
        '最后创建图层组，名称必须是 Agent Evidence Screen Group。',
        '读回图层层级，确认矩形、文字和图层组的编号。'
      ].join('\n')
    },
    {
      stageId: 'move-shape',
      title: '整理矩形归属',
      toolNames: ['switchDocument', 'getLayerHierarchy', 'moveLayerToGroup'],
      requiredToolNames: ['switchDocument', 'getLayerHierarchy', 'moveLayerToGroup'],
      maxIterations: 5,
      maxDesignRetryRounds: 1,
      skipUnless: () => typeof groupId === 'number' && typeof shapeLayerId === 'number',
      task: [
        `请先切回名称为 ${documentName} 的临时文档。`,
        `把编号 ${shapeLayerId} 的矩形移动到编号 ${groupId} 的 Agent Evidence Screen Group 里。`,
        '移动后读回图层层级，确认归属已经正确。'
      ].join('\n')
    },
    {
      stageId: 'move-text',
      title: '整理文字归属',
      toolNames: ['switchDocument', 'getLayerHierarchy', 'moveLayerToGroup'],
      requiredToolNames: ['switchDocument', 'getLayerHierarchy', 'moveLayerToGroup'],
      maxIterations: 5,
      maxDesignRetryRounds: 1,
      skipUnless: () => typeof groupId === 'number' && typeof textLayerId === 'number',
      task: [
        `请先切回名称为 ${documentName} 的临时文档。`,
        `把编号 ${textLayerId} 的文字移动到编号 ${groupId} 的 Agent Evidence Screen Group 里。`,
        '移动后读回图层层级，确认归属已经正确。'
      ].join('\n')
    },
    {
      stageId: 'document-evidence',
      title: '读取画面证据',
      toolNames: [
        'switchDocument',
        'getDocumentInfo',
        'getLayerHierarchy',
        'diagnoseState',
        'getDocumentSnapshot',
        'getAnnotatedSnapshot',
        'getElementMapping',
        'analyzeLayout',
        'resolveFontName'
      ],
      requiredToolNames: [
        'switchDocument',
        'getDocumentInfo',
        'getLayerHierarchy',
        'diagnoseState',
        'getDocumentSnapshot',
        'getAnnotatedSnapshot',
        'getElementMapping',
        'analyzeLayout',
        'resolveFontName'
      ],
      maxIterations: 10,
      maxDesignRetryRounds: 1,
      task: [
        `请先切回名称为 ${documentName} 的临时文档。`,
        '读取文档信息、图层层级、状态诊断、文档截图、带元素坐标的截图、元素映射和布局观察。',
        '字体解析请使用 Arial，最多看 5 个候选。',
        '只反馈画面证据和需要复核的点，不展开流程说明。'
      ].join('\n')
    },
    {
      stageId: 'screen-evidence',
      title: '读取屏级证据',
      toolNames: ['switchDocument', 'detectLayerIssues', 'getScreenSnapshots', 'getScreenSnapshotsWithOverlay'],
      requiredToolNames: ['switchDocument', 'detectLayerIssues', 'getScreenSnapshots', 'getScreenSnapshotsWithOverlay'],
      maxIterations: 8,
      maxDesignRetryRounds: 1,
      skipUnless: () => screenFixture && typeof groupId === 'number',
      task: [
        `请先切回名称为 ${documentName} 的临时文档。`,
        '请基于下面这一个屏对象读取屏级问题、屏级截图和带放置框的屏级截图：',
        JSON.stringify([screenFixture]),
        '带放置框的屏级截图中 placements 使用 []，screenIndices 使用 [0]。',
        '只反馈这一屏的可见证据和需要复核的点。'
      ].join('\n')
    },
    {
      stageId: 'close',
      title: '关闭临时画面',
      toolNames: ['switchDocument', 'closeDocument'],
      requiredToolNames: ['closeDocument'],
      maxIterations: 4,
      maxDesignRetryRounds: 0,
      task: [
        `请先切回名称为 ${documentName} 的临时文档。`,
        '关闭这个临时文档，不保存 PSD。'
      ].join('\n')
    }
  ];
}

function buildStageDesignRetryTask(stage, missingToolNames, previousTools, attempt) {
  const failed = previousTools
    .filter((tool) => tool.result?.success === false)
    .map((tool) => `${tool.name}: ${tool.result?.error || 'failed'}`)
    .join('\n');
  return [
    stage.task,
    '',
    `上一轮第 ${attempt} 次没有完成当前小步骤的必要证据：${missingToolNames.join(', ')}。`,
    failed ? `已看到的失败原因：\n${failed}` : '',
    '请只补齐这个小步骤缺少的证据或动作；如果无法继续，请说明真实原因。'
  ].filter(Boolean).join('\n');
}

async function cleanupStaleDisposableDocuments() {
  const list = await safeExecuteTool('listDocuments', { includeDetails: false });
  const documents = Array.isArray(list?.documents) ? list.documents : [];
  const stale = documents.filter((doc) => /^AgentLiveReadonlyEvidence-\d+/.test(String(doc?.name || '')));
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

function findLayerIdByTool(tools, toolName) {
  return firstSuccessfulTool(tools, toolName)?.result?.layerId;
}

function findGroupId(tools) {
  const group = firstSuccessfulTool(tools, 'createGroup');
  return firstNumber(group?.result?.groupId, group?.result?.layerId);
}

function findToolWithLayerArg(tools, toolName, layerId) {
  return tools.find((tool) => (
    tool.name === toolName
    && tool.result?.success !== false
    && typeof layerId === 'number'
    && Number(tool.arguments?.layerId) === layerId
  ));
}

function findToolWithGroupArgs(tools, layerId, groupId) {
  return tools.find((tool) => (
    tool.name === 'moveLayerToGroup'
    && tool.result?.success !== false
    && typeof layerId === 'number'
    && typeof groupId === 'number'
    && Number(tool.arguments?.layerId) === layerId
    && Number(tool.arguments?.targetGroupId) === groupId
  ));
}

function findToolWithScreensArg(tools, toolName, screenLayerId) {
  return tools.find((tool) => {
    if (tool.name !== toolName || tool.result?.success === false) return false;
    const screens = tool.arguments?.screens;
    if (!Array.isArray(screens) || screens.length === 0) return false;
    return screens.some((screen) => (
      Number(screen?.id) === screenLayerId
      && Number(screen?.index) === 0
      && Number(screen?.bounds?.left) === 0
      && Number(screen?.bounds?.top) === 0
      && Number(screen?.bounds?.right) === CANVAS.width
      && Number(screen?.bounds?.bottom) === CANVAS.height
    ));
  });
}

async function main() {
  if (hasArg('--self-test')) {
    const sampleScreen = buildSingleScreenFixture(8);
    const sample = {
      success: true,
      mode: 'self-test',
      agent: { toolCount: 2, failedToolCount: 0, toolNames: ['getAnnotatedSnapshot', 'getScreenSnapshots'] },
      tools: [
        { name: 'getAnnotatedSnapshot', arguments: { maxWidth: 900, maxHeight: 700 }, result: { success: true, layerCount: 2, base64Present: true } },
        { name: 'getScreenSnapshots', arguments: { screens: [sampleScreen], maxWidth: 720, screenIndices: [0] }, result: { success: true, snapshotCount: 1 } }
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
      mode: 'guarded-live-agent-photoshop-readonly-evidence',
      reason: 'Run with --live to allow a real model to call real Photoshop readonly evidence tools against a disposable document.',
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

  const modelId = getArgValue('--model', process.env.DESIGNECHO_LIVE_AGENT_READONLY_EVIDENCE_MODEL || DEFAULT_MODEL_ID);
  const timeoutMs = Number(getArgValue('--timeout-ms', process.env.DESIGNECHO_LIVE_AGENT_READONLY_EVIDENCE_TIMEOUT_MS || DEFAULT_TIMEOUT_MS));
  const stamp = Date.now();
  const documentName = getArgValue('--document-name', `AgentLiveReadonlyEvidence-${stamp}`);
  scopedDisposableDocumentName = documentName;

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
      mode: 'blocked-live-agent-photoshop-readonly-evidence',
      modelId,
      blockers,
      report: { json: REPORT_JSON, md: REPORT_MD },
      boundaries: ['Blocked before live Photoshop access; no success is claimed.']
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
      mode: 'blocked-live-agent-photoshop-readonly-evidence',
      modelId,
      blockers: [`Photoshop tool runtime unavailable before live run: ${cleanupBefore.probe.error || 'unknown error'}`],
      cleanupBefore,
      report: { json: REPORT_JSON, md: REPORT_MD },
      boundaries: ['Blocked before creating a disposable document; no Photoshop write or read success is claimed.']
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

  const stageResults = [];
  const allToolSummaries = [];
  const aggregateAgent = () => ({
    toolCount: allToolSummaries.length,
    failedToolCount: allToolSummaries.filter((tool) => tool.result?.success === false).length,
    toolNames: allToolSummaries.map((tool) => tool.name),
    stages: stageResults.map((stage) => ({
      stageId: stage.stageId,
      success: stage.success,
      stopReason: stage.stopReason,
      toolCount: stage.toolCount,
      toolNames: stage.toolNames
    }))
  });

  const runAgentStage = async (stage) => {
    const stageTools = selectTools(stage.toolNames);
    const missingStageTools = stage.toolNames.filter((name) => !stageTools.some((tool) => tool.name === name));
    if (missingStageTools.length > 0) {
      throw new Error(`Stage ${stage.stageId} missing tool schemas: ${missingStageTools.join(', ')}`);
    }

    liveEvents.push({
      kind: 'stage_started',
      title: stage.title,
      detail: stage.stageId,
      status: 'running'
    });
    writePartial({ agent: aggregateAgent() });

    const callbacks = {
      onStep: (step) => {
        liveEvents.push({
          stageId: stage.stageId,
          kind: step.kind,
          title: step.title,
          detail: step.detail,
          status: step.status,
          toolName: step.toolName
        });
        if (step.kind === 'model_response' || step.kind === 'warning' || step.kind === 'stopped') {
          writePartial({ agent: aggregateAgent() });
        }
      },
      onToolStart: (toolName) => console.log(`[agent-live-readonly-evidence:${stage.stageId}:tool:start] ${toolName}`),
      onToolComplete: (toolName, result) => {
        console.log(`[agent-live-readonly-evidence:${stage.stageId}:tool:${result?.success === false ? 'fail' : 'pass'}] ${toolName}`);
        liveTools.push({ stageId: stage.stageId, name: toolName, result: summarizeResult(result) });
        writePartial({ agent: aggregateAgent() });
      }
    };

    const agent = new Agent(
      {
        systemPrompt: [
          '你是一个谨慎的 Photoshop 设计助理。',
          `当前只处理这个小步骤：${stage.title}。`,
          '需要处理画面或读取证据时，请直接完成动作，不要只写说明后停止。',
          '简单证据读取时表达保持简短；必要时只用一句话交代观察目的。',
          '移动或读取屏级画面时，请复用已经确认的图层编号和图层组编号。',
          '如果某一步失败，请说明真实原因，不要把失败包装成完成。'
        ].join('\n'),
        tools: stageTools,
        modelId,
        maxIterations: stage.maxIterations || 8,
        requireInitialToolCall: true,
        toolDecisionContext: {
          intentControlPlane: buildAgentIntentControlPlaneDecision({
            userInput: stage.task,
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

    const result = await agent.run(stage.task);
    const stageToolSummaries = summarizeToolCallLog(result.toolCallLog)
      .map((tool) => ({ ...tool, stageId: stage.stageId }));
    allToolSummaries.push(...stageToolSummaries);
    const failedTools = stageToolSummaries.filter((tool) => tool.result?.success === false);
    const stageReport = {
      stageId: stage.stageId,
      title: stage.title,
      success: result.success,
      stopReason: result.stopReason,
      executionStatus: result.executionSummary?.status,
      summaryText: result.executionSummary?.summaryText,
      blockers: result.executionSummary?.blockers || [],
      warnings: result.executionSummary?.warnings || [],
      iterations: result.iterations,
      toolCount: stageToolSummaries.length,
      failedToolCount: failedTools.length,
      toolNames: stageToolSummaries.map((tool) => tool.name)
    };
    stageResults.push(stageReport);
    liveEvents.push({
      stageId: stage.stageId,
      kind: 'stage_completed',
      title: stage.title,
      detail: `动作 ${stageReport.toolCount} 次，失败 ${stageReport.failedToolCount} 次。`,
      status: failedTools.length === 0 ? 'success' : 'error'
    });
    writePartial({ agent: aggregateAgent() });
    return { result, tools: stageToolSummaries, stageReport };
  };

  const runStageWithRequiredTools = async (stage) => {
    if (typeof stage.skipUnless === 'function' && !stage.skipUnless()) {
      liveEvents.push({
        stageId: stage.stageId,
        kind: 'stage_skipped',
        title: stage.title,
        detail: '缺少上一小步确认的编号。',
        status: 'skipped'
      });
      writePartial({ agent: aggregateAgent() });
      return null;
    }

    const requiredToolNames = Array.isArray(stage.requiredToolNames)
      ? stage.requiredToolNames.filter(Boolean)
      : [];
    if (requiredToolNames.length === 0) {
      return runAgentStage(stage);
    }

    const stageStartIndex = allToolSummaries.length;
    const maxDesignRetryRounds = Math.max(0, Number(stage.maxDesignRetryRounds || 0));
    let currentStage = stage;
    let lastRun = null;

    for (let attempt = 0; attempt <= maxDesignRetryRounds; attempt += 1) {
      lastRun = await runAgentStage(currentStage);
      const cumulativeStageTools = allToolSummaries.slice(stageStartIndex);
      const missingToolNames = requiredToolNames.filter((toolName) => !hasSuccessfulTool(cumulativeStageTools, toolName));
      if (missingToolNames.length === 0) return lastRun;
      if (attempt >= maxDesignRetryRounds) {
        liveEvents.push({
          stageId: stage.stageId,
          kind: 'stage_reflexion_exhausted',
          title: stage.title,
          detail: `缺少必要证据：${missingToolNames.join(', ')}`,
          status: 'error'
        });
        writePartial({ agent: aggregateAgent() });
        return lastRun;
      }

      liveEvents.push({
        stageId: stage.stageId,
        kind: 'stage_reflexion_reentry',
        title: stage.title,
        detail: `缺少必要证据：${missingToolNames.join(', ')}`,
        status: 'running'
      });
      currentStage = {
        ...stage,
        title: `${stage.title} 复核调整 ${attempt + 1}`,
        task: buildStageDesignRetryTask(stage, missingToolNames, cumulativeStageTools, attempt + 1)
      };
      writePartial({ agent: aggregateAgent() });
    }

    return lastRun;
  };

  let groupId;
  let shapeLayerId;
  let textLayerId;
  let screenFixture = null;

  await runStageWithRequiredTools(buildReadonlyEvidenceStages({ documentName })[0]);
  groupId = findGroupId(allToolSummaries);
  shapeLayerId = findLayerIdByTool(allToolSummaries, 'createRectangle');
  textLayerId = findLayerIdByTool(allToolSummaries, 'createTextLayer');

  await runStageWithRequiredTools(buildReadonlyEvidenceStages({
    documentName,
    groupId,
    shapeLayerId,
    textLayerId
  })[1]);

  await runStageWithRequiredTools(buildReadonlyEvidenceStages({
    documentName,
    groupId,
    shapeLayerId,
    textLayerId
  })[2]);

  screenFixture = typeof groupId === 'number'
    ? buildSingleScreenFixture(groupId, 'Agent Evidence Screen Group')
    : null;
  scopedScreenFixture = screenFixture;

  await runStageWithRequiredTools(buildReadonlyEvidenceStages({
    documentName,
    groupId,
    shapeLayerId,
    textLayerId,
    screenFixture
  })[3]);

  await runStageWithRequiredTools(buildReadonlyEvidenceStages({
    documentName,
    groupId,
    shapeLayerId,
    textLayerId,
    screenFixture
  })[4]);

  await runStageWithRequiredTools(buildReadonlyEvidenceStages({
    documentName,
    groupId,
    shapeLayerId,
    textLayerId,
    screenFixture
  })[5]);

  const toolSummaries = allToolSummaries;
  const toolNames = toolSummaries.map((entry) => entry.name);
  const failedTools = toolSummaries.filter((entry) => entry.result.success === false);

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

  const requiredSignals = [
    { name: 'created-document', passed: hasSuccessfulTool(toolSummaries, 'createDocument') },
    { name: 'listed-documents', passed: hasSuccessfulTool(toolSummaries, 'listDocuments') || cleanupBefore.probe?.success !== false },
    { name: 'created-screen-group', passed: typeof groupId === 'number' },
    { name: 'created-shape', passed: typeof shapeLayerId === 'number' },
    { name: 'created-text', passed: typeof textLayerId === 'number' },
    { name: 'moved-shape-into-screen-group', passed: Boolean(findToolWithGroupArgs(toolSummaries, shapeLayerId, groupId)) },
    { name: 'moved-text-into-screen-group', passed: Boolean(findToolWithGroupArgs(toolSummaries, textLayerId, groupId)) },
    ...REQUIRED_READ_TOOLS.map((toolName) => ({ name: `called-${toolName}`, passed: hasSuccessfulTool(toolSummaries, toolName) })),
    { name: 'screen-fixture-built-from-real-group-id', passed: Boolean(screenFixture) },
    { name: 'detectLayerIssues-used-real-screens', passed: Boolean(findToolWithScreensArg(toolSummaries, 'detectLayerIssues', groupId)) },
    { name: 'getScreenSnapshots-used-real-screens', passed: Boolean(findToolWithScreensArg(toolSummaries, 'getScreenSnapshots', groupId)) },
    { name: 'getScreenSnapshotsWithOverlay-used-real-screens', passed: Boolean(findToolWithScreensArg(toolSummaries, 'getScreenSnapshotsWithOverlay', groupId)) },
    { name: 'resolved-font-requested', passed: Boolean(firstSuccessfulTool(toolSummaries, 'resolveFontName')?.arguments?.fontName) },
    { name: 'document-not-left-open', passed: Array.isArray(documentsAfterCleanup) && !documentsAfterCleanup.some((doc) => String(doc?.name || '') === documentName) },
    { name: 'no-failed-tools', passed: failedTools.length === 0 }
  ];
  const success = requiredSignals.every((item) => item.passed);
  const agentSummary = aggregateAgent();
  const lastStage = stageResults[stageResults.length - 1] || null;

  const report = {
    success,
    skipped: false,
    mode: 'live-agent-real-model-real-photoshop-readonly-evidence',
    modelId,
    ollama,
    documentName,
    groupId,
    shapeLayerId,
    textLayerId,
    screenLayerId: groupId,
    screenFixture,
    durationMs: Date.now() - startedAt,
    agent: {
      success: stageResults.length > 0 && stageResults.every((stage) => stage.failedToolCount === 0 && stage.success !== false),
      stopReason: lastStage?.stopReason,
      executionStatus: lastStage?.executionStatus,
      summaryText: lastStage?.summaryText,
      blockers: stageResults.flatMap((stage) => stage.blockers || []),
      warnings: stageResults.flatMap((stage) => stage.warnings || []),
      iterations: stageResults.reduce((total, stage) => total + (Number(stage.iterations) || 0), 0),
      toolCount: agentSummary.toolCount,
      failedToolCount: agentSummary.failedToolCount,
      toolNames,
      stages: agentSummary.stages
    },
    document: {
      openBeforeCleanup: Array.isArray(documentsBeforeCleanup) && documentsBeforeCleanup.some((doc) => String(doc?.name || '') === documentName),
      openAfter: Array.isArray(documentsAfterCleanup) && documentsAfterCleanup.some((doc) => String(doc?.name || '') === documentName),
      cleanup,
      cleanupBefore
    },
    requiredSignals,
    tools: toolSummaries,
    finalMessage: lastStage?.summaryText || '',
    report: { json: REPORT_JSON, md: REPORT_MD },
    boundaries: [
      'This runner uses a real model through ModelService.chatWithTools; tool calls are not pre-scripted.',
      'The executable tool set is scoped to readonly evidence and minimal disposable-document setup so diagnostic failures are attributable.',
      'Screen snapshot tools must receive explicit screens data built from a real groupId, not guessed ids.',
      'Passing this runner proves this bounded Agent evidence-reading task, not all Photoshop capabilities or design quality.'
    ]
  };

  writeReport(report);
  console.log(JSON.stringify({
    success: report.success,
    mode: report.mode,
    modelId,
    groupId,
    shapeLayerId,
    textLayerId,
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
    mode: 'live-agent-real-model-real-photoshop-readonly-evidence',
    generatedAt: new Date().toISOString(),
    error: error?.stack || error?.message || String(error),
    report: { json: REPORT_JSON, md: REPORT_MD },
    boundaries: ['Unhandled runner failure; no live success is claimed.']
  };
  writeReport(failed);
  console.error(failed.error);
  process.exit(1);
});
