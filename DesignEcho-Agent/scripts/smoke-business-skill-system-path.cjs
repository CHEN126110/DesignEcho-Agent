#!/usr/bin/env node
/* eslint-disable no-console */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const { createRuntimeSessionIdentityForPlan } = require('./runtime-session-smoke-fixture.cjs');
const TMP_DIR = path.join(ROOT, 'tmp', 'business-skill-real-provider-system-path');
const REAL_PROVIDER_FLAG = 'DESIGNECHO_REAL_PROVIDER_BUSINESS_SKILL_SYSTEM_PATH';
const DEFAULT_REAL_PROVIDER_MODEL = 'local-qwen2.5-7b';
const DEFAULT_REAL_PROVIDER_TIMEOUT_MS = 180_000;

if (!globalThis.window) globalThis.window = {};
const memoryStorage = new Map();
if (!globalThis.localStorage) {
  globalThis.localStorage = {
    getItem: (key) => memoryStorage.has(String(key)) ? memoryStorage.get(String(key)) : null,
    setItem: (key, value) => memoryStorage.set(String(key), String(value)),
    removeItem: (key) => memoryStorage.delete(String(key)),
    clear: () => memoryStorage.clear()
  };
}
globalThis.window.localStorage = globalThis.localStorage;

require('ts-node').register({
  transpileOnly: true,
  project: path.join(ROOT, 'tsconfig.main.json')
});

require(path.join(ROOT, 'src', 'renderer', 'services', 'skill-executors', 'index.ts'));

const {
  Agent
} = require(path.join(ROOT, 'src', 'renderer', 'services', 'agent-runtime', 'agent.ts'));
const {
  REQUEST_AGENT_CAPABILITIES_TOOL_NAME
} = require(path.join(ROOT, 'src', 'renderer', 'services', 'agent-runtime', 'capability-session.ts'));
const {
  resolveAutonomousCapabilityRuntime
} = require(path.join(ROOT, 'src', 'renderer', 'services', 'skill-executors', 'autonomous-agent.executor.ts'));
const {
  executeSkillTool,
  isSkillWorkflowBridgeToolName
} = require(path.join(ROOT, 'src', 'renderer', 'services', 'skill-executors', 'skill-tools.ts'));
const {
  registerSkillExecutor
} = require(path.join(ROOT, 'src', 'renderer', 'services', 'skill-executors', 'registry.ts'));
const {
  DECLARE_DESIGN_BRIEF_TOOL_NAME
} = require(path.join(ROOT, 'src', 'shared', 'agent-runtime-v5', 'runtime-design-brief-declaration.ts'));
const {
  DECLARE_DESIGN_STRATEGY_TOOL_NAME
} = require(path.join(ROOT, 'src', 'shared', 'agent-runtime-v5', 'runtime-design-strategy-declaration.ts'));
const {
  DECLARE_REFERENCE_BRIEF_TOOL_NAME
} = require(path.join(ROOT, 'src', 'shared', 'agent-runtime-v5', 'runtime-reference-context.ts'));
const {
  CURRENT_R3_STRATEGY_REF,
  DECLARE_RUNTIME_ACTION_PLAN_TOOL_NAME
} = require(path.join(ROOT, 'src', 'shared', 'agent-runtime-v5', 'runtime-action-plan-declaration.ts'));
const {
  buildAgentIntentControlPlaneDecision,
  buildAutonomousExecutionDecisionForEngine
} = require(path.join(ROOT, 'src', 'shared', 'agent-intent-control-plane.ts'));
const {
  ModelService
} = require(path.join(ROOT, 'src', 'main', 'services', 'model-service.ts'));
const {
  resolveSkillRuntimeEffectiveContract
} = require(path.join(ROOT, 'src', 'shared', 'agent-runtime-v5', 'skill-runtime.ts'));

// 本 smoke 驱动「创意声明流系统路径」（R1 brief → R3 strategy → … → E1）。结构化生产任务
// （sku-batch / sku-color-card）已改走精简阶段链 ['R0','R2','E1','R5']，不再经 brief/strategy 声明门，
// 因此不属于本 smoke 覆盖面——其短链结构由 smoke-runtime-selected-skill-handoff 断言。
const CASES = [
  { skillId: 'main-image-design', scenario: 'main-image' },
  { skillId: 'detail-page-design', scenario: 'detail-page' }
];

function hasArg(name) {
  return process.argv.includes(name);
}

function getArgValue(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  const value = process.argv[index + 1];
  if (!value || value.startsWith('--')) return fallback;
  return value;
}

function parsePositiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : fallback;
}

function buildFixtureInputSources(manifest, inputKeys) {
  return inputKeys.map((inputKey) => {
    const sourceKind = manifest.input_sources[inputKey]?.[0];
    assert(sourceKind, `Manifest input ${inputKey} must declare at least one source kind.`);
    return {
      sourceKind,
      inputKeys: [inputKey]
    };
  });
}

function buildFixtureInputRef(inputKey, sourceKind) {
  return `input:${inputKey}:${sourceKind}`;
}

function buildFixturePerformanceBudget(manifest) {
  const budget = manifest.performance_profile?.budget;
  assert(budget, `${manifest.skill_id} must declare a production performance budget.`);
  return {
    maxModelCalls: budget.max_model_calls,
    maxToolCalls: budget.max_tool_calls,
    maxVisionCandidates: budget.max_vision_candidates,
    maxVisualAnalyses: budget.max_visual_analyses,
    maxFullResolutionImageReads: budget.max_full_resolution_image_reads,
    softTimeBudgetMs: budget.soft_time_budget_ms
  };
}

function buildBrief(manifest) {
  const workMode = manifest.work_mode_contracts?.create_new || manifest.reference_policy
    ? 'create_new'
    : undefined;
  const effectiveContract = resolveSkillRuntimeEffectiveContract(manifest, workMode);
  const fixtureInputSources = buildFixtureInputSources(manifest, effectiveContract.required_inputs);
  const fixtureInputRefs = fixtureInputSources.map((source) => (
    buildFixtureInputRef(source.inputKeys[0], source.sourceKind)
  ));
  return {
    ...(workMode ? { workMode } : {}),
    taskGoal: `依据当前用户目标和已确认输入完成 ${manifest.display_name}。`,
    deliverables: effectiveContract.delivery_outputs.slice(0, 3),
    targetAudience: '需要快速理解商品核心信息的目标用户。',
    outputRequirements: ['结果必须可编辑', '执行后必须读取结果并进入评价'],
    constraints: ['不编造商品事实', '不把工具成功当作设计质量通过'],
    inputCoverage: effectiveContract.required_inputs.map((inputKey, index) => ({
      inputKey,
      status: 'provided',
      contextRefs: [fixtureInputRefs[index]]
    })),
    contextRefs: ['context:user_goal', 'context:skill_manifest', ...fixtureInputRefs]
  };
}

function buildReferenceBrief() {
  return {
    decision: 'search_new',
    readiness: 'ready',
    sources: [{
      kind: 'eagle',
      sourceRefs: ['context:reference_visual:fixture-eagle-1']
    }],
    insights: [{
      aspect: 'composition',
      application: '沿用清晰层级原则，但不复制候选的具体版式。',
      observationRefs: ['context:reference_visual:fixture-eagle-1']
    }],
    limitations: ['离线 fixture 只验证运行时上下文边界，不代表真实视觉分析质量。']
  };
}

function buildStrategy() {
  return {
    stageGoal: '建立清晰视觉焦点，并按用户阅读优先级组织设计信息。',
    objective: {
      primaryGoal: '让用户快速理解商品和核心价值。',
      secondaryGoals: ['保持真实商品信息', '保留后续可编辑空间'],
      targetAudienceSummary: '需要快速比较并理解商品信息的目标用户。'
    },
    messageArchitecture: {
      primaryMessage: '先呈现商品主体与核心价值，再提供必要支撑信息。',
      supportingMessages: ['辅助信息服务第一视觉层级。'],
      supportingFacts: ['用户目标和当前 Skill Manifest 已确认。'],
      objectionsToResolve: ['主体是否清晰', '信息层级是否明确']
    },
    copyDirection: {
      toneKeywords: ['清晰', '可信'],
      headlineOptions: ['聚焦核心价值'],
      subtitleOptions: [],
      tagOptions: [],
      prohibitedClaims: ['未经事实支持的效果承诺']
    },
    visualDirection: {
      moodKeywords: ['简洁', '可信'],
      paletteIntent: ['以中性色承载主体，用有限强调色建立焦点。'],
      typographyIntent: ['标题与说明形成明确层级。'],
      compositionIntent: ['主体承担主要视觉重量，辅助信息沿清晰阅读路径展开。'],
      imageTreatment: ['保护真实纹理，避免未经确认的商品外观改变。'],
      density: 'medium'
    },
    constraints: ['不改变商品事实。'],
    contextRefs: ['context:user_goal', 'context:design_brief'],
    assumptions: [],
    missingInputs: []
  };
}

function requireCapabilityRef(resolution, capabilityId) {
  assert(
    resolution.selectedCapabilityIds.includes(capabilityId),
    `selected Capability is missing: ${capabilityId}`
  );
  return capabilityId;
}

function buildActionPlan(skillId, resolution) {
  const skillRef = requireCapabilityRef(resolution, `skill.${skillId}`);
  const readRef = requireCapabilityRef(resolution, 'photoshop.read.getDocumentSummary');
  const deliveryRef = requireCapabilityRef(resolution, 'delivery.saveDocument');
  return {
    planGoal: '按当前策略调用被选择的专业 Skill，执行后读取结果并形成可追溯交付记录。',
    strategyRef: CURRENT_R3_STRATEGY_REF,
    contextRefs: ['context:user_goal', 'context:design_strategy'],
    steps: [
      {
        stepId: 'execute-selected-skill',
        kind: 'mutate',
        goal: '调用当前 Manifest 对应的专业 Skill 完成设计执行。',
        dependsOn: [],
        capabilityRefs: [skillRef],
        inputContextRefs: ['context:design_strategy'],
        expectedOutcomes: ['document_change'],
        completionCriteria: ['Skill 返回结构化执行结果。'],
        failurePolicy: 'retry_after_observation'
      },
      {
        stepId: 'readback-result',
        kind: 'verify',
        goal: '读取设计执行后的结构与视觉证据。',
        dependsOn: ['execute-selected-skill'],
        capabilityRefs: [readRef],
        inputContextRefs: ['context:design_strategy'],
        expectedOutcomes: ['readback', 'quality_report'],
        completionCriteria: ['写后读回与评价证据均被记录。'],
        failurePolicy: 'enter_reflexion'
      },
      {
        stepId: 'record-delivery',
        kind: 'deliver',
        goal: '记录当前输出及其交付证据，不把导出成功等同于质量通过。',
        dependsOn: ['readback-result'],
        capabilityRefs: [deliveryRef],
        inputContextRefs: ['context:design_strategy'],
        expectedOutcomes: ['delivery_record'],
        completionCriteria: ['输出记录可追溯且保留质量边界。'],
        failurePolicy: 'stop'
      }
    ],
    missingInputs: []
  };
}

function buildFixtureContext(scenario) {
  return {
    userInput: '执行当前设计任务并保留可编辑、可复核结果。',
    isPluginConnected: true,
    photoshopContext: { hasDocument: false },
    projectContext: {
      projectPath: 'D:/system-path-fixture',
      assetIndex: { summary: { totalImages: 2 }, visionCandidates: [] },
      visualSamplingPlan: {
        planVersion: 'project-visual-sampling/v0',
        mode: 'bounded-metadata-plan',
        scenario,
        maxCandidates: 2,
        selectedCandidates: [],
        skippedCandidateCount: 0,
        cacheSummary: { hit: 2, miss: 0, stale: 0, shouldAnalyze: 0 },
        warnings: [],
        limitations: [],
        evidence: []
      },
      visualInsightCache: {
        summary: { totalEntries: 2, entriesWithInsight: 2, entriesWithRawPayloadRemoved: 0 }
      }
    }
  };
}

async function runCase(item, options = {}) {
  const realProvider = options.realProvider === true;
  const modelId = realProvider
    ? String(options.modelId || DEFAULT_REAL_PROVIDER_MODEL)
    : 'system-path-fixture-model';
  const timeoutMs = parsePositiveInteger(options.timeoutMs, DEFAULT_REAL_PROVIDER_TIMEOUT_MS);
  const runtime = resolveAutonomousCapabilityRuntime({ declaredSkillId: item.skillId });
  const bundle = runtime.runtimeContractBundle;
  assert(bundle, `${item.skillId} must resolve a production runtime contract bundle.`);
  assert(
    Array.isArray(bundle.manifest.legacy_skill_ids)
      && bundle.manifest.legacy_skill_ids.includes(item.skillId),
    `${item.skillId} must be declared as a legacy workflow bridge alias.`
  );
  assert.strictEqual(bundle.stagePlan.skillId, bundle.manifest.skill_id);
  assert(runtime.capabilitySession.activeTools.some((tool) => tool.name === item.skillId));

  let receivedSkillInput = null;
  registerSkillExecutor({
    skillId: item.skillId,
    async execute(input) {
      receivedSkillInput = input;
      return {
        success: true,
        message: 'system-path fixture Skill executed',
        data: {
          version: 'business-skill-system-path-fixture/v0',
          postWriteReadback: { observed: true, fixtureOnly: true },
          evaluationEvidence: { status: 'needs_review', fixtureOnly: true },
          deliveryEvidence: { recorded: true, fixtureOnly: true },
          boundaries: {
            executesPhotoshop: false,
            claimsDesignQuality: false,
            claimsLiveE2E: false
          }
        }
      };
    }
  });

  const task = realProvider
    ? [
        `请通过当前选择的 ${item.skillId} 专业 Skill 完成一次无 Photoshop 写入的系统路径验证。`,
        `Manifest 必需输入均已由本验证任务逐项提供，请使用运行时列出的 input:<inputKey>:<sourceKind> 引用，不要用通用上下文替代具体输入。`,
        '先读取当前 fixture 文档事实，再根据运行时动态出现的控制工具依次声明 Design Brief、必要的 Reference Brief、设计策略和行动计划。',
        '行动计划就绪后调用当前被选择的业务 Skill；不要调用 createDocument、placeImage、renderLayout、saveDocument 或其他原子写入工具。',
        '只有最终业务 Skill 调用可以使用其 schema 中实际存在的 userIntent 参数；R1/R3/R4 声明不得添加 schema 之外的 userIntent、brief、channel 或其他字段。',
        '最终如实说明这是无 Photoshop fixture 验证，不能声明设计质量。'
      ].join('\n')
    : `通过 ${item.skillId} 完成当前设计任务。`;
  let modelCallCount = 0;
  const requiresReference = Boolean(bundle.stagePlan.referencePolicy);
  const performanceBudget = buildFixturePerformanceBudget(bundle.manifest);
  const modelToolSnapshots = [];
  const externalCalls = [];
  const modelService = realProvider
    ? new ModelService({ ollamaUrl: 'http://127.0.0.1:11434' })
    : null;
  const agent = new Agent(
    {
      systemPrompt: realProvider
        ? [
            '你正在验证生产 Agent 的动态设计治理路径，不是在执行一个固定业务模板。',
            '严格遵守运行时提供的 Manifest stage plan：根据当前证据主动填写每个声明工具的 schema，不得添加 schema 未声明的字段。',
            '每轮只调用一个工具。先调用 getDocumentInfo 取得 fixture 事实，然后完成 R1；如当前 Skill 要求参考决策，再完成 R2 Reference Brief；之后完成 R3、R4，最后调用当前唯一被选业务 Skill。',
            '不得调用任何原子 Photoshop 写工具；Skill executor 也是无写入 fixture。',
            '工具成功不等于设计质量通过，最终必须保留未验证边界。'
          ].join('\n')
        : '三类业务 Skill 系统路径 smoke；只验证真实生产拓扑，不执行 Photoshop。',
      tools: runtime.capabilitySession.activeTools,
      modelId,
      maxIterations: realProvider ? 12 : (requiresReference ? 10 : 7),
      performanceBudget,
      runtimeLoopContract: bundle.runtimeLoopContract,
      runtimeStagePlan: bundle.stagePlan,
      runtimeDesignBriefAvailableInputSources: buildFixtureInputSources(
        bundle.manifest,
        resolveSkillRuntimeEffectiveContract(
          bundle.manifest,
          bundle.manifest.work_mode_contracts?.create_new || bundle.manifest.reference_policy
            ? 'create_new'
            : undefined
        ).required_inputs
      ),
      runtimeSessionIdentity: createRuntimeSessionIdentityForPlan(bundle.stagePlan, `business-${item.skillId}`),
      toolCapabilityBridge: bundle.toolCapabilityBridge,
      evaluationProfile: bundle.evaluationProfile,
      getCapabilityResolution: () => runtime.capabilitySession.getResolution(),
      getActiveCapabilityIdsForTool: (toolName) => runtime.capabilitySession.getActiveCapabilityIdsForTool(toolName),
      toolDecisionContext: {
        intentControlPlane: buildAutonomousExecutionDecisionForEngine(
          'system-path smoke uses the production autonomous execution topology.',
          buildAgentIntentControlPlaneDecision({
            userInput: task,
            photoshopConnected: true,
            hasDocument: true
          })
        ),
        photoshopConnected: true,
        hasDocument: true,
        hasImageInput: false
      },
      callbacks: {}
    },
    async (selectedModelId, messages, tools, modelOptions) => {
      modelCallCount += 1;
      modelToolSnapshots.push(tools.map((tool) => tool.name));
      if (realProvider) {
        return modelService.chatWithTools(selectedModelId, messages, tools, {
          maxTokens: 3072,
          temperature: 0.1,
          timeoutMs: modelOptions?.timeoutMs || timeoutMs
        });
      }
      if (modelCallCount === 1) {
        assert(tools.some((tool) => tool.name === DECLARE_DESIGN_BRIEF_TOOL_NAME));
        assert(!tools.some((tool) => tool.name === DECLARE_DESIGN_STRATEGY_TOOL_NAME));
        return {
          content: '先读取当前文档事实，再声明设计简报。',
          toolCalls: [{
            id: `${item.skillId}-read`,
            name: 'getDocumentInfo',
            arguments: {}
          }]
        };
      }
      if (modelCallCount === 2) {
        assert(tools.some((tool) => tool.name === DECLARE_DESIGN_BRIEF_TOOL_NAME));
        assert(!tools.some((tool) => tool.name === DECLARE_DESIGN_STRATEGY_TOOL_NAME));
        return {
          content: '基于用户目标和当前读回声明设计简报。',
          toolCalls: [{
            id: `${item.skillId}-brief`,
            name: DECLARE_DESIGN_BRIEF_TOOL_NAME,
            arguments: buildBrief(bundle.manifest)
          }]
        };
      }
      if (requiresReference && modelCallCount === 3) {
        assert(tools.some((tool) => tool.name === 'searchEagleReferences'));
        assert(tools.some((tool) => tool.name === DECLARE_REFERENCE_BRIEF_TOOL_NAME));
        assert(!tools.some((tool) => tool.name === DECLARE_DESIGN_STRATEGY_TOOL_NAME));
        return {
          content: '先检索一组只读参考候选。',
          toolCalls: [{
            id: `${item.skillId}-reference-search`,
            name: 'searchEagleReferences',
            arguments: { query: '电商详情页 信息层级', limit: 3, preferAiSearch: false }
          }]
        };
      }
      if (requiresReference && modelCallCount === 4) {
        assert(tools.some((tool) => tool.name === 'analyzeEagleReference'));
        return {
          content: '候选元数据不是视觉理解，继续分析一条参考。',
          toolCalls: [{
            id: `${item.skillId}-reference-analyze`,
            name: 'analyzeEagleReference',
            arguments: { itemId: 'fixture-eagle-1', topics: ['composition', 'typography'] }
          }]
        };
      }
      if (requiresReference && modelCallCount === 5) {
        assert(tools.some((tool) => tool.name === DECLARE_REFERENCE_BRIEF_TOOL_NAME));
        assert(!tools.some((tool) => tool.name === DECLARE_DESIGN_STRATEGY_TOOL_NAME));
        return {
          content: '基于真实视觉观察声明参考决策。',
          toolCalls: [{
            id: `${item.skillId}-reference-brief`,
            name: DECLARE_REFERENCE_BRIEF_TOOL_NAME,
            arguments: buildReferenceBrief()
          }]
        };
      }
      const strategyCall = requiresReference ? 6 : 3;
      const planCall = strategyCall + 1;
      const executeCall = strategyCall + 2;
      if (modelCallCount === strategyCall) {
        assert(
          tools.some((tool) => tool.name === DECLARE_DESIGN_STRATEGY_TOOL_NAME),
          `R3 control unavailable after Brief for ${item.skillId}: ${tools.map((tool) => tool.name).join(', ')}`
        );
        assert(!tools.some((tool) => tool.name === DECLARE_RUNTIME_ACTION_PLAN_TOOL_NAME));
        return {
          content: '基于 Brief 声明设计策略。',
          toolCalls: [{
            id: `${item.skillId}-strategy`,
            name: DECLARE_DESIGN_STRATEGY_TOOL_NAME,
            arguments: buildStrategy()
          }]
        };
      }
      if (modelCallCount === planCall) {
        assert(tools.some((tool) => tool.name === DECLARE_RUNTIME_ACTION_PLAN_TOOL_NAME));
        return {
          content: '基于当前策略声明动态行动计划。',
          toolCalls: [{
            id: `${item.skillId}-plan`,
            name: DECLARE_RUNTIME_ACTION_PLAN_TOOL_NAME,
            arguments: buildActionPlan(item.skillId, runtime.capabilitySession.getResolution())
          }]
        };
      }
      if (modelCallCount === executeCall) {
        assert(tools.some((tool) => tool.name === item.skillId));
        return {
          content: '为了按已确认策略形成可编辑设计，我现在调用当前 Manifest 选择的专业 Skill 执行；完成后会读取结构、评价和交付证据。',
          toolCalls: [{
            id: `${item.skillId}-execute`,
            name: item.skillId,
            arguments: { userTask: task, userIntent: task }
          }]
        };
      }
      return { content: '系统路径已执行；fixture 不代表真实设计或 Photoshop 质量通过。', toolCalls: [] };
    },
    async (toolName, args, runtimeContext) => {
      externalCalls.push(toolName);
      if (toolName === REQUEST_AGENT_CAPABILITIES_TOOL_NAME) {
        const activation = runtime.capabilitySession.requestCapabilities(args.capabilityIds || []);
        return { success: activation.status !== 'rejected', data: activation };
      }
      if (isSkillWorkflowBridgeToolName(toolName)) {
        return executeSkillTool(toolName, args || {}, {
          context: buildFixtureContext(item.scenario),
          runtimeDesignBriefDeclaration: runtimeContext?.runtimeDesignBriefDeclaration,
          runtimeDesignBriefDigest: runtimeContext?.runtimeDesignBriefDigest,
          runtimeDesignBriefRequiredInputKeys: runtimeContext?.runtimeDesignBriefRequiredInputKeys,
          runtimeReferenceBriefDeclaration: runtimeContext?.runtimeReferenceBriefDeclaration,
          runtimeReferenceBriefDigest: runtimeContext?.runtimeReferenceBriefDigest
        });
      }
      if (toolName === 'searchEagleReferences') {
        return {
          success: true,
          resultCount: 1,
          results: [{ id: 'eagle:fixture-eagle-1', title: 'fixture reference' }],
          candidateEvidenceOnly: true,
          countsAsVisualUnderstanding: false,
          fixtureOnly: true
        };
      }
      if (toolName === 'analyzeEagleReference') {
        return {
          success: true,
          item: { id: 'fixture-eagle-1', title: 'fixture reference' },
          observation: {
            summary: '离线 fixture 的结构化参考观察。',
            strengths: [{ aspect: 'composition', observation: '层级清晰' }]
          },
          fixtureOnly: true
        };
      }
      if (toolName === 'getAnnotatedSnapshot') {
        return { success: true, elements: [{ id: 1, name: 'fixture-layer' }] };
      }
      if (toolName === 'getDocumentInfo') {
        return { success: true, documentId: 1, name: 'system-path-fixture.psd' };
      }
      if (toolName === 'getLayerHierarchy') {
        return {
          success: true,
          documentId: 1,
          layers: [{ id: 1, name: 'fixture-product', type: 'smartObject', visible: true }]
        };
      }
      if (toolName === 'getAcceptanceSnapshot' || toolName === 'getDocumentSnapshot') {
        return {
          success: true,
          documentId: 1,
          layerCount: 1,
          dimensions: { width: 800, height: 800 },
          fixtureOnly: true
        };
      }
      if (toolName === 'listDocuments') {
        return { success: true, documents: [{ id: 1, name: 'system-path-fixture.psd' }] };
      }
      throw new Error(`Unexpected external Tool in system-path smoke: ${toolName}`);
    }
  );

  const result = await agent.run(task);
  assert(
    receivedSkillInput,
    `${item.skillId} fixture executor did not receive the selected Skill call.\n${JSON.stringify({
      modelCallCount,
      externalCalls,
      stopReason: result.stopReason,
      message: result.message,
      toolCallLog: result.toolCallLog
    }, null, 2)}`
  );
  assert.strictEqual(receivedSkillInput.runtimeDesignBriefDeclaration?.readiness, 'ready');
  assert.strictEqual(receivedSkillInput.runtimeDesignBriefDigest?.version, 'runtime-design-brief-digest/v0');
  assert.deepStrictEqual(
    receivedSkillInput.runtimeDesignBriefDigest?.missingRequiredInputKeys,
    [],
    `${item.skillId} ready Brief must not invent missing user input.`
  );
  if (requiresReference) {
    assert.strictEqual(receivedSkillInput.runtimeReferenceBriefDeclaration?.readiness, 'ready');
    assert.strictEqual(receivedSkillInput.runtimeReferenceBriefDigest?.version, 'runtime-reference-brief-digest/v0');
  }
  assert.deepStrictEqual(
    receivedSkillInput.runtimeDesignBriefRequiredInputKeys,
    resolveSkillRuntimeEffectiveContract(
      bundle.manifest,
      bundle.manifest.work_mode_contracts?.create_new || bundle.manifest.reference_policy
        ? 'create_new'
        : undefined
    ).required_inputs
  );
  if (realProvider) {
    assert(
      externalCalls.includes(item.skillId),
      `${item.skillId} real provider path did not call the selected Skill: ${externalCalls.join(', ')}`
    );
  } else {
    const openingObservationExpected = performanceBudget.maxVisionCandidates > 0
      || performanceBudget.maxVisualAnalyses > 0;
    const expectedExternalCalls = [
      ...(openingObservationExpected ? ['getAnnotatedSnapshot'] : []),
      'getDocumentInfo',
      ...(requiresReference ? ['searchEagleReferences', 'analyzeEagleReference'] : []),
      item.skillId
    ];
    assert.deepStrictEqual(
      externalCalls.slice(0, expectedExternalCalls.length),
      expectedExternalCalls
    );
    const finalReadCalls = externalCalls.slice(expectedExternalCalls.length);
    assert.ok(
      finalReadCalls.every((name) => name === 'getDocumentInfo'),
      `only Runtime final document reads may follow the selected Skill: ${JSON.stringify(finalReadCalls)}`
    );
  }
  assert(result.toolCallLog.some((entry) => entry.name === DECLARE_DESIGN_BRIEF_TOOL_NAME));
  if (requiresReference) {
    assert(result.toolCallLog.some((entry) => entry.name === DECLARE_REFERENCE_BRIEF_TOOL_NAME));
  }
  assert(result.toolCallLog.some((entry) => entry.name === DECLARE_DESIGN_STRATEGY_TOOL_NAME));
  assert(result.toolCallLog.some((entry) => entry.name === DECLARE_RUNTIME_ACTION_PLAN_TOOL_NAME));
  assert(result.toolCallLog.some((entry) => entry.name === item.skillId));
  assert(modelToolSnapshots[0].length < 20, `${item.skillId} planning surface is still too broad.`);
  for (const names of modelToolSnapshots.slice(0, 3)) {
    assert(!names.includes(item.skillId), `${item.skillId} bridge must stay hidden before R4 is ready.`);
    assert(!names.includes('createDocument'), 'Photoshop write Tool must stay hidden during R1/R3 planning.');
    assert(!names.includes('saveDocument'), 'Delivery Tool must stay hidden during R1/R3 planning.');
  }
  assert(
    modelToolSnapshots.some((names) => names.includes(item.skillId)),
    `${item.skillId} bridge must become visible after R4 is ready.`
  );
  assert.strictEqual(
    externalCalls.filter((name) => name === item.skillId).length,
    1,
    `${item.skillId} bridge must execute exactly once.`
  );
  assert.notStrictEqual(result.stopReason, 'plan_execution_mismatch');
  assert.strictEqual(result.data.runtimeStagePlan.skillId, bundle.manifest.skill_id);
  assert.strictEqual(result.data.runtimeActionPlanDeclaration.readiness, 'ready');
  assert.notStrictEqual(result.executionSummary.designVerdict?.status, 'passed');

  const stageState = result.executionSummary.runtimeStageState;
  const requiredPassedStages = ['R1', 'R2', 'R3', 'R4'];
  for (const stage of requiredPassedStages) {
    assert.strictEqual(
      stageState.stages.find((item) => item.stage === stage)?.status,
      'passed',
      `${item.skillId} ${stage} must be evidence-backed.`
    );
  }
  assert.strictEqual(
    result.executionSummary.runtimeStageTraceDigest?.traceEventWithoutTransitionCount,
    0,
    `${item.skillId} Stage Trace must not contain future-stage Tool events.`
  );
  assert.notStrictEqual(
    result.executionSummary.runtimeStageTraceDigest?.status,
    'inconsistent',
    `${item.skillId} Stage Trace must remain transition-consistent.`
  );
  return {
    skillId: item.skillId,
    manifestSkillId: bundle.manifest.skill_id,
    taskType: bundle.manifest.task_type,
    selectedBridgeCalled: externalCalls.find((name) => name === item.skillId),
    modelId,
    modelCallCount,
    initialPlanningToolCount: modelToolSnapshots[0].length,
    maxPlanningToolCount: Math.max(...modelToolSnapshots.slice(0, 3).map((names) => names.length)),
    executionToolCount: modelToolSnapshots.find((names) => names.includes(item.skillId))?.length || 0,
    providerMode: realProvider ? 'real-ollama-provider' : 'fixture-model',
    briefReadiness: receivedSkillInput.runtimeDesignBriefDeclaration.readiness,
    stageStatuses: Object.fromEntries(
      stageState.stages
        .filter((stage) => requiredPassedStages.includes(stage.stage))
        .map((stage) => [stage.stage, stage.status])
    ),
    designVerdict: result.executionSummary.designVerdict?.status || 'missing',
    fixtureOnly: true
  };
}

function renderRealProviderMarkdown(report) {
  const lines = [
    '# 三类 Skill 真实 Provider 系统路径验证',
    '',
    `- success: ${report.success}`,
    `- modelId: ${report.modelId}`,
    `- executesPhotoshop: ${report.boundaries.executesPhotoshop}`,
    `- claimsDesignQuality: ${report.boundaries.claimsDesignQuality}`,
    ''
  ];
  for (const result of report.results || []) {
    lines.push(`## ${result.skillId}`, '');
    lines.push(`- selectedBridgeCalled: ${result.selectedBridgeCalled || 'none'}`);
    lines.push(`- briefReadiness: ${result.briefReadiness}`);
    lines.push(`- R1: ${result.stageStatuses.R1 || 'missing'}`);
    lines.push(`- R3: ${result.stageStatuses.R3 || 'missing'}`);
    lines.push(`- R4: ${result.stageStatuses.R4 || 'missing'}`);
    lines.push(`- designVerdict: ${result.designVerdict}`, '');
  }
  lines.push('## 边界', '');
  lines.push('- 使用真实本机 Ollama Provider。');
  lines.push('- Skill executor 是无 Photoshop 写入 fixture。');
  lines.push('- 本报告不证明 Photoshop E2E、设计质量或交付完成。');
  return `${lines.join('\n')}\n`;
}

function writeRealProviderReport(report) {
  fs.mkdirSync(TMP_DIR, { recursive: true });
  fs.writeFileSync(path.join(TMP_DIR, 'report.json'), JSON.stringify(report, null, 2), 'utf8');
  fs.writeFileSync(path.join(TMP_DIR, 'report.md'), renderRealProviderMarkdown(report), 'utf8');
}

async function main() {
  const realProvider = hasArg('--real-provider');
  if (realProvider && process.env[REAL_PROVIDER_FLAG] !== '1') {
    console.log(JSON.stringify({
      success: true,
      skipped: true,
      mode: 'guarded-real-provider-system-path',
      requiredAuthorization: `${REAL_PROVIDER_FLAG}=1`,
      boundaries: {
        callsProvider: false,
        executesPhotoshop: false,
        claimsLiveE2E: false,
        claimsDesignQuality: false
      }
    }, null, 2));
    return;
  }

  const requestedSkill = getArgValue('--skill', 'all');
  const selectedCases = requestedSkill === 'all'
    ? CASES
    : CASES.filter((item) => item.skillId === requestedSkill);
  assert(selectedCases.length > 0, `Unknown --skill value: ${requestedSkill}`);
  const modelId = getArgValue(
    '--model',
    process.env.DESIGNECHO_REAL_PROVIDER_BUSINESS_SKILL_SYSTEM_PATH_MODEL || DEFAULT_REAL_PROVIDER_MODEL
  );
  const timeoutMs = parsePositiveInteger(
    getArgValue('--timeout-ms', process.env.DESIGNECHO_REAL_PROVIDER_BUSINESS_SKILL_SYSTEM_PATH_TIMEOUT_MS),
    DEFAULT_REAL_PROVIDER_TIMEOUT_MS
  );
  const results = [];
  try {
    for (const item of selectedCases) {
      results.push(await runCase(item, { realProvider, modelId, timeoutMs }));
    }
  } catch (error) {
    if (!realProvider) throw error;
    const failedReport = {
      success: false,
      version: 'business-skill-real-provider-system-path/v0',
      mode: 'real-provider-fixture-executor',
      modelId,
      requestedSkill,
      completedResults: results,
      error: String(error?.message || error).slice(0, 12_000),
      boundaries: {
        callsRealProvider: true,
        skillExecutorsAreFixtures: true,
        executesPhotoshop: false,
        claimsLiveE2E: false,
        claimsDesignQuality: false
      }
    };
    writeRealProviderReport({ ...failedReport, results });
    console.error(JSON.stringify(failedReport, null, 2));
    process.exitCode = 1;
    return;
  }
  const report = {
    success: true,
    version: realProvider
      ? 'business-skill-real-provider-system-path/v0'
      : 'business-skill-system-path-smoke/v0',
    mode: realProvider ? 'real-provider-fixture-executor' : 'offline-fixture',
    modelId: realProvider ? modelId : 'system-path-fixture-model',
    results,
    boundaries: {
      usesProductionAgentRuntime: true,
      usesProductionManifestResolver: true,
      usesProductionCapabilitySession: true,
      usesProductionSkillWorkflowBridge: true,
      modelIsFixture: !realProvider,
      callsRealProvider: realProvider,
      skillExecutorsAreFixtures: true,
      executesPhotoshop: false,
      claimsLiveE2E: false,
      claimsDesignQuality: false
    }
  };
  if (realProvider) writeRealProviderReport(report);
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exit(1);
});
