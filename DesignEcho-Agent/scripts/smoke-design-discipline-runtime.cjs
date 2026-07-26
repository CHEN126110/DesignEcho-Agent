'use strict';

/**
 * smoke: 通用设计纪律运行时（design-discipline-runtime）
 * 验证 freshDetailPage 状态机的纪律被泛化为「任务类型无关、数据驱动」后行为不退化：
 * 检测 / 状态机 reducer / 门禁顺序 / 产物证据，且对主图同样生效（证明泛化）。
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

require('ts-node').register({
    transpileOnly: true,
    project: path.resolve(__dirname, '..', 'tsconfig.main.json')
});

const M = require(path.resolve(__dirname, '..', 'src', 'shared', 'design-discipline-runtime.ts'));
const {
    resolveDesignDisciplineContext,
    isDesignDisciplineTask,
    createDesignDisciplineState,
    applyDesignDisciplineProgress,
    evaluateDesignToolStateGuard,
    deriveDesignTaskRunRecord
} = M;
const {
    validateCreativeStagePlan
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'creative-stage-plan.ts'));
const {
    getDesignTaskTypeSpec,
    isRegisteredDesignTaskTypeId,
    listDesignTaskTypeIds,
    resolveDesignTaskTypeSpec
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'design-task-types.ts'));

let passed = 0;
function check(name, fn) {
    fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
}

console.log('smoke: design-discipline-runtime');

// ── 检测 ──
check('创意意图 + 详情页 → 激活，方法论工具=getDetailPageDesignFramework', () => {
    const ctx = resolveDesignDisciplineContext({ taskText: '帮我做详情页', isCreativeDesignIntent: true });
    assert.strictEqual(ctx.active, true);
    assert.strictEqual(ctx.taskTypeId, 'ecommerce.detail_page.v1');
    assert.strictEqual(ctx.frameworkToolName, 'getDetailPageDesignFramework');
});

check('泛化：创意意图 + 主图 → 激活，方法论工具=getMainImageDesignFramework', () => {
    const ctx = resolveDesignDisciplineContext({ taskText: '帮我做主图', isCreativeDesignIntent: true });
    assert.strictEqual(ctx.active, true);
    assert.strictEqual(ctx.taskTypeId, 'ecommerce.main_image.v1');
    assert.strictEqual(ctx.frameworkToolName, 'getMainImageDesignFramework');
});

check('SKU 模板无专属方法论工具 → 回退 searchDesignKnowledge', () => {
    const ctx = resolveDesignDisciplineContext({ taskText: '帮我设计SKU模板', isCreativeDesignIntent: true });
    assert.strictEqual(ctx.active, true);
    assert.strictEqual(ctx.frameworkToolName, 'searchDesignKnowledge');
});

// ── 编辑模式（真机病例 2026-07-07：存量详情页旁被另建空文档） ──
check('目标品类文档已打开 → 编辑模式：requiresStagePlan 降级', () => {
    const ctx = resolveDesignDisciplineContext({
        taskText: '详情页还有细节图没有置入 你帮我选图置入',
        isCreativeDesignIntent: true,
        activeDocumentName: '详情页.psb'
    });
    assert.strictEqual(ctx.active, true);
    assert.strictEqual(ctx.editingExistingCanonicalDocument, true);
    assert.strictEqual(ctx.requiresStagePlan, false);
});

check('编辑模式：createDocument 被拦；模型伪确认无效，只有 Harness 可信授权可放行', () => {
    const ctx = resolveDesignDisciplineContext({
        taskText: '详情页还有细节图没有置入 你帮我选图置入',
        isCreativeDesignIntent: true,
        activeDocumentName: '详情页.psb'
    });
    const blocked = evaluateDesignToolStateGuard({
        context: ctx,
        state: createDesignDisciplineState({ frameworkReadCount: 1, designKnowledgeReadCount: 1 }),
        toolName: 'createDocument',
        toolParams: {}
    });
    assert.strictEqual(blocked.success, false);
    assert.ok(blocked.message.includes('已经打开') && blocked.message.includes('switchDocument'), blocked.message);
    assert.ok(!blocked.message.includes('confirmNewDocumentDespiteExisting'), '不得再提示模型自行补确认参数');
    const fabricatedConfirmation = evaluateDesignToolStateGuard({
        context: ctx,
        state: createDesignDisciplineState({ frameworkReadCount: 1, designKnowledgeReadCount: 1 }),
        toolName: 'createDocument',
        toolParams: { confirmNewDocumentDespiteExisting: true }
    });
    assert.strictEqual(fabricatedConfirmation.success, false, '模型参数不能签发新建文档授权');
    const trustedAuthorization = evaluateDesignToolStateGuard({
        context: ctx,
        state: createDesignDisciplineState({ frameworkReadCount: 1, designKnowledgeReadCount: 1 }),
        toolName: 'createDocument',
        trustedCreateDocumentAuthorization: true
    });
    assert.ok(trustedAuthorization === null || trustedAuthorization.success !== false, 'Harness 可信独立目标授权应放行');
});

check('非编辑模式（目标文档未打开）：createDocument 不受本拦截影响', () => {
    const ctx = resolveDesignDisciplineContext({
        taskText: '帮我做详情页',
        isCreativeDesignIntent: true,
        activeDocumentName: '主图.psd'
    });
    assert.strictEqual(ctx.editingExistingCanonicalDocument, false);
    assert.strictEqual(ctx.requiresStagePlan, true);
});

check('无创意意图（仅命中任务类型）→ 不激活', () => {
    assert.strictEqual(isDesignDisciplineTask({ taskText: '帮我做详情页', isCreativeDesignIntent: false }), false);
});

check('创意意图但命中"非从零设计"排除信号（检查/导出/填充）→ 不激活（通用兜底也尊重排除信号）', () => {
    assert.strictEqual(isDesignDisciplineTask({ taskText: '看一下当前详情页结构', isCreativeDesignIntent: true }), false);
    assert.strictEqual(isDesignDisciplineTask({ taskText: '导出当前文档切片', isCreativeDesignIntent: true }), false);
    assert.strictEqual(isDesignDisciplineTask({ taskText: '把模板填充一下', isCreativeDesignIntent: true }), false);
});

check('创意意图 + 新品类（海报，无具体 spec、未命中排除）→ 通用兜底激活，方法论回退 searchDesignKnowledge', () => {
    const ctx = resolveDesignDisciplineContext({ taskText: '帮我做一张促销海报', isCreativeDesignIntent: true });
    assert.strictEqual(ctx.active, true);
    assert.strictEqual(ctx.taskTypeId, 'design.generic.v1');
    assert.strictEqual(ctx.frameworkToolName, 'searchDesignKnowledge');
    assert.strictEqual(ctx.requiresStagePlan, false);
    assert.strictEqual(ctx.canonicalDocumentName, undefined);
});

check('通用设计可被结构化声明，但不会被本地文本关键词匹配', () => {
    assert.strictEqual(getDesignTaskTypeSpec('design.generic.v1')?.id, 'design.generic.v1');
    assert.strictEqual(getDesignTaskTypeSpec('design.generic.v1')?.skillId, undefined, '通用设计不能伪绑定专用 Skill');
    assert.ok(listDesignTaskTypeIds().includes('design.generic.v1'));
    assert.strictEqual(isRegisteredDesignTaskTypeId('design.generic.v1'), true);
    assert.strictEqual(resolveDesignTaskTypeSpec('帮我做一张促销海报'), undefined);
});

check('R0 已声明通用设计时，无需本地创意关键词判断也能激活纪律', () => {
    const ctx = resolveDesignDisciplineContext({
        taskText: '执行刚才确认的方案',
        isCreativeDesignIntent: false,
        declaredTaskTypeId: 'design.generic.v1'
    });
    assert.strictEqual(ctx.active, true);
    assert.strictEqual(ctx.taskTypeId, 'design.generic.v1');
    assert.strictEqual(ctx.requiresStagePlan, false);
});

check('无创意意图 + 新品类（海报）→ 不激活（兜底只在确定创意意图时启用）', () => {
    assert.strictEqual(isDesignDisciplineTask({ taskText: '帮我做一张促销海报', isCreativeDesignIntent: false }), false);
});

check('方法论由 Manifest 所有，纪律运行时不保留平行 Tool policy', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '..', 'src/shared/design-discipline-runtime.ts'), 'utf8');
    assert.ok(source.includes('getManifestByTaskType'), '设计纪律应消费现有 Manifest Registry');
    assert.ok(!source.includes('FRAMEWORK_TOOL_BY_SKILL'), '设计纪律不应保留方法论工具平行表');
    for (const legacyName of [
        'TASK_TYPE_EXTRA_TOOL_NAMES',
        'DESIGN_DISCIPLINE_CORE_TOOL_NAMES',
        'DESIGN_DISCIPLINE_EXPOSED_CORE_TOOL_NAMES',
        'DESIGN_DISCIPLINE_REFERENCE_TOOL_NAMES',
        'buildDesignDisciplineToolPolicy'
    ]) {
        assert.ok(!source.includes(legacyName), `设计纪律不应恢复 legacy Tool policy：${legacyName}`);
    }
});

check('阶段计划校验已收敛为品类中立契约，Harness 不再依赖详情页专属校验器', () => {
    const disciplineSource = fs.readFileSync(
        path.resolve(__dirname, '..', 'src/shared/design-discipline-runtime.ts'),
        'utf8'
    );
    const toolExecutorSource = fs.readFileSync(
        path.resolve(__dirname, '..', 'src/renderer/services/tool-executor.service.ts'),
        'utf8'
    );
    for (const source of [disciplineSource, toolExecutorSource]) {
        assert.ok(source.includes('validateCreativeStagePlan'), '生产调用必须使用通用阶段计划校验器');
        assert.ok(!source.includes('validateDetailPageCreativeStagePlan'), '生产调用不得恢复详情页专属校验器');
        assert.ok(!source.includes('detail-page-creative-stage-plan'), '生产调用不得依赖详情页专属阶段计划模块');
    }
});

check('通用阶段计划校验器按调用上下文校验主图文档名，不自行推断详情页', () => {
    const validation = validateCreativeStagePlan({
        targetDocumentName: '主图',
        productUnderstanding: '轻量通勤鞋主图，重点展示鞋型轮廓、材质纹理与日常穿搭定位。',
        currentStage: {
            id: '1-核心主视觉',
            title: '核心主视觉',
            purpose: '先建立清晰的产品识别，再传达轻量与通勤定位。',
            sellingPoint: '轻量鞋身与简洁通勤轮廓',
            imageIntent: '使用主体完整且材质纹理清晰的鞋子实拍图',
            layoutRoles: ['background', 'main-image', 'title'],
            observationFocus: '检查主体完整性、轮廓辨识度与标题可读性'
        }
    }, { expectedDocumentName: '主图' });
    assert.strictEqual(validation.valid, true, validation.blockers.join('；'));
});

// ── 状态机 reducer ──
check('reducer：createDocument→documentCreated；renderLayout→layoutRendered+needsObservation', () => {
    const fw = { frameworkToolName: 'getDetailPageDesignFramework' };
    let s = createDesignDisciplineState();
    s = applyDesignDisciplineProgress(s, 'createDocument', true, fw);
    assert.strictEqual(s.documentCreated, true);
    s = applyDesignDisciplineProgress(s, 'renderLayout', true, fw);
    assert.strictEqual(s.layoutRendered, true);
    assert.strictEqual(s.needsObservationAfterMutation, true);
});

check('reducer：排版后改动累计 repair；视觉复核清掉 needsObservation', () => {
    const fw = { frameworkToolName: 'getDetailPageDesignFramework' };
    let s = createDesignDisciplineState({ documentCreated: true });
    s = applyDesignDisciplineProgress(s, 'renderLayout', true, fw);
    s = applyDesignDisciplineProgress(s, 'setTextContent', true, fw);
    assert.strictEqual(s.repairAttemptCount, 1, '排版后的改动应计入 repair');
    assert.strictEqual(s.observationIntent, 'text_readability');
    s = applyDesignDisciplineProgress(s, 'getAnnotatedSnapshot', true, fw);
    assert.strictEqual(s.needsObservationAfterMutation, false, '复核后应清掉待观察');
});

check('reducer：其他改动工具不覆盖已有的更具体观察意图（对齐详情页守卫语义）', () => {
    const fw = { frameworkToolName: 'getDetailPageDesignFramework' };
    let s = createDesignDisciplineState({ documentCreated: true });
    s = applyDesignDisciplineProgress(s, 'renderLayout', true, fw);
    s = applyDesignDisciplineProgress(s, 'transformLayer', true, fw);
    assert.strictEqual(s.observationIntent, 'image_fit', 'transformLayer → image_fit');
    s = applyDesignDisciplineProgress(s, 'moveLayer', true, fw);
    assert.strictEqual(s.observationIntent, 'image_fit', 'moveLayer 不应覆盖已有的 image_fit');
});

check('reducer：失败调用不推进状态', () => {
    const fw = { frameworkToolName: 'getDetailPageDesignFramework' };
    let s = createDesignDisciplineState();
    s = applyDesignDisciplineProgress(s, 'createDocument', false, fw);
    assert.strictEqual(s.documentCreated, false);
});

// ── 门禁 ──
const detailCtx = resolveDesignDisciplineContext({ taskText: '帮我做详情页', isCreativeDesignIntent: true });

check('门禁：未激活上下文恒返回 null（不拦截普通任务）', () => {
    const inactive = resolveDesignDisciplineContext({ taskText: '你好', isCreativeDesignIntent: false });
    const r = evaluateDesignToolStateGuard({
        context: inactive,
        state: createDesignDisciplineState(),
        toolName: 'createDocument'
    });
    assert.strictEqual(r, null);
});

check('门禁：不强制知识→建档路线，无知识证据也可由 Planner 自主 createDocument', () => {
    const r = evaluateDesignToolStateGuard({
        context: detailCtx,
        state: createDesignDisciplineState(),
        toolName: 'createDocument'
    });
    assert.strictEqual(r, null);
});

check('门禁：有知识证据后 createDocument 放行', () => {
    const r = evaluateDesignToolStateGuard({
        context: detailCtx,
        state: createDesignDisciplineState({ designKnowledgeReadCount: 1 }),
        toolName: 'createDocument'
    });
    assert.strictEqual(r, null);
});

check('门禁：已建画布再 createDocument → 拦截', () => {
    const r = evaluateDesignToolStateGuard({
        context: detailCtx,
        state: createDesignDisciplineState({ documentCreated: true, designKnowledgeReadCount: 1 }),
        toolName: 'createDocument'
    });
    assert.ok(r && r.success === false);
});

check('门禁：建画布后未排版可直接 placeImage，不强迫先 renderLayout', () => {
    const r = evaluateDesignToolStateGuard({
        context: detailCtx,
        state: createDesignDisciplineState({ documentCreated: true, designKnowledgeReadCount: 1 }),
        toolName: 'placeImage'
    });
    assert.strictEqual(r, null);
});

check('门禁：改动后未复核就保存 → 拦截，指向截图观察', () => {
    const r = evaluateDesignToolStateGuard({
        context: detailCtx,
        state: createDesignDisciplineState({
            documentCreated: true,
            layoutRendered: true,
            needsObservationAfterMutation: true,
            observationIntent: 'stage_readiness'
        }),
        toolName: 'saveDocument'
    });
    assert.ok(r && r.success === false);
    assert.ok(/getAnnotatedSnapshot|getCanvasSnapshot/.test(r.nextRequiredTool));
});

check('门禁：任意 Photoshop 写工具后，保存前都必须先观察', () => {
    const fw = { frameworkToolName: 'getDetailPageDesignFramework' };
    let state = createDesignDisciplineState({ documentCreated: true });
    state = applyDesignDisciplineProgress(state, 'createTextLayer', true, fw);
    assert.strictEqual(state.needsObservationAfterMutation, true, '新增原子写工具也必须触发待观察状态');
    const blocked = evaluateDesignToolStateGuard({
        context: detailCtx,
        state,
        toolName: 'saveDocument'
    });
    assert.ok(blocked && blocked.success === false, '任意写入后不得未经观察直接保存');
    state = applyDesignDisciplineProgress(state, 'getCanvasSnapshot', true, fw);
    assert.strictEqual(
        evaluateDesignToolStateGuard({ context: detailCtx, state, toolName: 'saveDocument' }),
        null,
        '观察成功后应恢复保存通路'
    );
});

check('门禁：Skill workflow bridge 被统一 Registry 分类为 Photoshop 写入时，同样触发观察', () => {
    const fw = {
        frameworkToolName: 'getDetailPageDesignFramework',
        isPhotoshopMutation: true
    };
    let state = createDesignDisciplineState({ documentCreated: true });
    state = applyDesignDisciplineProgress(state, 'detail-page-design', true, fw);
    assert.strictEqual(state.needsObservationAfterMutation, true);
    const context = resolveDesignDisciplineContext({
        taskText: '帮我做详情页',
        isCreativeDesignIntent: true
    });
    const blocked = evaluateDesignToolStateGuard({
        context,
        state,
        toolName: 'saveDocument'
    });
    assert.ok(blocked && blocked.success === false, 'Skill 内部写入后也必须先观察再保存');
});

check('门禁：复核后保存放行', () => {
    const r = evaluateDesignToolStateGuard({
        context: detailCtx,
        state: createDesignDisciplineState({
            documentCreated: true,
            layoutRendered: true,
            needsObservationAfterMutation: false
        }),
        toolName: 'saveDocument'
    });
    assert.strictEqual(r, null);
});

check('门禁：改动次数达上限 → 拦截，要求重判阶段', () => {
    const r = evaluateDesignToolStateGuard({
        context: detailCtx,
        state: createDesignDisciplineState({
            documentCreated: true,
            layoutRendered: true,
            observationIntent: 'stage_readiness',
            repairAttemptCount: 3,
            needsObservationAfterMutation: true
        }),
        toolName: 'setTextContent'
    });
    assert.ok(r && r.success === false);
    assert.strictEqual(r.nextRequiredTool, 'getAnnotatedSnapshot');
});

check('门禁：排版后 placeImage 放行，是否叠图由 Planner 与视觉证据判断', () => {
    const r = evaluateDesignToolStateGuard({
        context: detailCtx,
        state: createDesignDisciplineState({
            documentCreated: true,
            layoutRendered: true,
            needsObservationAfterMutation: false
        }),
        toolName: 'placeImage'
    });
    assert.strictEqual(r, null);
});

check('门禁：重复读方法论 → 拦截', () => {
    const r = evaluateDesignToolStateGuard({
        context: detailCtx,
        state: createDesignDisciplineState({ frameworkReadCount: 1 }),
        toolName: 'getDetailPageDesignFramework'
    });
    assert.ok(r && r.success === false);
});

// ── 显式 Skill policy 与 Harness 自由度 ──

check('门禁：详情页 renderLayout 缺 stagePlan → 拦截，指向 renderLayout', () => {
    // detailCtx.requiresStagePlan 应为 true（spec.requiresStagePlanOnRender=true）
    assert.strictEqual(detailCtx.requiresStagePlan, true, '详情页应要求 renderLayout 携带 stagePlan');
    const r = evaluateDesignToolStateGuard({
        context: detailCtx,
        state: createDesignDisciplineState({ documentCreated: true, designKnowledgeReadCount: 1 }),
        toolName: 'renderLayout',
        toolParams: {}
    });
    assert.ok(r && r.success === false, '缺 stagePlan 的 renderLayout 应被拦截');
    assert.strictEqual(r.nextRequiredTool, 'renderLayout');
    assert.ok(/stagePlan/.test(r.message));
});

check('门禁：详情页 renderLayout 带合法 stagePlan → 放行', () => {
    const stagePlan = {
        targetDocumentName: '详情页',
        productUnderstanding: '这是一款主打舒适与抑菌的纯棉中筒袜，目标用户为注重脚部健康的日常通勤人群。',
        currentStage: {
            id: 'detail-01-kv',
            title: '首屏 KV',
            purpose: '第一眼建立产品认知与抑菌舒适的点击理由。',
            sellingPoint: '纯棉抑菌，全天干爽不闷脚',
            imageIntent: '使用产品平铺白底主图，突出棉质纹理',
            layoutRoles: ['background', 'main-image', 'title'],
            observationFocus: '检查主图是否居中、标题是否清晰可读、无元素重叠'
        }
    };
    const r = evaluateDesignToolStateGuard({
        context: detailCtx,
        state: createDesignDisciplineState({ documentCreated: true, designKnowledgeReadCount: 1 }),
        toolName: 'renderLayout',
        toolParams: { stagePlan }
    });
    assert.strictEqual(r, null, '合法 stagePlan 的 renderLayout 应放行');
});

check('门禁：主图无 requiresStagePlan，renderLayout 不因缺 stagePlan 被拦', () => {
    const mainCtx = resolveDesignDisciplineContext({ taskText: '帮我做主图', isCreativeDesignIntent: true });
    assert.strictEqual(mainCtx.requiresStagePlan, false, '主图未启用 requiresStagePlanOnRender');
    const r = evaluateDesignToolStateGuard({
        context: mainCtx,
        state: createDesignDisciplineState({ documentCreated: true, designKnowledgeReadCount: 1 }),
        toolName: 'renderLayout',
        toolParams: {}
    });
    // 主图无 stagePlan 门禁，renderLayout 在已建画布有知识证据下应放行（不被 0) 分支拦）
    assert.strictEqual(r, null, '主图 renderLayout 不应因缺 stagePlan 被拦截');
});

check('门禁：createInteractiveCard 不因缺少交互请求被通用 Harness 拦截', () => {
    const r = evaluateDesignToolStateGuard({
        context: detailCtx,
        state: createDesignDisciplineState({ designKnowledgeReadCount: 1 }),
        toolName: 'createInteractiveCard'
    });
    assert.strictEqual(r, null, '卡片能力是否适用由 Planner / Skill 决定');
});

check('门禁：不再维护工具白名单，允许集外原子 Tool 也由统一 Registry / preflight 治理', () => {
    const settledState = createDesignDisciplineState({
        designKnowledgeReadCount: 1,
        documentCreated: true,
        layoutRendered: true,
        needsObservationAfterMutation: false
    });
    // Skill 工具与原子工具都不应被品类守卫做第二套白名单判断。
    const ok = evaluateDesignToolStateGuard({
        context: detailCtx,
        state: settledState,
        toolName: 'parseDetailPageTemplate'
    });
    assert.strictEqual(ok, null, '详情页专属工具不应被白名单兜底拦截');
    const atomic = evaluateDesignToolStateGuard({
        context: detailCtx,
        state: settledState,
        toolName: 'createTextLayer'
    });
    assert.strictEqual(atomic, null, '允许集外原子 Tool 不应被设计纪律白名单拦截');
});

check('门禁：参考通道全程可达（harness 体检 2026-07-07 语义翻转）', () => {
    // 旧断言要求无参考来源时拦截参考工具——与「设计是感觉，感觉的载体是参考」冲突：
    // 从零设计中途找参考灵感是正当行为，参考工具是只读检索，不该锁在 hasReferenceSource 后面。
    const allowed = evaluateDesignToolStateGuard({
        context: detailCtx,
        state: createDesignDisciplineState({
            designKnowledgeReadCount: 1,
            documentCreated: true,
            layoutRendered: true,
            needsObservationAfterMutation: false
        }),
        toolName: 'searchEagleReferences'
    });
    assert.strictEqual(allowed, null, '参考工具应全程可达（无需用户先给参考来源）');
    // 有参考来源时放行
    const refCtx = resolveDesignDisciplineContext({
        taskText: '帮我做详情页',
        isCreativeDesignIntent: true,
        hasReferenceSource: true
    });
    const ok = evaluateDesignToolStateGuard({
        context: refCtx,
        state: createDesignDisciplineState({ designKnowledgeReadCount: 1, documentCreated: true, layoutRendered: true, needsObservationAfterMutation: false }),
        toolName: 'searchEagleReferences'
    });
    assert.strictEqual(ok, null, 'hasReferenceSource=true 时参考工具应放行');
});

check('Harness 契约翻转：观察类工具（读旧文档结构）建画布前也放行——Observation 必须永远畅通', () => {
    // 契约翻转（2026-07-08，真机病例"帮我导出主图详情页"被误判从零设计）：
    // 旧版"建画布前禁读 getLayerHierarchy → 逼 createDocument"是把 Agent 致盲——它看不到
    // "这其实是张做好的详情页"，就会顺着牢笼去从零新建。Harness「Observation 必须永远畅通」：
    // 只读/打开/查看类工具绝不拦，Agent 看清后自会纠正关键词初判。防套版/防旁建由写路径门禁保证。
    const r = evaluateDesignToolStateGuard({
        context: detailCtx,
        state: createDesignDisciplineState({ designKnowledgeReadCount: 1 }),
        toolName: 'getLayerHierarchy'
    });
    assert.strictEqual(r, null, '观察类工具建画布前应放行（不再致盲 Agent）');
});

check('Harness：openTemplate（打开既有文件）建画布前放行', () => {
    const r = evaluateDesignToolStateGuard({
        context: detailCtx,
        state: createDesignDisciplineState({ designKnowledgeReadCount: 1 }),
        toolName: 'openTemplate'
    });
    assert.strictEqual(r, null, '打开既有文件是观察，设计纪律不拦');
});

check('Harness：导出工具建画布前放行——「导出既有」是动作本身，不逼先 createDocument', () => {
    const r = evaluateDesignToolStateGuard({
        context: detailCtx,
        state: createDesignDisciplineState({ designKnowledgeReadCount: 1 }),
        toolName: 'exportMainImageDocuments'
    });
    assert.strictEqual(r, null, '导出工具建画布前不应被允许集/禁读旧文档门禁拦截');
});

check('Harness：导出工具仍受「改后未复核不许导出」门禁约束——安全没丢', () => {
    const r = evaluateDesignToolStateGuard({
        context: detailCtx,
        state: createDesignDisciplineState({
            documentCreated: true,
            layoutRendered: true,
            needsObservationAfterMutation: true,
            observationIntent: 'stage_readiness'
        }),
        toolName: 'exportMainImageDocuments'
    });
    assert.ok(r && r.success === false, '改动后未复核，导出工具仍应被拦');
    assert.ok(/getAnnotatedSnapshot|getCanvasSnapshot/.test(r.nextRequiredTool), r && r.nextRequiredTool);
});

check('门禁：建画布前读项目素材工具（pre-document 集）→ 放行', () => {
    const r = evaluateDesignToolStateGuard({
        context: detailCtx,
        state: createDesignDisciplineState({ designKnowledgeReadCount: 1 }),
        toolName: 'listProjectResources'
    });
    assert.strictEqual(r, null, 'pre-document 允许集内工具（listProjectResources）建画布前应放行');
});

check('门禁：建画布前方法论工具按 frameworkToolName 通用放行', () => {
    // getDetailPageDesignFramework = detailCtx.frameworkToolName，建画布前应放行（不被禁读旧文档分支拦）
    const r = evaluateDesignToolStateGuard({
        context: detailCtx,
        state: createDesignDisciplineState(),
        toolName: 'getDetailPageDesignFramework'
    });
    assert.strictEqual(r, null, '方法论工具建画布前应放行');
});

check('门禁：团队工具不由通用 Harness 维护额外开关', () => {
    for (const toolName of ['delegateToAgent', 'runDesignTeamPipeline']) {
        const result = evaluateDesignToolStateGuard({
            context: detailCtx,
            state: createDesignDisciplineState({ designKnowledgeReadCount: 1 }),
            toolName
        });
        assert.strictEqual(result, null, `${toolName} 是否适用由 Planner / Skill 决定`);
    }
});

check('reducer：读 getDesignPrinciples 计入设计知识证据，可放行开稿', () => {
    const fw = { frameworkToolName: 'getDetailPageDesignFramework' };
    let s = createDesignDisciplineState();
    s = applyDesignDisciplineProgress(s, 'getDesignPrinciples', true, fw);
    assert.strictEqual(s.designKnowledgeReadCount, 1, '读通用设计原理应计入设计知识读取次数');
    const r = evaluateDesignToolStateGuard({ context: detailCtx, state: s, toolName: 'createDocument' });
    assert.strictEqual(r, null, '有设计原理证据后应放行开稿');
});

check('reducer：Eagle 参考检索也计入设计知识证据（参考成为开稿依据），可放行开稿', () => {
    const fw = { frameworkToolName: 'getDetailPageDesignFramework' };
    let s = createDesignDisciplineState();
    s = applyDesignDisciplineProgress(s, 'searchEagleReferences', true, fw);
    assert.strictEqual(s.designKnowledgeReadCount, 1, 'Eagle 参考检索应计入设计知识读取次数');
    const r = evaluateDesignToolStateGuard({ context: detailCtx, state: s, toolName: 'createDocument' });
    assert.strictEqual(r, null, 'Eagle 参考检索后应放行开稿');
});

// ── 产物证据 ──
check('产物证据：完整管线 → completed + 可宣称质量', () => {
    const ev = deriveDesignTaskRunRecord({
        executionCompleted: true,
        overallSuccess: true,
        label: '详情页',
        toolEntries: [
            { name: 'getDetailPageDesignFramework', succeeded: true },
            { name: 'createDocument', succeeded: true },
            { name: 'renderLayout', succeeded: true },
            { name: 'getAnnotatedSnapshot', succeeded: true, visualReviewed: true },
            { name: 'saveDocument', succeeded: true }
        ]
    });
    assert.strictEqual(ev.status, 'completed');
    assert.strictEqual(ev.canClaimOutputQuality, true);
    assert.strictEqual(ev.outputCount, 1, '完整管线 outputCount 应为已保存产物数（1）');
});

check('运行记录：截图调用成功但模型未完成视觉复核 → 不可宣称质量', () => {
    const run = deriveDesignTaskRunRecord({
        executionCompleted: true,
        overallSuccess: true,
        toolEntries: [
            { name: 'createDocument', succeeded: true },
            { name: 'renderLayout', succeeded: true },
            { name: 'getAnnotatedSnapshot', succeeded: true },
            { name: 'saveDocument', succeeded: true }
        ]
    });
    assert.strictEqual(run.canClaimOutputQuality, false);
    assert.strictEqual(run.observationCount, 0);
});

check('产物证据：outputCount 无保存时回退到已排版阶段数', () => {
    const ev = deriveDesignTaskRunRecord({
        executionCompleted: false,
        overallSuccess: true,
        toolEntries: [
            { name: 'createDocument', succeeded: true },
            { name: 'renderLayout', succeeded: true },
            { name: 'renderLayout', succeeded: true }
        ]
    });
    assert.strictEqual(ev.savedDocumentCount, 0);
    assert.strictEqual(ev.outputCount, 2, '无保存时 outputCount 回退到已排版阶段数（2）');
});

check('产物证据：缺观察 → needs_review，不可宣称质量', () => {
    const ev = deriveDesignTaskRunRecord({
        executionCompleted: true,
        overallSuccess: true,
        toolEntries: [
            { name: 'createDocument', succeeded: true },
            { name: 'renderLayout', succeeded: true },
            { name: 'saveDocument', succeeded: true }
        ]
    });
    assert.strictEqual(ev.canClaimOutputQuality, false);
    assert.ok(ev.warnings.some((w) => /查看.*真实画面/.test(w)));
});

check('产物证据：什么都没做且失败 → failed', () => {
    const ev = deriveDesignTaskRunRecord({
        executionCompleted: false,
        overallSuccess: false,
        toolEntries: []
    });
    assert.strictEqual(ev.status, 'failed');
});

console.log(`\n✅ design-discipline-runtime smoke 全部通过（${passed} 项）`);
