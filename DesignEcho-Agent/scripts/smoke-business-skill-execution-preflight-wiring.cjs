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
  attachBusinessSkillExecutionPreflightGateToResult,
  buildBusinessSkillExecutionPreflightGateForSkill,
  isBusinessSkillExecutionPreflightSkill
} = require('../src/renderer/services/skill-executors/business-skill-visual-context.ts');

const repoRoot = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
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

function buildProjectContext(options = {}) {
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
      scenario: options.scenario || 'main-image',
      maxCandidates: 2,
      selectedCandidates: [{
        assetId: 'asset-1',
        path: 'D:/demo-project/source/asset-1.jpg',
        role: 'raw-product-still',
        priority: 80,
        score: 120,
        reason: 'fixture',
        cacheKey: 'project-visual:asset-1',
        cacheStatus: options.cacheHit ? 'hit' : 'miss',
        shouldAnalyze: !options.cacheHit,
        cachedInsight: options.cacheHit ? {
          assetId: 'asset-1',
          path: 'D:/demo-project/source/asset-1.jpg',
          summary: '袜子素材 fixture',
          productType: '袜子'
        } : undefined,
        requiredObservations: [],
        selectionNotes: []
      }],
      skippedCandidateCount: 0,
      cacheSummary: options.cacheHit
        ? { hit: 1, miss: 0, stale: 0, shouldAnalyze: 0 }
        : { hit: 0, miss: 1, stale: 0, shouldAnalyze: 1 },
      warnings: [],
      limitations: [],
      sourceRecords: []
    },
    visualInsightCache: {
      cacheVersion: 'project-visual-insight-cache/v0',
      source: options.cacheHit ? 'persisted-project-cache' : 'missing',
      exists: Boolean(options.cacheHit),
      entries: options.cacheHit ? [{
        cacheKey: 'project-visual:asset-1',
        assetId: 'asset-1',
        path: 'D:/demo-project/source/asset-1.jpg',
        insight: {
          assetId: 'asset-1',
          path: 'D:/demo-project/source/asset-1.jpg',
          summary: '袜子素材 fixture',
          productType: '袜子'
        }
      }] : [],
      summary: options.cacheHit
        ? { totalEntries: 1, entriesWithInsight: 1, entriesWithRawPayloadRemoved: 0 }
        : { totalEntries: 0, entriesWithInsight: 0, entriesWithRawPayloadRemoved: 0 },
      warnings: [],
      limitations: [],
      sourceRecords: []
    }
  };
}

function buildExecuteParams(projectContext) {
  return {
    params: { prompt: '帮我做主图', rawImage: 'raw-image-payload' },
    context: {
      userInput: '帮我做主图',
      conversationHistory: [],
      isPluginConnected: true,
      projectContext
    }
  };
}

function assertPackageRegistration() {
  const packageJson = JSON.parse(read('package.json'));
  assert(
    packageJson.scripts?.['smoke:business-skill:execution-preflight-wiring'] ===
      'node scripts/smoke-business-skill-execution-preflight-wiring.cjs',
    'package.json should expose smoke:business-skill:execution-preflight-wiring'
  );
  assert(
    String(packageJson.scripts?.['maintenance:preflight'] || '').includes('smoke:business-skill:execution-preflight-wiring'),
    'maintenance:preflight should include execution preflight wiring smoke'
  );
}

function run() {
  assert(isBusinessSkillExecutionPreflightSkill('main-image-design'), 'main-image-design should receive execution preflight');
  assert(isBusinessSkillExecutionPreflightSkill('detail-page-design'), 'detail-page-design should receive execution preflight');
  assert(isBusinessSkillExecutionPreflightSkill('sku-batch'), 'sku-batch should receive execution preflight');
  assert(!isBusinessSkillExecutionPreflightSkill('layout-replication'), 'layout-replication is not one of the three business skill execution preflight targets');
  assert(!isBusinessSkillExecutionPreflightSkill('document-management'), 'document-management should not receive business execution preflight');

  const readyResult = {
    success: true,
    message: 'ok',
    data: {
      existing: true,
      designAgentOs: { version: 'fixture' },
      templateBlueprint: { id: 'template-fixture' }
    }
  };
  const readyGate = buildBusinessSkillExecutionPreflightGateForSkill(
    'main-image-design',
    buildExecuteParams(buildProjectContext({ cacheHit: true })),
    readyResult
  );
  assert(readyGate?.status === 'ready_for_existing_execution', 'ready context should allow existing execution', readyGate);
  assert(!Object.hasOwn(readyGate, 'acceptanceControlPlane'), 'renderer-built gate must not expose dev acceptance state');
  assert(!Object.hasOwn(readyGate, 'claimBoundary'), 'renderer-built gate must not expose proof-style claim boundaries');

  const readyWrapped = attachBusinessSkillExecutionPreflightGateToResult(readyResult, readyGate);
  assert(readyWrapped.success === true, 'preflight attachment must preserve success flag');
  assert(readyWrapped.data.existing === true, 'preflight attachment must preserve existing data');
  assert(
    readyWrapped.data.businessSkillExecutionPreflightGate.status === 'ready_for_existing_execution',
    'result data should include execution preflight gate',
    readyWrapped
  );

  const missingGate = buildBusinessSkillExecutionPreflightGateForSkill(
    'sku-batch',
    buildExecuteParams(undefined),
    { success: true, message: 'ok', data: { designAgentOs: { version: 'fixture' } } }
  );
  assert(missingGate?.status === 'needs_context', 'missing project context should remain a needs_context diagnostic', missingGate);
  const missingWrapped = attachBusinessSkillExecutionPreflightGateToResult(
    { success: true, message: 'ok' },
    missingGate
  );
  assert(missingWrapped.success === true, 'needs_context diagnostics must not change executor result success');

  const nonBusinessGate = buildBusinessSkillExecutionPreflightGateForSkill(
    'document-management',
    buildExecuteParams(buildProjectContext({ cacheHit: true })),
    readyResult
  );
  assert(nonBusinessGate === undefined, 'non-business skill should not build execution preflight');
  const noGateResult = attachBusinessSkillExecutionPreflightGateToResult({ success: true, message: 'ok' }, undefined);
  assert(!noGateResult.data, 'no-gate result should remain unchanged');

  const wrapperSource = read('src/renderer/services/skill-executors/business-skill-visual-context.ts');
  const preflightSource = read('src/shared/business-skill-execution-preflight-gate.ts');
  const registrySource = read('src/renderer/services/skill-executors/registry.ts');
  assert(registrySource.includes('buildBusinessSkillExecutionPreflightGateForSkill'), 'unified executor registry should build execution preflight');
  assert(registrySource.includes('attachBusinessSkillExecutionPreflightGateToResult'), 'unified executor registry should attach execution preflight');
  assert(!wrapperSource.includes('analyzeAssetContent'), 'execution preflight wrapper must not call visual analyzer');
  assert(!wrapperSource.includes('writeProjectVisualInsightCache'), 'execution preflight wrapper must not write visual cache');
  assert(!wrapperSource.includes('executeToolCall'), 'execution preflight wrapper must not call Photoshop tools');
  assert(!wrapperSource.includes('acceptanceControlPlane'), 'renderer wrapper must not reattach dev acceptance state');
  assert(!preflightSource.includes('agent-acceptance-control-plane'), 'production preflight must not import dev acceptance control plane');

  assertPackageRegistration();
  [
    ['readyGate', readyGate],
    ['readyWrapped', readyWrapped],
    ['missingGate', missingGate],
    ['missingWrapped', missingWrapped],
    ['wrapperSource', wrapperSource],
    ['registrySource', registrySource]
  ].forEach(([label, value]) => {
    assertNoRawPayload(value, label);
    assertNoPseudoThinking(value, label);
  });

  console.log(JSON.stringify({
    success: true,
    checks: [
      'execution preflight is attached only to main-image, detail-page and sku business skills',
      'attachment preserves original executor result success and data',
      'missing context stays diagnostic-only and does not block executor result',
      'wrapper does not call visual analyzer, cache writer or Photoshop tools',
      'package and maintenance preflight expose the wiring smoke'
    ]
  }, null, 2));
}

run();
