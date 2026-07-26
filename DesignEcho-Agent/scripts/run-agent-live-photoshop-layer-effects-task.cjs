#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TMP_DIR = path.join(ROOT, 'tmp');
const REPORT_JSON = path.join(TMP_DIR, 'agent-live-photoshop-layer-effects-task.json');
const REPORT_MD = path.join(TMP_DIR, 'agent-live-photoshop-layer-effects-task.md');
const DEFAULT_MODEL_ID = 'local-qwen2.5-7b';
const DEFAULT_TIMEOUT_MS = 180_000;

if (!globalThis.window) {
  globalThis.window = {};
}

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
  'getLayerHierarchy',
  'getLayerBounds',
  'getLayerProperties',
  'getAcceptanceSnapshot',
  'createRectangle',
  'selectLayer',
  'setLayerOpacity',
  'addStroke',
  'addDropShadow',
  'quickExport'
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

function safeUnlink(filePath) {
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch (_) {
    // Disposable verification output cleanup is best-effort.
  }
}

function readPngHeader(filePath) {
  if (!fs.existsSync(filePath)) return '';
  return fs.readFileSync(filePath).subarray(0, 8).toString('hex');
}

function compact(value, maxLength = 320) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > maxLength ? `${text.slice(0, maxLength - 3)}...` : text;
}

function normalizeArgs(args) {
  if (!args || typeof args !== 'object') return {};
  return args;
}

function summarizeResult(result) {
  const out = result && typeof result === 'object' ? result : {};
  return {
    success: out.success !== false,
    error: out.error ? compact(out.error) : undefined,
    message: out.message ? compact(out.message) : undefined,
    documentId: out.documentId ?? out.document?.id ?? undefined,
    documentName: out.documentName ?? out.document?.name ?? out.name ?? undefined,
    layerId: out.layerId ?? out.layer?.id ?? out.data?.layerId ?? undefined,
    layerName: out.layerName ?? out.layer?.name ?? out.name ?? undefined,
    outputPath: out.outputPath ?? out.savedPath ?? out.data?.outputPath ?? out.data?.savedPath ?? undefined,
    effect: out.effect ?? out.data?.effect,
    opacity: out.opacity ?? out.data?.opacity,
    format: out.format ?? out.data?.format,
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
    '# Agent Live Photoshop Layer Effects Task',
    '',
    `- success: ${report.success}`,
    `- skipped: ${Boolean(report.skipped)}`,
    `- mode: ${report.mode}`,
    `- modelId: ${report.modelId || ''}`,
    `- documentName: ${report.documentName || ''}`,
    `- shapeLayerId: ${report.shapeLayerId ?? ''}`,
    `- createdDocumentCount: ${report.createdDocumentCount ?? ''}`,
    `- createdShapeCount: ${report.createdShapeCount ?? ''}`,
    `- outputPath: ${report.outputPath || ''}`,
    `- fileExists: ${Boolean(report.file?.exists)}`,
    `- pngHeader: ${report.file?.pngHeader || ''}`,
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
    const args = tool.arguments || {};
    if (args.layerId !== undefined) lines.push(`  argument.layerId: ${args.layerId}`);
    if (tool.result.error) lines.push(`  error: ${tool.result.error}`);
    if (tool.result.layerId !== undefined) lines.push(`  result.layerId: ${tool.result.layerId}`);
    if (tool.result.effect) lines.push(`  effect: ${tool.result.effect}`);
    if (tool.result.outputPath) lines.push(`  outputPath: ${tool.result.outputPath}`);
  }

  if (report.requiredSignals?.length) {
    lines.push('', '## Required Signals', '');
    for (const signal of report.requiredSignals) {
      lines.push(`- ${signal.name}: ${signal.passed ? 'pass' : 'fail'}`);
    }
  }

  if (report.blockers?.length) {
    lines.push('', '## Blockers', '');
    for (const blocker of report.blockers) lines.push(`- ${blocker}`);
  }

  lines.push('', '## Boundaries', '');
  for (const boundary of report.boundaries || []) {
    lines.push(`- ${boundary}`);
  }

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
    mode: 'live-agent-real-model-real-photoshop-layer-effects',
    generatedAt: new Date().toISOString(),
    modelId: input.modelId,
    documentName: input.documentName,
    outputPath: input.outputPath,
    agent: input.agent || {
      toolCount: input.tools.length,
      failedToolCount: input.tools.filter((tool) => tool.result?.success === false).length,
      toolNames: input.tools.map((tool) => tool.name)
    },
    tools: input.tools,
    events: input.events,
    report: { json: REPORT_JSON, md: REPORT_MD },
    boundaries: [
      'Partial report: the live layer/effects runner failed or was interrupted before final assertions.',
      'Tool calls in this report are real Agent/tool-executor feedback collected before interruption.'
    ]
  };
}

async function listOllamaModels() {
  const response = await fetch('http://127.0.0.1:11434/api/tags');
  if (!response.ok) {
    throw new Error(`Ollama tags HTTP ${response.status}`);
  }
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

function buildTask(documentName, outputPath) {
  return [
    '这是一次真实 Photoshop 图层属性和图层样式验收，工具选择由你自己决定，不要只解释计划。',
    '这个任务属于简单操作验收，不需要长篇规划说明；你只需要说明下一步、执行真实动作，并用读回证据复核。',
    '如果你已经判断下一步要处理画面，请直接执行真实动作；不要把操作清单或参数说明当作结果。',
    `请创建一个 520x360 的临时文档，名称必须是 ${documentName}。`,
    '创建一个矩形形状图层，名称必须是 Agent Effects Shape，位置大约在画布中间，填充色为 #3D7C98。',
    '必须使用创建矩形后系统返回的已确认图层编号来继续选择、调整透明度、添加描边、添加投影和读回复核。',
    '请把这个矩形图层的不透明度设置为 74。',
    '请给这个矩形图层添加描边：宽度 6 像素、位置居中、颜色 #F2C94C、完全不透明。',
    '请给这个矩形图层添加真实 Photoshop 投影：黑色、55% 不透明度、角度 120 度、距离 10 像素、模糊大小 14 像素、扩展 0。',
    '效果和不透明度写入后，必须至少读取一次图层属性、图层边界或图层结构作为证据。',
    `请导出 PNG 到完整路径：${outputPath}。`,
    '导出后关闭这个临时文档，不保存 PSD。',
    '最后请用事实反馈真实处理动作、成功/失败状态、导出路径，以及是否需要人工复核。'
  ].join('\n');
}

async function cleanupStaleDisposableDocuments() {
  const list = await safeExecuteTool('listDocuments', { includeDetails: false });
  const documents = Array.isArray(list?.documents) ? list.documents : [];
  const stale = documents.filter((doc) => /^AgentLiveLayerEffects-\d+/.test(String(doc?.name || '')));
  const closed = [];
  for (const doc of stale) {
    const result = await safeExecuteTool('closeDocument', { documentId: doc.id, save: false });
    closed.push({ id: doc.id, name: doc.name, success: result?.success !== false, error: result?.error });
  }
  return { probe: list, closed };
}

function findFirstSuccessfulLayerId(tools, toolName) {
  const match = tools.find((tool) => tool.name === toolName && tool.result?.success !== false && typeof tool.result.layerId === 'number');
  return match?.result?.layerId;
}

function hasSuccessfulTool(tools, toolName) {
  return tools.some((tool) => tool.name === toolName && tool.result?.success !== false);
}

function hasMatchingLayerArg(tools, toolName, layerId) {
  return typeof layerId === 'number' && tools.some((tool) => (
    tool.name === toolName
    && tool.result?.success !== false
    && Number(tool.arguments?.layerId) === layerId
  ));
}

function findSuccessfulToolWithLayerArg(tools, toolName, layerId) {
  return tools.find((tool) => (
    tool.name === toolName
    && tool.result?.success !== false
    && Number(tool.arguments?.layerId) === layerId
  ));
}

function numberNear(value, expected, tolerance = 0.01) {
  return typeof value === 'number' && Math.abs(value - expected) <= tolerance;
}

function colorMatches(color, expected) {
  if (!color || typeof color !== 'object') return false;
  return Number(color.r) === expected.r && Number(color.g) === expected.g && Number(color.b) === expected.b;
}

function hasCorrectOpacityArgs(tools, layerId) {
  const tool = findSuccessfulToolWithLayerArg(tools, 'setLayerOpacity', layerId);
  return Boolean(tool && numberNear(tool.arguments?.opacity, 74));
}

function hasCorrectStrokeArgs(tools, layerId) {
  const tool = findSuccessfulToolWithLayerArg(tools, 'addStroke', layerId);
  const args = tool?.arguments || {};
  return Boolean(
    tool
    && numberNear(args.size, 6)
    && String(args.position || '').toLowerCase() === 'center'
    && numberNear(args.opacity, 100)
    && colorMatches(args.color, { r: 242, g: 201, b: 76 })
  );
}

function hasCorrectDropShadowArgs(tools, layerId) {
  const tool = findSuccessfulToolWithLayerArg(tools, 'addDropShadow', layerId);
  const args = tool?.arguments || {};
  return Boolean(
    tool
    && numberNear(args.opacity, 55)
    && numberNear(args.angle, 120)
    && numberNear(args.distance, 10)
    && numberNear(args.size, 14)
    && numberNear(args.spread, 0)
    && colorMatches(args.color, { r: 0, g: 0, b: 0 })
  );
}

async function main() {
  if (hasArg('--self-test')) {
    const sample = {
      success: true,
      mode: 'self-test',
      agent: { toolCount: 1, failedToolCount: 0, toolNames: ['setLayerOpacity'] },
      tools: [{ name: 'setLayerOpacity', arguments: { layerId: 2, opacity: 74 }, result: { success: true, layerId: 2 } }],
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
      mode: 'guarded-live-agent-photoshop-layer-effects',
      reason: 'Run with --live to allow a real model to call real Photoshop layer/effects tools against a disposable document.',
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

  const modelId = getArgValue('--model', process.env.DESIGNECHO_LIVE_AGENT_EFFECTS_MODEL || DEFAULT_MODEL_ID);
  const timeoutMs = Number(getArgValue('--timeout-ms', process.env.DESIGNECHO_LIVE_AGENT_EFFECTS_TIMEOUT_MS || DEFAULT_TIMEOUT_MS));
  const stamp = Date.now();
  const documentName = getArgValue('--document-name', `AgentLiveLayerEffects-${stamp}`);
  const outputPath = path.join(TMP_DIR, `agent-live-layer-effects-${stamp}.png`).replace(/\\/g, '/');
  const unexpectedPsdPath = outputPath.replace(/\.png$/i, '.psd');

  safeUnlink(outputPath);
  safeUnlink(unexpectedPsdPath);

  const blockers = [];
  let ollama = null;
  try {
    ollama = await ensureModelAvailable(modelId);
  } catch (error) {
    blockers.push(error?.message || String(error));
  }

  const tools = selectTools(TOOL_NAMES);
  const missingTools = TOOL_NAMES.filter((name) => !tools.some((tool) => tool.name === name));
  if (missingTools.length > 0) {
    blockers.push(`Agent tool schema missing: ${missingTools.join(', ')}`);
  }

  if (blockers.length > 0) {
    const blocked = {
      success: false,
      skipped: false,
      mode: 'blocked-live-agent-photoshop-layer-effects',
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
      mode: 'blocked-live-agent-photoshop-layer-effects',
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
      outputPath,
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
      if (step.kind === 'model_response' || step.kind === 'warning' || step.kind === 'stopped') {
        writePartial();
      }
    },
    onToolStart: (toolName) => console.log(`[agent-live-layer-effects:tool:start] ${toolName}`),
    onToolComplete: (toolName, result) => {
      console.log(`[agent-live-layer-effects:tool:${result?.success === false ? 'fail' : 'pass'}] ${toolName}`);
      liveTools.push({
        name: toolName,
        result: summarizeResult(result)
      });
      writePartial();
    }
  };

  const task = buildTask(documentName, outputPath);
  const agent = new Agent(
    {
      systemPrompt: [
        '你是一个谨慎的 Photoshop 工具 Agent。',
        '你必须根据用户目标自主选择工具；不要输出空泛计划后停止。',
        '决定处理画面时必须直接执行真实动作；不要只输出“准备执行”或说明文字来代替处理。',
        '这个任务必须真实调用工具；第一轮应直接创建临时文档。',
        '简单小工具任务不需要长篇规划说明，但每次写入都要有明确目标和复核方式。',
        '创建矩形后必须复用系统返回的已确认图层编号，不要猜测，也不要只依赖当前选区。',
        '写入不透明度、描边和投影后，必须读取图层证据。',
        '如果工具失败，停止掩盖并直接报告失败原因。'
      ].join('\n'),
      tools,
      modelId,
      maxIterations: 16,
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
  const shapeLayerId = findFirstSuccessfulLayerId(toolSummaries, 'createRectangle');
  const createdDocumentCount = toolSummaries.filter((entry) => entry.name === 'createDocument' && entry.result?.success !== false).length;
  const createdShapeCount = toolSummaries.filter((entry) => entry.name === 'createRectangle' && entry.result?.success !== false).length;
  const fileExists = fs.existsSync(outputPath);
  const unexpectedPsdExists = fs.existsSync(unexpectedPsdPath);
  const pngHeader = readPngHeader(outputPath);

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
    cleanup = openDocs.length > 0
      ? { success: closed.every((item) => item.success), closed }
      : null;
    const postCleanupList = await safeExecuteTool('listDocuments', { includeDetails: false });
    documentsAfterCleanup = Array.isArray(postCleanupList?.documents) ? postCleanupList.documents : [];
  } catch (error) {
    cleanup = { success: false, error: error?.message || String(error) };
    documentsAfterCleanup = documentsBeforeCleanup;
  }

  const requiredSignals = [
    { name: 'created-document', passed: hasSuccessfulTool(toolSummaries, 'createDocument') },
    { name: 'single-document-created', passed: createdDocumentCount === 1 },
    { name: 'created-shape', passed: hasSuccessfulTool(toolSummaries, 'createRectangle') && typeof shapeLayerId === 'number' },
    { name: 'single-shape-created', passed: createdShapeCount === 1 },
    { name: 'target-layer-selected-or-explicit', passed: hasMatchingLayerArg(toolSummaries, 'selectLayer', shapeLayerId) || hasMatchingLayerArg(toolSummaries, 'setLayerOpacity', shapeLayerId) },
    { name: 'opacity-written-to-shape', passed: hasMatchingLayerArg(toolSummaries, 'setLayerOpacity', shapeLayerId) },
    { name: 'opacity-arguments-correct', passed: hasCorrectOpacityArgs(toolSummaries, shapeLayerId) },
    { name: 'stroke-written-to-shape', passed: hasMatchingLayerArg(toolSummaries, 'addStroke', shapeLayerId) },
    { name: 'stroke-arguments-correct', passed: hasCorrectStrokeArgs(toolSummaries, shapeLayerId) },
    { name: 'drop-shadow-written-to-shape', passed: hasMatchingLayerArg(toolSummaries, 'addDropShadow', shapeLayerId) },
    { name: 'drop-shadow-arguments-correct', passed: hasCorrectDropShadowArgs(toolSummaries, shapeLayerId) },
    { name: 'readback-used', passed: hasSuccessfulTool(toolSummaries, 'getLayerProperties') || hasSuccessfulTool(toolSummaries, 'getLayerBounds') || hasSuccessfulTool(toolSummaries, 'getLayerHierarchy') || hasSuccessfulTool(toolSummaries, 'getAcceptanceSnapshot') },
    { name: 'exported-png', passed: fileExists && pngHeader === '89504e470d0a1a0a' && !unexpectedPsdExists },
    { name: 'document-not-left-open', passed: Array.isArray(documentsAfterCleanup) && !documentsAfterCleanup.some((doc) => String(doc?.name || '') === documentName) },
    { name: 'no-failed-tools', passed: failedTools.length === 0 }
  ];
  const success = requiredSignals.every((item) => item.passed);

  const report = {
    success,
    skipped: false,
    mode: 'live-agent-real-model-real-photoshop-layer-effects',
    modelId,
    ollama,
    documentName,
    shapeLayerId,
    createdDocumentCount,
    createdShapeCount,
    outputPath,
    unexpectedPsdPath,
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
    file: {
      exists: fileExists,
      pngHeader,
      size: fileExists ? fs.statSync(outputPath).size : 0,
      unexpectedPsdExists
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
      'The executable tool set is intentionally scoped to layer property/effects operations so failures are diagnosable.',
      'Photoshop writes happen against a disposable document and are verified by explicit layerId, readback, export, and cleanup evidence.',
      'Passing this runner proves this bounded Agent layer/effects task, not all Photoshop capabilities or open-ended design quality.'
    ]
  };

  writeReport(report);
  console.log(JSON.stringify({
    success: report.success,
    mode: report.mode,
    modelId,
    shapeLayerId,
    toolNames,
    failedTools: failedTools.map((item) => ({ name: item.name, error: item.result.error })),
    requiredSignals,
    file: report.file,
    document: report.document,
    report: report.report
  }, null, 2));

  if (!success) {
    process.exit(1);
  }
}

main().catch((error) => {
  const failed = {
    success: false,
    skipped: false,
    mode: 'live-agent-real-model-real-photoshop-layer-effects',
    generatedAt: new Date().toISOString(),
    error: error?.stack || error?.message || String(error),
    report: { json: REPORT_JSON, md: REPORT_MD },
    boundaries: ['Unhandled runner failure; no live success is claimed.']
  };
  writeReport(failed);
  console.error(failed.error);
  process.exit(1);
});
