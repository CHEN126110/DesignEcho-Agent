const fs = require('fs');
const path = require('path');

require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '..', 'tsconfig.main.json')
});

const routing = require(path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'agent-orchestration', 'routing.ts'));
const skillExecutors = require(path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'skill-executors', 'index.ts'));
const { DesignAgentEngine } = require(path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'design-agent', 'engine.ts'));

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function createContext(userInput, overrides = {}) {
  const base = {
    userInput,
    conversationHistory: [],
    isPluginConnected: true,
    photoshopContext: {
      hasDocument: true,
      documentName: 'intent-boundary.psd',
      activeLayerName: '图层 1',
      layerCount: 8
    },
    projectContext: {
      projectPath: 'C:/DesignEcho/test-project',
      projectImageCount: 12,
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

function buildDesignPreflightDecision(sample) {
  const skillLabel = sample.expectedSkillId || 'business-design-skill';
  return {
    designGoal: sample.routerDecision?.intentSummary || `Prepare an auditable execution plan for ${skillLabel}.`,
    productUnderstanding: [
      'Use project assets as the source of truth before Photoshop writes.',
      'Keep SKU notes separate from color or specification combination generation.'
    ],
    audience: 'Taobao/Tmall ecommerce shoppers comparing product variants.',
    hierarchy: {
      primarySubject: 'project product assets and SKU variant relationships',
      focalPoint: 'clear correspondence between selected variants, notes, and exported artwork',
      informationPriority: ['product visual evidence', 'variant mapping', 'self-select note requirement', 'export verification'],
      whitespaceIntent: 'preserve enough spacing for readable SKU labels and notes',
      layoutNotes: ['do not infer new colors without project evidence', 'keep notes readable and tied to their variant scope']
    },
    color: {
      paletteIntent: 'follow verified project SKU colors and template contrast rules',
      primaryColors: ['project-sku-colors'],
      accentColors: ['neutral-labels'],
      backgroundDirection: 'preserve the current template or approved white-background direction',
      contrastPlan: 'keep text and product boundaries legible after export',
      avoid: ['do not invent color variants', 'do not use unverified palette changes']
    },
    typography: {
      tone: 'clear ecommerce production labeling',
      hierarchy: ['variant title', 'note text', 'export status'],
      fontDirection: 'use existing template typography unless the plan explicitly changes it',
      spacingDirection: 'avoid crowded SKU labels and note collisions',
      avoid: ['decorative type that weakens readability']
    },
    retouch: {
      objectives: ['preserve product material and color fidelity', 'avoid unnecessary retouching for SKU notes'],
      colorCorrection: 'only correct obvious template mismatch after visual evidence',
      lighting: 'preserve source lighting unless the selected workflow requires normalization',
      cleanup: ['remove no unintended product details'],
      fabricOrMaterialHandling: 'keep sock texture and color faithful to source images',
      prohibitedEdits: ['do not alter actual product color', 'do not synthesize missing SKU assets']
    },
    assetSelection: {
      selectionPrinciples: ['prefer project SKU PSD/PSB assets over currently open documents', 'verify color layer names before combining'],
      requiredEvidence: ['project asset index', 'SKU color layer list', 'target export requirements'],
      rejectRules: ['reject unrelated open Photoshop documents', 'reject assets without matching SKU evidence']
    },
    toolWorkflow: [
      { phase: 'inspect', goal: 'Read project assets and current execution context.', allowedToolKinds: ['project-read'], requiredEvidence: ['projectPath'] },
      { phase: 'analyze', goal: 'Confirm SKU color/specification mapping and note requirements.', allowedToolKinds: ['asset-inspection'], requiredEvidence: ['sku-layer-list'] },
      { phase: 'plan', goal: 'Build a single execution plan before Photoshop writes.', allowedToolKinds: ['planning'], requiredEvidence: ['combination-plan'] },
      { phase: 'compose', goal: 'Execute SKU artwork and notes according to the approved plan.', allowedToolKinds: ['photoshop-write'], requiredEvidence: ['designIntelligenceDecision'] },
      { phase: 'verify', goal: 'Check outputs and summarize partial failures clearly.', allowedToolKinds: ['readback'], requiredEvidence: ['result-status'] }
    ],
    acceptanceCriteria: [
      'SKU execution uses project SKU assets rather than unrelated open documents.',
      'Self-select notes are treated as note content, not as extra color combinations.',
      'The final result reports completed, partial, or failed status with actionable warnings.'
    ],
    risks: ['project SKU assets may be missing or layer names may not match expected variants'],
    rationale: ['business design skills require a model-visible plan before write tools run']
  };
}

function writeReport(payload) {
  const outDir = path.join(__dirname, '..', 'tmp');
  ensureDir(outDir);
  const jsonPath = path.join(outDir, 'agent-intent-boundary-matrix.json');
  const mdPath = path.join(outDir, 'agent-intent-boundary-matrix.md');

  fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2), 'utf8');

  const lines = [
    '# Agent Intent Boundary Matrix',
    '',
    `- success: ${payload.success}`,
    '',
    '| case | expected | status |',
    '| --- | --- | --- |'
  ];

  for (const item of payload.cases) {
    lines.push(`| ${item.name} | ${item.expected} | ${item.status} |`);
  }

  fs.writeFileSync(mdPath, lines.join('\n'), 'utf8');
  return { json: jsonPath, md: mdPath };
}

async function runDirectResponseCase(engine, sample, executed) {
  let callModelCount = 0;
  let conversationalPromptSeen = false;
  let routerPromptSeen = false;

  const result = await engine.run(createContext(sample.input, {
    conversationHistory: sample.history || []
  }), {
    callModel: async (messages) => {
      callModelCount += 1;
      const systemPrompt = String(messages?.[0]?.content || '');
      conversationalPromptSeen = conversationalPromptSeen || systemPrompt.includes('当前用户在进行对话咨询');
      routerPromptSeen = routerPromptSeen || systemPrompt.includes('intent router');
      return { text: sample.modelReply };
    }
  });
  const executedSnapshot = executed.map((item) => ({
    skillId: item.skillId,
    params: { ...item.params }
  }));

  return {
    ok:
      routing.detectLightweightIntent(sample.input) === sample.lightweightIntent
      && callModelCount === 1
      && executedSnapshot.length === 0
      && conversationalPromptSeen
      && !routerPromptSeen
      && result?.success === true
      && String(result?.message || '').includes(sample.expectedMessageIncludes),
    details: {
      lightweightIntent: routing.detectLightweightIntent(sample.input),
      callModelCount,
      executed: executedSnapshot,
      conversationalPromptSeen,
      routerPromptSeen,
      message: result?.message
    }
  };
}

async function runSkillCase(engine, sample) {
  let callModelCount = 0;
  const result = await engine.run(createContext(sample.input, sample.contextOverrides || {}), {
    callModel: async (_messages, options = {}) => {
      callModelCount += 1;
      if (options.purpose === 'visible_reasoning') {
        return { text: sample.visibleReasoning || `我先判断用户意图，再选择 ${sample.expectedSkillId}。` };
      }
      if (options.purpose === 'design_execution_preflight') {
        return { text: JSON.stringify(sample.designDecision || buildDesignPreflightDecision(sample)) };
      }
      return { text: JSON.stringify(sample.routerDecision) };
    }
  });

  const executedSnapshot = sample.executed.map((item) => ({
    skillId: item.skillId,
    params: { ...item.params }
  }));

  return {
    ok:
      callModelCount >= sample.expectedMinModelCalls
      && callModelCount <= sample.expectedMaxModelCalls
      && executedSnapshot.some((item) => item.skillId === sample.expectedSkillId)
      && result?.success === true,
    details: {
      callModelCount,
      executed: executedSnapshot,
      message: result?.message
    }
  };
}

async function runAutonomousBusinessWorkflowCase(engine, sample) {
  let callModelCount = 0;
  const steps = [];
  const result = await engine.run(createContext(sample.input, sample.contextOverrides || {}), {
    callModel: async (_messages, options = {}) => {
      callModelCount += 1;
      if (options.purpose === 'router') {
        return {
          text: JSON.stringify({
            route: 'direct_response',
            intentSummary: sample.intentSummary,
            directResponse: '这个请求需要进入 Agent ReAct 循环，不应由旧技能直达。'
          })
        };
      }
      return { text: '公开判断：先进入 ReAct，定位业务工作流桥并观察真实结果。' };
    },
    callbacks: {
      onStep: (step) => steps.push(step)
    }
  });

  const executedSnapshot = sample.executed.map((item) => ({
    skillId: item.skillId,
    params: { ...item.params }
  }));

  // 92007e36 起，明确业务交付（business_workflow_react_entry 等自决信号）直进循环，
  // Route14 播报「准备处理画面」而非公开计划阶段的「整理设计计划」。
  const expectedStepTitle = sample.expectedStepTitle || '准备处理画面';
  const stepTitles = steps.map((step) => String(step.title || ''));

  return {
    ok:
      callModelCount >= sample.expectedMinModelCalls
      && callModelCount <= sample.expectedMaxModelCalls
      && executedSnapshot.length === 1
      && executedSnapshot[0].skillId === 'autonomous-agent'
      && !executedSnapshot.some((item) => item.skillId === sample.forbiddenSkillId)
      && result?.success === true
      && result?.data?.agentRequestLifecycle?.decision?.route === 'autonomous_agent'
      && stepTitles.some((title) => title.includes(expectedStepTitle)),
    details: {
      callModelCount,
      executed: executedSnapshot,
      route: result?.data?.agentRequestLifecycle?.decision?.route,
      message: result?.message,
      expectedStepTitle,
      stepTitles
    }
  };
}

async function main() {
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
      message: `executed:${skillId}`,
      data: { status: 'completed' }
    };
  };

  const cases = [];

  try {
    const directSamples = [
      {
        name: 'task summary stays direct response',
        input: '回顾上次我们的任务 进行一个总结',
        lightweightIntent: 'task_summary',
        modelReply: '这是对上次任务的总结，不需要调用 Photoshop 工具。',
        expectedMessageIncludes: '上次任务'
      },
      {
        name: 'continuation stays contextual and model-first',
        input: '继续下一项',
        lightweightIntent: 'continuation',
        history: [
          { role: 'user', content: '先做 Agent 意图边界收口' },
          { role: 'assistant', content: '已完成总结类意图边界。' }
        ],
        modelReply: '继续上一轮 Agent 意图边界收口，不直接调用 Photoshop 工具。',
        expectedMessageIncludes: '继续上一轮'
      },
      {
        name: 'model identity stays conversational',
        input: '你是什么模型？',
        lightweightIntent: 'identity',
        modelReply: '这是模型身份问题，应直接回答，不执行 Photoshop。',
        expectedMessageIncludes: '模型身份'
      },
      {
        name: 'capability question stays conversational',
        input: '你可以做什么？',
        lightweightIntent: 'capability',
        modelReply: '这是能力说明问题，应直接回答，不执行 Photoshop。',
        expectedMessageIncludes: '能力说明'
      },
      {
        name: 'sku capability question stays conversational',
        input: '我问你会做SKU吗',
        lightweightIntent: 'capability',
        modelReply: '能做，SKU 这块我会按组合图和自选备注来理解。',
        expectedMessageIncludes: 'SKU'
      },
      {
        name: 'sku ability question with spaces stays conversational',
        input: '你会做 SKU 吗',
        lightweightIntent: 'capability',
        modelReply: '可以。我能根据当前 PSD 和 SKU 色卡生成组合图，也能处理自选备注。',
        expectedMessageIncludes: '自选备注'
      },
      {
        name: 'sku can-do question stays conversational',
        input: '你能做 SKU 吗',
        lightweightIntent: 'capability',
        modelReply: '可以做 SKU。真正执行前我会先检查模板、色卡和排版空间。',
        expectedMessageIncludes: '检查模板'
      },
      {
        name: 'sku how-would-you-do question stays conversational',
        input: '你会怎么做 SKU',
        lightweightIntent: 'chat',
        modelReply: '我会先确认 SKU 色卡和模板，再一次性规划组合图和自选备注，最后读回结果检查遮挡和导出。',
        expectedMessageIncludes: '一次性规划'
      },
      {
        name: 'sku supported capability scope stays conversational',
        input: '你现在支持哪些 SKU 能力',
        lightweightIntent: 'capability',
        modelReply: 'SKU 这块我支持组合图、自选备注和基础导出检查；执行前会先确认项目里的 SKU 文件和模板。',
        expectedMessageIncludes: '组合图'
      },
      {
        name: 'design work capability question stays conversational',
        input: '你能帮我做什么设计工作',
        lightweightIntent: 'capability',
        modelReply: '我能协助主图、SKU、详情页和文字版式调整；真正执行前会先检查当前 PSD、素材和排版空间。',
        expectedMessageIncludes: '排版空间'
      },
      {
        name: 'sku modal capability question stays conversational',
        input: '你会不会做SKU',
        lightweightIntent: 'capability',
        modelReply: '我可以做 SKU，但这句话只是能力询问，不会读取项目或执行排版。',
        expectedMessageIncludes: '能力询问'
      },
      {
        name: 'design knowledge question stays conversational',
        input: '为什么电商详情页要分屏设计？',
        lightweightIntent: 'chat',
        modelReply: '分屏设计是为了控制信息节奏和卖点层级。',
        expectedMessageIncludes: '信息节奏'
      },
      {
        name: 'intent completion question stays task summary',
        input: '那么我们的意图已经完成了吗',
        lightweightIntent: 'task_summary',
        history: [
          { role: 'user', content: '意图还是存在问题，不能清晰理解用户需求。' },
          { role: 'assistant', content: '已新增意图边界矩阵，但真实 ChatPanel 样本还需要继续纳入。' }
        ],
        modelReply: '意图边界已有阶段性收口，但不能说完全完成。',
        expectedMessageIncludes: '阶段性'
      },
      {
        name: 'project progress percent question stays task summary',
        input: '我们的进度算百分之几',
        lightweightIntent: 'task_summary',
        modelReply: '当前进度只能基于已验证事项估算，不能伪造成完整设计能力完成。',
        expectedMessageIncludes: '已验证'
      },
      {
        name: 'ultimate-template gap question stays task summary',
        input: '距离终极模板还需要做哪些',
        lightweightIntent: 'task_summary',
        modelReply: '距离终极模板还需要补齐真实设计执行、验收和业务策略。',
        expectedMessageIncludes: '终极模板'
      },
      {
        name: 'architecture preparation question stays conversational',
        input: '从系统架构来说要做详情页设计的skills还需要做哪些准备',
        lightweightIntent: 'chat',
        modelReply: '详情页 skill 需要先准备素材理解、设计规范、执行 DSL、Photoshop 工具计划和验收标准。',
        expectedMessageIncludes: '素材理解'
      },
      {
        name: 'business phase readiness question stays plan only',
        input: '看看我们是否可以开始做主图详情页了',
        lightweightIntent: 'chat',
        modelReply: '这是阶段准备度确认，只应该说明是否可以开始以及还缺哪些条件，不应执行主图或详情页工具。',
        expectedMessageIncludes: '准备度'
      },
      {
        name: 'business remaining work question stays plan only',
        input: '主图详情页还剩哪些问题',
        lightweightIntent: 'chat',
        modelReply: '这是剩余工作评估，只应该回答缺口和下一步，不应进入 Photoshop 执行链。',
        expectedMessageIncludes: '剩余工作'
      },
      {
        name: 'agent foundation gap question stays conversational',
        input: '当前 Agent 还差什么',
        lightweightIntent: 'chat',
        modelReply: '这是 Agent 底座状态问题，只应该说明意图、工具授权和验收链缺口。',
        expectedMessageIncludes: '底座'
      },
      {
        name: 'user has follow-up question stays conversational',
        input: '我还有问题',
        lightweightIntent: 'chat',
        modelReply: '可以继续问，我会先理解问题，不会因为这句话触发 Photoshop 工具。',
        expectedMessageIncludes: '继续问'
      }
    ];

    for (const sample of directSamples) {
      executed.length = 0;
    const result = await runDirectResponseCase(engine, sample, executed);
      cases.push({
        name: sample.name,
        expected: `direct_response:${sample.lightweightIntent}`,
        status: result.ok ? 'pass' : 'fail',
        details: result.details
      });
    }

    const skillSamples = [
      {
        name: 'document close without save executes document-management',
        input: '帮我关闭文档不保存',
        expectedSkillId: 'document-management',
        expectedMinModelCalls: 1,
        expectedMaxModelCalls: 1,
        routerDecision: {
          route: 'skill_execution',
          skillId: 'document-management',
          intentSummary: '关闭当前文档且不保存。',
          skillParams: { action: 'close', save: false }
        }
      },
      {
        name: 'layer lightness order executes layer-management',
        input: '把图层的颜色从浅到深，从上到下调整图层顺序',
        expectedSkillId: 'layer-management',
        expectedMinModelCalls: 1,
        expectedMaxModelCalls: 1,
        routerDecision: {
          route: 'skill_execution',
          skillId: 'layer-management',
          intentSummary: '按颜色明度重新排序图层。',
          skillParams: {
            action: 'reorder',
            sortBy: 'lightness',
            sortDirection: 'light-to-dark'
          }
        }
      },
      {
        name: 'project image analysis executes project-image-analysis',
        input: '我想你理解一下项目中的图片',
        expectedSkillId: 'project-image-analysis',
        expectedMinModelCalls: 1,
        expectedMaxModelCalls: 1,
        routerDecision: {
          route: 'skill_execution',
          skillId: 'project-image-analysis',
          intentSummary: '分析项目图片内容和素材类型。',
          skillParams: { sampleSize: 6, focus: 'style-and-detail-page' }
        }
      },
      {
        name: 'template count executes project inventory read-only',
        input: '帮我看看模板有几个',
        expectedSkillId: 'project-image-analysis',
        expectedMinModelCalls: 0,
        expectedMaxModelCalls: 1,
        routerDecision: {
          route: 'direct_response',
          directResponse: '不应该依赖模型直接回答模板数量。'
        }
      }
    ];

    for (const sample of skillSamples) {
      executed.length = 0;
      sample.executed = executed;
      const result = await runSkillCase(engine, sample);
      cases.push({
        name: sample.name,
        expected: `skill_execution:${sample.expectedSkillId}`,
        status: result.ok ? 'pass' : 'fail',
        details: result.details
      });
    }

    const reactSamples = [
      {
        name: 'confirmed sku production enters autonomous ReAct',
        input: '我已确认 SKU 组合：2双：白色+黑色；3双：白色+黑色+灰色。请继续生成 SKU 组合图和自选备注。',
        intentSummary: '确认后的 SKU 生产应进入 Agent ReAct。',
        expectedMinModelCalls: 1,
        expectedMaxModelCalls: 3,
        forbiddenSkillId: 'sku-batch'
      }
    ];

    for (const sample of reactSamples) {
      executed.length = 0;
      sample.executed = executed;
      const result = await runAutonomousBusinessWorkflowCase(engine, sample);
      cases.push({
        name: sample.name,
        expected: 'autonomous_agent:not_direct_sku-batch',
        status: result.ok ? 'pass' : 'fail',
        details: result.details
      });
    }
  } finally {
    skillExecutors.getSkillExecutor = originalGetSkillExecutor;
    skillExecutors.executeSkillWithExecutor = originalExecuteSkillWithExecutor;
  }

  const payload = {
    success: cases.every((item) => item.status === 'pass'),
    cases
  };
  payload.report = writeReport(payload);

  console.log(JSON.stringify(payload, null, 2));
  if (!payload.success) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
