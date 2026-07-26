const fs = require('fs');
const path = require('path');
require('ts-node').register({ transpileOnly: true, project: path.resolve(__dirname, '..', 'tsconfig.main.json') });

const { Agent } = require(path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'agent-runtime', 'agent.ts'));
const { DesignAgentEngine } = require(path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'design-agent', 'engine.ts'));
const {
  buildAgentIntentControlPlaneDecision
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'agent-intent-control-plane.ts'));
const {
  evaluateDeterministicNonExecutionProtection,
  evaluateDeterministicRouteVeto,
  shouldEnterConversationalRoute
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'agent-route-boundary-policy.ts'));
const {
  detectLightweightIntent,
  fastDeterministicRoute
} = require(path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'agent-orchestration', 'routing.ts'));
const conversational = require(path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'agent-orchestration', 'conversational.ts'));

function assert(condition, message, details) {
  if (!condition) {
    const error = new Error(message);
    error.details = details;
    throw error;
  }
}

async function assertAgentDoesNotForceToolsForChatOnlyIntent() {
  const intentControlPlane = buildAgentIntentControlPlaneDecision({
    userInput: '我问你会做SKU吗',
    hasImageInput: false,
    hasDocument: true,
    photoshopConnected: true
  });
  assert(intentControlPlane.requestKind === 'chat_only', 'SKU capability question should stay chat_only.', intentControlPlane);
  assert(intentControlPlane.toolScope === 'none', 'SKU capability question should not authorize tools.', intentControlPlane);
  assert(
    detectLightweightIntent('我问你会做SKU吗') === 'capability',
    'SKU capability question should use the capability conversational audience, not generic chat.',
    { lightweightIntent: detectLightweightIntent('我问你会做SKU吗') }
  );

  let modelCalls = 0;
  let forcedToolNudgeSeen = false;
  const stepIssues = [];
  const agent = new Agent(
    {
      systemPrompt: '你是测试 Agent。用户只是在问能力时，直接回答，不要调用工具。',
      tools: [
        {
          name: 'getDocumentInfo',
          description: 'Read current document information.',
          inputSchema: { type: 'object', properties: {} }
        }
      ],
      modelId: 'test-model',
      maxIterations: 3,
      toolDecisionContext: {
        intentControlPlane,
        photoshopConnected: true,
        hasDocument: true,
        hasImageInput: false
      },
      callbacks: {
        onStep: (step) => {
          if (step.issue) stepIssues.push(step.issue);
        }
      }
    },
    async (_modelId, messages) => {
      modelCalls += 1;
      const text = messages.map((message) => String(message.content || '')).join('\n');
      if (/MUST call a tool now|不要用文字回答，请直接调用工具执行任务/i.test(text)) {
        forcedToolNudgeSeen = true;
      }
      return {
        content: '我可以做 SKU 组合图和自选备注；这句话只是能力询问，所以本轮不调用工具。',
        toolCalls: []
      };
    },
    async () => ({ success: true })
  );

  const result = await agent.run('我问你会做SKU吗');
  assert(result.message.includes('能力询问'), 'Chat-only Agent response should come from the first model text.', result);
  assert(modelCalls === 1, 'Chat-only Agent must not spend extra rounds forcing an initial tool call.', { modelCalls });
  assert(!forcedToolNudgeSeen, 'Chat-only Agent must not inject MUST-call-tool nudges.', { forcedToolNudgeSeen });
  assert(!stepIssues.includes('missing_initial_tool_call'), 'Chat-only Agent must not emit missing_initial_tool_call.', { stepIssues });
}

async function assertKnowledgeSearchIntentCanRespondBeforeToolUse() {
  const userInput = '找一些极简袜子主图设计参考，请先概括检索策略';
  const intentControlPlane = buildAgentIntentControlPlaneDecision({
    userInput,
    hasImageInput: false,
    hasDocument: true,
    photoshopConnected: true
  });
  assert(intentControlPlane.requestKind === 'execute_skill', 'Reference search should remain a routable skill intent.', intentControlPlane);
  assert(intentControlPlane.toolScope === 'knowledge_search', 'Reference search should authorize knowledge-search tools only.', intentControlPlane);

  let modelCalls = 0;
  const stepIssues = [];
  const agent = new Agent(
    {
      systemPrompt: '你是测试 Agent。用户让你先说明搜索策略时，可以先给出自然语言判断，再决定是否需要调用搜索工具。',
      tools: [
        {
          name: 'searchDesigns',
          description: 'Search design references.',
          inputSchema: { type: 'object', properties: { query: { type: 'string' } } }
        }
      ],
      modelId: 'test-model',
      maxIterations: 3,
      toolDecisionContext: {
        intentControlPlane,
        photoshopConnected: true,
        hasDocument: true,
        hasImageInput: false
      },
      callbacks: {
        onStep: (step) => {
          if (step.issue) stepIssues.push(step.issue);
        }
      }
    },
    async () => {
      modelCalls += 1;
      return {
        content: '我会先按品类、平台规范和视觉风格拆关键词，再搜索极简袜子主图、白底图和转化图参考；本轮先说明搜索策略，不直接写入 Photoshop。',
        toolCalls: []
      };
    },
    async () => ({ success: true })
  );

  const result = await agent.run(userInput);
  assert(modelCalls === 1, 'Knowledge-search intent should not force extra tool rounds when the model provides a valid first-step explanation.', { modelCalls, result });
  assert(result.stopReason === 'final_response', `expected final_response, got ${result.stopReason}`, result);
  assert(result.message.includes('搜索策略'), 'Knowledge-search first response should be the model-authored explanation.', result);
  assert(!stepIssues.includes('missing_initial_tool_call'), 'Knowledge-search first-step explanation must not be marked as missing initial tool call.', { stepIssues });
}

function assertExplicitSkuExecutionProtectsAgainstNonExecutionDrift() {
  const cannedDirectSku = evaluateDeterministicNonExecutionProtection({
    deterministicSkillId: 'sku-batch',
    requestKind: 'execute_skill',
    isSkuIntent: true,
    modelRoute: 'direct_response',
    modelDirectResponse: '我可以协助这些设计工作：主图、点击图、转化图和白底图规划、SKU 组合图和自选备注、详情页设计。你可以直接提出主图、SKU、详情页需求。'
  });
  assert(
    cannedDirectSku.allowed === true,
    'Explicit SKU execution must not be downgraded to a direct response by stale capability-menu drift.',
    cannedDirectSku
  );

  const explicitWaitDirectSku = evaluateDeterministicNonExecutionProtection({
    deterministicSkillId: 'sku-batch',
    requestKind: 'execute_skill',
    isSkuIntent: true,
    modelRoute: 'direct_response',
    modelDirectResponse: '当前先不要执行 Photoshop，等你确认 SKU 源文件和规格后再做。'
  });
  assert(
    explicitWaitDirectSku.allowed === true,
    'Explicit SKU execution must not be downgraded by a model-generated wait-for-confirmation response unless the user asked for clarification first.',
    explicitWaitDirectSku
  );

  const userRequestedWaitDirectSku = evaluateDeterministicNonExecutionProtection({
    deterministicSkillId: 'sku-batch',
    requestKind: 'execute_skill',
    isSkuIntent: true,
    userRequestedClarification: true,
    modelRoute: 'direct_response',
    modelDirectResponse: '当前先不要执行 Photoshop，等你确认 SKU 源文件和规格后再做。'
  });
  assert(
    userRequestedWaitDirectSku.allowed === false,
    'When the user asks to clarify before execution, the model may keep the SKU task paused for confirmation.',
    userRequestedWaitDirectSku
  );

  const genericClarifySku = evaluateDeterministicNonExecutionProtection({
    deterministicSkillId: 'sku-batch',
    requestKind: 'execute_skill',
    isSkuIntent: true,
    modelRoute: 'clarification_needed',
    modelClarificationQuestion: '需要先说明要处理哪个图层或画面。'
  });
  assert(
    genericClarifySku.allowed === true,
    'Explicit SKU execution must not be downgraded to a generic clarification after the control plane has authorized the SKU skill.',
    genericClarifySku
  );

  const sourceSelectionClarifySku = evaluateDeterministicNonExecutionProtection({
    deterministicSkillId: 'sku-batch',
    requestKind: 'execute_skill',
    isSkuIntent: true,
    modelRoute: 'clarification_needed',
    modelClarificationQuestion: '要用当前 PSD 里的 SKU 色卡，还是项目 PSD/SKU.psb 作为来源？'
  });
  assert(
    sourceSelectionClarifySku.allowed === true,
    'Explicit SKU execution should resolve source selection through project SKU source policy instead of asking the user.',
    sourceSelectionClarifySku
  );

  const resourceBurdenShiftClarifySku = evaluateDeterministicNonExecutionProtection({
    deterministicSkillId: 'sku-batch',
    requestKind: 'execute_skill',
    isSkuIntent: true,
    modelRoute: 'clarification_needed',
    modelClarificationQuestion: '当前还缺少 SKU 源文件和需要生成的规格，请先确认项目素材是否完整。'
  });
  assert(
    resourceBurdenShiftClarifySku.allowed === true,
    'Explicit SKU execution should not be stopped by a resource-discovery question that the Agent can inspect first.',
    resourceBurdenShiftClarifySku
  );
}

function assertConfirmedExecutionContinuationCannotBecomeChatOnly() {
  const userInput = '已加载修复后的版本。请继续刚才的真实验收，现在直接进入自主执行并调用工具：先在本对话显示活动项目根目录、Photoshop 当前文档和下一步动作，然后通过独立 sku-color-card Skill 完成色卡。只允许写入 E:\\DesignEchoDemo\\C-1221\\PSD\\SKU-Agent验收.psb，不得覆盖 SKU.psb 或当前未保存文档；工具、视觉模型或权限失败时必须如实停止。';
  const intentControlPlane = buildAgentIntentControlPlaneDecision({
    userInput,
    hasImageInput: false,
    hasDocument: true,
    photoshopConnected: true
  });
  const lightweightIntent = detectLightweightIntent(userInput);
  const shouldEnterConversation = shouldEnterConversationalRoute({
    requestKind: intentControlPlane.requestKind,
    executionAuthorization: intentControlPlane.executionAuthorization,
    allowsAutonomousExecution: intentControlPlane.allowsAutonomousExecution,
    intentRequestsConversationalPath: intentControlPlane.shouldUseConversationalPath,
    lightweightIntentIsConversational: Boolean(lightweightIntent)
  });

  assert(
    intentControlPlane.requestKind === 'autonomous_execution'
      && intentControlPlane.executionAuthorization === 'confirmed_tool_required'
      && intentControlPlane.allowsAutonomousExecution === true,
    'The real desktop continuation request must retain confirmed autonomous execution authorization even when it asks to show the next action.',
    { intentControlPlane, lightweightIntent }
  );
  assert(
    shouldEnterConversation === false,
    'A lightweight continuation hint must not downgrade confirmed tool execution to direct_response.',
    { intentControlPlane, lightweightIntent, shouldEnterConversation }
  );

  const chatOnly = buildAgentIntentControlPlaneDecision({
    userInput: '当前项目下一步做什么？只说明，不要执行。',
    hasImageInput: false,
    hasDocument: true,
    photoshopConnected: true
  });
  assert(
    shouldEnterConversationalRoute({
      requestKind: chatOnly.requestKind,
      executionAuthorization: chatOnly.executionAuthorization,
      allowsAutonomousExecution: chatOnly.allowsAutonomousExecution,
      intentRequestsConversationalPath: chatOnly.shouldUseConversationalPath,
      lightweightIntentIsConversational: true
    }) === true,
    'A genuine chat-only request must remain on the conversational route.',
    chatOnly
  );
}

function assertChatPanelReadsConnectedPhotoshopBaseStateWithoutIntentGate() {
  const source = fs.readFileSync(
    path.resolve(__dirname, '..', 'src', 'renderer', 'components', 'ChatPanel.tsx'),
    'utf8'
  );
  const connectedBranchIndex = source.indexOf('if (isPluginConnected) {');
  const photoshopReadIndex = source.indexOf('photoshopContext = await getPhotoshopContext();');

  assert(
    !source.includes('const preAgentIntentControlPlane = buildAgentIntentControlPlaneDecision'),
    'ChatPanel should not use business-intent classification to decide whether Photoshop base state exists.'
  );
  assert(
    connectedBranchIndex >= 0 && photoshopReadIndex > connectedBranchIndex,
    'ChatPanel should read lightweight Photoshop base state whenever the plugin is connected.'
  );
  assert(
    source.includes('photoshopContext = { hasDocument: false };'),
    'ChatPanel should only assert hasDocument:false when Photoshop is disconnected.'
  );
  assert(
    !source.includes('getCanvasSnapshot') || source.indexOf('getCanvasSnapshot') < source.indexOf('const sendMessage'),
    'The send preflight must not add an eager canvas snapshot to ordinary conversations.'
  );
}

function assertReferenceSearchUsesKnowledgeScopeWithoutPhotoshopWrite() {
  const intentControlPlane = buildAgentIntentControlPlaneDecision({
    userInput: '找一些极简袜子主图设计参考',
    hasImageInput: false,
    hasDocument: false,
    photoshopConnected: false
  });
  assert(
    intentControlPlane.requestKind === 'execute_skill',
    'Explicit reference search should enter controlled skill routing.',
    intentControlPlane
  );
  assert(
    intentControlPlane.toolScope === 'knowledge_search',
    'Explicit reference search should authorize only knowledge-search tools.',
    intentControlPlane
  );
  assert(
    intentControlPlane.matchedSignals.includes('shared_skill_routing:design-reference-search'),
    'Reference search should route through the design-reference-search skill.',
    intentControlPlane
  );

  const noSearchDirective = buildAgentIntentControlPlaneDecision({
    userInput: '只说明这个设计要不要先找参考，不要搜索也不要调用工具',
    hasImageInput: false,
    hasDocument: true,
    photoshopConnected: true
  });
  assert(
    noSearchDirective.requestKind === 'chat_only',
    'A no-tool directive about reference search should stay conversational.',
    noSearchDirective
  );
  assert(
    noSearchDirective.toolScope === 'none',
    'A no-tool directive should not authorize knowledge search.',
    noSearchDirective
  );
}

function assertPromptsDefineToolBoundariesWithoutForcingExecution() {
  const promptFiles = [
    'src/shared/prompts/enhanced-agent-prompt.ts',
    'src/shared/prompts/agent-prompt.ts'
  ];
  const forbiddenFragments = [
    '核心流程：必须先调用工具',
    '必须调用工具的场景',
    '如果不确定，就先调用 getElementMapping() 获取完整信息',
    '开始执行，不等用户确认',
    '然后直接调用工具执行',
    '不要问"要继续吗"，直接做',
    '逐步执行，每步调用工具',
    '你必须**主动分析、主动执行、及时反馈**'
  ];

  for (const relativePath of promptFiles) {
    const source = fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8');
    for (const fragment of forbiddenFragments) {
      assert(
        !source.includes(fragment),
        `${relativePath} should not force tool calls or direct execution through prompt wording.`,
        { relativePath, fragment }
      );
    }
  }

  const enhancedPrompt = fs.readFileSync(
    path.resolve(__dirname, '..', 'src/shared/prompts/enhanced-agent-prompt.ts'),
    'utf8'
  );
  assert(
    enhancedPrompt.includes('先理解用户意图') && enhancedPrompt.includes('根据需要选择工具'),
    'Enhanced prompt should frame tool use as autonomous intent understanding and selective tool choice.'
  );
  assert(
    enhancedPrompt.includes('工具负责执行边界清晰的动作'),
    'Enhanced prompt should describe tools as bounded execution capabilities.'
  );
}

async function assertConversationalRepairHandlesIncompletePlainText() {
  const calls = [];
  const reply = await conversational.tryConversationalModelReply(
    {
      userInput: '真实窗口八次回归测试：工具归工具，思考归思考。请只解释你如何理解这句话，不要调用工具。',
      conversationHistory: [],
      isPluginConnected: true,
      photoshopContext: { hasDocument: true },
      projectContext: {},
      hasAttachedImage: false
    },
    async (_messages, options) => {
      calls.push(options?.purpose || 'unknown');
      if (options?.purpose === 'direct_response') {
        return {
          text: '这句话的核心是职责分离：工具只负责按明确规则执行具体操作，比如裁切、导出、替换字体；而思考负责理解意图、判断设计合理性、确定执行策略。两者不要混在一起——不能用工具'
        };
      }
      return {
        text: '我的理解是：工具负责执行明确动作，思考负责理解意图和决定是否需要工具。本轮只解释概念，不调用任何工具。'
      };
    }
  );

  assert(
    reply === '我的理解是：工具负责执行明确动作，思考负责理解意图和决定是否需要工具。本轮只解释概念，不调用任何工具。',
    'Incomplete conversational plain text should be repaired before it is shown.',
    { reply, calls }
  );
  assert(
    JSON.stringify(calls) === JSON.stringify(['direct_response', 'direct_response_repair']),
    'Incomplete conversational plain text should trigger the repair model call.',
    { calls }
  );

  const quoteCalls = [];
  const quoteReply = await conversational.tryConversationalModelReply(
    {
      userInput: '工具归工具，思考归思考。你怎么理解这句话？只解释，不执行工具。',
      conversationHistory: [],
      isPluginConnected: false,
      photoshopContext: { hasDocument: false },
      projectContext: {},
      hasAttachedImage: false
    },
    async (_messages, options) => {
      quoteCalls.push(options?.purpose || 'unknown');
      if (options?.purpose === 'direct_response') {
        return {
          text: '这句话说的是我工作的底层逻辑。工具负责"怎么做"——比如打开图层、批量替换字体、调整布局，这些是定义清晰、边界明确的执行动作。但"做什么"、"为什么这么做'
        };
      }
      return {
        text: '我的理解是：我先负责理解目标、判断方案和规划路径，再决定是否需要工具；工具只负责执行边界清晰的动作。本轮只解释，不执行任何工具。'
      };
    }
  );

  assert(
    quoteReply === '我的理解是：我先负责理解目标、判断方案和规划路径，再决定是否需要工具；工具只负责执行边界清晰的动作。本轮只解释，不执行任何工具。',
    'Plain text with an unfinished quoted sentence should be repaired before display.',
    { quoteReply, quoteCalls }
  );
  assert(
    JSON.stringify(quoteCalls) === JSON.stringify(['direct_response', 'direct_response_repair']),
    'Unfinished quoted conversational text should trigger the repair model call.',
    { quoteCalls }
  );

}

async function assertClarificationUsesModelWordingWithoutToolExecution() {
  // v3 拓扑：模糊请求不再由意图闸门给固定澄清话术，而是进入自主循环，
  // 由循环模型自然反问澄清。本用例守住的边界相应更新为：
  // 1) 路由进入 autonomous_agent；2) 不执行任何 Photoshop 工具；
  // 3) 不输出旧版固定澄清模板；4) 循环模型不可用时如实失败、不伪造澄清。
  // （smoke 的 Node 环境没有 window.designEcho，循环模型必然不可用。）
  const engine = new DesignAgentEngine();
  const steps = [];
  const result = await engine.run(
    {
      userInput: '帮我处理一下这个',
      conversationHistory: [],
      isPluginConnected: true,
      photoshopContext: { hasDocument: true, documentName: 'test.psd' },
      projectContext: {}
    },
    {
      callModel: async () => ({ text: '' }),
      callbacks: {
        onStep: (step) => steps.push(step)
      }
    }
  );

  assert(
    result.data?.agentRequestLifecycle?.decision?.route === 'autonomous_agent',
    'Ambiguous request should route to the autonomous agent loop under v3 topology.',
    result.data?.agentRequestLifecycle?.decision
  );
  assert(
    !/要处理哪个图层或画面、想达到什么效果、是否允许修改当前文档/.test(String(result.message || '')),
    'Result should not expose the old fixed clarification template.',
    result.message
  );
  // 'autonomous-agent' 是能力包装层自身的步骤事件，不是 Photoshop 工具
  const NON_PHOTOSHOP_STEP_TOOLS = new Set(['autonomous-agent', 'providerNativeWebSearch']);
  assert(
    !steps.some((step) => ['tool_started', 'tool_completed'].includes(step.kind)
      && step.toolName && !NON_PHOTOSHOP_STEP_TOOLS.has(step.toolName)),
    'No Photoshop tool should start or complete when the loop model is unavailable.',
    steps.filter((step) => ['tool_started', 'tool_completed'].includes(step.kind))
  );
  assert(
    result.success === false && Boolean(result.error),
    'Without a usable loop model the result must be an honest failure, not a fabricated clarification.',
    { success: result.success, error: result.error }
  );
}

async function assertSkuTemplateDesignBypassesGenericRouterClarification() {
  const engine = new DesignAgentEngine();
  const userInput = '帮我做一下 SKU 模板';
  const steps = [];
  const calls = [];
  const result = await engine.run(
    {
      userInput,
      conversationHistory: [
        { role: 'user', content: '帮我做一下SKU模板' },
        {
          role: 'assistant',
          content: '做 SKU 模板之前，我想先确认一下：你是想做一个通用的 SKU 模板部署以后复用，还是针对当前某个具体商品来做？'
        },
        { role: 'user', content: '就是通用的SKU设计模板' }
      ],
      isPluginConnected: true,
      photoshopContext: { hasDocument: true, documentName: 'SKU.psb' },
      projectContext: {
        projectPath: 'E:/DesignEchoDemo/C-1198',
        projectImageCount: 38,
        sampleImagePaths: ['E:/DesignEchoDemo/C-1198/SCS1270桑蚕丝波浪镂空/HJT_3829.jpg']
      }
    },
    {
      callModel: async (_messages, options = {}) => {
        calls.push(options?.purpose || 'unknown');
        if (options?.purpose === 'router') {
          return {
            text: JSON.stringify({
              route: 'clarification_needed',
              skillId: null,
              mode: null,
              skillParams: null,
              intentSummary: '用户要做通用 SKU 设计模板。',
              directResponse: '',
              clarificationQuestion: '模板尺寸、平台、包含哪些模块和风格偏好分别是什么？'
            })
          };
        }
        return {
          text: '做之前我需要先确认模板尺寸、平台、模块和风格偏好。'
        };
      },
      callbacks: {
        onStep: (step) => steps.push(step)
      }
    }
  );

  assert(
    result.data?.agentRequestLifecycle?.decision?.route === 'autonomous_agent',
    'SKU template design should bypass generic router clarification and enter the autonomous design loop.',
    {
      route: result.data?.agentRequestLifecycle?.decision?.route,
      message: result.message,
      calls,
      steps: steps.map((step) => ({ kind: step.kind, title: step.title, toolName: step.toolName }))
    }
  );
  assert(
    !/模板尺寸、平台、包含哪些模块和风格偏好/.test(String(result.message || '')),
    'Generic SKU template preference clarification should not be shown as the final user reply.',
    result.message
  );
}

async function assertNaturalSkuColorCardRequestKeepsPrimaryDeliverable() {
  const engine = new DesignAgentEngine();
  const userInput = '帮我把项目里的四张袜子图片做成一张 1500×1500 的 SKU 色卡，按蓝条纹、咖条纹、奶白黑条纹、黑色白条纹排列，序号放在卡片外面方便查看，完成后另存为 PSD/SKU-用户验收.psb，不要改我现在打开的文档。';
  const deterministicRoute = fastDeterministicRoute(userInput);

  assert(
    deterministicRoute?.skillId === 'sku-color-card',
    'A natural SKU color-card request must keep the color card as the primary deliverable instead of becoming document-management or generic sku-batch.',
    deterministicRoute
  );
  assert(
    deterministicRoute?.skillParams?.outputRelativePath === 'PSD/SKU-用户验收.psb',
    'The requested save target should be retained as a delivery constraint on the color-card workflow.',
    deterministicRoute?.skillParams
  );

  const routeVeto = evaluateDeterministicRouteVeto({
    deterministicSkillId: deterministicRoute?.skillId,
    modelSkillId: 'document-management'
  });
  assert(
    routeVeto.allowed === true,
    'A declared autonomous business workflow must not be downgraded to a one-step document-management action.',
    routeVeto
  );

  const steps = [];
  const result = await engine.run(
    {
      userInput,
      conversationHistory: [],
      isPluginConnected: true,
      photoshopContext: {
        hasDocument: true,
        documentName: '黑色白条纹-圆角占位.psb'
      },
      projectContext: {
        projectPath: 'E:/DesignEchoDemo/C-1221',
        projectImageCount: 4,
        sampleImagePaths: [
          'E:/DesignEchoDemo/C-1221/蓝条纹.jpg',
          'E:/DesignEchoDemo/C-1221/咖条纹.jpg',
          'E:/DesignEchoDemo/C-1221/奶白黑条纹.jpg',
          'E:/DesignEchoDemo/C-1221/黑色白条纹.jpg'
        ]
      }
    },
    {
      callModel: async (_messages, options = {}) => {
        if (options?.purpose === 'router') {
          return {
            text: JSON.stringify({
              route: 'skill_execution',
              skillId: 'document-management',
              mode: 'execute',
              skillParams: {
                action: 'save',
                path: 'E:/DesignEchoDemo/C-1221/PSD/SKU-用户验收.psb',
                saveAs: true
              },
              intentSummary: '用户希望把当前文档另存为新的 PSB 文件。',
              directResponse: '',
              clarificationQuestion: ''
            })
          };
        }
        return { text: '' };
      },
      callbacks: {
        onStep: (step) => steps.push(step)
      }
    }
  );

  assert(
    result.data?.agentRequestLifecycle?.decision?.route === 'autonomous_agent',
    'Even when the router mistakes the save condition for the main task, the declared color-card workflow must enter the autonomous Agent loop.',
    {
      lifecycle: result.data?.agentRequestLifecycle?.decision,
      message: result.message,
      steps
    }
  );
  assert(
    !steps.some((step) => step.toolName === 'saveDocument' || step.toolName === 'document-management'),
    'The mistaken document-management route must not save or rename the currently open Photoshop document.',
    steps
  );
}

async function assertAutonomousWriteShowsReasoningAndRicherSummaryBeforeToolUse() {
  const userInput = '我想你帮我调整SKU色卡的占位符可以吗';
  const intentControlPlane = buildAgentIntentControlPlaneDecision({
    userInput,
    hasImageInput: false,
    hasDocument: true,
    photoshopConnected: true
  });
  assert(
    intentControlPlane.requestKind === 'autonomous_execution'
      && intentControlPlane.executionAuthorization === 'confirmed_tool_required',
    'SKU placeholder adjustment should be autonomous confirmed tool-required execution.',
    intentControlPlane
  );

  const thinkingEvents = [];
  const stepEvents = [];
  let modelCalls = 0;
  let toolExecutedAfterThinking = false;

  const agent = new Agent(
    {
      systemPrompt: '你是测试设计 Agent。写入前先给用户公开判断，工具后给用户总结。',
      tools: [
        {
          name: 'getDocumentInfo',
          description: '读取当前文档信息',
          inputSchema: {
            type: 'object',
            properties: {}
          }
        },
        {
          name: 'createSkuPlaceholders',
          description: '创建 SKU 占位符',
          inputSchema: {
            type: 'object',
            properties: {
              placeholderCount: { type: 'number' }
            }
          }
        }
      ],
      modelId: 'test-model',
      maxIterations: 4,
      toolDecisionContext: {
        intentControlPlane,
        photoshopConnected: true,
        hasDocument: true,
        hasImageInput: false
      },
      callbacks: {
        onThinking: (text) => thinkingEvents.push(text),
        onStep: (step) => stepEvents.push(step)
      }
    },
    async (_modelId, _messages, tools) => {
      modelCalls += 1;
      if (modelCalls === 1) {
        assert(Array.isArray(tools) && tools.length > 0, 'Agent should choose the first tool before deciding whether a separate rationale call is needed.');
        return {
          content: '我先读取当前文档，确认确实是在 SKU 卡片上操作，再调整占位区。',
          toolCalls: [
            {
              id: 'tool-1',
              name: 'getDocumentInfo',
              arguments: {}
            }
          ]
        };
      }
      if (modelCalls === 2) {
        return {
          content: '当前文档可以继续处理，我会写入占位区后看前后变化，确认不是只报成功。',
          toolCalls: [
            {
              id: 'tool-2',
              name: 'createSkuPlaceholders',
              arguments: { placeholderCount: 1 }
            }
          ]
        };
      }
      if (modelCalls === 3) {
        return {
          content: '完成。',
          toolCalls: []
        };
      }
      return {
        content: '我已调整 SKU 色卡的占位区，并根据前后快照变化确认画面确实发生了更新。当前证据只能说明占位位置已被写入，最终视觉位置还建议你看一眼卡片是否符合预期。',
        toolCalls: []
      };
    },
    async (toolName) => {
      assert(['getDocumentInfo', 'createSkuPlaceholders'].includes(toolName), 'Unexpected tool executed.', { toolName });
      if (toolName === 'getDocumentInfo') {
        return {
          success: true,
          document: {
            name: 'SKU.psb',
            width: 1500,
            height: 1500
          }
        };
      }
      toolExecutedAfterThinking = thinkingEvents.some((text) => /占位区|复核|前后变化/.test(String(text)));
      return {
        success: true,
        acceptance: {
          enabled: true,
          verified: true,
          assertionStatus: 'verified',
          summaryText: '已采集 before/after 快照，检测到 10 项变化（新增 1，删除 0，改动 9）。'
        }
      };
    }
  );

  const result = await agent.run(userInput);
  assert(toolExecutedAfterThinking, 'Autonomous write tool must not execute before a visible public reasoning summary.');
  assert(
    thinkingEvents.some((text) => /确认确实是在 SKU 卡片上操作|写入占位区后看前后变化/.test(String(text))),
    'Visible public reasoning should be emitted before first write tool.',
    thinkingEvents
  );
  assert(
    /前后快照变化|最终视觉位置/.test(String(result.message || '')),
    'Thin final response should be replaced by a richer evidence-grounded user summary.',
    { message: result.message, modelCalls }
  );
  assert(
    stepEvents.some((step) => step.kind === 'observation' && step.audience === 'user')
      && stepEvents.some((step) => step.kind === 'verification' && step.audience === 'user'),
    'Observation and verification steps should be marked as user-visible process events.',
    stepEvents.map((step) => ({
      kind: step.kind,
      title: step.title,
      audience: step.audience,
      source: step.source
    }))
  );
}

async function assertProviderThinkingStreamRespectsUserPreference() {
  async function runCase(thinkingEnabled) {
    const thinkingEvents = [];
    const intentControlPlane = buildAgentIntentControlPlaneDecision({
      userInput: '请简要说明你会怎样处理这个任务',
      hasImageInput: false,
      hasDocument: true,
      photoshopConnected: true
    });
    const agent = new Agent(
      {
        systemPrompt: '你是测试 Agent。请直接给出简洁回答。',
        tools: [],
        modelId: 'test-model',
        maxIterations: 2,
        thinkingEnabled,
        toolDecisionContext: {
          intentControlPlane,
          photoshopConnected: true,
          hasDocument: true,
          hasImageInput: false
        },
        callbacks: {
          onThinking: (text, meta) => thinkingEvents.push({ text, source: meta?.source })
        },
        callModelStream: async (_modelId, _messages, _tools, options) => {
          options?.onThinkingDelta?.('先确认任务目标，再组织简洁答复。', '先确认任务目标');
          return {
            content: '我会先确认目标和约束，再根据结果给出清晰答复。',
            thinking: '先确认任务目标，再组织简洁答复。',
            toolCalls: []
          };
        }
      },
      async () => {
        throw new Error('Stream-capable Agent should not fall back to the non-stream model call.');
      },
      async () => ({ success: true })
    );

    const result = await agent.run('请简要说明你会怎样处理这个任务');
    return { result, thinkingEvents };
  }

  const enabled = await runCase(true);
  assert(
    enabled.thinkingEvents.some((event) => event.source === 'provider_thinking_delta' && /确认任务目标/.test(event.text)),
    'Enabled Thinking must forward native provider deltas through Agent callbacks.',
    enabled.thinkingEvents
  );

  const disabled = await runCase(false);
  assert(
    !disabled.thinkingEvents.some((event) => event.source === 'provider_thinking_delta' || event.source === 'provider_final_thinking'),
    'Disabled Thinking must not expose provider thinking even if a provider emits it unexpectedly.',
    disabled.thinkingEvents
  );
}

async function assertTruncatedProviderResponseRecoversBeforeFinalizing() {
  const intentControlPlane = buildAgentIntentControlPlaneDecision({
    userInput: '请完整说明当前判断和下一步',
    hasImageInput: false,
    hasDocument: true,
    photoshopConnected: true
  });
  let modelCalls = 0;
  const agent = new Agent(
    {
      systemPrompt: '你是测试设计 Agent，所有用户可见内容使用简体中文。',
      tools: [],
      modelId: 'test-model',
      maxIterations: 3,
      thinkingEnabled: true,
      toolDecisionContext: {
        intentControlPlane,
        photoshopConnected: true,
        hasDocument: true,
        hasImageInput: false
      },
      callbacks: {},
      callModelStream: async () => {
        modelCalls += 1;
        if (modelCalls === 1) {
          return {
            content: '当前',
            thinking: '先确认现有画面。当前',
            toolCalls: [],
            stopReason: 'max_tokens'
          };
        }
        return {
          content: '当前画面仍缺少足够证据；我会先确认文档状态，再决定是否继续调整。',
          thinking: '先确认文档与画面证据，再给出完整判断。',
          toolCalls: [],
          stopReason: 'end_turn'
        };
      }
    },
    async () => {
      throw new Error('Stream recovery case must keep using the stream-capable model path.');
    },
    async () => ({ success: true })
  );

  const result = await agent.run('请完整说明当前判断和下一步');
  assert(modelCalls === 2, 'A max-token response must get one bounded continuation round.', { modelCalls, result });
  assert(
    /当前画面仍缺少足够证据/.test(String(result.message || '')) && !String(result.message || '').endsWith('当前'),
    'Agent must not finalize a provider response that ended at the token limit.',
    result
  );
}

async function main() {
  const cases = [];
  for (const testCase of [
    ['agent-chat-only-no-initial-tool-force', assertAgentDoesNotForceToolsForChatOnlyIntent],
    ['knowledge-search-can-respond-before-tool-use', assertKnowledgeSearchIntentCanRespondBeforeToolUse],
    ['reference-search-uses-knowledge-scope-without-photoshop-write', assertReferenceSearchUsesKnowledgeScopeWithoutPhotoshopWrite],
    ['prompts-define-tool-boundaries-without-forcing-execution', assertPromptsDefineToolBoundariesWithoutForcingExecution],
    ['explicit-sku-execution-protects-against-non-execution-drift', assertExplicitSkuExecutionProtectsAgainstNonExecutionDrift],
    ['confirmed-execution-continuation-cannot-become-chat-only', assertConfirmedExecutionContinuationCannotBecomeChatOnly],
    ['chatpanel-connected-photoshop-base-state', assertChatPanelReadsConnectedPhotoshopBaseStateWithoutIntentGate],
    ['conversational-repairs-incomplete-plain-text', assertConversationalRepairHandlesIncompletePlainText],
    ['clarification-uses-model-wording-without-tool-execution', assertClarificationUsesModelWordingWithoutToolExecution],
    ['sku-template-design-bypasses-generic-router-clarification', assertSkuTemplateDesignBypassesGenericRouterClarification],
    ['natural-sku-color-card-keeps-primary-deliverable', assertNaturalSkuColorCardRequestKeepsPrimaryDeliverable],
    ['autonomous-write-shows-reasoning-and-richer-summary-before-tool-use', assertAutonomousWriteShowsReasoningAndRicherSummaryBeforeToolUse],
    ['provider-thinking-stream-respects-user-preference', assertProviderThinkingStreamRespectsUserPreference],
    ['truncated-provider-response-recovers-before-finalizing', assertTruncatedProviderResponseRecoversBeforeFinalizing]
  ]) {
    const [name, fn] = testCase;
    try {
      await fn();
      cases.push({ name, status: 'pass' });
    } catch (error) {
      cases.push({
        name,
        status: 'fail',
        message: error.message,
        details: error.details
      });
    }
  }

  const payload = {
    success: cases.every((item) => item.status === 'pass'),
    cases
  };
  const outDir = path.resolve(__dirname, '..', 'tmp');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'agent-thinking-tool-boundary-smoke.json'), JSON.stringify(payload, null, 2), 'utf8');
  console.log(JSON.stringify(payload, null, 2));
  if (!payload.success) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
