#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '..', 'tsconfig.main.json')
});

const ROOT = path.resolve(__dirname, '..');
const TMP_DIR = path.join(ROOT, 'tmp', 'main-image-live-tool-adapter-disposable');
const FIXTURE_DIR = path.join(TMP_DIR, 'fixtures');
const EXPORT_DIR = path.join(TMP_DIR, 'exports');
const REPORT_JSON = path.join(TMP_DIR, 'report.json');
const REPORT_MD = path.join(TMP_DIR, 'report.md');
const MCP_ENDPOINT = process.env.MCP_ENDPOINT || 'http://127.0.0.1:8768/mcp';
const LIVE_FLAG = 'DESIGNECHO_LIVE_MAIN_IMAGE_TOOL_ADAPTER_ACCEPTANCE';
const DISPOSABLE_FLAG = 'DESIGNECHO_LIVE_MAIN_IMAGE_TOOL_ADAPTER_DISPOSABLE_DOCUMENT';
const DOC_PREFIX = 'DesignEchoMainImageToolAdapterDisposable';

function parsePositiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : fallback;
}

const MCP_REQUEST_TIMEOUT_MS = parsePositiveInteger(
  process.env.DESIGNECHO_LIVE_MAIN_IMAGE_TOOL_ADAPTER_MCP_TIMEOUT_MS,
  45_000
);
const CLEANUP_REQUEST_TIMEOUT_MS = parsePositiveInteger(
  process.env.DESIGNECHO_LIVE_MAIN_IMAGE_TOOL_ADAPTER_CLEANUP_TIMEOUT_MS,
  15_000
);

const REQUIRED_TOOL_NAMES = [
  'createDocument',
  'createGroup',
  'moveLayerToGroup',
  'placeImage',
  'transformLayer',
  'moveLayer',
  'exportGroup',
  'getDocumentInfo',
  'getLayerHierarchy',
  'getLayerProperties',
  'getAcceptanceSnapshot',
  'closeDocument',
  'listDocuments'
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const {
  createMainImageLivePhotoshopToolAdapter
} = require(path.join(ROOT, 'src', 'renderer', 'services', 'skill-executors', 'main-image-live-photoshop-tool-adapter.ts'));
const {
  buildMainImageLivePhotoshopAdapterContract
} = require(path.join(ROOT, 'src', 'shared', 'main-image-live-photoshop-adapter-contract.ts'));
const {
  runMainImageLiveExecutor
} = require(path.join(ROOT, 'src', 'shared', 'main-image-live-executor-runner.ts'));

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function normalizePath(filePath) {
  return filePath.replace(/\\/g, '/');
}

function calcFnv1a32(buffer) {
  let hash = 0x811c9dc5;
  for (const byte of buffer) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function resolveImageFormat(filePath) {
  const ext = path.extname(String(filePath || '')).replace(/^\./, '').toLowerCase();
  if (ext === 'jpg' || ext === 'jpeg') return 'jpg';
  if (ext === 'gif') return 'gif';
  if (ext === 'webp') return 'webp';
  if (ext === 'tif' || ext === 'tiff') return 'tiff';
  if (ext === 'bmp') return 'bmp';
  return 'png';
}

function preprocessPlaceImageParams(params = {}) {
  if (!params.filePath || params.imageData || params.fileToken) return params;

  const filePath = path.resolve(String(params.filePath));
  const bytes = fs.readFileSync(filePath);
  return {
    ...params,
    imageData: bytes.toString('base64'),
    imageFormat: resolveImageFormat(filePath),
    filePath: undefined,
    sourcePath: normalizePath(filePath),
    sourceByteLength: bytes.length,
    sourceChecksum: calcFnv1a32(bytes)
  };
}

async function writeFixtureImage() {
  ensureDir(FIXTURE_DIR);
  const filePath = path.join(FIXTURE_DIR, 'hero-sock-placeholder.png');
  await sharp({
    create: {
      width: 64,
      height: 48,
      channels: 4,
      background: { r: 246, g: 248, b: 252, alpha: 1 }
    }
  })
    .png()
    .toFile(filePath);
  return normalizePath(filePath);
}

function writeReport(report) {
  ensureDir(TMP_DIR);
  fs.writeFileSync(REPORT_JSON, JSON.stringify(report, null, 2), 'utf8');
  fs.writeFileSync(REPORT_MD, renderMarkdown(report), 'utf8');
}

function renderMarkdown(report) {
  const lines = [
    '# Main Image Live Tool Adapter Disposable Smoke',
    '',
    `- success: ${report.success}`,
    `- skipped: ${Boolean(report.skipped)}`,
    `- mode: ${report.mode}`,
    `- endpoint: ${report.endpoint}`,
    `- mcpRequestTimeoutMs: ${report.mcpRequestTimeoutMs || MCP_REQUEST_TIMEOUT_MS}`,
    `- cleanupRequestTimeoutMs: ${report.cleanupRequestTimeoutMs || CLEANUP_REQUEST_TIMEOUT_MS}`,
    typeof report.placeImagePreprocessedFilePathToBase64 === 'boolean'
      ? `- placeImagePreprocessedFilePathToBase64: ${report.placeImagePreprocessedFilePathToBase64}`
      : '',
    report.reason ? `- reason: ${report.reason}` : '',
    report.error ? `- error: ${String(report.error).split('\n')[0]}` : '',
    '',
    '## Boundaries',
    '',
    '- 默认不写 Photoshop，只有显式 live/disposable 环境变量齐备才执行。',
    '- 只允许脚本创建的一次性文档，不写生产文档。',
    '- runner 成功只代表工具队列和读回完成，不能声明主图设计质量。',
    '- 结果仍需要截图 QA、pixel probe 和人工复核。',
    ''
  ].filter(Boolean);

  if (report.preflight) {
    lines.push('## Preflight', '', '```json', JSON.stringify(report.preflight, null, 2), '```', '');
  }
  if (report.runnerResult) {
    lines.push('## Runner Result', '', '```json', JSON.stringify(report.runnerResult, null, 2), '```', '');
  }
  if (report.cleanup) {
    lines.push('## Cleanup', '', '```json', JSON.stringify(report.cleanup, null, 2), '```', '');
  }
  return `${lines.join('\n')}\n`;
}

function parseToolResult(result) {
  const text = result?.content?.[0]?.text || '';
  try {
    const parsed = JSON.parse(text);
    if (typeof parsed === 'string') {
      try {
        return JSON.parse(parsed);
      } catch {
        return parsed;
      }
    }
    return parsed;
  } catch {
    return text;
  }
}

async function rpc(method, params = {}, options = {}) {
  const requestTimeoutMs = parsePositiveInteger(options.requestTimeoutMs, MCP_REQUEST_TIMEOUT_MS);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
  let response;
  try {
    response = await fetch(MCP_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: Date.now() + Math.random(),
        method,
        params
      })
    });
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error(`${method} timed out after ${requestTimeoutMs}ms at ${MCP_ENDPOINT}`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} from ${MCP_ENDPOINT}`);
  }
  const payload = await response.json();
  if (payload.error) {
    throw new Error(`${method} failed: ${JSON.stringify(payload.error)}`);
  }
  return payload.result;
}

async function safeRpc(method, params = {}, options = {}) {
  try {
    return { ok: true, result: await rpc(method, params, options) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function callTool(name, args = {}, options = {}) {
  return parseToolResult(await rpc('tools/call', {
    name,
    arguments: args
  }, options));
}

async function safeCallTool(name, args = {}, options = {}) {
  try {
    return { ok: true, result: await callTool(name, args, options) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function callPhotoshopTool(name, args = {}, options = {}) {
  return callTool('photoshop.tools.call', {
    name,
    arguments: args
  }, options);
}

function isHostModalMessage(message) {
  return /host is in a modal state|modal state/i.test(String(message || ''));
}

function isHostModalResult(result) {
  return result?.success === false && isHostModalMessage(result.error || result.message);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function callPhotoshopToolStable(name, args = {}, options = {}) {
  const attempts = options.attempts || 5;
  const delayMs = options.delayMs || 250;
  const requestTimeoutMs = parsePositiveInteger(options.requestTimeoutMs, MCP_REQUEST_TIMEOUT_MS);
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const result = await callPhotoshopTool(name, args, { requestTimeoutMs });
      if (!isHostModalResult(result) || attempt >= attempts) {
        if (result && typeof result === 'object') result.__smokeAttempts = attempt;
        return result;
      }
    } catch (error) {
      lastError = error;
      if (!isHostModalMessage(error?.message) || attempt >= attempts) throw error;
    }
    await sleep(delayMs * attempt);
  }
  if (lastError) throw lastError;
  return callPhotoshopTool(name, args, { requestTimeoutMs });
}

function normalizeToolNames(result) {
  const tools = Array.isArray(result?.tools) ? result.tools : [];
  return tools.map((tool) => String(tool?.name || '').trim()).filter(Boolean);
}

function isTimeoutMessage(message) {
  return /timed out after|request timeout|timeout/i.test(String(message || ''));
}

function classifyPreflightHealth({ toolsList, systemStatus, photoshopTools, missingTools }) {
  if (!toolsList.ok) {
    return isTimeoutMessage(toolsList.error)
      ? 'mcp_endpoint_timeout'
      : 'mcp_endpoint_unavailable';
  }
  if (!systemStatus.ok) {
    return isTimeoutMessage(systemStatus.error)
      ? 'mcp_system_status_timeout'
      : 'mcp_system_status_unavailable';
  }
  if (systemStatus.result?.pluginConnected !== true) {
    return 'photoshop_plugin_not_connected';
  }
  if (!photoshopTools.ok) {
    return isTimeoutMessage(photoshopTools.error)
      ? 'photoshop_bridge_unresponsive'
      : 'photoshop_tool_registry_unavailable';
  }
  if (missingTools.length > 0) {
    return 'photoshop_runtime_tool_mismatch';
  }
  return 'ready';
}

function buildRecoveryActions(healthStatus) {
  switch (healthStatus) {
    case 'ready':
      return [];
    case 'mcp_endpoint_timeout':
    case 'mcp_endpoint_unavailable':
      return [
        '确认 Agent 桌面端和 MCP Host 已启动。',
        `确认 MCP_ENDPOINT 指向当前桌面端暴露的地址：${MCP_ENDPOINT}。`
      ];
    case 'mcp_system_status_timeout':
    case 'mcp_system_status_unavailable':
      return [
        '重启 Agent 桌面端，确认 MCP Host 可以响应 system.status。',
        '不要继续执行 live 写入，直到 preflight 状态恢复。'
      ];
    case 'photoshop_plugin_not_connected':
      return [
        '确认 Photoshop 已打开并加载 DesignEcho UXP 插件。',
        '在 UXP Developer Tool 中重新加载插件，必要时重启 Photoshop。'
      ];
    case 'photoshop_bridge_unresponsive':
      return [
        'Photoshop 插件显示已连接但工具调用无响应，优先重载 UXP 插件。',
        '如果重载后仍无响应，重启 Photoshop 和 Agent 桌面端，再重跑 preflight。',
        '不要重复运行 live 写入脚本，避免留下新的临时文档。'
      ];
    case 'photoshop_tool_registry_unavailable':
      return [
        '检查 UXP 插件是否成功注册 photoshop.tools.list。',
        '重载 UXP 插件后重跑 preflight。'
      ];
    case 'photoshop_runtime_tool_mismatch':
      return [
        '当前 Photoshop 运行时插件工具列表与本地构建不一致。',
        '重新构建并重载 UXP 插件，确认运行时包含缺失工具后再 live rerun。'
      ];
    default:
      return ['查看 blockers 字段，先恢复 preflight 再运行 live 验收。'];
  }
}

async function runSelfTest() {
  const readyToolsList = { ok: true, result: { tools: [] } };
  const connectedStatus = { ok: true, result: { pluginConnected: true } };
  const timeoutToolError = {
    ok: false,
    error: 'tools/call failed: {"code":-32000,"message":"MCP request timeout: tools/list"}'
  };

  assert(isTimeoutMessage(timeoutToolError.error), 'MCP request timeout must be recognized as a timeout.');
  assert(
    classifyPreflightHealth({
      toolsList: readyToolsList,
      systemStatus: connectedStatus,
      photoshopTools: timeoutToolError,
      missingTools: REQUIRED_TOOL_NAMES
    }) === 'photoshop_bridge_unresponsive',
    'photoshop.tools.list timeout must be classified as photoshop_bridge_unresponsive.'
  );
  assert(
    classifyPreflightHealth({
      toolsList: readyToolsList,
      systemStatus: { ok: true, result: { pluginConnected: false } },
      photoshopTools: { ok: false, error: 'skipped' },
      missingTools: REQUIRED_TOOL_NAMES
    }) === 'photoshop_plugin_not_connected',
    'Disconnected plugin must be classified as photoshop_plugin_not_connected.'
  );
  assert(
    classifyPreflightHealth({
      toolsList: readyToolsList,
      systemStatus: connectedStatus,
      photoshopTools: { ok: true, result: { tools: [] } },
      missingTools: ['placeImage']
    }) === 'photoshop_runtime_tool_mismatch',
    'Successful registry read with missing tools must be classified as photoshop_runtime_tool_mismatch.'
  );

  fs.rmSync(FIXTURE_DIR, { recursive: true, force: true });
  const fixturePath = await writeFixtureImage();
  const fixtureMetadata = await sharp(fixturePath).metadata();
  assert(
    fixtureMetadata.width === 64 && fixtureMetadata.height === 48,
    'fixture image must be a valid 64x48 PNG accepted by image decoders.'
  );

  console.log(JSON.stringify({
    success: true,
    checks: [
      'MCP request timeout is recognized as timeout',
      'photoshop.tools.list timeout maps to photoshop_bridge_unresponsive',
      'disconnected plugin maps to photoshop_plugin_not_connected',
      'successful registry with missing tools maps to photoshop_runtime_tool_mismatch',
      'disposable main-image fixture PNG decodes before live Photoshop placement'
    ]
  }, null, 2));
}

async function buildPreflightReport() {
  const toolsList = await safeRpc('tools/list', {});
  const systemStatus = toolsList.ok
    ? await safeCallTool('system.status', {})
    : { ok: false, error: 'tools/list failed; system.status skipped.' };
  const photoshopTools = systemStatus.ok && systemStatus.result?.pluginConnected === true
    ? await safeCallTool('photoshop.tools.list', {})
    : { ok: false, error: 'Photoshop plugin is not connected; photoshop.tools.list skipped.' };
  const availableToolNames = photoshopTools.ok ? normalizeToolNames(photoshopTools.result) : [];
  const missingTools = REQUIRED_TOOL_NAMES.filter((toolName) => !availableToolNames.includes(toolName));
  const blockers = [];

  if (!toolsList.ok) blockers.push(`MCP tools/list failed: ${toolsList.error}`);
  if (!systemStatus.ok) blockers.push(`system.status failed: ${systemStatus.error}`);
  if (systemStatus.ok && systemStatus.result?.pluginConnected !== true) {
    blockers.push('Photoshop UXP plugin is not connected.');
  }
  if (!photoshopTools.ok) blockers.push(`photoshop.tools.list failed: ${photoshopTools.error}`);
  if (missingTools.length > 0) blockers.push(`Missing Photoshop tools: ${missingTools.join(', ')}`);
  const healthStatus = classifyPreflightHealth({ toolsList, systemStatus, photoshopTools, missingTools });

  return {
    ready: blockers.length === 0,
    healthStatus,
    endpoint: MCP_ENDPOINT,
    currentBridgeReady: systemStatus.ok && systemStatus.result?.pluginConnected === true,
    photoshopToolCount: availableToolNames.length,
    requiredTools: REQUIRED_TOOL_NAMES,
    missingTools,
    blockers,
    recoveryActions: buildRecoveryActions(healthStatus)
  };
}

function createOperation(index, requestId, tool, phase, payloadPreview, groupPath = []) {
  return {
    id: `live-adapter-${String(index).padStart(3, '0')}-${requestId}`,
    sourceDryRunId: `dry-run-${String(index).padStart(3, '0')}-${requestId}`,
    requestId,
    tool,
    phase,
    documentName: `${DOC_PREFIX}_${Date.now()}`,
    groupPath,
    payloadPreview,
    requiredReadback: tool === 'transformLayer' ? ['actualBounds'] : ['documentInfo'],
    requiredPostRunReadbackTools: tool === 'transformLayer'
      ? ['getLayerProperties']
      : ['getDocumentInfo', 'getLayerHierarchy'],
    sourceContextIds: ['AGENT-144-disposable-live-adapter-acceptance'],
    dispatchBoundary: 'disposable-live-smoke-only',
    actualResult: null
  };
}

function buildCheckpoint(assetPath, outputDir) {
  const documentName = `${DOC_PREFIX}_${Date.now()}`;
  const operations = [
    createOperation(1, 'create-doc', 'createDocument', 'document', {
      documentName,
      canvasSize: { width: 800, height: 800 }
    }),
    createOperation(2, 'create-parent-group', 'createGroup', 'group', {
      groupPath: ['点击图转化图']
    }, ['点击图转化图']),
    createOperation(3, 'create-child-group', 'createGroup', 'group', {
      groupPath: ['点击图转化图', '点击图_1x1_验证']
    }, ['点击图转化图', '点击图_1x1_验证']),
    createOperation(4, 'place-hero', 'placeImage', 'asset', {
      groupPath: ['点击图转化图', '点击图_1x1_验证'],
      asset: { name: 'hero-sock-placeholder.png', path: assetPath }
    }, ['点击图转化图', '点击图_1x1_验证']),
    createOperation(5, 'transform-hero', 'transformLayer', 'transform', {
      scalePercent: 72,
      destinationBox: {
        left: 120,
        top: 210,
        right: 620,
        bottom: 610,
        width: 500,
        height: 400
      }
    }, ['点击图转化图', '点击图_1x1_验证']),
    createOperation(6, 'export-child-group', 'exportGroup', 'export', {
      groupPath: ['点击图转化图', '点击图_1x1_验证'],
      outputDir,
      exportSpecId: 'click_1x1_adapter_acceptance',
      exportSize: { width: 800, height: 800 }
    }, ['点击图转化图', '点击图_1x1_验证'])
  ].map((operation) => ({ ...operation, documentName }));

  return {
    version: 'main-image-live-executor-checkpoint/v0',
    skillId: 'main-image-design',
    scene: 'ecommerce-socks',
    status: 'ready_for_live_executor_run',
    canStartLiveExecutor: true,
    checkpointOnly: true,
    noPhotoshopWrites: true,
    mustNotExecutePhotoshop: true,
    liveExecutionRequiresSeparateRunner: true,
    canClaimOutputQuality: false,
    canClaimDesignComplete: false,
    operationRequests: operations,
    operationCount: operations.length,
    readbackTools: ['getDocumentInfo', 'getLayerHierarchy', 'getLayerProperties', 'getAcceptanceSnapshot'],
    readbackRequirements: ['documentInfo', 'actualBounds', 'exportFileExists'],
    runGuard: {
      executionScope: 'disposable-document',
      approvedLiveExecution: true,
      photoshopConnected: true,
      documentWriteAvailable: true,
      maxOperationCount: 20,
      stopOnFirstFailure: true,
      requireReadbackAfterEachOperation: true,
      requireFinalAcceptanceSnapshot: true,
      requireManualReviewBeforeQualityClaim: true,
      failurePolicy: 'stop-on-first-failure'
    },
    blockers: [],
    warnings: [],
    limitations: ['AGENT-144 disposable live adapter acceptance; not a design quality claim.'],
    sourceNotes: [],
    verificationReport: {
      reportId: 'AGENT-144-disposable-live-adapter-acceptance',
      scenario: 'main-image',
      status: 'passed',
      scope: 'task',
      summary: 'checkpoint fixture for disposable live adapter acceptance',
      checks: [],
      blockers: [],
      warnings: [],
      limitations: [],
      sourceNotes: []
    }
  };
}

function extractDocumentId(runnerResult) {
  const createDocumentResult = runnerResult?.operationResults?.[0]?.actualResult;
  const toolCalls = Array.isArray(createDocumentResult?.toolCalls) ? createDocumentResult.toolCalls : [];
  const createCall = toolCalls.find((call) => call.toolName === 'createDocument');
  const result = createCall?.result || {};
  return Number(result.documentId || result.id || result.document?.id || 0) || null;
}

function extractExportPath(runnerResult, fallbackPath) {
  const exportOperation = (runnerResult?.operationResults || []).find((operation) => operation.tool === 'exportGroup');
  const toolCalls = Array.isArray(exportOperation?.actualResult?.toolCalls) ? exportOperation.actualResult.toolCalls : [];
  const exportCall = toolCalls.find((call) => call.toolName === 'exportGroup');
  return exportCall?.result?.outputPath || exportCall?.result?.data?.outputPath || fallbackPath;
}

async function cleanupDisposable(documentId) {
  if (!documentId) return { attempted: false, closed: false, reason: 'missing_document_id' };
  const closeResult = await callPhotoshopToolStable('closeDocument', {
    documentId,
    save: false
  }, {
    attempts: 1,
    requestTimeoutMs: CLEANUP_REQUEST_TIMEOUT_MS
  });
  return {
    attempted: true,
    closed: closeResult?.success === true,
    result: closeResult
  };
}

async function runLive() {
  ensureDir(EXPORT_DIR);
  const report = {
    generatedAt: new Date().toISOString(),
    mode: 'live-disposable-tool-adapter',
    endpoint: MCP_ENDPOINT,
    mcpRequestTimeoutMs: MCP_REQUEST_TIMEOUT_MS,
    cleanupRequestTimeoutMs: CLEANUP_REQUEST_TIMEOUT_MS,
    success: false,
    skipped: false
  };
  let disposableDocumentId = null;

  try {
    report.preflight = await buildPreflightReport();
    if (!report.preflight.ready) {
      throw new Error(`preflight_not_ready: ${report.preflight.blockers.join('; ')}`);
    }

    const assetPath = await writeFixtureImage();
    const outputDir = normalizePath(EXPORT_DIR);
    const expectedExportPath = normalizePath(path.join(EXPORT_DIR, 'click_1x1_adapter_acceptance.png'));
    const checkpoint = buildCheckpoint(assetPath, outputDir);
    const contract = buildMainImageLivePhotoshopAdapterContract({
      checkpoint,
      availableToolNames: REQUIRED_TOOL_NAMES
    });
    if (contract.status !== 'ready_for_disposable_photoshop_adapter') {
      throw new Error(`adapter_contract_not_ready: ${contract.blockers.join('; ')}`);
    }

    const executedTools = [];
    const adapterBuild = createMainImageLivePhotoshopToolAdapter({
      adapterContract: contract,
      approvedLiveAdapterRun: true,
      executionScope: 'disposable-document',
      executeTool: async (toolName, params) => {
        const finalParams = toolName === 'placeImage'
          ? preprocessPlaceImageParams(params)
          : params;
        executedTools.push({
          toolName,
          params: finalParams,
          preprocessedFilePathToBase64: toolName === 'placeImage'
            && Boolean(params?.filePath)
            && Boolean(finalParams?.imageData)
        });
        return callPhotoshopToolStable(toolName, finalParams);
      }
    });
    if (!adapterBuild.adapter) {
      throw new Error(`adapter_not_ready: ${adapterBuild.blockers.join('; ')}`);
    }

    const runnerResult = await runMainImageLiveExecutor({
      checkpoint,
      adapter: adapterBuild.adapter
    });
    report.runnerResult = runnerResult;
    report.executedTools = executedTools.map((call) => call.toolName);
    report.placeImagePreprocessedFilePathToBase64 = executedTools.some((call) => call.preprocessedFilePathToBase64);
    disposableDocumentId = extractDocumentId(runnerResult);
    const exportedPath = normalizePath(extractExportPath(runnerResult, expectedExportPath));
    report.disposableDocumentId = disposableDocumentId;
    report.exportedPath = exportedPath;
    report.exportFile = fs.existsSync(exportedPath)
      ? { exists: true, size: fs.statSync(exportedPath).size }
      : { exists: false };

    if (runnerResult.status !== 'completed_requires_review') {
      throw new Error(`runner_not_completed: ${runnerResult.status}`);
    }
    if (!report.exportFile.exists || report.exportFile.size <= 0) {
      throw new Error(`export_file_missing_or_empty: ${exportedPath}`);
    }
    if (runnerResult.canClaimOutputQuality !== false || runnerResult.canClaimDesignComplete !== false) {
      throw new Error('runner_overclaimed_design_quality');
    }

    report.success = true;
  } catch (error) {
    report.success = false;
    report.error = error instanceof Error ? error.stack || error.message : String(error);
  } finally {
    try {
      report.cleanup = await cleanupDisposable(disposableDocumentId);
    } catch (cleanupError) {
      report.cleanup = {
        attempted: Boolean(disposableDocumentId),
        closed: false,
        error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError)
      };
    }
    writeReport(report);
  }

  console.log(JSON.stringify({
    success: report.success,
    mode: report.mode,
    disposableDocumentId: report.disposableDocumentId || null,
    exportedPath: report.exportedPath || null,
    exportFile: report.exportFile || null,
    cleanup: report.cleanup || null,
    report: REPORT_JSON,
    error: report.error ? String(report.error).split('\n')[0] : null
  }, null, 2));

  if (!report.success) process.exit(1);
}

async function writePreflightReport() {
  const report = {
    generatedAt: new Date().toISOString(),
    mode: 'preflight',
    endpoint: MCP_ENDPOINT,
    mcpRequestTimeoutMs: MCP_REQUEST_TIMEOUT_MS,
    cleanupRequestTimeoutMs: CLEANUP_REQUEST_TIMEOUT_MS,
    success: true,
    skipped: false,
    preflight: await buildPreflightReport()
  };
  writeReport(report);
  console.log(JSON.stringify({
    success: true,
    mode: report.mode,
    ready: report.preflight.ready,
    blockers: report.preflight.blockers,
    report: REPORT_JSON
  }, null, 2));
}

function writeSkippedReport() {
  const report = {
    generatedAt: new Date().toISOString(),
    mode: 'skipped-guarded-live',
    endpoint: MCP_ENDPOINT,
    mcpRequestTimeoutMs: MCP_REQUEST_TIMEOUT_MS,
    cleanupRequestTimeoutMs: CLEANUP_REQUEST_TIMEOUT_MS,
    success: true,
    skipped: true,
    reason: `Set ${LIVE_FLAG}=1 and ${DISPOSABLE_FLAG}=1 to run disposable live adapter acceptance.`,
    requiredEnvironment: {
      [LIVE_FLAG]: '1',
      [DISPOSABLE_FLAG]: '1'
    }
  };
  writeReport(report);
  console.log(JSON.stringify({
    success: true,
    skipped: true,
    reason: report.reason,
    report: REPORT_JSON
  }, null, 2));
}

async function main() {
  if (process.argv.includes('--self-test')) {
    await runSelfTest();
    return;
  }
  if (process.argv.includes('--preflight')) {
    await writePreflightReport();
    return;
  }
  if (process.env[LIVE_FLAG] !== '1' || process.env[DISPOSABLE_FLAG] !== '1') {
    writeSkippedReport();
    return;
  }
  await runLive();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
