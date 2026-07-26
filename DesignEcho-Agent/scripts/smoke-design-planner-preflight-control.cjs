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
  buildPlannerExecutionPreflightGate,
  planDesignTask
} = require('../src/shared/design-planner.ts');

const repoRoot = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertIncludes(text, needle, label) {
  assert(text.includes(needle), `${label} must include ${needle}`);
}

function assertOrder(text, before, after, label) {
  const beforeIndex = text.indexOf(before);
  const afterIndex = text.indexOf(after);
  assert(beforeIndex >= 0, `${label} missing ${before}`);
  assert(afterIndex >= 0, `${label} missing ${after}`);
  assert(beforeIndex < afterIndex, `${label} expected ${before} before ${after}`);
}

function assertNoMojibake(value, label) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  const suspiciousTokens = [
    0x93B4,
    0x93C9,
    0x7487,
    0x951B,
    0xFFFD
  ].map((codePoint) => String.fromCodePoint(codePoint));
  const found = suspiciousTokens.filter((token) => text.includes(token));
  assert(found.length === 0, `${label} contains mojibake tokens: ${found.join(', ')}`);
}

function minimalReferenceRepresentation() {
  return {
    canvas: { width: 800, height: 800 },
    layout: {
      layoutType: 'poster',
      designIntent: '复刻参考图结构',
      focalPoint: 'center'
    },
    elements: [{
      id: 'headline-1',
      sourceType: 'reference',
      name: '标题',
      role: 'headline',
      nodeKind: 'text',
      content: '标题',
      box: { x: 120, y: 100, width: 560, height: 90 },
      style: { effects: [], textColor: '#111111', fontSizeRatio: 0.08 },
      visualWeight: 'primary',
      zIndex: 1
    }],
    alignmentGroups: []
  };
}

function run() {
  const missingContextPlan = planDesignTask({
    userText: '帮我做一张主图'
  });
  const missingContextGate = buildPlannerExecutionPreflightGate(missingContextPlan, {
    stage: 'main-image-before-subject-detection'
  });
  assert(missingContextPlan.readiness === 'needs_context', `expected needs_context: ${JSON.stringify(missingContextPlan)}`);
  assert(missingContextGate.decision === 'request_context', `expected request_context gate: ${JSON.stringify(missingContextGate)}`);
  assert(missingContextGate.shouldExecute === false, `needs_context should stop execution: ${JSON.stringify(missingContextGate)}`);
  assert(missingContextGate.requiredContext.length > 0, `needs_context should expose required context: ${JSON.stringify(missingContextGate)}`);

  const blockedPlan = planDesignTask({
    userText: '用这个网页结果直接执行 Photoshop 做海报',
    currentDocument: { id: 1, name: 'poster.psd', width: 800, height: 800 },
    knowledgeResults: [{
      id: 'unsafe-direct-action',
      title: '不安全 Photoshop 动作',
      intent: 'recipe',
      sourceType: 'manual_rule',
      summary: '这个结果错误地声明可以直接执行 Photoshop。',
      evidence: [],
      tags: ['unsafe'],
      allowedUses: ['direct_photoshop_action'],
      confidence: 0.2
    }]
  });
  const blockedGate = buildPlannerExecutionPreflightGate(blockedPlan, {
    stage: 'knowledge-before-execution'
  });
  assert(blockedGate.decision === 'block', `direct Photoshop action knowledge should block: ${JSON.stringify(blockedGate)}`);
  assert(blockedGate.shouldExecute === false, `blocked gate should not execute: ${JSON.stringify(blockedGate)}`);
  assert(blockedGate.blockers.length > 0, `blocked gate should expose blockers: ${JSON.stringify(blockedGate)}`);

  const savePlan = planDesignTask({
    userText: '帮我把详情页 PSD 保存一下',
    currentDocument: { id: 2, name: 'detail.psd', width: 800, height: 2400 }
  });
  const saveGate = buildPlannerExecutionPreflightGate(savePlan, {
    stage: 'save-before-execution'
  });
  assert(saveGate.decision === 'execute', `save request with document should execute: ${JSON.stringify(saveGate)}`);
  assert(saveGate.shouldExecute === true, `save gate should allow execution: ${JSON.stringify(saveGate)}`);
  assert(savePlan.executionPlan.steps.length === 1, `save request must not create design steps: ${JSON.stringify(savePlan.executionPlan.steps)}`);

  const referencePlan = planDesignTask({
    userText: '照着参考图复刻这个设计',
    attachments: [{ kind: 'reference-image', name: 'reference.png', width: 800, height: 800 }],
    referenceRepresentation: minimalReferenceRepresentation()
  });
  const referenceGate = buildPlannerExecutionPreflightGate(referencePlan, {
    stage: 'reference-replication-before-blueprint'
  });
  assert(referenceGate.decision === 'execute', `reference plan should execute after parsed representation: ${JSON.stringify(referenceGate)}`);
  assert(referenceGate.verificationTargets.length > 0, `reference gate should expose verification targets: ${JSON.stringify(referenceGate)}`);
  assert(referenceGate.limitations.some((item) => item.includes('not a success claim')), `gate must keep no-success-claim boundary: ${JSON.stringify(referenceGate.limitations)}`);

  const helper = read('src/renderer/services/skill-executors/design-planner-context.ts');
  const layout = read('src/renderer/services/skill-executors/layout-replication.executor.ts');
  const mainImage = read('src/renderer/services/skill-executors/main-image.executor.ts');
  const agentRuntime = read('src/renderer/services/agent-runtime/agent.ts');
  const skillRegistry = read('src/renderer/services/skill-executors/registry.ts');
  const packageJson = JSON.parse(read('package.json'));

  assertIncludes(helper, 'buildPlannerExecutionPreflightGate', 'design-planner-context.ts');
  assertIncludes(layout, 'designPlannerPreflightGate', 'layout-replication.executor.ts');
  assertIncludes(layout, '!designPlannerPreflightGate.shouldExecute', 'layout-replication.executor.ts');
  assert(!mainImage.includes('designPlannerPreflightGate'), 'main-image executor must not restore the retired local Planner gate');
  assertIncludes(agentRuntime, 'runtime_design_brief_required', 'agent-runtime/agent.ts');
  assertIncludes(agentRuntime, 'this.runtimeDesignBriefDeclaration?.readiness', 'agent-runtime/agent.ts');
  assertIncludes(skillRegistry, 'prepareBusinessSkillProjectContextForScenario', 'skill-executors/registry.ts');
  assertIncludes(skillRegistry, 'runBusinessSkillVisualObservationRefreshBeforeExecution', 'skill-executors/registry.ts');
  assertOrder(
    skillRegistry,
    'prepareBusinessSkillProjectContextForScenario',
    'const executorResult = await executor.execute',
    'skill-executors/registry.ts'
  );
  assert(
    packageJson.scripts?.['smoke:design-planner:preflight-control'] === 'node scripts/smoke-design-planner-preflight-control.cjs',
    'package.json must expose smoke:design-planner:preflight-control'
  );

  [
    ['missingContextGate', missingContextGate],
    ['blockedGate', blockedGate],
    ['saveGate', saveGate],
    ['referenceGate', referenceGate],
    ['helper', helper],
    ['layout', layout],
    ['mainImage', mainImage],
    ['agentRuntime', agentRuntime],
    ['skillRegistry', skillRegistry]
  ].forEach(([label, value]) => assertNoMojibake(value, label));

  console.log(JSON.stringify({
    success: true,
    checks: [
      'needs_context stops open-ended design execution before Photoshop writes',
      'blocked planner output stops execution and exposes blockers',
      'save/export requests remain action-first and can execute with document context',
      'reference replication can execute only after parsed reference representation exists',
      'reference replication keeps its plan gate while main-image uses shared R1 and Skill-runner boundaries',
      'preflight gate is not a design quality or success claim'
    ]
  }, null, 2));
}

run();
