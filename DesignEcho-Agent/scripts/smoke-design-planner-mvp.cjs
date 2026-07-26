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

const {
  mapPlannerOutputToDesignAgentOsRecord,
  planDesignTask
} = require('../src/shared/design-planner.ts');
const { governDesignKnowledgeResult } = require('../src/shared/design-knowledge-governance.ts');

function governedKnowledge(item) {
  return governDesignKnowledgeResult(item, {
    provenance: 'bundled_curated',
    sourceRevision: `planner-smoke:${item.id}:v1`,
    retrievedAt: '2026-07-12T00:00:00.000Z'
  });
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
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
  assert(found.length === 0, `${label} contains mojibake tokens ${found.join(', ')}: ${text}`);
}

function minimalReferenceRepresentation() {
  return {
    canvas: { width: 800, height: 800 },
    layout: {
      layoutType: 'poster',
      designIntent: '复刻文字和主视觉结构',
      focalPoint: 'center'
    },
    elements: [
      {
        id: 'headline-1',
        sourceType: 'reference',
        name: '标题',
        role: 'headline',
        nodeKind: 'text',
        content: '合格证',
        box: { x: 260, y: 80, width: 280, height: 80 },
        style: { effects: [], textColor: '#111111', fontSizeRatio: 0.08 },
        visualWeight: 'primary',
        zIndex: 1
      },
      {
        id: 'body-1',
        sourceType: 'reference',
        name: '正文',
        role: 'supporting-copy',
        nodeKind: 'text',
        content: '品牌:FEX',
        box: { x: 80, y: 220, width: 320, height: 60 },
        style: { effects: [], textColor: '#111111', fontSizeRatio: 0.035 },
        visualWeight: 'secondary',
        zIndex: 2
      }
    ],
    alignmentGroups: [{ type: 'text-column', elementIndices: [0, 1] }]
  };
}

function c1198ProjectContext() {
  const assetPath = 'E:/fixture/SCS1270桑蚕丝波浪镂空/HJT_3829.jpg';
  return {
    projectPath: 'E:/fixture/C-1198',
    assetIndex: {
      indexVersion: 'project-asset-index/v0',
      projectName: 'SCS1270桑蚕丝波浪镂空',
      projectPath: 'E:/fixture/C-1198',
      generatedFrom: 'file-metadata',
      summary: {
        totalFiles: 1,
        totalImages: 1,
        totalDesignDocuments: 0,
        roleCounts: { 'raw-model-wear': 1 },
        folderRoleCounts: {},
        extensionCounts: { '.jpg': 1 },
        colorNames: [],
        skuConfigCount: 0
      },
      assets: [{
        id: 'wear-silk',
        path: assetPath,
        relativePath: 'SCS1270桑蚕丝波浪镂空/HJT_3829.jpg',
        name: 'HJT_3829.jpg',
        extension: '.jpg',
        sizeBytes: 10_000,
        width: 1500,
        height: 2000,
        aspectRatio: 0.75,
        folderRole: 'source',
        role: 'raw-model-wear',
        comboColors: [],
        isImage: true,
        isDesignDocument: false,
        isOutput: false,
        needsVision: true,
        confidence: 0.8,
        reasons: ['fixture'],
        evidence: []
      }],
      representativeSamples: {},
      visionCandidates: [],
      skillReadiness: [],
      warnings: [],
      limitations: [],
      evidence: []
    },
    visualInsightCache: {
      cacheVersion: 'project-visual-insight-cache/v0',
      source: 'provided-options',
      exists: true,
      entries: [{
        cacheKey: 'wear-silk',
        path: assetPath,
        insight: {
          assetId: 'wear-silk',
          path: assetPath,
          summary: '模特上脚浅色中筒袜，袜筒有镂空透气纹理和波浪花边袜口，画面轻薄清爽。',
          productType: '中筒袜',
          scene: '上脚场景',
          material: '桑蚕丝',
          styleTags: ['镂空', '波浪袜口', '轻薄', '清爽']
        }
      }],
      summary: {
        totalEntries: 1,
        entriesWithInsight: 1,
        entriesWithRawPayloadRemoved: 0
      },
      warnings: [],
      limitations: [],
      evidence: []
    }
  };
}

function run() {
  const savePlan = planDesignTask({
    userText: '帮我把详情页文档保存到项目的 PSD 中',
    currentDocument: { id: 1, name: '详情页.psd', width: 800, height: 2400 },
    executionMode: 'plan-only'
  });
  assert(savePlan.intentContext.action === 'save', `save request should keep save action: ${JSON.stringify(savePlan.intentContext)}`);
  assert(savePlan.readiness === 'ready', `save request with document should be ready: ${JSON.stringify(savePlan)}`);
  assert(savePlan.executionPlan.steps.length === 1, `save request should not create design steps: ${JSON.stringify(savePlan.executionPlan.steps)}`);
  assert(savePlan.executionPlan.steps[0].operation === 'saveDocument', `save step expected: ${JSON.stringify(savePlan.executionPlan.steps)}`);
  assert(!JSON.stringify(savePlan.executionPlan).includes('fillDetailPage'), `save request must not trigger detail-page generation: ${JSON.stringify(savePlan.executionPlan)}`);

  const chatPlan = planDesignTask({
    userText: '你是什么模型，和 Gemini 哪个更强？'
  });
  assert(chatPlan.intentContext.action === 'chat', `model identity request should be chat: ${JSON.stringify(chatPlan.intentContext)}`);
  assert(chatPlan.executionPlan.steps.length === 0, `chat should not produce Photoshop steps: ${JSON.stringify(chatPlan.executionPlan)}`);
  assert(chatPlan.readiness === 'ready', `chat should be ready without Photoshop: ${JSON.stringify(chatPlan)}`);

  const referencePlan = planDesignTask({
    userText: '照着这张参考图复刻一个可编辑设计',
    attachments: [{ kind: 'reference-image', name: 'reference.png', width: 800, height: 800 }],
    referenceRepresentation: minimalReferenceRepresentation(),
    knowledgeResults: [governedKnowledge({
      id: 'manual-rule:copywriting-framework',
      title: '图文文案撰写框架',
      intent: 'copywriting',
      sourceType: 'manual_rule',
      summary: '只作为 prompt context。',
      evidence: ['边界：不能直接执行 Photoshop。'],
      tags: ['copywriting'],
      allowedUses: ['prompt_context'],
      confidence: 0.8
    })]
  });
  assert(referencePlan.readiness === 'ready', `reference plan should be ready: ${JSON.stringify(referencePlan)}`);
  assert(referencePlan.designDsl && referencePlan.designDsl.regions.length === 2, `reference plan should produce DSL: ${JSON.stringify(referencePlan.designDsl)}`);
  assert(referencePlan.executionPlan.steps.some((step) => step.operation === 'composeDesignDsl'), `reference plan should compose DSL: ${JSON.stringify(referencePlan.executionPlan.steps)}`);
  assert(referencePlan.executionPlan.steps.some((step) => step.operation === 'useKnowledgeContext'), `knowledge should be context step: ${JSON.stringify(referencePlan.executionPlan.steps)}`);
  assert(!referencePlan.executionPlan.steps.some((step) => step.operation === 'direct_photoshop_action'), `knowledge must not become direct action: ${JSON.stringify(referencePlan.executionPlan.steps)}`);

  const missingContextPlan = planDesignTask({
    userText: '帮我做一张主图'
  });
  assert(missingContextPlan.readiness === 'needs_context', `main image without assets should need context: ${JSON.stringify(missingContextPlan)}`);
  assert(missingContextPlan.warnings.some((item) => item.includes('缺少参考图') || item.includes('缺少参考图、项目素材或当前文档上下文')), `missing context warning expected: ${JSON.stringify(missingContextPlan.warnings)}`);

  const c1198Plan = planDesignTask({
    userText: '请理解当前项目图片，提炼产品卖点，再规划主图和详情页方向。',
    projectContext: c1198ProjectContext()
  });
  assert(c1198Plan.selectedContext.notes.some((item) => item.includes('项目产品理解') && item.includes('桑蚕丝')), `planner should include semantic material understanding: ${JSON.stringify(c1198Plan.selectedContext.notes)}`);
  assert(c1198Plan.selectedContext.notes.some((item) => item.includes('项目产品理解') && item.includes('镂空透气纹理')), `planner should include visible product feature understanding: ${JSON.stringify(c1198Plan.selectedContext.notes)}`);
  assert(c1198Plan.selectedContext.notes.some((item) => item.includes('项目产品理解') && item.includes('visualSummaries') && item.includes('镂空透气纹理')), `planner should include observed visual summaries without authoring a design direction: ${JSON.stringify(c1198Plan.selectedContext.notes)}`);
  assert(!c1198Plan.selectedContext.notes.some((item) => /designDirections|buyerQuestions|groundedSellingAngles/.test(item)), `planner product understanding must not inject category strategy: ${JSON.stringify(c1198Plan.selectedContext.notes)}`);

  const blockedKnowledgePlan = planDesignTask({
    userText: '用搜索结果做一个海报',
    currentDocument: { id: 2, name: 'poster.psd', width: 800, height: 800 },
    knowledgeResults: [{
      id: 'unsafe:action',
      title: '不安全动作',
      intent: 'recipe',
      sourceType: 'manual_rule',
      summary: '错误地要求直接执行 Photoshop。',
      evidence: [],
      tags: [],
      allowedUses: ['direct_photoshop_action'],
      confidence: 0.5
    }]
  });
  assert(blockedKnowledgePlan.readiness === 'blocked', `direct Photoshop action knowledge should block planner: ${JSON.stringify(blockedKnowledgePlan)}`);
  assert(blockedKnowledgePlan.blockers.length > 0, `blocked planner should expose blockers: ${JSON.stringify(blockedKnowledgePlan)}`);

  const record = mapPlannerOutputToDesignAgentOsRecord(referencePlan);
  assert(record.intentContext && record.planInputs && record.executionPlan && record.verificationReport, `planner output should map to DesignAgentOsRecord: ${JSON.stringify(record)}`);
  assert(record.verificationReport.status === 'needs_review', `plan-only record must not pass verification: ${JSON.stringify(record.verificationReport)}`);

  [
    ['savePlan', savePlan],
    ['chatPlan', chatPlan],
    ['referencePlan', referencePlan],
    ['missingContextPlan', missingContextPlan],
    ['blockedKnowledgePlan', blockedKnowledgePlan],
    ['plannerRecord', record]
  ].forEach(([label, value]) => assertNoMojibake(value, label));

  console.log(JSON.stringify({
    success: true,
    checks: [
      'save request keeps save action and does not trigger detail-page generation',
      'chat/model identity request produces no Photoshop steps',
      'reference replication request produces DesignPlanInputs, DesignDSL and plan-only ExecutionPlan',
      'missing assets return needs_context without fabricating materials',
      'knowledge results stay as context and direct Photoshop action is blocked',
      'planner output maps back to a Design Agent OS record without passing verification'
    ]
  }, null, 2));
}

run();
