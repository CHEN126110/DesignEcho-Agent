#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TMP_DIR = path.join(ROOT, 'tmp');
const JSON_OUT = path.join(TMP_DIR, 'photoshop-layer-write-failures-live-smoke.json');
const MD_OUT = path.join(TMP_DIR, 'photoshop-layer-write-failures-live-smoke.md');
const endpoint = process.env.MCP_ENDPOINT || 'http://127.0.0.1:8768/mcp';
const DOC_PREFIX = 'DesignEchoLayerWritesLive';
const MISSING_LAYER_ID = -987654321;

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

function isHostModalState(value) {
  const text = typeof value === 'string'
    ? value
    : value?.error || value?.message || '';
  return /host is in a modal state|modal|模态状态|正在处理其他命令/i.test(String(text));
}

async function callPhotoshopToolStable(name, args = {}, options = {}) {
  const attempts = options.attempts || 5;
  const delayMs = options.delayMs || 250;
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const result = await callPhotoshopTool(name, args);
      if (!isHostModalState(result) || attempt >= attempts) {
        if (result && typeof result === 'object') result.__smokeAttempts = attempt;
        return result;
      }
    } catch (error) {
      lastError = error;
      if (!isHostModalState(error) || attempt >= attempts) throw error;
    }
    await sleep(delayMs * attempt);
  }

  if (lastError) throw lastError;
  return callPhotoshopTool(name, args);
}

function normalizeDocuments(listResult) {
  return Array.isArray(listResult?.documents) ? listResult.documents : [];
}

function hasDocument(listResult, documentId) {
  return normalizeDocuments(listResult).some((doc) => Number(doc?.id) === Number(documentId));
}

function summarizeResult(result) {
  if (!result || typeof result !== 'object') return result;
  const summary = {};
  for (const key of ['success', 'documentId', 'layerId', 'layerName', 'opacity', 'blendMode', 'effect', 'error']) {
    if (Object.prototype.hasOwnProperty.call(result, key)) summary[key] = result[key];
  }
  if (result.errorDetails) {
    summary.errorDetails = {
      handledBy: result.errorDetails.handledBy,
      toolName: result.errorDetails.toolName,
      category: result.errorDetails.category,
      retryable: result.errorDetails.retryable,
      popupRisk: result.errorDetails.popupRisk,
      paramsSummary: result.errorDetails.paramsSummary
    };
  }
  return summary;
}

function addStep(report, name, result) {
  report.steps.push({ name, ok: result?.success !== false, summary: summarizeResult(result) });
}

function assertCondition(report, name, passed, details = {}) {
  report.assertions.push({ name, passed: Boolean(passed), details });
  if (!passed) {
    throw new Error(`Assertion failed: ${name} ${asJson(details)}`);
  }
}

function assertToolSuccess(report, name, result) {
  addStep(report, name, result);
  assertCondition(report, `${name} success`, result?.success === true, {
    result: summarizeResult(result)
  });
}

function assertFailureEnvelope(report, name, result, expectedToolName) {
  addStep(report, name, result);
  assertCondition(report, `${name} returns failure`, result?.success === false, {
    result: summarizeResult(result)
  });
  assertCondition(report, `${name} has normalizer evidence`, result?.errorDetails?.handledBy === 'tool-error-normalizer/v1', {
    result: summarizeResult(result)
  });
  assertCondition(report, `${name} keeps actual tool name`, result?.errorDetails?.toolName === expectedToolName, {
    actual: result?.errorDetails?.toolName,
    expected: expectedToolName
  });
}

async function safeListDocuments(report, name) {
  try {
    const result = await callPhotoshopToolStable('listDocuments', { includeDetails: false });
    addStep(report, name, result);
    return result;
  } catch (error) {
    report.steps.push({ name, ok: false, error: error?.message || String(error) });
    return null;
  }
}

async function cleanupDisposable(report, disposableDocumentId, originalDocumentId) {
  const cleanup = { attempted: false, closed: false, restoredOriginal: false, errors: [] };
  report.cleanup = cleanup;
  if (!disposableDocumentId) {
    cleanup.closed = true;
    cleanup.restoredOriginal = true;
    return cleanup;
  }

  cleanup.attempted = true;
  const beforeCleanup = await safeListDocuments(report, 'cleanup.listDocuments.before');
  if (!beforeCleanup || hasDocument(beforeCleanup, disposableDocumentId)) {
    try {
      const closeResult = await callPhotoshopToolStable('closeDocument', {
        documentId: disposableDocumentId,
        save: false
      });
      addStep(report, 'cleanup.closeDisposableWithoutSaving', closeResult);
      cleanup.closed = closeResult?.success === true;
      if (!cleanup.closed) cleanup.errors.push(closeResult?.error || 'closeDocument returned success=false');
    } catch (error) {
      cleanup.errors.push(error?.message || String(error));
      report.steps.push({ name: 'cleanup.closeDisposableWithoutSaving', ok: false, error: error?.message || String(error) });
    }
  } else {
    cleanup.closed = true;
  }

  const afterClose = await safeListDocuments(report, 'cleanup.listDocuments.afterClose');
  cleanup.disposableStillOpen = afterClose ? hasDocument(afterClose, disposableDocumentId) : 'unknown';

  if (originalDocumentId && afterClose && hasDocument(afterClose, originalDocumentId)) {
    try {
      const switchResult = await callPhotoshopToolStable('switchDocument', { documentId: originalDocumentId });
      addStep(report, 'cleanup.switchBackOriginal', switchResult);
      cleanup.restoredOriginal = switchResult?.success === true;
      if (!cleanup.restoredOriginal) cleanup.errors.push(switchResult?.error || 'switchDocument returned success=false');
    } catch (error) {
      cleanup.errors.push(error?.message || String(error));
      report.steps.push({ name: 'cleanup.switchBackOriginal', ok: false, error: error?.message || String(error) });
    }
  } else {
    cleanup.restoredOriginal = true;
  }

  return cleanup;
}

function renderMarkdown(report) {
  return [
    '# Photoshop Layer Write Failures Live Smoke',
    '',
    `- Generated at: ${report.generatedAt}`,
    `- Endpoint: ${report.endpoint}`,
    `- Outcome: ${report.outcome}`,
    `- Disposable document id: ${report.disposableDocumentId || 'none'}`,
    `- Disposable layer id: ${report.layerId || 'none'}`,
    `- Cleanup closed disposable: ${report.cleanup?.closed ? 'yes' : 'no'}`,
    '',
    '## Assertions',
    '',
    '```json',
    JSON.stringify(report.assertions, null, 2),
    '```',
    '',
    '## Steps',
    '',
    '```json',
    JSON.stringify(report.steps, null, 2),
    '```',
    ''
  ].join('\n');
}

async function runScenario(report) {
  const systemStatus = await callTool('system.status', {});
  report.systemStatus = systemStatus;
  assertCondition(report, 'Photoshop UXP plugin connected', systemStatus?.pluginConnected === true, {
    pluginConnected: systemStatus?.pluginConnected
  });

  const beforeDocs = await callPhotoshopToolStable('listDocuments', { includeDetails: false });
  assertToolSuccess(report, 'listDocuments.before', beforeDocs);
  const documents = normalizeDocuments(beforeDocs);
  const originalDocumentId = beforeDocs.activeDocumentId || documents.find((doc) => doc.isActive)?.id || documents[0]?.id;
  report.originalDocumentId = originalDocumentId || null;

  const createDocument = await callPhotoshopToolStable('createDocument', {
    name: `${DOC_PREFIX}_${Date.now()}`,
    width: 360,
    height: 260,
    resolution: 72,
    backgroundColor: 'white'
  });
  assertToolSuccess(report, 'createDocument.disposable', createDocument);
  const disposableDocumentId = createDocument.documentId || createDocument.document?.id || createDocument.id;
  report.disposableDocumentId = disposableDocumentId;

  try {
    const shape = await callPhotoshopToolStable('createRectangle', {
      x: 64,
      y: 56,
      width: 160,
      height: 110,
      fillColorHex: '#8899AA',
      name: 'layer_write_probe'
    });
    assertToolSuccess(report, 'createRectangle.probe', shape);
    const layerId = Number(shape.layerId);
    report.layerId = layerId;

    const opacity = await callPhotoshopToolStable('setLayerOpacity', { layerId, opacity: 72 });
    assertToolSuccess(report, 'setLayerOpacity.success', opacity);

    const blendMode = await callPhotoshopToolStable('setBlendMode', { layerId, blendMode: 'multiply' });
    assertToolSuccess(report, 'setBlendMode.success', blendMode);

    const stroke = await callPhotoshopToolStable('addStroke', {
      layerId,
      size: 4,
      position: 'center',
      opacity: 100,
      color: { r: 255, g: 0, b: 0 }
    });
    assertToolSuccess(report, 'addStroke.success', stroke);

    const shadow = await callPhotoshopToolStable('addDropShadow', {
      layerId,
      opacity: 50,
      angle: 120,
      distance: 6,
      spread: 0,
      size: 8,
      color: { r: 0, g: 0, b: 0 }
    });
    assertToolSuccess(report, 'addDropShadow.success', shadow);

    const clearEffects = await callPhotoshopToolStable('clearLayerEffects', { layerId });
    assertToolSuccess(report, 'clearLayerEffects.success', clearEffects);

    const missingOpacity = await callPhotoshopToolStable('setLayerOpacity', {
      layerId: MISSING_LAYER_ID,
      opacity: 50
    });
    assertFailureEnvelope(report, 'setLayerOpacity.missingLayer', missingOpacity, 'setLayerOpacity');

    const missingStroke = await callPhotoshopToolStable('addStroke', {
      layerId: MISSING_LAYER_ID,
      size: 2,
      color: { r: 0, g: 0, b: 0 }
    });
    assertFailureEnvelope(report, 'addStroke.missingLayer', missingStroke, 'addStroke');
  } finally {
    await cleanupDisposable(report, disposableDocumentId, report.originalDocumentId);
  }

  assertCondition(report, 'cleanup closed disposable document', report.cleanup?.closed === true, report.cleanup || {});
  assertCondition(report, 'cleanup restored original document', report.cleanup?.restoredOriginal === true, report.cleanup || {});
}

async function main() {
  ensureDir(TMP_DIR);
  const report = {
    generatedAt: new Date().toISOString(),
    endpoint,
    outcome: 'pending',
    steps: [],
    assertions: [],
    cleanup: null
  };

  try {
    await runScenario(report);
    report.outcome = 'pass';
  } catch (error) {
    report.outcome = 'fail';
    report.error = error?.message || String(error);
    throw error;
  } finally {
    fs.writeFileSync(JSON_OUT, JSON.stringify(report, null, 2));
    fs.writeFileSync(MD_OUT, renderMarkdown(report));
    console.log(`Wrote ${JSON_OUT}`);
    console.log(`Wrote ${MD_OUT}`);
    console.log(JSON.stringify({
      connected: report.systemStatus?.pluginConnected === true,
      outcome: report.outcome,
      assertions: {
        pass: report.assertions.filter((item) => item.passed).length,
        fail: report.assertions.filter((item) => !item.passed).length
      },
      cleanup: report.cleanup
    }, null, 2));
  }
}

main().catch((error) => {
  console.error(`FAIL: ${error?.message || String(error)}`);
  process.exit(1);
});
