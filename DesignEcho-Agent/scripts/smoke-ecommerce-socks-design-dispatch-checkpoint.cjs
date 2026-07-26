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
  buildEcommerceSocksDispatchDecision
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
    typeof buildEcommerceSocksDispatchDecision === 'function',
    'dispatch checkpoint helper should be exported'
  );

  const evidence = buildEcommerceSocksDesignState({
    userIntent: '帮我做一整套袜子电商设计',
    deliverables: ['main-image', 'detail-page', 'sku']
  });

  const defaultDecision = buildEcommerceSocksDispatchDecision({
    childSkills: evidence.childSkills,
    executeChildren: false,
    confirmChildDispatch: false
  });
  assert(defaultDecision.version === 'ecommerce-socks-dispatch/v0', 'dispatch decision should expose version', defaultDecision);
  assert(defaultDecision.canDispatchChildren === false, 'default checkpoint must not dispatch children', defaultDecision);
  assert(defaultDecision.blockedReasons.includes('child_dispatch_not_requested'), 'default checkpoint should explain no dispatch request', defaultDecision);
  assert(defaultDecision.noPhotoshopWrites === true, 'dispatch checkpoint must not write Photoshop', defaultDecision);
  assert(defaultDecision.canClaimDesignComplete === false, 'dispatch checkpoint must not claim design completion', defaultDecision);
  assert(
    JSON.stringify(defaultDecision.childExecutionOrder.map((item) => item.skillId))
      === JSON.stringify(['main-image-design', 'detail-page-design', 'sku-batch']),
    'dispatch decision should preserve child execution order',
    defaultDecision
  );

  const unconfirmedDecision = buildEcommerceSocksDispatchDecision({
    childSkills: evidence.childSkills,
    executeChildren: true,
    confirmChildDispatch: false
  });
  assert(
    unconfirmedDecision.blockedReasons.includes('child_dispatch_requires_confirmation'),
    'dispatch request without confirmation should be blocked',
    unconfirmedDecision
  );

  const confirmedDecision = buildEcommerceSocksDispatchDecision({
    childSkills: evidence.childSkills,
    executeChildren: true,
    confirmChildDispatch: true
  });
  assert(confirmedDecision.canDispatchChildren === false, 'checkpoint stage still must not execute children', confirmedDecision);
  assert(
    confirmedDecision.blockedReasons.includes('child_dispatch_checkpoint_not_implemented'),
    'confirmed dispatch should remain blocked until child dispatch implementation lands',
    confirmedDecision
  );

  const executor = getSkillExecutor('ecommerce-socks-design');
  assert(executor, 'ecommerce-socks-design executor should be registered');

  const steps = [];
  const result = await executor.execute({
    params: {
      userIntent: '帮我做一整套袜子电商设计',
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
      userInput: '帮我做一整套袜子电商设计',
      isPluginConnected: true,
      conversationHistory: [],
      projectContext: {
        projectPath: 'D:/demo/socks-project',
        projectImageCount: 12
      },
      photoshopContext: {
        hasDocument: true,
        documentName: 'SKU.psb'
      }
    }
  });

  assert(result.success === true, 'parent checkpoint should return a readable control result', result);
  assert(
    result.data?.ecommerceSocksDispatchDecision?.version === 'ecommerce-socks-dispatch/v0',
    'executor should expose dispatch decision evidence',
    result.data
  );
  assert(
    result.data.ecommerceSocksDispatchDecision.canDispatchChildren === false,
    'executor checkpoint must not run child skills yet',
    result.data.ecommerceSocksDispatchDecision
  );
  assert(
    result.data.ecommerceSocksDesign.dispatchDecision === result.data.ecommerceSocksDispatchDecision,
    'entry evidence should reference the same dispatch decision',
    result.data
  );
  assert(
    !steps.some((item) => ['main-image-design', 'detail-page-design', 'sku-batch'].includes(item.toolName)),
    'dispatch checkpoint must not emit child skill execution events',
    steps
  );
  assertNoPseudoThinking(result, 'dispatch checkpoint result');
  assertNoPseudoThinking(steps, 'dispatch checkpoint steps');

  console.log(JSON.stringify({
    success: true,
    checks: [
      'dispatch helper exports stable checkpoint decision',
      'default parent skill remains plan-only',
      'unconfirmed child dispatch is blocked',
      'confirmed child dispatch is still blocked until child dispatch implementation lands',
      'executor exposes dispatch decision evidence without executing child skills'
    ]
  }, null, 2));
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
