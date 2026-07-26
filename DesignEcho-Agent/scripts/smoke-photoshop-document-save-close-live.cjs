/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TMP_DIR = path.join(ROOT, 'tmp');
const OUT_DIR = path.join(TMP_DIR, 'photoshop-document-save-close-live');
const JSON_OUT = path.join(TMP_DIR, 'photoshop-document-save-close-live-smoke.json');
const MD_OUT = path.join(TMP_DIR, 'photoshop-document-save-close-live-smoke.md');
const endpoint = process.env.MCP_ENDPOINT || 'http://127.0.0.1:8768/mcp';

const DOC_PREFIX = 'DesignEchoSaveCloseSmoke';
const INITIAL_TEXT = '\u4fdd\u5b58\u9a8c\u6536';
const UNSAVED_TEXT = '\u5173\u95ed\u4e0d\u4fdd\u5b58\u9a8c\u6536';

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

function normalizeDocuments(result) {
  return Array.isArray(result?.documents) ? result.documents : [];
}

function hasDocument(result, documentId) {
  return normalizeDocuments(result).some((doc) => Number(doc?.id) === Number(documentId));
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
    'savedPath',
    'format',
    'closedDocument',
    'activeDocumentId',
    'count',
    'error'
  ]) {
    if (Object.prototype.hasOwnProperty.call(result, key)) {
      summary[key] = result[key];
    }
  }
  if (Array.isArray(result.documents)) {
    summary.documents = result.documents.map((doc) => ({
      id: doc.id,
      name: doc.name,
      isActive: doc.isActive,
      path: doc.path
    }));
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
    result: summarizeResult(result)
  });
}

function statFile(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const stat = fs.statSync(filePath);
  return {
    size: stat.size,
    mtimeMs: stat.mtimeMs
  };
}

async function safeListDocuments(report, name) {
  try {
    const result = await callPhotoshopTool('listDocuments', { includeDetails: true });
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
  if (beforeCleanup && hasDocument(beforeCleanup, disposableDocumentId)) {
    try {
      const closeResult = await callPhotoshopTool('closeDocument', {
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
  cleanup.disposableStillOpen = afterClose ? hasDocument(afterClose, disposableDocumentId) : true;

  if (originalDocumentId && afterClose && hasDocument(afterClose, originalDocumentId)) {
    try {
      const switchResult = await callPhotoshopTool('switchDocument', { documentId: originalDocumentId });
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

function renderMarkdown(report) {
  const lines = [];
  lines.push('# Photoshop Document Save/Close Live Smoke');
  lines.push('');
  lines.push(`- Generated at: ${report.generatedAt}`);
  lines.push(`- Endpoint: ${report.endpoint}`);
  lines.push(`- Outcome: ${report.outcome}`);
  lines.push(`- PSD path: ${report.psdPath || 'none'}`);
  lines.push(`- Disposable document id: ${report.disposableDocumentId || 'none'}`);
  lines.push('');
  lines.push('## Assertions');
  lines.push('');
  lines.push('```json');
  lines.push(JSON.stringify(report.assertions, null, 2));
  lines.push('```');
  lines.push('');
  lines.push('## Disk Evidence');
  lines.push('');
  lines.push('```json');
  lines.push(JSON.stringify(report.diskEvidence, null, 2));
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

async function runScenario(report) {
  const systemStatus = await callTool('system.status', {});
  report.systemStatus = systemStatus;
  assertCondition(report, 'Photoshop UXP plugin connected', systemStatus?.pluginConnected === true, {
    pluginConnected: systemStatus?.pluginConnected
  });

  const beforeDocs = await callPhotoshopTool('listDocuments', { includeDetails: true });
  assertToolSuccess(report, 'listDocuments.before', beforeDocs);
  const documents = normalizeDocuments(beforeDocs);

  const originalDocumentId = beforeDocs.activeDocumentId || documents.find((doc) => doc.isActive)?.id || documents[0]?.id;
  report.originalDocumentId = originalDocumentId;

  const stamp = Date.now();
  const disposableName = `${DOC_PREFIX}_${stamp}`;
  const psdPath = path.join(OUT_DIR, `${disposableName}.psd`);
  report.disposableDocumentName = disposableName;
  report.psdPath = psdPath;

  if (fs.existsSync(psdPath)) {
    fs.rmSync(psdPath, { force: true });
  }

  let disposableDocumentId = null;
  try {
    const createDocument = await callPhotoshopTool('createDocument', {
      name: disposableName,
      width: 480,
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

    const createText = await callPhotoshopTool('createTextLayer', {
      content: INITIAL_TEXT,
      name: 'save_close_text',
      x: 40,
      y: 70,
      fontSize: 30,
      colorHex: '#111111',
      alignment: 'left'
    });
    assertToolSuccess(report, 'createTextLayer.initial', createText);

    const saveResult = await callPhotoshopTool('saveDocument', {
      format: 'psd',
      path: psdPath
    });
    assertToolSuccess(report, 'saveDocument.psdPath', saveResult);

    const savedPath = String(saveResult.savedPath || saveResult.savePath || psdPath);
    report.savedPathFromTool = savedPath;
    const afterSaveStat = statFile(psdPath);
    report.diskEvidence = {
      afterSave: afterSaveStat,
      afterUnsavedClose: null
    };
    assertCondition(report, 'PSD file exists after saveDocument(path)', Boolean(afterSaveStat), {
      psdPath,
      savedPath
    });
    assertCondition(report, 'PSD file has non-zero size after saveDocument(path)', Number(afterSaveStat?.size) > 0, {
      psdPath,
      stat: afterSaveStat
    });

    const setText = await callPhotoshopTool('setTextContent', {
      layerId: createText.layerId,
      content: UNSAVED_TEXT
    });
    assertToolSuccess(report, 'setTextContent.afterSaveUnsavedChange', setText);

    const closeResult = await callPhotoshopTool('closeDocument', {
      documentId: disposableDocumentId,
      save: false
    });
    assertToolSuccess(report, 'closeDocument.withoutSaving', closeResult);

    const afterCloseDocs = await callPhotoshopTool('listDocuments', { includeDetails: true });
    assertToolSuccess(report, 'listDocuments.afterClose', afterCloseDocs);
    assertCondition(report, 'disposable document is no longer open after close without saving', !hasDocument(afterCloseDocs, disposableDocumentId), {
      disposableDocumentId,
      documents: normalizeDocuments(afterCloseDocs).map((doc) => ({ id: doc.id, name: doc.name }))
    });

    const afterCloseStat = statFile(psdPath);
    report.diskEvidence.afterUnsavedClose = afterCloseStat;
    assertCondition(report, 'PSD file still exists after close without saving', Boolean(afterCloseStat), {
      psdPath
    });
    assertCondition(report, 'close without saving did not write the PSD again', afterCloseStat?.mtimeMs === afterSaveStat?.mtimeMs && afterCloseStat?.size === afterSaveStat?.size, {
      afterSave: afterSaveStat,
      afterUnsavedClose: afterCloseStat
    });

    disposableDocumentId = null;
  } finally {
    await cleanupDisposable(report, disposableDocumentId, originalDocumentId);
  }

  assertCondition(report, 'cleanup did not leave disposable document open', report.cleanup?.disposableStillOpen !== true, {
    cleanup: report.cleanup
  });
  assertCondition(report, 'cleanup restored original or no original was available', report.cleanup?.restoredOriginal === true, {
    cleanup: report.cleanup
  });
}

async function main() {
  ensureDir(TMP_DIR);
  ensureDir(OUT_DIR);
  const report = {
    generatedAt: new Date().toISOString(),
    endpoint,
    outcome: 'fail',
    steps: [],
    assertions: [],
    cleanup: {},
    diskEvidence: {}
  };

  try {
    await runScenario(report);
    report.outcome = 'pass';
  } catch (error) {
    report.outcome = 'fail';
    report.error = error?.stack || error?.message || String(error);
  }

  fs.writeFileSync(JSON_OUT, JSON.stringify(report, null, 2), 'utf8');
  fs.writeFileSync(MD_OUT, renderMarkdown(report), 'utf8');

  console.log(`Wrote ${JSON_OUT}`);
  console.log(`Wrote ${MD_OUT}`);
  console.log(JSON.stringify({
    connected: report.systemStatus?.pluginConnected === true,
    outcome: report.outcome,
    psdPath: report.psdPath || null,
    disposableDocumentId: report.disposableDocumentId || null,
    assertionCount: report.assertions.length,
    failedAssertions: report.assertions.filter((assertion) => !assertion.passed).map((assertion) => assertion.name),
    diskEvidence: report.diskEvidence,
    cleanup: report.cleanup,
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
