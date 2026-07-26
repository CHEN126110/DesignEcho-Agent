const fs = require('fs');
const path = require('path');
require('ts-node').register({ transpileOnly: true, project: path.resolve(__dirname, '..', 'tsconfig.main.json') });

const taskClassifier = require(path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'agent-orchestration', 'task-classifier.ts'));
const routing = require(path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'agent-orchestration', 'routing.ts'));
const conversational = require(path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'agent-orchestration', 'conversational.ts'));
const skillExecutors = require(path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'skill-executors', 'index.ts'));
const { DesignAgentEngine } = require(path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'design-agent', 'engine.ts'));
const { buildOperatingContextSnapshot } = require(path.resolve(__dirname, '..', 'src', 'shared', 'agent-runtime-v5', 'operating-context-snapshot.ts'));
const {
  normalizeSkillId,
  findSkillRoutingIntent,
  matchesSkillRoutingIntent,
  resolveSkillRoutingMode,
  extractDocumentManagementRoutingParams
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'skill-routing.ts'));
const routeBoundaryPolicy = require(path.resolve(__dirname, '..', 'src', 'shared', 'agent-route-boundary-policy.ts'));
const NATURAL_SKU_CAPABILITY_REPLY = '能做，SKU 这块我会按组合图和自选备注来理解。';
const MODEL_UNAVAILABLE_COPY = '这次没有拿到模型回复，先不继续处理。';

async function runConversationalJsonContentExtractionCase() {
  let callModelCount = 0;
  const context = createContext('你可以做什么？');
  const result = await conversational.tryConversationalModelReplyDetailed(
    context,
    async () => {
      callModelCount += 1;
      return {
        text: JSON.stringify({
          content: '可以协助你处理电商视觉设计、项目素材理解和 Photoshop 版面问题；明确要落地处理时，我会先检查素材、文档和版面空间。'
        })
      };
    }
  );

  return {
    name: 'conversational-json-content-field-is-treated-as-model-authored-text',
    status:
      result.reply === '可以协助你处理电商视觉设计、项目素材理解和 Photoshop 版面问题；明确要落地处理时，我会先检查素材、文档和版面空间。'
      && callModelCount === 1
      && !result.failure
        ? 'pass'
        : 'fail',
    details: JSON.stringify({
      callModelCount,
      reply: result.reply,
      failure: result.failure
    })
  };
}

let intentControlPlane = null;
let intentControlPlaneLoadError = null;
try {
  intentControlPlane = require(path.resolve(__dirname, '..', 'src', 'shared', 'agent-intent-control-plane.ts'));
} catch (error) {
  intentControlPlaneLoadError = error;
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeReport(payload) {
  const outDir = path.join(__dirname, '..', 'tmp');
  ensureDir(outDir);
  const jsonPath = path.join(outDir, 'agent-intent-engine-smoke.json');
  const mdPath = path.join(outDir, 'agent-intent-engine-smoke.md');
  fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2), 'utf8');

  const lines = [
    '# Agent Intent Engine Smoke',
    '',
    `- success: ${payload.success}`,
    ''
  ];

  for (const testCase of payload.cases) {
    lines.push(`## ${testCase.name}`);
    lines.push(`- status: ${testCase.status}`);
    if (testCase.details) {
      lines.push(`- details: ${testCase.details}`);
    }
    lines.push('');
  }

  fs.writeFileSync(mdPath, lines.join('\n'), 'utf8');
  return { json: jsonPath, md: mdPath };
}

function createContext(userInput, overrides = {}) {
  const base = {
    userInput,
    conversationHistory: [],
    isPluginConnected: true,
    photoshopContext: {
      hasDocument: true,
      documentName: 'test.psd',
      activeLayerName: '图层 1',
      layerCount: 12
    },
    projectContext: {
      projectPath: 'C:/DesignEcho/test-project',
      projectImageCount: 8,
      projectImageFolders: [],
      sampleImagePaths: []
    }
  };

  return {
    ...base,
    ...overrides,
    photoshopContext: {
      ...base.photoshopContext,
      ...(overrides.photoshopContext || {})
    },
    projectContext: {
      ...base.projectContext,
      ...(overrides.projectContext || {})
    }
  };
}

function createMatchingCopyOperatingContextSnapshot(originalCopy) {
  const capturedAt = new Date().toISOString();
  return buildOperatingContextSnapshot({
    snapshotId: 'copy-delivery-smoke',
    capturedAt,
    correlationId: 'copy-delivery-smoke',
    workspace: {
      source: 'agent-intent-engine-smoke',
      observedAt: capturedAt,
      revision: 'workspace-copy-delivery-v1',
      activePage: 'workflow'
    },
    photoshop: {
      source: 'agent-intent-engine-smoke',
      observedAt: capturedAt,
      revision: 'photoshop-copy-delivery-v1',
      validForMs: 60_000,
      connection: 'connected',
      documentState: 'present',
      document: {
        documentId: 1001,
        name: '详情页.psb',
        width: 750,
        height: 12000,
        layerCount: 86
      },
      activeLayer: {
        layerId: 2002,
        name: originalCopy
      }
    }
  });
}

function sameJson(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function isAutonomousBridgeExecution(entry, expectedSkillId) {
  return entry?.skillId === 'autonomous-agent'
    && entry?.params?.skillId === expectedSkillId
    && entry?.params?.agentIntentControlPlane?.requestKind === 'autonomous_execution'
    && entry?.params?.agentIntentControlPlane?.executionAuthorization === 'confirmed_tool_required';
}

function hasAutonomousToolExecutionLifecycle(result, expectedSkillId) {
  const lifecycle = result?.data?.agentRequestLifecycle || result?.lifecycle;
  return lifecycle?.decision?.route === 'autonomous_agent'
    && lifecycle?.decision?.skillId === 'autonomous-agent'
    && lifecycle?.execution?.kind === 'autonomous_agent'
    && (!expectedSkillId || lifecycle?.decision?.skillId === 'autonomous-agent');
}

function sampleDesignDecision(goal = '生成 SKU 组合图并同步处理自选备注。') {
  return {
    designGoal: goal,
    productUnderstanding: ['SKU 任务需要准确表达颜色和规格组合。', '自选备注属于 SKU 交付的一部分，不是额外随机颜色组合。'],
    audience: '淘宝天猫袜子消费者',
    hierarchy: {
      primarySubject: 'SKU 商品颜色和规格信息',
      focalPoint: '颜色组合与规格备注的对应关系',
      informationPriority: ['颜色', '规格', '自选备注'],
      whitespaceIntent: '保留 SKU 名称和备注的清晰可读区域。',
      layoutNotes: ['组合信息优先，装饰退后。']
    },
    color: {
      paletteIntent: '沿用项目真实 SKU 颜色，不由代码猜测颜色。',
      primaryColors: ['#FFFFFF', '#111111'],
      accentColors: ['#2F6FED'],
      backgroundDirection: '保持干净背景，突出商品颜色。',
      contrastPlan: '文字与商品区域保持足够对比。',
      avoid: ['改变真实 SKU 颜色', '高饱和装饰抢主体']
    },
    typography: {
      tone: '清晰、直接、偏电商规格表达',
      hierarchy: ['SKU 名称', '规格', '自选备注'],
      fontDirection: '无衬线黑体，优先可读。',
      spacingDirection: '备注不挤压商品主体。',
      avoid: ['过小备注文字', '复杂字效']
    },
    retouch: {
      objectives: ['保持 SKU 商品边缘清晰', '校正素材轻微偏色'],
      colorCorrection: '只校正曝光和白平衡，不改变 SKU 真实颜色。',
      lighting: '保持统一光照。',
      cleanup: ['去除背景杂点'],
      fabricOrMaterialHandling: '保留袜子材质纹理。',
      prohibitedEdits: ['改变颜色', '抹掉纹理']
    },
    assetSelection: {
      selectionPrinciples: ['优先项目 SKU 文档和项目素材，不使用已打开但不属于项目的文档。'],
      requiredEvidence: ['项目素材索引', 'SKU 文件证据', '颜色图层证据'],
      rejectRules: ['拒绝不属于当前项目的打开文档。']
    },
    toolWorkflow: [
      { phase: 'inspect', goal: '读取项目 SKU 文件和素材证据。', allowedToolKinds: ['read-only'], requiredEvidence: ['project-context'] },
      { phase: 'analyze', goal: '确认颜色、规格和自选备注语义。', allowedToolKinds: ['read-only'], requiredEvidence: ['sku-evidence'] },
      { phase: 'compose', goal: '生成 SKU 组合和备注。', allowedToolKinds: ['photoshop-write'], requiredEvidence: ['design-plan'] },
      { phase: 'verify', goal: '检查导出结果与组合数量。', allowedToolKinds: ['readback'], requiredEvidence: ['result-summary'] }
    ],
    acceptanceCriteria: ['SKU 颜色和规格对应正确。', '自选备注已生成且文字可读。', '执行结果包含导出或结果状态证据。'],
    risks: ['不能把“自选备注”误解成额外颜色组合。'],
    rationale: ['先确认语义，再执行 SKU 工具。']
  };
}

async function run() {
  const cases = [];
  const engine = new DesignAgentEngine();

  const originalGetSkillExecutor = skillExecutors.getSkillExecutor;
  const originalExecuteSkillWithExecutor = skillExecutors.executeSkillWithExecutor;

  let executed = [];
  skillExecutors.getSkillExecutor = (skillId) => ({ id: skillId, execute: async () => ({ success: true }) });
  skillExecutors.executeSkillWithExecutor = async (skillId, payload) => {
    executed.push({ skillId, params: payload?.params || null });
    return { success: true, message: `executed:${skillId}` };
  };

  try {
    cases.push(await runConversationalJsonContentExtractionCase());

    let capturedPrompt = '';
    await taskClassifier.classifyActionableIntent(
      createContext('帮我关闭文档不保存'),
      async (messages) => {
        capturedPrompt = String(messages?.[0]?.content || '');
        return {
          text: JSON.stringify({
            route: 'skill_execution',
            skillId: 'document-management',
            thinking: '这是文档关闭操作。',
            skillParams: { action: 'close', save: false }
          })
        };
      }
    );

    cases.push({
      name: 'classifier-prompt-uses-live-skill-registry',
      status:
        capturedPrompt.includes('Live skill registry summary:')
        && capturedPrompt.includes('- document-management [operation, user-facing]:')
        && !capturedPrompt.includes('- detail-page-template-authoring [workflow, user-facing]:')
        && capturedPrompt.includes('intentSignals:')
        && capturedPrompt.includes('clarificationHints:')
        && !capturedPrompt.includes('"confidence": number')
        && !capturedPrompt.includes('"confidence"')
        && !capturedPrompt.includes('- matte-product [operation, user-facing]:')
        && !capturedPrompt.includes('- shape-morphing [operation, system-only]:')
          ? 'pass'
          : 'fail',
      details: JSON.stringify({
        hasRegistrySummary: capturedPrompt.includes('Live skill registry summary:'),
        hasDocumentSkill: capturedPrompt.includes('- document-management [operation, user-facing]:'),
        leaksDetailTemplateSkill: capturedPrompt.includes('- detail-page-template-authoring [workflow, user-facing]:'),
        hasIntentSignals: capturedPrompt.includes('intentSignals:'),
        hasClarificationHints: capturedPrompt.includes('clarificationHints:'),
        requiresConfidence: capturedPrompt.includes('"confidence": number') || capturedPrompt.includes('"confidence"'),
        leaksMatteProduct: capturedPrompt.includes('- matte-product [operation, user-facing]:'),
        leaksShapeMorphing: capturedPrompt.includes('- shape-morphing [operation, system-only]:')
      })
    });

    const classifierSource = fs.readFileSync(
      path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'agent-orchestration', 'task-classifier.ts'),
      'utf8'
    );
    const chatPanelSource = fs.readFileSync(
      path.resolve(__dirname, '..', 'src', 'renderer', 'components', 'ChatPanel.tsx'),
      'utf8'
    );
    const appStoreSource = fs.readFileSync(
      path.resolve(__dirname, '..', 'src', 'renderer', 'stores', 'app.store.ts'),
      'utf8'
    );
    const engineSource = fs.readFileSync(
      path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'design-agent', 'engine.ts'),
      'utf8'
    );
    const conversationalSource = fs.readFileSync(
      path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'agent-orchestration', 'conversational.ts'),
      'utf8'
    );

    cases.push({
      name: 'router-model-call-is-silent-and-non-streaming',
      status:
        classifierSource.includes("purpose: 'router'")
        && classifierSource.includes('silent: true')
        && classifierSource.includes('stream: false')
        && chatPanelSource.includes('const isRouterCall =')
        && chatPanelSource.includes("options?.purpose === 'router'")
        && chatPanelSource.includes('!isRouterCall && canUsePlainTextProviderStream')
        && chatPanelSource.includes('shouldUseAttachedImages && !isRouterCall && !isVisibleReasoningCall')
        && chatPanelSource.includes("isRouterCall || isVisibleReasoningCall")
        && chatPanelSource.includes('const streamHasAttachedImage = isVisibleReasoningCall ? false : shouldUseAttachedImages;')
        && classifierSource.includes('Return strict JSON only.')
          ? 'pass'
          : 'fail',
      details: JSON.stringify({
        classifierMarksRouter: classifierSource.includes("purpose: 'router'"),
        classifierSilent: classifierSource.includes('silent: true'),
        classifierNonStreaming: classifierSource.includes('stream: false'),
        chatPanelHasRouterGuard: chatPanelSource.includes('const isRouterCall ='),
        streamGuarded: chatPanelSource.includes('!isRouterCall && canUsePlainTextProviderStream'),
        imageInjectionGuarded: chatPanelSource.includes('shouldUseAttachedImages && !isRouterCall && !isVisibleReasoningCall'),
        visibleReasoningUsesLogicTask: chatPanelSource.includes("isRouterCall || isVisibleReasoningCall"),
        visibleReasoningStreamTextOnly: chatPanelSource.includes('const streamHasAttachedImage = isVisibleReasoningCall ? false : shouldUseAttachedImages;'),
        classifierIsJsonOnly: classifierSource.includes('Return strict JSON only.')
      })
    });

    const routerDirectResponseIndex = engineSource.indexOf("modelDecision?.route === 'direct_response'");
    const routerDirectResponseBlock = routerDirectResponseIndex >= 0
      ? engineSource.slice(routerDirectResponseIndex, routerDirectResponseIndex + 2200)
      : '';
    cases.push({
      name: 'router-direct-response-reuses-conversational-quality-gate',
      status:
        routerDirectResponseBlock.includes('tryConversationalModelReplyDetailed')
        && (
          routerDirectResponseBlock.includes('success: Boolean(conversationalReply)')
          || routerDirectResponseBlock.includes('buildConversationalUnavailableStatusResult')
        )
        && routerDirectResponseBlock.includes("error: 'conversational_reply_unavailable'")
        && !routerDirectResponseBlock.includes('message: modelDecision.directResponse')
        && !engineSource.includes('resolveRouterDirectResponse' + String.fromCharCode(70, 97, 108, 108, 98, 97, 99, 107))
        && !engineSource.includes('router-direct-response:router-field')
          ? 'pass'
          : 'fail',
      details: JSON.stringify({
        hasRouterDirectResponseBlock: routerDirectResponseIndex >= 0,
        usesConversationalGate: routerDirectResponseBlock.includes('tryConversationalModelReplyDetailed'),
        marksUnavailableAsFailure:
          routerDirectResponseBlock.includes('success: Boolean(conversationalReply)')
          || routerDirectResponseBlock.includes('buildConversationalUnavailableStatusResult'),
        hasUnavailableError: routerDirectResponseBlock.includes("error: 'conversational_reply_unavailable'"),
        directlyReturnsRouterDirectResponse: routerDirectResponseBlock.includes('message: modelDecision.directResponse'),
        hasRouterFixedTemplateFunction: engineSource.includes('resolveRouterDirectResponse' + String.fromCharCode(70, 97, 108, 108, 98, 97, 99, 107)),
        hasRouterFieldOrigin: engineSource.includes('router-direct-response:router-field')
      })
    });

    cases.push({
      name: 'chat-panel-does-not-intercept-copy-variant-selection-before-agent',
      status:
        !chatPanelSource.includes('designecho_smart_copy_data')
        && !chatPanelSource.includes('handleApplySmartCopyVersion')
        && !chatPanelSource.includes('smartCopyMatch')
        && !chatPanelSource.includes("smart-copy:missing-data")
          ? 'pass'
          : 'fail',
      details: JSON.stringify({
        hasLegacyStorageKey: chatPanelSource.includes('designecho_smart_copy_data'),
        hasLegacyHandler: chatPanelSource.includes('handleApplySmartCopyVersion'),
        hasLegacyInputIntercept: chatPanelSource.includes('smartCopyMatch'),
        hasLegacyMissingDataReply: chatPanelSource.includes('smart-copy:missing-data')
      })
    });

    const controlPlaneSource = fs.readFileSync(
      path.resolve(__dirname, '..', 'src', 'shared', 'agent-intent-control-plane.ts'),
      'utf8'
    );
    const lifecycleSource = fs.readFileSync(
      path.resolve(__dirname, '..', 'src', 'shared', 'agent-request-lifecycle.ts'),
      'utf8'
    );
    cases.push({
      name: 'agent-decision-chain-does-not-use-ungrounded-confidence',
      status:
        !controlPlaneSource.includes('confidence:')
        && !controlPlaneSource.includes('.confidence')
        && !classifierSource.includes('"confidence": number')
        && !classifierSource.includes('clampConfidence')
        && !engineSource.includes('intentControlPlane.confidence')
        && !engineSource.includes('modelDecision.confidence >=')
        && !engineSource.includes('置信度')
        && !lifecycleSource.includes('decision: {\n            source: input.routeSource,\n            route: input.route,\n            skillId: normalizeText(input.skillId) || undefined,\n            mode: normalizeText(input.mode) || undefined,\n            confidence')
          ? 'pass'
          : 'fail',
      details: JSON.stringify({
        controlPlaneHasConfidence: controlPlaneSource.includes('confidence:') || controlPlaneSource.includes('.confidence'),
        classifierRequiresConfidence: classifierSource.includes('"confidence": number') || classifierSource.includes('clampConfidence'),
        engineUsesControlPlaneConfidence: engineSource.includes('intentControlPlane.confidence'),
        engineUsesModelConfidenceThreshold: engineSource.includes('modelDecision.confidence >='),
        engineUserCopyMentionsConfidence: engineSource.includes('置信度'),
        lifecycleDecisionHasConfidence: lifecycleSource.includes('decision: {\n            source: input.routeSource,\n            route: input.route,\n            skillId: normalizeText(input.skillId) || undefined,\n            mode: normalizeText(input.mode) || undefined,\n            confidence')
      })
    });

    const visibleReasoningGateIndex = engineSource.indexOf('shouldRequestInitialVisibleIntentPreview(initialDeterministicRoute');
    const visibleReasoningCallIndex = engineSource.indexOf('requestInitialVisibleIntentPreview(context, callModel, callbacks)');
    const deterministicRouteIndex = engineSource.indexOf('const deterministicRouteCandidate = buildRetryDeterministicRoute(context)');
    cases.push({
      name: 'visible-reasoning-preview-is-gated-without-business-parser-preflight',
      status:
        visibleReasoningGateIndex >= 0
        && visibleReasoningCallIndex >= 0
        && deterministicRouteIndex >= 0
        && visibleReasoningGateIndex < visibleReasoningCallIndex
        && visibleReasoningCallIndex < deterministicRouteIndex
        && !engineSource.includes('buildCurrentDocumentStructureRouteOptions')
        && !engineSource.includes('parseDetailPageTemplate')
          ? 'pass'
          : 'fail',
      details: JSON.stringify({
        visibleReasoningGateIndex,
        visibleReasoningCallIndex,
        deterministicRouteIndex,
        hasBusinessParserPreflight: engineSource.includes('buildCurrentDocumentStructureRouteOptions')
      })
    });

    const noToolExplanationDecision = intentControlPlane?.buildAgentIntentControlPlaneDecision?.({
      userInput: '真实窗口测试：我刚才说“帮我使用SKU素材做白底图导出到主图目录下”，你先只说明你如何理解，不要执行任何工具。',
      hasDocument: true,
      photoshopConnected: true
    });
    cases.push({
      name: 'explicit-no-tool-directive-overrides-skill-routing',
      status:
        noToolExplanationDecision?.requestKind === 'chat_only'
        && noToolExplanationDecision?.toolScope === 'none'
        && noToolExplanationDecision?.shouldUseConversationalPath === true
        && noToolExplanationDecision?.allowsDeterministicRoute === false
        && noToolExplanationDecision?.matchedSignals?.includes('explicit_no_tool_directive')
          ? 'pass'
          : 'fail',
      details: JSON.stringify({
        loadError: intentControlPlaneLoadError ? String(intentControlPlaneLoadError.message || intentControlPlaneLoadError) : null,
        decision: noToolExplanationDecision
      })
    });

    cases.push({
      name: 'conversational-reply-does-not-fake-semantic-understanding-locally',
      status:
        !conversationalSource.includes('buildExplanationOnlyNoTool' + String.fromCharCode(70, 97, 108, 108, 98, 97, 99, 107) + 'Reply')
        && !conversationalSource.includes('extractExplanationTargetText')
        && !conversationalSource.includes('你想先确认我如何理解')
        && conversationalSource.includes('不要把概念问题改写成“你想确认我如何理解这件事”')
          ? 'pass'
          : 'fail',
      details: JSON.stringify({
        hasLocalSemanticTemplate: conversationalSource.includes('buildExplanationOnlyNoTool' + String.fromCharCode(70, 97, 108, 108, 98, 97, 99, 107) + 'Reply'),
        hasTargetExtractor: conversationalSource.includes('extractExplanationTargetText'),
        hasMechanicalUnderstandingTemplate: conversationalSource.includes('你想先确认我如何理解'),
        hasConceptQuestionGuard: conversationalSource.includes('不要把概念问题改写成“你想确认我如何理解这件事”')
      })
    });

    const conceptualNoToolCalls = [];
    const conceptualNoToolReply = await conversational.tryConversationalModelReply(
      createContext('工具归工具，思考归思考。你怎么理解这句话？只解释，不执行工具。'),
      async (_messages, options) => {
        conceptualNoToolCalls.push(options?.purpose || 'unknown');
        return { text: '这句话的核心是思考先于工具：Agent 应该先理解目标、判断路径，再选择是否调用工具。工具只负责执行边界清晰的动作，不能反过来限制模型对需求、设计和风险的判断。' };
      }
    );
    cases.push({
      name: 'conceptual-no-tool-question-keeps-model-authored-answer',
      status:
        conceptualNoToolReply
        && conceptualNoToolReply.includes('思考先于工具')
        && conceptualNoToolReply.includes('不能反过来限制模型')
        && !conceptualNoToolReply.includes('你想先确认我如何理解')
        && sameJson(conceptualNoToolCalls, ['direct_response'])
          ? 'pass'
          : 'fail',
      details: JSON.stringify({
        calls: conceptualNoToolCalls,
        conceptualNoToolReply
      })
    });

    const skuCapabilitySolicitationCalls = [];
    const skuCapabilitySolicitationReply = await conversational.tryConversationalModelReply(
      createContext('你会做SKU吗'),
      async (_messages, options) => {
        skuCapabilitySolicitationCalls.push(options?.purpose || 'unknown');
        return {
          text: '在电商袜子项目中，SKU 通常指的是不同规格的产品组合，比如 2双、3双、4双等。我可以帮你设计和组合这些 SKU 的视觉展示，包括规格图和自选备注图。如果你有具体的规格或备注需求，我可以帮你看看如何优化展示。'
        };
      }
    );
    cases.push({
      name: 'sku-capability-solicitation-tail-is-repaired-instead-of-unavailable',
      status:
        skuCapabilitySolicitationReply
        && skuCapabilitySolicitationReply.includes('SKU')
        && /组合|规格图|自选备注/u.test(skuCapabilitySolicitationReply)
        && !/(具体的设计需求|具体的规格|备注需求|告诉我|请提供|请补充)/u.test(skuCapabilitySolicitationReply)
        && sameJson(skuCapabilitySolicitationCalls, ['direct_response', 'direct_response_repair'])
          ? 'pass'
          : 'fail',
      details: JSON.stringify({
        calls: skuCapabilitySolicitationCalls,
        skuCapabilitySolicitationReply
      })
    });

    const skuCapabilityStyleSolicitationCalls = [];
    const skuCapabilityStyleSolicitationReply = await conversational.tryConversationalModelReply(
      createContext('你会做SKU吗'),
      async (_messages, options) => {
        skuCapabilityStyleSolicitationCalls.push(options?.purpose || 'unknown');
        return {
          text: 'SKU组合图可以做，比如袜子项目的规格组合展示。需要的话可以具体说说你想要什么风格的SKU展示？'
        };
      }
    );
    cases.push({
      name: 'sku-capability-style-solicitation-tail-is-repaired',
      status:
        skuCapabilityStyleSolicitationReply
        && skuCapabilityStyleSolicitationReply.includes('SKU')
        && /组合|规格图|自选备注/u.test(skuCapabilityStyleSolicitationReply)
        && !/(需要的话|具体说说|什么风格|告诉我|请提供|请补充)/u.test(skuCapabilityStyleSolicitationReply)
        && sameJson(skuCapabilityStyleSolicitationCalls, ['direct_response', 'direct_response_repair'])
          ? 'pass'
          : 'fail',
      details: JSON.stringify({
        calls: skuCapabilityStyleSolicitationCalls,
        skuCapabilityStyleSolicitationReply
      })
    });

    const conversationalRepairCalls = [];
    const repairedConversationReply = await conversational.tryConversationalModelReply(
      createContext('真实窗口回归测试：我刚才说“帮我使用SKU素材做白底图导出到主图目录下”，请你先只说明你如何理解，不要执行任何工具。'),
      async (_messages, options) => {
        conversationalRepairCalls.push(options?.purpose || 'unknown');
        if (options?.purpose === 'direct_response') {
          return { text: '好的，我先说说我的理解： --- **你想要的是：** 用项目里的SKU素材，制作白底产品图（通常是指去除原有背景、统一换成纯白底），完成后导出保存到"主图"目录下。 **我会这样拆解任务：** 1. **找素材** — 先确认项目中哪些是SKU素材，是已经抠好的产品图，' };
        }
        return { text: '我的理解是：你要使用当前项目里的 SKU 素材作为白底图来源，生成主图目录需要的白底图导出；本轮你只要求我说明理解，不执行任何 Photoshop 工具。' };
      }
    );
    cases.push({
      name: 'conversational-direct-response-repairs-truncated-stream',
      status:
        repairedConversationReply
        && repairedConversationReply.includes('SKU')
        && repairedConversationReply.includes('白底图')
        && repairedConversationReply.includes('主图')
        && !repairedConversationReply.includes('请提供')
        && !repairedConversationReply.includes('请问')
        && !repairedConversationReply.includes('你想先确认我如何理解')
        && sameJson(conversationalRepairCalls, ['direct_response', 'direct_response_repair'])
          ? 'pass'
          : 'fail',
      details: JSON.stringify({
        calls: conversationalRepairCalls,
        repairedConversationReply
      })
    });

    const markdownFragmentRepairCalls = [];
    const repairedMarkdownFragmentReply = await conversational.tryConversationalModelReply(
      createContext('真实窗口三次回归测试：我刚才说“帮我使用SKU素材做白底图导出到主图目录下”，请你先只说明你如何理解，不要执行任何工具。'),
      async (_messages, options) => {
        markdownFragmentRepairCalls.push(options?.purpose || 'unknown');
        if (options?.purpose === 'direct_response') {
          return { text: '好的，我来说明我的理解： --- **你的需求拆解：** 1. **素材来源** — 使用项目中的SKU产品素材 2. **处理方式** — 制作白底图，即产品放置在纯白背景上 3. **输出位置** — 导出保存到"主图"目录下 --- **在正式执行前，我会想确认几个细节：** - **SKU素材**：项目里目前有哪些SKU图片？是已经抠好的透明底PNG，还是带原始背景需要' };
        }
        return { text: '我的理解是：你要把项目里的 SKU 产品素材作为白底图来源，做成主图目录需要的纯白背景产品图。本轮你只要求我说明理解，所以不会执行 Photoshop 工具。' };
      }
    );
    cases.push({
      name: 'conversational-direct-response-repairs-markdown-list-fragment',
      status:
        repairedMarkdownFragmentReply
        && repairedMarkdownFragmentReply.includes('SKU')
        && repairedMarkdownFragmentReply.includes('白底')
        && repairedMarkdownFragmentReply.includes('主图')
        && !/---|\*\*|(^|\s|\n)[-*]\s+|(^|\s|\n)\d+[.、)]/u.test(repairedMarkdownFragmentReply)
        && !repairedMarkdownFragmentReply.includes('你想先确认我如何理解')
        && sameJson(markdownFragmentRepairCalls, ['direct_response', 'direct_response_repair'])
          ? 'pass'
          : 'fail',
      details: JSON.stringify({
        calls: markdownFragmentRepairCalls,
        repairedMarkdownFragmentReply
      })
    });

    const explanationOnlyFollowupCalls = [];
    const repairedExplanationOnlyFollowupReply = await conversational.tryConversationalModelReply(
      createContext('真实窗口四次回归测试：我刚才说“帮我使用SKU素材做白底图导出到主图目录下”，请你先只说明你如何理解，不要执行任何工具。'),
      async (_messages, options) => {
        explanationOnlyFollowupCalls.push(options?.purpose || 'unknown');
        if (options?.purpose === 'direct_response') {
          return { text: '好的，我理解你的需求是： **用项目中的SKU素材，制作白底产品图，完成后导出到"主图"文件夹。** 执行前我会先确认：具体要用哪些SKU素材、白底图的尺寸规格、以及"主图"目录的具体路径。 请问这些信息方便提供吗？' };
        }
        return { text: '我的理解是：你要使用项目中的 SKU 素材制作白底产品图，并导出到主图目录。本轮只是说明理解，不执行任何工具。' };
      }
    );
    cases.push({
      name: 'conversational-direct-response-repairs-explanation-only-followup-drift',
      status:
        repairedExplanationOnlyFollowupReply
        && repairedExplanationOnlyFollowupReply.includes('SKU')
        && repairedExplanationOnlyFollowupReply.includes('白底')
        && repairedExplanationOnlyFollowupReply.includes('主图')
        && !/(请问|方便提供|请提供|请补充|请明确|需要你提供|能否提供|是否方便)/u.test(repairedExplanationOnlyFollowupReply)
        && !repairedExplanationOnlyFollowupReply.includes('你想先确认我如何理解')
        && sameJson(explanationOnlyFollowupCalls, ['direct_response', 'direct_response_repair'])
          ? 'pass'
          : 'fail',
      details: JSON.stringify({
        calls: explanationOnlyFollowupCalls,
        repairedExplanationOnlyFollowupReply
      })
    });

    const explanationOnlyEmptyModelCalls = [];
    const explanationOnlyReplyWithoutLocalTemplate = await conversational.tryConversationalModelReply(
      createContext('真实窗口六次回归测试：我刚才说“帮我使用SKU素材做白底图导出到主图目录下”，请你先只说明你如何理解，不要执行任何工具。'),
      async (_messages, options) => {
        explanationOnlyEmptyModelCalls.push(options?.purpose || 'unknown');
        return { text: '' };
      }
    );
    cases.push({
      name: 'conversational-direct-response-returns-null-instead-of-faking-empty-model-text',
      status:
        explanationOnlyReplyWithoutLocalTemplate === null
        && sameJson(explanationOnlyEmptyModelCalls, ['direct_response', 'direct_response_repair'])
          ? 'pass'
          : 'fail',
      details: JSON.stringify({
        calls: explanationOnlyEmptyModelCalls,
        explanationOnlyReplyWithoutLocalTemplate
      })
    });

    cases.push({
      name: 'request-lifecycle-is-persisted-as-hidden-message-metadata',
      status:
        appStoreSource.includes('agentRequestLifecycle?: AgentRequestLifecycleRecord')
        && chatPanelSource.includes('agentRequestLifecycle?: AgentRequestLifecycleRecord')
        && chatPanelSource.includes('data?.agentRequestLifecycle')
        && chatPanelSource.includes('agentRequestLifecycle: options?.agentRequestLifecycle')
        && !chatPanelSource.includes("type: 'thinking',\n                                    content: agentRequestLifecycle")
          ? 'pass'
          : 'fail',
      details: JSON.stringify({
        storeMessageField: appStoreSource.includes('agentRequestLifecycle?: AgentRequestLifecycleRecord'),
        chatPanelOptionsField: chatPanelSource.includes('agentRequestLifecycle?: AgentRequestLifecycleRecord'),
        extractsLifecycle: chatPanelSource.includes('data?.agentRequestLifecycle'),
        persistsLifecycle: chatPanelSource.includes('agentRequestLifecycle: options?.agentRequestLifecycle')
      })
    });

    cases.push({
      name: 'skill-id-normalization-uses-shared-helper',
      status:
        normalizeSkillId('document') === 'document-management'
        && normalizeSkillId('template-save') === 'save-current-template'
        && normalizeSkillId('agent-panel') === 'agent-panel-bridge'
          ? 'pass'
          : 'fail',
      details: JSON.stringify({
        document: normalizeSkillId('document'),
        templateSave: normalizeSkillId('template-save'),
        agentPanel: normalizeSkillId('agent-panel')
      })
    });

    cases.push({
      name: 'infer-skill-hint-shares-deterministic-matching',
      status:
        routing.inferSkillHint('帮我抠图') === undefined
        && routing.inferSkillHint('帮我做2-3-4的自选备注') === 'sku-batch'
        && routing.inferSkillHint('帮我把当前文档保存为模板') === 'save-current-template'
        && routing.inferSkillHint('参考图照着做生成同款版式') === 'layout-replication'
        && routing.inferSkillHint('帮我和面板一起调试详情页文案溢出') === 'agent-panel-bridge'
        && routing.inferSkillHint('帮我做转化图 在Adobe Photoshop文档中有800文档') === 'main-image-design'
          ? 'pass'
          : 'fail',
      details: JSON.stringify({
        matte: routing.inferSkillHint('帮我抠图'),
        skuNotes: routing.inferSkillHint('帮我做2-3-4的自选备注'),
        saveTemplate: routing.inferSkillHint('帮我把当前文档保存为模板'),
        layoutReplication: routing.inferSkillHint('参考图照着做生成同款版式'),
        debugBridge: routing.inferSkillHint('帮我和面板一起调试详情页文案溢出'),
        mainImageConversion: routing.inferSkillHint('帮我做转化图 在Adobe Photoshop文档中有800文档')
      })
    });

    const skuComboRoute = routing.fastDeterministicRoute('帮我做4双的SKU组合，需要3个');
    const skuSingleNoteRoute = routing.fastDeterministicRoute('帮我做单双装自选备注');
    const skuMultiNoteRoute = routing.fastDeterministicRoute('帮我做2-3-4的自选备注');
    const attachedReferenceReplicationRoute = routing.fastDeterministicRoute(
      '在我们创建的文档中 帮我复刻其中的内容',
      { hasAttachedImage: true }
    );
    const ambiguousNoImageReplicationRoute = routing.fastDeterministicRoute(
      '在我们创建的文档中 帮我复刻其中的内容'
    );
    const creativePosterReferenceRoute = routing.fastDeterministicRoute(
      '参考这张图做个海报',
      { hasAttachedImage: true }
    );
    const strictPosterReplicationRoute = routing.fastDeterministicRoute(
      '复刻这张海报',
      { hasAttachedImage: true }
    );
    cases.push({
      name: 'sku-deterministic-route-extracts-size-count-and-note-policy',
      status:
        skuComboRoute?.skillId === 'sku-batch'
        && sameJson(skuComboRoute.skillParams.comboSizes, [4])
        && skuComboRoute.skillParams.countPerSize === 3
        && skuComboRoute.skillParams.generateNotes === true
        && skuSingleNoteRoute?.skillId === 'sku-batch'
        && skuSingleNoteRoute.skillParams.onlyNotes === true
        && sameJson(skuSingleNoteRoute.skillParams.comboSizes, [1])
        && skuSingleNoteRoute.skillParams.generateNotes === true
        && skuMultiNoteRoute?.skillId === 'sku-batch'
        && skuMultiNoteRoute.skillParams.onlyNotes === true
        && sameJson(skuMultiNoteRoute.skillParams.comboSizes, [2, 3, 4])
          ? 'pass'
          : 'fail',
      details: JSON.stringify({
        skuCombo: skuComboRoute,
        skuSingleNote: skuSingleNoteRoute,
        skuMultiNote: skuMultiNoteRoute
      })
    });

    cases.push({
      name: 'attached-image-replication-wording-routes-to-layout-replication',
      status:
        attachedReferenceReplicationRoute?.skillId === 'layout-replication'
        && attachedReferenceReplicationRoute.skillParams?.outputMode === 'apply'
        && attachedReferenceReplicationRoute.skillParams?.autoCreateDocument === true
        && attachedReferenceReplicationRoute.skillParams?.preserveReferenceCanvasSize === true
        && ambiguousNoImageReplicationRoute === null
          ? 'pass'
          : 'fail',
      details: JSON.stringify({
        attachedReferenceReplicationRoute,
        ambiguousNoImageReplicationRoute
      })
    });

    cases.push({
      name: 'reference-method-does-not-replace-poster-deliverable-identity',
      status:
        creativePosterReferenceRoute === null
        && strictPosterReplicationRoute?.skillId === 'layout-replication'
        && strictPosterReplicationRoute.skillParams?.artifactKind === 'poster'
          ? 'pass'
          : 'fail',
      details: JSON.stringify({
        creativePosterReferenceRoute,
        strictPosterReplicationRoute
      })
    });

    const simpleShortPathAllowed = [
      'document-management',
      'layer-management',
      'text-font-replace'
    ].map((skillId) => routeBoundaryPolicy.evaluateSimpleDeterministicRouteBoundary({
      skillId,
      hasVisibleModelReasoning: true,
      hasContextImage: false
    }));
    const simpleShortPathDenied = [
      'sku-batch',
      'main-image-design',
      'detail-page-design',
      'layout-replication',
      'project-image-analysis',
      'autonomous-agent'
    ].map((skillId) => routeBoundaryPolicy.evaluateSimpleDeterministicRouteBoundary({
      skillId,
      hasVisibleModelReasoning: true,
      hasContextImage: false
    }));
    const coordinatorWorkflowShortPath = routeBoundaryPolicy.evaluateSimpleDeterministicRouteBoundary({
      skillId: 'ecommerce-socks-design',
      hasVisibleModelReasoning: false,
      hasContextImage: false
    });
    const shortPathNoVisibleReasoning = routeBoundaryPolicy.evaluateSimpleDeterministicRouteBoundary({
      skillId: 'document-management',
      hasVisibleModelReasoning: false,
      hasContextImage: false
    });
    const shortPathWithImage = routeBoundaryPolicy.evaluateSimpleDeterministicRouteBoundary({
      skillId: 'document-management',
      hasVisibleModelReasoning: true,
      hasContextImage: true
    });
    // 真机病例（2026-07-07）：四行待修改文案含「从浅到深都很耐看」被裸正则当成
    // 图层明度排序指令抢跑执行——长输入/多行正文不允许短路径抢跑
    const shortPathLongInput = routeBoundaryPolicy.evaluateSimpleDeterministicRouteBoundary({
      skillId: 'layer-management',
      hasVisibleModelReasoning: true,
      hasContextImage: false,
      userInputText: '帮我把详情页中的文案修改一下 原文是\n让日常穿搭多一点甜美\n从浅到深都很耐看\n通勤出门或周末闲逛\n都能把细节搭得刚刚好'
    });
    const shortPathShortCommand = routeBoundaryPolicy.evaluateSimpleDeterministicRouteBoundary({
      skillId: 'layer-management',
      hasVisibleModelReasoning: true,
      hasContextImage: false,
      userInputText: '把颜色图层从浅到深排一下'
    });
    // 正则纵深（同病例）：方向词必须带图层语境锚定——文案内容不再命中图层管理意图
    const copyTextNotLayerIntent = !routing.isLayerManagementIntent('帮我把详情页中的文案修改一下 原文是 让日常穿搭多一点甜美 从浅到深都很耐看 通勤出门或周末闲逛');
    const anchoredSortStillLayerIntent = routing.isLayerManagementIntent('把颜色图层从浅到深排一下')
      && routing.isLayerManagementIntent('图层从深到浅排序');
    const colorCopyNotLayerIntent = !routing.isLayerManagementIntent('这款袜子有几种颜色可选呢');
    const metadataInventoryRoute = routeBoundaryPolicy.isMetadataOnlyProjectInventoryRoute(
      'project-image-analysis',
      { analysisMode: 'inventory', sampleSize: 0 }
    );
    const contentAnalysisRoute = routeBoundaryPolicy.isMetadataOnlyProjectInventoryRoute(
      'project-image-analysis',
      { analysisMode: 'content', sampleSize: 6 }
    );
    cases.push({
      name: 'route-boundary-policy-keeps-short-path-mechanical-only',
      status:
        simpleShortPathAllowed.every((item) => item.allowed && item.category === 'simple_mechanical_operation')
        && simpleShortPathDenied.every((item) => !item.allowed && item.category === 'business_or_open_design')
        && coordinatorWorkflowShortPath.allowed
        && coordinatorWorkflowShortPath.category === 'coordinator_workflow'
        && shortPathNoVisibleReasoning.allowed
        && shortPathNoVisibleReasoning.category === 'simple_mechanical_operation'
        && !shortPathWithImage.allowed
        && shortPathWithImage.category === 'business_or_open_design'
        && !shortPathLongInput.allowed
        && shortPathLongInput.reason.includes('多行正文')
        && shortPathShortCommand.allowed
        && copyTextNotLayerIntent
        && anchoredSortStillLayerIntent
        && colorCopyNotLayerIntent
        && metadataInventoryRoute === true
        && contentAnalysisRoute === false
          ? 'pass'
          : 'fail',
      details: JSON.stringify({
        simpleShortPathAllowed,
        simpleShortPathDenied,
        coordinatorWorkflowShortPath,
        shortPathNoVisibleReasoning,
        shortPathWithImage,
        metadataInventoryRoute,
        contentAnalysisRoute
      })
    });

    const documentVeto = routeBoundaryPolicy.evaluateDeterministicRouteVeto({
      deterministicSkillId: 'document-management',
      modelSkillId: 'detail-page-design',
      isDocumentManagementIntent: true
    });
    const layoutVeto = routeBoundaryPolicy.evaluateDeterministicRouteVeto({
      deterministicSkillId: 'layout-replication',
      modelSkillId: 'main-image-design',
      isLayoutReplicationIntent: true
    });
    const retryVeto = routeBoundaryPolicy.evaluateDeterministicRouteVeto({
      deterministicSkillId: 'text-font-replace',
      modelSkillId: 'agent-panel-bridge',
      isRetryRoute: true
    });
    const skuVeto = routeBoundaryPolicy.evaluateDeterministicRouteVeto({
      deterministicSkillId: 'sku-batch',
      modelSkillId: 'main-image-design',
      isSkuIntent: true
    });
    const mainImageVeto = routeBoundaryPolicy.evaluateDeterministicRouteVeto({
      deterministicSkillId: 'main-image-design',
      modelSkillId: 'sku-batch',
      isMainImageDesignIntent: true
    });
    const skuParentPromotionVeto = routeBoundaryPolicy.evaluateDeterministicRouteVeto({
      deterministicSkillId: 'sku-batch',
      modelSkillId: 'ecommerce-socks-design',
      isSkuIntent: true
    });
    const readOnlyNonExecutionProtection = routeBoundaryPolicy.evaluateDeterministicNonExecutionProtection({
      deterministicSkillId: 'project-image-analysis',
      requestKind: 'read_only_inspect'
    });
    const skuNonExecutionProtection = routeBoundaryPolicy.evaluateDeterministicNonExecutionProtection({
      deterministicSkillId: 'sku-batch',
      requestKind: 'execute_skill',
      isSkuIntent: true,
      modelRoute: 'direct_response',
      modelDirectResponse: '我可以协助这些设计工作：主图、点击图、转化图和白底图规划、SKU 组合图和自选备注、详情页设计。你可以直接提出主图、SKU、详情页需求。'
    });
    const skuDirectWaitForUserProtection = routeBoundaryPolicy.evaluateDeterministicNonExecutionProtection({
      deterministicSkillId: 'sku-batch',
      requestKind: 'execute_skill',
      isSkuIntent: true,
      modelRoute: 'direct_response',
      modelDirectResponse: '当前先不要执行 Photoshop，等你确认 SKU 源文件和规格后再做。'
    });
    const skuGenericClarificationDirectResponseProtection = routeBoundaryPolicy.evaluateDeterministicNonExecutionProtection({
      deterministicSkillId: 'sku-batch',
      requestKind: 'execute_skill',
      isSkuIntent: true,
      modelRoute: 'direct_response',
      modelDirectResponse: '好的，想帮你做 SKU 组合图。先确认一下：这是什么品类的产品？比如袜子、服装还是其他？以及现在有哪些规格（颜色/尺码/款式）需要组合？'
    });
    const skuExecutionQuestionDirectResponseProtection = routeBoundaryPolicy.evaluateDeterministicNonExecutionProtection({
      deterministicSkillId: 'sku-batch',
      requestKind: 'execute_skill',
      isSkuIntent: true,
      modelRoute: 'direct_response',
      modelDirectResponse: '可以帮你做SKU组合图。不过你这个商品是什么品类，有几款颜色或者规格？另外项目里现在有素材了吗，还是需要从头搭？'
    });
    const skuGenericClarificationQuestionProtection = routeBoundaryPolicy.evaluateDeterministicNonExecutionProtection({
      deterministicSkillId: 'sku-batch',
      requestKind: 'execute_skill',
      executionAuthorization: 'confirmed_tool_required',
      isSkuIntent: true,
      modelRoute: 'clarification_needed',
      modelClarificationQuestion: '请问你做的是什么品类？目前有哪些 SKU 规格、素材和模板？'
    });
    const skuUserRequestedClarificationProtection = routeBoundaryPolicy.evaluateDeterministicNonExecutionProtection({
      deterministicSkillId: 'sku-batch',
      requestKind: 'execute_skill',
      isSkuIntent: true,
      userRequestedClarification: true,
      modelRoute: 'direct_response',
      modelDirectResponse: '当前先不要执行 Photoshop，等你确认 SKU 源文件和规格后再做。'
    });
    const skuNoModelRouteProtection = routeBoundaryPolicy.evaluateDeterministicNonExecutionProtection({
      deterministicSkillId: 'sku-batch',
      requestKind: 'execute_skill',
      isSkuIntent: true
    });
    const mainImageNonExecutionProtection = routeBoundaryPolicy.evaluateDeterministicNonExecutionProtection({
      deterministicSkillId: 'main-image-design',
      requestKind: 'execute_skill',
      isMainImageDesignIntent: true,
      modelRoute: 'clarification_needed',
      modelClarificationQuestion: '需要先说明要处理哪个图层或画面。'
    });
    const templateSaveNonExecutionProtection = routeBoundaryPolicy.evaluateDeterministicNonExecutionProtection({
      deterministicSkillId: 'save-current-template',
      requestKind: 'execute_skill',
      isTemplateSaveIntent: true
    });
    const genericNonExecutionAllowed = routeBoundaryPolicy.evaluateDeterministicNonExecutionProtection({
      deterministicSkillId: 'main-image-design',
      requestKind: 'execute_skill'
    });
    cases.push({
      name: 'route-boundary-policy-protects-only-critical-deterministic-routes',
      status:
        documentVeto.allowed
        && layoutVeto.allowed
        && retryVeto.allowed
        && skuVeto.allowed
        && mainImageVeto.allowed
        && readOnlyNonExecutionProtection.allowed
        && skuNonExecutionProtection.allowed
        && skuDirectWaitForUserProtection.allowed
        && skuGenericClarificationDirectResponseProtection.allowed
        && skuExecutionQuestionDirectResponseProtection.allowed
        && skuGenericClarificationQuestionProtection.allowed
        && !skuUserRequestedClarificationProtection.allowed
        && !skuNoModelRouteProtection.allowed
        && mainImageNonExecutionProtection.allowed
        && templateSaveNonExecutionProtection.allowed
        && !genericNonExecutionAllowed.allowed
        && skuParentPromotionVeto.allowed
          ? 'pass'
          : 'fail',
      details: JSON.stringify({
        documentVeto,
        layoutVeto,
        retryVeto,
        skuVeto,
        mainImageVeto,
        readOnlyNonExecutionProtection,
        skuNonExecutionProtection,
        skuDirectWaitForUserProtection,
        skuGenericClarificationDirectResponseProtection,
        skuExecutionQuestionDirectResponseProtection,
        skuGenericClarificationQuestionProtection,
        skuUserRequestedClarificationProtection,
        skuNoModelRouteProtection,
        mainImageNonExecutionProtection,
        templateSaveNonExecutionProtection,
        genericNonExecutionAllowed,
        skuParentPromotionVeto
      })
    });

    const skuMaterialWhiteBgInputs = [
      '帮我使用SKU素材做白底图导出到主图目录下',
      '帮我使用SKU素材做白底导出到主图目录下',
      '帮我使用SKU素材做自底图导出到主图目录下'
    ];
    const skuMaterialWhiteBgRouteChecks = skuMaterialWhiteBgInputs.map((input) => ({
      input,
      sharedMatch: findSkillRoutingIntent(input),
      mainImageIntent: routing.isMainImageDesignIntent(input),
      skuIntent: routing.isSkuIntent(input),
      skuHijack: matchesSkillRoutingIntent('sku-batch', input)
    }));
    const ambiguousSkuSourceExportInput = '使用SKU素材导出';


    cases.push({
      name: 'shared-skill-signal-matcher-supports-core-routes',
      status:
        matchesSkillRoutingIntent('save-current-template', '帮我把当前文档加入模板库')
        && !matchesSkillRoutingIntent('detail-page-template-authoring', '帮我从零做一个详情页模板')
        && !matchesSkillRoutingIntent('main-image-template-authoring', '帮我从零做一个主图模板')
        && matchesSkillRoutingIntent('text-font-replace', '帮我把字体全部改成思源黑体')
        && matchesSkillRoutingIntent('layout-replication', '参考图照着做生成同款版式')
        && matchesSkillRoutingIntent('project-image-analysis', '理解一下项目中的图片，看看这款是什么款式，有哪些特征，后续详情页可以怎么做')
        && matchesSkillRoutingIntent('document-management', '帮我把详情页文档保存到项目的PSD中')
        && matchesSkillRoutingIntent('document-management', '帮我把详情页文档导出成PNG')
        && matchesSkillRoutingIntent('main-image-design', '帮我做转化图 在Adobe Photoshop文档中有800文档')
        && matchesSkillRoutingIntent('main-image-design', '帮我使用SKU素材做白底图导出到主图目录下')
        && skuMaterialWhiteBgRouteChecks.every((item) => item.sharedMatch?.skillId === 'main-image-design')
        && skuMaterialWhiteBgRouteChecks.every((item) => item.mainImageIntent)
        && skuMaterialWhiteBgRouteChecks.every((item) => !item.skuIntent && !item.skuHijack)
        && !routing.isSkuIntent(ambiguousSkuSourceExportInput)
        && !matchesSkillRoutingIntent('sku-batch', ambiguousSkuSourceExportInput)
        && findSkillRoutingIntent('帮我做转化图 在Adobe Photoshop文档中有800文档')?.skillId === 'main-image-design'
        && findSkillRoutingIntent('帮我使用SKU素材做白底图导出到主图目录下')?.skillId === 'main-image-design'
        && routing.isMainImageDesignIntent('帮我使用SKU素材做白底图导出到主图目录下')
        && !routing.isSkuIntent('帮我使用SKU素材做白底图导出到主图目录下')
        && !matchesSkillRoutingIntent('sku-batch', '帮我使用SKU素材做白底图导出到主图目录下')
        && !matchesSkillRoutingIntent('detail-page-design', '帮我把详情页文档导出成PNG')
        && !matchesSkillRoutingIntent('project-image-analysis', '分析一下这个款式有什么特征')
        && !matchesSkillRoutingIntent('project-image-analysis', '帮我分析上传图片的构图')
        && !matchesSkillRoutingIntent('agent-panel-bridge', '帮我关闭文档不保存')
          ? 'pass'
          : 'fail',
      details: JSON.stringify({
        saveTemplate: matchesSkillRoutingIntent('save-current-template', '帮我把当前文档加入模板库'),
        detailTemplateRemoved: !matchesSkillRoutingIntent('detail-page-template-authoring', '帮我从零做一个详情页模板'),
        mainTemplateRemoved: !matchesSkillRoutingIntent('main-image-template-authoring', '帮我从零做一个主图模板'),
        textFont: matchesSkillRoutingIntent('text-font-replace', '帮我把字体全部改成思源黑体'),
        layoutReplication: matchesSkillRoutingIntent('layout-replication', '参考图照着做生成同款版式'),
        projectImageAnalysis: matchesSkillRoutingIntent('project-image-analysis', '理解一下项目中的图片，看看这款是什么款式，有哪些特征，后续详情页可以怎么做'),
        documentSave: matchesSkillRoutingIntent('document-management', '帮我把详情页文档保存到项目的PSD中'),
        documentExport: matchesSkillRoutingIntent('document-management', '帮我把详情页文档导出成PNG'),
        mainImageConversion: matchesSkillRoutingIntent('main-image-design', '帮我做转化图 在Adobe Photoshop文档中有800文档'),
        skuMaterialWhiteBgMainImage: matchesSkillRoutingIntent('main-image-design', '帮我使用SKU素材做白底图导出到主图目录下'),
        skuMaterialWhiteBgRouteChecks,
        ambiguousSkuSourceExport: {
          skuIntent: routing.isSkuIntent(ambiguousSkuSourceExportInput),
          skuHijack: matchesSkillRoutingIntent('sku-batch', ambiguousSkuSourceExportInput),
          sharedRoutingMatch: findSkillRoutingIntent(ambiguousSkuSourceExportInput)
        },
        sharedRoutingMatch: findSkillRoutingIntent('帮我做转化图 在Adobe Photoshop文档中有800文档'),
        skuMaterialWhiteBgSharedRoutingMatch: findSkillRoutingIntent('帮我使用SKU素材做白底图导出到主图目录下'),
        skuMaterialWhiteBgMainImageIntent: routing.isMainImageDesignIntent('帮我使用SKU素材做白底图导出到主图目录下'),
        skuMaterialWhiteBgSkuIntent: routing.isSkuIntent('帮我使用SKU素材做白底图导出到主图目录下'),
        skuMaterialWhiteBgSkuHijack: matchesSkillRoutingIntent('sku-batch', '帮我使用SKU素材做白底图导出到主图目录下'),
        detailExportHijack: matchesSkillRoutingIntent('detail-page-design', '帮我把详情页文档导出成PNG'),
        genericStyleQuestion: matchesSkillRoutingIntent('project-image-analysis', '分析一下这个款式有什么特征'),
        singleImageVisualAnalysis: matchesSkillRoutingIntent('project-image-analysis', '帮我分析上传图片的构图'),
        bridgeNegative: matchesSkillRoutingIntent('agent-panel-bridge', '帮我关闭文档不保存')
      })
    });

    const projectInventoryWordingChecks = [
      '项目内有什么',
      '项目里有什么',
      '项目中有什么',
      '项目有什么'
    ].map((input) => ({
      input,
      sharedMatch: matchesSkillRoutingIntent('project-image-analysis', input),
      lightweightIntent: routing.detectLightweightIntent(input),
      route: routing.fastDeterministicRoute(input)
    }));

    cases.push({
      name: 'project-identity-routes-readonly-metadata-instead-of-generic-chat',
      status:
        routing.detectLightweightIntent('当前是什么项目') === 'none'
        && routing.fastDeterministicRoute('当前是什么项目')?.skillId === 'project-image-analysis'
        && routing.fastDeterministicRoute('当前是什么项目')?.skillParams?.analysisMode === 'inventory'
        && routing.fastDeterministicRoute('当前是什么项目')?.skillParams?.sampleSize === 0
        && routing.detectLightweightIntent('帮我看看当前是个什么项目') === 'none'
        && routing.fastDeterministicRoute('帮我看看当前是个什么项目')?.skillId === 'project-image-analysis'
        && routing.fastDeterministicRoute('帮我看看当前是个什么项目')?.skillParams?.analysisMode === 'inventory'
        && routing.fastDeterministicRoute('帮我看看当前是个什么项目')?.skillParams?.sampleSize === 0
        && matchesSkillRoutingIntent('project-image-analysis', '你可以帮我看看这个项目都有什么')
        && matchesSkillRoutingIntent('project-image-analysis', '这个项目都有些什么')
        && matchesSkillRoutingIntent('project-image-analysis', '你可以帮我看看这个项目都有些什么')
        && matchesSkillRoutingIntent('project-image-analysis', '帮我看看当前项目图片是什么款式')
        && matchesSkillRoutingIntent('project-image-analysis', '你能看看这些图片是什么 你能描述一下吗 并总结一下内容')
        && routing.fastDeterministicRoute('你可以帮我看看这个项目都有什么')?.skillId === 'project-image-analysis'
        && routing.fastDeterministicRoute('你可以帮我看看这个项目都有什么')?.skillParams?.analysisMode === 'inventory'
        && routing.fastDeterministicRoute('你可以帮我看看这个项目都有什么')?.skillParams?.sampleSize === 0
        && routing.fastDeterministicRoute('这个项目都有些什么')?.skillId === 'project-image-analysis'
        && routing.fastDeterministicRoute('这个项目都有些什么')?.skillParams?.analysisMode === 'inventory'
        && routing.fastDeterministicRoute('这个项目都有些什么')?.skillParams?.sampleSize === 0
        && routing.fastDeterministicRoute('你可以帮我看看这个项目都有些什么')?.skillId === 'project-image-analysis'
        && routing.fastDeterministicRoute('你可以帮我看看这个项目都有些什么')?.skillParams?.analysisMode === 'inventory'
        && routing.fastDeterministicRoute('你可以帮我看看这个项目都有些什么')?.skillParams?.sampleSize === 0
        && routing.detectLightweightIntent('帮我看看当前项目图片是什么款式') === 'none'
        && routing.fastDeterministicRoute('帮我看看当前项目图片是什么款式')?.skillId === 'project-image-analysis'
        && routing.detectLightweightIntent('你能看看这些图片是什么 你能描述一下吗 并总结一下内容') === 'none'
        && routing.fastDeterministicRoute('你能看看这些图片是什么 你能描述一下吗 并总结一下内容')?.skillId === 'project-image-analysis'
        && projectInventoryWordingChecks.every((item) => (
          item.sharedMatch
          && item.lightweightIntent === 'none'
          && item.route?.skillId === 'project-image-analysis'
          && item.route?.skillParams?.analysisMode === 'inventory'
          && item.route?.skillParams?.sampleSize === 0
          && item.route?.skillParams?.focus === 'inventory'
        ))
        && !matchesSkillRoutingIntent('project-image-analysis', '有什么')
        && !matchesSkillRoutingIntent('project-image-analysis', '看看我们是否可以开始做主图详情页了')
        && !matchesSkillRoutingIntent('project-image-analysis', '帮我处理一下')
          ? 'pass'
          : 'fail',
      details: JSON.stringify({
        overviewMatch: matchesSkillRoutingIntent('project-image-analysis', '帮我看看当前是个什么项目'),
        exactOverviewMatch: matchesSkillRoutingIntent('project-image-analysis', '帮我看看当前是什么项目'),
        bareOverviewMatch: matchesSkillRoutingIntent('project-image-analysis', '当前是什么项目'),
        inventoryMatch: matchesSkillRoutingIntent('project-image-analysis', '你可以帮我看看这个项目都有什么'),
        bareInventoryVariantMatch: matchesSkillRoutingIntent('project-image-analysis', '这个项目都有些什么'),
        inventoryVariantMatch: matchesSkillRoutingIntent('project-image-analysis', '你可以帮我看看这个项目都有些什么'),
        projectStyleMatch: matchesSkillRoutingIntent('project-image-analysis', '帮我看看当前项目图片是什么款式'),
        theseImagesMatch: matchesSkillRoutingIntent('project-image-analysis', '你能看看这些图片是什么 你能描述一下吗 并总结一下内容'),
        overviewSharedRoute: findSkillRoutingIntent('帮我看看当前是个什么项目'),
        bareOverviewLightweight: routing.detectLightweightIntent('当前是什么项目'),
        bareOverviewFastRoute: routing.fastDeterministicRoute('当前是什么项目'),
        overviewLightweight: routing.detectLightweightIntent('帮我看看当前是个什么项目'),
        overviewFastRoute: routing.fastDeterministicRoute('帮我看看当前是个什么项目'),
        inventoryFastRoute: routing.fastDeterministicRoute('你可以帮我看看这个项目都有什么'),
        bareInventoryVariantFastRoute: routing.fastDeterministicRoute('这个项目都有些什么'),
        inventoryVariantFastRoute: routing.fastDeterministicRoute('你可以帮我看看这个项目都有些什么'),
        projectStyleLightweight: routing.detectLightweightIntent('帮我看看当前项目图片是什么款式'),
        projectStyleFastRoute: routing.fastDeterministicRoute('帮我看看当前项目图片是什么款式'),
        theseImagesLightweight: routing.detectLightweightIntent('你能看看这些图片是什么 你能描述一下吗 并总结一下内容'),
        theseImagesFastRoute: routing.fastDeterministicRoute('你能看看这些图片是什么 你能描述一下吗 并总结一下内容'),
        projectInventoryWordingChecks,
        ungroundedInventoryQuestion: matchesSkillRoutingIntent('project-image-analysis', '有什么'),
        planOnlyHijack: matchesSkillRoutingIntent('project-image-analysis', '看看我们是否可以开始做主图详情页了'),
        ambiguousHijack: matchesSkillRoutingIntent('project-image-analysis', '帮我处理一下')
      })
    });

    cases.push({
      name: 'detail-page-mode-signals-come-from-shared-metadata',
      status:
        matchesSkillRoutingIntent('detail-page-design', '帮我检查一下当前详情页结构')
        && resolveSkillRoutingMode('detail-page-design', '帮我检查一下当前详情页结构') === 'inspect'
        && resolveSkillRoutingMode('detail-page-design', '帮我设计并导出详情页') === 'execute'
        && !matchesSkillRoutingIntent('detail-page-design', '帮我把详情页文档导出成PNG')
          ? 'pass'
          : 'fail',
      details: JSON.stringify({
        inspectIntent: matchesSkillRoutingIntent('detail-page-design', '帮我检查一下当前详情页结构'),
        inspectMode: resolveSkillRoutingMode('detail-page-design', '帮我检查一下当前详情页结构'),
        executeMode: resolveSkillRoutingMode('detail-page-design', '帮我设计并导出详情页'),
        documentExportHijack: matchesSkillRoutingIntent('detail-page-design', '帮我把详情页文档导出成PNG')
      })
    });

    cases.push({
      name: 'document-action-signals-come-from-shared-metadata',
      status:
        matchesSkillRoutingIntent('document-management', '帮我关闭文档不保存')
        && resolveSkillRoutingMode('document-management', '帮我把详情页文档保存到项目的PSD中') === 'save'
        && resolveSkillRoutingMode('document-management', '帮我把详情页文档导出成PNG') === 'save'
        && resolveSkillRoutingMode('document-management', '帮我关闭文档不保存') === 'close'
        && resolveSkillRoutingMode('document-management', '帮我切换文档到 A.psd') === 'switch'
        && resolveSkillRoutingMode('document-management', '帮我列出当前文档') === 'list'
        && resolveSkillRoutingMode('document-management', '只读检查：请列出当前 Photoshop 打开的文档名称和路径，不要创建或修改任何内容。') === 'list'
        && resolveSkillRoutingMode('document-management', '帮我新建文档') === 'create'
        && matchesSkillRoutingIntent('document-management', '帮我新建一个 800x800 的文档，名称 DesignEchoLiveAgentAcceptance')
        && resolveSkillRoutingMode('document-management', '帮我新建一个 800x800 的文档，名称 DesignEchoLiveAgentAcceptance') === 'create'
          ? 'pass'
          : 'fail',
      details: JSON.stringify({
        save: resolveSkillRoutingMode('document-management', '帮我把详情页文档保存到项目的PSD中'),
        export: resolveSkillRoutingMode('document-management', '帮我把详情页文档导出成PNG'),
        close: resolveSkillRoutingMode('document-management', '帮我关闭文档不保存'),
        switch: resolveSkillRoutingMode('document-management', '帮我切换文档到 A.psd'),
        list: resolveSkillRoutingMode('document-management', '帮我列出当前文档'),
        readonlyList: resolveSkillRoutingMode('document-management', '只读检查：请列出当前 Photoshop 打开的文档名称和路径，不要创建或修改任何内容。'),
        create: resolveSkillRoutingMode('document-management', '帮我新建文档'),
        createSizedNamed: resolveSkillRoutingMode('document-management', '帮我新建一个 800x800 的文档，名称 DesignEchoLiveAgentAcceptance')
      })
    });

    cases.push({
      name: 'document-routing-params-use-shared-helper-safely',
      status:
        JSON.stringify(extractDocumentManagementRoutingParams('帮我关闭文档', 'close')) === JSON.stringify({ action: 'close' })
        && JSON.stringify(extractDocumentManagementRoutingParams('帮我关闭 A.psd 不保存', 'close')) === JSON.stringify({ action: 'close', documentName: 'A.psd', save: false })
        && JSON.stringify(extractDocumentManagementRoutingParams('帮我先保存再关闭 A.psd', 'close')) === JSON.stringify({ action: 'close', documentName: 'A.psd', save: true })
        && JSON.stringify(extractDocumentManagementRoutingParams('帮我切回 A.psd', 'switch')) === JSON.stringify({ action: 'switch', documentName: 'A.psd' })
        && JSON.stringify(extractDocumentManagementRoutingParams('帮我把详情页文档保存到项目的PSD中', 'save')) === JSON.stringify({ action: 'save', format: 'psd', saveAs: true, projectSubdir: 'PSD' })
        && JSON.stringify(extractDocumentManagementRoutingParams('帮我把详情页文档导出成PNG', 'save')) === JSON.stringify({ action: 'save', format: 'png', saveAs: true })
        && JSON.stringify(extractDocumentManagementRoutingParams('帮我新建一个 790x12000 名字叫详情页 的文档', 'create')) === JSON.stringify({ action: 'create', width: 790, height: 12000, name: '详情页', preset: 'detail-page' })
        && JSON.stringify(extractDocumentManagementRoutingParams('帮我新建一个 800x800 的文档，名称 DesignEchoLiveAgentAcceptance', 'create')) === JSON.stringify({ action: 'create', width: 800, height: 800, name: 'DesignEchoLiveAgentAcceptance' })
          ? 'pass'
          : 'fail',
      details: JSON.stringify({
        closeDefault: extractDocumentManagementRoutingParams('帮我关闭文档', 'close'),
        closeWithoutSaving: extractDocumentManagementRoutingParams('帮我关闭 A.psd 不保存', 'close'),
        closeWithSaving: extractDocumentManagementRoutingParams('帮我先保存再关闭 A.psd', 'close'),
        switchNamedDoc: extractDocumentManagementRoutingParams('帮我切回 A.psd', 'switch'),
        saveProjectPsd: extractDocumentManagementRoutingParams('帮我把详情页文档保存到项目的PSD中', 'save'),
        exportDocumentPng: extractDocumentManagementRoutingParams('帮我把详情页文档导出成PNG', 'save'),
        createSizedDoc: extractDocumentManagementRoutingParams('帮我新建一个 790x12000 名字叫详情页 的文档', 'create'),
        createSizedNamedDoc: extractDocumentManagementRoutingParams('帮我新建一个 800x800 的文档，名称 DesignEchoLiveAgentAcceptance', 'create')
      })
    });

    cases.push({
      name: 'routing-thinking-messages-stay-on-shared-skill-metadata',
      status:
        routing.buildDeterministicIntentMessage('document-management', '帮我关闭文档不保存') === '确认当前打开的文档后执行文档操作。'
        && routing.buildDeterministicIntentMessage('sku-batch', '帮我做2-3-4的自选备注') === '确认当前项目、SKU 文档和自选备注模板后生成备注。'
        && routing.buildAutonomousIntentMessage('帮我抠图', 'matte-product').includes('抠图属于 UXP 面板用户工具')
          ? 'pass'
          : 'fail',
      details: JSON.stringify({
        documentDeterministic: routing.buildDeterministicIntentMessage('document-management', '帮我关闭文档不保存'),
        skuNoteOnlyDeterministic: routing.buildDeterministicIntentMessage('sku-batch', '帮我做2-3-4的自选备注'),
        matteAutonomous: routing.buildAutonomousIntentMessage('帮我抠图', 'matte-product')
      })
    });

    const autonomousAgentSource = fs.readFileSync(
      path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'skill-executors', 'autonomous-agent.executor.ts'),
      'utf8'
    );
    const baseSystemPromptStart = autonomousAgentSource.indexOf('function buildBaseSystemPrompt');
    const capabilityPolicyPromptStart = autonomousAgentSource.indexOf('function buildBaseCapabilityPolicyPrompt');
    const baseSystemPromptSource = autonomousAgentSource.slice(
      baseSystemPromptStart,
      capabilityPolicyPromptStart
    );
    cases.push({
      name: 'autonomous-agent-tool-semantics-live-in-capability-policy-not-global-system',
      status:
        baseSystemPromptStart >= 0
        && capabilityPolicyPromptStart > baseSystemPromptStart
        && autonomousAgentSource.includes('buildPhotoshopToolSemanticsSummary')
        && autonomousAgentSource.includes('Photoshop Tool semantics for the currently exposed capability surface:')
        && autonomousAgentSource.includes("id: 'policy.execution-discipline'")
        && autonomousAgentSource.includes('content: baseCapabilityPolicyPrompt')
        && autonomousAgentSource.includes('cannot by itself prove screenshot-level typography quality')
        && !baseSystemPromptSource.includes('resolveFontName')
        && !baseSystemPromptSource.includes('buildPhotoshopToolSemanticsSummary')
          ? 'pass'
          : 'fail',
      details: JSON.stringify({
        hasSemanticsSummary: autonomousAgentSource.includes('buildPhotoshopToolSemanticsSummary'),
        hasCapabilityPolicyPrompt: capabilityPolicyPromptStart > baseSystemPromptStart,
        hasCapabilityPolicySlot: autonomousAgentSource.includes("id: 'policy.execution-discipline'"),
        hasBoundary: autonomousAgentSource.includes('cannot by itself prove screenshot-level typography quality'),
        globalMentionsResolveFontName: baseSystemPromptSource.includes('resolveFontName'),
        globalBuildsToolSemantics: baseSystemPromptSource.includes('buildPhotoshopToolSemanticsSummary')
      })
    });

    cases.push({
      name: 'casual-greeting-particles-stay-conversational',
      status:
        routing.detectLightweightIntent('你好啊') === 'greeting'
        && routing.debugInferDecisionFromText('你好啊')?.type === 'direct_response'
        && routing.debugInferDecisionFromText('你好啊')?.reasoning === 'lightweight:greeting'
          ? 'pass'
          : 'fail',
      details: JSON.stringify({
        intent: routing.detectLightweightIntent('你好啊'),
        decision: routing.debugInferDecisionFromText('你好啊')
      })
    });

    const actionableLayerQuestion = '你能把当前选中的图层置顶吗？';
    const hiddenLayerQuestion = '隐藏的图层你看不到吗？';
    const layerCountQuestion = '当前文档一共有几个图层？';
    const skuKnowledgeQuestion = 'SKU是什么？';
    const skuCapabilityQuestionVariants = [
      '我问你会做SKU吗',
      '你会做 SKU 吗',
      '你可以帮我做SKU吗？',
      '你会不会做SKU'
    ];
    const actionableLayerQuestionIntent = routing.detectLightweightIntent(actionableLayerQuestion);
    const hiddenLayerQuestionIntent = routing.detectLightweightIntent(hiddenLayerQuestion);
    const layerCountQuestionIntent = routing.detectLightweightIntent(layerCountQuestion);
    const skuQuestionIntent = routing.detectLightweightIntent(skuKnowledgeQuestion);
    const skuCapabilityQuestionResults = skuCapabilityQuestionVariants.map((input) => ({
      input,
      intent: routing.detectLightweightIntent(input),
      route: routing.fastDeterministicRoute(input),
      decision: routing.debugInferDecisionFromText(input)
    }));
    const actionableLayerQuestionRoute = routing.fastDeterministicRoute(actionableLayerQuestion);
    const hiddenLayerQuestionRoute = routing.fastDeterministicRoute(hiddenLayerQuestion);
    const layerCountQuestionRoute = routing.fastDeterministicRoute(layerCountQuestion);
    cases.push({
      name: 'actionable-photoshop-questions-override-lightweight-chat',
      status:
        actionableLayerQuestionIntent === 'none'
        && actionableLayerQuestionRoute?.skillId === 'layer-management'
        && actionableLayerQuestionRoute?.skillParams?.action === 'reorder'
        && actionableLayerQuestionRoute?.skillParams?.reorderAction === 'top'
        && hiddenLayerQuestionIntent === 'none'
        && hiddenLayerQuestionRoute?.skillId === 'layer-management'
        && hiddenLayerQuestionRoute?.skillParams?.action === 'inspect'
        && layerCountQuestionIntent === 'none'
        && layerCountQuestionRoute?.skillId === 'layer-management'
        && layerCountQuestionRoute?.skillParams?.action === 'inspect'
        && skuQuestionIntent === 'chat'
        && skuCapabilityQuestionResults.every((item) => (
          item.intent === 'capability'
          && item.route === null
          && item.decision?.type === 'direct_response'
        ))
          ? 'pass'
          : 'fail',
      details: JSON.stringify({
        actionableLayerQuestionIntent,
        actionableLayerQuestionRoute,
        hiddenLayerQuestionIntent,
        hiddenLayerQuestionRoute,
        layerCountQuestionIntent,
        layerCountQuestionRoute,
        skuQuestionIntent,
        skuCapabilityQuestionResults
      })
    });

    const controlPlaneMatrix = [
      {
        input: '看看我们是否可以开始做主图详情页了',
        expected: {
          requestKind: 'plan_only',
          toolScope: 'none',
          conversational: true,
          deterministic: false,
          router: false,
          autonomous: false,
          clarification: false
        }
      },
      {
        input: '主图详情页还剩哪些问题',
        expected: {
          requestKind: 'plan_only',
          toolScope: 'none',
          conversational: true,
          deterministic: false,
          router: false,
          autonomous: false,
          clarification: false
        }
      },
      {
        input: '请基于当前项目中的 SKU 色卡素材，创建一个详情页文档。按照文档名称区分：详情页文档就是详情页，SKU 就是 SKU。本轮先给出设计计划，不要写入 Photoshop。',
        expected: {
          requestKind: 'plan_only',
          toolScope: 'none',
          executionAuthorization: 'none',
          conversational: true,
          deterministic: false,
          router: false,
          autonomous: false,
          clarification: false
        }
      },
      {
        input: '我还有问题',
        expected: {
          requestKind: 'chat_only',
          toolScope: 'none',
          conversational: true,
          deterministic: false,
          router: false,
          autonomous: false,
          clarification: false
        }
      },
      {
        input: '我问你会做SKU吗',
        expected: {
          requestKind: 'chat_only',
          toolScope: 'none',
          conversational: true,
          deterministic: false,
          router: false,
          autonomous: false,
          clarification: false
        }
      },
      {
        input: '你会做 SKU 吗',
        expected: {
          requestKind: 'chat_only',
          toolScope: 'none',
          conversational: true,
          deterministic: false,
          router: false,
          autonomous: false,
          clarification: false
        }
      },
      {
        input: '你会不会做SKU',
        expected: {
          requestKind: 'chat_only',
          toolScope: 'none',
          conversational: true,
          deterministic: false,
          router: false,
          autonomous: false,
          clarification: false
        }
      },
      {
        input: 'SKU 怎么做比较好',
        expected: {
          requestKind: 'plan_only',
          toolScope: 'none',
          executionAuthorization: 'none',
          conversational: true,
          deterministic: false,
          router: false,
          autonomous: false,
          clarification: false
        }
      },
      {
        input: '我只是想问 SKU 自选备注怎么设计更好',
        expected: {
          requestKind: 'plan_only',
          toolScope: 'none',
          executionAuthorization: 'none',
          conversational: true,
          deterministic: false,
          router: false,
          autonomous: false,
          clarification: false
        }
      },
      {
        input: '这个主图怎么做比较好',
        expected: {
          requestKind: 'plan_only',
          toolScope: 'none',
          executionAuthorization: 'none',
          conversational: true,
          deterministic: false,
          router: false,
          autonomous: false,
          clarification: false
        }
      },
      {
        input: '这个设计要不要先找参考',
        expected: {
          requestKind: 'plan_only',
          toolScope: 'none',
          executionAuthorization: 'none',
          conversational: true,
          deterministic: false,
          router: false,
          autonomous: false,
          clarification: false
        }
      },
      {
        input: '我想你帮我继续完成转化图的第五张图，主要突出产品的穿搭表现。你需要先理解产品、找一些参考，再推理哪个参考更适合以及怎么设计。',
        expected: {
          requestKind: 'autonomous_execution',
          toolScope: 'write_photoshop',
          executionAuthorization: 'confirmed_tool_required',
          conversational: false,
          deterministic: true,
          router: true,
          autonomous: true,
          clarification: false
        }
      },
      {
        input: '帮我找一些设计参考',
        expected: {
          requestKind: 'execute_skill',
          toolScope: 'knowledge_search',
          executionAuthorization: 'confirmed_tool_required',
          conversational: false,
          deterministic: true,
          router: true,
          autonomous: false,
          clarification: false
        }
      },
      {
        input: '我想了解一下 SKU 自选备注是什么',
        expected: {
          requestKind: 'chat_only',
          toolScope: 'none',
          conversational: true,
          deterministic: false,
          router: false,
          autonomous: false,
          clarification: false
        }
      },
      {
        input: '我想了解 SKU 自选备注',
        expected: {
          requestKind: 'chat_only',
          toolScope: 'none',
          executionAuthorization: 'none',
          conversational: true,
          deterministic: false,
          router: false,
          autonomous: false,
          clarification: false
        }
      },
      {
        input: 'SKU 自选备注呢',
        expected: {
          requestKind: 'chat_only',
          toolScope: 'none',
          executionAuthorization: 'none',
          conversational: true,
          deterministic: false,
          router: false,
          autonomous: false,
          clarification: false
        }
      },
      {
        input: '看一下 SKU 配置',
        expected: {
          requestKind: 'read_only_inspect',
          toolScope: 'read_only',
          executionAuthorization: 'confirmed_tool_required',
          conversational: false,
          deterministic: true,
          router: true,
          autonomous: false,
          clarification: false
        }
      },
      {
        input: '帮我看看 SKU 有哪些颜色',
        expected: {
          requestKind: 'read_only_inspect',
          toolScope: 'read_only',
          executionAuthorization: 'confirmed_tool_required',
          conversational: false,
          deterministic: true,
          router: true,
          autonomous: false,
          clarification: false
        }
      },
      {
        input: '只说明理解，不执行工具：帮我做 SKU',
        expected: {
          requestKind: 'chat_only',
          toolScope: 'none',
          conversational: true,
          deterministic: false,
          router: false,
          autonomous: false,
          clarification: false
        }
      },
      {
        input: 'SKU',
        expected: {
          requestKind: 'clarify',
          toolScope: 'none',
          conversational: false,
          deterministic: false,
          router: false,
          autonomous: false,
          clarification: true
        }
      },
      {
        input: '你都能帮我做什么',
        expected: {
          requestKind: 'chat_only',
          toolScope: 'none',
          conversational: true,
          deterministic: false,
          router: false,
          autonomous: false,
          clarification: false
        }
      },
      {
        input: '帮我撰写文案 下面是原文\n选用更优质长绒棉，柔韧\n舒适，摩擦频繁也不起球\n帮我改成突出透气的',
        expected: {
          requestKind: 'chat_only',
          toolScope: 'none',
          executionAuthorization: 'none',
          conversational: true,
          deterministic: false,
          router: false,
          autonomous: false,
          clarification: false
        }
      },
      {
        input: '帮我润色这段文案：选用优质长绒棉',
        expected: {
          requestKind: 'chat_only',
          toolScope: 'none',
          executionAuthorization: 'none',
          conversational: true,
          deterministic: false,
          router: false,
          autonomous: false,
          clarification: false
        }
      },
      {
        input: '帮我写一版详情页文案，突出长绒棉的透气感',
        expected: {
          requestKind: 'chat_only',
          toolScope: 'none',
          executionAuthorization: 'none',
          conversational: true,
          deterministic: false,
          router: false,
          autonomous: false,
          clarification: false
        }
      },
      {
        input: '把当前画面的文案改成突出透气',
        expected: {
          requestKind: 'autonomous_execution',
          toolScope: 'write_photoshop',
          executionAuthorization: 'confirmed_tool_required',
          conversational: false,
          deterministic: true,
          router: true,
          autonomous: true,
          clarification: false
        }
      },
      {
        input: '把第三屏文案改成突出透气',
        expected: {
          requestKind: 'autonomous_execution',
          toolScope: 'write_photoshop',
          executionAuthorization: 'confirmed_tool_required',
          conversational: false,
          deterministic: true,
          router: true,
          autonomous: true,
          clarification: false
        }
      },
      {
        input: '把详情页顶部标题改成突出透气',
        expected: {
          requestKind: 'autonomous_execution',
          toolScope: 'write_photoshop',
          executionAuthorization: 'confirmed_tool_required',
          conversational: false,
          deterministic: true,
          router: true,
          autonomous: true,
          clarification: false
        }
      },
      {
        input: '把第一版应用到当前文字图层',
        expected: {
          requestKind: 'autonomous_execution',
          toolScope: 'write_photoshop',
          executionAuthorization: 'confirmed_tool_required',
          conversational: false,
          deterministic: true,
          router: true,
          autonomous: true,
          clarification: false
        }
      },
      {
        input: '用A',
        expected: {
          requestKind: 'chat_only',
          toolScope: 'none',
          executionAuthorization: 'none',
          conversational: true,
          deterministic: false,
          router: false,
          autonomous: false,
          clarification: false
        }
      },
      {
        input: '帮我处理一下',
        expected: {
          requestKind: 'autonomous_execution',
          toolScope: 'write_photoshop',
          conversational: false,
          deterministic: true,
          router: true,
          autonomous: true,
          clarification: false
        }
      },
      {
        input: '帮我抠图',
        expected: {
          requestKind: 'uxp_user_tool_only',
          toolScope: 'none',
          conversational: false,
          deterministic: false,
          router: false,
          autonomous: false,
          clarification: false
        }
      },
      {
        input: '当前文档一共有几个图层？',
        expected: {
          requestKind: 'read_only_inspect',
          toolScope: 'read_only',
          conversational: false,
          deterministic: true,
          router: true,
          autonomous: false,
          clarification: false
        }
      },
      {
        input: '帮我检查一下当前详情页结构',
        expected: {
          requestKind: 'read_only_inspect',
          toolScope: 'read_only',
          conversational: false,
          deterministic: true,
          router: true,
          autonomous: false,
          clarification: false
        }
      },
      {
        input: '当前是什么项目',
        expected: {
          requestKind: 'read_only_inspect',
          toolScope: 'read_only',
          conversational: false,
          deterministic: true,
          router: true,
          autonomous: false,
          clarification: false
        }
      },
      {
        input: '帮我看看当前是个什么项目',
        expected: {
          requestKind: 'read_only_inspect',
          toolScope: 'read_only',
          conversational: false,
          deterministic: true,
          router: true,
          autonomous: false,
          clarification: false
        }
      },
      {
        input: '帮我看看模板有几个',
        expected: {
          requestKind: 'read_only_inspect',
          toolScope: 'read_only',
          executionAuthorization: 'confirmed_tool_required',
          conversational: false,
          deterministic: true,
          router: true,
          autonomous: false,
          clarification: false
        }
      },
      {
        input: '帮我看看当前项目图片是什么款式',
        expected: {
          requestKind: 'read_only_inspect',
          toolScope: 'read_only',
          conversational: false,
          deterministic: true,
          router: true,
          autonomous: false,
          clarification: false
        }
      },
      {
        input: '你能看看这些图片是什么 你能描述一下吗 并总结一下内容',
        expected: {
          requestKind: 'read_only_inspect',
          toolScope: 'read_only',
          conversational: false,
          deterministic: true,
          router: true,
          autonomous: false,
          clarification: false
        }
      },
      {
        input: '帮我做SKU以及对应的自选备注',
        expected: {
          requestKind: 'autonomous_execution',
          toolScope: 'write_photoshop',
          conversational: false,
          deterministic: true,
          router: true,
          autonomous: true,
          clarification: false
        }
      },
      {
        // 新设计：创意主图「帮我做主图」走自主真实设计循环（基于设计方向+素材创作），
        // 不再硬路由到规格化生产脚本（main-image-design）。白底图已交给 Agent 自主循环
        // （autonomous_execution，见 control-plane 自决信号集）。
        // 治理审计(2026-07-01)阶段3a：main-image-design 补齐 controlledRouteEntry 后，
        // 点击图/转化图这类规格化措辞在有明确执行授权时也统一走 autonomous_execution
        // （与详情页/白底图口径一致），main-image-design 降为自主循环内可选技能工具。
        input: '帮我做主图',
        expected: {
          requestKind: 'autonomous_execution',
          toolScope: 'write_photoshop',
          conversational: false,
          deterministic: true,
          router: true,
          autonomous: true,
          clarification: false
        }
      },
      {
        input: '帮我做转化图 在Adobe Photoshop文档中有800文档',
        expected: {
          requestKind: 'autonomous_execution',
          toolScope: 'write_photoshop',
          conversational: false,
          deterministic: true,
          router: true,
          autonomous: true,
          clarification: false
        }
      },
      {
        input: '帮我打开CSV模板替换图标素材',
        expected: {
          requestKind: 'autonomous_execution',
          toolScope: 'write_photoshop',
          conversational: false,
          deterministic: true,
          router: true,
          autonomous: true,
          clarification: false
        }
      },
      {
        input: '怎么用 CSV 模板替换图标素材',
        expected: {
          requestKind: 'plan_only',
          toolScope: 'none',
          executionAuthorization: 'none',
          conversational: true,
          deterministic: false,
          router: false,
          autonomous: false,
          clarification: false
        }
      },
      {
        input: '把这个画面整理得更高级一些并保留当前视觉重点',
        expected: {
          requestKind: 'autonomous_execution',
          toolScope: 'write_photoshop',
          conversational: false,
          deterministic: true,
          router: true,
          autonomous: true,
          clarification: false
        }
      },
      {
        input: '这里不太好看帮我改一下',
        expected: {
          requestKind: 'autonomous_execution',
          toolScope: 'write_photoshop',
          conversational: false,
          deterministic: true,
          router: true,
          autonomous: true,
          clarification: false
        }
      },
      {
        input: '帮我根据当前画面做一版更高级的主图',
        expected: {
          requestKind: 'autonomous_execution',
          toolScope: 'write_photoshop',
          conversational: false,
          deterministic: true,
          router: true,
          autonomous: true,
          clarification: false
        }
      },
      {
        input: '把当前详情页优化得更高级一点',
        expected: {
          requestKind: 'autonomous_execution',
          toolScope: 'write_photoshop',
          conversational: false,
          deterministic: true,
          router: true,
          autonomous: true,
          clarification: false
        }
      }
    ];
    const controlPlaneResults = controlPlaneMatrix.map((item) => {
      const decision = intentControlPlane?.buildAgentIntentControlPlaneDecision
        ? intentControlPlane.buildAgentIntentControlPlaneDecision({ userInput: item.input })
        : null;
      return {
        input: item.input,
        expected: item.expected,
        actual: decision,
        ok:
          decision?.version === 'agent-intent-control-plane/v0'
          && decision?.requestKind === item.expected.requestKind
          && decision?.toolScope === item.expected.toolScope
          && (!item.expected.executionAuthorization || decision?.executionAuthorization === item.expected.executionAuthorization)
          && decision?.shouldUseConversationalPath === item.expected.conversational
          && decision?.allowsDeterministicRoute === item.expected.deterministic
          && decision?.allowsRouterModel === item.expected.router
          && decision?.allowsAutonomousExecution === item.expected.autonomous
          && decision?.requiresClarificationBeforeTools === item.expected.clarification
          && !Object.prototype.hasOwnProperty.call(decision || {}, 'confidence')
      };
    });
    cases.push({
      name: 'intent-control-plane-classifies-tool-authorization-contract',
      status:
        intentControlPlaneLoadError === null
        && typeof intentControlPlane?.buildAgentIntentControlPlaneDecision === 'function'
        && controlPlaneResults.every((item) => item.ok)
          ? 'pass'
          : 'fail',
      details: JSON.stringify({
        loadError: intentControlPlaneLoadError ? String(intentControlPlaneLoadError.message || intentControlPlaneLoadError) : null,
        controlPlaneResults
      })
    });

    const copyOriginal = '选用更优质长绒棉，柔韧 舒适，摩擦频繁也不起球';
    const copyDeliveryInput = [
      '帮我撰写文案 下面是原文',
      '选用更优质长绒棉，柔韧',
      '舒适，摩擦频繁也不起球',
      '帮我改成突出透气的'
    ].join('\n');
    let copyDeliveryModelCalls = 0;
    let copyDeliveryPrompt = '';
    executed = [];
    const copyDeliveryResult = await engine.run(createContext(copyDeliveryInput, {
      operatingContextSnapshot: createMatchingCopyOperatingContextSnapshot(copyOriginal)
    }), {
      callModel: async (messages) => {
        copyDeliveryModelCalls += 1;
        copyDeliveryPrompt = JSON.stringify(messages);
        return {
          text: [
            '我先给你三版突出透气感的文案：',
            '1. 精选优质长绒棉，轻盈透气，柔韧亲肤，久穿依然清爽舒适。',
            '2. 优质长绒棉带来会呼吸的轻柔触感，排湿不闷，贴肤更自在。',
            '3. 细密长绒棉兼顾柔韧与透气，减少闷热黏腻，日常穿着更清爽。',
            '我还发现当前详情页的活动图层就是这句原文。需要我帮你修改吗？如需写入，可以回复“把第2版替换到当前文字图层”。'
          ].join('\n')
        };
      }
    });
    const copyDeliveryMessage = String(copyDeliveryResult?.message || '');
    const copyDeliveryPlan = copyDeliveryResult?.data?.agentTaskPlan;
    cases.push({
      name: 'standalone-copy-delivery-completes-before-offering-contextual-photoshop-application',
      status:
        copyDeliveryModelCalls === 1
        && executed.length === 0
        && copyDeliveryResult?.success === true
        && copyDeliveryResult?.data?.agentIntentControlPlane?.requestKind === 'chat_only'
        && copyDeliveryPlan?.status === 'ready_direct_response'
        && sameJson(copyDeliveryPlan?.designBrief?.deliverables, ['copy_candidates'])
        && copyDeliveryPlan?.executionPlan?.mode === 'none'
        && copyDeliveryMessage.includes('1. 精选优质长绒棉')
        && copyDeliveryMessage.includes('3. 细密长绒棉')
        && copyDeliveryMessage.includes('需要我帮你修改吗')
        && copyDeliveryMessage.includes('把第2版替换到当前文字图层')
        && !copyDeliveryMessage.includes('这次还没有完成')
        && copyDeliveryPrompt.includes('当前请求的首要交付物是可直接使用的文案')
        && copyDeliveryPrompt.includes('当前活动图层名称与用户给出的原文一致')
        && copyDeliveryPrompt.includes('详情页.psb')
        && copyDeliveryPrompt.includes(copyOriginal)
          ? 'pass'
          : 'fail',
      details: JSON.stringify({
        copyDeliveryModelCalls,
        executed,
        success: copyDeliveryResult?.success,
        message: copyDeliveryMessage,
        intent: copyDeliveryResult?.data?.agentIntentControlPlane,
        plan: copyDeliveryPlan,
        promptHasDeliveryRule: copyDeliveryPrompt.includes('当前请求的首要交付物是可直接使用的文案'),
        promptHasContextMatch: copyDeliveryPrompt.includes('当前活动图层名称与用户给出的原文一致'),
        promptHasRuntimeDocument: copyDeliveryPrompt.includes('详情页.psb'),
        promptHasRuntimeCopy: copyDeliveryPrompt.includes(copyOriginal)
      })
    });

    const detailPlanNoWriteInput = '请基于当前项目中的 SKU 色卡素材，创建一个详情页文档。按照文档名称区分：详情页文档就是详情页，SKU 就是 SKU。本轮先给出设计计划，不要写入 Photoshop。';
    const detailPlanNoWriteRoute = routing.fastDeterministicRoute(detailPlanNoWriteInput);
    cases.push({
      name: 'deterministic-route-respects-plan-only-no-write-control-plane',
      status:
        detailPlanNoWriteRoute === null
          ? 'pass'
          : 'fail',
      details: JSON.stringify({
        input: detailPlanNoWriteInput,
        deterministicRoute: detailPlanNoWriteRoute
      })
    });

    const detailDocumentFromSkuSourceInput = '请基于当前项目中的 SKU 色卡素材，创建一个详情页文档。按照文档名称区分：详情页文档就是详情页，SKU 就是 SKU。';
    const detailDocumentFromSkuSourceRoute = routing.fastDeterministicRoute(detailDocumentFromSkuSourceInput);
    cases.push({
      name: 'document-name-target-overrides-sku-source-wording',
      status:
        detailDocumentFromSkuSourceRoute?.skillId === 'document-management'
        && detailDocumentFromSkuSourceRoute?.skillParams?.action === 'create'
        && detailDocumentFromSkuSourceRoute?.skillParams?.preset === 'detail-page'
        && detailDocumentFromSkuSourceRoute?.skillParams?.name === '详情页'
          ? 'pass'
          : 'fail',
      details: JSON.stringify({
        input: detailDocumentFromSkuSourceInput,
        deterministicRoute: detailDocumentFromSkuSourceRoute
      })
    });

    const skuTemplateFromExistingCardsInput = '项目中已经有 SKU 色卡素材，请基于已有 SKU 色卡素材创建卡片式 SKU 排版模板，规格是 2-3-4 双装以及对应自选备注。';
    const skuTemplateFromExistingCardsRoute = routing.fastDeterministicRoute(skuTemplateFromExistingCardsInput);
    const skuTemplateFromExistingCardsDecision = intentControlPlane?.buildAgentIntentControlPlaneDecision
      ? intentControlPlane.buildAgentIntentControlPlaneDecision({ userInput: skuTemplateFromExistingCardsInput })
      : null;
    cases.push({
      name: 'sku-template-target-stays-autonomous-instead-of-batch-template-script',
      status:
        skuTemplateFromExistingCardsRoute === null
        && skuTemplateFromExistingCardsDecision?.requestKind === 'autonomous_execution'
        && skuTemplateFromExistingCardsDecision?.matchedSignals?.includes('sku_template_design_autonomy') === true
          ? 'pass'
          : 'fail',
      details: JSON.stringify({
        input: skuTemplateFromExistingCardsInput,
        deterministicRoute: skuTemplateFromExistingCardsRoute,
        controlPlaneDecision: skuTemplateFromExistingCardsDecision
      })
    });

    const skuPlaceholderAdjustmentInputs = [
      '我想你帮我调整SKU色卡的占位符可以吗',
      '帮我调整SKU色卡的占位符',
      '调整SKU色卡的占位符',
      '我想让你帮我调整当前SKU色卡的占位符可以吗'
    ];
    const skuPlaceholderAdjustmentResults = skuPlaceholderAdjustmentInputs.map((input) => {
      const decision = intentControlPlane?.buildAgentIntentControlPlaneDecision
        ? intentControlPlane.buildAgentIntentControlPlaneDecision({ userInput: input })
        : null;
      const lightweightIntent = routing.detectLightweightIntent(input);
      const deterministicRoute = routing.fastDeterministicRoute(input);
      const debugDecision = routing.debugInferDecisionFromText(input);
      return {
        input,
        decision,
        lightweightIntent,
        deterministicRoute,
        debugDecision,
        ok:
          decision?.requestKind === 'autonomous_execution'
          && decision?.matchedSignals?.includes('sku_placeholder_adjustment') === true
          && decision?.executionAuthorization === 'confirmed_tool_required'
          && lightweightIntent === 'none'
          && deterministicRoute === null
          && debugDecision?.type === 'skill_execution'
          && debugDecision?.skillId === 'autonomous-agent'
      };
    });
    cases.push({
      name: 'sku-placeholder-adjustment-stays-autonomous-instead-of-capability-chat-or-batch-script',
      status:
        intentControlPlaneLoadError === null
        && skuPlaceholderAdjustmentResults.every((item) => item.ok)
          ? 'pass'
          : 'fail',
      details: JSON.stringify({
        loadError: intentControlPlaneLoadError ? String(intentControlPlaneLoadError.message || intentControlPlaneLoadError) : null,
        skuPlaceholderAdjustmentResults
      })
    });

    const plainSkuDocumentCreateRoute = routing.fastDeterministicRoute('创建一个 SKU 文档');
    cases.push({
      name: 'plain-sku-document-create-stays-document-management',
      status:
        plainSkuDocumentCreateRoute?.skillId === 'document-management'
        && plainSkuDocumentCreateRoute?.skillParams?.action === 'create'
        && plainSkuDocumentCreateRoute?.skillParams?.name === 'SKU'
          ? 'pass'
          : 'fail',
      details: JSON.stringify({
        deterministicRoute: plainSkuDocumentCreateRoute
      })
    });

    const intentControlPlaneSource = fs.readFileSync(
      path.resolve(__dirname, '..', 'src', 'shared', 'agent-intent-control-plane.ts'),
      'utf8'
    );
    const fixedClarificationMarkers = [
      'buildAgentIntentControlPlaneClarificationMessage',
      '还需要先确认一个会影响设计方向的关键点',
      '还缺少一个会影响结果的关键信息'
    ].filter((phrase) => intentControlPlaneSource.includes(phrase));
    cases.push({
      name: 'intent-control-plane-does-not-build-local-natural-language-clarification',
      status:
        fixedClarificationMarkers.length === 0
          ? 'pass'
          : 'fail',
      details: JSON.stringify({
        fixedClarificationMarkers
      })
    });

    let callModelCount = 0;
    executed = [];
    let skuCapabilityConversationalPromptSeen = false;
    let skuCapabilityRouterPromptSeen = false;
    const skuCapabilityRepairedResult = await engine.run(createContext('我问你会做SKU吗'), {
      callModel: async (messages, options = {}) => {
        callModelCount += 1;
        const systemPrompt = String(messages?.[0]?.content || '');
        skuCapabilityConversationalPromptSeen = skuCapabilityConversationalPromptSeen || systemPrompt.includes('当前用户在进行对话咨询');
        skuCapabilityRouterPromptSeen = skuCapabilityRouterPromptSeen || systemPrompt.includes('intent router');
        if (options.purpose === 'direct_response_repair') {
          return { text: NATURAL_SKU_CAPABILITY_REPLY };
        }
        return { text: '{}' };
      }
    });

    cases.push({
      name: 'engine-sku-capability-question-repairs-empty-model-reply-without-tools-or-fixed-template',
      status:
        callModelCount === 2
        && executed.length === 0
        && skuCapabilityConversationalPromptSeen
        && !skuCapabilityRouterPromptSeen
        && skuCapabilityRepairedResult?.success === true
        && !skuCapabilityRepairedResult?.error
        && String(skuCapabilityRepairedResult?.message || '').includes('SKU')
        && String(skuCapabilityRepairedResult?.message || '').includes('自选备注')
        && !String(skuCapabilityRepairedResult?.message || '').includes('主图')
        && !String(skuCapabilityRepairedResult?.message || '').includes('详情页')
        && !String(skuCapabilityRepairedResult?.message || '').includes('我可以协助这些设计工作')
        && !String(skuCapabilityRepairedResult?.message || '').includes('你可以直接提出主图、SKU、详情页')
        && !String(skuCapabilityRepairedResult?.message || '').includes('Conversational reply unavailable')
        && !String(skuCapabilityRepairedResult?.message || '').includes('这是对话问题')
        && skuCapabilityRepairedResult?.data?.agentIntentControlPlane?.requestKind === 'chat_only'
        && skuCapabilityRepairedResult?.data?.agentIntentControlPlane?.toolScope === 'none'
        && skuCapabilityRepairedResult?.data?.agentRequestLifecycle?.decision?.route === 'direct_response'
        && skuCapabilityRepairedResult?.data?.agentRequestLifecycle?.execution?.kind === 'none'
          ? 'pass'
          : 'fail',
      details: JSON.stringify({
        callModelCount,
        executed,
        skuCapabilityConversationalPromptSeen,
        skuCapabilityRouterPromptSeen,
        result: skuCapabilityRepairedResult
      })
    });

    callModelCount = 0;
    executed = [];
    const cannedCapabilityResult = await engine.run(createContext('你会做 SKU 吗'), {
      callModel: async (_messages, options = {}) => {
        callModelCount += 1;
        if (options.purpose === 'direct_response_repair') {
          return { text: NATURAL_SKU_CAPABILITY_REPLY };
        }
        return {
          text: '我可以协助这些设计工作：主图、点击图、转化图和白底图规划、SKU 组合图和自选备注、详情页设计。你可以直接提出主图、SKU、详情页、项目图片理解、文档保存或图层调整需求；我会先判断它属于对话、只读检查还是需要进入处理流程。'
        };
      }
    });

    cases.push({
      name: 'engine-sku-capability-question-rejects-canned-capability-template',
      status:
        callModelCount === 2
        && executed.length === 0
        && cannedCapabilityResult?.success === true
        && String(cannedCapabilityResult?.message || '').includes('SKU')
        && String(cannedCapabilityResult?.message || '').includes('自选备注')
        && !String(cannedCapabilityResult?.message || '').includes('主图')
        && !String(cannedCapabilityResult?.message || '').includes('详情页')
        && !String(cannedCapabilityResult?.message || '').includes('我可以协助这些设计工作')
        && !String(cannedCapabilityResult?.message || '').includes('你可以直接提出主图、SKU、详情页')
        && cannedCapabilityResult?.data?.agentIntentControlPlane?.requestKind === 'chat_only'
        && cannedCapabilityResult?.data?.agentRequestLifecycle?.execution?.kind === 'none'
          ? 'pass'
          : 'fail',
      details: JSON.stringify({ callModelCount, executed, cannedCapabilityResult })
    });

    callModelCount = 0;
    executed = [];
    const broadSkuCapabilitySystemPrompts = [];
    const broadSkuCapabilityResult = await engine.run(createContext('你现在支持哪些SKU能力'), {
      callModel: async (messages, options = {}) => {
        callModelCount += 1;
        broadSkuCapabilitySystemPrompts.push(String(messages?.[0]?.content || ''));
        if (options.purpose === 'direct_response_repair') {
          return { text: NATURAL_SKU_CAPABILITY_REPLY };
        }
        return {
          text: '我目前支持电商袜子类目的整套 SKU 设计，包括主图、点击图、转化图、白底图和卖点版式，也能处理 SKU 组合图、自选备注、规格组合以及素材导出和颜色占位图的准备工作。'
        };
      }
    });

    cases.push({
      name: 'engine-sku-capability-question-rejects-cross-domain-capability-answer',
      status:
        callModelCount === 2
        && executed.length === 0
        && broadSkuCapabilitySystemPrompts.length === 2
        && broadSkuCapabilitySystemPrompts.every((prompt) => prompt.includes('SKU 组合图、自选备注、规格组合、SKU 素材与导出'))
        && broadSkuCapabilitySystemPrompts.every((prompt) => prompt.includes('SKU 颜色配置和占位素材准备'))
        && broadSkuCapabilitySystemPrompts.every((prompt) => !prompt.includes('Prepare SKU workflow'))
        && broadSkuCapabilitySystemPrompts.every((prompt) => !prompt.includes('主图、点击图、转化图、白底图和卖点版式'))
        && broadSkuCapabilitySystemPrompts.every((prompt) => !prompt.includes('详情页模块、卖点图文、长图结构和模板延展'))
        && broadSkuCapabilityResult?.success === true
        && String(broadSkuCapabilityResult?.message || '') === NATURAL_SKU_CAPABILITY_REPLY
        && broadSkuCapabilityResult?.assistantReplyOrigin?.origin === 'model_repaired'
        && !String(broadSkuCapabilityResult?.message || '').includes('主图')
        && !String(broadSkuCapabilityResult?.message || '').includes('点击图')
        && !String(broadSkuCapabilityResult?.message || '').includes('转化图')
        && !String(broadSkuCapabilityResult?.message || '').includes('详情页')
        && broadSkuCapabilityResult?.data?.agentIntentControlPlane?.requestKind === 'chat_only'
        && broadSkuCapabilityResult?.data?.agentRequestLifecycle?.execution?.kind === 'none'
          ? 'pass'
          : 'fail',
      details: JSON.stringify({ callModelCount, executed, broadSkuCapabilitySystemPrompts, broadSkuCapabilityResult })
    });

    callModelCount = 0;
    executed = [];
    const invalidCapabilityRepairResult = await engine.run(createContext('你会做SKU吗'), {
      callModel: async (_messages, options = {}) => {
        callModelCount += 1;
        return {
          text: options.purpose === 'direct_response_repair'
            ? '实际制作时我会直接读取当前项目的素材配置和模板信息来高效完成。'
            : '我可以为你制作SKU组合图和规格组合，也能处理自选备注图生成与素材导出。'
        };
      }
    });

    cases.push({
      name: 'engine-sku-capability-question-does-not-fabricate-local-answer-after-invalid-repair',
      status:
        callModelCount === 2
        && executed.length === 0
        && invalidCapabilityRepairResult?.success === false
        && String(invalidCapabilityRepairResult?.message || '').includes(MODEL_UNAVAILABLE_COPY)
        && !String(invalidCapabilityRepairResult?.message || '').includes('现在没能生成有效回复')
        && !String(invalidCapabilityRepairResult?.message || '').includes('没有收到模型回复')
        && !String(invalidCapabilityRepairResult?.message || '').includes('Photoshop')
        && !String(invalidCapabilityRepairResult?.message || '').includes('认证失败')
        && !String(invalidCapabilityRepairResult?.message || '').includes('API Key')
        && !String(invalidCapabilityRepairResult?.message || '').includes('能力问题')
        && !String(invalidCapabilityRepairResult?.message || '').includes('组合图')
        && !String(invalidCapabilityRepairResult?.message || '').includes('自选备注')
        && !String(invalidCapabilityRepairResult?.message || '').includes('会做。SKU')
        && !String(invalidCapabilityRepairResult?.message || '').includes('我可以协助这些设计工作')
        && invalidCapabilityRepairResult?.error === 'Conversational reply unavailable'
        && invalidCapabilityRepairResult?.data?.conversationalModelFailure?.kind === 'rejected_by_cleaner'
        && invalidCapabilityRepairResult?.data?.agentIntentControlPlane?.requestKind === 'chat_only'
        && invalidCapabilityRepairResult?.data?.agentRequestLifecycle?.execution?.kind === 'none'
          ? 'pass'
          : 'fail',
      details: JSON.stringify({ callModelCount, executed, invalidCapabilityRepairResult })
    });

    callModelCount = 0;
    executed = [];
    const authFailureConversationalResult = await engine.run(createContext('你会做SKU吗'), {
      callModel: async () => {
        callModelCount += 1;
        throw new Error('xiaomi-mimo-v2.5: 401 Invalid API Key');
      }
    });

    cases.push({
      name: 'engine-conversational-provider-auth-failure-is-user-visible',
      status:
        callModelCount === 1
        && executed.length === 0
        && authFailureConversationalResult?.success === false
        && authFailureConversationalResult?.assistantReplyOrigin?.origin === 'ui_status'
        && authFailureConversationalResult?.assistantReplyOrigin?.userVisibleKind === 'status_notice'
        && !String(authFailureConversationalResult?.message || '').includes('可以做 SKU')
        && !String(authFailureConversationalResult?.message || '').includes('最低限度确认')
        && !String(authFailureConversationalResult?.message || '').includes('组合图')
        && !String(authFailureConversationalResult?.message || '').includes('自选备注')
        && String(authFailureConversationalResult?.message || '').includes('当前模型没有通过认证')
        && !String(authFailureConversationalResult?.message || '').includes('现在没能生成有效回复')
        && !String(authFailureConversationalResult?.message || '').includes('没有收到模型回复')
        && !String(authFailureConversationalResult?.message || '').includes('Photoshop')
        && !String(authFailureConversationalResult?.message || '').includes('能力问题')
        && String(authFailureConversationalResult?.message || '').includes('API Key')
        && !String(authFailureConversationalResult?.message || '').includes('切换一个可用模型')
        && !String(authFailureConversationalResult?.message || '').includes('认证失败')
        && !String(authFailureConversationalResult?.message || '').includes('重新填写')
        && !String(authFailureConversationalResult?.message || '').includes('切换可用的回复服务')
        && !String(authFailureConversationalResult?.message || '').includes('暂时无法生成自然回复')
        && !String(authFailureConversationalResult?.message || '').includes('当前对话模型连接不可用')
        && !String(authFailureConversationalResult?.message || '').includes('鉴权失败')
        && !String(authFailureConversationalResult?.message || '').includes('对话模型没有返回有效内容')
        && !String(authFailureConversationalResult?.message || '').includes('Invalid API Key')
        && !String(authFailureConversationalResult?.message || '').includes('我可以协助这些设计工作')
        && !String(authFailureConversationalResult?.message || '').includes('你可以直接提出主图、SKU、详情页')
        && authFailureConversationalResult?.data?.conversationalModelFailure?.kind === 'auth'
        && Array.isArray(authFailureConversationalResult?.data?.conversationalModelFailure?.attempts)
        && authFailureConversationalResult.data.conversationalModelFailure.attempts.some((attempt) => attempt?.purpose === 'direct_response' && attempt?.status === 'error')
        && !JSON.stringify(authFailureConversationalResult?.data?.conversationalModelFailure || {}).includes('Invalid API Key')
        && authFailureConversationalResult?.data?.agentRequestLifecycle?.decision?.route === 'direct_response'
        && authFailureConversationalResult?.data?.agentRequestLifecycle?.execution?.kind === 'none'
          ? 'pass'
          : 'fail',
      details: JSON.stringify({ callModelCount, executed, authFailureConversationalResult })
    });

    callModelCount = 0;
    executed = [];
    let dirtyCapabilityHistoryLeaked = false;
    const dirtyHistoryCapabilityResult = await engine.run(createContext('你会做SKU吗', {
      conversationHistory: [
        {
          role: 'user',
          content: '你会做SKU吗'
        },
        {
          role: 'assistant',
          content: '我可以协助这些设计工作：主图、点击图、转化图和白底图规划、SKU 组合图和自选备注、详情页设计。你可以直接提出主图、SKU、详情页、项目图片理解、文档保存或图层调整需求；我会先判断它属于对话、只读检查还是需要进入处理流程。'
        },
        {
          role: 'user',
          content: '你会做SKU吗'
        },
        {
          role: 'assistant',
          content: '⚠️ 对话模型没有返回有效内容，本次不会改动 Photoshop 文档。 对话模型没有返回有效内容，我会重新组织可读回复。'
        }
      ]
    }), {
      callModel: async (messages) => {
        callModelCount += 1;
        const visiblePromptText = messages.slice(1, -1).map((item) => String(item.content || '')).join('\n');
        dirtyCapabilityHistoryLeaked = dirtyCapabilityHistoryLeaked
          || visiblePromptText.includes('我可以协助这些设计工作')
          || visiblePromptText.includes('我会重新组织可读回复')
          || visiblePromptText.includes('对话模型没有返回有效内容');
        return {
          text: NATURAL_SKU_CAPABILITY_REPLY
        };
      }
    });

    cases.push({
      name: 'engine-sku-capability-question-filters-stale-canned-history-before-model',
      status:
        callModelCount === 1
        && executed.length === 0
        && dirtyCapabilityHistoryLeaked === false
        && dirtyHistoryCapabilityResult?.success === true
        && String(dirtyHistoryCapabilityResult?.message || '').includes('SKU')
        && String(dirtyHistoryCapabilityResult?.message || '').includes('自选备注')
        && !String(dirtyHistoryCapabilityResult?.message || '').includes('我可以协助这些设计工作')
        && !String(dirtyHistoryCapabilityResult?.message || '').includes('重新组织可读回复')
        && dirtyHistoryCapabilityResult?.data?.agentRequestLifecycle?.decision?.route === 'direct_response'
          ? 'pass'
          : 'fail',
      details: JSON.stringify({
        callModelCount,
        executed,
        dirtyCapabilityHistoryLeaked,
        dirtyHistoryCapabilityResult
      })
    });

    callModelCount = 0;
    executed = [];
    let leakedToolCallRepairPromptSeen = false;
    const leakedToolCallConversationalResult = await engine.run(createContext('你可以做什么？'), {
      callModel: async (messages, options = {}) => {
        callModelCount += 1;
        const systemPrompt = String(messages?.[0]?.content || '');
        leakedToolCallRepairPromptSeen = leakedToolCallRepairPromptSeen
          || systemPrompt.includes('上一轮对话回复为空')
          || systemPrompt.includes('误返回');
        if (options.purpose === 'direct_response_repair') {
          return { text: '我可以说明当前能力、理解项目图片和在明确授权后执行受控 Photoshop 技能；这次只是能力询问，不会调用工具。' };
        }
        return {
          text: [
            '好的，我先分析一下。',
            '<tool_call>',
            '<function=visual_analysis>',
            '<parameter=analysis_type>content_overview</parameter>',
            '</function>',
            '</tool_call>'
          ].join('\n')
        };
      }
    });

    cases.push({
      name: 'conversational-tool-call-text-is-repaired-instead-of-rendered',
      status:
        callModelCount === 2
        && executed.length === 0
        && leakedToolCallRepairPromptSeen
        && leakedToolCallConversationalResult?.success === true
        && !String(leakedToolCallConversationalResult?.message || '').includes('<tool_call>')
        && !String(leakedToolCallConversationalResult?.message || '').includes('<function=')
        && !String(leakedToolCallConversationalResult?.message || '').includes('Conversational reply unavailable')
        && leakedToolCallConversationalResult?.data?.agentRequestLifecycle?.decision?.route === 'direct_response'
          ? 'pass'
          : 'fail',
      details: JSON.stringify({
        callModelCount,
        executed,
        leakedToolCallRepairPromptSeen,
        result: leakedToolCallConversationalResult
      })
    });

    callModelCount = 0;
    executed = [];
    const genericCapabilitySolicitationEngineResult = await engine.run(createContext('你会做SKU吗'), {
      callModel: async (_messages, options = {}) => {
        callModelCount += 1;
        if (options.purpose === 'direct_response_repair') {
          return { text: NATURAL_SKU_CAPABILITY_REPLY };
        }
        return { text: '请补充具体目标、要处理的图层和想达到的效果。' };
      }
    });

    cases.push({
      name: 'engine-sku-capability-generic-input-solicitation-is-repaired-not-unavailable',
      status:
        callModelCount === 2
        && executed.length === 0
        && genericCapabilitySolicitationEngineResult?.success === true
        && String(genericCapabilitySolicitationEngineResult?.message || '') === NATURAL_SKU_CAPABILITY_REPLY
        && genericCapabilitySolicitationEngineResult?.assistantReplyOrigin?.origin === 'model_repaired'
        && !String(genericCapabilitySolicitationEngineResult?.message || '').includes('请补充具体目标')
        && !String(genericCapabilitySolicitationEngineResult?.message || '').includes('Conversational reply unavailable')
        && genericCapabilitySolicitationEngineResult?.data?.agentRequestLifecycle?.decision?.route === 'direct_response'
        && genericCapabilitySolicitationEngineResult?.data?.agentRequestLifecycle?.execution?.kind === 'none'
          ? 'pass'
          : 'fail',
      details: JSON.stringify({
        callModelCount,
        executed,
        result: genericCapabilitySolicitationEngineResult
      })
    });

    const localTemplateIntents = ['identity', 'model_compare', 'capability', 'greeting', 'thanks', 'ack'];
    const localTemplateResults = localTemplateIntents.map((intent) => ({
      intent,
      reply: conversational.buildLocalConversationalReply(intent, createContext('你好'))
    }));
    const noLocalFirstConversational = ['greeting', 'thanks', 'ack'].every((intent) => (
      routing.isLocalFirstConversationalIntent(intent) === false
    ));
    const noFixedPersonaReplies = localTemplateResults.every((item) => item.reply === null);

    cases.push({
      name: 'conversational-persona-and-capability-do-not-use-local-fixed-templates',
      status:
        noLocalFirstConversational
        && noFixedPersonaReplies
          ? 'pass'
          : 'fail',
      details: JSON.stringify({
        noLocalFirstConversational,
        localTemplateResults
      })
    });

    callModelCount = 0;
    executed = [];
    const capabilityNoModelResult = await engine.run(createContext('你都能帮我做什么'), {});

    cases.push({
      name: 'engine-capability-question-does-not-use-fixed-capability-template-when-model-unavailable',
      status:
        callModelCount === 0
        && executed.length === 0
        && capabilityNoModelResult?.success === false
        && String(capabilityNoModelResult?.message || '').includes(MODEL_UNAVAILABLE_COPY)
        && !String(capabilityNoModelResult?.message || '').includes('现在没能生成有效回复')
        && !String(capabilityNoModelResult?.message || '').includes('没有收到模型回复')
        && !String(capabilityNoModelResult?.message || '').includes('Photoshop')
        && !String(capabilityNoModelResult?.message || '').includes('能力问题')
        && !String(capabilityNoModelResult?.message || '').includes('当前没有可用对话模型')
        && !String(capabilityNoModelResult?.message || '').includes('我可以协助这些设计工作')
        && !String(capabilityNoModelResult?.message || '').includes('你可以直接提出主图、SKU、详情页')
        && !String(capabilityNoModelResult?.message || '').includes('Conversational reply unavailable')
        && !String(capabilityNoModelResult?.message || '').includes('需要先明确要处理的目标')
        && !String(capabilityNoModelResult?.message || '').includes('Smart Layout')
        && !String(capabilityNoModelResult?.message || '').includes('Project Image Analysis')
        && capabilityNoModelResult?.data?.agentIntentControlPlane?.requestKind === 'chat_only'
        && capabilityNoModelResult?.data?.agentIntentControlPlane?.toolScope === 'none'
        && capabilityNoModelResult?.data?.agentRequestLifecycle?.decision?.route === 'direct_response'
        && capabilityNoModelResult?.data?.agentRequestLifecycle?.execution?.kind === 'none'
          ? 'pass'
          : 'fail',
      details: JSON.stringify({ callModelCount, executed, capabilityNoModelResult })
    });

    callModelCount = 0;
    executed = [];
    const greetingResult = await engine.run(createContext('你好啊'), {
      callModel: async () => {
        callModelCount += 1;
        return {
          text: '你好，我在。'
        };
      }
    });

    cases.push({
      name: 'engine-greeting-consults-model-when-provider-is-available',
      status:
        callModelCount === 1
        && executed.length === 0
        && greetingResult?.success === true
        && typeof greetingResult?.message === 'string'
        && greetingResult.message.includes('你好')
          ? 'pass'
          : 'fail',
      details: JSON.stringify({ callModelCount, executed, greetingResult })
    });

    callModelCount = 0;
    executed = [];
    const greetingEmptyProviderResult = await engine.run(createContext('你好'), {
      callModel: async () => {
        callModelCount += 1;
        return { text: '' };
      }
    });

    cases.push({
      name: 'engine-greeting-empty-provider-reply-uses-availability-copy-not-blocked-status',
      status:
        callModelCount === 2
        && executed.length === 0
        && greetingEmptyProviderResult?.success === false
        && String(greetingEmptyProviderResult?.message || '').includes(MODEL_UNAVAILABLE_COPY)
        && !String(greetingEmptyProviderResult?.message || '').includes('现在没能生成有效回复')
        && !String(greetingEmptyProviderResult?.message || '').includes('没有收到模型回复')
        && !String(greetingEmptyProviderResult?.message || '').includes('Photoshop')
        && !String(greetingEmptyProviderResult?.message || '').includes('当前没有生成可展示回复')
        && !String(greetingEmptyProviderResult?.message || '').includes('缺少关键信息')
        && greetingEmptyProviderResult?.data?.agentRequestLifecycle?.decision?.route === 'direct_response'
        && greetingEmptyProviderResult?.data?.agentRequestLifecycle?.execution?.kind === 'none'
          ? 'pass'
          : 'fail',
      details: JSON.stringify({ callModelCount, executed, greetingEmptyProviderResult })
    });

    callModelCount = 0;
    executed = [];
    await engine.run(createContext('参考图照着做生成同款版式', {
      attachedImageData: 'base64-reference-image'
    }), {
      callModel: async () => {
        callModelCount += 1;
        return {
          text: JSON.stringify({
            route: 'skill_execution',
            skillId: 'main-image-design',
            thinking: '错误地把参考图复刻当成主图设计。',
            skillParams: { size: '800' }
          })
        };
      }
    });

    cases.push({
      name: 'reference-replication-consults-router-then-enters-autonomous-loop',
      status:
        callModelCount === 1
        && executed.length === 1
        && isAutonomousBridgeExecution(executed[0], 'layout-replication')
        && executed[0].params?.declaredSkillId === 'layout-replication'
        && executed[0].params?.runtimeSelectedSkillHandoff?.skillId === 'layout-replication'
        && executed[0].params?.skillParams?.outputMode === 'apply'
        && executed[0].params?.skillParams?.autoCreateDocument === true
        && executed[0].params?.skillParams?.preserveReferenceCanvasSize === true
          ? 'pass'
          : 'fail',
      details: JSON.stringify({ callModelCount, executed })
    });

    callModelCount = 0;
    executed = [];
    await engine.run(createContext('在我们创建的文档中 帮我复刻其中的内容', {
      hasAttachedImage: true,
      attachedImageData: 'base64-reference-image'
    }), {
      callModel: async () => {
        callModelCount += 1;
        return { text: '' };
      }
    });

    cases.push({
      name: 'engine-attached-reference-replication-enters-autonomous-loop-with-hint',
      status:
        callModelCount === 1
        && executed.length === 1
        && isAutonomousBridgeExecution(executed[0], 'layout-replication')
        && executed[0].params?.declaredSkillId === 'layout-replication'
        && executed[0].params?.runtimeSelectedSkillHandoff?.skillId === 'layout-replication'
        && executed[0].params?.runtimeSelectedSkillHandoff?.source === 'controlled_route_react_handoff'
        && executed[0].params?.skillParams?.userIntent === '在我们创建的文档中 帮我复刻其中的内容'
          ? 'pass'
          : 'fail',
      details: JSON.stringify({ callModelCount, executed })
    });

    callModelCount = 0;
    executed = [];
    let identityConversationalPromptSeen = false;
    let identityRouterPromptSeen = false;
    const identityResult = await engine.run(createContext('我的意思是你是什么模型 不是执行任务'), {
      callModel: async (messages, options = {}) => {
        callModelCount += 1;
        const systemPrompt = String(messages?.[0]?.content || '');
        identityConversationalPromptSeen = identityConversationalPromptSeen || systemPrompt.includes('当前用户在进行对话咨询');
        identityRouterPromptSeen = identityRouterPromptSeen || systemPrompt.includes('intent router');
        if (options.purpose === 'direct_response_repair') {
          return { text: '我是当前接入 DesignEcho 的对话模型，会基于项目上下文回答，并在明确需要时才进入受控 Photoshop 能力。' };
        }
        return {
          text: systemPrompt.includes('当前用户在进行对话咨询')
            ? JSON.stringify({
              route: 'skill_execution',
              skillId: 'document-management',
              skillParams: { action: 'list' }
            })
            : 'unexpected-router-call'
        };
      }
    });

    cases.push({
      name: 'engine-model-identity-enters-conversation-and-does-not-use-fixed-template',
      status:
        callModelCount === 2
        && executed.length === 0
        && identityConversationalPromptSeen
        && !identityRouterPromptSeen
        && typeof identityResult?.message === 'string'
        && identityResult.success === true
        && !identityResult.error
        && identityResult.message.includes('DesignEcho')
        && !identityResult.message.includes('对话模型没有返回有效内容')
        && !identityResult.message.includes('skill_execution')
        && !identityResult.message.includes('document-management')
        && !identityResult.message.includes('不会去调用 Photoshop 执行链')
          ? 'pass'
          : 'fail',
      details: JSON.stringify({
        callModelCount,
        executed,
        identityConversationalPromptSeen,
        identityRouterPromptSeen,
        identityResult
      })
    });

    callModelCount = 0;
    executed = [];
    let conversationalPromptSeen = false;
    let routerPromptSeen = false;
    const modelCompareResult = await engine.run(createContext('下面是一个闲聊 Gemini-3.1-Pro-Preview 和GPT5.4哪个模型更强'), {
      callModel: async (messages) => {
        callModelCount += 1;
        const systemPrompt = String(messages?.[0]?.content || '');
        conversationalPromptSeen = conversationalPromptSeen || systemPrompt.includes('当前用户在进行对话咨询');
        routerPromptSeen = routerPromptSeen || systemPrompt.includes('intent router');
        return { text: '这是模型能力比较问题，应直接回答，不应读取或修改 Photoshop 文档。' };
      }
    });

    cases.push({
      name: 'engine-model-comparison-stays-conversational',
      status:
        callModelCount === 1
        && executed.length === 0
        && conversationalPromptSeen
        && !routerPromptSeen
        && modelCompareResult?.message === '这是模型能力比较问题，应直接回答，不应读取或修改 Photoshop 文档。'
          ? 'pass'
          : 'fail',
      details: JSON.stringify({ callModelCount, executed, conversationalPromptSeen, routerPromptSeen, modelCompareResult })
    });

    callModelCount = 0;
    executed = [];
    conversationalPromptSeen = false;
    routerPromptSeen = false;
    const pureChatResult = await engine.run(createContext('为什么电商详情页要分屏设计？'), {
      callModel: async (messages) => {
        callModelCount += 1;
        const systemPrompt = String(messages?.[0]?.content || '');
        conversationalPromptSeen = conversationalPromptSeen || systemPrompt.includes('当前用户在进行对话咨询');
        routerPromptSeen = routerPromptSeen || systemPrompt.includes('intent router');
        return { text: '分屏设计主要是为了控制信息节奏、突出卖点层级，并降低用户阅读负担。' };
      }
    });

    cases.push({
      name: 'engine-pure-chat-question-stays-conversational',
      status:
        callModelCount === 1
        && executed.length === 0
        && conversationalPromptSeen
        && !routerPromptSeen
        && pureChatResult?.message === '分屏设计主要是为了控制信息节奏、突出卖点层级，并降低用户阅读负担。'
          ? 'pass'
          : 'fail',
      details: JSON.stringify({ callModelCount, executed, conversationalPromptSeen, routerPromptSeen, pureChatResult })
    });

    const taskSummaryInput = '回顾上次我们的任务 进行一个总结';
    const taskSummaryIntent = routing.detectLightweightIntent(taskSummaryInput);
    const taskSummaryDebugDecision = routing.debugInferDecisionFromText(taskSummaryInput);
    cases.push({
      name: 'task-summary-intent-stays-conversational',
      status:
        taskSummaryIntent === 'task_summary'
        && taskSummaryDebugDecision?.type === 'direct_response'
        && taskSummaryDebugDecision?.reasoning === 'lightweight:task_summary'
          ? 'pass'
          : 'fail',
      details: JSON.stringify({
        taskSummaryIntent,
        taskSummaryDebugDecision
      })
    });

    callModelCount = 0;
    executed = [];
    conversationalPromptSeen = false;
    routerPromptSeen = false;
    const taskSummaryResult = await engine.run(createContext(taskSummaryInput, {
      conversationHistory: [
        { role: 'user', content: '帮我做 SKU 以及对应的自选备注' },
        { role: 'assistant', content: '已生成 2/3/4 双 SKU，并导出对应图片。' }
      ]
    }), {
      callModel: async (messages) => {
        callModelCount += 1;
        const systemPrompt = String(messages?.[0]?.content || '');
        conversationalPromptSeen = conversationalPromptSeen || systemPrompt.includes('当前用户在进行对话咨询');
        routerPromptSeen = routerPromptSeen || systemPrompt.includes('intent router');
        return { text: '上次任务主要是 SKU 批量生成与自选备注处理，已导出对应文件；这次只是总结，不需要调用 Photoshop 工具。' };
      }
    });

    cases.push({
      name: 'engine-task-summary-does-not-enter-photoshop-tool-chain',
      status:
        callModelCount === 1
        && executed.length === 0
        && conversationalPromptSeen
        && !routerPromptSeen
        && taskSummaryResult?.message.includes('上次任务主要是 SKU 批量生成')
          ? 'pass'
          : 'fail',
      details: JSON.stringify({
        callModelCount,
        executed,
        conversationalPromptSeen,
        routerPromptSeen,
        taskSummaryResult
      })
    });

    callModelCount = 0;
    executed = [];
    const taskSummaryNoModelResult = await engine.run(createContext(taskSummaryInput, {
      conversationHistory: [
        { role: 'user', content: '帮我做 SKU 以及对应的自选备注' },
        { role: 'assistant', content: '已生成 2/3/4 双 SKU，并导出对应图片。' }
      ]
    }), {});

    cases.push({
      name: 'engine-task-summary-without-model-does-not-fabricate-local-summary',
      status:
        callModelCount === 0
        && executed.length === 0
        && taskSummaryNoModelResult?.success === false
        && taskSummaryNoModelResult?.assistantReplyOrigin?.origin === 'ui_status'
        && taskSummaryNoModelResult?.assistantReplyOrigin?.userVisibleKind === 'status_notice'
        && !String(taskSummaryNoModelResult?.message || '').includes('这是对话历史总结请求')
        && !String(taskSummaryNoModelResult?.message || '').includes('当前只能基于最近对话做简要回顾')
        && !String(taskSummaryNoModelResult?.message || '').includes('已生成 2/3/4 双 SKU')
        && String(taskSummaryNoModelResult?.message || '').includes(MODEL_UNAVAILABLE_COPY)
        && !String(taskSummaryNoModelResult?.message || '').includes('现在没能生成有效回复')
        && !String(taskSummaryNoModelResult?.message || '').includes('没有收到模型回复')
        && !String(taskSummaryNoModelResult?.message || '').includes('Photoshop')
          ? 'pass'
          : 'fail',
      details: JSON.stringify({
        callModelCount,
        executed,
        taskSummaryNoModelResult
      })
    });

    const continuationInputs = ['继续', '好的继续', '继续下一项', '按照计划继续'];
    const continuationIntents = continuationInputs.map((input) => ({
      input,
      intent: routing.detectLightweightIntent(input),
      decision: routing.debugInferDecisionFromText(input)
    }));
    cases.push({
      name: 'continuation-phrases-are-model-first-contextual-not-local-ack',
      status: continuationIntents.every((item) => (
        item.intent === 'continuation'
        && item.decision?.type === 'direct_response'
        && item.decision?.reasoning === 'lightweight:continuation'
      ))
        ? 'pass'
        : 'fail',
      details: JSON.stringify({ continuationIntents })
    });

    callModelCount = 0;
    executed = [];
    conversationalPromptSeen = false;
    routerPromptSeen = false;
    const continuationResult = await engine.run(createContext('继续', {
      conversationHistory: [
        { role: 'user', content: '帮我回顾上次我们的任务，进行一个总结' },
        { role: 'assistant', content: '上次任务是总结最近工作，不应调用 Photoshop 工具。' }
      ]
    }), {
      callModel: async (messages) => {
        callModelCount += 1;
        const systemPrompt = String(messages?.[0]?.content || '');
        const serializedMessages = JSON.stringify(messages);
        conversationalPromptSeen = conversationalPromptSeen || systemPrompt.includes('当前用户在进行对话咨询');
        routerPromptSeen = routerPromptSeen || systemPrompt.includes('intent router');
        return {
          text: serializedMessages.includes('帮我回顾上次我们的任务')
            ? '继续上一轮总结上下文：先确认已完成的修复与验证，再列出剩余风险。'
            : 'missing-context'
        };
      }
    });

    cases.push({
      name: 'engine-continuation-consults-model-with-history-and-no-tools',
      status:
        callModelCount === 1
        && executed.length === 0
        && conversationalPromptSeen
        && !routerPromptSeen
        && continuationResult?.message.includes('继续上一轮总结上下文')
          ? 'pass'
          : 'fail',
      details: JSON.stringify({
        callModelCount,
        executed,
        conversationalPromptSeen,
        routerPromptSeen,
        continuationResult
      })
    });

    callModelCount = 0;
    executed = [];
    const continuationNoModelResult = await engine.run(createContext('继续', {
      conversationHistory: [
        { role: 'user', content: '帮我回顾上次我们的任务，进行一个总结' },
        { role: 'assistant', content: '上次任务是总结最近工作，不应调用 Photoshop 工具。' }
      ]
    }), {});

    cases.push({
      name: 'engine-continuation-without-model-does-not-fabricate-local-continuation',
      status:
        callModelCount === 0
        && executed.length === 0
        && continuationNoModelResult?.success === false
        && continuationNoModelResult?.assistantReplyOrigin?.origin === 'ui_status'
        && continuationNoModelResult?.assistantReplyOrigin?.userVisibleKind === 'status_notice'
        && !String(continuationNoModelResult?.message || '').includes('我理解你想继续上一轮上下文')
        && !String(continuationNoModelResult?.message || '').includes('上一轮用户请求')
        && !String(continuationNoModelResult?.message || '').includes('帮我回顾上次我们的任务')
        && String(continuationNoModelResult?.message || '').includes(MODEL_UNAVAILABLE_COPY)
        && !String(continuationNoModelResult?.message || '').includes('现在没能生成有效回复')
        && !String(continuationNoModelResult?.message || '').includes('没有收到模型回复')
        && !String(continuationNoModelResult?.message || '').includes('Photoshop')
          ? 'pass'
          : 'fail',
      details: JSON.stringify({
        callModelCount,
        executed,
        continuationNoModelResult
      })
    });

    callModelCount = 0;
    executed = [];
    const clarificationResult = await engine.run(createContext('帮我处理一下详情页'), {
      callModel: async (_messages, options = {}) => {
        callModelCount += 1;
        if (options.purpose === 'direct_response') {
          return {
            text: '你是要检查当前详情页模板，还是从零新建一个详情页模板？'
          };
        }
        return {
          text: JSON.stringify({
            route: 'clarification_needed',
            thinking: '用户在说详情页，但没有说明是检查现有模板还是从零创建模板。',
            clarificationQuestion: '你是要检查当前详情页模板，还是从零新建一个详情页模板？'
          })
        };
      }
    });

    cases.push({
      // 详情页已交给 Agent（controlledRouteEntry=autonomous-react-loop，去刻意路线）：
      // 即便 router 漂移到 clarification_needed，模糊「处理一下详情页」也不再走循环外预澄清门控，
      // 而是直接进自主循环（autonomous-agent），由 Agent 在循环内自查/必要时追问（ADaPT 先试后问）。
      // 注：循环外 router 澄清浮现/清洗逻辑的单元覆盖在 smoke-chat-response-cleaner（line 703 等）。
      name: 'engine-hands-detail-page-to-agent-loop-not-preloop-clarification',
      status:
        callModelCount === 1
        && executed.length === 1
        && executed[0].skillId === 'autonomous-agent'
        && executed[0].params?.skillId === 'detail-page-design'
        && clarificationResult?.data?.agentIntentControlPlane?.requestKind === 'autonomous_execution'
        && (clarificationResult?.data?.agentIntentControlPlane?.matchedSignals || []).includes('controlled_skill_autonomous_entry')
        && clarificationResult?.data?.agentRequestLifecycle?.decision?.route === 'autonomous_agent'
        && clarificationResult?.data?.agentRequestLifecycle?.decision?.skillId === 'autonomous-agent'
          ? 'pass'
          : 'fail',
      details: JSON.stringify({ callModelCount, executed, clarificationResult })
    });

    callModelCount = 0;
    executed = [];
    const unsafeClarificationResult = await engine.run(createContext('帮我处理一下详情页'), {
      callModel: async (_messages, options = {}) => {
        callModelCount += 1;
        if (options.purpose === 'direct_response') {
          return { text: '需要先说明要处理哪个图层或画面。' };
        }
        if (options.purpose === 'direct_response_repair') {
          return { text: '你是想让我检查当前详情页模板，还是从零新建一个详情页模板？' };
        }
        return {
          text: JSON.stringify({
            route: 'clarification_needed',
            thinking: '用户在说详情页，但模型不应把内部路由标签展示给用户。',
            clarificationQuestion: 'clarification_needed：需要先说明要处理哪个图层或画面。'
          })
        };
      }
    });

    cases.push({
      // 详情页交给 Agent 后属可自决自主任务（controlled_skill_autonomous_entry ∈ 自决信号集）：
      // 直接进自主循环（ready_for_tool_execution），跳过循环外 public-plan「先出方案」门禁——
      // 这正是用户反对的刻意路线。router 漂移到 clarification 也不掐断、不预澄清。
      name: 'engine-detail-page-skips-public-plan-gate-into-tool-execution',
      status:
        callModelCount === 1
        && executed.length === 1
        && executed[0].skillId === 'autonomous-agent'
        && executed[0].params?.skillId === 'detail-page-design'
        && unsafeClarificationResult?.success === true
        && unsafeClarificationResult?.data?.agentTaskPlan?.status === 'ready_for_tool_execution'
        && unsafeClarificationResult?.data?.agentTaskPlan?.designBrief?.scenario === 'detail-page'
        && unsafeClarificationResult?.data?.agentRequestLifecycle?.decision?.route === 'autonomous_agent'
          ? 'pass'
          : 'fail',
      details: JSON.stringify({ callModelCount, executed, unsafeClarificationResult })
    });

    callModelCount = 0;
    executed = [];
    const thinkingEvents = [];
    const statusEvents = [];
    await engine.run(createContext('帮我关闭文档不保存'), {
      callModel: async (_messages, options = {}) => {
        callModelCount += 1;
        if (options.purpose === 'visible_reasoning') {
          return {
            text: '我先确认这是关闭当前 Photoshop 文档且不保存的操作，再判断是否需要调用文档管理能力。'
          };
        }
        return {
          text: JSON.stringify({
            route: 'skill_execution',
            skillId: 'document-management',
            mode: 'execute',
            intentSummary: '这是关闭当前文档且不保存的操作。',
            skillParams: { action: 'close', save: false }
          })
        };
      },
      callbacks: {
        onThinking: (thinking, meta) => thinkingEvents.push({ thinking, meta }),
        onStatus: (message) => statusEvents.push(message)
      }
    });

    cases.push({
      name: 'simple-operation-uses-deterministic-short-path-without-router-preview',
      status:
        callModelCount === 0
        && executed.length === 1
        && executed[0].skillId === 'document-management'
        && executed[0].params?.action === 'close'
        && executed[0].params?.save === false
        && thinkingEvents.length === 0
        && !statusEvents.some((message) => message.includes('调用意图分类模型'))
          ? 'pass'
          : 'fail',
      details: JSON.stringify({ callModelCount, executed, thinkingEvents, statusEvents })
    });

    callModelCount = 0;
    executed = [];
    const layerThinkingEvents = [];
    await engine.run(createContext('把图层的颜色从浅到深，从上到下调整图层顺序'), {
      callModel: async (_messages, options = {}) => {
        callModelCount += 1;
        if (options.purpose === 'visible_reasoning') {
          return {
            text: '我会先确认这是图层排序请求，再读取当前图层结构并按颜色明度调整顺序。'
          };
        }
        return {
          text: JSON.stringify({
            route: 'skill_execution',
            skillId: 'layer-management',
            mode: 'execute',
            intentSummary: '按颜色明度重新排序当前图层。',
            skillParams: {
              action: 'reorder',
              sortBy: 'lightness',
              sortDirection: 'light-to-dark'
            }
          })
        };
      },
      callbacks: {
        onThinking: (thinking, meta) => layerThinkingEvents.push({ thinking, meta })
      }
    });

    cases.push({
      name: 'layer-order-uses-deterministic-short-path-without-router-preview',
      status:
        callModelCount === 0
        && executed.length === 1
        && executed[0].skillId === 'layer-management'
        && executed[0].params?.action === 'reorder'
        && executed[0].params?.sortBy === 'lightness'
        && executed[0].params?.sortDirection === 'light-to-dark'
        && layerThinkingEvents.length === 0
          ? 'pass'
          : 'fail',
      details: JSON.stringify({ callModelCount, executed, layerThinkingEvents })
    });

    callModelCount = 0;
    executed = [];
    const skuThinkingEvents = [];
    const skuModelPurposes = [];
    await engine.run(createContext('帮我做SKU以及对应的自选备注'), {
      callModel: async (_messages, options = {}) => {
        callModelCount += 1;
        skuModelPurposes.push(options.purpose || 'unknown');
        if (options.purpose === 'visible_reasoning') {
          return {
            text: '我会先判断这是 SKU 出图和自选备注请求，再确认项目素材、规格和模板是否满足执行条件。'
          };
        }
        if (options.purpose === 'design_execution_preflight') {
          return {
            text: JSON.stringify(sampleDesignDecision('生成 SKU 组合图，并同步生成对应自选备注。'))
          };
        }
        return {
          text: JSON.stringify({
            route: 'skill_execution',
            skillId: 'sku-batch',
            mode: 'execute',
            intentSummary: '用户需要生成 SKU 组合图，并同步生成对应自选备注。',
            skillParams: {
              generateNotes: true
            }
          })
        };
      },
      callbacks: {
        onThinking: (thinking, meta) => skuThinkingEvents.push({ thinking, meta })
      }
    });

    cases.push({
      name: 'business-sku-request-skips-initial-visible-preview-before-skill-execution',
      status:
        callModelCount === 1
        && executed.length === 1
        && isAutonomousBridgeExecution(executed[0], 'sku-batch')
        && executed[0].params?.skillParams?.generateNotes === true
        && !executed[0].params?.skillParams?.designIntelligenceDecision
        && sameJson(skuModelPurposes, ['router'])
        && !skuThinkingEvents.some((item) => /设计方案|设计计划|整理设计|请问|方便提供|需要先确认/.test(String(item?.thinking || '')))
          ? 'pass'
          : 'fail',
      details: JSON.stringify({ callModelCount, executed, skuThinkingEvents, skuModelPurposes })
    });

    callModelCount = 0;
    executed = [];
    const candidateOnlyMainImageResult = await engine.run(createContext('主图'), {
      callModel: async (_messages, options = {}) => {
        callModelCount += 1;
        if (options.purpose === 'router') {
          return {
            text: JSON.stringify({
              route: 'direct_response',
              directResponse: '你提到的是主图方向；如果只是讨论，我可以先帮你判断主图策略，明确要生成时再进入执行。'
            })
          };
        }
        if (options.purpose === 'direct_response') {
          return {
            text: '你提到的是主图方向；如果只是讨论，我可以先帮你判断主图策略，明确要生成时再进入执行。'
          };
        }
        return { text: '' };
      }
    });

    cases.push({
      // 新设计：单独业务词「主图」没有明确动作意图，走对话不执行（创意主图设计需要明确
      // 「做/设计主图」才进自主执行）。核心安全保证不变：业务词不被误执行（executed 为空）。
      name: 'bare-business-term-stays-conversational-and-does-not-execute',
      status:
        callModelCount >= 1
        && executed.length === 0
        && candidateOnlyMainImageResult.data?.agentIntentControlPlane?.requestKind === 'chat_only'
          ? 'pass'
          : 'fail',
      details: JSON.stringify({
        callModelCount,
        executed,
        result: {
          success: candidateOnlyMainImageResult.success,
          message: candidateOnlyMainImageResult.message,
          intentControlPlane: candidateOnlyMainImageResult.data?.agentIntentControlPlane,
          lifecycle: candidateOnlyMainImageResult.data?.agentRequestLifecycle
        }
      })
    });

    callModelCount = 0;
    executed = [];
    const routerDirectUnavailablePurposes = [];
    const routerDirectUnavailableResult = await engine.run(createContext('主图'), {
      callModel: async (_messages, options = {}) => {
        callModelCount += 1;
        routerDirectUnavailablePurposes.push(options.purpose || 'unknown');
        if (options.purpose === 'router') {
          return {
            text: JSON.stringify({
              route: 'direct_response',
              directResponse: '这是路由字段，不应直接展示。'
            })
          };
        }
        if (options.purpose === 'direct_response') {
          return {
            text: '<tool_call><function=visual_analysis><parameter=analysis_type>content_overview</parameter></function></tool_call>'
          };
        }
        if (options.purpose === 'direct_response_repair') {
          return { text: '' };
        }
        return { text: '' };
      }
    });

    cases.push({
      // 单独业务词「主图」现走对话 direct-response 路径（非 router）。核心安全跨路径不变：
      // 模型返回路由字段/tool_call 等无效内容时，结果是诚实失败且不把这些内部内容泄露给用户。
      name: 'direct-response-model-unavailable-is-not-success-and-leaks-nothing',
      status:
        callModelCount >= 2
        && executed.length === 0
        && routerDirectUnavailableResult.success === false
        && routerDirectUnavailableResult.data?.agentRequestLifecycle?.decision?.route === 'direct_response'
        && !String(routerDirectUnavailableResult.message || '').includes('这是路由字段')
        && !String(routerDirectUnavailableResult.message || '').includes('<tool_call>')
        && !String(routerDirectUnavailableResult.message || '').includes('visual_analysis')
          ? 'pass'
          : 'fail',
      details: JSON.stringify({
        callModelCount,
        purposes: routerDirectUnavailablePurposes,
        executed,
        result: {
          success: routerDirectUnavailableResult.success,
          error: routerDirectUnavailableResult.error,
          message: routerDirectUnavailableResult.message,
          origin: routerDirectUnavailableResult.assistantReplyOrigin,
          failure: routerDirectUnavailableResult.data?.conversationalModelFailure,
          lifecycle: routerDirectUnavailableResult.data?.agentRequestLifecycle
        }
      })
    });

    callModelCount = 0;
    executed = [];
    const explicitSkuRoute = routing.fastDeterministicRoute('帮我做一下SKU');
    const explicitSkuResult = await engine.run(createContext('帮我做一下SKU'), {
      callModel: async (_messages, options = {}) => {
        callModelCount += 1;
        if (options.purpose === 'visible_reasoning') {
          return {
            text: '我会先判断这是当前项目的 SKU 批量生成请求，再确认 SKU 文件、模板和配置。'
          };
        }
        if (options.purpose === 'design_execution_preflight') {
          return { text: '{}' };
        }
        return {
          text: JSON.stringify({
            route: 'skill_execution',
            skillId: 'main-image-design',
            mode: 'open-design',
            intentSummary: '用户需要进行电商主图设计。',
            skillParams: {
              requiresGenericDesignDecision: true
            }
          })
        };
      }
    });

    cases.push({
      name: 'explicit-sku-route-vetoes-generic-design-model-drift',
      status:
        callModelCount === 1
        && explicitSkuRoute?.skillId === 'sku-batch'
        && explicitSkuResult.success === true
        && executed.length === 1
        && isAutonomousBridgeExecution(executed[0], 'sku-batch')
        && executed[0].params?.skillParams?.generateNotes === true
        && executed[0].params?.skillParams?.requiresGenericDesignDecision !== true
        && hasAutonomousToolExecutionLifecycle(explicitSkuResult, 'sku-batch')
          ? 'pass'
          : 'fail',
      details: JSON.stringify({
        callModelCount,
        deterministicRoute: explicitSkuRoute,
        executed,
        result: {
          success: explicitSkuResult.success,
          error: explicitSkuResult.error,
          message: explicitSkuResult.message,
          preflightStatus: explicitSkuResult.data?.agentDesignExecutionPreflight?.status,
          lifecycle: explicitSkuResult.data?.agentRequestLifecycle
        }
      })
    });

    callModelCount = 0;
    executed = [];
    const explicitSkuDirectResponseDriftResult = await engine.run(createContext('帮我做一下SKU'), {
      callModel: async (_messages, options = {}) => {
        callModelCount += 1;
        if (options.purpose === 'visible_reasoning') {
          return { text: '' };
        }
        if (options.purpose === 'design_execution_preflight') {
          return { text: '{}' };
        }
        return {
          text: JSON.stringify({
            route: 'direct_response',
            directResponse: '我可以协助这些设计工作：主图、点击图、转化图和白底图规划、SKU 组合图和自选备注、详情页设计。你可以直接提出主图、SKU、详情页、项目图片理解、文档保存或图层调整需求；我会先判断它属于对话、只读检查还是需要进入处理流程。'
          })
        };
      }
    });

    cases.push({
      name: 'explicit-sku-execution-overrides-model-direct-response-drift',
      status:
        callModelCount >= 1
        && explicitSkuDirectResponseDriftResult.success === true
        && executed.length === 1
        && isAutonomousBridgeExecution(executed[0], 'sku-batch')
        && hasAutonomousToolExecutionLifecycle(explicitSkuDirectResponseDriftResult, 'sku-batch')
        && !String(explicitSkuDirectResponseDriftResult.message || '').includes('我可以协助这些设计工作')
        && !String(explicitSkuDirectResponseDriftResult.message || '').includes('你可以直接提出主图、SKU、详情页')
          ? 'pass'
          : 'fail',
      details: JSON.stringify({
        callModelCount,
        executed,
        result: {
          success: explicitSkuDirectResponseDriftResult.success,
          error: explicitSkuDirectResponseDriftResult.error,
          message: explicitSkuDirectResponseDriftResult.message,
          lifecycle: explicitSkuDirectResponseDriftResult.data?.agentRequestLifecycle
        }
      })
    });

    callModelCount = 0;
    executed = [];
    const explicitSkuDirectWaitForUserResult = await engine.run(createContext('帮我做一下SKU'), {
      callModel: async (_messages, options = {}) => {
        callModelCount += 1;
        if (options.purpose === 'visible_reasoning') {
          return { text: '' };
        }
        if (options.purpose === 'direct_response') {
          return { text: '当前先不要执行 Photoshop，等你确认 SKU 源文件和规格后再做。' };
        }
        return {
          text: JSON.stringify({
            route: 'direct_response',
            directResponse: '当前先不要执行 Photoshop，等你确认 SKU 源文件和规格后再做。'
          })
        };
      }
    });

    cases.push({
      name: 'explicit-sku-execution-overrides-model-direct-wait-drift',
      status:
        callModelCount >= 1
        && explicitSkuDirectWaitForUserResult.success === true
        && executed.length === 1
        && isAutonomousBridgeExecution(executed[0], 'sku-batch')
        && hasAutonomousToolExecutionLifecycle(explicitSkuDirectWaitForUserResult, 'sku-batch')
          ? 'pass'
          : 'fail',
      details: JSON.stringify({
        callModelCount,
        executed,
        result: {
          success: explicitSkuDirectWaitForUserResult.success,
          error: explicitSkuDirectWaitForUserResult.error,
          message: explicitSkuDirectWaitForUserResult.message,
          lifecycle: explicitSkuDirectWaitForUserResult.data?.agentRequestLifecycle
        }
      })
    });

    callModelCount = 0;
    executed = [];
    const explicitSkuClarificationDriftResult = await engine.run(createContext('帮我做一下SKU'), {
      callModel: async (_messages, options = {}) => {
        callModelCount += 1;
        if (options.purpose === 'visible_reasoning') {
          return { text: '' };
        }
        if (options.purpose === 'design_execution_preflight') {
          return { text: '{}' };
        }
        return {
          text: JSON.stringify({
            route: 'clarification_needed',
            clarificationQuestion: '需要先说明要处理哪个图层或画面。'
          })
        };
      }
    });

    cases.push({
      name: 'explicit-sku-execution-overrides-model-clarification-drift',
      status:
        callModelCount >= 1
        && explicitSkuClarificationDriftResult.success === true
        && executed.length === 1
        && isAutonomousBridgeExecution(executed[0], 'sku-batch')
        && hasAutonomousToolExecutionLifecycle(explicitSkuClarificationDriftResult, 'sku-batch')
          ? 'pass'
          : 'fail',
      details: JSON.stringify({
        callModelCount,
        executed,
        result: {
          success: explicitSkuClarificationDriftResult.success,
          error: explicitSkuClarificationDriftResult.error,
          message: explicitSkuClarificationDriftResult.message,
          lifecycle: explicitSkuClarificationDriftResult.data?.agentRequestLifecycle
        }
      })
    });

    callModelCount = 0;
    executed = [];
    const explicitSkuDomainClarificationResult = await engine.run(createContext('帮我做一下SKU'), {
      callModel: async (_messages, options = {}) => {
        callModelCount += 1;
        if (options.purpose === 'visible_reasoning') {
          return { text: '' };
        }
        if (options.purpose === 'direct_response') {
          return { text: '当前还缺少 SKU 源文件和需要生成的规格，请先确认项目素材是否完整。' };
        }
        return {
          text: JSON.stringify({
            route: 'clarification_needed',
            clarificationQuestion: '当前还缺少 SKU 源文件和需要生成的规格，请先确认项目素材是否完整。'
          })
        };
      }
    });

    cases.push({
      name: 'explicit-sku-execution-overrides-domain-specific-model-clarification',
      status:
        callModelCount >= 1
        && explicitSkuDomainClarificationResult.success === true
        && executed.length === 1
        && isAutonomousBridgeExecution(executed[0], 'sku-batch')
        && hasAutonomousToolExecutionLifecycle(explicitSkuDomainClarificationResult, 'sku-batch')
          ? 'pass'
          : 'fail',
      details: JSON.stringify({
        callModelCount,
        executed,
        result: {
          success: explicitSkuDomainClarificationResult.success,
          error: explicitSkuDomainClarificationResult.error,
          message: explicitSkuDomainClarificationResult.message,
          lifecycle: explicitSkuDomainClarificationResult.data?.agentRequestLifecycle
        }
      })
    });

    callModelCount = 0;
    executed = [];
    const explicitSkuClarifyIfMissingResult = await engine.run(createContext('帮我生成SKU图，如果信息不够先问我'), {
      callModel: async (_messages, options = {}) => {
        callModelCount += 1;
        if (options.purpose === 'visible_reasoning') {
          return { text: '' };
        }
        if (options.purpose === 'design_execution_preflight') {
          return { text: '{}' };
        }
        if (options.purpose === 'direct_response') {
          return { text: '当前还缺少 SKU 源文件和需要生成的规格，请先确认项目素材是否完整。' };
        }
        return {
          text: JSON.stringify({
            route: 'clarification_needed',
            clarificationQuestion: '当前还缺少 SKU 源文件和需要生成的规格，请先确认项目素材是否完整。'
          })
        };
      }
    });

    cases.push({
      name: 'explicit-sku-execution-inspects-before-user-requested-missing-info-clarification',
      status:
        callModelCount >= 1
        && explicitSkuClarifyIfMissingResult.success === true
        && executed.length === 1
        && isAutonomousBridgeExecution(executed[0], 'sku-batch')
        && hasAutonomousToolExecutionLifecycle(explicitSkuClarifyIfMissingResult, 'sku-batch')
        && !String(explicitSkuClarifyIfMissingResult.message || '').includes('缺少 SKU 源文件')
          ? 'pass'
          : 'fail',
      details: JSON.stringify({
        callModelCount,
        executed,
        result: {
          success: explicitSkuClarifyIfMissingResult.success,
          error: explicitSkuClarifyIfMissingResult.error,
          message: explicitSkuClarifyIfMissingResult.message,
          lifecycle: explicitSkuClarifyIfMissingResult.data?.agentRequestLifecycle
        }
      })
    });

    callModelCount = 0;
    executed = [];
    const skuNoteOnlyClarificationDriftResult = await engine.run(createContext('我还需要对应的SKU自选备注'), {
      callModel: async (_messages, options = {}) => {
        callModelCount += 1;
        if (options.purpose === 'visible_reasoning') {
          return { text: '' };
        }
        if (options.purpose === 'design_execution_preflight') {
          return { text: '{}' };
        }
        return {
          text: JSON.stringify({
            route: 'clarification_needed',
            clarificationQuestion: '需要先说明要生成哪些颜色组合。'
          })
        };
      }
    });

    cases.push({
      name: 'sku-note-only-request-stays-note-only-when-model-asks-for-combos',
      status:
        callModelCount >= 1
        && skuNoteOnlyClarificationDriftResult.success === true
        && executed.length === 1
        && isAutonomousBridgeExecution(executed[0], 'sku-batch')
        && executed[0].params?.skillParams?.onlyNotes === true
        && executed[0].params?.skillParams?.generateNotes === true
        && !Array.isArray(executed[0].params?.skillParams?.specifiedColors)
        && hasAutonomousToolExecutionLifecycle(skuNoteOnlyClarificationDriftResult, 'sku-batch')
          ? 'pass'
          : 'fail',
      details: JSON.stringify({
        callModelCount,
        executed,
        result: {
          success: skuNoteOnlyClarificationDriftResult.success,
          error: skuNoteOnlyClarificationDriftResult.error,
          message: skuNoteOnlyClarificationDriftResult.message,
          lifecycle: skuNoteOnlyClarificationDriftResult.data?.agentRequestLifecycle
        }
      })
    });

    callModelCount = 0;
    executed = [];
    const explicitSkuPollutedModelPurposes = [];
    const explicitSkuPollutedModelResult = await engine.run(createContext('帮我做一下SKU'), {
      callModel: async (_messages, options = {}) => {
        explicitSkuPollutedModelPurposes.push(options.purpose || 'router');
        callModelCount += 1;
        if (options.purpose === 'visible_reasoning') {
          return { text: '' };
        }
        if (options.purpose === 'design_execution_preflight') {
          return { text: '{}' };
        }
        return {
          text: JSON.stringify({
            route: 'skill_execution',
            skillId: 'sku-batch',
            mode: 'open-design',
            intentSummary: '用户需要开放式设计 SKU 画面。',
            skillParams: {
              requiresGenericDesignDecision: true,
              generateNotes: false
            }
          })
        };
      }
    });

    cases.push({
      name: 'plain-sku-model-route-cannot-pollute-controlled-sku-preflight',
      status:
        callModelCount >= 1
        && !explicitSkuPollutedModelPurposes.includes('design_execution_preflight')
        && explicitSkuPollutedModelResult.success === true
        && executed.length === 1
        && isAutonomousBridgeExecution(executed[0], 'sku-batch')
        && executed[0].params?.skillParams?.generateNotes === true
        && executed[0].params?.skillParams?.requiresGenericDesignDecision !== true
        && !executed[0].params?.skillParams?.designIntelligenceDecision
        && hasAutonomousToolExecutionLifecycle(explicitSkuPollutedModelResult, 'sku-batch')
          ? 'pass'
          : 'fail',
      details: JSON.stringify({
        callModelCount,
        purposes: explicitSkuPollutedModelPurposes,
        executed,
        result: {
          success: explicitSkuPollutedModelResult.success,
          error: explicitSkuPollutedModelResult.error,
          message: explicitSkuPollutedModelResult.message,
          preflightStatus: explicitSkuPollutedModelResult.data?.agentDesignExecutionPreflight?.status,
          preflight: explicitSkuPollutedModelResult.data?.agentDesignExecutionPreflight,
          lifecycle: explicitSkuPollutedModelResult.data?.agentRequestLifecycle
        }
      })
    });

    callModelCount = 0;
    executed = [];
    const skuDownstreamContextInput = '帮我做4双SKU组合，需要3个，后续会接到主图和详情页流程里';
    const skuDownstreamContextKeywordRoute = routing.fastDeterministicRoute(skuDownstreamContextInput);
    const skuDownstreamContextResult = await engine.run(createContext(skuDownstreamContextInput), {
      callModel: async () => {
        callModelCount += 1;
        return {
          text: JSON.stringify({
            route: 'skill_execution',
            skillId: 'ecommerce-socks-design',
            mode: 'execute',
            intentSummary: '用户不是只要 SKU，而是要整体规划袜子电商出图交付。',
            skillParams: {
              deliverables: ['sku', 'main-image', 'detail-page'],
              userIntent: skuDownstreamContextInput
            }
          })
        };
      }
    });

    cases.push({
      name: 'sku-current-task-with-downstream-context-cannot-be-promoted-to-parent-workflow',
      status:
        callModelCount === 1
        && skuDownstreamContextKeywordRoute?.skillId === 'sku-batch'
        && executed.length === 1
        && isAutonomousBridgeExecution(executed[0], 'sku-batch')
        && executed[0].params?.skillParams?.comboSizes?.includes(4)
        && executed[0].params?.skillParams?.countPerSize === 3
        && hasAutonomousToolExecutionLifecycle(skuDownstreamContextResult, 'sku-batch')
          ? 'pass'
          : 'fail',
      details: JSON.stringify({
        callModelCount,
        keywordRoute: skuDownstreamContextKeywordRoute,
        executed,
        lifecycle: skuDownstreamContextResult.data?.agentRequestLifecycle
      })
    });

    callModelCount = 0;
    executed = [];
    await engine.run(createContext('把当前选中的图层编组'), {
      callModel: async () => {
        callModelCount += 1;
        return {
          text: JSON.stringify({
            route: 'skill_execution',
            skillId: 'layer-management',
            mode: 'execute',
            intentSummary: '把当前选中的图层编组。',
            skillParams: {
              action: 'group',
              useCurrentSelection: true
            }
          })
        };
      }
    });

    cases.push({
      name: 'current-selection-group-uses-deterministic-execution-boundary',
      status:
        callModelCount === 0
        && executed.length === 1
        && executed[0].skillId === 'layer-management'
        && executed[0].params?.action === 'group'
        && executed[0].params?.useCurrentSelection === true
          ? 'pass'
          : 'fail',
      details: JSON.stringify({ callModelCount, executed })
    });

    callModelCount = 0;
    executed = [];
    await engine.run(createContext('你能把当前选中的图层置顶吗？'), {
      callModel: async () => {
        callModelCount += 1;
        return {
          text: JSON.stringify({
            route: 'skill_execution',
            skillId: 'layer-management',
            mode: 'execute',
            intentSummary: '把当前选中的图层移到最上方。',
            skillParams: {
              action: 'reorder',
              reorderAction: 'top',
              useCurrentSelection: true
            }
          })
        };
      }
    });

    cases.push({
      name: 'actionable-layer-question-uses-deterministic-execution-boundary',
      status:
        callModelCount === 0
        && executed.length === 1
        && executed[0].skillId === 'layer-management'
        && executed[0].params?.action === 'reorder'
        && executed[0].params?.reorderAction === 'top'
        && executed[0].params?.useCurrentSelection === true
          ? 'pass'
          : 'fail',
      details: JSON.stringify({ callModelCount, executed })
    });

    callModelCount = 0;
    executed = [];
    await engine.run(createContext('隐藏的图层你看不到吗？'), {
      callModel: async () => {
        callModelCount += 1;
        return {
          text: JSON.stringify({
            route: 'skill_execution',
            skillId: 'layer-management',
            mode: 'execute',
            intentSummary: '检查隐藏图层和当前图层层级。',
            skillParams: {
              action: 'inspect'
            }
          })
        };
      }
    });

    cases.push({
      name: 'hidden-layer-question-uses-readonly-inspection-boundary',
      status:
        callModelCount === 0
        && executed.length === 1
        && executed[0].skillId === 'layer-management'
        && executed[0].params?.action === 'inspect'
          ? 'pass'
          : 'fail',
      details: JSON.stringify({ callModelCount, executed })
    });

    callModelCount = 0;
    executed = [];
    const autonomousPlanningModelPurposes = [];
    const autonomousPlanningResult = await engine.run(createContext('把这个画面整理得更高级一些并保留当前视觉重点'), {
      callModel: async (_messages, requestOptions) => {
        callModelCount += 1;
        autonomousPlanningModelPurposes.push(requestOptions?.purpose || 'unknown');
        if (requestOptions?.purpose !== 'router') {
          return { text: '' };
        }
        return {
          text: JSON.stringify({
            route: 'autonomous_agent',
            skillId: 'detail-page-design',
            mode: 'execute',
            thinking: '这是开放式详情页整理任务，需要保留已识别的屏级意图。',
            skillParams: {
              autoFix: false,
              structureMode: 'guided',
              visualValidation: true,
              userIntent: '把这个画面整理得更高级一些并保留当前视觉重点'
            }
          })
        };
      }
    });

    cases.push({
      name: 'autonomous-agent-preserves-classifier-intent-context',
      status:
        callModelCount === 1
        && sameJson(autonomousPlanningModelPurposes, ['router'])
        && executed.length === 1
        && isAutonomousBridgeExecution(executed[0], 'detail-page-design')
        && executed[0]?.params?.skillParams?.structureMode === 'guided'
        && executed[0]?.params?.recognizedIntent === '这是开放式详情页整理任务，需要保留已识别的屏级意图。'
        && autonomousPlanningResult?.success === true
        && autonomousPlanningResult?.data?.agentTaskPlan?.status === 'ready_for_tool_execution'
        && autonomousPlanningResult?.data?.agentRequestLifecycle?.decision?.route === 'autonomous_agent'
        && autonomousPlanningResult?.data?.agentRequestLifecycle?.execution?.kind === 'autonomous_agent'
          ? 'pass'
          : 'fail',
      details: JSON.stringify({ callModelCount, autonomousPlanningModelPurposes, executed, result: autonomousPlanningResult })
    });

    callModelCount = 0;
    executed = [];
    await engine.run(createContext('帮我关闭文档不保存'), {
      callModel: async () => {
        callModelCount += 1;
        return { text: '{}' };
      }
    });

    cases.push({
      name: 'local-route-handles-document-close-when-router-is-empty',
      status:
        callModelCount === 0
        && executed.length === 1
        && executed[0].skillId === 'document-management'
        && executed[0].params?.action === 'close'
        && executed[0].params?.save === false
          ? 'pass'
          : 'fail',
      details: JSON.stringify({ callModelCount, executed })
    });

    callModelCount = 0;
    executed = [];
    await engine.run(createContext('帮我关闭文档不保存'), {
      callModel: async () => {
        callModelCount += 1;
        return {
          text: JSON.stringify({
            route: 'skill_execution',
            skillId: 'agent-panel-bridge',
            thinking: '错误地当成调试桥接。',
            skillParams: { intent: 'debug_or_implement' }
          })
        };
      }
    });

    cases.push({
      name: 'internal-debug-bridge-cannot-hijack-ordinary-document-close',
      status:
        callModelCount === 0
        && executed.length === 1
        && executed[0].skillId === 'document-management'
        && executed[0].params?.action === 'close'
        && executed[0].params?.save === false
          ? 'pass'
          : 'fail',
      details: JSON.stringify({ callModelCount, executed })
    });

    const bridgeHijackMatrix = [
      {
        input: '帮我检查一下当前详情页结构',
        expectedSkillId: 'detail-page-design',
        expectedViaAutonomous: true
      },
      { input: '帮我把字体全部改成思源黑体', expectedSkillId: 'text-font-replace' },
      {
        input: '参考图照着做生成同款版式',
        expectedSkillId: 'layout-replication',
        expectedViaAutonomous: true
      }
    ];
    const bridgeHijackResults = [];
    callModelCount = 0;
    for (const item of bridgeHijackMatrix) {
      executed = [];
      await engine.run(createContext(item.input), {
        callModel: async () => {
          callModelCount += 1;
          return {
            text: JSON.stringify({
              route: 'skill_execution',
              skillId: 'agent-panel-bridge',
              thinking: '错误地当成调试桥接。',
              skillParams: { intent: 'debug_or_implement' }
            })
          };
        }
      });
      bridgeHijackResults.push({
        input: item.input,
        expectedSkillId: item.expectedSkillId,
        expectedViaAutonomous: item.expectedViaAutonomous === true,
        executed: [...executed]
      });
    }

    cases.push({
      name: 'ordinary-user-facing-skills-cannot-be-hijacked-by-agent-panel-bridge',
      status:
        bridgeHijackResults.every((item) =>
          item.executed.length === 1
          && (item.expectedViaAutonomous
            ? isAutonomousBridgeExecution(item.executed[0], item.expectedSkillId)
            : item.executed[0].skillId === item.expectedSkillId))
          ? 'pass'
          : 'fail',
      details: JSON.stringify({ callModelCount, bridgeHijackResults })
    });

    callModelCount = 0;
    executed = [];
    const skuMaterialWhiteBgHijackPurposes = [];
    const skuMaterialWhiteBgHijackResult = await engine.run(createContext('帮我使用SKU素材做白底图导出到主图目录下'), {
      callModel: async (_messages, options) => {
        callModelCount += 1;
        skuMaterialWhiteBgHijackPurposes.push(options?.purpose || 'unknown');
        if (options?.purpose === 'router') {
          return {
            text: JSON.stringify({
              route: 'skill_execution',
              skillId: 'sku-batch',
              thinking: '错误地把 SKU 素材来源当成 SKU 编排任务。',
              skillParams: {}
            })
          };
        }
        return { text: '用户要使用 SKU 素材制作主图白底图。' };
      }
    });

    cases.push({
      // 白底图已交给 Agent（去刻意路线）：不再硬路由到 main-image-design 固定流水线，
      // 而是进自主循环（autonomous-agent，ready_for_tool_execution）。模型 router 把它误判成
      // sku-batch 也不会被劫持——denylist 在执行点挡住 sku-batch 直执，落入循环；
      // main-image-design 仅作为循环内可选技能提示（params.skillId）。
      name: 'main-image-white-bg-using-sku-material-cannot-be-hijacked-by-sku-batch',
      status:
        callModelCount === 1
        && sameJson(skuMaterialWhiteBgHijackPurposes, ['router'])
        && executed.length === 1
        && executed[0].skillId === 'autonomous-agent'
        && executed[0].params?.skillId === 'main-image-design'
        && skuMaterialWhiteBgHijackResult?.data?.agentRequestLifecycle?.decision?.skillId === 'autonomous-agent'
        && skuMaterialWhiteBgHijackResult?.data?.agentRequestLifecycle?.decision?.route === 'autonomous_agent'
        && skuMaterialWhiteBgHijackResult?.data?.agentTaskPlan?.status === 'ready_for_tool_execution'
        && skuMaterialWhiteBgHijackResult?.data?.agentTaskPlan?.designBrief?.scenario === 'main-image'
          ? 'pass'
          : 'fail',
      details: JSON.stringify({
        callModelCount,
        purposes: skuMaterialWhiteBgHijackPurposes,
        executed,
        route: skuMaterialWhiteBgHijackResult?.data?.agentRequestLifecycle?.decision,
        taskPlan: skuMaterialWhiteBgHijackResult?.data?.agentTaskPlan
      })
    });

    callModelCount = 0;
    executed = [];
    const skuMaterialWhiteBgDirectResponseResult = await engine.run(createContext('帮我使用SKU素材做白底图导出到主图目录下'), {
      callModel: async (_messages, options) => {
        callModelCount += 1;
        if (options?.purpose === 'router') {
          return {
            text: JSON.stringify({
              route: 'direct_response',
              directResponse: '你是在描述白底图需求，本轮不需要执行工具。'
            })
          };
        }
        return { text: '用户要使用 SKU 素材制作主图白底图。' };
      }
    });

    cases.push({
      // 白底图是确定性交付：模型 router 漂移到 direct_response 也不掐断执行，
      // 仍进自主循环（autonomous-agent）；main-image-design 作为循环内技能提示保留。
      name: 'main-image-white-bg-execution-overrides-model-direct-response-drift',
      status:
        callModelCount === 1
        && executed.length === 1
        && executed[0].skillId === 'autonomous-agent'
        && executed[0].params?.skillId === 'main-image-design'
        && skuMaterialWhiteBgDirectResponseResult?.data?.agentRequestLifecycle?.decision?.route === 'autonomous_agent'
        && skuMaterialWhiteBgDirectResponseResult?.data?.agentRequestLifecycle?.decision?.skillId === 'autonomous-agent'
          ? 'pass'
          : 'fail',
      details: JSON.stringify({
        callModelCount,
        executed,
        route: skuMaterialWhiteBgDirectResponseResult?.data?.agentRequestLifecycle?.decision,
        message: skuMaterialWhiteBgDirectResponseResult?.message
      })
    });

    callModelCount = 0;
    executed = [];
    const skuMaterialWhiteBgClarificationResult = await engine.run(createContext('帮我使用SKU素材做白底图导出到主图目录下'), {
      callModel: async (_messages, options) => {
        callModelCount += 1;
        if (options?.purpose === 'router') {
          return {
            text: JSON.stringify({
              route: 'clarification_needed',
              clarificationQuestion: '需要先告诉我使用哪个 SKU 颜色。'
            })
          };
        }
        return { text: '用户要使用 SKU 素材制作主图白底图。' };
      }
    });

    cases.push({
      // 白底图是确定性交付：模型 router 漂移到 clarification 也不把任务丢回用户追问，
      // 仍进自主循环（autonomous-agent）；main-image-design 作为循环内技能提示保留。
      name: 'main-image-white-bg-execution-overrides-model-clarification-drift',
      status:
        callModelCount === 1
        && executed.length === 1
        && executed[0].skillId === 'autonomous-agent'
        && executed[0].params?.skillId === 'main-image-design'
        && skuMaterialWhiteBgClarificationResult?.data?.agentRequestLifecycle?.decision?.route === 'autonomous_agent'
        && skuMaterialWhiteBgClarificationResult?.data?.agentRequestLifecycle?.decision?.skillId === 'autonomous-agent'
          ? 'pass'
          : 'fail',
      details: JSON.stringify({
        callModelCount,
        executed,
        route: skuMaterialWhiteBgClarificationResult?.data?.agentRequestLifecycle?.decision,
        message: skuMaterialWhiteBgClarificationResult?.message
      })
    });

    callModelCount = 0;
    executed = [];
    const skuMaterialWhiteBgThinkingEvents = [];
    const skuMaterialWhiteBgPurposes = [];
    const skuMaterialWhiteBgClarifyingPreviewResult = await engine.run(createContext('帮我使用SKU素材做白底图导出到主图目录下'), {
      callbacks: {
        onThinking: (content) => skuMaterialWhiteBgThinkingEvents.push(String(content || ''))
      },
      callModel: async (_messages, options) => {
        callModelCount += 1;
        skuMaterialWhiteBgPurposes.push(options?.purpose || 'unknown');
        if (options?.purpose === 'visible_reasoning') {
          return { text: '我需要先确认 SKU素材是什么、主图目录在哪里，请问这些信息方便提供吗？' };
        }
        if (options?.purpose === 'router') {
          return {
            text: JSON.stringify({
              route: 'skill_execution',
              skillId: 'main-image-design',
              thinking: '用户要使用 SKU 素材制作主图白底图。',
              skillParams: {}
            })
          };
        }
        return { text: '用户要使用 SKU 素材制作主图白底图。' };
      }
    });

    cases.push({
      // 白底图直接进自主循环（ready_for_tool_execution），不先发澄清预览问用户；
      // 只调一次 router、不再触发循环外 public-plan / visible_reasoning。
      name: 'business-main-image-white-bg-skips-clarifying-visible-preview',
      status:
        callModelCount === 1
        && sameJson(skuMaterialWhiteBgPurposes, ['router'])
        && executed.length === 1
        && executed[0].skillId === 'autonomous-agent'
        && executed[0].params?.skillId === 'main-image-design'
        && skuMaterialWhiteBgClarifyingPreviewResult?.data?.agentRequestLifecycle?.decision?.skillId === 'autonomous-agent'
        && !skuMaterialWhiteBgThinkingEvents.some((item) => /请问|方便提供|需要先确认|先确认/.test(item))
          ? 'pass'
          : 'fail',
      details: JSON.stringify({
        callModelCount,
        purposes: skuMaterialWhiteBgPurposes,
        executed,
        thinkingEvents: skuMaterialWhiteBgThinkingEvents,
        route: skuMaterialWhiteBgClarifyingPreviewResult?.data?.agentRequestLifecycle?.decision
      })
    });

    callModelCount = 0;
    executed = [];
    const pausedMattingResult = await engine.run(createContext('帮我抠图'), {
      callModel: async () => {
        callModelCount += 1;
        return {
          text: JSON.stringify({
            route: 'skill_execution',
            skillId: 'matte-product',
            intentSummary: '用户想抠图。'
          })
        };
      }
    });

    cases.push({
      name: 'agent-matting-intent-is-paused-before-model-and-tools',
      status:
        callModelCount === 0
        && executed.length === 0
        && pausedMattingResult.success === false
        && pausedMattingResult.message.includes('抠图属于 UXP 面板用户工具')
        && pausedMattingResult.data?.agentIntentControlPlane?.requestKind === 'uxp_user_tool_only'
        && pausedMattingResult.data?.agentIntentControlPlane?.toolScope === 'none'
        && pausedMattingResult.data?.agentRequestLifecycle?.decision?.skillId === 'matte-product'
        && pausedMattingResult.data?.agentRequestLifecycle?.execution?.kind === 'none'
          ? 'pass'
          : 'fail',
      details: JSON.stringify({ callModelCount, executed, pausedMattingResult })
    });

    callModelCount = 0;
    executed = [];
    await engine.run(createContext('好像没有改成功 再改一下', {
      conversationHistory: [
        { role: 'user', content: '帮我把字体全部改成思源黑体' },
        { role: 'assistant', content: '已尝试修改字体。' }
      ]
    }), {
      callModel: async () => {
        callModelCount += 1;
        return {
          text: JSON.stringify({
            route: 'skill_execution',
            skillId: 'agent-panel-bridge',
            thinking: '错误地当成调试桥接。',
            skillParams: { intent: 'debug_or_implement' }
          })
        };
      }
    });

    cases.push({
      name: 'retry-feedback-continues-previous-action-not-debug-bridge',
      status:
        callModelCount === 0
        && executed.length === 1
        && executed[0].skillId === 'text-font-replace'
        && executed[0].params?.retry === true
        && executed[0].params?.retryFeedback === '好像没有改成功 再改一下'
        && executed[0].params?.previousUserIntent === '帮我把字体全部改成思源黑体'
          ? 'pass'
          : 'fail',
      details: JSON.stringify({ callModelCount, executed })
    });

    callModelCount = 0;
    executed = [];
    await engine.run(createContext('帮我关闭文档'), {
      callModel: async () => {
        callModelCount += 1;
        return { text: '{}' };
      }
    });

    cases.push({
      name: 'deterministic-close-without-save-does-not-flip-to-save-true',
      status:
        callModelCount === 0
        && executed.length === 1
        && executed[0].skillId === 'document-management'
        && executed[0].params?.action === 'close'
        && executed[0].params?.save !== true
          ? 'pass'
          : 'fail',
      details: JSON.stringify({ callModelCount, executed })
    });

    callModelCount = 0;
    executed = [];
    await engine.run(createContext('我想你理解一下项目中的图片'), {
      callModel: async () => {
        callModelCount += 1;
        return { text: '{}' };
      }
    });

    cases.push({
      name: 'local-route-still-handles-project-image-analysis',
      status:
        callModelCount === 1
        && executed.length === 1
        && executed[0].skillId === 'project-image-analysis'
        && executed[0].params?.focus === 'style-and-detail-page'
        && executed[0].params?.sampleSize === 6
          ? 'pass'
          : 'fail',
      details: JSON.stringify({ callModelCount, executed })
    });

    callModelCount = 0;
    executed = [];
    const projectIdentityConversationResult = await engine.run(createContext('帮我看看当前是个什么项目'), {
      callModel: async (_messages, options = {}) => {
        callModelCount += 1;
        if (options.purpose === 'direct_response_repair') {
          return { text: '当前项目是 test-project，我会基于当前项目上下文回答；这不是要求分析项目图片。' };
        }
        return { text: '当前项目是 test-project。你只是问项目身份，我先直接回答，不会执行项目图片分析工具。' };
      }
    });

    cases.push({
      name: 'engine-routes-project-identity-question-to-readonly-metadata',
      status:
        callModelCount === 0
        && executed.length === 1
        && executed[0].skillId === 'project-image-analysis'
        && executed[0].params?.analysisMode === 'inventory'
        && executed[0].params?.sampleSize === 0
        && projectIdentityConversationResult?.success === true
        && projectIdentityConversationResult?.data?.agentIntentControlPlane?.requestKind === 'read_only_inspect'
        && projectIdentityConversationResult?.data?.agentIntentControlPlane?.toolScope === 'read_only'
        && projectIdentityConversationResult?.data?.agentRequestLifecycle?.decision?.source === 'deterministic_route'
        && projectIdentityConversationResult?.data?.agentRequestLifecycle?.decision?.route === 'skill_execution'
        && projectIdentityConversationResult?.data?.agentRequestLifecycle?.decision?.skillId === 'project-image-analysis'
        && projectIdentityConversationResult?.data?.agentRequestLifecycle?.execution?.kind === 'deterministic_skill'
          ? 'pass'
          : 'fail',
      details: JSON.stringify({ callModelCount, executed, result: projectIdentityConversationResult })
    });

    callModelCount = 0;
    executed = [];
    const readOnlyProjectOverviewDirectResponseDriftResult = await engine.run(createContext('当前是什么项目'), {
      callModel: async (_messages, options = {}) => {
        callModelCount += 1;
        if (options.purpose === 'visible_reasoning') {
          return { text: '' };
        }
        return {
          text: JSON.stringify({
            route: 'direct_response',
            directResponse: '这是一个项目咨询问题，不需要查看项目文件。'
          })
        };
      }
    });

    cases.push({
      name: 'project-identity-router-direct-response-drift-is-overridden-by-readonly-metadata',
      status:
        callModelCount === 0
        && readOnlyProjectOverviewDirectResponseDriftResult.success === true
        && executed.length === 1
        && executed[0].skillId === 'project-image-analysis'
        && executed[0].params?.analysisMode === 'inventory'
        && readOnlyProjectOverviewDirectResponseDriftResult.data?.agentIntentControlPlane?.requestKind === 'read_only_inspect'
        && readOnlyProjectOverviewDirectResponseDriftResult.data?.agentRequestLifecycle?.decision?.route === 'skill_execution'
        && readOnlyProjectOverviewDirectResponseDriftResult.data?.agentRequestLifecycle?.decision?.skillId === 'project-image-analysis'
        && readOnlyProjectOverviewDirectResponseDriftResult.data?.agentRequestLifecycle?.execution?.kind === 'deterministic_skill'
          ? 'pass'
          : 'fail',
      details: JSON.stringify({
        callModelCount,
        executed,
        result: {
          success: readOnlyProjectOverviewDirectResponseDriftResult.success,
          error: readOnlyProjectOverviewDirectResponseDriftResult.error,
          message: readOnlyProjectOverviewDirectResponseDriftResult.message,
          lifecycle: readOnlyProjectOverviewDirectResponseDriftResult.data?.agentRequestLifecycle
        }
      })
    });

    callModelCount = 0;
    executed = [];
    const genericProjectAnalysisWithoutDocumentResult = await engine.run(createContext('帮我分析一下项目', {
      photoshopContext: {
        hasDocument: false,
        documentName: undefined,
        activeLayerName: undefined,
        layerCount: 0
      }
    }), {
      callModel: async (_messages, options = {}) => {
        callModelCount += 1;
        if (options.purpose === 'visible_reasoning') return { text: '' };
        return {
          text: JSON.stringify({
            route: 'direct_response',
            directResponse: '错误地把项目分析当成普通聊天。'
          })
        };
      }
    });

    cases.push({
      name: 'generic-project-analysis-with-project-and-no-document-uses-project-images',
      status:
        genericProjectAnalysisWithoutDocumentResult.success === true
        && executed.length === 1
        && executed[0].skillId === 'project-image-analysis'
        && executed[0].params?.userIntent === '帮我分析一下项目'
        && genericProjectAnalysisWithoutDocumentResult.data?.agentRequestLifecycle?.execution?.requiresPhotoshop === false
        && genericProjectAnalysisWithoutDocumentResult.data?.agentRequestLifecycle?.execution?.canStart === true
        && genericProjectAnalysisWithoutDocumentResult.data?.agentRequestLifecycle?.decision?.skillId === 'project-image-analysis'
          ? 'pass'
          : 'fail',
      details: JSON.stringify({
        callModelCount,
        executed,
        result: genericProjectAnalysisWithoutDocumentResult
      })
    });

    callModelCount = 0;
    executed = [];
    const readOnlyProjectOverviewClarificationDriftResult = await engine.run(createContext('帮我看看当前项目图片是什么款式'), {
      callModel: async (_messages, options = {}) => {
        callModelCount += 1;
        if (options.purpose === 'visible_reasoning') {
          return { text: '' };
        }
        return {
          text: JSON.stringify({
            route: 'clarification_needed',
            clarificationQuestion: '请先说明要处理哪个图层或画面。'
          })
        };
      }
    });

    cases.push({
      name: 'readonly-project-analysis-overrides-model-clarification-drift',
      status:
        callModelCount >= 1
        && readOnlyProjectOverviewClarificationDriftResult.success === true
        && executed.length === 1
        && executed[0].skillId === 'project-image-analysis'
        && readOnlyProjectOverviewClarificationDriftResult.data?.agentIntentControlPlane?.requestKind === 'read_only_inspect'
        && readOnlyProjectOverviewClarificationDriftResult.data?.agentRequestLifecycle?.decision?.source === 'deterministic_route'
        && readOnlyProjectOverviewClarificationDriftResult.data?.agentRequestLifecycle?.decision?.route === 'skill_execution'
          ? 'pass'
          : 'fail',
      details: JSON.stringify({
        callModelCount,
        executed,
        result: {
          success: readOnlyProjectOverviewClarificationDriftResult.success,
          error: readOnlyProjectOverviewClarificationDriftResult.error,
          message: readOnlyProjectOverviewClarificationDriftResult.message,
          lifecycle: readOnlyProjectOverviewClarificationDriftResult.data?.agentRequestLifecycle
        }
      })
    });

    callModelCount = 0;
    executed = [];
    const readOnlyCanvasIssueDirectResponseDriftResult = await engine.run(createContext('检查一下画面问题'), {
      callModel: async (_messages, options = {}) => {
        callModelCount += 1;
        if (options.purpose === 'visible_reasoning') {
          return { text: '' };
        }
        return {
          text: JSON.stringify({
            route: 'direct_response',
            directResponse: '这是一个咨询问题，不需要读取当前画面。'
          })
        };
      }
    });

    cases.push({
      name: 'readonly-canvas-inspection-overrides-model-direct-response-drift',
      status:
        callModelCount >= 1
        && readOnlyCanvasIssueDirectResponseDriftResult.success === true
        && executed.length === 1
        && executed[0].skillId === 'visual-analysis'
        && readOnlyCanvasIssueDirectResponseDriftResult.data?.agentIntentControlPlane?.requestKind === 'read_only_inspect'
        && readOnlyCanvasIssueDirectResponseDriftResult.data?.agentRequestLifecycle?.decision?.source === 'deterministic_route'
        && readOnlyCanvasIssueDirectResponseDriftResult.data?.agentRequestLifecycle?.decision?.route === 'skill_execution'
          ? 'pass'
          : 'fail',
      details: JSON.stringify({
        callModelCount,
        executed,
        result: {
          success: readOnlyCanvasIssueDirectResponseDriftResult.success,
          error: readOnlyCanvasIssueDirectResponseDriftResult.error,
          message: readOnlyCanvasIssueDirectResponseDriftResult.message,
          controlPlane: readOnlyCanvasIssueDirectResponseDriftResult.data?.agentIntentControlPlane,
          lifecycle: readOnlyCanvasIssueDirectResponseDriftResult.data?.agentRequestLifecycle
        }
      })
    });

    callModelCount = 0;
    executed = [];
    const canvasInspectionWithoutDocumentResult = await engine.run(createContext('检查一下画面问题', {
      photoshopContext: {
        hasDocument: false,
        documentName: undefined,
        activeLayerName: undefined,
        layerCount: 0
      }
    }), {
      callModel: async (_messages, options = {}) => {
        callModelCount += 1;
        if (options.purpose === 'visible_reasoning') return { text: '' };
        return { text: '{}' };
      }
    });

    cases.push({
      name: 'readonly-canvas-inspection-without-document-blocks-before-snapshot-skill',
      status:
        canvasInspectionWithoutDocumentResult.success === false
        && executed.length === 0
        && canvasInspectionWithoutDocumentResult.error === 'blocked_missing_document'
        && String(canvasInspectionWithoutDocumentResult.message || '').includes('打开要处理的 Photoshop 文档')
        && canvasInspectionWithoutDocumentResult.data?.agentRequestLifecycle?.execution?.canStart === false
          ? 'pass'
          : 'fail',
      details: JSON.stringify({
        callModelCount,
        executed,
        result: canvasInspectionWithoutDocumentResult
      })
    });

    callModelCount = 0;
    executed = [];
    const attachedImageUnderstandingResult = await engine.run(createContext('理解一下图片', {
      isPluginConnected: false,
      photoshopContext: {
        hasDocument: false,
        documentName: undefined,
        activeLayerName: undefined,
        layerCount: 0
      },
      hasAttachedImage: true,
      attachedImages: [{
        id: 'chat-upload-1',
        data: 'base64-attached-image',
        mediaType: 'image/jpeg',
        source: 'chat-upload',
        createdAt: 1,
        name: '用户上传图片.jpg'
      }]
    }), {
      callModel: async (_messages, options = {}) => {
        callModelCount += 1;
        if (options.purpose === 'visible_reasoning') return { text: '' };
        return {
          text: JSON.stringify({
            route: 'direct_response',
            directResponse: '错误地忽略用户已经上传的图片。'
          })
        };
      }
    });

    cases.push({
      name: 'attached-image-understanding-prefers-chat-attachment-over-photoshop-canvas',
      status:
        attachedImageUnderstandingResult.success === true
        && executed.length === 1
        && executed[0].skillId === 'visual-analysis'
        && executed[0].params?.sourceType === 'attached_image'
        && attachedImageUnderstandingResult.data?.agentIntentControlPlane?.requestKind === 'read_only_inspect'
        && attachedImageUnderstandingResult.data?.agentRequestLifecycle?.decision?.source === 'deterministic_route'
        && attachedImageUnderstandingResult.data?.agentRequestLifecycle?.execution?.requiresPhotoshop === false
        && attachedImageUnderstandingResult.data?.agentRequestLifecycle?.execution?.canStart === true
        && attachedImageUnderstandingResult.data?.agentRequestLifecycle?.blockers?.length === 0
          ? 'pass'
          : 'fail',
      details: JSON.stringify({
        callModelCount,
        executed,
        result: {
          success: attachedImageUnderstandingResult.success,
          error: attachedImageUnderstandingResult.error,
          message: attachedImageUnderstandingResult.message,
          controlPlane: attachedImageUnderstandingResult.data?.agentIntentControlPlane,
          lifecycle: attachedImageUnderstandingResult.data?.agentRequestLifecycle
        }
      })
    });

    callModelCount = 0;
    executed = [];
    const layerImageVisualAnalysisResult = await engine.run(createContext('帮我看看图层 2026-05-10 090013 这张图片里面是什么内容，只读取分析不要修改画面'), {
      callModel: async (_messages, options = {}) => {
        callModelCount += 1;
        if (options.purpose === 'visible_reasoning') {
          return { text: '' };
        }
        return {
          text: JSON.stringify({
            route: 'direct_response',
            directResponse: '这是普通咨询，不需要读取 Photoshop 图层。'
          })
        };
      }
    });

    cases.push({
      name: 'layer-image-content-analysis-routes-to-visual-analysis-layer-source',
      status:
        layerImageVisualAnalysisResult.success === true
        && executed.length === 1
        && executed[0].skillId === 'visual-analysis'
        && executed[0].params?.sourceType === 'layer'
        && executed[0].params?.layerName === '2026-05-10 090013'
        && executed[0].params?.analysisFocus === 'elements'
        && layerImageVisualAnalysisResult.data?.agentIntentControlPlane?.requestKind === 'read_only_inspect'
        && layerImageVisualAnalysisResult.data?.agentRequestLifecycle?.decision?.source === 'deterministic_route'
        && layerImageVisualAnalysisResult.data?.agentRequestLifecycle?.decision?.route === 'skill_execution'
          ? 'pass'
          : 'fail',
      details: JSON.stringify({
        callModelCount,
        executed,
        result: {
          success: layerImageVisualAnalysisResult.success,
          error: layerImageVisualAnalysisResult.error,
          message: layerImageVisualAnalysisResult.message,
          controlPlane: layerImageVisualAnalysisResult.data?.agentIntentControlPlane,
          lifecycle: layerImageVisualAnalysisResult.data?.agentRequestLifecycle
        }
      })
    });

    callModelCount = 0;
    executed = [];
    const saveTemplateDirectResponseDriftResult = await engine.run(createContext('帮我把当前文档保存为模板'), {
      callModel: async (_messages, options = {}) => {
        callModelCount += 1;
        if (options.purpose === 'visible_reasoning') {
          return { text: '' };
        }
        return {
          text: JSON.stringify({
            route: 'direct_response',
            directResponse: '这是模板能力咨询，不需要执行保存。'
          })
        };
      }
    });

    cases.push({
      name: 'save-current-template-overrides-model-direct-response-drift',
      status:
        callModelCount >= 1
        && saveTemplateDirectResponseDriftResult.success === true
        && executed.length === 1
        && executed[0].skillId === 'save-current-template'
        && saveTemplateDirectResponseDriftResult.data?.agentRequestLifecycle?.decision?.source === 'deterministic_route'
        && saveTemplateDirectResponseDriftResult.data?.agentRequestLifecycle?.decision?.route === 'skill_execution'
          ? 'pass'
          : 'fail',
      details: JSON.stringify({
        callModelCount,
        executed,
        result: {
          success: saveTemplateDirectResponseDriftResult.success,
          error: saveTemplateDirectResponseDriftResult.error,
          message: saveTemplateDirectResponseDriftResult.message,
          lifecycle: saveTemplateDirectResponseDriftResult.data?.agentRequestLifecycle
        }
      })
    });

    callModelCount = 0;
    executed = [];
    const readOnlyProjectInventoryResult = await engine.run(createContext('你可以帮我看看这个项目都有什么'), {
      callModel: async () => {
        callModelCount += 1;
        return {
          text: JSON.stringify({
            route: 'autonomous_agent',
            thinking: '错误地把项目资源清单当成自主工具循环。'
          })
        };
      }
    });

    cases.push({
      name: 'engine-resource-decision-keeps-project-inventory-metadata-only',
      status:
        callModelCount === 0
        && executed.length === 1
        && executed[0].skillId === 'project-image-analysis'
        && executed[0].params?.analysisMode === 'inventory'
        && executed[0].params?.sampleSize === 0
        && readOnlyProjectInventoryResult?.data?.agentRequestLifecycle?.performancePolicy?.taskClass === 'project-inventory'
        && readOnlyProjectInventoryResult?.data?.agentRequestLifecycle?.resourceDecision?.path === 'metadata-only'
          ? 'pass'
          : 'fail',
      details: JSON.stringify({ callModelCount, executed, result: readOnlyProjectInventoryResult })
    });

    callModelCount = 0;
    executed = [];
    const readOnlyProjectInventorySameSkillDriftResult = await engine.run(createContext('你可以帮我看看这个项目都有什么'), {
      callModel: async () => {
        callModelCount += 1;
        return {
          text: JSON.stringify({
            route: 'skill_execution',
            skillId: 'project-image-analysis',
            skillParams: {
              analysisMode: 'content',
              sampleSize: 5,
              focus: 'style-and-detail-page'
            },
            thinking: '错误地把项目资源清单当成视觉分析任务。'
          })
        };
      }
    });

    cases.push({
      name: 'engine-project-inventory-overrides-same-skill-visual-param-drift',
      status:
        callModelCount === 0
        && executed.length === 1
        && executed[0].skillId === 'project-image-analysis'
        && executed[0].params?.analysisMode === 'inventory'
        && executed[0].params?.sampleSize === 0
        && executed[0].params?.focus === 'inventory'
        && readOnlyProjectInventorySameSkillDriftResult?.data?.agentRequestLifecycle?.performancePolicy?.taskClass === 'project-inventory'
        && readOnlyProjectInventorySameSkillDriftResult?.data?.agentRequestLifecycle?.resourceDecision?.path === 'metadata-only'
          ? 'pass'
          : 'fail',
      details: JSON.stringify({ callModelCount, executed, result: readOnlyProjectInventorySameSkillDriftResult })
    });

    callModelCount = 0;
    executed = [];
    const planOnlyAutonomousHijackResult = await engine.run(createContext('看看我们是否可以开始做主图详情页了'), {
      callModel: async (messages) => {
        callModelCount += 1;
        const systemPrompt = String(messages?.[0]?.content || '');
        if (systemPrompt.includes('intent router')) {
          return {
            text: JSON.stringify({
              route: 'autonomous_agent',
              skillId: 'detail-page-design',
              thinking: '错误地把阶段准备度讨论当成详情页执行。'
            })
          };
        }
        return { text: '可以开始讨论主图和详情页，但需要先确认剩余缺口，不会直接执行工具。' };
      }
    });

    cases.push({
      name: 'engine-control-plane-blocks-plan-question-tool-hijack',
      status:
        callModelCount === 1
        && executed.length === 0
        && planOnlyAutonomousHijackResult?.success === true
        && planOnlyAutonomousHijackResult?.data?.agentIntentControlPlane?.requestKind === 'plan_only'
        && planOnlyAutonomousHijackResult?.data?.agentIntentControlPlane?.toolScope === 'none'
        && planOnlyAutonomousHijackResult?.data?.agentRequestLifecycle?.decision?.source === 'intent_control_plane'
        && planOnlyAutonomousHijackResult?.data?.agentRequestLifecycle?.execution?.kind === 'none'
          ? 'pass'
          : 'fail',
      details: JSON.stringify({ callModelCount, executed, result: planOnlyAutonomousHijackResult })
    });

    callModelCount = 0;
    executed = [];
    const ambiguousNoModelResult = await engine.run(createContext('帮我处理一下'), {});

    cases.push({
      name: 'engine-control-plane-routes-ambiguous-request-to-autonomous-gate-without-model-or-tools',
      status:
        callModelCount === 0
        && executed.length === 0
        && ambiguousNoModelResult?.success === false
        && String(ambiguousNoModelResult?.message || '').includes(MODEL_UNAVAILABLE_COPY)
        && !String(ambiguousNoModelResult?.message || '').includes('现在没能生成有效回复')
        && !String(ambiguousNoModelResult?.message || '').includes('没有收到模型回复')
        && !String(ambiguousNoModelResult?.message || '').includes('Photoshop')
        && !String(ambiguousNoModelResult?.message || '').includes('还缺少一个会影响结果的关键信息')
        && ambiguousNoModelResult?.assistantReplyOrigin?.userVisibleKind === 'status_notice'
        && ambiguousNoModelResult?.assistantReplyOrigin?.origin === 'ui_status'
        && ambiguousNoModelResult?.data?.agentIntentControlPlane?.requestKind === 'autonomous_execution'
        && ambiguousNoModelResult?.data?.agentRequestLifecycle?.decision?.route === 'autonomous_agent'
        && ambiguousNoModelResult?.data?.agentRequestLifecycle?.execution?.kind === 'none'
          ? 'pass'
          : 'fail',
      details: JSON.stringify({ callModelCount, executed, result: ambiguousNoModelResult })
    });

    callModelCount = 0;
    executed = [];
    let clarificationFollowupPromptSeen = false;
    const clarificationFollowupResult = await engine.run(createContext('比如呢', {
      conversationHistory: [
        { role: 'user', content: '帮我处理一下' },
        { role: 'assistant', content: '还缺少一个会影响结果的关键信息，我先不改动画面。' }
      ]
    }), {
      callModel: async (messages) => {
        callModelCount += 1;
        const systemPrompt = String(messages?.[0]?.content || '');
        const serializedMessages = JSON.stringify(messages);
        clarificationFollowupPromptSeen = clarificationFollowupPromptSeen
          || (
            systemPrompt.includes('上一轮澄清')
            && systemPrompt.includes('不要用固定的工具禁用话术代替解释')
            && serializedMessages.includes('还缺少一个会影响结果的关键信息')
          );
        return { text: '模型生成的澄清追问回答：请补目标对象、动作边界和交付范围，并给出贴合上一轮任务的表达样例。' };
      }
    });

    cases.push({
      name: 'engine-clarification-followup-consults-model-with-recent-context-without-tools',
      status:
        callModelCount === 1
        && executed.length === 0
        && clarificationFollowupResult?.success === true
        && clarificationFollowupPromptSeen
        && String(clarificationFollowupResult?.message || '').includes('模型生成的澄清追问回答')
        && !String(clarificationFollowupResult?.message || '').includes('这是对话问题')
        && clarificationFollowupResult?.data?.agentIntentControlPlane?.requestKind === 'chat_only'
        && clarificationFollowupResult?.data?.agentRequestLifecycle?.decision?.route === 'direct_response'
        && clarificationFollowupResult?.data?.agentRequestLifecycle?.execution?.kind === 'none'
          ? 'pass'
          : 'fail',
      details: JSON.stringify({ callModelCount, executed, clarificationFollowupPromptSeen, result: clarificationFollowupResult })
    });

    callModelCount = 0;
    executed = [];
    const clarificationFollowupNoModelResult = await engine.run(createContext('比如呢', {
      conversationHistory: [
        { role: 'user', content: '帮我处理一下' },
        { role: 'assistant', content: '还缺少一个会影响结果的关键信息，我先不改动画面。' }
      ]
    }), {});

    cases.push({
      name: 'engine-clarification-followup-without-model-does-not-replay-fixed-clarification',
      status:
        callModelCount === 0
        && executed.length === 0
        && clarificationFollowupNoModelResult?.success === false
        && String(clarificationFollowupNoModelResult?.message || '').includes(MODEL_UNAVAILABLE_COPY)
        && !String(clarificationFollowupNoModelResult?.message || '').includes('现在没能生成有效回复')
        && !String(clarificationFollowupNoModelResult?.message || '').includes('没有收到模型回复')
        && !String(clarificationFollowupNoModelResult?.message || '').includes('Photoshop')
        && !String(clarificationFollowupNoModelResult?.message || '').includes('还缺少一个会影响结果的关键信息')
        && clarificationFollowupNoModelResult?.assistantReplyOrigin?.userVisibleKind === 'status_notice'
        && clarificationFollowupNoModelResult?.assistantReplyOrigin?.origin === 'ui_status'
        && clarificationFollowupNoModelResult?.data?.agentRequestLifecycle?.decision?.route === 'direct_response'
        && clarificationFollowupNoModelResult?.data?.agentRequestLifecycle?.execution?.kind === 'none'
          ? 'pass'
          : 'fail',
      details: JSON.stringify({ callModelCount, executed, result: clarificationFollowupNoModelResult })
    });

    callModelCount = 0;
    executed = [];
    const ambiguousUnauthorizedModelPurposes = [];
    const ambiguousUnauthorizedAutonomousResult = await engine.run(createContext('帮我处理一下'), {
      callModel: async (_messages, requestOptions) => {
        callModelCount += 1;
        ambiguousUnauthorizedModelPurposes.push(requestOptions?.purpose || 'unknown');
        return {
          text: JSON.stringify({
            route: 'autonomous_agent',
            thinking: '信息不足但错误地准备工具循环。'
          })
        };
      }
    });

    cases.push({
      name: 'engine-control-plane-keeps-ambiguous-autonomous-planning-in-the-same-loop',
      status:
        callModelCount === 1
        && ambiguousUnauthorizedModelPurposes.includes('router')
        && !ambiguousUnauthorizedModelPurposes.includes('agent_task_public_plan')
        && executed.length === 1
        && executed[0]?.skillId === 'autonomous-agent'
        && ambiguousUnauthorizedAutonomousResult?.success === true
        && ambiguousUnauthorizedAutonomousResult?.data?.agentIntentControlPlane?.requestKind === 'autonomous_execution'
        && ambiguousUnauthorizedAutonomousResult?.data?.agentIntentControlPlane?.toolScope === 'write_photoshop'
        && ambiguousUnauthorizedAutonomousResult?.data?.agentRequestLifecycle?.decision?.route === 'autonomous_agent'
        && ambiguousUnauthorizedAutonomousResult?.data?.agentTaskPlan?.status === 'ready_for_model_planning'
        && ambiguousUnauthorizedAutonomousResult?.data?.agentTaskPlan?.executionPlan?.requiresUserApproval === false
        && ambiguousUnauthorizedAutonomousResult?.data?.agentTaskPlan?.executionPlan?.canExecuteTools === false
          ? 'pass'
          : 'fail',
      details: JSON.stringify({ callModelCount, ambiguousUnauthorizedModelPurposes, executed, result: ambiguousUnauthorizedAutonomousResult })
    });

    callModelCount = 0;
    executed = [];
    const resourceGroundedClarificationDriftResult = await engine.run(createContext('帮我打开CSV模板替换图标素材'), {
      callModel: async (_messages, requestOptions = {}) => {
        callModelCount += 1;
        if (requestOptions?.purpose === 'router') {
          return {
            text: JSON.stringify({
              route: 'clarification_needed',
              clarificationQuestion: '这个 CSV 模板在哪个位置？请告诉我文件名或路径。',
              thinking: '错误地要求用户先提供项目内文件位置。'
            })
          };
        }
        return { text: '' };
      }
    });

    cases.push({
      name: 'engine-resource-grounded-task-enters-autonomous-runtime-instead-of-file-location-clarification',
      status:
        callModelCount === 1
        && executed.length === 1
        && executed[0]?.skillId === 'autonomous-agent'
        && resourceGroundedClarificationDriftResult?.success === true
        && resourceGroundedClarificationDriftResult?.data?.agentIntentControlPlane?.requestKind === 'autonomous_execution'
        && resourceGroundedClarificationDriftResult?.data?.agentRequestLifecycle?.decision?.route === 'autonomous_agent'
        && resourceGroundedClarificationDriftResult?.data?.agentRequestLifecycle?.decision?.source === 'intent_control_plane'
        && resourceGroundedClarificationDriftResult?.data?.agentRequestLifecycle?.execution?.kind === 'autonomous_agent'
        && String(resourceGroundedClarificationDriftResult?.data?.agentRequestLifecycle?.decision?.reason || '').includes('控制面已确认执行授权')
        && resourceGroundedClarificationDriftResult?.data?.agentTaskPlan?.status === 'ready_for_tool_execution'
        && resourceGroundedClarificationDriftResult?.data?.agentTaskPlan?.userVisibleState?.category === 'tool_execution'
        && !String(resourceGroundedClarificationDriftResult?.message || '').includes('CSV 模板在哪')
        && !String(resourceGroundedClarificationDriftResult?.message || '').includes('请告诉我文件名')
          ? 'pass'
          : 'fail',
      details: JSON.stringify({ callModelCount, executed, result: resourceGroundedClarificationDriftResult })
    });

    callModelCount = 0;
    executed = [];
    const readOnlyInspectResult = await engine.run(createContext('当前文档一共有几个图层？'), {
      callModel: async () => {
        callModelCount += 1;
        return {
          text: JSON.stringify({
            route: 'autonomous_agent',
            thinking: '错误地把只读问题当成自主工具循环。'
          })
        };
      }
    });

    cases.push({
      name: 'engine-control-plane-keeps-readonly-inspection-on-deterministic-skill',
      status:
        callModelCount === 0
        && executed.length === 1
        && executed[0].skillId === 'layer-management'
        && executed[0].params?.action === 'inspect'
        && readOnlyInspectResult?.data?.agentIntentControlPlane?.requestKind === 'read_only_inspect'
        && readOnlyInspectResult?.data?.agentIntentControlPlane?.toolScope === 'read_only'
        && readOnlyInspectResult?.data?.agentRequestLifecycle?.decision?.source === 'deterministic_route'
          ? 'pass'
          : 'fail',
      details: JSON.stringify({ callModelCount, executed, result: readOnlyInspectResult })
    });

    callModelCount = 0;
    executed = [];
    const mainImageConversionResult = await engine.run(createContext('帮我做转化图 在Adobe Photoshop文档中有800文档'), {
      callModel: async () => {
        callModelCount += 1;
        return {
          text: JSON.stringify({
            route: 'skill_execution',
            skillId: 'main-image-design',
            thinking: '用户明确要做转化图，并指出当前 Photoshop 中有 800 文档，应进入主图业务技能。',
            skillParams: {
              size: '800',
              imageType: 'conversion'
            }
          })
        };
      }
    });

    // 治理审计(2026-07-01)阶段3a：main-image-design 补齐 controlledRouteEntry 后，
    // 有明确执行授权的转化图请求不再被判为 execute_skill 直执固定流水线，而是统一走
    // autonomous_execution 进 autonomous-agent 自主循环（main-image-design 作为循环内可选
    // 技能提示随 skillId 参数带入）。这里保留的不变量是原测试名所指："不落入泛化反问"——
    // 无论落到 execute_skill 还是 autonomous_execution，都不应该卡在 generic clarification。
    cases.push({
      name: 'engine-routes-main-image-conversion-request-without-generic-clarification',
      status:
        callModelCount >= 1
        && executed.length === 1
        && executed[0].skillId === 'autonomous-agent'
        && executed[0].params?.skillId === 'main-image-design'
        && mainImageConversionResult?.data?.agentIntentControlPlane?.requestKind === 'autonomous_execution'
        && mainImageConversionResult?.data?.agentIntentControlPlane?.requiresClarificationBeforeTools === false
        && mainImageConversionResult?.data?.agentIntentControlPlane?.matchedSignals?.includes('shared_skill_routing:main-image-design')
        && mainImageConversionResult?.data?.agentRequestLifecycle?.decision?.route === 'autonomous_agent'
        && mainImageConversionResult?.data?.agentRequestLifecycle?.decision?.skillId === 'autonomous-agent'
          ? 'pass'
          : 'fail',
      details: JSON.stringify({ callModelCount, executed, result: mainImageConversionResult })
    });

    callModelCount = 0;
    executed = [];
    const lifecycleCloseResult = await engine.run(createContext('帮我关闭文档不保存'), {
      callModel: async () => {
        callModelCount += 1;
        return { text: '{}' };
      }
    });
    const closeLifecycle = lifecycleCloseResult.data?.agentRequestLifecycle;

    cases.push({
      name: 'request-lifecycle-records-deterministic-document-route',
      status:
        callModelCount === 0
        && closeLifecycle?.version === 'agent-request-lifecycle/v0'
        && closeLifecycle?.decision?.source === 'deterministic_route'
        && closeLifecycle?.decision?.route === 'skill_execution'
        && closeLifecycle?.decision?.skillId === 'document-management'
        && closeLifecycle?.execution?.kind === 'deterministic_skill'
        && closeLifecycle?.execution?.requiresPhotoshop === true
          ? 'pass'
          : 'fail',
      details: JSON.stringify({ callModelCount, lifecycle: closeLifecycle })
    });

    callModelCount = 0;
    executed = [];
    const lifecycleSaveResult = await engine.run(createContext('帮我把详情页文档保存到项目的PSD中'), {
      callModel: async () => {
        callModelCount += 1;
        return {
          text: JSON.stringify({
            route: 'skill_execution',
            skillId: 'detail-page-design',
            thinking: '错误地当成详情页执行。',
            skillParams: { mode: 'execute' }
          })
        };
      }
    });
    const saveLifecycle = lifecycleSaveResult.data?.agentRequestLifecycle;

    cases.push({
      name: 'request-lifecycle-keeps-save-request-on-document-management',
      status:
        executed.length === 1
        && executed[0].skillId === 'document-management'
        && executed[0].params?.action === 'save'
        && saveLifecycle?.decision?.source === 'deterministic_route'
        && saveLifecycle?.decision?.skillId === 'document-management'
        && saveLifecycle?.decision?.route === 'skill_execution'
          ? 'pass'
          : 'fail',
      details: JSON.stringify({ callModelCount, executed, lifecycle: saveLifecycle })
    });

    callModelCount = 0;
    executed = [];
    const lifecycleAutonomousModelPurposes = [];
    const lifecycleAutonomousResult = await engine.run(createContext('帮我根据当前画面做一个更高级的设计'), {
      callModel: async (_messages, requestOptions) => {
        callModelCount += 1;
        lifecycleAutonomousModelPurposes.push(requestOptions?.purpose || 'unknown');
        if (requestOptions?.purpose !== 'router') {
          return { text: '' };
        }
        return {
          text: JSON.stringify({
            route: 'autonomous_agent',
            intentSummary: '用户需要开放式设计执行，需要工具循环探索当前画面。',
            skillParams: { styleGoal: '更高级' }
          })
        };
      }
    });
    const autonomousLifecycle = lifecycleAutonomousResult.data?.agentRequestLifecycle;
    const autonomousPlanningMessage = String(lifecycleAutonomousResult?.message || '');
    const autonomousVisiblePlanningLeaks = [
      '公开的设计计划',
      '公开设计计划',
      '操作边界',
      '检查标准',
      '暂不进入 Photoshop',
      'agent_task_plan_requires_model_planning'
    ].filter((phrase) => autonomousPlanningMessage.includes(phrase));

    cases.push({
      name: 'request-lifecycle-records-model-autonomous-route',
      status:
        callModelCount === 1
        && sameJson(lifecycleAutonomousModelPurposes, ['router'])
        && executed.length === 1
        && executed[0]?.skillId === 'autonomous-agent'
        && lifecycleAutonomousResult?.success === true
        && autonomousLifecycle?.decision?.source === 'model_router'
        && autonomousLifecycle?.decision?.route === 'autonomous_agent'
        && autonomousLifecycle?.execution?.kind === 'autonomous_agent'
        && lifecycleAutonomousResult?.data?.agentTaskPlan?.status === 'ready_for_tool_execution'
        && autonomousVisiblePlanningLeaks.length === 0
        && autonomousPlanningMessage === 'executed:autonomous-agent'
        && lifecycleAutonomousResult?.assistantReplyOrigin?.userVisibleKind === 'tool_summary'
        && lifecycleAutonomousResult?.assistantReplyOrigin?.origin === 'tool_result_summary'
          ? 'pass'
          : 'fail',
      details: JSON.stringify({
        callModelCount,
        lifecycleAutonomousModelPurposes,
        executed,
        autonomousVisiblePlanningLeaks,
        autonomousPlanningMessage,
        lifecycle: autonomousLifecycle,
        result: lifecycleAutonomousResult
      })
    });
  } finally {
    skillExecutors.getSkillExecutor = originalGetSkillExecutor;
    skillExecutors.executeSkillWithExecutor = originalExecuteSkillWithExecutor;
  }

  const success = cases.every((item) => item.status === 'pass');
  const payload = { success, cases };
  const report = writeReport(payload);
  console.log(JSON.stringify({ ...payload, report }, null, 2));
  process.exit(success ? 0 : 1);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
