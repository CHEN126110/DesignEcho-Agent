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

const path = require('path');

const ROOT = path.resolve(__dirname, '..');

const {
  buildEcommerceSocksChildReportAggregation,
  buildEcommerceSocksDesignState,
  buildEcommerceSocksDispatchDecision,
  buildEcommerceSocksDispatchLifecycle,
  buildEcommerceSocksDispatchOrchestrationPlan
} = require(path.join(ROOT, 'src', 'shared', 'ecommerce-socks-design.ts'));
const {
  getSkillExecutor
} = require(path.join(ROOT, 'src', 'renderer', 'services', 'skill-executors', 'index.ts'));

function assert(condition, message, details) {
  if (!condition) {
    const suffix = details ? `\n${JSON.stringify(details, null, 2)}` : '';
    throw new Error(`${message}${suffix}`);
  }
}

function assertNoPseudoThinking(value, label) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  const forbidden = ['正在思考', '等待响应', '请求已发送', '正在准备', '稍等'];
  const found = forbidden.filter((token) => text.includes(token));
  assert(found.length === 0, `${label} contains pseudo-thinking copy: ${found.join(', ')}`);
}

function buildFixture() {
  const evidence = buildEcommerceSocksDesignState({
    userIntent: '帮我完成整套袜子电商设计',
    deliverables: ['main-image', 'detail-page', 'sku']
  });
  const dispatchDecision = buildEcommerceSocksDispatchDecision({
    childSkills: evidence.childSkills,
    executeChildren: true,
    confirmChildDispatch: true
  });
  const dispatchLifecycle = buildEcommerceSocksDispatchLifecycle({
    userIntent: evidence.userIntent,
    childSkills: evidence.childSkills,
    dispatchDecision
  });
  const dispatchOrchestration = buildEcommerceSocksDispatchOrchestrationPlan({
    childSkills: evidence.childSkills,
    dispatchDecision,
    dispatchLifecycle
  });

  return {
    evidence,
    dispatchOrchestration
  };
}

function buildChildReports(childSteps, overrides = {}) {
  return childSteps.map((step) => {
    const override = overrides[step.skillId] || {};
    return {
      version: 'ecommerce-socks-child-report/v0',
      expectedReportKey: step.expectedReportKey,
      deliverable: step.deliverable,
      skillId: step.skillId,
      status: override.status || 'completed',
      canClaimOutputQuality: override.canClaimOutputQuality !== false,
      outputCount: override.outputCount ?? 1,
      warnings: override.warnings || [],
      blockers: override.blockers || []
    };
  });
}

async function run() {
  assert(
    typeof buildEcommerceSocksChildReportAggregation === 'function',
    'child report aggregation helper should be exported'
  );

  const fixture = buildFixture();
  const missing = buildEcommerceSocksChildReportAggregation({
    dispatchOrchestration: fixture.dispatchOrchestration,
    childReports: []
  });
  assert(missing.version === 'ecommerce-socks-child-report-aggregation/v0', 'aggregation should expose version', missing);
  assert(missing.status === 'blocked_missing_reports', 'missing reports should block parent aggregation', missing);
  assert(missing.missingChildReports.length === 3, 'missing aggregation should list all required child reports', missing);
  assert(missing.receivedChildReports.length === 0, 'missing aggregation should not fabricate received reports', missing);
  assert(missing.canAggregateQuality === false, 'missing reports cannot aggregate quality', missing);
  assert(missing.canClaimDesignComplete === false, 'missing reports cannot claim design completion', missing);
  assert(missing.mustNotRunChildSkills === true, 'aggregation must not run child skills', missing);
  assert(missing.noPhotoshopWrites === true, 'aggregation must not write Photoshop', missing);

  const failedReports = buildChildReports(fixture.dispatchOrchestration.childSteps, {
    'detail-page-design': {
      status: 'failed',
      canClaimOutputQuality: false,
      blockers: ['layout_verification_failed']
    }
  });
  const failed = buildEcommerceSocksChildReportAggregation({
    dispatchOrchestration: fixture.dispatchOrchestration,
    childReports: failedReports
  });
  assert(failed.status === 'blocked_child_failed', 'failed child report should block parent aggregation', failed);
  assert(failed.blockers.includes('child_report_failed'), 'failed aggregation should expose child failure blocker', failed);
  assert(failed.canAggregateQuality === false, 'failed child report cannot aggregate quality', failed);
  assert(failed.canClaimDesignComplete === false, 'failed child report cannot claim design completion', failed);

  const unverifiedReports = buildChildReports(fixture.dispatchOrchestration.childSteps, {
    'sku-batch': {
      status: 'completed',
      canClaimOutputQuality: false,
      warnings: ['missing_manual_review']
    }
  });
  const unverified = buildEcommerceSocksChildReportAggregation({
    dispatchOrchestration: fixture.dispatchOrchestration,
    childReports: unverifiedReports
  });
  assert(
    unverified.status === 'blocked_quality_unverified',
    'unverified child quality should block parent quality claim',
    unverified
  );
  assert(
    unverified.blockers.includes('child_report_quality_unverified'),
    'unverified aggregation should expose quality blocker',
    unverified
  );

  const completeReports = buildChildReports(fixture.dispatchOrchestration.childSteps);
  const complete = buildEcommerceSocksChildReportAggregation({
    dispatchOrchestration: fixture.dispatchOrchestration,
    childReports: completeReports
  });
  assert(complete.status === 'ready_to_report', 'all completed child reports should be ready to report', complete);
  assert(complete.receivedChildReports.length === 3, 'complete aggregation should list all received reports', complete);
  assert(complete.missingChildReports.length === 0, 'complete aggregation should have no missing reports', complete);
  assert(complete.canAggregateQuality === true, 'complete child reports can aggregate quality', complete);
  assert(
    complete.canClaimDesignComplete === true,
    'parent can claim completion only from all passed child reports',
    complete
  );
  assert(complete.completionClaimSource === 'child_reports_only', 'completion source should be child reports only', complete);

  const executor = getSkillExecutor('ecommerce-socks-design');
  assert(executor, 'ecommerce-socks-design executor should be registered');
  const steps = [];
  const result = await executor.execute({
    params: {
      userIntent: '帮我完成整套袜子电商设计',
      deliverables: ['main-image', 'detail-page', 'sku'],
      executeChildren: true,
      confirmChildDispatch: true,
      childReports: completeReports
    },
    callbacks: {
      onStep: (event) => steps.push(event),
      onMessage: () => undefined,
      onProgress: () => undefined
    },
    context: {
      userInput: '帮我完成整套袜子电商设计',
      isPluginConnected: true,
      conversationHistory: [],
      projectContext: {
        projectPath: 'D:/demo/socks-project',
        projectImageCount: 18
      },
      photoshopContext: {
        hasDocument: true,
        documentName: '详情页.psb'
      }
    }
  });

  assert(
    result.data?.ecommerceSocksChildReportAggregation?.version === 'ecommerce-socks-child-report-aggregation/v0',
    'executor should expose child report aggregation evidence',
    result.data
  );
  assert(
    result.data.ecommerceSocksDesign.childReportAggregation === result.data.ecommerceSocksChildReportAggregation,
    'entry evidence should reference the same aggregation evidence',
    result.data
  );
  assert(
    !steps.some((item) => ['main-image-design', 'detail-page-design', 'sku-batch'].includes(item.toolName)),
    'child report aggregation must not emit real child skill execution events',
    steps
  );
  assertNoPseudoThinking(result, 'child report aggregation result');
  assertNoPseudoThinking(steps, 'child report aggregation steps');

  console.log(JSON.stringify({
    success: true,
    checks: [
      'child report aggregation helper exports stable parent aggregation evidence',
      'missing child reports block parent quality and completion claims',
      'failed child reports block parent aggregation',
      'unverified child quality blocks parent quality claim',
      'all passed child reports allow parent report completion claim from child reports only',
      'executor exposes aggregation evidence without executing child skills'
    ]
  }, null, 2));
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
