#!/usr/bin/env node

const path = require('path');

require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '..', 'tsconfig.main.json')
});

const fs = require('fs');
const repoRoot = path.resolve(__dirname, '..');

const {
  runDesignLearningRuntimeTriggerService
} = require('../src/renderer/services/design-learning-runtime-trigger.service.ts');

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function assert(condition, message, details) {
  if (!condition) {
    const suffix = details ? `\n${JSON.stringify(details, null, 2)}` : '';
    throw new Error(`${message}${suffix}`);
  }
}

function assertNoUnsafePayload(value, label) {
  const text = JSON.stringify(value);
  const forbidden = [
    'data:image',
    'raw-image-payload',
    'base64-image-payload',
    '"base64"',
    '"imageBase64"',
    '"rawImage"',
    '"rawImages"',
    '"buffer"',
    '"bytes"',
    '"pixels"',
    '"confidence"',
    '置信',
    'C:\\Users\\',
    'D:\\Eagle\\library'
  ];
  const found = forbidden.filter((token) => text.includes(token));
  assert(found.length === 0, `${label} must not expose unsafe payloads, score markers or local paths: ${found.join(', ')}`, value);
}

function createAdapters(callLog) {
  return {
    sourceProviders: {
      eagleReadonly: async ({ topics, maxItems }) => {
        callLog.push(`eagle:${topics.join('/')}:${maxItems}`);
        return [{
          referenceId: 'eagle-sku-card-reference',
          title: '袜子 SKU 色卡精修参考',
          sourceType: 'eagle_visual_case',
          tags: ['socks', 'sku', 'retouch'],
          sourceUrl: 'eagle://item/eagle-sku-card-reference'
        }];
      },
      webSearch: async () => {
        callLog.push('web');
        return [{
          referenceId: 'web-sock-main-image-layout',
          title: 'Sock Product Main Image Layout',
          sourceType: 'external_reference',
          tags: ['main-image', 'white-background'],
          sourceUrl: 'https://example.com/sock-layout'
        }];
      },
      projectCases: async () => {
        callLog.push('project');
        return [{
          referenceId: 'project-c1163-sku',
          title: 'C-1163 SKU case',
          sourceType: 'manual_reference',
          tags: ['project-case', 'sku'],
          sourceUrl: 'D:\\DesignEchoDemo\\C-1163\\unsafe.jpg'
        }];
      }
    },
    analyzeReference: async (reference) => {
      callLog.push(`analyze:${reference.referenceId}`);
      return {
        referenceId: reference.referenceId,
        analysisSource: 'runtime-visual-analysis-adapter',
        observedAt: '2026-05-29T06:01:00.000Z',
        productCategory: 'socks',
        designType: reference.tags.includes('sku') ? 'sku-color-card' : 'main-image-reference',
        summary: `${reference.title} 通过统一形态、稳定光影和清晰留白形成可靠商品视觉。`,
        strengths: [
          {
            aspect: 'shape-rhythm',
            observation: '袜口和脚尖方向形成稳定节奏。',
            reason: 'SKU 色卡中统一形态能降低比较成本，并让颜色差异成为主要信息。',
            suitableFor: ['sku-color-card', 'white-background']
          },
          {
            aspect: 'lighting',
            observation: '接触阴影柔和且方向一致。',
            reason: '自然阴影保留真实感，同时不会干扰颜色判断。',
            suitableFor: ['sku-color-card', 'main-image']
          }
        ],
        suitableScenarios: ['袜子 SKU 色卡', '白底商品展示', '主图颜色对比'],
        avoidWhen: ['强情绪海报', '场景化大背景'],
        reusableHeuristics: ['统一袜口基线', '保留柔和接触阴影', '浅色商品避免白场过曝'],
        reviewStatus: 'needs_human_review',
        sourceNotes: [`source=${reference.sourceType}`],
        limitations: ['需要人工复核是否符合当前品牌。']
      };
    }
  };
}

function buildBaseInput(overrides = {}) {
  return {
    now: '2026-05-29T06:00:00.000Z',
    cadence: 'daily',
    preferredTopics: ['SKU 色卡精修', '袜子主图版式'],
    knowledgeGaps: ['袜子光影统一'],
    maxReferences: 3,
    storage: {
      getLastRunAt: () => '2026-05-28T04:00:00.000Z',
      setLastRunAt: () => {
        throw new Error('storage write should not happen in this case');
      }
    },
    reviewQueue: {
      enqueue: async () => {
        throw new Error('review queue should not be used in this case');
      }
    },
    ...overrides
  };
}

async function run() {
  const appStartLog = [];
  const appStart = await runDesignLearningRuntimeTriggerService(buildBaseInput({
    triggerSource: 'app_start',
    ...createAdapters(appStartLog)
  }));

  assert(appStart.version === 'design-learning-runtime-trigger-service/v0', 'service should expose a stable version', appStart);
  assert(appStart.status === 'ready_waiting_manual_start', 'app start should not auto-run heavy learning by default', appStart);
  assert(appStart.trigger.status === 'ready_for_runtime_runner', 'app start should still expose ready trigger status', appStart.trigger);
  assert(appStart.canRunRuntime === false, 'default app-start check must not run runtime', appStart);
  assert(appStartLog.length === 0, 'app-start default check must not call injected providers', appStartLog);
  assertNoUnsafePayload(appStart, 'app-start service result');

  const manualLog = [];
  const queued = [];
  const storageWrites = [];
  const manual = await runDesignLearningRuntimeTriggerService(buildBaseInput({
    triggerSource: 'manual',
    executeRuntime: true,
    storage: {
      getLastRunAt: () => '2026-05-29T05:55:00.000Z',
      setLastRunAt: (value, metadata) => storageWrites.push({ value, metadata })
    },
    reviewQueue: {
      enqueue: async (items, metadata) => {
        queued.push({ items, metadata });
        return { queuedCount: items.length, queueId: 'design-learning-review-queue-smoke' };
      }
    },
    ...createAdapters(manualLog)
  }));

  assert(manual.status === 'runtime_completed_review_queued', 'manual execute should run runtime and queue review candidates', manual);
  assert(manual.trigger.warnings.includes('manual_trigger_overrode_cadence'), 'manual run should explain cadence override', manual.trigger);
  assert(manual.runtimeResult?.status === 'completed_ready_for_review', 'manual runtime should complete into review state', manual.runtimeResult);
  assert(manual.reviewQueueResult?.queuedCount === manual.runtimeResult.memoryCandidates.length, 'all memory candidates should be queued for review', manual);
  assert(manual.runtimeResult.memoryCandidates.every((item) => item.status === 'needs_review'), 'queued candidates must remain needs_review', manual.runtimeResult.memoryCandidates);
  assert(storageWrites.length === 1, 'successful queued runtime should update lastRunAt once', storageWrites);
  assert(storageWrites[0].metadata.status === 'runtime_completed_review_queued', 'lastRunAt metadata should record service status', storageWrites);
  assert(manualLog.includes('web') && manualLog.includes('project') && manualLog.some((item) => item.startsWith('eagle:')), 'manual run should call injected providers', manualLog);
  assertNoUnsafePayload(manual, 'manual runtime service result');

  const missingAnalysisLog = [];
  const missingAnalysis = await runDesignLearningRuntimeTriggerService(buildBaseInput({
    triggerSource: 'manual',
    executeRuntime: true,
    analyzeReference: undefined,
    sourceProviders: createAdapters(missingAnalysisLog).sourceProviders,
    storage: {
      getLastRunAt: () => '2026-05-28T04:00:00.000Z',
      setLastRunAt: () => {
        throw new Error('blocked service must not update lastRunAt');
      }
    },
    reviewQueue: {
      enqueue: async () => {
        throw new Error('blocked service must not enqueue review candidates');
      }
    }
  }));
  assert(missingAnalysis.status === 'blocked_before_runtime', 'missing visual adapter should block before runtime', missingAnalysis);
  assert(missingAnalysis.trigger.status === 'blocked_missing_runtime_adapters', 'missing visual adapter should be a trigger-level blocker', missingAnalysis.trigger);
  assert(missingAnalysis.trigger.missingAdapters.includes('visualAnalysisAdapter'), 'missing visual adapter should be named', missingAnalysis.trigger);
  assert(missingAnalysisLog.length === 0, 'blocked trigger must not call source providers', missingAnalysisLog);

  const noQueue = await runDesignLearningRuntimeTriggerService(buildBaseInput({
    triggerSource: 'manual',
    executeRuntime: true,
    reviewQueue: undefined,
    ...createAdapters([])
  }));
  assert(noQueue.status === 'blocked_before_runtime', 'missing review queue should block before runtime', noQueue);
  assert(noQueue.trigger.status === 'blocked_review_gate_unavailable', 'missing review queue should be a trigger-level blocker', noQueue.trigger);

  const packageJson = JSON.parse(read('package.json'));
  assert(packageJson.scripts['smoke:design-learning:runtime-trigger-service'], 'package script should expose runtime trigger service smoke');
  assert(packageJson.scripts['maintenance:preflight'].includes('smoke:design-learning:runtime-trigger-service'), 'maintenance preflight should include runtime trigger service smoke');

  const boundaries = read('scripts/report-change-boundaries.cjs');
  assert(boundaries.includes('design-learning-runtime-trigger.service'), 'change boundary should include runtime trigger service');
  assert(boundaries.includes('smoke:design-learning:runtime-trigger-service'), 'change boundary validation should include service smoke');

  const hygiene = read('scripts/validate-maintenance-hygiene.cjs');
  assert(hygiene.includes('smoke-design-learning-runtime-trigger-service.cjs'), 'maintenance hygiene should check runtime trigger service smoke');

  console.log(JSON.stringify({
    success: true,
    checks: [
      'renderer service builds schedule and shared trigger from injected storage and policy',
      'app_start is ready but does not auto-run heavy learning by default',
      'manual execute can run injected runtime, enqueue needs-review candidates and update lastRunAt',
      'missing visual adapter and review queue block before provider calls',
      'service result strips unsafe payloads, local paths and score markers',
      'package, preflight, change-boundary and maintenance hygiene wiring are present'
    ]
  }, null, 2));
}

run().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
