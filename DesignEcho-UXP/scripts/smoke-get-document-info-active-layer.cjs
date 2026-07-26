#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const sourcePath = path.join(root, 'src', 'tools', 'canvas', 'get-document-info.ts');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function loadTool(app, core) {
  const coreMock = core || { executeAsModal: async (callback) => callback() };
  const moduleCache = new Map();
  function loadTsModule(modulePath) {
    const normalizedPath = path.normalize(modulePath);
    if (moduleCache.has(normalizedPath)) return moduleCache.get(normalizedPath).exports;
    const source = fs.readFileSync(normalizedPath, 'utf8');
    const compiled = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020
      },
      fileName: normalizedPath
    }).outputText;
    const module = { exports: {} };
    moduleCache.set(normalizedPath, module);
    const localRequire = (request) => {
      if (request === 'photoshop') {
        return {
          app,
          core: coreMock
        };
      }
      if (request.startsWith('.')) {
        const resolved = path.resolve(path.dirname(normalizedPath), request);
        const tsPath = path.extname(resolved) ? resolved : `${resolved}.ts`;
        return loadTsModule(tsPath);
      }
      throw new Error(`Unexpected require: ${request}`);
    };

    new Function('require', 'module', 'exports', compiled)(localRequire, module, module.exports);
    return module.exports;
  }

  return loadTsModule(sourcePath).GetDocumentInfoTool;
}

function createDocument(activeLayers) {
  return {
    id: 41,
    name: 'detail-page.psd',
    width: 1200,
    height: 3600,
    resolution: 72,
    mode: 'RGBColorMode',
    activeHistoryState: { id: 1001 },
    layers: [{ id: 7, name: 'Unselected fallback candidate' }],
    activeLayers
  };
}

async function main() {
  const selectedLayer = { id: 23, name: '卖点标题' };
  const selectedDocument = createDocument([selectedLayer]);
  const ToolWithSelection = loadTool({ activeDocument: selectedDocument });
  const selectedResult = await new ToolWithSelection().execute({});

  assert(selectedResult.success === true, 'document read should succeed');
  assert(selectedResult.documentState === 'present', 'a successful Host read must report documentState=present');
  assert(Number.isFinite(Date.parse(selectedResult.observedAt)), 'document read must include a Host observation timestamp');
  assert(selectedResult.document.activeLayerId === 23, 'activeLayerId should come from doc.activeLayers[0]');
  assert(selectedResult.document.activeLayerName === '卖点标题', 'activeLayerName should come from doc.activeLayers[0]');
  assert(selectedResult.historyStateRef.documentId === 41, 'successful read must bind the active document id');
  assert(selectedResult.historyStateRef.historyStateId === 1001, 'successful read must bind the Host history state id');

  const unselectedDocument = createDocument([]);
  const ToolWithoutSelection = loadTool({ activeDocument: unselectedDocument });
  const unselectedResult = await new ToolWithoutSelection().execute({});

  assert(unselectedResult.success === true, 'document read should remain successful without an active layer');
  assert(!Object.hasOwn(unselectedResult.document, 'activeLayerId'), 'missing selection must not fabricate activeLayerId');
  assert(!Object.hasOwn(unselectedResult.document, 'activeLayerName'), 'missing selection must not fall back to document layers');

  const ToolWithoutDocument = loadTool({ activeDocument: undefined });
  const noDocumentResult = await new ToolWithoutDocument().execute({});
  assert(noDocumentResult.success === false, 'missing document must remain a failed document read');
  assert(noDocumentResult.documentState === 'absent', 'Host must report missing document structurally');
  assert(noDocumentResult.errorCode === 'no_active_document', 'Host must not rely on localized error text for document state');

  const missingHistoryDocument = createDocument([]);
  delete missingHistoryDocument.activeHistoryState;
  const ToolWithoutHistory = loadTool({ activeDocument: missingHistoryDocument });
  const missingHistoryResult = await new ToolWithoutHistory().execute({});
  assert(missingHistoryResult.success === false, 'missing Host revision must fail closed');
  assert(missingHistoryResult.errorCode === 'history_state_unavailable', 'missing Host revision must be machine-readable');

  const changingDocument = createDocument([]);
  let historyReadCount = 0;
  Object.defineProperty(changingDocument, 'activeHistoryState', {
    get() {
      historyReadCount += 1;
      return { id: historyReadCount === 1 ? 1001 : 1002 };
    }
  });
  const ToolWithChangingHistory = loadTool({ activeDocument: changingDocument });
  const changingHistoryResult = await new ToolWithChangingHistory().execute({});
  assert(changingHistoryResult.success === false, 'Host revision changes during observation must discard the read');
  assert(changingHistoryResult.errorCode === 'document_changed_during_observation', 'revision changes must be machine-readable');

  // modal/超时类 executeAsModal 拒绝是瞬时故障：必须透出 retryable、保持 unknown，
  // 文案不得包含「没有打开的文档」触发字样（上游会按该字样判定无文档并禁止复核）。
  const modalRejectingCore = {
    executeAsModal: async () => { throw new Error('host is in a modal state'); }
  };
  const ToolWithModalHost = loadTool({ activeDocument: createDocument([]) }, modalRejectingCore);
  const modalResult = await new ToolWithModalHost().execute({});
  assert(modalResult.success === false, 'modal rejection must remain a failed read');
  assert(modalResult.documentState === 'unknown', 'modal rejection must not be misreported as absent');
  assert(modalResult.errorCode === 'get_document_info_failed', 'modal rejection must keep a generic machine code');
  assert(modalResult.retryable === true, 'modal rejection must surface retryable semantics');
  assert(!/没有打开的文档|没有活动文档|no active document/i.test(modalResult.error), 'busy copy must not contain the no-document trigger phrase');
  assert(modalResult.error.includes('这不代表文档不存在'), 'busy copy must say honestly that the document may still exist');

  console.log(JSON.stringify({
    success: true,
    checks: [
      'active layer identity is read from doc.activeLayers[0]',
      'Host observation timestamp is returned with the same read',
      'Host document state is structured instead of inferred from localized error text',
      'Host document/history identity is returned from the same stable observation',
      'missing or changing Host revision fails closed',
      'document read remains successful without an active layer',
      'no fallback layer identity is fabricated',
      'modal/busy rejections stay unknown and retryable instead of impersonating absent'
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
