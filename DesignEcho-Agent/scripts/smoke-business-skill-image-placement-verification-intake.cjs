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
  buildImagePlacementPlan
} = require('../src/shared/design-image-placement-core.ts');
const {
  buildBusinessSkillImagePlacementVerificationIntake
} = require('../src/shared/business-skill-image-placement-verification-intake.ts');
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

function buildPlacementPlan() {
  return buildImagePlacementPlan({
    source: {
      width: 1600,
      height: 1200,
      path: 'D:/demo/source/product.jpg',
      assetId: 'asset-product',
      role: 'product',
      subjectBox: { x: 240, y: 160, width: 1120, height: 820 }
    },
    target: {
      box: { x: 80, y: 120, width: 640, height: 520 },
      safeBox: { x: 60, y: 100, width: 680, height: 560 },
      screenId: 'screen-hero',
      slotId: 'hero-image',
      slotRole: 'hero'
    },
    canvas: { width: 800, height: 1200 },
    designType: 'detail-page',
    assetRole: 'product',
    intent: 'hero',
    executionTool: 'replaceImagePlaceholder'
  });
}

function resolveScenario(userInput) {
  if (userInput.includes('详情页')) return 'detail-page';
  if (userInput.includes('SKU')) return 'sku';
  return 'main-image';
}

function buildExecuteParams(userInput) {
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
          scenario: resolveScenario(userInput),
          maxCandidates: 1,
          selectedCandidates: [{
            assetId: 'asset-product',
            path: 'D:/demo/source/product.jpg',
            role: 'raw-product-still',
            priority: 100,
            score: 100,
            reason: 'fixture candidate',
            cacheKey: 'project-visual:asset-product',
            cacheStatus: 'hit',
            shouldAnalyze: false,
            cachedInsight: {
              assetId: 'asset-product',
              summary: '白色袜子商品图，已有缓存视觉摘要。',
              productType: '袜子'
            },
            requiredEvidence: [],
            evidence: []
          }],
          skippedCandidateCount: 0,
          cacheSummary: { hit: 1, miss: 0, stale: 0, shouldAnalyze: 0 },
          warnings: [],
          limitations: [],
          evidence: []
        },
        visualInsightCache: { summary: { entriesWithInsight: 1, totalEntries: 1 } }
      }
    }
  };
}

function runSharedHelperChecks() {
  const noPlan = buildBusinessSkillImagePlacementVerificationIntake({
    skillId: 'main-image-design',
    resultData: {}
  });
  assert(noPlan.status === 'no_placement_plan', 'missing placement plan should be explicit', noPlan);
  assert(noPlan.userVisible === false, 'placement intake must stay hidden');
  assert(noPlan.canClaimDesignQuality === false, 'placement intake must not claim design quality');
  assert(!Object.prototype.hasOwnProperty.call(noPlan, 'sourceRecords'), 'placement intake must not list its own normalized sections as sources', noPlan);
  assert(noPlan.requiredNextChecks.includes('image_placement_plan_required'), 'missing plan should require placement plan');

  const plan = buildPlacementPlan();
  const plannedOnly = buildBusinessSkillImagePlacementVerificationIntake({
    skillId: 'detail-page-design',
    resultData: { imagePlacementPlan: plan }
  });
  assert(plannedOnly.status === 'needs_actual_bounds', 'planned-only placement should require actualBounds', plannedOnly);
  assert(plannedOnly.requiredNextChecks.includes('photoshop_actual_bounds_required'), 'planned-only should require actualBounds');
  assert(plannedOnly.placementCheck.hasPlacementPlan === true, 'planned-only should detect placement plan');
  assert(plannedOnly.placementCheck.hasActualBounds === false, 'planned-only must not fabricate actualBounds');

  const boundsVerified = buildBusinessSkillImagePlacementVerificationIntake({
    skillId: 'detail-page-design',
    resultData: {
      imagePlacementPlan: plan,
      imagePlacementActualBounds: plan.execution.destinationBox,
      imagePlacementClippingApplied: true
    }
  });
  assert(boundsVerified.status === 'verified_by_bounds', 'exact bounds should verify geometry', boundsVerified);
  assert(boundsVerified.placementCheck.verifiedCount === 1, 'bounds verification should count one verified placement');
  assert(boundsVerified.canClaimDesignQuality === false, 'bounds verification still must not claim design quality');
  assert(!Object.prototype.hasOwnProperty.call(boundsVerified, 'sourceRecords'), 'placement checks should remain typed fields instead of self-source records', boundsVerified);
  assert(boundsVerified.limitations.some((item) => item.includes('不等于设计质量')), 'bounds limitations should block overclaim');

  const failedScreenshot = buildBusinessSkillImagePlacementVerificationIntake({
    skillId: 'detail-page-design',
    resultData: {
      imagePlacementPlan: plan,
      imagePlacementActualBounds: plan.execution.destinationBox,
      imagePlacementScreenshotReview: {
        available: true,
        reviewStatus: 'failed',
        reason: 'fixture screenshot failed'
      }
    }
  });
  assert(failedScreenshot.status === 'failed_bounds_or_screenshot', 'failed screenshot should fail placement intake', failedScreenshot);
  assert(failedScreenshot.blockers.some((item) => item.includes('fixture screenshot failed')), 'failed screenshot reason should surface as blocker');

  [noPlan, plannedOnly, boundsVerified, failedScreenshot].forEach((item, index) => {
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
    const plan = buildPlacementPlan();
    let executeCalls = 0;
    registerSkillExecutor({
      skillId: item.skillId,
      execute: async () => {
        executeCalls += 1;
        return {
          success: true,
          message: `fixture ${item.skillId} result`,
          data: {
            imagePlacementPlan: plan,
            imagePlacementActualBounds: plan.execution.destinationBox,
            imagePlacementClippingApplied: true
          }
        };
      }
    });

    const result = await executeSkillWithExecutor(item.skillId, buildExecuteParams(item.userInput));
    const intake = result.data && result.data.businessSkillImagePlacementVerificationIntake;
    assert(executeCalls === 1, `${item.skillId} executor should still run exactly once`, {
      executeCalls,
      result
    });
    assert(result.success === true, `${item.skillId} placement intake must preserve business result success`, result);
    assert(intake, `${item.skillId} should attach businessSkillImagePlacementVerificationIntake`);
    assert(intake.userVisible === false, `${item.skillId} placement intake must stay hidden`);
    assert(intake.canClaimDesignQuality === false, `${item.skillId} placement intake must not claim design quality`);
    assert(intake.status === 'verified_by_bounds', `${item.skillId} should verify geometry by bounds`, intake);
    assertNoRawPayload(result, `${item.skillId} result`);
    assertNoPseudoThinking(result, `${item.skillId} result`);
  }
}

function runSourceChecks() {
  const packageJson = JSON.parse(read('package.json'));
  const wrapperSource = read('src/renderer/services/skill-executors/business-skill-visual-context.ts');
  const architectureSource = read('scripts/report-agent-architecture.cjs');
  const cockpitSource = read('scripts/report-project-cockpit.cjs');
  const boundarySource = read('scripts/report-change-boundaries.cjs');

  assert(
    packageJson.scripts?.['smoke:business-skill:image-placement-verification-intake'] ===
      'node scripts/smoke-business-skill-image-placement-verification-intake.cjs',
    'package should register image placement verification intake smoke'
  );
  assert(
    String(packageJson.scripts?.['maintenance:preflight'] || '').includes('smoke:business-skill:image-placement-verification-intake'),
    'maintenance preflight should include image placement verification intake smoke'
  );
  assert(wrapperSource.includes('buildBusinessSkillImagePlacementVerificationIntakeForSkill'), 'wrapper should expose placement intake builder');
  assert(wrapperSource.includes('attachBusinessSkillImagePlacementVerificationIntakeToResult'), 'business skill wrapper should attach placement intake');
  assert(architectureSource.includes('businessSkillImagePlacementVerificationIntake'), 'architecture report should expose placement intake');
  assert(cockpitSource.includes('businessSkillImagePlacementVerificationIntake'), 'project cockpit should expose placement intake');
  assert(boundarySource.includes('image-placement-verification-intake'), 'change boundaries should classify placement intake');
}

async function run() {
  runSharedHelperChecks();
  await runExecutorWiringChecks();
  runSourceChecks();

  console.log(JSON.stringify({
    success: true,
    checks: [
      'business skill image placement verification intake summarizes placement plan and actualBounds checks',
      'planned destinationBox without actualBounds cannot pass verification',
      'bounds verification can pass geometry but still cannot claim design quality',
      'failed screenshot review blocks placement verification',
      'unified business skill executor attaches hidden placement verification intake for main-image, detail-page and SKU',
      'maintenance reports and preflight expose the placement verification intake'
    ]
  }, null, 2));
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
