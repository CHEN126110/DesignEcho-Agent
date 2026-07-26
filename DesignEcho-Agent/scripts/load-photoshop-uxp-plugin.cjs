#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_MANIFEST = path.resolve(ROOT, '..', 'DesignEcho-UXP', 'manifest.json');
const DEFAULT_PORT = parsePositiveInteger(process.env.UXP_DEVTOOLS_PORT, 14001);
const DEFAULT_TIMEOUT_MS = parsePositiveInteger(
  process.env.DESIGNECHO_UXP_PLUGIN_LOAD_TIMEOUT_MS,
  15_000
);
const MCP_ENDPOINT = process.env.MCP_ENDPOINT || 'http://127.0.0.1:8768/mcp';
const DEFAULT_BRIDGE_WAIT_TIMEOUT_MS = parsePositiveInteger(
  process.env.DESIGNECHO_UXP_PLUGIN_BRIDGE_WAIT_TIMEOUT_MS,
  20_000
);
const DEFAULT_BRIDGE_POLL_MS = parsePositiveInteger(
  process.env.DESIGNECHO_UXP_PLUGIN_BRIDGE_POLL_MS,
  500
);

function parsePositiveInteger(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.round(parsed);
}

function getArgValue(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  const value = process.argv[index + 1];
  if (!value || value.startsWith('--')) return fallback;
  return value;
}

function normalizeManifestPath(value) {
  return path.resolve(String(value || DEFAULT_MANIFEST));
}

function readManifest(manifestPath) {
  const text = fs.readFileSync(manifestPath, 'utf8');
  return JSON.parse(text);
}

function classifyLoadError(error) {
  const message = error instanceof Error ? error.message : String(error || '');
  if (/Bridge did not become ready/i.test(message)) return 'bridge_not_ready';
  if (/timed out|timeout/i.test(message)) return 'load_timeout';
  if (/ECONNREFUSED|not running|connect/i.test(message)) return 'devtools_service_unavailable';
  if (/manifest/i.test(message)) return 'invalid_manifest';
  return 'load_failed';
}

function buildRecoveryActions(classification) {
  switch (classification) {
    case 'load_timeout':
      return [
        'Clear any modal dialog in Photoshop, then rerun this loader.',
        'If Photoshop still keeps the old runtime, restart Photoshop and run this loader again.'
      ];
    case 'devtools_service_unavailable':
      return [
        'Start Adobe UXP Developer Tools and keep Photoshop open.',
        'Confirm the UXP Developer Tools service port matches --port or UXP_DEVTOOLS_PORT.'
      ];
    case 'invalid_manifest':
      return [
        'Confirm the manifest path points to DesignEcho-UXP/manifest.json.',
        'Run the UXP build before loading the plugin.'
      ];
    case 'bridge_not_ready':
      return [
        'The plugin loaded in Photoshop, but Agent did not see the UXP connection in time.',
        'Keep Agent desktop running, rerun the bridge health check, and restart Photoshop if the connection stays absent.'
      ];
    default:
      return [
        'Check Photoshop and UXP Developer Tools logs for the host-side load error.',
        'Rerun with Photoshop idle and no modal dialogs open.'
      ];
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeError(error) {
  return error instanceof Error ? error.message : String(error);
}

function parseToolResult(result) {
  const text = result?.content?.[0]?.text || '';
  try {
    const parsed = JSON.parse(text);
    if (typeof parsed !== 'string') return parsed;
    try {
      return JSON.parse(parsed);
    } catch {
      return parsed;
    }
  } catch {
    return text;
  }
}

async function rpc(method, params = {}, options = {}) {
  const requestTimeoutMs = parsePositiveInteger(options.requestTimeoutMs, DEFAULT_TIMEOUT_MS);
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

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} from ${MCP_ENDPOINT}`);
  }

  const payload = await response.json();
  if (payload.error) {
    throw new Error(`${method} failed: ${JSON.stringify(payload.error)}`);
  }
  return payload.result;
}

async function callTool(name, args = {}, options = {}) {
  const result = await rpc('tools/call', {
    name,
    arguments: args
  }, options);
  return parseToolResult(result);
}

async function waitForBridgeReady(options = {}) {
  const timeoutMs = parsePositiveInteger(options.timeoutMs, DEFAULT_BRIDGE_WAIT_TIMEOUT_MS);
  const pollMs = parsePositiveInteger(options.pollMs, DEFAULT_BRIDGE_POLL_MS);
  const deadline = Date.now() + timeoutMs;
  let attempts = 0;
  let last = null;

  while (Date.now() <= deadline) {
    attempts += 1;
    try {
      const status = await callTool('system.status', {}, {
        requestTimeoutMs: Math.min(3_000, timeoutMs)
      });
      last = {
        ok: true,
        pluginConnected: status?.pluginConnected === true,
        pluginConnectionState: status?.pluginConnectionState || null,
        pluginClientCount: status?.pluginClientCount ?? null
      };
      if (last.pluginConnected) {
        return {
          ready: true,
          attempts,
          status: last
        };
      }
    } catch (error) {
      last = {
        ok: false,
        error: normalizeError(error)
      };
    }
    await sleep(pollMs);
  }

  return {
    ready: false,
    attempts,
    status: last
  };
}

function createDevtoolsClient({ port, timeoutMs, appId }) {
  const url = `ws://127.0.0.1:${port}/socket/cli`;
  const pending = new Map();
  let nextRequestId = 0;
  let appClient = null;
  let waitForAppResolve = null;
  let waitForAppReject = null;
  let waitForAppTimer = null;

  const ws = new WebSocket(url);

  function close() {
    for (const [requestId, callback] of pending.entries()) {
      clearTimeout(callback.timer);
      callback.reject(new Error(`Connection closed before request ${requestId} completed.`));
    }
    pending.clear();
    if (waitForAppReject) waitForAppReject(new Error('Connection closed before Photoshop connected.'));
    if (waitForAppTimer) clearTimeout(waitForAppTimer);
    ws.close();
  }

  function waitForOpen() {
    if (ws.readyState === WebSocket.OPEN) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Timed out connecting to ${url}.`)), timeoutMs);
      ws.once('open', () => {
        clearTimeout(timer);
        resolve();
      });
      ws.once('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
  }

  function matchesApp(message) {
    const app = message?.app || {};
    if (!appId) return true;
    return String(app.appId || '').toUpperCase() === String(appId).toUpperCase();
  }

  function waitForApp() {
    if (appClient) return Promise.resolve(appClient);
    return new Promise((resolve, reject) => {
      waitForAppResolve = resolve;
      waitForAppReject = reject;
      waitForAppTimer = setTimeout(() => {
        waitForAppResolve = null;
        waitForAppReject = null;
        reject(new Error(`Timed out waiting for ${appId || 'host app'} on UXP Developer Tools service.`));
      }, timeoutMs);
    });
  }

  function request(message, requestTimeoutMs = timeoutMs) {
    const requestId = ++nextRequestId;
    const payload = { ...message, requestId };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(requestId);
        reject(new Error(`Timed out waiting for request ${requestId}.`));
      }, requestTimeoutMs);
      pending.set(requestId, { resolve, reject, timer });
      ws.send(JSON.stringify(payload));
    });
  }

  ws.on('message', (buffer) => {
    const message = JSON.parse(String(buffer));
    if (message.command === 'didAddRuntimeClient' && matchesApp(message)) {
      appClient = message;
      if (waitForAppResolve) {
        clearTimeout(waitForAppTimer);
        waitForAppResolve(message);
        waitForAppResolve = null;
        waitForAppReject = null;
      }
      return;
    }

    if (message.command === 'reply' && message.requestId) {
      const callback = pending.get(message.requestId);
      if (!callback) return;
      clearTimeout(callback.timer);
      pending.delete(message.requestId);
      if (message.error) {
        callback.reject(new Error(message.error));
      } else {
        callback.resolve(message);
      }
    }
  });

  ws.on('close', () => {
    for (const [requestId, callback] of pending.entries()) {
      clearTimeout(callback.timer);
      callback.reject(new Error(`Connection closed before request ${requestId} completed.`));
    }
    pending.clear();
  });

  return {
    close,
    waitForOpen,
    waitForApp,
    request
  };
}

async function loadPlugin(options = {}) {
  const manifestPath = normalizeManifestPath(options.manifestPath || DEFAULT_MANIFEST);
  const manifest = readManifest(manifestPath);
  const pluginFolder = path.dirname(manifestPath);
  const port = parsePositiveInteger(options.port, DEFAULT_PORT);
  const timeoutMs = parsePositiveInteger(options.timeoutMs, DEFAULT_TIMEOUT_MS);
  const appId = options.appId || 'PS';
  const client = createDevtoolsClient({ port, timeoutMs, appId });

  try {
    await client.waitForOpen();
    const appClient = await client.waitForApp();
    const validate = await client.request({
      command: 'proxy',
      clientId: appClient.id,
      message: {
        command: 'Plugin',
        action: 'validate',
        params: {
          provider: {
            type: 'disk',
            path: pluginFolder
          }
        },
        manifest
      }
    });

    const load = await client.request({
      command: 'proxy',
      clientId: appClient.id,
      message: {
        command: 'Plugin',
        action: 'load',
        params: {
          provider: {
            type: 'disk',
            path: pluginFolder
          }
        },
        breakOnStart: false,
        isPlaygroundPlugin: false
      }
    });

    return {
      success: true,
      app: appClient.app,
      manifestPath,
      pluginFolder,
      pluginId: manifest.id || null,
      pluginName: manifest.name || null,
      validate: {
        success: validate.success === true
      },
      load: {
        pluginSessionId: load.pluginSessionId || null
      },
      bridge: options.waitForBridge
        ? await waitForBridgeReady({
          timeoutMs: options.bridgeTimeoutMs,
          pollMs: options.bridgePollMs
        })
        : null
    };
  } finally {
    client.close();
  }
}

function runSelfTest() {
  const rootRelativeManifest = normalizeManifestPath('../DesignEcho-UXP/manifest.json');
  if (!rootRelativeManifest.endsWith(path.join('DesignEcho-UXP', 'manifest.json'))) {
    throw new Error(`Unexpected manifest normalization: ${rootRelativeManifest}`);
  }
  if (classifyLoadError(new Error('Plugin load timed out.')) !== 'load_timeout') {
    throw new Error('Timeout load errors must be classified.');
  }
  if (classifyLoadError(new Error('connect ECONNREFUSED 127.0.0.1:14001')) !== 'devtools_service_unavailable') {
    throw new Error('Devtools connection errors must be classified.');
  }
  if (classifyLoadError(new Error('Bridge did not become ready after plugin load.')) !== 'bridge_not_ready') {
    throw new Error('Bridge wait errors must be classified.');
  }
  if (buildRecoveryActions('load_timeout').length < 2) {
    throw new Error('Timeout recovery actions must be actionable.');
  }
  console.log(JSON.stringify({
    success: true,
    checks: [
      'default manifest path resolves to sibling DesignEcho-UXP manifest',
      'load timeout is classified',
      'devtools service connection error is classified',
      'bridge wait error is classified',
      'recovery actions are available'
    ]
  }, null, 2));
}

async function main() {
  if (process.argv.includes('--self-test')) {
    runSelfTest();
    return;
  }

  const manifestPath = getArgValue('--manifest', DEFAULT_MANIFEST);
  const port = parsePositiveInteger(getArgValue('--port', DEFAULT_PORT), DEFAULT_PORT);
  const timeoutMs = parsePositiveInteger(getArgValue('--timeout-ms', DEFAULT_TIMEOUT_MS), DEFAULT_TIMEOUT_MS);
  const waitForBridge = process.argv.includes('--wait-for-bridge');
  const bridgeTimeoutMs = parsePositiveInteger(
    getArgValue('--bridge-timeout-ms', DEFAULT_BRIDGE_WAIT_TIMEOUT_MS),
    DEFAULT_BRIDGE_WAIT_TIMEOUT_MS
  );
  const bridgePollMs = parsePositiveInteger(
    getArgValue('--bridge-poll-ms', DEFAULT_BRIDGE_POLL_MS),
    DEFAULT_BRIDGE_POLL_MS
  );

  try {
    const result = await loadPlugin({
      manifestPath,
      port,
      timeoutMs,
      waitForBridge,
      bridgeTimeoutMs,
      bridgePollMs
    });
    if (waitForBridge && result.bridge?.ready !== true) {
      throw new Error(`Bridge did not become ready after plugin load. Last status: ${JSON.stringify(result.bridge?.status || null)}`);
    }
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    const classification = classifyLoadError(error);
    console.error(JSON.stringify({
      success: false,
      classification,
      error: error instanceof Error ? error.message : String(error),
      recoveryActions: buildRecoveryActions(classification)
    }, null, 2));
    process.exit(1);
  }
}

main();
