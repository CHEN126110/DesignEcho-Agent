#!/usr/bin/env node
"use strict";

const fs = require("fs");
const net = require("net");
const os = require("os");
const path = require("path");
const { spawn, spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const TMP_ROOT = path.join(ROOT, "tmp");
const LAST_LAUNCH_JSON = path.join(TMP_ROOT, "chat-ui-debug-window-last-launch.json");

function usage() {
  return [
    "Usage: node scripts/launch-chat-ui-debug-window.cjs [--port 9223|auto] [--port-offset 20000] [--use-default-runtime-ports] [--preflight-only] [--log-file <path>] [--fake-model] [--fake-model-fixture <name>] [--fake-photoshop] [--empty-photoshop] [--isolated-user-data] [--seed-user-state] [--project <path>] [--self-test]",
    "",
    "Launches a persistent DesignEcho Electron window with the chat test bridge and a CDP port.",
    "This command does not close the window automatically; use inspect-chat-ui-running-window.cjs to attach to it.",
    "The debug window uses an isolated runtime port block by default so it does not disturb a normal running Agent window.",
    "Use --use-default-runtime-ports only for live validation against the normal Photoshop MCP bridge."
  ].join("\n");
}

function parseArgs(argv) {
  const parsed = {
    port: 9223,
    autoPort: false,
    portOffset: 20000,
    useDefaultRuntimePorts: false,
    preflightOnly: false,
    logFile: "",
    fakeModel: false,
    fakeModelFixture: "",
    fakePhotoshop: false,
    emptyPhotoshop: false,
    isolatedUserData: false,
    seedUserState: false,
    projectPath: "",
    selfTest: false
  };

  let explicitPortOffset = false;
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
      applyPortArg(parsed, argv[index + 1] || "");
      index += 1;
      continue;
    }
    if (arg.startsWith("--port=")) {
      applyPortArg(parsed, arg.slice("--port=".length));
      continue;
    }
    if (arg === "--port-offset") {
      parsed.portOffset = Number.parseInt(argv[index + 1], 10);
      explicitPortOffset = true;
      index += 1;
      continue;
    }
    if (arg.startsWith("--port-offset=")) {
      parsed.portOffset = Number.parseInt(arg.slice("--port-offset=".length), 10);
      explicitPortOffset = true;
      continue;
    }
    if (arg === "--use-default-runtime-ports") {
      parsed.useDefaultRuntimePorts = true;
      continue;
    }
    if (arg === "--preflight-only") {
      parsed.preflightOnly = true;
      continue;
    }
    if (arg === "--log-file") {
      parsed.logFile = argv[index + 1] || "";
      index += 1;
      continue;
    }
    if (arg.startsWith("--log-file=")) {
      parsed.logFile = arg.slice("--log-file=".length);
      continue;
    }
    if (arg === "--fake-model") {
      parsed.fakeModel = true;
      continue;
    }
    if (arg === "--fake-model-fixture") {
      parsed.fakeModelFixture = argv[index + 1] || "";
      index += 1;
      continue;
    }
    if (arg.startsWith("--fake-model-fixture=")) {
      parsed.fakeModelFixture = arg.slice("--fake-model-fixture=".length);
      continue;
    }
    if (arg === "--fake-photoshop") {
      parsed.fakePhotoshop = true;
      continue;
    }
    if (arg === "--empty-photoshop") {
      parsed.emptyPhotoshop = true;
      continue;
    }
    if (arg === "--isolated-user-data") {
      parsed.isolatedUserData = true;
      continue;
    }
    if (arg === "--seed-user-state") {
      parsed.seedUserState = true;
      parsed.isolatedUserData = true;
      continue;
    }
    if (arg === "--project") {
      parsed.projectPath = argv[index + 1] || "";
      index += 1;
      continue;
    }
    if (arg.startsWith("--project=")) {
      parsed.projectPath = arg.slice("--project=".length);
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (parsed.useDefaultRuntimePorts) {
    if (explicitPortOffset && parsed.portOffset !== 0) {
      throw new Error("--use-default-runtime-ports cannot be combined with a non-zero --port-offset.");
    }
    parsed.portOffset = 0;
  }

  if (!parsed.autoPort && (!Number.isInteger(parsed.port) || parsed.port < 1024 || parsed.port > 65535)) {
    throw new Error("--port must be an integer between 1024 and 65535.");
  }
  if (!Number.isInteger(parsed.portOffset) || parsed.portOffset < 0 || parsed.portOffset > 50000) {
    throw new Error("--port-offset must be an integer between 0 and 50000.");
  }

  return parsed;
}

function applyPortArg(parsed, value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "auto") {
    parsed.autoPort = true;
    parsed.port = 0;
    return;
  }
  parsed.autoPort = false;
  parsed.port = Number.parseInt(value, 10);
}

function resolveElectronBin() {
  try {
    return require("electron");
  } catch (error) {
    throw new Error(`Unable to resolve Electron binary. Run npm install first. ${error.message}`);
  }
}

function ensureBuiltApp() {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  const mainEntry = path.join(ROOT, pkg.main || "dist/main/main/index.js");
  const rendererEntry = path.join(ROOT, "dist", "renderer", "index.html");
  if (!fs.existsSync(mainEntry) || !fs.existsSync(rendererEntry)) {
    throw new Error("Missing built Electron output. Run npm run build before launching the debug window.");
  }
}

function buildEnv(parsed) {
  const projectPath = parsed.projectPath
    ? path.resolve(parsed.projectPath)
    : ensureDefaultProjectPath();
  const env = {
    ...process.env,
    DESIGNECHO_CHAT_TEST_BRIDGE: "1",
    DESIGNECHO_REMOTE_DEBUGGING_PORT: String(parsed.port),
    DESIGNECHO_PORT_OFFSET: String(parsed.portOffset),
    DESIGNECHO_SKIP_PORT_CLEANUP: "1",
    ELECTRON_DISABLE_SECURITY_WARNINGS: "true"
  };

  if (parsed.fakeModel) env.DESIGNECHO_CHAT_TEST_FAKE_MODEL = "1";
  if (parsed.fakeModelFixture) {
    env.DESIGNECHO_CHAT_TEST_FAKE_MODEL = "1";
    env.DESIGNECHO_CHAT_TEST_FAKE_MODEL_FIXTURE = parsed.fakeModelFixture;
  }
  if (parsed.fakePhotoshop) env.DESIGNECHO_CHAT_TEST_FAKE_PHOTOSHOP = "1";
  if (parsed.emptyPhotoshop) env.DESIGNECHO_CHAT_TEST_FAKE_PHOTOSHOP_EMPTY = "1";
  if (projectPath) env.DESIGNECHO_CHAT_TEST_PROJECT_PATH = projectPath;

  if (parsed.isolatedUserData) {
    const userDataDir = resolveIsolatedUserDataDir(parsed);
    fs.rmSync(userDataDir, { recursive: true, force: true });
    fs.mkdirSync(userDataDir, { recursive: true });
    if (parsed.seedUserState) {
      seedUserStateStore(userDataDir);
    }
    env.DESIGNECHO_TEST_USER_DATA_DIR = userDataDir;
  }

  return env;
}

function ensureDefaultProjectPath() {
  const projectPath = path.join(TMP_ROOT, "chat-ui-debug-project");
  const subdirs = ["assets", "PSD", "SKU", "main-image", "detail-page"];
  fs.mkdirSync(projectPath, { recursive: true });
  for (const subdir of subdirs) {
    fs.mkdirSync(path.join(projectPath, subdir), { recursive: true });
  }
  return projectPath;
}

function resolveIsolatedUserDataDir(parsed) {
  return path.join(TMP_ROOT, `chat-ui-debug-window-user-data-${parsed.port}`);
}

function getCurrentUserStateStorePath() {
  const appData = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
  return path.join(appData, "designecho-agent", "app-state-store.json");
}

function seedUserStateStore(userDataDir) {
  const source = getCurrentUserStateStorePath();
  if (!fs.existsSync(source)) return null;
  const destination = path.join(userDataDir, "app-state-store.json");
  fs.copyFileSync(source, destination);
  return { source, destination };
}

function resolveLaunchPorts(parsed) {
  const offset = Number(parsed.portOffset || 0);
  return [
    { label: "CDP remote debugging", port: parsed.port },
    { label: "Agent WebSocket bridge", port: 8765 + offset },
    { label: "Agent WebView server", port: 8766 + offset },
    { label: "Agent debug bridge", port: 8767 + offset },
    { label: "Agent MCP host", port: 8768 + offset }
  ];
}

function isTcpPortOpenOnHost(port, host) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ port, host });
    socket.setTimeout(350);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", () => resolve(false));
  });
}

async function isTcpPortOpen(port) {
  const checks = await Promise.all([
    isTcpPortOpenOnHost(port, "127.0.0.1"),
    isTcpPortOpenOnHost(port, "::1")
  ]);
  return checks.some(Boolean);
}

function buildAutoCdpPortCandidates() {
  return Array.from({ length: 18 }, (_, index) => 9223 + index);
}

async function resolveAutoCdpPort(parsed) {
  if (!parsed.autoPort) return parsed;
  for (const candidatePort of buildAutoCdpPortCandidates()) {
    if (!(await isTcpPortOpen(candidatePort))) {
      return {
        ...parsed,
        port: candidatePort,
        autoPortResolved: true
      };
    }
  }
  throw createNoUsageError(
    `No free CDP port was found in ${buildAutoCdpPortCandidates().join(", ")}. Close an old debug window or pass --port <free-port>.`
  );
}

function readPortOwnerSummary(port) {
  if (process.platform !== "win32") return "";
  const command = [
    "$items = Get-NetTCPConnection -LocalPort " + Number(port) + " -ErrorAction SilentlyContinue | Select-Object -First 8 LocalAddress,LocalPort,State,OwningProcess;",
    "$rows = foreach ($item in $items) {",
    "  $proc = Get-Process -Id $item.OwningProcess -ErrorAction SilentlyContinue;",
    "  [PSCustomObject]@{ LocalAddress=$item.LocalAddress; LocalPort=$item.LocalPort; State=$item.State.ToString(); OwningProcess=$item.OwningProcess; ProcessName=$proc.ProcessName; Path=$proc.Path }",
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
      const key = `${row.OwningProcess}:${row.ProcessName || ""}:${row.Path || ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      owners.push(`PID ${row.OwningProcess} ${row.ProcessName || "unknown"}${row.Path ? ` (${row.Path})` : ""}`);
    }
    return owners.join("; ");
  } catch {
    return String(result.stdout).trim().replace(/\s+/g, " ");
  }
}

function createNoUsageError(message) {
  const error = new Error(message);
  error.showUsage = false;
  return error;
}

async function assertLaunchPortsAvailable(parsed) {
  const ports = resolveLaunchPorts(parsed);
  const busy = [];
  const seen = new Set();
  for (const item of ports) {
    if (seen.has(item.port)) continue;
    seen.add(item.port);
    if (await isTcpPortOpen(item.port)) {
      busy.push({
        ...item,
        ownerSummary: readPortOwnerSummary(item.port)
      });
    }
  }
  if (busy.length === 0) return;

  const lines = [
    "Cannot launch the DesignEcho debug chat window because required ports are already in use.",
    ...busy.map((item) => [
      `- ${item.label}: ${item.port}`,
      item.ownerSummary ? `  owner: ${item.ownerSummary}` : ""
    ].filter(Boolean).join("\n")),
    "",
    parsed.useDefaultRuntimePorts
      ? "Default runtime ports are already occupied. Close or intentionally switch the existing Agent runtime before launching with --use-default-runtime-ports."
      : "Choose a different --port or --port-offset, or close the existing debug window using those ports."
  ];
  throw createNoUsageError(lines.join("\n"));
}

function runSelfTest() {
  const seeded9223 = parseArgs(["--port", "9223", "--seed-user-state"]);
  const seeded9224 = parseArgs(["--port", "9224", "--seed-user-state"]);
  const autoPort = parseArgs(["--port", "auto"]);
  const defaultRuntime = parseArgs(["--use-default-runtime-ports"]);
  const preflightOnly = parseArgs(["--preflight-only"]);
  if (autoPort.autoPort !== true || autoPort.port !== 0) {
    throw new Error("--port auto must preserve auto port mode until launch preflight resolves it");
  }
  if (!buildAutoCdpPortCandidates().includes(9223) || !buildAutoCdpPortCandidates().includes(9240)) {
    throw new Error("auto CDP port candidates must cover 9223 through 9240");
  }
  if (preflightOnly.preflightOnly !== true) {
    throw new Error("--preflight-only must be parsed as a launch preflight mode");
  }
  if (defaultRuntime.portOffset !== 0 || defaultRuntime.useDefaultRuntimePorts !== true) {
    throw new Error("--use-default-runtime-ports must force the default runtime port block");
  }
  assertThrows(
    () => parseArgs(["--use-default-runtime-ports", "--port-offset", "20000"]),
    "--use-default-runtime-ports cannot be combined with a non-zero --port-offset."
  );
  const dir9223 = resolveIsolatedUserDataDir(seeded9223);
  const dir9224 = resolveIsolatedUserDataDir(seeded9224);
  if (dir9223 === dir9224) {
    throw new Error("isolated debug userData directories must be port-specific");
  }
  if (!dir9223.endsWith("chat-ui-debug-window-user-data-9223")) {
    throw new Error(`unexpected userData dir for 9223: ${dir9223}`);
  }
  if (!dir9224.endsWith("chat-ui-debug-window-user-data-9224")) {
    throw new Error(`unexpected userData dir for 9224: ${dir9224}`);
  }
  const isolatedPorts = resolveLaunchPorts(seeded9223).map((item) => item.port);
  if (!isolatedPorts.includes(28768)) {
    throw new Error(`isolated runtime ports must include the offset MCP host port: ${isolatedPorts.join(",")}`);
  }
  const defaultPorts = resolveLaunchPorts(defaultRuntime).map((item) => item.port);
  for (const expectedPort of [8765, 8766, 8767, 8768]) {
    if (!defaultPorts.includes(expectedPort)) {
      throw new Error(`default runtime ports must include ${expectedPort}: ${defaultPorts.join(",")}`);
    }
  }
  console.log("launch-chat-ui-debug-window self-test passed");
}

function assertThrows(fn, expectedMessage) {
  try {
    fn();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes(expectedMessage)) return;
    throw new Error(`Expected error containing "${expectedMessage}", got "${message}"`);
  }
  throw new Error(`Expected function to throw "${expectedMessage}"`);
}

function openLogFile(parsed) {
  if (!parsed.logFile) return null;
  const resolvedLogFile = path.resolve(ROOT, parsed.logFile);
  fs.mkdirSync(path.dirname(resolvedLogFile), { recursive: true });
  const stream = fs.createWriteStream(resolvedLogFile, { flags: "a", encoding: "utf8" });
  stream.write(`\n\n[${new Date().toISOString()}] Launching DesignEcho debug chat window\n`);
  return { path: resolvedLogFile, stream };
}

function writeLastLaunchState(parsed, child) {
  fs.mkdirSync(TMP_ROOT, { recursive: true });
  fs.writeFileSync(LAST_LAUNCH_JSON, JSON.stringify({
    version: "chat-ui-debug-window-last-launch/v0",
    generatedAt: new Date().toISOString(),
    port: parsed.port,
    cdpEndpoint: `http://127.0.0.1:${parsed.port}`,
    portOffset: parsed.portOffset,
    useDefaultRuntimePorts: parsed.useDefaultRuntimePorts,
    autoPortResolved: Boolean(parsed.autoPortResolved),
    pid: child?.pid || null
  }, null, 2), "utf8");
}

async function main() {
  let parsed = parseArgs(process.argv.slice(2));
  if (parsed.selfTest) {
    runSelfTest();
    return;
  }
  parsed = await resolveAutoCdpPort(parsed);
  await assertLaunchPortsAvailable(parsed);
  if (parsed.preflightOnly) {
    console.log("DesignEcho debug chat window launch preflight passed.");
    if (parsed.autoPortResolved) {
      console.log(`Selected CDP port: ${parsed.port}`);
    }
    console.log(`Runtime port offset: ${parsed.portOffset}`);
    if (parsed.useDefaultRuntimePorts) {
      console.log("Default runtime ports are available for a debug window launch.");
    }
    return;
  }
  ensureBuiltApp();

  const electronBin = resolveElectronBin();
  const log = openLogFile(parsed);
  const child = spawn(electronBin, [ROOT], {
    cwd: ROOT,
    env: buildEnv(parsed),
    stdio: log ? ["ignore", "pipe", "pipe"] : "inherit",
    windowsHide: false
  });
  writeLastLaunchState(parsed, child);

  if (log) {
    child.stdout?.pipe(log.stream, { end: false });
    child.stderr?.pipe(log.stream, { end: false });
    child.on("exit", () => {
      log.stream.end(`[${new Date().toISOString()}] Electron child exited\n`);
    });
  }

  console.log(`DesignEcho debug chat window launched. cdp=http://127.0.0.1:${parsed.port}`);
  console.log(`Runtime port offset: ${parsed.portOffset}`);
  if (parsed.useDefaultRuntimePorts) {
    console.log("Default runtime ports enabled: this window may share the normal Photoshop MCP bridge.");
  }
  if (log) console.log(`Log file: ${log.path}`);
  console.log("Use: node scripts/inspect-chat-ui-running-window.cjs --port " + parsed.port);

  child.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 0);
  });
}

try {
  main().catch((error) => {
    console.error(error.message);
    if (error.showUsage !== false) {
      console.error("");
      console.error(usage());
    }
    process.exit(1);
  });
} catch (error) {
  console.error(error.message);
  if (error.showUsage !== false) {
    console.error("");
    console.error(usage());
  }
  process.exit(1);
}
