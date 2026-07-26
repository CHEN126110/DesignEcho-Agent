const assert = require('assert');
const fs = require('fs');
const path = require('path');

require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '..', 'tsconfig.main.json')
});

const {
  buildDesignDocumentRoleContext,
  evaluateCreateDocumentTargetBoundary,
  inferDesignDocumentRoleFromName,
  isCreateDocumentOperation,
  normalizeCreateDocumentParamsForDesignRole,
  normalizeLayoutParamsForDesignRole
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'design-document-role.ts'));
const {
  buildAgentPerformancePolicy,
  buildAutonomousAgentRuntimeBudget
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'agent-performance-policy.ts'));
const {
  buildAgentTaskPublicPlanExecutionRequest
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'agent-task-public-plan-execution-request.ts'));
const {
  findSkillRoutingIntent,
  matchesSkillRoutingIntent
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'skill-routing.ts'));

function assertNoMojibake(text, label) {
  const suspiciousTokens = [
    0x93b4,
    0x93c9,
    0x951b,
    0x95c8,
    0xfffd
  ].map((codePoint) => String.fromCodePoint(codePoint));
  const found = suspiciousTokens.filter((token) => text.includes(token));
  assert.strictEqual(found.length, 0, `${label} contains mojibake tokens: ${found.join(', ')}`);
}

assert.strictEqual(inferDesignDocumentRoleFromName('详情页'), 'detailPage');
assert.strictEqual(inferDesignDocumentRoleFromName('详情页文档'), 'detailPage');
assert.strictEqual(inferDesignDocumentRoleFromName('商品详情.psb'), 'detailPage');
assert.strictEqual(inferDesignDocumentRoleFromName('SKU'), 'sku');
assert.strictEqual(inferDesignDocumentRoleFromName('SKU.psb'), 'sku');
assert.strictEqual(inferDesignDocumentRoleFromName('PSD/SKU-card-source.psb'), 'sku');
assert.strictEqual(inferDesignDocumentRoleFromName('夏季活动海报.psd'), 'poster');
assert.strictEqual(inferDesignDocumentRoleFromName('店铺横幅.psb'), 'banner');
assert.strictEqual(inferDesignDocumentRoleFromName('2双自选备注-卡片模板.psd'), 'unknown');
assert.strictEqual(inferDesignDocumentRoleFromName('4双装-卡片模板.psd'), 'unknown');
assert.strictEqual(inferDesignDocumentRoleFromName('组合图成品.psd'), 'unknown');

const roleContext = buildDesignDocumentRoleContext({
  userInput: '请基于当前项目素材从零创建一个电商袜子详情页文档。详情页文档按名称识别，详情页就是详情页；如果当前打开的是 SKU 文档，不要把 SKU 当详情页模板。',
  currentDocumentName: 'SKU'
});

assert.strictEqual(roleContext.targetRole, 'detailPage', JSON.stringify(roleContext, null, 2));
assert.strictEqual(roleContext.currentRole, 'sku', JSON.stringify(roleContext, null, 2));
assert.strictEqual(roleContext.canReuseCurrentDocument, false, JSON.stringify(roleContext, null, 2));
assert(
  roleContext.agentInstruction.includes('当前打开的是 SKU 文档')
    && roleContext.agentInstruction.includes('目标是详情页文档')
    && roleContext.agentInstruction.includes('不要把当前文档当作详情页模板'),
  roleContext.agentInstruction
);

const referenceDetailToPosterContext = buildDesignDocumentRoleContext({
  userInput: '参考这张详情页做海报，保留可编辑文字层',
  currentDocumentName: '商品详情页.psd'
});
assert.strictEqual(referenceDetailToPosterContext.targetRole, 'poster', JSON.stringify(referenceDetailToPosterContext, null, 2));
assert.strictEqual(referenceDetailToPosterContext.currentRole, 'detailPage', JSON.stringify(referenceDetailToPosterContext, null, 2));
assert.strictEqual(referenceDetailToPosterContext.currentDocumentUse, 'separate_target', JSON.stringify(referenceDetailToPosterContext, null, 2));
assert.strictEqual(referenceDetailToPosterContext.canReuseCurrentDocument, false, JSON.stringify(referenceDetailToPosterContext, null, 2));

const referencePosterToDetailContext = buildDesignDocumentRoleContext({
  userInput: '参考这张海报做详情页，文字保持可编辑',
  currentDocumentName: '活动海报.psd'
});
assert.strictEqual(referencePosterToDetailContext.targetRole, 'detailPage', JSON.stringify(referencePosterToDetailContext, null, 2));
assert.strictEqual(referencePosterToDetailContext.currentRole, 'poster', JSON.stringify(referencePosterToDetailContext, null, 2));
assert.strictEqual(referencePosterToDetailContext.currentDocumentUse, 'separate_target', JSON.stringify(referencePosterToDetailContext, null, 2));

const selectedCopyContext = buildDesignDocumentRoleContext({
  userInput: '帮我修改当前选择的文案，改成突出透气感',
  currentDocumentName: '详情页.psb'
});
assert.strictEqual(selectedCopyContext.targetRole, 'unknown', JSON.stringify(selectedCopyContext, null, 2));
assert.strictEqual(selectedCopyContext.currentDocumentUse, 'reuse', JSON.stringify(selectedCopyContext, null, 2));
assert.strictEqual(selectedCopyContext.canReuseCurrentDocument, true, JSON.stringify(selectedCopyContext, null, 2));
assert.ok(selectedCopyContext.agentInstruction.includes('不要另建文档'), selectedCopyContext.agentInstruction);
const selectedCopyCreateBoundary = evaluateCreateDocumentTargetBoundary(selectedCopyContext);
assert.strictEqual(selectedCopyCreateBoundary.allowed, false, JSON.stringify(selectedCopyCreateBoundary, null, 2));
assert.strictEqual(selectedCopyCreateBoundary.code, 'create_document_would_fork_existing_target');

const unresolvedCurrentTarget = buildDesignDocumentRoleContext({
  userInput: '继续处理刚才的内容',
  currentDocumentName: '详情页.psb'
});
const unresolvedCreateBoundary = evaluateCreateDocumentTargetBoundary(unresolvedCurrentTarget);
assert.strictEqual(unresolvedCurrentTarget.currentDocumentUse, 'observe_only');
assert.strictEqual(unresolvedCreateBoundary.allowed, false);
assert.strictEqual(unresolvedCreateBoundary.nextRequiredTool, 'listDocuments');

assert.strictEqual(
  evaluateCreateDocumentTargetBoundary(referenceDetailToPosterContext).allowed,
  true,
  '明确的详情页→海报独立交付目标仍允许新建文档'
);
assert.strictEqual(isCreateDocumentOperation('createDocument', {}), true);
assert.strictEqual(isCreateDocumentOperation('document-management', { action: 'create' }), true);
assert.strictEqual(isCreateDocumentOperation('document-management', { action: 'switch' }), false);

const sameRoleCreateNewContext = buildDesignDocumentRoleContext({
  userInput: '创建另一个详情页版本',
  currentDocumentName: '详情页.psb',
  workMode: 'create_new'
});
assert.strictEqual(sameRoleCreateNewContext.currentDocumentUse, 'separate_target');
assert.strictEqual(evaluateCreateDocumentTargetBoundary(sameRoleCreateNewContext).allowed, true);

const structuredEditContext = buildDesignDocumentRoleContext({
  userInput: '继续',
  currentDocumentName: '详情页.psb',
  workMode: 'edit_existing'
});
assert.strictEqual(structuredEditContext.currentDocumentUse, 'reuse');
assert.strictEqual(evaluateCreateDocumentTargetBoundary(structuredEditContext).allowed, false);

const detailCreateParams = normalizeCreateDocumentParamsForDesignRole('detailPage', {
  width: 790,
  height: 1600
});
assert.deepStrictEqual(detailCreateParams, {
  width: 790,
  height: 1600,
  name: '详情页',
  preset: 'detail-page'
});

const canonicalDetailCreateParams = normalizeCreateDocumentParamsForDesignRole('detailPage', {
  width: 800,
  height: 1200,
  name: '临时详情页草稿-790x1200'
}, { canonicalName: true, canonicalDimensions: true });
assert.strictEqual(canonicalDetailCreateParams.name, '详情页');
assert.strictEqual(canonicalDetailCreateParams.preset, 'detail-page');
assert.strictEqual(canonicalDetailCreateParams.width, 790);

const canonicalDetailLayoutParams = normalizeLayoutParamsForDesignRole('detailPage', {
  canvas: { width: 800, height: 1200 },
  blocks: [{ role: 'title', content: '舒适透气运动袜', heightRatio: 0.2 }]
}, { canonicalDimensions: true });
assert.strictEqual(canonicalDetailLayoutParams.canvas.width, 790);
assert.strictEqual(canonicalDetailLayoutParams.canvas.height, 1200);

const skuCreateParams = normalizeCreateDocumentParamsForDesignRole('sku', {
  width: 2000,
  height: 2000
});
assert.deepStrictEqual(skuCreateParams, {
  width: 2000,
  height: 2000,
  name: 'SKU'
});

const detailPlanWithMisleadingSkuScenario = buildAgentTaskPublicPlanExecutionRequest({
  agentTaskPlan: {
    version: 'agent-task-planning-contract/v0',
    status: 'ready_for_model_planning',
    requestKind: 'autonomous_execution',
    allowedToolScope: 'write_photoshop',
    route: 'autonomous_agent',
    skillId: 'autonomous-agent',
    designBrief: {
      scenario: 'sku',
      goal: '请从零创建详情页文档。按文档名称区分：详情页文档就是详情页，SKU 就是 SKU；如果当前打开的是 SKU 文档，不要把 SKU 当详情页模板。'
    },
    executionPlan: {
      mode: 'model_planning_required',
      canExecuteTools: false,
      requiresUserApproval: true,
      steps: [],
      verificationTargets: ['document_info', 'layer_hierarchy']
    }
  },
  publicPlan: {
    status: 'ready',
    canExecuteTools: false,
    message: '创建详情页首屏。',
    proposedWriteTools: ['createDocument', 'renderLayout'],
    readbackTargets: ['document_info', 'layer_hierarchy'],
    executionPlanSummary: '创建详情页首屏。'
  },
  runtimeOperationRequests: [
    {
      operationId: 'create-doc',
      toolName: 'createDocument',
      params: { width: 800, height: 1200, name: 'SKU' },
      paramsSummary: '创建画布',
      readbackTargets: ['document_info']
    },
    {
      operationId: 'render-layout',
      toolName: 'renderLayout',
      params: { canvas: { width: 800, height: 1200 }, blocks: [{ role: 'title', content: '详情页标题', heightRatio: 0.2 }] },
      paramsSummary: '排版首屏',
      readbackTargets: ['layer_hierarchy']
    }
  ],
  userConfirmed: true,
  enableControlledExecutionRequest: true
});
const misleadingCreateOperation = detailPlanWithMisleadingSkuScenario.operationRequests.find((operation) => operation.toolName === 'createDocument');
const misleadingRenderOperation = detailPlanWithMisleadingSkuScenario.operationRequests.find((operation) => operation.toolName === 'renderLayout');
assert.strictEqual(misleadingCreateOperation.params.name, '详情页');
assert.strictEqual(misleadingCreateOperation.params.width, 790);
assert.strictEqual(misleadingRenderOperation.params.canvas.width, 790);

const autonomousSource = fs.readFileSync(
  path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'skill-executors', 'autonomous-agent.executor.ts'),
  'utf8'
);
const toolSchemaSource = fs.readFileSync(
  path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'agent-runtime', 'tool-schemas.ts'),
  'utf8'
);
assert(
  autonomousSource.includes('buildDesignDocumentRoleContext')
    && autonomousSource.includes('normalizeCreateDocumentParamsForDesignRole'),
  'autonomous agent executor must consume the shared design document role context'
);
assert(
  !toolSchemaSource.includes('confirmNewDocumentDespiteExisting'),
  'atomic createDocument schema must not expose a model-authored pseudo confirmation'
);
assert(
  autonomousSource.includes('stripCreateDocumentPseudoConfirmation')
    && autonomousSource.includes('evaluateCreateDocumentTargetBoundary'),
  'autonomous execution must strip legacy pseudo confirmation and enforce the target boundary'
);
assert(
  autonomousSource.includes('exactObservedLayerWrite')
    && autonomousSource.includes('isToolWriteBoundToObservedActiveLayer(privateTargetGuard, toolParams)'),
  'an observed selection write must be authorized by the private preflight-validated layer target'
);
const protectedWriteBranch = autonomousSource.slice(
  autonomousSource.indexOf('const changesProtectedDocument = activeDocumentWriteProtected'),
  autonomousSource.indexOf('if (changesProtectedDocument)')
);
assert(protectedWriteBranch.length > 0, 'protected-document write branch must remain inspectable');
assert(
  !protectedWriteBranch.includes('!isWorkflowBridge'),
  'workflow bridge skills must not bypass protected/separate/observe-only document guards'
);
// 2026-07-02 命名残留清零：执行器守卫激活布尔已从 freshDetailPageTask 改为通用
// designDisciplineActive（design-discipline-runtime 泛化），断言同步指向新符号，语义不变。
assert(
  autonomousSource.includes("defaultSource: designDisciplineActive ? 'stage-autonomous-agent-default'"),
  'design-discipline autonomous runs should use a stage source instead of the legacy 25-round default'
);
assert(
  autonomousSource.includes('resolveAutonomousPerformancePolicy')
    && autonomousSource.includes('buildAgentPerformancePolicy({')
    && autonomousSource.includes('scenario: designDisciplineContext.spec?.runtimeHints.scenario')
    && autonomousSource.includes('|| resolveDesignerAgentScenario(params, context)')
    && autonomousSource.includes("action: 'create'"),
  'design-discipline autonomous runs should inherit the task-specific performance policy instead of a fixed tiny script budget'
);
// 2026-07-02 命名残留清零：运行结果已泛化为 deriveDesignTaskRunRecord / designRunRecord
// （design-discipline-runtime），断言同步指向新符号；outputCount 是证据对象暴露的产物数字段。
assert(
  autonomousSource.includes('deriveDesignTaskRunRecord')
    && autonomousSource.includes('designRunRecord')
    && autonomousSource.includes('canClaimOutputQuality')
    && autonomousSource.includes('outputCount'),
  'design-discipline autonomous results should expose observed run evidence instead of a hard-coded review status'
);

const detailPagePerformancePolicy = buildAgentPerformancePolicy({
  userText: '创建一个详情页文档',
  scenario: 'detail-page',
  action: 'create',
  skillId: 'autonomous-agent',
  requiresPhotoshop: true
});
assert(
  detailPagePerformancePolicy.budget.maxIterations > 10,
  'detail-page design should not be limited to the old 10-step stage draft budget'
);

const stageBudget = buildAutonomousAgentRuntimeBudget({
  defaultMaxIterations: detailPagePerformancePolicy.budget.maxIterations,
  defaultSource: 'stage-autonomous-agent-default'
});
assert.strictEqual(stageBudget.maxIterations, detailPagePerformancePolicy.budget.maxIterations);
assert.strictEqual(stageBudget.source, 'stage-autonomous-agent-default');

[
  '帮我做一个详情页',
  '帮我做一个详情页模板',
  '请创建一个790宽的临时详情页模板草稿，先做首屏和三个卖点模块'
].forEach((text) => {
  assert.strictEqual(
    matchesSkillRoutingIntent('detail-page-design', text),
    false,
    `fresh detail-page design text must not route to template detail-page skill: ${text}`
  );
  assert.strictEqual(
    findSkillRoutingIntent(text, { includeVisibilities: ['user-facing'] }),
    undefined,
    `fresh detail-page design text should fall through to autonomous Agent: ${text}`
  );
});

const detailDocumentCreateRoute = findSkillRoutingIntent(
  '帮我新建一个详情页文档 你需要知道详情页的尺寸规范',
  { includeVisibilities: ['user-facing'] }
);
assert.strictEqual(detailDocumentCreateRoute?.skillId, 'document-management');
assert.strictEqual(detailDocumentCreateRoute?.mode, 'create');

[
  '解析当前详情页模板并填充',
  '当前已有详情页模板，帮我填充并导出'
].forEach((text) => {
  const route = findSkillRoutingIntent(text, { includeVisibilities: ['user-facing'] });
  assert.strictEqual(route?.skillId, 'detail-page-design', `existing template detail-page text should keep template skill: ${text}`);
  assert.strictEqual(matchesSkillRoutingIntent('detail-page-design', text), true);
});

[
  roleContext.agentInstruction,
  JSON.stringify(detailCreateParams),
  JSON.stringify(canonicalDetailCreateParams),
  JSON.stringify(canonicalDetailLayoutParams),
  JSON.stringify(skuCreateParams),
  JSON.stringify(detailPlanWithMisleadingSkuScenario.operationRequests),
  JSON.stringify(stageBudget.limitations)
].forEach((text, index) => assertNoMojibake(text, `design-document-role smoke ${index}`));

console.log(JSON.stringify({
  success: true,
  checks: [
    'document names classify 详情页 as detail-page and SKU as SKU',
    'target-role context tells the Agent not to reuse an opened SKU document as a detail-page document',
    'reference source identity cannot override poster/detail-page target document identity',
    'current selected copy binds the opened document as the write target and forbids createDocument forking',
    'an unresolved follow-up target cannot use createDocument as a fallback',
    'structured create_new/edit_existing work modes own same-role create-vs-reuse decisions',
    'workflow bridge skills cannot bypass protected current-document writes',
    'createDocument params are normalized by target design document role',
    'canonical mode rewrites temporary detail-page draft names to 详情页 and width to 790',
    'renderLayout canvas width is normalized by target document role',
    'goal text overrides misleading SKU scenario when the user is creating a detail-page document',
    'fresh detail-page autonomous runs use the detail-page performance policy instead of the old tiny stage budget',
    'fresh detail-page autonomous results expose observed evidence before claiming output quality',
    'fresh detail-page design/template-draft wording falls through to autonomous Agent instead of template filling',
    'plain detail-page document creation keeps document-management while using detail-page role rules',
    'existing detail-page template parse/fill wording still routes to the template skill'
  ]
}, null, 2));
