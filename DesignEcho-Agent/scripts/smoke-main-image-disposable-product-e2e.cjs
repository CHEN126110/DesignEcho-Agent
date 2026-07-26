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
const TMP_DIR = path.join(ROOT, 'tmp', 'main-image-disposable-product-e2e');
const FIXTURE_DIR = path.join(TMP_DIR, 'fixtures');
const EXPORT_DIR = path.join(TMP_DIR, 'exports');
const REPORT_JSON = path.join(TMP_DIR, 'report.json');
const REPORT_MD = path.join(TMP_DIR, 'report.md');
const MCP_ENDPOINT = process.env.MCP_ENDPOINT || 'http://127.0.0.1:8768/mcp';
const LIVE_FLAG = 'DESIGNECHO_MAIN_IMAGE_DISPOSABLE_PRODUCT_E2E_LIVE';
const DISPOSABLE_FLAG = 'DESIGNECHO_MAIN_IMAGE_DISPOSABLE_PRODUCT_E2E_DISPOSABLE_DOCUMENT';
const DOC_PREFIX = 'DesignEchoMainImageProductDisposable';

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

const PRODUCT_TOOL_NAMES = REQUIRED_TOOL_NAMES.filter((name) => !['closeDocument', 'listDocuments'].includes(name));

const selectedAssetBase = {
  id: 'asset-product-smoke-1',
  name: 'white-slouch-socks-product-smoke.png',
  path: 'C:/project/assets/white-slouch-socks-product-smoke.png',
  role: 'project-image',
  width: 1600,
  height: 1600
};

const subjectBounds = {
  left: 250,
  top: 360,
  right: 1330,
  bottom: 980,
  width: 1080,
  height: 620
};

const sizePlans = [
  {
    sizeKey: '800',
    targetSize: { width: 1440, height: 1440 },
    subjectSize: { width: 1080, height: 620 },
    scale: 0.65,
    targetX: 369,
    targetY: 519,
    decisionReason: '1:1 disposable product smoke main-image plan',
    smartLayoutPlanned: true,
    quickExportPlanned: true,
    quickExportOutputPath: path.join(EXPORT_DIR, '主图', '800', 'main-image_800_click.jpg')
  },
  {
    sizeKey: '750',
    targetSize: { width: 1440, height: 1920 },
    subjectSize: { width: 1080, height: 620 },
    scale: 0.65,
    targetX: 369,
    targetY: 759,
    decisionReason: '3:4 disposable product smoke main-image plan',
    smartLayoutPlanned: true,
    quickExportPlanned: true,
    quickExportOutputPath: path.join(EXPORT_DIR, '主图', '750', 'main-image_750_click.jpg')
  },
  {
    sizeKey: '1200',
    targetSize: { width: 1440, height: 2560 },
    subjectSize: { width: 1080, height: 620 },
    scale: 0.65,
    targetX: 369,
    targetY: 1079,
    decisionReason: '9:16 disposable product smoke main-image plan',
    smartLayoutPlanned: true,
    quickExportPlanned: true,
    quickExportOutputPath: path.join(EXPORT_DIR, '主图', '1200', 'main-image_1200_click.jpg')
  }
];

function buildVisualSignal(asset) {
  return {
    source: 'vision-model',
    assetRef: { id: asset.id, path: asset.path, name: asset.name },
    productType: '堆堆袜',
    subjectSummary: '白色堆堆袜，松弛褶皱感，适合春夏清爽穿搭主图',
    backgroundSummary: '浅色背景，局部脚部造型',
    sourceNotes: ['视觉模型：白色堆堆袜', '视觉模型：褶皱袜筒和清爽穿搭氛围']
  };
}

const {
  createMainImageLivePhotoshopToolAdapter
} = require(path.join(ROOT, 'src', 'renderer', 'services', 'skill-executors', 'main-image-live-photoshop-tool-adapter.ts'));
const {
  buildMainImageAgentDraftPlan
} = require(path.join(ROOT, 'src', 'shared', 'main-image-agent-draft-plan.ts'));
const {
  buildMainImageCandidatePreflightPlan
} = require(path.join(ROOT, 'src', 'shared', 'main-image-asset-selection.ts'));
const {
  buildMainImageVisionPreflightResult,
  buildMainImageVisionPreflightPlan
} = require(path.join(ROOT, 'src', 'shared', 'main-image-vision-preflight.ts'));
const {
  buildMainImageLiveAdapterHandoff
} = require(path.join(ROOT, 'src', 'shared', 'main-image-live-adapter-handoff.ts'));
const {
  buildMainImageLiveExecutorCheckpoint
} = require(path.join(ROOT, 'src', 'shared', 'main-image-live-executor-checkpoint.ts'));
const {
  runMainImageLiveExecutor
} = require(path.join(ROOT, 'src', 'shared', 'main-image-live-executor-runner.ts'));
const {
  buildMainImageLivePhotoshopAdapterContract
} = require(path.join(ROOT, 'src', 'shared', 'main-image-live-photoshop-adapter-contract.ts'));
const {
  buildMainImageQaReport
} = require(path.join(ROOT, 'src', 'shared', 'main-image-qa-report.ts'));
const {
  buildMainImageStrategyInputs
} = require(path.join(ROOT, 'src', 'shared', 'main-image-strategy-input-builder.ts'));

function assert(condition, message, details) {
  if (!condition) {
    const suffix = details ? `\n${JSON.stringify(details, null, 2)}` : '';
    throw new Error(`${message}${suffix}`);
  }
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function normalizePath(filePath) {
  return String(filePath || '').replace(/\\/g, '/');
}

function parsePositiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : fallback;
}

const MCP_REQUEST_TIMEOUT_MS = parsePositiveInteger(
  process.env.DESIGNECHO_MAIN_IMAGE_DISPOSABLE_PRODUCT_E2E_MCP_TIMEOUT_MS,
  45_000
);
const CLEANUP_REQUEST_TIMEOUT_MS = parsePositiveInteger(
  process.env.DESIGNECHO_MAIN_IMAGE_DISPOSABLE_PRODUCT_E2E_CLEANUP_TIMEOUT_MS,
  15_000
);

function shouldRunLive(env = process.env) {
  return env[LIVE_FLAG] === '1' && env[DISPOSABLE_FLAG] === '1';
}

function assertNoRawPayload(value, label) {
  const serialized = JSON.stringify(value);
  const forbidden = ['raw-image-payload', 'base64-image-payload', 'data:image/'];
  const found = forbidden.filter((token) => serialized.includes(token));
  assert(found.length === 0, `${label} must not leak raw image payload markers: ${found.join(', ')}`);
}

async function writeFixtureImage() {
  ensureDir(FIXTURE_DIR);
  const filePath = path.join(FIXTURE_DIR, 'white-slouch-socks-product-smoke.png');
  await sharp({
    create: {
      width: 96,
      height: 72,
      channels: 4,
      background: { r: 246, g: 248, b: 252, alpha: 1 }
    }
  })
    .composite([
      {
        input: Buffer.from(
          '<svg width="96" height="72" xmlns="http://www.w3.org/2000/svg"><path d="M18 42 C28 30, 48 31, 60 40 C70 48, 82 47, 88 40" fill="none" stroke="#d7dde8" stroke-width="10" stroke-linecap="round"/><path d="M30 25 C38 18, 48 19, 56 27" fill="none" stroke="#eef2f8" stroke-width="12" stroke-linecap="round"/></svg>'
        ),
        top: 0,
        left: 0
      }
    ])
    .png()
    .toFile(filePath);
  return normalizePath(filePath);
}

function calcFnv1a32(buffer) {
  let hash = 0x811c9dc5;
  for (const byte of buffer) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function preprocessPlaceImageParams(params = {}) {
  if (!params.filePath || params.imageData || params.fileToken) return params;
  const filePath = path.resolve(String(params.filePath));
  const bytes = fs.readFileSync(filePath);
  return {
    ...params,
    imageData: bytes.toString('base64'),
    imageFormat: 'png',
    filePath: undefined,
    sourcePath: normalizePath(filePath),
    sourceByteLength: bytes.length,
    sourceChecksum: calcFnv1a32(bytes)
  };
}

function buildStrategy(assetPath, outputDir) {
  const selectedAsset = {
    ...selectedAssetBase,
    path: assetPath || selectedAssetBase.path
  };

  return buildMainImageStrategyInputs({
    userText: '看项目图片理解袜子款式，制作点击图和转化图',
    imageType: 'click',
    selectedAsset,
    projectAssets: [selectedAsset],
    subjectBounds,
    sizePlans,
    copyCandidates: ['轻薄堆叠，春夏更自在'],
    outputDir,
    toolNames: PRODUCT_TOOL_NAMES,
    allowPendingRatioExecution: true,
    userCheckpointApproved: true,
    visionSignal: buildVisualSignal(selectedAsset)
  });
}

function buildQaReport(strategy) {
  const selectedAsset = strategy.assetHeroStrategy.selectedAsset || selectedAssetBase;
  const draft = buildMainImageAgentDraftPlan({
    userText: '看项目图片理解袜子款式，制作点击图和转化图',
    imageType: 'click',
    projectAssets: [selectedAsset],
    selectedAsset,
    subjectBounds,
    sizePlans,
    copyCandidates: ['轻薄堆叠，春夏更自在'],
    outputDir: normalizePath(EXPORT_DIR),
    visionSignal: buildVisualSignal(selectedAsset)
  });
  const candidatePreflight = buildMainImageCandidatePreflightPlan({
    userText: '看项目图片理解袜子款式，制作点击图和转化图',
    projectAssets: [selectedAsset],
    selectedAsset,
    enableVisionPreflight: false,
    hasAnalyzer: true
  });
  const visionPlan = buildMainImageVisionPreflightPlan({
    enabled: false,
    selectedAssetPath: selectedAsset.path,
    selectedAssetName: selectedAsset.name,
    hasAnalyzer: true
  });
  const visionPreflight = buildMainImageVisionPreflightResult({ plan: visionPlan });
  const resultPath = normalizePath(path.join(EXPORT_DIR, 'product-path-smoke.png'));
  const screenshotQa = {
    stage: 'needs_manual_review',
    blockers: [],
    warnings: [],
    resultImageRecord: {
      resultPaths: [resultPath]
    },
    pixelProbe: {
      status: 'ok',
      rawImagesRedacted: true,
      boundary: 'fake adapter smoke records diagnostic status only; not a design quality claim'
    },
    manualReview: null
  };
  const screenshotProbeReadiness = {
    stage: 'needs_manual_review',
    blockers: [],
    warnings: [],
    resultFileProbes: [{
      path: resultPath,
      status: 'ok',
      exists: true,
      isFile: true,
      byteLength: 1200,
      format: 'png',
      dimensions: { width: 800, height: 800 },
      sha256: 'fake-adapter-smoke',
      rawImagesRedacted: true
    }],
    probeTarget: {
      mode: 'fake-adapter-smoke-result'
    },
    pixelProbe: {
      status: 'ok',
      rawImagesRedacted: true
    }
  };

  return buildMainImageQaReport({
    agentDraft: draft,
    candidatePreflight,
    visionPreflight,
    executionAlignment: null,
    screenshotQa,
    screenshotProbeReadiness
  });
}

function buildValidatedToolchainContext(contract, options = {}) {
  return {
    source: options.source || 'main-image-disposable-product-e2e',
    mode: options.mode || 'guarded-fake-disposable-product-path',
    success: true,
    preflightReady: true,
    assertionCount: options.assertionCount || 1,
    failedAssertions: [],
    exportedPath: options.exportedPath || normalizePath(path.join(EXPORT_DIR, 'product-path-smoke.png')),
    exportFileExists: options.exportFileExists !== false,
    cleanup: {
      closed: true,
      restoredOriginal: true,
      disposableStillOpen: false,
      errors: []
    },
    requiredToolNames: contract.requiredToolNames,
    missingToolNames: []
  };
}

function buildProductPathContext(input = {}) {
  const outputDir = normalizePath(input.outputDir || EXPORT_DIR);
  const strategy = buildStrategy(input.assetPath, outputDir);
  const checkpoint = buildMainImageLiveExecutorCheckpoint({
    requestPackage: strategy.liveExecutorRequestPackage,
    approvedLiveExecution: true,
    executionScope: 'disposable-document',
    photoshopConnection: {
      connected: true,
      documentWriteAvailable: true,
      source: input.connectionSource || 'guarded-fake-smoke',
      currentDocumentId: `${DOC_PREFIX}_disposable`,
      activeDocumentName: `${DOC_PREFIX}.psd`
    }
  });
  const contract = buildMainImageLivePhotoshopAdapterContract({
    checkpoint,
    availableToolNames: PRODUCT_TOOL_NAMES
  });
  const handoff = buildMainImageLiveAdapterHandoff({
    adapterContract: contract,
    toolchainCheck: buildValidatedToolchainContext(contract, {
      source: input.connectionSource || 'guarded-fake-smoke'
    })
  });
  const qaReport = buildQaReport(strategy);

  return {
    strategy,
    checkpoint,
    contract,
    handoff,
    qaReport
  };
}

function makeFakeExecuteTool() {
  const calls = [];
  let nextLayerId = 100;
  let documentId = 10;

  async function executeTool(toolName, params) {
    calls.push({ toolName, params });
    if (toolName === 'createDocument') return { success: true, documentId: documentId++ };
    if (toolName === 'createGroup') return { success: true, layerId: nextLayerId++ };
    if (toolName === 'placeImage') return { success: true, layerId: nextLayerId++ };
    if (toolName === 'transformLayer') {
      return {
        success: true,
        layerId: params.layerId || nextLayerId - 1,
        actualBounds: { left: 90, top: 270, right: 710, bottom: 690 }
      };
    }
    if (toolName === 'moveLayer' || toolName === 'moveLayerToGroup') return { success: true, layerId: params.layerId };
    if (toolName === 'exportGroup') return { success: true, outputPath: params.outputPath };
    if (toolName === 'getLayerProperties') {
      return { success: true, properties: { id: params.layerId, bounds: { left: 90, top: 270, right: 710, bottom: 690 } } };
    }
    if (toolName === 'getLayerHierarchy') return { success: true, layers: [] };
    if (toolName === 'getDocumentInfo') return { success: true, id: 10, width: 800, height: 800 };
    if (toolName === 'getAcceptanceSnapshot') return { success: true, document: { id: 10 }, layers: [] };
    return { success: true };
  }

  return { calls, executeTool };
}

async function runGuardedFakeProductPath() {
  ensureDir(EXPORT_DIR);
  const assetPath = await writeFixtureImage();
  const productPath = buildProductPathContext({ assetPath });
  assertReadyProductPath(productPath);

  const fake = makeFakeExecuteTool();
  const adapterBuild = createMainImageLivePhotoshopToolAdapter({
    adapterContract: productPath.contract,
    approvedLiveAdapterRun: true,
    executionScope: 'disposable-document',
    executeTool: fake.executeTool
  });
  assert(adapterBuild.status === 'ready_for_guarded_live_adapter', 'guarded fake adapter should be ready', adapterBuild);

  const runnerResult = await runMainImageLiveExecutor({
    checkpoint: productPath.checkpoint,
    adapter: adapterBuild.adapter
  });
  assert(runnerResult.status === 'completed_requires_review', 'fake product path runner should complete and require review', runnerResult);
  assert(fake.calls.length > 0, 'fake adapter should receive tool calls');
  assert(!fake.calls.some((call) => call.toolName === 'closeDocument'), 'default fake smoke must not call cleanup/write-live-only tools');

  const report = makeReport({
    mode: 'guarded-fake-disposable-product-e2e',
    success: true,
    skippedLiveWrite: true,
    productPath,
    adapterBuild,
    runnerResult,
    executedTools: fake.calls.map((call) => call.toolName)
  });
  writeReport(report);
  return report;
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
  if (!response.ok) throw new Error(`HTTP ${response.status} from ${MCP_ENDPOINT}`);
  const payload = await response.json();
  if (payload.error) throw new Error(`${method} failed: ${JSON.stringify(payload.error)}`);
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
  return parseToolResult(await rpc('tools/call', { name, arguments: args }, options));
}

async function safeCallTool(name, args = {}, options = {}) {
  try {
    return { ok: true, result: await callTool(name, args, options) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function callPhotoshopTool(name, args = {}, options = {}) {
  return callTool('photoshop.tools.call', { name, arguments: args }, options);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isHostModalMessage(message) {
  return /host is in a modal state|modal state/i.test(String(message || ''));
}

function isHostModalResult(result) {
  return result?.success === false && isHostModalMessage(result.error || result.message);
}

async function callPhotoshopToolStable(name, args = {}, options = {}) {
  const attempts = options.attempts || 5;
  const delayMs = options.delayMs || 250;
  const requestTimeoutMs = parsePositiveInteger(options.requestTimeoutMs, MCP_REQUEST_TIMEOUT_MS);
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const result = await callPhotoshopTool(name, args, { requestTimeoutMs });
      if (!isHostModalResult(result) || attempt >= attempts) return result;
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
  return (Array.isArray(result?.tools) ? result.tools : [])
    .map((tool) => String(tool?.name || '').trim())
    .filter(Boolean);
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
  if (systemStatus.ok && systemStatus.result?.pluginConnected !== true) blockers.push('Photoshop UXP plugin is not connected.');
  if (!photoshopTools.ok) blockers.push(`photoshop.tools.list failed: ${photoshopTools.error}`);
  if (missingTools.length > 0) blockers.push(`Missing Photoshop tools: ${missingTools.join(', ')}`);
  return {
    ready: blockers.length === 0,
    endpoint: MCP_ENDPOINT,
    requiredTools: REQUIRED_TOOL_NAMES,
    availableToolCount: availableToolNames.length,
    missingTools,
    blockers
  };
}

function extractDocumentId(runnerResult) {
  const createDocumentResult = runnerResult?.operationResults?.find((item) => item.tool === 'createDocument')?.actualResult;
  const toolCalls = Array.isArray(createDocumentResult?.toolCalls) ? createDocumentResult.toolCalls : [];
  const createCall = toolCalls.find((call) => call.toolName === 'createDocument');
  const result = createCall?.result || {};
  return Number(result.documentId || result.id || result.document?.id || result.data?.id || 0) || null;
}

async function cleanupDisposable(documentId) {
  if (!documentId) return { attempted: false, closed: false, reason: 'missing_document_id' };
  const result = await callPhotoshopToolStable('closeDocument', {
    documentId,
    save: false
  }, {
    attempts: 1,
    requestTimeoutMs: CLEANUP_REQUEST_TIMEOUT_MS
  });
  return {
    attempted: true,
    closed: result?.success === true,
    result
  };
}

async function runLiveProductPath() {
  ensureDir(EXPORT_DIR);
  const reportBase = {
    mode: 'live-disposable-product-e2e',
    endpoint: MCP_ENDPOINT,
    success: false,
    liveWriteArmed: true
  };
  let disposableDocumentId = null;
  let report = reportBase;

  try {
    const preflight = await buildPreflightReport();
    if (!preflight.ready) throw new Error(`preflight_not_ready: ${preflight.blockers.join('; ')}`);

    const assetPath = await writeFixtureImage();
    const productPath = buildProductPathContext({
      assetPath,
      connectionSource: 'live-disposable-product-e2e'
    });
    assertReadyProductPath(productPath);

    const executedTools = [];
    const adapterBuild = createMainImageLivePhotoshopToolAdapter({
      adapterContract: productPath.contract,
      approvedLiveAdapterRun: true,
      executionScope: 'disposable-document',
      executeTool: async (toolName, params) => {
        const finalParams = toolName === 'placeImage'
          ? preprocessPlaceImageParams(params)
          : params;
        executedTools.push(toolName);
        return callPhotoshopToolStable(toolName, finalParams);
      }
    });
    assert(adapterBuild.status === 'ready_for_guarded_live_adapter', 'live guarded adapter should be ready', adapterBuild);

    const runnerResult = await runMainImageLiveExecutor({
      checkpoint: productPath.checkpoint,
      adapter: adapterBuild.adapter
    });
    disposableDocumentId = extractDocumentId(runnerResult);
    assert(runnerResult.status === 'completed_requires_review', 'live product path runner should complete and require review', runnerResult);
    assert(runnerResult.canClaimOutputQuality === false, 'live runner must not claim output quality', runnerResult);
    assert(runnerResult.canClaimDesignComplete === false, 'live runner must not claim design completion', runnerResult);

    report = makeReport({
      ...reportBase,
      success: true,
      preflight,
      productPath,
      adapterBuild,
      runnerResult,
      executedTools,
      disposableDocumentId
    });
  } catch (error) {
    report = {
      ...reportBase,
      error: error instanceof Error ? error.stack || error.message : String(error)
    };
  } finally {
    try {
      report.cleanup = await cleanupDisposable(disposableDocumentId);
    } catch (error) {
      report.cleanup = {
        attempted: Boolean(disposableDocumentId),
        closed: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
    writeReport(report);
  }

  if (!report.success) process.exitCode = 1;
  return report;
}

function assertReadyProductPath(productPath) {
  assert(productPath.strategy.status === 'ready_for_strategy_contract', 'strategy input builder should be ready', productPath.strategy);
  assert(productPath.strategy.productionExecutionPlan.status === 'ready_execution_plan', 'production execution plan should be ready', productPath.strategy.productionExecutionPlan);
  assert(productPath.strategy.productionExecutorHandoff.status === 'ready_for_dry_run', 'production handoff should be dry-run ready', productPath.strategy.productionExecutorHandoff);
  assert(productPath.strategy.productionExecutorDispatchPlan.status === 'ready_for_dry_run_bridge', 'production bridge should be dry-run ready', productPath.strategy.productionExecutorDispatchPlan);
  assert(productPath.strategy.productionExecutorDryRunPreview.status === 'completed_dry_run', 'production dry-run should complete without writes', productPath.strategy.productionExecutorDryRunPreview);
  assert(productPath.strategy.liveExecutorRequestPackage.status === 'ready_for_executor_dispatch', 'live request package should be dispatch-ready', productPath.strategy.liveExecutorRequestPackage);
  assert(productPath.checkpoint.status === 'ready_for_live_executor_run', 'live checkpoint should be ready', productPath.checkpoint);
  assert(productPath.checkpoint.runGuard.executionScope === 'disposable-document', 'checkpoint must stay disposable-document scoped', productPath.checkpoint.runGuard);
  assert(productPath.contract.status === 'ready_for_disposable_photoshop_adapter', 'adapter contract should be disposable-ready', productPath.contract);
  assert(productPath.handoff.status === 'ready_for_guarded_adapter_handoff', 'live adapter handoff should be guarded-ready', productPath.handoff);
  assert(productPath.qaReport.stage === 'needs_manual_review', 'QA report should require manual review after fake runner record', productPath.qaReport);
  assertNoOverclaim(productPath.strategy, 'strategy record');
  assertNoOverclaim(productPath.checkpoint, 'checkpoint record');
  assertNoOverclaim(productPath.contract, 'adapter contract');
  assertNoOverclaim(productPath.handoff, 'adapter handoff');
  assert(productPath.qaReport.qualityClaim.allowed === false, 'QA report must not allow quality claim before screenshot/pixel/manual review', productPath.qaReport);
  assertNoRawPayload(productPath, 'ready product path');
}

function assertNoOverclaim(value, label) {
  assert(value.canClaimOutputQuality === false, `${label} must not claim output quality`, value);
  assert(value.canClaimDesignComplete === false, `${label} must not claim design completion`, value);
}

async function runSelfTest() {
  assert(shouldRunLive({}) === false, 'live mode must be off without explicit env flags');
  assert(shouldRunLive({ [LIVE_FLAG]: '1' }) === false, 'live mode must require disposable env flag too');
  assert(shouldRunLive({ [DISPOSABLE_FLAG]: '1' }) === false, 'live mode must require live env flag too');
  assert(shouldRunLive({ [LIVE_FLAG]: '1', [DISPOSABLE_FLAG]: '1' }) === true, 'live mode should arm only with both env flags');

  const productPath = buildProductPathContext({});
  assertReadyProductPath(productPath);

  const missingApproval = createMainImageLivePhotoshopToolAdapter({
    adapterContract: productPath.contract,
    executionScope: 'disposable-document',
    executeTool: async () => ({ success: true })
  });
  assert(missingApproval.status === 'blocked_requires_explicit_live_approval', 'guard must block missing explicit live approval', missingApproval);

  const activeDocument = createMainImageLivePhotoshopToolAdapter({
    adapterContract: productPath.contract,
    approvedLiveAdapterRun: true,
    executionScope: 'active-document',
    executeTool: async () => ({ success: true })
  });
  assert(activeDocument.status === 'blocked_non_disposable_scope', 'guard must block active-document scope by default', activeDocument);

  console.log(JSON.stringify({
    success: true,
    checks: [
      'live write is armed only when both live and disposable environment variables are set',
      'ready product path connects strategyInputs, liveExecutorRequestPackage, checkpoint, adapter contract, fake runner and QA report',
      'guarded Photoshop adapter blocks missing explicit live approval',
      'guarded Photoshop adapter blocks non-disposable scope',
      'ready product path does not claim output quality or design completion'
    ]
  }, null, 2));
}

function makeReport(input) {
  const productPath = input.productPath;
  const runnerResult = input.runnerResult;
  return {
    generatedAt: new Date().toISOString(),
    mode: input.mode,
    success: input.success,
    endpoint: input.endpoint || MCP_ENDPOINT,
    liveWriteArmed: input.liveWriteArmed === true,
    skippedLiveWrite: input.skippedLiveWrite === true,
    disposableDocumentId: input.disposableDocumentId || null,
    preflight: input.preflight || null,
    statuses: productPath ? {
      strategy: productPath.strategy.status,
      productionExecutionPlan: productPath.strategy.productionExecutionPlan.status,
      productionExecutorHandoff: productPath.strategy.productionExecutorHandoff.status,
      productionExecutorBridge: productPath.strategy.productionExecutorDispatchPlan.status,
      productionExecutorDryRun: productPath.strategy.productionExecutorDryRunPreview.status,
      liveExecutorRequest: productPath.strategy.liveExecutorRequestPackage.status,
      checkpoint: productPath.checkpoint.status,
      adapterContract: productPath.contract.status,
      adapterHandoff: productPath.handoff.status,
      guardedAdapter: input.adapterBuild?.status || 'not_run',
      runner: runnerResult?.status || 'not_run',
      qaReport: productPath.qaReport.stage
    } : null,
    noOverclaim: productPath && runnerResult ? {
      strategyCanClaimOutputQuality: productPath.strategy.canClaimOutputQuality,
      runnerCanClaimOutputQuality: runnerResult.canClaimOutputQuality,
      runnerCanClaimDesignComplete: runnerResult.canClaimDesignComplete,
      qaQualityClaimAllowed: productPath.qaReport.qualityClaim.allowed
    } : null,
    counts: productPath && runnerResult ? {
      plannedOperations: productPath.strategy.productionExecutionPlan.plannedOperationCount,
      dryRunOperations: productPath.strategy.productionExecutorDryRunPreview.operationCount,
      checkpointOperations: productPath.checkpoint.operationCount,
      runnerExecutedOperations: runnerResult.executedOperationCount
    } : null,
    executedTools: input.executedTools || [],
    reportFiles: {
      json: normalizePath(REPORT_JSON),
      markdown: normalizePath(REPORT_MD)
    },
    boundaries: [
      '默认 smoke 使用 fake adapter，不连接或写入 Photoshop。',
      `真实写入必须同时设置 ${LIVE_FLAG}=1 和 ${DISPOSABLE_FLAG}=1。`,
      'live 模式只允许 disposable-document，一次性文档会在 finally 中 closeDocument(save=false)。',
      'runner completed_requires_review 不是设计质量通过；QA report 仍要求结果图、pixel probe 和人工复核。'
    ]
  };
}

function writeReport(report) {
  ensureDir(TMP_DIR);
  fs.writeFileSync(REPORT_JSON, JSON.stringify(report, null, 2), 'utf8');
  fs.writeFileSync(REPORT_MD, renderMarkdown(report), 'utf8');
}

function renderMarkdown(report) {
  const lines = [
    '# Main Image Disposable Product E2E Smoke',
    '',
    `- success: ${report.success}`,
    `- mode: ${report.mode}`,
    `- liveWriteArmed: ${report.liveWriteArmed === true}`,
    `- skippedLiveWrite: ${report.skippedLiveWrite === true}`,
    `- endpoint: ${report.endpoint || MCP_ENDPOINT}`,
    report.error ? `- error: ${String(report.error).split('\n')[0]}` : '',
    '',
    '## Statuses',
    '',
    '```json',
    JSON.stringify(report.statuses || {}, null, 2),
    '```',
    '',
    '## Boundaries',
    '',
    ...(report.boundaries || []).map((item) => `- ${item}`),
    '',
    '## No Overclaim',
    '',
    '```json',
    JSON.stringify(report.noOverclaim || {}, null, 2),
    '```'
  ].filter((line) => line !== '');

  if (report.cleanup) {
    lines.push('', '## Cleanup', '', '```json', JSON.stringify(report.cleanup, null, 2), '```');
  }
  return `${lines.join('\n')}\n`;
}

async function main() {
  if (process.argv.includes('--self-test')) {
    await runSelfTest();
    return;
  }

  const report = shouldRunLive()
    ? await runLiveProductPath()
    : await runGuardedFakeProductPath();

  console.log(JSON.stringify({
    success: report.success,
    mode: report.mode,
    statuses: report.statuses,
    skippedLiveWrite: report.skippedLiveWrite === true,
    liveWriteArmed: report.liveWriteArmed === true,
    report: report.reportFiles || { json: normalizePath(REPORT_JSON), markdown: normalizePath(REPORT_MD) },
    cleanup: report.cleanup || null,
    error: report.error ? String(report.error).split('\n')[0] : null
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
