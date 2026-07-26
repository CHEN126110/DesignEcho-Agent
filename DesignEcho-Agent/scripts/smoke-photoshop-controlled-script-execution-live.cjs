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
const {
  buildControlledPhotoshopLayerLightnessSortPlan,
  buildControlledPhotoshopLayerLightnessSortToolCallPlan,
  buildControlledPhotoshopScriptBenchmarkReport,
  executeControlledPhotoshopToolCallPlan
} = require(path.join(repoRoot, 'src', 'shared', 'photoshop-controlled-script-execution.ts'));

const endpoint = process.env.MCP_ENDPOINT || 'http://127.0.0.1:8768/mcp';
const tmpDir = path.join(repoRoot, 'tmp');
const jsonOut = path.join(tmpDir, 'photoshop-controlled-script-execution-live.json');
const mdOut = path.join(tmpDir, 'photoshop-controlled-script-execution-live.md');
const docPrefix = 'DesignEchoControlledScriptLive';

const colorLayers = [
  { name: 'controlled_black', colorHex: '#111111', x: 36, y: 36 },
  { name: 'controlled_milk_white', colorHex: '#F2EFE7', x: 72, y: 68 },
  { name: 'controlled_middle_gray', colorHex: '#7F7F7F', x: 108, y: 100 },
  { name: 'controlled_light_gray', colorHex: '#D7D7D7', x: 144, y: 132 }
];

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

async function rpc(method, params = {}) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: Date.now() + Math.random(), method, params })
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} from ${endpoint}`);
  }
  const payload = await response.json();
  if (payload.error) {
    throw new Error(`${method} failed: ${asJson(payload.error)}`);
  }
  return payload.result;
}

function parseToolResult(result) {
  const text = result?.content?.[0]?.text || '';
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function callTool(name, args = {}) {
  return parseToolResult(await rpc('tools/call', { name, arguments: args }));
}

async function callPhotoshopTool(name, args = {}) {
  return callTool('photoshop.tools.call', { name, arguments: args });
}

function isModalState(value) {
  const text = typeof value === 'string'
    ? value
    : value?.error || value?.message || '';
  return /host is in a modal state|modal|模态状态|正在处理其他命令/i.test(String(text));
}

async function callPhotoshopToolStable(name, args = {}, options = {}) {
  const attempts = options.attempts || 6;
  const delayMs = options.delayMs || 300;
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const result = await callPhotoshopTool(name, args);
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
  return callPhotoshopTool(name, args);
}

function assertCondition(report, name, passed, details = {}) {
  report.assertions.push({ name, passed: Boolean(passed), details });
  if (!passed) {
    throw new Error(`Assertion failed: ${name} ${asJson(details)}`);
  }
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

function flatHierarchyLayers(value) {
  const layers = value?.flatList || value?.layers || value?.snapshot?.layers || [];
  return Array.isArray(layers) ? layers : [];
}

function targetTopToBottomLayerIds(hierarchy, targetIds) {
  const idSet = new Set(targetIds.map(Number));
  return flatHierarchyLayers(hierarchy)
    .filter((layer) => idSet.has(Number(layer?.id)))
    .sort((a, b) => Number(a?.index ?? 0) - Number(b?.index ?? 0))
    .map((layer) => Number(layer.id));
}

async function getHierarchy() {
  const result = await callPhotoshopToolStable('getLayerHierarchy', {
    includeHidden: true,
    includeBounds: false,
    flatList: true
  });
  if (result?.success !== true) {
    throw new Error(`getLayerHierarchy failed: ${result?.error || asJson(result)}`);
  }
  return result;
}

async function safeListDocuments(report, name) {
  try {
    const result = await callPhotoshopToolStable('listDocuments', { includeDetails: false });
    report.steps.push({ name, ok: result?.success !== false });
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
      }, { attempts: 8, delayMs: 400 });
      if (closeResult?.success === true) {
        report.staleCleanup.closed.push({ id: document.id, name: document.name });
      } else {
        report.staleCleanup.errors.push(closeResult?.error || `close failed: ${document.name}`);
      }
    } catch (error) {
      report.staleCleanup.errors.push(error?.message || String(error));
    }
  }
}

async function cleanupDocument(report, documentId, originalDocumentId) {
  report.cleanup = { attempted: false, closed: false, restoredOriginal: false, errors: [] };
  if (documentId) {
    report.cleanup.attempted = true;
    try {
      const closeResult = await callPhotoshopToolStable('closeDocument', { documentId, save: false });
      report.cleanup.closed = closeResult?.success === true;
      if (!report.cleanup.closed) {
        report.cleanup.errors.push(closeResult?.error || 'closeDocument returned success=false');
      }
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
      const switchResult = await callPhotoshopToolStable('switchDocument', { documentId: originalDocumentId });
      report.cleanup.restoredOriginal = switchResult?.success === true;
    } catch (error) {
      report.cleanup.errors.push(error?.message || String(error));
    }
  } else {
    report.cleanup.restoredOriginal = true;
  }
}

function renderMarkdown(report) {
  return [
    '# Photoshop Controlled Script Execution Live Smoke',
    '',
    `- Generated at: ${report.generatedAt}`,
    `- Endpoint: ${report.endpoint}`,
    `- Outcome: ${report.outcome}`,
    `- Disposable document id: ${report.disposableDocumentId || 'none'}`,
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

function createLiveAdapter(targetLayerIds) {
  return {
    runToolCall: async (call) => {
      const result = await callPhotoshopToolStable(call.tool, call.params);
      return {
        success: result?.success === true,
        error: result?.error,
        data: result
      };
    },
    readTargetTopToBottomLayerIds: async () => {
      const hierarchy = await getHierarchy();
      return targetTopToBottomLayerIds(hierarchy, targetLayerIds);
    }
  };
}

async function runScenario(report) {
  const systemStatus = await callTool('system.status', {});
  report.systemStatus = systemStatus;
  assertCondition(report, 'UXP plugin connected', systemStatus?.pluginConnected === true, {
    pluginConnected: systemStatus?.pluginConnected
  });

  await cleanupStaleDocuments(report);

  const beforeDocs = await callPhotoshopToolStable('listDocuments', { includeDetails: false });
  const documents = normalizeDocuments(beforeDocs);
  const originalDocumentId = beforeDocs.activeDocumentId || documents.find((document) => document.isActive)?.id || documents[0]?.id;
  report.originalDocumentId = originalDocumentId || null;

  let disposableDocumentId = null;
  try {
    const created = await callPhotoshopToolStable('createDocument', {
      name: `${docPrefix}_${Date.now()}`,
      width: 420,
      height: 260,
      resolution: 72,
      backgroundColor: 'white',
      colorMode: 'RGB'
    }, { attempts: 12, delayMs: 500 });
    assertCondition(report, 'create disposable document', created?.success === true, { result: created });
    disposableDocumentId = created.documentId || created.document?.id;
    report.disposableDocumentId = disposableDocumentId;

    const targets = [];
    for (const layer of colorLayers) {
      const result = await callPhotoshopToolStable('createRectangle', {
        name: layer.name,
        x: layer.x,
        y: layer.y,
        width: 96,
        height: 48,
        fillColorHex: layer.colorHex
      });
      assertCondition(report, `create ${layer.name}`, result?.success === true, { result });
      const layerId = Number(result.layerId);
      assertCondition(report, `${layer.name} returns layerId`, Number.isFinite(layerId), { layerId: result.layerId });
      targets.push({
        layerId,
        layerName: layer.name,
        colorHex: layer.colorHex,
        locked: false,
        visible: true,
        parentPath: []
      });
    }

    const planningStartMs = performance.now();
    const dryRun = buildControlledPhotoshopLayerLightnessSortPlan({
      kind: 'layer-lightness-sort',
      direction: 'dark-to-light',
      userIntent: '把图层颜色按从深到浅，从上到下排序',
      layers: targets
    });
    assertCondition(report, 'controlled dry-run ready', dryRun.status === 'ready_dry_run', { dryRun });

    const toolCallPlan = buildControlledPhotoshopLayerLightnessSortToolCallPlan(dryRun);
    assertCondition(report, 'controlled tool-call plan ready', toolCallPlan.status === 'ready_tool_call_plan', { toolCallPlan });
    const planningMs = Math.round((performance.now() - planningStartMs) * 100) / 100;

    const executionStartMs = performance.now();
    const execution = await executeControlledPhotoshopToolCallPlan(
      toolCallPlan,
      createLiveAdapter(targets.map((target) => target.layerId)),
      { liveExecutionApproved: true, executionTarget: 'disposable-photoshop' }
    );
    const executionMs = Math.round((performance.now() - executionStartMs) * 100) / 100;
    report.controlledDryRun = dryRun;
    report.controlledToolCallPlan = toolCallPlan;
    report.controlledExecution = execution;
    report.controlledBenchmark = buildControlledPhotoshopScriptBenchmarkReport(dryRun, toolCallPlan, execution, {
      planningMs,
      executionMs,
      totalMs: Math.round((planningMs + executionMs) * 100) / 100,
      sampleCount: 1
    });

    assertCondition(report, 'controlled execution verified', execution.status === 'completed_verified', { execution });
    assertCondition(report, 'executed every planned tool call', execution.executedToolCount === toolCallPlan.toolCalls.length, {
      executedToolCount: execution.executedToolCount,
      expected: toolCallPlan.toolCalls.length
    });
    assertCondition(report, 'benchmark does not claim runtime speedup', report.controlledBenchmark?.canClaimRuntimeSpeedup === false, {
      benchmark: report.controlledBenchmark
    });
  } finally {
    await cleanupDocument(report, disposableDocumentId, originalDocumentId);
  }

  assertCondition(report, 'disposable document closed', report.cleanup.disposableStillOpen === false, report.cleanup);
}

async function main() {
  ensureDir(tmpDir);
  const report = {
    generatedAt: new Date().toISOString(),
    endpoint,
    outcome: 'fail',
    steps: [],
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
    connected: report.systemStatus?.pluginConnected === true,
    outcome: report.outcome,
    disposableDocumentId: report.disposableDocumentId || null,
    controlledExecutionStatus: report.controlledExecution?.status || null,
    executedToolCount: report.controlledExecution?.executedToolCount || 0,
    benchmarkStatus: report.controlledBenchmark?.status || null,
    estimatedModelRoundTripReduction: report.controlledBenchmark?.estimatedReduction?.modelDecisionRoundTrips || 0,
    measuredTotalMs: report.controlledBenchmark?.measurement?.totalMs || null,
    expectedOrder: report.controlledExecution?.verificationReport?.expectedTopToBottomLayerIds || [],
    actualOrder: report.controlledExecution?.verificationReport?.actualTopToBottomLayerIds || [],
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
