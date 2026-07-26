#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TMP_DIR = path.join(ROOT, 'tmp');
const REPORT_JSON = path.join(TMP_DIR, 'agent-live-photoshop-layer-management-task.json');
const REPORT_MD = path.join(TMP_DIR, 'agent-live-photoshop-layer-management-task.md');
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
  'switchDocument',
  'closeDocument',
  'getDocumentInfo',
  'getLayerHierarchy',
  'getLayerBounds',
  'getLayerProperties',
  'getAcceptanceSnapshot',
  'createGroup',
  'createRectangle',
  'createTextLayer',
  'selectLayer',
  'focusLayer',
  'renameLayer',
  'duplicateLayer',
  'deleteLayer',
  'moveLayerToGroup',
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
    layerId: firstNumber(out.layerId, out.newLayerId, out.layer?.id, out.data?.layerId, out.data?.newLayerId, out.data?.layer?.id),
    groupId: firstNumber(out.groupId, out.group?.id, out.data?.groupId, out.data?.group?.id, out.layerId),
    outputPath: out.outputPath ?? out.savedPath ?? out.data?.outputPath ?? out.data?.savedPath ?? undefined,
    format: out.format ?? out.data?.format,
    layerNames: Array.isArray(out.layers)
      ? out.layers.map((layer) => String(layer?.name || '')).filter(Boolean)
      : undefined,
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

function renderReportDocument(report) {
  const lines = [
    '# Agent Live Photoshop Layer Management Task',
    '',
    `- success: ${report.success}`,
    `- skipped: ${Boolean(report.skipped)}`,
    `- mode: ${report.mode}`,
    `- modelId: ${report.modelId || ''}`,
    `- documentName: ${report.documentName || ''}`,
    `- shapeLayerId: ${report.shapeLayerId ?? ''}`,
    `- groupId: ${report.groupId ?? ''}`,
    `- duplicateLayerId: ${report.duplicateLayerId ?? ''}`,
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
    if (args.targetGroupId !== undefined) lines.push(`  argument.targetGroupId: ${args.targetGroupId}`);
    if (args.documentName !== undefined) lines.push(`  argument.documentName: ${args.documentName}`);
    if (tool.result.error) lines.push(`  error: ${tool.result.error}`);
    if (tool.result.layerId !== undefined) lines.push(`  result.layerId: ${tool.result.layerId}`);
    if (tool.result.groupId !== undefined) lines.push(`  result.groupId: ${tool.result.groupId}`);
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
  fs.writeFileSync(REPORT_MD, renderReportDocument(report), 'utf8');
}

function buildPartialReport(input) {
  return {
    success: false,
    partial: true,
    skipped: false,
    mode: 'live-agent-real-model-real-photoshop-layer-management',
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
      'Partial report: the live layer-management runner failed or was interrupted before final assertions.',
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

async function cleanupStaleDisposableDocuments() {
  const list = await safeExecuteTool('listDocuments', { includeDetails: false });
  const documents = Array.isArray(list?.documents) ? list.documents : [];
  const stale = documents.filter((doc) => /^AgentLiveLayerManagement-\d+/.test(String(doc?.name || '')));
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

function lastSuccessfulTool(tools, toolName) {
  return [...tools].reverse().find((tool) => tool.name === toolName && tool.result?.success !== false);
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

function findSwitchToDocument(tools, documentName) {
  return tools.find((tool) => (
    tool.name === 'switchDocument'
    && tool.result?.success !== false
    && String(tool.arguments?.documentName || '') === documentName
  ));
}

function buildLayerManagementStages(input) {
  const {
    documentName,
    outputPath,
    groupId,
    shapeLayerId,
    textLayerId,
    duplicateLayerId
  } = input;

  const evidenceLines = [
    groupId !== undefined ? `- 已确认图层组 Agent Managed Group 的 groupId 是 ${groupId}。` : '',
    shapeLayerId !== undefined ? `- 已确认矩形图层的 layerId 是 ${shapeLayerId}。` : '',
    textLayerId !== undefined ? `- 已确认原始文字图层 Temporary Duplicate Source 的 layerId 是 ${textLayerId}。` : '',
    duplicateLayerId !== undefined ? `- 已确认复制图层 Agent Duplicate To Delete 的 layerId 是 ${duplicateLayerId}。` : ''
  ].filter(Boolean);
  const evidenceBlock = evidenceLines.length
    ? ['当前已读回证据：', ...evidenceLines].join('\n')
    : '当前还没有已确认的图层 id，必须先创建并读回。';

  return [
    {
      stageId: 'setup-document-and-layers',
      title: '创建临时文档、图层组、矩形、文字并读回',
      maxIterations: 7,
      maxDesignRetryRounds: 1,
      requiredToolNames: [
        'switchDocument',
        'createGroup',
        'createRectangle',
        'createTextLayer',
        'getLayerHierarchy'
      ],
      retryGuidance: '还需要把临时文档、图层组、矩形图层、文字图层和读回证据补完整。',
      toolNames: [
        'createDocument',
        'listDocuments',
        'switchDocument',
        'createGroup',
        'createRectangle',
        'createTextLayer',
        'getLayerHierarchy',
        'getLayerProperties'
      ],
      task: [
        '创建一份可验证的临时图层结构。',
        '这是简单图层管理操作，不需要长篇说明；请直接在 Photoshop 中完成当前步骤。',
        `创建一个 640x420 的临时文档，名称必须是 ${documentName}。`,
        `创建后查看打开的文档，并切换到名称为 ${documentName} 的文档。`,
        '先创建一个矩形形状图层，名称必须是 Agent Raw Rectangle，填充色为 #4F8A8B。',
        '再创建一个文字图层，内容必须是 Temporary Duplicate Source。',
        '最后创建一个空图层组，名称必须是 Agent Managed Group；不要把创建组当作移动矩形。',
        '最后读回图层结构或图层属性，确认图层组、矩形图层和文字图层都已存在。',
        '上述创建和读回只做一轮；一旦已经创建成功，不要重新创建文档，不要重复创建图层组、矩形或文字。',
        '不要执行重命名、移动、复制、删除、聚焦或导出，那些属于后续阶段。'
      ].join('\n')
    },
    {
      stageId: 'rename-and-group-shape',
      title: '重命名矩形并移动到图层组',
      maxIterations: 6,
      maxDesignRetryRounds: 1,
      requiredToolNames: ['switchDocument', 'renameLayer', 'moveLayerToGroup'],
      toolNames: [
        'renameLayer',
        'moveLayerToGroup',
        'getLayerHierarchy',
        'getLayerProperties',
        'switchDocument'
      ],
      retryGuidance: '还需要确认矩形图层已经改名，并且已经放入目标图层组。',
      task: [
        '只处理矩形图层的改名和入组。',
        evidenceBlock,
        `本阶段开始先把 Photoshop 切回名称为 ${documentName} 的临时文档，后续所有 layerId 和 groupId 都只针对这份文档。`,
        '请优先完成两个实际操作：把矩形图层改名，然后把它放入目标图层组；不要把操作清单当作结果。',
        `把系统已确认编号为 ${shapeLayerId ?? '<shapeLayerId>'} 的矩形图层改名为 Agent Renamed Rectangle。`,
        `把系统已确认编号为 ${shapeLayerId ?? '<shapeLayerId>'} 的矩形图层移动到编号为 ${groupId ?? '<groupId>'} 的 Agent Managed Group 里面。`,
        '同一阶段必须读回图层结构或图层属性，复核改名和入组结果。',
        '不要复制、删除、聚焦或导出，那些属于后续阶段。'
      ].join('\n')
    },
    {
      stageId: 'duplicate-text-layer',
      title: '复制文字图层并读回复制图层 id',
      maxIterations: 8,
      maxDesignRetryRounds: 1,
      requiredToolNames: ['switchDocument', 'duplicateLayer'],
      retryGuidance: '还需要确认文字图层已经复制，并且复制层名称正确。',
      toolNames: [
        'switchDocument',
        'getLayerHierarchy',
        'getLayerProperties',
        'duplicateLayer'
      ],
      task: [
        '只复制文字图层。',
        evidenceBlock,
        `如果当前活动文档不是 ${documentName}，先切换到该文档。`,
        `复制系统已确认编号为 ${textLayerId ?? '<textLayerId>'} 的文字图层。`,
        '复制图层名称必须是 Agent Duplicate To Delete。',
        '复制后必须读回图层结构或图层属性，确认复制层真实存在。',
        '不要删除、聚焦或导出，那些属于下一阶段。'
      ].join('\n')
    },
    {
      stageId: 'delete-duplicate-layer',
      title: '删除临时复制层并读回',
      maxIterations: 5,
      maxDesignRetryRounds: 1,
      requiredToolNames: ['switchDocument', 'deleteLayer'],
      toolNames: [
        'switchDocument',
        'getLayerHierarchy',
        'deleteLayer'
      ],
      retryGuidance: '还需要确认临时复制层已经从当前临时文档中移除。',
      task: [
        '只删除临时复制层，并读回确认。',
        evidenceBlock,
        `先确认当前活动文档是 ${documentName}。如果不是，请切换回这个临时文档。`,
        `删除系统已确认编号为 ${duplicateLayerId ?? '<duplicateLayerId>'} 的 Agent Duplicate To Delete。不要删除原始文字层或矩形层。`,
        '删除后必须读回图层结构，复核复制层已经不存在。不要读取已删除图层的属性。',
        '不要聚焦图层，不要导出，不要重复删除同一个图层。'
      ].join('\n')
    },
    {
      stageId: 'focus-export',
      title: '聚焦矩形、读回并导出',
      maxIterations: 6,
      maxDesignRetryRounds: 1,
      requiredToolNames: ['switchDocument', 'focusLayer', 'quickExport'],
      toolNames: [
        'switchDocument',
        'getLayerHierarchy',
        'getLayerBounds',
        'getLayerProperties',
        'getAcceptanceSnapshot',
        'focusLayer',
        'quickExport'
      ],
      retryGuidance: '还需要确认矩形图层已经被聚焦，并且 PNG 已导出到指定路径。',
      task: [
        '只聚焦重命名后的矩形层、读回并导出 PNG。',
        evidenceBlock,
        `先确认当前活动文档是 ${documentName}。如果不是，请切换回这个临时文档。`,
        `聚焦系统已确认编号为 ${shapeLayerId ?? '<shapeLayerId>'} 的 Agent Renamed Rectangle。`,
        '聚焦后必须读回图层结构、边界、图层属性或验收快照进行复核。',
        `最后导出 PNG 到完整路径：${outputPath}。`,
        '不要创建新文档，不要复制或删除图层。'
      ].join('\n')
    }
  ];
}

function buildStageDesignRetryTask(stage, missingToolNames, stageTools, attemptNumber) {
  const completedCount = stageTools.filter((tool) => tool.result?.success !== false).length;
  const failedTools = stageTools
    .filter((tool) => tool.result?.success === false)
    .map((tool) => tool.result?.error || '处理失败');
  return [
    `这是第 ${attemptNumber + 1} 次处理同一个小步骤。上一轮还没有把这个步骤完整做完。`,
    stage.retryGuidance || '请只补齐当前小步骤缺少的实际处理结果。',
    completedCount > 0 ? `上一轮已有 ${completedCount} 项操作成功，请不要重复已经完成的部分。` : '上一轮没有留下可确认的处理结果，请直接完成当前步骤。',
    failedTools.length ? `上一轮失败反馈：${failedTools.join('；')}。` : '',
    '请回到同一份临时 Photoshop 文档，只补齐当前小步骤；不要创建新文档，不要跳到后续步骤。',
    '',
    stage.task
  ].filter(Boolean).join('\n');
}

async function main() {
  if (hasArg('--self-test')) {
    const sample = {
      success: true,
      mode: 'self-test',
      agent: { toolCount: 1, failedToolCount: 0, toolNames: ['renameLayer'] },
      tools: [{ name: 'renameLayer', arguments: { layerId: 2, newName: 'Agent Renamed Rectangle' }, result: { success: true, layerId: 2 } }],
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
      mode: 'guarded-live-agent-photoshop-layer-management',
      reason: 'Run with --live to allow a real model to call real Photoshop layer-management tools against a disposable document.',
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

  const modelId = getArgValue('--model', process.env.DESIGNECHO_LIVE_AGENT_LAYER_MANAGEMENT_MODEL || DEFAULT_MODEL_ID);
  const timeoutMs = Number(getArgValue('--timeout-ms', process.env.DESIGNECHO_LIVE_AGENT_LAYER_MANAGEMENT_TIMEOUT_MS || DEFAULT_TIMEOUT_MS));
  const stamp = Date.now();
  const documentName = getArgValue('--document-name', `AgentLiveLayerManagement-${stamp}`);
  const outputPath = path.join(TMP_DIR, `agent-live-layer-management-${stamp}.png`).replace(/\\/g, '/');
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
      mode: 'blocked-live-agent-photoshop-layer-management',
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
      mode: 'blocked-live-agent-photoshop-layer-management',
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
      onToolStart: (toolName) => console.log(`[agent-live-layer-management:${stage.stageId}:tool:start] ${toolName}`),
      onToolComplete: (toolName, result) => {
        console.log(`[agent-live-layer-management:${stage.stageId}:tool:${result?.success === false ? 'fail' : 'pass'}] ${toolName}`);
        liveTools.push({ stageId: stage.stageId, name: toolName, result: summarizeResult(result) });
        writePartial({ agent: aggregateAgent() });
      }
    };

    const agent = new Agent(
      {
        systemPrompt: [
          '你是一个谨慎的 Photoshop 设计助理。',
          '你必须根据当前小步骤直接处理 Photoshop；不要只写计划或操作清单后停止。',
          `当前小步骤：${stage.title}。只完成这个小步骤，不要跳到其他步骤。`,
          '简单图层管理不需要长篇说明，但每次改动画面后都要用读回结果确认。',
          '移动、重命名、复制、删除、聚焦图层时必须复用系统已经确认的图层编号或图层组编号。',
          '删除图层、移动图层、聚焦图层或导出时，必须在本步骤内安排读回或导出结果复核。',
          '不要猜测图层编号，不要把背景层当作目标图层。',
          '对用户汇报时使用设计师语言，只说明处理结果、画面状态和需要复核的点；不要输出内部流程名称或调试内容。'
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
      detail: `工具 ${stageReport.toolCount} 次，失败 ${stageReport.failedToolCount} 次。`,
      status: failedTools.length === 0 ? 'success' : 'error'
    });
    writePartial({ agent: aggregateAgent() });
    return { result, tools: stageToolSummaries, stageReport };
  };

  const runStageWithRequiredTools = async (stage) => {
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
          detail: `缺少关键工具证据：${missingToolNames.join(', ')}`,
          status: 'error'
        });
        writePartial({ agent: aggregateAgent() });
        return lastRun;
      }

      liveEvents.push({
        stageId: stage.stageId,
        kind: 'stage_reflexion_reentry',
        title: stage.title,
        detail: `缺少关键工具证据：${missingToolNames.join(', ')}`,
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

  let currentGroupId;
  let currentShapeLayerId;
  let currentTextLayerId;
  let currentDuplicateLayerId;

  await runStageWithRequiredTools(buildLayerManagementStages({ documentName, outputPath })[0]);
  currentGroupId = findGroupId(allToolSummaries);
  currentShapeLayerId = findLayerIdByTool(allToolSummaries, 'createRectangle');
  currentTextLayerId = findLayerIdByTool(allToolSummaries, 'createTextLayer');

  if (typeof currentGroupId === 'number' && typeof currentShapeLayerId === 'number') {
    await runStageWithRequiredTools(buildLayerManagementStages({
      documentName,
      outputPath,
      groupId: currentGroupId,
      shapeLayerId: currentShapeLayerId,
      textLayerId: currentTextLayerId
    })[1]);
  }

  if (typeof currentTextLayerId === 'number') {
    await runStageWithRequiredTools(buildLayerManagementStages({
      documentName,
      outputPath,
      groupId: currentGroupId,
      shapeLayerId: currentShapeLayerId,
      textLayerId: currentTextLayerId
    })[2]);
    currentDuplicateLayerId = findLayerIdByTool(allToolSummaries, 'duplicateLayer');
  }

  if (typeof currentDuplicateLayerId === 'number') {
    await runStageWithRequiredTools(buildLayerManagementStages({
      documentName,
      outputPath,
      groupId: currentGroupId,
      shapeLayerId: currentShapeLayerId,
      textLayerId: currentTextLayerId,
      duplicateLayerId: currentDuplicateLayerId
    })[3]);
  }

  if (typeof currentShapeLayerId === 'number') {
    await runStageWithRequiredTools(buildLayerManagementStages({
      documentName,
      outputPath,
      groupId: currentGroupId,
      shapeLayerId: currentShapeLayerId,
      textLayerId: currentTextLayerId,
      duplicateLayerId: currentDuplicateLayerId
    })[4]);
  }

  const toolSummaries = allToolSummaries;
  const toolNames = toolSummaries.map((entry) => entry.name);
  const failedTools = toolSummaries.filter((entry) => entry.result.success === false);
  const groupId = currentGroupId ?? findGroupId(toolSummaries);
  const shapeLayerId = currentShapeLayerId ?? findLayerIdByTool(toolSummaries, 'createRectangle');
  const textLayerId = currentTextLayerId ?? findLayerIdByTool(toolSummaries, 'createTextLayer');
  const duplicateLayerId = currentDuplicateLayerId ?? findLayerIdByTool(toolSummaries, 'duplicateLayer');
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

  const renameTool = findToolWithLayerArg(toolSummaries, 'renameLayer', shapeLayerId);
  const duplicateTool = findToolWithLayerArg(toolSummaries, 'duplicateLayer', textLayerId);
  const deleteTool = duplicateLayerId !== undefined
    ? findToolWithLayerArg(toolSummaries, 'deleteLayer', duplicateLayerId)
    : firstSuccessfulTool(toolSummaries, 'deleteLayer');
  const finalSnapshot = lastSuccessfulTool(toolSummaries, 'getAcceptanceSnapshot');
  const finalLayerNames = Array.isArray(finalSnapshot?.result?.layerNames) ? finalSnapshot.result.layerNames : [];
  const duplicateLayerAbsentInFinalSnapshot = finalLayerNames.length > 0
    && !finalLayerNames.includes('Agent Duplicate To Delete');

  const requiredSignals = [
    { name: 'created-document', passed: hasSuccessfulTool(toolSummaries, 'createDocument') },
    { name: 'document-context-confirmed', passed: hasSuccessfulTool(toolSummaries, 'listDocuments') || hasSuccessfulTool(toolSummaries, 'createDocument') },
    { name: 'disposable-document-active-or-switched', passed: Boolean(findSwitchToDocument(toolSummaries, documentName)) || hasSuccessfulTool(toolSummaries, 'createDocument') },
    { name: 'created-group', passed: typeof groupId === 'number' },
    { name: 'created-shape', passed: typeof shapeLayerId === 'number' },
    { name: 'created-text', passed: typeof textLayerId === 'number' },
    { name: 'renamed-shape-with-real-layer-id', passed: Boolean(renameTool && renameTool.arguments?.newName === 'Agent Renamed Rectangle') },
    { name: 'moved-shape-into-group', passed: Boolean(findToolWithGroupArgs(toolSummaries, shapeLayerId, groupId)) },
    { name: 'duplicated-text-layer', passed: Boolean(duplicateTool) },
    { name: 'deleted-duplicate-layer', passed: Boolean(deleteTool) },
    { name: 'duplicate-layer-absent-in-final-snapshot', passed: duplicateLayerAbsentInFinalSnapshot },
    { name: 'focused-renamed-shape', passed: Boolean(findToolWithLayerArg(toolSummaries, 'focusLayer', shapeLayerId)) },
    { name: 'readback-used', passed: hasSuccessfulTool(toolSummaries, 'getLayerHierarchy') || hasSuccessfulTool(toolSummaries, 'getLayerProperties') || hasSuccessfulTool(toolSummaries, 'getLayerBounds') || hasSuccessfulTool(toolSummaries, 'getAcceptanceSnapshot') },
    { name: 'exported-png', passed: fileExists && pngHeader === '89504e470d0a1a0a' && !unexpectedPsdExists },
    { name: 'document-not-left-open', passed: Array.isArray(documentsAfterCleanup) && !documentsAfterCleanup.some((doc) => String(doc?.name || '') === documentName) },
    { name: 'no-failed-tools', passed: failedTools.length === 0 }
  ];
  const success = requiredSignals.every((item) => item.passed);

  const report = {
    success,
    skipped: false,
    mode: 'live-agent-real-model-real-photoshop-layer-management',
    modelId,
    ollama,
    documentName,
    groupId,
    shapeLayerId,
    textLayerId,
    duplicateLayerId,
    outputPath,
    unexpectedPsdPath,
    durationMs: Date.now() - startedAt,
    agent: {
      success: stageResults.length > 0 && stageResults.every((stage) => stage.failedToolCount === 0),
      stopReason: stageResults.map((stage) => `${stage.stageId}:${stage.stopReason}`).join(', '),
      executionStatus: stageResults.every((stage) => stage.executionStatus === 'completed') ? 'completed' : 'needs_review',
      summaryText: `阶段 ${stageResults.length} 个，处理动作 ${toolSummaries.length} 次，失败 ${failedTools.length} 次。`,
      blockers: stageResults.flatMap((stage) => stage.blockers || []),
      warnings: stageResults.flatMap((stage) => stage.warnings || []),
      iterations: stageResults.reduce((sum, stage) => sum + Number(stage.iterations || 0), 0),
      toolCount: toolSummaries.length,
      failedToolCount: failedTools.length,
      toolNames,
      stageResults
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
    finalMessage: stageResults.map((stage) => `${stage.stageId}: ${stage.summaryText || stage.stopReason}`).join('\n'),
    report: { json: REPORT_JSON, md: REPORT_MD },
    boundaries: [
      'This runner uses a real model through ModelService.chatWithTools; tool calls are not pre-scripted.',
      'The executable tool set is scoped to layer-management operations so layerId and groupId mistakes are diagnosable.',
      'Photoshop writes happen against a disposable document and are verified by explicit ids, readback, export, and cleanup evidence.',
      'Passing this runner proves this bounded Agent layer-management task, not all Photoshop capabilities or open-ended design quality.'
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
    duplicateLayerId,
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
    mode: 'live-agent-real-model-real-photoshop-layer-management',
    generatedAt: new Date().toISOString(),
    error: error?.stack || error?.message || String(error),
    report: { json: REPORT_JSON, md: REPORT_MD },
    boundaries: ['Unhandled runner failure; no live success is claimed.']
  };
  writeReport(failed);
  console.error(failed.error);
  process.exit(1);
});
