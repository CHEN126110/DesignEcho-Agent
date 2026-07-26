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
  buildBusinessSkillExecutionPlanIntake
} = require('../src/shared/business-skill-execution-plan-intake.ts');
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

function assertNoRawPayload(value, label) {
  const text = JSON.stringify(value);
  const forbidden = ['base64-image-payload', 'raw-image-payload', 'dataUrl', 'pixels', 'buffer'];
  const found = forbidden.filter((token) => text.includes(token));
  assert(found.length === 0, `${label} contains raw image payload markers: ${found.join(', ')}`);
}

function assertNoPseudoThinking(value, label) {
  const text = JSON.stringify(value);
  const forbidden = ['正在思考', '等待响应', '请求已发送', '正在准备', '稍等'];
  const found = forbidden.filter((token) => text.includes(token));
  assert(found.length === 0, `${label} contains pseudo-thinking copy: ${found.join(', ')}`);
}

function buildExecutionPlan(stepCount = 2) {
  return {
    planId: 'fixture-execution-plan',
    scenario: 'main-image',
    status: 'planned',
    steps: Array.from({ length: stepCount }, (_, index) => ({
      id: `step-${index + 1}`,
      operation: index === 0 ? 'transformLayer' : 'quickExport',
      target: index === 0 ? 'hero-image' : 'output-file',
      params: { fixture: true },
      reason: 'fixture plan step',
      expectedOutcomes: ['tool result', 'bounds']
    })),
    inputs: [{ source: 'D:/fixture/source.psd', summary: 'fixture input document' }],
    limitations: ['fixture plan only']
  };
}

function buildExecutionTrace(options = {}) {
  const failed = options.failed === true;
  return {
    traceId: 'fixture-trace',
    scenario: 'main-image',
    toolCallCount: 2,
    successfulToolCalls: failed ? 1 : 2,
    failedToolCalls: failed ? 1 : 0,
    toolCalls: [
      { toolName: 'transformLayer', success: true, summary: 'transform ok' },
      { toolName: 'quickExport', success: !failed, summary: failed ? 'export failed' : 'export ok' }
    ]
  };
}

function buildVerificationReport(status = 'needs_review') {
  return {
    reportId: 'fixture-verification',
    scenario: 'main-image',
    status,
    scope: 'bounds',
    summary: `fixture verification ${status}`,
    checks: [{
      id: 'fixture-check',
      label: 'fixture check',
      status,
      summary: 'fixture check summary'
    }],
    blockers: status === 'failed' ? ['fixture verification failed'] : [],
    warnings: status === 'needs_review' ? ['fixture still needs screenshot review'] : [],
    limitations: ['fixture verification is not design quality']
  };
}

function buildDesignAgentOs(overrides = {}) {
  return {
    intentContext: {
      rawText: '帮我做主图',
      normalizedText: '帮我做主图',
      targetScenario: 'main-image',
      action: 'create',
      requiresPhotoshop: true,
      constraints: [],
      sourceRefs: []
    },
    planInputs: {
      scenario: 'main-image',
      goal: '主图设计',
      constraints: [],
      sourceRefs: []
    },
    executionPlan: buildExecutionPlan(),
    ...overrides
  };
}

function buildPlacementIntake(status = 'verified_by_bounds') {
  return {
    version: 'business-skill-image-placement-verification-intake/v0',
    skillId: 'main-image-design',
    status,
    readOnly: true,
    userVisible: false,
    canClaimDesignQuality: false,
    mustNotChangeBusinessStrategy: true,
    placementCheck: {
      hasPlacementPlan: true,
      hasPlannedDestinationBox: true,
      hasActualBounds: status !== 'needs_actual_bounds',
      hasScreenshotReview: false,
      placementCount: 1,
      verifiedCount: status === 'verified_by_bounds' ? 1 : 0,
      failedCount: status === 'failed_bounds_or_screenshot' ? 1 : 0
    },
    sourceRecords: ['image_placement_plan', 'photoshop_actual_bounds'],
    requiredNextChecks: status === 'verified_by_bounds' ? [] : ['photoshop_actual_bounds_required'],
    warnings: [],
    blockers: status === 'failed_bounds_or_screenshot' ? ['fixture placement failed'] : [],
    limitations: ['fixture placement is geometry evidence only']
  };
}

function scenarioForSkill(skillId) {
  if (skillId === 'detail-page-design') return 'detail-page';
  if (skillId === 'sku-batch') return 'sku';
  return 'main-image';
}

function buildExecuteParams(userInput, skillId = 'main-image-design') {
  const scenario = scenarioForSkill(skillId);
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
      projectContext: {
        projectPath: 'D:/demo',
        assetIndex: { summary: { totalImages: 3 }, visionCandidates: [] },
        visualSamplingPlan: {
          planVersion: 'project-visual-sampling/v0',
          mode: 'bounded-metadata-plan',
          scenario,
          maxCandidates: 1,
          selectedCandidates: [],
          skippedCandidateCount: 0,
          cacheSummary: { hit: 0, miss: 0, stale: 0, shouldAnalyze: 0 },
          warnings: [],
          limitations: [],
          evidence: []
        },
        visualInsightCache: { summary: { entriesWithInsight: 0, totalEntries: 0 } }
      }
    }
  };
}

function runSharedHelperChecks() {
  const noPlan = buildBusinessSkillExecutionPlanIntake({
    skillId: 'main-image-design',
    resultData: {}
  });
  assert(noPlan.status === 'no_execution_plan_record', 'missing designAgentOs executionPlan should be explicit', noPlan);
  assert(noPlan.userVisible === false, 'execution plan intake must stay hidden');
  assert(noPlan.canClaimDesignQuality === false, 'execution plan intake must not claim design quality');
  assert(!Object.prototype.hasOwnProperty.call(noPlan, 'sourceRecords'), 'execution plan intake must not list its own component names as sources', noPlan);
  assert(noPlan.requiredNextChecks.includes('design_agent_os_execution_plan_required'), 'missing plan should require Design Agent OS execution plan');

  const planOnly = buildBusinessSkillExecutionPlanIntake({
    skillId: 'main-image-design',
    resultData: {
      designAgentOs: buildDesignAgentOs()
    }
  });
  assert(planOnly.status === 'plan_only_needs_execution_trace', 'plan without trace should be plan-only', planOnly);
  assert(planOnly.planSummary.stepCount === 2, 'plan-only should count execution plan steps');
  assert(planOnly.requiredNextChecks.includes('execution_trace_required'), 'plan-only should require execution trace');

  const executed = buildBusinessSkillExecutionPlanIntake({
    skillId: 'main-image-design',
    resultData: {
      designAgentOs: buildDesignAgentOs({
        executionTrace: buildExecutionTrace(),
        verificationReport: buildVerificationReport('needs_review')
      }),
      designPlannerExecutionAlignment: { status: 'aligned' },
      businessSkillImagePlacementVerificationIntake: buildPlacementIntake()
    }
  });
  assert(executed.status === 'executed_with_trace_needs_verification', 'trace plus needs_review verification should need verification', executed);
  assert(executed.planSummary.hasExecutionTrace === true, 'executed intake should detect execution trace');
  assert(executed.planSummary.toolCallCount === 2, 'executed intake should count tool calls');
  assert(executed.planSummary.placementVerificationStatus === 'verified_by_bounds', 'executed intake should include placement status');
  assert(executed.canClaimDesignQuality === false, 'executed trace still must not claim design quality');
  assert(!Object.prototype.hasOwnProperty.call(executed, 'sourceRecords'), 'executed intake must use typed summaries rather than self-source records', executed);

  const failed = buildBusinessSkillExecutionPlanIntake({
    skillId: 'main-image-design',
    resultData: {
      designAgentOs: buildDesignAgentOs({
        executionTrace: buildExecutionTrace({ failed: true }),
        verificationReport: buildVerificationReport('failed')
      }),
      businessSkillImagePlacementVerificationIntake: buildPlacementIntake('failed_bounds_or_screenshot')
    }
  });
  assert(failed.status === 'failed_execution', 'failed trace or verification should fail execution plan intake', failed);
  assert(failed.blockers.includes('execution_trace_failed'), 'failed trace should expose stable blocker', failed);
  assert(failed.blockers.includes('fixture verification failed'), 'verification blockers should be carried into intake', failed);

  [noPlan, planOnly, executed, failed].forEach((item, index) => {
    assertNoRawPayload(item, `shared intake ${index}`);
    assertNoPseudoThinking(item, `shared intake ${index}`);
  });
}

async function runExecutorWiringChecks() {
  const cases = [
    { skillId: 'main-image-design', userInput: '帮我做主图' },
    { skillId: 'detail-page-design', userInput: '帮我做详情页' },
    { skillId: 'sku-batch', userInput: '帮我做 SKU' }
  ];

  for (const item of cases) {
    let executeCalls = 0;
    registerSkillExecutor({
      skillId: item.skillId,
      execute: async () => {
        executeCalls += 1;
        return {
          success: true,
          message: `fixture ${item.skillId} result`,
          data: {
            designAgentOs: buildDesignAgentOs({
              executionTrace: buildExecutionTrace(),
              verificationReport: buildVerificationReport('needs_review')
            }),
            designPlannerExecutionAlignment: { status: 'aligned' },
            businessSkillImagePlacementVerificationIntake: buildPlacementIntake()
          }
        };
      }
    });

    const result = await executeSkillWithExecutor(item.skillId, buildExecuteParams(item.userInput, item.skillId));
    const intake = result.data && result.data.businessSkillExecutionPlanIntake;
    assert(executeCalls === 1, `${item.skillId} executor should still run exactly once`, { executeCalls, result });
    assert(result.success === true, `${item.skillId} execution plan intake must preserve business result success`, result);
    assert(intake, `${item.skillId} should attach businessSkillExecutionPlanIntake`);
    assert(intake.userVisible === false, `${item.skillId} execution plan intake must stay hidden`);
    assert(intake.canClaimDesignQuality === false, `${item.skillId} execution plan intake must not claim design quality`);
    assert(intake.status === 'executed_with_trace_needs_verification', `${item.skillId} should expose trace-needs-verification status`, intake);
    assertNoRawPayload(result, `${item.skillId} result`);
    assertNoPseudoThinking(result, `${item.skillId} result`);
  }
}

function runSourceChecks() {
  const packageJson = JSON.parse(read('package.json'));
  const wrapperSource = read('src/renderer/services/skill-executors/business-skill-visual-context.ts');
  const registrySource = read('src/renderer/services/skill-executors/registry.ts');
  const architectureSource = read('scripts/report-agent-architecture.cjs');
  const cockpitSource = read('scripts/report-project-cockpit.cjs');
  const boundarySource = read('scripts/report-change-boundaries.cjs');

  assert(
    packageJson.scripts?.['smoke:business-skill:execution-plan-intake'] ===
      'node scripts/smoke-business-skill-execution-plan-intake.cjs',
    'package should register business skill execution plan intake smoke'
  );
  assert(
    String(packageJson.scripts?.['maintenance:preflight'] || '').includes('smoke:business-skill:execution-plan-intake'),
    'maintenance preflight should include execution plan intake smoke'
  );
  assert(wrapperSource.includes('buildBusinessSkillExecutionPlanIntakeForSkill'), 'wrapper should expose execution plan intake builder');
  assert(registrySource.includes('attachBusinessSkillExecutionPlanIntakeToResult'), 'unified executor should attach execution plan intake');
  assert(architectureSource.includes('businessSkillExecutionPlanIntake'), 'architecture report should expose execution plan intake');
  assert(cockpitSource.includes('businessSkillExecutionPlanIntake'), 'project cockpit should expose execution plan intake');
  assert(boundarySource.includes('smoke:business-skill:execution-plan-intake'), 'change boundaries should validate execution plan intake');
  assert(boundarySource.includes('execution-plan-intake'), 'change boundaries should classify execution plan intake');
}

async function run() {
  runSharedHelperChecks();
  await runExecutorWiringChecks();
  runSourceChecks();

  console.log(JSON.stringify({
    success: true,
    checks: [
      'business skill execution plan intake detects missing Design Agent OS executionPlan',
      'plan-only records require an execution trace before execution can be treated as completed',
      'execution trace is summarized without claiming design quality',
      'failed trace or verification blocks execution completion',
      'unified business skill executor attaches hidden execution plan intake for main-image, detail-page and SKU',
      'maintenance reports and preflight expose the execution plan intake'
    ]
  }, null, 2));
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
