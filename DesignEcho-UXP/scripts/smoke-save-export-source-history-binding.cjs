#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const ROOT = path.resolve(__dirname, '..');
const SOURCE_PATH = path.join(ROOT, 'src', 'tools', 'canvas', 'save-document.ts');

function loadSaveTools(harness) {
  const source = fs.readFileSync(SOURCE_PATH, 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020
    },
    fileName: SOURCE_PATH
  }).outputText;
  const module = { exports: {} };
  const localRequire = (request) => {
    if (request === 'photoshop') {
      return {
        app: harness.app,
        core: harness.core,
        action: harness.action
      };
    }
    if (request === 'uxp') {
      return {
        storage: {
          localFileSystem: {
            createSessionToken: async () => 'token'
          }
        }
      };
    }
    if (request === '../../core/jsx-bridge') {
      return {
        saveDocumentViaJsx: harness.saveDocumentViaJsx,
        saveActiveDocumentWithJsx: harness.saveDocumentViaJsx
      };
    }
    if (request === '../../core/file-url') {
      return { getEntryFromPath: async () => undefined };
    }
    if (request === '../../core/tool-error-normalizer') {
      return {
        createToolFailureResult(input) {
          return {
            success: false,
            error: String(input.error && input.error.message ? input.error.message : input.error),
            data: null
          };
        }
      };
    }
    if (request === '../../core/photoshop-history-state-ref') {
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
    if (request === '../types') return {};
    throw new Error(`Unexpected require: ${request}`);
  };
  new Function('require', 'module', 'exports', compiled)(localRequire, module, module.exports);
  return module.exports;
}

function createHarness(options = {}) {
  let modalDepth = 0;
  let jsxCallCount = 0;
  const refs = options.jsxRefs || [{ documentId: 41, historyStateId: 701 }];
  const document = {
    id: 41,
    name: 'delivery-source.psd',
    saved: true,
    width: 800,
    height: 800,
    activeHistoryState: options.missingHistory ? undefined : { id: 701 }
  };
  const app = { activeDocument: options.noDocument ? null : document };
  return {
    app,
    document,
    get modalDepth() { return modalDepth; },
    get jsxCallCount() { return jsxCallCount; },
    core: {
      async executeAsModal(callback) {
        modalDepth += 1;
        try {
          return await callback();
        } finally {
          modalDepth -= 1;
        }
      }
    },
    action: {
      async batchPlay() {
        assert(modalDepth > 0, 'save batchPlay must execute inside the existing modal');
        return [{}];
      }
    },
    async saveDocumentViaJsx(filePath) {
      const sourceHistoryStateRef = refs[Math.min(jsxCallCount, refs.length - 1)];
      jsxCallCount += 1;
      return {
        success: true,
        filePath,
        ...(sourceHistoryStateRef ? { sourceHistoryStateRef } : {})
      };
    }
  };
}

async function main() {
  const stableHarness = createHarness();
  const stableTools = loadSaveTools(stableHarness);
  const saveResult = await new stableTools.SaveDocumentTool().execute({ format: 'psd' });
  assert.strictEqual(saveResult.success, true);
  assert.deepStrictEqual(saveResult.sourceHistoryStateRef, { documentId: 41, historyStateId: 701 });
  assert.strictEqual(stableHarness.modalDepth, 0);

  const missingHistoryHarness = createHarness({ missingHistory: true });
  const missingHistoryTools = loadSaveTools(missingHistoryHarness);
  const missingHistoryResult = await new missingHistoryTools.SaveDocumentTool().execute({ format: 'psd' });
  assert.strictEqual(missingHistoryResult.success, true);
  assert.strictEqual(missingHistoryResult.sourceHistoryStateRef, undefined);

  const quickHarness = createHarness();
  const quickTools = loadSaveTools(quickHarness);
  const quickResult = await new quickTools.QuickExportTool().execute({
    outputPath: 'C:\\output\\delivery.png',
    format: 'png'
  });
  assert.strictEqual(quickResult.success, true);
  assert.deepStrictEqual(quickResult.sourceHistoryStateRef, { documentId: 41, historyStateId: 701 });
  assert.strictEqual(quickHarness.jsxCallCount, 1);

  const consistentBatchHarness = createHarness({
    jsxRefs: [
      { documentId: 41, historyStateId: 701 },
      { documentId: 41, historyStateId: 701 }
    ]
  });
  const consistentBatchTools = loadSaveTools(consistentBatchHarness);
  const consistentBatch = await new consistentBatchTools.BatchExportTool().execute({
    outputDirectory: 'C:\\output',
    presets: [
      { width: 800, height: 800, suffix: '_a' },
      { width: 400, height: 400, suffix: '_b' }
    ]
  });
  assert.strictEqual(consistentBatch.success, true);
  assert.strictEqual(consistentBatch.sourceHistoryStateVerified, true);
  assert.deepStrictEqual(consistentBatch.sourceHistoryStateRef, { documentId: 41, historyStateId: 701 });

  const mixedBatchHarness = createHarness({
    jsxRefs: [
      { documentId: 41, historyStateId: 701 },
      { documentId: 41, historyStateId: 702 }
    ]
  });
  const mixedBatchTools = loadSaveTools(mixedBatchHarness);
  const mixedBatch = await new mixedBatchTools.BatchExportTool().execute({
    outputDirectory: 'C:\\output',
    presets: [
      { width: 800, height: 800, suffix: '_a' },
      { width: 400, height: 400, suffix: '_b' }
    ]
  });
  assert.strictEqual(mixedBatch.success, true);
  assert.strictEqual(mixedBatch.sourceHistoryStateVerified, false);
  assert.strictEqual(mixedBatch.sourceHistoryStateRef, undefined);

  const noDocumentHarness = createHarness({ noDocument: true });
  const noDocumentTools = loadSaveTools(noDocumentHarness);
  const noDocumentResult = await new noDocumentTools.QuickExportTool().execute({
    outputPath: 'C:\\output\\missing.png'
  });
  assert.strictEqual(noDocumentResult.success, false);
  assert.strictEqual(noDocumentResult.sourceHistoryStateRef, undefined);

  const jsxBridgeSource = fs.readFileSync(path.join(ROOT, 'src', 'core', 'jsx-bridge.ts'), 'utf8');
  assert(
    jsxBridgeSource.includes('sourceDoc && sourceDoc.activeHistoryState ? sourceDoc.activeHistoryState.id'),
    'JSX export must bind the original sourceDoc history state, not a resized duplicate'
  );
  assert(
    jsxBridgeSource.includes('sourceHistoryStateRef'),
    'JSX bridge must normalize the source document revision into a dedicated field'
  );

  console.log(JSON.stringify({
    success: true,
    stableSave: saveResult.sourceHistoryStateRef,
    missingHistory: 'no receipt credit',
    quickExport: quickResult.sourceHistoryStateRef,
    batchConsistent: consistentBatch.sourceHistoryStateVerified,
    batchMixed: mixedBatch.sourceHistoryStateVerified,
    noDocument: 'failed without fabricated source ref'
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
