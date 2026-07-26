#!/usr/bin/env node

const fs = require('fs');
const net = require('net');
const path = require('path');
const { _electron: electron } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const REPORT_JSON = path.join(ROOT, 'tmp', 'electron-startup-window-smoke.json');
const REPORT_MD = path.join(ROOT, 'tmp', 'electron-startup-window-smoke.md');
const WS_PORT = 8765;
const TEST_PORT_START = 20800;
const TEST_PORT_END = 21800;

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

function writeReports(result) {
  fs.mkdirSync(path.dirname(REPORT_JSON), { recursive: true });
  fs.writeFileSync(REPORT_JSON, JSON.stringify(result, null, 2), 'utf8');
  fs.writeFileSync(
    REPORT_MD,
    [
      '# Electron Startup Window Smoke',
      '',
      `- success: ${result.success}`,
      result.error ? `- error: ${result.error}` : '',
      `- report: ${REPORT_JSON}`,
      '',
      '## Checks',
      ...(result.checks || []).map((check) => `- ${check}`)
    ].filter(Boolean).join('\n'),
    'utf8'
  );
}

async function getWindowStates(app) {
  return app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((window) => ({
    title: window.getTitle(),
    visible: window.isVisible(),
    minimized: window.isMinimized(),
    focused: window.isFocused(),
    bounds: window.getBounds()
  })));
}

async function waitForVisibleWindow(app, timeoutMs = 15000) {
  const startedAt = Date.now();
  let latest = [];
  while (Date.now() - startedAt < timeoutMs) {
    latest = await getWindowStates(app);
    const visible = latest.find((window) => window.visible && !window.minimized);
    if (visible) return { visible, states: latest };
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return { visible: null, states: latest };
}

async function main() {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const mainEntry = path.join(ROOT, pkg.main || 'dist/main/main/index.js');
  const rendererEntry = path.join(ROOT, 'dist/renderer/index.html');
  assert(fs.existsSync(mainEntry), `Missing built Electron main entry: ${mainEntry}. Run npm run build first.`);
  assert(fs.existsSync(rendererEntry), `Missing built renderer entry: ${rendererEntry}. Run npm run build first.`);

  const testPortBase = await findFreePortBlock();
  const userDataDir = resetDir('electron-startup-window-user-data');
  let app;
  try {
    app = await electron.launch({
      args: [ROOT, `--user-data-dir=${userDataDir}`],
      cwd: ROOT,
      env: {
        ...process.env,
        DESIGNECHO_TEST_USER_DATA_DIR: userDataDir,
        DESIGNECHO_PORT_OFFSET: String(testPortBase - WS_PORT),
        DESIGNECHO_SKIP_PORT_CLEANUP: '1',
        ELECTRON_DISABLE_SECURITY_WARNINGS: 'true'
      },
      timeout: 30000
    });

    const page = await app.firstWindow({ timeout: 30000 });
    await page.waitForLoadState('domcontentloaded', { timeout: 30000 });
    const { visible, states } = await waitForVisibleWindow(app);
    assert(visible, `Expected a visible Electron BrowserWindow. states=${JSON.stringify(states)}`);
    assert(visible.title === 'DesignEcho', `Expected DesignEcho window title, got ${visible.title || '<empty>'}.`);
    assert(visible.bounds.width >= 800 && visible.bounds.height >= 600, `Unexpected window bounds: ${JSON.stringify(visible.bounds)}.`);

    const result = {
      success: true,
      isolatedPorts: {
        ws: testPortBase,
        webview: testPortBase + 1,
        debugBridge: testPortBase + 2,
        mcpHost: testPortBase + 3
      },
      checks: [
        'Electron app launched with isolated userData and isolated ports',
        'renderer reached domcontentloaded',
        'main BrowserWindow became visible without relying only on ready-to-show',
        'visible window title and minimum bounds are correct'
      ],
      visibleWindow: visible,
      allWindows: states,
      report: {
        json: REPORT_JSON,
        md: REPORT_MD
      }
    };
    writeReports(result);
    console.log(JSON.stringify(result, null, 2));
  } finally {
    if (app) {
      await app.close().catch(() => undefined);
    }
  }
}

main().catch((error) => {
  const result = {
    success: false,
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
