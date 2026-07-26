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
      actions: ['getCapabilities', 'listLayerSets', 'copyLayerSetToTemplate', 'execute', 'arrangeDynamic'],
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
  let currentDocumentName = options.currentDocumentName || 'SKU.psb';
  const templateSizes = options.templateSizes || [2, 3, 4];
  const docs = options.documents || [
    { name: 'SKU.psb', path: 'C:\\Project\\PSD\\SKU.psb', width: 800, height: 800 },
    ...templateSizes.flatMap((size) => [
      { name: `${size}双装-卡片模板.psd`, path: `C:\\Project\\模板文件\\${size}双装-卡片模板.psd`, width: 800, height: 800 },
      { name: `${size}双自选备注-卡片模板.psd`, path: `C:\\Project\\模板文件\\${size}双自选备注-卡片模板.psd`, width: 800, height: 800 }
    ])
  ];
  const layerSetNames = options.layerSetNames || ['1', '2', '3', '4', '5'];

  function buildTemplateLayerHierarchy(documentName) {
    if (Array.isArray(options.templateLayers)) {
      return options.templateLayers.map((layer) => ({ ...layer }));
    }
    const sizeMatch = String(documentName || '').match(/(\d+)双/);
    const size = sizeMatch ? Number(sizeMatch[1]) : 2;
    const placeholderCount = String(documentName || '').includes('自选备注') ? layerSetNames.length : size;
    const placeholderGroups = Array.from({ length: placeholderCount }, (_, index) => {
      const left = 80 + index * 90;
      return {
        id: 30 + index,
        name: String(index + 1),
        kind: 'group',
        visible: true,
        bounds: { left, top: 180, right: left + 72, bottom: 520 },
        layers: [
          {
            id: 130 + index,
            name: `占位${index + 1}`,
            kind: 'solidColor',
            visible: true,
            bounds: { left, top: 180, right: left + 72, bottom: 520 }
          }
        ]
      };
    });
    return [
      { id: 1, name: '背景', visible: true, isBackgroundLayer: true, bounds: { left: 0, top: 0, right: 800, bottom: 800 } },
      { id: 2, name: documentName.includes('自选备注') ? '自选备注标题' : 'SKU标题', kind: 'text', visible: true, bounds: { left: 80, top: 48, right: 720, bottom: 118 } },
      {
        id: 20,
        name: '占位',
        kind: 'group',
        visible: true,
        bounds: { left: 60, top: 160, right: 740, bottom: 560 },
        layers: placeholderGroups
      }
    ];
  }

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
          layers: buildTemplateLayerHierarchy(currentDocumentName)
        },
        totalLayers: 3,
        summary: { visibleLayerCount: 3 }
      };
    }

    if (toolName === 'skuLayout') {
      if (params.action === 'getCapabilities') return createSkuLayoutCapabilities();
      if (params.action === 'inspectTemplateLayout') {
        const layers = buildTemplateLayerHierarchy(String(params.templateDocName || currentDocumentName));
        const placeholderContainer = layers.find((layer) => layer.name === '占位');
        const slots = Array.isArray(placeholderContainer?.layers)
          ? placeholderContainer.layers.map((layer) => ({
              name: layer.name,
              bounds: layer.bounds,
              kind: layer.kind || 'group',
              visible: layer.visible !== false
            }))
          : layers
              .filter((layer) => /矩形|形状参考|SKU占位符|占位/i.test(String(layer.name || '')))
              .map((layer) => ({
                name: layer.name,
                bounds: layer.bounds,
                kind: layer.kind || 'shape',
                visible: layer.visible !== false
              }));
        return {
          success: true,
          data: {
            schema: 'sku-template-layout-inspection/v1',
            templateName: params.templateDocName || currentDocumentName,
            mode: slots.length === 1 ? 'legacy_single_region' : slots.length > 1 ? 'ordered_slots' : 'none',
            slotCount: slots.length,
            supportsMultiColorInSingleRegion: slots.length === 1,
            slots,
            blockers: slots.length > 0 ? [] : ['模板没有识别到可用 SKU 占位槽。'],
            warnings: []
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
                path: `C:\\Project\\SKU\\${params.action === 'execute' ? params.combos?.[0]?.join('+') || 'combo' : 'note'}.jpg`
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
          // 正常 SKU 场景必须有当前项目路径：模板从 <项目>\模板文件 识别，不依赖打开文档当模板。
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
        comboSizes: [2, 3, 4],
        countPerSize: 1,
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

function executedSkuCombos(records) {
  return skuLayoutWriteCalls(records)
    .filter((record) => record.params.action === 'execute')
    .flatMap((record) => Array.isArray(record.params.combos) ? record.params.combos : []);
}

async function main() {
  const pending = await runExecutorCase('请基于已有 SKU 色卡素材生成 2双装、3双装、4双装组合和自选备注，先让我确认组合。', {
    requireSkuComboConfirmation: true
  });

  assert(pending.result.success === true, 'combo confirmation request should succeed without Photoshop writes', pending.result);
  assert(
    pending.result.data?.status === 'pending_sku_combo_confirmation',
    'combo confirmation request must return pending_sku_combo_confirmation',
    pending.result
  );
  assert(
    Array.isArray(pending.result.data?.interactiveCards) && pending.result.data.interactiveCards.length === 1,
    'combo confirmation request must expose one interactive card',
    pending.result
  );
  assert(
    pending.result.data.interactiveCards[0].kind === 'sku_combo_editor',
    'combo confirmation card must be a SKU combo editor',
    pending.result.data.interactiveCards[0]
  );
  assert(
    skuLayoutWriteCalls(pending.records).length === 0,
    'executor must not run Photoshop SKU writes before user confirms the combo card',
    pending.records
  );
  assert(
    !pending.records.some((record) => record.toolName === 'createDocument'),
    'existing SKU source requests must not recreate SKU card source before combo confirmation',
    pending.records
  );
  assert(
    pending.records.some((record) => record.toolName === 'switchDocument' && /SKU/i.test(String(record.params.documentName || ''))),
    'existing SKU source requests should reuse the SKU document by name',
    pending.records
  );

  const structuredTask = '请生成 2双、3双、4双 SKU，并额外追加纯黑组合；先让我确认组合。';
  const structuredHarnessOptions = {
    layerSetNames: ['白色', '绿色', '蓝色', '粉色', '黑色']
  };
  const structuredPending = await runExecutorCase(structuredTask, {
    requireSkuComboConfirmation: true
  }, structuredHarnessOptions);
  const structuredCard = structuredPending.result.data?.interactiveCards?.[0];
  assert(structuredCard?.kind === 'sku_combo_editor', 'structured continuation fixture must start from the real SKU card', structuredPending.result);
  const structuredValue = {
    groups: [
      { size: 2, combos: [[2, 1]] },
      { size: 3, combos: [[5, 3, 1]] },
      { size: 4, combos: [[4, 2, 5, 1]] }
    ],
    generateSelfSelectNotes: false
  };
  const structuredSubmission = {
    version: 'interactive-card-submission/v0',
    cardId: structuredCard.id,
    kind: structuredCard.kind,
    submittedAt: '2026-07-16T10:30:00.000Z',
    value: structuredValue,
    validation: {
      valid: true,
      canSubmit: true,
      normalizedValue: structuredValue,
      issues: [],
      blockers: [],
      warnings: []
    }
  };
  const structuredConfirmed = await runExecutorCase(structuredTask, {
    requireSkuComboConfirmation: true,
    interactiveCardDefinition: structuredCard,
    interactiveCardSubmission: structuredSubmission
  }, structuredHarnessOptions);
  const actualStructuredCombos = executedSkuCombos(structuredConfirmed.records);
  const expectedStructuredCombos = [
    ['绿色', '白色'],
    ['黑色', '蓝色', '白色'],
    ['粉色', '绿色', '黑色', '白色']
  ];
  assert(structuredConfirmed.result.success === true, 'structured SKU continuation should execute successfully', structuredConfirmed.result);
  assert(
    JSON.stringify(actualStructuredCombos) === JSON.stringify(expectedStructuredCombos),
    'Photoshop writes must use exactly the combinations confirmed in the card, with no text-derived additions',
    { actualStructuredCombos, expectedStructuredCombos, records: structuredConfirmed.records }
  );
  assert(
    !actualStructuredCombos.some((combo) => combo.every((color) => color === '黑色')),
    'a monochrome combo removed by the user must not be re-added from the original task text',
    actualStructuredCombos
  );
  assert(
    !structuredConfirmed.records.some((record) => record.toolName === 'skuLayout' && record.params.action === 'arrangeDynamic'),
    'generateSelfSelectNotes=false from the card must suppress note generation',
    structuredConfirmed.records
  );
  assert(
    !Array.isArray(structuredConfirmed.result.data?.interactiveCards) || structuredConfirmed.result.data.interactiveCards.length === 0,
    'structured continuation must not ask for the same SKU confirmation again',
    structuredConfirmed.result
  );

  const templateOnly = await runExecutorCase('请基于已有 SKU 色卡素材生成 2双装、3双装、4双装组合和自选备注，先让我确认组合。', {
    requireSkuComboConfirmation: true,
    preferExistingSkuSourceForCardPreparation: true,
    allowSkuCardSourcePreparation: false
  }, {
    currentDocumentName: '2双自选备注-卡片模板.psd',
    documents: [
      { name: '2双装-卡片模板.psd', path: 'C:\\Project\\模板文件\\2双装-卡片模板.psd', width: 800, height: 800 },
      { name: '2双自选备注-卡片模板.psd', path: 'C:\\Project\\模板文件\\2双自选备注-卡片模板.psd', width: 800, height: 800 },
      { name: '3双装-卡片模板.psd', path: 'C:\\Project\\模板文件\\3双装-卡片模板.psd', width: 800, height: 800 },
      { name: '3双自选备注-卡片模板.psd', path: 'C:\\Project\\模板文件\\3双自选备注-卡片模板.psd', width: 800, height: 800 }
    ]
  });
  assert(
    templateOnly.result.success === false && templateOnly.result.data?.status === 'blocked_missing_sku_source_file',
    'SKU source resolution must not treat combo or self-select note templates as the SKU source document',
    templateOnly.result
  );
  assert(
    !templateOnly.records.some((record) => record.toolName === 'switchDocument' && /自选备注|双装/.test(String(record.params.documentName || ''))),
    'SKU source resolution must not switch to template documents as SKU source',
    templateOnly.records
  );

  const mixedLayerNames = [
    '白色黑圆点',
    '奶白粉圆点',
    '卡其咖圆点',
    '灰色蓝圆点',
    '点击图',
    '点击图-1-点击图 1 穿着波点短袜的脚及三双新短袜 日常、清新 #F5F5F5',
    '点击图-2-点击图 2 穿着波点短袜的脚及三双新短袜 日常、清新 #F5F5F5',
    '转化图',
    '转化图-1-转化图 1 穿着波点短袜的脚及三双新短袜 日常、清新 #F5F5F5',
    '转化图-2-转化图 2 穿着波点短袜的脚及三双新短袜 日常、清新 #F5F5F5',
    '黑色白圆点'
  ];
  const mixedLayers = await runExecutorCase(
    '请基于当前 SKU 文档生成 2-3-4 双装组合，先让我确认组合。',
    {
      requireSkuComboConfirmation: true
    },
    {
      layerSetNames: mixedLayerNames
    }
  );
  const mixedColorLabels = mixedLayers.result.data?.interactiveCards?.[0]?.payload?.colorSlots?.map((slot) => slot.label) || [];
  assert(
    JSON.stringify(mixedColorLabels) === JSON.stringify([
      '白色黑圆点',
      '奶白粉圆点',
      '卡其咖圆点',
      '灰色蓝圆点',
      '黑色白圆点'
    ]),
    'SKU combo confirmation must not expose main-image/detail deliverables as selectable color slots',
    { mixedColorLabels, layerSetNames: mixedLayerNames, result: mixedLayers.result }
  );

  const confirmed = await runExecutorCase(
    '我已确认 SKU 组合：2双：颜色1+颜色2；3双：颜色1+颜色2+颜色3；4双：颜色1+颜色2+颜色3+颜色4。需要生成自选备注。请基于确认后的组合继续执行。',
    {
      requireSkuComboConfirmation: true
    }
  );
  const confirmedWrites = skuLayoutWriteCalls(confirmed.records);
  const confirmedTemplateInspections = confirmed.records.filter((record) =>
    record.toolName === 'skuLayout' && record.params.action === 'inspectTemplateLayout'
  );
  assert(confirmed.result.success === true, 'confirmed combo request should execute successfully', confirmed.result);
  assert(
    confirmedTemplateInspections.length > 0,
    'confirmed combo request must ask UXP to inspect template layout before write execution',
    confirmed.records
  );
  assert(
    !confirmed.records.some((record) => record.toolName === 'getLayerHierarchy'),
    'confirmed combo request must not duplicate UXP template recognition through getLayerHierarchy',
    confirmed.records
  );
  assert(
    confirmedWrites.some((call) => call.params.action === 'execute'),
    'confirmed combo request must run combo image generation',
    confirmedWrites
  );
  assert(
    confirmedWrites.some((call) => call.params.action === 'arrangeDynamic'),
    'confirmed combo request must run self-select note generation when requested',
    confirmedWrites
  );
  assert(
    !Array.isArray(confirmed.result.data?.interactiveCards) || confirmed.result.data.interactiveCards.length === 0,
    'confirmed combo request must not ask for the same confirmation card again',
    confirmed.result
  );

  const noPlaceholderTemplate = await runExecutorCase(
    '我已确认 SKU 组合：2双：颜色1+颜色1。需要生成自选备注。请基于确认后的组合继续执行。',
    {
      requireSkuComboConfirmation: false,
      skuComboConfirmationApproved: true,
      comboSizes: [2],
      countPerSize: 1,
      generateNotes: false,
      specifiedColors: [['1', '1']]
    },
    {
      templateSizes: [2],
      templateLayers: [
        { id: 1, name: '背景', visible: true, isBackgroundLayer: true, bounds: { left: 0, top: 0, right: 800, bottom: 800 } },
        { id: 2, name: 'SKU标题', kind: 'text', visible: true, bounds: { left: 80, top: 48, right: 720, bottom: 118 } }
      ]
    }
  );
  assert(
    noPlaceholderTemplate.result.success === false,
    'template without SKU placeholder groups must fail before layout execution',
    noPlaceholderTemplate.result
  );
  assert(
    noPlaceholderTemplate.result.data?.status === 'blocked_invalid_sku_template_layout',
    'template without SKU placeholders should report blocked_invalid_sku_template_layout',
    noPlaceholderTemplate.result
  );
  assert(
    skuLayoutWriteCalls(noPlaceholderTemplate.records).length === 0,
    'template without SKU placeholders must not call skuLayout execute',
    noPlaceholderTemplate.records
  );

  console.log('[smoke-sku-combo-confirmation-flow] pass');
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  if (error && error.detail !== undefined) {
    console.error(JSON.stringify(error.detail, null, 2));
  }
  process.exit(1);
});
