#!/usr/bin/env node

require('ts-node').register({
  transpileOnly: true,
  compilerOptions: {
    target: 'ES2020',
    module: 'CommonJS',
    moduleResolution: 'node',
    esModuleInterop: true,
    skipLibCheck: true
  }
});

const path = require('path');

const ROOT = path.resolve(__dirname, '..');

const {
  applySharedSkillParamDefaults
} = require(path.join(ROOT, 'src', 'shared', 'skill-param-defaults.ts'));
const {
  buildMainImageWhiteBackgroundExportContract,
  buildMainImageWhiteBackgroundLiveToolRequest,
  MAIN_IMAGE_WHITE_BG_FROM_SKU_CAPABILITY_ID
} = require(path.join(ROOT, 'src', 'shared', 'main-image-white-background-export-contract.ts'));
const {
  fastDeterministicRoute
} = require(path.join(ROOT, 'src', 'renderer', 'services', 'agent-orchestration', 'routing.ts'));
const {
  buildBusinessVisualContextForSkill,
  buildBusinessSkillVisualContextPreparationForSkill
} = require(path.join(ROOT, 'src', 'renderer', 'services', 'skill-executors', 'business-skill-visual-context.ts'));
const {
  buildAgentDesignExecutionPreflight
} = require(path.join(ROOT, 'src', 'shared', 'agent-design-execution-preflight.ts'));
const fs = require('fs');

function assert(condition, message, details) {
  if (!condition) {
    const suffix = details ? `\n${JSON.stringify(details, null, 2)}` : '';
    throw new Error(`${message}${suffix}`);
  }
}

function buildSkuOnlyProjectContext() {
  return {
    projectPath: 'D:/demo-project/C-1166',
    assetIndex: {
      indexVersion: 'project-asset-index/v0',
      generatedAt: '2026-05-30T00:00:00.000Z',
      projectPath: 'D:/demo-project/C-1166',
      assets: [{
        id: 'asset-sku-psb',
        path: 'D:/demo-project/C-1166/PSD/SKU.psb',
        relativePath: 'PSD/SKU.psb',
        name: 'SKU.psb',
        extension: '.psb',
        folderRole: 'psd',
        role: 'psd',
        isImage: false,
        isDesignDocument: true,
        isOutput: false,
        needsVision: false,
        reasons: ['design document extension'],
        comboColors: [],
        evidence: []
      }],
      visionCandidates: [],
      summary: {
        totalFiles: 1,
        totalImages: 0,
        totalDesignDocuments: 1,
        roleCounts: { psd: 1 },
        folderRoleCounts: { psd: 1 },
        extensionCounts: { '.psb': 1 },
        colorNames: [],
        skuConfigCount: 0
      },
      skillReadiness: [],
      warnings: [],
      limitations: []
    },
    visualSamplingPlan: {
      planVersion: 'project-visual-sampling/v0',
      mode: 'bounded-metadata-plan',
      scenario: 'main-image',
      maxCandidates: 2,
      selectedCandidates: [],
      skippedCandidateCount: 0,
      cacheSummary: { hit: 0, miss: 0, stale: 0, shouldAnalyze: 0 },
      warnings: [],
      limitations: [],
      evidence: []
    },
    visualInsightCache: {
      cacheVersion: 'project-visual-insight-cache/v0',
      source: 'missing',
      exists: false,
      entries: [],
      summary: { totalEntries: 0, entriesWithInsight: 0, entriesWithRawPayloadRemoved: 0 },
      warnings: [],
      limitations: [],
      evidence: []
    }
  };
}

function run() {
  const mainImageExecutorSource = fs.readFileSync(
    path.join(ROOT, 'src', 'renderer', 'services', 'skill-executors', 'main-image.executor.ts'),
    'utf8'
  );
  const whiteBgLiveReturnBlock = mainImageExecutorSource.slice(
    mainImageExecutorSource.indexOf("success ? '**白底图已导出**'"),
    mainImageExecutorSource.indexOf('toolResults: [{', mainImageExecutorSource.indexOf("success ? '**白底图已导出**'"))
  );
  assert(mainImageExecutorSource.includes('Photoshop 可能正被弹窗或面板状态阻塞'), 'white-bg failure message should be user-facing and actionable', mainImageExecutorSource);
  assert(!/来源=|工具=|读回=|sourceDocumentPath|outputPath|exportWhiteBgFromSkuMaterial/.test(whiteBgLiveReturnBlock), 'white-bg visible live result must not leak debug fields, raw paths or tool names', whiteBgLiveReturnBlock);

  const whiteBgIntentVariants = [
    '帮我使用SKU素材做白底图导出到主图目录下',
    '使用SKU素材做白底图导出到主图目录下',
    '帮我使用SKU素材做白底导出到主图目录下',
    '帮我使用SKU素材做自底图导出到主图目录下'
  ];
  const userIntent = whiteBgIntentVariants[0];
  const defaults = applySharedSkillParamDefaults({
    skillId: 'main-image-design',
    userInput: userIntent,
    params: {}
  });

  assert(defaults.imageType === 'white-bg', 'C-1166 request should infer white-bg imageType', defaults);
  assert(defaults.sourceAssetKind === 'project-sku-material', 'C-1166 request should define SKU as source material, not SKU batch task', defaults);
  assert(defaults.outputDirPolicy === 'project-main-image-dir', 'C-1166 request should target the project main-image directory', defaults);
  assert(defaults.mainImageCapability === MAIN_IMAGE_WHITE_BG_FROM_SKU_CAPABILITY_ID, 'C-1166 request should carry the white-bg capability id', defaults);
  assert(defaults.whiteBackgroundOutputRelativePath === '主图/白底.jpg', 'white-bg output path should be normalized to 主图/白底.jpg', defaults);

  const route = fastDeterministicRoute(userIntent);
  assert(route?.skillId === 'main-image-design', 'C-1166 request must route to main-image-design', route);
  assert(route.skillParams?.imageType === 'white-bg', 'route should keep white-bg imageType', route);
  assert(route.skillParams?.sourceAssetKind === 'project-sku-material', 'route should keep project SKU source kind', route);
  assert(route.skillParams?.outputDirPolicy === 'project-main-image-dir', 'route should keep project main-image output policy', route);
  assert(route.skillParams?.mainImageExecutionMode === 'product-disposable-live', 'explicit C-1166 export request should enter controlled live execution', route);
  assert(route.skillParams?.approvedLiveExecution !== true, 'routing defaults must not mint live-execution approval', route);
  assert(route.skillParams?.approvedLiveAdapterRun !== true, 'routing defaults must not mint Photoshop-adapter approval', route);
  assert(route.skillParams?.userCheckpointApproved !== true, 'routing defaults must not mint a user-checkpoint approval', route);

  for (const variant of whiteBgIntentVariants) {
    const variantDefaults = applySharedSkillParamDefaults({
      skillId: 'main-image-design',
      userInput: variant,
      params: {}
    });
    const variantRoute = fastDeterministicRoute(variant);
    assert(variantDefaults.imageType === 'white-bg', `white-bg variant should infer imageType: ${variant}`, variantDefaults);
    assert(variantDefaults.sourceAssetKind === 'project-sku-material', `white-bg variant should keep SKU as source material: ${variant}`, variantDefaults);
    assert(variantDefaults.outputDirPolicy === 'project-main-image-dir', `white-bg variant should target the project main-image dir: ${variant}`, variantDefaults);
    assert(variantRoute?.skillId === 'main-image-design', `white-bg variant must route to main-image-design: ${variant}`, variantRoute);
    assert(variantRoute.skillParams?.mainImageExecutionMode === 'product-disposable-live', `white-bg variant should enter controlled live execution: ${variant}`, variantRoute);
  }

  const repeatedParticleRoute = fastDeterministicRoute('帮我使用SKU素材做白底图导出到到主图目录下');
  assert(repeatedParticleRoute?.skillId === 'main-image-design', 'C-1166 repeated-particle wording must still route to main-image-design', repeatedParticleRoute);
  assert(repeatedParticleRoute.skillParams?.imageType === 'white-bg', 'repeated-particle wording should keep white-bg imageType', repeatedParticleRoute);
  assert(repeatedParticleRoute.skillParams?.sourceAssetKind === 'project-sku-material', 'repeated-particle wording should keep project SKU source kind', repeatedParticleRoute);
  assert(repeatedParticleRoute.skillParams?.mainImageExecutionMode === 'product-disposable-live', 'repeated-particle wording should still enter controlled live execution', repeatedParticleRoute);

  const strategyContract = buildMainImageWhiteBackgroundExportContract({
    userIntent,
    imageType: route.skillParams.imageType,
    sourceAssetKind: route.skillParams.sourceAssetKind,
    outputDirPolicy: route.skillParams.outputDirPolicy,
    mainImageExecutionMode: 'strategy-only',
    projectPath: 'D:/demo-project/C-1166'
  });

  assert(strategyContract.status === 'ready_strategy_only_contract', 'white-bg SKU source contract should support strategy-only mode', strategyContract);
  assert(strategyContract.capabilityId === MAIN_IMAGE_WHITE_BG_FROM_SKU_CAPABILITY_ID, 'contract should expose a stable capability id', strategyContract);
  assert(strategyContract.skillId === 'main-image-design', 'contract belongs to main-image-design', strategyContract);
  assert(strategyContract.source.kind === 'project-sku-material', 'contract source should be project SKU material', strategyContract);
  assert(strategyContract.source.relativeDocumentPath === 'PSD/SKU.psb', 'contract source should use project PSD/SKU.psb', strategyContract);
  assert(strategyContract.exportTarget.policy === 'project-main-image-dir', 'contract export target should use project main image directory', strategyContract);
  assert(strategyContract.exportTarget.relativePath === '主图/白底.jpg', 'contract export target should be 主图/白底.jpg', strategyContract);
  assert(strategyContract.canvasSize.width === 800 && strategyContract.canvasSize.height === 800, 'white-bg export should be 800x800', strategyContract);
  assert(strategyContract.photoshopWriteAllowed === false, 'strategy-only contract must not write Photoshop', strategyContract);
  assert(strategyContract.requiredChecks.includes('project_sku_document'), 'contract should require a project SKU document check', strategyContract);
  assert(strategyContract.requiredChecks.includes('white_background_export_target'), 'contract should require an export target check', strategyContract);
  assert(!strategyContract.requiredChecks.includes('visual_observation'), 'simple white-bg export contract should not require semantic visual observation', strategyContract);
  assert(
    strategyContract.toolContract.requiredToolCapabilities.includes('exportWhiteBgFromSkuMaterial'),
    'contract should name the dedicated white-bg SKU material export tool',
    strategyContract.toolContract
  );

  const strategyToolRequest = buildMainImageWhiteBackgroundLiveToolRequest(strategyContract);
  assert(strategyToolRequest.canExecute === false, 'strategy-only contract should not create an executable live request', strategyToolRequest);
  assert(strategyToolRequest.toolName === 'exportWhiteBgFromSkuMaterial', 'tool request should use the dedicated UXP tool', strategyToolRequest);

  const liveContract = buildMainImageWhiteBackgroundExportContract({
    userIntent,
    imageType: 'white-bg',
    sourceAssetKind: 'project-sku-material',
    outputDirPolicy: 'project-main-image-dir',
    mainImageExecutionMode: 'product-disposable-live',
    approvedLiveExecution: true,
    approvedLiveAdapterRun: true,
    projectPath: 'D:/demo-project/C-1166',
    preferredSkuColor: '白色'
  });
  const liveToolRequest = buildMainImageWhiteBackgroundLiveToolRequest(liveContract);
  assert(liveContract.status === 'ready_live_execution_contract', 'approved live contract should be ready for live execution', liveContract);
  assert(liveToolRequest.canExecute === true, 'approved live contract should create an executable UXP tool request', liveToolRequest);
  assert(liveToolRequest.toolName === 'exportWhiteBgFromSkuMaterial', 'live tool request should use the dedicated UXP tool', liveToolRequest);
  assert(liveToolRequest.params.sourceDocumentPath === 'D:/demo-project/C-1166/PSD/SKU.psb', 'live tool request should resolve the absolute SKU source path', liveToolRequest);
  assert(liveToolRequest.params.outputPath === 'D:/demo-project/C-1166/主图/白底.jpg', 'live tool request should resolve the exact main-image white-bg output path', liveToolRequest);
  assert(liveToolRequest.params.preferredLayerName === '白色', 'live tool request should pass preferred SKU color to the UXP tool', liveToolRequest);
  assert(liveToolRequest.params.canvasWidth === 800 && liveToolRequest.params.canvasHeight === 800, 'live tool request should keep 800x800 white-bg size', liveToolRequest);
  assert(liveToolRequest.params.targetSubjectHeightPx === 760, 'live tool request should keep the white-bg subject height policy', liveToolRequest);

  const preflight = buildAgentDesignExecutionPreflight({
    userText: userIntent,
    route: 'skill_execution',
    routeSource: 'deterministic',
    skillId: 'main-image-design',
    mode: route.mode,
    params: route.skillParams,
    projectContext: buildSkuOnlyProjectContext()
  });
  assert(preflight.status === 'context_ready', 'white-bg SKU export should expose its controlled production context', preflight);
  assert(!Object.hasOwn(preflight, 'shouldExecute'), 'design context preflight must not own execution authority', preflight);
  assert(preflight.requiredInputs.includes('white-background-export-contract'), 'preflight should list the white-bg export contract input', preflight);

  const visualContext = buildBusinessVisualContextForSkill('main-image-design', {
    params: route.skillParams,
    context: {
      userInput: userIntent,
      conversationHistory: [],
      isPluginConnected: true,
      projectContext: buildSkuOnlyProjectContext()
    }
  });

  assert(visualContext?.status === 'not_required', 'white-bg export from project SKU.psb should not ask for visual candidate confirmation', visualContext);
  assert(!Object.hasOwn(visualContext, 'shouldExecute'), 'visual context must not own executor permission', visualContext);

  const visualContextPreparation = buildBusinessSkillVisualContextPreparationForSkill('main-image-design', {
    params: route.skillParams,
    context: {
      userInput: userIntent,
      conversationHistory: [],
      isPluginConnected: true,
      projectContext: buildSkuOnlyProjectContext()
    }
  });
  assert(visualContextPreparation?.status === 'not_applicable', 'white-bg export should not require visual sampling preparation', visualContextPreparation);
  assert(!Object.hasOwn(visualContextPreparation, 'canRunBusinessExecutor'), 'visual context preparation must not own executor permission', visualContextPreparation);

  const repeatedParticleContext = buildBusinessVisualContextForSkill('main-image-design', {
    params: repeatedParticleRoute.skillParams,
    context: {
      userInput: '帮我使用SKU素材做白底图导出到到主图目录下',
      conversationHistory: [],
      isPluginConnected: true,
      projectContext: buildSkuOnlyProjectContext()
    }
  });
  assert(repeatedParticleContext?.status === 'not_required', 'repeated-particle white-bg export should not surface no-image-candidate business feedback', repeatedParticleContext);
  assert(!Object.hasOwn(repeatedParticleContext, 'shouldExecute'), 'repeated-particle visual context must not own executor permission', repeatedParticleContext);
}

try {
  run();
  console.log('[smoke-main-image-white-bg-sku-material-contract] PASS');
} catch (error) {
  console.error('[smoke-main-image-white-bg-sku-material-contract] FAIL');
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
}
