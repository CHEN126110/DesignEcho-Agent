#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');

require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '..', 'tsconfig.main.json')
});

const repoRoot = path.resolve(__dirname, '..');
const toolExecutor = require(path.join(repoRoot, 'src', 'renderer', 'services', 'tool-executor.service.ts'));
const {
  textFontReplaceExecutor
} = require(path.join(repoRoot, 'src', 'renderer', 'services', 'skill-executors', 'text-font-replace.executor.ts'));

const endpoint = process.env.MCP_ENDPOINT || 'http://127.0.0.1:8768/mcp';
const tmpDir = path.join(repoRoot, 'tmp');
const jsonOut = path.join(tmpDir, 'photoshop-text-font-replace-live.json');
const mdOut = path.join(tmpDir, 'photoshop-text-font-replace-live.md');
const docPrefix = 'DesignEchoTextFontReplaceLive';
const requestTimeoutMs = parsePositiveInteger(process.env.DESIGNECHO_TEXT_FONT_REPLACE_LIVE_TIMEOUT_MS, 15_000);

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function parsePositiveInteger(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.round(parsed);
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

function normalizeDocuments(value) {
  return Array.isArray(value?.documents) ? value.documents : [];
}

function hasDocument(value, documentId) {
  return normalizeDocuments(value).some((document) => Number(document?.id) === Number(documentId));
}

function disposableDocuments(value) {
  return normalizeDocuments(value).filter((document) => String(document?.name || '').startsWith(docPrefix));
}

function summarizeToolResult(result) {
  if (!result || typeof result !== 'object') return result;
  const summary = {};
  for (const key of ['success', 'documentId', 'layerId', 'count', 'activeDocumentId', 'closedDocument', 'verifiedFont']) {
    if (Object.prototype.hasOwnProperty.call(result, key)) summary[key] = result[key];
  }
  if (result.error) summary.error = result.error;
  return summary;
}

function assertCondition(report, name, passed, details = {}) {
  report.assertions.push({ name, passed: Boolean(passed), details });
  if (!passed) {
    throw new Error(`Assertion failed: ${name} ${asJson(details)}`);
  }
}

async function safeListDocuments(report, name) {
  try {
    const result = await callPhotoshopToolStable('listDocuments', { includeDetails: false });
    report.steps.push({ name, ok: result?.success !== false, summary: summarizeToolResult(result) });
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
      const closeResult = await callPhotoshopToolStable('closeDocument', { documentId, save: false }, { attempts: 8, delayMs: 400 });
      report.cleanup.closed = closeResult?.success === true;
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
      const switchResult = await callPhotoshopToolStable('switchDocument', { documentId: originalDocumentId });
      report.cleanup.restoredOriginal = switchResult?.success === true;
    } catch (error) {
      report.cleanup.errors.push(error?.message || String(error));
    }
  } else {
    report.cleanup.restoredOriginal = true;
  }
}

function findTextLayerByName(layers, name) {
  return layers.find((layer) => String(layer?.name || '') === name) || null;
}

async function createText(report, args, label) {
  const result = await callPhotoshopToolStable('createTextLayer', args, { attempts: 8, delayMs: 350 });
  report.steps.push({ name: `createTextLayer.${label}`, ok: result?.success === true, summary: summarizeToolResult(result) });
  assertCondition(report, `createTextLayer.${label} success`, result?.success === true, { result });
  const layerId = Number(result.layerId);
  assertCondition(report, `createTextLayer.${label} returns layerId`, Number.isFinite(layerId), { result });
  return layerId;
}

async function runExecutorWithLiveTools(report, params) {
  const original = toolExecutor.executeToolCall;
  toolExecutor.executeToolCall = async (toolName, toolParams) => {
    const result = await callPhotoshopToolStable(toolName, toolParams);
    report.executorToolCalls.push({
      toolName,
      params: toolParams,
      result: summarizeToolResult(result)
    });
    return result;
  };

  try {
    return await textFontReplaceExecutor.execute({
      params,
      callbacks: {},
      context: {
        userInput: 'live disposable text font replace sample',
        conversationHistory: [],
        isPluginConnected: true
      }
    });
  } finally {
    toolExecutor.executeToolCall = original;
  }
}

function renderMarkdown(report) {
  return [
    '# Photoshop Text Font Replace Live Smoke',
    '',
    `- Generated at: ${report.generatedAt}`,
    `- Endpoint: ${report.endpoint}`,
    `- Outcome: ${report.outcome}`,
    `- Disposable document id: ${report.disposableDocumentId || 'none'}`,
    '',
    '## Executor Result',
    '',
    '```json',
    JSON.stringify(report.executorResult, null, 2),
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
    report.error ? `\n## Error\n\n\`\`\`text\n${report.error}\n\`\`\`\n` : '',
    '',
    '## Boundary',
    '',
    'This sample writes the font name already read from the disposable document. It verifies executor wiring, controlled tool calls and readback, not font availability mapping or typography quality.'
  ].join('\n');
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
      width: 640,
      height: 360,
      resolution: 72,
      backgroundColor: 'white',
      colorMode: 'RGB'
    }, { attempts: 12, delayMs: 500 });
    report.steps.push({ name: 'createDocument.disposable', ok: created?.success === true, summary: summarizeToolResult(created) });
    assertCondition(report, 'create disposable document', created?.success === true, { result: created });
    disposableDocumentId = created.documentId || created.document?.id;
    report.disposableDocumentId = disposableDocumentId;

    const firstLayerId = await createText(report, {
      content: '字体替换样本 A',
      name: 'font_replace_live_A',
      x: 72,
      y: 96,
      fontSize: 32,
      colorHex: '#111111',
      alignment: 'left'
    }, 'A');
    const secondLayerId = await createText(report, {
      content: '字体替换样本 B',
      name: 'font_replace_live_B',
      x: 72,
      y: 156,
      fontSize: 28,
      colorHex: '#222222',
      alignment: 'left'
    }, 'B');

    const beforeTextLayers = await callPhotoshopToolStable('getAllTextLayers', { includeHidden: true });
    report.steps.push({ name: 'getAllTextLayers.beforeExecutor', ok: beforeTextLayers?.success === true, summary: summarizeToolResult(beforeTextLayers) });
    assertCondition(report, 'read text layers before executor', beforeTextLayers?.success === true, { result: beforeTextLayers });

    const layerA = findTextLayerByName(beforeTextLayers.layers || [], 'font_replace_live_A');
    const layerB = findTextLayerByName(beforeTextLayers.layers || [], 'font_replace_live_B');
    assertCondition(report, 'created text layers are readable', !!layerA && !!layerB, {
      firstLayerId,
      secondLayerId,
      layerA,
      layerB
    });

    const requestedFont = String(layerA?.style?.fontName || layerB?.style?.fontName || '').trim();
    report.requestedFont = requestedFont;
    assertCondition(report, 'requested font comes from Photoshop readback', requestedFont.length > 0, {
      layerAStyle: layerA?.style,
      layerBStyle: layerB?.style
    });

    const result = await runExecutorWithLiveTools(report, {
      fontName: requestedFont,
      includeHidden: true,
      layerIds: [firstLayerId, secondLayerId]
    });
    report.executorResult = result;

    assertCondition(report, 'text-font-replace executor succeeds', result?.success === true, {
      message: result?.message,
      error: result?.error,
      data: result?.data
    });
    assertCondition(
      report,
      'controlled text style execution needs external verification',
      result?.data?.controlledTextStyleBatch?.execution?.status === 'completed_needs_verification',
      result?.data?.controlledTextStyleBatch?.execution
    );
    assertCondition(
      report,
      'controlled benchmark does not overclaim design quality',
      result?.data?.controlledTextStyleBatch?.benchmark?.canClaimDesignQuality === false
        && result?.data?.controlledTextStyleBatch?.benchmark?.canClaimRuntimeSpeedup === false,
      result?.data?.controlledTextStyleBatch?.benchmark
    );
    assertCondition(
      report,
      'executor called setTextStyle for both disposable text layers',
      report.executorToolCalls.filter((call) => call.toolName === 'setTextStyle').length === 2,
      report.executorToolCalls
    );
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
    requestTimeoutMs,
    outcome: 'fail',
    steps: [],
    assertions: [],
    executorToolCalls: []
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
    requestedFont: report.requestedFont || null,
    executorSuccess: report.executorResult?.success === true,
    controlledExecutionStatus: report.executorResult?.data?.controlledTextStyleBatch?.execution?.status || null,
    setTextStyleCalls: report.executorToolCalls.filter((call) => call.toolName === 'setTextStyle').length,
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
