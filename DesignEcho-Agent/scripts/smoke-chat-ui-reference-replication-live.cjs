#!/usr/bin/env node

const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { _electron: electron } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const REPORT_JSON = path.join(ROOT, 'tmp', 'chat-ui-reference-replication-live-smoke.json');
const REPORT_MD = path.join(ROOT, 'tmp', 'chat-ui-reference-replication-live-smoke.md');
const WS_PORT = 8765;
const DEFAULT_PORTS = {
  ws: 8765,
  webview: 8766,
  debugBridge: 8767,
  mcpHost: 8768
};
const TEST_PORT_START = 21820;
const TEST_PORT_END = 22820;
const LIVE_FLAG = 'DESIGNECHO_LIVE_REFERENCE_REPLICATION_UI';
const REAL_PS_FLAG = 'DESIGNECHO_LIVE_REFERENCE_REPLICATION_REAL_PHOTOSHOP';
const TAKEOVER_FLAG = 'DESIGNECHO_LIVE_REFERENCE_REPLICATION_TAKEOVER';
const CAPTURE_RESULT_FLAG = 'DESIGNECHO_LIVE_REFERENCE_REPLICATION_CAPTURE_RESULT';
const CASE_ID_FLAG = 'DESIGNECHO_REFERENCE_REPLICATION_LIVE_CASE_ID';
const DEFAULT_CASE_ID = 'rr-001-fex-certificate-text-layout';
const TIMEOUT_MS = Number(process.env.DESIGNECHO_LIVE_REFERENCE_REPLICATION_TIMEOUT_MS || 240000);
const BENCHMARK_DIR = path.join(ROOT, 'benchmarks', 'reference-replication');

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) continue;
    const eqIndex = arg.indexOf('=');
    const key = eqIndex >= 0 ? arg.slice(2, eqIndex) : arg.slice(2);
    let value = eqIndex >= 0 ? arg.slice(eqIndex + 1) : undefined;
    if (value === undefined && index + 1 < argv.length && !argv[index + 1].startsWith('--')) {
      value = argv[index + 1];
      index += 1;
    }
    options[key] = value === undefined ? true : value;
  }
  return options;
}

function parseBoolean(value, fallback = false) {
  if (value === undefined) return fallback;
  if (typeof value === 'boolean') return value;
  const normalized = String(value).trim().toLowerCase();
  if (normalized === '') return true;
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return Boolean(value);
}

const cliOptions = parseArgs(process.argv.slice(2));
const CASE_ID = String(cliOptions.id || process.env[CASE_ID_FLAG] || DEFAULT_CASE_ID).trim();
const CAPTURE_RESULT = parseBoolean(cliOptions['capture-result'], process.env[CAPTURE_RESULT_FLAG] === '1');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function isPortOpen(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const socket = net.createConnection({ port, host });
    socket.setTimeout(500);
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.once('error', () => resolve(false));
  });
}

async function findFreePortBlock(start = TEST_PORT_START, end = TEST_PORT_END, count = 4) {
  for (let base = start; base <= end - count; base += count + 1) {
    const open = await Promise.all(Array.from({ length: count }, (_, index) => isPortOpen(base + index)));
    if (open.every((value) => !value)) return base;
  }
  throw new Error(`No free ${count}-port block found between ${start} and ${end}.`);
}

async function listOpenDefaultPorts() {
  const entries = await Promise.all(
    Object.entries(DEFAULT_PORTS).map(async ([name, port]) => ({
      name,
      port,
      open: await isPortOpen(port)
    }))
  );
  return entries.filter((entry) => entry.open);
}

function resetDir(name) {
  const tmpRoot = path.resolve(ROOT, 'tmp');
  const dir = path.resolve(tmpRoot, name);
  if (!dir.startsWith(`${tmpRoot}${path.sep}`)) {
    throw new Error(`Refusing to remove unsafe test directory: ${dir}`);
  }
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function toPosixPath(value) {
  return String(value || '').replace(/\\/g, '/');
}

function inferImageMimeType(filePath) {
  return path.extname(String(filePath || '')).toLowerCase() === '.png'
    ? 'image/png'
    : 'image/jpeg';
}

function assertInsideDirectory(rootDir, targetPath, label) {
  const relative = path.relative(rootDir, targetPath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`${label} escapes ${rootDir}`);
  }
}

function resolveBenchmarkRelativePath(relativePath, label) {
  const raw = String(relativePath || '').trim();
  if (!raw) throw new Error(`${label} is empty`);
  if (path.isAbsolute(raw)) throw new Error(`${label} must be benchmark-relative`);
  const resolved = path.resolve(BENCHMARK_DIR, raw);
  assertInsideDirectory(BENCHMARK_DIR, resolved, label);
  return resolved;
}

function loadBenchmarkCase(caseId) {
  const manifestPath = path.join(BENCHMARK_DIR, 'cases.manifest.json');
  const manifest = readJson(manifestPath);
  const manifestItem = (manifest.cases || []).find((item) => String(item?.id || '').trim() === caseId);
  if (!manifestItem) {
    throw new Error(`Reference benchmark case not found in manifest: ${caseId}`);
  }

  const casePath = resolveBenchmarkRelativePath(manifestItem.file || `cases/${caseId}.json`, 'manifest case file');
  if (!fs.existsSync(casePath)) {
    throw new Error(`Reference benchmark case file missing: ${toPosixPath(path.relative(BENCHMARK_DIR, casePath))}`);
  }
  const caseJson = readJson(casePath);
  const referenceImagePath = resolveBenchmarkRelativePath(caseJson?.referenceImage?.path, 'referenceImage.path');
  const canvas = caseJson?.scenario?.canvas || {};
  const width = Number(canvas.width) || 0;
  const height = Number(canvas.height) || 0;
  if (!width || !height) {
    throw new Error(`Reference benchmark case ${caseId} does not define a valid scenario.canvas`);
  }

  return {
    caseId,
    caseJson,
    caseFile: toPosixPath(path.relative(BENCHMARK_DIR, casePath)),
    referenceImagePath,
    referenceRelativePath: toPosixPath(path.relative(BENCHMARK_DIR, referenceImagePath)),
    canvas: { width, height }
  };
}

function resolveCaptureScreenshotPath(caseInfo) {
  const requested = cliOptions['result-screenshot'];
  if (requested !== undefined && String(requested).trim()) {
    return path.isAbsolute(String(requested))
      ? path.resolve(String(requested))
      : path.resolve(process.cwd(), String(requested));
  }
  return path.join(BENCHMARK_DIR, 'results', `${caseInfo.caseId}-result.png`);
}

function writeBase64Image(base64, outputPath, options = {}) {
  const normalized = String(base64 || '').replace(/^data:image\/\w+;base64,/, '');
  if (!normalized.trim()) {
    throw new Error('getCanvasSnapshot did not return base64 image data');
  }
  if (fs.existsSync(outputPath) && !options.overwrite) {
    throw new Error(`Result screenshot already exists: ${outputPath}. Use --overwrite when recapturing intentionally.`);
  }
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, Buffer.from(normalized, 'base64'));
}

function buildRecordCommand(caseInfo, screenshotPath) {
  const parts = [
    'npm', 'run', 'benchmark:reference-replication:record-result', '--',
    '--id', caseInfo.caseId,
    '--result-screenshot', screenshotPath,
    '--copy-result-screenshot',
    '--build-verified',
    '--manual-verified',
    '--reviewer', '<reviewer>',
    '--score-structure', '<0..1>',
    '--score-placement', '<0..1>',
    '--score-text-hierarchy', '<0..1>',
    '--score-editability', '<0..1>',
    '--score-overall', '<0..1>'
  ];
  return parts.map((part) => {
    const value = String(part);
    if (value === 'npm' || value === 'run' || value === '--' || value.startsWith('--') || value.startsWith('benchmark:')) {
      return value;
    }
    return `"${value.replace(/"/g, '\\"')}"`;
  }).join(' ');
}

function writeReports(result) {
  fs.mkdirSync(path.dirname(REPORT_JSON), { recursive: true });
  fs.writeFileSync(REPORT_JSON, JSON.stringify(result, null, 2), 'utf8');
  fs.writeFileSync(
    REPORT_MD,
    [
      '# Chat UI Reference Replication Live Smoke',
      '',
      `- success: ${result.success}`,
      `- skipped: ${Boolean(result.skipped)}`,
      result.mode ? `- mode: ${result.mode}` : '',
      result.error ? `- error: ${result.error}` : '',
      `- report: ${REPORT_JSON}`,
      '',
      '## Checks',
      ...(result.checks || []).map((check) => `- ${check}`),
      '',
      '## Findings',
      ...(result.findings || []).map((finding) => `- ${finding}`)
    ].filter(Boolean).join('\n'),
    'utf8'
  );
}

function safeReadStateStorePath() {
  if (process.env.DESIGNECHO_LIVE_REFERENCE_REPLICATION_STATE_STORE) {
    return path.resolve(process.env.DESIGNECHO_LIVE_REFERENCE_REPLICATION_STATE_STORE);
  }
  const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  return path.join(appData, 'designecho-agent', 'app-state-store.json');
}

function copyStateStoreIntoUserData(userDataDir) {
  const source = safeReadStateStorePath();
  if (!fs.existsSync(source)) {
    throw new Error(`Missing persisted model settings store. Expected ${source}.`);
  }
  const destination = path.join(userDataDir, 'app-state-store.json');
  fs.copyFileSync(source, destination);
  return {
    copied: true,
    sourceExists: true,
    destination
  };
}

function messagesText(messages) {
  return messages.map((message) => message.contentPreview || '').join('\n');
}

function thinkingText(messages) {
  return messages.map((message) => message.thinkingPreview || '').join('\n');
}

function asJson(value) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

async function rpc(endpoint, method, params = {}) {
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

async function callToolAt(endpoint, name, args = {}) {
  return parseToolResult(await rpc(endpoint, 'tools/call', { name, arguments: args }));
}

async function callPhotoshopToolAt(endpoint, name, args = {}) {
  return callToolAt(endpoint, 'photoshop.tools.call', { name, arguments: args });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTransientPhotoshopState(value) {
  const text = typeof value === 'string'
    ? value
    : value?.error || value?.message || '';
  return /host is in a modal state|not connected|connection|ECONNREFUSED|fetch failed/i.test(String(text));
}

async function callPhotoshopToolStableAt(endpoint, name, args = {}, options = {}) {
  const attempts = options.attempts || 8;
  const delayMs = options.delayMs || 300;
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const result = await callPhotoshopToolAt(endpoint, name, args);
      if (!isTransientPhotoshopState(result) || attempt >= attempts) {
        if (result && typeof result === 'object') {
          result.__smokeAttempts = attempt;
        }
        return result;
      }
    } catch (error) {
      lastError = error;
      if (!isTransientPhotoshopState(error) || attempt >= attempts) {
        throw error;
      }
    }
    await sleep(delayMs * attempt);
  }

  if (lastError) throw lastError;
  return callPhotoshopToolAt(endpoint, name, args);
}

function normalizeDocuments(listResult) {
  return Array.isArray(listResult?.documents) ? listResult.documents : [];
}

async function waitForRealPhotoshopReady(endpoint, timeoutMs = 45000) {
  const started = Date.now();
  let lastError = null;
  while (Date.now() - started < timeoutMs) {
    try {
      const result = await callPhotoshopToolAt(endpoint, 'listDocuments', { includeDetails: true });
      if (result?.success) {
        return result;
      }
      lastError = new Error(result?.error || 'listDocuments did not report success');
    } catch (error) {
      lastError = error;
    }
    await sleep(500);
  }
  throw new Error(`Photoshop UXP tool channel was not ready within ${timeoutMs}ms: ${lastError?.message || String(lastError)}`);
}

async function cleanupRealPhotoshopDocuments(endpoint, beforeListResult) {
  const beforeDocuments = normalizeDocuments(beforeListResult);
  const beforeIds = new Set(beforeDocuments.map((doc) => Number(doc?.id)).filter(Number.isFinite));
  const beforeActiveId = Number(beforeListResult?.activeDocumentId);
  const cleanup = {
    attempted: true,
    beforeDocumentCount: beforeDocuments.length,
    closedDocuments: [],
    restoreAttempted: false,
    restoredActiveDocument: false,
    warnings: []
  };

  let afterListResult;
  try {
    afterListResult = await callPhotoshopToolStableAt(endpoint, 'listDocuments', { includeDetails: true });
  } catch (error) {
    cleanup.warnings.push(`cleanup listDocuments failed: ${error?.message || String(error)}`);
    return cleanup;
  }

  const afterDocuments = normalizeDocuments(afterListResult);
  const newDocuments = afterDocuments.filter((doc) => {
    const id = Number(doc?.id);
    return Number.isFinite(id) && !beforeIds.has(id);
  });

  for (const doc of newDocuments) {
    try {
      const closeResult = await callPhotoshopToolStableAt(endpoint, 'closeDocument', {
        documentId: doc.id,
        save: false
      }, { attempts: 5, delayMs: 350 });
      cleanup.closedDocuments.push({
        id: doc.id,
        name: doc.name,
        success: closeResult?.success !== false,
        error: closeResult?.error
      });
    } catch (error) {
      cleanup.closedDocuments.push({
        id: doc.id,
        name: doc.name,
        success: false,
        error: error?.message || String(error)
      });
    }
  }

  if (Number.isFinite(beforeActiveId)) {
    cleanup.restoreAttempted = true;
    try {
      const current = await callPhotoshopToolStableAt(endpoint, 'listDocuments', { includeDetails: false });
      const currentDocuments = normalizeDocuments(current);
      if (currentDocuments.some((doc) => Number(doc?.id) === beforeActiveId)) {
        const switchResult = await callPhotoshopToolStableAt(endpoint, 'switchDocument', { documentId: beforeActiveId });
        cleanup.restoredActiveDocument = switchResult?.success !== false;
        if (switchResult?.success === false) {
          cleanup.warnings.push(`restore switchDocument failed: ${switchResult?.error || 'unknown error'}`);
        }
      } else {
        cleanup.warnings.push(`original active document ${beforeActiveId} was no longer open`);
      }
    } catch (error) {
      cleanup.warnings.push(`restore active document failed: ${error?.message || String(error)}`);
    }
  }

  return cleanup;
}

async function captureRealPhotoshopSnapshot(endpoint, caseInfo, outputPath) {
  const snapshot = await callPhotoshopToolStableAt(endpoint, 'getCanvasSnapshot', {
    maxSize: Math.max(caseInfo.canvas.width, caseInfo.canvas.height),
    format: 'png',
    quality: 100
  }, { attempts: 5, delayMs: 350 });
  if (snapshot?.success !== true) {
    throw new Error(snapshot?.error || 'getCanvasSnapshot returned success=false');
  }
  writeBase64Image(snapshot?.snapshot?.base64, outputPath, {
    overwrite: parseBoolean(cliOptions.overwrite, false)
  });
  return {
    success: true,
    absolutePath: toPosixPath(outputPath),
    width: snapshot?.snapshot?.width,
    height: snapshot?.snapshot?.height,
    format: snapshot?.snapshot?.format || 'png',
    recordCommand: buildRecordCommand(caseInfo, outputPath)
  };
}

function findRiskMarkers(text) {
  return [
    { id: 'internal_bridge_json', pattern: /"intent"\s*:\s*"debug_or_implement"|"current_state"|"action_request"/ },
    { id: 'max_iterations', pattern: /Max iterations reached|最大迭代次数/ },
    { id: 'parse_failed', pattern: /Parse failed|解析失败/ },
    { id: 'ordinary_chat_fallback', pattern: /ordinary chat|普通对话/ },
    { id: 'uxp_disconnected_wrong_path', pattern: /UXP 插件未连接/ },
    { id: 'debug_bridge_generated', pattern: /Agent 面板桥接消息已生成|bridge message generated/i }
  ].filter((marker) => marker.pattern.test(text)).map((marker) => marker.id);
}

function summarizeMessages(messages) {
  return messages.map((message) => ({
    role: message.role,
    hasImage: Boolean(message.hasImage),
    contentPreview: message.contentPreview,
    thinkingStepCount: message.thinkingStepCount,
    toolResultCount: message.toolResultCount,
    executionStatus: message.executionStatus,
    executionSummaryPreview: message.executionSummaryPreview
  }));
}

function buildSkippedResult(reason) {
  return {
    success: true,
    skipped: true,
    mode: 'guarded-default',
    caseId: CASE_ID,
    captureRequested: CAPTURE_RESULT,
    reason,
    checks: [
      `Set ${LIVE_FLAG}=1 to run the real-model ChatPanel path.`,
      'Default mode does not call any external model and does not touch Photoshop.'
    ],
    findings: [
      'This guard exists to keep maintenance/preflight runs from consuming provider quota.'
    ],
    report: {
      json: REPORT_JSON,
      md: REPORT_MD
    }
  };
}

async function main() {
  if (process.env[LIVE_FLAG] !== '1') {
    const result = buildSkippedResult(`${LIVE_FLAG} is not set to 1.`);
    writeReports(result);
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  const useRealPhotoshop = process.env[REAL_PS_FLAG] === '1';

  if (useRealPhotoshop && process.env[TAKEOVER_FLAG] !== '1') {
    const result = {
      success: false,
      skipped: true,
      mode: 'real-photoshop-refused',
      error: `${REAL_PS_FLAG}=1 requires ${TAKEOVER_FLAG}=1. Real Photoshop mode can create and close a disposable document, so it must be explicit.`,
      checks: [
        'Refused to touch Photoshop without explicit takeover opt-in.'
      ],
      findings: [
        'Run only when Photoshop is ready and you accept a disposable-document end-to-end check.'
      ],
      report: {
        json: REPORT_JSON,
        md: REPORT_MD
      }
    };
    writeReports(result);
    console.error(JSON.stringify(result, null, 2));
    process.exit(1);
  }

  if (useRealPhotoshop) {
    const openDefaultPorts = await listOpenDefaultPorts();
    if (openDefaultPorts.length > 0) {
      const result = {
        success: false,
        skipped: true,
        mode: 'real-photoshop-refused',
        error: `Default DesignEcho ports are already in use: ${openDefaultPorts.map((entry) => `${entry.name}:${entry.port}`).join(', ')}.`,
        checks: [
          'Refused to kill or hijack an existing desktop app/UXP connection.',
          'Close the running DesignEcho desktop app first, then rerun with takeover if you want a real Photoshop UI smoke.'
        ],
        findings: [
          'This guard prevents destructive interference with the user workspace.'
        ],
        report: {
          json: REPORT_JSON,
          md: REPORT_MD
        }
      };
      writeReports(result);
      console.error(JSON.stringify(result, null, 2));
      process.exit(1);
    }
  }

  const benchmarkCase = loadBenchmarkCase(CASE_ID);
  const captureScreenshotPath = resolveCaptureScreenshotPath(benchmarkCase);
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const mainEntry = path.join(ROOT, pkg.main || 'dist/main/main/index.js');
  const rendererEntry = path.join(ROOT, 'dist/renderer/index.html');
  const referenceImagePath = benchmarkCase.referenceImagePath;

  assert(fs.existsSync(mainEntry), `Missing built Electron main entry: ${mainEntry}. Run npm run build first.`);
  assert(fs.existsSync(rendererEntry), `Missing built renderer entry: ${rendererEntry}. Run npm run build first.`);
  assert(fs.existsSync(referenceImagePath), `Missing reference image fixture: ${referenceImagePath}`);
  if (CAPTURE_RESULT && !useRealPhotoshop) {
    throw new Error(`--capture-result requires ${REAL_PS_FLAG}=1 because only the real Photoshop tool channel can provide a real result screenshot.`);
  }

  const testPortBase = useRealPhotoshop ? WS_PORT : await findFreePortBlock();
  const userDataDir = resetDir('chat-ui-reference-replication-live-user-data');
  const projectDir = resetDir('chat-ui-reference-replication-live-project');
  fs.mkdirSync(path.join(projectDir, 'PSD'), { recursive: true });
  fs.mkdirSync(path.join(projectDir, 'assets'), { recursive: true });
  const stateStore = copyStateStoreIntoUserData(userDataDir);

  let app;
  let realPhotoshopBeforeDocuments = null;
  let realPhotoshopCleanup = null;
  const mcpEndpoint = `http://127.0.0.1:${useRealPhotoshop ? DEFAULT_PORTS.mcpHost : testPortBase + 3}/mcp`;
  try {
    const launchEnv = {
      ...process.env,
      DESIGNECHO_CHAT_TEST_BRIDGE: '1',
      DESIGNECHO_TEST_USER_DATA_DIR: userDataDir,
      DESIGNECHO_CHAT_TEST_PROJECT_PATH: projectDir,
      DESIGNECHO_SKIP_PORT_CLEANUP: '1',
      ELECTRON_DISABLE_SECURITY_WARNINGS: 'true'
    };

    if (!useRealPhotoshop) {
      launchEnv.DESIGNECHO_CHAT_TEST_FAKE_PHOTOSHOP = '1';
      launchEnv.DESIGNECHO_CHAT_TEST_FAKE_PHOTOSHOP_EMPTY = '1';
      launchEnv.DESIGNECHO_PORT_OFFSET = String(testPortBase - WS_PORT);
    }

    app = await electron.launch({
      args: [ROOT, `--user-data-dir=${userDataDir}`],
      cwd: ROOT,
      env: launchEnv,
      timeout: 30000
    });

    const page = await app.firstWindow({ timeout: 30000 });
    await page.waitForLoadState('domcontentloaded', { timeout: 30000 });
    await page.waitForFunction(() => !!window.__DESIGNECHO_CHAT_TEST_BRIDGE__, null, { timeout: 30000 });

    if (useRealPhotoshop) {
      realPhotoshopBeforeDocuments = await waitForRealPhotoshopReady(mcpEndpoint, 60000);
    }

    const before = await page.evaluate(() => window.__DESIGNECHO_CHAT_TEST_BRIDGE__.getSnapshot());
    const imageData = fs.readFileSync(referenceImagePath).toString('base64');
    const imageType = inferImageMimeType(referenceImagePath);
    const prompt = [
      `Please use the attached reference image as the design target for benchmark case ${benchmarkCase.caseId}.`,
      `Case name: ${benchmarkCase.caseJson.name || benchmarkCase.caseId}.`,
      'Rebuild a similar editable Photoshop layout.',
      'Keep text editable, preserve the main structure and hierarchy, and report any incomplete verification truthfully.',
      'Do not output debug JSON.'
    ].join(' ');
    const after = await page.evaluate((payload) => (
      window.__DESIGNECHO_CHAT_TEST_BRIDGE__.submit(payload.prompt, {
        image: { data: payload.imageData, type: payload.imageType },
        timeoutMs: payload.timeoutMs
      })
    ), { prompt, imageData, imageType, timeoutMs: TIMEOUT_MS });

    const newMessages = after.messages.slice(before.messageCount);
    const visibleText = messagesText(newMessages);
    const progressText = thinkingText(newMessages);
    const combinedText = `${visibleText}\n${progressText}`;
    const riskMarkers = findRiskMarkers(combinedText);
    const assistantMessages = newMessages.filter((message) => message.role === 'assistant');
    const assistantVisibleText = messagesText(assistantMessages);
    const assistantProgressText = thinkingText(assistantMessages);
    const assistantCombinedText = `${assistantVisibleText}\n${assistantProgressText}`;
    const executionStatuses = [...new Set(assistantMessages.map((message) => message.executionStatus).filter(Boolean))];
    const hasReferenceIntent = /reference|参考图|复刻|replicat|layout|版式|Photoshop|editable|可编辑/i.test(assistantCombinedText);
    const routedToLayoutReplication = /layout-replication|analyzeReferenceLayout|准备参考图复刻|分析参考图|调用视觉模型解析参考图|生成模板骨架|参考图模板骨架|元素覆盖/i.test(assistantCombinedText);
    const hasImageUserMessage = newMessages.some((message) => message.role === 'user' && message.hasImage);
    const completed = executionStatuses.includes('completed') || /completed|已完成/i.test(combinedText);
    const needsReview = executionStatuses.includes('needs_review') || /needs[_ -]?review|需复核|未完成|incomplete/i.test(combinedText);

    let capturedResultScreenshot = null;
    const findings = [];
    if (!hasReferenceIntent) findings.push('The visible response did not clearly acknowledge the reference-replication task.');
    if (!routedToLayoutReplication) findings.push('The live model did not route the request through the layout-replication skill path.');
    if (!hasImageUserMessage) findings.push('The submitted user message did not retain the reference image attachment.');
    if (riskMarkers.length) findings.push(`Risk markers found: ${riskMarkers.join(', ')}`);
    if (!assistantMessages.length) findings.push('No assistant message was produced.');
    if (!completed && !needsReview) findings.push('No explicit completed or needs-review execution status was visible.');
    if (CAPTURE_RESULT && useRealPhotoshop) {
      try {
        capturedResultScreenshot = await captureRealPhotoshopSnapshot(mcpEndpoint, benchmarkCase, captureScreenshotPath);
      } catch (error) {
        findings.push(`Result screenshot capture failed: ${error?.message || String(error)}`);
      }
    }

    const success = assistantMessages.length > 0
      && hasImageUserMessage
      && hasReferenceIntent
      && routedToLayoutReplication
      && riskMarkers.length === 0
      && (!CAPTURE_RESULT || capturedResultScreenshot?.success === true);

    const result = {
      success,
      skipped: false,
      mode: useRealPhotoshop ? 'live-model-real-photoshop' : 'live-model-fake-photoshop',
      caseId: benchmarkCase.caseId,
      caseName: benchmarkCase.caseJson.name || benchmarkCase.caseId,
      caseFile: benchmarkCase.caseFile,
      referenceImage: benchmarkCase.referenceRelativePath,
      captureRequested: CAPTURE_RESULT,
      plannedResultScreenshot: toPosixPath(captureScreenshotPath),
      capturedResultScreenshot,
      timeoutMs: TIMEOUT_MS,
      isolatedPorts: {
        ws: testPortBase,
        webview: testPortBase + 1,
        debugBridge: testPortBase + 2,
        mcpHost: testPortBase + 3
      },
      persistedStateCopied: stateStore.copied,
      checks: [
        useRealPhotoshop
          ? 'Electron ChatPanel launched on default ports for the real UXP Photoshop tool channel'
          : 'Electron ChatPanel launched with isolated userData and isolated ports',
        'persisted settings were copied into the isolated userData directory without printing secrets',
        'real configured model path was used; DESIGNECHO_CHAT_TEST_FAKE_MODEL was not set',
        useRealPhotoshop
          ? 'Photoshop execution used the real UXP tool channel and a disposable-document cleanup guard'
          : 'Photoshop execution was faked to avoid touching the user document',
        'temporary simple text-layout reference image was submitted through the real ChatPanel image path'
      ],
      findings,
      riskMarkers,
      beforeMessageCount: before.messageCount,
      afterMessageCount: after.messageCount,
      executionStatuses,
      routedToLayoutReplication,
      assistantPreview: visibleText.slice(0, 1600),
      thinkingPreview: progressText.slice(0, 1600),
      messages: summarizeMessages(newMessages),
      realPhotoshopBeforeDocumentCount: realPhotoshopBeforeDocuments
        ? normalizeDocuments(realPhotoshopBeforeDocuments).length
        : undefined,
      report: {
        json: REPORT_JSON,
        md: REPORT_MD
      }
    };
    writeReports(result);
    const output = JSON.stringify(result, null, 2);
    if (success) {
      console.log(output);
    } else {
      console.error(output);
      process.exitCode = 1;
    }
  } finally {
    if (useRealPhotoshop && realPhotoshopBeforeDocuments) {
      realPhotoshopCleanup = await cleanupRealPhotoshopDocuments(mcpEndpoint, realPhotoshopBeforeDocuments).catch((error) => ({
        attempted: true,
        error: error?.message || String(error)
      }));
      try {
        const existing = fs.existsSync(REPORT_JSON)
          ? JSON.parse(fs.readFileSync(REPORT_JSON, 'utf8'))
          : {};
        existing.realPhotoshopCleanup = realPhotoshopCleanup;
        writeReports(existing);
      } catch {
        // Cleanup result is best-effort evidence; do not mask the original smoke result.
      }
    }
    if (app) {
      await app.close().catch(() => undefined);
    }
  }
}

main().catch((error) => {
  const result = {
    success: false,
    skipped: false,
    mode: process.env[LIVE_FLAG] === '1'
      ? (process.env[REAL_PS_FLAG] === '1' ? 'live-model-real-photoshop' : 'live-model-fake-photoshop')
      : 'guarded-default',
    error: error?.stack || error?.message || String(error),
    report: {
      json: REPORT_JSON,
      md: REPORT_MD
    }
  };
  writeReports(result);
  console.error(JSON.stringify(result, null, 2));
  process.exit(1);
});
