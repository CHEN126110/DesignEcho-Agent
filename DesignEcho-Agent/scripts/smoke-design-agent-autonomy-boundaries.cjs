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

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

const {
  applySharedSkillParamDefaults
} = require(path.join(ROOT, 'src', 'shared', 'skill-param-defaults.ts'));
const {
  validateCreativeStagePlan
} = require(path.join(ROOT, 'src', 'shared', 'creative-stage-plan.ts'));
// A1.2：行为断言从详情页专属守卫 evaluateFreshDetailPageToolStateGuard 迁移到通用守卫
// evaluateDesignToolStateGuard（被测对象迁移，断言同样的拦截/放行语义，不是删断言掩盖）。
const {
  resolveDesignDisciplineContext,
  createDesignDisciplineState,
  evaluateDesignToolStateGuard
} = require(path.join(ROOT, 'src', 'shared', 'design-discipline-runtime.ts'));
// 详情页设计纪律上下文（创意意图 + 命中详情页任务类型 → active）。
const detailPageDisciplineContext = resolveDesignDisciplineContext({
  taskText: '请基于项目素材从零创建一个详情页文档',
  isCreativeDesignIntent: true
});

function assert(condition, message, details) {
  if (!condition) {
    const suffix = details ? `\n${JSON.stringify(details, null, 2)}` : '';
    throw new Error(`${message}${suffix}`);
  }
}

function assertNoMojibake(value, label) {
  const text = String(value || '');
  const replacementChar = String.fromCharCode(0xfffd);
  const mojibakeTokens = [
    0x951f,
    0x923f,
    0x93c8,
    0x9353,
    0x7ef1,
    0x4fd9
  ].map((codePoint) => String.fromCharCode(codePoint));
  assert(
    !text.includes(replacementChar) && mojibakeTokens.every((token) => !text.includes(token)),
    `${label} contains mojibake`,
    { text }
  );
}

function readSource(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function testStagePlanContractLivesOutsideGenericExecutorPrompt() {
  const source = readSource('src/renderer/services/skill-executors/autonomous-agent.executor.ts');
  const toolSchemaSource = readSource('src/renderer/services/agent-runtime/tool-schemas.ts');

  const forbidden = [
    '直接确定首屏、核心卖点、材质/透气、弹力贴合、耐磨不易滑、颜色/搭配建议等模块顺序',
    '材质/透气、弹力贴合、耐磨不易滑、颜色/搭配建议'
  ];
  const found = forbidden.filter((token) => source.includes(token));
  assert(
    found.length === 0,
    'fresh detail-page design prompt must not hardcode a socks module sequence; the Agent should derive stages from project evidence',
    { found }
  );

  assert(
    !source.includes('buildDetailPageCreativeStagePlanPromptSection')
      && !source.includes("from '../../../shared/creative-stage-plan'"),
    'the generic autonomous executor prompt must not import or inject detail-page stage-plan instructions'
  );
  assert(
    toolSchemaSource.includes("name: 'renderLayout'")
      && toolSchemaSource.includes('stagePlan:'),
    'renderLayout Tool policy must expose the optional stagePlan contract to the model'
  );
  assert(
    detailPageDisciplineContext.requiresStagePlan === true,
    'the explicit detail-page Skill policy must still activate stagePlan validation'
  );
}

function testExistingSkuSourceInstructionDisablesSourceRebuildForTemplateAndComboWork() {
  const userInput = [
    '项目中存在 SKU 色卡素材，但是没有模板需要做模板。',
    '模板包含 2双装、3双装、4双装组合以及对应自选备注。',
    '按照文档名称区分，SKU 就是 SKU。'
  ].join('');

  const params = applySharedSkillParamDefaults({
    skillId: 'sku-batch',
    mode: 'execute',
    userInput,
    params: {}
  });

  assert(params.preferExistingSkuSourceForCardPreparation === true, 'existing SKU source should be preferred', params);
  assert(params.allowSkuCardSourcePreparation === false, 'existing SKU source request must not allow source preparation', params);
  assert(params.skuSourcePreparationMode === 'disabled', 'source preparation mode should be disabled when existing SKU source is requested', params);
  assert(params.requireSkuComboConfirmation === true, 'combo work should request editable confirmation before producing combinations', params);
  assert(params.requireSkuCardTemplateDesignConfirmation === true, 'template-review default may still be set by routing for template-related wording', params);

  const executorSource = readSource('src/renderer/services/skill-executors/sku-batch.executor.ts');
  // 钉桩翻转（治理2026-07-02，原钉桩过期）：旧断言要求"缺模板的完整生产用
  // shouldAutoPrepareSkuCardTemplateForProduction 跳过方向确认、静默自动准备占位模板"——
  // 这正是用户观察到"有概率用硬编码占位模板"的来源，与新治理相反。
  // 新语义：默认路径必须走 确认模板方向 → 移交 Agent 自主设计；硬编码占位模板只在
  // 显式兜底（explicitPlaceholderTemplateFallback）时可达，路由单一真相源是
  // shared/sku-template-design-loop.ts 的 resolveSkuTemplatePreparationRoute。
  // 行为级断言见 scripts/smoke-sku-template-design-loop.cjs。
  assert(
    !/shouldAutoPrepareSkuCardTemplateForProduction\s*\(/.test(executorSource),
    'sku-batch must not silently auto-prepare placeholder templates for full production with a missing template'
  );
  assert(
    /resolveSkuTemplatePreparationRoute/.test(executorSource)
      && /explicitPlaceholderTemplateFallback/.test(executorSource),
    'missing-template routing must come from the shared sku-template-design-loop single source with explicit-fallback gating'
  );
}

function testRenderLayoutNormalizesMissingBlockIds() {
  const source = readSource('src/renderer/services/tool-executor.service.ts');
  // 渲染桥（2026-07-06）后 blocks/regions 双模式共用同一次 id 归一化。
  assert(
    /\(regionMode \? rawSpecRegions : rawSpecBlocks\)\.map/.test(source)
      && /id:\s*id\s*\|\|\s*`\$\{role\}-\$\{index \+ 1\}`/.test(source),
    'renderLayout should normalize missing block ids so Photoshop layer names do not become undefined-*'
  );
  assert(
    /stageGroupName/.test(source)
      && /deletePreviousStageGroup/.test(source)
      && /moveLayerToStageGroup/.test(source),
    'renderLayout should replace the same stage draft group instead of stacking repeated stage renders'
  );
  assert(
    /deleteReusableDraftLayer/.test(source)
      && /buildExpectedTopLevelDraftLayerNames/.test(source),
    'renderLayout should also replace same-name top-level draft layers when a model omits stagePlan'
  );
}

function testRepeatedFrameworkReadDoesNotForceDocumentSequence() {
  // 重复读取同一方法论仍可被去重，但出口只能回到项目状态/证据判断，不能规定下一步必须建档或排版。
  const repeatedFrameworkRead = evaluateDesignToolStateGuard({
    context: detailPageDisciplineContext,
    state: createDesignDisciplineState({
      documentCreated: false,
      layoutRendered: false,
      designKnowledgeReadCount: 1,
      frameworkReadCount: 1
    }),
    toolName: 'getDetailPageDesignFramework'
  });

  assert(
    repeatedFrameworkRead === null
      || !['createDocument', 'renderLayout'].includes(repeatedFrameworkRead?.nextRequiredTool),
    'repeated framework reads must not force a document or layout sequence',
    repeatedFrameworkRead
  );
}

function buildValidDetailPageStagePlan() {
  return {
    targetDocumentName: '详情页',
    productUnderstanding: '短筒波点袜，整体是清新网感风格，重点突出花色、舒适和日常搭配。',
    currentStage: {
      id: 'hero',
      title: '首屏氛围',
      purpose: '先让买家一眼看到袜子款式和波点风格。',
      sellingPoint: '清新波点短筒袜',
      imageIntent: '使用项目中主体完整的袜子实拍图作为主视觉。',
      layoutRoles: ['background', 'main-image', 'title', 'selling-point'],
      observationFocus: '确认主视觉清楚、标题可读、卖点不遮挡产品。'
    }
  };
}

function testDetailPageStagePlanValidation() {
  const valid = validateCreativeStagePlan(buildValidDetailPageStagePlan());
  assert(valid.valid === true, 'valid detail-page stage plan should pass', valid);

  const invalid = validateCreativeStagePlan({
    targetDocumentName: '详情页',
    currentStage: {
      title: '首屏'
    }
  });
  assert(
    invalid.valid === false && invalid.blockers.length > 0,
    'incomplete detail-page stage plan should fail with blockers',
    invalid
  );
}

function testFreshDetailPageRenderLayoutRequiresStagePlan() {
  // 已建画布、有设计知识证据、尚未排版的状态：renderLayout 必须携带合法 stagePlan。
  const stagedState = createDesignDisciplineState({
    documentCreated: true,
    layoutRendered: false,
    designKnowledgeReadCount: 1,
    frameworkReadCount: 1
  });
  const missingPlan = evaluateDesignToolStateGuard({
    context: detailPageDisciplineContext,
    state: stagedState,
    toolName: 'renderLayout',
    toolParams: {
      canvas: { width: 790, height: 1200 },
      blocks: [
        { role: 'background', content: '#101827', heightRatio: 1 },
        { role: 'title', content: '清新波点短筒袜', heightRatio: 0.14 }
      ]
    }
  });
  assert(
    missingPlan && missingPlan.nextRequiredTool === 'renderLayout',
    'fresh detail-page renderLayout should require an explicit stagePlan',
    missingPlan
  );

  const withPlan = evaluateDesignToolStateGuard({
    context: detailPageDisciplineContext,
    state: stagedState,
    toolName: 'renderLayout',
    toolParams: {
      canvas: { width: 790, height: 1200 },
      stagePlan: buildValidDetailPageStagePlan(),
      blocks: [
        { role: 'background', content: '#101827', heightRatio: 1 },
        { role: 'title', content: '清新波点短筒袜', heightRatio: 0.14 },
        { role: 'selling-point', content: '波点花色  日常百搭', heightRatio: 0.1 }
      ]
    }
  });
  assert(withPlan === null, 'fresh detail-page renderLayout with valid stagePlan should not be blocked', withPlan);
}

function run() {
  testStagePlanContractLivesOutsideGenericExecutorPrompt();
  testExistingSkuSourceInstructionDisablesSourceRebuildForTemplateAndComboWork();
  testRenderLayoutNormalizesMissingBlockIds();
  testRepeatedFrameworkReadDoesNotForceDocumentSequence();
  testDetailPageStagePlanValidation();
  testFreshDetailPageRenderLayoutRequiresStagePlan();

  [
    '详情页文档就是详情页，SKU 就是 SKU。',
    '已有 SKU 色卡素材时，不应重建色卡源。'
  ].forEach((text, index) => assertNoMojibake(text, `autonomy-boundaries smoke ${index}`));

  console.log('smoke-design-agent-autonomy-boundaries passed:', [
    'generic executor prompt contains no detail-page stage-plan instructions while Tool/Skill policy retains the explicit contract',
    'existing SKU source instructions keep source preparation disabled and missing-template routing stays explicit-fallback-only (no silent placeholder prep)',
    'renderLayout normalizes missing block ids before creating Photoshop layers',
    'repeated framework-read handling does not force document creation or renderLayout',
    'fresh detail-page renderLayout is bound to an Agent-owned stage plan through Tool/Skill policy'
  ].join('; '));
}

run();
