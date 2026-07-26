'use strict';

/**
 * 黄金主测（golden-master）：evaluateDesignToolStateGuard 当前治理语义。
 *
 * 通用 Harness 只保留两类约束：
 *   1. 显式 Skill policy：stagePlan、reference-first；
 *   2. 跨任务安全不变量：编辑现有文档不误建、同轮不重复建档、连续写入先观察、写后观察再保存。
 *
 * 它不再规定「知识 → 建档 → renderLayout」路线，不维护品类工具白名单，也不根据本地布尔开关
 * 拦截卡片、团队、Skill 或原子 Tool。具体能力选择由 Planner / Skill 决定，统一 Registry、preflight
 * 与 Photoshop 执行契约负责能力和写入安全。
 */

const assert = require('assert');
const path = require('path');

require('ts-node').register({
    transpileOnly: true,
    project: path.resolve(__dirname, '..', 'tsconfig.main.json')
});

const M = require(path.resolve(__dirname, '..', 'src', 'shared', 'design-discipline-runtime.ts'));
const {
    resolveDesignDisciplineContext,
    createDesignDisciplineState,
    applyDesignDisciplineProgress,
    evaluateDesignToolStateGuard,
    isDesignDisciplineObservationTool
} = M;

let passed = 0;
function check(name, fn) {
    fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
}

console.log('smoke: design-discipline-guard golden-master');

const detailCtx = resolveDesignDisciplineContext({ taskText: '帮我做详情页', isCreativeDesignIntent: true });
const mainCtx = resolveDesignDisciplineContext({ taskText: '帮我做主图', isCreativeDesignIntent: true });
const skuCtx = resolveDesignDisciplineContext({ taskText: '帮我设计SKU模板', isCreativeDesignIntent: true });

const VALID_STAGE_PLAN = {
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

function guard(context, state, toolName, toolParams) {
    return evaluateDesignToolStateGuard({ context, state, toolName, toolParams });
}

function st(init) {
    return createDesignDisciplineState(init);
}

// ── 顶层边界 ──
check('未激活上下文不拦截任何工具', () => {
    const inactive = resolveDesignDisciplineContext({ taskText: '你好', isCreativeDesignIntent: false });
    assert.strictEqual(guard(inactive, st({}), 'createDocument'), null);
});

check('active=true 但 spec 缺失的异常上下文不拦截', () => {
    const crafted = {
        active: true,
        spec: undefined,
        frameworkToolName: 'searchDesignKnowledge',
        label: '设计',
        requiresStagePlan: false,
        requiresReferenceInput: false,
        editingExistingCanonicalDocument: false,
        hasReferenceSource: false
    };
    assert.strictEqual(guard(crafted, st({}), 'createTextLayer'), null);
});

check('观察工具始终畅通', () => {
    for (const tool of ['getLayerHierarchy', 'openTemplate', 'switchDocument', 'getCanvasSnapshot']) {
        assert.strictEqual(isDesignDisciplineObservationTool(tool), true, tool);
        assert.strictEqual(guard(detailCtx, st({}), tool), null, tool);
    }
});

// ── 显式 Skill policy：stagePlan ──
check('详情页 renderLayout 缺少合法 stagePlan 时拦截', () => {
    const result = guard(detailCtx, st({ documentCreated: true }), 'renderLayout', {});
    assert.ok(result && result.success === false);
    assert.strictEqual(result.nextRequiredTool, 'renderLayout');
    assert.ok(/stagePlan/.test(result.message));
    assert.strictEqual(result.error, result.message);
});

check('详情页 renderLayout 携带合法 stagePlan 时放行', () => {
    assert.strictEqual(
        guard(detailCtx, st({ documentCreated: true }), 'renderLayout', { stagePlan: VALID_STAGE_PLAN }),
        null
    );
});

check('未声明 stagePlan policy 的主图不因缺 stagePlan 被拦截', () => {
    assert.strictEqual(mainCtx.requiresStagePlan, false);
    assert.strictEqual(guard(mainCtx, st({ documentCreated: true }), 'renderLayout', {}), null);
});

// ── 方法论只保留重复读取停机约束，不规定下一条设计路线 ──
check('重复读方法论：未建档时指向读取项目状态，不强迫 createDocument', () => {
    const result = guard(detailCtx, st({ frameworkReadCount: 1 }), 'getDetailPageDesignFramework');
    assert.ok(result && result.success === false);
    assert.strictEqual(result.nextRequiredTool, 'getDesignProjectState');
    assert.ok(/自主选择下一步/.test(result.message));
});

check('重复读方法论：已有文档时指向观察，不强迫 renderLayout', () => {
    const result = guard(
        detailCtx,
        st({ frameworkReadCount: 1, documentCreated: true }),
        'getDetailPageDesignFramework'
    );
    assert.ok(result && result.success === false);
    assert.strictEqual(result.nextRequiredTool, 'getCanvasSnapshot');
});

// ── 连续写入观察阈值 ──
check('连续写入未达阈值时放行', () => {
    const result = guard(
        detailCtx,
        st({
            documentCreated: true,
            needsObservationAfterMutation: true,
            observationIntent: 'stage_readiness',
            repairAttemptCount: 2
        }),
        'setTextContent'
    );
    assert.strictEqual(result, null);
});

check('连续写入达到阈值时先观察真实画面', () => {
    const result = guard(
        detailCtx,
        st({
            documentCreated: true,
            needsObservationAfterMutation: true,
            observationIntent: 'stage_readiness',
            repairAttemptCount: 3
        }),
        'setTextContent'
    );
    assert.ok(result && result.success === false);
    assert.strictEqual(result.nextRequiredTool, 'getAnnotatedSnapshot');
    assert.ok(/连续写入/.test(result.message));
});

check('不同观察意图使用各自阈值与证据工具', () => {
    const result = guard(
        detailCtx,
        st({
            documentCreated: true,
            needsObservationAfterMutation: true,
            observationIntent: 'export_readiness',
            repairAttemptCount: 1
        }),
        'setTextContent'
    );
    assert.ok(result && result.success === false);
    assert.strictEqual(result.nextRequiredTool, 'getCanvasSnapshot');
});

// ── 编辑现有文档保护 ──
check('编辑现有品类文档时 createDocument 必须由 Harness 的独立目标授权', () => {
    const editing = resolveDesignDisciplineContext({
        taskText: '详情页还有细节图没有置入 你帮我选图置入',
        isCreativeDesignIntent: true,
        activeDocumentName: '详情页.psb'
    });
    assert.strictEqual(editing.editingExistingCanonicalDocument, true);
    const result = guard(editing, st({}), 'createDocument', {});
    assert.ok(result && result.success === false);
    assert.strictEqual(result.nextRequiredTool, 'switchDocument');
    assert.ok(!/confirmNewDocumentDespiteExisting/.test(result.message));
});

check('编辑现有文档时模型伪确认无效，Harness 可信授权可放行', () => {
    const editing = resolveDesignDisciplineContext({
        taskText: '详情页还有细节图没有置入 你帮我选图置入',
        isCreativeDesignIntent: true,
        activeDocumentName: '详情页.psb'
    });
    assert.ok(guard(editing, st({}), 'createDocument', { confirmNewDocumentDespiteExisting: true }));
    assert.strictEqual(evaluateDesignToolStateGuard({
        context: editing,
        state: st({}),
        toolName: 'createDocument',
        trustedCreateDocumentAuthorization: true
    }), null);
});

// ── 显式 Skill policy：reference-first ──
check('SKU reference-first：无参考证据时不允许新建画布', () => {
    assert.strictEqual(skuCtx.requiresReferenceInput, true);
    const result = guard(skuCtx, st({}), 'createDocument');
    assert.ok(result && result.success === false);
    assert.strictEqual(result.nextRequiredTool, 'searchEagleReferences');
    assert.ok(/设计必须有参考/.test(result.message));
});

check('SKU reference-first：已有工具证据时放行', () => {
    assert.strictEqual(guard(skuCtx, st({ referenceInputCount: 1 }), 'createDocument'), null);
});

check('SKU reference-first：用户自带参考来源时放行', () => {
    const refSku = resolveDesignDisciplineContext({
        taskText: '帮我设计SKU模板',
        isCreativeDesignIntent: true,
        hasReferenceSource: true
    });
    assert.strictEqual(guard(refSku, st({}), 'createDocument'), null);
});

// ── 同轮重复建档保护 ──
check('已建档后重复 createDocument 被拦截，但不强迫 renderLayout', () => {
    const result = guard(detailCtx, st({ documentCreated: true }), 'createDocument');
    assert.ok(result && result.success === false);
    assert.strictEqual(result.nextRequiredTool, 'getDocumentInfo');
    assert.ok(/自主|选择|规划/.test(result.nextRequiredToolReason + result.message));
});

check('无论是否使用 renderLayout，重复建档都指向真实文档状态', () => {
    const result = guard(detailCtx, st({ documentCreated: true, layoutRendered: true }), 'createDocument');
    assert.ok(result && result.success === false);
    assert.strictEqual(result.nextRequiredTool, 'getDocumentInfo');
});

// ── 任意写后，保存/导出前必须观察 ──
check('Registry 分类的任意 Photoshop 写工具都会触发待观察状态', () => {
    const fw = { frameworkToolName: detailCtx.frameworkToolName };
    const state = applyDesignDisciplineProgress(
        st({ documentCreated: true }),
        'createTextLayer',
        true,
        fw
    );
    assert.strictEqual(state.needsObservationAfterMutation, true);
    assert.strictEqual(state.lastMutationToolName, 'createTextLayer');
    const result = guard(detailCtx, state, 'saveDocument');
    assert.ok(result && result.success === false);
    assert.strictEqual(result.nextRequiredTool, 'getAnnotatedSnapshot');
});

check('任意写后完成观察，保存通路恢复', () => {
    const fw = { frameworkToolName: detailCtx.frameworkToolName };
    let state = applyDesignDisciplineProgress(st({ documentCreated: true }), 'createTextLayer', true, fw);
    state = applyDesignDisciplineProgress(state, 'getCanvasSnapshot', true, fw);
    assert.strictEqual(state.needsObservationAfterMutation, false);
    assert.strictEqual(guard(detailCtx, state, 'saveDocument'), null);
});

check('改后未观察时导出同样被拦截', () => {
    const result = guard(
        detailCtx,
        st({
            documentCreated: true,
            needsObservationAfterMutation: true,
            observationIntent: 'export_readiness'
        }),
        'exportMainImageDocuments'
    );
    assert.ok(result && result.success === false);
    assert.strictEqual(result.nextRequiredTool, 'getCanvasSnapshot');
});

// ── 通用 Harness 不规定能力路线 ──
check('不强制知识→建档：无知识证据也不拦 createDocument', () => {
    assert.strictEqual(guard(detailCtx, st({}), 'createDocument'), null);
});

check('不强制建档→renderLayout：原子 placeImage 在建档前后均不被路线门禁拦截', () => {
    assert.strictEqual(guard(detailCtx, st({}), 'placeImage'), null);
    assert.strictEqual(guard(detailCtx, st({ documentCreated: true }), 'placeImage'), null);
    assert.strictEqual(
        guard(detailCtx, st({ documentCreated: true, layoutRendered: true }), 'placeImage'),
        null
    );
});

check('卡片、团队与白名单外工具不由设计纪律拦截', () => {
    const settled = st({ documentCreated: true, needsObservationAfterMutation: false });
    for (const tool of ['createInteractiveCard', 'delegateToAgent', 'runDesignTeamPipeline', 'createTextLayer']) {
        assert.strictEqual(guard(detailCtx, settled, tool), null, tool);
    }
});

check('合法 stagePlan 可直接执行，设计纪律不额外强迫知识或建档前置', () => {
    assert.strictEqual(guard(detailCtx, st({}), 'renderLayout', { stagePlan: VALID_STAGE_PLAN }), null);
});

console.log(`\n✅ design-discipline-guard golden-master 全部通过（${passed} 项）`);
