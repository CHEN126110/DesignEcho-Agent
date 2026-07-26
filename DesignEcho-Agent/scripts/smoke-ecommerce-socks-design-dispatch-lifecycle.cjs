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
  buildEcommerceSocksDispatchLifecycle
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
    typeof buildEcommerceSocksDispatchLifecycle === 'function',
    'dispatch lifecycle helper should be exported'
  );

  const evidence = buildEcommerceSocksDesignState({
    userIntent: '帮我完成整套袜子电商设计',
    deliverables: ['main-image', 'detail-page', 'sku']
  });
  const decision = buildEcommerceSocksDispatchDecision({
    childSkills: evidence.childSkills,
    executeChildren: true,
    confirmChildDispatch: true
  });
  const lifecycle = buildEcommerceSocksDispatchLifecycle({
    userIntent: evidence.userIntent,
    childSkills: evidence.childSkills,
    dispatchDecision: decision
  });

  assert(lifecycle.version === 'ecommerce-socks-dispatch-lifecycle/v0', 'lifecycle should expose version', lifecycle);
  assert(lifecycle.status === 'blocked', 'lifecycle should remain blocked while child dispatch is blocked', lifecycle);
  assert(lifecycle.noPhotoshopWrites === true, 'lifecycle must not write Photoshop', lifecycle);
  assert(lifecycle.canClaimDesignComplete === false, 'lifecycle must not claim design completion', lifecycle);
  assert(
    lifecycle.acceptanceResponsibility.parent === 'aggregate_child_reports_only',
    'parent should aggregate child reports only',
    lifecycle.acceptanceResponsibility
  );
  assert(
    JSON.stringify(lifecycle.acceptanceResponsibility.children.map((item) => item.skillId))
      === JSON.stringify(['main-image-design', 'detail-page-design', 'sku-batch']),
    'lifecycle should preserve child acceptance ownership',
    lifecycle.acceptanceResponsibility
  );
  assert(
    JSON.stringify(lifecycle.phases.map((item) => item.id))
      === JSON.stringify(['context_intake', 'child_dispatch', 'child_acceptance', 'parent_report']),
    'lifecycle should expose stable phase ids',
    lifecycle.phases
  );
  assert(
    lifecycle.phases.find((item) => item.id === 'child_dispatch').status === 'blocked',
    'child dispatch phase should be blocked by checkpoint decision',
    lifecycle.phases
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
    result.data?.ecommerceSocksDispatchLifecycle?.version === 'ecommerce-socks-dispatch-lifecycle/v0',
    'executor should expose dispatch lifecycle evidence',
    result.data
  );
  assert(
    result.data.ecommerceSocksDispatchLifecycle.status === 'blocked',
    'executor lifecycle should remain blocked in checkpoint stage',
    result.data.ecommerceSocksDispatchLifecycle
  );
  assert(
    result.data.ecommerceSocksDispatchLifecycle.acceptanceResponsibility.parent === 'aggregate_child_reports_only',
    'executor lifecycle should expose parent acceptance responsibility',
    result.data.ecommerceSocksDispatchLifecycle
  );
  assert(
    !steps.some((item) => ['main-image-design', 'detail-page-design', 'sku-batch'].includes(item.toolName)),
    'lifecycle evidence must not emit child skill execution events',
    steps
  );
  assertNoPseudoThinking(result, 'dispatch lifecycle result');
  assertNoPseudoThinking(steps, 'dispatch lifecycle steps');

  console.log(JSON.stringify({
    success: true,
    checks: [
      'dispatch lifecycle helper exports stable control evidence',
      'lifecycle preserves parent and child acceptance responsibility',
      'lifecycle blocks child dispatch while checkpoint is not implemented',
      'executor exposes lifecycle evidence without executing child skills',
      'lifecycle evidence does not claim Photoshop writes or design completion'
    ]
  }, null, 2));
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
