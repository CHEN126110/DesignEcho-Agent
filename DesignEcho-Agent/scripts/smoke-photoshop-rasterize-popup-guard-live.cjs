#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TMP_DIR = path.join(ROOT, 'tmp');
const JSON_OUT = path.join(TMP_DIR, 'photoshop-rasterize-popup-guard-live.json');
const MD_OUT = path.join(TMP_DIR, 'photoshop-rasterize-popup-guard-live.md');
const endpoint = process.env.MCP_ENDPOINT || 'http://127.0.0.1:8768/mcp';
const requestTimeoutMs = parsePositiveInteger(
  process.env.DESIGNECHO_RASTERIZE_POPUP_GUARD_TIMEOUT_MS,
  12_000
);
const cleanupTimeoutMs = parsePositiveInteger(
  process.env.DESIGNECHO_RASTERIZE_POPUP_GUARD_CLEANUP_TIMEOUT_MS,
  8_000
);
const docPrefix = 'DesignEchoRasterizePopupGuardLive';
const requiredPhotoshopTools = [
  'createDocument',
  'createRectangle',
  'convertToSmartObject',
  'rasterizeSmartObject',
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

async function callPhotoshopTool(name, args = {}, options = {}) {
  return callTool('photoshop.tools.call', { name, arguments: args }, options);
}

function isModalStatePayload(payload) {
  const category = payload?.errorDetails?.category;
  const message = payload?.error || payload?.message || payload?.errorDetails?.message || '';
  return category === 'modal_state'
    || /host is in a modal state|modal|模态状态|正在处理其他命令/i.test(String(message));
}

async function callPhotoshopToolStable(name, args = {}, options = {}) {
  const attempts = options.attempts || 6;
  const delayMs = options.delayMs || 250;
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const result = await callPhotoshopTool(name, args, options);
      if (!isModalStatePayload(result) || attempt >= attempts) {
        if (result && typeof result === 'object') result.__smokeAttempts = attempt;
        return result;
      }
    } catch (error) {
      lastError = error;
      if (!isModalStatePayload(error) || attempt >= attempts) throw error;
    }
    await sleep(delayMs * attempt);
  }

  if (lastError) throw lastError;
  return callPhotoshopTool(name, args, options);
}

function normalizeToolNames(result) {
  const tools = Array.isArray(result?.tools) ? result.tools : [];
  return tools.map((tool) => String(tool?.name || '').trim()).filter(Boolean);
}

function getToolInputProperties(tool) {
  const inputSchema = tool?.inputSchema || tool?.parameters || tool?.schema?.inputSchema || tool?.schema?.parameters || {};
  return inputSchema?.properties || {};
}

function findTool(runtimeTools, toolName) {
  const tools = Array.isArray(runtimeTools?.tools) ? runtimeTools.tools : [];
  return tools.find((tool) => tool?.name === toolName) || null;
}

function normalizeDocuments(value) {
  return Array.isArray(value?.documents) ? value.documents : [];
}

function disposableDocuments(value) {
  return normalizeDocuments(value).filter((document) => String(document?.name || '').startsWith(docPrefix));
}

function summarizeToolResult(result) {
  if (!result || typeof result !== 'object') return result;
  const summary = {};
  for (const key of [
    'success',
    'entityType',
    'documentId',
    'layerId',
    'closedDocument',
    'error'
  ]) {
    if (Object.prototype.hasOwnProperty.call(result, key)) summary[key] = result[key];
  }
  if (result.errorDetails) {
    summary.errorDetails = {
      handledBy: result.errorDetails.handledBy,
      toolName: result.errorDetails.toolName,
      category: result.errorDetails.category,
      message: result.errorDetails.message
    };
  }
  return summary;
}

function pushStep(report, name, result) {
  report.steps.push({
    name,
    ok: result?.success !== false,
    summary: summarizeToolResult(result)
  });
  writeReport(report);
}

function assertCondition(report, name, passed, details = {}) {
  report.assertions.push({ name, passed: Boolean(passed), details });
  writeReport(report);
  if (!passed) {
    throw new Error(`Assertion failed: ${name} ${asJson(details)}`);
  }
}

function assertToolSuccess(report, name, result) {
  pushStep(report, name, result);
  assertCondition(report, `${name} success`, result?.success === true, {
    result: summarizeToolResult(result)
  });
}

function isStructuredRasterizeFailure(payload) {
  const message = String(payload?.error || payload?.message || payload?.errorDetails?.message || '');
  return payload?.success === false
    && payload?.errorDetails?.handledBy === 'tool-error-normalizer/v1'
    && payload?.errorDetails?.toolName === 'rasterizeSmartObject'
    && /destructiveRasterizeConfirmed|原生 rasterizeLayer|栅格化|rasterize/i.test(message);
}

async function closeDocumentBestEffort(report, documentId, name) {
  if (typeof documentId !== 'number') return;
  try {
    const result = await callPhotoshopToolStable('closeDocument', {
      documentId,
      save: false
    }, { requestTimeoutMs: cleanupTimeoutMs });
    report.cleanup.closed.push({ name, documentId, result: summarizeToolResult(result) });
  } catch (error) {
    report.cleanup.errors.push({ name, documentId, error: error?.message || String(error) });
  }
  writeReport(report);
}

async function cleanupStaleDocuments(report) {
  try {
    const before = await callPhotoshopToolStable('listDocuments', { includeDetails: false }, {
      requestTimeoutMs: cleanupTimeoutMs
    });
    const stale = disposableDocuments(before);
    report.cleanup.staleCount = stale.length;
    writeReport(report);
    for (const document of stale) {
      await closeDocumentBestEffort(report, Number(document.id), document.name || 'stale-disposable');
    }
  } catch (error) {
    report.cleanup.errors.push({
      name: 'staleCleanup.listDocuments',
      error: error?.message || String(error)
    });
    writeReport(report);
  }
}

function renderMarkdown(report) {
  const lines = [];
  lines.push('# Photoshop Rasterize Popup Guard Live Smoke');
  lines.push('');
  lines.push(`- Generated at: ${report.generatedAt}`);
  lines.push(`- Endpoint: ${report.endpoint}`);
  lines.push(`- Status: ${report.status}`);
  lines.push(`- Disposable document: ${report.disposableDocument?.name || 'n/a'}`);
  lines.push('');
  lines.push('## Boundary');
  lines.push('');
  lines.push('- This smoke proves the default rasterizeSmartObject path is blocked before Photoshop native rasterize.');
  lines.push('- This smoke does not prove rasterize functionality or design quality.');
  lines.push('- This smoke never sends destructiveRasterizeConfirmed=true.');
  lines.push('');
  lines.push('## Runtime Guards');
  lines.push('');
  lines.push('```json');
  lines.push(JSON.stringify(report.runtimeGuards, null, 2));
  lines.push('```');
  lines.push('');
  lines.push('## Steps');
  lines.push('');
  lines.push('```json');
  lines.push(JSON.stringify(report.steps, null, 2));
  lines.push('```');
  lines.push('');
  lines.push('## Assertions');
  lines.push('');
  lines.push('```json');
  lines.push(JSON.stringify(report.assertions, null, 2));
  lines.push('```');
  lines.push('');
  lines.push('## Cleanup');
  lines.push('');
  lines.push('```json');
  lines.push(JSON.stringify(report.cleanup, null, 2));
  lines.push('```');
  lines.push('');
  return lines.join('\n');
}

function writeReport(report) {
  ensureDir(TMP_DIR);
  fs.writeFileSync(JSON_OUT, JSON.stringify(report, null, 2));
  fs.writeFileSync(MD_OUT, renderMarkdown(report));
}

function createInitialReport() {
  return {
    generatedAt: new Date().toISOString(),
    endpoint,
    status: 'running',
    runtimeGuards: [],
    steps: [],
    assertions: [],
    cleanup: {
      staleCount: 0,
      closed: [],
      errors: []
    },
    disposableDocument: null
  };
}

async function main() {
  const report = createInitialReport();
  let createdDoc = null;
  writeReport(report);

  try {
    const systemStatus = await callTool('system.status', {});
    report.systemStatus = systemStatus;
    writeReport(report);
    assertCondition(report, 'UXP plugin connected', systemStatus?.pluginConnected === true, {
      pluginConnected: systemStatus?.pluginConnected
    });

    const runtimeTools = await callTool('photoshop.tools.list', {});
    report.runtimeGuards.push({
      name: 'photoshop.tools.list',
      status: 'passed',
      toolCount: Array.isArray(runtimeTools?.tools) ? runtimeTools.tools.length : 0
    });
    writeReport(report);

    const runtimeToolNames = normalizeToolNames(runtimeTools);
    const missingTools = requiredPhotoshopTools.filter((toolName) => !runtimeToolNames.includes(toolName));
    assertCondition(report, 'required Photoshop tools available', missingTools.length === 0, {
      missingTools,
      availableToolCount: runtimeToolNames.length
    });

    const rasterizeTool = findTool(runtimeTools, 'rasterizeSmartObject');
    const rasterizeProperties = getToolInputProperties(rasterizeTool);
    const confirmationProperty = rasterizeProperties.destructiveRasterizeConfirmed;
    const runtimeSchemaGuard = {
      name: 'rasterizeSmartObject schema guard',
      status: confirmationProperty?.type === 'boolean' || Boolean(confirmationProperty) ? 'passed' : 'failed',
      propertyNames: Object.keys(rasterizeProperties),
      destructiveRasterizeConfirmed: confirmationProperty || null
    };
    report.runtimeGuards.push(runtimeSchemaGuard);
    writeReport(report);
    assertCondition(report, 'rasterizeSmartObject declares destructive confirmation', Boolean(confirmationProperty), runtimeSchemaGuard);
    assertCondition(report, 'destructiveRasterizeConfirmed is boolean when typed', !confirmationProperty.type || confirmationProperty.type === 'boolean', runtimeSchemaGuard);

    await cleanupStaleDocuments(report);

    const docName = `${docPrefix}-${Date.now()}`;
    createdDoc = await callPhotoshopToolStable('createDocument', {
      width: 320,
      height: 240,
      name: docName,
      backgroundColor: 'white'
    });
    report.disposableDocument = { name: docName, documentId: createdDoc?.documentId };
    assertToolSuccess(report, 'createDocument', createdDoc);
    assertCondition(report, 'created document id', typeof createdDoc?.documentId === 'number', {
      documentId: createdDoc?.documentId
    });

    const rectangle = await callPhotoshopToolStable('createRectangle', {
      x: 70,
      y: 55,
      width: 130,
      height: 90,
      fillColorHex: '#7FA3D8',
      name: 'Rasterize Popup Guard Rectangle'
    });
    assertToolSuccess(report, 'createRectangle', rectangle);
    assertCondition(report, 'created rectangle layer id', typeof rectangle?.layerId === 'number', {
      layerId: rectangle?.layerId
    });

    const smartObject = await callPhotoshopToolStable('convertToSmartObject', {
      layerIds: [rectangle.layerId],
      name: 'Rasterize Popup Guard Smart Object'
    });
    assertToolSuccess(report, 'convertToSmartObject', smartObject);
    assertCondition(report, 'converted Smart Object layer id', typeof smartObject?.layerId === 'number', {
      layerId: smartObject?.layerId,
      entityType: smartObject?.entityType
    });

    const blockedRasterize = await callPhotoshopToolStable('rasterizeSmartObject', {
      layerId: smartObject.layerId
    });
    pushStep(report, 'rasterizeSmartObject.defaultBlocked', blockedRasterize);
    assertCondition(report, 'rasterizeSmartObject default path is structured failure', isStructuredRasterizeFailure(blockedRasterize), {
      result: summarizeToolResult(blockedRasterize)
    });

    report.status = 'passed';
    writeReport(report);
    console.log(JSON.stringify({
      status: report.status,
      json: JSON_OUT,
      markdown: MD_OUT,
      disposableDocument: report.disposableDocument,
      assertionCount: report.assertions.length
    }, null, 2));
  } catch (error) {
    report.status = 'failed';
    report.error = error?.message || String(error);
    writeReport(report);
    throw error;
  } finally {
    if (createdDoc?.documentId) {
      await closeDocumentBestEffort(report, createdDoc.documentId, report.disposableDocument?.name || 'current-disposable');
    }
    writeReport(report);
  }
}

main().catch((error) => {
  console.error(`FAIL: ${error?.message || String(error)}`);
  process.exit(1);
});
