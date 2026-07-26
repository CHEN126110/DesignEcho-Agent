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

function buildFullContextState() {
  return {
    hasProjectContext: true,
    hasAssetIndex: true,
    hasVisualSamplingPlan: true,
    hasVisualUnderstanding: true,
    hasTemplateResult: true
  };
}

function buildProjectContext() {
  return {
    projectPath: 'D:/demo-project',
    assetIndex: {
      indexVersion: 'project-asset-index/v0',
      generatedAt: '2026-05-16T00:00:00.000Z',
      projectPath: 'D:/demo-project',
      assets: [],
      visionCandidates: [],
      summary: {
        totalFiles: 1,
        totalImages: 1,
        totalDesignDocuments: 1,
        roleCounts: {},
        folderRoleCounts: {},
        extensionCounts: {},
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
      scenario: 'sku',
      maxCandidates: 2,
      selectedCandidates: [{
        assetId: 'asset-1',
        path: 'D:/demo-project/source/asset-1.jpg',
        role: 'raw-product-still',
        priority: 80,
        score: 120,
        reason: 'fixture',
        cacheKey: 'project-visual:asset-1',
        cacheStatus: 'hit',
        shouldAnalyze: false,
        cachedInsight: {
          assetId: 'asset-1',
          path: 'D:/demo-project/source/asset-1.jpg',
          summary: '袜子素材 fixture',
          productType: '袜子'
        }
      }],
      skippedCandidateCount: 0,
      cacheSummary: { hit: 1, miss: 0, stale: 0, shouldAnalyze: 0 },
      warnings: [],
      limitations: []
    },
    visualInsightCache: {
      cacheVersion: 'project-visual-insight-cache/v0',
      source: 'persisted-project-cache',
      exists: true,
      entries: [{
        cacheKey: 'project-visual:asset-1',
        assetId: 'asset-1',
        path: 'D:/demo-project/source/asset-1.jpg',
        insight: {
          assetId: 'asset-1',
          path: 'D:/demo-project/source/asset-1.jpg',
          summary: '袜子素材 fixture',
          productType: '袜子'
        }
      }],
      summary: { totalEntries: 1, entriesWithInsight: 1, entriesWithRawPayloadRemoved: 0 },
      warnings: [],
      limitations: []
    }
  };
}

function buildExecuteParams(projectContext) {
  return {
    params: { prompt: '帮我做 SKU', rawImage: 'raw-image-payload' },
    context: {
      userInput: '帮我做 SKU',
      conversationHistory: [],
      isPluginConnected: true,
      projectContext
    }
  };
}

function assertPackageRegistration() {
  const packageJson = JSON.parse(read('package.json'));
  assert(
    packageJson.scripts?.['smoke:business-skill:preflight-planner-context'] ===
      'node scripts/smoke-business-skill-preflight-planner-context.cjs',
    'package.json should expose smoke:business-skill:preflight-planner-context'
  );
  assert(
    String(packageJson.scripts?.['maintenance:preflight'] || '').includes('smoke:business-skill:preflight-planner-context'),
    'maintenance:preflight should include smoke:business-skill:preflight-planner-context'
  );
}

function run() {
  const readyGate = buildBusinessSkillExecutionPreflightGate({
    skillId: 'sku-batch',
    requestKind: 'execute_existing',
    contextState: buildFullContextState()
  });
  const readyContext = buildBusinessSkillPreflightPlannerContext(readyGate);
  assert(readyContext.version === 'business-skill-preflight-planner-context/v0', 'planner context should expose stable version', readyContext);
  assert(readyContext.gateStatus === 'ready_for_existing_execution', 'ready execution status should remain visible as context', readyContext);
  assert(!Object.hasOwn(readyContext, 'plannerDisposition'), 'planner context must not create a second execution decision', readyContext);
  assert(!Object.hasOwn(readyContext, 'canContinueExistingExecution'), 'planner context must not grant executor permission', readyContext);
  assert(!Object.hasOwn(readyContext, 'canClaimDesignQuality'), 'planner context must not carry a quality verdict', readyContext);

  const needsContextGate = buildBusinessSkillExecutionPreflightGate({
    skillId: 'main-image-design',
    requestKind: 'execute_existing',
    contextState: { hasProjectContext: true }
  });
  const needsContext = buildBusinessSkillPreflightPlannerContext(needsContextGate);
  assert(needsContext.gateStatus === 'needs_context', 'needs_context should remain visible as input status', needsContext);
  assert(needsContext.requiredInputs.includes('asset_index_required'), 'needs_context should preserve required inputs', needsContext);

  const blockedGate = buildBusinessSkillExecutionPreflightGate({
    skillId: 'detail-page-design',
    requestKind: 'business_strategy',
    userCheckpointConfirmed: false,
    implementationInputs: { rawImage: 'raw-image-payload' },
    contextState: {}
  });
  const blockedContext = buildBusinessSkillPreflightPlannerContext(blockedGate);
  assert(blockedContext.gateStatus === 'blocked', 'blocked strategy status should remain visible as context', blockedContext);
  assert(!Object.hasOwn(blockedContext, 'canChangeBusinessStrategy'), 'planner projection must not duplicate strategy permission', blockedContext);
  assert(blockedContext.requiredInputs.includes('implementation_designStandards_required'), 'planner context should preserve missing implementation inputs', blockedContext);
  assert(!Object.hasOwn(blockedContext, 'blockers'), 'planner projection must not copy execution blockers', blockedContext);

  const executorGate = buildBusinessSkillExecutionPreflightGateForSkill(
    'sku-batch',
    buildExecuteParams(buildProjectContext()),
    { success: true, message: 'ok', data: { designAgentOs: { version: 'fixture' }, skuPlan: { id: 'sku-fixture' } } }
  );
  const wrapped = attachBusinessSkillExecutionPreflightGateToResult(
    { success: true, message: 'ok', data: { existing: true } },
    executorGate
  );
  assert(wrapped.success === true, 'planner context attachment must preserve executor success');
  assert(wrapped.data.existing === true, 'planner context attachment must preserve existing data');
  assert(wrapped.data.businessSkillExecutionPreflightGate, 'wrapped result should keep raw preflight gate');
  assert(wrapped.data.businessSkillPreflightPlannerContext, 'wrapped result should include planner control context');
  assert(wrapped.data.businessSkillPreflightPlannerContext.gateStatus === 'ready_for_existing_execution', 'wrapped planner context should be derived from gate', wrapped);

  const wrapperSource = read('src/renderer/services/skill-executors/business-skill-visual-context.ts');
  assert(wrapperSource.includes('buildBusinessSkillPreflightPlannerContext'), 'skill wrapper should build planner context from execution preflight gate');
  assert(!/analyzeAssetContent\s*\(/.test(wrapperSource), 'planner context wrapper must not call visual analyzer');
  assert(!/writeProjectVisualInsightCache\s*\(/.test(wrapperSource), 'planner context wrapper must not write visual cache');
  assert(!wrapperSource.includes('executeToolCall'), 'planner context wrapper must not call Photoshop tools');

  assertPackageRegistration();
  [
    ['readyContext', readyContext],
    ['needsContext', needsContext],
    ['blockedContext', blockedContext],
    ['wrapped', wrapped],
    ['wrapperSource', wrapperSource]
  ].forEach(([label, value]) => {
    assertNoRawPayload(value, label);
    assertNoPseudoThinking(value, label);
  });

  console.log(JSON.stringify({
    success: true,
    checks: [
      'business skill preflight status maps to read-only planner context',
      'planner context carries no execution permission or quality verdict',
      'needs_context and blocked statuses preserve required inputs without blockers',
      'unified skill executor attaches planner context without changing result success',
      'planner context wrapper does not call models, cache writers or Photoshop tools'
    ]
  }, null, 2));
}

run();
