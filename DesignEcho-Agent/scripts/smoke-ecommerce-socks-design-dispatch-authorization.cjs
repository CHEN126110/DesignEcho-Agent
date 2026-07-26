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
  buildEcommerceSocksDispatchAuthorization,
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

function buildFixture(params = {}) {
  const evidence = buildEcommerceSocksDesignState({
    userIntent: '帮我完成整套袜子电商设计',
    deliverables: ['main-image', 'detail-page', 'sku']
  });
  const dispatchDecision = buildEcommerceSocksDispatchDecision({
    childSkills: evidence.childSkills,
    executeChildren: params.executeChildren,
    confirmChildDispatch: params.confirmChildDispatch
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
    dispatchDecision,
    dispatchLifecycle,
    dispatchOrchestration
  };
}

async function run() {
  assert(
    typeof buildEcommerceSocksDispatchAuthorization === 'function',
    'dispatch authorization helper should be exported'
  );

  const notRequestedFixture = buildFixture();
  const notRequested = buildEcommerceSocksDispatchAuthorization({
    dispatchDecision: notRequestedFixture.dispatchDecision,
    dispatchOrchestration: notRequestedFixture.dispatchOrchestration
  });
  assert(notRequested.version === 'ecommerce-socks-dispatch-authorization/v0', 'authorization should expose version', notRequested);
  assert(notRequested.status === 'not_requested', 'authorization should stay not_requested when child execution was not requested', notRequested);
  assert(notRequested.requiresExplicitUserApproval === true, 'authorization should require explicit user approval', notRequested);
  assert(notRequested.canExecuteChildren === false, 'authorization must not execute child skills', notRequested);
  assert(notRequested.noPhotoshopWrites === true, 'authorization must not write Photoshop', notRequested);
  assert(notRequested.canClaimDesignComplete === false, 'authorization must not claim design completion', notRequested);

  const requiresApprovalFixture = buildFixture({ executeChildren: true });
  const requiresApproval = buildEcommerceSocksDispatchAuthorization({
    dispatchDecision: requiresApprovalFixture.dispatchDecision,
    dispatchOrchestration: requiresApprovalFixture.dispatchOrchestration
  });
  assert(
    requiresApproval.status === 'requires_user_approval',
    'authorization should require approval when child execution is requested but not confirmed',
    requiresApproval
  );
  assert(
    requiresApproval.blockers.includes('child_dispatch_requires_confirmation'),
    'authorization should preserve confirmation blocker',
    requiresApproval
  );

  const deniedFixture = buildFixture({ executeChildren: true });
  const denied = buildEcommerceSocksDispatchAuthorization({
    dispatchDecision: deniedFixture.dispatchDecision,
    dispatchOrchestration: deniedFixture.dispatchOrchestration,
    userDeniedChildDispatch: true
  });
  assert(denied.status === 'denied', 'authorization should record explicit user denial', denied);
  assert(denied.userDeniedChildDispatch === true, 'authorization should expose denial flag', denied);
  assert(denied.canExecuteChildren === false, 'denial must not execute child skills', denied);

  const approvedFixture = buildFixture({ executeChildren: true, confirmChildDispatch: true });
  const approvedButBlocked = buildEcommerceSocksDispatchAuthorization({
    dispatchDecision: approvedFixture.dispatchDecision,
    dispatchOrchestration: approvedFixture.dispatchOrchestration
  });
  assert(approvedButBlocked.status === 'approved_but_blocked', 'authorization should separate approval from executable dispatch', approvedButBlocked);
  assert(approvedButBlocked.userApprovedChildDispatch === true, 'authorization should expose approval flag', approvedButBlocked);
  assert(
    approvedButBlocked.blockers.includes('child_dispatch_checkpoint_not_implemented'),
    'authorization should keep implementation blocker after approval',
    approvedButBlocked
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
    result.data?.ecommerceSocksDispatchAuthorization?.version === 'ecommerce-socks-dispatch-authorization/v0',
    'executor should expose dispatch authorization evidence',
    result.data
  );
  assert(
    result.data.ecommerceSocksDispatchAuthorization.status === 'approved_but_blocked',
    'executor should expose approved-but-blocked authorization evidence',
    result.data.ecommerceSocksDispatchAuthorization
  );
  assert(
    result.data.ecommerceSocksDesign.dispatchAuthorization === result.data.ecommerceSocksDispatchAuthorization,
    'entry evidence should reference the same authorization evidence',
    result.data
  );
  assert(
    !steps.some((item) => ['main-image-design', 'detail-page-design', 'sku-batch'].includes(item.toolName)),
    'authorization evidence must not emit child skill execution events',
    steps
  );
  assertNoPseudoThinking(result, 'dispatch authorization result');
  assertNoPseudoThinking(steps, 'dispatch authorization steps');

  console.log(JSON.stringify({
    success: true,
    checks: [
      'dispatch authorization helper exports stable approval evidence',
      'authorization separates not-requested, requires-approval, denied and approved-but-blocked states',
      'authorization never executes child skills or writes Photoshop',
      'executor exposes authorization evidence without executing child skills',
      'authorization evidence does not claim design completion or provider thinking'
    ]
  }, null, 2));
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
