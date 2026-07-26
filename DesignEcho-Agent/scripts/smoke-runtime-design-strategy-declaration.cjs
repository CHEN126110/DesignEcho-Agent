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
  DECLARE_DESIGN_BRIEF_TOOL_NAME
} = require(path.join(root, 'src', 'shared', 'agent-runtime-v5', 'runtime-design-brief-declaration.ts'));
const {
  DECLARE_DESIGN_STRATEGY_TOOL_NAME,
  buildDeclareDesignStrategyToolSchema,
  buildRuntimeDesignStrategyDigest,
  validateRuntimeDesignStrategyDeclaration
} = require(path.join(root, 'src', 'shared', 'agent-runtime-v5', 'runtime-design-strategy-declaration.ts'));
const { buildRuntimeStagePlan } = require(path.join(root, 'src', 'shared', 'agent-runtime-v5', 'runtime-stage-plan.ts'));
const { GENERAL_DESIGN_MANIFEST } = require(path.join(root, 'src', 'shared', 'agent-runtime-v5', 'manifests', 'general-design.manifest.ts'));
const { Agent } = require(path.join(root, 'src', 'renderer', 'services', 'agent-runtime', 'agent.ts'));
const {
  buildAgentIntentControlPlaneDecision
} = require(path.join(root, 'src', 'shared', 'agent-intent-control-plane.ts'));

const plan = buildRuntimeStagePlan(GENERAL_DESIGN_MANIFEST);
const allowedContextRefs = [
  'context:user_goal',
  'context:skill_manifest',
  'context:opening_observation',
  'context:readback'
];

function validBrief() {
  return {
    taskGoal: '基于当前文档形成清晰、可编辑且可复核的视觉设计。',
    deliverables: ['可编辑设计文档', '预览', '交付记录'],
    targetAudience: '需要快速理解核心信息的目标用户。',
    outputRequirements: ['保留可编辑结构', '写入后必须复核'],
    constraints: ['不改变素材表达的事实'],
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
    stageGoal: '建立清晰的单一视觉焦点，并让关键信息按阅读优先级展开。',
    objective: {
      primaryGoal: '让用户快速理解画面主题与核心价值。',
      secondaryGoals: ['保持真实素材质感', '让后续执行有明确取舍'],
      targetAudienceSummary: '需要快速理解信息、偏好克制视觉表达的目标用户。'
    },
    messageArchitecture: {
      primaryMessage: '核心内容应先被看到，再由辅助信息解释原因。',
      supportingMessages: ['辅助信息服务主信息，不争夺第一视觉层级。'],
      supportingFacts: ['当前文档结构已读取。'],
      objectionsToResolve: ['信息是否太散', '主体是否足够突出']
    },
    copyDirection: {
      toneKeywords: ['清晰', '克制'],
      headlineOptions: ['聚焦核心价值'],
      subtitleOptions: [],
      tagOptions: [],
      prohibitedClaims: ['未经事实支持的效果承诺']
    },
    visualDirection: {
      moodKeywords: ['简洁', '可信'],
      paletteIntent: ['以中性色承载主体，用单一强调色建立焦点。'],
      typographyIntent: ['标题与说明形成明显字号和字重层级。'],
      compositionIntent: ['主体占据主要视觉重量，辅助信息沿清晰阅读路径排列。'],
      imageTreatment: ['保留真实纹理，避免过度磨皮和不必要特效。'],
      density: 'medium'
    },
    constraints: ['不改变素材所表达的产品事实。'],
    contextRefs: ['context:user_goal', 'context:readback'],
    assumptions: [],
    missingInputs: [],
    ...overrides
  };
}

const valid = validateRuntimeDesignStrategyDeclaration({
  value: validStrategy(),
  allowedContextRefs
});
assert.strictEqual(valid.ok, true, JSON.stringify(valid.issues));
assert.strictEqual(valid.readiness, 'ready');
assert.strictEqual(valid.declaration.version, 'runtime-design-strategy-declaration/v0');
assert.strictEqual(valid.declaration.source, 'model_tool_call');
assert.strictEqual(valid.declaration.boundaries.harnessValidatedOnly, true);
assert.strictEqual(valid.declaration.boundaries.artifactPublished, false);
assert.strictEqual(valid.declaration.boundaries.executesTools, false);
assert.strictEqual(valid.declaration.boundaries.countsAsTaskProgress, false);
assert.strictEqual(valid.declaration.boundaries.countsAsQualityPass, false);
assert(!Object.prototype.hasOwnProperty.call(valid.declaration, 'meta'));
assert(!Object.prototype.hasOwnProperty.call(valid.declaration.payload, 'contextSnapshotRef'));
assert(!Object.prototype.hasOwnProperty.call(valid.declaration.payload, 'contentModules'));

const digest = buildRuntimeDesignStrategyDigest(valid.declaration);
assert.strictEqual(digest.version, 'runtime-design-strategy-digest/v0');
assert.strictEqual(digest.stageGoal, valid.declaration.payload.stageGoal);
assert.strictEqual(digest.boundaries.digestOnly, true);
assert.strictEqual(digest.boundaries.changesTaskResult, false);

const blocking = validateRuntimeDesignStrategyDeclaration({
  value: validStrategy({
    missingInputs: [{
      inputId: 'brand-rule',
      field: 'brandRules',
      question: '是否有必须遵守的品牌颜色？',
      severity: 'blocking'
    }]
  }),
  allowedContextRefs
});
assert.strictEqual(blocking.ok, true);
assert.strictEqual(blocking.readiness, 'needs_input');

const unavailableContext = validateRuntimeDesignStrategyDeclaration({
  value: validStrategy({ contextRefs: ['context:not_available'] }),
  allowedContextRefs
});
assert.strictEqual(unavailableContext.ok, false);
assert(unavailableContext.issues.some((issue) => issue.code === 'context_ref_not_available'));

const implementationLeak = validateRuntimeDesignStrategyDeclaration({
  value: validStrategy({ x: 120, layerName: '产品图', toolId: 'moveLayer' }),
  allowedContextRefs
});
assert.strictEqual(implementationLeak.ok, false);
assert(implementationLeak.issues.filter((issue) => issue.code === 'unknown_field').length === 3);

const nestedImplementationLeak = validStrategy();
nestedImplementationLeak.visualDirection.bounds = { x: 0, y: 0, width: 1, height: 1 };
const nestedResult = validateRuntimeDesignStrategyDeclaration({
  value: nestedImplementationLeak,
  allowedContextRefs
});
assert.strictEqual(nestedResult.ok, false);
assert(nestedResult.issues.some((issue) => issue.path === 'visualDirection.bounds'));

const sensitive = validateRuntimeDesignStrategyDeclaration({
  value: validStrategy({ stageGoal: '读取 C:\\private\\secret.psd 后执行设计' }),
  allowedContextRefs
});
assert.strictEqual(sensitive.ok, false);
assert(sensitive.issues.some((issue) => issue.code === 'sensitive_payload_forbidden'));

const implementationText = validateRuntimeDesignStrategyDeclaration({
  value: validStrategy({ stageGoal: '调用 moveLayer 工具并执行 Photoshop 命令完成布局' }),
  allowedContextRefs
});
assert.strictEqual(implementationText.ok, false);
assert(implementationText.issues.some((issue) => issue.code === 'implementation_detail_forbidden'));

const schema = buildDeclareDesignStrategyToolSchema(allowedContextRefs);
assert.strictEqual(schema.name, DECLARE_DESIGN_STRATEGY_TOOL_NAME);
assert.deepStrictEqual(schema.inputSchema.properties.contextRefs.items.enum, allowedContextRefs);
assert.strictEqual(schema.inputSchema.additionalProperties, false);
assert.strictEqual(schema.inputSchema.properties.visualDirection.additionalProperties, false);

const source = fs.readFileSync(
  path.join(root, 'src', 'shared', 'agent-runtime-v5', 'runtime-design-strategy-declaration.ts'),
  'utf8'
);
assert(source.includes("import type { CreativeStrategy }"));
assert(!/detailPage|mainImage|sku/i.test(source));
assert(!source.includes('executeTool('));
assert(!source.includes('taskText'));

async function runAgentIntegration() {
  const task = '请先基于当前文档形成设计策略，再把目标图层不透明度调整为 80% 并复核';
  let modelCallCount = 0;
  const externalToolCalls = [];
  const agent = new Agent(
    {
      systemPrompt: 'R3 strategy declaration integration smoke.',
      tools: [{
        name: 'getDocumentInfo',
        description: 'Read document information.',
        inputSchema: { type: 'object', properties: {} }
      }],
      modelId: 'test-model',
      maxIterations: 4,
      runtimeStagePlan: plan,
      runtimeSessionIdentity: createRuntimeSessionIdentityForPlan(plan, 'strategy'),
      toolDecisionContext: {
        intentControlPlane: buildAgentIntentControlPlaneDecision({ userInput: task }),
        photoshopConnected: true,
        hasDocument: true
      },
      callbacks: {}
    },
    async (_modelId, _messages, tools) => {
      modelCallCount += 1;
      if (modelCallCount === 1) {
        assert(tools.some((tool) => tool.name === DECLARE_DESIGN_BRIEF_TOOL_NAME));
        assert(!tools.some((tool) => tool.name === DECLARE_DESIGN_STRATEGY_TOOL_NAME));
        return {
          content: '先读取文档信息，再声明设计简报。',
          toolCalls: [{ id: 'read-doc', name: 'getDocumentInfo', arguments: {} }]
        };
      }
      if (modelCallCount === 2) {
        assert(tools.some((tool) => tool.name === DECLARE_DESIGN_BRIEF_TOOL_NAME));
        assert(!tools.some((tool) => tool.name === DECLARE_DESIGN_STRATEGY_TOOL_NAME));
        return {
          content: '基于用户目标和当前文档事实记录设计简报。',
          toolCalls: [{
            id: 'declare-brief',
            name: DECLARE_DESIGN_BRIEF_TOOL_NAME,
            arguments: validBrief()
          }]
        };
      }
      if (modelCallCount === 3) {
        const strategyTool = tools.find((tool) => tool.name === DECLARE_DESIGN_STRATEGY_TOOL_NAME);
        assert(strategyTool.inputSchema.properties.contextRefs.items.enum.includes('context:design_brief'));
        assert(strategyTool.inputSchema.properties.contextRefs.items.enum.includes('context:readback'));
        return {
          content: '基于已就绪的 Brief 和文档事实记录当前设计策略。',
          toolCalls: [{
            id: 'declare-strategy',
            name: DECLARE_DESIGN_STRATEGY_TOOL_NAME,
            arguments: validStrategy({ contextRefs: ['context:design_brief', 'context:readback'] })
          }]
        };
      }
      return { content: '策略已经记录，但尚未形成可验证设计产物。', toolCalls: [] };
    },
    async (toolName) => {
      externalToolCalls.push(toolName);
      if (toolName === 'getAnnotatedSnapshot') {
        return { success: true, elements: [{ id: 7, name: '目标图层' }] };
      }
      if (toolName === 'getDocumentInfo') return { success: true, documentId: 1 };
      throw new Error(`Harness control leaked to external executor: ${toolName}`);
    }
  );
  const result = await agent.run(task);
  assert.deepStrictEqual(
    externalToolCalls,
    ['getAnnotatedSnapshot', 'getDocumentInfo'],
    JSON.stringify({ result, externalToolCalls }, null, 2)
  );
  assert(result.toolCallLog.some((entry) => entry.name === DECLARE_DESIGN_BRIEF_TOOL_NAME));
  assert(result.toolCallLog.some((entry) => entry.name === DECLARE_DESIGN_STRATEGY_TOOL_NAME));
  assert.strictEqual(result.executionSummary.successfulToolCalls, 1);
  assert(result.data.runtimeDesignBriefDeclaration);
  assert(result.executionSummary.runtimeDesignBriefDigest);
  assert(result.data.runtimeDesignStrategyDeclaration);
  assert(result.executionSummary.runtimeDesignStrategyDigest);
  const r3 = result.executionSummary.runtimeStageState.stages.find((stage) => stage.stage === 'R3');
  const r1 = result.executionSummary.runtimeStageState.stages.find((stage) => stage.stage === 'R1');
  assert.strictEqual(r1.status, 'passed');
  assert.strictEqual(r3.status, 'passed');
  assert.deepStrictEqual(r3.observedOutcomes.sort(), ['design_strategy_recorded', 'stage_goal_defined']);
  assert(!result.executionSummary.runtimeStageTraceDigest.missingStages.includes('R3'));
  assert.strictEqual(result.executionSummary.runtimeStageTraceDigest.unbackedTransitionCount, 0);
  assert.notStrictEqual(result.executionSummary.status, 'completed');
  assert.notStrictEqual(result.executionSummary.designVerdict?.status, 'passed');
  const serializedDeclaration = JSON.stringify(result.data.runtimeDesignStrategyDeclaration);
  assert(!serializedDeclaration.includes('documentId'));
  assert(!serializedDeclaration.includes('目标图层'));
  return {
    externalToolCalls,
    executionStatus: result.executionSummary.status,
    successfulTaskTools: result.executionSummary.successfulToolCalls,
    r1Status: r1.status,
    r3Status: r3.status,
    traceStatus: result.executionSummary.runtimeStageTraceDigest.status,
    traceMissingStages: result.executionSummary.runtimeStageTraceDigest.missingStages
  };
}

runAgentIntegration().then((agentIntegration) => {
  console.log(JSON.stringify({
    success: true,
    declaration: {
      readiness: valid.readiness,
      sharedCreativeStrategyFields: true,
      artifactPublished: valid.declaration.boundaries.artifactPublished
    },
    invalidCases: {
      unavailableContext: unavailableContext.issues.map((issue) => issue.code),
      implementationLeak: implementationLeak.issues.map((issue) => issue.code),
      implementationText: implementationText.issues.map((issue) => issue.code),
      sensitivePayload: sensitive.issues.map((issue) => issue.code)
    },
    agentIntegration,
    boundary: 'model-authored R3 strategy; Harness validation only; no external Tool or quality-pass authority'
  }, null, 2));
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
