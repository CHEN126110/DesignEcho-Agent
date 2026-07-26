#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const sourcePath = path.join(root, 'src', 'core', 'photoshop-target-guard.ts');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function loadGuard(app) {
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
    if (request === 'photoshop') {
      return { app };
    }
    if (request === './photoshop-history-state-ref') {
      return {
        readActiveHistoryStateRef(document) {
          const documentId = Number(document && document.id);
          const historyStateId = Number(document && document.activeHistoryState && document.activeHistoryState.id);
          if (!Number.isSafeInteger(documentId) || documentId <= 0
            || !Number.isSafeInteger(historyStateId) || historyStateId <= 0) return undefined;
          return { documentId, historyStateId };
        },
        sameHistoryStateRef(left, right) {
          return Boolean(left && right
            && left.documentId === right.documentId
            && left.historyStateId === right.historyStateId);
        }
      };
    }
    throw new Error(`Unexpected require: ${request}`);
  };

  new Function('require', 'module', 'exports', compiled)(localRequire, module, module.exports);
  return module.exports;
}

function loadMcpProtocol(guardExports) {
  const mcpSourcePath = path.join(root, 'src', 'core', 'mcp-protocol.ts');
  const source = fs.readFileSync(mcpSourcePath, 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020
    },
    fileName: mcpSourcePath
  }).outputText;
  const module = { exports: {} };
  const localRequire = (request) => {
    if (request === './photoshop-target-guard') {
      return guardExports;
    }
    if (request === './tool-error-normalizer') {
      return {
        createToolFailureResult(input) {
          return { success: false, error: String(input.error), data: null };
        }
      };
    }
    if (request === '../tools/registry' || request === '../tools/types') {
      return {};
    }
    throw new Error(`Unexpected MCP require: ${request}`);
  };

  new Function('require', 'module', 'exports', compiled)(localRequire, module, module.exports);
  return module.exports.MCPProtocolHandler;
}

function createTool(calls) {
  return {
    name: 'protectedWrite',
    schema: {
      name: 'protectedWrite',
      description: 'test tool',
      parameters: { type: 'object', properties: {} }
    },
    async execute(params, context) {
      calls.push({ params, context });
      return { success: true, params };
    }
  };
}

function guardedParams(expectedDocumentId, expectedActiveLayerId, expectedHistoryStateId) {
  return {
    layerId: 73,
    __designEchoTargetGuard: {
      expectedDocumentId,
      ...(expectedActiveLayerId === undefined ? {} : { expectedActiveLayerId }),
      ...(expectedHistoryStateId === undefined ? {} : {
        expectedHistoryStateRef: {
          documentId: expectedDocumentId,
          historyStateId: expectedHistoryStateId
        }
      }),
      observationTool: 'getDocumentInfo'
    }
  };
}

async function main() {
  const app = {
    activeDocument: {
      id: 41,
      name: 'private-document-name.psd',
      activeHistoryState: { id: 701 },
      activeLayers: [{ id: 17, name: 'private-layer-name' }]
    }
  };
  const guardExports = loadGuard(app);
  const {
    executeToolWithPhotoshopTargetGuard,
    PHOTOSHOP_TARGET_GUARD_PARAM
  } = guardExports;
  const calls = [];
  const tool = createTool(calls);
  const isCancelled = () => false;
  const context = { requestId: 'request-1', isCancelled };

  const invalidGuard = await executeToolWithPhotoshopTargetGuard(
    tool,
    guardedParams(-1),
    context
  );
  assert(invalidGuard.success === false, 'non-positive Photoshop IDs must invalidate the guard');
  assert(calls.length === 0, 'invalid guard must not execute the business tool');

  const documentMismatch = await executeToolWithPhotoshopTargetGuard(
    tool,
    guardedParams(99, 17),
    context
  );
  assert(documentMismatch.success === false, 'document mismatch must fail');
  assert(
    documentMismatch.code === 'photoshop_target_changed_before_execution',
    'document mismatch must use the target-changed code'
  );
  assert(calls.length === 0, 'document mismatch must not execute the business tool');
  assert(documentMismatch.expected.documentId === 99, 'failure must include the expected document ID');
  assert(documentMismatch.actual.documentId === 41, 'failure must include the actual document ID');
  assert(!JSON.stringify(documentMismatch).includes('private-document-name'), 'failure must not expose document names');
  assert(!JSON.stringify(documentMismatch).includes('private-layer-name'), 'failure must not expose layer names');

  const layerMismatch = await executeToolWithPhotoshopTargetGuard(
    tool,
    guardedParams(41, 88),
    context
  );
  assert(layerMismatch.success === false, 'active layer mismatch must fail');
  assert(calls.length === 0, 'active layer mismatch must not execute the business tool');
  assert(layerMismatch.expected.activeLayerId === 88, 'failure must include the expected active layer ID');
  assert(layerMismatch.actual.activeLayerId === 17, 'failure must include the actual active layer ID');

  const historyMismatch = await executeToolWithPhotoshopTargetGuard(
    tool,
    guardedParams(41, 17, 700),
    context
  );
  assert(historyMismatch.success === false, 'history revision mismatch must fail');
  assert(historyMismatch.expected.historyStateId === 700, 'failure must include expected history revision');
  assert(historyMismatch.actual.historyStateId === 701, 'failure must include actual history revision');
  assert(calls.length === 0, 'history revision mismatch must not execute the business tool');

  app.activeDocument = null;
  const missingDocument = await executeToolWithPhotoshopTargetGuard(
    tool,
    guardedParams(41),
    context
  );
  assert(missingDocument.success === false, 'missing active document must fail closed');
  assert(calls.length === 0, 'missing active document must not execute the business tool');
  assert(missingDocument.actual.documentId === null, 'missing document must be represented without fabricated IDs');

  app.activeDocument = {
    id: 41,
    name: 'private-document-name.psd',
    activeHistoryState: { id: 701 },
    activeLayers: [{ id: 17, name: 'private-layer-name' }]
  };
  const matched = await executeToolWithPhotoshopTargetGuard(
    tool,
    guardedParams(41, 17, 701),
    context
  );
  assert(matched.success === true, 'matching document and layer must execute');
  assert(calls.length === 1, 'matching target must execute exactly once');
  assert(calls[0].params.layerId === 73, 'business params must be preserved');
  assert(
    !Object.hasOwn(calls[0].params, PHOTOSHOP_TARGET_GUARD_PARAM),
    'private target guard must be removed before business tool execution'
  );
  assert(calls[0].context !== context, 'guarded calls must derive a call-scoped execution context');
  assert(calls[0].context.requestId === context.requestId, 'requestId must survive guarded context derivation');
  assert(calls[0].context.isCancelled === isCancelled, 'cancellation probe must survive guarded context derivation');
  assert(!Object.hasOwn(context, 'photoshopTargetGuard'), 'the caller context must not be mutated');
  assert(
    calls[0].context.photoshopTargetGuard.expectedHistoryStateRef.historyStateId === 701,
    'the normalized Host revision guard must reach the business tool through call-scoped context'
  );
  assert(Object.isFrozen(calls[0].context.photoshopTargetGuard), 'the normalized guard must be readonly at runtime');
  assert(
    Object.isFrozen(calls[0].context.photoshopTargetGuard.expectedHistoryStateRef),
    'the nested Host revision ref must be readonly at runtime'
  );

  await executeToolWithPhotoshopTargetGuard(tool, guardedParams(41), context);
  assert(calls.length === 2, 'document-only guard must not require an active layer match');

  let releaseConcurrentCalls;
  const concurrentBarrier = new Promise((resolve) => {
    releaseConcurrentCalls = resolve;
  });
  const concurrentSnapshots = [];
  const concurrentTool = {
    ...createTool([]),
    async execute(params, callContext) {
      const before = callContext.photoshopTargetGuard.observationTool;
      await concurrentBarrier;
      concurrentSnapshots.push({
        marker: params.marker,
        before,
        after: callContext.photoshopTargetGuard.observationTool,
        context: callContext
      });
      return { success: true };
    }
  };
  const concurrentA = executeToolWithPhotoshopTargetGuard(concurrentTool, {
    marker: 'A',
    __designEchoTargetGuard: {
      expectedDocumentId: 41,
      expectedHistoryStateRef: { documentId: 41, historyStateId: 701 },
      observationTool: 'observation-A'
    }
  }, context);
  const concurrentB = executeToolWithPhotoshopTargetGuard(concurrentTool, {
    marker: 'B',
    __designEchoTargetGuard: {
      expectedDocumentId: 41,
      expectedHistoryStateRef: { documentId: 41, historyStateId: 701 },
      observationTool: 'observation-B'
    }
  }, context);
  releaseConcurrentCalls();
  await Promise.all([concurrentA, concurrentB]);
  concurrentSnapshots.sort((left, right) => left.marker.localeCompare(right.marker));
  assert(concurrentSnapshots.length === 2, 'both concurrent guarded calls must execute');
  assert(
    concurrentSnapshots[0].before === 'observation-A'
      && concurrentSnapshots[0].after === 'observation-A'
      && concurrentSnapshots[1].before === 'observation-B'
      && concurrentSnapshots[1].after === 'observation-B',
    'concurrent calls must retain their own guard for the full Tool lifetime'
  );
  assert(
    concurrentSnapshots[0].context !== concurrentSnapshots[1].context,
    'concurrent guarded calls must never share one mutable execution context'
  );

  const mcpCalls = [];
  const mcpTool = createTool(mcpCalls);
  const MCPProtocolHandler = loadMcpProtocol(guardExports);
  const mcpHandler = new MCPProtocolHandler({
    getTool(name) {
      return name === mcpTool.name ? mcpTool : null;
    }
  });
  const mcpMismatch = await mcpHandler.handleMethod('tools/call', {
    name: mcpTool.name,
    arguments: guardedParams(91, 17)
  }, context);
  const mcpMismatchPayload = JSON.parse(mcpMismatch.content[0].text);
  assert(mcpMismatch.isError === true, 'MCP tools/call must expose target mismatch as an error');
  assert(
    mcpMismatchPayload.code === 'photoshop_target_changed_before_execution',
    'MCP tools/call must preserve the target-changed code'
  );
  assert(mcpCalls.length === 0, 'MCP target mismatch must not execute the business tool');

  const mcpMatch = await mcpHandler.handleMethod('tools/call', {
    name: mcpTool.name,
    arguments: guardedParams(41, 17)
  }, context);
  assert(mcpMatch.isError === false, 'MCP matching target must execute successfully');
  assert(mcpCalls.length === 1, 'MCP matching target must execute once');
  assert(
    !Object.hasOwn(mcpCalls[0].params, PHOTOSHOP_TARGET_GUARD_PARAM),
    'MCP path must strip the private guard before execution'
  );
  assert(
    mcpCalls[0].context.photoshopTargetGuard.expectedDocumentId === 41,
    'MCP path must carry the normalized guard in call-scoped context'
  );

  const messageHandler = read('src/core/message-handler.ts');
  const mcpProtocol = read('src/core/mcp-protocol.ts');
  assert(
    messageHandler.includes('executeToolWithPhotoshopTargetGuard(tool, params, executionContext)'),
    'legacy MessageHandler calls must use the shared target guard owner'
  );
  assert(
    mcpProtocol.includes('executeToolWithPhotoshopTargetGuard(tool, args || {}, context)'),
    'MCP tools/call and MCP legacy calls must use the shared target guard owner'
  );

  console.log(JSON.stringify({
    success: true,
    checks: [
      'document mismatch fails closed without executing the tool',
      'invalid non-positive target IDs fail closed',
      'active layer mismatch fails closed without executing the tool',
      'Host history revision mismatch fails closed without executing the tool',
      'missing active document fails closed',
      'matching target derives an immutable call-scoped guard context with private params stripped',
      'concurrent calls cannot overwrite each other\'s guard context',
      'MCP tools/call behavior is guarded without a bypass',
      'legacy and MCP paths share one guard owner'
    ]
  }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({
    success: false,
    error: error instanceof Error ? error.message : String(error)
  }, null, 2));
  process.exit(1);
});
