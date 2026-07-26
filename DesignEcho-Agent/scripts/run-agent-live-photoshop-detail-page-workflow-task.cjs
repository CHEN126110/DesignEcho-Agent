#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TMP_DIR = path.join(ROOT, 'tmp');
const REPORT_JSON = path.join(TMP_DIR, 'agent-live-photoshop-detail-page-workflow-task.json');
const REPORT_MD = path.join(TMP_DIR, 'agent-live-photoshop-detail-page-workflow-task.md');
const DEFAULT_MODEL_ID = 'local-qwen2.5-7b';
const DEFAULT_TIMEOUT_MS = 180_000;
const CANVAS = { width: 750, height: 980 };
const LIVE_FLAG = 'DESIGNECHO_LIVE_AGENT_DETAIL_PAGE_WORKFLOW';
const DISPOSABLE_DOCUMENT_FLAG = 'DESIGNECHO_LIVE_AGENT_DETAIL_PAGE_WORKFLOW_DISPOSABLE_DOCUMENT';

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
  'getLayerHierarchy',
  'parseDetailPageTemplate',
  'fillDetailPage',
  'auditDetailPagePlacement',
  'fixLayerIssues',
  'exportDetailPageSlices'
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

function getMissingLiveAuthorization(env = process.env, args = process.argv) {
  const missing = [];
  if (!args.includes('--live')) missing.push('--live');
  if (env[LIVE_FLAG] !== '1') missing.push(`${LIVE_FLAG}=1`);
  if (env[DISPOSABLE_DOCUMENT_FLAG] !== '1') missing.push(`${DISPOSABLE_DOCUMENT_FLAG}=1`);
  return missing;
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

function summarizeFillResult(out) {
  if (!out || typeof out !== 'object') return {};
  return {
    copiesFilled: firstNumber(out.copiesFilled),
    imagesFilled: firstNumber(out.imagesFilled),
    placementCount: Array.isArray(out.placements) ? out.placements.length : undefined,
    errors: Array.isArray(out.errors) ? out.errors.map(compact) : undefined
  };
}

function summarizeResult(result) {
  if (Array.isArray(result)) {
    return {
      success: result.every((item) => item?.success !== false),
      itemCount: result.length,
      failedItemCount: result.filter((item) => item?.success === false).length
    };
  }

  const out = result && typeof result === 'object' ? result : {};
  const screens = Array.isArray(out.screens) ? out.screens : [];
  const issues = Array.isArray(out.issues) ? out.issues : [];
  const copyLayerIds = [];
  for (const screen of screens) {
    for (const copy of Array.isArray(screen?.copyPlaceholders) ? screen.copyPlaceholders : []) {
      if (typeof copy?.layerId === 'number') copyLayerIds.push(copy.layerId);
    }
  }

  return {
    success: out.success !== false,
    error: out.error ? compact(out.error) : undefined,
    message: out.message ? compact(out.message) : undefined,
    documentId: firstNumber(out.documentId, out.activeDocumentId, out.document?.id, out.data?.documentId),
    documentName: out.documentName ?? out.document?.name ?? out.name ?? undefined,
    layerId: firstNumber(out.layerId, out.layer?.id, out.groupId, out.data?.layerId, out.data?.layer?.id),
    groupId: firstNumber(out.groupId, out.data?.groupId, out.layer?.id),
    screenCount: firstNumber(out.screenCount) ?? screens.length,
    screenIds: screens.map((screen) => screen?.id).filter((id) => typeof id === 'number'),
    copyLayerIds,
    issueCount: issues.length,
    autoFixableIssueCount: issues.filter((issue) => issue?.autoFixable === true).length,
    auditCount: Array.isArray(out.audits) ? out.audits.length : undefined,
    warningCount: firstNumber(out.summary?.warningCount),
    outputDir: out.outputDir,
    exportSuccessCount: firstNumber(out.successCount),
    exportFailedCount: firstNumber(out.failedCount),
    ...summarizeFillResult(out)
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
    '# Agent Live Photoshop Detail Page Workflow Task',
    '',
    `- success: ${report.success}`,
    `- skipped: ${Boolean(report.skipped)}`,
    `- mode: ${report.mode}`,
    `- modelId: ${report.modelId || ''}`,
    `- documentName: ${report.documentName || ''}`,
    `- screenGroupId: ${report.screenGroupId ?? ''}`,
    `- outputDir: ${report.outputDir || ''}`,
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
    if (tool.arguments?.config?.outputDir) lines.push(`  argument.outputDir: ${tool.arguments.config.outputDir}`);
    if (tool.result.error) lines.push(`  error: ${tool.result.error}`);
    if (tool.result.screenCount !== undefined) lines.push(`  screenCount: ${tool.result.screenCount}`);
    if (tool.result.copiesFilled !== undefined) lines.push(`  copiesFilled: ${tool.result.copiesFilled}`);
    if (tool.result.outputDir) lines.push(`  outputDir: ${tool.result.outputDir}`);
    if (tool.result.exportSuccessCount !== undefined) lines.push(`  exportSuccessCount: ${tool.result.exportSuccessCount}`);
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
    mode: 'live-agent-real-model-real-photoshop-detail-page-workflow',
    generatedAt: new Date().toISOString(),
    modelId: input.modelId,
    documentName: input.documentName,
    outputDir: input.outputDir,
    agent: input.agent || {
      toolCount: input.tools.length,
      failedToolCount: input.tools.filter((tool) => tool.result?.success === false).length,
      toolNames: input.tools.map((tool) => tool.name)
    },
    tools: input.tools,
    events: input.events,
    report: { json: REPORT_JSON, md: REPORT_MD },
    boundaries: [
      'Partial report: the live detail-page workflow runner failed or was interrupted before final assertions.',
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

function buildTask(documentName, outputDir) {
  return [
    '这是一次真实 Photoshop 详情页模板工作流验收，工具选择由你自己决定，不要使用固定脚本思路。',
    '这是详情页工作流验收，不需要长篇规划说明；如果运行时需要说明，只给一句执行目的，然后继续执行真实动作。',
    '如果你已经判断下一步要处理画面，请直接执行真实动作；不要把操作清单或参数说明当作结果。',
    `请创建一个 ${CANVAS.width}x${CANVAS.height} 的临时详情页文档，名称必须是 ${documentName}。`,
    '创建一个顶层图层组，名称必须是 01 首屏。这个组就是详情页 screen。',
    '创建一个矩形形状图层，名称必须是 Agent Detail Image Placeholder，位置 x: 80, y: 220, width: 590, height: 360，填充色 #D7E5EA。',
    '创建一个文字图层，内容必须是 Detail Placeholder Title，名称必须是 Agent Detail Copy Placeholder，位置 x: 96, y: 118，字号 42。',
    '把矩形和文字图层都移动到 01 首屏 组中，必须使用系统确认的图层编号和图层组编号。',
    '解析详情页模板时 includeStructure 必须为 true，并使用解析结果返回的 screens 和 copyPlaceholders，不要手造首屏编号或文字图层编号。',
    '用模板解析结果里的第一个 screen 和第一个 copyPlaceholder 构造详情页填充计划：只填文案，images 传空数组，content 必须是 Agent Filled Detail Copy，source 为 user_input，confidence 0.99，needsReview false。',
    '填充详情页后，用模板解析结果里的 screens 和填充返回的 placements 或 [] 复核详情页摆放。',
    '修复图层问题时，issues 使用模板解析结果里 autoFixable 为 true 的项目；如果没有可修复问题，传 []，不要伪造问题。',
    `导出详情页切片时，screens 使用模板解析结果返回的 screens，config.outputDir 必须是 ${outputDir}，format: jpeg，quality: 10，namingPattern: agent-detail-{index}，createSubfolder: false。`,
    '导出后关闭这个临时文档，不保存 PSD。',
    '最后请用事实反馈真实处理动作、成功/失败状态、填充数量、审计摘要、修复数量、导出目录，以及是否需要人工复核。'
  ].join('\n');
}

async function cleanupStaleDisposableDocuments() {
  const list = await safeExecuteTool('listDocuments', { includeDetails: false });
  const documents = Array.isArray(list?.documents) ? list.documents : [];
  const stale = documents.filter((doc) => /^AgentLiveDetailPage详情页-\d+/.test(String(doc?.name || '')));
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

function parsedEvidence(tools) {
  const parse = firstSuccessfulTool(tools, 'parseDetailPageTemplate');
  return {
    screenIds: Array.isArray(parse?.result?.screenIds) ? parse.result.screenIds : [],
    copyLayerIds: Array.isArray(parse?.result?.copyLayerIds) ? parse.result.copyLayerIds : [],
    screenCount: Number(parse?.result?.screenCount || 0),
    autoFixableIssueCount: Number(parse?.result?.autoFixableIssueCount || 0)
  };
}

function findFillDetailPageWithParsedScreen(tools, evidence) {
  return tools.find((tool) => {
    if (tool.name !== 'fillDetailPage' || tool.result?.success === false) return false;
    const plan = tool.arguments?.plan || (Array.isArray(tool.arguments?.plans) ? tool.arguments.plans[0] : null);
    if (!plan || typeof plan !== 'object') return false;
    const copies = Array.isArray(plan.copies) ? plan.copies : [];
    return evidence.screenIds.includes(Number(plan.screenId))
      && copies.some((copy) => evidence.copyLayerIds.includes(Number(copy?.layerId)))
      && copies.some((copy) => String(copy?.content || '') === 'Agent Filled Detail Copy');
  });
}

function findToolWithScreensArg(tools, toolName, evidence) {
  return tools.find((tool) => {
    if (tool.name !== toolName || tool.result?.success === false) return false;
    const screens = tool.arguments?.screens;
    if (!Array.isArray(screens) || screens.length === 0) return false;
    return screens.some((screen) => evidence.screenIds.includes(Number(screen?.id)));
  });
}

function findExportWithOutputDir(tools, outputDir, evidence) {
  const exportTool = findToolWithScreensArg(tools, 'exportDetailPageSlices', evidence);
  return exportTool && String(exportTool.arguments?.config?.outputDir || '').replace(/\\/g, '/') === outputDir;
}

async function main() {
  if (hasArg('--self-test')) {
    const missingWithoutAuthorization = getMissingLiveAuthorization({}, ['node', __filename]);
    const missingWithAuthorization = getMissingLiveAuthorization({
      [LIVE_FLAG]: '1',
      [DISPOSABLE_DOCUMENT_FLAG]: '1'
    }, ['node', __filename, '--live']);
    if (missingWithoutAuthorization.length !== 3 || missingWithAuthorization.length !== 0) {
      throw new Error('live authorization gate self-test failed.');
    }
    const sample = {
      success: true,
      mode: 'self-test',
      agent: { toolCount: 2, failedToolCount: 0, toolNames: ['parseDetailPageTemplate', 'fillDetailPage'] },
      tools: [
        { name: 'parseDetailPageTemplate', arguments: { includeStructure: true }, result: { success: true, screenCount: 1, screenIds: [4], copyLayerIds: [6] } },
        { name: 'fillDetailPage', arguments: { plan: { screenId: 4, copies: [{ layerId: 6, content: 'Agent Filled Detail Copy' }], images: [] } }, result: { success: true, copiesFilled: 1 } }
      ],
      requiredSignals: [{ name: 'self-test-contract', passed: true }],
      boundaries: ['self-test does not touch Photoshop or models']
    };
    writeReport(sample);
    console.log(JSON.stringify({ success: true, report: { json: REPORT_JSON, md: REPORT_MD } }, null, 2));
    return;
  }

  const missingLiveAuthorization = getMissingLiveAuthorization();
  if (missingLiveAuthorization.length > 0) {
    const skipped = {
      success: true,
      skipped: true,
      mode: 'guarded-live-agent-photoshop-detail-page-workflow',
      reason: 'Live execution requires the CLI gate plus separate task and disposable-document authorization.',
      missingAuthorization: missingLiveAuthorization,
      requiredAuthorization: [
        '--live',
        `${LIVE_FLAG}=1`,
        `${DISPOSABLE_DOCUMENT_FLAG}=1`
      ],
      report: { json: REPORT_JSON, md: REPORT_MD },
      boundaries: [
        'Default execution does not touch a live model or Photoshop.',
        'Live mode uses a disposable document and still reports failures honestly.',
        'A CLI flag alone cannot authorize Photoshop writes.'
      ]
    };
    writeReport(skipped);
    console.log(JSON.stringify(skipped, null, 2));
    return;
  }

  const modelId = getArgValue('--model', process.env.DESIGNECHO_LIVE_AGENT_DETAIL_PAGE_WORKFLOW_MODEL || DEFAULT_MODEL_ID);
  const timeoutMs = Number(getArgValue('--timeout-ms', process.env.DESIGNECHO_LIVE_AGENT_DETAIL_PAGE_WORKFLOW_TIMEOUT_MS || DEFAULT_TIMEOUT_MS));
  const stamp = Date.now();
  const documentName = getArgValue('--document-name', `AgentLiveDetailPage详情页-${stamp}`);
  const outputDir = path.join(TMP_DIR, `agent-live-detail-page-slices-${stamp}`).replace(/\\/g, '/');

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
      mode: 'blocked-live-agent-photoshop-detail-page-workflow',
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
      mode: 'blocked-live-agent-photoshop-detail-page-workflow',
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
      outputDir,
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
    onToolStart: (toolName) => console.log(`[agent-live-detail-page-workflow:tool:start] ${toolName}`),
    onToolComplete: (toolName, result) => {
      console.log(`[agent-live-detail-page-workflow:tool:${result?.success === false ? 'fail' : 'pass'}] ${toolName}`);
      liveTools.push({ name: toolName, result: summarizeResult(result) });
      writePartial();
    }
  };

  const task = buildTask(documentName, outputDir);
  const agent = new Agent(
    {
      systemPrompt: [
        '你是一个谨慎的 Photoshop 详情页模板工作流 Agent。',
        '你必须根据用户目标自主选择工具；不要输出空泛计划后停止。',
        '决定处理画面时必须直接执行真实动作；不要只输出“准备执行”或说明文字来代替处理。',
        '这个任务必须真实调用工具；第一轮应直接创建临时详情页文档。',
        '详情页处理必须使用模板解析返回的真实 screens、copyPlaceholders 和 issues。',
        '填充详情页不允许猜首屏编号或文字图层编号；导出切片不允许手造 screens。',
        '如果工具失败，停止掩盖并直接报告失败原因。'
      ].join('\n'),
      tools,
      modelId,
      maxIterations: 22,
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
  const screenGroupId = findGroupId(toolSummaries);
  const shapeLayerId = findLayerIdByTool(toolSummaries, 'createRectangle');
  const textLayerId = findLayerIdByTool(toolSummaries, 'createTextLayer');
  const evidence = parsedEvidence(toolSummaries);

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

  const exportedFiles = fs.existsSync(outputDir)
    ? fs.readdirSync(outputDir).filter((name) => /\.(jpe?g|png)$/i.test(name))
    : [];

  const requiredSignals = [
    { name: 'created-document', passed: hasSuccessfulTool(toolSummaries, 'createDocument') },
    { name: 'created-screen-group', passed: typeof screenGroupId === 'number' },
    { name: 'created-shape-placeholder', passed: typeof shapeLayerId === 'number' },
    { name: 'created-copy-placeholder', passed: typeof textLayerId === 'number' },
    { name: 'moved-shape-into-screen-group', passed: Boolean(findToolWithGroupArgs(toolSummaries, shapeLayerId, screenGroupId)) },
    { name: 'moved-copy-into-screen-group', passed: Boolean(findToolWithGroupArgs(toolSummaries, textLayerId, screenGroupId)) },
    { name: 'parsed-template-with-screen', passed: evidence.screenCount > 0 && evidence.screenIds.length > 0 },
    { name: 'parsed-copy-placeholder', passed: evidence.copyLayerIds.length > 0 },
    { name: 'fill-used-parsed-screen-and-copy-layer', passed: Boolean(findFillDetailPageWithParsedScreen(toolSummaries, evidence)) },
    { name: 'audit-used-parsed-screens', passed: Boolean(findToolWithScreensArg(toolSummaries, 'auditDetailPagePlacement', evidence)) },
    { name: 'fixLayerIssues-called-with-issues-array', passed: hasSuccessfulTool(toolSummaries, 'fixLayerIssues') && Array.isArray(firstSuccessfulTool(toolSummaries, 'fixLayerIssues')?.arguments?.issues) },
    { name: 'export-used-parsed-screens-and-output-dir', passed: Boolean(findExportWithOutputDir(toolSummaries, outputDir, evidence)) },
    { name: 'export-produced-or-reported-success', passed: exportedFiles.length > 0 || firstSuccessfulTool(toolSummaries, 'exportDetailPageSlices')?.result?.exportSuccessCount > 0 },
    { name: 'document-not-left-open', passed: Array.isArray(documentsAfterCleanup) && !documentsAfterCleanup.some((doc) => String(doc?.name || '') === documentName) },
    { name: 'no-failed-tools', passed: failedTools.length === 0 }
  ];
  const success = requiredSignals.every((item) => item.passed);

  const report = {
    success,
    skipped: false,
    mode: 'live-agent-real-model-real-photoshop-detail-page-workflow',
    modelId,
    ollama,
    documentName,
    outputDir,
    screenGroupId,
    shapeLayerId,
    textLayerId,
    parsedEvidence: evidence,
    exportedFiles,
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
      'The executable tool set is scoped to a minimal disposable detail-page workflow so parse/fill/export mistakes are diagnosable.',
      'fillDetailPage, auditDetailPagePlacement, fixLayerIssues, and exportDetailPageSlices must consume parseDetailPageTemplate evidence.',
      'Passing this runner proves this bounded Agent detail-page workflow, not full creative detail-page quality.'
    ]
  };

  writeReport(report);
  console.log(JSON.stringify({
    success: report.success,
    mode: report.mode,
    modelId,
    screenGroupId,
    shapeLayerId,
    textLayerId,
    parsedEvidence: evidence,
    exportedFiles,
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
    mode: 'live-agent-real-model-real-photoshop-detail-page-workflow',
    generatedAt: new Date().toISOString(),
    error: error?.stack || error?.message || String(error),
    report: { json: REPORT_JSON, md: REPORT_MD },
    boundaries: ['Unhandled runner failure; no live success is claimed.']
  };
  writeReport(failed);
  console.error(failed.error);
  process.exit(1);
});
