#!/usr/bin/env node
'use strict';

const assert = require('assert');
const path = require('path');

require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '..', 'tsconfig.main.json')
});

const ROOT = path.resolve(__dirname, '..');
const reference = require(path.join(
  ROOT,
  'src',
  'shared',
  'agent-runtime-v5',
  'runtime-reference-context.ts'
));
const brief = require(path.join(
  ROOT,
  'src',
  'shared',
  'agent-runtime-v5',
  'runtime-design-brief-declaration.ts'
));
const { buildRuntimeStagePlan } = require(path.join(
  ROOT,
  'src',
  'shared',
  'agent-runtime-v5',
  'runtime-stage-plan.ts'
));
const runtimeSession = require(path.join(
  ROOT,
  'src',
  'shared',
  'agent-runtime-v5',
  'runtime-session.ts'
));
const { DETAIL_PAGE_MANIFEST } = require(path.join(
  ROOT,
  'src',
  'shared',
  'agent-runtime-v5',
  'manifests',
  'detail-page.manifest.ts'
));
const {
  classifyAgentToolExecution,
  isAgentHarnessControlTool
} = require(path.join(ROOT, 'src', 'shared', 'agent-tool-execution-preflight.ts'));
const { Agent } = require(path.join(
  ROOT,
  'src',
  'renderer',
  'services',
  'agent-runtime',
  'agent.ts'
));

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

const policy = DETAIL_PAGE_MANIFEST.reference_policy;
const visualRef = 'context:reference_visual:eagle-item-1';
const createNewResolvedInputs = brief.resolveRuntimeDesignBriefInputs({
  inputSources: DETAIL_PAGE_MANIFEST.input_sources,
  availableSources: [
    { sourceKind: 'structured_input', inputKeys: ['product'] },
    { sourceKind: 'attached_image', inputKeys: ['asset_source'] }
  ]
});
const createNewInputRef = (inputKey) => createNewResolvedInputs.find((item) => item.inputKey === inputKey).contextRef;

function referenceContext(overrides = {}) {
  return {
    allowedContextRefs: [visualRef],
    visualObservations: [{
      ref: visualRef,
      summary: '参考图主体靠视觉中心偏上，底部保留稳定承托空间。',
      aspects: [{
        aspect: 'composition',
        observation: '主体靠视觉中心偏上，底部保留稳定承托空间。'
      }]
    }],
    searchAttemptCount: 1,
    searchFailureCount: 0,
    visualAnalysisFailureCount: 0,
    ...overrides
  };
}

function readyDeclaration() {
  return {
    decision: 'search_new',
    readiness: 'ready',
    sources: [{ kind: 'eagle', sourceRefs: [visualRef] }],
    insights: [{
      aspect: 'composition',
      application: '详情页首屏延续上紧下稳的视觉重心，但不复制具体版式。',
      observationRefs: [visualRef]
    }],
    limitations: []
  };
}

console.log('smoke: runtime-reference-context');

check('detail-page manifest owns a bounded, work-mode-aware reference policy', () => {
  assert.ok(policy);
  assert.equal(policy.work_mode_requirements.create_new, 'required');
  assert.equal(policy.work_mode_requirements.redesign, 'required');
  assert.equal(policy.work_mode_requirements.template_fill, 'reuse_or_optional');
  assert.equal(policy.work_mode_requirements.export_only, 'not_required');
  assert.equal(policy.max_search_rounds, 2);
  assert.equal(policy.unavailable_behavior, 'continue_degraded');
  assert.deepStrictEqual(reference.validateSkillRuntimeReferencePolicy(policy), []);
});

check('R1 requires explicit workMode when the selected Skill has a reference policy', () => {
  const base = {
    taskGoal: '完成详情页设计',
    deliverables: ['detail_page_psd'],
    outputRequirements: [],
    constraints: [],
    inputCoverage: [
      { inputKey: 'product', status: 'provided', contextRefs: [createNewInputRef('product')] },
      { inputKey: 'asset_source', status: 'provided', contextRefs: [createNewInputRef('asset_source')] }
    ],
    contextRefs: ['context:user_goal', ...createNewResolvedInputs.map((item) => item.contextRef)]
  };
  const missing = brief.validateRuntimeDesignBriefDeclaration({
    value: base,
    requiredInputKeys: ['product', 'asset_source'],
    optionalInputKeys: [],
    allowedContextRefs: ['context:user_goal'],
    inputSources: DETAIL_PAGE_MANIFEST.input_sources,
    resolvedInputs: createNewResolvedInputs,
    workModeRequired: true
  });
  assert.equal(missing.ok, false);
  assert.ok(missing.issues.some((issue) => issue.code === 'work_mode_required'));
  const declared = brief.validateRuntimeDesignBriefDeclaration({
    value: { ...base, workMode: 'create_new' },
    requiredInputKeys: ['product', 'asset_source'],
    optionalInputKeys: [],
    allowedContextRefs: ['context:user_goal'],
    inputSources: DETAIL_PAGE_MANIFEST.input_sources,
    resolvedInputs: createNewResolvedInputs,
    workModeRequired: true
  });
  assert.equal(declared.ok, true, JSON.stringify(declared.issues));
  assert.equal(declared.declaration.payload.workMode, 'create_new');
});

check('candidate search metadata alone cannot become a resolved visual reference context', () => {
  const candidateRef = 'context:reference_candidates:1';
  const result = reference.validateRuntimeReferenceBriefDeclaration({
    value: {
      ...readyDeclaration(),
      sources: [{ kind: 'eagle', sourceRefs: [candidateRef] }],
      insights: [{
        ...readyDeclaration().insights[0],
        observationRefs: [candidateRef]
      }]
    },
    policy,
    workMode: 'create_new',
    context: referenceContext({
      allowedContextRefs: [candidateRef],
      visualObservations: []
    })
  });
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => issue.code === 'reference_visual_observation_required'));
});

check('a visually analyzed Eagle reference can resolve create_new reference context', () => {
  const result = reference.validateRuntimeReferenceBriefDeclaration({
    value: readyDeclaration(),
    policy,
    workMode: 'create_new',
    context: referenceContext()
  });
  assert.equal(result.ok, true, JSON.stringify(result.issues));
  assert.equal(result.declaration.readiness, 'ready');
  assert.equal(result.declaration.requirement, 'required');
  assert.equal(reference.hasRuntimeReferenceVisualObservation(result.declaration), true);
  assert.equal(
    result.declaration.insights[0].observation,
    '主体靠视觉中心偏上，底部保留稳定承托空间。'
  );
});

check('model-authored observation text cannot replace visual tool output', () => {
  const value = readyDeclaration();
  value.insights[0].observation = '模型自行声称的画面事实';
  const result = reference.validateRuntimeReferenceBriefDeclaration({
    value,
    policy,
    workMode: 'create_new',
    context: referenceContext()
  });
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => issue.code === 'unknown_field' && issue.path.endsWith('.observation')));
});

check('template/edit can explicitly waive optional retrieval without pretending visual insight', () => {
  const result = reference.validateRuntimeReferenceBriefDeclaration({
    value: {
      decision: 'skip_not_needed',
      readiness: 'waived',
      sources: [],
      insights: [],
      limitations: ['当前任务沿用用户模板结构，不额外检索参考。']
    },
    policy,
    workMode: 'template_fill',
    context: referenceContext({
      allowedContextRefs: [],
      visualObservations: [],
      searchAttemptCount: 0
    })
  });
  assert.equal(result.ok, true, JSON.stringify(result.issues));
  assert.equal(result.declaration.readiness, 'waived');
  assert.equal(reference.isRuntimeReferenceContextResolved(result.declaration), true);
  assert.equal(reference.hasRuntimeReferenceVisualObservation(result.declaration), false);
});

check('analyze/export modes can skip references deterministically', () => {
  const result = reference.validateRuntimeReferenceBriefDeclaration({
    value: {
      decision: 'skip_not_needed',
      readiness: 'waived',
      sources: [],
      insights: [],
      limitations: []
    },
    policy,
    workMode: 'export_only',
    context: referenceContext({
      allowedContextRefs: [],
      visualObservations: [],
      searchAttemptCount: 0
    })
  });
  assert.equal(result.ok, true, JSON.stringify(result.issues));
  assert.equal(result.declaration.requirement, 'not_required');
});

check('required reference context degrades only after the bounded search budget and a real failure', () => {
  const value = {
    decision: 'search_new',
    readiness: 'degraded',
    sources: [],
    insights: [],
    limitations: ['Eagle 两轮检索均无可用候选，本轮仅依据项目上下文继续并标记复核风险。']
  };
  const tooEarly = reference.validateRuntimeReferenceBriefDeclaration({
    value,
    policy,
    workMode: 'create_new',
    context: referenceContext({
      allowedContextRefs: [],
      visualObservations: [],
      searchAttemptCount: 1,
      searchFailureCount: 1
    })
  });
  assert.equal(tooEarly.ok, false);
  assert.ok(tooEarly.issues.some((issue) => issue.code === 'reference_search_budget_not_exhausted'));
  const bounded = reference.validateRuntimeReferenceBriefDeclaration({
    value,
    policy,
    workMode: 'create_new',
    context: referenceContext({
      allowedContextRefs: [],
      visualObservations: [],
      searchAttemptCount: 2,
      searchFailureCount: 2
    })
  });
  assert.equal(bounded.ok, true, JSON.stringify(bounded.issues));
  assert.equal(bounded.declaration.readiness, 'degraded');
  assert.equal(reference.isRuntimeReferenceContextResolved(bounded.declaration), true);
  assert.equal(reference.hasRuntimeReferenceVisualObservation(bounded.declaration), false);
});

check('stage plan and tool semantics expose R2 reference context without granting write authority', () => {
  const plan = buildRuntimeStagePlan(DETAIL_PAGE_MANIFEST);
  const r2 = plan.steps.find((step) => step.stage === 'R2');
  assert.ok(r2.requiredOutcomes.includes('reference_context_resolved'));
  assert.ok(plan.referencePolicy);
  assert.ok(DETAIL_PAGE_MANIFEST.available_tools.includes('eagle.read.analyzeReference'));
  assert.equal(classifyAgentToolExecution('analyzeEagleReference'), 'read_only_observation');
  assert.equal(classifyAgentToolExecution('searchEagleReferences'), 'knowledge_search');
  assert.equal(isAgentHarnessControlTool('declareReferenceBrief'), true);
});

async function checkAgentRuntimeWiring() {
  const plan = buildRuntimeStagePlan(DETAIL_PAGE_MANIFEST);
  const externalCalls = [];
  const agent = new Agent(
    {
      systemPrompt: 'reference context smoke',
      tools: [
        { name: 'searchEagleReferences', description: 'search', inputSchema: { type: 'object', properties: {} } },
        { name: 'analyzeEagleReference', description: 'analyze', inputSchema: { type: 'object', properties: {} } }
      ],
      modelId: 'test-model',
      maxIterations: 3,
      runtimeStagePlan: plan,
      runtimeDesignBriefAvailableInputSources: [
        { sourceKind: 'structured_input', inputKeys: ['product'] },
        { sourceKind: 'attached_image', inputKeys: ['asset_source'] }
      ],
      callbacks: {}
    },
    async () => ({ content: 'unused', toolCalls: [] }),
    async (toolName) => {
      externalCalls.push(toolName);
      return { success: true };
    }
  );
  agent.runtimeSession = runtimeSession.createRuntimeSession({
    identity: runtimeSession.createRuntimeSessionIdentity({
      now: '2026-07-14T03:00:00.000Z',
      nonce: 'reference-context-smoke',
      skillId: plan.skillId,
      taskType: plan.taskType
    }),
    plan
  });
  const briefCall = { id: 'brief', name: 'declareDesignBrief', arguments: {
    workMode: 'create_new',
    taskGoal: '完成可编辑、可复核的详情页设计。',
    deliverables: ['detail_page_psd'],
    outputRequirements: [],
    constraints: [],
    inputCoverage: [
      { inputKey: 'product', status: 'provided', contextRefs: [createNewInputRef('product')] },
      { inputKey: 'asset_source', status: 'provided', contextRefs: [createNewInputRef('asset_source')] }
    ],
    contextRefs: ['context:user_goal', 'context:skill_manifest', ...createNewResolvedInputs.map((item) => item.contextRef)]
  } };
  const briefResult = await agent.executeToolWithFailureBreaker(briefCall.name, briefCall.arguments);
  assert.equal(briefResult.success, true, JSON.stringify(briefResult));
  agent.recordToolResultStageTrace(briefCall, briefResult);
  let visible = await agent.buildModelVisibleToolsForIteration();
  assert(visible.some((tool) => tool.name === 'declareReferenceBrief'));
  assert(!visible.some((tool) => tool.name === 'declareDesignStrategy'));

  agent.toolCallLog.push({
    name: 'analyzeEagleReference',
    arguments: { itemId: 'malformed-item' },
    result: { success: true, item: { id: 'malformed-item' } }
  });
  const malformedContext = agent.buildReferenceContextState();
  assert.equal(malformedContext.visualObservations.length, 0);
  assert.equal(malformedContext.visualAnalysisFailureCount, 1);
  agent.toolCallLog.pop();

  agent.toolCallLog.push({
    name: 'searchEagleReferences',
    arguments: { query: '详情页 排版' },
    result: { success: true, resultCount: 1 }
  });
  agent.toolCallLog.push({
    name: 'analyzeEagleReference',
    arguments: { itemId: 'eagle-item-1' },
    result: {
      success: true,
      item: { id: 'eagle-item-1' },
      observation: {
        summary: '视觉分析',
        strengths: [{
          aspect: 'composition',
          observation: '主体靠视觉中心偏上，底部保留稳定承托空间。'
        }]
      }
    }
  });
  agent.recordToolResultStageTrace(
    { id: 'reference-visual', name: 'analyzeEagleReference', arguments: { itemId: 'eagle-item-1' } },
    {
      success: true,
      item: { id: 'eagle-item-1' },
      observation: {
        summary: '视觉分析',
        strengths: [{
          aspect: 'composition',
          observation: '主体靠视觉中心偏上，底部保留稳定承托空间。'
        }]
      }
    }
  );
  agent.toolCallLog.push({
    name: 'searchEagleReferences',
    arguments: { query: '详情页 信息层级' },
    result: { success: true, resultCount: 1 }
  });
  const referenceCall = {
    id: 'reference',
    name: 'declareReferenceBrief',
    arguments: readyDeclaration()
  };
  const referenceResult = await agent.executeToolWithFailureBreaker(
    referenceCall.name,
    referenceCall.arguments
  );
  assert.equal(referenceResult.success, true, JSON.stringify(referenceResult));
  agent.recordToolResultStageTrace(referenceCall, referenceResult);
  visible = await agent.buildModelVisibleToolsForIteration();
  assert(visible.some((tool) => tool.name === 'declareDesignStrategy'));

  const blockedSearch = await agent.executeToolWithFailureBreaker('searchEagleReferences', { query: '第三轮' });
  assert.equal(blockedSearch.blockedByRuntimeReferenceSearchBudget, true);
  assert.deepStrictEqual(externalCalls, []);
  passed += 1;
  console.log('  ✓ Agent runtime hides R3 until R2 reference context resolves and enforces the search budget');
}

checkAgentRuntimeWiring()
  .then(() => console.log(`\n${passed} checks passed.`))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
