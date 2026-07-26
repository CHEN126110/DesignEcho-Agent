'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '..', 'tsconfig.main.json')
});

const root = path.resolve(__dirname, '..');
const { createRuntimeSessionIdentityForPlan } = require('./runtime-session-smoke-fixture.cjs');
const {
  CURRENT_R3_STRATEGY_REF,
  DECLARE_RUNTIME_ACTION_PLAN_TOOL_NAME,
  buildDeclareRuntimeActionPlanToolSchema,
  buildRuntimeActionPlanCapabilityContext,
  buildRuntimeActionPlanDigest,
  validateRuntimeActionPlanDeclaration
} = require(path.join(root, 'src', 'shared', 'agent-runtime-v5', 'runtime-action-plan-declaration.ts'));
const {
  DECLARE_DESIGN_BRIEF_TOOL_NAME
} = require(path.join(root, 'src', 'shared', 'agent-runtime-v5', 'runtime-design-brief-declaration.ts'));
const {
  DECLARE_DESIGN_STRATEGY_TOOL_NAME,
  buildRuntimeDesignStrategyDigest,
  validateRuntimeDesignStrategyDeclaration
} = require(path.join(root, 'src', 'shared', 'agent-runtime-v5', 'runtime-design-strategy-declaration.ts'));
const { buildRuntimeStagePlan } = require(path.join(root, 'src', 'shared', 'agent-runtime-v5', 'runtime-stage-plan.ts'));
const { GENERAL_DESIGN_MANIFEST } = require(path.join(root, 'src', 'shared', 'agent-runtime-v5', 'manifests', 'general-design.manifest.ts'));
const {
  createAgentCapabilitySession,
  REQUEST_AGENT_CAPABILITIES_TOOL_NAME
} = require(path.join(root, 'src', 'renderer', 'services', 'agent-runtime', 'capability-session.ts'));
const { Agent } = require(path.join(root, 'src', 'renderer', 'services', 'agent-runtime', 'agent.ts'));
const {
  buildAgentIntentControlPlaneDecision
} = require(path.join(root, 'src', 'shared', 'agent-intent-control-plane.ts'));

const stagePlan = buildRuntimeStagePlan(GENERAL_DESIGN_MANIFEST);
const allowedContextRefs = [
  'context:user_goal',
  'context:skill_manifest',
  'context:opening_observation',
  'context:readback',
  'context:design_strategy'
];
const readyCapabilityContext = {
  discoveredCapabilityRefs: [
    'design.general',
    'photoshop.read.getDocumentSummary',
    'photoshop.read.inspectLayers',
    'photoshop.write.setLayerOpacity',
    'design-quality-verdict/v0',
    'tool-safety-policy/v0'
  ],
  activeActionCapabilityRefs: [
    'photoshop.read.getDocumentSummary',
    'photoshop.read.inspectLayers',
    'photoshop.write.setLayerOpacity'
  ],
  onDemandActionCapabilityRefs: []
};

function validBrief() {
  return {
    taskGoal: '基于当前文档形成可编辑、可复核的视觉设计。',
    deliverables: ['可编辑设计文档', '预览'],
    targetAudience: '需要快速理解核心信息的目标用户。',
    outputRequirements: ['写入后必须读取结构或视觉结果'],
    constraints: ['不编造事实', '不以工具成功替代质量通过'],
    inputCoverage: [{
      inputKey: 'goal',
      status: 'provided',
      contextRefs: ['input:goal:user_goal']
    }],
    contextRefs: ['context:user_goal', 'context:skill_manifest', 'input:goal:user_goal']
  };
}

function validStrategy(overrides = {}) {
  return {
    stageGoal: '建立单一视觉焦点，并按阅读优先级组织辅助信息。',
    objective: {
      primaryGoal: '让用户先理解核心信息，再理解支撑理由。',
      secondaryGoals: ['保持真实素材质感'],
      targetAudienceSummary: '需要快速理解画面主题的目标用户。'
    },
    messageArchitecture: {
      primaryMessage: '核心价值先被看到，辅助信息随后解释。',
      supportingMessages: ['辅助内容不争夺第一层级。'],
      supportingFacts: ['当前文档结构已读取。'],
      objectionsToResolve: ['信息层级是否清晰']
    },
    copyDirection: {
      toneKeywords: ['清晰', '克制'],
      headlineOptions: ['聚焦核心价值'],
      subtitleOptions: [],
      tagOptions: [],
      prohibitedClaims: ['未经事实支持的承诺']
    },
    visualDirection: {
      moodKeywords: ['简洁', '可信'],
      paletteIntent: ['中性色承载主体，强调色只服务焦点。'],
      typographyIntent: ['标题和说明形成清晰层级。'],
      compositionIntent: ['主体承担主要视觉重量。'],
      imageTreatment: ['保留真实纹理。'],
      density: 'medium'
    },
    constraints: ['不改变素材表达的事实。'],
    contextRefs: ['context:user_goal', 'context:readback'],
    assumptions: [],
    missingInputs: [],
    ...overrides
  };
}

function strategyDigest() {
  const result = validateRuntimeDesignStrategyDeclaration({
    value: validStrategy(),
    allowedContextRefs
  });
  assert.strictEqual(result.ok, true, JSON.stringify(result.issues));
  return buildRuntimeDesignStrategyDigest(result.declaration);
}

function validPlan(overrides = {}) {
  return {
    planGoal: '先形成可执行的语义版面，再实施最小改动并完成读回复核。',
    strategyRef: CURRENT_R3_STRATEGY_REF,
    contextRefs: ['context:user_goal', 'context:readback', 'context:design_strategy'],
    steps: [
      {
        stepId: 'compose-layout',
        kind: 'compose_dsl',
        goal: '把策略转成归一化区域、阅读顺序和元素关系。',
        dependsOn: [],
        capabilityRefs: ['design.general'],
        inputContextRefs: ['context:design_strategy', 'context:readback'],
        expectedOutcomes: ['design_dsl'],
        completionCriteria: ['区域角色、层级和阅读顺序完整且无越界。'],
        failurePolicy: 'replan'
      },
      {
        stepId: 'apply-change',
        kind: 'mutate',
        goal: '依据语义版面实施当前最小必要画面调整。',
        dependsOn: ['compose-layout'],
        capabilityRefs: ['photoshop.write.setLayerOpacity'],
        inputContextRefs: ['context:design_strategy', 'context:readback'],
        expectedOutcomes: ['document_change'],
        completionCriteria: ['目标画面发生预期变化且未破坏既有信息层级。'],
        failurePolicy: 'retry_after_observation'
      },
      {
        stepId: 'verify-change',
        kind: 'verify',
        goal: '读取更新后的结构与视觉状态并进入质量评价。',
        dependsOn: ['apply-change'],
        capabilityRefs: ['photoshop.read.inspectLayers', 'design-quality-verdict/v0'],
        inputContextRefs: ['context:design_strategy'],
        expectedOutcomes: ['readback', 'quality_report'],
        completionCriteria: ['完成读回，质量问题被结构化记录。'],
        failurePolicy: 'enter_reflexion'
      }
    ],
    designDsl: {
      compositionIntent: '主视觉承担主要重量，标题在上层建立第一阅读入口。',
      regions: [
        {
          regionId: 'primary-visual',
          role: 'primary_visual',
          bounds: { x: 0, y: 0, width: 1, height: 1 },
          zIndex: 0,
          alignment: { horizontal: 'center', vertical: 'center' },
          overflow: 'clip'
        },
        {
          regionId: 'headline',
          role: 'headline',
          bounds: { x: 0.1, y: 0.06, width: 0.8, height: 0.16 },
          zIndex: 2,
          alignment: { horizontal: 'start', vertical: 'center' },
          overflow: 'visible'
        }
      ],
      elements: [
        {
          elementId: 'focus-badge',
          role: 'badge',
          elementType: 'badge',
          regionId: 'headline',
          source: { kind: 'token', refId: 'brand-accent' },
          styleTokenRefs: ['color.brand.accent'],
          required: false
        }
      ],
      readingOrder: ['headline', 'primary-visual'],
      constraints: ['重叠只用于建立层级，不遮挡核心信息。']
    },
    missingInputs: [],
    ...overrides
  };
}

const digest = strategyDigest();
const ready = validateRuntimeActionPlanDeclaration({
  value: validPlan(),
  strategyDigest: digest,
  allowedContextRefs,
  capabilityContext: readyCapabilityContext,
  forbiddenToolNames: ['getDocumentInfo', 'setLayerOpacity', 'getLayerHierarchy']
});
assert.strictEqual(ready.ok, true, JSON.stringify(ready.issues));
assert.strictEqual(ready.readiness, 'ready');
assert.strictEqual(ready.declaration.version, 'runtime-action-plan-declaration/v0');
assert.strictEqual(ready.declaration.graph.acyclic, true);
assert.deepStrictEqual(ready.declaration.graph.rootStepIds, ['compose-layout']);
assert.deepStrictEqual(ready.declaration.graph.terminalStepIds, ['verify-change']);
assert.strictEqual(ready.declaration.boundaries.shadowOnly, true);
assert.strictEqual(ready.declaration.boundaries.executable, false);
assert.strictEqual(ready.declaration.boundaries.schedulerAuthority, false);
assert.strictEqual(ready.declaration.boundaries.autoActivatesCapabilities, false);
assert.strictEqual(ready.declaration.boundaries.countsAsTaskProgress, false);
assert.strictEqual(ready.declaration.boundaries.countsAsQualityPass, false);
assert.strictEqual(ready.declaration.payload.designDsl.regions[0].bounds.width, 1);
assert(!Object.prototype.hasOwnProperty.call(ready.declaration.payload.steps[0], 'operation'));
assert(!Object.prototype.hasOwnProperty.call(ready.declaration.payload.steps[0], 'params'));

const actionDigest = buildRuntimeActionPlanDigest({
  declaration: ready.declaration,
  strategyDigest: digest
});
assert.strictEqual(actionDigest.version, 'runtime-action-plan-digest/v0');
assert.strictEqual(actionDigest.stepCount, 3);
assert.strictEqual(actionDigest.designDsl.regionCount, 2);
assert.strictEqual(actionDigest.boundaries.digestOnly, true);
assert.strictEqual(actionDigest.boundaries.executable, false);

const needsCapability = validateRuntimeActionPlanDeclaration({
  value: validPlan(),
  strategyDigest: digest,
  allowedContextRefs,
  capabilityContext: {
    ...readyCapabilityContext,
    activeActionCapabilityRefs: ['photoshop.read.getDocumentSummary', 'photoshop.read.inspectLayers'],
    onDemandActionCapabilityRefs: ['photoshop.write.setLayerOpacity']
  },
  forbiddenToolNames: ['setLayerOpacity']
});
assert.strictEqual(needsCapability.ok, true, JSON.stringify(needsCapability.issues));
assert.strictEqual(needsCapability.readiness, 'needs_capability');
assert.deepStrictEqual(needsCapability.declaration.missingCapabilityRefs, ['photoshop.write.setLayerOpacity']);
assert.strictEqual(needsCapability.declaration.boundaries.autoActivatesCapabilities, false);

const needsInput = validateRuntimeActionPlanDeclaration({
  value: validPlan({
    missingInputs: [{
      inputId: 'brand-rule',
      field: 'brandRules',
      question: '是否有必须遵守的品牌规则？',
      severity: 'blocking'
    }]
  }),
  strategyDigest: digest,
  allowedContextRefs,
  capabilityContext: readyCapabilityContext
});
assert.strictEqual(needsInput.ok, true);
assert.strictEqual(needsInput.readiness, 'needs_input');

const noStrategy = validateRuntimeActionPlanDeclaration({
  value: validPlan(),
  allowedContextRefs,
  capabilityContext: readyCapabilityContext
});
assert.strictEqual(noStrategy.ok, false);
assert(noStrategy.issues.some((issue) => issue.code === 'strategy_not_ready'));

const fakeContext = validateRuntimeActionPlanDeclaration({
  value: validPlan({ contextRefs: ['context:design_strategy', 'context:invented'] }),
  strategyDigest: digest,
  allowedContextRefs,
  capabilityContext: readyCapabilityContext
});
assert.strictEqual(fakeContext.ok, false);
assert(fakeContext.issues.some((issue) => issue.code === 'context_ref_not_available'));

const fakeCapabilityPlan = validPlan();
fakeCapabilityPlan.steps[1].capabilityRefs = ['photoshop.write.not-real'];
const fakeCapability = validateRuntimeActionPlanDeclaration({
  value: fakeCapabilityPlan,
  strategyDigest: digest,
  allowedContextRefs,
  capabilityContext: readyCapabilityContext
});
assert.strictEqual(fakeCapability.ok, false);
assert(fakeCapability.issues.some((issue) => issue.code === 'capability_ref_not_discovered'));

const cyclePlan = validPlan();
cyclePlan.steps[0].dependsOn = ['verify-change'];
const cycle = validateRuntimeActionPlanDeclaration({
  value: cyclePlan,
  strategyDigest: digest,
  allowedContextRefs,
  capabilityContext: readyCapabilityContext
});
assert.strictEqual(cycle.ok, false);
assert(cycle.issues.some((issue) => issue.code === 'dependency_cycle'));

const missingDependencyPlan = validPlan();
missingDependencyPlan.steps[1].dependsOn = ['missing-step'];
const missingDependency = validateRuntimeActionPlanDeclaration({
  value: missingDependencyPlan,
  strategyDigest: digest,
  allowedContextRefs,
  capabilityContext: readyCapabilityContext
});
assert.strictEqual(missingDependency.ok, false);
assert(missingDependency.issues.some((issue) => issue.code === 'step_dependency_not_found'));

const implementationPlan = validPlan();
implementationPlan.steps[1].operation = 'setLayerOpacity';
implementationPlan.steps[1].params = { opacity: 80 };
implementationPlan.steps[1].goal = '调用 setLayerOpacity 并执行 Photoshop 命令。';
const implementationLeak = validateRuntimeActionPlanDeclaration({
  value: implementationPlan,
  strategyDigest: digest,
  allowedContextRefs,
  capabilityContext: readyCapabilityContext,
  forbiddenToolNames: ['setLayerOpacity']
});
assert.strictEqual(implementationLeak.ok, false);
assert(implementationLeak.issues.some((issue) => issue.code === 'unknown_field'));
assert(implementationLeak.issues.some((issue) => issue.code === 'implementation_detail_forbidden'));

const sensitivePlan = validPlan({ planGoal: '读取 C:\\private\\plan.json 后继续。' });
const sensitive = validateRuntimeActionPlanDeclaration({
  value: sensitivePlan,
  strategyDigest: digest,
  allowedContextRefs,
  capabilityContext: readyCapabilityContext
});
assert.strictEqual(sensitive.ok, false);
assert(sensitive.issues.some((issue) => issue.code === 'sensitive_payload_forbidden'));

const pixelPlan = validPlan();
pixelPlan.designDsl.regions[0].bounds.width = 750;
const pixelCoordinates = validateRuntimeActionPlanDeclaration({
  value: pixelPlan,
  strategyDigest: digest,
  allowedContextRefs,
  capabilityContext: readyCapabilityContext
});
assert.strictEqual(pixelCoordinates.ok, false);
assert(pixelCoordinates.issues.some((issue) => (
  issue.code === 'number_out_of_range' || issue.code === 'coordinate_not_normalized'
)));

const brokenElementPlan = validPlan();
brokenElementPlan.designDsl.elements[0].regionId = 'missing-region';
const brokenElement = validateRuntimeActionPlanDeclaration({
  value: brokenElementPlan,
  strategyDigest: digest,
  allowedContextRefs,
  capabilityContext: readyCapabilityContext
});
assert.strictEqual(brokenElement.ok, false);
assert(brokenElement.issues.some((issue) => issue.code === 'element_region_not_found'));

const schema = buildDeclareRuntimeActionPlanToolSchema({
  allowedContextRefs,
  discoveredCapabilityRefs: readyCapabilityContext.discoveredCapabilityRefs
});
assert.strictEqual(schema.name, DECLARE_RUNTIME_ACTION_PLAN_TOOL_NAME);
assert.strictEqual(schema.inputSchema.additionalProperties, false);
assert.strictEqual(schema.inputSchema.properties.steps.items.additionalProperties, false);
assert.deepStrictEqual(
  schema.inputSchema.properties.steps.items.properties.capabilityRefs.items.enum,
  readyCapabilityContext.discoveredCapabilityRefs
);
assert.strictEqual(schema.inputSchema.properties.designDsl.properties.regions.items.additionalProperties, false);
assert.strictEqual(schema.inputSchema.properties.designDsl.properties.elements.items.additionalProperties, false);

const source = fs.readFileSync(
  path.join(root, 'src', 'shared', 'agent-runtime-v5', 'runtime-action-plan-declaration.ts'),
  'utf8'
);
assert(source.includes("import type { ElementPlan, LayoutRegion, MissingInput }"));
assert(!/detailPage|mainImage|sku/i.test(source));
assert(!source.includes('executeTool('));
assert(!source.includes('taskText'));

async function runAgentIntegration() {
  const task = '请先基于当前文档形成策略和动态行动计划，再把目标图层不透明度调整为 80% 并复核';
  const candidateTools = [
    {
      name: 'getDocumentInfo',
      description: 'Read document information.',
      inputSchema: { type: 'object', properties: {} }
    },
    {
      name: 'getLayerHierarchy',
      description: 'Read layer hierarchy.',
      inputSchema: { type: 'object', properties: {} }
    },
    {
      name: 'setLayerOpacity',
      description: 'Change opacity.',
      inputSchema: { type: 'object', properties: { opacity: { type: 'number' } }, required: ['opacity'] }
    }
  ];
  const capabilitySession = createAgentCapabilitySession({
    candidateTools,
    requestedTaskType: GENERAL_DESIGN_MANIFEST.task_type,
    manifest: GENERAL_DESIGN_MANIFEST
  });
  const initialContext = buildRuntimeActionPlanCapabilityContext(capabilitySession.getResolution());
  assert(initialContext.onDemandActionCapabilityRefs.includes('photoshop.write.setLayerOpacity'));

  let modelCallCount = 0;
  const externalToolCalls = [];
  const capabilityControlCalls = [];
  const agent = new Agent(
    {
      systemPrompt: 'R4 action plan declaration integration smoke.',
      tools: capabilitySession.activeTools,
      modelId: 'test-model',
      maxIterations: 9,
      runtimeStagePlan: stagePlan,
      runtimeSessionIdentity: createRuntimeSessionIdentityForPlan(stagePlan, 'action-plan'),
      getCapabilityResolution: () => capabilitySession.getResolution(),
      getOnDemandActivatedCapabilityIds: () => capabilitySession.getOnDemandActivatedCapabilityIds(),
      toolDecisionContext: {
        intentControlPlane: buildAgentIntentControlPlaneDecision({ userInput: task }),
        photoshopConnected: true,
        hasDocument: true
      },
      callbacks: {}
    },
    async (_modelId, _messages, tools) => {
      modelCallCount += 1;
      const briefTool = tools.find((tool) => tool.name === DECLARE_DESIGN_BRIEF_TOOL_NAME);
      const strategyTool = tools.find((tool) => tool.name === DECLARE_DESIGN_STRATEGY_TOOL_NAME);
      const actionPlanTool = tools.find((tool) => tool.name === DECLARE_RUNTIME_ACTION_PLAN_TOOL_NAME);
      if (modelCallCount === 1) {
        assert(briefTool, 'R1 Brief control must be visible initially');
        assert(!strategyTool, 'R3 control must wait for a ready R1 Brief');
        assert(!actionPlanTool, 'R4 control must wait for a ready R3 declaration');
        return {
          content: '先读取当前文档事实。',
          toolCalls: [{ id: 'read-doc', name: 'getDocumentInfo', arguments: {} }]
        };
      }
      if (modelCallCount === 2) {
        assert(briefTool, 'R1 Brief control must remain visible after readonly observation');
        assert(!strategyTool, 'ordinary read Tool call must not unlock R3 before Brief');
        assert(!actionPlanTool, 'ordinary read Tool call must not unlock R4 before R3');
        return {
          content: '基于用户目标和真实读回声明设计简报。',
          toolCalls: [{ id: 'declare-brief', name: DECLARE_DESIGN_BRIEF_TOOL_NAME, arguments: validBrief() }]
        };
      }
      if (modelCallCount === 3) {
        assert(strategyTool, 'ready Brief must expose R3 declaration control');
        assert(!actionPlanTool, 'R4 control must still wait for R3');
        return {
          content: '基于真实读回记录设计策略。',
          toolCalls: [{
            id: 'declare-strategy',
            name: DECLARE_DESIGN_STRATEGY_TOOL_NAME,
            arguments: validStrategy({ contextRefs: ['context:design_brief', 'context:readback'] })
          }]
        };
      }
      if (modelCallCount === 4) {
        assert(actionPlanTool, 'ready R3 must expose R4 declaration control');
        assert(actionPlanTool.inputSchema.properties.steps.items.properties.capabilityRefs.items.enum.includes('photoshop.write.setLayerOpacity'));
        return {
          content: '先记录当前计划，让 Harness 如实报告尚未装载的能力。',
          toolCalls: [{
            id: 'declare-needs-capability-plan',
            name: DECLARE_RUNTIME_ACTION_PLAN_TOOL_NAME,
            arguments: validPlan()
          }]
        };
      }
      if (modelCallCount === 5) {
        const resolution = capabilitySession.getResolution();
        assert(!resolution.selectedCapabilityIds.includes('photoshop.write.setLayerOpacity'));
        assert(!resolution.selectedCapabilityIds.includes('photoshop.read.inspectLayers'));
        assert(resolution.onDemandCapabilityIds.includes('photoshop.write.setLayerOpacity'));
        assert(resolution.onDemandCapabilityIds.includes('photoshop.read.inspectLayers'));
        return {
          content: '计划只报告能力缺口，没有自动装载；现在显式请求执行与读回的最小集合。',
          toolCalls: [{
            id: 'load-opacity-capability',
            name: REQUEST_AGENT_CAPABILITIES_TOOL_NAME,
            arguments: {
              capabilityIds: [
                'photoshop.write.setLayerOpacity',
                'photoshop.read.inspectLayers'
              ]
            }
          }]
        };
      }
      if (modelCallCount === 6) {
        const resolution = capabilitySession.getResolution();
        assert(resolution.selectedCapabilityIds.includes('photoshop.write.setLayerOpacity'));
        assert(resolution.selectedCapabilityIds.includes('photoshop.read.inspectLayers'));
        return {
          content: '能力已装载，现在记录不执行的动态行动计划。',
          toolCalls: [{
            id: 'declare-action-plan',
            name: DECLARE_RUNTIME_ACTION_PLAN_TOOL_NAME,
            arguments: validPlan()
          }]
        };
      }
      return { content: '计划已记录，但尚未执行画面调整或质量交付。', toolCalls: [] };
    },
    async (toolName, args) => {
      if (toolName === REQUEST_AGENT_CAPABILITIES_TOOL_NAME) {
        capabilityControlCalls.push(toolName);
        const activation = capabilitySession.requestCapabilities(args.capabilityIds || []);
        return {
          success: activation.status !== 'rejected',
          data: {
            ...activation,
            changesModelVisibleSchemasOnly: true,
            executesPhotoshop: false,
            grantsPermission: false,
            countsAsObservation: false,
            countsAsTaskProgress: false
          }
        };
      }
      externalToolCalls.push(toolName);
      if (toolName === 'getAnnotatedSnapshot') {
        return { success: true, elements: [{ id: 7, name: '目标图层' }] };
      }
      if (toolName === 'getDocumentInfo') return { success: true, documentId: 1 };
      throw new Error(`Unexpected external Tool: ${toolName}`);
    }
  );
  const result = await agent.run(task);
  assert.deepStrictEqual(externalToolCalls, ['getAnnotatedSnapshot', 'getDocumentInfo']);
  assert.deepStrictEqual(capabilityControlCalls, [REQUEST_AGENT_CAPABILITIES_TOOL_NAME]);
  assert(result.toolCallLog.some((entry) => entry.name === DECLARE_RUNTIME_ACTION_PLAN_TOOL_NAME));
  assert.strictEqual(result.executionSummary.successfulToolCalls, 1);
  // 泄漏守护：控制工具的工具结果只能携带 digest，不得携带完整声明——
  // 工具结果会经 thinkingSteps[].toolResult 进入对话长期档案（对抗核验 2026-07-10）。
  for (const entry of result.toolCallLog) {
    if (entry.name !== DECLARE_RUNTIME_ACTION_PLAN_TOOL_NAME
      && entry.name !== DECLARE_DESIGN_BRIEF_TOOL_NAME
      && entry.name !== DECLARE_DESIGN_STRATEGY_TOOL_NAME) continue;
    const raw = JSON.stringify(entry.result || {});
    assert(!raw.includes('"payload"'), 'declaration payload must not leak into tool result');
    assert(!raw.includes('"dependsOn"'), 'plan steps must not leak into tool result');
    assert(!raw.includes('"messageArchitecture"'), 'full strategy must not leak into tool result');
    assert(!raw.includes('"inputCoverage"'), 'full Brief input coverage must not leak into tool result');
    if (entry.name === DECLARE_RUNTIME_ACTION_PLAN_TOOL_NAME && entry.result?.success !== false) {
      assert(entry.result.actionPlanDigest, 'successful plan declaration must return a digest');
      assert.strictEqual(entry.result.actionPlanDigest.boundaries.digestOnly, true);
    }
    if (entry.name === DECLARE_DESIGN_STRATEGY_TOOL_NAME && entry.result?.success !== false) {
      assert(entry.result.strategyDigest, 'successful strategy declaration must return a digest');
    }
    if (entry.name === DECLARE_DESIGN_BRIEF_TOOL_NAME && entry.result?.success !== false) {
      assert(entry.result.briefDigest, 'successful Brief declaration must return a digest');
    }
  }
  assert(result.data.runtimeDesignBriefDeclaration);
  assert(result.data.runtimeActionPlanDeclaration);
  assert.strictEqual(result.data.runtimeActionPlanDeclaration.boundaries.executable, false);
  assert(result.executionSummary.runtimeActionPlanDigest);
  assert.strictEqual(
    result.executionSummary.runtimeActionPlanDigest.readiness,
    'ready',
    JSON.stringify({
      modelCallCount,
      capabilityControlCalls,
      selectedCapabilityIds: capabilitySession.getResolution().selectedCapabilityIds,
      actionPlanCalls: result.toolCallLog
        .filter((entry) => entry.name === DECLARE_RUNTIME_ACTION_PLAN_TOOL_NAME)
        .map((entry) => entry.result)
    }, null, 2)
  );
  const r4 = result.executionSummary.runtimeStageState.stages.find((stage) => stage.stage === 'R4');
  assert.strictEqual(r4.status, 'passed');
  assert.deepStrictEqual(r4.observedOutcomes.sort(), ['preview_or_action_plan', 'stage_output_candidate']);
  assert(!result.executionSummary.runtimeStageTraceDigest.missingStages.includes('R4'));
  const r4Events = result.data.runtimeStageTrace.events.filter((event) => event.stage === 'R4');
  assert.deepStrictEqual(r4Events.map((event) => event.source), ['action_plan_declaration', 'action_plan_declaration']);
  assert.deepStrictEqual(r4Events.map((event) => event.outcome), ['needs_review', 'passed']);
  assert(!result.data.runtimeStageTrace.events.some((event) => event.source === 'model_tool_plan'));
  assert.notStrictEqual(result.executionSummary.status, 'completed');
  assert.notStrictEqual(result.executionSummary.designVerdict?.status, 'passed');
  assert(!JSON.stringify(result.data.runtimeActionPlanDeclaration).includes('documentId'));
  assert(!JSON.stringify(result.data.runtimeActionPlanDeclaration).includes('目标图层'));
  return {
    externalToolCalls,
    capabilityControlCalls,
    executionStatus: result.executionSummary.status,
    successfulTaskTools: result.executionSummary.successfulToolCalls,
    r4Status: r4.status,
    r4TraceSources: r4Events.map((event) => event.source),
    r4TraceOutcomes: r4Events.map((event) => event.outcome),
    traceMissingStages: result.executionSummary.runtimeStageTraceDigest.missingStages
  };
}

// 守护：R3 策略重新声明后，已存 R4 计划必须作废。生产模型在 R4 看不到 R3
// 控制工具；真正回退由 Runtime Session / Reflexion 拥有。这里直接验证声明消费者的
// 防御性失效语义，避免为了测试恢复跨 Stage 控制工具。
async function runStrategyRedeclarationInvalidatesPlan() {
  const task = '先形成策略与行动计划，再根据新的输入调整策略方向。';
  const candidateTools = [
    { name: 'getDocumentInfo', description: 'Read document information.', inputSchema: { type: 'object', properties: {} } },
    { name: 'getLayerHierarchy', description: 'Read layer hierarchy.', inputSchema: { type: 'object', properties: {} } },
    { name: 'setLayerOpacity', description: 'Change opacity.', inputSchema: { type: 'object', properties: { opacity: { type: 'number' } }, required: ['opacity'] } }
  ];
  const capabilitySession = createAgentCapabilitySession({
    candidateTools,
    requestedTaskType: GENERAL_DESIGN_MANIFEST.task_type,
    manifest: GENERAL_DESIGN_MANIFEST
  });
  let modelCallCount = 0;
  const agent = new Agent(
    {
      systemPrompt: 'R4 plan invalidation on strategy redeclaration smoke.',
      tools: capabilitySession.activeTools,
      modelId: 'test-model',
      maxIterations: 9,
      runtimeStagePlan: stagePlan,
      runtimeSessionIdentity: createRuntimeSessionIdentityForPlan(stagePlan, 'action-plan-invalidation'),
      getCapabilityResolution: () => capabilitySession.getResolution(),
      toolDecisionContext: {
        intentControlPlane: buildAgentIntentControlPlaneDecision({ userInput: task }),
        photoshopConnected: true,
        hasDocument: true
      },
      callbacks: {}
    },
    async (_modelId, _messages, modelTools) => {
      modelCallCount += 1;
      if (modelCallCount === 1) {
        return {
          content: '先读取当前文档事实。',
          toolCalls: [{ id: 'read-doc', name: 'getDocumentInfo', arguments: {} }]
        };
      }
      if (modelCallCount === 2) {
        return {
          content: '基于真实读回声明设计简报。',
          toolCalls: [{ id: 'declare-brief', name: DECLARE_DESIGN_BRIEF_TOOL_NAME, arguments: validBrief() }]
        };
      }
      if (modelCallCount === 3) {
        return {
          content: '基于真实读回声明设计策略。',
          toolCalls: [{
            id: 'declare-strategy-a',
            name: DECLARE_DESIGN_STRATEGY_TOOL_NAME,
            arguments: validStrategy({ contextRefs: ['context:design_brief', 'context:readback'] })
          }]
        };
      }
      if (modelCallCount === 4) {
        return {
          content: '基于策略声明行动计划。',
          toolCalls: [{ id: 'declare-plan', name: DECLARE_RUNTIME_ACTION_PLAN_TOOL_NAME, arguments: validPlan() }]
        };
      }
      if (modelCallCount === 5) {
        assert.strictEqual(
          modelTools.some((tool) => tool.name === DECLARE_DESIGN_STRATEGY_TOOL_NAME),
          false,
          'R4 must not expose the R3 declaration control Tool'
        );
      }
      return { content: '等待补充输入，本轮不再执行。', toolCalls: [] };
    },
    async (toolName) => {
      if (toolName === 'getAnnotatedSnapshot') {
        return { success: true, elements: [{ id: 7, name: '目标图层' }] };
      }
      if (toolName === 'getDocumentInfo') return { success: true, documentId: 1 };
      if (toolName === 'getLayerHierarchy') return { success: true, layers: [{ id: 7, name: '目标图层' }] };
      throw new Error(`Unexpected external Tool: ${toolName}`);
    }
  );
  const result = await agent.run(task);
  assert(result.executionSummary.runtimeActionPlanDigest,
    'fixture must first establish an R4 plan before testing invalidation');
  const redeclaration = agent.executeDesignStrategyDeclaration(validStrategy({
    stageGoal: '在补齐品牌语气输入后重建信息层级。',
    contextRefs: ['context:design_brief', 'context:readback'],
    missingInputs: [{
      inputId: 'brand-tone',
      field: 'copyDirection.toneKeywords',
      question: '品牌语气的核心关键词需要确认哪些？',
      severity: 'blocking'
    }]
  }));
  assert.strictEqual(redeclaration.success, true);
  assert.strictEqual(agent.runtimeActionPlanDeclaration, undefined,
    'redeclared strategy must clear the bounded full plan declaration');
  assert.strictEqual(agent.runtimeActionPlanExecutionJournal, undefined,
    'redeclared strategy must clear previous plan execution observations');
  assert.strictEqual(
    redeclaration.readiness,
    'needs_input',
    JSON.stringify({
      modelCallCount,
      stopReason: result.stopReason,
      toolCallLog: result.toolCallLog
    }, null, 2)
  );
  const r4Events = result.data.runtimeStageTrace.events.filter((event) => event.stage === 'R4');
  assert(r4Events.length > 0, 'historic R4 trace events must be preserved as facts');
  return {
    strategyReadiness: redeclaration.readiness,
    planDigestCleared: agent.runtimeActionPlanDeclaration === undefined,
    historicR4Events: r4Events.length
  };
}

// 守护：Harness 控制工具的成功声明不得重置无进展停机守卫——全失败运行中
// 每轮附带一次载荷微调的合法声明，仍必须在连续失败阈值处停机，
// 而不是烧满 maxIterations（对抗核验 2026-07-10）。
async function runControlToolDoesNotResetStallGuards() {
  const task = '请调整画面并复核结果。';
  const candidateTools = [
    { name: 'getDocumentInfo', description: 'Read document information.', inputSchema: { type: 'object', properties: {} } }
  ];
  const capabilitySession = createAgentCapabilitySession({
    candidateTools,
    requestedTaskType: GENERAL_DESIGN_MANIFEST.task_type,
    manifest: GENERAL_DESIGN_MANIFEST
  });
  let modelCallCount = 0;
  const maxIterations = 8;
  const agent = new Agent(
    {
      systemPrompt: 'stall guard control-tool exclusion smoke.',
      tools: capabilitySession.activeTools,
      modelId: 'test-model',
      maxIterations,
      runtimeStagePlan: stagePlan,
      runtimeSessionIdentity: createRuntimeSessionIdentityForPlan(stagePlan, 'action-plan-stall'),
      getCapabilityResolution: () => capabilitySession.getResolution(),
      toolDecisionContext: {
        intentControlPlane: buildAgentIntentControlPlaneDecision({ userInput: task }),
        photoshopConnected: true,
        hasDocument: true
      },
      callbacks: {}
    },
    async (_modelId, _messages, tools) => {
      modelCallCount += 1;
      const strategyVisible = tools.some((tool) => tool.name === DECLARE_DESIGN_STRATEGY_TOOL_NAME);
      if (!strategyVisible) {
        return {
          content: '先声明当前任务的 Design Brief，再进入策略和失败守卫样本。',
          toolCalls: [{
            id: `declare-brief-${modelCallCount}`,
            name: DECLARE_DESIGN_BRIEF_TOOL_NAME,
            arguments: validBrief()
          }]
        };
      }
      return {
        content: `第 ${modelCallCount} 轮：读取文档并同步声明策略。`,
        toolCalls: [
          { id: `read-doc-${modelCallCount}`, name: 'getDocumentInfo', arguments: {} },
          {
            id: `declare-strategy-${modelCallCount}`,
            name: DECLARE_DESIGN_STRATEGY_TOOL_NAME,
            arguments: validStrategy({
              stageGoal: `第 ${modelCallCount} 版：建立单一视觉焦点并组织辅助信息层级。`,
              // 读回持续失败，context:readback 不可用；用真实存在的开工观察记录让声明成功，
              // 才能验证"成功声明不得重置停机守卫"。
              contextRefs: ['context:design_brief', 'context:opening_observation'],
              // 保持 R3 未就绪，才能在同一 Stage 内形成多次成功控制声明；
              // 不再依赖越权暴露给 R4 的旧阶段控制 Tool。
              missingInputs: [{
                inputId: `fixture-gap-${modelCallCount}`,
                field: 'copyDirection.toneKeywords',
                question: '测试注入：品牌语气仍待确认。',
                severity: 'blocking'
              }]
            })
          }
        ]
      };
    },
    async (toolName) => {
      if (toolName === 'getAnnotatedSnapshot') {
        return { success: true, elements: [{ id: 7, name: '目标图层' }] };
      }
      if (toolName === 'getDocumentInfo') {
        return { success: false, error: '文档读取失败（测试注入的持续失败）。' };
      }
      throw new Error(`Unexpected external Tool: ${toolName}`);
    }
  );
  const result = await agent.run(task);
  // 自检：声明必须真的成功过，否则本样本没有测到"成功声明不得重置守卫"的目标语义。
  const successfulDeclarations = result.toolCallLog.filter((entry) =>
    entry.name === DECLARE_DESIGN_STRATEGY_TOOL_NAME && entry.result?.success !== false);
  assert(successfulDeclarations.length >= 2,
    `declarations must actually succeed for this guard sample to be meaningful (got ${successfulDeclarations.length})`);
  assert(modelCallCount < maxIterations,
    `stall guard must stop the run before maxIterations (model calls: ${modelCallCount})`);
  assert(modelCallCount <= 6,
    `consecutive failed rounds must accumulate despite successful declarations (model calls: ${modelCallCount})`);
  assert.notStrictEqual(result.executionSummary.status, 'completed');
  return {
    modelCallsBeforeStop: modelCallCount,
    maxIterations,
    executionStatus: result.executionSummary.status
  };
}

Promise.resolve().then(async () => {
  const agentIntegration = await runAgentIntegration();
  const strategyRedeclaration = await runStrategyRedeclarationInvalidatesPlan();
  const stallGuard = await runControlToolDoesNotResetStallGuards();
  return { agentIntegration, strategyRedeclaration, stallGuard };
}).then(({ agentIntegration, strategyRedeclaration, stallGuard }) => {
  console.log(JSON.stringify({
    success: true,
    declaration: {
      readiness: ready.readiness,
      stepCount: ready.declaration.payload.steps.length,
      rootSteps: ready.declaration.graph.rootStepIds,
      terminalSteps: ready.declaration.graph.terminalStepIds,
      semanticDsl: Boolean(ready.declaration.payload.designDsl),
      executable: ready.declaration.boundaries.executable
    },
    readinessCases: {
      needsCapability: needsCapability.readiness,
      needsInput: needsInput.readiness
    },
    invalidCases: {
      noStrategy: noStrategy.issues.map((issue) => issue.code),
      fakeContext: fakeContext.issues.map((issue) => issue.code),
      fakeCapability: fakeCapability.issues.map((issue) => issue.code),
      cycle: cycle.issues.map((issue) => issue.code),
      implementationLeak: implementationLeak.issues.map((issue) => issue.code),
      pixelCoordinates: pixelCoordinates.issues.map((issue) => issue.code)
    },
    agentIntegration,
    strategyRedeclaration,
    stallGuard,
    boundary: 'model-authored R4 plan; semantic Capability and DSL refs only; read-only projection with no scheduler or Tool authority'
  }, null, 2));
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
