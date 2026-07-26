const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..', '..');

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function assertIncludes(text, expected, label) {
  if (!text.includes(expected)) {
    throw new Error(`${label} missing: ${expected}`);
  }
}

function assertNotIncludes(text, unexpected, label) {
  if (text.includes(unexpected)) {
    throw new Error(`${label} must not include: ${unexpected}`);
  }
}

function main() {
  const uxpClient = read('DesignEcho-UXP/src/core/websocket-client.ts');
  const uxpIndex = read('DesignEcho-UXP/src/index.ts');
  const wsServer = read('DesignEcho-Agent/src/main/websocket/server.ts');
  const websocketHandlers = read('DesignEcho-Agent/src/main/ipc-handlers/websocket-handlers.ts');
  const mcpHost = read('DesignEcho-Agent/src/main/services/mcp-host-service.ts');
  const toolExecutor = read('DesignEcho-Agent/src/renderer/services/tool-executor.service.ts');

  assertIncludes(uxpClient, 'private connectPromise: Promise<void> | null = null;', 'UXP reconnect single-flight guard');
  assertIncludes(uxpClient, 'private scheduleReconnect(reason: string): void', 'UXP persistent reconnect scheduler');
  assertIncludes(uxpClient, 'private forceReconnect(reason: string): void', 'UXP stale socket reconnect');
  assertIncludes(uxpClient, "this.forceReconnect('heartbeat-timeout');", 'UXP heartbeat timeout handling');
  assertIncludes(uxpClient, "this.scheduleReconnect('connect-exception');", 'UXP initial connect failure handling');
  assertNotIncludes(uxpClient, 'Max reconnect attempts reached, giving up', 'UXP reconnect must not permanently give up');
  assertIncludes(uxpIndex, 'void initializeConnection();', 'UXP panel show should start Agent connection in the background');
  assertIncludes(uxpIndex, '插件加载不能等待 Agent/WebSocket/MCP 初始化', 'UXP panel show should document the load-time boundary');
  assertNotIncludes(uxpIndex, 'renderPanel(node);\n                await initializeConnection();', 'UXP panel show must not await Agent connection during plugin load');

  assertIncludes(wsServer, 'export interface WebSocketConnectionDiagnostics', 'desktop connection diagnostics contract');
  assertIncludes(wsServer, 'private static readonly MAX_MISSED_NATIVE_PONGS = 3;', 'desktop native pong watchdog budget');
  assertIncludes(wsServer, "socket.on('pong'", 'desktop native pong listener');
  assertIncludes(wsServer, 'private sendNativePing(): void', 'desktop native ping sender');
  assertIncludes(wsServer, 'private closeStalePluginSocket(reason: string): void', 'desktop stale socket cleanup');
  assertIncludes(wsServer, 'getConnectionDiagnostics(): WebSocketConnectionDiagnostics', 'desktop diagnostics exporter');
  assertIncludes(wsServer, 'pendingRequestCount: this.pendingRequests.size', 'desktop pending MCP request count diagnostics');
  assertIncludes(wsServer, 'private getPendingRequestDiagnostics()', 'desktop pending MCP request detail diagnostics');
  assertIncludes(wsServer, 'private buildPluginRequestTimeoutError', 'desktop request timeout diagnostic builder');
  assertIncludes(wsServer, 'photoshop_native_modal_suspected', 'desktop timeout errors should classify suspected native Photoshop dialogs');
  assertIncludes(wsServer, 'private static readonly APP_HEARTBEAT_STALE_MS = 120000;', 'desktop app-level heartbeat stale threshold');
  assertIncludes(wsServer, 'appHeartbeatStale: this.isAppHeartbeatStale()', 'desktop diagnostics should expose app-level heartbeat staleness');
  assertIncludes(wsServer, 'private isAppHeartbeatStale(now: number = Date.now()): boolean', 'desktop app-level heartbeat stale detector');
  assertIncludes(wsServer, "this.closeStalePluginSocket('uxp app heartbeat stale during MCP request timeout');", 'desktop should close stale app-level socket after MCP timeout');
  assertIncludes(wsServer, 'if (this.pluginSocket === socket)', 'desktop current-socket close guard');

  assertIncludes(websocketHandlers, 'diagnostics: wsServer?.getConnectionDiagnostics?.() ?? null', 'IPC ws:status diagnostics');
  assertIncludes(mcpHost, 'diagnostics: this.wsServer.getConnectionDiagnostics()', 'MCP photoshop.connection_status diagnostics');
  assertIncludes(mcpHost, 'pluginConnectionDiagnostics: this.wsServer.getConnectionDiagnostics()', 'MCP system.status diagnostics');
  assertIncludes(toolExecutor, 'buildPhotoshopNativeModalSuspectedResult', 'renderer should convert Photoshop tool timeouts into visible modal feedback');
  assertIncludes(toolExecutor, 'errorCategory: \'photoshop_native_modal_suspected\'', 'renderer timeout feedback should expose a stable category');

  console.log(JSON.stringify({
    success: true,
    checks: [
      'UXP reconnect no longer has a permanent fixed-attempt give-up path',
      'UXP panel load does not await Agent/WebSocket/MCP initialization',
      'UXP heartbeat timeout force-closes stale sockets before reconnecting',
      'desktop WebSocket server has native ping/pong stale connection cleanup',
      'desktop WebSocket server closes app-level stale plugin sockets after MCP request timeouts',
      'desktop diagnostics expose pending MCP requests for popup/blocker triage',
      'ws:status, photoshop.connection_status and system.status expose diagnostics',
      'tool timeouts surface suspected Photoshop native dialog feedback instead of silent waiting'
    ]
  }, null, 2));
}

main();
