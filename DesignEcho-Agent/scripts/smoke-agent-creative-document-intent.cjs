const assert = require('assert');
const path = require('path');

require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '..', 'tsconfig.main.json')
});

const {
  buildAgentIntentControlPlaneDecision
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'agent-intent-control-plane.ts'));
const {
  hasExplicitGeneratedPublicPlanApproval
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'generated-public-plan-approval-policy.ts'));
const {
  buildAgentTaskPublicPlanExecutionRequest,
  DEFAULT_AGENT_TASK_PUBLIC_PLAN_WRITE_TOOL_ALLOWLIST
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'agent-task-public-plan-execution-request.ts'));
const {
  getSkillById
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'skills', 'skill-declarations.ts'));
const {
  fastDeterministicRoute,
  isEcommerceSocksDesignIntent
} = require(path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'agent-orchestration', 'routing.ts'));
const {
  extractDocumentManagementRoutingParams,
  matchesSkillRoutingIntent,
  normalizeSkillId
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'skill-routing.ts'));
const {
  sanitizeUserVisibleThinkingText
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'chat-response-cleaner.ts'));
const skillExecutors = require(path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'skill-executors', 'index.ts'));
const { DesignAgentEngine } = require(path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'design-agent', 'engine.ts'));
const {
  autonomousAgentExecutor,
  resolveAutonomousCapabilityRuntime,
  selectToolsForContext
} = require(path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'skill-executors', 'autonomous-agent.executor.ts'));
// 通用 Harness 守卫只保留安全、显式 Skill policy 与写后观察，不再规定品类工具路线。
const {
  resolveDesignDisciplineContext,
  createDesignDisciplineState,
  evaluateDesignToolStateGuard
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'design-discipline-runtime.ts'));

function decide(userInput) {
  return buildAgentIntentControlPlaneDecision({
    userInput,
    hasDocument: true,
    photoshopConnected: true
  });
}

function createEngineContext(userInput) {
  return {
    userInput,
    conversationHistory: [],
    isPluginConnected: true,
    photoshopContext: {
      hasDocument: true,
      documentName: 'test.psd',
      activeLayerName: '背景',
      layerCount: 1
    },
    projectContext: {
      projectPath: 'C:/DesignEcho/test-project',
      projectImageCount: 0,
      projectImageFolders: [],
      sampleImagePaths: []
    }
  };
}

const DETAIL_PAGE_VISIBLE_COPY = [
  '舒适透气运动袜',
  '吸汗速干',
  '材质透气',
  '弹力贴合',
  '耐磨不易滑',
  '颜色搭配建议',
  '经典色日常百搭'
];

function buildDetailPageStagePlan(overrides = {}) {
  return {
    targetDocumentName: '详情页',
    productUnderstanding: '电商袜子详情页草稿，重点突出舒适透气、吸汗速干、弹力贴合和耐磨不易滑。',
    currentStage: {
      id: 'hero-selling-points',
      title: '首屏卖点',
      purpose: '先建立详情页首屏，让买家快速看到产品主题和主要购买理由。',
      sellingPoint: '舒适透气运动袜',
      imageIntent: '本阶段先用深色背景和可编辑文字建立信息层级，不使用外部素材。',
      layoutRoles: ['background', 'title', 'selling-point'],
      observationFocus: '检查标题和三个卖点是否真实可见、可编辑，并且没有文字重叠。',
      ...(overrides.currentStage || {})
    },
    ...overrides
  };
}

function buildMinimalDetailPageDraftOperations({ width = 790, height = 1200, includeStagePlan = true } = {}) {
  return [
    {
      operationId: 'create-detail-page-document',
      toolName: 'createDocument',
      params: {
        width,
        height,
        name: '详情页',
        preset: 'detail-page',
        backgroundColor: 'transparent'
      },
      paramsSummary: `新建 ${width}x${height} 详情页草稿画布。`,
      readbackTargets: ['document_info']
    },
    {
      operationId: 'render-detail-page-stage',
      toolName: 'renderLayout',
      params: {
        canvas: { width, height },
        ...(includeStagePlan ? { stagePlan: buildDetailPageStagePlan() } : {}),
        blocks: [
          { id: 'stage-background', role: 'background', content: '#101827', heightRatio: 1 },
          { id: 'stage-title', role: 'title', content: '舒适透气运动袜', heightRatio: 0.14, widthRatio: 0.9, hAlign: 'center' },
          { id: 'selling-point-1', role: 'selling-point', content: '吸汗速干', heightRatio: 0.1, widthRatio: 0.84, hAlign: 'center' },
          { id: 'selling-point-2', role: 'selling-point', content: '弹力贴合', heightRatio: 0.1, widthRatio: 0.84, hAlign: 'center' },
          { id: 'selling-point-3', role: 'selling-point', content: '耐磨不易滑', heightRatio: 0.1, widthRatio: 0.84, hAlign: 'center' }
        ]
      },
      paramsSummary: '按阶段计划生成详情页首屏草稿。',
      readbackTargets: ['layer_hierarchy', 'acceptance_snapshot']
    }
  ];
}

function buildDetailPageVisibleCopyReadback(target) {
  const layers = DETAIL_PAGE_VISIBLE_COPY.map((contents, index) => ({
    id: 800 + index,
    name: `详情页文案-${index + 1}`,
    kind: 'text',
    visible: true,
    contents
  }));
  return {
    target,
    ok: true,
    hierarchy: layers,
    layers,
    textLayerReadback: {
      success: true,
      layers: layers.map((layer) => ({
        id: layer.id,
        name: layer.name,
        contents: layer.contents
      }))
    }
  };
}

async function assertCreativeDraftDoesNotShortCircuitToDocumentManagement(creativeMainImageDraft) {
  const engine = new DesignAgentEngine();
  const originalGetSkillExecutor = skillExecutors.getSkillExecutor;
  const originalExecuteSkillWithExecutor = skillExecutors.executeSkillWithExecutor;
  const executed = [];

  skillExecutors.getSkillExecutor = (skillId) => ({
    id: skillId,
    execute: async () => ({ success: true, message: `executed:${skillId}` })
  });
  skillExecutors.executeSkillWithExecutor = async (skillId, payload) => {
    executed.push({ skillId, params: payload?.params || {} });
    return { success: true, message: `executed:${skillId}`, data: { status: 'completed' } };
  };

  try {
    const result = await engine.run(createEngineContext(creativeMainImageDraft), {
      callModel: async (messages, options = {}) => {
        if (options.purpose === 'visible_reasoning') {
          return { text: '我会先搭一个临时主图草稿，包含深色背景、标题和三个卖点文字。' };
        }
        return {
          text: JSON.stringify({
            route: 'autonomous_agent',
            intentSummary: '创建一个可编辑的电商袜子主图草稿。',
            skillParams: {}
          })
        };
      }
    });

    assert(
      !executed.some((item) => item.skillId === 'document-management'),
      `creative main-image draft must not short-circuit to document-management: ${JSON.stringify({ executed, result })}`
    );
    assert.strictEqual(result?.data?.agentIntentControlPlane?.requestKind, 'autonomous_execution');
  } finally {
    skillExecutors.getSkillExecutor = originalGetSkillExecutor;
    skillExecutors.executeSkillWithExecutor = originalExecuteSkillWithExecutor;
  }
}

async function assertCreativeDraftRejectsTemplateRouterDecision(creativeMainImageDraft) {
  const engine = new DesignAgentEngine();
  const originalGetSkillExecutor = skillExecutors.getSkillExecutor;
  const originalExecuteSkillWithExecutor = skillExecutors.executeSkillWithExecutor;
  const executed = [];
  let publicPlanPrompt = '';

  skillExecutors.getSkillExecutor = (skillId) => ({
    id: skillId,
    execute: async () => ({ success: true, message: `executed:${skillId}` })
  });
  skillExecutors.executeSkillWithExecutor = async (skillId, payload) => {
    executed.push({ skillId, params: payload?.params || {} });
    return { success: true, message: `executed:${skillId}`, data: { status: 'completed' } };
  };

  try {
    const result = await engine.run(createEngineContext(creativeMainImageDraft), {
      callModel: async (messages, options = {}) => {
        if (options.purpose === 'visible_reasoning') {
          return { text: '我会先按真实主图草稿处理，把标题和三个卖点放进画面。' };
        }
        if (options.purpose === 'router') {
          return {
            text: JSON.stringify({
              route: 'skill_execution',
              skillId: 'main-image-template-authoring',
              mode: 'execute',
              intentSummary: '创建电商袜子主图草稿。',
              skillParams: {
                size: '800',
                imageType: 'conversion',
                productTheme: '电商袜子'
              }
            })
          };
        }
        if (options.purpose === 'agent_task_public_plan') {
          publicPlanPrompt = String(messages?.[1]?.content || messages?.[0]?.content || '');
          return {
            text: JSON.stringify({
              message: '我会按真实主图草稿处理：先搭深色背景，再放入标题“舒适透气运动袜”和三个卖点“吸汗速干 / 弹力贴合 / 耐磨不易滑”，完成后读回图层确认内容可编辑。',
              proposedWriteTools: ['createDocument', 'renderLayout', 'getAcceptanceSnapshot'],
              readbackTargets: ['acceptance_snapshot', 'layer_hierarchy'],
              executionPlanSummary: '创建 800x800 主图草稿，并确认用户给定文案进入可编辑图层。'
            })
          };
        }
        return { text: '{}' };
      }
    });

    // 创意草稿（去刻意路线 + 用户「做主图1440 没拿到模型回复」根因修复）：拒绝 template 骨架，
    // 且直接进 Agent 自主循环（ready_for_tool_execution），不再被引擎重建决策丢信号后退回
    // 循环外强制 public-plan 门禁（加尺寸等长 prompt 时易掐断）。public-plan 降为循环内可选能力。
    assert(
      !executed.some((item) => item.skillId === 'main-image-template-authoring'),
      `creative draft must reject template skeleton router decisions: ${JSON.stringify({ executed, result })}`
    );
    assert.strictEqual(result?.success, true, `creative draft should run autonomously: ${JSON.stringify({ executed, result })}`);
    assert.strictEqual(
      result?.data?.agentTaskPlan?.status,
      'ready_for_tool_execution',
      `creative draft should enter the autonomous loop directly (skip the forced public-plan gate): ${JSON.stringify({ executed, result })}`
    );
    assert(
      executed.some((item) => item.skillId === 'autonomous-agent'),
      `creative draft should execute the autonomous-agent loop, not a template skeleton: ${JSON.stringify({ executed, result })}`
    );
    assert.strictEqual(
      result?.data?.agentRequestLifecycle?.decision?.route,
      'autonomous_agent',
      `creative draft should be routed to autonomous: ${JSON.stringify({ executed, result })}`
    );

    // public-plan 仍用于 candidate_only 的真正含糊请求；它不能因品类或设计复杂度拦住已授权任务。
    // 其 prompt 必须面向用户且不泄漏工具名。
    executed.length = 0;
    publicPlanPrompt = '';
    const openImprovementResult = await engine.run(
      createEngineContext('帮我处理一下'),
      {
        callModel: async (messages, options = {}) => {
          if (options.purpose === 'router') {
            return { text: JSON.stringify({ route: 'autonomous_agent', thinking: '目标和授权仍需确认。' }) };
          }
          if (options.purpose === 'agent_task_public_plan') {
            publicPlanPrompt = String(messages?.[1]?.content || messages?.[0]?.content || '');
            return {
              text: JSON.stringify({
                message: '我会先观察当前画面，再调整版式、层次和质感，完成后读回结果确认。',
                proposedWriteTools: ['renderLayout', 'getAcceptanceSnapshot'],
                readbackTargets: ['acceptance_snapshot', 'layer_hierarchy'],
                executionPlanSummary: '在保留视觉重点前提下调整版式与层次。'
              })
            };
          }
          return { text: '{}' };
        }
      }
    );
    assert.strictEqual(
      openImprovementResult?.data?.agentTaskPlan?.status,
      'ready_for_model_planning',
      `candidate-only ambiguous work should still form a public plan: ${JSON.stringify({ openImprovementResult })}`
    );
    assert(
      publicPlanPrompt.includes('message 面向真实使用者')
        && publicPlanPrompt.includes('不要在 message 里出现工具名')
        && publicPlanPrompt.includes('不要使用 route、skill、executor、template authoring'),
      `public plan prompt should force user-facing, non-technical wording: ${publicPlanPrompt}`
    );
  } finally {
    skillExecutors.getSkillExecutor = originalGetSkillExecutor;
    skillExecutors.executeSkillWithExecutor = originalExecuteSkillWithExecutor;
  }
}

async function assertCreativeDetailSkillCandidateStaysInsideAutonomousLoop(creativeDetailPageDraft) {
  const engine = new DesignAgentEngine();
  const originalGetSkillExecutor = skillExecutors.getSkillExecutor;
  const originalExecuteSkillWithExecutor = skillExecutors.executeSkillWithExecutor;
  const executed = [];

  skillExecutors.getSkillExecutor = (skillId) => ({
    id: skillId,
    execute: async () => ({ success: true, message: `executed:${skillId}` })
  });
  skillExecutors.executeSkillWithExecutor = async (skillId, payload) => {
    executed.push({ skillId, params: payload?.params || {} });
    return { success: true, message: `executed:${skillId}`, data: { status: 'completed' } };
  };

  try {
    const result = await engine.run(createEngineContext(creativeDetailPageDraft), {
      callModel: async (messages, options = {}) => {
        if (options.purpose === 'visible_reasoning') {
          return { text: '我会先按真实详情页草稿处理，搭出深色首屏、标题和三个卖点模块。' };
        }
        if (options.purpose === 'router') {
          return {
            text: JSON.stringify({
              route: 'skill_execution',
              skillId: 'detail-page-design',
              mode: 'execute',
              intentSummary: '创建电商袜子详情页草稿。',
              skillParams: {
                theme: '电商袜子详情页'
              }
            })
          };
        }
        if (options.purpose === 'agent_task_public_plan') {
          return {
            text: JSON.stringify({
              message: '我会按真实详情页草稿处理：先建立 790 宽的画面，再放入深色首屏、标题“舒适透气运动袜”和三个卖点模块，完成后读回图层确认文字可编辑。',
              proposedWriteTools: ['createDocument', 'renderLayout'],
              readbackTargets: ['acceptance_snapshot', 'layer_hierarchy'],
              executionPlanSummary: '创建 790 宽详情页草稿，并确认用户给定文案进入可编辑图层。',
              operationRequests: buildMinimalDetailPageDraftOperations({ width: 790, height: 1200 })
            })
          };
        }
        return { text: '{}' };
      }
    });

    // detail-page-design 同时覆盖套版与从零设计；router 选中它时应作为能力建议进入自主循环，
    // 不能由模型路由直接执行固定 workflow executor。具体使用 Skill 还是原子 Tool 由循环内 Agent 决定。
    assert(
      !executed.some((item) => item.skillId === 'detail-page-design'),
      `model-selected detail-page Skill must not bypass the autonomous loop via direct execution: ${JSON.stringify({ executed, result })}`
    );
    assert.strictEqual(result?.success, true, `creative detail-page draft should run autonomously: ${JSON.stringify({ executed, result })}`);
    assert.strictEqual(
      result?.data?.agentTaskPlan?.status,
      'ready_for_tool_execution',
      `creative detail-page draft should enter the autonomous loop directly (skip the forced public-plan gate): ${JSON.stringify({ executed, result })}`
    );
    assert(
      executed.some((item) => item.skillId === 'autonomous-agent'),
      `creative detail-page work should execute the autonomous loop with the Skill remaining available as a capability: ${JSON.stringify({ executed, result })}`
    );
    assert.strictEqual(
      result?.data?.agentRequestLifecycle?.decision?.route,
      'autonomous_agent',
      `creative detail-page draft should be routed to autonomous: ${JSON.stringify({ executed, result })}`
    );
  } finally {
    skillExecutors.getSkillExecutor = originalGetSkillExecutor;
    skillExecutors.executeSkillWithExecutor = originalExecuteSkillWithExecutor;
  }
}

async function assertConfirmedPublicPlanUsesControlledRunInsteadOfAutonomousLoop(creativeDetailPageDraft) {
  const engine = new DesignAgentEngine();
  const originalGetSkillExecutor = skillExecutors.getSkillExecutor;
  const originalExecuteSkillWithExecutor = skillExecutors.executeSkillWithExecutor;
  const executed = [];

  const agentTaskPlan = {
    version: 'agent-task-planning-contract/v0',
    status: 'ready_for_model_planning',
    requestKind: 'autonomous_execution',
    allowedToolScope: 'write_photoshop',
    route: 'autonomous_agent',
    skillId: 'autonomous-agent',
    designBrief: {
      scenario: 'detail-page',
      goal: creativeDetailPageDraft,
      deliverables: ['model_generated_design_plan'],
      constraints: ['确认后按约定范围处理。'],
      needsProjectAssets: false,
      needsVisualObservation: false,
      userVisibleSummary: '这是从零创作设计请求，需要先整理设计方向和可确认方案，确认后再创建画面。'
    },
    userVisibleState: {
      version: 'agent-user-visible-state/v0',
      category: 'planning',
      title: '整理设计方向',
      summary: '确认画面重点、版式、色彩和效果检查方式。',
      nextStep: '确认画面方向和验收方式后再继续。',
      toolUse: 'no_tools',
      canStartTools: false,
      userActionRequired: false
    },
    executionPlan: {
      mode: 'model_planning_required',
      canExecuteTools: false,
      requiresUserApproval: true,
      steps: [],
      verificationTargets: ['layer_hierarchy']
    },
    requiredInputs: ['design_brief'],
    blockers: [],
    warnings: [],
    boundaries: [],
    planningContext: [],
    qualityClaim: {
      canClaimDesignComplete: false,
      canClaimOutputQuality: false
    }
  };
  const pendingPublicPlan = {
    status: 'ready',
    canExecuteTools: false,
    message: '创建 790 宽临时详情页草稿，放入深色首屏、标题和三个卖点模块。',
    proposedWriteTools: ['createTextLayer'],
    writeToolAllowlist: ['createTextLayer'],
    readbackTargets: ['layer_hierarchy'],
    executionPlanSummary: '创建标题文字并读回图层结构。'
  };
  const pendingRequest = buildAgentTaskPublicPlanExecutionRequest({
    agentTaskPlan,
    publicPlan: pendingPublicPlan,
    runtimeAllowedWriteTools: ['createTextLayer'],
    userConfirmed: false,
    requestId: 'public-plan-confirm-smoke'
  });
  const sourceMessageId = 'assistant-public-plan-smoke';

  skillExecutors.getSkillExecutor = (skillId) => ({
    id: skillId,
    execute: async () => ({ success: true, message: `executed:${skillId}` })
  });
  skillExecutors.executeSkillWithExecutor = async (skillId, payload) => {
    executed.push({ skillId, params: payload?.params || {} });
    return { success: true, message: `executed:${skillId}`, data: { status: 'completed' } };
  };

  try {
    const result = await engine.run({
      ...createEngineContext('确认计划，开始执行'),
      conversationHistory: [
        {
          id: 'user-original-smoke',
          role: 'user',
          content: creativeDetailPageDraft
        },
        {
          id: sourceMessageId,
          role: 'assistant',
          content: pendingPublicPlan.message,
          agentTaskPlan,
          agentTaskPublicPlan: pendingPublicPlan,
          agentTaskPublicPlanExecutionRequest: pendingRequest
        }
      ],
      agentTaskPublicPlanApproval: {
        userConfirmed: true,
        sourceMessageId,
        requestId: 'public-plan-confirm-smoke',
        allowedWriteTools: ['createTextLayer'],
        enableControlledExecutionRequest: true,
        executionTarget: 'live-photoshop',
        allowPhotoshopWrites: true,
        liveExecutionScope: 'disposable-document',
        adapter: {
          async runWriteOperation(operation) {
            return { success: true, data: { layerId: 701, operationId: operation.operationId } };
          },
          async readbackAfterOperation(_operation, target) {
            return {
              success: true,
              data: {
                target,
                layers: [{
                  id: 701,
                  name: '标题-舒适透气运动袜',
                  kind: 'text',
                  visible: true,
                  contents: '舒适透气运动袜'
                }]
              }
            };
          }
        },
        runtimeOperationRequests: [
          {
            operationId: 'op-title',
            toolName: 'createTextLayer',
            params: {
              content: '舒适透气运动袜',
              x: 80,
              y: 120,
              fontSize: 44,
              colorHex: '#FFFFFF',
              name: '标题-舒适透气运动袜'
            },
            paramsSummary: '创建可编辑标题文字',
            readbackTargets: ['layer_hierarchy']
          }
        ]
      }
    }, {
      callModel: async () => {
        throw new Error('confirmed public plan should not start a new model/autonomous loop');
      }
    });

    assert(
      !executed.some((item) => item.skillId === 'autonomous-agent'),
      `confirmed public plan with executable operations must not enter the full autonomous loop: ${JSON.stringify({ executed, result })}`
    );
    assert.strictEqual(result?.success, true, `controlled public-plan run should return a visible result: ${JSON.stringify({ executed, result })}`);
    assert.strictEqual(
      result?.data?.agentTaskPublicPlanControlledRun?.status,
      'completed_live_adapter_verified',
      `controlled public-plan run should expose completed live adapter evidence: ${JSON.stringify(result?.data?.agentTaskPublicPlanControlledRun)}`
    );
    assert(
      !/createTextLayer|createDocument|renderLayout|layer_hierarchy|acceptance_snapshot|受控|读回|工具执行|已执行：|已检查：/.test(String(result?.message || '')),
      `controlled public-plan user message must describe the created design, not internal tools or readback: ${JSON.stringify(result?.message)}`
    );
    assert(
      /画面|标题|可编辑|复核/.test(String(result?.message || '')),
      `controlled public-plan user message should speak in user-facing design terms: ${JSON.stringify(result?.message)}`
    );
  } finally {
    skillExecutors.getSkillExecutor = originalGetSkillExecutor;
    skillExecutors.executeSkillWithExecutor = originalExecuteSkillWithExecutor;
  }
}

async function assertExplicitDeliveryPublicPlanRunsWithInitialApproval(projectDetailPageDeliveryBrief) {
  const engine = new DesignAgentEngine();
  const originalGetSkillExecutor = skillExecutors.getSkillExecutor;
  const originalExecuteSkillWithExecutor = skillExecutors.executeSkillWithExecutor;
  const executed = [];
  const adapterOperations = [];

  skillExecutors.getSkillExecutor = (skillId) => ({
    id: skillId,
    execute: async () => ({ success: true, message: `executed:${skillId}` })
  });
  skillExecutors.executeSkillWithExecutor = async (skillId, payload) => {
    executed.push({ skillId, params: payload?.params || {} });
    return { success: true, message: `executed:${skillId}`, data: { status: 'completed' } };
  };

  try {
    const result = await engine.run({
      ...createEngineContext(projectDetailPageDeliveryBrief),
      projectContext: {
        projectPath: 'E:/DesignEchoDemo/C-1194',
        projectImageCount: 8,
        projectImageFolders: [{ path: 'E:/DesignEchoDemo/C-1194/素材', imageCount: 8 }],
        sampleImagePaths: ['E:/DesignEchoDemo/C-1194/素材/sample-a.jpg']
      },
      agentTaskPublicPlanApproval: {
        userConfirmed: true,
        approveGeneratedPublicPlan: true,
        requestId: 'initial-detail-page-delivery-smoke',
        allowedWriteTools: [...DEFAULT_AGENT_TASK_PUBLIC_PLAN_WRITE_TOOL_ALLOWLIST, 'saveDocument'],
        enableControlledExecutionRequest: true,
        executionTarget: 'live-photoshop',
        allowPhotoshopWrites: true,
        liveExecutionScope: 'disposable-document',
        adapter: {
          async runWriteOperation(operation) {
            adapterOperations.push({ toolName: operation.toolName, params: operation.params });
            if (operation.toolName === 'createDocument') return { success: true, data: { documentId: 901, width: 790, height: 1600 } };
            if (operation.toolName === 'placeImage') return { success: true, layerId: 902, autoSelected: { selectedPath: 'E:/DesignEchoDemo/C-1194/素材/sample-a.jpg' } };
            if (operation.toolName === 'renderLayout') return { success: true, created: [{ id: 'hero-title', role: 'title' }] };
            if (operation.toolName === 'saveDocument') return { success: true, savePath: 'E:/DesignEchoDemo/C-1194/详情页/详情页.png', format: 'png' };
            return { success: false, error: `unexpected tool ${operation.toolName}` };
          },
          async readbackAfterOperation(_operation, target) {
            return { success: true, data: buildDetailPageVisibleCopyReadback(target) };
          }
        }
      }
    }, {
      callModel: async (_messages, options = {}) => {
        if (options.purpose === 'visible_reasoning') {
          return { text: '我会先理解项目素材，再完成 790 宽详情页长图并保存到详情页目录。' };
        }
        if (options.purpose === 'router') {
          return {
            text: JSON.stringify({
              route: 'autonomous_agent',
              intentSummary: '完成项目袜子详情页长图。',
              skillParams: {}
            })
          };
        }
        if (options.purpose === 'agent_task_public_plan') {
          return {
            text: JSON.stringify({
              message: '我会使用项目里最适合作为首屏的袜子图片，制作 790 宽详情页长图，包含首屏、核心卖点、材质透气、弹力贴合、耐磨和颜色搭配模块，并保存到详情页目录。',
              proposedWriteTools: ['createDocument', 'placeImage', 'renderLayout', 'saveDocument'],
              readbackTargets: ['document_info', 'acceptance_snapshot'],
              executionPlanSummary: '创建 790 宽详情页长图，置入项目袜子图，排版卖点模块并保存为 PNG。',
              operationRequests: [
                {
                  operationId: 'create-detail-page-document',
                  toolName: 'createDocument',
                  params: { width: 790, height: 1600, name: '电商袜子详情页长图', backgroundColor: 'transparent' },
                  paramsSummary: '新建 790 宽详情页画布',
                  readbackTargets: ['document_info']
                },
                {
                  operationId: 'place-hero-product-photo',
                  toolName: 'placeImage',
                  params: {
                    autoSelect: true,
                    selectionMode: 'auto',
                    requirement: '适合作为袜子详情页首屏的真实产品或模特图片',
                    name: '首屏产品图',
                    targetBounds: { x: 0, y: 900, width: 790, height: 520 },
                    targetFit: 'cover',
                    layerOrder: 'belowText'
                  },
                  paramsSummary: '选择并置入项目中的首屏袜子图片',
                  readbackTargets: ['layer_hierarchy']
                },
                {
                  operationId: 'render-detail-page-layout',
                  toolName: 'renderLayout',
                  params: {
                    canvas: { width: 790, height: 1600 },
                    stagePlan: buildDetailPageStagePlan({
                      productUnderstanding: '当前项目是电商袜子详情页长图，目标是用项目图片和可编辑文案突出舒适透气、弹力贴合、耐磨和颜色搭配。',
                      currentStage: {
                        id: 'detail-page-hero-and-selling-points',
                        title: '首屏与卖点承接',
                        purpose: '先完成详情页上半段的信息层级，让买家看到产品主题、真实图片和核心购买理由。',
                        sellingPoint: '舒适透气运动袜',
                        imageIntent: '选择项目中适合作为首屏的袜子真实产品或模特图片。',
                        layoutRoles: ['background', 'main-image', 'title', 'selling-point'],
                        observationFocus: '确认首屏图片没有盖住标题，标题和卖点清晰可读，保存前仍能看到全部计划文案。'
                      }
                    }),
                    blocks: [
                      { id: 'bg', role: 'background', content: '#101827', heightRatio: 1 },
                      { id: 'hero-title', role: 'title', content: '舒适透气运动袜', heightRatio: 0.13, widthRatio: 0.9, hAlign: 'center' },
                      { id: 'point-1', role: 'selling-point', content: '吸汗速干', heightRatio: 0.09, widthRatio: 0.84, hAlign: 'center' },
                      { id: 'point-2', role: 'selling-point', content: '弹力贴合', heightRatio: 0.09, widthRatio: 0.84, hAlign: 'center' },
                      { id: 'point-3', role: 'selling-point', content: '耐磨不易滑', heightRatio: 0.09, widthRatio: 0.84, hAlign: 'center' },
                      { id: 'point-4', role: 'selling-point', content: '颜色搭配建议', heightRatio: 0.09, widthRatio: 0.84, hAlign: 'center' }
                    ]
                  },
                  paramsSummary: '排版详情页标题和卖点模块',
                  readbackTargets: ['layer_hierarchy', 'acceptance_snapshot']
                },
                {
                  operationId: 'save-detail-page-export',
                  toolName: 'saveDocument',
                  params: { format: 'png', projectSubdir: '详情页', quality: 12 },
                  paramsSummary: '保存详情页长图到项目详情页目录',
                  readbackTargets: ['document_info']
                }
              ]
            })
          };
        }
        return { text: '{}' };
      }
    });

    assert(
      !executed.some((item) => item.skillId === 'autonomous-agent'),
      `explicit delivery with initial public-plan approval must not fall through into autonomous-agent executor: ${JSON.stringify({ executed, result })}`
    );
    assert.strictEqual(
      result?.data?.agentTaskPublicPlanControlledRun?.status,
      'completed_live_adapter_verified',
      `explicit delivery should run generated public-plan operations through the controlled runner: ${JSON.stringify(result)}`
    );
    assert(
      adapterOperations.map((operation) => operation.toolName).includes('saveDocument'),
      `explicit delivery controlled run should include a save/export operation: ${JSON.stringify(adapterOperations)}`
    );
    assert(
      !/saveDocument|createDocument|renderLayout|placeImage|adapter|runner|受控|工具执行|operationRequests/.test(String(result?.message || '')),
      `explicit delivery result message must stay user-facing: ${JSON.stringify(result?.message)}`
    );
  } finally {
    skillExecutors.getSkillExecutor = originalGetSkillExecutor;
    skillExecutors.executeSkillWithExecutor = originalExecuteSkillWithExecutor;
  }
}

async function assertExplicitDeliveryRepairsAfterReadbackMismatch(projectDetailPageDeliveryBrief) {
  const engine = new DesignAgentEngine();
  const originalGetSkillExecutor = skillExecutors.getSkillExecutor;
  const originalExecuteSkillWithExecutor = skillExecutors.executeSkillWithExecutor;
  const executed = [];

  skillExecutors.getSkillExecutor = (skillId) => ({
    id: skillId,
    execute: async () => ({ success: true, message: `executed:${skillId}` })
  });
  skillExecutors.executeSkillWithExecutor = async (skillId, payload) => {
    executed.push({ skillId, params: payload?.params || {} });
    return {
      success: true,
      message: '我看到首屏缺少卖点文字，已回到画面继续补齐并重新观察。',
      data: { status: 'autonomous-repair-started' }
    };
  };

  try {
    const result = await engine.run({
      ...createEngineContext(projectDetailPageDeliveryBrief),
      projectContext: {
        projectPath: 'E:/DesignEchoDemo/C-1194',
        projectImageCount: 8,
        projectImageFolders: [{ path: 'E:/DesignEchoDemo/C-1194/素材', imageCount: 8 }],
        sampleImagePaths: ['E:/DesignEchoDemo/C-1194/素材/sample-a.jpg']
      },
      agentTaskPublicPlanApproval: {
        userConfirmed: true,
        approveGeneratedPublicPlan: true,
        requestId: 'public-plan-readback-mismatch-repair-smoke',
        allowedWriteTools: [...DEFAULT_AGENT_TASK_PUBLIC_PLAN_WRITE_TOOL_ALLOWLIST],
        enableControlledExecutionRequest: true,
        executionTarget: 'live-photoshop',
        allowPhotoshopWrites: true,
        liveExecutionScope: 'disposable-document',
        adapter: {
          async runWriteOperation(operation) {
            if (operation.toolName === 'createDocument') return { success: true, data: { documentId: 910, width: 790, height: 1600 } };
            if (operation.toolName === 'renderLayout') return { success: true, created: [{ id: 'hero-title', role: 'title' }] };
            return { success: false, error: `unexpected tool ${operation.toolName}` };
          },
          async readbackAfterOperation(_operation, target) {
            return {
              success: true,
              data: {
                target,
                layers: [{
                  id: 9101,
                  name: '标题-舒适透气运动袜',
                  kind: 'text',
                  visible: true,
                  contents: '舒适透气运动袜'
                }]
              }
            };
          }
        }
      }
    }, {
      callModel: async (_messages, options = {}) => {
        if (options.purpose === 'visible_reasoning') {
          return { text: '我会先创建详情页首屏，之后观察画面并补齐缺失内容。' };
        }
        if (options.purpose === 'router') {
          return {
            text: JSON.stringify({
              route: 'autonomous_agent',
              intentSummary: '完成项目袜子详情页首屏。',
              skillParams: {}
            })
          };
        }
        if (options.purpose === 'agent_task_public_plan') {
          return {
            text: JSON.stringify({
              message: '我会先创建 790 宽详情页首屏，放入标题和三个卖点，完成后观察真实画面。',
              proposedWriteTools: ['createDocument', 'renderLayout'],
              readbackTargets: ['layer_hierarchy'],
              executionPlanSummary: '创建 790 宽详情页首屏，并确认标题和卖点真实在画面中。',
              operationRequests: [
                {
                  operationId: 'create-detail-page-document',
                  toolName: 'createDocument',
                  params: { width: 790, height: 1600, name: '临时详情页草稿-790x1600' },
                  paramsSummary: '新建 790 宽详情页画布',
                  readbackTargets: ['document_info']
                },
                {
                  operationId: 'render-detail-page-layout',
                  toolName: 'renderLayout',
                  params: {
                    canvas: { width: 790, height: 1600 },
                    stagePlan: buildDetailPageStagePlan({
                      currentStage: {
                        id: 'hero-readback-repair',
                        title: '首屏卖点复核',
                        purpose: '先创建首屏标题和卖点，随后通过读回判断是否需要修复缺失文案。',
                        sellingPoint: '舒适透气运动袜',
                        imageIntent: '本阶段先用可编辑文字和色块建立首屏信息，不使用外部素材。',
                        layoutRoles: ['background', 'title', 'selling-point'],
                        observationFocus: '确认标题和三个卖点都能在读回结果中看到。'
                      }
                    }),
                    blocks: [
                      { id: 'hero-title', role: 'title', content: '舒适透气运动袜', heightRatio: 0.16 },
                      { id: 'point-1', role: 'selling-point', content: '吸汗速干', heightRatio: 0.1 },
                      { id: 'point-2', role: 'selling-point', content: '弹力贴合', heightRatio: 0.1 },
                      { id: 'point-3', role: 'selling-point', content: '耐磨不易滑', heightRatio: 0.1 }
                    ]
                  },
                  paramsSummary: '排版详情页标题和卖点模块',
                  readbackTargets: ['layer_hierarchy']
                }
              ]
            })
          };
        }
        return { text: '{}' };
      }
    });

    assert(
      executed.some((item) => item.skillId === 'autonomous-agent'),
      `readback mismatch should be handed back to autonomous-agent for repair instead of stopping: ${JSON.stringify({ executed, result })}`
    );
    const repairRun = executed.find((item) => item.skillId === 'autonomous-agent');
    assert(
      /真实画面复核发现|继续修复|缺少/.test(String(repairRun?.params?.userTask || '')),
      `repair task should carry observation evidence back to the Agent: ${JSON.stringify(repairRun)}`
    );
    assert.strictEqual(
      result?.assistantReplyOrigin?.origin,
      'tool_result_summary',
      `repair fallback should return a tool summary origin, not a deterministic blocker: ${JSON.stringify(result?.assistantReplyOrigin)}`
    );
    assert(
      !/确认这些内容是否是你刚刚主动删除|需要你确认/.test(String(result?.message || '')),
      `readback mismatch should not ask the user to confirm system-observable missing content: ${JSON.stringify(result?.message)}`
    );
  } finally {
    skillExecutors.getSkillExecutor = originalGetSkillExecutor;
    skillExecutors.executeSkillWithExecutor = originalExecuteSkillWithExecutor;
  }
}

async function assertPublicPlanRepairsMissingRenderLayoutBlocksBeforeLiveRun(projectDetailPageDeliveryBrief) {
  const engine = new DesignAgentEngine();
  const originalGetSkillExecutor = skillExecutors.getSkillExecutor;
  const originalExecuteSkillWithExecutor = skillExecutors.executeSkillWithExecutor;
  const executed = [];
  const adapterOperations = [];
  let publicPlanCalls = 0;
  const publicPlanOffsets = [];

  const validOperationRequests = [
    {
      operationId: 'create-detail-page-document',
      toolName: 'createDocument',
      params: { width: 790, height: 1600, name: '电商袜子详情页长图', backgroundColor: 'transparent' },
      paramsSummary: '新建 790 宽详情页画布',
      readbackTargets: ['document_info']
    },
    {
      operationId: 'place-hero-product-photo',
      toolName: 'placeImage',
      params: {
        autoSelect: true,
        selectionMode: 'auto',
        requirement: '适合作为袜子详情页首屏的真实产品图片',
        name: '首屏产品图',
        targetBounds: { x: 0, y: 900, width: 790, height: 520 },
        targetFit: 'cover',
        layerOrder: 'belowText'
      },
      paramsSummary: '选择并置入项目中的首屏袜子图片',
      readbackTargets: ['layer_hierarchy']
    },
    {
      operationId: 'render-detail-page-layout',
      toolName: 'renderLayout',
      params: {
        canvas: { width: 790, height: 1600 },
        stagePlan: buildDetailPageStagePlan({
          currentStage: {
            id: 'detail-page-copy-structure',
            title: '详情页文案结构',
            purpose: '确认标题和卖点模块已经真实进入画面，再继续做图片和导出。',
            sellingPoint: '舒适透气运动袜',
            imageIntent: '本阶段聚焦可编辑文案和版式层级，不先堆叠商品图。',
            layoutRoles: ['background', 'title', 'selling-point'],
            observationFocus: '检查详情页标题、卖点模块和背景是否真实存在，确认文字没有被遗漏或重叠。'
          }
        }),
        blocks: [
          { id: 'bg', role: 'background', content: '#101827', heightRatio: 1 },
          { id: 'title', role: 'title', content: '舒适透气运动袜', heightRatio: 0.13, widthRatio: 0.9, hAlign: 'center' },
          { id: 'material', role: 'selling-point', content: '材质透气', heightRatio: 0.09, widthRatio: 0.84, hAlign: 'center' },
          { id: 'fit', role: 'selling-point', content: '弹力贴合', heightRatio: 0.09, widthRatio: 0.84, hAlign: 'center' },
          { id: 'durable', role: 'selling-point', content: '耐磨不易滑', heightRatio: 0.09, widthRatio: 0.84, hAlign: 'center' },
          { id: 'color', role: 'selling-point', content: '颜色搭配建议', heightRatio: 0.09, widthRatio: 0.84, hAlign: 'center' }
        ]
      },
      paramsSummary: '排版详情页标题和卖点模块',
      readbackTargets: ['layer_hierarchy', 'acceptance_snapshot']
    },
    {
      operationId: 'save-detail-page-export',
      toolName: 'saveDocument',
      params: { format: 'png', projectSubdir: '详情页', quality: 12 },
      paramsSummary: '保存详情页长图到项目详情页目录',
      readbackTargets: ['document_info']
    }
  ];

  skillExecutors.getSkillExecutor = (skillId) => ({
    id: skillId,
    execute: async () => ({ success: true, message: `executed:${skillId}` })
  });
  skillExecutors.executeSkillWithExecutor = async (skillId, payload) => {
    executed.push({ skillId, params: payload?.params || {} });
    return { success: true, message: `executed:${skillId}`, data: { status: 'completed' } };
  };

  try {
    const result = await engine.run({
      ...createEngineContext(projectDetailPageDeliveryBrief),
      projectContext: {
        projectPath: 'E:/DesignEchoDemo/C-1194',
        projectImageCount: 8,
        projectImageFolders: [{ path: 'E:/DesignEchoDemo/C-1194/素材', imageCount: 8 }],
        sampleImagePaths: ['E:/DesignEchoDemo/C-1194/素材/sample-a.jpg']
      },
      agentTaskPublicPlanApproval: {
        userConfirmed: true,
        approveGeneratedPublicPlan: true,
        requestId: 'repair-missing-render-layout-blocks-smoke',
        allowedWriteTools: [...DEFAULT_AGENT_TASK_PUBLIC_PLAN_WRITE_TOOL_ALLOWLIST, 'saveDocument'],
        enableControlledExecutionRequest: true,
        executionTarget: 'live-photoshop',
        allowPhotoshopWrites: true,
        liveExecutionScope: 'disposable-document',
        adapter: {
          async runWriteOperation(operation) {
            adapterOperations.push({ toolName: operation.toolName, params: operation.params });
            return { success: true, data: { operationId: operation.operationId } };
          },
          async readbackAfterOperation(_operation, target) {
            return { success: true, data: buildDetailPageVisibleCopyReadback(target) };
          }
        }
      }
    }, {
      callModel: async (_messages, options = {}) => {
        if (options.purpose === 'visible_reasoning') {
          return { text: '我会先理解项目素材，再完成 790 宽详情页长图并保存到详情页目录。' };
        }
        if (options.purpose === 'router') {
          return {
            text: JSON.stringify({
              route: 'autonomous_agent',
              intentSummary: '完成项目袜子详情页长图。',
              skillParams: {}
            })
          };
        }
        if (options.purpose === 'agent_task_public_plan') {
          publicPlanCalls += 1;
          publicPlanOffsets.push(options.modelCandidateOffset);
          return {
            text: JSON.stringify({
              message: '我会使用项目里最适合作为首屏的袜子图片，制作 790 宽详情页长图，包含首屏、核心卖点、材质透气、弹力贴合、耐磨和颜色搭配模块，并保存到详情页目录。',
              proposedWriteTools: ['createDocument', 'placeImage', 'renderLayout', 'saveDocument'],
              readbackTargets: ['document_info', 'acceptance_snapshot'],
              executionPlanSummary: '创建 790 宽详情页长图，置入项目袜子图，排版卖点模块并保存为 PNG。',
              operationRequests: publicPlanCalls === 1
                ? validOperationRequests.map((operation) => (
                  operation.toolName === 'renderLayout'
                    ? {
                        ...operation,
                        params: {
                          canvas: { width: 790, height: 1600 },
                          stagePlan: operation.params.stagePlan
                        }
                      }
                    : operation
                ))
                : validOperationRequests
            })
          };
        }
        return { text: '{}' };
      }
    });

    assert.strictEqual(
      publicPlanCalls,
      2,
      `engine should request one corrected public plan when renderLayout blocks are missing: ${JSON.stringify({ publicPlanCalls, result })}`
    );
    assert.strictEqual(
      result?.data?.agentTaskPublicPlanControlledRun?.status,
      'completed_live_adapter_verified',
      `repaired public plan should run successfully: ${JSON.stringify(result)}`
    );
    const renderLayoutOperation = adapterOperations.find((operation) => operation.toolName === 'renderLayout');
    assert(
      Array.isArray(renderLayoutOperation?.params?.blocks) && renderLayoutOperation.params.blocks.length >= 3,
      `corrected renderLayout operation should include executable blocks: ${JSON.stringify(adapterOperations)}`
    );
    assert(
      !executed.some((item) => item.skillId === 'autonomous-agent'),
      `repair flow must not fall through into autonomous-agent executor: ${JSON.stringify({ executed, result })}`
    );
  } finally {
    skillExecutors.getSkillExecutor = originalGetSkillExecutor;
    skillExecutors.executeSkillWithExecutor = originalExecuteSkillWithExecutor;
  }
}

async function assertPublicPlanRepairsInternalCopyAndImageBoundsBeforeLiveRun(projectDetailPageDeliveryBrief) {
  const engine = new DesignAgentEngine();
  const originalGetSkillExecutor = skillExecutors.getSkillExecutor;
  const originalExecuteSkillWithExecutor = skillExecutors.executeSkillWithExecutor;
  const executed = [];
  const adapterOperations = [];
  let publicPlanCalls = 0;
  const publicPlanOffsets = [];

  const validOperationRequests = [
    {
      operationId: 'create-detail-page-document',
      toolName: 'createDocument',
      params: { width: 790, height: 1800, name: '电商袜子详情页长图', backgroundColor: 'transparent' },
      paramsSummary: '新建 790 宽详情页画布',
      readbackTargets: ['document_info']
    },
    {
      operationId: 'place-hero-product-photo',
      toolName: 'placeImage',
      params: {
        autoSelect: true,
        selectionMode: 'auto',
        requirement: '适合作为袜子详情页首屏的真实产品图片',
        name: '首屏产品图',
        targetBounds: { x: 0, y: 900, width: 790, height: 420 },
        targetFit: 'cover',
        layerOrder: 'belowText'
      },
      paramsSummary: '选择并置入首屏袜子图片',
      readbackTargets: ['layer_hierarchy']
    },
    {
      operationId: 'place-material-detail-photo',
      toolName: 'placeImage',
      params: {
        autoSelect: true,
        selectionMode: 'auto',
        requirement: '适合作为袜子材质细节的真实产品图片',
        name: '材质细节图',
        targetBounds: { x: 52, y: 1360, width: 686, height: 360 },
        targetFit: 'cover',
        layerOrder: 'belowText'
      },
      paramsSummary: '选择并置入材质细节图片',
      readbackTargets: ['layer_hierarchy']
    },
    {
      operationId: 'render-detail-page-layout',
      toolName: 'renderLayout',
      params: {
        canvas: { width: 790, height: 1800 },
        stagePlan: buildDetailPageStagePlan({
          currentStage: {
            id: 'detail-page-selling-points',
            title: '详情页卖点排版',
            purpose: '建立详情页核心卖点和图片承接关系，方便后续观察画面是否完整。',
            sellingPoint: '吸汗速干、弹力贴合、耐磨不易滑',
            imageIntent: '用项目商品图承接首屏和材质细节，文案只保留买家能看到的卖点。',
            layoutRoles: ['background', 'main-image', 'title', 'selling-point'],
            observationFocus: '检查图片是否在画布内、文字是否为买家可读卖点，并确认内部说明没有出现在画面上。'
          }
        }),
        blocks: [
          { id: 'bg', role: 'background', content: '#0F172A', heightRatio: 1 },
          { id: 'title', role: 'title', content: '舒适透气运动袜', heightRatio: 0.12, widthRatio: 0.9, hAlign: 'center' },
          { id: 'dry', role: 'selling-point', content: '吸汗速干', heightRatio: 0.08, widthRatio: 0.82, hAlign: 'center' },
          { id: 'fit', role: 'selling-point', content: '弹力贴合', heightRatio: 0.08, widthRatio: 0.82, hAlign: 'center' },
          { id: 'durable', role: 'selling-point', content: '耐磨不易滑', heightRatio: 0.08, widthRatio: 0.82, hAlign: 'center' },
          { id: 'color', role: 'selling-point', content: '经典色日常百搭', heightRatio: 0.08, widthRatio: 0.82, hAlign: 'center' }
        ]
      },
      paramsSummary: '排版详情页标题和卖点模块',
      readbackTargets: ['layer_hierarchy', 'acceptance_snapshot']
    },
    {
      operationId: 'save-detail-page-export',
      toolName: 'saveDocument',
      params: { format: 'png', projectSubdir: '详情页', quality: 12 },
      paramsSummary: '保存详情页长图到项目详情页目录',
      readbackTargets: ['document_info']
    }
  ];

  const badOperationRequests = validOperationRequests.map((operation) => {
    if (operation.toolName === 'placeImage') {
      const isLowerImage = operation.operationId === 'place-material-detail-photo';
      return {
        ...operation,
        params: {
          autoSelect: true,
          selectionMode: 'auto',
          requirement: operation.params.requirement,
          name: operation.params.name,
          targetBounds: isLowerImage
            ? { x: 52, y: 1640, width: 686, height: 420 }
            : operation.params.targetBounds,
          targetFit: operation.params.targetFit
        }
      };
    }
    if (operation.toolName === 'renderLayout') {
      return {
        ...operation,
        params: {
          canvas: { width: 790, height: 1800 },
          stagePlan: operation.params.stagePlan,
          blocks: [
            { id: 'bg', role: 'background', content: '#FFFFFF', heightRatio: 1 },
            { id: 'material', role: 'selling-point', content: '材质/透气：使用项目素材中的材质细节图，说明袜子的透气科技', heightRatio: 0.12 }
          ]
        }
      };
    }
    return operation;
  });

  skillExecutors.getSkillExecutor = (skillId) => ({
    id: skillId,
    execute: async () => ({ success: true, message: `executed:${skillId}` })
  });
  skillExecutors.executeSkillWithExecutor = async (skillId, payload) => {
    executed.push({ skillId, params: payload?.params || {} });
    return { success: true, message: `executed:${skillId}`, data: { status: 'completed' } };
  };

  try {
    const result = await engine.run({
      ...createEngineContext(projectDetailPageDeliveryBrief),
      projectContext: {
        projectPath: 'E:/DesignEchoDemo/C-1194',
        projectImageCount: 8,
        projectImageFolders: [{ path: 'E:/DesignEchoDemo/C-1194/素材', imageCount: 8 }],
        sampleImagePaths: ['E:/DesignEchoDemo/C-1194/素材/sample-a.jpg']
      },
      agentTaskPublicPlanApproval: {
        userConfirmed: true,
        approveGeneratedPublicPlan: true,
        requestId: 'repair-internal-copy-image-bounds-smoke',
        allowedWriteTools: [...DEFAULT_AGENT_TASK_PUBLIC_PLAN_WRITE_TOOL_ALLOWLIST, 'saveDocument'],
        enableControlledExecutionRequest: true,
        executionTarget: 'live-photoshop',
        allowPhotoshopWrites: true,
        liveExecutionScope: 'disposable-document',
        adapter: {
          async runWriteOperation(operation) {
            adapterOperations.push({ toolName: operation.toolName, params: operation.params });
            return { success: true, data: { operationId: operation.operationId } };
          },
          async readbackAfterOperation(_operation, target) {
            return { success: true, data: buildDetailPageVisibleCopyReadback(target) };
          }
        }
      }
    }, {
      callModel: async (_messages, options = {}) => {
        if (options.purpose === 'visible_reasoning') {
          return { text: '我会先理解项目素材，再完成 790 宽详情页长图并保存到详情页目录。' };
        }
        if (options.purpose === 'router') {
          return {
            text: JSON.stringify({
              route: 'autonomous_agent',
              intentSummary: '完成项目袜子详情页长图。',
              skillParams: {}
            })
          };
        }
        if (options.purpose === 'agent_task_public_plan') {
          publicPlanCalls += 1;
          publicPlanOffsets.push(options.modelCandidateOffset);
          return {
            text: JSON.stringify({
              message: '我会使用项目里最适合作为首屏的袜子图片，制作 790 宽详情页长图，包含首屏、核心卖点、材质透气、弹力贴合、耐磨和颜色搭配模块，并保存到详情页目录。',
              proposedWriteTools: ['createDocument', 'placeImage', 'renderLayout', 'saveDocument'],
              readbackTargets: ['document_info', 'acceptance_snapshot'],
              executionPlanSummary: '创建 790 宽详情页长图，置入项目袜子图，排版卖点模块并保存为 PNG。',
              operationRequests: publicPlanCalls < 3 ? badOperationRequests : validOperationRequests
            })
          };
        }
        return { text: '{}' };
      }
    });

    assert.strictEqual(
      publicPlanCalls,
      3,
      `engine should keep repairing public plans until visible copy and image placement are executable: ${JSON.stringify({ publicPlanCalls, result })}`
    );
    assert.deepStrictEqual(
      publicPlanOffsets,
      [0, 1, 2],
      `public plan repair attempts should rotate model candidates instead of retrying the same first candidate: ${JSON.stringify(publicPlanOffsets)}`
    );
    assert.strictEqual(
      result?.data?.agentTaskPublicPlanControlledRun?.status,
      'completed_live_adapter_verified',
      `repaired public plan should run successfully: ${JSON.stringify(result)}`
    );
    const placeImageOperations = adapterOperations.filter((operation) => operation.toolName === 'placeImage');
    assert(
      placeImageOperations.length >= 2 && placeImageOperations.every((operation) => operation.params?.targetBounds),
      `corrected placeImage operations should include targetBounds: ${JSON.stringify(adapterOperations)}`
    );
    assert(
      placeImageOperations.every((operation) => operation.params?.layerOrder === 'belowText'),
      `corrected placeImage operations should keep images below visible text layers: ${JSON.stringify(adapterOperations)}`
    );
    const renderLayoutOperation = adapterOperations.find((operation) => operation.toolName === 'renderLayout');
    assert(
      !JSON.stringify(renderLayoutOperation?.params || {}).includes('使用项目素材'),
      `corrected renderLayout operation should not contain internal visible copy: ${JSON.stringify(renderLayoutOperation)}`
    );
    assert(
      !executed.some((item) => item.skillId === 'autonomous-agent'),
      `repair flow must not fall through into autonomous-agent executor: ${JSON.stringify({ executed, result })}`
    );
  } finally {
    skillExecutors.getSkillExecutor = originalGetSkillExecutor;
    skillExecutors.executeSkillWithExecutor = originalExecuteSkillWithExecutor;
  }
}

async function assertExplicitProjectDeliveryFallsBackToAutonomousLoopWhenPublicPlanUnavailable(projectDetailPageDeliveryBrief) {
  const engine = new DesignAgentEngine();
  const originalGetSkillExecutor = skillExecutors.getSkillExecutor;
  const originalExecuteSkillWithExecutor = skillExecutors.executeSkillWithExecutor;
  const executed = [];
  let publicPlanCalls = 0;
  const publicPlanOffsets = [];

  skillExecutors.getSkillExecutor = (skillId) => ({
    id: skillId,
    execute: async () => ({ success: true, message: `executed:${skillId}` })
  });
  skillExecutors.executeSkillWithExecutor = async (skillId, payload) => {
    executed.push({ skillId, params: payload?.params || {} });
    return { success: true, message: `executed:${skillId}`, data: { status: 'autonomous-loop-started' } };
  };

  try {
    const result = await engine.run({
      ...createEngineContext(projectDetailPageDeliveryBrief),
      projectContext: {
        projectPath: 'E:/DesignEchoDemo/C-1194',
        projectImageCount: 8,
        projectImageFolders: [{ path: 'E:/DesignEchoDemo/C-1194/素材', imageCount: 8 }],
        sampleImagePaths: ['E:/DesignEchoDemo/C-1194/素材/sample-a.jpg']
      },
      agentTaskPublicPlanApproval: {
        userConfirmed: true,
        approveGeneratedPublicPlan: true,
        requestId: 'public-plan-unavailable-autonomous-fallback-smoke',
        allowedWriteTools: [...DEFAULT_AGENT_TASK_PUBLIC_PLAN_WRITE_TOOL_ALLOWLIST, 'saveDocument'],
        enableControlledExecutionRequest: true,
        executionTarget: 'live-photoshop',
        allowPhotoshopWrites: true,
        liveExecutionScope: 'disposable-document'
      }
    }, {
      callModel: async (_messages, options = {}) => {
        if (options.purpose === 'visible_reasoning') {
          return { text: '我会先理解项目素材，再完成详情页长图。' };
        }
        if (options.purpose === 'router') {
          return {
            text: JSON.stringify({
              route: 'autonomous_agent',
              intentSummary: '完成项目袜子详情页长图。',
              skillParams: {}
            })
          };
        }
        if (options.purpose === 'agent_task_public_plan') {
          publicPlanCalls += 1;
          publicPlanOffsets.push(options.modelCandidateOffset);
          return { text: '这不是 JSON，也不是可执行公开计划。' };
        }
        return { text: '{}' };
      }
    });

    assert.strictEqual(
      publicPlanCalls,
      3,
      `unavailable public plan should be retried before autonomous fallback: ${JSON.stringify({ publicPlanCalls, result })}`
    );
    assert.deepStrictEqual(
      publicPlanOffsets,
      [0, 1, 2],
      `unavailable public plan retries should rotate model candidates: ${JSON.stringify(publicPlanOffsets)}`
    );
    assert(
      executed.some((item) => item.skillId === 'autonomous-agent'),
      `explicit project delivery should fall back to autonomous loop after public plan failure: ${JSON.stringify({ executed, result })}`
    );
    assert.strictEqual(
      result?.assistantReplyOrigin?.origin,
      'tool_result_summary',
      `autonomous fallback should return a tool summary origin: ${JSON.stringify(result?.assistantReplyOrigin)}`
    );
  } finally {
    skillExecutors.getSkillExecutor = originalGetSkillExecutor;
    skillExecutors.executeSkillWithExecutor = originalExecuteSkillWithExecutor;
  }
}

async function assertAutonomousAgentStopsBeforeModelWhenPhotoshopBridgeNotReady(projectDetailPageDeliveryBrief) {
  let modelCalls = 0;
  const originalWindow = global.window;
  global.window = {
    designEcho: {
      getDesignState: async () => ({ success: true, state: null }),
      chatWithTools: async () => {
        modelCalls += 1;
        return { content: '模型不应该在桥接不可用时被调用。', toolCalls: [] };
      }
    }
  };

  try {
    const result = await autonomousAgentExecutor.execute({
      params: {
        userTask: projectDetailPageDeliveryBrief,
        skillId: 'autonomous-agent',
        agentIntentControlPlane: decide(projectDetailPageDeliveryBrief),
        photoshopBridgeReadiness: {
          ready: false,
          healthStatus: 'photoshop_plugin_message_loop_stale',
          blockers: ['Photoshop 插件暂时没有响应。'],
          recoveryActions: ['请在 UXP Developer Tool 中重载插件。']
        }
      },
      callbacks: {},
      signal: undefined,
      context: createEngineContext(projectDetailPageDeliveryBrief)
    });

    assert.strictEqual(modelCalls, 0, `autonomous agent must not call the model when Photoshop bridge is not ready: ${modelCalls}`);
    assert.strictEqual(result.success, false, `bridge-not-ready result should stop execution: ${JSON.stringify(result)}`);
    assert(
      /Photoshop.*暂时无法处理|重载插件|重新打开 Photoshop/.test(String(result.message || '')),
      `bridge-not-ready message should be user-recoverable and non-technical: ${JSON.stringify(result)}`
    );
  } finally {
    global.window = originalWindow;
  }
}

async function main() {
  const creativeMainImageDraft = '请新建一个 800x800 的临时主图草稿画布，主题是电商袜子主图。只做最小可验收效果：深色背景、一个标题“舒适透气运动袜”、三个卖点“吸汗速干 / 弹力贴合 / 耐磨不易滑”，使用可编辑文字图层和简单色块排版，不要使用外部素材，不要导出。完成后请说明创建了哪些可编辑图层。';
  const creativeDetailPageDraft = '请新建一个 790 宽的临时详情页草稿，主题是电商袜子详情页。只做最小可验收效果：深色首屏、标题“舒适透气运动袜”、三个卖点模块“吸汗速干 / 弹力贴合 / 耐磨不易滑”，使用可编辑文字图层和简单色块排版，不要使用外部素材，不要导出。完成后说明创建了哪些可编辑图层。';
  const creativeDetailPageDraftWithBookQuotes = '请新建一个 790 宽的临时详情页草稿，主题是电商袜子详情页。只做最小可验收效果：深色首屏、标题为《舒适透气运动袜》、三个卖点模块为《吸汗速干》《弹力贴合》《耐磨不易滑》，使用可编辑文字图层和简单色块排版，不要使用外部素材，不要导出。完成后说明创建了哪些可编辑图层。';
  const projectDetailPageDeliveryBrief = '请使用当前项目 E:\\DesignEchoDemo\\C-1194 的图片，完成一个可验收的电商袜子详情页长图：宽度 790px，高度按内容自然展开，至少包含首屏氛围、核心卖点、材质/透气、弹力贴合、耐磨不易滑、颜色/搭配建议这几个模块。不要做空模板或占位图，不要直接套脚本模板；请根据项目素材选择合适图片并排版。请把结果导出到项目的“详情页”目录，完成后读回导出文件并说明哪个文件可以验收。';
  const projectDetailPageDocumentNameBrief = '请基于当前项目 E:\\DesignEchoDemo\\C-1194 的素材从零创建一个电商袜子详情页文档。详情页文档按名称识别，详情页就是详情页；如果当前打开的是 SKU 文档，不要把 SKU 当详情页模板。请先读取项目素材并自己判断卖点和排版方向，不要直接问我。';
  assert.strictEqual(
    getSkillById('main-image-template-authoring'),
    undefined,
    'main-image template skeleton workflow must be removed from the user-facing skill registry'
  );
  assert.strictEqual(
    getSkillById('detail-page-template-authoring'),
    undefined,
    'detail-page template skeleton workflow must be removed from the user-facing skill registry'
  );
  assert(
    DEFAULT_AGENT_TASK_PUBLIC_PLAN_WRITE_TOOL_ALLOWLIST.includes('renderLayout'),
    'public plan confirmation must allow renderLayout so simple editable drafts can execute as one layout operation'
  );
  assert(
    DEFAULT_AGENT_TASK_PUBLIC_PLAN_WRITE_TOOL_ALLOWLIST.includes('saveDocument'),
    'public plan confirmation must allow saveDocument so explicit delivery requests can export without a dialog'
  );
  assert.strictEqual(
    skillExecutors.getSkillExecutor('main-image-template-authoring'),
    undefined,
    'main-image template skeleton executor must not be registered at runtime'
  );
  assert.strictEqual(
    skillExecutors.getSkillExecutor('detail-page-template-authoring'),
    undefined,
    'detail-page template skeleton executor must not be registered at runtime'
  );
  assert.strictEqual(
    normalizeSkillId('main-image-template'),
    'main-image-template',
    'main-image-template alias must not normalize to a removed skeleton executor'
  );
  assert.strictEqual(
    normalizeSkillId('detail-page-template'),
    'detail-page-template',
    'detail-page-template alias must not normalize to a removed skeleton executor'
  );
  assert.strictEqual(
    matchesSkillRoutingIntent('main-image-template-authoring', '帮我创建主图模板'),
    false,
    'shared skill routing must not match the removed main-image template skeleton workflow'
  );
  assert.strictEqual(
    matchesSkillRoutingIntent('detail-page-template-authoring', '帮我从零做一个详情页模板'),
    false,
    'shared skill routing must not match the removed detail-page template skeleton workflow'
  );
  assert.strictEqual(
    hasExplicitGeneratedPublicPlanApproval({}),
    false,
    'task text without a pending-plan source cannot authorize generated public-plan execution'
  );
  for (const untrustedApprovalText of [
    '使用项目素材做一张详情页。',
    '新建临时主图草稿画布。',
    '请完成主图并保存到项目目录，确保可以验收。',
    '我确认计划并执行。'
  ]) {
    assert.strictEqual(
      hasExplicitGeneratedPublicPlanApproval({
        sourceMessageId: '',
        sourceRequestStatus: untrustedApprovalText
      }),
      false,
      `plain text must never stand in for an explicit generated public-plan confirmation event: ${untrustedApprovalText}`
    );
  }
  assert.strictEqual(
    hasExplicitGeneratedPublicPlanApproval({
      sourceMessageId: 'pending-public-plan-message',
      sourceRequestStatus: 'blocked_pending_user_confirmation'
    }),
    true,
    'a traced pending plan plus an explicit UI confirmation event may authorize controlled execution'
  );
  assert.notStrictEqual(
    fastDeterministicRoute('帮我创建主图模板')?.skillId,
    'main-image-template-authoring',
    'deterministic routing must not route any request to the removed main-image template skeleton workflow'
  );
  assert.notStrictEqual(
    fastDeterministicRoute('帮我从零做一个详情页模板')?.skillId,
    'detail-page-template-authoring',
    'deterministic routing must not route any request to the removed detail-page template skeleton workflow'
  );
  assert.strictEqual(
    matchesSkillRoutingIntent('ecommerce-socks-design', creativeDetailPageDraft),
    false,
    'single fresh detail-page draft must not match the whole-project e-commerce socks parent workflow'
  );
  assert.strictEqual(
    isEcommerceSocksDesignIntent(creativeDetailPageDraft),
    false,
    'single fresh detail-page draft must not enter the e-commerce socks parent coordinator'
  );
  assert.notStrictEqual(
    fastDeterministicRoute(projectDetailPageDocumentNameBrief)?.skillId,
    'document-management',
    'project-grounded fresh detail-page document design must not be reduced to plain document creation'
  );
  assert.strictEqual(
    extractDocumentManagementRoutingParams(projectDetailPageDocumentNameBrief, 'create').name,
    '详情页',
    'document-management fallback must never create a detail-page document named after the wording “名称识别”'
  );
  assert.notStrictEqual(
    fastDeterministicRoute(creativeDetailPageDraft)?.skillId,
    'ecommerce-socks-design',
    'fresh detail-page draft creation must not route to the parent e-commerce socks coordinator'
  );
  const creativeDecision = decide(creativeMainImageDraft);
  const creativeDetailDecision = decide(creativeDetailPageDraft);
  const projectDetailPageDeliveryDecision = decide(projectDetailPageDeliveryBrief);
  const projectDetailPageDocumentNameDecision = decide(projectDetailPageDocumentNameBrief);
  assert.strictEqual(
    projectDetailPageDeliveryDecision.requestKind,
    'autonomous_execution',
    'project-grounded fresh detail-page delivery should enter the autonomous design loop'
  );
  assert.strictEqual(
    projectDetailPageDocumentNameDecision.requestKind,
    'autonomous_execution',
    `project-grounded fresh detail-page document design should enter the autonomous design loop, got ${JSON.stringify(projectDetailPageDocumentNameDecision)}`
  );
  assert.strictEqual(
    creativeDecision.requestKind,
    'autonomous_execution',
    `creative main-image document draft must enter autonomous execution, got ${JSON.stringify(creativeDecision)}`
  );
  assert.strictEqual(creativeDecision.toolScope, 'write_photoshop');
  assert.strictEqual(creativeDecision.allowsAutonomousExecution, true);
  assert(
    creativeDecision.matchedSignals.includes('explicit_creative_design'),
    `expected explicit_creative_design signal, got ${creativeDecision.matchedSignals.join(',')}`
  );
  assert.strictEqual(
    creativeDetailDecision.requestKind,
    'autonomous_execution',
    `creative detail-page draft must enter autonomous execution, got ${JSON.stringify(creativeDetailDecision)}`
  );
  assert(
    creativeDetailDecision.matchedSignals.includes('explicit_creative_design'),
    `expected explicit_creative_design signal for detail-page draft, got ${creativeDetailDecision.matchedSignals.join(',')}`
  );
  assert(
    !/自主设计循环|公开计划|门禁|执行循环/.test(String(creativeDetailDecision.userVisibleSummary || '')),
    `creative design user-visible summary must not expose internal planning topology: ${creativeDetailDecision.userVisibleSummary}`
  );

  const autonomousExecutorSource = require('fs').readFileSync(
    path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'skill-executors', 'autonomous-agent.executor.ts'),
    'utf8'
  );
  // Harness 只消费通用安全/证据守卫；manifest 提供可扩展种子，不能退化为品类封闭白名单。
  assert(
    autonomousExecutorSource.includes('evaluateDesignToolStateGuard')
      && autonomousExecutorSource.includes('resolveAutonomousCapabilityRuntime')
      && autonomousExecutorSource.includes('REQUEST_AGENT_CAPABILITIES_TOOL_NAME')
      && !autonomousExecutorSource.includes('buildDesignDisciplineToolPolicy'),
    'autonomous executor must keep the generic evidence guard without a category tool-policy cage'
  );
  // createDocument 结果一致性校验仍在执行器侧（去品类化：文档名用 disciplineContext.canonicalDocumentName）。
  assert(
    autonomousExecutorSource.includes('buildCreateDocumentResultMismatch')
      && autonomousExecutorSource.includes('createDocument_result_mismatch')
      && autonomousExecutorSource.includes('不能继续在错误文档上排版'),
    'fresh design executor must reject createDocument results that point to the wrong active document'
  );

  assert.strictEqual(
    typeof selectToolsForContext,
    'function',
    'autonomous executor must expose context-aware tool selection for regression testing'
  );
  assert.strictEqual(
    typeof evaluateDesignToolStateGuard,
    'function',
    'generic design-discipline guard must be available for regression testing'
  );
  // 详情页设计纪律上下文（创意意图 + 命中详情页任务类型 → active）。
  const deliveryDisciplineContext = resolveDesignDisciplineContext({
    taskText: projectDetailPageDeliveryBrief,
    isCreativeDesignIntent: true
  });
  assert(
    deliveryDisciplineContext.active && deliveryDisciplineContext.taskTypeId === 'ecommerce.detail_page.v1',
    `project detail-page delivery brief must activate the detail-page design discipline: ${JSON.stringify(deliveryDisciplineContext)}`
  );

  // placeImage 是正常 Photoshop 构图动作；是否在 renderLayout 前后都由 Agent 基于画面决定。
  const postLayoutFreePlacementGuard = evaluateDesignToolStateGuard({
    context: deliveryDisciplineContext,
    state: createDesignDisciplineState({
      documentCreated: true,
      layoutRendered: true,
      designKnowledgeReadCount: 1,
      needsObservationAfterMutation: false
    }),
    toolName: 'placeImage'
  });
  assert.strictEqual(
    postLayoutFreePlacementGuard,
    null,
    `the generic guard must not prohibit placeImage after renderLayout: ${JSON.stringify(postLayoutFreePlacementGuard)}`
  );
  // 素材理解次数不再强制转成「下一步必须建档」；停止条件由 Agent 和运行预算判断。
  const preDocumentAnalysisBudgetGuard = evaluateDesignToolStateGuard({
    context: deliveryDisciplineContext,
    state: createDesignDisciplineState({
      documentCreated: false,
      layoutRendered: false,
      preDocumentAssetAnalysisCount: 4
    }),
    toolName: 'analyzeAssetContent'
  });
  assert.strictEqual(
    preDocumentAnalysisBudgetGuard,
    null,
    `the generic guard must not force asset analysis into createDocument: ${JSON.stringify(preDocumentAnalysisBudgetGuard)}`
  );
  // 通用 Harness 不再强制「先读方法论才能建档」；显式 reference-first Skill policy 仍单独测试。
  const preDocumentKnowledgeGuard = evaluateDesignToolStateGuard({
    context: deliveryDisciplineContext,
    state: createDesignDisciplineState({
      documentCreated: false,
      layoutRendered: false,
      designKnowledgeReadCount: 0
    }),
    toolName: 'createDocument'
  });
  assert.strictEqual(
    preDocumentKnowledgeGuard,
    null,
    `the generic guard must not force a knowledge-to-document sequence: ${JSON.stringify(preDocumentKnowledgeGuard)}`
  );
  // Harness 契约翻转（2026-07-08，真机病例"帮我导出主图详情页"被误判从零设计）：
  // 建画布前读旧文档快照是正当观察，不再拦成 createDocument。Observation 必须永远畅通——
  // Agent 先看清现有文档是什么，才能纠正"导出/编辑"被误判成"从零设计"。防套版/防旁建由写路径门禁保证。
  const preDocumentSnapshotGuard = evaluateDesignToolStateGuard({
    context: deliveryDisciplineContext,
    state: createDesignDisciplineState({
      documentCreated: false,
      layoutRendered: false,
      designKnowledgeReadCount: 1
    }),
    toolName: 'getAcceptanceSnapshot'
  });
  assert(
    preDocumentSnapshotGuard === null,
    `Harness: observation snapshot before canvas creation must be allowed (Observation always flows): ${JSON.stringify(preDocumentSnapshotGuard)}`
  );
  // 交互卡和团队协作都是通用能力，不再被「先建档」或品类关键词约束。
  const preDocumentInteractionGuard = evaluateDesignToolStateGuard({
    context: deliveryDisciplineContext,
    state: createDesignDisciplineState({
      documentCreated: false,
      layoutRendered: false,
      designKnowledgeReadCount: 1
    }),
    toolName: 'createInteractiveCard'
  });
  assert.strictEqual(
    preDocumentInteractionGuard,
    null,
    `the generic guard must allow createInteractiveCard before document creation: ${JSON.stringify(preDocumentInteractionGuard)}`
  );
  assert.strictEqual(
    evaluateDesignToolStateGuard({
      context: deliveryDisciplineContext,
      state: createDesignDisciplineState({}),
      toolName: 'delegateToAgent'
    }),
    null,
    'the generic guard must not block team capabilities'
  );
  assert.strictEqual(
    evaluateDesignToolStateGuard({
      context: deliveryDisciplineContext,
      state: createDesignDisciplineState({}),
      toolName: 'futureRegisteredDesignCapability'
    }),
    null,
    'the generic guard must not implement an allowlist that blocks future capabilities'
  );
  // 改后未复核就保存 → 拦截，指向针对性观察。
  const postLayoutSaveGuard = evaluateDesignToolStateGuard({
    context: deliveryDisciplineContext,
    state: createDesignDisciplineState({
      documentCreated: true,
      layoutRendered: true,
      designKnowledgeReadCount: 1,
      needsObservationAfterMutation: true,
      observationIntent: 'stage_readiness'
    }),
    toolName: 'saveDocument'
  });
  assert(
    postLayoutSaveGuard?.success === false
      && ['getAnnotatedSnapshot', 'getCanvasSnapshot'].includes(postLayoutSaveGuard?.nextRequiredTool),
    `design guard must require visual observation before export: ${JSON.stringify(postLayoutSaveGuard)}`
  );
  assert(
    /真实画面|观察|截图|复核/.test(String(postLayoutSaveGuard?.error || '')),
    `post-layout save guard should explain that the agent must observe the real canvas first: ${JSON.stringify(postLayoutSaveGuard)}`
  );
  const plainTextDetailRuntime = resolveAutonomousCapabilityRuntime({
    userTask: creativeDetailPageDraft,
    agentIntentControlPlane: creativeDetailDecision
  }, createEngineContext(creativeDetailPageDraft));
  const plainTextDetailResolution = plainTextDetailRuntime.capabilitySession.getResolution();
  const plainTextDetailToolNames = plainTextDetailRuntime.capabilitySession.activeTools.map((tool) => tool.name);
  const plainTextDetailOnDemand = plainTextDetailResolution.onDemandCapabilityIds;
  assert.strictEqual(
    plainTextDetailRuntime.runtimeContractBundle,
    undefined,
    'plain task text and regex-derived discipline state must not select a business Capability manifest'
  );
  assert.strictEqual(plainTextDetailResolution.selectionMode, 'broad_discovery');
  assert(!plainTextDetailToolNames.includes('detail-page-design'));
  assert(plainTextDetailOnDemand.includes('skill.detail-page-design'));

  const creativeDetailRuntime = resolveAutonomousCapabilityRuntime({
    userTask: creativeDetailPageDraft,
    declaredSkillId: 'detail-page-design',
    agentIntentControlPlane: creativeDetailDecision
  }, createEngineContext(creativeDetailPageDraft));
  const creativeDetailTools = creativeDetailRuntime.capabilitySession.activeTools;
  const creativeDetailToolNames = creativeDetailTools.map((tool) => tool.name);
  const creativeDetailOnDemand = creativeDetailRuntime.capabilitySession.getResolution().onDemandCapabilityIds;
  const genericCreativeTask = '请从零设计一张夏日促销海报，尺寸 1080x1350';
  const genericCreativeDecision = decide(genericCreativeTask);
  const genericCreativeRuntime = resolveAutonomousCapabilityRuntime({
    userTask: genericCreativeTask,
    agentIntentControlPlane: genericCreativeDecision
  }, createEngineContext(genericCreativeTask));
  const genericCreativeToolNames = genericCreativeRuntime.capabilitySession.activeTools.map((tool) => tool.name);
  const genericCreativeOnDemand = genericCreativeRuntime.capabilitySession.getResolution().onDemandCapabilityIds;
  for (const detailPageCapability of [
    'detail-page-design',
    'parseDetailPageTemplate',
    'detectLayerIssues',
    'matchDetailPageContent',
    'fillDetailPage',
    'exportDetailPageSlices',
    'delegateToAgent',
    'runDesignTeamPipeline',
    'createInteractiveCard',
    'createTextLayer',
    'getLayerHierarchy',
    'searchEagleReferences',
    'requestAgentCapabilities'
  ]) {
    assert(
      creativeDetailToolNames.includes(detailPageCapability),
      `creative detail-page work must keep registered capability ${detailPageCapability} visible: ${creativeDetailToolNames.join(', ')}`
    );
  }
  for (const detailOnDemandCapability of [
    'project.read.analyzeProjectForDetailPage',
    'photoshop.write.createGroup',
    'photoshop.write.moveLayer',
    'observation.read.describeImage',
    'skill.design-reference-search'
  ]) {
    assert(
      creativeDetailOnDemand.includes(detailOnDemandCapability),
      `detail-page Planner must be able to load ${detailOnDemandCapability} on demand`
    );
  }
  // Generic creative work keeps universal creation/observation exits and discovers extra Skills/Tools compactly.
  for (const genericCapability of [
    'delegateToAgent',
    'runDesignTeamPipeline',
    'createInteractiveCard',
    'createTextLayer',
    'placeImage',
    'getLayerHierarchy',
    'searchEagleReferences',
    'requestAgentCapabilities'
  ]) {
    assert(
      genericCreativeToolNames.includes(genericCapability),
      `generic creative work must keep representative registered capability ${genericCapability} visible: ${genericCreativeToolNames.join(', ')}`
    );
  }
  for (const genericOnDemandCapability of [
    'skill.detail-page-design',
    'skill.document-management',
    'skill.design-reference-search',
    'photoshop.write.createGroup',
    'photoshop.write.moveLayer',
    'observation.read.describeImage'
  ]) {
    assert(
      genericCreativeOnDemand.includes(genericOnDemandCapability),
      `generic creative Planner must be able to load ${genericOnDemandCapability} on demand`
    );
  }
  for (const removedCapability of ['main-image-template-authoring', 'detail-page-template-authoring']) {
    assert(
      !creativeDetailToolNames.includes(removedCapability)
        && !genericCreativeToolNames.includes(removedCapability),
      `removed legacy capability must stay absent from registries: ${removedCapability}`
    );
  }
  assert(
    creativeDetailToolNames.includes('createDocument')
      && creativeDetailToolNames.includes('renderLayout')
      && creativeDetailToolNames.includes('placeImage')
      && creativeDetailToolNames.includes('getAnnotatedSnapshot')
      && creativeDetailToolNames.includes('saveDocument')
      && creativeDetailToolNames.includes('searchDesignKnowledge'),
    `fresh detail-page draft should keep high-level creation/export tools available: ${creativeDetailToolNames.join(', ')}`
  );

  const documentOnly = '帮我新建一个 800x800 的文档';
  const documentDecision = decide(documentOnly);
  assert.strictEqual(
    documentDecision.requestKind,
    'execute_skill',
    `plain document creation should stay document-management, got ${JSON.stringify(documentDecision)}`
  );
  assert(
    documentDecision.matchedSignals.includes('shared_skill_routing:document-management')
      || documentDecision.matchedSignals.includes('explicit_skill_execution'),
    `expected document-management signal, got ${documentDecision.matchedSignals.join(',')}`
  );

  const internalReasoningLeak = '嗯，用户让我新建一个主图草稿。首先，我得仔细看看用户的要求。我需要确保回复只有一到两句话，不能提工具名。';
  assert.strictEqual(
    sanitizeUserVisibleThinkingText(internalReasoningLeak),
    '',
    'private reasoning draft must not be shown to the user'
  );

  const publicPlan = '我会先搭一个临时主图草稿，包含深色背景、标题和三个卖点文字，完成后再说明哪些内容可以继续修改。';
  assert.strictEqual(
    sanitizeUserVisibleThinkingText(publicPlan),
    publicPlan,
    'normal user-facing plan text should remain visible'
  );

  await assertCreativeDraftDoesNotShortCircuitToDocumentManagement(creativeMainImageDraft);
  await assertCreativeDraftRejectsTemplateRouterDecision(creativeMainImageDraft);
  await assertCreativeDetailSkillCandidateStaysInsideAutonomousLoop(creativeDetailPageDraft);
  await assertCreativeDetailSkillCandidateStaysInsideAutonomousLoop(creativeDetailPageDraftWithBookQuotes);
  await assertConfirmedPublicPlanUsesControlledRunInsteadOfAutonomousLoop(creativeDetailPageDraft);
  await assertExplicitDeliveryPublicPlanRunsWithInitialApproval(projectDetailPageDeliveryBrief);
  await assertExplicitDeliveryRepairsAfterReadbackMismatch(projectDetailPageDeliveryBrief);
  await assertPublicPlanRepairsMissingRenderLayoutBlocksBeforeLiveRun(projectDetailPageDeliveryBrief);
  await assertPublicPlanRepairsInternalCopyAndImageBoundsBeforeLiveRun(projectDetailPageDeliveryBrief);
  await assertExplicitProjectDeliveryFallsBackToAutonomousLoopWhenPublicPlanUnavailable(projectDetailPageDeliveryBrief);
  await assertAutonomousAgentStopsBeforeModelWhenPhotoshopBridgeNotReady(projectDetailPageDeliveryBrief);

  console.log(JSON.stringify({
    success: true,
    checks: [
      'creative main-image draft document enters autonomous execution',
      'plain document creation remains document-management',
      'private reasoning draft is hidden from user-visible thinking',
      'normal user-facing plan remains visible',
      'plain task text never grants generated public-plan approval without an explicit confirmation event',
      'creative main-image draft does not short-circuit to document-management',
      'creative main-image draft rejects template skeleton router decisions',
      'model-selected detail-page Skill remains a capability candidate inside the autonomous loop instead of direct workflow execution',
      'creative detail-page requests enter autonomous execution without redefining the Skill as template-only',
      'creative detail-page draft preserves title and selling points when the user uses Chinese book-title quotes',
      'confirmed public-plan operations return controlled-run evidence instead of entering another autonomous loop',
      'explicit project delivery requests can run generated public-plan operations through the controlled runner',
      'readback mismatches are handed back to autonomous-agent for repair instead of asking the user to confirm',
      'public-plan repair rejects internal visible copy and overlapping multi-image placement',
      'explicit project delivery falls back to autonomous loop when public plan stays unavailable',
      'autonomous agent stops before model/tool execution when Photoshop bridge is not ready',
      'autonomous creative drafts keep registered Skills and atomic Tools visible while removed legacy capabilities stay absent'
    ]
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
