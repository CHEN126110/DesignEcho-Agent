#!/usr/bin/env node

const path = require('path');
const Module = require('module');

require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '..', 'tsconfig.json'),
  compilerOptions: {
    module: 'CommonJS',
    moduleResolution: 'node'
  }
});

const ROOT = path.resolve(__dirname, '..');

function assert(condition, message, detail) {
  if (!condition) {
    const error = new Error(message);
    if (detail !== undefined) error.detail = detail;
    throw error;
  }
}

function createSkuLayoutCapabilities() {
  return {
    success: true,
    data: {
      schema: 'sku-layout-capabilities/v0',
      actions: ['getCapabilities', 'inspectTemplateLayout', 'listLayerSets', 'copyLayerSetToTemplate', 'execute', 'arrangeDynamic'],
      supportsNoPlaceholderAutoLayout: true,
      noPlaceholderAutoLayout: {
        revision: 'sku-no-placeholder-auto-layout/v2',
        actions: ['execute', 'arrangeDynamic'],
        returnsActualSubjectBoundsQa: true
      },
      supportsRecursiveSkuLayerSets: true,
      skuSourceColorGroups: {
        revision: 'sku-recursive-color-layer-groups/v1',
        actions: ['listLayerSets', 'copyLayerSetToTemplate', 'execute', 'arrangeDynamic'],
        recursiveLayerSets: true,
        canResolveNestedColorGroups: true,
        returnsLayerSetPaths: true
      },
      comboExportNaming: {
        revision: 'sku-combo-export-naming/v1',
        usesColorComboAsFileName: true,
        keepsExecutionOrderOutOfFileName: true
      },
      templateLayoutInspection: {
        revision: 'sku-template-layout-inspection/v1',
        actions: ['inspectTemplateLayout'],
        ownsPhotoshopTemplateRecognition: true
      }
    }
  };
}

function createMemoryStorage() {
  const data = new Map();
  return {
    getItem(key) {
      return data.has(String(key)) ? data.get(String(key)) : null;
    },
    setItem(key, value) {
      data.set(String(key), String(value));
    },
    removeItem(key) {
      data.delete(String(key));
    },
    clear() {
      data.clear();
    }
  };
}

function createHarness(options = {}) {
  const records = [];
  let currentDocumentName = 'SKU.psb';
  const templateSizes = options.templateSizes || [2];
  const docs = [
    { name: 'SKU.psb', path: 'C:\\Project\\SKU\\SKU.psb', width: 800, height: 800 },
    ...templateSizes.flatMap((size) => [
      { name: `${size}双装.psd`, path: `C:\\Project\\模板文件\\${size}双装.psd`, width: 800, height: 800 },
      { name: `${size}双自选备注.psd`, path: `C:\\Project\\模板文件\\${size}双自选备注.psd`, width: 800, height: 800 }
    ])
  ];
  const layerSetNames = options.layerSetNames || ['白色', '黑色', '浅灰', '深灰', '奶白'];

  async function executeToolCall(toolName, params = {}) {
    records.push({ toolName, params: { ...params }, currentDocumentName });

    if (toolName === 'listDocuments') {
      return { success: true, documents: docs.map((doc) => ({ ...doc })) };
    }

    if (toolName === 'switchDocument') {
      currentDocumentName = String(params.documentName || currentDocumentName);
      return { success: true, documentName: currentDocumentName };
    }

    if (toolName === 'getLayerHierarchy') {
      return {
        success: true,
        documentName: currentDocumentName,
        hierarchy: {
          layers: [
            { id: 1, name: '背景', visible: true, isBackgroundLayer: true, bounds: { left: 0, top: 0, right: 800, bottom: 800 } },
            { id: 2, name: currentDocumentName.includes('自选备注') ? '自选备注标题' : 'SKU标题', kind: 'text', visible: true, bounds: { left: 80, top: 48, right: 720, bottom: 118 } },
            { id: 3, name: '角标', kind: 'shape', visible: true, bounds: { left: 650, top: 650, right: 750, bottom: 750 } }
          ]
        },
        totalLayers: 3,
        summary: { visibleLayerCount: 3 }
      };
    }

    if (toolName === 'skuLayout') {
      if (params.action === 'getCapabilities') return createSkuLayoutCapabilities();
      if (params.action === 'inspectTemplateLayout') {
        const expected = Number(params.expectedItemCount || 2);
        const slotCount = String(params.templateDocName || currentDocumentName).includes('自选备注')
          ? layerSetNames.length
          : expected;
        return {
          success: true,
          data: {
            schema: 'sku-template-layout-inspection/v1',
            templateName: params.templateDocName || currentDocumentName,
            mode: slotCount === 1 ? 'legacy_single_region' : 'ordered_slots',
            slotCount,
            expectedItemCount: expected,
            supportsMultiColorInSingleRegion: slotCount === 1,
            slots: Array.from({ length: slotCount }, (_, index) => ({
              name: String(index + 1),
              kind: 'group',
              visible: true,
              bounds: { left: 80 + index * 90, top: 180, right: 152 + index * 90, bottom: 520, width: 72, height: 340 }
            })),
            blockers: [],
            warnings: [],
            inspectedLayerCount: slotCount + 2,
            visibleLayerCount: slotCount + 2
          }
        };
      }
      if (params.action === 'listLayerSets') {
        return {
          success: true,
          data: {
            recursive: true,
            layerSets: layerSetNames.map((name) => ({ name, path: [name] }))
          }
        };
      }
      if (params.action === 'execute' || params.action === 'arrangeDynamic') {
        return {
          success: true,
          data: {
            exportedFiles: [
              JSON.stringify({
                status: 'exported_jsx',
                path: `C:\\Project\\SKU\\2双\\${params.action === 'execute' ? '白色+黑色.jpg' : '2双自选备注.jpg'}`
              })
            ],
            autoLayoutPlans: params.action === 'execute' ? [{ status: 'ready', autoLayoutQa: { status: 'ready' } }] : [],
            noteAutoLayoutPlans: params.action === 'arrangeDynamic' ? [{ status: 'ready', autoLayoutQa: { status: 'ready' } }] : []
          }
        };
      }
    }

    return { success: true };
  }

  return { records, executeToolCall };
}

function installModuleMocks(harness) {
  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === '../tool-executor.service') {
      return { executeToolCall: harness.executeToolCall };
    }
    if (request === '../../stores/app.store') {
      return {
        useAppStore: {
          // 正常 SKU 场景必须有当前项目路径：模板从 <项目>\模板文件 识别，
          // 而不是依赖「项目为空时把打开文档当模板」的旧行为。
          getState: () => ({ currentProject: { path: 'C:\\Project' } })
        }
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  return () => {
    Module._load = originalLoad;
  };
}

async function runExecutorCase(name, params, harnessOptions = {}) {
  const harness = createHarness(harnessOptions);
  const restore = installModuleMocks(harness);
  try {
    const executorModulePath = path.join(ROOT, 'src', 'renderer', 'services', 'skill-executors', 'sku-batch.executor.ts');
    delete require.cache[require.resolve(executorModulePath)];
    const { skuBatchExecutor } = require(executorModulePath);

    global.window = {
      designEcho: {
        invoke: async () => null,
        readDirectory: async () => [],
        chat: async () => ({
          text: JSON.stringify({
            mode: 'default',
            countPerSize: params.countPerSize || 1,
            generateNotes: params.generateNotes !== false,
            specifiedCombos: [],
            appendMonochromeColors: [],
            targetSizes: [],
            reasoning: '按默认 SKU 计划执行'
          })
        })
      }
    };
    global.localStorage = createMemoryStorage();

    const result = await skuBatchExecutor.execute({
      params: {
        countPerSize: 1,
        comboSizes: [2],
        generateNotes: true,
        skuFileKeyword: 'SKU',
        userIntent: name,
        ...params
      },
      callbacks: {}
    });

    return { result, records: harness.records };
  } finally {
    restore();
    delete global.window;
    delete global.localStorage;
  }
}

function skuLayoutWriteCalls(records) {
  return records.filter((record) =>
    record.toolName === 'skuLayout'
    && (record.params.action === 'execute' || record.params.action === 'arrangeDynamic')
  );
}

async function main() {
  const comboCase = await runExecutorCase('帮我做 SKU，包括自选备注', {
    onlyNotes: false
  });
  assert(comboCase.result.success === true, 'normal SKU mock execution should succeed', comboCase.result);
  const comboWrites = skuLayoutWriteCalls(comboCase.records);
  assert(comboWrites.some((call) => call.params.action === 'execute'), 'normal SKU must call skuLayout execute', comboWrites);
  assert(comboWrites.some((call) => call.params.action === 'arrangeDynamic'), 'normal SKU with notes must call skuLayout arrangeDynamic', comboWrites);
  assert(
    comboWrites.every((call) => call.params.autoLayoutWithoutPlaceholders !== true),
    '6.3 ordered-placeholder SKU execution must not pass autoLayoutWithoutPlaceholders=true to normal SKU writes',
    comboWrites
  );
  assert(
    comboCase.records.some((call) => call.toolName === 'skuLayout' && call.params.action === 'inspectTemplateLayout'),
    'executor should ask UXP skuLayout to inspect template layout before SKU writes',
    comboCase.records
  );
  assert(
    !comboCase.records.some((call) => call.toolName === 'getLayerHierarchy'),
    'executor should not duplicate UXP Photoshop template recognition through getLayerHierarchy',
    comboCase.records
  );

  const numericColorSkuCase = await runExecutorCase(
    '请使用当前项目 E:\\DesignEchoDemo\\C-1194 的图片，先完成卡片式 SKU：规格为 2双装、3双装、4双装，并生成对应自选备注；参考 D:\\DesignEchoDemo\\C-1137 的成品风格，但不要复制参考项目文件。',
    {
      comboSizes: [2, 3, 4],
      countPerSize: 1,
      generateNotes: true
    },
    {
      layerSetNames: ['1', '2'],
      templateSizes: [2, 3, 4]
    }
  );
  const numericColorWrites = skuLayoutWriteCalls(numericColorSkuCase.records);
  const numericColorComboWrites = numericColorWrites.filter((call) => call.params.action === 'execute');
  assert(
    numericColorComboWrites.every((call) => !call.params.combos.some((combo) => combo.length === 1)),
    'numeric color layer names must not turn size wording or project paths into explicit 1-color SKU combos',
    numericColorComboWrites
  );
  assert(
    numericColorComboWrites.some((call) => call.params.combos.some((combo) => combo.length === 3))
      && numericColorComboWrites.some((call) => call.params.combos.some((combo) => combo.length === 4)),
    'explicit requested SKU sizes 2/3/4 must survive numeric color layer names',
    numericColorComboWrites
  );

  const noteOnlyCase = await runExecutorCase('只做 SKU 备注', {
    onlyNotes: true
  });
  assert(noteOnlyCase.result.success === true, 'note-only mock execution should succeed', noteOnlyCase.result);
  const noteWrites = skuLayoutWriteCalls(noteOnlyCase.records);
  assert(noteWrites.length > 0, 'note-only SKU must produce at least one skuLayout write', noteOnlyCase.records);
  assert(
    noteWrites.every((call) => call.params.action === 'arrangeDynamic'),
    'note-only SKU must not call skuLayout execute',
    noteWrites
  );
  assert(
    noteWrites.every((call) => call.params.autoLayoutWithoutPlaceholders !== true),
    'note-only 6.3 ordered-placeholder execution must not pass autoLayoutWithoutPlaceholders=true',
    noteWrites
  );

  console.log(JSON.stringify({
    success: true,
    checks: [
      'normal SKU calls execute and arrangeDynamic',
      'note-only SKU calls arrangeDynamic only',
      '6.3 ordered-placeholder execution does not pass autoLayoutWithoutPlaceholders=true',
      'executor asks UXP to inspect template layout before writes',
      'numeric color names do not hijack explicit SKU sizes'
    ],
    writeCalls: {
      normal: comboWrites.map((call) => call.params),
      noteOnly: noteWrites.map((call) => call.params)
    }
  }, null, 2));
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  if (error && error.detail !== undefined) {
    console.error(JSON.stringify(error.detail, null, 2));
  }
  process.exit(1);
});
