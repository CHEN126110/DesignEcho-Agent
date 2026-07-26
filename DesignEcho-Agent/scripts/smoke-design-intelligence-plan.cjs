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

const { buildDesignIntelligencePlan } = require('../src/shared/design-intelligence-plan.ts');
const { governDesignKnowledgeResult } = require('../src/shared/design-knowledge-governance.ts');

function governedKnowledge(item) {
  return governDesignKnowledgeResult(item, {
    provenance: 'local_reviewed',
    sourceRevision: `intelligence-smoke:${item.id}:v1`,
    retrievedAt: '2026-07-12T00:00:00.000Z'
  });
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertIncludes(values, expected, label) {
  assert(Array.isArray(values), `${label} must be an array`);
  assert(values.includes(expected), `${label} must include ${expected}: ${JSON.stringify(values)}`);
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

function modelDesignDecision() {
  return {
    source: 'model-agent',
    designGoal: '围绕纯白短袜的柔软、干净和基础百搭建立主图设计。',
    productUnderstanding: [
      '商品是纯白短袜，重点是柔软、洁净和日常穿搭。',
      '画面需要突出袜身质感，不应把颜色改成非商品颜色。'
    ],
    audience: '淘宝天猫袜子类目消费者',
    hierarchy: {
      primarySubject: '纯白短袜主体',
      focalPoint: '袜身面料纹理和口部弹性',
      informationPriority: ['主体', '核心卖点', '规格提示'],
      whitespaceIntent: '保留可读留白，避免文字压住主体。'
    },
    color: {
      paletteIntent: '白色商品配合低饱和浅灰背景和少量冷色强调。',
      primaryColors: ['#FFFFFF', '#F2F4F7'],
      accentColors: ['#2F6FED'],
      backgroundDirection: '轻微灰白渐变或实拍环境清理，不改变产品颜色。',
      contrastPlan: '标题和规格信息使用深灰，确保白底场景可读。',
      avoid: ['大面积暖黄偏色', '高饱和荧光色']
    },
    typography: {
      tone: '干净、稳定、偏电商转化',
      hierarchy: ['主标题', '卖点短句', '规格补充'],
      fontDirection: '无衬线黑体，字重区分层级。',
      spacingDirection: '行距紧凑但不压迫主体。',
      avoid: ['过多字效', '低对比浅灰正文']
    },
    retouch: {
      objectives: ['清理背景杂点', '保持袜子白色层次', '轻微增强面料纹理'],
      colorCorrection: '校正白袜偏色但保留真实白色层次。',
      lighting: '主体光照均匀，不制造塑料感高光。',
      cleanup: ['去除灰尘', '修正边缘毛刺'],
      fabricOrMaterialHandling: '保留棉袜纹理和柔软褶皱。',
      prohibitedEdits: ['改变商品颜色', '抹掉面料纹理', '夸张液化袜型']
    },
    assetSelection: {
      selectionPrinciples: ['优先选择主体完整、纹理清楚、无遮挡的项目摄影图。'],
      requiredInputs: ['项目素材索引', '视觉理解结果', '主体边界'],
      rejectRules: ['不能选择低清、过曝或主体被裁断的图片。']
    },
    toolWorkflow: [
      { phase: 'inspect', goal: '读取项目素材和当前文档状态。', allowedToolKinds: ['read-only'], requiredInputs: ['project-context'] },
      { phase: 'analyze', goal: '分析商品主体、卖点和可用视觉素材。', allowedToolKinds: ['read-only'], requiredInputs: ['visual-insight'] },
      { phase: 'retouch', goal: '按修图目标清理背景和校正白色层次。', allowedToolKinds: ['retouch-plan'], requiredInputs: ['retouch-brief'] },
      { phase: 'compose', goal: '按层级和配色计划排版主图。', allowedToolKinds: ['photoshop-write'], requiredInputs: ['design-plan'] },
      { phase: 'verify', goal: '读回结果并检查主体、文字、颜色和导出要求。', allowedToolKinds: ['readback'], requiredInputs: ['screenshot-qa'] }
    ],
    acceptanceCriteria: [
      '主体完整清晰，白袜不能偏黄或失去纹理。',
      '主标题和卖点文字不遮挡产品。',
      '输出前必须完成截图或读回检查。'
    ],
    rationale: ['先设计目标，再决定工具顺序。']
  };
}

const missingDecision = buildDesignIntelligencePlan({
  userText: '帮我做主图',
  scenario: 'main-image',
  plannerReadiness: 'needs_context'
});
assert(missingDecision.status === 'needs_model_design_decision', `missing decision should need model decision: ${JSON.stringify(missingDecision)}`);
assert(missingDecision.decisionSource === 'missing', `missing decision source expected: ${missingDecision.decisionSource}`);
assertIncludes(missingDecision.toolUsePlan.requiredInputs, 'model-agent-design-decision', 'missingDecision requiredInputs');
assertIncludes(missingDecision.toolUsePlan.requiredInputs, 'project-visual-observation', 'missingDecision requiredInputs');
assert(JSON.stringify(missingDecision.decisions.color).includes('不要由代码按关键词猜测配色'), 'missing color decision must forbid keyword guessing');

const readyPlan = buildDesignIntelligencePlan({
  userText: '帮我做主图',
  scenario: 'main-image',
  plannerReadiness: 'ready',
  projectContext: {
    assetIndex: { summary: { totalImages: 8 } },
    visualInsightCache: {
      entries: [{
        insight: {
          assetId: 'asset-1',
          path: 'C:/project/素材/white-socks.jpg',
          summary: '白色短袜平铺，袜身纹理清楚。',
          material: '细密棉织纹理'
        }
      }],
      summary: { entriesWithInsight: 3 }
    }
  },
  memoryContext: { status: 'ready' },
  knowledgeResults: [governedKnowledge({
    id: 'local-case:white-socks-clean-main-image',
    title: '白袜清爽主图案例',
    intent: 'case_reference',
    sourceType: 'local_case',
    summary: '白色袜子使用浅灰背景和少量蓝色强调。',
    sourceNotes: ['只作为视觉参考，不直接生成 Photoshop 动作。'],
    tags: ['main-image', 'socks', 'white'],
    allowedUses: ['prompt_context', 'user_reference'],
    sourceLevel: 'local_case',
    sourceRank: 20
  })],
  agentDecision: modelDesignDecision()
});
assert(readyPlan.status === 'ready_for_tool_planning', `ready plan status expected: ${JSON.stringify(readyPlan)}`);
assert(readyPlan.decisionSource === 'model-agent', `model source expected: ${readyPlan.decisionSource}`);
assert(readyPlan.toolUsePlan.canPlanToolUse === true, 'ready plan can plan tool use');
assert(readyPlan.contextSummary.visualUnderstanding.concreteInsightCount === 1, 'concrete visual insight should be counted');
assert(readyPlan.contextSummary.visualUnderstanding.reportedInsightCount === 3, 'reported insight count should remain metadata');
assert(readyPlan.decisions.retouch.colorCorrection.includes('校正白袜偏色'), 'retouch color correction must be preserved');
assert(readyPlan.decisions.color.primaryColors.includes('#FFFFFF'), 'color palette must be preserved');
assert(readyPlan.toolUsePlan.workflow.some((step) => step.phase === 'retouch'), 'workflow must include retouch phase');
assert(readyPlan.contextSummary.localCaseCount === 1, `local case count expected: ${JSON.stringify(readyPlan.contextSummary)}`);

const manualNoVisual = buildDesignIntelligencePlan({
  userText: '按我说的干净风格做 SKU',
  scenario: 'sku',
  plannerReadiness: 'ready',
  agentDecision: {
    ...modelDesignDecision(),
    source: 'manual',
    designGoal: '按用户确认的干净风格规划 SKU 视觉表达。'
  }
});
assert(manualNoVisual.status === 'needs_visual_observation', `manual decision without a visual observation should need one: ${JSON.stringify(manualNoVisual)}`);
assert(manualNoVisual.decisionSource === 'manual', `manual source expected: ${manualNoVisual.decisionSource}`);
assert(manualNoVisual.toolUsePlan.canPlanToolUse === true, 'manual no visual can still form a tool plan');

const attachmentOnly = buildDesignIntelligencePlan({
  userText: '按这张附件做主图',
  scenario: 'main-image',
  plannerReadiness: 'ready',
  projectContext: {
    attachmentImageCount: 1,
    sampleImagePaths: ['C:/temp/attached-image.png']
  },
  agentDecision: modelDesignDecision()
});
assert(attachmentOnly.status === 'needs_visual_observation', `attachment-only input must not become visual understanding: ${JSON.stringify(attachmentOnly)}`);
assert(attachmentOnly.contextSummary.assetAvailability.availableImageCount === 1, 'attachment should be reported as an available asset');
assert(attachmentOnly.contextSummary.visualUnderstanding.status === 'missing', 'attachment path alone must not be marked understood');

const summaryOnly = buildDesignIntelligencePlan({
  userText: '基于项目素材做主图',
  scenario: 'main-image',
  plannerReadiness: 'ready',
  projectContext: {
    assetIndex: { summary: { totalImages: 8 } },
    visualInsightCache: { summary: { entriesWithInsight: 4 } }
  },
  agentDecision: modelDesignDecision()
});
assert(summaryOnly.status === 'needs_visual_observation', `summary counts must not become visual understanding: ${JSON.stringify(summaryOnly)}`);
assert(summaryOnly.contextSummary.visualUnderstanding.concreteInsightCount === 0, 'summary-only context has no concrete insight');
assert(summaryOnly.contextSummary.visualUnderstanding.reportedInsightCount === 4, 'summary count remains diagnostic metadata');

const unsafeKnowledgePlan = buildDesignIntelligencePlan({
  userText: '直接照这个网页规则改图',
  scenario: 'detail-page',
  plannerReadiness: 'ready',
  projectContext: {
    assetIndex: { summary: { totalImages: 2 } },
    visualInsightCache: {
      entries: [{ insight: {
        assetId: 'asset-2',
        path: 'C:/project/素材/b.jpg',
        scene: '详情页中的袜子上脚展示'
      } }],
      summary: { entriesWithInsight: 1 }
    }
  },
  agentDecision: modelDesignDecision(),
  knowledgeResults: [{
    id: 'unsafe:direct-action',
    title: '错误知识条目',
    intent: 'tool_plan',
    sourceType: 'web_page',
    summary: '该条目错误地试图把知识直接变成 Photoshop 动作。',
    sourceNotes: ['这类知识必须被阻断。'],
    tags: ['unsafe'],
    allowedUses: ['direct_photoshop_action'],
    sourceLevel: 'external_snippet',
    sourceRank: 1
  }]
});
assert(unsafeKnowledgePlan.status === 'ready_for_tool_planning', `unsafe knowledge should be ignored without becoming execution authority: ${JSON.stringify(unsafeKnowledgePlan)}`);
assert(unsafeKnowledgePlan.warnings.some((item) => item.includes('已忽略')), `ignored knowledge warning expected: ${JSON.stringify(unsafeKnowledgePlan.warnings)}`);

[
  ['missingDecision', missingDecision],
  ['readyPlan', readyPlan],
  ['manualNoVisual', manualNoVisual],
  ['attachmentOnly', attachmentOnly],
  ['summaryOnly', summaryOnly],
  ['unsafeKnowledgePlan', unsafeKnowledgePlan]
].forEach(([label, value]) => {
  const text = JSON.stringify(value);
  assert(!text.includes('"confidence"'), `${label} must not expose confidence`);
  assert(!text.includes('置信'), `${label} must not expose confidence wording`);
  assert(!text.includes('canExecuteWriteTools'), `${label} must not expose write authorization`);
  assert(!text.includes('requiredBeforeExecution'), `${label} must use context inputs, not execution authorization`);
  assert(!text.includes('"blockers"'), `${label} must not expose context gaps as blockers`);
  assertNoMojibake(value, label);
});

console.log(JSON.stringify({
  success: true,
  checks: [
    'missing model design decision is reported as a planning input',
    'asset availability is separate from visual understanding',
    'attachment paths and summary counts never become visual understanding',
    'concrete insight objects are recognized as visual understanding',
    'model-agent decision carries hierarchy, color, typography, retouch, asset and verification intent',
    'manual decision can plan while exposing a missing visual observation',
    'unsafe knowledge is ignored instead of becoming Photoshop authority',
    'design intelligence plan exposes no write authorization or blocker fields',
    'design intelligence plan exposes no confidence field or confidence wording',
    'mojibake guard passed'
  ]
}, null, 2));
