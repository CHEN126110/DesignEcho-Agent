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
  let documentLayersReadCount = 0;
  let batchPlayCount = 0;
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
    defineGuarded(style, 'size', 'text.characterStyle.size', 32);
    defineGuarded(style, 'font', 'text.characterStyle.font', 'FallbackFont');
    defineGuarded(style, 'fontStyle', 'text.characterStyle.fontStyle', 'Regular');
    defineGuarded(style, 'tracking', 'text.characterStyle.tracking', 5);
    defineGuarded(style, 'leading', 'text.characterStyle.leading', 42);
    defineGuarded(style, 'horizontalScale', 'text.characterStyle.horizontalScale', 100);
    defineGuarded(style, 'verticalScale', 'text.characterStyle.verticalScale', 100);
    return style;
  }

  function createTextItem() {
    const textItem = {};
    defineGuarded(textItem, 'contents', 'text.textItem.contents', '版本绑定文案');
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
    defineGuarded(layer, 'opacity', `layer:${config.label}.opacity`, 100);
    defineGuarded(layer, 'blendMode', `layer:${config.label}.blendMode`, 'normal');
    defineGuarded(layer, 'isClippingMask', `layer:${config.label}.isClippingMask`, false);
    defineGuarded(layer, 'layers', `layer:${config.label}.layers`, config.layers);
    defineGuarded(layer, 'bounds', `layer:${config.label}.bounds`, createBounds(
      `layer:${config.label}.boundsValue`,
      config.bounds || { left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100 }
    ));
    if (config.kind === 'TEXT') {
      defineGuarded(layer, 'textItem', `layer:${config.label}.textItem`, createTextItem());
      defineGuarded(layer, 'boundsNoEffects', `layer:${config.label}.boundsNoEffects`, createBounds(
        `layer:${config.label}.boundsNoEffectsValue`,
        { left: 20, top: 30, right: 420, bottom: 100, width: 400, height: 70 }
      ));
    }
    return layer;
  }

  function createDocument(config) {
    const textLayer = createLayer({
      label: 'text',
      id: 31,
      name: '主标题',
      kind: 'TEXT',
      bounds: { left: 20, top: 30, right: 420, bottom: 100, width: 400, height: 70 }
    });
    const groupLayer = createLayer({
      label: 'group',
      id: 21,
      name: '文字组',
      kind: 'GROUP',
      layers: [textLayer],
      bounds: { left: 20, top: 30, right: 420, bottom: 100, width: 400, height: 70 }
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
    Object.defineProperty(document, 'layers', {
      configurable: true,
      enumerable: true,
      get() {
        assertInsideModal('document.layers');
        documentLayersReadCount += 1;
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

  function createUnitValue(label, value) {
    const unit = {};
    defineGuarded(unit, '_value', label, value);
    return unit;
  }

  function createDescriptorResult() {
    const textStyle = {};
    defineGuarded(textStyle, 'size', 'descriptor.textStyle.size', createUnitValue('descriptor.textStyle.size._value', 36));
    defineGuarded(textStyle, 'fontPostScriptName', 'descriptor.textStyle.fontPostScriptName', 'MockSans-Bold');
    defineGuarded(textStyle, 'tracking', 'descriptor.textStyle.tracking', 25);
    defineGuarded(textStyle, 'leading', 'descriptor.textStyle.leading', createUnitValue('descriptor.textStyle.leading._value', 48));
    defineGuarded(textStyle, 'horizontalScale', 'descriptor.textStyle.horizontalScale', 98);
    defineGuarded(textStyle, 'verticalScale', 'descriptor.textStyle.verticalScale', 102);

    const textStyleRange = {};
    defineGuarded(textStyleRange, 'textStyle', 'descriptor.textStyleRange.textStyle', textStyle);
    const alignment = {};
    defineGuarded(alignment, '_value', 'descriptor.paragraphStyle.align._value', 'left');
    const paragraphStyle = {};
    defineGuarded(paragraphStyle, 'align', 'descriptor.paragraphStyle.align', alignment);
    const paragraphStyleRange = {};
    defineGuarded(paragraphStyleRange, 'paragraphStyle', 'descriptor.paragraphStyleRange.paragraphStyle', paragraphStyle);
    const textKey = {};
    defineGuarded(textKey, 'textStyleRange', 'descriptor.textKey.textStyleRange', [textStyleRange]);
    defineGuarded(textKey, 'paragraphStyleRange', 'descriptor.textKey.paragraphStyleRange', [paragraphStyleRange]);
    const descriptor = {};
    defineGuarded(descriptor, 'textKey', 'descriptor.textKey', textKey);
    return [descriptor];
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
    constants: {
      LayerKind: {
        GROUP: 'GROUP',
        TEXT: 'TEXT'
      }
    },
    core: {
      async executeAsModal(callback, options) {
        assert.strictEqual(modalDepth, 0, 'structure smoke expects one non-nested modal interval');
        modalDepth += 1;
        record('modal:enter', normalize(options));
        try {
          return await callback();
        } finally {
          record('modal:exit', normalize(options));
          modalDepth -= 1;
        }
      }
    },
    action: {
      async batchPlay(descriptors, options) {
        assertInsideModal('action.batchPlay');
        batchPlayCount += 1;
        record('action.batchPlay', {
          descriptors: normalize(descriptors),
          options: normalize(options)
        });
        return createDescriptorResult();
      }
    }
  };

  function reset(overrides = {}) {
    const config = {
      documentId: 91,
      documentName: 'structure-bound.psd',
      historyBefore: 801,
      historyAfter: 801,
      ...overrides
    };
    events.length = 0;
    modalDepth = 0;
    historyReadCount = 0;
    documentLayersReadCount = 0;
    batchPlayCount = 0;
    scenario = {
      config,
      document: createDocument(config)
    };
  }

  function getState() {
    return {
      events: events.slice(),
      modalDepth,
      historyReadCount,
      documentLayersReadCount,
      batchPlayCount
    };
  }

  reset();
  return { photoshop, reset, getState };
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
    const matchingIndexes = events
      .map((event, index) => event.label === label ? index : -1)
      .filter((index) => index >= 0);
    assert(matchingIndexes.length > 0, `${label} must be observed`);
    assert(matchingIndexes.every((index) => index > enterIndex && index < exitIndex),
      `${label} must stay inside the same executeAsModal callback`);
    assert(matchingIndexes.every((index) => events[index].insideModal),
      `${label} must be marked as a modal observation`);
  }
}

async function assertHierarchyBehavior(tool, harness) {
  harness.reset();
  const stable = await tool.execute({ includeHidden: true, includeBounds: true, flatList: true });
  assert.strictEqual(stable.success, true);
  assert.deepStrictEqual(normalize(stable.historyStateRef), {
    documentId: 91,
    historyStateId: 801
  });
  assert.strictEqual(stable.documentName, 'structure-bound.psd');
  assert.strictEqual(stable.totalLayers, 3);
  assert.deepStrictEqual(normalize(stable.flatList.map((layer) => layer.name)), ['产品图', '文字组', '主标题']);
  let state = harness.getState();
  assert.strictEqual(state.modalDepth, 0);
  assert.strictEqual(state.batchPlayCount, 0);
  assertEventsWereInsideOneModal(state.events, [
    'document.activeHistoryState',
    'document.layers',
    'document.name',
    'layer:pixel.id',
    'layer:pixel.kind',
    'layer:pixel.bounds',
    'layer:pixel.boundsValue.left',
    'layer:group.layers',
    'layer:text.name',
    'layer:text.boundsValue.bottom'
  ]);

  harness.reset({ historyBefore: undefined, historyAfter: undefined });
  const missing = await tool.execute({ includeHidden: true, includeBounds: true });
  assert.strictEqual(missing.success, false, 'missing Host history identity must fail closed');
  state = harness.getState();
  assert.strictEqual(state.documentLayersReadCount, 0,
    'missing history identity must fail before layer hierarchy traversal');
  assert.strictEqual(state.batchPlayCount, 0);

  harness.reset({ historyBefore: 801, historyAfter: 802 });
  const changed = await tool.execute({ includeHidden: true, includeBounds: true, flatList: true });
  assert.strictEqual(changed.success, false, 'a history transition must discard the hierarchy');
  assert.strictEqual(changed.flatList, undefined);
  assert.strictEqual(changed.hierarchy, undefined);
  state = harness.getState();
  assert(state.documentLayersReadCount > 0, 'the changed-history case must exercise hierarchy traversal');
  assertEventsWereInsideOneModal(state.events, [
    'document.activeHistoryState',
    'document.layers',
    'layer:text.kind'
  ]);
}

async function assertTextBehavior(tool, harness) {
  harness.reset();
  const stable = await tool.execute({ includeHidden: true });
  assert.strictEqual(stable.success, true);
  assert.deepStrictEqual(normalize(stable.historyStateRef), {
    documentId: 91,
    historyStateId: 801
  });
  assert.strictEqual(stable.count, 1);
  assert.deepStrictEqual(normalize(stable.layers[0]), {
    id: 31,
    name: '主标题',
    contents: '版本绑定文案',
    bounds: {
      left: 20,
      top: 30,
      right: 420,
      bottom: 100,
      width: 400,
      height: 70
    },
    boundsNoEffects: {
      left: 20,
      top: 30,
      right: 420,
      bottom: 100,
      width: 400,
      height: 70
    },
    style: {
      fontSize: 36,
      fontName: 'MockSans-Bold',
      fontStyle: 'Regular',
      tracking: 25,
      leading: 48,
      horizontalScale: 98,
      verticalScale: 102,
      textAlign: 'left'
    }
  });
  let state = harness.getState();
  assert.strictEqual(state.modalDepth, 0);
  assert.strictEqual(state.batchPlayCount, 1);
  assertEventsWereInsideOneModal(state.events, [
    'document.activeHistoryState',
    'document.layers',
    'layer:group.layers',
    'layer:text.textItem',
    'text.textItem.contents',
    'text.textItem.characterStyle',
    'text.characterStyle.fontStyle',
    'layer:text.bounds',
    'layer:text.boundsValue.left',
    'layer:text.boundsNoEffects',
    'layer:text.boundsNoEffectsValue.width',
    'action.batchPlay',
    'descriptor.textKey',
    'descriptor.textKey.textStyleRange',
    'descriptor.textStyle.size._value',
    'descriptor.textStyle.fontPostScriptName',
    'descriptor.textKey.paragraphStyleRange',
    'descriptor.paragraphStyle.align._value'
  ]);

  harness.reset({ historyBefore: undefined, historyAfter: undefined });
  const missing = await tool.execute({ includeHidden: true });
  assert.strictEqual(missing.success, false, 'missing Host history identity must fail closed');
  state = harness.getState();
  assert.strictEqual(state.documentLayersReadCount, 0,
    'missing history identity must fail before text traversal');
  assert.strictEqual(state.batchPlayCount, 0,
    'missing history identity must fail before text style batchPlay');

  harness.reset({ historyBefore: 801, historyAfter: 802 });
  const changed = await tool.execute({ includeHidden: true });
  assert.strictEqual(changed.success, false, 'a history transition must discard text and style results');
  assert.strictEqual(changed.layers, undefined);
  assert.strictEqual(changed.count, undefined);
  state = harness.getState();
  assert(state.documentLayersReadCount > 0, 'the changed-history case must exercise text traversal');
  assert.strictEqual(state.batchPlayCount, 1, 'the changed-history case must exercise style batchPlay');
  assertEventsWereInsideOneModal(state.events, [
    'document.activeHistoryState',
    'document.layers',
    'text.textItem.contents',
    'action.batchPlay',
    'descriptor.textStyle.leading._value'
  ]);
}

async function run() {
  const harness = createPhotoshopHarness();
  const load = createTypeScriptLoader(harness.photoshop);
  const hierarchyPath = path.join(ROOT, 'src', 'tools', 'layout', 'get-layer-hierarchy.ts');
  const textLayersPath = path.join(ROOT, 'src', 'tools', 'layout', 'get-all-text-layers.ts');
  const { GetLayerHierarchyTool } = load(hierarchyPath);
  const { GetAllTextLayersTool } = load(textLayersPath);
  const hierarchyTool = new GetLayerHierarchyTool();
  const textTool = new GetAllTextLayersTool();

  await assertHierarchyBehavior(hierarchyTool, harness);
  await assertTextBehavior(textTool, harness);

  console.log('structure history binding smoke passed');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
