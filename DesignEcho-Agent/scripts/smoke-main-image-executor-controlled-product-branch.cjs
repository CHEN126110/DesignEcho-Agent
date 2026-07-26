#!/usr/bin/env node

const path = require('path');
const fs = require('fs');

require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '..', 'tsconfig.main.json')
});

const repoRoot = path.resolve(__dirname, '..');
const localStorageData = new Map();
global.localStorage = {
  getItem: (key) => localStorageData.has(key) ? localStorageData.get(key) : null,
  setItem: (key, value) => localStorageData.set(key, String(value)),
  removeItem: (key) => localStorageData.delete(key),
  clear: () => localStorageData.clear()
};

const { mainImageExecutor } = require(path.join(repoRoot, 'src', 'renderer', 'services', 'skill-executors', 'main-image.executor.ts'));
const { getMemoryService } = require(path.join(repoRoot, 'src', 'renderer', 'services', 'memory.service.ts'));

function assert(condition, message, details) {
  if (!condition) {
    const suffix = details ? `\n${JSON.stringify(details, null, 2)}` : '';
    throw new Error(`${message}${suffix}`);
  }
}

function assertNoRawPayload(value, label) {
  const serialized = JSON.stringify(value);
  const forbidden = ['raw-image-payload', 'base64-image-payload', 'data:image/'];
  const found = forbidden.filter((token) => serialized.includes(token));
  assert(found.length === 0, `${label} leaked raw image payload markers: ${found.join(', ')}`, value);
}

function assertNoConfidence(value, label) {
  const serialized = JSON.stringify(value);
  assert(!serialized.includes('"confidence"') && !serialized.includes('置信'), `${label} should not expose confidence fields`, value);
}

const baseParams = {
  userIntent: 'raw-image-payload 看项目图片理解袜子款式，制作点击图和转化图 data:image/png;base64,abc',
  imageType: 'click',
  assetPath: 'C:/project/assets/white-slouch-socks-01.png',
  assetWidth: 1600,
  assetHeight: 1600,
  outputDir: 'C:/Exports',
  subjectBounds: {
    left: 250,
    top: 360,
    right: 1330,
    bottom: 980,
    width: 1080,
    height: 620
  },
  sizePlans: [
    {
      sizeKey: '800',
      targetSize: { width: 1440, height: 1440 },
      subjectSize: { width: 900, height: 620 },
      scale: 0.72,
      targetX: 396,
      targetY: 497,
      decisionReason: '1:1 controlled executor branch smoke',
      smartLayoutPlanned: true,
      quickExportPlanned: true
    },
    {
      sizeKey: '750',
      targetSize: { width: 1440, height: 1920 },
      subjectSize: { width: 900, height: 620 },
      scale: 0.72,
      targetX: 396,
      targetY: 737,
      decisionReason: '3:4 controlled executor branch smoke',
      smartLayoutPlanned: true,
      quickExportPlanned: true
    },
    {
      sizeKey: '1200',
      targetSize: { width: 1440, height: 2560 },
      subjectSize: { width: 900, height: 620 },
      scale: 0.72,
      targetX: 396,
      targetY: 1057,
      decisionReason: '9:16 controlled executor branch smoke',
      smartLayoutPlanned: true,
      quickExportPlanned: true
    }
  ],
  copyCandidates: ['轻薄堆叠，春夏更自在'],
  knowledgeResults: [
    {
      id: 'web:main-image-reference',
      title: '袜子主图参考',
      intent: 'reference',
      sourceType: 'web_page',
      summary: '浅色袜子主图常用干净背景、主体放大和短标题。',
      sourceNotes: ['Source URL: https://example.com/socks-main-image'],
      tags: ['socks', 'main-image'],
      allowedUses: ['prompt_context', 'user_reference'],
      sourceLevel: 'external_snippet',
      sourceRank: 58,
      sourceUrl: 'https://example.com/socks-main-image',
      updatedAt: '2026-05-26T00:00:00.000Z'
    }
  ],
  visionSignal: {
    source: 'vision-model',
    assetRef: { path: 'C:/project/assets/white-slouch-socks-01.png' },
    productType: '不应被 executor 接受的注入值',
    subjectSummary: '这个对象只用于确认 params 旁路已经失效。',
    backgroundSummary: '不应进入主图视觉上下文。'
  },
  userCheckpointApproved: true
};

async function execute(params) {
  const {
    contextProjectPath,
    contextSampleImagePaths,
    contextSelectedProjectImagePath,
    contextAssetIndex,
    contextVisualInsightCache,
    ...executorParams
  } = params;
  const sampleImagePaths = Array.isArray(contextSampleImagePaths)
    ? contextSampleImagePaths
    : params.assetPath
      ? [params.assetPath]
      : [];
  const selectedProjectImagePath = contextSelectedProjectImagePath || params.assetPath;
  const visualInsightCache = contextVisualInsightCache === undefined && selectedProjectImagePath
    ? {
      cacheVersion: 'project-visual-insight-cache/v0',
      entries: [{
        cacheKey: `project-visual:${selectedProjectImagePath}`,
        path: selectedProjectImagePath,
        insight: {
          assetId: 'asset-default-main-image',
          path: selectedProjectImagePath,
          productType: '堆堆袜',
          summary: '白色堆堆袜，松弛褶皱感，适合春夏主图',
          scene: '浅色背景',
          styleTags: ['浅色', '干净']
        }
      }]
    }
    : contextVisualInsightCache;
  const messages = [];
  const progress = [];
  const result = await mainImageExecutor.execute({
    params: executorParams,
    callbacks: {
      onMessage: (message) => messages.push(String(message || '')),
      onProgress: (message, percent) => progress.push({ message, percent })
    },
    context: {
      userInput: executorParams.userIntent,
      projectContext: {
        projectPath: contextProjectPath,
        selectedProjectImagePath,
        sampleImagePaths,
        assetIndex: contextAssetIndex,
        visualInsightCache
      }
    }
  });
  return { result, messages, progress };
}

async function run() {
  const executorSource = fs.readFileSync(path.join(repoRoot, 'src', 'renderer', 'services', 'skill-executors', 'main-image.executor.ts'), 'utf8');
  assert(executorSource.includes('extractMainImageControlledProductResultPaths'), 'controlled product branch should extract runner result paths for file probes');
  assert(executorSource.includes('probeMainImageResultFiles(controlledResultPaths)'), 'controlled product branch should probe exported result files after runner');
  assert(executorSource.includes('compareMainImageResultToReference'), 'controlled product branch should reuse pixel probe adapter when reference image is available');
  assert(executorSource.includes('data.mainImageControlledProductQaGate = controlledProductQaGate'), 'controlled product branch should retain file probe summary in structured QA data');
  assert(executorSource.includes('formatMainImageUserVisibleResultFile'), 'controlled product branch response should name a user-checkable result file');
  assert(!executorSource.includes('结果图片：') && !executorSource.includes('文件读回：'), 'controlled product branch response must not expose internal result/readback counters in the user message');
  assert(executorSource.includes('buildMainImageControlledProductQaBundle'), 'controlled product branch should bridge runner record into screenshot QA record');
  assert(executorSource.includes('buildMainImageAgentDraftPlan'), 'controlled product branch should build a real agent draft from controlled inputs before final QA');
  assert(executorSource.includes('mainImageAgentDraft: controlledAgentDraft'), 'controlled product branch should expose controlled agent draft data');
  assert(executorSource.includes('data.mainImageScreenshotQa'), 'controlled product branch should expose canonical mainImageScreenshotQa data');
  assert(executorSource.includes('data.mainImageScreenshotProbeReadiness'), 'controlled product branch should expose canonical mainImageScreenshotProbeReadiness data');
  assert(executorSource.includes('data.mainImageControlledProductQaBridge'), 'controlled product branch should expose redacted controlled product QA bridge data');
  assert(executorSource.includes('buildMainImageQaReport({'), 'controlled product branch should let final mainImageQaReport aggregate real controlled record');
  assert(executorSource.includes('data.mainImageQaReport = mainImageQaReport'), 'controlled product branch should expose final QA report only after controlled record is built');
  assert(!executorSource.includes('data.mainImageQaReport = controlledProductQaBundle'), 'controlled product branch must not fake final mainImageQaReport from bridge record alone');

  const defaultRun = await execute(baseParams);
  assert(defaultRun.result.success === true, 'default main-image executor should return strategy-only record successfully', defaultRun.result);
  assert(defaultRun.result.data?.mainImageExecutionMode === 'strategy-only', 'default execution mode should be strategy-only', defaultRun.result.data);
  assert((defaultRun.result.toolResults || []).length === 0, 'default strategy-only branch must not call Photoshop tools', defaultRun.result.toolResults);
  assert(defaultRun.result.data?.mainImageStrategyInputBundle?.status === 'ready_for_strategy_contract', 'strategy-only branch should expose strategy input record', defaultRun.result.data);
  assert(defaultRun.result.data?.mainImageDesignCorePlan === defaultRun.result.data?.mainImageStrategyInputBundle?.designCorePlan, 'strategy-only branch should expose design core record as a stable top-level alias', defaultRun.result.data);
  assert(defaultRun.result.data?.mainImageDesignConceptPlan === defaultRun.result.data?.mainImageStrategyInputBundle?.designConceptPlan, 'strategy-only branch should expose design concept plan as a stable top-level alias', defaultRun.result.data);
  assert(defaultRun.result.data?.mainImageCopyStrategy === defaultRun.result.data?.mainImageStrategyInputBundle?.copyStrategy, 'strategy-only branch should expose copy record as a stable top-level alias', defaultRun.result.data);
  assert(defaultRun.result.data?.mainImageDesignConceptPlan?.status === 'ready_design_concept_plan', 'strategy-only concept plan should be ready when controlled inputs include asset-bound visual context', defaultRun.result.data?.mainImageDesignConceptPlan);
  assert(defaultRun.result.data?.mainImageCopyStrategy?.status === 'ready_copy_strategy', 'strategy-only copy record should be ready when copy candidates and asset-bound visual context are present', defaultRun.result.data?.mainImageCopyStrategy);
  assert(
    defaultRun.result.data?.mainImageStrategyInputBundle?.projectStyleStrategy?.referenceResearchPlan?.referenceHintCount === 1,
    'strategy-only branch should pass knowledge results into main-image reference record',
    defaultRun.result.data?.mainImageStrategyInputBundle?.projectStyleStrategy?.referenceResearchPlan
  );
  assert(
    defaultRun.result.data?.mainImageStrategyInputBundle?.strategyInputs?.copyRolePolicy?.referenceCount === 1,
    'strategy-only copy role policy should expose mapped knowledge reference count',
    defaultRun.result.data?.mainImageStrategyInputBundle?.strategyInputs?.copyRolePolicy
  );
  assertNoConfidence(
    defaultRun.result.data?.mainImageStrategyInputBundle?.projectStyleStrategy?.referenceResearchPlan,
    'strategy-only mapped reference plan'
  );
  assert(defaultRun.result.data?.mainImageLiveExecutorRequestPackage?.status === 'ready_for_executor_dispatch', 'strategy-only branch may prepare request package without dispatching', defaultRun.result.data);
  assert(defaultRun.result.data?.mainImageControlledProductRunner === undefined, 'strategy-only branch must not run live runner', defaultRun.result.data);
  assertNoRawPayload(defaultRun.result, 'default strategy-only executor result');

  const rejectedParamsVisionRun = await execute({
    ...baseParams,
    contextVisualInsightCache: { entries: [] },
    enableVisionPreflight: false
  });
  assert(
    rejectedParamsVisionRun.result.data?.mainImageStrategyInputBundle?.projectStyleStrategy?.status === 'needs_vision',
    'arbitrary vision objects in executor params must not bypass the asset-bound visual context path',
    rejectedParamsVisionRun.result.data?.mainImageStrategyInputBundle?.projectStyleStrategy
  );
  assert(
    rejectedParamsVisionRun.result.data?.mainImageDesignConceptPlan?.status === 'blocked_missing_visual_context',
    'arbitrary params vision object must not unlock design concepts',
    rejectedParamsVisionRun.result.data?.mainImageDesignConceptPlan
  );

  const projectCandidatePath = 'C:/project/assets/project-socks-main-source.png';
  const projectCandidateRun = await execute({
    userIntent: '请使用当前项目 C:\\project 的图片，完成一张可验收的电商袜子主图：画布 800x800，适合淘宝商品首图，主体要清楚。请把结果导出到项目的“主图”目录，完成后读回导出文件并说明哪个文件可以验收。',
    imageType: 'click',
    size: 'custom',
    customSize: { width: 800, height: 800 },
    sourceAssetKind: 'selected-project-image',
    outputDirPolicy: 'project-main-image-dir',
    mainImageExecutionMode: 'product-disposable-live',
    executionScope: 'disposable-document',
    approvedLiveExecution: true,
    approvedLiveAdapterRun: false,
    photoshopConnection: { connected: true, documentWriteAvailable: true, source: 'smoke' },
    userCheckpointApproved: true,
    contextProjectPath: 'C:/project',
    contextSampleImagePaths: [projectCandidatePath],
    contextAssetIndex: {
      assets: [{
        path: projectCandidatePath,
        name: 'project-socks-main-source.png',
        width: 1600,
        height: 1000,
        role: 'source-photo',
        isImage: true
      }]
    },
    contextVisualInsightCache: {
      cacheVersion: 'project-visual-insight-cache/v0',
      source: 'provided-options',
      exists: true,
      entries: [{
        cacheKey: projectCandidatePath,
        path: projectCandidatePath,
        insight: {
          assetId: 'asset-project-socks-main-source',
          path: projectCandidatePath,
          productType: '运动袜',
          summary: '浅色调袜子素材，主体适合做电商主图。',
          styleTags: ['浅色', '干净', '电商主图'],
          sourceRecords: [{ source: 'smoke-fixture', summary: 'cached visual insight for project candidate', status: 'needs_review' }]
        }
      }],
      summary: { totalEntries: 1, entriesWithInsight: 1, entriesWithRawPayloadRemoved: 0 },
      warnings: [],
      limitations: [],
      sourceRecords: [{ source: 'smoke-fixture', summary: 'provided visual insight cache', status: 'needs_review' }]
    }
  });
  const projectCandidateStrategy = projectCandidateRun.result.data?.mainImageStrategyInputBundle;
  const projectCandidateExportRequests = projectCandidateStrategy?.productionExecutorHandoff?.toolRequests
    ?.filter((request) => request.tool === 'exportGroup') || [];
  const projectCandidateExportDirs = projectCandidateExportRequests
    .map((request) => String(request?.payloadPreview?.outputDir || '').replace(/\\/g, '/'));
  const projectCandidateDocuments = projectCandidateStrategy?.productionDocumentStructure?.documents || [];
  const projectCandidateExportSpecs = projectCandidateStrategy?.productionDocumentStructure?.exportSpecs || [];
  const projectCandidateQuickExportPaths = projectCandidateRun.result.data?.mainImageAgentDraft?.sizePlans
    ?.map((plan) => String(plan.quickExportOutputPath || '').replace(/\\/g, '/'))
    ?.filter(Boolean) || [];
  assert(projectCandidateRun.result.success === false, 'project candidate live branch should stop before Photoshop when adapter approval is missing', projectCandidateRun.result);
  assert((projectCandidateRun.result.toolResults || []).length === 0, 'project candidate blocked branch must not call Photoshop tools', projectCandidateRun.result.toolResults);
  assert(projectCandidateRun.result.data?.mainImageControlledProductAdapter?.status === 'blocked_requires_explicit_live_approval', 'project candidate branch should reach guarded adapter approval, not fail earlier', projectCandidateRun.result.data);
  assert(projectCandidateStrategy?.status === 'ready_for_strategy_contract', 'project candidate branch should build ready strategy record from project context', projectCandidateStrategy);
  assert(projectCandidateStrategy?.productionExecutionPlan?.status === 'ready_execution_plan', 'project candidate branch should produce a production execution plan from project context', projectCandidateStrategy?.productionExecutionPlan);
  assert(projectCandidateStrategy?.liveExecutorRequestPackage?.status === 'ready_for_executor_dispatch', 'project candidate branch should prepare live executor requests before adapter guard', projectCandidateStrategy?.liveExecutorRequestPackage);
  assert(
    projectCandidateDocuments.length > 0
      && projectCandidateDocuments.every((doc) => doc.canvasSize?.width === 800 && doc.canvasSize?.height === 800 && doc.exportSize?.width === 800 && doc.exportSize?.height === 800),
    'explicit 800x800 main-image request should use the requested pixel size instead of the platform 800-folder work size',
    projectCandidateDocuments
  );
  assert(
    projectCandidateDocuments.length === 1
      && projectCandidateDocuments[0]?.sizeProfileId === 'custom-explicit-main-image'
      && projectCandidateExportSpecs.length > 0
      && projectCandidateExportSpecs.every((spec) => spec.imageType === 'click'),
    'project candidate branch should scope production structure to the requested explicit first-image document only',
    {
      projectCandidateDocuments,
      projectCandidateExportSpecs
    }
  );
  assert(
    projectCandidateStrategy?.assetHeroStrategy?.assetUnderstanding?.selectedAssetPath === projectCandidatePath,
    'project candidate branch should promote the selected project candidate into selectedAsset trace',
    projectCandidateStrategy?.assetHeroStrategy
  );
  assert(
    projectCandidateStrategy?.assetHeroStrategy?.heroSubjectSelection?.bounds?.width === 1600
      && projectCandidateStrategy?.assetHeroStrategy?.heroSubjectSelection?.bounds?.height === 1000,
    'project candidate branch should derive subject bounds from project asset metadata when no explicit bounds are provided',
    projectCandidateStrategy?.assetHeroStrategy?.heroSubjectSelection
  );
  assert(
    projectCandidateExportRequests.length > 0
      && projectCandidateExportDirs.every((dir) => dir === 'C:/project/主图'),
    'project candidate branch should derive outputDir from projectPath + 主图 when outputDirPolicy=project-main-image-dir',
    projectCandidateExportDirs
  );
  assert(
    projectCandidateQuickExportPaths.every((item) => !item.includes('/主图/主图/')),
    'project candidate branch should not duplicate 主图 in quick export record paths',
    projectCandidateQuickExportPaths
  );

  const memory = getMemoryService();
  memory.updatePreferences({
    design: {
      preferredFonts: ['阿里巴巴普惠体'],
      preferredColors: ['#f8f8f8'],
      preferredStyles: ['浅色干净']
    },
    workflow: {
      defaultExportFormat: 'jpg'
    }
  });
  const memoryOnlyRun = await execute({
    ...baseParams,
    knowledgeResults: undefined
  });
  const memoryReferencePlan = memoryOnlyRun.result.data?.mainImageStrategyInputBundle?.projectStyleStrategy?.referenceResearchPlan;
  const memoryContext = memoryOnlyRun.result.data?.mainImageStrategyInputBundle?.mainImageMemoryContext;
  const memoryCopyPolicy = memoryOnlyRun.result.data?.mainImageStrategyInputBundle?.strategyInputs?.copyRolePolicy;
  assert(
    memoryReferencePlan?.referenceHintCount === 0,
    'renderer memory preferences should not be mixed into external reference record',
    memoryReferencePlan
  );
  assert(
    memoryContext?.status === 'available'
      && memoryContext.preferenceSummary?.stylePreferences?.includes('浅色干净')
      && memoryContext.preferenceSummary?.typographyPreferences?.includes('阿里巴巴普惠体'),
    'strategy-only branch should expose renderer memory preferences as structured mainImageMemoryContext',
    memoryContext
  );
  assert(
    memoryCopyPolicy?.designMemory?.sourceResultCount >= 1,
    'memory record should reach copyRolePolicy.designMemory without becoming referenceCount',
    memoryCopyPolicy
  );
  assert(memoryCopyPolicy?.referenceCount === 0, 'memory-only run should not inflate external reference count', memoryCopyPolicy);
  assertNoConfidence(memoryReferencePlan, 'memory-driven reference plan');
  assertNoConfidence(memoryContext, 'memory-driven structured context');

  const defaultThreeSpecParams = { ...baseParams };
  delete defaultThreeSpecParams.sizePlans;
  delete defaultThreeSpecParams.size;
  delete defaultThreeSpecParams.sizes;
  const defaultThreeSpecRun = await execute(defaultThreeSpecParams);
  const defaultThreeSpecDocuments = defaultThreeSpecRun.result.data?.mainImageStrategyInputBundle?.productionExecutionPlan?.documents || [];
  const defaultThreeSpecSizeKeys = defaultThreeSpecDocuments
    .map((doc) => String(doc.sizeProfileId || '').match(/tmall-(800|750|1200)-main-image/)?.[1])
    .filter(Boolean);
  const defaultThreeSpecExportSpecs = defaultThreeSpecRun.result.data?.mainImageStrategyInputBundle?.productionExecutionPlan?.exportSpecs || [];
  const exportTypes1200 = defaultThreeSpecExportSpecs
    .filter((spec) => String(spec.documentId || '').includes('1200'))
    .map((spec) => spec.imageType);
  const designCoreDocuments = defaultThreeSpecRun.result.data?.mainImageDesignCorePlan?.deliveryDocuments || [];
  const designCoreDocumentKeys = designCoreDocuments.map((doc) => doc.folderKey);
  const document1200 = designCoreDocuments.find((doc) => doc.folderKey === '1200');
  assert(
    JSON.stringify(defaultThreeSpecSizeKeys) === JSON.stringify(['800', '750', '1200']),
    'default strategy-only branch should infer all three production size plans when the user only says to make main images',
    defaultThreeSpecRun.result.data
  );
  assert(
    JSON.stringify(designCoreDocumentKeys) === JSON.stringify(['800', '750', '1200'])
      && document1200?.includedImageTypes?.length === 1
      && document1200.includedImageTypes[0] === 'click'
      && document1200.excludedImageTypes?.includes('conversion')
      && exportTypes1200.length > 0
      && exportTypes1200.every((imageType) => imageType === 'click'),
    'design core record should expose 800/750/1200 documents and forbid conversion image in 1200',
    {
      designCorePlan: defaultThreeSpecRun.result.data?.mainImageDesignCorePlan,
      exportTypes1200
    }
  );
  assert(
    defaultThreeSpecRun.result.data?.mainImageDesignCorePlan?.whiteBackgroundSpec?.sourceDocumentPath === 'PSD/SKU.psb'
      && defaultThreeSpecRun.result.data?.mainImageDesignCorePlan?.whiteBackgroundSpec?.outputPath === '主图/白底.jpg'
      && defaultThreeSpecRun.result.data?.mainImageDesignCorePlan?.whiteBackgroundSpec?.canvasSize?.width === 800
      && defaultThreeSpecRun.result.data?.mainImageDesignCorePlan?.whiteBackgroundSpec?.canvasSize?.height === 800,
    'design core record should expose white background export rules from SKU source document',
    defaultThreeSpecRun.result.data?.mainImageDesignCorePlan?.whiteBackgroundSpec
  );

  const staleExternalPlansRun = await execute({
    ...baseParams,
    sizePlans: [
      {
        sizeKey: 'tmall-1x1-main-image',
        targetSize: { width: 800, height: 800 },
        subjectSize: { width: 620, height: 420 },
        scale: 0.72,
        targetX: 90,
        targetY: 270,
        decisionReason: 'legacy external 1x1 plan',
        smartLayoutPlanned: true,
        quickExportPlanned: true
      },
      {
        sizeKey: 'tmall-3x4-main-image',
        targetSize: { width: 800, height: 1067 },
        subjectSize: { width: 620, height: 420 },
        scale: 0.72,
        targetX: 90,
        targetY: 380,
        decisionReason: 'legacy external 3x4 plan',
        smartLayoutPlanned: true,
        quickExportPlanned: true
      }
    ]
  });
  const normalizedExternalDocuments = staleExternalPlansRun.result.data?.mainImageStrategyInputBundle?.productionExecutionPlan?.documents || [];
  const normalizedExternalKeys = normalizedExternalDocuments
    .map((doc) => String(doc.sizeProfileId || '').match(/tmall-(800|750|1200)-main-image/)?.[1])
    .filter(Boolean);
  assert(
    staleExternalPlansRun.result.data?.mainImageStrategyInputBundle?.productionExecutionPlan?.status === 'ready_execution_plan'
      && JSON.stringify(normalizedExternalKeys) === JSON.stringify(['800', '750', '1200']),
    'external legacy sizePlans should be normalized and completed to the project 800/750/1200 delivery contract',
    staleExternalPlansRun.result.data?.mainImageStrategyInputBundle?.productionExecutionPlan
  );

  const missingApproval = await execute({
    ...baseParams,
    mainImageExecutionMode: 'product-disposable-live',
    executionScope: 'disposable-document',
    approvedLiveExecution: true,
    approvedLiveAdapterRun: false,
    photoshopConnection: { connected: true, documentWriteAvailable: true, source: 'smoke' }
  });
  assert(missingApproval.result.success === false, 'missing live adapter approval should block product disposable live branch', missingApproval.result);
  assert(missingApproval.result.data?.mainImageExecutionMode === 'product-disposable-live', 'blocked result should expose requested mode', missingApproval.result.data);
  assert((missingApproval.result.toolResults || []).length === 0, 'blocked product branch must not call Photoshop tools', missingApproval.result.toolResults);
  assert(missingApproval.result.data?.mainImageControlledProductAdapter?.status === 'blocked_requires_explicit_live_approval', 'missing adapter approval should be explicit', missingApproval.result.data);

  const previousWindow = global.window;
  const previousFetch = global.fetch;
  global.fetch = async () => {
    throw new Error('smoke forces IPC connection fallback');
  };
  global.window = {
    designEcho: {
      invoke: async (channel) => {
        assert(channel === 'ws:status', 'runtime connection fallback should only query ws:status', { channel });
        return { connected: true };
      }
    }
  };
  try {
    const runtimeConnectionRun = await execute({
      ...baseParams,
      mainImageExecutionMode: 'product-disposable-live',
      executionScope: 'disposable-document',
      approvedLiveExecution: true,
      approvedLiveAdapterRun: false
    });
    assert(runtimeConnectionRun.result.success === false, 'runtime connection branch should still stop before adapter approval', runtimeConnectionRun.result);
    assert((runtimeConnectionRun.result.toolResults || []).length === 0, 'runtime connection approval gate must not call Photoshop tools', runtimeConnectionRun.result.toolResults);
    assert(
      runtimeConnectionRun.result.data?.mainImageLiveExecutorCheckpoint?.status === 'ready_for_live_executor_run',
      'runtime Photoshop connection should populate controlled checkpoint when params.photoshopConnection is absent',
      runtimeConnectionRun.result.data
    );
    assert(
      runtimeConnectionRun.result.data?.mainImageControlledProductAdapter?.status === 'blocked_requires_explicit_live_approval',
      'runtime Photoshop connection should reach adapter approval guard instead of Photoshop unavailable',
      runtimeConnectionRun.result.data
    );
  } finally {
    if (previousWindow === undefined) {
      delete global.window;
    } else {
      global.window = previousWindow;
    }
    if (previousFetch === undefined) {
      delete global.fetch;
    } else {
      global.fetch = previousFetch;
    }
  }

  const missingConnection = await execute({
    ...baseParams,
    mainImageExecutionMode: 'product-disposable-live',
    executionScope: 'disposable-document',
    approvedLiveExecution: true,
    approvedLiveAdapterRun: true,
    photoshopConnection: { connected: false, documentWriteAvailable: false, source: 'smoke' }
  });
  assert(missingConnection.result.success === false, 'missing Photoshop connection should block before adapter execution', missingConnection.result);
  assert((missingConnection.result.toolResults || []).length === 0, 'missing connection branch must not call Photoshop tools', missingConnection.result.toolResults);
  assert(missingConnection.result.data?.mainImageLiveExecutorCheckpoint?.status === 'blocked_photoshop_unavailable', 'checkpoint should report Photoshop unavailable', missingConnection.result.data);

  const activeScope = await execute({
    ...baseParams,
    mainImageExecutionMode: 'product-disposable-live',
    executionScope: 'active-document',
    approvedLiveExecution: true,
    approvedLiveAdapterRun: true,
    photoshopConnection: { connected: true, documentWriteAvailable: true, source: 'smoke' }
  });
  assert(activeScope.result.success === false, 'active-document scope should be blocked for controlled product branch', activeScope.result);
  assert((activeScope.result.toolResults || []).length === 0, 'active-document blocked branch must not call Photoshop tools', activeScope.result.toolResults);
  assert(activeScope.result.data?.mainImageLiveExecutorCheckpoint?.status === 'ready_for_live_executor_run', 'checkpoint may be ready before adapter scope guard', activeScope.result.data);
  assert(activeScope.result.data?.mainImageControlledProductAdapter?.status === 'blocked_non_disposable_scope', 'adapter should reject non-disposable scope', activeScope.result.data);

  console.log(JSON.stringify({
    success: true,
    checks: [
      'default main-image executor is strategy-only and does not call Photoshop',
      'strategy-only branch exposes request/checkpoint record without running the live runner',
      'product-disposable-live blocks without explicit adapter approval',
      'product-disposable-live blocks when Photoshop connection is unavailable',
      'product-disposable-live blocks non-disposable scopes before tool execution',
      'controlled product live branch is wired to result file probes and pixel probe adapter',
      'executor record redacts raw image-like payloads',
      'strategy-only branch can consume renderer memory preferences as structured memory record'
    ]
  }, null, 2));
}

run().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
