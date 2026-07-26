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
  buildBusinessSkillVisualContextPreparation
} = require('../src/shared/business-skill-visual-context-preparation.ts');
const {
  runBusinessSkillVisualObservationRefreshBeforeExecution
} = require('../src/renderer/services/skill-executors/business-skill-visual-context.ts');
const {
  executeSkillWithExecutor,
  registerSkillExecutor
} = require('../src/renderer/services/skill-executors/index.ts');

const root = path.resolve(__dirname, '..');

function assert(condition, message, details) {
  if (!condition) throw new Error(`${message}${details ? `\n${JSON.stringify(details, null, 2)}` : ''}`);
}

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function buildSamplingPlan(scenario = 'sku') {
  return {
    planVersion: 'project-visual-sampling/v0',
    mode: 'bounded-metadata-plan',
    scenario,
    maxCandidates: 2,
    selectedCandidates: [{
      assetId: 'asset-1',
      path: 'D:/demo/source/sock.jpg',
      role: 'raw-product-still',
      priority: 80,
      score: 100,
      reason: 'fixture',
      cacheKey: 'project-visual:asset-1',
      cacheStatus: 'miss',
      shouldAnalyze: true
    }],
    skippedCandidateCount: 0,
    cacheSummary: { hit: 0, miss: 1, stale: 0, shouldAnalyze: 1 },
    warnings: [],
    limitations: []
  };
}

function buildProjectContext(scenario = 'sku') {
  return {
    projectPath: 'D:/demo',
    assetIndex: {
      summary: { totalImages: 1 },
      visionCandidates: []
    },
    visualSamplingPlan: buildSamplingPlan(scenario),
    visualInsightCache: {
      exists: false,
      entries: [],
      summary: { totalEntries: 0, entriesWithInsight: 0 }
    }
  };
}

function buildExecuteParams({ projectContext, params = {} } = {}) {
  return {
    params,
    callbacks: {
      onStep: () => undefined,
      onProgress: () => undefined,
      onMessage: () => undefined
    },
    context: {
      userInput: '帮我做 SKU',
      conversationHistory: [],
      isPluginConnected: true,
      ...(projectContext ? { projectContext } : {})
    }
  };
}

function assertNoAuthorityFields(value, label) {
  const text = JSON.stringify(value);
  [
    'canRunBusinessExecutor',
    'shouldRunRefreshBeforeExecution',
    'blockers',
    'requireBeforeExecution',
    'blocked_strict_missing_visual_observation'
  ].forEach((field) => assert(!text.includes(field), `${label} contains removed authority field ${field}`, value));
}

function runSharedChecks() {
  const missingContext = buildBusinessSkillVisualContextPreparation({
    skillId: 'sku-batch',
    requiresVisualObservation: true,
    hasProjectContext: false,
    hasAssetIndex: false,
    hasVisualSamplingPlan: false,
    hasVisualUnderstanding: false
  });
  assert(missingContext.status === 'context_missing', 'missing context should be reported, not blocked', missingContext);
  assert(missingContext.version === 'business-skill-visual-context-preparation/v0', 'context preparation should expose its responsibility-based version', missingContext);
  assert(missingContext.requiredInputs.includes('project_context'), 'missing input should be explicit', missingContext);
  assert(missingContext.recommendedActions.includes('continue_with_skill_input_validation'), 'actual Skill should validate its own inputs', missingContext);
  assertNoAuthorityFields(missingContext, 'missingContext');

  const mismatch = buildBusinessSkillVisualContextPreparation({
    skillId: 'sku-batch',
    projectPath: 'D:/demo',
    visualSamplingPlan: buildSamplingPlan('main-image'),
    expectedVisualSamplingScenario: 'sku',
    requiresVisualObservation: true,
    hasProjectContext: true,
    hasAssetIndex: true,
    hasVisualSamplingPlan: true,
    hasVisualUnderstanding: false
  });
  assert(mismatch.status === 'sampling_scenario_mismatch', 'scenario mismatch should be reported', mismatch);
  assert(mismatch.requiredInputs.includes('matching_visual_sampling_scenario'), 'scenario input should be explicit', mismatch);
  assertNoAuthorityFields(mismatch, 'mismatch');

  const refresh = buildBusinessSkillVisualContextPreparation({
    skillId: 'sku-batch',
    projectPath: 'D:/demo',
    visualSamplingPlan: buildSamplingPlan(),
    expectedVisualSamplingScenario: 'sku',
    requiresVisualObservation: true,
    hasProjectContext: true,
    hasAssetIndex: true,
    hasVisualSamplingPlan: true,
    hasVisualUnderstanding: false,
    runBeforeExecution: true,
    runtimeCanAnalyze: true,
    runtimeCanWriteCache: true,
    maxCandidates: 1
  });
  assert(refresh.status === 'refresh_requested', 'explicit bounded refresh should be represented as a request', refresh);
  assert(refresh.refreshPlan.shouldCallAnalyzer === true, 'refresh plan should be runnable', refresh);
  assert(refresh.observations.every((item) => !Object.prototype.hasOwnProperty.call(item, 'status')), 'observation records must not carry verdicts', refresh);
  assertNoAuthorityFields(refresh, 'refresh');
  return refresh;
}

async function runRefreshFailureCheck(contextPreparation) {
  const executeParams = buildExecuteParams({ projectContext: buildProjectContext() });
  const result = await runBusinessSkillVisualObservationRefreshBeforeExecution(
    contextPreparation,
    executeParams,
    { runCacheFill: async () => { throw new Error('fixture analyzer failure'); } }
  );
  assert(result.executeParams === executeParams, 'refresh failure should preserve Skill parameters', result);
  assert(result.runSummary.status === 'failed', 'refresh failure should be recorded', result);
  assert(!Object.prototype.hasOwnProperty.call(result, 'blockedResult'), 'refresh runner must not return an early-exit result', result);
}

async function runRegistryContinuationChecks() {
  let executeCalls = 0;
  registerSkillExecutor({
    skillId: 'sku-batch',
    execute: async () => {
      executeCalls += 1;
      return {
        success: true,
        message: 'fixture executor ran',
        data: { skuPlan: { id: `plan-${executeCalls}` } }
      };
    }
  });

  const missingContextResult = await executeSkillWithExecutor('sku-batch', buildExecuteParams());
  assert(executeCalls === 1, 'missing observation context must not prevent Registry from invoking the Skill', missingContextResult);
  assert(missingContextResult.success === true, 'missing observation context must preserve Skill result', missingContextResult);
  assert(missingContextResult.data.businessSkillVisualContextPreparation.status === 'context_missing', 'context state should still be attached', missingContextResult);

  const mismatchResult = await executeSkillWithExecutor('sku-batch', buildExecuteParams({
    projectContext: buildProjectContext('main-image')
  }));
  assert(executeCalls === 2, 'scenario mismatch must not prevent Registry from invoking the Skill', mismatchResult);
  assert(mismatchResult.success === true, 'scenario mismatch must preserve Skill result', mismatchResult);
  assert(mismatchResult.data.businessSkillVisualContextPreparation.status === 'sampling_scenario_mismatch', 'mismatch should remain context data', mismatchResult);

  global.window = {
    designEcho: {
      analyzeAssetContent: async () => { throw new Error('fixture provider failure'); },
      writeProjectVisualInsightCache: async () => ({ ok: true })
    }
  };
  const refreshFailureResult = await executeSkillWithExecutor('sku-batch', buildExecuteParams({
    projectContext: buildProjectContext(),
    params: {
      runBusinessVisualObservationRefreshBeforeExecution: true,
      visualObservationRefreshRuntimeReady: true,
      visualObservationRefreshMaxCandidates: 1
    }
  }));
  delete global.window;
  assert(executeCalls === 3, 'refresh failure must not prevent Registry from invoking the Skill', refreshFailureResult);
  assert(refreshFailureResult.success === true, 'refresh failure must preserve Skill result', refreshFailureResult);
  assert(refreshFailureResult.data.businessSkillVisualContextPreparationRun, 'refresh activity should remain attached as context', refreshFailureResult);

  const registry = read('src/renderer/services/skill-executors/registry.ts');
  const wrapper = read('src/renderer/services/skill-executors/business-skill-visual-context.ts');
  assert(!fs.existsSync(path.join(root, 'src/shared/business-skill-visual-observation-pre-execution-gate.ts')), 'legacy preparation gate module must not remain as an alias');
  assert(!registry.includes('businessSkillVisualObservationPreExecutionGate'), 'Registry must not emit the legacy preparation gate field');
  assert(!registry.includes('preExecutionVisualObservation.blockedResult'), 'Registry must not early-return on observation context');
  assert(!wrapper.includes('buildBusinessSkillVisualContextPreparationBlockedResult'), 'wrapper must not construct blocked business results');
  assert(!wrapper.includes('requireBusinessVisualObservationBeforeExecution'), 'removed strict switch must have no compatibility read');
  assert(!wrapper.includes('blockWithoutBusinessVisualObservation'), 'removed blocking switch must have no compatibility read');
}

async function run() {
  const contextPreparation = runSharedChecks();
  await runRefreshFailureCheck(contextPreparation);
  await runRegistryContinuationChecks();
  console.log(JSON.stringify({
    success: true,
    checks: [
      'visual context preparation reports missing inputs and recommendations without authority fields',
      'explicit bounded refresh remains available',
      'missing context and scenario mismatch still invoke the registered Skill',
      'refresh failure still invokes the registered Skill',
      'Registry contains no observation-derived early return or legacy preparation field'
    ]
  }, null, 2));
}

run().catch((error) => {
  delete global.window;
  console.error(error);
  process.exit(1);
});
