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
  let layerCollectionReadCount = 0;
  const events = [];

  function assertInsideModal(label) {
    assert(modalDepth > 0, `${label} must be read inside executeAsModal`);
  }

  function record(label, detail) {
    events.push({ label, detail, insideModal: modalDepth > 0 });
  }

  function defineGuarded(target, property, label, value) {
    Object.defineProperty(target, property, {
      configurable: true,
      enumerable: true,
      get() {
        assertInsideModal(label);
        record(label);
        return typeof value === 'function' ? value() : value;
      }
    });
  }

  function createBounds(label, values) {
    const bounds = {};
    for (const property of ['left', 'top', 'right', 'bottom', 'width', 'height']) {
      defineGuarded(bounds, property, `${label}.${property}`, values[property]);
    }
    return bounds;
  }

  function createCharacterStyle() {
    const style = {};
    defineGuarded(style, 'size', 'text.characterStyle.size', 38);
    defineGuarded(style, 'font', 'text.characterStyle.font', 'MockSans');
    defineGuarded(style, 'fontStyle', 'text.characterStyle.fontStyle', 'Bold');
    defineGuarded(style, 'tracking', 'text.characterStyle.tracking', 20);
    defineGuarded(style, 'leading', 'text.characterStyle.leading', 48);
    defineGuarded(style, 'horizontalScale', 'text.characterStyle.horizontalScale', 100);
    defineGuarded(style, 'verticalScale', 'text.characterStyle.verticalScale', 100);
    return style;
  }

  function createTextItem() {
    const textItem = {};
    defineGuarded(textItem, 'contents', 'text.textItem.contents', '真实验收文案');
    defineGuarded(textItem, 'characterStyle', 'text.textItem.characterStyle', createCharacterStyle());
    return textItem;
  }

  function createLayer(config) {
    const layer = {};
    defineGuarded(layer, 'id', `layer:${config.label}.id`, config.id);
    defineGuarded(layer, 'name', `layer:${config.label}.name`, config.name);
    defineGuarded(layer, 'kind', `layer:${config.label}.kind`, config.kind);
    defineGuarded(layer, 'visible', `layer:${config.label}.visible`, config.visible !== false);
    defineGuarded(layer, 'locked', `layer:${config.label}.locked`, false);
    defineGuarded(layer, 'allLocked', `layer:${config.label}.allLocked`, false);
    defineGuarded(layer, 'opacity', `layer:${config.label}.opacity`, 100);
    defineGuarded(layer, 'blendMode', `layer:${config.label}.blendMode`, 'normal');
    defineGuarded(layer, 'bounds', `layer:${config.label}.bounds`, createBounds(
      `layer:${config.label}.boundsValue`,
      config.bounds || { left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100 }
    ));
    defineGuarded(layer, 'boundsNoEffects', `layer:${config.label}.boundsNoEffects`, createBounds(
      `layer:${config.label}.boundsNoEffectsValue`,
      config.bounds || { left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100 }
    ));
    if (config.kind === 'TEXT') {
      defineGuarded(layer, 'textItem', `layer:${config.label}.textItem`, createTextItem());
    }
    if (config.kind === 'GROUP') {
      Object.defineProperty(layer, 'layers', {
        configurable: true,
        enumerable: true,
        get() {
          assertInsideModal(`layer:${config.label}.layers`);
          layerCollectionReadCount += 1;
          record(`layer:${config.label}.layers`);
          return config.layers;
        }
      });
    }
    return layer;
  }

  function createDocument(config) {
    const textLayer = createLayer({
      label: 'text',
      id: 33,
      name: '主标题',
      kind: 'TEXT',
      bounds: { left: 40, top: 50, right: 440, bottom: 120, width: 400, height: 70 }
    });
    const groupLayer = createLayer({
      label: 'group',
      id: 22,
      name: '文字组',
      kind: 'GROUP',
      layers: [textLayer],
      bounds: { left: 40, top: 50, right: 440, bottom: 120, width: 400, height: 70 }
    });
    const pixelLayer = createLayer({
      label: 'pixel',
      id: 11,
      name: '产品图',
      kind: 'PIXEL',
      bounds: { left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600 }
    });
    const document = {};
    defineGuarded(document, 'id', 'document.id', config.documentId);
    defineGuarded(document, 'name', 'document.name', config.documentName);
    defineGuarded(document, 'width', 'document.width', 800);
    defineGuarded(document, 'height', 'document.height', 600);
    defineGuarded(document, 'resolution', 'document.resolution', 72);
    defineGuarded(document, 'mode', 'document.mode', 'RGBColorMode');
    defineGuarded(document, 'activeLayers', 'document.activeLayers', [textLayer]);
    Object.defineProperty(document, 'layers', {
      configurable: true,
      enumerable: true,
      get() {
        assertInsideModal('document.layers');
        layerCollectionReadCount += 1;
        record('document.layers');
        return [pixelLayer, groupLayer];
      }
    });
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
        assert.strictEqual(modalDepth, 0, 'acceptance smoke expects one non-nested modal interval');
        modalDepth += 1;
        record('modal:enter', normalize(options));
        try {
          return await callback();
        } finally {
          record('modal:exit', normalize(options));
          modalDepth -= 1;
        }
      }
    }
  };

  function reset(overrides = {}) {
    const config = {
      documentId: 97,
      documentName: 'acceptance-bound.psd',
      historyBefore: 901,
      historyAfter: 901,
      noDocument: false,
      ...overrides
    };
    events.length = 0;
    modalDepth = 0;
    historyReadCount = 0;
    layerCollectionReadCount = 0;
    scenario = {
      config,
      document: config.noDocument ? null : createDocument(config)
    };
  }

  function getState() {
    return {
      events: events.slice(),
      modalDepth,
      historyReadCount,
      layerCollectionReadCount
    };
  }

  reset();
  return { photoshop, reset, getState };
}

function resolveLocalModule(parentPath, request) {
  const unresolved = path.resolve(path.dirname(parentPath), request);
  const candidates = [unresolved, `${unresolved}.ts`, `${unresolved}.tsx`, path.join(unresolved, 'index.ts')];
  const resolved = candidates.find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
  if (!resolved) throw new Error(`unable to resolve ${request} from ${parentPath}`);
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
      console: { log() {}, warn() {}, error() {} },
      Array,
      ArrayBuffer,
      Boolean,
      Date,
      Error,
      JSON,
      Map,
      Math,
      Number,
      Object,
      Promise,
      RegExp,
      Set,
      String
    };
    vm.runInNewContext(compiled, sandbox, { filename: absolutePath });
    return moduleRecord.exports;
  }

  return load;
}

function assertEventsWereInsideOneModal(events, requiredLabels) {
  const enterIndexes = events
    .map((event, index) => event.label === 'modal:enter' ? index : -1)
    .filter((index) => index >= 0);
  const exitIndexes = events
    .map((event, index) => event.label === 'modal:exit' ? index : -1)
    .filter((index) => index >= 0);
  assert.strictEqual(enterIndexes.length, 1, 'the tool must use exactly one executeAsModal callback');
  assert.strictEqual(exitIndexes.length, 1, 'the modal callback must exit exactly once');
  const enterIndex = enterIndexes[0];
  const exitIndex = exitIndexes[0];
  assert(exitIndex > enterIndex, 'the modal callback must exit after all observations');

  for (const label of requiredLabels) {
    const indexes = events
      .map((event, index) => event.label === label ? index : -1)
      .filter((index) => index >= 0);
    assert(indexes.length > 0, `${label} must be observed`);
    assert(indexes.every((index) => index > enterIndex && index < exitIndex),
      `${label} must stay inside the same executeAsModal callback`);
    assert(indexes.every((index) => events[index].insideModal),
      `${label} must be marked as a modal observation`);
  }
}

async function run() {
  const harness = createPhotoshopHarness();
  const load = createTypeScriptLoader(harness.photoshop);
  const toolPath = path.join(ROOT, 'src', 'tools', 'acceptance', 'get-acceptance-snapshot.ts');
  const { GetAcceptanceSnapshotTool } = load(toolPath);
  const tool = new GetAcceptanceSnapshotTool();

  harness.reset();
  const stable = await tool.execute({ includeHidden: true, includeBounds: true, includeText: true });
  assert.strictEqual(stable.success, true);
  assert.strictEqual(stable.hasDocument, true);
  assert.deepStrictEqual(normalize(stable.historyStateRef), {
    documentId: 97,
    historyStateId: 901
  });
  assert.strictEqual(stable.document.name, 'acceptance-bound.psd');
  assert.strictEqual(stable.summary.totalLayers, 3);
  assert.deepStrictEqual(normalize(stable.selectedLayerIds), [33]);
  assert.strictEqual(stable.layers[2].text.content, '真实验收文案');
  let state = harness.getState();
  assert.strictEqual(state.modalDepth, 0);
  assert.strictEqual(state.historyReadCount, 2);
  assertEventsWereInsideOneModal(state.events, [
    'app.activeDocument',
    'document.id',
    'document.activeHistoryState',
    'document.name',
    'document.width',
    'document.height',
    'document.resolution',
    'document.mode',
    'document.activeLayers',
    'document.layers',
    'layer:pixel.id',
    'layer:pixel.bounds',
    'layer:pixel.boundsValue.left',
    'layer:group.layers',
    'layer:text.name',
    'layer:text.boundsNoEffectsValue.bottom',
    'layer:text.textItem',
    'text.textItem.contents',
    'text.textItem.characterStyle',
    'text.characterStyle.font',
    'text.characterStyle.leading'
  ]);

  harness.reset({ historyBefore: undefined, historyAfter: undefined });
  const missing = await tool.execute({ includeHidden: true, includeBounds: true, includeText: true });
  assert.strictEqual(missing.success, false, 'missing Host history identity must fail closed');
  assert.strictEqual(missing.errorCode, 'history_state_unavailable');
  assert.strictEqual(missing.layers, undefined);
  state = harness.getState();
  assert.strictEqual(state.layerCollectionReadCount, 0,
    'missing history identity must fail before document layer traversal');
  assertEventsWereInsideOneModal(state.events, ['app.activeDocument', 'document.id', 'document.activeHistoryState']);

  harness.reset({ historyBefore: 901, historyAfter: 902 });
  const changed = await tool.execute({ includeHidden: true, includeBounds: true, includeText: true });
  assert.strictEqual(changed.success, false, 'a Host history transition must discard the acceptance snapshot');
  assert.strictEqual(changed.errorCode, 'document_changed_during_observation');
  assert.strictEqual(changed.layers, undefined);
  assert.strictEqual(changed.summary, undefined);
  state = harness.getState();
  assert(state.layerCollectionReadCount > 0, 'changed-history case must exercise the complete acceptance read');
  assert.strictEqual(state.historyReadCount, 2);
  assertEventsWereInsideOneModal(state.events, [
    'app.activeDocument',
    'document.activeHistoryState',
    'document.layers',
    'layer:text.textItem',
    'text.textItem.contents',
    'layer:text.boundsValue.right'
  ]);

  harness.reset({ noDocument: true });
  const empty = await tool.execute({ includeHidden: true, includeBounds: true, includeText: true });
  assert.strictEqual(empty.success, true, 'no active document is an honest empty observation');
  assert.strictEqual(empty.hasDocument, false);
  assert.strictEqual(empty.historyStateRef, undefined);
  assert.strictEqual(empty.layers, undefined);
  state = harness.getState();
  assert.strictEqual(state.historyReadCount, 0);
  assert.strictEqual(state.layerCollectionReadCount, 0);
  assertEventsWereInsideOneModal(state.events, ['app.activeDocument']);

  console.log('acceptance snapshot history binding smoke passed');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
