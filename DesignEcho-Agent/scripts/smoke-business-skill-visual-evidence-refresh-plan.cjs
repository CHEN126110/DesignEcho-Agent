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
  buildBusinessSkillExecutionPreflightGate
} = require('../src/shared/business-skill-execution-preflight-gate.ts');
const {
  buildBusinessSkillPreflightPlannerContext
} = require('../src/shared/business-skill-preflight-planner-context.ts');
const {
  buildBusinessSkillVisualObservationRefreshPlan
} = require('../src/shared/business-skill-visual-observation-refresh-plan.ts');
const {
  attachBusinessSkillExecutionPreflightGateToResult,
  buildBusinessSkillExecutionPreflightGateForSkill
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

function assertNoRawPayload(value, label) {
  const text = JSON.stringify(value);
  const forbidden = ['base64-image-payload', 'raw-image-payload', 'dataUrl', 'pixels', 'buffer'];
  const found = forbidden.filter((token) => text.includes(token));
  assert(found.length === 0, `${label} contains raw payload markers: ${found.join(', ')}`);
}

function assertNoPseudoThinking(value, label) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  const forbidden = ['正在思考', '等待响应', '请求已发送', '正在准备', '稍等'];
  const found = forbidden.filter((token) => text.includes(token));
  assert(found.length === 0, `${label} contains pseudo-thinking copy: ${found.join(', ')}`);
}

function buildCandidate(index) {
  return {
    assetId: `asset-${index}`,
    path: `D:/demo/source/sock-${index}.jpg`,
    role: 'raw-product-still',
    priority: 90 - index,
    score: 100 - index,
    reason: `fixture ${index}`,
    cacheKey: `project-visual:fixture-${index}`,
    cacheStatus: 'miss',
    shouldAnalyze: true,
    requiredEvidence: ['visual model or human evidence required'],
    evidence: []
  };
}

function buildVisualSamplingPlan() {
  return {
    planVersion: 'project-visual-sampling/v0',
    mode: 'bounded-metadata-plan',
    scenario: 'sku',
    maxCandidates: 3,
    selectedCandidates: [
      buildCandidate(1),
      buildCandidate(2),
      { ...buildCandidate(3), cacheStatus: 'hit', shouldAnalyze: false }
    ],
    skippedCandidateCount: 4,
    cacheSummary: { hit: 1, miss: 2, stale: 0, shouldAnalyze: 2 },
    warnings: [],
    limitations: [],
    evidence: []
  };
}

function buildProjectContext() {
  return {
    projectPath: 'D:/demo',
    assetIndex: { summary: { totalImages: 3 }, visionCandidates: [] },
    visualSamplingPlan: buildVisualSamplingPlan(),
    visualInsightCache: {
      summary: { totalEntries: 0, entriesWithInsight: 0, entriesWithRawPayloadRemoved: 0 }
    }
  };
}

function buildExecuteParams(params = {}) {
  return {
    params,
    context: {
      userInput: '帮我做 SKU',
      conversationHistory: [],
      isPluginConnected: true,
      projectContext: buildProjectContext()
    }
  };
}

function buildPlannerEvidenceWithMissingVisualUnderstanding() {
  const gate = buildBusinessSkillExecutionPreflightGate({
    skillId: 'sku-batch',
    requestKind: 'execute_existing',
    contextState: {
      hasProjectContext: true,
      hasAssetIndex: true,
      hasVisualSamplingPlan: true,
      hasTemplateResult: true
    }
  });
  return buildBusinessSkillPreflightPlannerContext(gate);
}

function assertPackageRegistration() {
  const packageJson = JSON.parse(read('package.json'));
  assert(
    packageJson.scripts?.['smoke:business-skill:visual-evidence-refresh-plan'] ===
      'node scripts/smoke-business-skill-visual-evidence-refresh-plan.cjs',
    'package.json should expose smoke:business-skill:visual-evidence-refresh-plan'
  );
  assert(
    String(packageJson.scripts?.['maintenance:preflight'] || '').includes('smoke:business-skill:visual-evidence-refresh-plan'),
    'maintenance:preflight should include smoke:business-skill:visual-evidence-refresh-plan'
  );
}

function run() {
  const plannerEvidence = buildPlannerEvidenceWithMissingVisualUnderstanding();

  const disabled = buildBusinessSkillVisualObservationRefreshPlan({
    skillId: 'sku-batch',
    plannerContext: plannerEvidence,
    projectPath: 'D:/demo',
    visualSamplingPlan: buildVisualSamplingPlan(),
    enabled: false,
    runtimeCanAnalyze: true,
    runtimeCanWriteCache: true
  });
  assert(disabled.status === 'disabled', 'default refresh plan should stay disabled', disabled);
  assert(disabled.shouldRunRefresh === false, 'disabled plan should not run refresh', disabled);
  assert(disabled.missingVisualUnderstanding === true, 'disabled plan should preserve missing visual understanding evidence', disabled);

  const ready = buildBusinessSkillVisualObservationRefreshPlan({
    skillId: 'sku-batch',
    plannerContext: plannerEvidence,
    projectPath: 'D:/demo',
    visualSamplingPlan: buildVisualSamplingPlan(),
    enabled: true,
    runtimeCanAnalyze: true,
    runtimeCanWriteCache: true,
    maxCandidates: 2
  });
  assert(ready.status === 'ready', 'explicit opt-in with runtime evidence should be ready', ready);
  assert(ready.shouldRunRefresh === true, 'ready plan should allow a separate refresh runner to execute', ready);
  assert(ready.fillPlan?.candidates.length === 2, 'ready plan should keep bounded candidates', ready);

  const blocked = buildBusinessSkillVisualObservationRefreshPlan({
    skillId: 'sku-batch',
    plannerContext: plannerEvidence,
    projectPath: 'D:/demo',
    visualSamplingPlan: buildVisualSamplingPlan(),
    enabled: true,
    runtimeCanAnalyze: false,
    runtimeCanWriteCache: true
  });
  assert(blocked.status === 'blocked_no_analyzer', 'explicit opt-in without analyzer runtime should block refresh plan', blocked);
  assert(blocked.shouldRunRefresh === false, 'blocked plan should not run refresh', blocked);

  const noNeedGate = buildBusinessSkillExecutionPreflightGate({
    skillId: 'main-image-design',
    requestKind: 'execute_existing',
    contextState: {
      hasProjectContext: true,
      hasAssetIndex: true,
      hasVisualSamplingPlan: true,
      hasVisualUnderstanding: true,
      hasTemplateResult: true
    }
  });
  const noNeed = buildBusinessSkillVisualObservationRefreshPlan({
    skillId: 'main-image-design',
    plannerContext: buildBusinessSkillPreflightPlannerContext(noNeedGate),
    projectPath: 'D:/demo',
    visualSamplingPlan: buildVisualSamplingPlan(),
    enabled: true,
    runtimeCanAnalyze: true,
    runtimeCanWriteCache: true
  });
  assert(noNeed.status === 'not_needed', 'ready visual understanding should not trigger refresh', noNeed);

  const gate = buildBusinessSkillExecutionPreflightGateForSkill(
    'sku-batch',
    buildExecuteParams({ enableVisualObservationRefresh: true, visualObservationRefreshRuntimeReady: true }),
    { success: true, message: 'ok', data: { designAgentOs: { version: 'fixture' }, skuPlan: { id: 'sku-fixture' } } }
  );
  const wrapped = attachBusinessSkillExecutionPreflightGateToResult(
    { success: true, message: 'ok', data: { existing: true } },
    gate,
    buildExecuteParams({ enableVisualObservationRefresh: true, visualObservationRefreshRuntimeReady: true })
  );
  assert(wrapped.success === true, 'refresh plan attachment must preserve executor success');
  assert(wrapped.data.existing === true, 'refresh plan attachment must preserve existing data');
  assert(wrapped.data.businessSkillVisualObservationRefreshPlan, 'wrapped result should include visual evidence refresh plan');
  assert(wrapped.data.businessSkillVisualObservationRefreshPlan.status === 'ready', 'wrapped refresh plan should become ready with opt-in runtime evidence', wrapped);

  const wrapperSource = read('src/renderer/services/skill-executors/business-skill-visual-context.ts');
  assert(wrapperSource.includes('buildBusinessSkillVisualObservationRefreshPlan'), 'skill wrapper should build business visual refresh plan');
  assert(!/analyzeAssetContent\s*\(/.test(wrapperSource), 'refresh plan wrapper must not call visual analyzer directly');
  assert(!/writeProjectVisualInsightCache\s*\(/.test(wrapperSource), 'refresh plan wrapper must not call cache writer directly');
  assert(!wrapperSource.includes('executeToolCall'), 'wrapper must not call Photoshop tools');

  assertPackageRegistration();
  [
    ['disabled', disabled],
    ['ready', ready],
    ['blocked', blocked],
    ['noNeed', noNeed],
    ['wrapped', wrapped],
    ['wrapperSource', wrapperSource]
  ].forEach(([label, value]) => {
    assertNoRawPayload(value, label);
    assertNoPseudoThinking(value, label);
  });

  console.log(JSON.stringify({
    success: true,
    checks: [
      'visual evidence refresh plan stays disabled by default',
      'explicit opt-in prepares bounded candidates without running a model',
      'runtime gaps block refresh planning instead of silently fabricating visual understanding',
      'ready visual understanding marks refresh as not_needed',
      'unified skill executor attaches refresh plan without changing result success'
    ]
  }, null, 2));
}

run();
