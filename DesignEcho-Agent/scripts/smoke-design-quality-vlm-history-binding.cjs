#!/usr/bin/env node
'use strict';

/**
 * 视觉 Judge 的 Photoshop Host 历史版本绑定行为 smoke。
 *
 * 直接驱动真实 Agent 收尾方法，验证：
 * - 像素截图、结构读回、Judge 前后复核均为同一 historyStateRef 时才采用 VLM 结果；
 * - Judge 前版本已变化时不调用模型；Judge 期间变化时丢弃模型返回；
 * - 截图或结构证据缺 Host 引用时 fail closed；
 * - 版本变化后执行摘要不能把旧结构/旧视觉标为 fresh。
 * - Harness 质量复核与模型业务工具的连续失败熔断互不读取、累加或清除。
 */

const assert = require('assert');
const path = require('path');

const root = path.resolve(__dirname, '..');

if (!globalThis.window) globalThis.window = {};
const memoryStorage = new Map();
if (!globalThis.localStorage) {
  globalThis.localStorage = {
    getItem: (key) => memoryStorage.has(String(key)) ? memoryStorage.get(String(key)) : null,
    setItem: (key, value) => memoryStorage.set(String(key), String(value)),
    removeItem: (key) => memoryStorage.delete(String(key)),
    clear: () => memoryStorage.clear()
  };
}
globalThis.window.localStorage = globalThis.localStorage;

require('ts-node').register({
  transpileOnly: true,
  project: path.join(root, 'tsconfig.main.json')
});

const { Agent } = require(path.join(
  root,
  'src',
  'renderer',
  'services',
  'agent-runtime',
  'agent.ts'
));
const {
  MAIN_IMAGE_EVALUATION_PROFILE_ID,
  getDesignEvaluationProfileVlmAssertions,
  listDesignEvaluationProfiles
} = require(path.join(
  root,
  'src',
  'shared',
  'agent-runtime-v5',
  'design-evaluation-profiles.ts'
));

const DOCUMENT_ID = 42;
const HISTORY_A = { documentId: DOCUMENT_ID, historyStateId: 7001 };
const HISTORY_B = { documentId: DOCUMENT_ID, historyStateId: 7002 };
// extractImageFromToolResult 的真实防误识别下限为 500 字符；使用合法 base64 字符构造无 I/O fixture。
const SNAPSHOT_BASE64 = 'A'.repeat(600);

const evaluationProfile = listDesignEvaluationProfiles().find(
  (profile) => profile.profileId === MAIN_IMAGE_EVALUATION_PROFILE_ID
);
assert(evaluationProfile, 'main-image Evaluation Profile must exist');
const expectedVlmAssertionCount = getDesignEvaluationProfileVlmAssertions(evaluationProfile).length;
assert(expectedVlmAssertionCount > 0, 'main-image Evaluation Profile must expose VLM assertions');
const COMPLETE_VLM_JUDGE_RESPONSE = JSON.stringify(
  getDesignEvaluationProfileVlmAssertions(evaluationProfile).map((assertion) => ({
    id: assertion.id,
    pass: true,
    score: 0.92,
    confidence: 0.9,
    reason: 'controlled complete visual Judge result'
  }))
);

function addHistoryStateRef(result, historyStateRef) {
  return historyStateRef ? { ...result, historyStateRef } : result;
}

function buildToolCallLog({ snapshotHistoryStateRef, structureHistoryStateRef }) {
  return [
    {
      name: 'createDocument',
      arguments: {},
      result: {
        success: true,
        document: { id: DOCUMENT_ID, name: 'HistoryBinding.psd', width: 1000, height: 1000 }
      }
    },
    {
      name: 'renderLayout',
      arguments: {},
      result: { success: true, documentId: DOCUMENT_ID, subjectLayerIds: [2] }
    },
    {
      name: 'getDocumentInfo',
      arguments: {},
      result: addHistoryStateRef({
        success: true,
        document: { id: DOCUMENT_ID, name: 'HistoryBinding.psd', width: 1000, height: 1000 }
      }, structureHistoryStateRef)
    },
    {
      name: 'getLayerHierarchy',
      arguments: {},
      result: addHistoryStateRef({
        success: true,
        documentId: DOCUMENT_ID,
        flatList: [{
          id: 2,
          kind: 'smartObject',
          visible: true,
          bounds: { left: 200, top: 100, right: 800, bottom: 700, width: 600, height: 600 }
        }]
      }, structureHistoryStateRef)
    },
    {
      name: 'getCanvasSnapshot',
      arguments: {},
      result: addHistoryStateRef({
        success: true,
        snapshot: {
          base64: SNAPSHOT_BASE64,
          width: 1000,
          height: 1000,
          format: 'jpeg'
        },
        documentInfo: {
          id: DOCUMENT_ID,
          name: 'HistoryBinding.psd',
          width: 1000,
          height: 1000
        }
      }, snapshotHistoryStateRef)
    }
  ];
}

function createScenario({
  verificationHistoryStateRefs,
  snapshotHistoryStateRef = HISTORY_A,
  structureHistoryStateRef = HISTORY_A,
  modelThrows = false
}) {
  const pendingRefs = [...verificationHistoryStateRefs];
  const modelRequests = [];
  const verificationCalls = [];
  const steps = [];
  const agent = new Agent(
    {
      systemPrompt: 'History binding behavior smoke.',
      tools: [],
      modelId: 'local-llava-13b',
      maxIterations: 1,
      evaluationProfile,
      callbacks: {
        onStep: (step) => steps.push(step)
      }
    },
    async (modelId, messages) => {
      modelRequests.push({ modelId, messages });
      if (modelThrows) throw new Error('controlled visual Judge failure');
      return { content: COMPLETE_VLM_JUDGE_RESPONSE, toolCalls: [] };
    },
    async (name, args) => {
      verificationCalls.push({ name, args });
      const historyStateRef = pendingRefs.shift();
      return addHistoryStateRef({
        success: true,
        observedAt: '2026-07-19T00:00:00.000Z',
        documentState: 'present',
        document: { id: DOCUMENT_ID, name: 'HistoryBinding.psd', width: 1000, height: 1000 }
      }, historyStateRef);
    }
  );
  agent.currentTask = '设计一张电商主图';
  agent.toolCallLog = buildToolCallLog({
    snapshotHistoryStateRef,
    structureHistoryStateRef
  });
  return { agent, modelRequests, verificationCalls, steps };
}

function resultById(summary, id) {
  return summary.designScorecard?.results?.find((result) => result.id === id);
}

async function run() {
  {
    const scenario = createScenario({ verificationHistoryStateRefs: [HISTORY_A] });
    scenario.agent.consecutiveToolFailuresByName.set('getDocumentInfo', 99);

    const historyStateRef = await scenario.agent
      .readCurrentPhotoshopHistoryStateRefForQualityVerification('final_summary');

    assert.deepStrictEqual(historyStateRef, HISTORY_A,
      'business failure breaker must not block the Harness quality closure read');
    assert.strictEqual(scenario.verificationCalls.length, 1,
      'Harness quality closure must still reach the real read executor');
    assert.strictEqual(scenario.agent.consecutiveToolFailuresByName.get('getDocumentInfo'), 99,
      'Harness success must not clear the model-business failure breaker state');
  }

  {
    const scenario = createScenario({ verificationHistoryStateRefs: [] });
    scenario.agent.consecutiveToolFailuresByName.set('getDocumentInfo', 2);
    scenario.agent.executeTool = async () => ({ success: false, error: 'controlled Host read failure' });

    const historyStateRef = await scenario.agent
      .readCurrentPhotoshopHistoryStateRefForQualityVerification('final_summary');

    assert.strictEqual(historyStateRef, undefined);
    assert.strictEqual(scenario.agent.consecutiveToolFailuresByName.get('getDocumentInfo'), 2,
      'Harness failure must not increment the model-business failure breaker state');
  }

  {
    const scenario = createScenario({ verificationHistoryStateRefs: [] });
    scenario.agent.config.agentTaskPlan = {
      executionPlan: {
        canExecuteTools: true,
        mode: 'read_only'
      }
    };
    scenario.agent.toolCallLog = [{
      name: 'getDocumentInfo',
      arguments: {},
      result: addHistoryStateRef({ success: true }, HISTORY_A),
      origin: 'harness_quality_verification'
    }];
    assert.strictEqual(
      scenario.agent.resolveTaskPlanObligationGap(),
      'task_progress_missing',
      'Harness quality verification must not satisfy request-level task progress'
    );
    scenario.agent.toolCallLog.unshift({
      name: 'renderLayout',
      arguments: {},
      result: { success: true, documentId: DOCUMENT_ID }
    });
    const summary = scenario.agent.buildExecutionSummary('final_response', 1, null);
    assert.strictEqual(
      summary.successfulObservationCalls,
      0,
      'Harness quality verification must not satisfy the Completion observation gate'
    );
  }

  {
    const scenario = createScenario({ verificationHistoryStateRefs: [HISTORY_A] });
    scenario.agent.config.modelId = 'test-model-without-vision';
    scenario.agent.config.performanceBudget = {
      maxModelCalls: 0,
      maxToolCalls: 0,
      maxVisionCandidates: 0,
      maxVisualAnalyses: 0,
      maxFullResolutionImageReads: 0,
      softTimeBudgetMs: 60_000
    };
    const result = await scenario.agent.buildRunResult({
      success: true,
      message: '完成',
      iterations: 1,
      stopReason: 'final_response'
    });

    assert.strictEqual(scenario.modelRequests.length, 0, 'no-vision quality closure must not call a model');
    assert.strictEqual(scenario.verificationCalls.length, 1, 'no-vision quality summary still requires one Host closure read');
    assert.strictEqual(scenario.agent.performanceToolCallCount, 0,
      'Host closure must not consume the exhausted model-business Tool budget');
    assert.strictEqual(scenario.agent.harnessQualityVerificationCallCount, 1);
    const finalEntry = scenario.agent.toolCallLog.at(-1);
    assert.strictEqual(finalEntry.origin, 'harness_quality_verification');
    assert.strictEqual(finalEntry.qualityVerificationPhase, 'final_summary');
    assert.strictEqual(resultById(result.executionSummary, 'main-image.fresh-structure')?.status, 'pass');
    assert.notStrictEqual(resultById(result.executionSummary, 'main-image.fresh-visual')?.status, 'pass');
  }

  {
    const scenario = createScenario({
      verificationHistoryStateRefs: [HISTORY_A, HISTORY_A, HISTORY_A, HISTORY_A]
    });
    scenario.agent.config.performanceBudget = {
      maxModelCalls: 0,
      maxToolCalls: 0,
      maxVisionCandidates: 0,
      maxVisualAnalyses: 0,
      maxFullResolutionImageReads: 0,
      softTimeBudgetMs: 60_000
    };
    for (let index = 0; index < 4; index += 1) {
      await scenario.agent.readCurrentPhotoshopHistoryStateRefForQualityVerification('final_summary');
    }
    assert.strictEqual(scenario.verificationCalls.length, 3,
      'the dedicated Host closure quota must remain bounded to three real reads');
    assert.strictEqual(
      scenario.agent.toolCallLog.at(-1).result.code,
      'agent_quality_verification_budget_exhausted'
    );
    assert.strictEqual(scenario.agent.readLatestClosedQualityHistoryStateRef(), undefined,
      'a quota policy result cannot close the final quality version');
  }

  {
    const scenario = createScenario({ verificationHistoryStateRefs: [] });
    scenario.agent.toolCallLog.push({
      name: 'getDocumentInfo',
      arguments: {},
      result: { success: false, historyStateRef: HISTORY_A },
      origin: 'harness_quality_verification',
      qualityVerificationPhase: 'final_summary'
    });
    assert.strictEqual(scenario.agent.readLatestClosedQualityHistoryStateRef(), undefined,
      'success:false carrying a ref must never count as a closed Host observation');
    assert.strictEqual(
      scenario.agent.buildExecutionSummary('final_response', 1, null).failedToolCalls,
      0,
      'a failed Harness closure read must not masquerade as a failed business Tool action'
    );
  }

  {
    const scenario = createScenario({ verificationHistoryStateRefs: [HISTORY_A, HISTORY_A] });
    const assertions = await scenario.agent.evaluateDesignQualityVlmAssertions('final_response');

    assert(Array.isArray(assertions), 'stable Host revision must produce VLM assertion results');
    assert.strictEqual(assertions.length, expectedVlmAssertionCount);
    assert.strictEqual(scenario.modelRequests.length, 1, 'stable revision must call the visual Judge once');
    assert.strictEqual(scenario.verificationCalls.length, 2, 'stable revision must read Host state before and after Judge');
    assert.deepStrictEqual(
      scenario.verificationCalls.map((call) => call.name),
      ['getDocumentInfo', 'getDocumentInfo']
    );
    const imageBlocks = scenario.modelRequests[0].messages
      .flatMap((message) => message.contentBlocks || [])
      .filter((block) => block.type === 'image');
    assert.strictEqual(imageBlocks.length, 1, 'Judge must receive the selected snapshot as a real image block');
    assert.strictEqual(imageBlocks[0].data, SNAPSHOT_BASE64);
    const qualityVerificationEntries = scenario.agent.toolCallLog.slice(-2);
    assert(qualityVerificationEntries.every(
      (entry) => entry.origin === 'harness_quality_verification'
    ), 'Host verification reads must remain auditable without masquerading as model Tool calls');
    assert.deepStrictEqual(
      qualityVerificationEntries.map((entry) => entry.qualityVerificationPhase),
      ['pre_judge', 'post_judge'],
      'Host verification reads must preserve their pre/post closure phase'
    );

    const summary = scenario.agent.buildExecutionSummary('final_response', 1, assertions);
    assert.strictEqual(resultById(summary, 'main-image.fresh-structure')?.status, 'pass');
    assert.strictEqual(resultById(summary, 'main-image.fresh-visual')?.status, 'pass');
  }

  {
    const scenario = createScenario({
      verificationHistoryStateRefs: [HISTORY_A],
      modelThrows: true
    });
    const assertions = await scenario.agent.evaluateDesignQualityVlmAssertions('final_response');

    assert.strictEqual(assertions, null, 'visual Judge failure must not fabricate assertions');
    assert.strictEqual(scenario.verificationCalls.length, 1, 'failed Judge has no completed post-Judge closure');
    const summary = scenario.agent.buildExecutionSummary('final_response', 1, assertions);
    assert.notStrictEqual(
      resultById(summary, 'main-image.fresh-structure')?.status,
      'pass',
      'a pre-Judge-only read must not publish a closed fresh structure claim'
    );
  }

  {
    const scenario = createScenario({ verificationHistoryStateRefs: [HISTORY_B] });
    const assertions = await scenario.agent.evaluateDesignQualityVlmAssertions('final_response');

    assert.strictEqual(assertions, null, 'pre-Judge revision mismatch must fail closed');
    assert.strictEqual(scenario.modelRequests.length, 0, 'pre-Judge mismatch must stop before the visual model call');
    assert.strictEqual(scenario.verificationCalls.length, 1);
    assert(scenario.steps.some((step) => step.issue === 'design_quality_vlm_stale'));
  }

  {
    const scenario = createScenario({ verificationHistoryStateRefs: [HISTORY_A, HISTORY_B] });
    const assertions = await scenario.agent.evaluateDesignQualityVlmAssertions('final_response');

    assert.strictEqual(assertions, null, 'post-Judge revision mismatch must discard the model response');
    assert.strictEqual(scenario.modelRequests.length, 1, 'post-Judge mismatch is detected after the model call');
    assert.strictEqual(scenario.verificationCalls.length, 2);
    assert(scenario.steps.some((step) => step.issue === 'design_quality_vlm_stale'));

    const summary = scenario.agent.buildExecutionSummary('final_response', 1, assertions);
    assert.notStrictEqual(
      resultById(summary, 'main-image.fresh-structure')?.status,
      'pass',
      'changed Host revision must not publish the old structure as fresh'
    );
    assert.notStrictEqual(
      resultById(summary, 'main-image.fresh-visual')?.status,
      'pass',
      'changed Host revision must not publish the discarded visual judgment as fresh'
    );
  }

  {
    const scenario = createScenario({
      verificationHistoryStateRefs: [],
      snapshotHistoryStateRef: null
    });
    const assertions = await scenario.agent.evaluateDesignQualityVlmAssertions('final_response');

    assert.strictEqual(assertions, null, 'snapshot without historyStateRef must fail closed');
    assert.strictEqual(scenario.modelRequests.length, 0);
    assert.strictEqual(scenario.verificationCalls.length, 0, 'missing snapshot ref must stop before Host verification');
  }

  {
    const scenario = createScenario({
      verificationHistoryStateRefs: [],
      structureHistoryStateRef: null
    });
    const assertions = await scenario.agent.evaluateDesignQualityVlmAssertions('final_response');

    assert.strictEqual(assertions, null, 'structure evidence without historyStateRef must fail closed');
    assert.strictEqual(scenario.modelRequests.length, 0);
    assert.strictEqual(scenario.verificationCalls.length, 0, 'missing structure ref must stop before Host verification');
  }

  console.log(JSON.stringify({
    success: true,
    checks: [
      'stable screenshot/structure/pre/post Host revision reaches the visual Judge',
      'pre-Judge revision mismatch stops before model execution',
      'post-Judge revision mismatch discards model output and fresh verification claims',
      'missing screenshot Host revision fails closed',
      'missing structure Host revision fails closed',
      'Harness quality verification does not satisfy task progress',
      'no-vision quality summary performs a final Host closure without fabricating visual review',
      'Host quality closure uses a separate bounded quota when business Tool budget is exhausted',
      'failed or policy-gated Host reads cannot close quality version',
      'a failed Judge without post verification cannot publish a closed fresh claim'
    ]
  }, null, 2));
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
