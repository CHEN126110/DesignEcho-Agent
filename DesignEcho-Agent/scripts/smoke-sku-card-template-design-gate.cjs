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
      actions: ['getCapabilities', 'listLayerSets', 'execute', 'arrangeDynamic'],
      supportsNoPlaceholderAutoLayout: true,
      noPlaceholderAutoLayout: {
        revision: 'sku-no-placeholder-auto-layout/v2',
        actions: ['execute', 'arrangeDynamic'],
        returnsActualSubjectBoundsQa: true
      },
      supportsRecursiveSkuLayerSets: true,
      skuSourceColorGroups: {
        revision: 'sku-recursive-color-layer-groups/v1',
        actions: ['listLayerSets', 'execute', 'arrangeDynamic'],
        recursiveLayerSets: true,
        canResolveNestedColorGroups: true,
        returnsLayerSetPaths: true
      },
      comboExportNaming: {
        revision: 'sku-combo-export-naming/v1',
        usesColorComboAsFileName: true,
        keepsExecutionOrderOutOfFileName: true
      }
    }
  };
}

function createHarness(options = {}) {
  const records = [];
  const docs = options.documents || [
    { name: 'SKU.psb', path: 'E:\\fixture\\PSD\\SKU.psb', width: 800, height: 800 }
  ];

  async function executeToolCall(toolName, params = {}) {
    records.push({ toolName, params: { ...params } });
    if (toolName === 'listDocuments') {
      return { success: true, documents: docs.map((doc) => ({ ...doc })) };
    }
    if (toolName === 'switchDocument') {
      return { success: true, documentName: params.documentName || 'SKU.psb' };
    }
    if (toolName === 'skuLayout') {
      if (params.action === 'getCapabilities') return createSkuLayoutCapabilities();
      if (params.action === 'listLayerSets') {
        return {
          success: true,
          data: {
            recursive: true,
            layerSets: ['奶白', '粉色', '浅咖', '灰色', '黑色'].map((name) => ({ name, path: [name] }))
          }
        };
      }
    }
    if (toolName === 'searchProjectResources') {
      return { success: true, results: [] };
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
          getState: () => ({ currentProject: { path: 'E:\\fixture' } })
        }
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  return () => {
    Module._load = originalLoad;
  };
}

async function runExecutor(params, harnessOptions = {}) {
  const harness = createHarness(harnessOptions);
  const restore = installModuleMocks(harness);
  try {
    const executorModulePath = path.join(ROOT, 'src', 'renderer', 'services', 'skill-executors', 'sku-batch.executor.ts');
    delete require.cache[require.resolve(executorModulePath)];
    const { skuBatchExecutor } = require(executorModulePath);

    global.window = {
      designEcho: {
        invoke: async () => null,
        readDirectory: async (dir) => {
          if (String(dir || '').replace(/\\/g, '/').endsWith('/模板文件')) return [];
          if (String(dir || '').replace(/\\/g, '/').endsWith('/配置文件')) return [];
          return [];
        },
        chat: async () => ({
          text: JSON.stringify({
            mode: 'default',
            countPerSize: 1,
            generateNotes: true,
            specifiedCombos: [],
            appendMonochromeColors: [],
            targetSizes: [],
            reasoning: '默认组合'
          })
        })
      }
    };

    const result = await skuBatchExecutor.execute({
      params: {
        comboSizes: [2, 3, 4],
        countPerSize: 1,
        generateNotes: true,
        skuFileKeyword: 'SKU',
        skuTemplatePreparationMode: 'card-placeholder-templates',
        allowSkuCardTemplatePreparation: true,
        requireSkuCardTemplateDesignConfirmation: true,
        userIntent: '请基于已有 SKU 色卡素材创建卡片式 SKU 排版模板，并生成 2双装、3双装、4双装组合图和自选备注。',
        ...params
      },
      callbacks: {}
    });
    return { result, records: harness.records };
  } finally {
    restore();
    delete global.window;
  }
}

function templateWriteCalls(records) {
  const writeTools = new Set(['createDocument', 'createRectangle', 'createTextLayer', 'createSkuPlaceholders', 'saveDocument']);
  return records.filter((record) => writeTools.has(record.toolName));
}

async function main() {
  const pending = await runExecutor({});
  assert(pending.result.success === true, 'template design gate should return a user-confirmable result', pending.result);
  assert(
    pending.result.data?.status === 'pending_sku_card_template_design_confirmation',
    'missing card templates must pause for template design confirmation',
    pending.result
  );
  assert(
    Array.isArray(pending.result.data?.interactiveCards) &&
      pending.result.data.interactiveCards.some((card) => card.kind === 'editable_confirmation'),
    'template design gate must expose an editable confirmation card',
    pending.result
  );
  const designCard = pending.result.data.interactiveCards.find((card) => card.kind === 'editable_confirmation');
  const confirmationField = designCard?.payload?.fields?.find((field) => field.id === 'template_confirmation');
  assert(
    confirmationField?.type === 'choice' &&
      confirmationField.value === '确认' &&
      confirmationField.options?.some((option) => option.value === '需要调整'),
    'template design confirmation must use an explicit choice instead of a boolean label that can be misread as approval',
    designCard
  );
  assert(
    templateWriteCalls(pending.records).length === 0,
    'template design gate must not run generic placeholder-template Photoshop writes before confirmation',
    pending.records
  );

  const openedSkuDocOnly = await runExecutor({
    skuSourcePreparationMode: 'card-source-from-project-images',
    userIntent: '项目中已经有 SKU 色卡素材，请基于已有 SKU 色卡素材创建卡片式 SKU 排版模板，规格是 2-3-4 双装以及对应自选备注。'
  }, {
    documents: [
      { name: 'SKU', isActive: true, width: 1600, height: 1600 }
    ]
  });
  assert(
    openedSkuDocOnly.result.success === true &&
      openedSkuDocOnly.result.data?.status === 'pending_sku_card_template_design_confirmation',
    'an already opened document named SKU must be treated as the SKU source before rebuilding color-card materials',
    openedSkuDocOnly.result
  );
  assert(
    openedSkuDocOnly.records.some((record) => record.toolName === 'skuLayout' && record.params.action === 'listLayerSets'),
    'opened SKU document should be inspected for color groups',
    openedSkuDocOnly.records
  );
  assert(
    templateWriteCalls(openedSkuDocOnly.records).length === 0,
    'opened SKU document path must still pause for template confirmation before Photoshop template writes',
    openedSkuDocOnly.records
  );

  console.log('[smoke-sku-card-template-design-gate] pass');
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  if (error && error.detail !== undefined) {
    console.error(JSON.stringify(error.detail, null, 2));
  }
  process.exit(1);
});
