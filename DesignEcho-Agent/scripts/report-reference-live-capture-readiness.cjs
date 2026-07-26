#!/usr/bin/env node

const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const DEFAULT_CASE_ID = 'rr-002-neutral-quality-card-text-layout';
const DEFAULT_PORTS = {
  ws: 8765,
  webview: 8766,
  debugBridge: 8767,
  mcpHost: 8768
};
const FLAGS = {
  liveUi: 'DESIGNECHO_LIVE_REFERENCE_REPLICATION_UI',
  realPhotoshop: 'DESIGNECHO_LIVE_REFERENCE_REPLICATION_REAL_PHOTOSHOP',
  takeover: 'DESIGNECHO_LIVE_REFERENCE_REPLICATION_TAKEOVER'
};

function run(command, args, cwd) {
  return execFileSync(command, args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim();
}

function repoRoot() {
  return run('git', ['rev-parse', '--show-toplevel'], process.cwd()).replace(/\\/g, '/');
}

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

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function toPosixPath(value) {
  return String(value || '').replace(/\\/g, '/');
}

function quote(value) {
  return `"${String(value).replace(/"/g, '\\"')}"`;
}

function isEnabled(value) {
  return String(value || '').trim() === '1';
}

function resolveInside(rootDir, relativePath, label) {
  const raw = String(relativePath || '').trim();
  if (!raw) throw new Error(`${label} is empty`);
  if (path.isAbsolute(raw)) throw new Error(`${label} must be benchmark-relative`);
  const resolved = path.resolve(rootDir, raw);
  const relative = path.relative(rootDir, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`${label} escapes benchmark directory`);
  }
  return resolved;
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

async function inspectDefaultPorts() {
  return Promise.all(Object.entries(DEFAULT_PORTS).map(async ([name, port]) => ({
    name,
    port,
    open: await isPortOpen(port)
  })));
}

function defaultStateStorePath() {
  const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  return path.join(appData, 'designecho-agent', 'app-state-store.json');
}

function buildRunCommand(caseId, resultScreenshot) {
  return [
    'npm run benchmark:reference-replication:run-live-evidence-pipeline --',
    '--live',
    '--real-photoshop',
    '--takeover',
    '--id', quote(caseId),
    '--result-screenshot', quote(resultScreenshot)
  ].join(' ');
}

async function buildReport() {
  const options = parseArgs(process.argv.slice(2));
  const root = repoRoot();
  const agentRoot = path.join(root, 'DesignEcho-Agent');
  const benchmarkDir = options['benchmark-dir']
    ? path.resolve(process.cwd(), String(options['benchmark-dir']))
    : path.join(agentRoot, 'benchmarks', 'reference-replication');
  const caseId = String(options.id || DEFAULT_CASE_ID).trim();
  const pkg = readJson(path.join(agentRoot, 'package.json'));
  const mainEntry = path.join(agentRoot, pkg.main || 'dist/main/main/index.js');
  const rendererEntry = path.join(agentRoot, 'dist', 'renderer', 'index.html');
  const manifestPath = path.join(benchmarkDir, 'cases.manifest.json');
  const manifest = readJson(manifestPath);
  const manifestItem = (manifest.cases || []).find((item) => String(item?.id || '').trim() === caseId);
  const casePath = manifestItem
    ? resolveInside(benchmarkDir, manifestItem.file || `cases/${caseId}.json`, 'manifest case file')
    : null;
  const caseJson = casePath && fs.existsSync(casePath) ? readJson(casePath) : null;
  const referenceImagePath = caseJson?.referenceImage?.path
    ? resolveInside(benchmarkDir, caseJson.referenceImage.path, 'referenceImage.path')
    : null;
  const resultScreenshot = options['result-screenshot']
    ? path.resolve(process.cwd(), String(options['result-screenshot']))
    : path.join(benchmarkDir, 'results', `${caseId}-result.png`);
  const stateStorePath = process.env.DESIGNECHO_LIVE_REFERENCE_REPLICATION_STATE_STORE
    ? path.resolve(process.env.DESIGNECHO_LIVE_REFERENCE_REPLICATION_STATE_STORE)
    : defaultStateStorePath();
  const ports = await inspectDefaultPorts();

  const flags = {
    liveUi: isEnabled(process.env[FLAGS.liveUi]),
    realPhotoshop: isEnabled(process.env[FLAGS.realPhotoshop]),
    takeover: isEnabled(process.env[FLAGS.takeover])
  };
  const build = {
    mainEntry: toPosixPath(mainEntry),
    mainEntryExists: fs.existsSync(mainEntry),
    rendererEntry: toPosixPath(rendererEntry),
    rendererEntryExists: fs.existsSync(rendererEntry)
  };
  const benchmarkCase = {
    caseId,
    manifestItemExists: Boolean(manifestItem),
    caseFile: casePath ? toPosixPath(path.relative(benchmarkDir, casePath)) : '',
    caseFileExists: Boolean(casePath && fs.existsSync(casePath)),
    referenceImage: referenceImagePath ? toPosixPath(path.relative(benchmarkDir, referenceImagePath)) : '',
    referenceImageExists: Boolean(referenceImagePath && fs.existsSync(referenceImagePath)),
    canvasReady: Boolean(Number(caseJson?.scenario?.canvas?.width) && Number(caseJson?.scenario?.canvas?.height))
  };
  const result = {
    plannedResultScreenshot: toPosixPath(resultScreenshot),
    resultAlreadyExists: fs.existsSync(resultScreenshot),
    parentDirectoryExists: fs.existsSync(path.dirname(resultScreenshot))
  };
  const stateStore = {
    path: toPosixPath(stateStorePath),
    exists: fs.existsSync(stateStorePath),
    source: process.env.DESIGNECHO_LIVE_REFERENCE_REPLICATION_STATE_STORE ? 'env' : 'default-appdata'
  };
  const openDefaultPorts = ports.filter((entry) => entry.open);

  const blockers = [];
  const warnings = [];
  if (!flags.liveUi) blockers.push(`${FLAGS.liveUi}=1 is required for live-model capture.`);
  if (!flags.realPhotoshop) blockers.push(`${FLAGS.realPhotoshop}=1 is required for real Photoshop screenshot capture.`);
  if (!flags.takeover) blockers.push(`${FLAGS.takeover}=1 is required before touching Photoshop or default ports.`);
  if (!build.mainEntryExists) blockers.push('built Electron main entry is missing; run npm run build:main or npm run build.');
  if (!build.rendererEntryExists) blockers.push('built renderer entry is missing; run npm run build:renderer or npm run build.');
  if (!benchmarkCase.manifestItemExists) blockers.push(`reference benchmark case not found in manifest: ${caseId}`);
  if (!benchmarkCase.caseFileExists) blockers.push(`reference benchmark case file missing: ${benchmarkCase.caseFile || caseId}`);
  if (!benchmarkCase.referenceImageExists) blockers.push('reference benchmark image is missing.');
  if (!benchmarkCase.canvasReady) blockers.push('reference benchmark scenario.canvas is missing width/height.');
  if (!stateStore.exists) blockers.push('persisted model settings store is missing; live model smoke cannot reuse configured provider settings.');
  if (result.resultAlreadyExists && !options.overwrite) blockers.push('planned result screenshot already exists; pass --overwrite only for intentional recapture.');
  if (openDefaultPorts.length > 0) {
    blockers.push(`default DesignEcho ports are already open: ${openDefaultPorts.map((entry) => `${entry.name}:${entry.port}`).join(', ')}.`);
  }
  if (!result.parentDirectoryExists) {
    warnings.push('planned result parent directory does not exist yet; capture-live can create it when writing the screenshot.');
  }

  return {
    success: true,
    generatedAt: new Date().toISOString(),
    mode: 'read-only-preflight',
    readyForLiveCapture: blockers.length === 0,
    defaultSafe: true,
    doesNotCallModel: true,
    doesNotTouchPhotoshop: true,
    doesNotWriteScreenshot: true,
    flags,
    build,
    benchmarkDir: toPosixPath(benchmarkDir),
    benchmarkCase,
    result,
    stateStore,
    ports,
    blockers,
    warnings,
    commands: {
      runWhenReady: buildRunCommand(caseId, resultScreenshot),
      guardSmoke: 'npm run smoke:reference:live-evidence-pipeline',
      readiness: `npm run maintenance:reference-live-readiness -- --id ${quote(caseId)}`
    },
    policy: 'read-only-live-capture-preflight-no-model-no-photoshop-no-screenshot'
  };
}

function printText(report) {
  console.log('Reference Replication Live Capture Readiness');
  console.log(`readyForLiveCapture: ${report.readyForLiveCapture}`);
  console.log(`case: ${report.benchmarkCase.caseId}`);
  console.log(`referenceImageExists: ${report.benchmarkCase.referenceImageExists}`);
  console.log(`mainEntryExists: ${report.build.mainEntryExists}`);
  console.log(`rendererEntryExists: ${report.build.rendererEntryExists}`);
  console.log(`stateStoreExists: ${report.stateStore.exists}`);
  console.log(`openDefaultPorts: ${report.ports.filter((entry) => entry.open).map((entry) => `${entry.name}:${entry.port}`).join(', ') || 'none'}`);
  if (report.blockers.length > 0) {
    console.log('blockers:');
    report.blockers.forEach((item) => console.log(`- ${item}`));
  }
  if (report.warnings.length > 0) {
    console.log('warnings:');
    report.warnings.forEach((item) => console.log(`- ${item}`));
  }
  console.log('run when ready:');
  console.log(report.commands.runWhenReady);
}

buildReport()
  .then((report) => {
    if (process.argv.includes('--json')) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      printText(report);
    }
  })
  .catch((error) => {
    console.error(error?.stack || error?.message || String(error));
    process.exit(1);
  });
