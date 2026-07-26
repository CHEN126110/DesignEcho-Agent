#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TMP_DIR = path.join(ROOT, 'tmp');
const STANDARD_OUTPUT_DIR = path.join(TMP_DIR, 'photoshop-save-export-live');
const PRODUCTION_OUTPUT_DIR = path.join(TMP_DIR, 'photoshop-save-export-production-live');
const STANDARD_JSON_OUT = path.join(TMP_DIR, 'photoshop-save-export-live-smoke.json');
const STANDARD_MD_OUT = path.join(TMP_DIR, 'photoshop-save-export-live-smoke.md');
const PRODUCTION_JSON_OUT = path.join(TMP_DIR, 'photoshop-save-export-production-live-smoke.json');
const PRODUCTION_MD_OUT = path.join(TMP_DIR, 'photoshop-save-export-production-live-smoke.md');
const ENDPOINT = process.env.MCP_ENDPOINT || 'http://127.0.0.1:8768/mcp';
const DOC_PREFIX = 'DesignEchoSaveExportLive';

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function parseArgs(argv) {
  const options = {
    scenario: 'standard',
    width: 320,
    height: 200,
    outputDirectory: STANDARD_OUTPUT_DIR,
    jsonOut: STANDARD_JSON_OUT,
    mdOut: STANDARD_MD_OUT,
    keepOutput: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--production-size') {
      options.scenario = 'production-size';
      options.width = 1000;
      options.height = 14525;
      options.outputDirectory = PRODUCTION_OUTPUT_DIR;
      options.jsonOut = PRODUCTION_JSON_OUT;
      options.mdOut = PRODUCTION_MD_OUT;
    } else if (arg === '--width') {
      options.width = Number(argv[index + 1]);
      index += 1;
    } else if (arg === '--height') {
      options.height = Number(argv[index + 1]);
      index += 1;
    } else if (arg === '--keep-output') {
      options.keepOutput = true;
    } else if (arg === '--help') {
      options.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!Number.isFinite(options.width) || options.width < 16) {
    throw new Error(`Invalid --width: ${options.width}`);
  }
  if (!Number.isFinite(options.height) || options.height < 16) {
    throw new Error(`Invalid --height: ${options.height}`);
  }

  return options;
}

function printHelp() {
  console.log([
    'Usage: node scripts/smoke-photoshop-save-export-live.cjs [--production-size] [--keep-output]',
    '',
    'Default mode uses a small disposable canvas for fast save/export checks.',
    'Production-size mode uses a 1000x14525 disposable canvas to sample detail-page-like save/export boundaries.'
  ].join('\n'));
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
  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: Date.now() + Math.random(), method, params })
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} from ${ENDPOINT}`);
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
  const attempts = options.attempts || 6;
  const delayMs = options.delayMs || 350;
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
    'savedPath',
    'format',
    'outputDirectory',
    'exportedCount',
    'exportedFiles',
    'error'
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
  assertCondition(report, `${name} success`, result?.success === true, {
    result: summarizeResult(result),
    error: result?.error
  });
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

async function cleanupStaleDisposableDocuments(report) {
  const staleCleanup = { attempted: false, closed: [], errors: [] };
  report.staleCleanup = staleCleanup;

  const documentsResult = await safeListDocuments(report, 'staleCleanup.listDocuments.before');
  for (const document of disposableDocuments(documentsResult)) {
    staleCleanup.attempted = true;
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
      }, {
        attempts: 8,
        delayMs: 400
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

function cleanupOutputArtifacts(report, config) {
  if (config.keepOutput) {
    report.outputCleanup = {
      attempted: false,
      removed: false,
      kept: true,
      directory: config.outputDirectory
    };
    return;
  }

  try {
    fs.rmSync(config.outputDirectory, { recursive: true, force: true });
    report.outputCleanup = { attempted: true, removed: true, directory: config.outputDirectory };
  } catch (error) {
    report.outputCleanup = {
      attempted: true,
      removed: false,
      directory: config.outputDirectory,
      error: error?.message || String(error)
    };
  }
}

function buildProbeRectangles(config) {
  const safeWidth = Math.max(48, Math.min(320, Math.floor(config.width * 0.36)));
  const safeHeight = Math.max(32, Math.min(120, Math.floor(config.height * 0.08)));
  const left = Math.max(24, Math.floor(config.width * 0.08));
  const top = Math.max(24, Math.floor(config.height * 0.04));

  if (config.scenario !== 'production-size') {
    return [{
      name: 'save_export_probe_rect',
      x: 48,
      y: 42,
      width: 160,
      height: 80,
      fillColorHex: '#3366CC'
    }];
  }

  const middleY = Math.max(top + safeHeight + 24, Math.floor(config.height * 0.48));
  const bottomY = Math.max(middleY + safeHeight + 24, config.height - safeHeight - 96);

  return [
    { name: 'save_export_probe_top', x: left, y: top, width: safeWidth, height: safeHeight, fillColorHex: '#3366CC' },
    { name: 'save_export_probe_middle', x: left + 80, y: middleY, width: safeWidth, height: safeHeight, fillColorHex: '#33AA66' },
    { name: 'save_export_probe_bottom', x: left + 160, y: bottomY, width: safeWidth, height: safeHeight, fillColorHex: '#CC6633' }
  ];
}

function assertFileExists(report, filePath, label) {
  const exists = Boolean(filePath && fs.existsSync(filePath));
  const size = exists ? fs.statSync(filePath).size : 0;
  report.files.push({ label, filePath: filePath || null, existedBeforeCleanup: exists, size });
  assertCondition(report, `${label} exists`, exists && size > 0, { filePath, size });
}

async function runScenario(report, config) {
  fs.rmSync(config.outputDirectory, { recursive: true, force: true });
  ensureDir(config.outputDirectory);

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
      width: config.width,
      height: config.height,
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

    const probeRectangles = buildProbeRectangles(config);
    for (const [index, rectangleSpec] of probeRectangles.entries()) {
      const rectangle = await callPhotoshopToolStable('createRectangle', rectangleSpec);
      assertToolSuccess(report, `createRectangle.probe.${index + 1}`, rectangle);
    }
    assertCondition(report, 'probe rectangles created', probeRectangles.length >= 1, {
      count: probeRectangles.length,
      scenario: config.scenario
    });

    const psdPath = path.join(config.outputDirectory, `${disposableName}.psd`);
    const saveDocument = await callPhotoshopToolStable('saveDocument', {
      path: psdPath,
      format: 'psd'
    }, {
      attempts: 8,
      delayMs: 500
    });
    assertToolSuccess(report, 'saveDocument.psd', saveDocument);
    assertFileExists(report, saveDocument.savedPath || psdPath, 'saveDocument PSD');

    const psbPath = path.join(config.outputDirectory, `${disposableName}.psb`);
    const saveLargeDocument = await callPhotoshopToolStable('saveDocument', {
      path: psbPath,
      format: 'psb'
    }, {
      attempts: 8,
      delayMs: 500
    });
    assertToolSuccess(report, 'saveDocument.psb', saveLargeDocument);
    assertFileExists(report, saveLargeDocument.savedPath || psbPath, 'saveDocument PSB');

    const batchOutputDirectory = path.join(config.outputDirectory, 'batch');
    ensureDir(batchOutputDirectory);
    const batchExport = await callPhotoshopToolStable('batchExport', {
      outputDirectory: batchOutputDirectory,
      format: 'jpg',
      quality: 80,
      presets: [
        { width: 160, height: 100, suffix: '_160x100' },
        { width: 80, height: 0, suffix: '_80w' }
      ]
    }, {
      attempts: 8,
      delayMs: 500
    });
    assertToolSuccess(report, 'batchExport.jpgPresets', batchExport);
    assertCondition(report, 'batchExport returned two files', Array.isArray(batchExport.exportedFiles) && batchExport.exportedFiles.length === 2, {
      exportedFiles: batchExport.exportedFiles
    });
    for (const [index, exportedFile] of batchExport.exportedFiles.entries()) {
      assertFileExists(report, exportedFile.filePath, `batchExport file ${index + 1}`);
    }
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

function renderMarkdown(report) {
  const lines = [];
  lines.push('# Photoshop Save Export Live Smoke');
  lines.push('');
  lines.push(`- Generated at: ${report.generatedAt}`);
  lines.push(`- Endpoint: ${report.endpoint}`);
  lines.push(`- Scenario: ${report.scenario}`);
  lines.push(`- Canvas: ${report.canvas?.width}x${report.canvas?.height}`);
  lines.push(`- Outcome: ${report.outcome}`);
  lines.push(`- Disposable document id: ${report.disposableDocumentId || 'none'}`);
  lines.push(`- Cleanup closed disposable: ${report.cleanup?.closed ? 'yes' : 'no'}`);
  lines.push('');
  lines.push('## Files');
  lines.push('');
  lines.push('```json');
  lines.push(JSON.stringify(report.files, null, 2));
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
  lines.push(JSON.stringify({ document: report.cleanup, output: report.outputCleanup }, null, 2));
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

async function main() {
  const config = parseArgs(process.argv.slice(2));
  if (config.help) {
    printHelp();
    return;
  }

  ensureDir(TMP_DIR);
  const report = {
    generatedAt: new Date().toISOString(),
    endpoint: ENDPOINT,
    scenario: config.scenario,
    canvas: { width: config.width, height: config.height },
    outputDirectory: config.outputDirectory,
    outcome: 'fail',
    steps: [],
    assertions: [],
    cleanup: {},
    files: []
  };

  try {
    await runScenario(report, config);
    report.outcome = 'pass';
  } catch (error) {
    report.outcome = 'fail';
    report.error = error?.stack || error?.message || String(error);
  }

  cleanupOutputArtifacts(report, config);
  fs.writeFileSync(config.jsonOut, JSON.stringify(report, null, 2));
  fs.writeFileSync(config.mdOut, renderMarkdown(report));

  console.log(`Wrote ${config.jsonOut}`);
  console.log(`Wrote ${config.mdOut}`);
  console.log(JSON.stringify({
    connected: report.systemStatus?.pluginConnected === true,
    outcome: report.outcome,
    scenario: report.scenario,
    canvas: report.canvas,
    disposableDocumentId: report.disposableDocumentId || null,
    assertionCount: report.assertions.length,
    failedAssertions: report.assertions.filter((assertion) => !assertion.passed).map((assertion) => assertion.name),
    files: report.files,
    cleanup: report.cleanup,
    outputCleanup: report.outputCleanup,
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
