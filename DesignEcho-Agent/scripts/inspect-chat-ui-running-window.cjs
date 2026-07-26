#!/usr/bin/env node
"use strict";

const fs = require("fs");
const http = require("http");
const path = require("path");
const assert = require("assert");
const { spawnSync } = require("child_process");
const { chromium } = require("playwright");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_CDP_PORT = 9223;
const LAST_LAUNCH_PATH = path.join(ROOT, "tmp", "chat-ui-debug-window-last-launch.json");
const OUT_DIR = path.join(ROOT, "tmp", "running-window-chat");
const REPORT_JSON = path.join(OUT_DIR, "running-window-chat-report.json");
const REPORT_MD = path.join(OUT_DIR, "running-window-chat-report.md");
const DEFAULT_MCP_ENDPOINT = process.env.MCP_ENDPOINT || "http://127.0.0.1:8768/mcp";
const PROMPT_KINDS = new Set(["custom", "conversation", "read_only", "execution"]);
const DEFAULT_RUNTIME_PORTS = [
  { label: "Agent WebSocket bridge", port: 8765 },
  { label: "Agent WebView server", port: 8766 },
  { label: "Agent debug bridge", port: 8767 },
  { label: "Agent MCP host", port: 8768 }
];

const DEFAULT_SAFE_CASES = [
  {
    id: "sku-capability",
    prompt: "你会做SKU吗",
    kind: "conversation",
    assertions: {
      noTools: true,
      noCannedCapabilityMenu: true,
      noInternalStatus: true
    }
  },
  {
    id: "sku-no-tool-directive",
    prompt: "只说明理解，不执行工具：帮我做 SKU",
    kind: "conversation",
    assertions: {
      noTools: true,
      noCannedCapabilityMenu: true,
      noInternalStatus: true
    }
  },
  {
    id: "capability-overview",
    prompt: "你可以做什么？",
    kind: "conversation",
    assertions: {
      noTools: true,
      noCannedCapabilityMenu: true,
      noInternalStatus: true
    }
  },
  {
    id: "project-identity-readonly",
    prompt: "当前是什么项目？",
    kind: "read_only",
    assertions: {
      noCannedCapabilityMenu: true,
      noInternalStatus: true,
      requiresProjectInventorySummary: true,
      noNoImageInventoryBlocker: true
    }
  },
  {
    id: "project-inventory-readonly",
    prompt: "你可以帮我看看这个项目都有什么",
    kind: "read_only",
    assertions: {
      noCannedCapabilityMenu: true,
      noInternalStatus: true,
      requiresProjectInventorySummary: true,
      noNoImageInventoryBlocker: true
    }
  }
];

const EXECUTION_CASES = [
  {
    id: "sku-execution",
    prompt: "帮我做 SKU",
    kind: "execution",
    assertions: {
      noCannedCapabilityMenu: true,
      noInternalStatus: true
    }
  },
  {
    id: "sku-note-only-execution",
    prompt: "我还需要对应的 SKU 自选备注",
    kind: "execution",
    assertions: {
      noCannedCapabilityMenu: true,
      noInternalStatus: true
    }
  }
];

function usage() {
  return [
    "Usage: node scripts/inspect-chat-ui-running-window.cjs [--port 9223|last|auto] [--allow-execution] [--allow-unavailable-skip] [--preserve-conversation] [--prompt <text>] [--prompt-kind custom|conversation|read_only|execution] [--mcp-endpoint <url>] [--require-running-window-bridge-connected] [--require-default-mcp-connected] [--require-bridge-match] [--c1163-sku-e2e]",
    "",
    "Attaches to an already running DesignEcho Electron window through Chromium CDP.",
    "It never launches or closes Electron. The window must be started with DESIGNECHO_CHAT_TEST_BRIDGE=1 and DESIGNECHO_REMOTE_DEBUGGING_PORT=<port>.",
    `Use --port last to require ${LAST_LAUNCH_PATH}; use --port auto to read it when available and fall back to ${DEFAULT_CDP_PORT}.`,
    "",
    "Examples:",
    "  node scripts/inspect-chat-ui-running-window.cjs --port 9223",
    "  node scripts/inspect-chat-ui-running-window.cjs --port auto",
    "  node scripts/inspect-chat-ui-running-window.cjs --port 9223 --allow-execution",
    "  node scripts/inspect-chat-ui-running-window.cjs --port 9223 --require-running-window-bridge-connected --require-default-mcp-connected --require-bridge-match",
    "  node scripts/inspect-chat-ui-running-window.cjs --port 9223 --c1163-sku-e2e --timeout-ms 180000"
  ].join("\n");
}

function isValidCdpPort(port) {
  return Number.isInteger(port) && port >= 1024 && port <= 65535;
}

function readLastLaunchPort(lastLaunchPath = LAST_LAUNCH_PATH) {
  try {
    const raw = fs.readFileSync(lastLaunchPath, "utf8");
    const launch = JSON.parse(raw);
    const port = Number(launch?.port);
    if (!isValidCdpPort(port)) {
      throw new Error('expected "port" to be an integer between 1024 and 65535');
    }
    return port;
  } catch (error) {
    throw new Error(`Cannot resolve --port last from ${lastLaunchPath}: ${error?.message || String(error)}`);
  }
}

function resolvePort(value, options = {}) {
  const raw = String(value || "").trim();
  if (raw === "last") {
    return readLastLaunchPort(options.lastLaunchPath);
  }
  if (raw === "auto") {
    try {
      return readLastLaunchPort(options.lastLaunchPath);
    } catch {
      return DEFAULT_CDP_PORT;
    }
  }
  return Number.parseInt(value, 10);
}

function parseArgs(argv, options = {}) {
  const parsed = {
    port: DEFAULT_CDP_PORT,
    allowExecution: false,
    allowUnavailableSkip: false,
    prompts: [],
    promptKind: "custom",
    preserveConversation: false,
    mcpEndpoint: DEFAULT_MCP_ENDPOINT,
    requireRunningWindowBridgeConnected: false,
    requireDefaultMcpConnected: false,
    requireBridgeMatch: false,
    c1163SkuE2e: false,
    timeoutMs: 30000,
    selfTest: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      console.log(usage());
      process.exit(0);
    }
    if (arg === "--self-test") {
      parsed.selfTest = true;
      continue;
    }
    if (arg === "--port") {
      parsed.port = resolvePort(argv[index + 1], options);
      index += 1;
      continue;
    }
    if (arg.startsWith("--port=")) {
      parsed.port = resolvePort(arg.slice("--port=".length), options);
      continue;
    }
    if (arg === "--timeout-ms") {
      parsed.timeoutMs = Number.parseInt(argv[index + 1], 10);
      index += 1;
      continue;
    }
    if (arg.startsWith("--timeout-ms=")) {
      parsed.timeoutMs = Number.parseInt(arg.slice("--timeout-ms=".length), 10);
      continue;
    }
    if (arg === "--allow-execution") {
      parsed.allowExecution = true;
      continue;
    }
    if (arg === "--preserve-conversation") {
      parsed.preserveConversation = true;
      continue;
    }
    if (arg === "--require-running-window-bridge-connected") {
      parsed.requireRunningWindowBridgeConnected = true;
      continue;
    }
    if (arg === "--require-default-mcp-connected") {
      parsed.requireDefaultMcpConnected = true;
      continue;
    }
    if (arg === "--require-bridge-match") {
      parsed.requireBridgeMatch = true;
      continue;
    }
    if (arg === "--c1163-sku-e2e") {
      parsed.c1163SkuE2e = true;
      parsed.allowExecution = true;
      parsed.promptKind = "execution";
      continue;
    }
    if (arg === "--fail-if-unavailable") {
      parsed.allowUnavailableSkip = false;
      continue;
    }
    if (arg === "--allow-unavailable-skip") {
      parsed.allowUnavailableSkip = true;
      continue;
    }
    if (arg === "--prompt") {
      parsed.prompts.push(argv[index + 1] || "");
      index += 1;
      continue;
    }
    if (arg.startsWith("--prompt=")) {
      parsed.prompts.push(arg.slice("--prompt=".length));
      continue;
    }
    if (arg === "--prompt-kind") {
      parsed.promptKind = argv[index + 1] || "";
      index += 1;
      continue;
    }
    if (arg.startsWith("--prompt-kind=")) {
      parsed.promptKind = arg.slice("--prompt-kind=".length);
      continue;
    }
    if (arg === "--mcp-endpoint") {
      parsed.mcpEndpoint = argv[index + 1] || "";
      index += 1;
      continue;
    }
    if (arg.startsWith("--mcp-endpoint=")) {
      parsed.mcpEndpoint = arg.slice("--mcp-endpoint=".length);
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!isValidCdpPort(parsed.port)) {
    throw new Error("--port must be an integer between 1024 and 65535.");
  }
  if (!Number.isInteger(parsed.timeoutMs) || parsed.timeoutMs < 1000) {
    throw new Error("--timeout-ms must be an integer greater than 1000.");
  }
  if (!PROMPT_KINDS.has(parsed.promptKind)) {
    throw new Error("--prompt-kind must be one of custom, conversation, read_only, execution.");
  }
  if (parsed.promptKind === "execution") {
    parsed.allowExecution = true;
  }
  if (!parsed.mcpEndpoint || !/^https?:\/\//.test(parsed.mcpEndpoint)) {
    throw new Error("--mcp-endpoint must be an http(s) URL.");
  }

  return parsed;
}

function ensureOutDir() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
}

function fetchJson(url, timeoutMs = 1500) {
  return new Promise((resolve, reject) => {
    const request = http.get(url, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        body += chunk;
      });
      response.on("end", () => {
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(`HTTP ${response.statusCode}: ${body.slice(0, 200)}`));
          return;
        }
        try {
          resolve(JSON.parse(body));
        } catch (error) {
          reject(error);
        }
      });
    });
    request.setTimeout(timeoutMs, () => {
      request.destroy(new Error(`Timed out requesting ${url}`));
    });
    request.on("error", reject);
  });
}

async function closeBrowserConnection(browser, timeoutMs = 2500) {
  if (!browser) return;
  let timedOut = false;
  await Promise.race([
    browser.close().catch(() => undefined),
    new Promise((resolve) => {
      setTimeout(() => {
        timedOut = true;
        resolve(undefined);
      }, timeoutMs);
    })
  ]);
  if (timedOut) {
    // CDP detach can hang against a long-lived Electron app; inspection must still finish.
    try {
      const closeResult = browser._connection?.close?.();
      if (closeResult && typeof closeResult.catch === "function") {
        void closeResult.catch(() => undefined);
      }
    } catch {
      // Best-effort detach only; the inspection result has already been produced.
    }
  }
}

function withTimeout(promise, timeoutMs, label) {
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

const TEXT_MODEL_API_KEY_TYPES = [
  "xiaomi",
  "google",
  "openrouter",
  "openai",
  "gptsapi",
  "deepseek",
  "ollamaApiKey",
  "anthropic"
];

function toApiKeyPresence(apiKeys) {
  return Object.fromEntries(
    Object.entries(apiKeys || {}).map(([key, value]) => [
      key,
      typeof value === "string"
        ? {
          present: value.trim().length > 0,
          length: value.trim().length
        }
        : {
          present: Boolean(value),
          type: typeof value
        }
    ])
  );
}

function summarizeRuntimeModelReadinessFromState(state) {
  const modelPreferences = state?.modelPreferences && typeof state.modelPreferences === "object"
    ? state.modelPreferences
    : {};
  const apiKeyPresence = state?.apiKeyPresence && typeof state.apiKeyPresence === "object"
    ? state.apiKeyPresence
    : toApiKeyPresence(state?.apiKeys || {});
  const configuredTextProviders = TEXT_MODEL_API_KEY_TYPES
    .filter((key) => Boolean(apiKeyPresence?.[key]?.present));
  const hasConfiguredTextProvider = configuredTextProviders.length > 0;

  return {
    mode: String(modelPreferences.mode || ""),
    preferredCloudModels: modelPreferences.preferredCloudModels || {},
    preferredLocalModels: modelPreferences.preferredLocalModels || {},
    hasConfiguredTextProvider,
    configuredTextProviders,
    apiKeyPresence,
    diagnostic: hasConfiguredTextProvider
      ? `Text model providers are configured in this running window: ${configuredTextProviders.join(", ")}. If conversation is still unavailable, inspect provider auth/network logs.`
      : "This running debug window has no configured text model provider keys. Launch with launch-chat-ui-debug-window.cjs --seed-user-state, configure model settings, or use --fake-model only for fixture validation."
  };
}

function buildModelUnavailableCaseReason(modelReadiness) {
  if (!modelReadiness) {
    return "the running window returned an explicit model-unavailable status notice; this is not counted as model-authored conversation";
  }
  if (modelReadiness.hasConfiguredTextProvider === false) {
    return "the running window returned model-unavailable because this debug window has no configured text model provider keys; launch with --seed-user-state for a real-provider validation";
  }
  return `the running window returned model-unavailable even though provider settings are present; ${modelReadiness.diagnostic}`;
}

function parseMcpToolResult(result) {
  const text = result?.content?.[0]?.text || "";
  try {
    const parsed = JSON.parse(text);
    if (typeof parsed !== "string") return parsed;
    try {
      return JSON.parse(parsed);
    } catch {
      return parsed;
    }
  } catch {
    return text;
  }
}

async function callMcpTool(endpoint, name, args = {}, timeoutMs = 1500) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: Date.now() + Math.random(),
        method: "tools/call",
        params: {
          name,
          arguments: args
        }
      })
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const payload = await response.json();
    if (payload.error) {
      throw new Error(JSON.stringify(payload.error));
    }
    return parseMcpToolResult(payload.result);
  } finally {
    clearTimeout(timeout);
  }
}

async function readDefaultMcpBridgeReadiness(endpoint = DEFAULT_MCP_ENDPOINT, timeoutMs = 1500) {
  try {
    const status = await callMcpTool(endpoint, "system.status", {}, timeoutMs);
    const diagnostics = status?.pluginConnectionDiagnostics || null;
    return {
      endpoint,
      ok: true,
      pluginConnected: status?.pluginConnected === true,
      pluginConnectionState: status?.pluginConnectionState || null,
      diagnostics
    };
  } catch (error) {
    return {
      endpoint,
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

function readLastLaunchSummary(lastLaunchPath = LAST_LAUNCH_PATH) {
  try {
    const raw = fs.readFileSync(lastLaunchPath, "utf8");
    const parsed = JSON.parse(raw);
    return {
      path: lastLaunchPath,
      exists: true,
      generatedAt: parsed?.generatedAt || null,
      port: Number.isInteger(Number(parsed?.port)) ? Number(parsed.port) : null,
      cdpEndpoint: parsed?.cdpEndpoint || null,
      portOffset: Number.isInteger(Number(parsed?.portOffset)) ? Number(parsed.portOffset) : null,
      useDefaultRuntimePorts: parsed?.useDefaultRuntimePorts === true,
      pid: parsed?.pid || null
    };
  } catch (error) {
    return {
      path: lastLaunchPath,
      exists: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

function readPortOwnerSummary(port) {
  if (process.platform !== "win32") return "";
  const numericPort = Number(port);
  if (!Number.isInteger(numericPort) || numericPort <= 0) return "";
  const command = [
    `$items = Get-NetTCPConnection -LocalPort ${numericPort} -ErrorAction SilentlyContinue | Select-Object -First 8 LocalAddress,LocalPort,State,OwningProcess;`,
    "$rows = foreach ($item in $items) {",
    "  $proc = Get-Process -Id $item.OwningProcess -ErrorAction SilentlyContinue;",
    "  $cmd = $null;",
    "  try { $cmd = (Get-CimInstance Win32_Process -Filter \"ProcessId=$($item.OwningProcess)\" -ErrorAction SilentlyContinue).CommandLine } catch {}",
    "  [PSCustomObject]@{ LocalAddress=$item.LocalAddress; LocalPort=$item.LocalPort; State=$item.State.ToString(); OwningProcess=$item.OwningProcess; ProcessName=$proc.ProcessName; Path=$proc.Path; CommandLine=$cmd }",
    "};",
    "$rows | ConvertTo-Json -Compress"
  ].join(" ");
  const result = spawnSync("powershell.exe", ["-NoProfile", "-Command", command], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 3000
  });
  if (result.status !== 0 || !String(result.stdout || "").trim()) return "";
  try {
    const parsed = JSON.parse(String(result.stdout).trim());
    const rows = Array.isArray(parsed) ? parsed : [parsed];
    const owners = [];
    const seen = new Set();
    for (const row of rows) {
      const key = `${row.OwningProcess}:${row.ProcessName || ""}:${row.Path || ""}:${row.CommandLine || ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      owners.push({
        pid: row.OwningProcess || null,
        processName: row.ProcessName || null,
        path: row.Path || null,
        commandLine: row.CommandLine || null
      });
    }
    return owners;
  } catch {
    return String(result.stdout).trim().replace(/\s+/g, " ");
  }
}

function readDefaultRuntimePortDiagnostics() {
  return DEFAULT_RUNTIME_PORTS.map((item) => {
    const owners = readPortOwnerSummary(item.port);
    return {
      ...item,
      occupied: Array.isArray(owners) ? owners.length > 0 : Boolean(owners),
      owners
    };
  });
}

function hasBusyDefaultRuntimePorts(portDiagnostics) {
  return Array.isArray(portDiagnostics) && portDiagnostics.some((item) => item.occupied);
}

function formatPortOwnerForReason(item) {
  const owners = Array.isArray(item.owners) ? item.owners : [];
  if (owners.length === 0) return `${item.port}`;
  const owner = owners[0];
  const command = String(owner.commandLine || "");
  const hasDebugBridge = /DESIGNECHO_CHAT_TEST_BRIDGE|DESIGNECHO_REMOTE_DEBUGGING_PORT/i.test(command);
  const mode = hasDebugBridge ? "debug/test bridge" : "normal runtime";
  return `${item.port} by PID ${owner.pid || "unknown"} ${owner.processName || "unknown"} (${mode})`;
}

function buildUnavailableWindowReason(parsed, diagnostics) {
  const parts = [
    `No running DesignEcho debug window was reachable on http://127.0.0.1:${parsed.port}.`
  ];
  const lastLaunch = diagnostics?.lastLaunch;
  if (lastLaunch?.exists) {
    parts.push(`Last launch record points to port ${lastLaunch.port || "unknown"}${lastLaunch.useDefaultRuntimePorts ? " with default runtime ports" : ""}.`);
  }
  const busyDefaultPorts = (diagnostics?.defaultRuntimePorts || []).filter((item) => item.occupied);
  if (busyDefaultPorts.length > 0) {
    parts.push(`Default runtime ports are occupied: ${busyDefaultPorts.map(formatPortOwnerForReason).join("; ")}.`);
  }
  if (diagnostics?.defaultMcpBridge?.ok === true) {
    parts.push(`Default MCP bridge is ${diagnostics.defaultMcpBridge.pluginConnected ? "connected to Photoshop" : "reachable but not connected to Photoshop"}.`);
  }
  return parts.join(" ");
}

function buildUnavailableWindowNextActions(diagnostics) {
  const busyDefaultPorts = hasBusyDefaultRuntimePorts(diagnostics?.defaultRuntimePorts);
  const actions = [
    "Do not count this as ChatPanel E2E passed; the script could not attach to a debuggable ChatPanel window."
  ];
  if (busyDefaultPorts) {
    actions.push("The normal default runtime ports are already occupied. Get user approval before closing or restarting that runtime.");
    actions.push("For default-MCP validation, restart the same Agent runtime with DESIGNECHO_CHAT_TEST_BRIDGE=1 and DESIGNECHO_REMOTE_DEBUGGING_PORT, or intentionally launch npm run dev:chat-ui:debug-window:default-mcp after the ports are free.");
  } else {
    actions.push("Launch a debuggable window with npm run dev:chat-ui:debug-window:default-mcp, then rerun npm run smoke:chat-ui:running-window:default-mcp-required.");
  }
  if (diagnostics?.lastLaunch?.exists) {
    actions.push("If tmp/chat-ui-debug-window-last-launch.json points to an old port, launch a fresh debug window so --port last resolves to the current runtime.");
  }
  return actions;
}

async function buildUnavailableWindowDiagnostics(parsed) {
  const lastLaunch = readLastLaunchSummary();
  const defaultRuntimePorts = readDefaultRuntimePortDiagnostics();
  const defaultMcpBridge = await readDefaultMcpBridgeReadiness(parsed.mcpEndpoint);
  const diagnostics = {
    lastLaunch,
    defaultRuntimePorts,
    defaultMcpBridge
  };
  return {
    ...diagnostics,
    reason: buildUnavailableWindowReason(parsed, diagnostics),
    nextActions: buildUnavailableWindowNextActions(diagnostics)
  };
}

async function readRunningWindowBridgeReadiness(page) {
  return page.evaluate(async () => {
    if (!window.designEcho?.getConnectionStatus) {
      return {
        ok: false,
        source: "running-window-ipc",
        error: "window.designEcho.getConnectionStatus is unavailable"
      };
    }
    try {
      const status = await window.designEcho.getConnectionStatus();
      return {
        ok: true,
        source: "running-window-ipc",
        connected: status?.connected === true,
        diagnostics: status?.diagnostics || null
      };
    } catch (error) {
      return {
        ok: false,
        source: "running-window-ipc",
        error: error instanceof Error ? error.message : String(error)
      };
    }
  });
}

function buildBridgeRuntimeMismatch(runningWindowBridge, defaultMcpBridge) {
  if (!runningWindowBridge || !defaultMcpBridge) return "";
  if (runningWindowBridge.ok !== true || defaultMcpBridge.ok !== true) return "";
  if (runningWindowBridge.connected === false && defaultMcpBridge.pluginConnected === true) {
    return "The inspected Electron window is not connected to Photoshop, but the default MCP bridge is connected. This usually means the CDP window is an isolated debug runtime, not the currently connected Agent host.";
  }
  if (runningWindowBridge.connected === true && defaultMcpBridge.pluginConnected === false) {
    return "The inspected Electron window reports Photoshop connected, but the default MCP bridge is disconnected. Check whether multiple Agent runtimes are using different port blocks.";
  }
  return "";
}

function buildBridgeRequirementFailures(parsed, runningWindowBridge, defaultMcpBridge, bridgeRuntimeMismatch) {
  const failures = [];
  if (parsed.requireRunningWindowBridgeConnected) {
    if (!runningWindowBridge || runningWindowBridge.ok !== true) {
      failures.push(`running window bridge unavailable: ${runningWindowBridge?.error || "unknown error"}`);
    } else if (runningWindowBridge.connected !== true) {
      failures.push("running window bridge is not connected to Photoshop");
    }
  }

  if (parsed.requireDefaultMcpConnected) {
    if (!defaultMcpBridge || defaultMcpBridge.ok !== true) {
      failures.push(`default MCP bridge unavailable: ${defaultMcpBridge?.error || "unknown error"}`);
    } else if (defaultMcpBridge.pluginConnected !== true) {
      failures.push("default MCP bridge is not connected to Photoshop");
    }
  }

  if (parsed.requireBridgeMatch) {
    if (!runningWindowBridge || runningWindowBridge.ok !== true || !defaultMcpBridge || defaultMcpBridge.ok !== true) {
      failures.push("cannot verify bridge match because one of the bridge status reads is unavailable");
    } else if (Boolean(runningWindowBridge.connected) !== Boolean(defaultMcpBridge.pluginConnected)) {
      failures.push(bridgeRuntimeMismatch || "running window bridge status does not match the default MCP bridge status");
    }
  }

  return failures;
}

function shouldSkipPromptCasesForBridgeRequirementFailures(parsed, bridgeRequirementFailures) {
  return bridgeRequirementFailures.length > 0
    && (
      parsed.requireRunningWindowBridgeConnected
      || parsed.requireDefaultMcpConnected
      || parsed.requireBridgeMatch
    );
}

function buildSkippedCasesForBridgeRequirementFailures(parsed, reason) {
  return buildCases(parsed).map((testCase) => ({
    id: testCase.id,
    prompt: testCase.prompt,
    kind: testCase.kind,
    status: "skipped",
    reason
  }));
}

function didRunPromptCases(cases) {
  return Array.isArray(cases) && cases.some((item) => item.status !== "skipped");
}

async function readRuntimeModelReadiness(page) {
  const state = await page.evaluate(() => {
    function maskApiKeys(apiKeys) {
      return Object.fromEntries(
        Object.entries(apiKeys || {}).map(([key, value]) => [
          key,
          typeof value === "string"
            ? {
              present: value.trim().length > 0,
              length: value.trim().length
            }
            : {
              present: Boolean(value),
              type: typeof value
            }
        ])
      );
    }

    const raw = localStorage.getItem("designecho-storage");
    let parsed = null;
    try {
      parsed = raw ? JSON.parse(raw) : null;
    } catch (error) {
      return {
        storageRawLength: raw ? raw.length : 0,
        parseError: String(error)
      };
    }

    const state = parsed?.state || parsed || {};
    return {
      storageRawLength: raw ? raw.length : 0,
      modelPreferences: state.modelPreferences || null,
      apiKeyPresence: maskApiKeys(state.apiKeys || {})
    };
  });

  return {
    ...summarizeRuntimeModelReadinessFromState(state),
    storageRawLength: state.storageRawLength || 0,
    ...(state.parseError ? { parseError: state.parseError } : {})
  };
}

function writeReports(result) {
  ensureOutDir();
  fs.writeFileSync(REPORT_JSON, JSON.stringify(result, null, 2), "utf8");
  const lines = [
    "# Running Chat Window Inspection",
    "",
    `- success: ${result.success}`,
    `- skipped: ${Boolean(result.skipped)}`,
    result.reason ? `- reason: ${result.reason}` : "",
    `- report: ${REPORT_JSON}`,
    result.modelReadiness?.diagnostic ? `- modelReadiness: ${result.modelReadiness.diagnostic}` : "",
    result.runningWindowBridge
      ? `- runningWindowBridge: ${result.runningWindowBridge.ok ? (result.runningWindowBridge.connected ? "connected" : "disconnected") : "unavailable"}`
      : "",
    result.defaultMcpBridge
      ? `- defaultMcpBridge: ${result.defaultMcpBridge.ok ? (result.defaultMcpBridge.pluginConnected ? "connected" : "disconnected") : "unavailable"}`
      : "",
    result.bridgeRuntimeMismatch ? `- bridgeRuntimeMismatch: ${result.bridgeRuntimeMismatch}` : "",
    result.failures?.length ? `- failures: ${result.failures.length}` : "",
    ...(result.failures || []).map((failure) => `  - ${failure}`),
    result.windowReadinessDiagnostics?.reason ? `- windowReadiness: ${result.windowReadinessDiagnostics.reason}` : "",
    result.windowReadinessDiagnostics?.nextActions?.length ? "- nextActions:" : "",
    ...(result.windowReadinessDiagnostics?.nextActions || []).map((action) => `  - ${action}`),
    "",
    "## Cases",
    ...(result.cases || []).map((item) => [
      `- ${item.id}: ${item.status}`,
      item.prompt ? `  - prompt: ${item.prompt}` : "",
      item.assistantReplyOrigins?.length ? `  - assistantReplyOrigins: ${item.assistantReplyOrigins.join(", ")}` : "",
      item.visibleTextPreview ? `  - visible: ${item.visibleTextPreview}` : "",
      item.screenshotPath ? `  - screenshot: ${item.screenshotPath}` : "",
      item.reason ? `  - reason: ${item.reason}` : ""
    ].filter(Boolean).join("\n")),
    "",
    "## Checks",
    ...(result.checks || []).map((check) => `- ${check}`)
  ].filter(Boolean);
  fs.writeFileSync(REPORT_MD, lines.join("\n"), "utf8");
}

function buildRunningWindowInspectionResult({
  parsed,
  pageInfo,
  modelReadiness,
  runningWindowBridge,
  defaultMcpBridge,
  bridgeRuntimeMismatch,
  bridgeRequirementFailures,
  cases,
  hasMountedTestBridge,
  inProgress = false
}) {
  const failedCases = cases.filter((item) => item.status === "failed");
  const promptCasesRan = didRunPromptCases(cases);
  return {
    success: !inProgress && failedCases.length === 0 && bridgeRequirementFailures.length === 0,
    skipped: false,
    inProgress,
    cdpEndpoint: `http://127.0.0.1:${parsed.port}`,
    page: pageInfo,
    modelReadiness,
    runningWindowBridge,
    defaultMcpBridge,
    bridgeRuntimeMismatch,
    failures: bridgeRequirementFailures,
    cases,
    checks: [
      "attached to an already running DesignEcho Electron window",
      hasMountedTestBridge
        ? "used the mounted ChatPanel test bridge instead of launching a disposable smoke window"
        : "used the live ChatPanel DOM fallback because the running window has no test bridge",
      hasMountedTestBridge
        ? "recorded the current Electron window Photoshop bridge status"
        : "could not read per-window bridge status without the test bridge; checked the default MCP bridge separately",
      "compared the current window bridge with the default MCP Photoshop bridge",
      ...(parsed.requireRunningWindowBridgeConnected ? ["required the current Electron window bridge to be connected"] : []),
      ...(parsed.requireDefaultMcpConnected ? ["required the default MCP bridge to be connected"] : []),
      ...(parsed.requireBridgeMatch ? ["required the current Electron window bridge to match the default MCP bridge"] : []),
      ...(bridgeRuntimeMismatch ? ["reported a bridge-runtime mismatch instead of treating the default MCP state as the inspected window state"] : []),
      ...(promptCasesRan
        ? [
          "captured an Agent window screenshot after each submitted case",
          "checked chat DOM horizontal overflow after expanding rendered detail blocks",
          "checked visible replies for internal status/tool-call leakage"
        ]
        : [
          "skipped prompt cases because running-window bridge requirements failed before user-message submission"
        ]),
      !hasMountedTestBridge
        ? "DOM fallback cannot inspect assistantReplyOrigin metadata; it verifies visible behavior only"
        : pageInfo.hasFakeModel
        ? "classified conversational replies as fake-model test fixtures, not production model speech"
        : "required conversational replies to come from the production model/repaired-model path",
      parsed.allowExecution
        ? "execution prompts were explicitly allowed by --allow-execution"
        : "execution prompts were not sent without --allow-execution",
      ...(inProgress ? ["incrementally wrote this report after the latest completed case"] : [])
    ]
  };
}

async function captureBoundedViewportScreenshot(page, screenshotPath, timeoutMs = 8000) {
  try {
    await page.screenshot({
      path: screenshotPath,
      fullPage: false,
      timeout: timeoutMs,
      animations: "disabled",
      caret: "hide"
    });
    return { captured: true, method: "playwright" };
  } catch (playwrightError) {
    try {
      const session = await page.context().newCDPSession(page);
      try {
        const result = await session.send("Page.captureScreenshot", {
          format: "png",
          captureBeyondViewport: false,
          fromSurface: true
        });
        fs.writeFileSync(screenshotPath, Buffer.from(result.data, "base64"));
        return { captured: true, method: "cdp", fallbackFrom: "playwright", fallbackError: String(playwrightError?.message || playwrightError) };
      } finally {
        await session.detach().catch(() => undefined);
      }
    } catch (cdpError) {
      return {
        captured: false,
        method: "failed",
        error: `playwright screenshot failed: ${playwrightError?.message || String(playwrightError)}; cdp screenshot failed: ${cdpError?.message || String(cdpError)}`
      };
    }
  }
}

function messagesText(messages) {
  return messages.map((message) => {
    const visible = String(message.visibleTextPreview || "").replace(/\s+/g, " ").trim();
    const content = String(message.contentPreview || "").replace(/\s+/g, " ").trim();
    const normalizedVisible = normalizeVisibleTextForComparison(visible);
    const values = [
      visible,
      content && !normalizedVisible.includes(normalizeVisibleTextForComparison(content)) ? content : ""
    ].filter(Boolean);
    const unique = [];
    for (const value of values) {
      if (!unique.includes(value)) unique.push(value);
    }
    return unique.join(" ");
  }).filter(Boolean).join("\n");
}

function assistantMessagesText(messages) {
  return messagesText((messages || []).filter((message) => message.role === "assistant"));
}

function hasSubmittedUserMessage(messages) {
  return (messages || []).some((message) =>
    message.role === "user" && Boolean(String(message.contentPreview || message.visibleTextPreview || "").trim())
  );
}

function normalizeVisibleTextForComparison(value) {
  return String(value || "")
    .replace(/^[\s⚠️❌✅!！i]+/, "")
    .replace(/^(?:错误|Error)\s*[:：]\s*/i, "")
    .replace(/[。！？!?,，、；;：:\s]/g, "")
    .trim();
}

function runSelfTest() {
  const repeated = messagesText([{
    contentPreview: "同一句回复",
    visibleTextPreview: "同一句回复",
    executionSummaryPreview: "同一句回复"
  }]);
  assert.strictEqual(repeated, "同一句回复", "visible text aggregation must dedupe identical previews");
  const hiddenSummary = messagesText([{
    contentPreview: "用户真正看到的回复",
    visibleTextPreview: "用户真正看到的回复",
    executionSummaryPreview: "执行条件未满足，本轮没有执行工具"
  }]);
  assert.strictEqual(
    hiddenSummary,
    "用户真正看到的回复",
    "visible text aggregation must not treat hidden execution summaries as visible copy"
  );
  const embedded = messagesText([{
    contentPreview: "⚠️ 当前项目里没有可分析的图片资源。",
    visibleTextPreview: "先看一下当前画面\n当前项目里没有可分析的图片资源。"
  }]);
  assert.strictEqual(
    embedded,
    "先看一下当前画面 当前项目里没有可分析的图片资源。",
    "visible text aggregation must not duplicate content already present in rendered blocks"
  );
  const userPromptWithDesignDomains = [{
    role: "user",
    contentPreview: "请使用当前项目 [local-path-redacted] 做主图、SKU 和详情页，并导出到项目目录。",
    visibleTextPreview: "请使用当前项目 [local-path-redacted] 做主图、SKU 和详情页，并导出到项目目录。"
  }, {
    role: "assistant",
    contentPreview: "已完成详情页长图并导出。",
    visibleTextPreview: "已完成详情页长图并导出。"
  }];
  assert.strictEqual(
    looksLikeCannedCapabilityMenu(assistantMessagesText(userPromptWithDesignDomains)),
    false,
    "canned capability detection must not inspect the submitted user prompt"
  );
  assert.strictEqual(
    looksLikeCannedCapabilityMenu("好的，我理解你的需求。我的设计计划如下：1. **素材盘点与评估**：检查 SKU 色卡素材。2. **详情页结构规划**：规划顶部主视觉区、产品卖点图文区和 SKU 色卡展示区。3. **交付物**：先给计划，不写入 Photoshop。"),
    false,
    "canned capability detection must not reject a concrete no-write design plan"
  );
  assert.strictEqual(
    hasSubmittedUserMessage(userPromptWithDesignDomains),
    true,
    "submitted user message detection should tolerate path redaction"
  );

  const source = fs.readFileSync(__filename, "utf8");
  assert(
    !source.includes(["success:", "!parsed.failIfUnavailable"].join(" ")),
    "running-window inspection must not report success when the window or bridge is unavailable"
  );
  assert(
    !source.includes(["page.screenshot({ path: screenshotPath, fullPage: false })", ".catch"].join("")),
    "screenshot failures must be visible to the inspection result instead of being swallowed"
  );
  const scrollAnchorIndex = source.lastIndexOf("scrollScreenshotAnchorIntoView(page, newMessages)");
  const screenshotIndex = source.lastIndexOf("captureBoundedViewportScreenshot(page, screenshotPath)");
  assert(
    scrollAnchorIndex >= 0 && screenshotIndex >= 0 && scrollAnchorIndex < screenshotIndex,
    "running-window screenshots must scroll the submitted case anchor into view before capturing"
  );
  assert(
    source.includes('timeout: timeoutMs') &&
      source.includes('Page.captureScreenshot') &&
      source.includes('screenshotMethod'),
    "running-window screenshots must use bounded Playwright capture with CDP fallback and record the capture method"
  );
  assert(
    source.includes("closeBlockingOverlays(page)") && source.lastIndexOf("detectBlockingOverlay(page)") < screenshotIndex,
    "running-window screenshots must close or detect blocking overlays before capturing"
  );
  const chatPanelSource = fs.readFileSync(path.join(ROOT, "src", "renderer", "components", "ChatPanel.tsx"), "utf8");
  assert(
    chatPanelSource.includes("data-message-id={msg.id}") && chatPanelSource.includes("data-message-role={msg.role}"),
    "ChatPanel messages must expose stable test-only message anchors for running-window screenshots"
  );
  assert(
    chatPanelSource.includes("hasVisibleAssistantPayload") && chatPanelSource.includes("buildMissingVisibleResultContent"),
    "ChatPanel must not finalize a successful assistant result with no visible user-facing content"
  );
  assert(
    findForbiddenVisibleMarkers("我这边暂时没拿到可靠回复，不能把能力范围说准，请在设置里检查当前模型。").length > 0,
    "running-window inspection must fail when model-unavailable fallback copy is visible"
  );
  assert(
    findForbiddenVisibleMarkers("路由结果：普通对话").length > 0,
    "running-window inspection must fail when route classification wording is visible"
  );
  const emptyModelReadiness = summarizeRuntimeModelReadinessFromState({
    modelPreferences: { mode: "cloud" },
    apiKeys: {}
  });
  assert.strictEqual(
    emptyModelReadiness.hasConfiguredTextProvider,
    false,
    "running-window inspection must detect when an isolated window has no configured text model provider"
  );
  assert(
    /--seed-user-state/.test(emptyModelReadiness.diagnostic),
    "running-window inspection should tell maintainers how to launch a real-model debug window"
  );
  assert.strictEqual(
    buildBridgeRuntimeMismatch(
      { ok: true, connected: false },
      { ok: true, pluginConnected: true }
    ),
    "The inspected Electron window is not connected to Photoshop, but the default MCP bridge is connected. This usually means the CDP window is an isolated debug runtime, not the currently connected Agent host.",
    "running-window inspection must explain when the inspected CDP window is not the same runtime as the connected MCP bridge"
  );
  assert.strictEqual(
    buildBridgeRuntimeMismatch(
      { ok: true, connected: true },
      { ok: true, pluginConnected: false }
    ),
    "The inspected Electron window reports Photoshop connected, but the default MCP bridge is disconnected. Check whether multiple Agent runtimes are using different port blocks.",
    "running-window inspection must explain split bridge state in the opposite direction"
  );
  assert.strictEqual(
    buildBridgeRuntimeMismatch(
      { ok: true, connected: true },
      { ok: true, pluginConnected: true }
    ),
    "",
    "running-window inspection must not report a bridge mismatch when both bridge views agree"
  );
  assert.deepStrictEqual(
    buildBridgeRequirementFailures(
      { requireRunningWindowBridgeConnected: true, requireDefaultMcpConnected: true, requireBridgeMatch: true },
      { ok: true, connected: true },
      { ok: true, pluginConnected: true },
      ""
    ),
    [],
    "bridge requirements should pass when both bridge views are connected and aligned"
  );
  assert(
    buildBridgeRequirementFailures(
      { requireRunningWindowBridgeConnected: true, requireDefaultMcpConnected: true, requireBridgeMatch: true },
      { ok: true, connected: false },
      { ok: true, pluginConnected: true },
      "mismatch"
    ).length >= 2,
    "bridge requirements must fail hard for disconnected or mismatched running windows"
  );
  assert.strictEqual(
    shouldSkipPromptCasesForBridgeRequirementFailures(
      { requireRunningWindowBridgeConnected: true },
      ["running window bridge is not connected to Photoshop"]
    ),
    true,
    "strict running-window validation should not send prompts when bridge requirements already failed"
  );
  assert.strictEqual(
    shouldSkipPromptCasesForBridgeRequirementFailures(
      { requireRunningWindowBridgeConnected: false, requireDefaultMcpConnected: false, requireBridgeMatch: false },
      ["diagnostic failure"]
    ),
    false,
    "non-strict diagnostic inspection may still run prompt cases"
  );
  const unavailableDiagnosticsFixture = {
    lastLaunch: {
      exists: true,
      port: 9223,
      useDefaultRuntimePorts: true
    },
    defaultRuntimePorts: [
      {
        label: "Agent MCP host",
        port: 8768,
        occupied: true,
        owners: [
          {
            pid: 123,
            processName: "electron",
            commandLine: "electron.exe ."
          }
        ]
      }
    ],
    defaultMcpBridge: {
      ok: true,
      pluginConnected: true
    }
  };
  assert(
    buildUnavailableWindowReason({ port: 9223 }, unavailableDiagnosticsFixture).includes("normal runtime"),
    "unavailable running-window diagnostics should distinguish a normal runtime from a test-bridge runtime"
  );
  assert(
    buildUnavailableWindowNextActions(unavailableDiagnosticsFixture).some((action) => /Get user approval/.test(action)),
    "unavailable running-window diagnostics should not tell maintainers to take over a busy runtime without approval"
  );
  assert.strictEqual(parseArgs(["--prompt-kind", "execution"]).allowExecution, true);
  assert.strictEqual(parseArgs(["--c1163-sku-e2e"]).allowExecution, true);
  assert.strictEqual(
    parseArgs(["--preserve-conversation"]).preserveConversation,
    true,
    "--preserve-conversation should keep multiple submitted prompts in the same ChatPanel conversation"
  );
  const selfTestLastLaunchPath = path.join(ROOT, "tmp", "inspect-chat-ui-running-window-self-test-last-launch.json");
  fs.mkdirSync(path.dirname(selfTestLastLaunchPath), { recursive: true });
  try {
    fs.writeFileSync(selfTestLastLaunchPath, JSON.stringify({ port: 9345 }), "utf8");
    assert.strictEqual(
      parseArgs(["--port", "last"], { lastLaunchPath: selfTestLastLaunchPath }).port,
      9345,
      "--port last should read the most recent debug window port"
    );
    assert.strictEqual(
      parseArgs(["--port=auto"], { lastLaunchPath: selfTestLastLaunchPath }).port,
      9345,
      "--port auto should read the most recent debug window port when available"
    );
    assert.strictEqual(
      parseArgs(["--port", "9224"], { lastLaunchPath: selfTestLastLaunchPath }).port,
      9224,
      "numeric --port behavior must remain unchanged"
    );
    fs.writeFileSync(selfTestLastLaunchPath, JSON.stringify({ port: "not-a-port" }), "utf8");
    assert.strictEqual(
      parseArgs(["--port", "auto"], { lastLaunchPath: selfTestLastLaunchPath }).port,
      9223,
      "--port auto should fall back to 9223 when the last launch file is invalid"
    );
    fs.rmSync(selfTestLastLaunchPath, { force: true });
    assert.strictEqual(
      parseArgs(["--port", "auto"], { lastLaunchPath: selfTestLastLaunchPath }).port,
      9223,
      "--port auto should fall back to 9223 when the last launch file is missing"
    );
    assert.throws(
      () => parseArgs(["--port", "last"], { lastLaunchPath: selfTestLastLaunchPath }),
      /Cannot resolve --port last/,
      "--port last should fail clearly when the last launch file cannot be read"
    );
  } finally {
    fs.rmSync(selfTestLastLaunchPath, { force: true });
  }
  assert.strictEqual(buildCases(parseArgs(["--c1163-sku-e2e"]))[0].acceptanceCase.expectation.skillId, "sku-batch");
  assert(
    collectAcceptanceDebugFailures(
      { id: "c1163-sku-e2e", acceptanceCase: buildC1163SkuAcceptanceCase("帮我做一下SKU") },
      {
        report: { status: "passed" },
        bundle: {
          lifecycle: { decision: { route: "skill_execution", source: "deterministic_route", skillId: "sku-batch" } },
          diagnosticEvidence: {
            skuConfiguredExecutionPlan: {
              schema: "sku-configured-execution-plan/v0",
              status: "ready_configured_execution_plan",
              comboExecutionCount: 1,
              noteExecutionCount: 1
            },
            skuExecutionManifest: [{ status: "ready" }],
            skuExportReadback: {
              version: "sku-export-readback/v0",
              status: "ready_for_review",
              okFileProbeCount: 2
            }
          }
        }
      }
    ).length === 0,
    "C-1163 running-window case should accept a complete SKU diagnostic/readback bundle"
  );
  assert(
    collectAcceptanceDebugFailures(
      { id: "c1163-sku-e2e", acceptanceCase: buildC1163SkuAcceptanceCase("帮我做一下SKU") },
      {
        report: { status: "passed" },
        bundle: {
          lifecycle: { decision: { route: "skill_execution", source: "deterministic_route", skillId: "sku-batch" } },
          diagnosticEvidence: {
            skuConfiguredExecutionPlan: {
              schema: "sku-configured-execution-plan/v0",
              status: "blocked_configured_execution_plan",
              comboExecutionCount: 16,
              noteExecutionCount: 3,
              blockers: ["SKU 素材只有 5 个可用颜色组，配置文件需要 6 个颜色槽。"]
            }
          }
        }
      }
    ).length === 0,
    "C-1163 running-window case should accept an actionable configured SKU blocker without requiring export readback"
  );
  const configuredModelReadiness = summarizeRuntimeModelReadinessFromState({
    modelPreferences: {
      mode: "cloud",
      preferredCloudModels: { layoutAnalysis: "xiaomi-mimo-v2.5-pro" }
    },
    apiKeys: {
      xiaomi: "sk-test-value",
      google: ""
    }
  });
  assert.strictEqual(configuredModelReadiness.hasConfiguredTextProvider, true);
  assert.deepStrictEqual(configuredModelReadiness.configuredTextProviders, ["xiaomi"]);
  assert(!JSON.stringify(configuredModelReadiness).includes("sk-test-value"));
  assert.deepStrictEqual(
    collectAssistantReplyOriginFailures(
      [{
        role: "assistant",
        contentPreview: "可以，我先看项目素材。",
        visibleTextPreview: "可以，我先看项目素材。",
        assistantReplyOrigin: {
          origin: "model_authored",
          userVisibleKind: "assistant_speech"
        }
      }],
      { id: "conversation-origin-ok", kind: "conversation" }
    ),
    [],
    "conversation cases should accept model-authored assistant speech"
  );
  assert(
    collectAssistantReplyOriginFailures(
      [{
        role: "assistant",
        assistantReplyOrigin: {
          origin: "local_conversation_summary",
          userVisibleKind: "assistant_speech"
        }
      }],
      { id: "conversation-origin-local", kind: "conversation" }
    ).length > 0,
    "conversation cases must reject local summaries as visible assistant speech"
  );
  assert.deepStrictEqual(
    collectAssistantReplyOriginFailures(
      [{
        role: "assistant",
        contentPreview: "测试回复。",
        visibleTextPreview: "测试回复。",
        assistantReplyOrigin: {
          origin: "test_fixture",
          userVisibleKind: "test_fixture"
        }
      }],
      { id: "conversation-origin-fake-fixture-ok", kind: "conversation" },
      { hasFakeModel: true }
    ),
    [],
    "fake-model conversation cases should accept explicit test fixtures"
  );
  assert(
    collectAssistantReplyOriginFailures(
      [{
        role: "assistant",
        assistantReplyOrigin: {
          origin: "model_authored",
          userVisibleKind: "assistant_speech"
        }
      }],
      { id: "conversation-origin-fake-model-authored", kind: "conversation" },
      { hasFakeModel: true }
    ).length > 0,
    "fake-model conversation cases must reject product-looking model-authored speech"
  );
  assert.deepStrictEqual(
    collectAssistantReplyOriginFailures(
      [{
        role: "assistant",
        contentPreview: "当前项目里没有可分析的图片资源。",
        visibleTextPreview: "当前项目里没有可分析的图片资源。",
        assistantReplyOrigin: {
          origin: "deterministic_blocker",
          userVisibleKind: "blocker_notice"
        }
      }],
      { id: "readonly-blocker-origin-ok", kind: "read_only" }
    ),
    [],
    "read-only blocker cases should accept deterministic blocker notices"
  );
  assert.deepStrictEqual(
    collectAssistantReplyOriginFailures(
      [{
        role: "assistant",
        contentPreview: "已完成处理。",
        visibleTextPreview: "已完成处理。",
        assistantReplyOrigin: {
          origin: "tool_result_summary",
          userVisibleKind: "tool_summary"
        }
      }],
      { id: "execution-tool-origin-ok", kind: "execution" }
    ),
    [],
    "execution cases should accept tool result summaries"
  );
  assert(
    collectAssistantReplyOriginFailures(
      [{
        role: "assistant",
        contentPreview: "",
        visibleTextPreview: "",
        cardTitles: [],
        thinkingBlockTitles: [],
        assistantReplyOrigin: {
          origin: "tool_result_summary",
          userVisibleKind: "tool_summary"
        }
      }],
      { id: "readonly-empty-tool-summary", kind: "read_only" }
    ).length > 0,
    "read-only and execution cases must reject blank assistant messages even when origin is valid"
  );
  assert(
    collectAssistantReplyOriginFailures(
      [{
        role: "assistant",
        assistantReplyOrigin: {
          origin: "unknown",
          userVisibleKind: "tool_summary"
        }
      }],
      { id: "readonly-origin-unknown", kind: "read_only" }
    ).length > 0,
    "read-only and execution cases must reject unknown assistant reply origins"
  );
  assert(
    collectAssistantReplyOriginFailures(
      [{ role: "assistant" }],
      { id: "execution-origin-missing", kind: "execution" }
    ).length > 0,
    "read-only and execution cases must reject missing assistant reply origins"
  );
  assert.deepStrictEqual(
    collectAssistantReplyOriginFailures(
      [{
        role: "assistant",
        contentPreview: "这次没有拿到模型回复，先不继续处理。",
        visibleTextPreview: "这次没有拿到模型回复，先不继续处理。",
        assistantReplyOrigin: {
          origin: "ui_status",
          userVisibleKind: "status_notice"
        }
      }],
      { id: "conversation-model-unavailable-status", kind: "conversation" },
      { allowModelUnavailable: true }
    ),
    [],
    "conversation cases should classify explicit model-unavailable status as a diagnostic block, not as hardcoded assistant speech"
  );
  assert.deepStrictEqual(
    collectAssistantReplyOriginFailures(
      [{
        role: "assistant",
        contentPreview: "这次没有拿到模型回复，先不继续处理。",
        assistantReplyOrigin: {
          origin: "ui_status",
          userVisibleKind: "status_notice"
        }
      }],
      { id: "readonly-model-unavailable-status", kind: "read_only" },
      { allowModelUnavailable: true }
    ),
    [],
    "read-only cases should classify explicit model-unavailable status as a diagnostic block when the real model is not configured"
  );
  assert(
    collectAssistantReplyOriginFailures(
      [{
        role: "assistant",
        contentPreview: "暂时没有拿到可靠回复能力问题；本轮不会改动画面。可以稍后再试，或在设置里切换可用的回复服务。",
        assistantReplyOrigin: {
          origin: "ui_status",
          userVisibleKind: "status_notice"
        }
      }],
      { id: "old-capability-unavailable-status", kind: "conversation" },
      { allowModelUnavailable: true }
    ).length > 0,
    "old capability-specific model-unavailable status should be treated as stale template copy, not as an allowed status notice"
  );
  assert.strictEqual(
    selectScreenshotAnchorMessageId([
      { id: "user-1", role: "user" },
      { id: "assistant-1", role: "assistant" }
    ]),
    "assistant-1",
    "running-window screenshots should anchor to the newest assistant message from the submitted case"
  );
  assert.strictEqual(
    selectScreenshotAnchorMessageId([
      { id: "user-2", role: "user" }
    ]),
    "user-2",
    "running-window screenshots should fall back to the submitted user message when no assistant message exists"
  );

  console.log("inspect-chat-ui-running-window self-test passed");
}

function findForbiddenVisibleMarkers(text) {
  const forbidden = [
    /<\s*tool_call\b/i,
    /<\s*function\s*=/i,
    /\b(?:direct_response|clarification_needed|needs_model_design_decision|skill_execution|read_only_inspect|execute_skill|chat_only|toolScope|requestKind)\b/i,
    /Conversational reply unavailable/i,
    /暂时没拿到可靠回复/,
    /现在没能生成有效回复/,
    /这轮不会改动 Photoshop/,
    /没有收到模型回复/,
    /不能把能力范围说准/,
    /请在设置里检查当前模型/,
    /模型(?:不可用|服务不可用|没有返回有效内容)/,
    /对话模型没有返回有效内容/,
    /路由结果\s*[:：]\s*(?:普通对话|只读检查|执行|工具)/,
    /(?:普通对话|只读检查|需要进入处理流程)/,
    /执行条件未满足，本轮没有执行工具/,
    /(?:业务预检|预检模式|准备受控执行|受控执行)/,
    /\bSKU\s+skill\b/i,
    /agent-task-planning-contract/i,
    /agent-user-visible-state/i
  ];
  return forbidden
    .filter((pattern) => pattern.test(text))
    .map((pattern) => String(pattern));
}

function findRepeatedVisiblePhrases(text) {
  const phrases = String(text || "")
    .split(/[\n。！？!?\s]+/)
    .map((value) => value
      .replace(/^[\s⚠️❌✅!！i]+/, "")
      .replace(/^(?:错误|Error)\s*[:：]\s*/i, "")
      .replace(/\s+/g, "")
      .trim())
    .filter((value) => value.length >= 8 && !isSafeRepeatedVisiblePhrase(value));
  const counts = new Map();
  for (const phrase of phrases) {
    counts.set(phrase, (counts.get(phrase) || 0) + 1);
  }
  return Array.from(counts.entries())
    .filter(([, count]) => count > 1)
    .map(([phrase]) => phrase);
}

function isSafeRepeatedVisiblePhrase(phrase) {
  const text = String(phrase || "").replace(/[*`"'“”《》【】（）()]/g, "").trim();
  if (!text) return true;
  if (/^[A-Za-z0-9_\-./]+$/.test(text)) return true;
  if (/^(?:SCS|C)-?\d+/i.test(text)) return true;
  if (!/(是|有|包含|观察|判断|建议|需要|可以|读取|处理|进入|完成|失败|没有|先|再|已|未)/.test(text)) {
    return true;
  }
  return false;
}

function looksLikeConcreteProjectUnderstanding(text) {
  const value = String(text || "").replace(/\s+/g, " ").trim();
  if (!value) return false;
  const hasProjectObservationFrame = /(项目资源|资源索引|项目里(?:总)?共有|当前项目包含|文件夹结构|主要文件夹和资源|从结构上看|从文件夹结构来看|资源库已经|素材已初步归类)/.test(value);
  const hasConcreteResourceEvidence = /\d+\s*(?:个|张|类)\s*(?:图片|素材|文件夹|资源)/.test(value)
    || /`?[^`\s，。；;]+?\.(?:png|jpe?g|psd|psb)`?/i.test(value)
    || /\bPSD\b|\bPSB\b|SKU\.psb/i.test(value);
  const hasDesignerJudgment = /(我的判断|我的建议|我观察到|这很可能是|说明这个款式|下一步建议|建议)/.test(value);
  const looksLikeCapabilityMenu = /(我可以协助这些设计工作|我可以帮你处理以下|我能帮你做的是|你可以直接提出主图、SKU、详情页)/.test(value);
  return hasProjectObservationFrame
    && hasConcreteResourceEvidence
    && hasDesignerJudgment
    && !looksLikeCapabilityMenu;
}

function looksLikeCannedCapabilityMenu(text) {
  const value = String(text || "").replace(/\s+/g, " ").trim();
  if (looksLikeConcreteProjectUnderstanding(value)) return false;
  const markdownHeadingCount = (value.match(/\*\*[^*]{2,24}\*\*/g) || []).length;
  const sentenceCount = (value.match(/[。！？!?]/g) || []).length;
  const hasConcreteDesignPlan = /(设计计划如下|我的设计计划|素材盘点|详情页结构规划|SKU色卡展示区|交付物)/.test(value);
  const domainHitCount = [
    /(主图|点击图|转化图|白底图)/,
    /(详情页|长图)/,
    /(SKU|sku|组合图|自选备注)/,
    /(素材整理|素材理解|图层|导出)/
  ].filter((pattern) => pattern.test(value)).length;
  const hasGeneralCapabilityMenu = markdownHeadingCount >= 2
    && /(设计判断|主图|详情页|SKU|素材整理|图层调整|电商视觉|设计搭档)/.test(value)
    && /(你现在有具体|还是先随便聊聊|需要解决哪类问题|手头有素材|告诉我)/.test(value);
  const hasLongCapabilityOverview = sentenceCount >= 4
    && domainHitCount >= 2
    && !hasConcreteDesignPlan
    && !/只说明理解|不执行工具|先不动手|这是我对这个任务的理解/.test(value)
    && /(主要帮你|这些事情|这些|比如|另外|简单说|你告诉我|你给我描述|有什么具体|具体想法|我来判断)/.test(value);
  return /我可以协助这些设计工作/.test(value)
    || /你可以直接提出主图、SKU、详情页/.test(text)
    || /我会先判断它属于对话、只读检查还是需要进入处理流程/.test(value)
    || hasGeneralCapabilityMenu
    || hasLongCapabilityOverview;
}

function hasProjectInventoryEvidence(text) {
  const value = String(text || "").replace(/\s+/g, " ").trim();
  return /已读取当前项目资源索引/.test(value)
    || looksLikeConcreteProjectUnderstanding(value)
    || /(当前项目|项目).{0,20}\d+\s*(?:个|张|类)\s*(?:图片|素材|文件夹|资源)/.test(value);
}

function describeAssistantReplyOrigin(origin) {
  if (!origin || typeof origin !== "object") return "missing";
  return `${String(origin.origin || "missing")}/${String(origin.userVisibleKind || "missing")}`;
}

function hasAssistantBlockerNotice(messages) {
  return messages.some((message) => {
    if (message.role !== "assistant") return false;
    const origin = message.assistantReplyOrigin;
    return origin
      && origin.origin === "deterministic_blocker"
      && origin.userVisibleKind === "blocker_notice";
  });
}

function summarizeAssistantReplyOrigins(messages) {
  return messages
    .filter((message) => message.role === "assistant")
    .map((message, index) => `assistant#${index + 1}:${describeAssistantReplyOrigin(message.assistantReplyOrigin)}`);
}

function selectScreenshotAnchorMessageId(messages) {
  const list = Array.isArray(messages) ? messages : [];
  const newestAssistant = [...list].reverse().find((message) => message?.role === "assistant" && message.id);
  if (newestAssistant?.id) return newestAssistant.id;
  const newestUser = [...list].reverse().find((message) => message?.role === "user" && message.id);
  if (newestUser?.id) return newestUser.id;
  const newestMessage = [...list].reverse().find((message) => message?.id);
  return newestMessage?.id || null;
}

async function scrollScreenshotAnchorIntoView(page, messages) {
  const anchorMessageId = selectScreenshotAnchorMessageId(messages);
  if (!anchorMessageId) {
    return {
      anchorMessageId: null,
      found: false,
      visible: false,
      reason: "no message id was available for screenshot anchoring"
    };
  }

  return page.evaluate(async (targetMessageId) => {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const target = Array.from(document.querySelectorAll("[data-message-id]"))
      .find((element) => element.getAttribute("data-message-id") === targetMessageId);
    if (!target) {
      return {
        anchorMessageId: targetMessageId,
        found: false,
        visible: false,
        reason: "message DOM node with data-message-id was not found"
      };
    }

    target.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" });
    await sleep(120);
    const rect = target.getBoundingClientRect();
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
    const visible = rect.bottom > 0
      && rect.top < viewportHeight
      && rect.right > 0
      && rect.left < viewportWidth;
    return {
      anchorMessageId: targetMessageId,
      found: true,
      visible,
      top: Math.round(rect.top),
      bottom: Math.round(rect.bottom),
      left: Math.round(rect.left),
      right: Math.round(rect.right),
      viewportHeight,
      viewportWidth
    };
  }, anchorMessageId);
}

async function detectBlockingOverlay(page) {
  return page.evaluate(() => {
    const selectors = [
      ".modal-backdrop",
      ".settings-modal",
      ".preview-modal",
      ".upload-modal"
    ];
    const overlays = [];
    for (const selector of selectors) {
      for (const element of Array.from(document.querySelectorAll(selector))) {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity || "1") === 0) continue;
        if (rect.width <= 0 || rect.height <= 0) continue;
        overlays.push({
          selector,
          className: String(element.className || ""),
          top: Math.round(rect.top),
          left: Math.round(rect.left),
          right: Math.round(rect.right),
          bottom: Math.round(rect.bottom),
          text: String(element.textContent || "").replace(/\s+/g, " ").trim().slice(0, 120)
        });
      }
    }
    return {
      present: overlays.length > 0,
      overlays: overlays.slice(0, 6)
    };
  });
}

async function closeBlockingOverlays(page) {
  let before = await detectBlockingOverlay(page);
  if (!before.present) {
    return {
      attempted: false,
      before,
      after: before
    };
  }

  await page.keyboard.press("Escape").catch(() => undefined);
  await page.waitForTimeout(120).catch(() => undefined);
  before = await detectBlockingOverlay(page);
  if (!before.present) {
    return {
      attempted: true,
      method: "escape",
      before,
      after: before
    };
  }

  await page.evaluate(() => {
    const closeButton = document.querySelector(".modal-backdrop .close-btn, .settings-modal .close-btn, .preview-modal .close-btn, .upload-modal .close-upload");
    if (closeButton instanceof HTMLElement) closeButton.click();
  }).catch(() => undefined);
  await page.waitForTimeout(160).catch(() => undefined);
  const after = await detectBlockingOverlay(page);
  return {
    attempted: true,
    method: "escape-or-close-button",
    before,
    after
  };
}

function getMessageVisibleText(message) {
  return [
    message?.visibleTextPreview,
    message?.contentPreview,
    message?.executionSummaryPreview
  ].map((value) => String(value || "").trim()).filter(Boolean).join(" ");
}

function isModelUnavailableStatusNoticeMessage(message) {
  const origin = message?.assistantReplyOrigin;
  if (!origin || origin.origin !== "ui_status" || origin.userVisibleKind !== "status_notice") return false;
  const text = getMessageVisibleText(message);
  if (/暂时没有拿到可靠回复能力问题/.test(text)) return false;
  return /这次没有拿到模型回复，先不继续处理/.test(text)
    || /当前模型没有通过认证/.test(text);
}

function isModelUnavailableOnlyCase(messages) {
  const assistantMessages = messages.filter((message) => message.role === "assistant");
  return assistantMessages.length > 0
    && assistantMessages.every(isModelUnavailableStatusNoticeMessage);
}

function hasAssistantVisiblePayload(message) {
  if (getMessageVisibleText(message).trim()) return true;
  if ((message.cardTitles || []).some((item) => String(item || "").trim())) return true;
  if ((message.thinkingBlockTitles || []).some((item) => String(item || "").trim())) return true;
  if ((message.businessPreflightCardTitles || []).some((item) => String(item || "").trim())) return true;
  if (Number(message.businessPreflightCardCount || 0) > 0) return true;
  if (Number(message.toolResultCount || 0) > 0) return true;
  if (message.hasBusinessVisualObservationFeedback) return true;
  if (message.hasPublicPlanExecutionRequest || message.hasPublicPlanControlledRun) return true;
  return false;
}

function collectAssistantReplyOriginFailures(messages, testCase, runtime = {}) {
  const assistantMessages = messages.filter((message) => message.role === "assistant");
  if (assistantMessages.length === 0) return [];
  if (!["conversation", "read_only", "execution"].includes(testCase.kind)) return [];

  const failures = [];
  assistantMessages.forEach((message, index) => {
    const label = `${testCase.id} assistant#${index + 1}`;
    const origin = message.assistantReplyOrigin;
    if (!origin || typeof origin !== "object") {
      failures.push(`${label} missing assistantReplyOrigin`);
      return;
    }

    const originKind = String(origin.origin || "");
    const userVisibleKind = String(origin.userVisibleKind || "");
    if (originKind === "unknown" || userVisibleKind === "unknown") {
      failures.push(`${label} must not use unknown assistantReplyOrigin: ${describeAssistantReplyOrigin(origin)}`);
      return;
    }
    if (runtime.allowModelUnavailable && isModelUnavailableStatusNoticeMessage(message)) {
      return;
    }
    if (!hasAssistantVisiblePayload(message)) {
      failures.push(`${label} has no visible assistant content`);
      return;
    }

    if (testCase.kind === "conversation") {
      if (runtime.hasFakeModel) {
        const isFakeModelFixture = originKind === "test_fixture"
          && userVisibleKind === "test_fixture";
        if (!isFakeModelFixture) {
          failures.push(
            `${label} in a fake-model window must be test_fixture/test_fixture, got ${describeAssistantReplyOrigin(origin)}`
          );
        }
        return;
      }

      const isModelAssistantSpeech = userVisibleKind === "assistant_speech"
        && (originKind === "model_authored" || originKind === "model_repaired");
      if (!isModelAssistantSpeech) {
        failures.push(
          `${label} must be model_authored/model_repaired assistant_speech, got ${describeAssistantReplyOrigin(origin)}`
        );
      }
      return;
    }

    const isAllowedReadOnlyOrExecutionOrigin = (
      originKind === "deterministic_blocker"
      && userVisibleKind === "blocker_notice"
    ) || (
      originKind === "tool_result_summary"
      && userVisibleKind === "tool_summary"
    ) || (
      userVisibleKind === "assistant_speech"
      && (originKind === "model_authored" || originKind === "model_repaired")
    );
    if (!isAllowedReadOnlyOrExecutionOrigin) {
      failures.push(
        `${label} must be deterministic_blocker/blocker_notice, tool_result_summary/tool_summary, or model_authored/model_repaired assistant_speech, got ${describeAssistantReplyOrigin(origin)}`
      );
    }
  });

  return failures;
}

async function findChatBridgePage(browser) {
  const contexts = browser.contexts();
  const pages = contexts.flatMap((context) => context.pages());
  for (const page of pages) {
    try {
      await page.waitForLoadState("domcontentloaded", { timeout: 3000 }).catch(() => undefined);
      const hasBridge = await page.evaluate(() => Boolean(window.__DESIGNECHO_CHAT_TEST_BRIDGE__));
      if (hasBridge) return page;
    } catch {
      // Ignore non-DesignEcho pages exposed by the same CDP endpoint.
    }
  }
  return null;
}

async function findDesignEchoPage(browser) {
  const contexts = browser.contexts();
  const pages = contexts.flatMap((context) => context.pages());
  for (const page of pages) {
    try {
      await page.waitForLoadState("domcontentloaded", { timeout: 3000 }).catch(() => undefined);
      const isDesignEcho = await page.evaluate(() => {
        const hasInput = Boolean(document.querySelector("[data-testid='chat-input'], textarea.chat-input"));
        const hasMessages = Boolean(document.querySelector("[data-testid='chat-messages'], .messages-container"));
        const titleMatches = /DesignEcho/i.test(document.title || "");
        const urlMatches = /DesignEcho-Agent|dist\/renderer\/index\.html/i.test(window.location.href || "");
        return hasInput && hasMessages && (titleMatches || urlMatches);
      });
      if (isDesignEcho) return page;
    } catch {
      // Ignore non-DesignEcho pages exposed by the same CDP endpoint.
    }
  }
  return null;
}

async function measureChatHorizontalOverflow(page) {
  return page.evaluate(async () => {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const root = document.querySelector(".chat-panel") || document.body;
    const messages = document.querySelector("[data-testid='chat-messages']");
    const clickTargets = Array.from(document.querySelectorAll(
      ".thinking-header,.tool-result-header,.collapsible-header,.card-header"
    ));

    for (const target of clickTargets) {
      try {
        target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      } catch {
        // Width probing can continue even if one rendered block is not interactive.
      }
    }
    await sleep(50);

    const rootRect = root.getBoundingClientRect();
    const selectors = [
      ".chat-panel",
      "[data-testid='chat-messages']",
      ".message-wrapper",
      ".multimodal-message",
      ".message-body",
      ".message-block",
      ".thinking-block",
      ".thinking-simple",
      ".thinking-steps",
      ".thinking-step",
      ".pondering-steps",
      ".pondering-step",
      ".tool-result-block",
      ".tool-result-details",
      ".card-block",
      ".card-body",
      ".card-detail-item",
      ".details-list",
      ".detail-item",
      ".list-block li",
      ".code-content",
      ".raw-result pre",
      ".table-block",
      ".artifact-content",
      ".collapsible-block",
      ".collapsible-content"
    ];
    const offenders = [];
    const seen = new Set();

    for (const selector of selectors) {
      for (const element of Array.from(document.querySelectorAll(selector))) {
        if (seen.has(element)) continue;
        seen.add(element);
        const rect = element.getBoundingClientRect();
        const scrollOverflow = element.scrollWidth > element.clientWidth + 2;
        const rightOverflow = rect.right > rootRect.right + 2;
        if (!scrollOverflow && !rightOverflow) continue;
        offenders.push({
          selector,
          className: String(element.className || ""),
          scrollWidth: element.scrollWidth,
          clientWidth: element.clientWidth,
          left: Math.round(rect.left),
          right: Math.round(rect.right),
          rootRight: Math.round(rootRect.right),
          text: String(element.textContent || "").replace(/\s+/g, " ").trim().slice(0, 120)
        });
      }
    }

    return {
      root: {
        scrollWidth: root.scrollWidth,
        clientWidth: root.clientWidth,
        right: Math.round(rootRect.right)
      },
      messages: messages
        ? { scrollWidth: messages.scrollWidth, clientWidth: messages.clientWidth }
        : null,
      offenders: offenders.slice(0, 12)
    };
  });
}

function buildC1163SkuAcceptanceCase(prompt) {
  return {
    id: "desktop-c1163-sku-configured-execution-chain",
    title: "桌面端普通 SKU 请求应读取项目配置并执行 sku-batch",
    userInput: prompt,
    mode: "desktop_bridge",
    tags: ["desktop", "sku", "configured-plan", "c1163", "running-window"],
    expectation: {
      route: "skill_execution",
      routeSource: "deterministic_route",
      skillId: "sku-batch",
      executionKind: "deterministic_skill",
      shouldUseTools: true,
      shouldChangeDocument: false,
      maxIterations: 1,
      maxToolCalls: 80
    },
    notes: [
      "This running-window case verifies the real ChatPanel path for C-1163 SKU execution."
    ]
  };
}

async function readCaseAcceptanceDebug(page, testCase, newMessages) {
  if (!testCase.acceptanceCase) return null;
  const assistantMessages = newMessages.filter((message) => message.role === "assistant");
  const latestAssistant = assistantMessages[assistantMessages.length - 1] || null;
  return page.evaluate(
    ({ casePayload, messageId }) => {
      const bridge = window.__DESIGNECHO_CHAT_TEST_BRIDGE__;
      if (typeof bridge?.getLatestAcceptanceDebug !== "function") {
        throw new Error("ChatPanel test bridge does not expose getLatestAcceptanceDebug.");
      }
      return bridge.getLatestAcceptanceDebug(casePayload, messageId ? { messageId } : undefined);
    },
    { casePayload: testCase.acceptanceCase, messageId: latestAssistant?.id || "" }
  );
}

function summarizeAcceptanceDebug(debug) {
  if (!debug) return null;
  const diagnosticEvidence = debug.bundle?.diagnosticEvidence || {};
  const evidenceKeys = Object.keys(diagnosticEvidence).sort();
  return {
    reportStatus: debug.report?.status || null,
    reportSummary: debug.report?.summary || "",
    issueLayers: Array.isArray(debug.report?.issueLayers) ? debug.report.issueLayers : [],
    blockers: Array.isArray(debug.report?.blockers) ? debug.report.blockers : [],
    warnings: Array.isArray(debug.report?.warnings) ? debug.report.warnings : [],
    lifecycleRoute: debug.bundle?.lifecycle?.decision?.route || null,
    lifecycleSource: debug.bundle?.lifecycle?.decision?.source || null,
    skillId: debug.bundle?.lifecycle?.decision?.skillId || null,
    executionStatus: debug.bundle?.executionSummary?.status || null,
    toolCount: Number(debug.report?.evidence?.toolCount || 0),
    diagnosticEvidenceKeys: evidenceKeys,
    skuConfiguredPlanStatus: diagnosticEvidence.skuConfiguredExecutionPlan?.status || null,
    skuComboExecutionCount: Number(diagnosticEvidence.skuConfiguredExecutionPlan?.comboExecutionCount || 0),
    skuNoteExecutionCount: Number(diagnosticEvidence.skuConfiguredExecutionPlan?.noteExecutionCount || 0),
    skuExportReadbackStatus: diagnosticEvidence.skuExportReadback?.status || null,
    skuExportReadbackOkFileProbeCount: Number(diagnosticEvidence.skuExportReadback?.okFileProbeCount || 0)
  };
}

function collectAcceptanceDebugFailures(testCase, debug) {
  if (!testCase.acceptanceCase) return [];
  const failures = [];
  if (!debug) {
    failures.push(`${testCase.id} did not expose an acceptance debug export`);
    return failures;
  }

  if (debug.report?.status !== "passed") {
    failures.push(`${testCase.id} acceptance report did not pass: ${JSON.stringify(debug.report || {}).slice(0, 900)}`);
  }

  if (testCase.id === "c1163-sku-e2e") {
    const lifecycle = debug.bundle?.lifecycle;
    const diagnosticEvidence = debug.bundle?.diagnosticEvidence || {};
    const configuredPlan = diagnosticEvidence.skuConfiguredExecutionPlan;
    const executionManifest = diagnosticEvidence.skuExecutionManifest;
    const exportReadback = diagnosticEvidence.skuExportReadback;
    const evidenceKeys = Object.keys(diagnosticEvidence);
    const configuredPlanStatus = configuredPlan?.status;
    const configuredPlanBlocked = configuredPlanStatus === "blocked_configured_execution_plan";

    if (lifecycle?.decision?.route !== "skill_execution") failures.push(`${testCase.id} lifecycle route was not skill_execution`);
    if (lifecycle?.decision?.source !== "deterministic_route") failures.push(`${testCase.id} lifecycle source was not deterministic_route`);
    if (lifecycle?.decision?.skillId !== "sku-batch") failures.push(`${testCase.id} did not select sku-batch`);
    const requiredEvidenceKeys = configuredPlanBlocked
      ? ["skuConfiguredExecutionPlan"]
      : ["skuConfiguredExecutionPlan", "skuExecutionManifest", "skuExportReadback"];
    for (const key of requiredEvidenceKeys) {
      if (!evidenceKeys.includes(key)) failures.push(`${testCase.id} did not export ${key} diagnostics`);
    }
    if (configuredPlan?.schema !== "sku-configured-execution-plan/v0") failures.push(`${testCase.id} exported the wrong configured SKU plan schema`);
    if (configuredPlanStatus !== "ready_configured_execution_plan" && configuredPlanStatus !== "blocked_configured_execution_plan") {
      failures.push(`${testCase.id} configured SKU plan had an unexpected status: ${String(configuredPlanStatus || "missing")}`);
    }
    if (Number(configuredPlan?.comboExecutionCount || 0) <= 0) failures.push(`${testCase.id} configured SKU plan did not include combo rows`);
    if (Number(configuredPlan?.noteExecutionCount || 0) <= 0) failures.push(`${testCase.id} configured SKU plan did not include self-select note rows`);
    if (configuredPlanBlocked) {
      const blockers = Array.isArray(configuredPlan?.blockers) ? configuredPlan.blockers : [];
      if (blockers.length === 0) failures.push(`${testCase.id} blocked configured SKU plan did not include actionable blockers`);
      if (!blockers.some((item) => /SKU|素材|配置|颜色组|颜色槽/.test(String(item || "")))) {
        failures.push(`${testCase.id} blocked configured SKU plan did not explain the SKU/config mismatch`);
      }
      return failures;
    }
    if (!Array.isArray(executionManifest) || !executionManifest.some((item) => item?.status === "ready")) {
      failures.push(`${testCase.id} execution manifest did not include a ready SKU size`);
    }
    if (exportReadback?.version !== "sku-export-readback/v0") failures.push(`${testCase.id} exported the wrong SKU readback version`);
    if (exportReadback?.status !== "ready_for_review") failures.push(`${testCase.id} SKU export readback was not ready_for_review`);
    if (Number(exportReadback?.okFileProbeCount || 0) < 2) failures.push(`${testCase.id} SKU export readback did not verify combo and note files`);
  }

  return failures;
}

function buildCases(parsed) {
  if (parsed.c1163SkuE2e) {
    const prompt = parsed.prompts[0] || "帮我做一下SKU";
    return [{
      id: "c1163-sku-e2e",
      prompt,
      kind: "execution",
      assertions: {
        noCannedCapabilityMenu: true,
        noInternalStatus: true
      },
      acceptanceCase: buildC1163SkuAcceptanceCase(prompt)
    }];
  }

  if (parsed.prompts.length > 0) {
    return parsed.prompts.map((prompt, index) => ({
      id: `custom-${index + 1}`,
      prompt,
      kind: parsed.promptKind,
      assertions: {
        noCannedCapabilityMenu: true,
        noInternalStatus: true
      }
    }));
  }

  return parsed.allowExecution
    ? [...DEFAULT_SAFE_CASES, ...EXECUTION_CASES]
    : DEFAULT_SAFE_CASES;
}

async function readDomChatSnapshot(page) {
  return page.evaluate(() => {
    const textOf = (element) => String(element?.innerText || element?.textContent || "").trim();
    const messageNodes = Array.from(document.querySelectorAll(
      "[data-testid='chat-message-user'], [data-testid='chat-message-assistant']"
    ));
    const messages = messageNodes.map((element, index) => {
      const role = element.getAttribute("data-testid") === "chat-message-user" ? "user" : "assistant";
      const id = element.getAttribute("data-message-id") || `dom-message-${index}`;
      const visibleText = textOf(element);
      const blocks = Array.from(element.querySelectorAll(".message-block, .thinking-block, .tool-result-block, .card-block"));
      const thinkingBlocks = Array.from(element.querySelectorAll(".thinking-block, .thinking-simple, .pondering-step, .thinking-step"));
      const toolBlocks = Array.from(element.querySelectorAll(".tool-result-block, .tool-result-details"));
      const thinkingBlockTitles = thinkingBlocks
        .map((block) => textOf(block).split(/\n/)[0])
        .filter(Boolean)
        .slice(0, 6);
      return {
        id,
        role,
        contentPreview: visibleText.slice(0, 1200),
        visibleTextPreview: visibleText.slice(0, 1200),
        executionSummaryPreview: "",
        thinkingPreview: thinkingBlocks.map(textOf).join("\n").slice(0, 1000),
        thinkingBlockTitles,
        toolResultCount: toolBlocks.length,
        blockCount: blocks.length
      };
    });
    return {
      messageCount: messages.length,
      messages,
      hasStopButton: Boolean(document.querySelector(".send-button.stop-button")),
      hasInput: Boolean(document.querySelector("[data-testid='chat-input'], textarea.chat-input")),
      bodyTail: String(document.body.innerText || "").slice(-5000)
    };
  });
}

async function waitForDomChatIdle(page, beforeMessageCount, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let latest = await readDomChatSnapshot(page);
  let previousVisible = "";
  let stableTicks = 0;
  while (Date.now() < deadline) {
    latest = await readDomChatSnapshot(page);
    const tailText = messagesText(latest.messages.slice(beforeMessageCount));
    const hasAssistant = latest.messages.slice(beforeMessageCount).some((message) => message.role === "assistant");
    if (!latest.hasStopButton && hasAssistant) {
      if (tailText === previousVisible) {
        stableTicks += 1;
      } else {
        stableTicks = 0;
        previousVisible = tailText;
      }
      if (stableTicks >= 2) return latest;
    }
    await page.waitForTimeout(1000);
  }
  return {
    ...latest,
    timeout: true
  };
}

async function submitDomChatPrompt(page, prompt, timeoutMs) {
  await page.waitForSelector("[data-testid='chat-input'], textarea.chat-input", { timeout: 30000 });
  const before = await readDomChatSnapshot(page);
  await page.locator("[data-testid='chat-input'], textarea.chat-input").first().fill(prompt);
  await page.waitForTimeout(120);
  await page.locator("[data-testid='chat-send'], .send-button:not(.stop-button)").last().click({ timeout: 15000 });
  const after = await waitForDomChatIdle(page, before.messageCount, timeoutMs);
  return { before, after };
}

async function runDomCase(page, testCase, parsed, index) {
  if (testCase.kind === "execution" && !parsed.allowExecution) {
    return {
      id: testCase.id,
      prompt: testCase.prompt,
      status: "skipped",
      reason: "execution prompt skipped; pass --allow-execution to send it to the running window"
    };
  }

  const overlayBeforeSubmit = await closeBlockingOverlays(page);
  const { before, after } = await submitDomChatPrompt(page, testCase.prompt, parsed.timeoutMs);
  const newMessages = after.messages.slice(before.messageCount);
  const visibleText = messagesText(newMessages);
  const screenshotPath = path.join(OUT_DIR, `${String(index + 1).padStart(2, "0")}-${testCase.id}-dom.png`);
  const failures = [];

  if (after.timeout) {
    failures.push(`timed out waiting for assistant response after ${parsed.timeoutMs}ms`);
  }
  if (overlayBeforeSubmit.after?.present) {
    failures.push(`blocking overlay present before submit: ${JSON.stringify(overlayBeforeSubmit.after.overlays).slice(0, 700)}`);
  }
  const assistantVisibleText = assistantMessagesText(newMessages);
  if (!hasSubmittedUserMessage(newMessages)) {
    failures.push("submitted user message was not visible in the chat DOM");
  }
  if (!newMessages.some((message) => message.role === "assistant")) {
    failures.push("assistant message was not visible in the chat DOM");
  }
  const modelUnavailable = /这次没有拿到模型回复|当前模型没有通过认证|当前已选模型认证失败|Conversational reply unavailable/i.test(visibleText);
  if (modelUnavailable && !parsed.allowUnavailableSkip) {
    failures.push("assistant response was a model-unavailable status notice; pass --allow-unavailable-skip only when this is acceptable");
  }
  if (testCase.assertions?.noTools) {
    const toolResultCount = newMessages.reduce((sum, message) => sum + Number(message.toolResultCount || 0), 0);
    const thinkingText = newMessages.map((message) => `${message.thinkingPreview || ""} ${(message.thinkingBlockTitles || []).join(" ")}`).join("\n");
    if (toolResultCount > 0) failures.push(`expected no tools, saw toolResultCount=${toolResultCount}`);
    if (/工具调用|执行记录|tool/i.test(thinkingText)) failures.push("expected no tool activity in thinking blocks");
  }
  if (testCase.assertions?.noCannedCapabilityMenu && looksLikeCannedCapabilityMenu(assistantVisibleText)) {
    failures.push("old canned capability menu leaked into visible chat");
  }
  if (testCase.assertions?.noInternalStatus) {
    const markers = findForbiddenVisibleMarkers(assistantVisibleText);
    if (markers.length > 0) failures.push(`internal markers leaked: ${markers.join(", ")}`);
  }
  if (testCase.assertions?.noNoImageInventoryBlocker && /当前项目里没有可分析的图片资源/.test(visibleText)) {
    failures.push("project inventory read-only request fell back to the old no-image blocker");
  }
  if (testCase.assertions?.requiresProjectInventorySummary && !hasProjectInventoryEvidence(visibleText)) {
    failures.push("project inventory read-only request did not render the resource index summary");
  }

  const overlayBeforeScreenshot = await closeBlockingOverlays(page);
  const screenshotAnchor = await scrollScreenshotAnchorIntoView(page, newMessages);
  const screenshotResult = await captureBoundedViewportScreenshot(page, screenshotPath);
  const screenshotCaptured = screenshotResult.captured;
  if (!screenshotResult.captured) {
    failures.push(`screenshot capture failed: ${screenshotResult.error || "unknown screenshot error"}`);
  }
  const overflowProbe = await measureChatHorizontalOverflow(page);
  const messagesOverflow = overflowProbe.messages
    && overflowProbe.messages.scrollWidth > overflowProbe.messages.clientWidth + 2;
  if (messagesOverflow || overflowProbe.offenders.length > 0) {
    failures.push(`chat horizontal overflow: ${JSON.stringify(overflowProbe).slice(0, 900)}`);
  }

  return {
    id: testCase.id,
    prompt: testCase.prompt,
    kind: testCase.kind,
    status: modelUnavailable && failures.length === 0
      ? "model_unavailable"
      : failures.length > 0 ? "failed" : "passed",
    runtime: "dom_fallback",
    failures,
    reason: modelUnavailable && parsed.allowUnavailableSkip
      ? buildModelUnavailableCaseReason(parsed.modelReadiness)
      : undefined,
    newMessageCount: newMessages.length,
    visibleTextPreview: visibleText.replace(/\s+/g, " ").slice(0, 500),
    screenshotPath,
    screenshotCaptured,
    screenshotMethod: screenshotResult.method,
    screenshotAnchor,
    overlayBeforeSubmit,
    overlayBeforeScreenshot,
    horizontalOverflow: overflowProbe
  };
}

async function runCase(page, testCase, parsed, index) {
  if (testCase.kind === "execution" && !parsed.allowExecution) {
    return {
      id: testCase.id,
      prompt: testCase.prompt,
      status: "skipped",
      reason: "execution prompt skipped; pass --allow-execution to send it to the running window"
    };
  }
  if (testCase.kind === "execution" && parsed.executionBlockedReason) {
    return {
      id: testCase.id,
      prompt: testCase.prompt,
      kind: testCase.kind,
      status: "skipped",
      reason: parsed.executionBlockedReason
    };
  }

  const overlayBeforeSubmit = await closeBlockingOverlays(page);
  if (!parsed.preserveConversation || index === 0) {
    await withTimeout(page.evaluate(() => {
      if (typeof window.__DESIGNECHO_CHAT_TEST_BRIDGE__?.resetConversation === "function") {
        window.__DESIGNECHO_CHAT_TEST_BRIDGE__.resetConversation();
      }
    }), 3000, `ChatPanel test bridge reset(${testCase.id})`).catch(() => undefined);
  }
  const bridgeReady = await page.evaluate(() => {
    const bridge = window.__DESIGNECHO_CHAT_TEST_BRIDGE__;
    return Boolean(
      bridge
      && typeof bridge.getSnapshot === "function"
      && typeof bridge.submit === "function"
    );
  }).catch(() => false);
  if (!bridgeReady) {
    return runDomCase(page, testCase, parsed, index);
  }
  const before = await withTimeout(
    page.evaluate(() => window.__DESIGNECHO_CHAT_TEST_BRIDGE__.getSnapshot()),
    3000,
    `ChatPanel test bridge getSnapshot(${testCase.id}) before submit`
  );
  const bridgeSubmitFailures = [];
  let after = null;
  try {
    after = await withTimeout(
      page.evaluate(
        ({ prompt, timeoutMs }) => window.__DESIGNECHO_CHAT_TEST_BRIDGE__.submit(prompt, { timeoutMs }),
        { prompt: testCase.prompt, timeoutMs: parsed.timeoutMs }
      ),
      parsed.timeoutMs + 5000,
      `ChatPanel test bridge submit(${testCase.id})`
    );
  } catch (error) {
    bridgeSubmitFailures.push(error instanceof Error ? error.message : String(error));
    after = await page.evaluate(() => window.__DESIGNECHO_CHAT_TEST_BRIDGE__.getSnapshot()).catch(() => ({
      messageCount: before.messageCount,
      messages: before.messages || []
    }));
  }
  const newMessages = after.messages.slice(before.messageCount);
  const visibleText = messagesText(newMessages);
  const screenshotPath = path.join(OUT_DIR, `${String(index + 1).padStart(2, "0")}-${testCase.id}.png`);
  const failures = [...bridgeSubmitFailures];
  if (overlayBeforeSubmit.after?.present) {
    failures.push(`blocking overlay present before submit: ${JSON.stringify(overlayBeforeSubmit.after.overlays).slice(0, 700)}`);
  }
  const overlayBeforeScreenshot = await closeBlockingOverlays(page);
  if (overlayBeforeScreenshot.after?.present) {
    failures.push(`blocking overlay present before screenshot: ${JSON.stringify(overlayBeforeScreenshot.after.overlays).slice(0, 700)}`);
  }
  const screenshotAnchor = await scrollScreenshotAnchorIntoView(page, newMessages);
  if (screenshotAnchor.anchorMessageId && !screenshotAnchor.found) {
    failures.push(`screenshot anchor not found: ${screenshotAnchor.anchorMessageId}`);
  } else if (screenshotAnchor.found && !screenshotAnchor.visible) {
    failures.push(`screenshot anchor not visible: ${JSON.stringify(screenshotAnchor)}`);
  }
  const screenshotResult = await captureBoundedViewportScreenshot(page, screenshotPath);
  const screenshotCaptured = screenshotResult.captured;
  if (!screenshotResult.captured) {
    failures.push(`screenshot capture failed: ${screenshotResult.error || "unknown screenshot error"}`);
  }

  const assistantVisibleText = assistantMessagesText(newMessages);
  if (!hasSubmittedUserMessage(newMessages)) {
    failures.push("submitted user message was not visible in the chat snapshot");
  }
  if (!newMessages.some((message) => message.role === "assistant")) {
    failures.push("assistant message was not visible in the chat snapshot");
  }
  const assistantReplyOriginFailures = collectAssistantReplyOriginFailures(newMessages, testCase, {
    hasFakeModel: Boolean(parsed.hasFakeModel),
    allowModelUnavailable: Boolean(parsed.allowUnavailableSkip)
  });
  const modelUnavailable = Boolean(parsed.allowUnavailableSkip && isModelUnavailableOnlyCase(newMessages));
  if (assistantReplyOriginFailures.length > 0) {
    failures.push(...assistantReplyOriginFailures);
  }
  if (testCase.assertions?.noTools) {
    const toolResultCount = newMessages.reduce((sum, message) => sum + Number(message.toolResultCount || 0), 0);
    const thinkingText = newMessages.map((message) => `${message.thinkingPreview || ""} ${(message.thinkingBlockTitles || []).join(" ")}`).join("\n");
    if (toolResultCount > 0) failures.push(`expected no tools, saw toolResultCount=${toolResultCount}`);
    if (/工具调用|tool/i.test(thinkingText)) failures.push("expected no tool activity in thinking blocks");
  }
  if (testCase.assertions?.noCannedCapabilityMenu && looksLikeCannedCapabilityMenu(assistantVisibleText)) {
    failures.push("old canned capability menu leaked into visible chat");
  }
  if (testCase.assertions?.noInternalStatus && !modelUnavailable) {
    const markers = findForbiddenVisibleMarkers(assistantVisibleText);
    if (markers.length > 0) failures.push(`internal markers leaked: ${markers.join(", ")}`);
  }
  if (testCase.assertions?.noNoImageInventoryBlocker && /当前项目里没有可分析的图片资源/.test(visibleText)) {
    failures.push("project inventory read-only request fell back to the old no-image blocker");
  }
  if (testCase.assertions?.requiresProjectInventorySummary && !hasProjectInventoryEvidence(visibleText)) {
    failures.push("project inventory read-only request did not render the resource index summary");
  }
  if (testCase.assertions?.requiresProjectInventorySummary && /先看一下当前画面|先查看项目、文档或图层信息|读取完成后展示判断结果/.test(visibleText)) {
    failures.push("project inventory read-only request rendered a separate process card instead of only the result summary");
  }
  if (
    testCase.kind === "read_only"
    && hasAssistantBlockerNotice(newMessages)
    && /先看一下当前画面|先查看项目、文档或图层信息|读取完成后展示判断结果/.test(visibleText)
  ) {
    failures.push("read-only blocker should not render a separate read-only process card");
  }
  const repeatedVisiblePhrases = findRepeatedVisiblePhrases(assistantVisibleText);
  if (repeatedVisiblePhrases.length > 0) {
    failures.push(`duplicate visible phrases: ${repeatedVisiblePhrases.join(", ")}`);
  }
  const overflowProbe = await measureChatHorizontalOverflow(page);
  const messagesOverflow = overflowProbe.messages
    && overflowProbe.messages.scrollWidth > overflowProbe.messages.clientWidth + 2;
  if (messagesOverflow || overflowProbe.offenders.length > 0) {
    failures.push(`chat horizontal overflow: ${JSON.stringify(overflowProbe).slice(0, 900)}`);
  }

  let acceptanceDebug = null;
  let acceptanceDebugSummary = null;
  if (testCase.acceptanceCase) {
    try {
      acceptanceDebug = await readCaseAcceptanceDebug(page, testCase, newMessages);
      acceptanceDebugSummary = summarizeAcceptanceDebug(acceptanceDebug);
    } catch (error) {
      failures.push(`acceptance debug export failed: ${error?.message || String(error)}`);
    }
    if (acceptanceDebug) {
      failures.push(...collectAcceptanceDebugFailures(testCase, acceptanceDebug));
    }
  }

  return {
    id: testCase.id,
    prompt: testCase.prompt,
    kind: testCase.kind,
    status: modelUnavailable && failures.length === 0
      ? "model_unavailable"
      : failures.length > 0 ? "failed" : "passed",
    failures,
    reason: modelUnavailable && failures.length === 0
      ? buildModelUnavailableCaseReason(parsed.modelReadiness)
      : undefined,
    newMessageCount: newMessages.length,
    assistantReplyOrigins: summarizeAssistantReplyOrigins(newMessages),
    conversationalFailures: newMessages
      .filter((message) => message.role === "assistant" && message.conversationalFailureKind)
      .map((message) => ({
        id: message.id,
        kind: message.conversationalFailureKind,
        attempts: Array.isArray(message.conversationalFailureAttempts)
          ? message.conversationalFailureAttempts.slice(0, 4)
          : []
      })),
    visibleTextPreview: visibleText.replace(/\s+/g, " ").slice(0, 500),
    screenshotPath,
    screenshotCaptured,
    screenshotMethod: screenshotResult.method,
    screenshotAnchor,
    overlayBeforeSubmit,
    overlayBeforeScreenshot,
    horizontalOverflow: overflowProbe,
    acceptanceDebugSummary
  };
}

async function inspectRunningWindow(parsed) {
  const versionUrl = `http://127.0.0.1:${parsed.port}/json/version`;
  await fetchJson(versionUrl);

  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${parsed.port}`);
  try {
    let page = await findChatBridgePage(browser);
    const hasMountedTestBridge = Boolean(page);
    if (!page) {
      page = await findDesignEchoPage(browser);
    }
    if (!page) {
      return {
        success: Boolean(parsed.allowUnavailableSkip),
        skipped: true,
        reason: "CDP endpoint is available, but no DesignEcho ChatPanel page was found.",
        cases: [],
        checks: [
          "attached to a running Chromium/Electron CDP endpoint",
          "did not launch or close Electron"
        ]
      };
    }

    const pageInfo = await page.evaluate(() => ({
      url: window.location.href,
      title: document.title,
      query: window.location.search,
      hasBridge: Boolean(window.__DESIGNECHO_CHAT_TEST_BRIDGE__),
      hasFakeModel: new URLSearchParams(window.location.search).get("designechoChatTestFakeModel") === "1",
      hasFakePhotoshop: new URLSearchParams(window.location.search).get("designechoChatTestFakePhotoshop") === "1"
    }));
    const modelReadiness = await readRuntimeModelReadiness(page);
    const runningWindowBridge = hasMountedTestBridge
      ? await readRunningWindowBridgeReadiness(page)
      : {
        ok: false,
        reason: "chat test bridge is not mounted; DOM fallback inspection cannot read per-window bridge diagnostics"
      };
    const defaultMcpBridge = await readDefaultMcpBridgeReadiness(parsed.mcpEndpoint);
    const bridgeRuntimeMismatch = buildBridgeRuntimeMismatch(runningWindowBridge, defaultMcpBridge);
    const bridgeRequirementFailures = buildBridgeRequirementFailures(
      parsed,
      runningWindowBridge,
      defaultMcpBridge,
      bridgeRuntimeMismatch
    );
    const promptCasesBlockedReason = bridgeRequirementFailures.length > 0
      ? `prompt cases skipped because bridge requirements failed: ${bridgeRequirementFailures.join("; ")}`
      : "";

    const cases = [];
    const testCases = buildCases(parsed);
    if (shouldSkipPromptCasesForBridgeRequirementFailures(parsed, bridgeRequirementFailures)) {
      cases.push(...buildSkippedCasesForBridgeRequirementFailures(parsed, promptCasesBlockedReason));
      return buildRunningWindowInspectionResult({
        parsed,
        pageInfo,
        modelReadiness,
        runningWindowBridge,
        defaultMcpBridge,
        bridgeRuntimeMismatch,
        bridgeRequirementFailures,
        cases,
        hasMountedTestBridge,
        inProgress: false
      });
    }
    for (let index = 0; index < testCases.length; index += 1) {
      cases.push(hasMountedTestBridge
        ? await runCase(page, testCases[index], {
          ...parsed,
          hasFakeModel: pageInfo.hasFakeModel,
          modelReadiness,
          executionBlockedReason: promptCasesBlockedReason
        }, index)
        : await runDomCase(page, testCases[index], {
          ...parsed,
          modelReadiness,
          executionBlockedReason: promptCasesBlockedReason
        }, index));
      writeReports(buildRunningWindowInspectionResult({
        parsed,
        pageInfo,
        modelReadiness,
        runningWindowBridge,
        defaultMcpBridge,
        bridgeRuntimeMismatch,
        bridgeRequirementFailures,
        cases,
        hasMountedTestBridge,
        inProgress: index < testCases.length - 1
      }));
    }

    return buildRunningWindowInspectionResult({
      parsed,
      pageInfo,
      modelReadiness,
      runningWindowBridge,
      defaultMcpBridge,
      bridgeRuntimeMismatch,
      bridgeRequirementFailures,
      cases,
      hasMountedTestBridge,
      inProgress: false
    });
  } finally {
    await closeBrowserConnection(browser);
  }
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.selfTest) {
    runSelfTest();
    return;
  }
  ensureOutDir();

  let result;
  try {
    result = await inspectRunningWindow(parsed);
  } catch (error) {
    const unavailable = /ECONNREFUSED|Timed out requesting|connect/i.test(String(error?.message || error));
    const windowReadinessDiagnostics = unavailable
      ? await buildUnavailableWindowDiagnostics(parsed)
      : null;
    result = {
      success: unavailable ? Boolean(parsed.allowUnavailableSkip) : false,
      skipped: unavailable,
      reason: unavailable
        ? windowReadinessDiagnostics.reason
        : (error?.message || String(error)),
      windowReadinessDiagnostics,
      cases: [],
      checks: [
        "script did not launch or close Electron",
        "running window attachment requires DESIGNECHO_REMOTE_DEBUGGING_PORT and DESIGNECHO_CHAT_TEST_BRIDGE"
      ]
    };
  }

  writeReports(result);
  console.log(JSON.stringify(result, null, 2));
  if (!result.success) process.exit(1);
}

main().catch((error) => {
  const result = {
    success: false,
    error: error?.stack || String(error),
    cases: [],
    checks: []
  };
  writeReports(result);
  console.error(JSON.stringify(result, null, 2));
  process.exit(1);
});
