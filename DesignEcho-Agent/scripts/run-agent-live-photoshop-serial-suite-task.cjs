#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TMP_DIR = path.join(ROOT, 'tmp');
const REPORT_JSON = path.join(TMP_DIR, 'agent-live-photoshop-serial-suite-task.json');
const REPORT_MD = path.join(TMP_DIR, 'agent-live-photoshop-serial-suite-task.md');
const DEFAULT_MODEL_ID = 'local-qwen2.5-7b';
const DEFAULT_TIMEOUT_MS = 240_000;

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

const REQUIRED_SERIAL_TOOLS = [
  'addGlow',
  'addGradientOverlay',
  'alignLayers',
  'clearLayerEffects',
  'convertToSmartObject',
  'createEllipse',
  'distributeLayers',
  'duplicateSmartObject',
  'exportGroup',
  'getAllTextLayers',
  'getCanvasSnapshot',
  'getSmartObjectInfo',
  'getSmartObjectLayers',
  'getTextContent',
  'getTextStyle',
  'groupLayers',
  'moveLayer',
  'placeImage',
  'quickScale',
  'reorderLayer',
  'replaceLayerContent',
  'saveDocument',
  'setBlendMode',
  'setLayerFill',
  'setTextContent',
  'setTextStyle',
  'smartSave',
  'transformLayer',
  'ungroupLayers'
];

const TOOL_NAMES = [
  'createDocument',
  'listDocuments',
  'closeDocument',
  'getDocumentInfo',
  'getLayerHierarchy',
  'getLayerBounds',
  'getLayerProperties',
  'getAcceptanceSnapshot',
  'createGroup',
  'createRectangle',
  'createEllipse',
  'createTextLayer',
  'selectLayer',
  'addGlow',
  'addGradientOverlay',
  'alignLayers',
  'clearLayerEffects',
  'convertToSmartObject',
  'distributeLayers',
  'duplicateSmartObject',
  'exportGroup',
  'getAllTextLayers',
  'getCanvasSnapshot',
  'getSmartObjectInfo',
  'getSmartObjectLayers',
  'getTextContent',
  'getTextStyle',
  'groupLayers',
  'moveLayer',
  'placeImage',
  'quickScale',
  'reorderLayer',
  'replaceLayerContent',
  'saveDocument',
  'setBlendMode',
  'setLayerFill',
  'setTextContent',
  'setTextStyle',
  'smartSave',
  'transformLayer',
  'ungroupLayers'
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

function writeFixturePng(filePath) {
  ensureDir(path.dirname(filePath));
  const base64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=';
  fs.writeFileSync(filePath, Buffer.from(base64, 'base64'));
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
    layerId: firstNumber(out.layerId, out.layer?.id, out.data?.layerId, out.data?.layer?.id, out.smartObjectLayerId),
    groupId: firstNumber(out.groupId, out.data?.groupId, out.layer?.id),
    outputPath: out.outputPath ?? out.savedPath ?? out.path ?? out.data?.outputPath ?? out.data?.savedPath,
    filePath: out.filePath,
    renamedCount: Array.isArray(out.renamedLayers) ? out.renamedLayers.length : undefined,
    textLayerCount: Array.isArray(out.textLayers) ? out.textLayers.length : undefined,
    snapshotPresent: Boolean(out.snapshot?.base64 || out.imageData),
    isSmartObject: out.isSmartObject ?? out.data?.isSmartObject,
    smartObjectLayerCount: Array.isArray(out.layers) ? out.layers.length : undefined,
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
    '# Agent Live Photoshop Serial Suite Task',
    '',
    `- success: ${report.success}`,
    `- skipped: ${Boolean(report.skipped)}`,
    `- mode: ${report.mode}`,
    `- modelId: ${report.modelId || ''}`,
    `- documentName: ${report.documentName || ''}`,
    `- fixturePath: ${report.fixturePath || ''}`,
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
    if (tool.arguments?.filePath) lines.push(`  argument.filePath: ${tool.arguments.filePath}`);
    if (tool.result.error) lines.push(`  error: ${tool.result.error}`);
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
    mode: 'live-agent-real-model-real-photoshop-serial-suite',
    generatedAt: new Date().toISOString(),
    modelId: input.modelId,
    documentName: input.documentName,
    fixturePath: input.fixturePath,
    agent: input.agent || {
      toolCount: input.tools.length,
      failedToolCount: input.tools.filter((tool) => tool.result?.success === false).length,
      toolNames: input.tools.map((tool) => tool.name)
    },
    tools: input.tools,
    events: input.events,
    report: { json: REPORT_JSON, md: REPORT_MD },
    boundaries: [
      'Partial report: the live serial suite runner failed or was interrupted before final assertions.',
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

function buildTask(input) {
  return [
    '这是一次真实 Photoshop 综合小工具串行验收，工具选择由你自己决定，不要使用固定脚本思路。',
    '这是明确 Photoshop 操作验收，不需要长篇规划说明；如果运行时需要说明，只给一句执行目的，然后继续执行真实动作。',
    '如果你已经判断下一步要处理画面，请直接执行真实动作；不要把操作清单或参数说明当作结果。',
    `请创建一个 900x640 的临时文档，名称必须是 ${input.documentName}。`,
    '创建矩形、椭圆和文字图层；文字内容先写 Agent Serial Suite。',
    '必须读取全部文字图层、文字内容和文字样式，然后把文字改为 Agent Serial Suite Updated，并把 fontSize 设置为 38。',
    '对形状图层调用 setLayerFill、setBlendMode、addGlow、addGradientOverlay，然后调用 clearLayerEffects 清除效果。清除前后都要用 getLayerProperties、getLayerBounds、getAcceptanceSnapshot 或 getLayerHierarchy 读回。',
    '必须完成移动图层、变换图层、快速缩放和调整图层顺序。涉及图层编号时必须使用系统返回或读回得到的已确认编号。',
    '必须用至少两个已确认图层编号完成对齐和分布。',
    '必须用已确认图层编号完成编组，然后导出这个组，再解组。',
    `必须置入图片，filePath 使用 ${input.fixturePath}，名称 Agent Fixture Image。`,
    `必须替换图层内容，filePath 使用 ${input.fixturePath}，图层编号使用置入图片返回或读回得到的已确认编号。`,
    '必须把真实图层转换为智能对象；然后读取智能对象信息、读取智能对象图层(autoOpen:false)、复制智能对象。',
    `必须保存导出 PNG 到 ${input.savePath}。`,
    `必须智能保存导出 PNG 到 ${input.smartSavePath}。`,
    '导出后关闭这个临时文档，不保存 PSD。',
    '最后请用事实反馈真实处理动作、成功/失败状态、导出路径、智能对象读回结果，以及是否需要人工复核。'
  ].join('\n');
}

async function cleanupStaleDisposableDocuments() {
  const list = await safeExecuteTool('listDocuments', { includeDetails: false });
  const documents = Array.isArray(list?.documents) ? list.documents : [];
  const stale = documents.filter((doc) => /^AgentLiveSerialSuite-\d+/.test(String(doc?.name || '')));
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

async function main() {
  if (hasArg('--self-test')) {
    const sample = {
      success: true,
      mode: 'self-test',
      agent: { toolCount: REQUIRED_SERIAL_TOOLS.length, failedToolCount: 0, toolNames: REQUIRED_SERIAL_TOOLS },
      tools: REQUIRED_SERIAL_TOOLS.map((name) => ({ name, arguments: {}, result: { success: true } })),
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
      mode: 'guarded-live-agent-photoshop-serial-suite',
      reason: 'Run with --live to allow a real model to call the broad serial Photoshop suite against a disposable document.',
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

  const modelId = getArgValue('--model', process.env.DESIGNECHO_LIVE_AGENT_SERIAL_SUITE_MODEL || DEFAULT_MODEL_ID);
  const timeoutMs = Number(getArgValue('--timeout-ms', process.env.DESIGNECHO_LIVE_AGENT_SERIAL_SUITE_TIMEOUT_MS || DEFAULT_TIMEOUT_MS));
  const stamp = Date.now();
  const documentName = getArgValue('--document-name', `AgentLiveSerialSuite-${stamp}`);
  const fixturePath = path.join(TMP_DIR, `agent-live-serial-fixture-${stamp}.png`).replace(/\\/g, '/');
  const groupExportPath = path.join(TMP_DIR, `agent-live-serial-group-${stamp}.png`).replace(/\\/g, '/');
  const savePath = path.join(TMP_DIR, `agent-live-serial-save-${stamp}.png`).replace(/\\/g, '/');
  const smartSavePath = path.join(TMP_DIR, `agent-live-serial-smart-save-${stamp}.png`).replace(/\\/g, '/');

  for (const filePath of [fixturePath, groupExportPath, savePath, smartSavePath]) safeUnlink(filePath);
  writeFixturePng(fixturePath);

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
      mode: 'blocked-live-agent-photoshop-serial-suite',
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
      mode: 'blocked-live-agent-photoshop-serial-suite',
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
      fixturePath,
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
    onToolStart: (toolName) => console.log(`[agent-live-serial-suite:tool:start] ${toolName}`),
    onToolComplete: (toolName, result) => {
      console.log(`[agent-live-serial-suite:tool:${result?.success === false ? 'fail' : 'pass'}] ${toolName}`);
      liveTools.push({ name: toolName, result: summarizeResult(result) });
      writePartial();
    }
  };

  const task = buildTask({ documentName, fixturePath, groupExportPath, savePath, smartSavePath });
  const agent = new Agent(
    {
      systemPrompt: [
        '你是一个谨慎的 Photoshop 综合操作验收 Agent。',
        '你必须根据用户目标自主选择工具；不要输出空泛计划后停止。',
        '决定处理画面时必须直接执行真实动作；不要只输出“准备执行”或说明文字来代替处理。',
        '这个任务必须真实调用工具；第一轮应直接创建临时文档。',
        '各步骤之间必须用真实返回值或读回证据传递已确认图层编号、图层组编号和文件路径，不要猜测。',
        '如果工具失败，停止掩盖并直接报告失败原因。'
      ].join('\n'),
      tools,
      modelId,
      maxIterations: 35,
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
        maxTokens: 2048,
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
    ...REQUIRED_SERIAL_TOOLS.map((toolName) => ({ name: `called-${toolName}`, passed: hasSuccessfulTool(toolSummaries, toolName) })),
    { name: 'fixture-exists', passed: fs.existsSync(fixturePath) && readPngHeader(fixturePath) === '89504e470d0a1a0a' },
    { name: 'group-exported-png', passed: fs.existsSync(groupExportPath) && readPngHeader(groupExportPath) === '89504e470d0a1a0a' },
    { name: 'saveDocument-exported-png', passed: fs.existsSync(savePath) && readPngHeader(savePath) === '89504e470d0a1a0a' },
    { name: 'smartSave-exported-png', passed: fs.existsSync(smartSavePath) && readPngHeader(smartSavePath) === '89504e470d0a1a0a' },
    { name: 'document-not-left-open', passed: Array.isArray(documentsAfterCleanup) && !documentsAfterCleanup.some((doc) => String(doc?.name || '') === documentName) },
    { name: 'no-failed-tools', passed: failedTools.length === 0 }
  ];
  const success = requiredSignals.every((item) => item.passed);

  const report = {
    success,
    skipped: false,
    mode: 'live-agent-real-model-real-photoshop-serial-suite',
    modelId,
    ollama,
    documentName,
    fixturePath,
    groupExportPath,
    savePath,
    smartSavePath,
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
      'The executable tool set intentionally covers the formerly scripted-live-only Photoshop tools in one bounded serial suite.',
      'Live mode uses disposable files and a disposable document; failures remain visible instead of being treated as coverage.',
      'Passing this runner proves this bounded serial suite, not arbitrary open-ended Photoshop design quality.'
    ]
  };

  writeReport(report);
  console.log(JSON.stringify({
    success: report.success,
    mode: report.mode,
    modelId,
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
    mode: 'live-agent-real-model-real-photoshop-serial-suite',
    generatedAt: new Date().toISOString(),
    error: error?.stack || error?.message || String(error),
    report: { json: REPORT_JSON, md: REPORT_MD },
    boundaries: ['Unhandled runner failure; no live success is claimed.']
  };
  writeReport(failed);
  console.error(failed.error);
  process.exit(1);
});
