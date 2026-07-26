/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TMP_DIR = path.join(ROOT, 'tmp');
const JSON_OUT = path.join(TMP_DIR, 'reference-overlay-live-smoke.json');
const MD_OUT = path.join(TMP_DIR, 'reference-overlay-live-smoke.md');
const endpoint = process.env.MCP_ENDPOINT || 'http://127.0.0.1:8768/mcp';

const DOC_PREFIX = 'DesignEchoReferenceOverlaySmoke';

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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isHostModalState(value) {
  const text = typeof value === 'string'
    ? value
    : value?.error || value?.message || '';
  return /host is in a modal state/i.test(String(text));
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

function base64ByteEstimate(value) {
  if (typeof value !== 'string' || value.length === 0) return 0;
  return Math.floor((value.replace(/=+$/, '').length * 3) / 4);
}

function redactOverlayResult(result) {
  const snapshots = Array.isArray(result?.snapshots) ? result.snapshots : [];
  const success = result?.success === true && snapshots.length > 0;
  return {
    success,
    error: result?.error || (snapshots.length === 0 ? 'Overlay tool returned no snapshots.' : undefined),
    errors: Array.isArray(result?.errors)
      ? result.errors.map((item) => ({
          screenId: item?.screenId,
          screenName: item?.screenName,
          screenIndex: item?.screenIndex,
          stage: item?.stage,
          error: item?.error
        }))
      : undefined,
    debug: result?.debug
      ? {
          version: result.debug.version,
          documentId: result.debug.documentId,
          screenCount: result.debug.screenCount,
          targetScreenCount: result.debug.targetScreenCount,
          placementCount: result.debug.placementCount,
          topLayerCount: result.debug.topLayerCount,
          hasDocumentCanvas: result.debug.hasDocumentCanvas,
          hasOffscreenCanvas: result.debug.hasOffscreenCanvas,
          hasImageData: result.debug.hasImageData,
          snapshotCount: result.debug.snapshotCount,
          errorCount: result.debug.errorCount,
          screenStages: Array.isArray(result.debug.screenStages)
            ? result.debug.screenStages.map((item) => ({
                screenId: item?.screenId,
                screenName: item?.screenName,
                screenIndex: item?.screenIndex,
                stage: item?.stage,
                width: item?.width,
                height: item?.height,
                placementCount: item?.placementCount,
                renderMode: item?.renderMode,
                error: item?.error
              }))
            : []
        }
      : undefined,
    snapshotCount: snapshots.length,
    overlayCount: snapshots.length,
    redacted: true,
    snapshots: snapshots.map((snapshot) => ({
      screenId: snapshot?.screenId,
      screenName: snapshot?.screenName,
      screenIndex: snapshot?.screenIndex,
      width: snapshot?.width,
      height: snapshot?.height,
      base64Bytes: base64ByteEstimate(snapshot?.base64),
      base64Hidden: true
    }))
  };
}

function summarizeResult(result) {
  if (!result || typeof result !== 'object') return result;
  if (Array.isArray(result?.snapshots)) return redactOverlayResult(result);
  const summary = {};
  for (const key of [
    'success',
    'documentId',
    'entityType',
    'layerId',
    'name',
    'layerName',
    'shapeType',
    'groupName',
    'layerCount',
    'activeDocumentId',
    'error'
  ]) {
    if (Object.prototype.hasOwnProperty.call(result, key)) {
      summary[key] = result[key];
    }
  }
  if (result.group) {
    summary.group = {
      id: result.group.id,
      name: result.group.name,
      layerCount: result.group.layerCount
    };
  }
  if (Object.prototype.hasOwnProperty.call(result, '__smokeAttempts')) {
    summary.smokeAttempts = result.__smokeAttempts;
  }
  return summary;
}

function pushStep(report, name, result) {
  report.steps.push({
    name,
    ok: result?.success !== false,
    summary: summarizeResult(result)
  });
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

async function safeListDocuments(report, name) {
  try {
    const listResult = await callPhotoshopToolStable('listDocuments', { includeDetails: false });
    pushStep(report, name, listResult);
    return listResult;
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
  if (beforeCleanup && hasDocument(beforeCleanup, disposableDocumentId)) {
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

  const finalDocuments = await safeListDocuments(report, 'cleanup.listDocuments.final');
  cleanup.finalDocumentIds = normalizeDocuments(finalDocuments).map((doc) => doc.id);
  cleanup.disposableStillOpen = finalDocuments ? hasDocument(finalDocuments, disposableDocumentId) : true;
  return cleanup;
}

function renderMarkdown(report) {
  const lines = [];
  lines.push('# Reference Overlay Live Smoke');
  lines.push('');
  lines.push(`- Generated at: ${report.generatedAt}`);
  lines.push(`- Endpoint: ${report.endpoint}`);
  lines.push(`- Outcome: ${report.outcome}`);
  if (report.skipped) {
    lines.push(`- Skipped: ${report.skipReason}`);
  }
  lines.push(`- Disposable document id: ${report.disposableDocumentId || 'none'}`);
  lines.push(`- Screen group id: ${report.screenGroupId || 'none'}`);
  lines.push(`- Overlay snapshots: ${report.overlayResult?.snapshotCount ?? 0}`);
  lines.push(`- Base64 redacted: ${report.overlayResult?.redacted ? 'yes' : 'n/a'}`);
  lines.push('');
  lines.push('## Overlay Result');
  lines.push('');
  lines.push('```json');
  lines.push(JSON.stringify(report.overlayResult || null, null, 2));
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
  if (report.error) {
    lines.push('');
    lines.push('## Error');
    lines.push('');
    lines.push('```text');
    lines.push(report.error);
    lines.push('```');
  }
  lines.push('');
  return lines.join('\n');
}

function writeReport(report) {
  ensureDir(TMP_DIR);
  fs.writeFileSync(JSON_OUT, JSON.stringify(report, null, 2), 'utf8');
  fs.writeFileSync(MD_OUT, renderMarkdown(report), 'utf8');
}

async function trySystemStatus(report) {
  try {
    const status = await callTool('system.status', {});
    report.systemStatus = status;
    return status;
  } catch (error) {
    report.skipped = true;
    report.skipReason = `MCP endpoint unavailable or system.status failed: ${error?.message || String(error)}`;
    return null;
  }
}

async function runScenario(report) {
  const systemStatus = await trySystemStatus(report);
  if (!systemStatus) return;

  if (systemStatus?.pluginConnected !== true) {
    report.skipped = true;
    report.skipReason = 'Photoshop UXP plugin is not connected';
    return;
  }

  const beforeDocs = await callPhotoshopToolStable('listDocuments', { includeDetails: false });
  assertToolSuccess(report, 'listDocuments.before', beforeDocs);
  const documents = normalizeDocuments(beforeDocs);
  const originalDocumentId = beforeDocs.activeDocumentId || documents.find((doc) => doc.isActive)?.id || documents[0]?.id || null;
  report.originalDocumentId = originalDocumentId;

  const docName = `${DOC_PREFIX}_${Date.now()}`;
  let disposableDocumentId = null;

  try {
    const createDocument = await callPhotoshopToolStable('createDocument', {
      name: docName,
      width: 420,
      height: 320,
      resolution: 72,
      backgroundColor: 'white',
      colorMode: 'RGB'
    });
    assertToolSuccess(report, 'createDocument.disposable', createDocument);
    disposableDocumentId = createDocument.documentId || createDocument.document?.id;
    report.disposableDocumentId = disposableDocumentId;
    assertCondition(report, 'disposable document id returned', Number.isFinite(Number(disposableDocumentId)), {
      disposableDocumentId
    });

    const targetBounds = { left: 70, top: 70, right: 260, bottom: 190 };
    const actualBounds = { left: 92, top: 86, right: 262, bottom: 196 };

    const targetRect = await callPhotoshopToolStable('createRectangle', {
      x: targetBounds.left,
      y: targetBounds.top,
      width: targetBounds.right - targetBounds.left,
      height: targetBounds.bottom - targetBounds.top,
      fillColorHex: '#D7E6FF',
      name: 'overlay_smoke_target'
    });
    assertToolSuccess(report, 'createRectangle.target', targetRect);
    assertCondition(report, 'target rectangle layer id returned', Number.isFinite(Number(targetRect?.layerId)), {
      layerId: targetRect?.layerId
    });

    const actualRect = await callPhotoshopToolStable('createRectangle', {
      x: actualBounds.left,
      y: actualBounds.top,
      width: actualBounds.right - actualBounds.left,
      height: actualBounds.bottom - actualBounds.top,
      fillColorHex: '#FFE0B8',
      name: 'overlay_smoke_actual'
    });
    assertToolSuccess(report, 'createRectangle.actual', actualRect);
    assertCondition(report, 'actual rectangle layer id returned', Number.isFinite(Number(actualRect?.layerId)), {
      layerId: actualRect?.layerId
    });

    const group = await callPhotoshopToolStable('createGroup', {
      groupName: 'overlay_smoke_screen_1',
      layerIds: [targetRect.layerId, actualRect.layerId]
    });
    assertToolSuccess(report, 'createGroup.screen', group);
    const screenGroupId = group.layerId || group.group?.id;
    report.screenGroupId = screenGroupId;
    assertCondition(report, 'screen group id returned', Number.isFinite(Number(screenGroupId)), { screenGroupId });

    const screen = {
      id: screenGroupId,
      name: 'overlay_smoke_screen_1',
      index: 1,
      bounds: { left: 0, top: 0, right: 420, bottom: 320, width: 420, height: 320 }
    };

    const placement = {
      screenId: screenGroupId,
      placeholderLayerId: targetRect.layerId,
      placeholderLayerName: targetRect.layerName || targetRect.name,
      actualLayerId: actualRect.layerId,
      actualLayerName: actualRect.layerName || actualRect.name,
      targetBounds,
      actualBounds
    };

    const overlay = await callPhotoshopToolStable('getScreenSnapshotsWithOverlay', {
      screens: [screen],
      placements: [placement],
      maxWidth: 420
    });
    pushStep(report, 'getScreenSnapshotsWithOverlay', overlay);
    report.overlayResult = redactOverlayResult(overlay);
    assertCondition(report, 'overlay tool returned success', overlay?.success === true, {
      result: report.overlayResult
    });
    assertCondition(report, 'overlay returned one snapshot', report.overlayResult.snapshotCount === 1, {
      result: report.overlayResult
    });
    assertCondition(report, 'overlay base64 was generated but redacted in report', report.overlayResult.snapshots[0]?.base64Bytes > 100, {
      snapshot: report.overlayResult.snapshots[0]
    });
    assertCondition(report, 'overlay report hides raw base64', report.overlayResult.snapshots[0]?.base64Hidden === true, {
      snapshot: report.overlayResult.snapshots[0]
    });
  } finally {
    await cleanupDisposable(report, disposableDocumentId, originalDocumentId);
  }

  assertCondition(report, 'disposable document closed', report.cleanup?.disposableStillOpen === false, {
    cleanup: report.cleanup
  });
}

async function main() {
  const report = {
    generatedAt: new Date().toISOString(),
    endpoint,
    outcome: 'fail',
    skipped: false,
    skipReason: '',
    steps: [],
    assertions: [],
    cleanup: {},
    overlayResult: null
  };

  try {
    await runScenario(report);
    report.outcome = report.skipped ? 'skipped' : 'pass';
  } catch (error) {
    report.outcome = 'fail';
    report.error = error?.stack || error?.message || String(error);
  }

  writeReport(report);

  console.log(`Wrote ${JSON_OUT}`);
  console.log(`Wrote ${MD_OUT}`);
  console.log(JSON.stringify({
    connected: report.systemStatus?.pluginConnected === true,
    outcome: report.outcome,
    skipped: report.skipped,
    skipReason: report.skipReason || null,
    disposableDocumentId: report.disposableDocumentId || null,
    screenGroupId: report.screenGroupId || null,
    overlayResult: report.overlayResult,
    failedAssertions: report.assertions.filter((assertion) => !assertion.passed).map((assertion) => assertion.name),
    cleanup: report.cleanup,
    error: report.error ? report.error.split('\n')[0] : null
  }, null, 2));

  if (report.outcome === 'fail') {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(`FAIL: ${error?.message || String(error)}`);
  process.exit(1);
});
