#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const UXP_ROOT = path.resolve(ROOT, '..', 'DesignEcho-UXP');
const UXP_MANIFEST = path.join(UXP_ROOT, 'manifest.json');
const TMP_DIR = path.join(ROOT, 'tmp', 'main-image-uxp-toolchain-live');
const EXPORT_DIR = path.join(TMP_DIR, 'exports');
const REPORT_JSON = path.join(TMP_DIR, 'report.json');
const REPORT_MD = path.join(TMP_DIR, 'report.md');
const MCP_ENDPOINT = process.env.MCP_ENDPOINT || 'http://127.0.0.1:8768/mcp';
const DOC_PREFIX = 'DesignEchoMainImageUxPToolchainLive';
const LIVE_FLAG = 'DESIGNECHO_LIVE_MAIN_IMAGE_UXP_TOOLCHAIN';
const DISPOSABLE_FLAG = 'DESIGNECHO_LIVE_MAIN_IMAGE_UXP_TOOLCHAIN_DISPOSABLE_DOCUMENT';

const REQUIRED_TOOL_NAMES = [
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

const BOUNDARIES = [
  'default run does not touch Photoshop',
  'live mode writes only a disposable document',
  'no design quality claim',
  'does not validate main-image design quality'
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

function readJsonSafe(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    return { __readError: error?.message || String(error) };
  }
}

function readTextSafe(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    return null;
  }
}

function getFileStatsSafe(filePath) {
  try {
    const stats = fs.statSync(filePath);
    return {
      exists: true,
      size: stats.size,
      lastModifiedAt: stats.mtime.toISOString()
    };
  } catch {
    return {
      exists: false
    };
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isPreflightMode() {
  return process.argv.includes('--preflight')
    || process.env.DESIGNECHO_LIVE_MAIN_IMAGE_UXP_TOOLCHAIN_PREFLIGHT === '1';
}

function isLiveArmed() {
  return process.env[LIVE_FLAG] === '1' && process.env[DISPOSABLE_FLAG] === '1';
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

async function rpc(method, params = {}) {
  const response = await fetch(MCP_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: Date.now() + Math.random(), method, params })
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} from ${MCP_ENDPOINT}`);
  }
  const payload = await response.json();
  if (payload.error) {
    throw new Error(`${method} failed: ${asJson(payload.error)}`);
  }
  return payload.result;
}

async function safeRpc(method, params = {}) {
  try {
    return { ok: true, result: await rpc(method, params) };
  } catch (error) {
    return { ok: false, error: error?.message || String(error) };
  }
}

async function callTool(name, args = {}) {
  return parseToolResult(await rpc('tools/call', { name, arguments: args }));
}

async function safeCallTool(name, args = {}) {
  try {
    return { ok: true, result: await callTool(name, args) };
  } catch (error) {
    return { ok: false, error: error?.message || String(error) };
  }
}

async function callPhotoshopTool(name, args = {}) {
  return callTool('photoshop.tools.call', { name, arguments: args });
}

function isHostModalMessage(message) {
  return /host is in a modal state|modal state/i.test(String(message || ''));
}

function isHostModalResult(result) {
  return result?.success === false && isHostModalMessage(result.error || result.message);
}

async function callPhotoshopToolStable(name, args = {}, options = {}) {
  const attempts = options.attempts || 5;
  const delayMs = options.delayMs || 250;
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const result = await callPhotoshopTool(name, args);
      if (!isHostModalResult(result) || attempt >= attempts) {
        if (result && typeof result === 'object') {
          result.__smokeAttempts = attempt;
        }
        return result;
      }
    } catch (error) {
      lastError = error;
      if (!isHostModalMessage(error?.message) || attempt >= attempts) {
        throw error;
      }
    }
    await sleep(delayMs * attempt);
  }

  if (lastError) throw lastError;
  return callPhotoshopTool(name, args);
}

function normalizeDocuments(result) {
  return Array.isArray(result?.documents) ? result.documents : [];
}

function documentExists(result, documentId) {
  return normalizeDocuments(result).some((doc) => Number(doc?.id) === Number(documentId));
}

function normalizeToolNames(result) {
  const tools = Array.isArray(result?.tools) ? result.tools : [];
  return tools.map((tool) => String(tool?.name || '').trim()).filter(Boolean);
}

function buildLocalUxpBundleDiagnostics(requiredToolNames, missingRuntimeToolNames) {
  const manifest = readJsonSafe(UXP_MANIFEST);
  const manifestMain = typeof manifest?.main === 'string' ? manifest.main : 'dist/runtime.js';
  const runtimePath = path.resolve(UXP_ROOT, manifestMain);
  const runtimeSource = readTextSafe(runtimePath);
  const bundleToolPresence = {};

  for (const toolName of requiredToolNames) {
    bundleToolPresence[toolName] = typeof runtimeSource === 'string' && runtimeSource.includes(toolName);
  }

  const missingToolsPresentInBundle = missingRuntimeToolNames
    .filter((toolName) => bundleToolPresence[toolName] === true);
  const runtimeMismatchLikely = missingRuntimeToolNames.length > 0
    && missingToolsPresentInBundle.length === missingRuntimeToolNames.length;

  return {
    uxpRoot: UXP_ROOT,
    manifestPath: UXP_MANIFEST,
    manifestMain,
    runtimePath,
    manifestReadError: manifest?.__readError || null,
    runtimeFile: getFileStatsSafe(runtimePath),
    bundleToolPresence,
    missingToolsPresentInBundle,
    runtimeMismatchLikely,
    guidance: runtimeMismatchLikely
      ? 'Current bundle contains the missing tools, but Photoshop runtime tools/list does not. Fully unload/load the UXP plugin or restart Photoshop, then rerun preflight.'
      : 'If required tools are absent from the bundle, rebuild DesignEcho-UXP before reloading the plugin.'
  };
}

function hierarchyLayers(result) {
  const flat = result?.flatList || result?.layers || result?.snapshot?.layers || [];
  return Array.isArray(flat) ? flat : [];
}

function findLayer(result, layerId) {
  return hierarchyLayers(result).find((layer) => Number(layer?.id) === Number(layerId)) || null;
}

function summarizeResult(result) {
  if (!result || typeof result !== 'object') return result;
  const summary = {};
  for (const key of [
    'success',
    'documentId',
    'name',
    'layerId',
    'targetGroupId',
    'newParentId',
    'newParentName',
    'outputPath',
    'width',
    'height',
    'activeDocumentId',
    'closedDocument',
    'totalLayers',
    'error'
  ]) {
    if (Object.prototype.hasOwnProperty.call(result, key)) {
      summary[key] = result[key];
    }
  }
  if (result.data && typeof result.data === 'object') {
    summary.data = summarizeResult(result.data);
  }
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

function pushStep(report, name, result) {
  report.steps.push({
    name,
    ok: result?.success !== false,
    summary: summarizeResult(result)
  });
}

function assertCondition(report, name, passed, details = {}) {
  const assertion = { name, passed: Boolean(passed), details };
  report.assertions.push(assertion);
  if (!assertion.passed) {
    throw new Error(`Assertion failed: ${name} ${asJson(details)}`);
  }
}

function assertToolSuccess(report, name, result) {
  pushStep(report, name, result);
  assertCondition(report, `${name} success`, result?.success === true, {
    result: summarizeResult(result)
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

async function cleanupDisposable(report, disposableDocumentId, originalDocumentId) {
  const cleanup = { attempted: false, closed: false, restoredOriginal: false, errors: [] };
  report.cleanup = cleanup;

  if (!disposableDocumentId) {
    cleanup.closed = true;
    cleanup.restoredOriginal = true;
    return cleanup;
  }

  cleanup.attempted = true;
  const beforeClose = await safeListDocuments(report, 'cleanup.listDocuments.beforeClose');
  const shouldClose = !beforeClose || documentExists(beforeClose, disposableDocumentId);

  if (shouldClose) {
    try {
      const closeResult = await callPhotoshopToolStable('closeDocument', {
        documentId: disposableDocumentId,
        save: false
      });
      pushStep(report, 'cleanup.closeDocument.discardDisposable', closeResult);
      cleanup.closed = closeResult?.success === true;
      if (!cleanup.closed) cleanup.errors.push(closeResult?.error || 'closeDocument returned success=false');
    } catch (error) {
      cleanup.errors.push(error?.message || String(error));
      report.steps.push({
        name: 'cleanup.closeDocument.discardDisposable',
        ok: false,
        error: error?.message || String(error)
      });
    }
  } else {
    cleanup.closed = true;
  }

  const afterClose = await safeListDocuments(report, 'cleanup.listDocuments.afterClose');
  cleanup.disposableStillOpen = afterClose ? documentExists(afterClose, disposableDocumentId) : 'unknown';

  if (originalDocumentId && afterClose && documentExists(afterClose, originalDocumentId)) {
    try {
      const switchResult = await callPhotoshopToolStable('switchDocument', { documentId: originalDocumentId });
      pushStep(report, 'cleanup.switchDocument.original', switchResult);
      cleanup.restoredOriginal = switchResult?.success === true;
      if (!cleanup.restoredOriginal) cleanup.errors.push(switchResult?.error || 'switchDocument returned success=false');
    } catch (error) {
      cleanup.errors.push(error?.message || String(error));
      report.steps.push({
        name: 'cleanup.switchDocument.original',
        ok: false,
        error: error?.message || String(error)
      });
    }
  } else {
    cleanup.restoredOriginal = true;
  }

  return cleanup;
}

async function buildPreflightReport() {
  const toolsList = await safeRpc('tools/list', {});
  const systemStatus = toolsList.ok
    ? await safeCallTool('system.status', {})
    : { ok: false, error: 'tools/list failed; system.status skipped.' };
  const photoshopTools = systemStatus.ok && systemStatus.result?.pluginConnected === true
    ? await safeCallTool('photoshop.tools.list', {})
    : { ok: false, error: 'Photoshop plugin is not connected; photoshop.tools.list skipped.' };

  const availableToolNames = photoshopTools.ok ? normalizeToolNames(photoshopTools.result) : [];
  const missingTools = REQUIRED_TOOL_NAMES.filter((name) => !availableToolNames.includes(name));
  const localUxpBundle = buildLocalUxpBundleDiagnostics(REQUIRED_TOOL_NAMES, missingTools);
  const blockers = [];
  if (!toolsList.ok) blockers.push(`MCP tools/list failed: ${toolsList.error}`);
  if (!systemStatus.ok) blockers.push(`system.status failed: ${systemStatus.error}`);
  if (systemStatus.ok && systemStatus.result?.pluginConnected !== true) blockers.push('Photoshop UXP plugin is not connected.');
  if (!photoshopTools.ok) blockers.push(`photoshop.tools.list failed: ${photoshopTools.error}`);
  if (missingTools.length > 0) blockers.push(`Missing Photoshop tools: ${missingTools.join(', ')}`);
  if (localUxpBundle.runtimeMismatchLikely) {
    blockers.push('Runtime mismatch likely: current UXP bundle contains all missing tools, but the connected Photoshop plugin is exposing an older tool registry.');
  }

  return {
    ready: blockers.length === 0,
    endpoint: MCP_ENDPOINT,
    currentBridgeReady: systemStatus.ok && systemStatus.result?.pluginConnected === true,
    toolsList: toolsList.ok ? { ok: true } : toolsList,
    systemStatus: systemStatus.ok ? systemStatus.result : systemStatus,
    photoshopToolCount: availableToolNames.length,
    localUxpBundle,
    requiredTools: REQUIRED_TOOL_NAMES,
    missingTools,
    blockers
  };
}

function buildBaseReport(mode) {
  return {
    generatedAt: new Date().toISOString(),
    mode,
    endpoint: MCP_ENDPOINT,
    success: false,
    skipped: false,
    boundaries: BOUNDARIES,
    steps: [],
    assertions: [],
    cleanup: {},
    artifactPaths: {
      json: REPORT_JSON,
      markdown: REPORT_MD,
      exportDir: EXPORT_DIR
    }
  };
}

function renderMarkdown(report) {
  const lines = [
    '# Main Image UXP Toolchain Live Smoke',
    '',
    `- success: ${report.success}`,
    `- skipped: ${Boolean(report.skipped)}`,
    `- mode: ${report.mode}`,
    `- endpoint: ${report.endpoint}`,
    report.reason ? `- reason: ${report.reason}` : '',
    report.error ? `- error: ${report.error.split('\n')[0]}` : '',
    '',
    '## Boundaries',
    ''
  ].filter(Boolean);

  for (const boundary of report.boundaries || []) {
    lines.push(`- ${boundary}`);
  }

  if (report.preflight) {
    lines.push('', '## Preflight', '', '```json');
    lines.push(JSON.stringify(report.preflight, null, 2));
    lines.push('```');
  }

  if (Array.isArray(report.assertions) && report.assertions.length > 0) {
    lines.push('', '## Assertions', '', '```json');
    lines.push(JSON.stringify(report.assertions, null, 2));
    lines.push('```');
  }

  if (Array.isArray(report.steps) && report.steps.length > 0) {
    lines.push('', '## Steps', '', '```json');
    lines.push(JSON.stringify(report.steps, null, 2));
    lines.push('```');
  }

  if (report.cleanup) {
    lines.push('', '## Cleanup', '', '```json');
    lines.push(JSON.stringify(report.cleanup, null, 2));
    lines.push('```');
  }

  return `${lines.join('\n')}\n`;
}

function writeReport(report) {
  ensureDir(TMP_DIR);
  fs.writeFileSync(REPORT_JSON, JSON.stringify(report, null, 2), 'utf8');
  fs.writeFileSync(REPORT_MD, renderMarkdown(report), 'utf8');
}

function writeSkippedReport(reason) {
  const report = buildBaseReport('skipped-guarded-live');
  report.success = true;
  report.skipped = true;
  report.reason = reason;
  report.requiredEnvironment = {
    [LIVE_FLAG]: '1',
    [DISPOSABLE_FLAG]: '1'
  };
  writeReport(report);
  console.log(JSON.stringify({
    success: true,
    skipped: true,
    reason,
    report: REPORT_JSON,
    boundaries: BOUNDARIES
  }, null, 2));
}

async function writePreflightReport() {
  const report = buildBaseReport('preflight');
  report.preflight = await buildPreflightReport();
  report.success = true;
  writeReport(report);
  console.log(JSON.stringify({
    success: true,
    mode: report.mode,
    ready: report.preflight.ready,
    blockers: report.preflight.blockers,
    report: REPORT_JSON
  }, null, 2));
}

async function verifyToolchain(report) {
  const preflight = await buildPreflightReport();
  report.preflight = preflight;
  assertCondition(report, 'preflight ready', preflight.ready === true, preflight);

  const beforeDocs = await callPhotoshopToolStable('listDocuments', { includeDetails: false });
  assertToolSuccess(report, 'listDocuments.before', beforeDocs);
  const documents = normalizeDocuments(beforeDocs);
  const originalDocumentId = beforeDocs.activeDocumentId || documents.find((doc) => doc.isActive)?.id || documents[0]?.id;
  report.originalDocumentId = originalDocumentId || null;

  const disposableName = `${DOC_PREFIX}_${Date.now()}`;
  report.disposableDocumentName = disposableName;
  let disposableDocumentId = null;
  let parentGroupId = null;
  let childGroupId = null;
  let heroLayerId = null;

  try {
    ensureDir(EXPORT_DIR);
    const exportPath = path.join(EXPORT_DIR, `${disposableName}-click-1x1.png`);
    report.exportPath = exportPath;

    const createDocument = await callPhotoshopToolStable('createDocument', {
      name: disposableName,
      width: 800,
      height: 800,
      resolution: 72,
      backgroundColor: 'white',
      colorMode: 'RGB'
    });
    assertToolSuccess(report, 'createDocument.disposable', createDocument);
    disposableDocumentId = Number(createDocument.documentId || createDocument.document?.id);
    report.disposableDocumentId = disposableDocumentId;
    assertCondition(report, 'disposable document id returned', Number.isFinite(disposableDocumentId), {
      disposableDocumentId
    });

    const parentGroup = await callPhotoshopToolStable('createGroup', { groupName: 'click_conversion_group' });
    assertToolSuccess(report, 'createGroup.parent', parentGroup);
    parentGroupId = Number(parentGroup.layerId || parentGroup.group?.id);
    assertCondition(report, 'parent group id returned', Number.isFinite(parentGroupId), { parentGroupId });

    const childGroup = await callPhotoshopToolStable('createGroup', { groupName: 'click_1x1_variant' });
    assertToolSuccess(report, 'createGroup.child', childGroup);
    childGroupId = Number(childGroup.layerId || childGroup.group?.id);
    assertCondition(report, 'child group id returned', Number.isFinite(childGroupId), { childGroupId });

    const nestChild = await callPhotoshopToolStable('moveLayerToGroup', {
      layerId: childGroupId,
      targetGroupId: parentGroupId,
      position: 'inside'
    });
    assertToolSuccess(report, 'moveLayerToGroup.childIntoParent', nestChild);
    assertCondition(report, 'child group moved into parent', Number(nestChild.newParentId) === parentGroupId, {
      parentGroupId,
      result: summarizeResult(nestChild)
    });

    const heroLayer = await callPhotoshopToolStable('createRectangle', {
      name: 'hero_placeholder_layer',
      x: 140,
      y: 220,
      width: 520,
      height: 360,
      fillColorHex: '#E7E2D8',
      cornerRadius: 28
    });
    assertToolSuccess(report, 'createRectangle.heroPlaceholder', heroLayer);
    heroLayerId = Number(heroLayer.layerId);
    assertCondition(report, 'hero layer id returned', Number.isFinite(heroLayerId), { heroLayerId });

    const moveHero = await callPhotoshopToolStable('moveLayerToGroup', {
      layerId: heroLayerId,
      targetGroupId: childGroupId,
      position: 'inside'
    });
    assertToolSuccess(report, 'moveLayerToGroup.heroIntoChild', moveHero);
    assertCondition(report, 'hero layer moved into child group', Number(moveHero.newParentId) === childGroupId, {
      childGroupId,
      result: summarizeResult(moveHero)
    });

    const hierarchy = await callPhotoshopToolStable('getLayerHierarchy', {
      includeHidden: true,
      includeBounds: true,
      flatList: true
    });
    assertToolSuccess(report, 'getLayerHierarchy.afterHierarchyBuild', hierarchy);
    report.layerReadback = {
      parentGroupId,
      childGroupId,
      heroLayerId,
      childGroup: findLayer(hierarchy, childGroupId),
      heroLayer: findLayer(hierarchy, heroLayerId)
    };
    assertCondition(report, 'hierarchy readback sees nested child group', Number(report.layerReadback.childGroup?.parentId) === parentGroupId, {
      layerReadback: report.layerReadback
    });
    assertCondition(report, 'hierarchy readback sees hero in child group', Number(report.layerReadback.heroLayer?.parentId) === childGroupId, {
      layerReadback: report.layerReadback
    });

    const layerProperties = await callPhotoshopToolStable('getLayerProperties', { layerId: heroLayerId });
    assertToolSuccess(report, 'getLayerProperties.hero', layerProperties);
    assertCondition(report, 'layer properties include bounds', Boolean(layerProperties.properties?.bounds), {
      properties: layerProperties.properties
    });

    const exportGroup = await callPhotoshopToolStable('exportGroup', {
      layerId: childGroupId,
      outputPath: exportPath,
      format: 'png',
      targetWidth: 800,
      targetHeight: 800
    }, { attempts: 2, delayMs: 300 });
    assertToolSuccess(report, 'exportGroup.childGroupPng', exportGroup);
    const exportedPath = exportGroup.data?.outputPath || exportGroup.outputPath || exportPath;
    report.exportedPath = exportedPath;
    const exportStat = fs.existsSync(exportedPath) ? fs.statSync(exportedPath) : null;
    assertCondition(report, 'exported group file exists', Boolean(exportStat && exportStat.size > 0), {
      exportedPath,
      size: exportStat?.size || 0
    });
  } finally {
    await cleanupDisposable(report, disposableDocumentId, report.originalDocumentId);
  }

  assertCondition(report, 'disposable document closed', report.cleanup?.disposableStillOpen === false, {
    cleanup: report.cleanup
  });
}

async function runLive() {
  const report = buildBaseReport('live-disposable-toolchain');
  try {
    await verifyToolchain(report);
    report.success = true;
  } catch (error) {
    report.success = false;
    report.error = error?.stack || error?.message || String(error);
  }

  writeReport(report);
  console.log(JSON.stringify({
    success: report.success,
    mode: report.mode,
    disposableDocumentId: report.disposableDocumentId || null,
    exportedPath: report.exportedPath || null,
    assertionCount: report.assertions.length,
    failedAssertions: report.assertions.filter((assertion) => !assertion.passed).map((assertion) => assertion.name),
    cleanup: report.cleanup,
    report: REPORT_JSON,
    error: report.error ? report.error.split('\n')[0] : null
  }, null, 2));

  if (!report.success) process.exit(1);
}

async function main() {
  if (isPreflightMode()) {
    await writePreflightReport();
    return;
  }

  if (!isLiveArmed()) {
    writeSkippedReport(`Set ${LIVE_FLAG}=1 and ${DISPOSABLE_FLAG}=1 to run the disposable Photoshop write smoke.`);
    return;
  }

  await runLive();
}

main().catch((error) => {
  console.error(`FAIL: ${error?.message || String(error)}`);
  process.exit(1);
});
