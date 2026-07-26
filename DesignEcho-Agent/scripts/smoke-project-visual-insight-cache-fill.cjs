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

const {
  buildProjectVisualInsightCacheFillPlan,
  mapAssetAnalysisToProjectVisualInsight
} = require('../src/shared/project-visual-insight-cache-fill.ts');
const {
  runProjectVisualInsightCacheFill
} = require('../src/renderer/services/project-visual-insight-cache-fill.ts');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertNoMojibake(value, label) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  const signals = [String.fromCharCode(0x9359), String.fromCharCode(0x7487), '\ufffd'];
  for (const signal of signals) {
    assert(!text.includes(signal), `${label} contains mojibake signal ${JSON.stringify(signal)}`);
  }
}

function assertNoRawPayload(value, label) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  for (const forbidden of ['SHOULD_BE_REMOVED', 'base64', 'imageBase64', 'rawImageBase64', 'dataUrl']) {
    assert(!text.includes(forbidden), `${label} should not contain raw image payload ${forbidden}`);
  }
}

function buildCandidate(index, overrides = {}) {
  return {
    assetId: `asset-${index}`,
    path: `C:/fixture/project/source/sock-${index}.jpg`,
    role: index === 3 ? 'raw-detail-closeup' : 'raw-model-wear',
    priority: 100 - index,
    score: 100 - index,
    reason: `fixture candidate ${index}`,
    cacheKey: `project-visual:fixture-${index}`,
    cacheStatus: 'miss',
    shouldAnalyze: true,
    requiredObservations: ['visual model or human observation required'],
    selectionNotes: [{
      source: 'smoke',
      summary: `candidate ${index}`,
      status: 'unknown'
    }],
    ...overrides
  };
}

function buildPlan() {
  return {
    planVersion: 'project-visual-sampling/v0',
    mode: 'bounded-metadata-plan',
    scenario: 'main-image',
    maxCandidates: 3,
    selectedCandidates: [
      buildCandidate(1),
      buildCandidate(2),
      buildCandidate(3, { cacheStatus: 'hit', shouldAnalyze: false })
    ],
    skippedCandidateCount: 4,
    cacheSummary: {
      hit: 1,
      miss: 2,
      stale: 0,
      shouldAnalyze: 2
    },
    warnings: [],
    limitations: ['smoke fixture'],
    sourceRecords: []
  };
}

async function main() {
  const visualSamplingPlan = buildPlan();
  let analyzerCalls = 0;
  let writerCalls = 0;
  let writtenEntries = [];

  const disabledPlan = buildProjectVisualInsightCacheFillPlan({
    projectPath: 'C:/fixture/project',
    visualSamplingPlan,
    enabled: false,
    hasAnalyzer: true,
    hasWriter: true
  });
  assert(disabledPlan.status === 'disabled', 'disabled plan should stay disabled');
  assert(disabledPlan.shouldCallAnalyzer === false, 'disabled plan should not call analyzer');
  assert(disabledPlan.warnings.some((item) => item.includes('文件名')), 'disabled plan should warn against filename inference');

  const blockedPlan = buildProjectVisualInsightCacheFillPlan({
    projectPath: 'C:/fixture/project',
    visualSamplingPlan,
    enabled: true,
    hasAnalyzer: false,
    hasWriter: true
  });
  assert(blockedPlan.status === 'blocked_no_analyzer', 'enabled plan without analyzer should block');
  assert(blockedPlan.candidates.length === 2, 'blocked plan should still expose bounded candidates');

  const emptyInsight = mapAssetAnalysisToProjectVisualInsight({
    candidate: visualSamplingPlan.selectedCandidates[0],
    payload: {
      success: true,
      analysis: {}
    }
  });
  assert(emptyInsight === null, 'empty analysis should not fabricate visual insight');

  const result = await runProjectVisualInsightCacheFill({
    projectPath: 'C:/fixture/project',
    visualSamplingPlan,
    enabled: true,
    maxCandidates: 2,
    modelId: 'smoke-vision-model',
    nowIso: '2026-05-15T00:00:00.000Z',
    analyzeAssetContent: async (imagePath) => {
      analyzerCalls += 1;
      if (imagePath.includes('sock-2')) {
        return { success: false, error: 'fixture analyzer failure', imageBase64: 'SHOULD_BE_REMOVED' };
      }
      return {
        success: true,
        imageBase64: 'SHOULD_BE_REMOVED',
        analysis: {
          description: '白色袜子上脚图',
          category: 'product_main',
          mainSubject: '袜子',
          colors: ['#ffffff', '#d8d8d8'],
          style: '清爽',
          suggestedPlacement: 'hero image',
          suggestedEffects: ['direct_use']
        }
      };
    },
    writeProjectVisualInsightCache: async (options) => {
      writerCalls += 1;
      writtenEntries = options.entries;
      return { success: true };
    }
  });

  assert(analyzerCalls === 2, 'enabled runner should call analyzer for two miss candidates only');
  assert(writerCalls === 1, 'runner should write successful entries once');
  assert(result.status === 'partial', 'one success and one failed candidate should be partial');
  assert(result.analyzedCount === 2, 'result should record analyzed count');
  assert(result.successCount === 1, 'result should record success count');
  assert(result.failedCount === 1, 'result should record failed count');
  assert(result.entries.length === 1, 'result should include only successful cache entries');
  assert(!JSON.stringify(result).includes('"evidence"'), 'fill result must not expose a generic evidence field');
  assert(writtenEntries.length === 1, 'writer should receive only successful cache entries');
  assert(result.entries[0].insight.productType === '袜子', 'cache insight should map product type from real analysis payload');
  assert(result.entries[0].insight.modelId === 'smoke-vision-model', 'cache insight should record model id');
  assert(result.limitations.some((item) => item.includes('不会批量调用视觉模型')), 'runner should expose no-bulk-scan limitation');
  assertNoMojibake({ disabledPlan, blockedPlan, result }, 'visual insight cache fill result');
  assertNoRawPayload({ disabledPlan, blockedPlan, result, writtenEntries }, 'visual insight cache fill result');

  console.log(JSON.stringify({
    ok: true,
    disabledStatus: disabledPlan.status,
    blockedStatus: blockedPlan.status,
    enabledStatus: result.status,
    analyzerCalls,
    writerCalls,
    writtenEntries: writtenEntries.length
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
