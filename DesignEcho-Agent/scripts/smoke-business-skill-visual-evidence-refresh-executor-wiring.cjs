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
  executeSkillWithExecutor,
  registerSkillExecutor
} = require('../src/renderer/services/skill-executors/index.ts');

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
  const toolEvents = [];
  return {
    toolEvents,
    params: {
      enableBusinessVisualObservationRefresh: true,
      runBusinessVisualObservationRefresh: true,
      visualObservationRefreshMaxCandidates: 2,
      ...params
    },
    callbacks: {
      onStep: (event) => toolEvents.push(event),
      onProgress: () => undefined,
      onMessage: () => undefined
    },
    context: {
      userInput: '帮我做 SKU',
      conversationHistory: [],
      isPluginConnected: true,
      projectContext: {
        projectPath: 'D:/demo',
        assetIndex: { summary: { totalImages: 2 }, visionCandidates: [] },
        visualSamplingPlan: {
          planVersion: 'project-visual-sampling/v0',
          mode: 'bounded-metadata-plan',
          scenario: 'sku',
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

function installVisualRuntime(counters) {
  global.window = {
    designEcho: {
      analyzeAssetContent: async (imagePath) => {
        counters.analyzeCalls += 1;
        return {
          success: true,
          analysis: {
            description: `袜子素材 ${path.basename(imagePath)}`,
            category: 'socks',
            mainSubject: 'socks',
            colors: ['white'],
            style: 'ecommerce',
            scene: 'product'
          }
        };
      },
      writeProjectVisualInsightCache: async (options) => {
        counters.writeCalls += 1;
        counters.writtenEntryCount += Array.isArray(options?.entries) ? options.entries.length : 0;
        return { ok: true };
      }
    }
  };
}

function uninstallVisualRuntime() {
  delete global.window;
}

function assertNoRawPayload(value, label) {
  const text = JSON.stringify(value);
  const forbidden = ['base64-image-payload', 'raw-image-payload', 'dataUrl', 'pixels', 'buffer'];
  const found = forbidden.filter((token) => text.includes(token));
  assert(found.length === 0, `${label} contains raw image payload markers: ${found.join(', ')}`);
}

async function run() {
  const counters = {
    executeCalls: 0,
    analyzeCalls: 0,
    writeCalls: 0,
    writtenEntryCount: 0
  };

  registerSkillExecutor({
    skillId: 'sku-batch',
    execute: async () => {
      counters.executeCalls += 1;
      return {
        success: true,
        message: 'fixture sku executor result',
        data: {
          fixtureBusinessData: true,
          skuPlan: { id: 'fixture-sku-plan' }
        }
      };
    }
  });

  installVisualRuntime(counters);
  const executeParams = buildExecuteParams();
  const result = await executeSkillWithExecutor('sku-batch', executeParams);
  uninstallVisualRuntime();

  assert(counters.executeCalls === 1, 'fake business executor should run exactly once');
  assert(counters.analyzeCalls === 2, 'executor wrapper should run visual analysis through renderer runtime after business executor');
  assert(counters.writeCalls === 1, 'executor wrapper should write visual cache once');
  assert(counters.writtenEntryCount === 2, 'executor wrapper should write bounded cache entries');
  assert(result.success === true, 'visual refresh must preserve business result success', result);
  assert(result.skillOutcome?.status === 'executed', 'legacy success must be returned as executed instead of completed', result);
  assert(result.message === 'fixture sku executor result', 'visual refresh must preserve business result message', result);
  assert(result.data.fixtureBusinessData === true, 'visual refresh must preserve existing business data');
  assert(result.data.businessSkillVisualObservationRefreshPlan.status === 'ready', 'executor wiring should attach ready refresh plan');
  assert(result.data.businessSkillVisualObservationRefreshRun.status === 'completed', 'executor wiring should attach completed refresh run summary');
  assert(result.data.businessSkillVisualObservationRefreshRun.successCount === 2, 'run summary should expose success count');
  assert(!result.data.businessSkillVisualObservationRefreshRun.entries, 'run summary must not expose raw cache entries');
  assertNoRawPayload(result, 'executeSkillWithExecutor result');

  const completedEvent = executeParams.toolEvents.find((event) => event.kind === 'tool_completed');
  assert(completedEvent, 'executeSkillWithExecutor should emit completion step');
  assert(completedEvent.status === 'success', 'visual refresh evidence must not make the skill completion fail');
  assert(completedEvent.title.includes('能力已执行'), 'registry must keep legacy success visible as executed without claiming completion', completedEvent);
  assert(!completedEvent.title.includes('能力完成'), 'legacy success must not emit a false completion title', completedEvent);

  const source = read('src/renderer/services/skill-executors/registry.ts');
  assert(source.includes('await executor.execute('), 'unified executor registry should call business executor');
  assert(source.includes('await runBusinessSkillVisualObservationRefreshAfterExecution'), 'unified executor registry should call visual refresh runner');

  console.log(JSON.stringify({
    success: true,
    checks: [
      'unified skill executor preserves business result while attaching visual refresh evidence',
      'unified skill executor separates execution success from explicit task completion',
      'renderer runtime visual analysis and cache writer are used only after explicit opt-in',
      'visual refresh evidence remains summary-only through the unified executor entrypoint'
    ]
  }, null, 2));
}

run().catch((error) => {
  uninstallVisualRuntime();
  console.error(error);
  process.exit(1);
});
