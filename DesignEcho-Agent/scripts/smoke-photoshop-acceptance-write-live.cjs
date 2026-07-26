/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TMP_DIR = path.join(ROOT, 'tmp');
const JSON_OUT = path.join(TMP_DIR, 'photoshop-acceptance-write-live-smoke.json');
const MD_OUT = path.join(TMP_DIR, 'photoshop-acceptance-write-live-smoke.md');
const endpoint = process.env.MCP_ENDPOINT || 'http://127.0.0.1:8768/mcp';

const INITIAL_TEXT = '\u9a8c\u6536\u6587\u672c';
const UPDATED_TEXT = '\u9a8c\u6536\u6587\u672c\u5df2\u4fee\u6539';
const DISPOSABLE_DOC_PREFIX = 'DesignEchoAcceptanceWriteSmoke';
const REQUIRED_LIVE_WRITE_FLAGS = [
  'DESIGNECHO_LIVE_AGENT_ACCEPTANCE',
  'DESIGNECHO_LIVE_AGENT_ACCEPTANCE_TAKEOVER',
  'DESIGNECHO_LIVE_AGENT_ACCEPTANCE_DISPOSABLE_DOCUMENT'
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

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function buildLiveWriteOptIn(env = process.env) {
  const missing = REQUIRED_LIVE_WRITE_FLAGS.filter((name) => String(env[name] || '') !== '1');
  return {
    ok: missing.length === 0,
    required: REQUIRED_LIVE_WRITE_FLAGS.map((name) => ({ name, expected: '1' })),
    missing,
    blockers: missing.map((name) => `${name}=1 is required before disposable live Photoshop writes.`),
    boundaries: {
      touchesLivePhotoshop: true,
      writesPhotoshop: true,
      requiresDisposableDocument: true,
      userDocumentWritesAllowed: false,
      savesDocument: false,
      claimsDesignQuality: false
    }
  };
}

function runSelfTest() {
  const missing = buildLiveWriteOptIn({});
  assert(missing.ok === false, 'missing live write flags must block.');
  assert(
    missing.missing.length === REQUIRED_LIVE_WRITE_FLAGS.length,
    'all required live write flags should be reported when absent.'
  );
  assert(
    missing.boundaries.requiresDisposableDocument === true
      && missing.boundaries.userDocumentWritesAllowed === false
      && missing.boundaries.claimsDesignQuality === false,
    'live write boundaries must remain explicit and non-overclaiming.'
  );

  const readyEnv = Object.fromEntries(REQUIRED_LIVE_WRITE_FLAGS.map((name) => [name, '1']));
  const ready = buildLiveWriteOptIn(readyEnv);
  assert(ready.ok === true, 'all live write flags should allow the disposable smoke to start.');
  assert(ready.missing.length === 0, 'ready opt-in should not report missing flags.');

  const emptyBeforeState = buildOriginalDocumentState({
    success: true,
    activeDocumentId: null,
    documents: []
  });
  assert(emptyBeforeState.hasExistingDocument === false, 'empty Photoshop session should be allowed.');
  assert(emptyBeforeState.originalDocumentId === null, 'empty Photoshop session has no original document to restore.');

  console.log(JSON.stringify({
    success: true,
    checks: [
      'missing live write flags block before Photoshop calls',
      'all required flags are listed',
      'boundaries require disposable document and forbid quality claims',
      'all flags set allows the disposable live smoke to start',
      'empty Photoshop sessions can create a disposable acceptance document'
    ]
  }, null, 2));
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

async function acceptanceSnapshot() {
  return callTool('photoshop.acceptance_snapshot', {
    includeHidden: true,
    includeBounds: true,
    includeText: true,
    maxLayers: 120
  });
}

function snapshotDocumentId(snapshot) {
  return snapshot?.document?.id ?? snapshot?.snapshot?.document?.id ?? null;
}

function snapshotLayers(snapshot) {
  const source = snapshot?.layers || snapshot?.snapshot?.layers || [];
  return Array.isArray(source) ? source : [];
}

function findLayer(snapshot, predicate) {
  return snapshotLayers(snapshot).find(predicate) || null;
}

function findLayerById(snapshot, layerId) {
  return findLayer(snapshot, (layer) => Number(layer?.id) === Number(layerId));
}

function normalizeDocuments(listResult) {
  return Array.isArray(listResult?.documents) ? listResult.documents : [];
}

function hasDocument(listResult, documentId) {
  return normalizeDocuments(listResult).some((doc) => Number(doc?.id) === Number(documentId));
}

function buildOriginalDocumentState(listResult) {
  const documents = normalizeDocuments(listResult);
  const activeDocumentId = listResult?.activeDocumentId || documents.find((doc) => doc.isActive)?.id || documents[0]?.id || null;
  return {
    hasExistingDocument: documents.length > 0,
    documentCount: documents.length,
    originalDocumentId: activeDocumentId || null
  };
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
    'previousContent',
    'newContent',
    'closedDocument',
    'activeDocumentId',
    'count'
  ]) {
    if (Object.prototype.hasOwnProperty.call(result, key)) {
      summary[key] = result[key];
    }
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
  assertCondition(report, `${name} success`, result?.success === true, { result: summarizeResult(result), error: result?.error });
}

function assertNear(report, name, actual, expected, tolerance) {
  const delta = Math.abs(Number(actual) - Number(expected));
  assertCondition(report, name, delta <= tolerance, { actual, expected, tolerance, delta });
}

async function safeListDocuments(report, name) {
  try {
    const listResult = await callPhotoshopTool('listDocuments', { includeDetails: false });
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

  const finalDocuments = await safeListDocuments(report, 'cleanup.listDocuments.final');
  cleanup.finalDocumentIds = normalizeDocuments(finalDocuments).map((doc) => doc.id);
  cleanup.disposableStillOpen = finalDocuments ? hasDocument(finalDocuments, disposableDocumentId) : true;

  return cleanup;
}

function renderMarkdown(report) {
  const lines = [];
  lines.push('# Photoshop Acceptance Write Live Smoke');
  lines.push('');
  lines.push(`- Generated at: ${report.generatedAt}`);
  lines.push(`- Endpoint: ${report.endpoint}`);
  lines.push(`- Outcome: ${report.outcome}`);
  lines.push(`- Disposable document id: ${report.disposableDocumentId || 'none'}`);
  lines.push(`- Text layer id: ${report.textLayerId || 'none'}`);
  lines.push(`- Cleanup closed disposable: ${report.cleanup?.closed ? 'yes' : 'no'}`);
  lines.push(`- Cleanup restored original: ${report.cleanup?.restoredOriginal ? 'yes' : 'no'}`);
  lines.push(`- Live write opt-in: ${report.liveWriteOptIn?.ok ? 'yes' : 'no'}`);
  lines.push('');
  if (Array.isArray(report.blockers) && report.blockers.length > 0) {
    lines.push('## Blockers');
    lines.push('');
    for (const blocker of report.blockers) lines.push(`- ${blocker}`);
    lines.push('');
  }
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

async function runScenario(report) {
  const systemStatus = await callTool('system.status', {});
  report.systemStatus = systemStatus;
  assertCondition(report, 'Photoshop UXP plugin connected', systemStatus?.pluginConnected === true, {
    pluginConnected: systemStatus?.pluginConnected
  });

  const beforeDocs = await callPhotoshopTool('listDocuments', { includeDetails: false });
  assertToolSuccess(report, 'listDocuments.before', beforeDocs);
  const originalDocumentState = buildOriginalDocumentState(beforeDocs);
  report.originalDocumentState = originalDocumentState;
  assertCondition(report, 'existing document state captured', Number.isFinite(originalDocumentState.documentCount), {
    count: originalDocumentState.documentCount,
    originalDocumentId: originalDocumentState.originalDocumentId
  });

  const originalDocumentId = originalDocumentState.originalDocumentId;
  report.originalDocumentId = originalDocumentId;
  const disposableName = `${DISPOSABLE_DOC_PREFIX}_${Date.now()}`;
  report.disposableDocumentName = disposableName;

  let disposableDocumentId = null;
  try {
    const createDocument = await callPhotoshopTool('createDocument', {
      name: disposableName,
      width: 420,
      height: 260,
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

    const createdSnapshot = await acceptanceSnapshot();
    report.createdSnapshot = { documentId: snapshotDocumentId(createdSnapshot), summary: createdSnapshot?.summary };
    assertCondition(report, 'created disposable document is active', Number(snapshotDocumentId(createdSnapshot)) === Number(disposableDocumentId), {
      expected: disposableDocumentId,
      actual: snapshotDocumentId(createdSnapshot)
    });

    const createText = await callPhotoshopTool('createTextLayer', {
      content: INITIAL_TEXT,
      name: 'acceptance_text',
      x: 30,
      y: 50,
      fontSize: 28,
      colorHex: '#111111',
      alignment: 'left'
    });
    assertToolSuccess(report, 'createTextLayer', createText);
    const textLayerId = createText.layerId;
    report.textLayerId = textLayerId;
    assertCondition(report, 'text layer id returned', Number.isFinite(Number(textLayerId)), { textLayerId });

    const afterCreateText = await acceptanceSnapshot();
    const createdTextLayer = findLayerById(afterCreateText, textLayerId);
    assertCondition(report, 'created text layer visible in acceptance snapshot', Boolean(createdTextLayer), {
      textLayerId,
      layerNames: snapshotLayers(afterCreateText).map((layer) => layer.name)
    });
    assertCondition(report, 'created text content captured', createdTextLayer?.text?.content === INITIAL_TEXT, {
      expected: INITIAL_TEXT,
      actual: createdTextLayer?.text?.content
    });

    const setText = await callPhotoshopTool('setTextContent', {
      layerId: textLayerId,
      content: UPDATED_TEXT
    });
    assertToolSuccess(report, 'setTextContent', setText);
    const afterSetText = await acceptanceSnapshot();
    const updatedTextLayer = findLayerById(afterSetText, textLayerId);
    assertCondition(report, 'updated text content captured', updatedTextLayer?.text?.content === UPDATED_TEXT, {
      expected: UPDATED_TEXT,
      actual: updatedTextLayer?.text?.content
    });

    const moveLayer = await callPhotoshopTool('moveLayer', {
      layerId: textLayerId,
      x: 60,
      y: 90,
      relative: false
    });
    assertToolSuccess(report, 'moveLayer.absolute', moveLayer);
    const afterMove = await acceptanceSnapshot();
    const movedLayer = findLayerById(afterMove, textLayerId);
    assertCondition(report, 'moved layer still visible in acceptance snapshot', Boolean(movedLayer), { textLayerId });
    assertCondition(report, 'moved layer has bounds', Boolean(movedLayer?.bounds), { bounds: movedLayer?.bounds });
    assertNear(report, 'moved layer left near requested x', movedLayer?.bounds?.left, 60, 10);
    assertNear(report, 'moved layer top near requested y', movedLayer?.bounds?.top, 90, 10);
    assertCondition(report, 'moved text content still captured', movedLayer?.text?.content === UPDATED_TEXT, {
      expected: UPDATED_TEXT,
      actual: movedLayer?.text?.content
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
  if (process.argv.includes('--self-test')) {
    runSelfTest();
    return;
  }

  ensureDir(TMP_DIR);
  const report = {
    generatedAt: new Date().toISOString(),
    endpoint,
    outcome: 'fail',
    steps: [],
    assertions: [],
    cleanup: {},
    liveWriteOptIn: buildLiveWriteOptIn()
  };

  try {
    if (!report.liveWriteOptIn.ok) {
      report.outcome = 'blocked_missing_live_write_opt_in';
      report.blockers = report.liveWriteOptIn.blockers;
    } else {
      await runScenario(report);
      report.outcome = 'pass';
    }
  } catch (error) {
    report.outcome = 'fail';
    report.error = error?.stack || error?.message || String(error);
  }

  fs.writeFileSync(JSON_OUT, JSON.stringify(report, null, 2));
  fs.writeFileSync(MD_OUT, renderMarkdown(report));

  console.log(`Wrote ${JSON_OUT}`);
  console.log(`Wrote ${MD_OUT}`);
  console.log(JSON.stringify({
    connected: report.systemStatus?.pluginConnected === true,
    outcome: report.outcome,
    blockers: report.blockers || [],
    disposableDocumentId: report.disposableDocumentId || null,
    textLayerId: report.textLayerId || null,
    assertionCount: report.assertions.length,
    failedAssertions: report.assertions.filter((assertion) => !assertion.passed).map((assertion) => assertion.name),
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
