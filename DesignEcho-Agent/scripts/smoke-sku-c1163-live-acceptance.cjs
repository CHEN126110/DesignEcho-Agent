#!/usr/bin/env node
/* eslint-disable no-console */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '..', 'tsconfig.main.json')
});

const {
  buildSkuExportReadback
} = require(path.join(__dirname, '..', 'src', 'shared', 'sku-export-readback.ts'));
const {
  buildSkuConfiguredExecutionPlan
} = require(path.join(__dirname, '..', 'src', 'shared', 'sku-configured-execution-plan.ts'));
const {
  buildSkuLayoutExecutionBatches
} = require(path.join(__dirname, '..', 'src', 'shared', 'sku-layout-execution-batches.ts'));
const {
  ResourceManagerService
} = require(path.join(__dirname, '..', 'src', 'main', 'services', 'resource-manager-service.ts'));

const ROOT = path.resolve(__dirname, '..');
const TMP_DIR = path.join(ROOT, 'tmp', 'sku-c1163-live-acceptance');
const REPORT_JSON = path.join(TMP_DIR, 'report.json');
const REPORT_MD = path.join(TMP_DIR, 'report.md');
const MCP_ENDPOINT = process.env.MCP_ENDPOINT || 'http://127.0.0.1:8768/mcp';

const LIVE_FLAG = 'DESIGNECHO_LIVE_SKU_C1163_ACCEPTANCE';
const TAKEOVER_FLAG = 'DESIGNECHO_LIVE_SKU_C1163_TAKEOVER';
const DISPOSABLE_OUTPUT_FLAG = 'DESIGNECHO_LIVE_SKU_C1163_DISPOSABLE_OUTPUT';
const EXECUTE_MINIMAL_FLAG = 'DESIGNECHO_LIVE_SKU_C1163_EXECUTE_MINIMAL';
const EXECUTE_CONFIGURED_FLAG = 'DESIGNECHO_LIVE_SKU_C1163_EXECUTE_CONFIGURED';
const PROJECT_PATH_ENV = 'DESIGNECHO_LIVE_SKU_C1163_PROJECT_PATH';
const TIMEOUT_ENV = 'DESIGNECHO_LIVE_SKU_C1163_MCP_TIMEOUT_MS';
const EXECUTION_TIMEOUT_ENV = 'DESIGNECHO_LIVE_SKU_C1163_EXECUTION_TIMEOUT_MS';
const MINIMAL_SIZE_ENV = 'DESIGNECHO_LIVE_SKU_C1163_MINIMAL_SIZE';
const MINIMAL_NOTE_ENV = 'DESIGNECHO_LIVE_SKU_C1163_INCLUDE_NOTE';

const DEFAULT_PROJECT_PATH = 'D:\\DesignEchoDemo\\C-1163';
const REQUIRED_TOOLS = [
  'listDocuments',
  'switchDocument',
  'closeDocument',
  'openTemplate',
  'skuLayout',
  'getAcceptanceSnapshot'
];

function reportModeFileName(mode, ext) {
  const safeMode = String(mode || 'unknown')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'unknown';
  return `report-${safeMode}.${ext}`;
}

function reportPathsForMode(mode) {
  return {
    latestJson: REPORT_JSON,
    latestMarkdown: REPORT_MD,
    modeJson: path.join(TMP_DIR, reportModeFileName(mode, 'json')),
    modeMarkdown: path.join(TMP_DIR, reportModeFileName(mode, 'md'))
  };
}

function parsePositiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : fallback;
}

const MCP_REQUEST_TIMEOUT_MS = parsePositiveInteger(process.env[TIMEOUT_ENV], 20_000);
const MCP_EXECUTION_TIMEOUT_MS = parsePositiveInteger(process.env[EXECUTION_TIMEOUT_ENV], 180_000);

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function normalizePath(filePath) {
  return String(filePath || '').replace(/\\/g, '/');
}

function isAbsolutePath(value) {
  return /^[a-zA-Z]:[\\/]/.test(String(value || '')) || /^\\\\/.test(String(value || '')) || path.isAbsolute(String(value || ''));
}

function redactPath(value) {
  const text = String(value || '');
  if (!text) return text;
  if (!isAbsolutePath(text)) return normalizePath(text);
  return `[local-path-redacted]/${path.basename(text)}`;
}

function sanitize(value) {
  if (Array.isArray(value)) return value.map(sanitize);
  if (!value || typeof value !== 'object') {
    if (typeof value === 'string') {
      if (/data:image\//i.test(value) || /base64/i.test(value)) return '[binary-redacted]';
      const trimmed = value.trim();
      if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
        try {
          return sanitize(JSON.parse(trimmed));
        } catch {
          // Fall through to path redaction for non-JSON strings.
        }
      }
      return isAbsolutePath(value) ? redactPath(value) : value;
    }
    return value;
  }
  return Object.fromEntries(Object.entries(value).map(([key, item]) => {
    if (/(path|dir|directory|output|file)$/i.test(key) && typeof item === 'string') {
      return [key, redactPath(item)];
    }
    return [key, sanitize(item)];
  }));
}

function listFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  const entries = [];
  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const child = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(child);
      } else if (entry.isFile()) {
        entries.push(child);
      }
    }
  }
  return entries.sort((a, b) => normalizePath(a).localeCompare(normalizePath(b), 'zh-Hans-CN'));
}

function extractSkuOutputColorNames(fileName) {
  const stem = path.basename(String(fileName || ''), path.extname(String(fileName || '')))
    .trim()
    .replace(/^\d+[\s._-]*/u, '');
  if (!stem.includes('+')) return [];
  return stem
    .split('+')
    .map((name) => String(name || '').trim())
    .filter(Boolean);
}

function buildSkuOutputEvidence(files) {
  const images = Array.isArray(files) ? files : [];
  const seen = new Set();
  const colorNames = [];
  for (const file of images) {
    for (const colorName of extractSkuOutputColorNames(file.fileName)) {
      if (seen.has(colorName)) continue;
      seen.add(colorName);
      colorNames.push(colorName);
    }
  }
  return {
    schema: 'sku-existing-output-evidence/v0',
    status: images.length > 0 ? 'found_existing_sku_outputs' : 'not_found',
    fileCount: images.length,
    sampleFileNames: images.slice(0, 20).map((file) => file.fileName),
    colorCount: colorNames.length,
    colorNames,
    boundaries: {
      readOnly: true,
      writesPhotoshop: false,
      writesProjectDocuments: false,
      writesProjectOutputDir: false,
      claimsSkuCompletion: false,
      claimsDesignQuality: false
    }
  };
}

function extractColorNameFromSourceImage(fileName) {
  const stem = path.basename(String(fileName || ''), path.extname(String(fileName || '')))
    .trim()
    .replace(/^\d+[\s._-]*/u, '');
  if (!stem || /详情|主图|白底|tm|1200|750|800/i.test(stem)) return '';
  return stem;
}

function uniqueOrdered(values) {
  const seen = new Set();
  const output = [];
  for (const value of values) {
    const text = String(value || '').trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    output.push(text);
  }
  return output;
}

function buildSkuColorSourceImageEvidence(files, expectedColorNames = []) {
  const images = Array.isArray(files) ? files : [];
  const colorNames = uniqueOrdered(images.map((file) => extractColorNameFromSourceImage(file.fileName)));
  const expected = uniqueOrdered(expectedColorNames);
  const candidateSet = new Set(colorNames);
  const expectedSet = new Set(expected);
  const matchedExpectedColorNames = expected.filter((name) => candidateSet.has(name));
  const missingExpectedColorNames = expected.filter((name) => !candidateSet.has(name));
  const extraCandidateColorNames = colorNames.filter((name) => !expectedSet.has(name));
  const coverageStatus = expected.length === 0 || images.length === 0
    ? 'not_compared'
    : (missingExpectedColorNames.length === 0 && extraCandidateColorNames.length === 0 ? 'exact_match' : 'name_mismatch_or_partial_match');
  return {
    schema: 'sku-color-source-image-evidence/v0',
    status: images.length > 0 ? 'found_candidate_color_source_images' : 'not_found',
    fileCount: images.length,
    sampleFileNames: images.slice(0, 20).map((file) => file.fileName),
    colorCount: colorNames.length,
    colorNames,
    coverage: {
      comparedAgainst: 'existing_sku_output_color_names',
      status: coverageStatus,
      expectedColorNames: expected,
      matchedExpectedColorNames,
      missingExpectedColorNames,
      extraCandidateColorNames
    },
    boundaries: {
      readOnly: true,
      treatsImagesAsCandidateSourceOnly: true,
      doesNotTreatAsPhotoshopLayerGroups: true,
      writesPhotoshop: false,
      writesProjectDocuments: false,
      writesProjectOutputDir: false,
      claimsSkuCompletion: false,
      claimsDesignQuality: false
    }
  };
}

function pickProjectPath(env = process.env) {
  const explicitPath = String(env[PROJECT_PATH_ENV] || '').trim();
  if (explicitPath) return path.resolve(explicitPath);
  if (fs.existsSync(DEFAULT_PROJECT_PATH)) return DEFAULT_PROJECT_PATH;
  return '';
}

function fileSummary(filePath) {
  const stat = fs.statSync(filePath);
  return {
    fileName: path.basename(filePath),
    absolutePath: filePath,
    ext: path.extname(filePath).toLowerCase(),
    sizeBytes: stat.size
  };
}

function normalizeFileNameKey(fileName) {
  return String(fileName || '').trim().replace(/\s+/g, '').toLowerCase();
}

function templateKindFromFileName(fileName) {
  return /自选备注/.test(String(fileName || '')) ? 'self_select_note' : 'combo';
}

function findTemplateForConfigRow(templateFileName, templates) {
  const wantedKey = normalizeFileNameKey(templateFileName);
  const exact = (templates || []).find((file) => normalizeFileNameKey(file.fileName) === wantedKey);
  if (exact) return exact;
  const wantedSize = extractSizeFromFileName(templateFileName);
  if (!wantedSize) return null;
  return pickFileBySize(templates, wantedSize);
}

function buildEmptySkuConfigPlan(status, blockers = []) {
  return {
    schema: 'sku-configured-execution-plan/v0',
    status,
    configFileName: null,
    encoding: null,
    expectedColorCount: null,
    colorSlotCount: 0,
    availableColorCount: 0,
    availableColorNames: [],
    sizes: [],
    comboExecutionCount: 0,
    noteExecutionCount: 0,
    blockers: [...blockers],
    warnings: [],
    boundaries: {
      readOnly: true,
      writesPhotoshop: false,
      writesProjectDocuments: false,
      writesProjectOutputDir: false,
      claimsSkuCompletion: false,
      claimsDesignQuality: false
    }
  };
}

function toSharedCsvConfigInputs(files) {
  return (Array.isArray(files) ? files : []).map((file) => ({
    fileName: file.fileName,
    base64: fs.readFileSync(file.absolutePath).toString('base64')
  }));
}

function toSharedTemplateInputs(files) {
  return (Array.isArray(files) ? files : []).map((file) => ({
    fileName: file.fileName,
    filePath: file.absolutePath
  }));
}

function buildProjectSkuConfigPlan({ csvConfigs, comboTemplates, noteTemplates }) {
  if (!Array.isArray(csvConfigs) || csvConfigs.length === 0) {
    return buildEmptySkuConfigPlan('blocked_missing_csv_config', ['Project config folder has no CSV SKU config.']);
  }
  return sanitize(buildSkuConfiguredExecutionPlan({
    csvConfigs: toSharedCsvConfigInputs(csvConfigs),
    comboTemplates: toSharedTemplateInputs(comboTemplates),
    noteTemplates: toSharedTemplateInputs(noteTemplates),
    availableColorNames: [],
    validateColorAvailability: false
  }));
}

function scanProject(projectPath) {
  const blockers = [];
  const emptyConfigPlan = buildEmptySkuConfigPlan('blocked_project_files_incomplete');
  if (!projectPath) {
    blockers.push(`${PROJECT_PATH_ENV} is required when the default C-1163 path is unavailable.`);
    return {
      status: 'blocked_missing_project_path',
      projectPath: '',
      blockers,
      files: {
        skuSources: [],
        comboTemplates: [],
        noteTemplates: [],
        csvConfigs: [],
        skuOutputImages: [],
        skuColorSourceImages: []
      },
      skuConfigPlan: buildEmptySkuConfigPlan('blocked_missing_project_path', blockers),
      skuOutputEvidence: buildSkuOutputEvidence([]),
      skuColorSourceImageEvidence: buildSkuColorSourceImageEvidence([])
    };
  }

  if (!fs.existsSync(projectPath) || !fs.statSync(projectPath).isDirectory()) {
    blockers.push(`Project path does not exist or is not a directory: ${redactPath(projectPath)}`);
    return {
      status: 'blocked_project_path_unavailable',
      projectPath,
      blockers,
      files: {
        skuSources: [],
        comboTemplates: [],
        noteTemplates: [],
        csvConfigs: [],
        skuOutputImages: [],
        skuColorSourceImages: []
      },
      skuConfigPlan: buildEmptySkuConfigPlan('blocked_project_path_unavailable', blockers),
      skuOutputEvidence: buildSkuOutputEvidence([]),
      skuColorSourceImageEvidence: buildSkuColorSourceImageEvidence([])
    };
  }

  const files = listFiles(projectPath);
  const isDesignSource = (filePath) => /\.(psd|psb)$/i.test(filePath);
  const isTemplateSource = (filePath) => /\.(psd|psb|tif|tiff)$/i.test(filePath);
  const isInFolder = (filePath, folderKeyword) => normalizePath(filePath).includes(`/${folderKeyword}/`);
  const skuSources = files
    .filter((filePath) => isDesignSource(filePath) && /sku/i.test(path.basename(filePath)) && isInFolder(filePath, 'PSD'))
    .map(fileSummary);
  const templateFiles = files.filter((filePath) => isTemplateSource(filePath) && isInFolder(filePath, '模板文件'));
  const noteTemplates = templateFiles
    .filter((filePath) => /自选备注/.test(path.basename(filePath)))
    .map(fileSummary);
  const comboTemplates = templateFiles
    .filter((filePath) => /双/.test(path.basename(filePath)) && !/自选备注/.test(path.basename(filePath)))
    .map(fileSummary);
  const csvConfigs = files
    .filter((filePath) => /\.csv$/i.test(filePath) && isInFolder(filePath, '配置文件'))
    .map(fileSummary);
  const skuOutputImages = files
    .filter((filePath) => /\.(jpe?g|png|webp)$/i.test(filePath) && isInFolder(filePath, 'SKU'))
    .map(fileSummary);
  const skuOutputEvidence = buildSkuOutputEvidence(skuOutputImages);
  const skuColorSourceImages = files
    .filter((filePath) => /\.(jpe?g|png|webp)$/i.test(filePath))
    .filter((filePath) => !isInFolder(filePath, 'SKU'))
    .filter((filePath) => {
      const colorName = extractColorNameFromSourceImage(path.basename(filePath));
      return Boolean(colorName) && /色|肤|蓝|紫|黑|白/.test(colorName);
    })
    .map(fileSummary);
  const skuColorSourceImageEvidence = buildSkuColorSourceImageEvidence(
    skuColorSourceImages,
    skuOutputEvidence.colorNames
  );

  if (skuSources.length === 0) blockers.push('Project PSD folder has no SKU PSD/PSB source.');
  if (comboTemplates.length === 0) blockers.push('Project template folder has no combo template file.');
  if (noteTemplates.length === 0) blockers.push('Project template folder has no self-select note template file.');
  if (csvConfigs.length === 0) blockers.push('Project config folder has no CSV SKU config.');
  const skuConfigPlan = csvConfigs.length > 0
    ? buildProjectSkuConfigPlan({ csvConfigs, comboTemplates, noteTemplates })
    : emptyConfigPlan;
  blockers.push(...skuConfigPlan.blockers);

  return {
    status: blockers.length === 0 ? 'ready_project_files' : 'blocked_project_files_incomplete',
    projectPath,
    blockers,
    files: {
      skuSources,
      comboTemplates,
      noteTemplates,
      csvConfigs,
      skuOutputImages,
      skuColorSourceImages
    },
    skuConfigPlan,
    skuOutputEvidence,
    skuColorSourceImageEvidence
  };
}

function buildOptIn(env = process.env) {
  const missing = [LIVE_FLAG]
    .filter((name) => String(env[name] || '') !== '1');
  const projectPath = pickProjectPath(env);
  if (!projectPath) missing.push(PROJECT_PATH_ENV);
  return {
    ok: missing.length === 0,
    required: [
      `${LIVE_FLAG}=1`,
      `${PROJECT_PATH_ENV}=<absolute C-1163 project path>`
    ],
    missing,
    boundaries: {
      touchesLivePhotoshop: true,
      writesPhotoshop: false,
      writesProjectDocuments: false,
      writesProjectOutputDir: false,
      usesDisposableOutputDir: false,
      claimsSkuCompletion: false,
      claimsDesignQuality: false
    }
  };
}

function buildMinimalExecutionOptIn(env = process.env) {
  const readiness = buildOptIn(env);
  const missing = [...readiness.missing];
  for (const name of [TAKEOVER_FLAG, DISPOSABLE_OUTPUT_FLAG]) {
    if (String(env[name] || '') !== '1') missing.push(name);
  }
  if (String(env[EXECUTE_MINIMAL_FLAG] || '') !== '1') missing.push(EXECUTE_MINIMAL_FLAG);
  return {
    ok: missing.length === 0,
    required: [
      ...readiness.required,
      `${TAKEOVER_FLAG}=1`,
      `${DISPOSABLE_OUTPUT_FLAG}=1`,
      `${EXECUTE_MINIMAL_FLAG}=1`
    ],
    missing,
    boundaries: {
      touchesLivePhotoshop: true,
      writesPhotoshop: true,
      writesProjectDocuments: false,
      writesProjectOutputDir: false,
      usesDisposableOutputDir: true,
      claimsSkuCompletion: false,
      claimsDesignQuality: false
    }
  };
}

function buildConfiguredExecutionOptIn(env = process.env) {
  const readiness = buildOptIn(env);
  const missing = [...readiness.missing];
  for (const name of [TAKEOVER_FLAG, DISPOSABLE_OUTPUT_FLAG]) {
    if (String(env[name] || '') !== '1') missing.push(name);
  }
  if (String(env[EXECUTE_CONFIGURED_FLAG] || '') !== '1') missing.push(EXECUTE_CONFIGURED_FLAG);
  return {
    ok: missing.length === 0,
    required: [
      ...readiness.required,
      `${TAKEOVER_FLAG}=1`,
      `${DISPOSABLE_OUTPUT_FLAG}=1`,
      `${EXECUTE_CONFIGURED_FLAG}=1`
    ],
    missing,
    boundaries: {
      touchesLivePhotoshop: true,
      writesPhotoshop: true,
      writesProjectDocuments: false,
      writesProjectOutputDir: false,
      usesDisposableOutputDir: true,
      claimsSkuCompletion: false,
      claimsDesignQuality: false
    }
  };
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

async function rpc(method, params = {}, options = {}) {
  const requestTimeoutMs = parsePositiveInteger(options.requestTimeoutMs, MCP_REQUEST_TIMEOUT_MS);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
  let response;
  try {
    response = await fetch(MCP_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: Date.now() + Math.random(),
        method,
        params
      })
    });
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error(`${method} timed out after ${requestTimeoutMs}ms at ${MCP_ENDPOINT}`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) throw new Error(`HTTP ${response.status} from ${MCP_ENDPOINT}`);
  const payload = await response.json();
  if (payload.error) throw new Error(`${method} failed: ${JSON.stringify(payload.error)}`);
  return payload.result;
}

async function callTool(name, args = {}, options = {}) {
  const result = await rpc('tools/call', { name, arguments: args }, options);
  return parseToolResult(result);
}

async function callPhotoshopTool(name, args = {}, options = {}) {
  return callTool('photoshop.tools.call', { name, arguments: args }, options);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isHostModalMessage(value) {
  const text = typeof value === 'string'
    ? value
    : value?.error || value?.message || '';
  return /host is in a modal state|modal state|modal|模态状态|正在处理其他命令/i.test(String(text || ''));
}

function isHostModalResult(result) {
  return result?.success === false && isHostModalMessage(result);
}

async function callPhotoshopToolStable(name, args = {}, options = {}) {
  const attempts = options.attempts || 6;
  const delayMs = options.delayMs || 450;
  const requestTimeoutMs = options.requestTimeoutMs || MCP_EXECUTION_TIMEOUT_MS;
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const result = await callPhotoshopTool(name, args, { requestTimeoutMs });
      if (!isHostModalResult(result) || attempt >= attempts) {
        if (result && typeof result === 'object') result.__smokeAttempts = attempt;
        return result;
      }
    } catch (error) {
      lastError = error;
      if (!isHostModalMessage(error) || attempt >= attempts) throw error;
    }
    await sleep(delayMs * attempt);
  }

  if (lastError) throw lastError;
  return callPhotoshopTool(name, args, { requestTimeoutMs });
}

function normalizeToolNames(result) {
  return (Array.isArray(result?.tools) ? result.tools : [])
    .map((tool) => String(tool?.name || '').trim())
    .filter(Boolean)
    .sort();
}

function formatErrorMessage(error) {
  return error instanceof Error ? error.message : String(error || 'unknown error');
}

async function captureReadinessCall(label, task) {
  const startedAt = Date.now();
  try {
    const value = await task();
    return {
      label,
      ok: true,
      elapsedMs: Date.now() - startedAt,
      value,
      error: null
    };
  } catch (error) {
    return {
      label,
      ok: false,
      elapsedMs: Date.now() - startedAt,
      value: null,
      error: formatErrorMessage(error)
    };
  }
}

function buildReadonlyResponsivenessProbe(toolName, options = {}) {
  const elapsedMs = Number.isFinite(Number(options.elapsedMs)) ? Math.max(0, Math.round(Number(options.elapsedMs))) : 0;
  const result = options.result || null;
  const error = options.error || null;
  const ok = !error && result?.success !== false;
  const errorMessage = error
    ? (error instanceof Error ? error.message : String(error))
    : (result?.success === false ? String(result.error || result.message || 'unknown readonly tool failure') : '');
  return sanitize({
    toolName,
    ok,
    status: ok ? 'responded' : 'blocked_tool_timeout_or_failure',
    elapsedMs,
    documentCount: toolName === 'listDocuments' && ok ? normalizeDocuments(result).length : null,
    error: errorMessage || null
  });
}

function buildReadonlyResponsivenessBlockers(readonlyResponsiveness) {
  const listDocumentsProbe = readonlyResponsiveness?.listDocuments;
  if (!listDocumentsProbe) return ['Readonly responsiveness probe did not run listDocuments.'];
  if (listDocumentsProbe.status === 'skipped_tool_unavailable') return [];
  if (listDocumentsProbe.ok === true) return [];
  const error = listDocumentsProbe.error ? `: ${listDocumentsProbe.error}` : '';
  return [`Readonly Photoshop tool listDocuments did not respond${error}`];
}

async function runReadonlyResponsivenessProbe() {
  const startedAt = Date.now();
  try {
    const result = await callPhotoshopTool('listDocuments', { includeDetails: true }, {
      requestTimeoutMs: MCP_REQUEST_TIMEOUT_MS
    });
    return {
      listDocuments: buildReadonlyResponsivenessProbe('listDocuments', {
        result,
        elapsedMs: Date.now() - startedAt
      })
    };
  } catch (error) {
    return {
      listDocuments: buildReadonlyResponsivenessProbe('listDocuments', {
        error,
        elapsedMs: Date.now() - startedAt
      })
    };
  }
}

async function runBridgeReadiness() {
  const mcpToolsCall = await captureReadinessCall('tools/list', () =>
    rpc('tools/list', {}, { requestTimeoutMs: MCP_REQUEST_TIMEOUT_MS })
  );
  const systemStatusCall = await captureReadinessCall('system.status', () =>
    callTool('system.status', {}, { requestTimeoutMs: MCP_REQUEST_TIMEOUT_MS })
  );
  const systemStatus = systemStatusCall.value || {};
  const photoshopToolsCall = systemStatus?.pluginConnected === true
    ? await captureReadinessCall('photoshop.tools.list', () =>
      callTool('photoshop.tools.list', {}, { requestTimeoutMs: MCP_REQUEST_TIMEOUT_MS })
    )
    : {
      label: 'photoshop.tools.list',
      ok: false,
      elapsedMs: 0,
      value: { tools: [] },
      error: systemStatusCall.ok === true ? 'Photoshop UXP plugin is not connected.' : 'system.status did not respond.'
    };
  const photoshopTools = photoshopToolsCall.value || { tools: [] };
  const toolNames = normalizeToolNames(photoshopTools);
  const missingTools = photoshopToolsCall.ok === true
    ? REQUIRED_TOOLS.filter((toolName) => !toolNames.includes(toolName))
    : [];
  const readonlyResponsiveness = systemStatus?.pluginConnected === true
      && photoshopToolsCall.ok === true
      && !missingTools.includes('listDocuments')
    ? await runReadonlyResponsivenessProbe()
    : {
      listDocuments: {
        toolName: 'listDocuments',
        ok: false,
        status: 'skipped_tool_unavailable',
        elapsedMs: 0,
        documentCount: null,
        error: missingTools.includes('listDocuments')
          ? 'listDocuments is missing from photoshop.tools.list'
          : (photoshopToolsCall.ok !== true
            ? 'photoshop.tools.list did not respond.'
            : 'Photoshop UXP plugin is not connected.')
      }
    };
  const blockers = [];
  if (mcpToolsCall.ok !== true) blockers.push(`MCP tools/list did not respond: ${mcpToolsCall.error}`);
  if (systemStatusCall.ok !== true) blockers.push(`system.status did not respond: ${systemStatusCall.error}`);
  if (systemStatus?.pluginConnected !== true) blockers.push('Photoshop UXP plugin is not connected.');
  if (photoshopToolsCall.ok !== true && systemStatus?.pluginConnected === true) {
    blockers.push(`photoshop.tools.list did not respond: ${photoshopToolsCall.error}`);
  }
  if (missingTools.length > 0) blockers.push(`Missing Photoshop tools: ${missingTools.join(', ')}`);
  blockers.push(...buildReadonlyResponsivenessBlockers(readonlyResponsiveness));
  return {
    ready: blockers.length === 0,
    endpoint: MCP_ENDPOINT,
    readinessCalls: sanitize({
      mcpTools: { ok: mcpToolsCall.ok, elapsedMs: mcpToolsCall.elapsedMs, error: mcpToolsCall.error },
      systemStatus: { ok: systemStatusCall.ok, elapsedMs: systemStatusCall.elapsedMs, error: systemStatusCall.error },
      photoshopTools: { ok: photoshopToolsCall.ok, elapsedMs: photoshopToolsCall.elapsedMs, error: photoshopToolsCall.error }
    }),
    mcpToolCount: normalizeToolNames(mcpToolsCall.value).length,
    photoshopToolCount: toolNames.length,
    requiredTools: REQUIRED_TOOLS,
    missingTools,
    readonlyResponsiveness,
    systemStatus: {
      pluginConnected: systemStatus?.pluginConnected === true,
      pluginConnectionState: systemStatus?.pluginConnectionState || null,
      pluginClientCount: systemStatus?.pluginClientCount ?? null
    },
    blockers
  };
}

function normalizeDocuments(result) {
  return Array.isArray(result?.documents) ? result.documents : [];
}

async function listDocumentsDetailed() {
  const result = await callPhotoshopToolStable('listDocuments', { includeDetails: true }, {
    requestTimeoutMs: MCP_REQUEST_TIMEOUT_MS
  });
  if (result?.success === false) {
    throw new Error(`listDocuments failed: ${result.error || 'unknown error'}`);
  }
  return result;
}

function documentIdentity(doc) {
  return `${Number(doc?.id) || 0}:${String(doc?.name || '').trim()}:${normalizePath(doc?.path || '')}`;
}

function documentSet(result) {
  return new Set(normalizeDocuments(result).map(documentIdentity));
}

function findDocumentByName(result, documentName) {
  const wanted = String(documentName || '').trim().toLowerCase();
  if (!wanted) return null;
  return normalizeDocuments(result).find((doc) => String(doc?.name || '').trim().toLowerCase() === wanted) || null;
}

function findDocumentByPathOrName(result, filePath) {
  const normalizedPath = normalizePathForCompare(filePath);
  const normalizedBase = path.basename(String(filePath || '')).toLowerCase();
  return normalizeDocuments(result).find((doc) => {
    const docPath = normalizePathForCompare(doc?.path || '');
    const docName = String(doc?.name || '').trim().toLowerCase();
    return (normalizedPath && docPath && docPath === normalizedPath) || (normalizedBase && docName === normalizedBase);
  }) || null;
}

function normalizePathForCompare(input) {
  return String(input || '').trim().replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();
}

function extractSizeFromFileName(fileName) {
  const match = String(fileName || '').match(/(\d{1,2})\s*双/);
  const size = match ? Number(match[1]) : NaN;
  return Number.isFinite(size) && size > 0 ? Math.round(size) : null;
}

function pickFileBySize(files, size) {
  return (files || []).find((file) => extractSizeFromFileName(file.fileName) === size) || null;
}

function pickPrimarySkuSource(files) {
  return (files || [])
    .slice()
    .sort((a, b) => {
      const aScore = /sku/i.test(a.fileName) ? 10 : 0;
      const bScore = /sku/i.test(b.fileName) ? 10 : 0;
      return bScore - aScore || String(a.fileName).localeCompare(String(b.fileName));
    })[0] || null;
}

function uniqueColorNames(layerSets) {
  const blocked = /参考|背景|background|ref/i;
  const seen = new Set();
  const output = [];
  for (const item of Array.isArray(layerSets) ? layerSets : []) {
    const name = String(item?.name || '').trim();
    if (!name || blocked.test(name)) continue;
    const key = name.replace(/\s+/g, '').toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(name);
  }
  return output;
}

function buildConfiguredSkuExecutionPlan(projectScan, colorNames) {
  const usableColorNames = (Array.isArray(colorNames) ? colorNames : [])
    .map((name) => String(name || '').trim())
    .filter(Boolean);
  return sanitize(buildSkuConfiguredExecutionPlan({
    csvConfigs: toSharedCsvConfigInputs(projectScan?.files?.csvConfigs || []),
    comboTemplates: toSharedTemplateInputs(projectScan?.files?.comboTemplates || []),
    noteTemplates: toSharedTemplateInputs(projectScan?.files?.noteTemplates || []),
    availableColorNames: usableColorNames
  }));
}

function parseExportedFiles(result) {
  const exported = result?.data?.exportedFiles || [];
  const paths = [];
  for (const item of Array.isArray(exported) ? exported : []) {
    if (!item) continue;
    if (typeof item === 'string') {
      try {
        const parsed = JSON.parse(item);
        if (parsed?.path) paths.push(String(parsed.path));
      } catch {
        if (isAbsolutePath(item)) paths.push(item);
      }
    } else if (item?.path) {
      paths.push(String(item.path));
    }
  }
  return Array.from(new Set(paths.filter(Boolean)));
}

async function probeImageFiles(filePaths) {
  const service = new ResourceManagerService();
  const probes = [];
  for (const filePath of filePaths) {
    try {
      probes.push(await service.probeImageFile(filePath));
    } catch (error) {
      probes.push({
        success: false,
        path: filePath,
        status: 'decode_failed',
        rawImagesRedacted: true,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }
  return probes;
}

function buildTemplateCloseState({ before, afterNaturalClose, openedTemplateNames }) {
  const beforeIdentities = documentSet(before);
  const afterDocs = normalizeDocuments(afterNaturalClose);
  const leakedDocs = afterDocs.filter((doc) => {
    const name = String(doc?.name || '').trim();
    if (!openedTemplateNames.includes(name)) return false;
    return !beforeIdentities.has(documentIdentity(doc));
  });
  return sanitize({
    status: leakedDocs.length === 0 ? 'closed' : 'blocked_template_left_open',
    openedTemplateNames,
    leakedTemplateNames: leakedDocs.map((doc) => doc.name),
    blockers: leakedDocs.length === 0
      ? []
      : [`Template documents still open after skuLayout execution: ${leakedDocs.map((doc) => doc.name).join(', ')}`],
    boundaries: {
      doesNotClaimDesignQuality: true,
      verifiesNaturalCloseBeforeCleanup: true
    }
  });
}

function assertToolSuccess(stage, result) {
  if (result?.success !== true) {
    throw new Error(`${stage} failed: ${result?.error || result?.message || JSON.stringify(result)}`);
  }
}

async function openDesignDocument(filePath, stage) {
  const result = await callPhotoshopToolStable('openTemplate', { psdPath: filePath }, {
    requestTimeoutMs: MCP_EXECUTION_TIMEOUT_MS
  });
  assertToolSuccess(stage, result);
  const documentName = result?.data?.documentName || path.basename(filePath);
  const documents = await listDocumentsDetailed();
  const doc = findDocumentByName(documents, documentName) || findDocumentByPathOrName(documents, filePath);
  if (!doc) {
    throw new Error(`${stage} opened ${path.basename(filePath)} but listDocuments could not find the opened document.`);
  }
  return {
    result,
    documentName: doc.name,
    documentId: doc.id,
    width: Number(doc.width) || undefined,
    height: Number(doc.height) || undefined
  };
}

function expectedDimensionsFromDoc(doc) {
  const width = Number(doc?.width);
  const height = Number(doc?.height);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return undefined;
  return { width: Math.round(width), height: Math.round(height) };
}

async function closeDocumentIfOpenedBySmoke(before, doc, cleanupSteps) {
  if (!doc?.documentId) return;
  const beforeIdentities = documentSet(before);
  const current = await listDocumentsDetailed();
  const existingDoc = normalizeDocuments(current).find((item) => Number(item?.id) === Number(doc.documentId));
  if (!existingDoc) return;
  if (beforeIdentities.has(documentIdentity(existingDoc))) return;
  const closeResult = await callPhotoshopToolStable('closeDocument', {
    documentId: doc.documentId,
    save: false
  }, { requestTimeoutMs: MCP_EXECUTION_TIMEOUT_MS });
  cleanupSteps.push(sanitize({
    documentName: existingDoc.name,
    result: closeResult
  }));
}

async function runMinimalLiveExecution(projectScan, env = process.env) {
  const beforeDocuments = await listDocumentsDetailed();
  const cleanupSteps = [];
  const openedTemplateDocs = [];
  let openedSkuDoc = null;
  let naturalCloseDocuments = null;

  const requestedSize = parsePositiveInteger(env[MINIMAL_SIZE_ENV], 2);
  const comboTemplateFile = pickFileBySize(projectScan.files.comboTemplates, requestedSize)
    || projectScan.files.comboTemplates[0];
  const size = extractSizeFromFileName(comboTemplateFile?.fileName) || requestedSize;
  const noteTemplateFile = pickFileBySize(projectScan.files.noteTemplates, size);
  const skuSource = pickPrimarySkuSource(projectScan.files.skuSources);
  const includeNote = String(env[MINIMAL_NOTE_ENV] || '1') !== '0';
  const outputDir = disposableOutputDir();
  ensureDir(outputDir);

  const blockers = [];
  if (!skuSource?.absolutePath) blockers.push('No SKU source file is available for minimal live execution.');
  if (!comboTemplateFile?.absolutePath) blockers.push(`No ${size}双 combo template is available for minimal live execution.`);
  if (includeNote && !noteTemplateFile?.absolutePath) blockers.push(`No ${size}双 self-select note template is available for minimal live execution.`);
  if (blockers.length > 0) {
    return sanitize({
      executed: false,
      status: 'blocked_project_matrix_incomplete',
      size,
      blockers,
      boundaries: buildMinimalExecutionOptIn(env).boundaries
    });
  }

  try {
    openedSkuDoc = await openDesignDocument(skuSource.absolutePath, 'open SKU source');
    await callPhotoshopToolStable('switchDocument', { documentName: openedSkuDoc.documentName }, {
      requestTimeoutMs: MCP_REQUEST_TIMEOUT_MS
    });
    const layerSetsResult = await callPhotoshopToolStable('skuLayout', { action: 'listLayerSets' }, {
      requestTimeoutMs: MCP_EXECUTION_TIMEOUT_MS
    });
    assertToolSuccess('list SKU color layer sets', layerSetsResult);
    const colorNames = uniqueColorNames(layerSetsResult?.data?.layerSets);
    if (colorNames.length < size) {
      throw new Error(`SKU source has only ${colorNames.length} usable color groups; ${size} are required for ${size}双 minimal combo.`);
    }
    const comboColors = colorNames.slice(0, size);

    const comboTemplateDoc = await openDesignDocument(comboTemplateFile.absolutePath, `open ${size}双 combo template`);
    openedTemplateDocs.push(comboTemplateDoc);
    const comboResult = await callPhotoshopToolStable('skuLayout', {
      action: 'execute',
      combos: [comboColors],
      skuDocName: openedSkuDoc.documentName,
      templateDocName: comboTemplateDoc.documentName,
      outputFormat: 'jpg',
      quality: 12,
      outputDir
    }, { requestTimeoutMs: MCP_EXECUTION_TIMEOUT_MS });
    assertToolSuccess(`${size}双 combo skuLayout`, comboResult);
    const comboExportPaths = parseExportedFiles(comboResult);
    const comboReadback = buildSkuExportReadback({
      expectedExports: comboExportPaths.map((filePath) => ({
        path: filePath,
        expectedDimensions: expectedDimensionsFromDoc(comboTemplateDoc)
      })),
      fileProbes: await probeImageFiles(comboExportPaths)
    });

    let noteResult = null;
    let noteReadback = null;
    let noteTemplateDoc = null;
    if (includeNote) {
      noteTemplateDoc = await openDesignDocument(noteTemplateFile.absolutePath, `open ${size}双 self-select note template`);
      openedTemplateDocs.push(noteTemplateDoc);
      noteResult = await callPhotoshopToolStable('skuLayout', {
        action: 'arrangeDynamic',
        combos: [colorNames],
        skuDocName: openedSkuDoc.documentName,
        templateDocName: noteTemplateDoc.documentName,
        outputFormat: 'jpg',
        quality: 12,
        outputDir,
        noteFilePrefix: `${size}双自选备注-minimal-live`
      }, { requestTimeoutMs: MCP_EXECUTION_TIMEOUT_MS });
      assertToolSuccess(`${size}双 self-select note skuLayout`, noteResult);
      const noteExportPaths = parseExportedFiles(noteResult);
      noteReadback = buildSkuExportReadback({
        expectedExports: noteExportPaths.map((filePath) => ({
          path: filePath,
          expectedDimensions: expectedDimensionsFromDoc(noteTemplateDoc)
        })),
        fileProbes: await probeImageFiles(noteExportPaths)
      });
    }

    naturalCloseDocuments = await listDocumentsDetailed();
    const templateCloseState = buildTemplateCloseState({
      before: beforeDocuments,
      afterNaturalClose: naturalCloseDocuments,
      openedTemplateNames: openedTemplateDocs.map((doc) => doc.documentName)
    });

    const executionBlockers = [
      ...(comboReadback.blockers || []),
      ...(noteReadback?.blockers || []),
      ...(templateCloseState.blockers || [])
    ];
    const status = executionBlockers.length === 0
      ? 'ready_for_manual_review'
      : 'blocked_readback_or_close_state';

    return sanitize({
      executed: true,
      status,
      size,
      outputDir,
      source: {
        skuFile: skuSource.fileName,
        comboTemplateFile: comboTemplateFile.fileName,
        noteTemplateFile: noteTemplateFile?.fileName || null
      },
      selectedColors: comboColors,
      colorCount: colorNames.length,
      comboToolResult: comboResult,
      comboExportReadback: comboReadback,
      noteToolResult: noteResult,
      noteExportReadback: noteReadback,
      templateCloseState,
      finalAcceptanceSnapshot: await callPhotoshopToolStable('getAcceptanceSnapshot', {}, {
        requestTimeoutMs: MCP_REQUEST_TIMEOUT_MS
      }).catch((error) => ({
        success: false,
        error: error instanceof Error ? error.message : String(error)
      })),
      blockers: executionBlockers,
      boundaries: buildMinimalExecutionOptIn(env).boundaries
    });
  } finally {
    const afterNaturalClose = naturalCloseDocuments || await listDocumentsDetailed().catch(() => null);
    if (afterNaturalClose) {
      for (const templateDoc of openedTemplateDocs) {
        await closeDocumentIfOpenedBySmoke(beforeDocuments, templateDoc, cleanupSteps).catch((error) => {
          cleanupSteps.push({
            documentName: templateDoc.documentName,
            error: error instanceof Error ? error.message : String(error)
          });
        });
      }
    }
    if (openedSkuDoc) {
      await closeDocumentIfOpenedBySmoke(beforeDocuments, openedSkuDoc, cleanupSteps).catch((error) => {
        cleanupSteps.push({
          documentName: openedSkuDoc.documentName,
          error: error instanceof Error ? error.message : String(error)
        });
      });
    }
  }
}

async function runConfiguredLiveExecution(projectScan, env = process.env) {
  const beforeDocuments = await listDocumentsDetailed();
  const cleanupSteps = [];
  const openedTemplateDocs = [];
  let openedSkuDoc = null;
  let naturalCloseDocuments = null;
  const outputDir = disposableOutputDir();
  ensureDir(outputDir);

  const skuSource = pickPrimarySkuSource(projectScan.files.skuSources);
  if (!skuSource?.absolutePath) {
    return sanitize({
      executed: false,
      status: 'blocked_project_matrix_incomplete',
      blockers: ['No SKU source file is available for configured live execution.'],
      boundaries: buildConfiguredExecutionOptIn(env).boundaries
    });
  }

  try {
    openedSkuDoc = await openDesignDocument(skuSource.absolutePath, 'open SKU source');
    await callPhotoshopToolStable('switchDocument', { documentName: openedSkuDoc.documentName }, {
      requestTimeoutMs: MCP_REQUEST_TIMEOUT_MS
    });
    const layerSetsResult = await callPhotoshopToolStable('skuLayout', { action: 'listLayerSets' }, {
      requestTimeoutMs: MCP_EXECUTION_TIMEOUT_MS
    });
    assertToolSuccess('list SKU color layer sets', layerSetsResult);
    const colorNames = uniqueColorNames(layerSetsResult?.data?.layerSets);
    const executionPlan = buildConfiguredSkuExecutionPlan(projectScan, colorNames);
    if (executionPlan.status !== 'ready_configured_execution_plan') {
      return sanitize({
        executed: false,
        status: 'blocked_configured_execution_plan',
        outputDir,
        executionPlan,
        blockers: executionPlan.blockers,
        boundaries: buildConfiguredExecutionOptIn(env).boundaries
      });
    }

    const comboToolResultsBySize = {};
    const comboExportReadbackBySize = {};
    const noteToolResultsBySize = {};
    const noteExportReadbackBySize = {};

    for (const sizePlan of executionPlan.sizes) {
      const comboTemplateFile = findTemplateForConfigRow(
        sizePlan.comboRows[0]?.templateFileName,
        projectScan.files.comboTemplates
      );
      if (comboTemplateFile?.absolutePath && sizePlan.comboRows.length > 0) {
        const comboBatches = buildSkuLayoutExecutionBatches({
          action: 'execute',
          size: sizePlan.size,
          rows: sizePlan.comboRows,
          maxRowsPerToolCall: 1
        });
        const comboBatchResults = [];
        const comboExportPaths = [];
        const comboExpectedExports = [];
        for (const batch of comboBatches) {
          const comboTemplateDoc = await openDesignDocument(
            comboTemplateFile.absolutePath,
            `open ${sizePlan.size}双 configured combo template batch ${batch.batchIndex}/${batch.batchCount}`
          );
          openedTemplateDocs.push(comboTemplateDoc);
          const comboResult = await callPhotoshopToolStable('skuLayout', {
            action: 'execute',
            combos: batch.combos,
            skuDocName: openedSkuDoc.documentName,
            templateDocName: comboTemplateDoc.documentName,
            outputFormat: 'jpg',
            quality: 12,
            outputDir
          }, { requestTimeoutMs: MCP_EXECUTION_TIMEOUT_MS });
          assertToolSuccess(`${sizePlan.size}双 configured combo skuLayout batch ${batch.batchIndex}/${batch.batchCount}`, comboResult);
          comboBatchResults.push({
            batchIndex: batch.batchIndex,
            batchCount: batch.batchCount,
            rowStartIndex: batch.rowStartIndex,
            rowEndIndex: batch.rowEndIndex,
            combos: batch.combos,
            result: comboResult
          });
          const batchExportPaths = parseExportedFiles(comboResult);
          comboExportPaths.push(...batchExportPaths);
          comboExpectedExports.push(...batchExportPaths.map((filePath) => ({
            path: filePath,
            expectedDimensions: expectedDimensionsFromDoc(comboTemplateDoc)
          })));
        }
        comboToolResultsBySize[sizePlan.size] = {
          schema: 'sku-layout-configured-combo-batch-results/v0',
          batchCount: comboBatches.length,
          totalRows: sizePlan.comboRows.length,
          results: comboBatchResults
        };
        comboExportReadbackBySize[sizePlan.size] = buildSkuExportReadback({
          expectedExports: comboExpectedExports,
          fileProbes: await probeImageFiles(comboExportPaths)
        });
      }

      const noteTemplateFile = findTemplateForConfigRow(
        sizePlan.noteRows[0]?.templateFileName,
        projectScan.files.noteTemplates
      );
      if (noteTemplateFile?.absolutePath && sizePlan.noteRows.length > 0) {
        const noteBatches = buildSkuLayoutExecutionBatches({
          action: 'arrangeDynamic',
          size: sizePlan.size,
          rows: sizePlan.noteRows,
          maxRowsPerToolCall: 1
        });
        const noteBatchResults = [];
        const noteExportPaths = [];
        const noteExpectedExports = [];
        for (const batch of noteBatches) {
          const noteTemplateDoc = await openDesignDocument(
            noteTemplateFile.absolutePath,
            `open ${sizePlan.size}双 configured self-select note template batch ${batch.batchIndex}/${batch.batchCount}`
          );
          openedTemplateDocs.push(noteTemplateDoc);
          const noteResult = await callPhotoshopToolStable('skuLayout', {
            action: 'arrangeDynamic',
            combos: batch.combos,
            skuDocName: openedSkuDoc.documentName,
            templateDocName: noteTemplateDoc.documentName,
            outputFormat: 'jpg',
            quality: 12,
            outputDir,
            noteFilePrefix: noteBatches.length > 1
              ? `${sizePlan.size}双自选备注-configured-live-${batch.batchIndex}`
              : `${sizePlan.size}双自选备注-configured-live`
          }, { requestTimeoutMs: MCP_EXECUTION_TIMEOUT_MS });
          assertToolSuccess(`${sizePlan.size}双 configured self-select note skuLayout batch ${batch.batchIndex}/${batch.batchCount}`, noteResult);
          noteBatchResults.push({
            batchIndex: batch.batchIndex,
            batchCount: batch.batchCount,
            rowStartIndex: batch.rowStartIndex,
            rowEndIndex: batch.rowEndIndex,
            combos: batch.combos,
            result: noteResult
          });
          const batchExportPaths = parseExportedFiles(noteResult);
          noteExportPaths.push(...batchExportPaths);
          noteExpectedExports.push(...batchExportPaths.map((filePath) => ({
            path: filePath,
            expectedDimensions: expectedDimensionsFromDoc(noteTemplateDoc)
          })));
        }
        noteToolResultsBySize[sizePlan.size] = {
          schema: 'sku-layout-configured-note-batch-results/v0',
          batchCount: noteBatches.length,
          totalRows: sizePlan.noteRows.length,
          results: noteBatchResults
        };
        noteExportReadbackBySize[sizePlan.size] = buildSkuExportReadback({
          expectedExports: noteExpectedExports,
          fileProbes: await probeImageFiles(noteExportPaths)
        });
      }
    }

    naturalCloseDocuments = await listDocumentsDetailed();
    const templateCloseState = buildTemplateCloseState({
      before: beforeDocuments,
      afterNaturalClose: naturalCloseDocuments,
      openedTemplateNames: openedTemplateDocs.map((doc) => doc.documentName)
    });

    const executionBlockers = [
      ...Object.values(comboExportReadbackBySize).flatMap((readback) => readback?.blockers || []),
      ...Object.values(noteExportReadbackBySize).flatMap((readback) => readback?.blockers || []),
      ...(templateCloseState.blockers || [])
    ];
    const status = executionBlockers.length === 0
      ? 'ready_for_manual_review'
      : 'blocked_readback_or_close_state';

    return sanitize({
      executed: true,
      status,
      outputDir,
      source: {
        skuFile: skuSource.fileName,
        configFile: projectScan.skuConfigPlan?.configFileName || null
      },
      executionPlan,
      comboToolResultsBySize,
      comboExportReadbackBySize,
      noteToolResultsBySize,
      noteExportReadbackBySize,
      templateCloseState,
      finalAcceptanceSnapshot: await callPhotoshopToolStable('getAcceptanceSnapshot', {}, {
        requestTimeoutMs: MCP_REQUEST_TIMEOUT_MS
      }).catch((error) => ({
        success: false,
        error: error instanceof Error ? error.message : String(error)
      })),
      blockers: executionBlockers,
      boundaries: buildConfiguredExecutionOptIn(env).boundaries
    });
  } finally {
    const afterNaturalClose = naturalCloseDocuments || await listDocumentsDetailed().catch(() => null);
    if (afterNaturalClose) {
      for (const templateDoc of openedTemplateDocs) {
        await closeDocumentIfOpenedBySmoke(beforeDocuments, templateDoc, cleanupSteps).catch((error) => {
          cleanupSteps.push({
            documentName: templateDoc.documentName,
            error: error instanceof Error ? error.message : String(error)
          });
        });
      }
    }
    if (openedSkuDoc) {
      await closeDocumentIfOpenedBySmoke(beforeDocuments, openedSkuDoc, cleanupSteps).catch((error) => {
        cleanupSteps.push({
          documentName: openedSkuDoc.documentName,
          error: error instanceof Error ? error.message : String(error)
        });
      });
    }
  }
}

function disposableOutputDir() {
  return path.join(TMP_DIR, 'disposable-output', `run-${Date.now()}`);
}

function buildReport({
  mode,
  optIn,
  executionOptIn = null,
  projectScan,
  bridgeReadiness = null,
  minimalExecution = null,
  configuredExecution = null,
  skipped = false,
  error = null
}) {
  const missingOptIns = new Set(optIn.missing);
  const executionOnlyMissing = executionOptIn
    ? executionOptIn.missing.filter((name) => !missingOptIns.has(name))
    : [];
  const blockers = [
    ...optIn.missing.map((name) => `Missing opt-in: ${name}`),
    ...executionOnlyMissing.map((name) => `Missing execution opt-in: ${name}`),
    ...projectScan.blockers,
    ...(bridgeReadiness?.blockers || []),
    ...(minimalExecution?.blockers || []),
    ...(configuredExecution?.blockers || []),
    ...(error ? [String(error.message || error)] : [])
  ];
  const executedPhotoshop = minimalExecution?.executed === true || configuredExecution?.executed === true;
  return sanitize({
    success: blockers.length === 0,
    skipped,
    mode,
    generatedAt: new Date().toISOString(),
    endpoint: MCP_ENDPOINT,
    mcpRequestTimeoutMs: MCP_REQUEST_TIMEOUT_MS,
    project: {
      path: projectScan.projectPath,
      status: projectScan.status,
      files: projectScan.files,
      skuConfigPlan: projectScan.skuConfigPlan,
      skuOutputEvidence: projectScan.skuOutputEvidence,
      skuColorSourceImageEvidence: projectScan.skuColorSourceImageEvidence
    },
    optIn,
    executionOptIn,
    bridgeReadiness,
    minimalExecution,
    configuredExecution,
    disposableOutput: {
      directory: disposableOutputDir(),
      projectOutputWritesAllowed: false
    },
    blockers,
    boundaries: {
      readOnlyUntilExecutionOptIn: true,
      writesPhotoshop: executedPhotoshop,
      writesProjectDocuments: false,
      writesProjectOutputDir: false,
      usesDisposableOutputDir: executedPhotoshop,
      claimsSkuCompletion: false,
      claimsDesignQuality: false
    }
  });
}

function renderMarkdown(report) {
  const lines = [
    '# SKU C-1163 Live Acceptance Readiness',
    '',
    `- success: ${report.success}`,
    `- skipped: ${Boolean(report.skipped)}`,
    `- mode: ${report.mode}`,
    `- projectStatus: ${report.project.status}`,
    `- bridgeReady: ${report.bridgeReadiness ? report.bridgeReadiness.ready : 'not-run'}`,
    `- writesPhotoshop: ${report.boundaries.writesPhotoshop}`,
    `- writesProjectDocuments: ${report.boundaries.writesProjectDocuments}`,
    `- writesProjectOutputDir: ${report.boundaries.writesProjectOutputDir}`,
    `- claimsSkuCompletion: ${report.boundaries.claimsSkuCompletion}`,
    `- claimsDesignQuality: ${report.boundaries.claimsDesignQuality}`,
    '',
    '## Blockers',
    ''
  ];
  if (report.blockers.length === 0) {
    lines.push('- none');
  } else {
    for (const blocker of report.blockers) lines.push(`- ${blocker}`);
  }
  lines.push('', '## Project Matrix', '', '```json', JSON.stringify(report.project.files, null, 2), '```', '');
  if (report.project.skuOutputEvidence) {
    lines.push('', '## Existing SKU Output Evidence', '', '```json', JSON.stringify(report.project.skuOutputEvidence, null, 2), '```', '');
  }
  if (report.project.skuColorSourceImageEvidence) {
    lines.push('', '## Candidate SKU Color Source Image Evidence', '', '```json', JSON.stringify(report.project.skuColorSourceImageEvidence, null, 2), '```', '');
  }
  lines.push('', '## SKU Config Plan', '', '```json', JSON.stringify(report.project.skuConfigPlan, null, 2), '```', '');
  if (report.bridgeReadiness) {
    lines.push('## Bridge Readiness', '', '```json', JSON.stringify(report.bridgeReadiness, null, 2), '```', '');
  }
  if (report.minimalExecution) {
    lines.push('## Minimal Live Execution', '', '```json', JSON.stringify(report.minimalExecution, null, 2), '```', '');
  }
  if (report.configuredExecution) {
    lines.push('## Configured Live Execution', '', '```json', JSON.stringify(report.configuredExecution, null, 2), '```', '');
  }
  return `${lines.join('\n')}\n`;
}

function writeReport(report) {
  ensureDir(TMP_DIR);
  const paths = reportPathsForMode(report?.mode);
  const json = JSON.stringify(report, null, 2);
  const markdown = renderMarkdown(report);
  fs.writeFileSync(paths.latestJson, json, 'utf8');
  fs.writeFileSync(paths.latestMarkdown, markdown, 'utf8');
  fs.writeFileSync(paths.modeJson, json, 'utf8');
  fs.writeFileSync(paths.modeMarkdown, markdown, 'utf8');
  return paths;
}

function createFixtureProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'designecho-sku-c1163-fixture-'));
  const dirs = [
    'PSD',
    '模板文件',
    '配置文件',
    path.join('S82646', '新建文件夹'),
    path.join('SKU', '2双装'),
    path.join('SKU', '2双自选备注')
  ];
  for (const dir of dirs) ensureDir(path.join(root, dir));
  fs.writeFileSync(path.join(root, 'PSD', 'SKU.psb'), 'fixture psb', 'utf8');
  for (const size of [2, 3, 4]) {
    fs.writeFileSync(path.join(root, '模板文件', `${size}双装.tif`), 'fixture template', 'utf8');
    fs.writeFileSync(path.join(root, '模板文件', `${size}双自选备注.tif`), 'fixture note', 'utf8');
  }
  fs.writeFileSync(
    path.join(root, '配置文件', '6色 2-3-4.csv'),
    Buffer.from(
      'xKOw5SzF5MmrDQoyy6vXsC50aWYsMSsxDQoyy6vXsC50aWYsMisyDQoyy6vXsC50aWYsMyszDQoyy6vXsC50aWYsMis0DQoyy6vXsC50aWYsMys1DQoyy6vXsC50aWYsNisxDQozy6vXsC50aWYsMSsxKzENCjPLq9ewLnRpZiwyKzIrMg0KM8ur17AudGlmLDMrMyszDQozy6vXsC50aWYsMSsyKzMNCjPLq9ewLnRpZiw0KzUrNg0KNMur17AudGlmLDErMSsxKzENCjTLq9ewLnRpZiwxKzErMisyDQo0y6vXsC50aWYsMisyKzMrMw0KNMur17AudGlmLDErMiszKzYNCjTLq9ewLnRpZiwxKzQrNSs2DQoyy6vX1NGhsbjXoi50aWYsMSsyKzMrNCs1KzYNCjPLq9fU0aGxuNeiLnRpZiwxKzIrMys0KzUrNg0KNMur19TRobG416IudGlmLDErMiszKzQrNSs2DQo=',
      'base64'
    )
  );
  fs.writeFileSync(path.join(root, 'SKU', '2双装', '1白色+白色.jpg'), 'fixture output', 'utf8');
  fs.writeFileSync(path.join(root, 'SKU', '2双装', '2浅肤+浅肤.jpg'), 'fixture output', 'utf8');
  fs.writeFileSync(path.join(root, 'SKU', '2双装', '3深肤+深肤.jpg'), 'fixture output', 'utf8');
  fs.writeFileSync(path.join(root, 'SKU', '2双装', '4浅肤+浅蓝.jpg'), 'fixture output', 'utf8');
  fs.writeFileSync(path.join(root, 'SKU', '2双装', '5深肤+浅紫.jpg'), 'fixture output', 'utf8');
  fs.writeFileSync(path.join(root, 'SKU', '2双装', '6黑色+白色.jpg'), 'fixture output', 'utf8');
  fs.writeFileSync(path.join(root, 'SKU', '2双自选备注', '1白色+浅肤+深肤+浅蓝+浅紫+黑色.jpg'), 'fixture output', 'utf8');
  for (const colorName of ['白色', '黑色', '浅肤', '浅蓝', '浅紫', '身肤']) {
    fs.writeFileSync(path.join(root, 'S82646', '新建文件夹', `${colorName}.jpg`), 'fixture source image', 'utf8');
  }
  fs.writeFileSync(path.join(root, 'S82646', 'YYC_8808.jpg'), 'fixture raw photo', 'utf8');
  fs.writeFileSync(path.join(root, 'S82646', 'ZZY_9867.jpg'), 'fixture raw photo', 'utf8');
  return root;
}

function runSelfTest() {
  const blocked = buildOptIn({});
  assert(blocked.ok === false, 'missing readonly live opt-in must block readiness.');
  assert(blocked.missing.includes(LIVE_FLAG), 'missing live flag must be reported.');
  assert(blocked.boundaries.writesProjectOutputDir === false, 'project output writes must stay blocked.');
  assert(blocked.boundaries.usesDisposableOutputDir === false, 'readonly readiness must not require or claim a disposable output dir.');
  const fixtureProject = createFixtureProject();
  const scan = scanProject(fixtureProject);
  assert(scan.status === 'ready_project_files', `fixture project should be ready, got ${scan.status}`);
  assert(scan.files.skuSources.length === 1, 'fixture should expose one SKU source.');
  assert(scan.files.comboTemplates.length === 3, 'fixture should expose three combo templates.');
  assert(scan.files.noteTemplates.length === 3, 'fixture should expose three note templates.');
  assert(scan.files.csvConfigs.length === 1, 'fixture should expose one CSV config.');
  assert(scan.files.skuOutputImages.length === 7, 'fixture should expose existing SKU output images as read-only evidence.');
  assert(scan.files.skuColorSourceImages.length === 6, 'fixture should expose candidate SKU color source images as read-only evidence.');
  assert.deepStrictEqual(
    scan.skuOutputEvidence.colorNames,
    ['白色', '浅肤', '深肤', '浅蓝', '浅紫', '黑色'],
    'fixture should extract color names from existing SKU output filenames without reading pixels.'
  );
  assert(scan.skuOutputEvidence.boundaries.readOnly === true, 'existing SKU output evidence must stay read-only.');
  assert(scan.skuColorSourceImageEvidence.boundaries.readOnly === true, 'candidate SKU color source image evidence must stay read-only.');
  assert.deepStrictEqual(
    scan.skuColorSourceImageEvidence.colorNames,
    ['白色', '黑色', '浅肤', '浅蓝', '浅紫', '身肤'],
    'fixture should extract candidate color names from source image filenames without treating them as Photoshop layer groups.'
  );
  assert.deepStrictEqual(
    scan.skuColorSourceImageEvidence.coverage.missingExpectedColorNames,
    ['深肤'],
    'source image evidence should preserve the 深肤 vs 身肤 naming mismatch instead of silently aliasing it.'
  );
  assert.deepStrictEqual(
    scan.skuColorSourceImageEvidence.coverage.extraCandidateColorNames,
    ['身肤'],
    'source image evidence should report unmatched candidate names without pretending they satisfy the CSV.'
  );
  assert(scan.skuConfigPlan.schema === 'sku-configured-execution-plan/v0', 'fixture should use the shared configured SKU plan schema.');
  assert(scan.skuConfigPlan.status === 'ready_configured_execution_plan', `fixture should parse full SKU config plan, got ${scan.skuConfigPlan?.status}`);
  assert.deepStrictEqual(scan.skuConfigPlan.sizes.map((item) => item.size), [2, 3, 4], 'fixture should parse 2/3/4 SKU sizes from CSV templates.');
  assert(scan.skuConfigPlan.colorSlotCount === 6, 'fixture should parse six color slots from CSV combinations.');
  assert(scan.skuConfigPlan.availableColorCount === 0, 'project matrix scan must not pretend the SKU source color layers are already open.');
  assert(scan.skuConfigPlan.sizes[0].comboRows.length === 6, 'fixture should parse six 2双 combo rows.');
  assert(scan.skuConfigPlan.sizes[1].comboRows.length === 5, 'fixture should parse five 3双 combo rows.');
  assert(scan.skuConfigPlan.sizes[2].comboRows.length === 5, 'fixture should parse five 4双 combo rows.');
  assert(scan.skuConfigPlan.sizes[0].noteRows.length === 1, 'fixture should parse one 2双 self-select note row.');
  assert(scan.skuConfigPlan.sizes[1].noteRows.length === 1, 'fixture should parse one 3双 self-select note row.');
  assert(scan.skuConfigPlan.sizes[2].noteRows.length === 1, 'fixture should parse one 4双 self-select note row.');
  assert(scan.skuConfigPlan.blockers.length === 0, 'fixture plan should match all combo and note templates.');

  const ready = buildOptIn({
    [LIVE_FLAG]: '1',
    [PROJECT_PATH_ENV]: fixtureProject
  });
  assert(ready.ok === true, 'readonly live readiness flag and project path should pass opt-in without write takeover flags.');
  assert(ready.boundaries.writesPhotoshop === false, 'readonly live readiness must not write Photoshop.');

  const executionBlocked = buildMinimalExecutionOptIn({
    [LIVE_FLAG]: '1',
    [PROJECT_PATH_ENV]: fixtureProject
  });
  assert(executionBlocked.ok === false, 'minimal live execution must require write takeover and an extra execute flag.');
  assert(executionBlocked.missing.includes(TAKEOVER_FLAG), 'minimal live execution must require takeover opt-in.');
  assert(executionBlocked.missing.includes(DISPOSABLE_OUTPUT_FLAG), 'minimal live execution must require disposable output opt-in.');
  assert(
    executionBlocked.missing.includes(EXECUTE_MINIMAL_FLAG),
    'missing minimal live execute flag must be reported separately from readiness flags.'
  );
  const configuredExecutionBlocked = buildConfiguredExecutionOptIn({
    [LIVE_FLAG]: '1',
    [PROJECT_PATH_ENV]: fixtureProject
  });
  assert(configuredExecutionBlocked.ok === false, 'configured live execution must require write takeover and an extra execute flag.');
  assert(configuredExecutionBlocked.missing.includes(TAKEOVER_FLAG), 'configured live execution must require takeover opt-in.');
  assert(configuredExecutionBlocked.missing.includes(DISPOSABLE_OUTPUT_FLAG), 'configured live execution must require disposable output opt-in.');
  assert(
    configuredExecutionBlocked.missing.includes(EXECUTE_CONFIGURED_FLAG),
    'missing configured live execute flag must be reported separately from readiness flags.'
  );
  const configuredPlan = buildConfiguredSkuExecutionPlan(scan, ['白色', '浅肤', '浅灰', '深灰', '奶白', '黑色']);
  assert(configuredPlan.status === 'ready_configured_execution_plan', `configured execution plan should be ready, got ${configuredPlan.status}`);
  assert(configuredPlan.comboExecutionCount === 16, 'configured execution plan should include all 16 combo rows.');
  assert(configuredPlan.noteExecutionCount === 3, 'configured execution plan should include all three self-select note rows.');
  assert.deepStrictEqual(
    configuredPlan.sizes.map((item) => item.size),
    [2, 3, 4],
    'configured execution plan should preserve 2/3/4 execution order.'
  );
  assert.deepStrictEqual(
    configuredPlan.sizes[0].comboRows[0].colorNames,
    ['白色', '白色'],
    'configured execution plan should map color slot 1+1 to color names.'
  );
  assert.deepStrictEqual(
    configuredPlan.sizes[2].comboRows[4].colorNames,
    ['白色', '深灰', '奶白', '黑色'],
    'configured execution plan should map the final 4双 row to color names.'
  );
  const configuredComboBatches = configuredPlan.sizes.flatMap((sizePlan) =>
    buildSkuLayoutExecutionBatches({
      action: 'execute',
      size: sizePlan.size,
      rows: sizePlan.comboRows,
      maxRowsPerToolCall: 1
    })
  );
  const configuredNoteBatches = configuredPlan.sizes.flatMap((sizePlan) =>
    buildSkuLayoutExecutionBatches({
      action: 'arrangeDynamic',
      size: sizePlan.size,
      rows: sizePlan.noteRows,
      maxRowsPerToolCall: 1
    })
  );
  assert.strictEqual(configuredComboBatches.length, configuredPlan.comboExecutionCount, 'configured live combo execution must be one MCP call per combo row.');
  assert.strictEqual(configuredNoteBatches.length, configuredPlan.noteExecutionCount, 'configured live note execution must be one MCP call per note row.');
  assert(
    configuredComboBatches.every((batch) => batch.combos.length === 1),
    'configured live execution must not submit a whole size worth of combo rows in one skuLayout call.'
  );

  const report = buildReport({
    mode: 'self-test',
    optIn: ready,
    projectScan: scan,
    bridgeReadiness: {
      ready: true,
      blockers: [],
      requiredTools: REQUIRED_TOOLS,
      missingTools: [],
      readonlyResponsiveness: {
        listDocuments: {
          status: 'responded',
          ok: true,
          elapsedMs: 12,
          documentCount: 1
        }
      }
    }
  });
  const serialized = JSON.stringify(report);
  assert(!serialized.includes(fixtureProject.replace(/\\/g, '/')), 'report must redact absolute fixture paths.');
  assert(!serialized.includes('data:image/'), 'report must not expose raw images.');
  assert(report.project.skuConfigPlan.status === 'ready_configured_execution_plan', 'report must include the configured SKU plan.');
  assert(typeof buildReadonlyResponsivenessProbe === 'function', 'readiness must have a real readonly responsiveness probe builder.');
  assert(report.bridgeReadiness.readonlyResponsiveness.listDocuments.ok === true, 'readiness must prove listDocuments actually responds, not only that the tool exists.');
  const timedOutProbe = buildReadonlyResponsivenessProbe('listDocuments', {
    elapsedMs: 20_000,
    error: new Error('listDocuments timed out after 20000ms')
  });
  assert(timedOutProbe.ok === false, 'listDocuments timeout must not be treated as readiness.');
  assert(
    buildReadonlyResponsivenessBlockers({ listDocuments: timedOutProbe })[0].includes('listDocuments did not respond'),
    'listDocuments timeout must become a readiness blocker.'
  );
  assert(report.boundaries.claimsSkuCompletion === false, 'readiness must not claim SKU completion.');

  const executionReport = buildReport({
    mode: 'self-test-minimal-execution',
    optIn: ready,
    projectScan: scan,
    bridgeReadiness: {
      ready: true,
      blockers: [],
      requiredTools: REQUIRED_TOOLS,
      missingTools: []
    },
    minimalExecution: {
      executed: true,
      status: 'ready_for_manual_review',
      size: 2,
      comboToolResult: {
        success: true,
        data: {
          exportedFiles: [
            JSON.stringify({
              path: 'C:\\DesignEcho\\private\\2双装\\1白色+浅肤.jpg',
              targetName: '1白色+浅肤.jpg',
              status: 'exported_jsx'
            })
          ]
        }
      },
      comboExportReadback: { status: 'ready_for_review' },
      noteExportReadback: { status: 'ready_for_review' },
      templateCloseState: { status: 'closed' },
      boundaries: {
        writesPhotoshop: true,
        writesProjectDocuments: false,
        writesProjectOutputDir: false,
        usesDisposableOutputDir: true,
        claimsSkuCompletion: false,
        claimsDesignQuality: false
      }
    }
  });
  assert(executionReport.minimalExecution.status === 'ready_for_manual_review', 'minimal execution report should be preserved.');
  assert(!JSON.stringify(executionReport).includes('C:\\'), 'embedded JSON strings in tool results must redact absolute paths.');
  assert(executionReport.boundaries.claimsSkuCompletion === false, 'minimal live execution must not claim full SKU completion.');
  assert(executionReport.boundaries.claimsDesignQuality === false, 'minimal live execution must not claim design quality.');

  const configuredExecutionReport = buildReport({
    mode: 'self-test-configured-execution',
    optIn: ready,
    executionOptIn: {
      ok: true,
      missing: [],
      boundaries: buildConfiguredExecutionOptIn({
        [LIVE_FLAG]: '1',
        [TAKEOVER_FLAG]: '1',
        [DISPOSABLE_OUTPUT_FLAG]: '1',
        [EXECUTE_CONFIGURED_FLAG]: '1',
        [PROJECT_PATH_ENV]: fixtureProject
      }).boundaries
    },
    projectScan: scan,
    bridgeReadiness: {
      ready: true,
      blockers: [],
      requiredTools: REQUIRED_TOOLS,
      missingTools: []
    },
    configuredExecution: {
      executed: true,
      status: 'ready_for_manual_review',
      executionPlan: configuredPlan,
      comboExportReadbackBySize: {
        2: { status: 'ready_for_review', files: [{ path: 'C:\\DesignEcho\\private\\2双装\\1白色+白色.jpg' }] }
      },
      blockers: [],
      boundaries: {
        writesPhotoshop: true,
        writesProjectDocuments: false,
        writesProjectOutputDir: false,
        usesDisposableOutputDir: true,
        claimsSkuCompletion: false,
        claimsDesignQuality: false
      }
    }
  });
  assert(configuredExecutionReport.configuredExecution.status === 'ready_for_manual_review', 'configured execution report should be preserved.');
  assert(configuredExecutionReport.boundaries.writesPhotoshop === true, 'configured execution report should mark Photoshop writes.');
  assert(!JSON.stringify(configuredExecutionReport).includes('C:\\'), 'configured execution report must redact embedded absolute paths.');
  assert(configuredExecutionReport.boundaries.claimsSkuCompletion === false, 'configured live execution must not claim full SKU completion.');
  assert(configuredExecutionReport.boundaries.claimsDesignQuality === false, 'configured live execution must not claim design quality.');

  const configuredReportPaths = reportPathsForMode('live-configured-execution');
  const minimalReportPaths = reportPathsForMode('live-minimal-execution');
  assert(configuredReportPaths.latestJson === REPORT_JSON, 'mode report paths should keep report.json as the latest-run alias.');
  assert(configuredReportPaths.latestMarkdown === REPORT_MD, 'mode report paths should keep report.md as the latest-run alias.');
  assert(configuredReportPaths.modeJson.endsWith('report-live-configured-execution.json'), 'configured live must get a stable mode-specific JSON report.');
  assert(configuredReportPaths.modeMarkdown.endsWith('report-live-configured-execution.md'), 'configured live must get a stable mode-specific Markdown report.');
  assert(minimalReportPaths.modeJson.endsWith('report-live-minimal-execution.json'), 'minimal live must get a separate mode-specific JSON report.');
  assert(configuredReportPaths.modeJson !== minimalReportPaths.modeJson, 'configured and minimal live reports must not overwrite each other.');
  const configuredWritePaths = reportPathsForMode(configuredExecutionReport.mode);
  const minimalWritePaths = reportPathsForMode(executionReport.mode);
  for (const reportPath of [
    configuredWritePaths.modeJson,
    configuredWritePaths.modeMarkdown,
    minimalWritePaths.modeJson,
    minimalWritePaths.modeMarkdown
  ]) {
    fs.rmSync(reportPath, { force: true });
  }
  writeReport(configuredExecutionReport);
  writeReport(executionReport);
  assert(fs.existsSync(configuredWritePaths.modeJson), 'writing a later minimal report must not remove the configured JSON report.');
  assert(fs.existsSync(configuredWritePaths.modeMarkdown), 'writing a later minimal report must not remove the configured Markdown report.');
  assert(fs.existsSync(minimalWritePaths.modeJson), 'minimal JSON report should be written under its own mode-specific path.');
  assert(fs.existsSync(minimalWritePaths.modeMarkdown), 'minimal Markdown report should be written under its own mode-specific path.');
  assert(JSON.parse(fs.readFileSync(configuredWritePaths.modeJson, 'utf8')).mode === 'self-test-configured-execution', 'configured mode-specific report should preserve configured evidence.');
  assert(JSON.parse(fs.readFileSync(minimalWritePaths.modeJson, 'utf8')).mode === 'self-test-minimal-execution', 'minimal mode-specific report should preserve minimal evidence.');
  assert(JSON.parse(fs.readFileSync(REPORT_JSON, 'utf8')).mode === 'self-test-minimal-execution', 'report.json should remain the latest-run alias.');

  console.log(JSON.stringify({
    success: true,
    checks: [
      'missing readonly live opt-in blocks before Photoshop bridge calls',
      'readonly readiness does not require write takeover flags',
      'minimal live execution requires write takeover plus a separate explicit execute flag',
      'fixture C-1163-like project matrix is detected',
      'GBK C-1163 CSV config is parsed into a full 2/3/4 SKU plan',
      'existing SKU output filenames are parsed as read-only color evidence',
      'candidate SKU color source image filenames are parsed as read-only recovery evidence',
      'configured full SKU execution plan maps CSV color slots to SKU color names',
      'readonly live opt-in flag plus project path make readiness gate eligible',
      'reports redact absolute paths and raw payload markers',
      'readiness does not claim SKU completion or design quality'
    ]
  }, null, 2));
}

async function main() {
  if (process.argv.includes('--self-test')) {
    runSelfTest();
    return;
  }

  const runtimeEnv = { ...process.env };
  if (process.argv.includes('--execute-minimal')) runtimeEnv[EXECUTE_MINIMAL_FLAG] = '1';
  if (process.argv.includes('--execute-configured')) runtimeEnv[EXECUTE_CONFIGURED_FLAG] = '1';

  const optIn = buildOptIn(runtimeEnv);
  const wantsMinimalExecution = String(runtimeEnv[EXECUTE_MINIMAL_FLAG] || '') === '1';
  const wantsConfiguredExecution = String(runtimeEnv[EXECUTE_CONFIGURED_FLAG] || '') === '1';
  const executionOptIn = wantsConfiguredExecution
    ? buildConfiguredExecutionOptIn(runtimeEnv)
    : (wantsMinimalExecution ? buildMinimalExecutionOptIn(runtimeEnv) : null);
  const projectScan = scanProject(pickProjectPath(runtimeEnv));
  let bridgeReadiness = null;
  let minimalExecution = null;
  let configuredExecution = null;
  let error = null;
  let mode = 'readiness-skipped';

  if (optIn.ok && projectScan.status === 'ready_project_files') {
    mode = 'live-readonly-bridge-readiness';
    try {
      bridgeReadiness = await runBridgeReadiness();
    } catch (caught) {
      error = caught;
    }
  }

  if (wantsConfiguredExecution) {
    mode = 'live-configured-execution';
    if (!executionOptIn?.ok) {
      mode = 'live-configured-execution-blocked';
    } else if (projectScan.status !== 'ready_project_files') {
      mode = 'live-configured-execution-blocked';
    } else if (bridgeReadiness?.ready !== true) {
      mode = 'live-configured-execution-blocked';
    } else if (!error) {
      try {
        configuredExecution = await runConfiguredLiveExecution(projectScan, runtimeEnv);
      } catch (caught) {
        error = caught;
      }
    }
  }

  if (wantsMinimalExecution && !wantsConfiguredExecution) {
    mode = 'live-minimal-execution';
    if (!executionOptIn?.ok) {
      mode = 'live-minimal-execution-blocked';
    } else if (projectScan.status !== 'ready_project_files') {
      mode = 'live-minimal-execution-blocked';
    } else if (bridgeReadiness?.ready !== true) {
      mode = 'live-minimal-execution-blocked';
    } else if (!error) {
      try {
        minimalExecution = await runMinimalLiveExecution(projectScan, runtimeEnv);
      } catch (caught) {
        error = caught;
      }
    }
  }

  const skipped = mode === 'readiness-skipped';
  const report = buildReport({
    mode,
    optIn,
    executionOptIn,
    projectScan,
    bridgeReadiness,
    minimalExecution,
    configuredExecution,
    skipped,
    error
  });
  const reportPaths = writeReport(report);
  console.log(JSON.stringify({
    success: report.success,
    scriptCompleted: true,
    readiness: report.success,
    minimalExecution: report.minimalExecution?.status || null,
    configuredExecution: report.configuredExecution?.status || null,
    skipped: report.skipped,
    mode: report.mode,
    blockers: report.blockers,
    report: reportPaths.latestJson,
    modeReport: reportPaths.modeJson
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
