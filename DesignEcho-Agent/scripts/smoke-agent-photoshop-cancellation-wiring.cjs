const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

require('ts-node').register({
  transpileOnly: true,
  project: path.join(root, 'tsconfig.main.json'),
  compilerOptions: { module: 'CommonJS', moduleResolution: 'node' }
});

const { WebSocketServer } = require(path.join(root, 'src', 'main', 'websocket', 'server.ts'));

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function assertIncludes(file, text, label) {
  const content = read(file);
  if (!content.includes(text)) {
    throw new Error(`${label}: missing ${text} in ${file}`);
  }
}

assertIncludes('src/main/preload.ts', 'sendToPluginCancellable', 'preload exposes cancellable Photoshop request');
assertIncludes('src/main/preload.ts', 'cancelPluginRequest', 'preload exposes Photoshop request cancellation');
assertIncludes('src/main/ipc-handlers/websocket-handlers.ts', "ipcMain.handle('ws:send-cancellable'", 'main process handles cancellable send');
assertIncludes('src/main/ipc-handlers/websocket-handlers.ts', "ipcMain.handle('ws:cancel'", 'main process handles cancellation');
assertIncludes('src/main/websocket/server.ts', 'requestKeyToId', 'websocket server tracks request keys');
assertIncludes('src/main/websocket/server.ts', 'cancelRequestByKey', 'websocket server can cancel pending request by key');
assertIncludes('src/main/websocket/server.ts', 'assertRequestKeyAvailable', 'websocket server rejects ambiguous concurrent request-key reuse');
assertIncludes('src/main/websocket/server.ts', 'takePendingRequest', 'websocket server has one pending-request cleanup owner');
assertIncludes('src/main/websocket/server.ts', 'rejectPendingBinaryRequests', 'websocket server terminates binary waiters with the connection generation');
assertIncludes('src/main/websocket/server.ts', 'clearReceivedBinaryCache', 'websocket server clears binary cache on replacement and shutdown');
assertIncludes('src/main/websocket/server.ts', 'if (this.pluginSocket !== socket) return;', 'late messages from a replaced socket are ignored');
assertIncludes('src/main/websocket/server.ts', 'targetSocket: WebSocket | null = this.pluginSocket', 'async responses retain their source socket identity');
assertIncludes('src/main/index.ts', "import { BinaryMessageType, getBinaryTypeName } from '../shared/binary-protocol';", 'binary cache handler loads protocol before accepting socket data');
if (read('src/main/index.ts').includes("await import('../shared/binary-protocol')")) {
  throw new Error('binary cache handler must not yield to a replacement connection before storing source data');
}
assertIncludes('src/main/websocket/server.ts', "this.sendNotification('notifications/cancelled'", 'websocket server notifies UXP about cancellation');
assertIncludes('src/main/websocket/server.ts', 'forwardMCPRequest(method: string, params: any, options: SendRequestOptions = {})', 'MCP forwarding accepts cancellation request keys');
assertIncludes('src/main/websocket/server.ts', 'const requestKey = String(options.requestKey || \'\').trim() || undefined;', 'MCP forwarding normalizes request key');
assertIncludes('src/main/websocket/server.ts', 'callMCPTool(name: string, args: any = {}, options: SendRequestOptions = {})', 'MCP tool calls can pass cancellation request keys');
assertIncludes('src/main/ipc-handlers/websocket-handlers.ts', "ipcMain.handle('mcp:tools:call-cancellable'", 'main process handles cancellable MCP tool calls');
assertIncludes('src/main/ipc-handlers/websocket-handlers.ts', "ipcMain.handle('mcp:tools:cancel'", 'main process exposes MCP cancellation');
assertIncludes('src/main/preload.ts', 'callMcpToolCancellable', 'preload exposes cancellable MCP tool call');
assertIncludes('src/main/preload.ts', 'cancelMcpToolRequest', 'preload exposes MCP tool cancellation');
assertIncludes('src/renderer/services/mcp-host.client.ts', 'export type McpToolCallOptions', 'renderer MCP client exposes cancellation options type');
assertIncludes('src/renderer/services/mcp-host.client.ts', 'options: McpToolCallOptions = {}', 'renderer MCP client accepts an AbortSignal option');
assertIncludes('src/renderer/services/mcp-host.client.ts', 'options.signal', 'renderer MCP client reads the shared AbortSignal');
assertIncludes('src/renderer/services/mcp-host.client.ts', "options.signal.addEventListener('abort'", 'renderer MCP client subscribes to cancellation');
assertIncludes('src/renderer/services/mcp-host.client.ts', 'cancelMcpToolRequest', 'renderer MCP client can cancel direct IPC MCP calls');
assertIncludes('src/renderer/services/mcp-host.client.ts', "callHostTool('photoshop.tools.cancel'", 'renderer MCP client can cancel MCP host forwarded Photoshop calls');
assertIncludes('src/renderer/services/mcp-host.client.ts', "invoke('mcp:tools:cancel'", 'renderer MCP client can cancel fallback IPC MCP calls');
assertIncludes('src/renderer/services/mcp-host.client.ts', 'buildCancelledMcpToolResult', 'renderer MCP client returns an explicit cancelled result');
assertIncludes('src/renderer/services/mcp-host.client.ts', 'normalizeMcpHostTimeoutMs', 'renderer MCP client normalizes per-call host timeouts');
assertIncludes('src/renderer/services/mcp-host.client.ts', 'DEFAULT_MCP_TOOL_CALL_TIMEOUT_MS', 'renderer MCP client separates real Photoshop tool timeout from health-check timeout');
assertIncludes('src/renderer/services/mcp-host.client.ts', 'timeoutMs: options.timeoutMs', 'renderer MCP host calls preserve tool-specific timeout budgets');
assertIncludes('src/renderer/services/mcp-host.client.ts', 'options.timeoutMs ?? DEFAULT_MCP_TOOL_CALL_TIMEOUT_MS', 'renderer MCP host calls must not use the 1.5s health-check timeout for real Photoshop tools');
assertIncludes('src/renderer/services/mcp-host.client.ts', 'originalMessage', 'renderer MCP client preserves original host failure when IPC fallback is unavailable');
assertIncludes('src/renderer/services/skill-executors/agent-panel-bridge.executor.ts', 'async execute({ params, callbacks, signal }: SkillExecuteParams)', 'agent panel bridge receives the shared AbortSignal');
assertIncludes('src/renderer/services/skill-executors/agent-panel-bridge.executor.ts', 'callPhotoshopMcpTool(mcpToolName, p.mcpArguments || {}, { signal })', 'agent panel bridge passes the shared AbortSignal into direct MCP tool calls');
assertIncludes('src/main/services/mcp-host-service.ts', 'requestKey: { type: \'string\' }', 'MCP host Photoshop tool call schema accepts requestKey');
assertIncludes('src/main/services/mcp-host-service.ts', 'this.wsServer.callMCPTool(toolName, toolArgs, requestKey ? { requestKey } : {})', 'MCP host forwards requestKey to Photoshop MCP tool call');
assertIncludes('src/renderer/services/tool-executor.service.ts', 'ToolCallExecutionOptions', 'tool executor accepts execution options');
assertIncludes('src/renderer/services/tool-executor.service.ts', 'sendToPluginWithCancellation', 'tool executor routes Photoshop calls through cancellable bridge');
assertIncludes('src/renderer/services/tool-executor.service.ts', "if (toolName === 'createTextLayer') return 60 * 1000", 'createTextLayer must get a real MCP host timeout budget');
assertIncludes('src/renderer/services/tool-executor.service.ts', 'signal?: AbortSignal;', 'acceptance snapshot capture accepts the shared AbortSignal');
assertIncludes('src/renderer/services/tool-executor.service.ts', '}, options.timeoutMs, { signal: options.signal }, \'getAcceptanceSnapshot\')', 'acceptance snapshot capture routes through the cancellable Photoshop bridge');
assertIncludes('src/renderer/services/tool-executor.service.ts', 'maybeAutoFocusAfterTool(toolName, finalParams, result, options)', 'auto focus follow-up receives the shared tool execution options');
assertIncludes('src/renderer/services/tool-executor.service.ts', 'const focusResult = await sendToPluginWithCancellation(', 'auto focus follow-up routes through the cancellable Photoshop bridge');
assertIncludes('src/renderer/services/skill-executors/autonomous-agent.executor.ts', 'executeToolCall(toolName, atomicExecutionParams, { signal })', 'autonomous agent passes abort signal to tool executor after role-aware target-guard normalization');
assertIncludes('src/renderer/services/skill-executors/main-image.executor.ts', 'async execute({ params, callbacks, context, signal }: SkillExecuteParams)', 'main-image controlled executor receives the shared AbortSignal');
assertIncludes('src/renderer/services/skill-executors/main-image.executor.ts', '{ signal: input.signal }', 'main-image controlled Photoshop calls preserve the shared AbortSignal');
assertIncludes('src/renderer/services/agent-runtime/agent.ts', 'cancelled: true', 'agent runtime treats cancellation as its own stop reason');
assertIncludes('../DesignEcho-UXP/src/core/websocket-client.ts', 'request.id', 'UXP passes request id into message handler');
assertIncludes('../DesignEcho-UXP/src/core/message-handler.ts', 'cancelledRequestIds', 'UXP message handler records cancelled request ids');
assertIncludes('../DesignEcho-UXP/src/tools/types.ts', 'ToolExecutionContext', 'UXP tools receive execution context');
assertIncludes('../DesignEcho-UXP/src/tools/image/place-image.ts', 'throwIfRequestCancelled', 'placeImage checks cancellation between Photoshop substeps');
assertIncludes('../DesignEcho-UXP/src/tools/layout/sku-layout-tool.ts', 'activeExecutionContext', 'skuLayout keeps request cancellation context');
assertIncludes('../DesignEcho-UXP/src/tools/layout/sku-layout-tool.ts', 'this.throwIfCancelled()', 'skuLayout checks cancellation during long loops');

const chatPanelSource = read('src/renderer/components/ChatPanel.tsx');
const handleSendStart = chatPanelSource.indexOf('const handleSend = async');
const handleSendEnd = chatPanelSource.indexOf('handleSendRef.current = handleSend;', handleSendStart);
const handleSendSource = chatPanelSource.slice(handleSendStart, handleSendEnd);
const handleSendBusyGuard = handleSendSource.indexOf('chatSubmissionInFlightRef.current || stateAtSend.isLoading');
const debugSubmitStart = chatPanelSource.indexOf('onDebugBridgeChatSubmit');
const debugBusyGuard = chatPanelSource.indexOf(
  'chatSubmissionInFlightRef.current || useAppStore.getState().isLoading',
  debugSubmitStart
);
const debugReset = chatPanelSource.indexOf('resetChatTestConversation();', debugSubmitStart);
if (!chatPanelSource.includes('const chatSubmissionInFlightRef = useRef(false);')
  || handleSendBusyGuard < 0
  || !handleSendSource.includes('chatSubmissionInFlightRef.current = true;')
  || !handleSendSource.includes('chatSubmissionInFlightRef.current = false;')
  || handleSendBusyGuard >= handleSendSource.indexOf('chatSubmissionInFlightRef.current = true;')
  || handleSendSource.indexOf('chatSubmissionInFlightRef.current = true;') >= handleSendSource.indexOf('setLoading(true);')
  || debugBusyGuard < 0
  || debugBusyGuard >= debugReset) {
  throw new Error('ChatPanel must reject concurrent UI/test/debug submissions before reset or Agent execution overlap');
}

function attachFakePluginSocket(server, sentRequests) {
  const socket = {
    readyState: 1,
    send(payload) {
      const parsed = JSON.parse(String(payload));
      if (parsed.id !== undefined) sentRequests.push(parsed);
    },
    close() {
      this.readyState = 3;
    }
  };
  server.pluginSocket = socket;
  return socket;
}

async function verifyRequestKeyLifecycle() {
  const server = new WebSocketServer(0);
  const sentRequests = [];
  attachFakePluginSocket(server, sentRequests);

  const first = server.sendRequest('first.tool', {}, 1000, { requestKey: 'shared-key' });
  let duplicateRejected = false;
  try {
    await server.sendRequest('duplicate.tool', {}, 1000, { requestKey: 'shared-key' });
  } catch (error) {
    duplicateRejected = String(error && error.message || error).includes('不能并发复用');
  }

  const firstRequest = sentRequests.find((request) => request.method === 'first.tool');
  server.handleResponse({ jsonrpc: '2.0', id: firstRequest.id, result: { success: true } });
  const firstResult = await first;

  const reused = server.sendRequest('reused.tool', {}, 1000, { requestKey: 'shared-key' });
  const reusedRequest = sentRequests.find((request) => request.method === 'reused.tool');
  server.handleResponse({ jsonrpc: '2.0', id: reusedRequest.id, result: { success: true } });
  const reusedResult = await reused;

  const stopped = server.sendRequest('stopped.tool', {}, 1000, { requestKey: 'shared-key' })
    .then(() => '', (error) => String(error && error.message || error));
  server.stop();
  const stoppedMessage = await stopped;

  attachFakePluginSocket(server, sentRequests);
  const afterRestart = server.sendRequest('after-restart.tool', {}, 1000, { requestKey: 'shared-key' });
  const afterRestartRequest = sentRequests.find((request) => request.method === 'after-restart.tool');
  server.handleResponse({ jsonrpc: '2.0', id: afterRestartRequest.id, result: { success: true } });
  const afterRestartResult = await afterRestart;

  if (!duplicateRejected
    || !firstResult?.success
    || !reusedResult?.success
    || stoppedMessage !== 'Server stopped'
    || !afterRestartResult?.success) {
    throw new Error('requestKey lifecycle race check failed');
  }
}

async function verifyConnectionGenerationIsolation() {
  const server = new WebSocketServer(0);
  const oldSent = [];
  const newSent = [];
  const oldSocket = attachFakePluginSocket(server, oldSent);
  let finishHandler;
  server.registerHandler('slow.inbound', async () => await new Promise((resolve) => {
    finishHandler = resolve;
  }));

  const handling = server.handleRequest({
    jsonrpc: '2.0',
    id: 77,
    method: 'slow.inbound',
    params: {}
  }, oldSocket);
  attachFakePluginSocket(server, newSent);
  finishHandler({ source: 'old-socket' });
  await handling;

  if (!oldSent.some((message) => message.id === 77 && message.result?.source === 'old-socket')
    || newSent.some((message) => message.id === 77)) {
    throw new Error('late inbound response crossed the UXP connection generation boundary');
  }
}

async function verifyBinaryLifecycle() {
  const server = new WebSocketServer(0);
  attachFakePluginSocket(server, []);

  const waiting = server.waitForBinaryData(91, 1000);
  let duplicateRejected = false;
  try {
    await server.waitForBinaryData(91, 1000);
  } catch (error) {
    duplicateRejected = String(error && error.message || error).includes('不能重复注册');
  }

  const firstCache = {
    header: { requestId: 92, type: 1, width: 1, height: 1 },
    imageData: Buffer.from([1]),
    timestamp: Date.now()
  };
  const secondCache = {
    header: { requestId: 92, type: 1, width: 1, height: 1 },
    imageData: Buffer.from([2]),
    timestamp: Date.now() + 1
  };
  server.cacheReceivedBinaryMessage(firstCache);
  server.cacheReceivedBinaryMessage(secondCache);
  const cached = server.takeReceivedBinaryCache(92);

  server.stop();
  const stoppedWait = await waiting;
  if (!duplicateRejected
    || cached?.imageData?.[0] !== 2
    || stoppedWait !== null
    || server.pendingBinaryRequests.size !== 0
    || server.receivedBinaryCache.size !== 0
    || server.receivedBinaryCacheTimers.size !== 0) {
    throw new Error('binary request/cache lifecycle race check failed');
  }
}

async function main() {
  await verifyRequestKeyLifecycle();
  await verifyConnectionGenerationIsolation();
  await verifyBinaryLifecycle();
  console.log('smoke-agent-photoshop-cancellation-wiring passed');
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
