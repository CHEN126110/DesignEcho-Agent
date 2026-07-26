#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const UXP_ROOT = path.resolve(ROOT, '..', 'DesignEcho-UXP');
const TMP_DIR = path.join(ROOT, 'tmp');
const EXPORT_TMP_DIR = path.join(TMP_DIR, 'photoshop-simple-ops-export');
const JSON_OUT = path.join(TMP_DIR, 'photoshop-simple-operations-live-smoke.json');
const MD_OUT = path.join(TMP_DIR, 'photoshop-simple-operations-live-smoke.md');
const endpoint = process.env.MCP_ENDPOINT || 'http://127.0.0.1:8768/mcp';

const DOC_PREFIX = 'DesignEchoSimpleOpsLive';
const LAYERS = [
  { key: 'dark', name: 'simple_ops_dark', fillColorHex: '#222222', x: 32, y: 32 },
  { key: 'mid', name: 'simple_ops_mid', fillColorHex: '#888888', x: 72, y: 62 },
  { key: 'light', name: 'simple_ops_light', fillColorHex: '#DDDDDD', x: 112, y: 92 }
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
        if (result && typeof result === 'object') {
          result.__smokeAttempts = attempt;
        }
        return result;
      }
    } catch (error) {
      lastError = error;
      if (!isHostModalState(error) || attempt >= attempts) {
        throw error;
      }
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

function disposableDocuments(listResult) {
  return normalizeDocuments(listResult).filter((doc) => String(doc?.name || '').startsWith(DOC_PREFIX));
}

function hierarchyLayers(result) {
  const flat = result?.flatList || result?.layers || result?.snapshot?.layers || [];
  return Array.isArray(flat) ? flat : [];
}

function stackOrderForIds(result, ids) {
  const idSet = new Set(ids.map(Number));
  return hierarchyLayers(result)
    .filter((layer) => idSet.has(Number(layer?.id)))
    .sort((a, b) => Number(a?.index ?? 0) - Number(b?.index ?? 0))
    .map((layer) => ({
      id: Number(layer.id),
      name: layer.name,
      index: Number(layer.index),
      depth: Number(layer.depth || 0)
    }));
}

function topIndex(result, layerId) {
  const order = stackOrderForIds(result, [layerId]);
  return Number.isFinite(order[0]?.index) ? order[0].index : null;
}

function orderNames(order) {
  return order.map((item) => item.name);
}

function pushStep(report, name, result) {
  report.steps.push({
    name,
    ok: result?.success !== false,
    summary: summarizeResult(result)
  });
}

function summarizeResult(result) {
  if (!result || typeof result !== 'object') return result;
  const summary = {};
  for (const key of [
    'success',
    'documentId',
    'name',
    'layerId',
    'activeDocumentId',
    'closedDocument',
    'count',
    'totalLayers',
    'originalSize',
    'newSize',
    'exportedFiles',
    'outputPath',
    'error'
  ]) {
    if (Object.prototype.hasOwnProperty.call(result, key)) {
      summary[key] = result[key];
    }
  }
  if (result.layer && typeof result.layer === 'object') {
    summary.layer = {
      id: result.layer.id,
      name: result.layer.name,
      newPosition: result.layer.newPosition
    };
  }
  if (result.data && typeof result.data === 'object') {
    summary.data = {
      layerId: result.data.layerId,
      layerName: result.data.layerName,
      bounds: result.data.bounds,
      error: result.data.error
    };
  }
  if (Array.isArray(result.flatList)) {
    summary.flatList = result.flatList.map((layer) => ({
      id: layer.id,
      name: layer.name,
      index: layer.index,
      depth: layer.depth
    })).slice(0, 12);
  }
  return summary;
}

function assertCondition(report, name, passed, details = {}) {
  report.assertions.push({ name, passed: Boolean(passed), details });
  if (!passed) {
    throw new Error(`Assertion failed: ${name} ${asJson(details)}`);
  }
}

function assertToolSuccess(report, name, result) {
  pushStep(report, name, result);
  assertCondition(report, `${name} success`, result?.success === true, {
    result: summarizeResult(result),
    error: result?.error
  });
}

async function getHierarchy(report, name, ids = []) {
  const result = await callPhotoshopToolStable('getLayerHierarchy', {
    includeHidden: true,
    includeBounds: false,
    flatList: true
  });
  assertToolSuccess(report, name, result);
  if (ids.length > 0) {
    report.layerOrders[name] = stackOrderForIds(result, ids);
  }
  return result;
}

async function safeListDocuments(report, name) {
  try {
    const result = await callPhotoshopToolStable('listDocuments', { includeDetails: false });
    pushStep(report, name, result);
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
  const shouldAttemptClose = !beforeCleanup || hasDocument(beforeCleanup, disposableDocumentId);
  if (shouldAttemptClose) {
    try {
      const closeResult = await callPhotoshopToolStable('closeDocument', {
        documentId: disposableDocumentId,
        save: false
      });
      pushStep(report, 'cleanup.closeDisposableWithoutSaving', closeResult);
      cleanup.closed = closeResult?.success === true;
      if (!cleanup.closed) {
        cleanup.errors.push(closeResult?.error || 'closeDocument returned success=false');
      }
    } catch (error) {
      cleanup.errors.push(error?.message || String(error));
      report.steps.push({
        name: 'cleanup.closeDisposableWithoutSaving',
        ok: false,
        error: error?.message || String(error)
      });
    }
  } else {
    cleanup.closed = true;
  }

  const afterClose = await safeListDocuments(report, 'cleanup.listDocuments.afterClose');
  cleanup.disposableStillOpen = afterClose ? hasDocument(afterClose, disposableDocumentId) : 'unknown';

  if (originalDocumentId && afterClose && hasDocument(afterClose, originalDocumentId)) {
    try {
      const switchResult = await callPhotoshopToolStable('switchDocument', { documentId: originalDocumentId });
      pushStep(report, 'cleanup.switchBackOriginal', switchResult);
      cleanup.restoredOriginal = switchResult?.success === true;
      if (!cleanup.restoredOriginal) {
        cleanup.errors.push(switchResult?.error || 'switchDocument returned success=false');
      }
    } catch (error) {
      cleanup.errors.push(error?.message || String(error));
      report.steps.push({
        name: 'cleanup.switchBackOriginal',
        ok: false,
        error: error?.message || String(error)
      });
    }
  } else {
    cleanup.restoredOriginal = true;
  }

  return cleanup;
}

async function cleanupStaleDisposableDocuments(report) {
  const staleCleanup = { attempted: false, closed: [], errors: [] };
  report.staleCleanup = staleCleanup;

  const documentsResult = await safeListDocuments(report, 'staleCleanup.listDocuments.before');
  const staleDocuments = disposableDocuments(documentsResult);
  if (staleDocuments.length === 0) {
    return staleCleanup;
  }

  staleCleanup.attempted = true;
  for (const document of staleDocuments) {
    try {
      const closeResult = await callPhotoshopToolStable('closeDocument', {
        documentId: document.id,
        save: false
      }, {
        attempts: 8,
        delayMs: 400
      });
      pushStep(report, `staleCleanup.close.${document.id}`, closeResult);
      if (closeResult?.success === true) {
        staleCleanup.closed.push({ id: document.id, name: document.name });
      } else {
        staleCleanup.errors.push(closeResult?.error || `closeDocument failed for ${document.name}`);
      }
    } catch (error) {
      staleCleanup.errors.push(error?.message || String(error));
      report.steps.push({
        name: `staleCleanup.close.${document.id}`,
        ok: false,
        error: error?.message || String(error)
      });
    }
  }
  return staleCleanup;
}

function renderMarkdown(report) {
  const lines = [];
  lines.push('# Photoshop Simple Operations Live Smoke');
  lines.push('');
  lines.push(`- Generated at: ${report.generatedAt}`);
  lines.push(`- Endpoint: ${report.endpoint}`);
  lines.push(`- Outcome: ${report.outcome}`);
  lines.push(`- Disposable document id: ${report.disposableDocumentId || 'none'}`);
  lines.push(`- Created layer ids: ${report.createdLayerIds.join(', ') || 'none'}`);
  lines.push(`- Cleanup closed disposable: ${report.cleanup?.closed ? 'yes' : 'no'}`);
  lines.push('');
  lines.push('## Layer Orders');
  lines.push('');
  lines.push('```json');
  lines.push(JSON.stringify(report.layerOrders, null, 2));
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
  if (report.error) {
    lines.push('## Error');
    lines.push('');
    lines.push('```text');
    lines.push(report.error);
    lines.push('```');
    lines.push('');
  }
  return lines.join('\n');
}

function cleanupExportArtifacts(report) {
  try {
    fs.rmSync(EXPORT_TMP_DIR, { recursive: true, force: true });
    report.exportCleanup = { attempted: true, removed: true, directory: EXPORT_TMP_DIR };
  } catch (error) {
    report.exportCleanup = {
      attempted: true,
      removed: false,
      directory: EXPORT_TMP_DIR,
      error: error?.message || String(error)
    };
  }
}

async function runScenario(report) {
  fs.rmSync(EXPORT_TMP_DIR, { recursive: true, force: true });
  ensureDir(EXPORT_TMP_DIR);

  const systemStatus = await callTool('system.status', {});
  report.systemStatus = systemStatus;
  assertCondition(report, 'Photoshop UXP plugin connected', systemStatus?.pluginConnected === true, {
    pluginConnected: systemStatus?.pluginConnected
  });

  await cleanupStaleDisposableDocuments(report);

  const beforeDocs = await callPhotoshopToolStable('listDocuments', { includeDetails: false });
  assertToolSuccess(report, 'listDocuments.before', beforeDocs);
  const documents = normalizeDocuments(beforeDocs);
  const originalDocumentId = beforeDocs.activeDocumentId || documents.find((doc) => doc.isActive)?.id || documents[0]?.id;
  report.originalDocumentId = originalDocumentId || null;

  const disposableName = `${DOC_PREFIX}_${Date.now()}`;
  report.disposableDocumentName = disposableName;
  let disposableDocumentId = null;

  try {
    const createDocument = await callPhotoshopToolStable('createDocument', {
      name: disposableName,
      width: 420,
      height: 260,
      resolution: 72,
      backgroundColor: 'white',
      colorMode: 'RGB'
    }, {
      attempts: 12,
      delayMs: 500
    });
    assertToolSuccess(report, 'createDocument.disposable', createDocument);
    disposableDocumentId = createDocument.documentId || createDocument.document?.id;
    report.disposableDocumentId = disposableDocumentId;
    assertCondition(report, 'disposable document id returned', Number.isFinite(Number(disposableDocumentId)), {
      disposableDocumentId
    });

    const createdByKey = {};
    for (const layerSpec of LAYERS) {
      const result = await callPhotoshopToolStable('createRectangle', {
        name: layerSpec.name,
        x: layerSpec.x,
        y: layerSpec.y,
        width: 120,
        height: 50,
        fillColorHex: layerSpec.fillColorHex
      });
      assertToolSuccess(report, `createRectangle.${layerSpec.key}`, result);
      const layerId = Number(result.layerId);
      assertCondition(report, `${layerSpec.key} layer id returned`, Number.isFinite(layerId), { layerId: result.layerId });
      report.createdLayerIds.push(layerId);
      createdByKey[layerSpec.key] = layerId;
    }
    report.createdByKey = createdByKey;

    const afterCreate = await getHierarchy(report, 'getLayerHierarchy.afterCreate', report.createdLayerIds);
    const afterCreateOrder = stackOrderForIds(afterCreate, report.createdLayerIds);
    assertCondition(report, 'all created layers visible in hierarchy', afterCreateOrder.length === report.createdLayerIds.length, {
      expected: report.createdLayerIds,
      actual: afterCreateOrder
    });

    const distributeCreated = await callPhotoshopToolStable('distributeLayers', {
      layerIds: report.createdLayerIds,
      distributeType: 'horizontalCenters'
    });
    assertToolSuccess(report, 'distributeLayers.created.horizontalCenters', distributeCreated);

    const alignCreated = await callPhotoshopToolStable('alignLayers', {
      layerIds: report.createdLayerIds,
      alignType: 'top',
      alignTo: 'canvas'
    });
    assertToolSuccess(report, 'alignLayers.created.topCanvas', alignCreated);

    const scaleLight = await callPhotoshopToolStable('transformLayer', {
      layerId: createdByKey.light,
      scaleUniform: 50
    });
    assertToolSuccess(report, 'transformLayer.light.scale50', scaleLight);
    assertCondition(report, 'light layer scaled to half width', scaleLight?.newSize?.width > 0 && scaleLight.newSize.width <= 70, {
      originalSize: scaleLight?.originalSize,
      newSize: scaleLight?.newSize
    });
    assertCondition(report, 'light layer scaled to half height', scaleLight?.newSize?.height > 0 && scaleLight.newSize.height <= 35, {
      originalSize: scaleLight?.originalSize,
      newSize: scaleLight?.newSize
    });

    const iconPath = path.join(UXP_ROOT, 'icons', 'dark.png');
    const imageData = fs.readFileSync(iconPath).toString('base64');
    const placedIcon = await callPhotoshopToolStable('placeImage', {
      imageData,
      imageFormat: 'png',
      name: 'simple_ops_placed_icon',
      center: true,
      scale: 60
    });
    assertToolSuccess(report, 'placeImage.icon.centerScale60', placedIcon);
    const placedLayerId = Number(placedIcon?.data?.layerId);
    assertCondition(report, 'placed image layer id returned', Number.isFinite(placedLayerId), {
      result: summarizeResult(placedIcon)
    });

    const quickExport = await callPhotoshopToolStable('quickExport', {
      format: 'png',
      outputPath: EXPORT_TMP_DIR,
      suffix: '_smoke'
    });
    assertToolSuccess(report, 'quickExport.document.png', quickExport);
    const exportedFilePath = Array.isArray(quickExport?.exportedFiles) ? quickExport.exportedFiles[0] : '';
    const exportedFileExists = Boolean(exportedFilePath && fs.existsSync(exportedFilePath));
    report.exportedFiles.push({
      filePath: exportedFilePath || null,
      existedBeforeCleanup: exportedFileExists
    });
    assertCondition(report, 'quickExport returned an existing file path', exportedFileExists, {
      exportedFiles: quickExport?.exportedFiles,
      outputPath: quickExport?.outputPath
    });

    const topDark = await callPhotoshopToolStable('reorderLayer', {
      layerId: createdByKey.dark,
      action: 'top'
    });
    assertToolSuccess(report, 'reorderLayer.dark.top', topDark);
    const afterTop = await getHierarchy(report, 'getLayerHierarchy.afterDarkTop', report.createdLayerIds);
    const afterTopOrder = stackOrderForIds(afterTop, report.createdLayerIds);
    assertCondition(report, 'dark moved to top among created layers', afterTopOrder[0]?.id === createdByKey.dark, {
      order: afterTopOrder,
      orderNames: orderNames(afterTopOrder)
    });

    const midAboveDark = await callPhotoshopToolStable('reorderLayer', {
      layerId: createdByKey.mid,
      action: 'above',
      targetLayerId: createdByKey.dark
    });
    assertToolSuccess(report, 'reorderLayer.mid.aboveDark', midAboveDark);
    const afterAbove = await getHierarchy(report, 'getLayerHierarchy.afterMidAboveDark', report.createdLayerIds);
    const midIndex = topIndex(afterAbove, createdByKey.mid);
    const darkIndex = topIndex(afterAbove, createdByKey.dark);
    assertCondition(report, 'mid is above dark after targeted reorder', Number(midIndex) < Number(darkIndex), {
      midIndex,
      darkIndex,
      order: stackOrderForIds(afterAbove, report.createdLayerIds)
    });
  } finally {
    await cleanupDisposable(report, disposableDocumentId, originalDocumentId);
  }

  assertCondition(report, 'disposable document closed', report.cleanup?.disposableStillOpen === false, {
    cleanup: report.cleanup
  });
  assertCondition(report, 'original document restored or unavailable', report.cleanup?.restoredOriginal === true, {
    cleanup: report.cleanup
  });
}

async function main() {
  ensureDir(TMP_DIR);
  const report = {
    generatedAt: new Date().toISOString(),
    endpoint,
    outcome: 'fail',
    steps: [],
    assertions: [],
    cleanup: {},
    exportedFiles: [],
    createdLayerIds: [],
    layerOrders: {}
  };

  try {
    await runScenario(report);
    report.outcome = 'pass';
  } catch (error) {
    report.outcome = 'fail';
    report.error = error?.stack || error?.message || String(error);
  }

  cleanupExportArtifacts(report);

  fs.writeFileSync(JSON_OUT, JSON.stringify(report, null, 2));
  fs.writeFileSync(MD_OUT, renderMarkdown(report));

  console.log(`Wrote ${JSON_OUT}`);
  console.log(`Wrote ${MD_OUT}`);
  console.log(JSON.stringify({
    connected: report.systemStatus?.pluginConnected === true,
    outcome: report.outcome,
    disposableDocumentId: report.disposableDocumentId || null,
    createdLayerIds: report.createdLayerIds,
    layerOrders: report.layerOrders,
    assertionCount: report.assertions.length,
    failedAssertions: report.assertions.filter((assertion) => !assertion.passed).map((assertion) => assertion.name),
    cleanup: report.cleanup,
    exportedFiles: report.exportedFiles,
    error: report.error ? report.error.split('\n')[0] : null
  }, null, 2));

  if (report.outcome !== 'pass') {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(`FAIL: ${error?.message || String(error)}`);
  process.exit(1);
});
