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

async function run() {
  assert(
    typeof buildEcommerceSocksDispatchOrchestrationPlan === 'function',
    'dispatch orchestration helper should be exported'
  );

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
  const orchestration = buildEcommerceSocksDispatchOrchestrationPlan({
    childSkills: evidence.childSkills,
    dispatchDecision,
    dispatchLifecycle
  });

  assert(
    orchestration.version === 'ecommerce-socks-dispatch-orchestration/v0',
    'orchestration should expose version',
    orchestration
  );
  assert(orchestration.status === 'blocked', 'orchestration should remain blocked while dispatch is blocked', orchestration);
  assert(orchestration.canExecuteChildren === false, 'orchestration must not execute child skills yet', orchestration);
  assert(orchestration.noPhotoshopWrites === true, 'orchestration must not write Photoshop', orchestration);
  assert(orchestration.canClaimDesignComplete === false, 'orchestration must not claim design completion', orchestration);
  assert(
    orchestration.failurePolicy.onChildFailure === 'continue_independent_and_report',
    'orchestration should define independent child continuation failure policy',
    orchestration.failurePolicy
  );
  assert(
    orchestration.resultAggregation.requiredChildReports.length === 3,
    'orchestration should require all child reports before parent quality aggregation',
    orchestration.resultAggregation
  );
  assert(
    orchestration.resultAggregation.parentMayOnlyAggregate === true,
    'parent must only aggregate child reports',
    orchestration.resultAggregation
  );
  assert(
    JSON.stringify(orchestration.childSteps.map((item) => item.skillId))
      === JSON.stringify(['main-image-design', 'detail-page-design', 'sku-batch']),
    'orchestration should preserve child execution order',
    orchestration.childSteps
  );
  assert(
    orchestration.childSteps.every((item) => item.executionState === 'not_started'),
    'orchestration evidence must not mark child execution started',
    orchestration.childSteps
  );
  assert(
    orchestration.childSteps.every((item) => item.progressRange.start < item.progressRange.end),
    'each child step should have a visible progress range',
    orchestration.childSteps
  );

  const executor = getSkillExecutor('ecommerce-socks-design');
  assert(executor, 'ecommerce-socks-design executor should be registered');

  const steps = [];
  const result = await executor.execute({
    params: {
      userIntent: '帮我完成整套袜子电商设计',
      deliverables: ['main-image', 'detail-page', 'sku'],
      executeChildren: true,
      confirmChildDispatch: true
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
    result.data?.ecommerceSocksDispatchOrchestration?.version === 'ecommerce-socks-dispatch-orchestration/v0',
    'executor should expose dispatch orchestration evidence',
    result.data
  );
  assert(
    result.data.ecommerceSocksDispatchOrchestration.canExecuteChildren === false,
    'executor orchestration must not run child skills yet',
    result.data.ecommerceSocksDispatchOrchestration
  );
  assert(
    result.data.ecommerceSocksDesign.dispatchOrchestration === result.data.ecommerceSocksDispatchOrchestration,
    'entry evidence should reference the same orchestration evidence',
    result.data
  );
  assert(
    !steps.some((item) => ['main-image-design', 'detail-page-design', 'sku-batch'].includes(item.toolName)),
    'orchestration evidence must not emit child skill execution events',
    steps
  );
  assertNoPseudoThinking(result, 'dispatch orchestration result');
  assertNoPseudoThinking(steps, 'dispatch orchestration steps');

  console.log(JSON.stringify({
    success: true,
    checks: [
      'dispatch orchestration helper exports stable pre-execution plan',
      'orchestration defines failure policy and result aggregation',
      'orchestration assigns progress ranges without starting child skills',
      'executor exposes orchestration evidence without executing child skills',
      'orchestration evidence does not claim Photoshop writes or design completion'
    ]
  }, null, 2));
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
