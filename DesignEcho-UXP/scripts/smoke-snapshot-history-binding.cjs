const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ts = require('typescript');

const ROOT = path.resolve(__dirname, '..');

function normalize(value) {
  return JSON.parse(JSON.stringify(value));
}

function createPhotoshopHarness() {
  let scenario = null;
  let modalDepth = 0;
  let historyReadCount = 0;
  let getPixelsCount = 0;
  let disposedSourceCount = 0;
  let disposedEncodedCount = 0;
  const events = [];

  function assertInsideModal(label) {
    assert(modalDepth > 0, `${label} must be read inside executeAsModal`);
  }

  function record(label, detail) {
    events.push({ label, detail, insideModal: modalDepth > 0 });
  }

  function guardedValue(label, value) {
    return {
      configurable: true,
      enumerable: true,
      get() {
        assertInsideModal(label);
        record(label);
        return value;
      }
    };
  }

  function createLayer(name, children) {
    const layer = {};
    Object.defineProperty(layer, 'name', guardedValue(`layer:${name}.name`, name));
    Object.defineProperty(layer, 'layers', guardedValue(`layer:${name}.layers`, children));
    return layer;
  }

  function createDocument(config) {
    const leaf = createLayer('leaf', undefined);
    const child = createLayer('child', undefined);
    const group = createLayer('group', [child]);
    const document = {};
    Object.defineProperty(document, 'id', guardedValue('document.id', config.documentId));
    Object.defineProperty(document, 'name', guardedValue('document.name', config.documentName));
    Object.defineProperty(document, 'width', guardedValue('document.width', config.width));
    Object.defineProperty(document, 'height', guardedValue('document.height', config.height));
    Object.defineProperty(document, 'layers', guardedValue('document.layers', [leaf, group]));
    Object.defineProperty(document, 'activeHistoryState', {
      configurable: true,
      enumerable: true,
      get() {
        assertInsideModal('document.activeHistoryState');
        const historyStateId = historyReadCount === 0
          ? config.historyBefore
          : config.historyAfter;
        historyReadCount += 1;
        record('document.activeHistoryState', historyStateId);
        if (historyStateId === undefined) return undefined;
        return { id: historyStateId };
      }
    });
    return document;
  }

  const app = {};
  Object.defineProperty(app, 'activeDocument', {
    configurable: true,
    enumerable: true,
    get() {
      assertInsideModal('app.activeDocument');
      record('app.activeDocument');
      return scenario.document;
    }
  });

  const photoshop = {
    app,
    core: {
      async executeAsModal(callback, options) {
        assert.strictEqual(modalDepth, 0, 'smoke expects one non-nested modal interval');
        modalDepth += 1;
        record('modal:enter', options);
        try {
          return await callback();
        } finally {
          record('modal:exit', options);
          modalDepth -= 1;
        }
      }
    },
    imaging: {
      async getPixels(options) {
        assertInsideModal('imaging.getPixels');
        getPixelsCount += 1;
        record('imaging.getPixels', normalize(options));
        const width = Number(options.targetSize.width);
        const height = Number(options.targetSize.height);
        const imageData = {};
        Object.defineProperty(imageData, 'width', guardedValue('imageData.width', width));
        Object.defineProperty(imageData, 'height', guardedValue('imageData.height', height));
        Object.defineProperty(imageData, 'components', guardedValue('imageData.components', 4));
        Object.defineProperty(imageData, 'componentSize', guardedValue('imageData.componentSize', 8));
        imageData.getData = async () => {
          assertInsideModal('imageData.getData');
          record('imageData.getData');
          const pixels = new Uint8Array(width * height * 4);
          pixels.fill(255);
          return pixels;
        };
        imageData.dispose = () => {
          assertInsideModal('source imageData.dispose');
          disposedSourceCount += 1;
          record('source imageData.dispose');
        };
        return { imageData };
      },
      async createImageDataFromBuffer(buffer, options) {
        assertInsideModal('imaging.createImageDataFromBuffer');
        record('imaging.createImageDataFromBuffer', {
          byteLength: buffer.byteLength,
          options: normalize(options)
        });
        return {
          dispose() {
            assertInsideModal('encoded imageData.dispose');
            disposedEncodedCount += 1;
            record('encoded imageData.dispose');
          }
        };
      },
      async encodeImageData() {
        assertInsideModal('imaging.encodeImageData');
        record('imaging.encodeImageData');
        return { base64: 'stable-jpeg' };
      }
    }
  };

  function reset(overrides = {}) {
    const config = {
      documentId: 41,
      documentName: 'history-bound.psd',
      width: 1200,
      height: 800,
      historyBefore: 701,
      historyAfter: 701,
      ...overrides
    };
    events.length = 0;
    modalDepth = 0;
    historyReadCount = 0;
    getPixelsCount = 0;
    disposedSourceCount = 0;
    disposedEncodedCount = 0;
    scenario = {
      config,
      document: createDocument(config)
    };
  }

  function getState() {
    return {
      events: events.slice(),
      getPixelsCount,
      disposedSourceCount,
      disposedEncodedCount,
      modalDepth
    };
  }

  reset();
  return { photoshop, reset, getState, assertInsideModal, record };
}

function resolveLocalModule(parentPath, request) {
  const unresolved = path.resolve(path.dirname(parentPath), request);
  const candidates = [
    unresolved,
    `${unresolved}.ts`,
    `${unresolved}.tsx`,
    path.join(unresolved, 'index.ts')
  ];
  const resolved = candidates.find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
  if (!resolved) {
    throw new Error(`unable to resolve ${request} from ${parentPath}`);
  }
  return resolved;
}

function createTypeScriptLoader(photoshop) {
  const cache = new Map();

  function load(modulePath) {
    const absolutePath = path.resolve(modulePath);
    if (cache.has(absolutePath)) return cache.get(absolutePath).exports;

    const source = fs.readFileSync(absolutePath, 'utf8');
    const compiled = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
        esModuleInterop: true
      },
      fileName: absolutePath
    }).outputText;
    const moduleRecord = { exports: {} };
    cache.set(absolutePath, moduleRecord);

    const sandbox = {
      module: moduleRecord,
      exports: moduleRecord.exports,
      require(request) {
        if (request === 'photoshop') return photoshop;
        if (request.startsWith('.')) return load(resolveLocalModule(absolutePath, request));
        throw new Error(`unexpected module ${request} from ${absolutePath}`);
      },
      console: {
        log() {},
        warn() {},
        error() {}
      },
      ArrayBuffer,
      Boolean,
      Error,
      Float32Array,
      JSON,
      Map,
      Math,
      Number,
      Promise,
      Set,
      String,
      Uint8Array,
      Uint16Array,
      btoa: (value) => Buffer.from(value, 'binary').toString('base64')
    };
    vm.runInNewContext(compiled, sandbox, { filename: absolutePath });
    return moduleRecord.exports;
  }

  return load;
}

function assertEventsWereInsideOneModal(events, requiredLabels) {
  const enterIndex = events.findIndex((event) => event.label === 'modal:enter');
  const exitIndex = events.findIndex((event) => event.label === 'modal:exit');
  assert(enterIndex >= 0, 'executeAsModal must be entered');
  assert(exitIndex > enterIndex, 'executeAsModal must exit after the observation');
  assert.strictEqual(events.filter((event) => event.label === 'modal:enter').length, 1);
  assert.strictEqual(events.filter((event) => event.label === 'modal:exit').length, 1);
  for (const label of requiredLabels) {
    const matchingIndexes = events
      .map((event, index) => event.label === label ? index : -1)
      .filter((index) => index >= 0);
    assert(matchingIndexes.length > 0, `${label} must be observed`);
    assert(matchingIndexes.every((index) => index > enterIndex && index < exitIndex),
      `${label} must stay inside the same executeAsModal callback`);
    assert(matchingIndexes.every((index) => events[index].insideModal),
      `${label} must be marked as a modal read`);
  }
}

function createGuardedRegion(harness, values) {
  const region = {};
  for (const key of ['x', 'y', 'width', 'height']) {
    Object.defineProperty(region, key, {
      enumerable: true,
      get() {
        harness.assertInsideModal(`region.${key}`);
        harness.record(`region.${key}`);
        return values[key];
      }
    });
  }
  const params = { maxSize: 250, format: 'jpeg' };
  Object.defineProperty(params, 'region', {
    enumerable: true,
    get() {
      harness.assertInsideModal('params.region');
      harness.record('params.region');
      return region;
    }
  });
  return params;
}

async function assertChangedHistoryFails(tool, params, harness) {
  harness.reset({ historyBefore: 701, historyAfter: 702 });
  const result = await tool.execute(params);
  assert.strictEqual(result.success, false, 'a history transition must discard the snapshot');
  assert.strictEqual(harness.getState().getPixelsCount, 1,
    'history changes after pixel capture must be detected by the post-read');
}

async function assertMissingHistoryFailsBeforePixels(tool, params, harness) {
  harness.reset({ historyBefore: undefined, historyAfter: undefined });
  const result = await tool.execute(params);
  assert.strictEqual(result.success, false, 'missing Host history identity must fail closed');
  assert.strictEqual(harness.getState().getPixelsCount, 0,
    'missing history identity must fail before imaging.getPixels');
}

async function run() {
  const harness = createPhotoshopHarness();
  const load = createTypeScriptLoader(harness.photoshop);
  const documentSnapshotPath = path.join(ROOT, 'src', 'tools', 'canvas', 'get-document-snapshot.ts');
  const visualAnalysisPath = path.join(ROOT, 'src', 'tools', 'canvas', 'visual-analysis.ts');
  const { GetDocumentSnapshotTool } = load(documentSnapshotPath);
  const { GetCanvasSnapshotTool } = load(visualAnalysisPath);
  const documentTool = new GetDocumentSnapshotTool();
  const canvasTool = new GetCanvasSnapshotTool();

  harness.reset();
  const documentResult = await documentTool.execute({ maxWidth: 600, maxHeight: 600, format: 'jpeg' });
  assert.strictEqual(documentResult.success, true);
  assert.deepStrictEqual(normalize(documentResult.historyStateRef), {
    documentId: 41,
    historyStateId: 701
  });
  assert.strictEqual(documentResult.width, 600);
  assert.strictEqual(documentResult.height, 400);
  assert.deepStrictEqual(normalize(documentResult.documentInfo), {
    id: 41,
    name: 'history-bound.psd',
    width: 1200,
    height: 800
  });
  let state = harness.getState();
  assert.strictEqual(state.getPixelsCount, 1);
  assert.strictEqual(state.disposedSourceCount, 1);
  assert.strictEqual(state.disposedEncodedCount, 1);
  assert.strictEqual(state.modalDepth, 0);
  assertEventsWereInsideOneModal(state.events, [
    'document.width',
    'document.height',
    'document.name',
    'document.activeHistoryState',
    'imaging.getPixels',
    'imageData.getData'
  ]);

  await assertChangedHistoryFails(documentTool, { maxWidth: 600, maxHeight: 600 }, harness);
  await assertMissingHistoryFailsBeforePixels(documentTool, { maxWidth: 600, maxHeight: 600 }, harness);

  harness.reset();
  const regionParams = createGuardedRegion(harness, { x: 100, y: 50, width: 500, height: 300 });
  const canvasResult = await canvasTool.execute(regionParams);
  assert.strictEqual(canvasResult.success, true);
  assert.deepStrictEqual(normalize(canvasResult.historyStateRef), {
    documentId: 41,
    historyStateId: 701
  });
  assert.deepStrictEqual(normalize(canvasResult.region), {
    x: 100,
    y: 50,
    width: 500,
    height: 300
  });
  assert.deepStrictEqual(normalize(canvasResult.snapshot), {
    base64: 'stable-jpeg',
    width: 250,
    height: 150,
    format: 'jpeg'
  });
  assert.deepStrictEqual(normalize(canvasResult.documentInfo), {
    id: 41,
    name: 'history-bound.psd',
    width: 1200,
    height: 800,
    layerCount: 3
  });
  state = harness.getState();
  const getPixelsEvent = state.events.find((event) => event.label === 'imaging.getPixels');
  assert.deepStrictEqual(getPixelsEvent.detail.sourceBounds, {
    left: 100,
    top: 50,
    right: 600,
    bottom: 350
  });
  assert.deepStrictEqual(getPixelsEvent.detail.targetSize, { width: 250, height: 150 });
  assertEventsWereInsideOneModal(state.events, [
    'document.width',
    'document.height',
    'document.name',
    'params.region',
    'region.x',
    'region.y',
    'region.width',
    'region.height',
    'document.layers',
    'layer:leaf.layers',
    'layer:group.layers',
    'layer:child.layers',
    'imaging.getPixels'
  ]);

  await assertChangedHistoryFails(canvasTool, { maxSize: 250 }, harness);
  await assertMissingHistoryFailsBeforePixels(canvasTool, { maxSize: 250 }, harness);

  console.log('snapshot history binding smoke passed');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
