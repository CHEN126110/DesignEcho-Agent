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

const fs = require('fs');
const path = require('path');

const {
  buildProjectAssetUnderstandingIntake
} = require('../src/shared/project-asset-understanding-intake.ts');
const {
  executeSkillWithExecutor,
  registerSkillExecutor
} = require('../src/renderer/services/skill-executors/index.ts');
const {
  prepareBusinessSkillProjectContextForScenario
} = require('../src/renderer/services/skill-executors/business-skill-visual-context.ts');

const ROOT = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function assert(condition, message, details) {
  if (!condition) {
    const suffix = details ? `\n${JSON.stringify(details, null, 2)}` : '';
    throw new Error(`${message}${suffix}`);
  }
}

function buildAsset(id, role, name) {
  return {
    id,
    path: `D:/demo/source/${name}`,
    relativePath: `source/${name}`,
    name,
    extension: '.jpg',
    role,
    folderRole: 'source',
    comboColors: [],
    isImage: true,
    isDesignDocument: false,
    isOutput: false,
    needsVision: true,
    confidence: 0.76,
    reasons: ['fixture'],
    classificationNotes: []
  };
}

function buildAssetIndex() {
  return {
    indexVersion: 'project-asset-index/v0',
    projectPath: 'D:/demo',
    generatedFrom: 'file-metadata',
    summary: {
      totalFiles: 3,
      totalImages: 3,
      totalDesignDocuments: 0,
      roleCounts: {
        'raw-model-wear': 1,
        'raw-product-still': 1,
        'raw-detail-closeup': 0,
        'color-single': 1,
        'main-image-output': 0,
        'sku-output': 0,
        'detail-page-slice': 0,
        template: 0,
        psd: 0,
        config: 0,
        archive: 0,
        unknown: 0
      },
      folderRoleCounts: {},
      extensionCounts: { '.jpg': 3 },
      colorNames: ['白色'],
      skuConfigCount: 0
    },
    assets: [
      buildAsset('asset-1', 'raw-model-wear', 'wear.jpg'),
      buildAsset('asset-2', 'raw-product-still', 'still.jpg'),
      buildAsset('asset-3', 'color-single', 'white.jpg')
    ],
    representativeSamples: {},
    visionCandidates: [
      {
        assetId: 'asset-1',
        path: 'D:/demo/source/wear.jpg',
        role: 'raw-model-wear',
        priority: 100,
        reason: 'wear candidate'
      },
      {
        assetId: 'asset-2',
        path: 'D:/demo/source/still.jpg',
        role: 'raw-product-still',
        priority: 90,
        reason: 'still candidate'
      }
    ],
    skillReadiness: [
      {
        skill: 'main-image',
        status: 'needs_visual_sampling',
        candidateCount: 3,
        blockers: [],
        warnings: ['需要视觉模型确认。']
      }
    ],
    warnings: [],
    limitations: [],
    sourceRecords: []
  };
}

function buildCandidate(id, cacheStatus, cachedInsight) {
  return {
    assetId: id,
    path: `D:/demo/source/${id}.jpg`,
    role: id === 'asset-1' ? 'raw-model-wear' : 'raw-product-still',
    priority: 100,
    score: 120,
    reason: 'bounded fixture candidate',
    cacheKey: `project-visual:${id}`,
    cacheStatus,
    shouldAnalyze: cacheStatus !== 'hit',
    requiredObservations: ['visual model or human inspection required'],
    cachedInsight,
    selectionNotes: []
  };
}

function buildVisualSamplingPlan(cacheStatus = 'miss', scenario = 'main-image') {
  const cachedInsight = cacheStatus === 'hit'
    ? {
      assetId: 'asset-1',
      path: 'D:/demo/source/asset-1.jpg',
      summary: '白色袜子平铺图，可作为候选素材。',
      productType: '袜子',
      scene: 'product still',
      material: 'cotton',
      styleTags: ['clean', 'ecommerce'],
      rawImage: 'raw-image-payload',
      base64: 'base64-image-payload'
    }
    : undefined;
    return {
    planVersion: 'project-visual-sampling/v0',
    mode: 'bounded-metadata-plan',
    scenario,
    maxCandidates: 2,
    selectedCandidates: [
      buildCandidate('asset-1', cacheStatus, cachedInsight),
      buildCandidate('asset-2', 'miss')
    ],
    skippedCandidateCount: 0,
    cacheSummary: {
      hit: cacheStatus === 'hit' ? 1 : 0,
      miss: cacheStatus === 'hit' ? 1 : 2,
      stale: 0,
      shouldAnalyze: cacheStatus === 'hit' ? 1 : 2
    },
    warnings: [],
    limitations: [],
    sourceRecords: []
  };
}

function buildVisualInsightCache(entriesWithInsight = 0) {
  return {
    cacheVersion: 'project-visual-insight-cache/v0',
    source: entriesWithInsight > 0 ? 'provided-options' : 'missing',
    exists: entriesWithInsight > 0,
    entries: [],
    summary: {
      totalEntries: entriesWithInsight,
      entriesWithInsight,
      entriesWithRawPayloadRemoved: 0
    },
    warnings: [],
    limitations: [],
    sourceRecords: []
  };
}

function buildProjectContext(cacheStatus = 'miss', scenario = 'main-image') {
  return {
    projectPath: 'D:/demo',
    assetIndex: buildAssetIndex(),
    visualSamplingPlan: buildVisualSamplingPlan(cacheStatus, scenario),
    visualInsightCache: buildVisualInsightCache(cacheStatus === 'hit' ? 1 : 0)
  };
}

function buildExecuteParams(cacheStatus = 'miss', userInput = '帮我做主图', scenario = 'main-image') {
  return {
    params: {},
    callbacks: {
      onStep: () => undefined,
      onProgress: () => undefined,
      onMessage: () => undefined
    },
    context: {
      userInput,
      conversationHistory: [],
      isPluginConnected: true,
      projectContext: buildProjectContext(cacheStatus, scenario)
    }
  };
}

function assertNoRawPayload(value, label) {
  const text = JSON.stringify(value);
  const forbidden = ['base64-image-payload', 'raw-image-payload', 'dataUrl', 'pixels', 'buffer'];
  const found = forbidden.filter((token) => text.includes(token));
  assert(found.length === 0, `${label} contains raw payload markers: ${found.join(', ')}`);
}

function assertNoPseudoThinking(value, label) {
  const text = JSON.stringify(value);
  const forbidden = ['正在思考', '等待响应', '请求已发送', '正在准备', '稍等'];
  const found = forbidden.filter((token) => text.includes(token));
  assert(found.length === 0, `${label} contains pseudo-thinking copy: ${found.join(', ')}`);
}

function runSharedHelperChecks() {
  const missingContext = buildProjectAssetUnderstandingIntake({
    skillId: 'main-image-design',
    projectContext: null
  });
  assert(missingContext.status === 'needs_context_snapshot', 'missing project context should require ContextSnapshot', missingContext);
  assert(missingContext.canClaimDesignQuality === false, 'asset understanding cannot claim design quality');
  assert(missingContext.userVisible === false, 'asset understanding intake must stay hidden');

  const missingVisual = buildProjectAssetUnderstandingIntake({
    skillId: 'main-image-design',
    projectContext: buildProjectContext('miss')
  });
  assert(missingVisual.status === 'needs_bounded_visual_analysis', 'cache miss should require bounded visual analysis', missingVisual);
  assert(missingVisual.selectedCandidates.length === 2, 'intake should expose bounded selected candidates');
  assert(missingVisual.visualInsightCoverage.entriesWithInsight === 0, 'cache miss should not fabricate visual insight');
  assert(missingVisual.requiredNextObservations.includes('visual_understanding_required'), 'cache miss should require visual understanding');

  const cached = buildProjectAssetUnderstandingIntake({
    skillId: 'main-image-design',
    projectContext: buildProjectContext('hit')
  });
  assert(cached.status === 'ready_with_cached_visual_observations', 'cache hit should be ready with cached visual observations', cached);
  assert(cached.canUseCachedVisualObservations === true, 'cache hit should allow cached visual observation reuse');
  assert(cached.canClaimDesignQuality === false, 'cache hit still cannot claim design quality');
  assertNoRawPayload(cached, 'cached asset understanding intake');
  assertNoPseudoThinking(cached, 'cached asset understanding intake');
}

async function runExecutorWiringCheck() {
  const cases = [
    {
      skillId: 'main-image-design',
      scenario: 'main-image',
      userInput: '帮我做主图',
      data: { mainImageAgentDraft: { id: 'fixture-draft' } }
    },
    {
      skillId: 'detail-page-design',
      scenario: 'detail-page',
      userInput: '帮我做详情页',
      data: { designPlanner: { id: 'fixture-detail' } }
    },
    {
      skillId: 'sku-batch',
      scenario: 'sku',
      userInput: '帮我做 SKU',
      data: { skuBatchResult: { id: 'fixture-sku' } }
    }
  ];

  for (const item of cases) {
    let executeCalls = 0;
    registerSkillExecutor({
      skillId: item.skillId,
      execute: async () => {
        executeCalls += 1;
        return {
          success: true,
          message: `fixture ${item.skillId} executor result`,
          data: item.data
        };
      }
    });

    const result = await executeSkillWithExecutor(item.skillId, buildExecuteParams('hit', item.userInput, item.scenario));
    const data = result.data || {};
    assert(executeCalls === 1, `${item.skillId} executor should still run exactly once`);
    assert(result.success === true, `${item.skillId} intake must preserve success`);
    assert(data.businessSkillProjectAssetUnderstandingIntake, `${item.skillId} should attach asset understanding intake`);
    assert(
      data.businessSkillProjectAssetUnderstandingIntake.status === 'ready_with_cached_visual_observations',
      `${item.skillId} attached intake should reflect cached visual observations`
    );
    assert(data.businessSkillProjectAssetUnderstandingIntake.userVisible === false, `${item.skillId} intake must stay hidden`);
    assert(data.businessSkillProjectAssetUnderstandingIntake.canClaimDesignQuality === false, `${item.skillId} intake must not claim design quality`);
    assert(!result.error, `${item.skillId} must not be blocked by intake wiring`, result);
    if (data.businessSkillVisualObservationPreExecutionRun) {
      assert(
        data.businessSkillVisualObservationPreExecutionRun.executed !== true,
        `${item.skillId} default path must not execute pre-execution visual refresh`
      );
    }
    if (data.businessSkillVisualObservationRefreshRun) {
      assert(
        data.businessSkillVisualObservationRefreshRun.executed !== true,
        `${item.skillId} default path must not execute post-execution visual refresh`
      );
    }
    assertNoRawPayload(result, `${item.skillId} executor result`);
    assertNoPseudoThinking(result, `${item.skillId} executor result`);
  }
}

async function runProjectContextScenarioPreparationCheck() {
  const originalWindow = global.window;
  let snapshotCalls = 0;
  global.window = {
    designEcho: {
      buildProjectContextSnapshot: async ({ projectPath, visualSamplingScenario }) => {
        snapshotCalls += 1;
        return {
          success: true,
          source: 'fixture-runtime-project-service',
          projectPath,
          projectName: 'demo',
          contextSnapshot: {
            snapshotVersion: 'context-snapshot/v0',
            project: { path: projectPath, name: 'demo' },
            warnings: [],
            limitations: [],
            sourceRecords: []
          },
          assetIndex: buildAssetIndex(),
          visualSamplingPlan: buildVisualSamplingPlan('hit', visualSamplingScenario),
          visualInsightCache: buildVisualInsightCache(1),
          warnings: [],
          limitations: []
        };
      }
    }
  };

  try {
    const incompleteSameScenarioParams = {
      params: {},
      callbacks: {
        onStep: () => undefined,
        onProgress: () => undefined,
        onMessage: () => undefined
      },
      context: {
        userInput: '请使用当前项目图片做主图并导出',
        conversationHistory: [],
        isPluginConnected: true,
        projectContext: {
          projectPath: 'D:/demo',
          visualSamplingPlan: buildVisualSamplingPlan('miss', 'main-image')
        }
      }
    };

    const prepared = await prepareBusinessSkillProjectContextForScenario(
      'main-image-design',
      incompleteSameScenarioParams
    );
    const projectContext = prepared.context?.projectContext || {};
    assert(snapshotCalls === 1, 'incomplete same-scenario project context should be rebuilt before business execution', { snapshotCalls, projectContext });
    assert(projectContext.assetIndex?.summary?.totalImages === 3, 'rebuilt context should attach asset index', projectContext);
    assert(projectContext.visualSamplingPlan?.scenario === 'main-image', 'rebuilt context should keep requested scenario', projectContext);
    assert(projectContext.visualInsightCache?.summary?.entriesWithInsight === 1, 'rebuilt context should attach visual insight cache', projectContext);
  } finally {
    if (originalWindow === undefined) {
      delete global.window;
    } else {
      global.window = originalWindow;
    }
  }
}

function runSourceChecks() {
  const sharedSource = read('src/shared/project-asset-understanding-intake.ts');
  const wrapperSource = read('src/renderer/services/skill-executors/business-skill-visual-context.ts');
  const indexSource = read('src/renderer/services/skill-executors/index.ts');
  const registrySource = read('src/renderer/services/skill-executors/registry.ts');
  const packageJson = JSON.parse(read('package.json'));
  const architectureSource = read('scripts/report-agent-architecture.cjs');
  const cockpitSource = read('scripts/report-project-cockpit.cjs');
  const boundarySource = read('scripts/report-change-boundaries.cjs');

  assert(sharedSource.includes('canClaimDesignQuality: false'), 'shared intake must deny design quality claims');
  assert(sharedSource.includes('userVisible: false'), 'shared intake must stay hidden');
  assert(wrapperSource.includes('buildBusinessSkillProjectAssetUnderstandingIntakeForSkill'), 'wrapper should expose asset understanding builder');
  assert(indexSource.includes("from './registry'"), 'skill index should delegate unified execution to registry');
  assert(registrySource.includes('attachBusinessSkillProjectAssetUnderstandingIntakeToResult'), 'unified executor should attach asset understanding intake');
  assert(
    packageJson.scripts?.['smoke:project-asset-understanding:intake'] === 'node scripts/smoke-project-asset-understanding-intake.cjs',
    'package should register asset understanding intake smoke'
  );
  assert(
    String(packageJson.scripts?.['maintenance:preflight'] || '').includes('smoke:project-asset-understanding:intake'),
    'maintenance preflight should include asset understanding intake smoke'
  );
  assert(architectureSource.includes('projectAssetUnderstandingIntake'), 'architecture report should expose asset understanding intake');
  assert(cockpitSource.includes('projectAssetUnderstandingIntake'), 'project cockpit should expose asset understanding intake');
  assert(boundarySource.includes('project-asset-understanding'), 'change boundaries should classify asset understanding intake');
}

async function run() {
  runSharedHelperChecks();
  await runProjectContextScenarioPreparationCheck();
  await runExecutorWiringCheck();
  runSourceChecks();
  console.log(JSON.stringify({
    success: true,
    checks: [
      'project asset understanding intake summarizes ProjectAssetIndex, VisualSamplingPlan and VisualInsightCache',
      'cache miss requires bounded visual analysis without fabricating product facts',
      'cache hit can reuse cached visual observations without claiming design quality',
      'incomplete same-scenario project context is rebuilt before business execution',
      'unified business skill executor attaches hidden redacted intake context',
      'maintenance reports and preflight expose the new intake'
    ]
  }, null, 2));
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
