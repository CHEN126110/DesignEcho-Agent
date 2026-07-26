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
  buildBusinessSkillExecutionPreflightGate
} = require('../src/shared/business-skill-execution-preflight-gate.ts');
const {
  runBusinessSkillVisualObservationRefreshAfterExecution
} = require('../src/renderer/services/skill-executors/business-skill-visual-context.ts');

function assert(condition, message, details) {
  if (!condition) {
    const suffix = details ? `\n${JSON.stringify(details, null, 2)}` : '';
    throw new Error(`${message}${suffix}`);
  }
}

function buildCandidate(index) {
  return {
    assetId: `asset-${index}`,
    path: `D:/demo/source/sock-${index}.jpg`,
    role: 'raw-product-still',
    priority: 100 - index,
    score: 90 - index,
    reason: `fixture ${index}`,
    cacheKey: `project-visual:fixture-${index}`,
    cacheStatus: 'miss',
    shouldAnalyze: true,
    requiredEvidence: ['visual evidence required'],
    evidence: []
  };
}

function buildExecuteParams(params = {}) {
  return {
    params,
    context: {
      userInput: '帮我做主图',
      conversationHistory: [],
      isPluginConnected: true,
      projectContext: {
        projectPath: 'D:/demo',
        assetIndex: { summary: { totalImages: 2 }, visionCandidates: [] },
        visualSamplingPlan: {
          planVersion: 'project-visual-sampling/v0',
          mode: 'bounded-metadata-plan',
          scenario: 'main-image',
          maxCandidates: 2,
          selectedCandidates: [buildCandidate(1), buildCandidate(2)],
          skippedCandidateCount: 0,
          cacheSummary: { hit: 0, miss: 2, stale: 0, shouldAnalyze: 2 },
          warnings: [],
          limitations: [],
          evidence: []
        },
        visualInsightCache: {
          summary: { totalEntries: 0, entriesWithInsight: 0, entriesWithRawPayloadRemoved: 0 }
        }
      }
    }
  };
}

function buildGate() {
  return buildBusinessSkillExecutionPreflightGate({
    skillId: 'main-image-design',
    requestKind: 'execute_existing',
    contextState: {
      hasProjectContext: true,
      hasAssetIndex: true,
      hasVisualSamplingPlan: true,
      hasTemplateResult: true
    }
  });
}

function installVisualRuntime() {
  global.window = {
    designEcho: {
      analyzeAssetContent: async () => ({ productType: 'sock', visibleFeatures: ['texture'] }),
      writeProjectVisualInsightCache: async () => ({ ok: true })
    }
  };
}

function uninstallVisualRuntime() {
  delete global.window;
}

async function run() {
  const baseResult = { success: true, message: 'business result', data: { existing: true } };
  const gate = buildGate();
  let callCount = 0;
  const fakeRunCacheFill = async () => {
    callCount += 1;
    return {
      status: 'completed',
      analyzedCount: 2,
      successCount: 2,
      failedCount: 0,
      entries: [{ cacheKey: 'redacted-1' }, { cacheKey: 'redacted-2' }],
      warnings: [],
      limitations: [],
      evidence: [{ source: 'project-visual-insight-cache-fill', summary: 'runtime fixture', status: 'needs_review' }]
    };
  };

  uninstallVisualRuntime();
  const blocked = await runBusinessSkillVisualObservationRefreshAfterExecution(
    baseResult,
    gate,
    buildExecuteParams({
      enableBusinessVisualObservationRefresh: true,
      runBusinessVisualObservationRefresh: true
    }),
    { runCacheFill: fakeRunCacheFill }
  );
  assert(callCount === 0, 'runner must not execute when runtime capability is absent and no explicit runtime flags exist');
  assert(blocked.data.businessSkillVisualObservationRefreshPlan.status === 'blocked_no_analyzer', 'runtime-absent plan should stay blocked');
  assert(blocked.data.businessSkillVisualObservationRefreshRun.status === 'skipped_plan_not_ready', 'runtime-absent runner should skip');

  installVisualRuntime();
  const executed = await runBusinessSkillVisualObservationRefreshAfterExecution(
    baseResult,
    gate,
    buildExecuteParams({
      enableBusinessVisualObservationRefresh: true,
      runBusinessVisualObservationRefresh: true,
      visualObservationRefreshMaxCandidates: 2
    }),
    { runCacheFill: fakeRunCacheFill }
  );
  assert(callCount === 1, 'renderer runtime capability should make explicit runner executable without hidden runtime params');
  assert(executed.data.businessSkillVisualObservationRefreshPlan.status === 'ready', 'runtime-present plan should be ready');
  assert(executed.data.businessSkillVisualObservationRefreshRun.status === 'completed', 'runtime-present runner should execute');
  assert(!executed.data.businessSkillVisualObservationRefreshRun.entries, 'runner summary must not expose cache entries');
  uninstallVisualRuntime();

  console.log(JSON.stringify({
    success: true,
    checks: [
      'runtime-absent refresh stays blocked without hidden params',
      'renderer runtime capability enables explicit refresh without hidden params',
      'runtime-enabled refresh still returns summary-only evidence'
    ]
  }, null, 2));
}

run().catch((error) => {
  uninstallVisualRuntime();
  console.error(error);
  process.exit(1);
});
