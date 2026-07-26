#!/usr/bin/env node
'use strict';

/**
 * smoke: SKU 无模板时「Agent 自主设计模板」闭环（治理2026-07-02）
 *
 * 用户预期：项目没有 SKU 模板时，Agent 应当自己设计一个 SKU 模板，且
 *   ① 设计必须有参考（不许凭空设计）
 *   ② 设计完成后必须添加占位符（便于批量处理）
 *   ③ 然后回到批量出图；
 * 硬编码占位模板生成只能作为用户显式要求的兜底。
 *
 * 钉桩：
 *   ① 默认无模板路径不再可达硬编码 preparation（除非显式要求）——默认弹「模板方向」确认卡，
 *      确认后移交 Agent 自主设计（pending_sku_template_design_agent_decision），全程零模板写调用。
 *   ② 尚未观察参考来源时模板画布创建被拦（design-discipline-runtime 执行点门禁），
 *      拒绝消息指路 searchEagleReferences / searchDesignKnowledge / analyzeAssetContent，且指路可达。
 *   ③ 设计产物无可解析占位符不得进批量，拒绝消息指路 createSkuPlaceholders → inspectTemplateLayout。
 *   ④ 显式要求默认/占位模板时兜底可用，产物命名与消息明示「通用占位模板（非设计稿）」，
 *      且兜底完成后回到批量流程（组合确认）。
 */

const path = require('path');
const Module = require('module');

require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '..', 'tsconfig.json'),
  compilerOptions: {
    module: 'CommonJS',
    moduleResolution: 'node'
  }
});

const ROOT = path.resolve(__dirname, '..');

function assert(condition, message, detail) {
  if (!condition) {
    const error = new Error(message);
    if (detail !== undefined) error.detail = detail;
    throw error;
  }
}

const {
  hasExplicitSkuPlaceholderTemplateFallbackText,
  hasDeclinedSkuCardTemplateDesignText,
  resolveSkuTemplatePreparationRoute,
  buildSkuTemplateDesignHandoffContract,
  evaluateSkuTemplatePlaceholderBatchEntryGate
} = require(path.join(ROOT, 'src', 'shared', 'sku-template-design-loop.ts'));
const {
  buildSkuCardTemplatePreparationPlan
} = require(path.join(ROOT, 'src', 'shared', 'sku-card-template-preparation-plan.ts'));
const {
  resolveDesignDisciplineContext,
  createDesignDisciplineState,
  applyDesignDisciplineProgress,
  evaluateDesignToolStateGuard
} = require(path.join(ROOT, 'src', 'shared', 'design-discipline-runtime.ts'));
const {
  SKU_TEMPLATE_DESIGN_TASK_TYPE_ID,
  resolveDeclaredDesignTaskTypeIdFromControlPlaneSignals
} = require(path.join(ROOT, 'src', 'shared', 'design-task-types.ts'));
const {
  buildAgentIntentControlPlaneDecision
} = require(path.join(ROOT, 'src', 'shared', 'agent-intent-control-plane.ts'));

// ── ① + ④ 前置：路由纯函数（缺模板时的唯一真相源） ──

function testPreparationRoutePureLogic() {
  const routeOf = (userInput, extras = {}) => resolveSkuTemplatePreparationRoute({
    userInput,
    params: extras.params || {},
    templateDesignConfirmed: extras.confirmed === true
  }).route;

  // 默认路径（只说做 SKU）→ 先确认模板方向
  assert(routeOf('帮我批量做SKU，规格2-3-4双装') === 'confirmation_required',
    'default SKU request with missing templates must ask for template direction first');
  // 旧 autoPrepare 触发文本（缺模板+生产措辞）不再静默落硬编码
  assert(routeOf('项目没有模板，帮我批量生成 2双装 SKU 组合图') === 'confirmation_required',
    'missing-template production wording must not silently reach the hardcoded placeholder preparation');
  // 设计请求不是兜底请求
  assert(routeOf('没有模板，先帮我设计一版SKU模板') === 'confirmation_required',
    'a design request must not be misread as an explicit placeholder fallback');
  // 方向确认后 → 移交 Agent 自主设计
  assert(routeOf('模板方向确认：确认。请继续。', { confirmed: true }) === 'agent_design_handoff',
    'confirmed template direction must hand off to agent-owned design');
  // 明确拒绝 → 不推进
  assert(routeOf('模板方向确认：需要调整') === 'blocked_missing_template',
    'declined template direction must not advance template generation');
  assert(hasDeclinedSkuCardTemplateDesignText('模板方向确认：需要调整') === true,
    'declined text helper should detect the confirmation-card decline');

  // 显式兜底文本
  assert(routeOf('占位模板就行，快速出一版') === 'placeholder_preparation',
    'explicit placeholder wording must reach the placeholder fallback');
  assert(routeOf('用默认占位模板，继续批量出图') === 'placeholder_preparation',
    'explicit default-placeholder wording must reach the placeholder fallback');
  assert(routeOf('随便什么都行', { params: { skuPlaceholderTemplateFallbackApproved: true } }) === 'placeholder_preparation',
    'explicit fallback param must reach the placeholder fallback');
  // 反向表述不算显式兜底
  assert(routeOf('不要用默认模板，帮我认真设计一版') === 'confirmation_required',
    'negated default-template wording must not be treated as an explicit fallback');
  assert(hasExplicitSkuPlaceholderTemplateFallbackText('帮我做SKU') === false,
    'plain SKU request is not an explicit placeholder fallback');
}

// ── ② 参考先行门禁（执行点确定性检查 + 指路可达交叉验证） ──

function testReferenceFirstGate() {
  const context = resolveDesignDisciplineContext({
    taskText: 'SKU模板设计：帮我设计一版SKU色卡模板',
    isCreativeDesignIntent: true
  });
  assert(context.active === true && context.taskTypeId === 'ecommerce.sku_template.v1',
    'SKU template design task should resolve to the sku_template task type', context);
  assert(context.requiresReferenceInput === true,
    'sku_template task type must require a reference observation before document creation', context);

  const freshState = createDesignDisciplineState();
  const blocked = evaluateDesignToolStateGuard({
    context,
    state: freshState,
    toolName: 'createDocument'
  });
  assert(blocked && /searchEagleReferences/.test(blocked.message)
    && /searchDesignKnowledge/.test(blocked.message)
    && /analyzeAssetContent/.test(blocked.message),
    'createDocument without a reference observation must be blocked with reachable retrieval tools named', blocked);
  assert(blocked.nextRequiredTool === 'searchEagleReferences',
    'reference gate should point to searchEagleReferences as the next tool', blocked);

  // 指路可达交叉验证：被指路的工具本身不被任何门禁拦截
  for (const toolName of ['searchEagleReferences', 'searchDesignKnowledge', 'analyzeAssetContent']) {
    const gate = evaluateDesignToolStateGuard({ context, state: freshState, toolName });
    assert(gate === null, `suggested tool ${toolName} must itself be reachable (not blocked)`, gate);
  }
  // 任一参考来源观察成功后放行；通用「知识先行」gate 已移除，不再叠加第二道品类无关门禁。
  const withEagle = applyDesignDisciplineProgress(freshState, 'searchEagleReferences', true, {
    frameworkToolName: context.frameworkToolName
  });
  assert(withEagle.referenceInputCount === 1, 'eagle reference should count as reference input', withEagle);
  const afterReferenceObservation = evaluateDesignToolStateGuard({ context, state: withEagle, toolName: 'createDocument' });
  assert(afterReferenceObservation === null,
    'createDocument must pass after one reference observation (eagle search also counts as knowledge)', afterReferenceObservation);

  // analyzeAssetContent 本身就是有效参考观察：SKU 显式 reference-first 满足后应直接放行。
  const withAssetOnly = applyDesignDisciplineProgress(freshState, 'analyzeAssetContent', true, {
    frameworkToolName: context.frameworkToolName
  });
  assert(evaluateDesignToolStateGuard({ context, state: withAssetOnly, toolName: 'createDocument' }) === null,
    'an asset reference observation must satisfy SKU reference-first without a removed generic knowledge gate');

  // 用户消息自带参考来源 = 已提供一条参考来源，不要求再人为补一次知识调用。
  const contextWithUserReference = resolveDesignDisciplineContext({
    taskText: 'SKU模板设计：帮我设计一版SKU色卡模板',
    isCreativeDesignIntent: true,
    hasReferenceSource: true
  });
  assert(evaluateDesignToolStateGuard({
    context: contextWithUserReference,
    state: createDesignDisciplineState(),
    toolName: 'createDocument'
  }) === null, 'user-supplied reference source must satisfy the reference gate');

  // 非 reference-first 品类不受影响；通用知识 gate 已移除，fresh state 也可由 Planner 自主开稿。
  const detailContext = resolveDesignDisciplineContext({
    taskText: '请基于项目素材从零创建一个详情页文档',
    isCreativeDesignIntent: true
  });
  assert(detailContext.requiresReferenceInput === false,
    'detail-page task type must not enable the reference-first gate', detailContext);
  assert(evaluateDesignToolStateGuard({
    context: detailContext,
    state: createDesignDisciplineState(),
    toolName: 'createDocument'
  }) === null, 'detail-page createDocument must not inherit the SKU-only reference gate or removed knowledge gate');
}

// ── ②-fix 参考先行门禁在三个真实入口可达（评审修复 2026-07-03，F1） ──
//
// 评审列出的三个不可达入口：
//   入口A：控制面对「帮我设计一版SKU模板」只发 sku_template_design_autonomy（不发
//         explicit_creative_design）→ isCreativeDesignIntent=false → 纪律不激活；
//   入口B：行为足迹激活必然发生在首次 createDocument 成功之后，而参考先行门禁只查
//         !documentCreated → 永远错过；
//   入口C：确认卡重提交文本命中 excludeSignals（「出图」）→ taskText 匹配被排除 → 不激活。
// 修复：声明式任务类型通道（declaredTaskTypeId）——控制面信号数据映射 + 移交契约
// data.declaredDesignTaskTypeId 确定性激活，优先于 taskText 关键词/排除信号。

function testReferenceGateReachableFromRealEntryPoints() {
  // 入口A：控制面信号 → 数据映射 → 声明式激活（不依赖 explicit_creative_design）
  const entryDecision = buildAgentIntentControlPlaneDecision({ userInput: '帮我设计一版SKU模板' });
  assert(entryDecision.matchedSignals.includes('sku_template_design_autonomy'),
    'entry A: control plane must emit sku_template_design_autonomy for the SKU template design request', entryDecision);
  assert(!entryDecision.matchedSignals.includes('explicit_creative_design'),
    'entry A precondition: the request does not carry explicit_creative_design (this was the hole)', entryDecision);
  const declaredFromSignals = resolveDeclaredDesignTaskTypeIdFromControlPlaneSignals(entryDecision.matchedSignals);
  assert(declaredFromSignals === SKU_TEMPLATE_DESIGN_TASK_TYPE_ID,
    'entry A: control-plane signals must map to the sku_template task type id', declaredFromSignals);
  const entryContext = resolveDesignDisciplineContext({
    taskText: '帮我设计一版SKU模板',
    isCreativeDesignIntent: false,
    declaredTaskTypeId: declaredFromSignals
  });
  assert(entryContext.active === true && entryContext.taskTypeId === SKU_TEMPLATE_DESIGN_TASK_TYPE_ID,
    'entry A: declared task type must activate the discipline context without explicit_creative_design', entryContext);
  const entryGate = evaluateDesignToolStateGuard({
    context: entryContext,
    state: createDesignDisciplineState({ designKnowledgeReadCount: 1 }),
    toolName: 'createDocument'
  });
  assert(entryGate && /searchEagleReferences/.test(entryGate.message),
    'entry A: the reference-first gate must now be reachable (createDocument blocked without a reference observation)', entryGate);

  // 入口B：移交契约携带声明式 id，激活发生在移交时（documentCreated=false），
  // 门禁在首次 createDocument 之前就能拦——不再依赖「必然晚于 createDocument」的行为足迹。
  const handoff = buildSkuTemplateDesignHandoffContract({ missingSizes: [2, 3], colorCount: 5 });
  assert(handoff.declaredDesignTaskTypeId === SKU_TEMPLATE_DESIGN_TASK_TYPE_ID,
    'entry B: handoff contract must carry the declared task type id for deterministic activation', handoff);
  const handoffContext = resolveDesignDisciplineContext({
    taskText: '帮我批量做SKU，规格2-3-4双装',
    isCreativeDesignIntent: false,
    declaredTaskTypeId: handoff.declaredDesignTaskTypeId
  });
  assert(handoffContext.active === true && handoffContext.requiresReferenceInput === true,
    'entry B: handoff-declared task type must activate the reference-first discipline', handoffContext);
  const preDocumentState = createDesignDisciplineState({ designKnowledgeReadCount: 1 });
  assert(preDocumentState.documentCreated === false,
    'entry B precondition: at handoff time no document has been created yet');
  const handoffGate = evaluateDesignToolStateGuard({
    context: handoffContext,
    state: preDocumentState,
    toolName: 'createDocument'
  });
  assert(handoffGate && handoffGate.nextRequiredTool === 'searchEagleReferences',
    'entry B: createDocument right after handoff must hit the reference-first gate (was unreachable before)', handoffGate);

  // 入口C：确认卡重提交文本（含「出图」等 excludeSignals）——
  // 老路径（纯 taskText）不激活；声明式 id 优先于排除信号，确定性激活。
  const resubmitText = [
    '我已确认「确认 SKU 色卡模板方向」：模板方向确认：确认；',
    '视觉方向：按项目产品与素材风格自定，背景干净、商品卡片清晰留白；',
    '复核重点：产品图不溢出；出图前再看真实画面。；允许先生成可编辑基础模板：是',
    '请基于确认后的内容继续执行。'
  ].join('');
  const withoutDeclared = resolveDesignDisciplineContext({
    taskText: resubmitText,
    isCreativeDesignIntent: true
  });
  assert(withoutDeclared.active === false,
    'entry C precondition: resubmit text alone is killed by excludeSignals (the hole being fixed)', withoutDeclared);
  const resubmitDecision = buildAgentIntentControlPlaneDecision({ userInput: resubmitText });
  const resubmitDeclared = resolveDeclaredDesignTaskTypeIdFromControlPlaneSignals(resubmitDecision.matchedSignals);
  assert(resubmitDeclared === SKU_TEMPLATE_DESIGN_TASK_TYPE_ID,
    'entry C: confirmation-card resubmit still yields the declared task type id via control-plane signals', resubmitDecision);
  const resubmitContext = resolveDesignDisciplineContext({
    taskText: resubmitText,
    isCreativeDesignIntent: false,
    declaredTaskTypeId: resubmitDeclared
  });
  assert(resubmitContext.active === true && resubmitContext.taskTypeId === SKU_TEMPLATE_DESIGN_TASK_TYPE_ID,
    'entry C: declared task type must take priority over excludeSignals wording in the resubmit text', resubmitContext);

  // 未注册 id 不得激活（声明通道只做查表，不做猜测）
  const unknownDeclared = resolveDesignDisciplineContext({
    taskText: '随便聊聊',
    isCreativeDesignIntent: false,
    declaredTaskTypeId: 'not.registered.v1'
  });
  assert(unknownDeclared.active === false,
    'declared channel must not activate for unregistered task type ids', unknownDeclared);
}

// ── ②-fix SKU 模板纪律激活态下，移交清单工具不被状态门禁阻断 ──
// Tool 发现与 schema 可达性由统一 Registry / Capability Resolver 守护，本纪律不再维护品类暴露表。

function testSkuTemplateChecklistToolsReachableUnderDiscipline() {
  const context = resolveDesignDisciplineContext({
    taskText: '帮我设计一版SKU模板',
    isCreativeDesignIntent: false,
    declaredTaskTypeId: SKU_TEMPLATE_DESIGN_TASK_TYPE_ID
  });
  assert(context.active === true && context.spec, 'sku_template discipline context should activate', context);

  // 端到端状态机：参考 → 建画布 → 排版 → 观察 → 占位/布局 → 再观察 → 保存 → 回批量。
  // 占位与布局同属 Photoshop 写入；当前 Harness 要求任意写后保存前必须重新观察。
  const fw = { frameworkToolName: context.frameworkToolName };
  let state = createDesignDisciplineState();
  state = applyDesignDisciplineProgress(state, 'searchEagleReferences', true, fw);
  assert(evaluateDesignToolStateGuard({ context, state, toolName: 'createDocument' }) === null,
    'createDocument must pass after a reference observation');
  state = applyDesignDisciplineProgress(state, 'createDocument', true, fw);
  assert(evaluateDesignToolStateGuard({ context, state, toolName: 'renderLayout' }) === null,
    'renderLayout must pass after document creation');
  state = applyDesignDisciplineProgress(state, 'renderLayout', true, fw);
  assert(evaluateDesignToolStateGuard({ context, state, toolName: 'getCanvasSnapshot' }) === null,
    'observation must pass after layout');
  state = applyDesignDisciplineProgress(state, 'getCanvasSnapshot', true, fw);
  for (const toolName of ['createSkuPlaceholders', 'skuLayout']) {
    const gate = evaluateDesignToolStateGuard({ context, state, toolName });
    assert(gate === null,
      `checklist tool ${toolName} must be reachable in the designed+observed state (no interlock)`, gate);
    state = applyDesignDisciplineProgress(state, toolName, true, fw);
  }
  const saveBeforeObservation = evaluateDesignToolStateGuard({ context, state, toolName: 'saveDocument' });
  assert(saveBeforeObservation && ['getAnnotatedSnapshot', 'getCanvasSnapshot'].includes(saveBeforeObservation.nextRequiredTool),
    'writes after the first review must require a fresh observation before save', saveBeforeObservation);
  const observationTool = saveBeforeObservation.nextRequiredTool;
  assert(evaluateDesignToolStateGuard({ context, state, toolName: observationTool }) === null,
    'the observation named by the save gate must itself be reachable');
  state = applyDesignDisciplineProgress(state, observationTool, true, fw);
  assert(evaluateDesignToolStateGuard({ context, state, toolName: 'saveDocument' }) === null,
    'saveDocument must pass after the post-write observation');
  state = applyDesignDisciplineProgress(state, 'saveDocument', true, fw);
  assert(evaluateDesignToolStateGuard({ context, state, toolName: 'sku-batch' }) === null,
    'sku-batch must remain reachable after the designed template is observed and saved');
}

// ── ③ 设计后占位闭环：无可解析占位符不得进批量，指路 createSkuPlaceholders ──

function testPlaceholderBatchEntryGate() {
  const blocked = evaluateSkuTemplatePlaceholderBatchEntryGate({
    size: 3,
    action: 'execute',
    templateName: '3双装模板',
    expectedItemCount: 3,
    placeholderCount: 0,
    skuPlaceholderInspectionStatus: 'inspected',
    hasReliableSkuPlaceholders: false
  });
  assert(blocked && /createSkuPlaceholders/.test(blocked.message) && /inspectTemplateLayout/.test(blocked.message),
    'designed template without parseable placeholders must be blocked with createSkuPlaceholders guidance', blocked);

  assert(evaluateSkuTemplatePlaceholderBatchEntryGate({
    size: 3,
    action: 'execute',
    templateName: '3双装模板',
    expectedItemCount: 3,
    placeholderCount: 3,
    skuPlaceholderInspectionStatus: 'inspected',
    hasReliableSkuPlaceholders: true
  }) === null, 'reliable placeholders must not be blocked');

  assert(evaluateSkuTemplatePlaceholderBatchEntryGate({
    size: 3,
    action: 'execute',
    templateName: '3双装模板',
    expectedItemCount: 3,
    placeholderCount: 0,
    skuPlaceholderInspectionStatus: 'unknown',
    hasReliableSkuPlaceholders: undefined
  }) === null, 'uninspected templates keep the original non-blocking semantics (runtime readiness gate unchanged)');

  const contract = buildSkuTemplateDesignHandoffContract({ missingSizes: [2, 3], colorCount: 5 });
  assert(contract.status === 'pending_sku_template_design_agent_decision',
    'handoff contract must use the agent-decision status', contract);
  assert(contract.completionChecklist.some((item) => item.includes('createSkuPlaceholders'))
    && contract.completionChecklist.some((item) => item.includes('inspectTemplateLayout'))
    && contract.completionChecklist.some((item) => item.includes('模板文件')),
    'handoff checklist must contain the placeholder closure steps', contract);
  assert(contract.requiredReferenceObservationTools.includes('searchEagleReferences'),
    'handoff contract must name the reference observation tools', contract);
}

// ── ④ 前置：占位模板产物命名明示「通用占位」 ──

function testPlaceholderPlanNaming() {
  const plan = buildSkuCardTemplatePreparationPlan({
    projectPath: 'E:/fixture',
    requiredSizes: [2]
  });
  assert(plan.status === 'ready_for_preparation', 'placeholder plan should be buildable', plan);
  assert(plan.templateOutputs.every((output) => output.name.includes('通用占位')),
    'placeholder template outputs must be named as generic placeholders (非设计稿)', plan.templateOutputs);
}

// ── 执行器行为（harness：mock 工具层与 window，桥不接 Photoshop） ──

function createSkuLayoutCapabilities() {
  return {
    success: true,
    data: {
      schema: 'sku-layout-capabilities/v0',
      actions: ['getCapabilities', 'listLayerSets', 'execute', 'arrangeDynamic'],
      supportsNoPlaceholderAutoLayout: true,
      noPlaceholderAutoLayout: {
        revision: 'sku-no-placeholder-auto-layout/v2',
        actions: ['execute', 'arrangeDynamic'],
        returnsActualSubjectBoundsQa: true
      },
      supportsRecursiveSkuLayerSets: true,
      skuSourceColorGroups: {
        revision: 'sku-recursive-color-layer-groups/v1',
        actions: ['listLayerSets', 'execute', 'arrangeDynamic'],
        recursiveLayerSets: true,
        canResolveNestedColorGroups: true,
        returnsLayerSetPaths: true
      },
      comboExportNaming: {
        revision: 'sku-combo-export-naming/v1',
        usesColorComboAsFileName: true,
        keepsExecutionOrderOutOfFileName: true
      }
    }
  };
}

function createHarness() {
  const records = [];
  const savedTemplatePaths = [];
  const docs = [
    { name: 'SKU.psb', path: 'E:\\fixture\\PSD\\SKU.psb', width: 800, height: 800 }
  ];

  async function executeToolCall(toolName, params = {}) {
    records.push({ toolName, params: { ...params } });
    if (toolName === 'listDocuments') {
      return { success: true, documents: docs.map((doc) => ({ ...doc })) };
    }
    if (toolName === 'switchDocument') {
      return { success: true, documentName: params.documentName || 'SKU.psb' };
    }
    if (toolName === 'saveDocument' && typeof params.path === 'string' && params.path.trim()) {
      savedTemplatePaths.push(params.path);
      return { success: true, path: params.path };
    }
    if (toolName === 'skuLayout') {
      if (params.action === 'getCapabilities') return createSkuLayoutCapabilities();
      if (params.action === 'listLayerSets') {
        return {
          success: true,
          data: {
            recursive: true,
            layerSets: ['奶白', '粉色', '浅咖', '灰色', '黑色'].map((name) => ({ name, path: [name] }))
          }
        };
      }
      if (params.action === 'inspectTemplateLayout') {
        return {
          success: true,
          data: {
            templateName: params.templateDocName,
            mode: 'placeholders',
            slotCount: params.expectedItemCount,
            blockers: [],
            warnings: []
          }
        };
      }
      return { success: true, data: { exportedFiles: [] } };
    }
    if (toolName === 'searchProjectResources') {
      return { success: true, results: [] };
    }
    return { success: true };
  }

  return { records, savedTemplatePaths, executeToolCall };
}

function installModuleMocks(harness) {
  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === '../tool-executor.service') {
      return { executeToolCall: harness.executeToolCall };
    }
    if (request === '../../stores/app.store') {
      return {
        useAppStore: {
          getState: () => ({ currentProject: { path: 'E:\\fixture' } })
        }
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  return () => {
    Module._load = originalLoad;
  };
}

async function runExecutor(params) {
  const harness = createHarness();
  const restore = installModuleMocks(harness);
  const statusMessages = [];
  try {
    const executorModulePath = path.join(ROOT, 'src', 'renderer', 'services', 'skill-executors', 'sku-batch.executor.ts');
    delete require.cache[require.resolve(executorModulePath)];
    const { skuBatchExecutor } = require(executorModulePath);

    global.window = {
      designEcho: {
        invoke: async () => null,
        readDirectory: async (dir) => {
          const normalized = String(dir || '').replace(/\\/g, '/');
          if (normalized.endsWith('/模板文件')) {
            return harness.savedTemplatePaths.map((filePath) => ({ type: 'file', path: filePath }));
          }
          return [];
        },
        chat: async () => ({
          text: JSON.stringify({
            mode: 'default',
            countPerSize: 1,
            generateNotes: true,
            specifiedCombos: [],
            appendMonochromeColors: [],
            targetSizes: [],
            reasoning: '默认组合'
          })
        })
      }
    };

    const result = await skuBatchExecutor.execute({
      params,
      callbacks: {
        onStatus: (message) => statusMessages.push(String(message || ''))
      }
    });
    return { result, records: harness.records, savedTemplatePaths: harness.savedTemplatePaths, statusMessages };
  } finally {
    restore();
    delete global.window;
  }
}

function templateWriteCalls(records) {
  const writeTools = new Set(['createDocument', 'createRectangle', 'createTextLayer', 'createSkuPlaceholders', 'saveDocument']);
  return records.filter((record) => writeTools.has(record.toolName));
}

async function testDefaultMissingTemplatePathAsksDirectionWithoutHardcodedPrep() {
  const run = await runExecutor({
    comboSizes: [2, 3],
    countPerSize: 1,
    generateNotes: false,
    skuFileKeyword: 'SKU',
    userIntent: '帮我批量做SKU，规格是2双装和3双装，每个规格1个组合。'
  });
  assert(run.result.success === true, 'default missing-template path should pause, not hard-fail', run.result);
  assert(run.result.data?.status === 'pending_sku_card_template_design_confirmation',
    'default missing-template path must ask for template direction (no dead end, no hardcoded prep)', run.result.data);
  assert(Array.isArray(run.result.data?.interactiveCards)
    && run.result.data.interactiveCards.some((card) => card.kind === 'editable_confirmation'),
    'template direction confirmation must expose an editable card', run.result.data);
  assert(templateWriteCalls(run.records).length === 0,
    'default path must not run any hardcoded placeholder-template Photoshop writes', run.records);
  assert(String(run.result.message || '').includes('自主设计'),
    'confirmation message must state that the Agent will design the template after confirmation', run.result.message);

  // 评审修复 2026-07-03（F3）：无项目品类上下文时，方向卡默认值必须中性——
  // 不硬编码「袜子 / 卡片式 SKU / ins 风格」，且默认文案不携带 excludeSignals 措辞（如「出图」），
  // 避免确认卡重提交文本误杀后续纪律激活。
  const directionCard = run.result.data.interactiveCards.find((card) => card.kind === 'editable_confirmation');
  const cardFields = directionCard?.payload?.fields || [];
  const fieldTexts = cardFields
    .map((field) => `${field.label}：${typeof field.value === 'boolean' ? (field.value ? '是' : '否') : String(field.value || '')}`)
    .join('；');
  assert(!/袜子|ins\s*风|卡片式\s*SKU/i.test(fieldTexts),
    'direction card defaults must not hardcode product category or style without project context', fieldTexts);
  assert(!/出图|批量/.test(fieldTexts),
    'direction card default field texts must avoid sku_template excludeSignals wording (出图/批量)', fieldTexts);
  assert(/按项目产品与素材风格自定/.test(fieldTexts),
    'direction card style default must fall back to the neutral project-derived wording', fieldTexts);
  const productHints = directionCard?.payload?.productHints || {};
  assert(!productHints.productType && !productHints.style,
    'direction card productHints must omit productType/style when no project context exists', productHints);

  // 中文回读校验：卡片默认文案不得出现乱码（UTF-8 链路）
  assert(!/[鈥鎻锟®]/.test(fieldTexts) && /主体不溢出/.test(fieldTexts),
    'direction card Chinese defaults must survive the UTF-8 round trip', fieldTexts);
}

async function testConfirmedDirectionHandsOffToAgentDesignInsteadOfHardcodedPrep() {
  const run = await runExecutor({
    comboSizes: [2, 3],
    countPerSize: 1,
    generateNotes: false,
    skuFileKeyword: 'SKU',
    requireSkuCardTemplateDesignConfirmation: true,
    allowSkuCardTemplatePreparation: true,
    skuTemplatePreparationMode: 'card-placeholder-templates',
    userIntent: '模板方向确认：确认。请按确认后的模板方案继续 2双装、3双装组合。'
  });
  assert(run.result.success === false && run.result.nonFatal === true,
    'confirmed direction should hand off as a non-fatal agent observation', run.result);
  assert(run.result.data?.status === 'pending_sku_template_design_agent_decision',
    'confirmed direction must hand off to agent-owned template design, not the hardcoded preparation', run.result.data);
  assert(run.result.data?.declaredDesignTaskTypeId === SKU_TEMPLATE_DESIGN_TASK_TYPE_ID,
    'executor handoff payload must carry declaredDesignTaskTypeId so the loop can deterministically activate the discipline (F1 entry B)', run.result.data);
  assert(Array.isArray(run.result.data?.completionChecklist)
    && run.result.data.completionChecklist.some((item) => String(item).includes('createSkuPlaceholders')),
    'handoff must carry the placeholder closure checklist', run.result.data);
  assert(Array.isArray(run.result.data?.requiredReferenceObservationTools)
    && run.result.data.requiredReferenceObservationTools.includes('searchEagleReferences'),
    'handoff must carry the reference-first requirement', run.result.data);
  assert(templateWriteCalls(run.records).length === 0,
    'confirmed direction must not run hardcoded placeholder-template writes', run.records);
}

async function testExplicitPlaceholderFallbackStillWorksAndIsLabeled() {
  const run = await runExecutor({
    comboSizes: [2],
    countPerSize: 1,
    generateNotes: false,
    skuFileKeyword: 'SKU',
    requireSkuComboConfirmation: true,
    userIntent: '项目没有模板，用默认占位模板快速出一版就行，继续生成 2双装 SKU 组合图。'
  });
  assert(run.records.some((record) => record.toolName === 'createSkuPlaceholders'),
    'explicit fallback must run the placeholder preparation (createSkuPlaceholders)', run.records);
  assert(run.savedTemplatePaths.length > 0
    && run.savedTemplatePaths.every((filePath) => filePath.includes('通用占位')),
    'fallback template artifacts must be named as generic placeholders', run.savedTemplatePaths);
  assert(run.statusMessages.some((message) => message.includes('通用占位模板（非设计稿）')),
    'fallback progress messages must state 通用占位模板（非设计稿）', run.statusMessages);
  assert(run.result.data?.status === 'pending_sku_combo_confirmation',
    'after the explicit fallback prepared templates, the flow must return to batch (combo confirmation)', run.result.data);
}

// ── ②-fix 接线钉桩：自主循环包装器与移交激活通道保持接线（文本级，防悄然拆线） ──

function testAutonomousExecutorDeclaredChannelWiring() {
  const fs = require('fs');
  const executorSource = fs.readFileSync(
    path.join(ROOT, 'src', 'renderer', 'services', 'skill-executors', 'autonomous-agent.executor.ts'),
    'utf8'
  );
  assert(/declaredTaskTypeId:\s*resolveDeclaredDesignTaskTypeIdForAutonomousRun\(params\)/.test(executorSource),
    'resolveAutonomousDesignDisciplineContext must pass the declared task type id channel (F1 entry A wiring)');
  assert(/resolveDeclaredDesignTaskTypeIdFromControlPlaneSignals\(/.test(executorSource),
    'executor must translate control-plane signals via the shared data map (no category literals)');
  const bindCallCount = (executorSource.match(/bindDeclaredDisciplineContextFromToolResult\(result\)/g) || []).length;
  assert(bindCallCount >= 2,
    `handoff activation must be wired on both skill-tool and atomic-tool result paths (found ${bindCallCount})`);
  assert(!/ecommerce\.sku_template\.v1/.test(executorSource),
    'executor must stay generic: no sku_template task type literal (data lives in design-task-types)');
}

// ── 治理2026-07-06：用户模板优先于生成占位物 + 占位符排布=设计决策（知识载体三处） ──

function testUserTemplatePriorityAndPlacementDesignKnowledge() {
  const fs = require('fs');
  const executorSource = fs.readFileSync(
    path.join(ROOT, 'src', 'renderer', 'services', 'skill-executors', 'sku-batch.executor.ts'),
    'utf8'
  );
  // 打分反转：生成占位模板（卡片模板v{n}）一律减分，旧的"版号加分"不得回归
  assert(/if \(cardRevision > 0\) score -= 80;/.test(executorSource),
    'generated placeholder templates must be demoted in library scoring (score -= 80)');
  assert(!/score \+= 30 \+ cardRevision/.test(executorSource),
    'the old revision bonus (score += 30 + cardRevision) must not come back — user templates must win');
  // 兜底选中生成占位物时透明告知并指路设计
  assert(executorSource.includes('当前使用通用占位模板（非设计稿）'),
    'selecting a generated placeholder template must be announced as 非设计稿 with a design exit');

  // handoff 契约：占位符步骤按版面构图规划 slots；产物按用户规格命名习惯
  const contract = buildSkuTemplateDesignHandoffContract({ missingSizes: [3], colorCount: 8 });
  assert(contract.completionChecklist.some((item) => item.includes('slots 显式传给 createSkuPlaceholders') && item.includes('getLayerBounds')),
    'checklist must teach planning slot geometry from the designed layout before createSkuPlaceholders', contract.completionChecklist);
  assert(contract.completionChecklist.some((item) => item.includes('3双装自选备注') && item.includes('不要用「通用占位」')),
    'checklist must teach user-style spec naming and forbid generator naming', contract.completionChecklist);

  // 模型侧工具描述：占位槽几何=排版设计决策，slots 优先
  const schemaSource = fs.readFileSync(
    path.join(ROOT, 'src', 'renderer', 'services', 'agent-runtime', 'tool-schemas.ts'),
    'utf8'
  );
  assert(/createSkuPlaceholders[\s\S]{0,600}排版设计决策[\s\S]{0,200}slots 显式/.test(schemaSource),
    'createSkuPlaceholders tool schema must teach slots-first placement as a design decision');

  // UXP 侧描述同步（一致性卫生）
  const uxpToolSource = fs.readFileSync(
    path.join(ROOT, '..', 'DesignEcho-UXP', 'src', 'tools', 'sku', 'sku-config-tools.ts'),
    'utf8'
  );
  assert(uxpToolSource.includes('排版设计决策'),
    'UXP createSkuPlaceholders schema description must stay in sync (slots-first design decision)');
}

async function main() {
  testPreparationRoutePureLogic();
  testReferenceFirstGate();
  testReferenceGateReachableFromRealEntryPoints();
  testSkuTemplateChecklistToolsReachableUnderDiscipline();
  testAutonomousExecutorDeclaredChannelWiring();
  testPlaceholderBatchEntryGate();
  testPlaceholderPlanNaming();
  testUserTemplatePriorityAndPlacementDesignKnowledge();
  await testDefaultMissingTemplatePathAsksDirectionWithoutHardcodedPrep();
  await testConfirmedDirectionHandsOffToAgentDesignInsteadOfHardcodedPrep();
  await testExplicitPlaceholderFallbackStillWorksAndIsLabeled();
  console.log('[smoke-sku-template-design-loop] pass');
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  if (error && error.detail !== undefined) {
    console.error(JSON.stringify(error.detail, null, 2));
  }
  process.exit(1);
});
