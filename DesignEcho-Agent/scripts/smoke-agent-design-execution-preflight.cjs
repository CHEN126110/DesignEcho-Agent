#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '..', 'tsconfig.main.json')
});

const {
  buildAgentDesignExecutionPreflight,
  shouldApplyAgentDesignExecutionPreflight
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'agent-design-execution-preflight.ts'));
const {
  DesignAgentEngine
} = require(path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'design-agent', 'engine.ts'));
const skillExecutors = require(path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'skill-executors', 'index.ts'));

function assert(condition, message, details) {
  if (!condition) {
    const suffix = details ? `\n${JSON.stringify(details, null, 2)}` : '';
    throw new Error(`${message}${suffix}`);
  }
}

function assertNoMojibake(value, label) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  const suspiciousTokens = [
    0x93B4,
    0x93C9,
    0x951B,
    0x95C8,
    0xFFFD
  ].map((codePoint) => String.fromCodePoint(codePoint));
  const found = suspiciousTokens.filter((token) => text.includes(token));
  assert(found.length === 0, `${label} contains mojibake tokens: ${found.join(', ')}`);
}

function designDecision() {
  return {
    source: 'model-agent',
    designGoal: '为纯白短袜建立干净、清爽、可转化的电商主图设计。',
    productUnderstanding: [
      '商品是纯白短袜，核心是柔软、洁净和基础百搭。',
      '设计必须保持商品真实白色和面料纹理。'
    ],
    audience: '淘宝天猫袜子消费者',
    hierarchy: {
      primarySubject: '纯白短袜主体',
      focalPoint: '袜身纹理和袜口弹性',
      informationPriority: ['商品主体', '核心卖点', '规格说明'],
      whitespaceIntent: '保留标题和卖点文字的安全留白。',
      layoutNotes: ['主体优先，不让装饰抢层级。']
    },
    color: {
      paletteIntent: '白色商品配浅灰背景和少量蓝色强调。',
      primaryColors: ['#FFFFFF', '#F3F5F8'],
      accentColors: ['#2F6FED'],
      backgroundDirection: '浅灰白背景，避免偏黄。',
      contrastPlan: '深灰文字保证白底可读。',
      avoid: ['大面积荧光色', '暖黄偏色']
    },
    typography: {
      tone: '清爽、稳定、偏转化',
      hierarchy: ['主标题', '卖点短句', '规格补充'],
      fontDirection: '无衬线黑体，字重区分层级。',
      spacingDirection: '紧凑但不遮挡主体。',
      avoid: ['过度字效', '过浅正文']
    },
    retouch: {
      objectives: ['清理背景', '校正白袜偏色', '增强面料纹理'],
      colorCorrection: '白色层次校正，不改变商品颜色。',
      lighting: '均匀自然，不制造塑料感。',
      cleanup: ['去除灰尘', '修边缘杂点'],
      fabricOrMaterialHandling: '保留棉袜纹理和柔软褶皱。',
      prohibitedEdits: ['改变商品颜色', '抹掉纹理']
    },
    assetSelection: {
      selectionPrinciples: ['优先主体完整、纹理清楚、无遮挡的项目摄影图。'],
      requiredInputs: ['项目素材索引', '视觉理解结果'],
      rejectRules: ['拒绝主体裁断、过曝、低清素材。']
    },
    toolWorkflow: [
      { phase: 'inspect', goal: '读取项目和文档状态。', allowedToolKinds: ['read-only'], requiredInputs: ['project-context'] },
      { phase: 'analyze', goal: '分析商品主体和可用素材。', allowedToolKinds: ['read-only'], requiredInputs: ['visual-observation'] },
      { phase: 'retouch', goal: '按修图目标清理和校色。', allowedToolKinds: ['retouch-plan'], requiredInputs: ['retouch-brief'] },
      { phase: 'compose', goal: '按层级、配色和字体计划排版。', allowedToolKinds: ['photoshop-write'], requiredInputs: ['design-plan'] },
      { phase: 'verify', goal: '读回结果并检查主体、文字和导出要求。', allowedToolKinds: ['readback'], requiredInputs: ['screenshot-qa'] }
    ],
    acceptanceCriteria: [
      '白袜颜色真实且保留纹理。',
      '标题和卖点不遮挡主体。',
      '执行后必须完成读回或截图检查。'
    ],
    risks: ['白色商品容易与背景粘连。'],
    rationale: ['先形成设计计划，再进入工具执行。']
  };
}

function makeContext(userInput, overrides = {}) {
  return {
    userInput,
    conversationHistory: [],
    isPluginConnected: true,
    photoshopContext: {
      hasDocument: true,
      documentName: '主图.psd',
      activeLayerName: '图层 1',
      layerCount: 12
    },
    projectContext: {
      projectPath: 'C:/DesignEcho/test-project',
      projectImageCount: 6,
      sampleImagePaths: ['C:/DesignEcho/test-project/素材/a.jpg'],
      visualInsightCache: {
        entries: [{
          insight: {
            assetId: 'asset-a',
            path: 'C:/DesignEcho/test-project/素材/a.jpg',
            summary: '白色短袜平铺，主体和纹理清楚。'
          }
        }],
        summary: { entriesWithInsight: 2 }
      }
    },
    ...overrides
  };
}

assert(shouldApplyAgentDesignExecutionPreflight('main-image-design') === true, 'main-image should be guarded');
assert(shouldApplyAgentDesignExecutionPreflight('detail-page-design') === true, 'detail-page should be guarded');
assert(shouldApplyAgentDesignExecutionPreflight('sku-batch') === true, 'SKU should be guarded');
assert(shouldApplyAgentDesignExecutionPreflight('layout-replication') === false, 'layout-replication keeps its reference-specific executor gate');
assert(shouldApplyAgentDesignExecutionPreflight('document-management') === false, 'document-management should not be guarded');

const nonBusiness = buildAgentDesignExecutionPreflight({
  userText: '帮我关闭文档',
  route: 'skill_execution',
  routeSource: 'model_router',
  skillId: 'document-management'
});
assert(nonBusiness.status === 'not_applicable', 'non-business skill should not require design context', nonBusiness);
assert(!Object.hasOwn(nonBusiness, 'shouldExecute'), 'design context preflight must not expose execution authority', nonBusiness);

const inspectExempt = buildAgentDesignExecutionPreflight({
  userText: '先检查详情页结构',
  route: 'skill_execution',
  routeSource: 'model_router',
  skillId: 'detail-page-design',
  mode: 'inspect',
  params: { inspectOnly: true }
});
assert(inspectExempt.readOnlyExempt === true, 'inspect request should be exempt from design context planning', inspectExempt);

const missingDecision = buildAgentDesignExecutionPreflight({
  userText: '帮我做主图',
  route: 'skill_execution',
  routeSource: 'model_router',
  skillId: 'main-image-design',
  params: {},
  projectContext: { projectImageCount: 5 }
});
assert(missingDecision.status === 'needs_model_design_decision', 'business write should require model design decision', missingDecision);
assert(missingDecision.requiredInputs.includes('model-agent-design-decision'), 'missing decision should be reported as a planning input', missingDecision);
assert(missingDecision.recommendedActions.length > 0, 'missing decision should provide a next action', missingDecision);
assert(
  !Object.hasOwn(missingDecision, 'blockers') && !Object.hasOwn(missingDecision, 'shouldExecute'),
  `design context gaps must not become execution blockers: ${JSON.stringify(missingDecision)}`
);

const missingVisualObservation = buildAgentDesignExecutionPreflight({
  userText: '帮我做主图',
  route: 'skill_execution',
  routeSource: 'model_router',
  skillId: 'main-image-design',
  params: { designIntelligenceDecision: designDecision() },
  projectContext: { projectImageCount: 0 }
});
assert(missingVisualObservation.status === 'needs_visual_observation', 'business write should require a visual observation', missingVisualObservation);
assert(missingVisualObservation.requiredInputs.includes('project-visual-observation'), 'missing visual understanding should be reported as an input', missingVisualObservation);

const attachmentOnly = buildAgentDesignExecutionPreflight({
  userText: '按附件做一张主图',
  route: 'skill_execution',
  routeSource: 'model_router',
  skillId: 'main-image-design',
  params: { designIntelligenceDecision: designDecision() },
  projectContext: {
    attachmentImageCount: 1,
    sampleImagePaths: ['C:/temp/attachment.png']
  }
});
assert(attachmentOnly.status === 'needs_visual_observation', 'attachment and file path alone must not become visual understanding', attachmentOnly);
assert(attachmentOnly.designIntelligencePlan.contextSummary.assetAvailability.availableImageCount === 1, 'attachment should remain asset availability', attachmentOnly);
assert(attachmentOnly.designIntelligencePlan.contextSummary.visualUnderstanding.status === 'missing', 'attachment should not claim visual understanding', attachmentOnly);

const summaryOnly = buildAgentDesignExecutionPreflight({
  userText: '基于项目素材做主图',
  route: 'skill_execution',
  routeSource: 'model_router',
  skillId: 'main-image-design',
  params: { designIntelligenceDecision: designDecision() },
  projectContext: {
    assetIndex: { summary: { totalImages: 5 } },
    visualInsightCache: { summary: { entriesWithInsight: 2 } }
  }
});
assert(summaryOnly.status === 'needs_visual_observation', 'summary count alone must not become visual understanding', summaryOnly);
assert(summaryOnly.designIntelligencePlan.contextSummary.visualUnderstanding.concreteInsightCount === 0, 'summary-only context has no concrete visual insight', summaryOnly);

const skuProductionPlanner = buildAgentDesignExecutionPreflight({
  userText: '帮我做 SKU',
  route: 'skill_execution',
  routeSource: 'model_router',
  skillId: 'sku-batch',
  params: {},
  projectContext: { projectImageCount: 0 }
});
assert(skuProductionPlanner.status === 'context_ready', 'SKU should expose its controlled production context', skuProductionPlanner);
assert(skuProductionPlanner.requiredInputs.includes('project-first-sku-source-resolution'), 'SKU planner should list project-first source resolution', skuProductionPlanner);
assert(skuProductionPlanner.requiredInputs.includes('sku-result-readback'), 'SKU planner should keep result readback input', skuProductionPlanner);

const projectContextMainImagePlanner = buildAgentDesignExecutionPreflight({
  userText: '请使用当前项目 C:/project 的图片，完成一张可验收的电商袜子主图：画布 800x800，结果导出到项目的“主图”目录，完成后读回导出文件。',
  route: 'skill_execution',
  routeSource: 'model_router',
  skillId: 'main-image-design',
  params: {
    size: '800',
    imageType: 'click',
    mainImageExecutionMode: 'product-disposable-live',
    executionScope: 'disposable-document',
    sourceAssetKind: 'selected-project-image',
    outputDirPolicy: 'project-main-image-dir',
    approvedLiveExecution: true,
    approvedLiveAdapterRun: true,
    enableVisionPreflight: true,
    maxVisionCandidates: 1,
    userCheckpointApproved: true
  },
  projectContext: {
    projectImageCount: 8,
    visualInsightCache: { summary: { entriesWithInsight: 2 } }
  }
});
assert(projectContextMainImagePlanner.status === 'context_ready', 'project-context main image should expose controlled production context', projectContextMainImagePlanner);
assert(projectContextMainImagePlanner.requiredInputs.includes('project-main-image-source-resolution'), 'project-context main image planner should list project image source resolution', projectContextMainImagePlanner);
assert(projectContextMainImagePlanner.requiredInputs.includes('main-image-result-readback'), 'project-context main image planner should list export readback', projectContextMainImagePlanner);
assert(!projectContextMainImagePlanner.designIntelligencePlan, 'project-context main image controlled planner should not request generic design decision', projectContextMainImagePlanner);

const ready = buildAgentDesignExecutionPreflight({
  userText: '帮我做主图',
  route: 'skill_execution',
  routeSource: 'model_router',
  skillId: 'main-image-design',
  params: { designIntelligenceDecision: designDecision() },
  projectContext: {
    projectImageCount: 5,
    visualInsightCache: {
      entries: [{ insight: { assetId: 'asset-ready', path: 'C:/project/ready.jpg' } }],
      summary: { entriesWithInsight: 2 }
    }
  }
});
assert(ready.status === 'context_ready', 'concrete visual context should be ready for skill planning', ready);
assert(ready.designIntelligencePlan.contextSummary.visualUnderstanding.concreteInsightCount === 1, 'concrete insight should create visual understanding', ready);

const engineSource = fs.readFileSync(
  path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'design-agent', 'engine.ts'),
  'utf8'
);
assert(!engineSource.includes('if (!preflight.shouldExecute)'), 'engine must not stop a skill from design-context status');
assert(!engineSource.includes('prepared.blockedResult'), 'engine must not create a blocked result from design-context gaps');

const originalGetSkillExecutor = skillExecutors.getSkillExecutor;
const originalExecuteSkillWithExecutor = skillExecutors.executeSkillWithExecutor;

async function runEngineChecks() {
  const executed = [];
  skillExecutors.getSkillExecutor = () => ({ id: 'fake' });
  skillExecutors.executeSkillWithExecutor = async (skillId, input) => {
    executed.push({ skillId, params: input.params });
    return {
      success: true,
      message: `${skillId} done`,
      data: { receivedParams: input.params }
    };
  };

  const engine = new DesignAgentEngine();
  try {
    const continuedWithoutDecision = await engine.run(makeContext('请基于项目素材生成主图'), {
      callModel: async (_messages, options = {}) => {
        if (options.purpose === 'visible_reasoning') return { text: '我会先理解主图目标，再检查还需要补充哪些设计上下文。' };
        if (options.purpose === 'router') {
          return {
            text: JSON.stringify({
              route: 'skill_execution',
              skillId: 'main-image-design',
              intentSummary: '用户要生成主图。',
              skillParams: {
                mainImageExecutionMode: 'product-disposable-live',
                executionScope: 'disposable-document',
                approvedLiveExecution: true,
                approvedLiveAdapterRun: true
              }
            })
          };
        }
        if (options.purpose === 'design_execution_preflight') {
          return { text: JSON.stringify({ designGoal: '不完整设计决策' }) };
        }
        return { text: '{}' };
      }
    });
    assert(continuedWithoutDecision.success === true, 'engine should continue into the skill when the model decision remains incomplete', continuedWithoutDecision);
    assert(executed.length === 1, 'design context preflight must not block the skill executor', executed);
    assert(executed[0].skillId === 'autonomous-agent', 'v3 should hand the selected main-image skill to the autonomous runtime', executed[0]);
    assert(executed[0].params.skillId === 'main-image-design', 'autonomous runtime should receive the selected main-image skill', executed[0]);

    executed.length = 0;

    const passed = await engine.run(makeContext('请基于项目素材生成主图'), {
      callModel: async (_messages, options = {}) => {
        if (options.purpose === 'visible_reasoning') return { text: '我会先理解主图目标，再形成公开设计计划。' };
        if (options.purpose === 'router') {
          return {
            text: JSON.stringify({
              route: 'skill_execution',
              skillId: 'main-image-design',
              intentSummary: '用户要生成主图。',
              skillParams: {
                mainImageExecutionMode: 'product-disposable-live',
                executionScope: 'disposable-document',
                approvedLiveExecution: true,
                approvedLiveAdapterRun: true
              }
            })
          };
        }
        if (options.purpose === 'design_execution_preflight') {
          return { text: JSON.stringify(designDecision()) };
        }
        return { text: '{}' };
      }
    });
    assert(passed.success === true, 'engine should continue the main-image task through the autonomous runtime', passed);
    assert(executed.length === 1, 'main-image task should execute once', executed);
    assert(executed[0].skillId === 'autonomous-agent', 'main-image should keep the v3 autonomous runtime topology', executed[0]);
    assert(executed[0].params.skillId === 'main-image-design', 'main-image handoff should remain explicit', executed[0]);

    executed.length = 0;
    const attachmentContinued = await engine.run(makeContext('请根据我附的图片设计一张主图', {
      hasAttachedImage: true,
      projectContext: {
        projectPath: 'C:/DesignEcho/test-project',
        projectImageCount: 0,
        sampleImagePaths: ['C:/temp/attachment.png']
      }
    }), {
      callModel: async (_messages, options = {}) => {
        if (options.purpose === 'visible_reasoning') return { text: '我会先整理主图目标，再由设计能力读取当前图片。' };
        if (options.purpose === 'router') {
          return {
            text: JSON.stringify({
              route: 'skill_execution',
              skillId: 'main-image-design',
              intentSummary: '用户希望根据附件设计主图。',
              skillParams: {
                mainImageExecutionMode: 'creative-design',
                executionScope: 'current-document'
              }
            })
          };
        }
        if (options.purpose === 'design_execution_preflight') {
          return { text: JSON.stringify(designDecision()) };
        }
        return { text: '{}' };
      }
    });
    assert(attachmentContinued.success === true, 'attachment-only context should continue into the skill', attachmentContinued);
    assert(executed.length === 1, 'missing visual understanding must not block the skill executor', executed);
    assert(executed[0].skillId === 'autonomous-agent', 'attachment task should continue through the autonomous runtime', executed[0]);
    assert(executed[0].params.skillId === 'main-image-design', 'attachment task should preserve the selected skill handoff', executed[0]);

    executed.length = 0;
    const skuModelPurposes = [];
    const skuPassed = await engine.run(makeContext('帮我做 SKU'), {
      callModel: async (_messages, options = {}) => {
        skuModelPurposes.push(options.purpose || '');
        if (options.purpose === 'visible_reasoning') return { text: '我会按 SKU 专用流程检查项目 SKU 文件、模板和配置。' };
        if (options.purpose === 'design_execution_preflight') {
          throw new Error('SKU controlled execution must not request generic design_execution_preflight');
        }
        return { text: '{}' };
      }
    });
    assert(skuPassed.success === true, 'engine should execute SKU through the autonomous runtime', skuPassed);
    assert(executed.length === 1, 'SKU task should execute once', executed);
    assert(executed[0].skillId === 'autonomous-agent', 'SKU should keep the v3 autonomous runtime topology', executed[0]);
    assert(executed[0].params.skillId === 'sku-batch', 'SKU autonomous handoff should select sku-batch', executed[0]);
    assert(!executed[0].params.skillParams?.designIntelligenceDecision, 'SKU handoff should not inject a generic design decision', executed[0]);
    assert(!JSON.stringify(skuPassed).includes('needs_model_design_decision'), 'SKU execution result should not expose an unrelated generic design decision status', skuPassed);
    assert(!skuModelPurposes.includes('design_execution_preflight'), 'SKU should not call generic design execution preflight model', skuModelPurposes);

    executed.length = 0;
    const skuClarificationOverruled = await engine.run(makeContext('帮我做 SKU'), {
      callModel: async (_messages, options = {}) => {
        if (options.purpose === 'visible_reasoning') return { text: '我会先检查当前项目 SKU 文件、模板和配置，再进入生成。' };
        if (options.purpose === 'design_execution_preflight') {
          throw new Error('SKU controlled execution must not request generic design_execution_preflight');
        }
        return {
          text: JSON.stringify({
            route: 'clarification_needed',
            clarificationQuestion: '请问你做的是什么品类？目前有哪些 SKU 规格、素材和模板？',
            thinking: '用户请求制作 SKU，但模型想先补充品类、规格、素材和模板。'
          })
        };
      }
    });
    assert(skuClarificationOverruled.success === true, 'confirmed SKU execution should not be stopped by generic model clarification', skuClarificationOverruled);
    assert(executed.length === 1, 'generic SKU clarification should be overruled and execute once', executed);
    assert(executed[0].skillId === 'autonomous-agent', 'generic SKU clarification should still enter the autonomous runtime', executed[0]);
    assert(executed[0].params.skillId === 'sku-batch', 'generic SKU clarification should preserve the sku-batch handoff', executed[0]);

    executed.length = 0;
    const projectMainImagePurposes = [];
    const projectMainImagePrompt = '请使用当前项目 C:/project 的图片，完成一张可验收的电商袜子主图：画布 800x800，适合淘宝商品首图，主体要清楚，风格参考项目素材本身的温柔浅色调，可以有简短卖点文案，但不要做模板占位图。请把结果导出到项目的“主图”目录，完成后读回导出文件并说明哪个文件可以验收。';
    const projectMainImagePassed = await engine.run(makeContext(projectMainImagePrompt, {
      projectContext: {
        projectPath: 'C:/project',
        projectImageCount: 8,
        sampleImagePaths: ['C:/project/素材/a.jpg'],
        visualInsightCache: { summary: { entriesWithInsight: 2 } }
      }
    }), {
      callModel: async (_messages, options = {}) => {
        projectMainImagePurposes.push(options.purpose || '');
        if (options.purpose === 'visible_reasoning') return { text: '我会先从项目图片里选出适合首图的主体，再完成 800 方图并读回结果。' };
        if (options.purpose === 'design_execution_preflight') {
          throw new Error('project-context main image controlled execution must not request generic design_execution_preflight');
        }
        return {
          text: JSON.stringify({
            route: 'direct_response',
            directResponse: '不应由 router direct_response 拦截项目主图交付。'
          })
        };
      }
    });
    assert(projectMainImagePassed.success === true, 'engine should execute project-context main image through the autonomous runtime', projectMainImagePassed);
    assert(executed.length === 1, 'project-context main image should execute once', executed);
    assert(executed[0].skillId === 'autonomous-agent', 'project-context main image should keep the v3 autonomous runtime topology', executed[0]);
    assert(executed[0].params.skillId === 'main-image-design', 'project-context main image handoff should select main-image-design', executed[0]);
    assert(executed[0].params.skillParams?.mainImageExecutionMode === 'product-disposable-live', 'project-context main image should use disposable live mode', executed[0]);
    assert(executed[0].params.skillParams?.sourceAssetKind === 'selected-project-image', 'project-context main image should be bounded to selected project image', executed[0]);
    assert(executed[0].params.skillParams?.outputDirPolicy === 'project-main-image-dir', 'project-context main image should export to project main image dir', executed[0]);
    assert(!executed[0].params.skillParams?.designIntelligenceDecision, 'project-context main image handoff should not inject a generic design decision', executed[0]);
    assert(!projectMainImagePurposes.includes('design_execution_preflight'), 'project-context main image should not call generic design execution preflight model', projectMainImagePurposes);

    const serializedPreflights = JSON.stringify({
      nonBusiness,
      inspectExempt,
      missingDecision,
      missingVisualObservation,
      attachmentOnly,
      summaryOnly,
      skuProductionPlanner,
      projectContextMainImagePlanner,
      ready
    });
    assert(!serializedPreflights.includes('"confidence"'), 'preflight output must not expose confidence fields');
    assert(!serializedPreflights.includes('置信'), 'preflight output must not expose confidence wording');
    assert(!serializedPreflights.includes('"shouldExecute"'), 'design context preflight must not expose execution authority');
    assert(!serializedPreflights.includes('"blockers"'), 'design context gaps must not be serialized as blockers');
    assertNoMojibake(serializedPreflights, 'agent design execution preflight smoke output');

    return executed;
  } finally {
    skillExecutors.getSkillExecutor = originalGetSkillExecutor;
    skillExecutors.executeSkillWithExecutor = originalExecuteSkillWithExecutor;
  }
}

runEngineChecks().then((executed) => {
  console.log(JSON.stringify({
    success: true,
    executedCount: executed.length,
    checks: [
      'design context preflight does not own execution authority',
      'non-business and inspect-only routes do not require design context',
      'missing model design decision is exposed as a recommended planning action',
      'no indexed images and attachment-only inputs remain visually unobserved',
      'summary counts do not become visual understanding',
      'concrete insight objects create visual understanding',
      'engine continues into the skill when visual understanding is missing',
      'engine contains no design-context early-return branch',
      'engine executes SKU through its controlled production context without a generic design decision',
      'confirmed SKU execution is not stopped by generic model clarification',
      'project-context main image delivery uses its controlled production context',
      'engine executes project-context main image instead of model direct_response',
      'write authorization and blocker fields are absent from design context output',
      'no confidence field or confidence wording is exposed',
      'mojibake guard passed'
    ]
  }, null, 2));
}).catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
