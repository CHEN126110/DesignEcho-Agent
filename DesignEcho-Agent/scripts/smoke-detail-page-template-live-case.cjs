#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'tmp', 'template-validation');
const EXPORT_DIR = path.join(OUT_DIR, 'exports');
const JSON_OUT = path.join(OUT_DIR, 'detail-template-live-case.json');
const MD_OUT = path.join(OUT_DIR, 'detail-template-live-case.md');
const MCP_ENDPOINT = process.env.MCP_ENDPOINT || 'http://127.0.0.1:8768/mcp';

function parseArgs(argv) {
  const args = {
    templatePath: process.env.DETAIL_TEMPLATE_PATH || '',
    expectTrap: process.env.DETAIL_TEMPLATE_EXPECT_TRAP === '1',
    exportSmoke: process.env.DETAIL_TEMPLATE_EXPORT_SMOKE === '1',
    keepExport: process.env.DETAIL_TEMPLATE_KEEP_EXPORT === '1'
  };

  for (let index = 2; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--template' && argv[index + 1]) {
      args.templatePath = argv[index + 1];
      index += 1;
      continue;
    }
    if (value === '--expect-template-pit') {
      args.expectTrap = true;
    }
    if (value === '--export-smoke') {
      args.exportSmoke = true;
    }
    if (value === '--keep-export') {
      args.keepExport = true;
    }
  }

  return args;
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

async function rpc(method, params = {}) {
  const response = await fetch(MCP_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: Date.now() + Math.random(),
      method,
      params
    })
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} from ${MCP_ENDPOINT}: ${text.slice(0, 500)}`);
  }

  const payload = JSON.parse(text);
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

async function safeCallPhotoshopTool(name, args = {}) {
  try {
    return { ok: true, result: await callPhotoshopTool(name, args) };
  } catch (error) {
    return { ok: false, error: error?.message || String(error) };
  }
}

function normalizeDocuments(result) {
  return Array.isArray(result?.documents) ? result.documents : [];
}

function documentExists(result, documentId) {
  return normalizeDocuments(result).some((document) => Number(document?.id) === Number(documentId));
}

function getActiveDocumentId(result) {
  const documents = normalizeDocuments(result);
  return Number(result?.activeDocumentId || documents.find((document) => document?.isActive)?.id || 0) || null;
}

function compactIssue(issue) {
  return {
    type: issue?.type,
    severity: issue?.severity,
    layerId: issue?.layerId,
    layerName: issue?.layerName,
    screenIndex: issue?.screenIndex,
    description: issue?.description
  };
}

function compactScreen(screen) {
  return {
    id: screen?.id,
    name: screen?.name,
    type: screen?.type,
    typeConfidence: screen?.typeConfidence,
    index: screen?.index,
    bounds: screen?.bounds,
    copyCount: Array.isArray(screen?.copyPlaceholders) ? screen.copyPlaceholders.length : 0,
    imageCount: Array.isArray(screen?.imagePlaceholders) ? screen.imagePlaceholders.length : 0,
    iconCount: Array.isArray(screen?.iconPlaceholders) ? screen.iconPlaceholders.length : 0,
    missingGroups: Array.isArray(screen?.structure?.missingGroups) ? screen.structure.missingGroups : []
  };
}

function hasIssue(issues, type, matcher = () => true) {
  return issues.some((issue) => issue?.type === type && matcher(issue));
}

function assertCheck(report, name, passed, details = {}) {
  report.assertions.push({ name, passed: Boolean(passed), details });
  if (!passed) {
    report.outcome = 'fail';
  }
}

function assertExportFileExists(report, filePath, label) {
  const exists = Boolean(filePath && fs.existsSync(filePath));
  const size = exists ? fs.statSync(filePath).size : 0;
  report.exportSmoke.files.push({
    label,
    filePath: filePath || null,
    existedBeforeCleanup: exists,
    size
  });
  assertCheck(report, `${label} exists`, exists && size > 0, { filePath, size });
}

function cleanupExportArtifacts(report, keepExport) {
  if (!report.exportSmoke?.requested) {
    return;
  }

  if (keepExport) {
    report.exportSmoke.cleanup = {
      attempted: false,
      kept: true,
      removed: false,
      directory: EXPORT_DIR
    };
    return;
  }

  try {
    fs.rmSync(EXPORT_DIR, { recursive: true, force: true });
    report.exportSmoke.cleanup = {
      attempted: true,
      kept: false,
      removed: true,
      directory: EXPORT_DIR
    };
  } catch (error) {
    report.exportSmoke.cleanup = {
      attempted: true,
      kept: false,
      removed: false,
      directory: EXPORT_DIR,
      error: error?.message || String(error)
    };
    assertCheck(report, 'template export cleanup completed', false, report.exportSmoke.cleanup);
  }
}

async function runExportSmoke(report) {
  fs.rmSync(EXPORT_DIR, { recursive: true, force: true });
  ensureDir(EXPORT_DIR);

  const exportResult = await callPhotoshopTool('batchExport', {
    outputDirectory: EXPORT_DIR,
    format: 'jpg',
    quality: 80,
    presets: [
      { width: 360, height: 0, suffix: '_360w' },
      { width: 180, height: 0, suffix: '_180w' }
    ]
  });

  report.exportSmoke.result = exportResult;
  assertCheck(report, 'template batchExport succeeded', exportResult?.success === true, {
    result: exportResult
  });
  assertCheck(report, 'template batchExport returned two files', Array.isArray(exportResult?.exportedFiles) && exportResult.exportedFiles.length === 2, {
    exportedFiles: exportResult?.exportedFiles
  });

  for (const [index, exportedFile] of (exportResult?.exportedFiles || []).entries()) {
    assertExportFileExists(report, exportedFile.filePath, `template export file ${index + 1}`);
  }
}

function listProcessNames() {
  if (process.platform !== 'win32') return [];

  try {
    const output = execFileSync('powershell.exe', [
      '-NoProfile',
      '-Command',
      'Get-Process | ForEach-Object { $_.ProcessName }'
    ], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    });

    return output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function buildRuntimeDiagnostics(status) {
  const processNames = listProcessNames();
  const processNameSet = new Set(processNames.map((name) => name.toLowerCase()));
  const relevantProcesses = processNames.filter((name) => (
    /photoshop|uxp|electron|node/i.test(name)
  ));

  return {
    pluginConnected: status?.pluginConnected === true,
    pluginConnectionDiagnostics: status?.pluginConnectionDiagnostics ?? null,
    photoshopProcessRunning: processNameSet.has('photoshop'),
    uxpDeveloperToolsRunning: relevantProcesses.some((name) => /uxp/i.test(name)),
    agentElectronRunning: processNameSet.has('electron'),
    relevantProcesses: Array.from(new Set(relevantProcesses)).sort()
  };
}

function renderMarkdown(report) {
  const lines = [
    '# Detail Page Template Live Case',
    '',
    `- generatedAt: ${report.generatedAt}`,
    `- endpoint: ${report.endpoint}`,
    `- outcome: ${report.outcome}`,
    `- openedTemplatePath: ${report.openedTemplatePath || 'active-document'}`,
    `- document: ${report.parseSummary.documentName || 'unknown'}`,
    `- screenCount: ${report.parseSummary.screenCount}`,
    `- issueCount: ${report.parseSummary.issueCount}`,
    '',
    '## Assertions',
    '',
    '```json',
    JSON.stringify(report.assertions, null, 2),
    '```',
    '',
    '## Runtime Diagnostics',
    '',
    '```json',
    JSON.stringify(report.runtimeDiagnostics, null, 2),
    '```',
    '',
    '## Screens',
    '',
    '```json',
    JSON.stringify(report.screens, null, 2),
    '```',
    '',
    '## Issues',
    '',
    '```json',
    JSON.stringify(report.issues, null, 2),
    '```'
  ];

  if (report.cleanup) {
    if (report.exportSmoke?.requested) {
      lines.push('', '## Export Smoke', '', '```json');
      lines.push(JSON.stringify(report.exportSmoke, null, 2));
      lines.push('```');
    }

    lines.push('', '## Cleanup', '', '```json');
    lines.push(JSON.stringify(report.cleanup, null, 2));
    lines.push('```');
  }

  if (report.error) {
    lines.push('', '## Error', '', '```text', report.error, '```');
  }

  return `${lines.join('\n')}\n`;
}

async function cleanupOpenedTemplate(report) {
  if (!report.cleanup?.openedBySmoke || !report.cleanup?.openedDocumentId) {
    return;
  }

  const closeResult = await safeCallPhotoshopTool('closeDocument', {
    documentId: report.cleanup.openedDocumentId,
    save: false
  });
  report.cleanup.closeResult = closeResult;
  report.cleanup.closed = closeResult.ok && closeResult.result?.success === true;

  const afterClose = await safeCallPhotoshopTool('listDocuments', { includeDetails: false });
  report.cleanup.afterClose = afterClose.ok ? afterClose.result : afterClose;
  report.cleanup.openedDocumentStillOpen = afterClose.ok
    ? documentExists(afterClose.result, report.cleanup.openedDocumentId)
    : 'unknown';

  if (report.cleanup.originalDocumentId && afterClose.ok && documentExists(afterClose.result, report.cleanup.originalDocumentId)) {
    const switchResult = await safeCallPhotoshopTool('switchDocument', {
      documentId: report.cleanup.originalDocumentId
    });
    report.cleanup.restoreOriginalResult = switchResult;
    report.cleanup.restoredOriginal = switchResult.ok && switchResult.result?.success === true;
  } else {
    report.cleanup.restoredOriginal = true;
  }
}

async function main() {
  const args = parseArgs(process.argv);
  ensureDir(OUT_DIR);

  const report = {
    generatedAt: new Date().toISOString(),
    endpoint: MCP_ENDPOINT,
    outcome: 'pass',
    openedTemplatePath: args.templatePath || null,
    status: null,
    openResult: null,
    runtimeDiagnostics: null,
    parseSummary: {},
    screens: [],
    issues: [],
    assertions: [],
    cleanup: {
      openedBySmoke: false,
      openedDocumentId: null,
      originalDocumentId: null,
      closed: null,
      restoredOriginal: null
    },
    exportSmoke: {
      requested: args.exportSmoke,
      outputDirectory: EXPORT_DIR,
      files: [],
      result: null,
      cleanup: null
    }
  };

  try {
    report.status = await callTool('system.status', {});
    report.runtimeDiagnostics = buildRuntimeDiagnostics(report.status);
    assertCheck(report, 'Photoshop UXP plugin connected', report.status?.pluginConnected === true, {
      pluginConnected: report.status?.pluginConnected,
      runtimeDiagnostics: report.runtimeDiagnostics
    });

    if (args.templatePath) {
      const beforeOpen = await callPhotoshopTool('listDocuments', { includeDetails: false });
      const beforeDocumentIds = new Set(normalizeDocuments(beforeOpen).map((document) => Number(document?.id)));
      report.cleanup.originalDocumentId = getActiveDocumentId(beforeOpen);
      report.cleanup.beforeOpen = beforeOpen;

      report.openResult = await callPhotoshopTool('openTemplate', { psdPath: args.templatePath });
      assertCheck(report, 'template opened', report.openResult?.success === true, {
        openResult: report.openResult
      });
      if (report.openResult?.success !== true) {
        throw new Error(`Template open failed before parse: ${report.openResult?.error || args.templatePath}`);
      }

      const afterOpen = await callPhotoshopTool('listDocuments', { includeDetails: false });
      const openedDocumentId = getActiveDocumentId(afterOpen);
      report.cleanup.openedDocumentId = openedDocumentId;
      report.cleanup.afterOpen = afterOpen;
      report.cleanup.openedBySmoke = Boolean(openedDocumentId && !beforeDocumentIds.has(openedDocumentId));
    }

    const parsed = await callPhotoshopTool('parseDetailPageTemplate', { includeStructure: true });
    const screens = Array.isArray(parsed?.screens) ? parsed.screens : [];
    const issues = Array.isArray(parsed?.issues) ? parsed.issues : [];
    report.parseSummary = {
      success: parsed?.success,
      documentName: parsed?.documentName,
      documentSize: parsed?.documentSize,
      screenCount: parsed?.screenCount,
      issueCount: issues.length,
      crossScreenLayerCount: Array.isArray(parsed?.crossScreenLayers) ? parsed.crossScreenLayers.length : 0,
      parseTime: parsed?.parseTime
    };
    report.screens = screens.map(compactScreen);
    report.issues = issues.map(compactIssue);

    assertCheck(report, 'active document parsed', parsed?.success === true, {
      parseSummary: report.parseSummary
    });
    assertCheck(report, 'detail template inferred without user label', Number(parsed?.screenCount || 0) >= 8, {
      screenCount: parsed?.screenCount,
      screenNames: report.screens.map((screen) => screen.name)
    });
    assertCheck(report, 'nested detail container detected', hasIssue(issues, 'detail_container_detected'), {
      issues: report.issues.filter((issue) => issue.type === 'detail_container_detected')
    });

    if (args.expectTrap) {
      assertCheck(report, 'polluted screen bounds detected', hasIssue(issues, 'screen_bounds_repaired', (issue) => String(issue?.layerName || '') === '13'), {
        issues: report.issues.filter((issue) => issue.type === 'screen_bounds_repaired')
      });
      assertCheck(report, 'empty 0x0 layer excluded', hasIssue(issues, 'empty_or_invalid_layer_bounds', (issue) => String(issue?.layerName || '').includes('图层 4')), {
        issues: report.issues.filter((issue) => issue.type === 'empty_or_invalid_layer_bounds')
      });

      const screen13 = report.screens.find((screen) => String(screen.name) === '13');
      assertCheck(report, 'screen 13 bounds repaired to lower detail-page area', !!screen13 && Number(screen13.bounds?.top || 0) > 12000, {
        screen13
      });
    }

    if (args.exportSmoke) {
      await runExportSmoke(report);
    }
  } catch (error) {
    report.outcome = 'fail';
    report.error = error?.stack || error?.message || String(error);
  } finally {
    cleanupExportArtifacts(report, args.keepExport);
    await cleanupOpenedTemplate(report);
  }

  if (report.cleanup.openedBySmoke) {
    assertCheck(report, 'explicit template closed without saving', report.cleanup.closed === true && report.cleanup.openedDocumentStillOpen === false, {
      cleanup: report.cleanup
    });
  }

  if (report.assertions.some((assertion) => !assertion.passed)) {
    report.outcome = 'fail';
  }

  fs.writeFileSync(JSON_OUT, JSON.stringify(report, null, 2), 'utf8');
  fs.writeFileSync(MD_OUT, renderMarkdown(report), 'utf8');

  console.log(JSON.stringify({
    outcome: report.outcome,
    json: JSON_OUT,
    markdown: MD_OUT,
    parseSummary: report.parseSummary,
    runtimeDiagnostics: report.runtimeDiagnostics,
    failedAssertions: report.assertions.filter((assertion) => !assertion.passed).map((assertion) => assertion.name)
  }, null, 2));

  if (report.outcome !== 'pass') {
    process.exit(1);
  }
}

main();
