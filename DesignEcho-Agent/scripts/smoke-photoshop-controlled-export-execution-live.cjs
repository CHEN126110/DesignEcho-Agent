#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');
const { performance } = require('perf_hooks');

require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '..', 'tsconfig.main.json')
});

const repoRoot = path.resolve(__dirname, '..');
const tmpDir = path.join(repoRoot, 'tmp');
const runDir = path.join(tmpDir, 'photoshop-controlled-export-execution-live');
const exportDir = path.join(runDir, 'exports');
const jsonOut = path.join(tmpDir, 'photoshop-controlled-export-execution-live.json');
const mdOut = path.join(tmpDir, 'photoshop-controlled-export-execution-live.md');
const endpoint = process.env.MCP_ENDPOINT || 'http://127.0.0.1:8768/mcp';
const requestTimeoutMs = parsePositiveInteger(process.env.DESIGNECHO_CONTROLLED_EXPORT_LIVE_TIMEOUT_MS, 15_000);
const cleanupTimeoutMs = parsePositiveInteger(process.env.DESIGNECHO_CONTROLLED_EXPORT_LIVE_CLEANUP_TIMEOUT_MS, 8_000);
const docPrefix = 'DesignEchoControlledExportLive';

const {
  buildControlledPhotoshopExportBatchPlan,
  buildControlledPhotoshopExportToolCallPlan,
  executeControlledPhotoshopExportToolCallPlan,
  buildControlledPhotoshopExportBenchmarkReport
} = require(path.join(repoRoot, 'src', 'shared', 'photoshop-controlled-export-execution.ts'));

const requiredToolNames = [
  'createDocument',
  'createGroup',
  'createRectangle',
  'moveLayerToGroup',
  'exportGroup',
  'getLayerHierarchy',
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
    'targetGroupId',
    'newParentId',
    'outputPath',
    'width',
    'height',
    'error'
  ]) {
    if (Object.prototype.hasOwnProperty.call(result, key)) summary[key] = result[key];
  }
  if (result.data && typeof result.data === 'object') summary.data = summarizeToolResult(result.data);
  if (result.properties && typeof result.properties === 'object') {
    summary.properties = {
      id: result.properties.id,
      name: result.properties.name,
      kind: result.properties.kind,
      bounds: result.properties.bounds
    };
  }
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
    exportedFileDeleted: false,
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

  if (report.exportedPath && fs.existsSync(report.exportedPath)) {
    try {
      fs.rmSync(report.exportedPath, { force: true });
      report.cleanup.exportedFileDeleted = !fs.existsSync(report.exportedPath);
    } catch (error) {
      report.cleanup.errors.push(`delete exported file failed: ${error?.message || String(error)}`);
    }
  } else {
    report.cleanup.exportedFileDeleted = true;
  }
}

function createLiveAdapter(report) {
  return {
    runToolCall: async (call) => {
      const result = await callPhotoshopToolStable(call.tool, call.params, {
        attempts: 2,
        delayMs: 300,
        requestTimeoutMs
      });
      report.adapterToolCalls.push({
        tool: call.tool,
        params: call.params,
        result: summarizeToolResult(result)
      });
      return {
        success: result?.success === true,
        error: result?.error,
        data: result
      };
    },
    readExportedOutputPaths: async () => {
      const expectedPaths = report.controlledToolCallPlan?.verificationPlan?.expectedOutputPaths || [];
      return expectedPaths.filter((outputPath) => fs.existsSync(outputPath));
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

  return {
    ready: blockers.length === 0,
    endpoint,
    requestTimeoutMs,
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

function renderMarkdown(report) {
  return [
    '# Photoshop Controlled Export Execution Live Smoke',
    '',
    `- Generated at: ${report.generatedAt}`,
    `- Endpoint: ${report.endpoint}`,
    `- Outcome: ${report.outcome}`,
    `- Request timeout: ${report.requestTimeoutMs}ms`,
    `- Disposable document id: ${report.disposableDocumentId || 'none'}`,
    `- Exported path: ${report.exportedPath || 'none'}`,
    '',
    '## Boundary',
    '',
    '- This is a disposable-document infrastructure smoke.',
    '- It verifies controlled export tool-call wiring and exported-file existence.',
    '- It does not claim design quality, visual crop correctness, platform compliance, or business skill completion.',
    '',
    '## Preflight',
    '',
    '```json',
    JSON.stringify(report.preflight, null, 2),
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
    '## Export File',
    '',
    '```json',
    JSON.stringify(report.exportFile, null, 2),
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
  ensureDir(runDir);
  ensureDir(exportDir);

  report.preflight = await buildPreflightReport();
  assertCondition(report, 'Photoshop bridge preflight ready', report.preflight.ready === true, report.preflight);

  await cleanupStaleDocuments(report);

  const beforeDocs = await callPhotoshopToolStable('listDocuments', { includeDetails: false });
  pushStep(report, 'listDocuments.before', beforeDocs);
  const documents = normalizeDocuments(beforeDocs);
  const originalDocumentId = beforeDocs.activeDocumentId || documents.find((document) => document.isActive)?.id || documents[0]?.id;
  report.originalDocumentId = originalDocumentId || null;

  const disposableName = `${docPrefix}_${Date.now()}`;
  const exportPath = path.join(exportDir, `${disposableName}-child-group.png`).replace(/\\/g, '/');
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

    const parentGroup = await callPhotoshopToolStable('createGroup', { groupName: 'controlled_export_parent' });
    assertToolSuccess(report, 'createGroup.parent', parentGroup);
    const parentGroupId = Number(parentGroup.layerId || parentGroup.group?.id);
    assertCondition(report, 'parent group id returned', Number.isFinite(parentGroupId), { parentGroupId });

    const childGroup = await callPhotoshopToolStable('createGroup', { groupName: 'controlled_export_child' });
    assertToolSuccess(report, 'createGroup.child', childGroup);
    const childGroupId = Number(childGroup.layerId || childGroup.group?.id);
    assertCondition(report, 'child group id returned', Number.isFinite(childGroupId), { childGroupId });

    const nestChild = await callPhotoshopToolStable('moveLayerToGroup', {
      layerId: childGroupId,
      targetGroupId: parentGroupId,
      position: 'inside'
    });
    assertToolSuccess(report, 'moveLayerToGroup.childIntoParent', nestChild);
    assertCondition(report, 'child group moved into parent group', Number(nestChild.newParentId) === parentGroupId, {
      parentGroupId,
      result: summarizeToolResult(nestChild)
    });

    const rectangle = await callPhotoshopToolStable('createRectangle', {
      name: 'controlled_export_probe',
      x: 120,
      y: 110,
      width: 360,
      height: 180,
      fillColorHex: '#82A7DC',
      cornerRadius: 12
    });
    assertToolSuccess(report, 'createRectangle.probe', rectangle);
    const rectangleLayerId = Number(rectangle.layerId);
    assertCondition(report, 'rectangle layer id returned', Number.isFinite(rectangleLayerId), { rectangleLayerId });

    const moveRectangle = await callPhotoshopToolStable('moveLayerToGroup', {
      layerId: rectangleLayerId,
      targetGroupId: childGroupId,
      position: 'inside'
    });
    assertToolSuccess(report, 'moveLayerToGroup.probeIntoChild', moveRectangle);
    assertCondition(report, 'probe layer moved into child group', Number(moveRectangle.newParentId) === childGroupId, {
      childGroupId,
      result: summarizeToolResult(moveRectangle)
    });

    const hierarchy = await callPhotoshopToolStable('getLayerHierarchy', {
      includeHidden: true,
      includeBounds: true,
      flatList: true
    });
    assertToolSuccess(report, 'getLayerHierarchy.afterSetup', hierarchy);

    const properties = await callPhotoshopToolStable('getLayerProperties', { layerId: rectangleLayerId });
    assertToolSuccess(report, 'getLayerProperties.probe', properties);
    assertCondition(report, 'probe layer properties include bounds', Boolean(properties.properties?.bounds), {
      properties: summarizeToolResult(properties)
    });

    const planningStartMs = performance.now();
    const dryRun = buildControlledPhotoshopExportBatchPlan({
      kind: 'group-export-batch',
      userIntent: 'live disposable controlled export sample',
      targets: [{
        id: 'controlled-export-child-group',
        label: '受控导出子组',
        layerId: childGroupId,
        outputPath: exportPath,
        format: 'png',
        targetWidth: 640,
        targetHeight: 420
      }]
    });
    assertCondition(report, 'controlled export dry-run ready', dryRun.status === 'ready_dry_run', { dryRun });

    const toolCallPlan = buildControlledPhotoshopExportToolCallPlan(dryRun);
    assertCondition(report, 'controlled export tool-call plan ready', toolCallPlan.status === 'ready_tool_call_plan', { toolCallPlan });
    const planningMs = Math.round((performance.now() - planningStartMs) * 100) / 100;

    report.controlledDryRun = dryRun;
    report.controlledToolCallPlan = toolCallPlan;

    const executionStartMs = performance.now();
    const execution = await executeControlledPhotoshopExportToolCallPlan(
      toolCallPlan,
      createLiveAdapter(report),
      { liveExecutionApproved: true, executionTarget: 'disposable-photoshop' }
    );
    const executionMs = Math.round((performance.now() - executionStartMs) * 100) / 100;
    report.controlledExecution = execution;
    report.controlledBenchmark = buildControlledPhotoshopExportBenchmarkReport(dryRun, toolCallPlan, execution);
    report.controlledBenchmark.measurement = {
      planningMs,
      executionMs,
      totalMs: Math.round((planningMs + executionMs) * 100) / 100,
      sampleCount: 1
    };

    assertCondition(report, 'controlled export execution verified', execution.status === 'completed_verified', { execution });
    assertCondition(report, 'controlled export executed every tool call', execution.executedToolCount === toolCallPlan.toolCalls.length, {
      executedToolCount: execution.executedToolCount,
      expected: toolCallPlan.toolCalls.length
    });

    const exportedPath = execution.toolResults[0]?.data?.data?.outputPath
      || execution.toolResults[0]?.data?.outputPath
      || exportPath;
    report.exportedPath = exportedPath;
    const exportStat = fs.existsSync(exportedPath) ? fs.statSync(exportedPath) : null;
    report.exportFile = {
      exists: Boolean(exportStat),
      size: exportStat?.size || 0,
      path: exportedPath
    };
    assertCondition(report, 'exported PNG exists and is non-empty', Boolean(exportStat && exportStat.size > 0), report.exportFile);
    assertCondition(report, 'benchmark does not claim runtime speedup', report.controlledBenchmark.canClaimRuntimeSpeedup === false, {
      benchmark: report.controlledBenchmark
    });
    assertCondition(report, 'benchmark does not claim design quality', report.controlledBenchmark.canClaimDesignQuality === false, {
      benchmark: report.controlledBenchmark
    });
  } finally {
    await cleanupDocument(report, disposableDocumentId, originalDocumentId);
  }

  assertCondition(report, 'disposable document closed', report.cleanup?.disposableStillOpen === false, {
    cleanup: report.cleanup
  });
  assertCondition(report, 'temporary exported file removed after verification', report.cleanup?.exportedFileDeleted === true, {
    cleanup: report.cleanup
  });
}

async function main() {
  ensureDir(tmpDir);
  const report = {
    generatedAt: new Date().toISOString(),
    endpoint,
    requestTimeoutMs,
    outcome: 'fail',
    steps: [],
    adapterToolCalls: [],
    assertions: []
  };

  try {
    await runScenario(report);
    report.outcome = 'pass';
  } catch (error) {
    report.error = error?.stack || error?.message || String(error);
  }

  fs.writeFileSync(jsonOut, JSON.stringify(report, null, 2), 'utf8');
  fs.writeFileSync(mdOut, renderMarkdown(report), 'utf8');

  console.log(`Wrote ${jsonOut}`);
  console.log(`Wrote ${mdOut}`);
  console.log(JSON.stringify({
    connected: report.preflight?.systemStatus?.pluginConnected === true,
    outcome: report.outcome,
    disposableDocumentId: report.disposableDocumentId || null,
    controlledExecutionStatus: report.controlledExecution?.status || null,
    executedToolCount: report.controlledExecution?.executedToolCount || 0,
    exportedFileSize: report.exportFile?.size || 0,
    exportedFileDeleted: report.cleanup?.exportedFileDeleted === true,
    benchmarkStatus: report.controlledBenchmark?.status || null,
    estimatedModelRoundTripReduction: report.controlledBenchmark?.estimatedReduction?.modelDecisionRoundTrips || 0,
    measuredTotalMs: report.controlledBenchmark?.measurement?.totalMs || null,
    failedAssertions: report.assertions.filter((assertion) => !assertion.passed).map((assertion) => assertion.name),
    cleanup: report.cleanup || null,
    error: report.error ? report.error.split('\n')[0] : null
  }, null, 2));

  if (report.outcome !== 'pass') process.exit(1);
}

main().catch((error) => {
  console.error(`FAIL: ${error?.message || String(error)}`);
  process.exit(1);
});
