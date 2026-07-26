#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function assert(condition, message, details) {
  if (!condition) {
    const error = new Error(message);
    error.details = details;
    throw error;
  }
}

function loadMessageHandler(MCPProtocolHandler) {
  const sourcePath = path.join(root, 'src', 'core', 'message-handler.ts');
  const source = fs.readFileSync(sourcePath, 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020
    },
    fileName: sourcePath
  }).outputText;
  const module = { exports: {} };
  const localRequire = (request) => {
    if (request === '../tools/registry') return {};
    if (request === './mcp-protocol') return { MCPProtocolHandler };
    if (request === './photoshop-target-guard') {
      return {
        executeToolWithPhotoshopTargetGuard(tool, params, context) {
          return tool.execute(params, context);
        },
        stripPhotoshopTargetGuard(params) {
          return params;
        }
      };
    }
    if (request === './tool-error-normalizer') {
      return {
        createToolFailureResult(input) {
          return { success: false, error: String(input.error), data: null };
        }
      };
    }
    throw new Error(`Unexpected require: ${request}`);
  };
  new Function('require', 'module', 'exports', compiled)(localRequire, module, module.exports);
  return module.exports.MessageHandler;
}

async function verifyLateMcpCancellationPreservesCommitAndCleansRequest() {
  let releaseFirstCall;
  let markFirstCallStarted;
  const firstCallStarted = new Promise((resolve) => {
    markFirstCallStarted = resolve;
  });
  const firstCallBarrier = new Promise((resolve) => {
    releaseFirstCall = resolve;
  });
  let callCount = 0;
  class FakeMCPProtocolHandler {
    async handleMethod() {
      callCount += 1;
      if (callCount === 1) {
        markFirstCallStarted();
        await firstCallBarrier;
      }
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            photoshopMutationCommit: {
              version: 'photoshop-mutation-commit/v1',
              basis: 'same_execute_as_modal'
            }
          })
        }],
        isError: false
      };
    }
  }
  const MessageHandler = loadMessageHandler(FakeMCPProtocolHandler);
  const handler = new MessageHandler({ getTool() { return null; } });
  const pending = handler.handleToolCall('tools/call', { name: 'atomicWrite', arguments: {} }, 'request-55');
  await firstCallStarted;
  handler.handleNotification('notifications/cancelled', { requestId: 'request-55' });
  releaseFirstCall();
  const cancelledEnvelope = await pending;
  const cancelledPayload = JSON.parse(cancelledEnvelope.content[0].text);
  assert(cancelledPayload.success === true, 'late cancellation must not rewrite an already executed mutation as no-op failure');
  assert(cancelledPayload.photoshopMutationCommit, 'late MCP cancellation must retain the atomic commit payload');
  assert(
    cancelledPayload.cancellationRequestedAfterExecution === true,
    'late MCP cancellation must be disclosed inside the parsed Tool payload'
  );

  const reusedRequestEnvelope = await handler.handleToolCall(
    'tools/call',
    { name: 'atomicWrite', arguments: {} },
    'request-55'
  );
  const reusedRequestPayload = JSON.parse(reusedRequestEnvelope.content[0].text);
  assert(
    reusedRequestPayload.cancellationRequestedAfterExecution === undefined,
    'completed cancellation state must be removed so a reused request id is not poisoned'
  );
}

async function main() {
  const messageHandler = read('src/core/message-handler.ts');
  const mcpProtocol = read('src/core/mcp-protocol.ts');
  const toolTypes = read('src/tools/types.ts');
  const placeImage = read('src/tools/image/place-image.ts');
  const skuLayout = read('src/tools/layout/sku-layout-tool.ts');

  assert(
    messageHandler.includes('cancelledRequestIds = new Set<string>()')
      && messageHandler.includes("case 'notifications/cancelled'")
      && messageHandler.includes('this.cancelledRequestIds.add(String(params.requestId))'),
    'MessageHandler must remember MCP cancellation notifications by request id.'
  );
  assert(
    messageHandler.includes('requestIdKey && this.cancelledRequestIds.has(requestIdKey)')
      && messageHandler.includes('cancelled: true')
      && messageHandler.includes("error: '请求已取消'"),
    'MessageHandler must refuse requests that were already cancelled.'
  );
  assert(
    messageHandler.includes('isCancelled: () => Boolean(requestIdKey && this.cancelledRequestIds.has(requestIdKey))'),
    'MessageHandler must pass a live cancellation probe into tool execution context.'
  );
  assert(
    messageHandler.includes('finalizeRawCancelledResult')
      && messageHandler.includes('isRecord(result.photoshopMutationCommit)')
      && messageHandler.includes('cancellationRequestedAfterExecution: true')
      && messageHandler.includes('this.finalizeRequestCancellation(requestIdKey, result)'),
    'late cancellation must not discard a same-modal commit from a write that already executed.'
  );
  assert(
    messageHandler.includes('const executionContext = {')
      && messageHandler.includes('requestId,')
      && messageHandler.includes('isCancelled: () => Boolean(requestIdKey && this.cancelledRequestIds.has(requestIdKey))')
      && messageHandler.includes('this.mcpHandler.handleMethod(method, params, executionContext)'),
    'MessageHandler must pass the same cancellation context into MCP method handling.'
  );
  assert(
    mcpProtocol.includes("import { ToolExecutionContext } from '../tools/types'")
      && mcpProtocol.includes('async handleMethod(method: string, params: any, context?: ToolExecutionContext)')
      && mcpProtocol.includes('this.handleToolsCall(params, context)')
      && mcpProtocol.includes('executeToolWithPhotoshopTargetGuard(tool, args || {}, context)'),
    'MCPProtocolHandler must forward ToolExecutionContext into MCP tools/call execution.'
  );
  assert(
    toolTypes.includes('isCancelled?: () => boolean'),
    'ToolExecutionContext must expose an optional cancellation probe.'
  );
  assert(
    placeImage.includes('REQUEST_CANCELLED_ERROR')
      && placeImage.includes('isRequestCancelled(context)')
      && placeImage.includes('throwIfRequestCancelled(context)')
      && placeImage.includes('cancelled: true'),
    'PlaceImageTool must check cancellation before and during long image placement.'
  );
  assert(
    skuLayout.includes('REQUEST_CANCELLED_ERROR')
      && skuLayout.includes('activeExecutionContext?.isCancelled?.()')
      && skuLayout.includes('throwIfCancelled()')
      && skuLayout.includes('cancelled: true'),
    'SkuLayoutTool must check cancellation during layout/export execution.'
  );

  await verifyLateMcpCancellationPreservesCommitAndCleansRequest();

  console.log(JSON.stringify({
    success: true,
    checks: [
      'MCP cancellation notifications are remembered by request id',
      'tool execution receives a live cancellation probe',
      'late cancellation preserves an already-observed mutation commit',
      'MCP tools/call receives the same cancellation probe',
      'placeImage checks cancellation during long work',
      'skuLayout checks cancellation during layout/export work',
      'MCP late cancellation preserves the commit and clears request-scoped cancellation state'
    ]
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
