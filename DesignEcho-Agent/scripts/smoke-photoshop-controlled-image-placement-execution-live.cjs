#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');

require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '..', 'tsconfig.main.json')
});

const repoRoot = path.resolve(__dirname, '..');
const tmpDir = path.join(repoRoot, 'tmp');
const runDir = path.join(tmpDir, 'photoshop-controlled-image-placement-execution-live');
const jsonOut = path.join(tmpDir, 'photoshop-controlled-image-placement-execution-live.json');
const mdOut = path.join(tmpDir, 'photoshop-controlled-image-placement-execution-live.md');
const endpoint = process.env.MCP_ENDPOINT || 'http://127.0.0.1:8768/mcp';
const requestTimeoutMs = parsePositiveInteger(process.env.DESIGNECHO_CONTROLLED_IMAGE_LIVE_TIMEOUT_MS, 15_000);
const cleanupTimeoutMs = parsePositiveInteger(process.env.DESIGNECHO_CONTROLLED_IMAGE_LIVE_CLEANUP_TIMEOUT_MS, 8_000);
const docPrefix = 'DesignEchoControlledImagePlacementLive';
const sourceImagePath = path.join(runDir, 'controlled-placement-source.png');

const {
  buildImagePlacementPlan
} = require(path.join(repoRoot, 'src', 'shared', 'design-image-placement-core.ts'));

const {
  buildControlledPhotoshopImagePlacementPlan,
  buildControlledPhotoshopImagePlacementToolCallPlan,
  executeControlledPhotoshopImagePlacementToolCallPlan,
  buildControlledPhotoshopImagePlacementBenchmarkReport
} = require(path.join(repoRoot, 'src', 'shared', 'photoshop-controlled-image-placement-execution.ts'));

const requiredToolNames = [
  'createDocument',
  'placeImage',
  'transformLayer',
  'moveLayer',
  'getLayerProperties',
  'closeDocument',
  'listDocuments'
];

function parsePositiveInteger(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.round(parsed);
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function asJson(value) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function rpc(method, params = {}, options = {}) {
  const timeoutMs = parsePositiveInteger(options.requestTimeoutMs, requestTimeoutMs);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response;

  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({ jsonrpc: '2.0', id: Date.now() + Math.random(), method, params })
    });
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error(`${method} timed out after ${timeoutMs}ms at ${endpoint}`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} from ${endpoint}`);
  }

  const payload = await response.json();
  if (payload.error) {
    throw new Error(`${method} failed: ${asJson(payload.error)}`);
  }
  return payload.result;
}

async function safeRpc(method, params = {}, options = {}) {
  try {
    return { ok: true, result: await rpc(method, params, options) };
  } catch (error) {
    return { ok: false, error: error?.message || String(error) };
  }
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

async function callTool(name, args = {}, options = {}) {
  return parseToolResult(await rpc('tools/call', { name, arguments: args }, options));
}

async function safeCallTool(name, args = {}, options = {}) {
  try {
    return { ok: true, result: await callTool(name, args, options) };
  } catch (error) {
    return { ok: false, error: error?.message || String(error) };
  }
}

async function callPhotoshopTool(name, args = {}, options = {}) {
  return callTool('photoshop.tools.call', { name, arguments: args }, options);
}

function isModalState(value) {
  const category = value?.errorDetails?.category;
  const text = typeof value === 'string'
    ? value
    : value?.error || value?.message || value?.errorDetails?.message || '';
  return category === 'modal_state'
    || /host is in a modal state|modal|模态状态|正在处理其他命令/i.test(String(text));
}

async function callPhotoshopToolStable(name, args = {}, options = {}) {
  const attempts = options.attempts || 6;
  const delayMs = options.delayMs || 300;
  const timeoutMs = parsePositiveInteger(options.requestTimeoutMs, requestTimeoutMs);
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const result = await callPhotoshopTool(name, args, { requestTimeoutMs: timeoutMs });
      if (!isModalState(result) || attempt >= attempts) {
        if (result && typeof result === 'object') result.__smokeAttempts = attempt;
        return result;
      }
    } catch (error) {
      lastError = error;
      if (!isModalState(error) || attempt >= attempts) throw error;
    }
    await sleep(delayMs * attempt);
  }

  if (lastError) throw lastError;
  return callPhotoshopTool(name, args, { requestTimeoutMs: timeoutMs });
}

function normalizeDocuments(value) {
  return Array.isArray(value?.documents) ? value.documents : [];
}

function hasDocument(value, documentId) {
  return normalizeDocuments(value).some((document) => Number(document?.id) === Number(documentId));
}

function disposableDocuments(value) {
  return normalizeDocuments(value).filter((document) => String(document?.name || '').startsWith(docPrefix));
}

function normalizeToolNames(result) {
  const tools = Array.isArray(result?.tools) ? result.tools : [];
  return tools.map((tool) => String(tool?.name || '').trim()).filter(Boolean);
}

function summarizeToolResult(result) {
  if (!result || typeof result !== 'object') return result;
  const summary = {};
  for (const key of [
    'success',
    'documentId',
    'layerId',
    'activeDocumentId',
    'closedDocument',
    'error'
  ]) {
    if (Object.prototype.hasOwnProperty.call(result, key)) summary[key] = result[key];
  }
  if (result.data && typeof result.data === 'object') {
    summary.data = summarizeToolResult(result.data);
  }
  if (result.properties && typeof result.properties === 'object') {
    summary.properties = {
      id: result.properties.id,
      name: result.properties.name,
      kind: result.properties.kind,
      bounds: result.properties.bounds
    };
  }
  if (result.newPosition) summary.newPosition = result.newPosition;
  if (result.layerBounds) summary.layerBounds = result.layerBounds;
  return summary;
}

function assertCondition(report, name, passed, details = {}) {
  report.assertions.push({ name, passed: Boolean(passed), details });
  if (!passed) {
    throw new Error(`Assertion failed: ${name} ${asJson(details)}`);
  }
}

function pushStep(report, name, result) {
  report.steps.push({
    name,
    ok: result?.success !== false,
    summary: summarizeToolResult(result)
  });
}

function assertToolSuccess(report, name, result) {
  pushStep(report, name, result);
  assertCondition(report, `${name} success`, result?.success === true, {
    result: summarizeToolResult(result)
  });
}

async function safeListDocuments(report, name) {
  try {
    const result = await callPhotoshopToolStable('listDocuments', { includeDetails: false }, {
      requestTimeoutMs: cleanupTimeoutMs
    });
    pushStep(report, name, result);
    return result;
  } catch (error) {
    report.steps.push({ name, ok: false, error: error?.message || String(error) });
    return null;
  }
}

async function cleanupStaleDocuments(report) {
  const before = await safeListDocuments(report, 'staleCleanup.listDocuments.before');
  const stale = disposableDocuments(before);
  report.staleCleanup = { attempted: stale.length > 0, closed: [], errors: [] };

  for (const document of stale) {
    try {
      const closeResult = await callPhotoshopToolStable('closeDocument', {
        documentId: document.id,
        save: false
      }, {
        attempts: 4,
        delayMs: 400,
        requestTimeoutMs: cleanupTimeoutMs
      });
      pushStep(report, `staleCleanup.close.${document.id}`, closeResult);
      if (closeResult?.success === true) {
        report.staleCleanup.closed.push({ id: document.id, name: document.name });
      } else {
        report.staleCleanup.errors.push(closeResult?.error || `closeDocument failed for ${document.name}`);
      }
    } catch (error) {
      report.staleCleanup.errors.push(error?.message || String(error));
      report.steps.push({
        name: `staleCleanup.close.${document.id}`,
        ok: false,
        error: error?.message || String(error)
      });
    }
  }
}

async function cleanupDocument(report, documentId, originalDocumentId) {
  report.cleanup = {
    attempted: false,
    closed: false,
    restoredOriginal: false,
    disposableStillOpen: null,
    errors: []
  };

  if (documentId) {
    report.cleanup.attempted = true;
    try {
      const closeResult = await callPhotoshopToolStable('closeDocument', {
        documentId,
        save: false
      }, {
        attempts: 4,
        delayMs: 400,
        requestTimeoutMs: cleanupTimeoutMs
      });
      report.cleanup.closed = closeResult?.success === true;
      pushStep(report, 'cleanup.closeDocument.disposable', closeResult);
      if (!report.cleanup.closed) report.cleanup.errors.push(closeResult?.error || 'closeDocument returned success=false');
    } catch (error) {
      report.cleanup.errors.push(error?.message || String(error));
    }
  } else {
    report.cleanup.closed = true;
  }

  const afterClose = await safeListDocuments(report, 'cleanup.listDocuments.afterClose');
  report.cleanup.disposableStillOpen = afterClose && documentId ? hasDocument(afterClose, documentId) : false;

  if (originalDocumentId && afterClose && hasDocument(afterClose, originalDocumentId)) {
    try {
      const switchResult = await callPhotoshopToolStable('switchDocument', {
        documentId: originalDocumentId
      }, {
        requestTimeoutMs: cleanupTimeoutMs
      });
      report.cleanup.restoredOriginal = switchResult?.success === true;
      pushStep(report, 'cleanup.switchDocument.original', switchResult);
    } catch (error) {
      report.cleanup.errors.push(error?.message || String(error));
    }
  } else {
    report.cleanup.restoredOriginal = true;
  }
}

function readPngDimensions(filePath) {
  const bytes = fs.readFileSync(filePath);
  const signature = bytes.subarray(0, 8).toString('hex');
  if (signature !== '89504e470d0a1a0a') {
    throw new Error(`Source image is not a PNG file: ${filePath}`);
  }
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
    byteLength: bytes.length
  };
}

async function ensureSourceImageFixture() {
  const sharp = require('sharp');
  ensureDir(runDir);
  await sharp({
    create: {
      width: 40,
      height: 40,
      channels: 4,
      background: { r: 130, g: 167, b: 220, alpha: 1 }
    }
  })
    .png()
    .toFile(sourceImagePath);
}

function normalizeBounds(bounds) {
  if (!bounds || typeof bounds !== 'object') return null;
  const left = Number(bounds.left);
  const top = Number(bounds.top);
  const right = Number(bounds.right);
  const bottom = Number(bounds.bottom);
  if (![left, top, right, bottom].every(Number.isFinite)) return null;
  return {
    x: Math.round(left),
    y: Math.round(top),
    width: Math.round(right - left),
    height: Math.round(bottom - top)
  };
}

function extractLayerId(result) {
  const direct = Number(result?.layerId);
  const nested = Number(result?.data?.layerId);
  if (Number.isFinite(direct) && direct > 0) return direct;
  if (Number.isFinite(nested) && nested > 0) return nested;
  return null;
}

function createLiveAdapter(report) {
  const layerIdsByPlacementId = new Map();

  return {
    runToolCall: async (call) => {
      const result = await callPhotoshopToolStable(call.tool, call.params, {
        attempts: 2,
        delayMs: 300,
        requestTimeoutMs
      });
      const layerId = extractLayerId(result) || Number(call.params?.layerId) || null;
      if (call.tool === 'placeImage' && layerId) {
        layerIdsByPlacementId.set(call.placementId, layerId);
      }
      report.adapterToolCalls.push({
        tool: call.tool,
        params: call.params,
        layerId,
        result: summarizeToolResult(result)
      });
      return {
        success: result?.success === true,
        layerId: layerId || undefined,
        error: result?.error,
        data: result
      };
    },
    readPlacementActualBounds: async () => {
      const actualBoundsByPlacementId = {};
      for (const [placementId, layerId] of layerIdsByPlacementId.entries()) {
        const result = await callPhotoshopToolStable('getLayerProperties', { layerId }, {
          attempts: 2,
          delayMs: 300,
          requestTimeoutMs
        });
        report.readbackToolCalls.push({
          placementId,
          layerId,
          result: summarizeToolResult(result)
        });
        actualBoundsByPlacementId[placementId] = normalizeBounds(result?.properties?.bounds);
      }
      return actualBoundsByPlacementId;
    }
  };
}

async function buildPreflightReport() {
  const toolsList = await safeRpc('tools/list', {}, { requestTimeoutMs });
  const systemStatus = toolsList.ok
    ? await safeCallTool('system.status', {}, { requestTimeoutMs })
    : { ok: false, error: 'tools/list failed; system.status skipped.' };
  const photoshopTools = systemStatus.ok && systemStatus.result?.pluginConnected === true
    ? await safeCallTool('photoshop.tools.list', {}, { requestTimeoutMs })
    : { ok: false, error: 'Photoshop plugin is not connected; photoshop.tools.list skipped.' };
  const availableToolNames = photoshopTools.ok ? normalizeToolNames(photoshopTools.result) : [];
  const missingToolNames = requiredToolNames.filter((toolName) => !availableToolNames.includes(toolName));
  const blockers = [];

  if (!toolsList.ok) blockers.push(`MCP tools/list failed: ${toolsList.error}`);
  if (!systemStatus.ok) blockers.push(`system.status failed: ${systemStatus.error}`);
  if (systemStatus.ok && systemStatus.result?.pluginConnected !== true) blockers.push('Photoshop UXP plugin is not connected.');
  if (!photoshopTools.ok) blockers.push(`photoshop.tools.list failed: ${photoshopTools.error}`);
  if (missingToolNames.length > 0) blockers.push(`Missing Photoshop tools: ${missingToolNames.join(', ')}`);
  if (!fs.existsSync(sourceImagePath)) blockers.push(`Missing source image: ${sourceImagePath}`);

  return {
    ready: blockers.length === 0,
    endpoint,
    requestTimeoutMs,
    sourceImagePath,
    toolsListOk: toolsList.ok,
    systemStatus: systemStatus.ok ? {
      ok: true,
      pluginConnected: systemStatus.result?.pluginConnected === true,
      pluginConnectionState: systemStatus.result?.pluginConnectionState || null,
      pluginConnectionDiagnostics: systemStatus.result?.pluginConnectionDiagnostics || null
    } : {
      ok: false,
      error: systemStatus.error
    },
    photoshopToolsOk: photoshopTools.ok,
    availableToolNames,
    missingToolNames,
    blockers
  };
}

function buildControlledPlans(imageInfo) {
  const source = {
    width: imageInfo.width,
    height: imageInfo.height,
    path: sourceImagePath,
    role: 'icon',
    subjectBox: {
      x: 0,
      y: 0,
      width: imageInfo.width,
      height: imageInfo.height
    }
  };
  const targetBox = {
    x: 180,
    y: 120,
    width: imageInfo.width * 3,
    height: imageInfo.height * 3
  };
  const placementPlan = buildImagePlacementPlan({
    source,
    target: {
      box: targetBox,
      safeBox: { x: 80, y: 60, width: 420, height: 260 },
      slotId: 'live-controlled-icon-slot',
      slotRole: 'probe-image'
    },
    canvas: { width: 640, height: 420 },
    designType: 'generic',
    assetRole: 'icon',
    intent: 'supporting',
    cropPolicy: 'contain',
    executionTool: 'placeImage'
  });
  const controlledPlan = buildControlledPhotoshopImagePlacementPlan({
    kind: 'image-slot-placement',
    userIntent: 'verify controlled image placement execution on a disposable Photoshop document',
    targets: [{
      id: 'live-icon-placement',
      label: 'Live icon placement',
      sourcePath: sourceImagePath,
      imageFormat: 'png',
      layerName: 'controlled_image_live_icon',
      placementPlan
    }]
  });
  const sourcePlansByPlacementId = {
    'live-icon-placement': placementPlan
  };
  const controlledToolCallPlan = buildControlledPhotoshopImagePlacementToolCallPlan(
    controlledPlan,
    sourcePlansByPlacementId
  );
  return {
    placementPlan,
    controlledPlan,
    controlledToolCallPlan
  };
}

function resolveExecutionPassed(executionResult) {
  return executionResult?.status === 'completed_bounds_verified'
    || executionResult?.status === 'completed_bounds_needs_review';
}

function renderMarkdown(report) {
  return [
    '# Photoshop Controlled Image Placement Execution Live Smoke',
    '',
    `- Generated at: ${report.generatedAt}`,
    `- Endpoint: ${report.endpoint}`,
    `- Outcome: ${report.outcome}`,
    `- Request timeout: ${report.requestTimeoutMs}ms`,
    `- Disposable document id: ${report.disposableDocumentId || 'none'}`,
    `- Source image: ${report.sourceImagePath}`,
    '',
    '## Boundary',
    '',
    '- This is a disposable-document infrastructure smoke.',
    '- It verifies controlled placeImage -> transformLayer -> moveLayer -> getLayerProperties wiring.',
    '- It only checks geometry readback; it does not claim design quality, visual balance, crop aesthetics, product identity or business skill completion.',
    '',
    '## Preflight',
    '',
    '```json',
    JSON.stringify(report.preflight, null, 2),
    '```',
    '',
    '## Controlled Plan',
    '',
    '```json',
    JSON.stringify({
      placementPlan: report.placementPlan,
      controlledPlan: report.controlledPlan,
      controlledToolCallPlan: report.controlledToolCallPlan
    }, null, 2),
    '```',
    '',
    '## Controlled Execution',
    '',
    '```json',
    JSON.stringify(report.controlledExecution, null, 2),
    '```',
    '',
    '## Benchmark',
    '',
    '```json',
    JSON.stringify(report.controlledBenchmark, null, 2),
    '```',
    '',
    '## Adapter Calls',
    '',
    '```json',
    JSON.stringify({
      writes: report.adapterToolCalls,
      readbacks: report.readbackToolCalls
    }, null, 2),
    '```',
    '',
    '## Assertions',
    '',
    '```json',
    JSON.stringify(report.assertions, null, 2),
    '```',
    '',
    '## Cleanup',
    '',
    '```json',
    JSON.stringify(report.cleanup, null, 2),
    '```',
    report.error ? `\n## Error\n\n\`\`\`text\n${report.error}\n\`\`\`\n` : ''
  ].join('\n');
}

async function runScenario(report) {
  ensureDir(tmpDir);
  await ensureSourceImageFixture();

  report.preflight = await buildPreflightReport();
  assertCondition(report, 'Photoshop bridge preflight ready', report.preflight.ready === true, report.preflight);

  await cleanupStaleDocuments(report);

  const beforeDocs = await callPhotoshopToolStable('listDocuments', { includeDetails: false });
  pushStep(report, 'listDocuments.before', beforeDocs);
  const documents = normalizeDocuments(beforeDocs);
  const originalDocumentId = beforeDocs.activeDocumentId || documents.find((document) => document.isActive)?.id || documents[0]?.id;
  report.originalDocumentId = originalDocumentId || null;

  const imageInfo = readPngDimensions(sourceImagePath);
  report.sourceImage = imageInfo;
  const plans = buildControlledPlans(imageInfo);
  report.placementPlan = plans.placementPlan;
  report.controlledPlan = plans.controlledPlan;
  report.controlledToolCallPlan = plans.controlledToolCallPlan;

  assertCondition(report, 'image placement plan is ready', plans.placementPlan.status === 'ready', {
    status: plans.placementPlan.status,
    warnings: plans.placementPlan.warnings
  });
  assertCondition(report, 'controlled dry-run plan is ready', plans.controlledPlan.status === 'ready_dry_run', plans.controlledPlan);
  assertCondition(report, 'controlled tool-call plan is ready', plans.controlledToolCallPlan.status === 'ready_tool_call_plan', plans.controlledToolCallPlan);

  const blockedExecution = await executeControlledPhotoshopImagePlacementToolCallPlan(
    plans.controlledToolCallPlan,
    createLiveAdapter(report),
    { executionTarget: 'disposable-photoshop' }
  );
  report.blockedExecution = blockedExecution;
  assertCondition(report, 'live execution requires explicit approval', blockedExecution.status === 'blocked_explicit_live_approval_required', {
    status: blockedExecution.status
  });

  const disposableName = `${docPrefix}_${Date.now()}`;
  let disposableDocumentId = null;

  try {
    const createDocument = await callPhotoshopToolStable('createDocument', {
      name: disposableName,
      width: 640,
      height: 420,
      resolution: 72,
      backgroundColor: 'white',
      colorMode: 'RGB'
    }, {
      attempts: 10,
      delayMs: 500
    });
    assertToolSuccess(report, 'createDocument.disposable', createDocument);
    disposableDocumentId = Number(createDocument.documentId || createDocument.document?.id);
    report.disposableDocumentId = disposableDocumentId;
    assertCondition(report, 'disposable document id returned', Number.isFinite(disposableDocumentId), {
      disposableDocumentId
    });

    const adapter = createLiveAdapter(report);
    const controlledExecution = await executeControlledPhotoshopImagePlacementToolCallPlan(
      plans.controlledToolCallPlan,
      adapter,
      {
        liveExecutionApproved: true,
        executionTarget: 'disposable-photoshop'
      }
    );
    report.controlledExecution = controlledExecution;
    report.controlledBenchmark = buildControlledPhotoshopImagePlacementBenchmarkReport(
      plans.controlledPlan,
      plans.controlledToolCallPlan,
      controlledExecution
    );

    assertCondition(report, 'controlled execution finished with bounds readback', resolveExecutionPassed(controlledExecution), {
      status: controlledExecution.status,
      verificationReport: controlledExecution.verificationReport,
      blockers: controlledExecution.blockers,
      warnings: controlledExecution.warnings
    });
    assertCondition(report, 'controlled execution ran every planned write tool', controlledExecution.executedToolCount === plans.controlledToolCallPlan.toolCalls.length, {
      executedToolCount: controlledExecution.executedToolCount,
      plannedToolCallCount: plans.controlledToolCallPlan.toolCalls.length
    });
    assertCondition(report, 'verification report recorded the checked placement', controlledExecution.verificationReport.placements.length === 1, {
      placements: controlledExecution.verificationReport.placements
    });
    assertCondition(report, 'controlled benchmark remains no-overclaim', report.controlledBenchmark.canClaimDesignQuality === false
      && report.controlledBenchmark.canClaimRuntimeSpeedup === false
      && report.controlledBenchmark.canClaimDesignComplete === false, report.controlledBenchmark);
  } finally {
    await cleanupDocument(report, disposableDocumentId, originalDocumentId);
  }

  assertCondition(report, 'disposable document closed', report.cleanup.closed === true && report.cleanup.disposableStillOpen === false, report.cleanup);
}

async function main() {
  const report = {
    generatedAt: new Date().toISOString(),
    endpoint,
    requestTimeoutMs,
    sourceImagePath,
    outcome: 'failed',
    steps: [],
    assertions: [],
    adapterToolCalls: [],
    readbackToolCalls: []
  };

  try {
    await runScenario(report);
    report.outcome = 'passed';
  } catch (error) {
    report.outcome = 'failed';
    report.error = error?.stack || error?.message || String(error);
    process.exitCode = 1;
  } finally {
    ensureDir(tmpDir);
    fs.writeFileSync(jsonOut, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    fs.writeFileSync(mdOut, `${renderMarkdown(report)}\n`, 'utf8');
    console.log(`controlled image placement live smoke ${report.outcome}`);
    console.log(`json: ${jsonOut}`);
    console.log(`md: ${mdOut}`);
  }
}

main();
