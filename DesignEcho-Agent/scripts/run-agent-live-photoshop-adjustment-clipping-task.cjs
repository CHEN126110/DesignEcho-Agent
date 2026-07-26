#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TMP_DIR = path.join(ROOT, 'tmp');
const REPORT_JSON = path.join(TMP_DIR, 'agent-live-photoshop-adjustment-clipping-task.json');
const REPORT_MD = path.join(TMP_DIR, 'agent-live-photoshop-adjustment-clipping-task.md');
const DEFAULT_MODEL_ID = 'local-qwen2.5-7b';
const DEFAULT_TIMEOUT_MS = 180_000;

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
  'getLayerHierarchy',
  'getLayerBounds',
  'getLayerProperties',
  'getAcceptanceSnapshot',
  'getClippingMaskInfo',
  'getAllClippingMasks',
  'createRectangle',
  'selectLayer',
  'addBrightnessContrastAdjustment',
  'addHueSaturationAdjustment',
  'addLevelsAdjustment',
  'addColorBalanceAdjustment',
  'addVibranceAdjustment',
  'addPhotoFilterAdjustment',
  'createClippingMask',
  'releaseClippingMask',
  'quickExport'
];

const REQUIRED_ADJUSTMENTS = [
  'addBrightnessContrastAdjustment',
  'addHueSaturationAdjustment',
  'addLevelsAdjustment',
  'addColorBalanceAdjustment',
  'addVibranceAdjustment',
  'addPhotoFilterAdjustment'
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
    layerId: firstNumber(
      out.layerId,
      out.layer?.id,
      out.data?.layerId,
      out.data?.layer?.id,
      out.clippedLayer?.id,
      out.releasedLayer?.id
    ),
    baseLayerId: firstNumber(out.baseLayer?.id, out.data?.baseLayer?.id),
    outputPath: out.outputPath ?? out.savedPath ?? out.data?.outputPath ?? out.data?.savedPath ?? undefined,
    adjustmentType: out.adjustmentType ?? out.data?.adjustmentType,
    entityType: out.entityType ?? out.data?.entityType,
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
    '# Agent Live Photoshop Adjustment And Clipping Task',
    '',
    `- success: ${report.success}`,
    `- skipped: ${Boolean(report.skipped)}`,
    `- mode: ${report.mode}`,
    `- modelId: ${report.modelId || ''}`,
    `- documentName: ${report.documentName || ''}`,
    `- baseLayerId: ${report.baseLayerId ?? ''}`,
    `- clippingLayerId: ${report.clippingLayerId ?? ''}`,
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
    if (args.name !== undefined) lines.push(`  argument.name: ${args.name}`);
    if (tool.result.error) lines.push(`  error: ${tool.result.error}`);
    if (tool.result.layerId !== undefined) lines.push(`  result.layerId: ${tool.result.layerId}`);
    if (tool.result.adjustmentType) lines.push(`  adjustmentType: ${tool.result.adjustmentType}`);
    if (tool.result.outputPath) lines.push(`  outputPath: ${tool.result.outputPath}`);
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
    mode: 'live-agent-real-model-real-photoshop-adjustment-clipping',
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
      'Partial report: the live adjustment/clipping runner failed or was interrupted before final assertions.',
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

function buildTask(documentName, outputPath) {
  return [
    '这是一次真实 Photoshop 调整图层和剪切关系小操作验收，处理方式由你自己决定，不要只解释计划。',
    '这是明确的小操作任务，不需要长篇规划说明；你只需要说明下一步、执行真实动作，并用读回证据复核。',
    '如果你已经判断下一步要处理画面，请直接执行真实动作；不要把操作清单或参数说明当作结果。',
    `请创建一个 620x420 的临时文档，名称必须是 ${documentName}。`,
    '创建一个矩形形状图层，名称必须是 Agent Clip Base，位置在画布中间，填充色为 #6A8D73，作为剪切蒙版基底。',
    '依次创建 6 个非破坏性调整图层，名称必须分别包含 Agent BC、Agent HueSat、Agent Levels、Agent ColorBalance、Agent Vibrance、Agent PhotoFilter。',
    '必须创建亮度/对比度调整层，brightness: 12，contrast: 18。',
    '必须创建色相/饱和度调整层，hue: 0，saturation: 14，lightness: 0。',
    '必须创建色阶调整层，inputBlack: 4，inputWhite: 246，gamma: 1.08，outputBlack: 0，outputWhite: 255。',
    '必须创建色彩平衡调整层，shadows: [0, 0, 0]，midtones: [6, -3, -4]，highlights: [4, 0, -6]，preserveLuminosity: true。',
    '必须创建自然饱和度调整层，vibrance: 22，saturation: 6。',
    '必须创建照片滤镜调整层，colorHex: #EC8A00，density: 12，preserveLuminosity: true。',
    '使用创建亮度/对比度调整层后系统返回的已确认编号来创建剪切关系，让 Agent BC 剪切到下方基底图层；不要换成 Agent HueSat 或后续调整层。',
    '创建剪切关系后，必须读取这个剪切关系本身，并读取全局剪切关系证据。',
    '然后用同一个 Agent BC 已确认编号释放剪切关系，并再次读取剪切关系、图层结构或验收快照复核。',
    `请导出 PNG 到完整路径：${outputPath}。`,
    '导出后关闭这个临时文档，不保存 PSD。',
    '最后请用事实反馈真实处理动作、成功/失败状态、导出路径，以及是否需要人工复核。'
  ].join('\n');
}

async function cleanupStaleDisposableDocuments() {
  const list = await safeExecuteTool('listDocuments', { includeDetails: false });
  const documents = Array.isArray(list?.documents) ? list.documents : [];
  const stale = documents.filter((doc) => /^AgentLiveAdjustmentClipping-\d+/.test(String(doc?.name || '')));
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

function findToolWithLayerArg(tools, toolName, layerId) {
  return tools.find((tool) => (
    tool.name === toolName
    && tool.result?.success !== false
    && typeof layerId === 'number'
    && Number(tool.arguments?.layerId) === layerId
  ));
}

async function main() {
  if (hasArg('--self-test')) {
    const sample = {
      success: true,
      mode: 'self-test',
      agent: { toolCount: 1, failedToolCount: 0, toolNames: ['addBrightnessContrastAdjustment'] },
      tools: [{ name: 'addBrightnessContrastAdjustment', arguments: { brightness: 12, contrast: 18, name: 'Agent BC' }, result: { success: true, layerId: 3 } }],
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
      mode: 'guarded-live-agent-photoshop-adjustment-clipping',
      reason: 'Run with --live to allow a real model to call real Photoshop adjustment/clipping tools against a disposable document.',
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

  const modelId = getArgValue('--model', process.env.DESIGNECHO_LIVE_AGENT_ADJUSTMENT_CLIPPING_MODEL || DEFAULT_MODEL_ID);
  const timeoutMs = Number(getArgValue('--timeout-ms', process.env.DESIGNECHO_LIVE_AGENT_ADJUSTMENT_CLIPPING_TIMEOUT_MS || DEFAULT_TIMEOUT_MS));
  const stamp = Date.now();
  const documentName = getArgValue('--document-name', `AgentLiveAdjustmentClipping-${stamp}`);
  const outputPath = path.join(TMP_DIR, `agent-live-adjustment-clipping-${stamp}.png`).replace(/\\/g, '/');
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
  if (missingTools.length > 0) blockers.push(`Agent tool schema missing: ${missingTools.join(', ')}`);

  if (blockers.length > 0) {
    const blocked = {
      success: false,
      skipped: false,
      mode: 'blocked-live-agent-photoshop-adjustment-clipping',
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
      mode: 'blocked-live-agent-photoshop-adjustment-clipping',
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
      if (step.kind === 'model_response' || step.kind === 'warning' || step.kind === 'stopped') writePartial();
    },
    onToolStart: (toolName) => console.log(`[agent-live-adjustment-clipping:tool:start] ${toolName}`),
    onToolComplete: (toolName, result) => {
      console.log(`[agent-live-adjustment-clipping:tool:${result?.success === false ? 'fail' : 'pass'}] ${toolName}`);
      liveTools.push({ name: toolName, result: summarizeResult(result) });
      writePartial();
    }
  };

  const task = buildTask(documentName, outputPath);
  const agent = new Agent(
    {
      systemPrompt: [
        '你是一个谨慎的 Photoshop 调整图层和剪切蒙版工具 Agent。',
        '你必须根据用户目标自主选择工具；不要输出空泛计划后停止。',
        '决定处理画面时必须直接执行真实动作；不要只输出“准备执行”或说明文字来代替处理。',
        '这个任务必须真实调用工具；第一轮应直接创建临时文档。',
        '明确的小工具任务不需要长篇规划说明，但每次写入都要有明确目标和复核方式。',
        '创建剪切关系和释放剪切关系时必须复用任务指定调整层返回或读回得到的已确认编号。',
        '不要猜测编号，不要把背景层或其他调整层当作目标图层。',
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
  const baseLayerId = findLayerIdByTool(toolSummaries, 'createRectangle');
  const clippingLayerId = findLayerIdByTool(toolSummaries, 'addBrightnessContrastAdjustment');
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
    cleanup = openDocs.length > 0 ? { success: closed.every((item) => item.success), closed } : null;
    const postCleanupList = await safeExecuteTool('listDocuments', { includeDetails: false });
    documentsAfterCleanup = Array.isArray(postCleanupList?.documents) ? postCleanupList.documents : [];
  } catch (error) {
    cleanup = { success: false, error: error?.message || String(error) };
    documentsAfterCleanup = documentsBeforeCleanup;
  }

  const requiredSignals = [
    { name: 'created-document', passed: hasSuccessfulTool(toolSummaries, 'createDocument') },
    { name: 'created-base-shape', passed: typeof baseLayerId === 'number' },
    ...REQUIRED_ADJUSTMENTS.map((toolName) => ({ name: `created-${toolName}`, passed: hasSuccessfulTool(toolSummaries, toolName) })),
    { name: 'clipping-layer-id-known', passed: typeof clippingLayerId === 'number' },
    { name: 'created-clipping-mask-with-real-layer-id', passed: Boolean(findToolWithLayerArg(toolSummaries, 'createClippingMask', clippingLayerId)) },
    { name: 'read-clipping-mask-info-with-real-layer-id', passed: Boolean(findToolWithLayerArg(toolSummaries, 'getClippingMaskInfo', clippingLayerId)) },
    { name: 'read-all-clipping-masks', passed: hasSuccessfulTool(toolSummaries, 'getAllClippingMasks') },
    { name: 'released-clipping-mask-with-real-layer-id', passed: Boolean(findToolWithLayerArg(toolSummaries, 'releaseClippingMask', clippingLayerId)) },
    { name: 'readback-used', passed: hasSuccessfulTool(toolSummaries, 'getLayerHierarchy') || hasSuccessfulTool(toolSummaries, 'getLayerProperties') || hasSuccessfulTool(toolSummaries, 'getLayerBounds') || hasSuccessfulTool(toolSummaries, 'getAcceptanceSnapshot') },
    { name: 'exported-png', passed: fileExists && pngHeader === '89504e470d0a1a0a' && !unexpectedPsdExists },
    { name: 'document-not-left-open', passed: Array.isArray(documentsAfterCleanup) && !documentsAfterCleanup.some((doc) => String(doc?.name || '') === documentName) },
    { name: 'no-failed-tools', passed: failedTools.length === 0 }
  ];
  const success = requiredSignals.every((item) => item.passed);

  const report = {
    success,
    skipped: false,
    mode: 'live-agent-real-model-real-photoshop-adjustment-clipping',
    modelId,
    ollama,
    documentName,
    baseLayerId,
    clippingLayerId,
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
      'The executable tool set is scoped to adjustment-layer and clipping-mask operations so layerId mistakes are diagnosable.',
      'Photoshop writes happen against a disposable document and are verified by explicit ids, clipping readback, export, and cleanup evidence.',
      'Passing this runner proves this bounded Agent adjustment/clipping task, not all Photoshop capabilities or open-ended design quality.'
    ]
  };

  writeReport(report);
  console.log(JSON.stringify({
    success: report.success,
    mode: report.mode,
    modelId,
    baseLayerId,
    clippingLayerId,
    toolNames,
    failedTools: failedTools.map((item) => ({ name: item.name, error: item.result.error })),
    requiredSignals,
    file: report.file,
    document: report.document,
    report: report.report
  }, null, 2));

  if (!success) process.exit(1);
}

main().catch((error) => {
  const failed = {
    success: false,
    skipped: false,
    mode: 'live-agent-real-model-real-photoshop-adjustment-clipping',
    generatedAt: new Date().toISOString(),
    error: error?.stack || error?.message || String(error),
    report: { json: REPORT_JSON, md: REPORT_MD },
    boundaries: ['Unhandled runner failure; no live success is claimed.']
  };
  writeReport(failed);
  console.error(failed.error);
  process.exit(1);
});
