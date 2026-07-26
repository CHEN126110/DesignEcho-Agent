'use strict';

/**
 * smoke: 门禁出口治理（discipline gate exits）
 *
 * 治理原则：Harness 只强制跨品类不变量，不用知识/工具顺序把 Agent 困在某一种设计路径里。
 * 当前 design-discipline-runtime 只保留：显式 Skill 契约、重复动作停机、编辑模式防旁建、
 * 显式 reference-first、重复建档保护，以及通用「连续写后先观察」「写后观察再保存」。
 * 本 smoke 钉住三层出口不变量：
 *   1. 通用知识 gate 与固定 createDocument/renderLayout 路径已经移除；
 *   2. 连续写入达到阈值后必须先观察，任意写入后保存前也必须先观察，观察成功会解锁；
 *   3. 每个现存拒绝都有同状态可达的出口，agent-tool-decision-contract / skill-tools 亦然。
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

require('ts-node').register({
    transpileOnly: true,
    project: path.resolve(__dirname, '..', 'tsconfig.main.json')
});

const runtime = require(path.resolve(__dirname, '..', 'src', 'shared', 'design-discipline-runtime.ts'));
const {
    resolveDesignDisciplineContext,
    createDesignDisciplineState,
    applyDesignDisciplineProgress,
    evaluateDesignToolStateGuard,
    isDesignDisciplineMutationTool
} = runtime;
const {
    buildAgentToolDecisionContract
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'agent-tool-decision-contract.ts'));

let passed = 0;
function check(name, fn) {
    fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
}

const detailCtx = resolveDesignDisciplineContext({ taskText: '帮我做详情页', isCreativeDesignIntent: true });
const mainCtx = resolveDesignDisciplineContext({ taskText: '帮我做主图', isCreativeDesignIntent: true });
const skuCtx = resolveDesignDisciplineContext({ taskText: '帮我设计一版SKU模板', isCreativeDesignIntent: true });

/** 合法 stagePlan（与 smoke-design-discipline-runtime 同款），模拟模型"按指路正确重试" */
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

function guardWithBestParams(context, state, toolName) {
    // renderLayout 的指路语义是"带上正确的 stagePlan 重试"，其余工具无参数门禁
    const toolParams = toolName === 'renderLayout' ? { stagePlan: VALID_STAGE_PLAN } : undefined;
    return evaluateDesignToolStateGuard({ context, state, toolName, toolParams });
}

/**
 * 出口链不变量：一个拒绝的指路工具在同一状态下必须可通行；若指路工具也被拦，
 * 其拒绝必须继续给出指路，且链条在 maxHops 内到达可通行工具、不得成环（死锁）。
 */
function assertExitChainTerminates(context, state, rejection, label, maxHops = 3) {
    assert.ok(rejection && rejection.success === false, `${label}: 应是拒绝结果`);
    assert.ok(rejection.nextRequiredTool, `${label}: 拒绝必须携带 nextRequiredTool 指路`);
    const visited = new Set();
    let current = rejection;
    for (let hop = 0; hop < maxHops; hop += 1) {
        const nextTool = current.nextRequiredTool;
        assert.ok(nextTool, `${label}: 出口链第 ${hop + 1} 跳缺少 nextRequiredTool（只说不行不给出路）`);
        assert.ok(!visited.has(nextTool), `${label}: 出口链在 ${nextTool} 成环（指路进墙死锁）`);
        visited.add(nextTool);
        const next = guardWithBestParams(context, state, nextTool);
        if (next === null) return nextTool;
        current = next;
    }
    assert.fail(`${label}: 出口链 ${maxHops} 跳内未到达可通行工具（${[...visited].join(' → ')}）`);
}

console.log('smoke: discipline-gate-exits');

// ── 1. 当前守卫规则：不固定设计路径，只保留可验证的 Harness 不变量 ──

check('分支0：renderLayout 缺 stagePlan → 拒绝消息说明缺什么（同工具带 stagePlan 重试即通行）', () => {
    const state = createDesignDisciplineState({ documentCreated: true, designKnowledgeReadCount: 1 });
    const r = evaluateDesignToolStateGuard({ context: detailCtx, state, toolName: 'renderLayout', toolParams: {} });
    assert.ok(r && r.success === false);
    assert.strictEqual(r.nextRequiredTool, 'renderLayout', '指路=带正确参数重试同一工具');
    assert.ok(/stagePlan/.test(r.message), '消息必须点名缺失的 stagePlan');
    // 按指路正确重试（带合法 stagePlan）→ 通行
    assert.strictEqual(guardWithBestParams(detailCtx, state, 'renderLayout'), null);
});

check('分支1：重复方法论只要求回到观察/项目状态，不再指定 createDocument 或 renderLayout', () => {
    const preDocument = createDesignDisciplineState({ frameworkReadCount: 1 });
    const preResult = evaluateDesignToolStateGuard({
        context: detailCtx,
        state: preDocument,
        toolName: 'getDetailPageDesignFramework'
    });
    assert.strictEqual(preResult.nextRequiredTool, 'getDesignProjectState');
    assertExitChainTerminates(detailCtx, preDocument, preResult, '重复方法论(pre-document)');

    const inDocument = createDesignDisciplineState({ frameworkReadCount: 1, documentCreated: true });
    const inDocumentResult = evaluateDesignToolStateGuard({
        context: detailCtx,
        state: inDocument,
        toolName: 'getDetailPageDesignFramework'
    });
    assert.strictEqual(inDocumentResult.nextRequiredTool, 'getCanvasSnapshot');
    assertExitChainTerminates(detailCtx, inDocument, inDocumentResult, '重复方法论(in-document)');
});

check('通用知识 gate 已移除：Agent 可自主选择开稿和 Photoshop 写入路径', () => {
    const fresh = createDesignDisciplineState();
    for (const toolName of ['createDocument', 'placeImage', 'setTextContent', 'createRectangle']) {
        assert.strictEqual(
            evaluateDesignToolStateGuard({ context: detailCtx, state: fresh, toolName }),
            null,
            `${toolName} 不应因缺少通用知识证据或固定流程而被拦`
        );
    }
});

check('分支2.2b：编辑现有目标文档时禁止旁建；只有 Harness 可信授权是可达出口', () => {
    const editingContext = resolveDesignDisciplineContext({
        taskText: '帮我修改详情页',
        isCreativeDesignIntent: true,
        activeDocumentName: '详情页.psb'
    });
    const state = createDesignDisciplineState();
    const rejection = evaluateDesignToolStateGuard({ context: editingContext, state, toolName: 'createDocument' });
    assert.strictEqual(rejection.nextRequiredTool, 'switchDocument');
    assertExitChainTerminates(editingContext, state, rejection, '编辑模式旁建保护');
    assert.ok(evaluateDesignToolStateGuard({
        context: editingContext,
        state,
        toolName: 'createDocument',
        toolParams: { confirmNewDocumentDespiteExisting: true }
    }), '模型伪确认参数不能放行');
    assert.strictEqual(evaluateDesignToolStateGuard({
        context: editingContext,
        state,
        toolName: 'createDocument',
        trustedCreateDocumentAuthorization: true
    }), null, 'Harness 已确认独立交付目标后应可通行');
});

check('分支2.3：只有显式 SKU reference-first 保留，参考证据后即可开稿', () => {
    const fresh = createDesignDisciplineState();
    const rejection = evaluateDesignToolStateGuard({ context: skuCtx, state: fresh, toolName: 'createDocument' });
    assert.strictEqual(rejection.nextRequiredTool, 'searchEagleReferences');
    assertExitChainTerminates(skuCtx, fresh, rejection, 'SKU reference-first');
    const withReference = applyDesignDisciplineProgress(
        fresh,
        'analyzeAssetContent',
        true,
        { frameworkToolName: skuCtx.frameworkToolName }
    );
    assert.strictEqual(
        evaluateDesignToolStateGuard({ context: skuCtx, state: withReference, toolName: 'createDocument' }),
        null,
        '一条参考证据应满足 SKU reference-first，不再叠加通用知识 gate'
    );
});

check('分支5：重复建档指路读取当前文档状态，不再固定后续必须 renderLayout', () => {
    const state = createDesignDisciplineState({ documentCreated: true });
    const rejection = evaluateDesignToolStateGuard({ context: detailCtx, state, toolName: 'createDocument' });
    assert.strictEqual(rejection.nextRequiredTool, 'getDocumentInfo');
    assertExitChainTerminates(detailCtx, state, rejection, '重复建档');
});

check('分支2：连续写入达到阈值后，所有后续写入（含 renderLayout）统一指路观察', () => {
    const fw = { frameworkToolName: detailCtx.frameworkToolName };
    let state = createDesignDisciplineState({ documentCreated: true });
    for (const toolName of ['placeImage', 'setTextContent', 'moveLayer', 'transformLayer']) {
        assert.strictEqual(
            guardWithBestParams(detailCtx, state, toolName),
            null,
            `${toolName} 在达到连续写阈值前应可执行`
        );
        state = applyDesignDisciplineProgress(state, toolName, true, fw);
    }
    assert.strictEqual(state.repairAttemptCount, 3, '四次连续写入后应累计到三次未观察修正');
    assert.strictEqual(state.needsObservationAfterMutation, true);

    for (const toolName of ['setTextStyle', 'replaceLayerContent', 'renderLayout']) {
        const rejection = guardWithBestParams(detailCtx, state, toolName);
        assert.ok(rejection && rejection.success === false, `${toolName} 达到阈值后必须被观察 gate 拦下`);
        assert.ok(['getAnnotatedSnapshot', 'getCanvasSnapshot'].includes(rejection.nextRequiredTool));
        assertExitChainTerminates(detailCtx, state, rejection, `连续写入达阈值(${toolName})`);
    }
    const mainRejection = evaluateDesignToolStateGuard({ context: mainCtx, state, toolName: 'renderLayout' });
    assert.ok(mainRejection && ['getAnnotatedSnapshot', 'getCanvasSnapshot'].includes(mainRejection.nextRequiredTool),
        '不要求 stagePlan 的主图 renderLayout 也不能绕过连续写入观察 gate');

    const observationTool = guardWithBestParams(detailCtx, state, 'setTextStyle').nextRequiredTool;
    const unchanged = applyDesignDisciplineProgress(state, observationTool, false, fw);
    assert.strictEqual(unchanged.repairAttemptCount, 3, '失败的观察不能伪造解锁');
    assert.ok(guardWithBestParams(detailCtx, unchanged, 'setTextStyle'), '失败观察后写入仍应被拦');

    state = applyDesignDisciplineProgress(state, observationTool, true, fw);
    assert.strictEqual(state.needsObservationAfterMutation, false, '成功观察应清除写后待观察状态');
    assert.strictEqual(state.repairAttemptCount, 0, '成功观察应重置连续写入计数');
    assert.strictEqual(guardWithBestParams(detailCtx, state, 'setTextStyle'), null,
        '观察成功后 Planner 可自主选择下一项写能力');
});

check('分支7：任意 Photoshop 写入后保存前必须观察，成功观察是可达出口', () => {
    const fw = { frameworkToolName: detailCtx.frameworkToolName };
    for (const mutationTool of ['renderLayout', 'placeImage', 'setTextContent', 'createRectangle']) {
        assert.ok(isDesignDisciplineMutationTool(mutationTool), `${mutationTool} 必须被识别为 Photoshop 写入`);
        let state = createDesignDisciplineState({ documentCreated: true });
        state = applyDesignDisciplineProgress(state, mutationTool, true, fw);
        assert.strictEqual(state.needsObservationAfterMutation, true, `${mutationTool} 成功后必须等待观察`);

        const rejection = evaluateDesignToolStateGuard({ context: detailCtx, state, toolName: 'saveDocument' });
        assert.ok(rejection && ['getAnnotatedSnapshot', 'getCanvasSnapshot'].includes(rejection.nextRequiredTool),
            `${mutationTool} 后直接保存必须被观察 gate 拦下`);
        assertExitChainTerminates(detailCtx, state, rejection, `写后保存(${mutationTool})`);

        state = applyDesignDisciplineProgress(state, rejection.nextRequiredTool, true, fw);
        assert.strictEqual(
            evaluateDesignToolStateGuard({ context: detailCtx, state, toolName: 'saveDocument' }),
            null,
            `${mutationTool} 后成功观察应解锁保存`
        );
    }
});

// ── 2. agent-tool-decision-contract 拒绝出口：消息必含替代路径 ──

function buildContract(overrides) {
    return buildAgentToolDecisionContract({
        userInput: '帮我处理画面',
        intentControlPlane: { toolScope: 'write_photoshop', requestKind: 'autonomous_execution' },
        assistantContent: '先读取当前文档结构，再决定怎么改，改完复核截图。',
        ...overrides
    });
}

check('契约：tool_unavailable → 消息指路"从已提供工具中改选"', () => {
    const contract = buildContract({
        toolCalls: [{ name: 'getLayerBounds' }],
        runtime: { availableTools: ['getDocumentInfo'], photoshopConnected: true, hasDocument: true }
    });
    const b = contract.blockers.find((item) => item.code === 'tool_unavailable');
    assert.ok(b, '应有 tool_unavailable 阻断');
    assert.ok(/改选|可用工具/.test(b.message), `消息应含替代路径指引：${b.message}`);
});

check('契约：unknown_tool_kind → 消息指路"改用已登记工具"并给登记方向', () => {
    const contract = buildContract({
        toolCalls: [{ name: 'totallyUnknownTool' }],
        runtime: { photoshopConnected: true, hasDocument: true }
    });
    const b = contract.blockers.find((item) => item.code === 'unknown_tool_kind');
    assert.ok(b, '应有 unknown_tool_kind 阻断');
    assert.ok(/改用/.test(b.message) && /登记/.test(b.message), `消息应含替代路径与登记方向：${b.message}`);
});

check('契约：tool_scope_exceeds_intent → 消息说明允许范围并给替代方向', () => {
    const contract = buildContract({
        intentControlPlane: { toolScope: 'read_only', requestKind: 'read_only_inspect' },
        toolCalls: [{ name: 'placeImage', arguments: { filePath: 'a.png' } }],
        runtime: { photoshopConnected: true, hasDocument: true }
    });
    const b = contract.blockers.find((item) => item.code === 'tool_scope_exceeds_intent');
    assert.ok(b, '应有 tool_scope_exceeds_intent 阻断');
    assert.ok(/只读分析/.test(b.message), `消息应说明当前允许范围：${b.message}`);
    assert.ok(/改用|扩大操作范围/.test(b.message), `消息应给替代方向：${b.message}`);
});

check('契约：photoshop_document_required → 指路 createDocument/listDocuments/switchDocument（均为无文档可用工具，不会被同门禁拦）', () => {
    const contract = buildContract({
        toolCalls: [{ name: 'placeImage', arguments: { filePath: 'a.png' } }],
        runtime: { photoshopConnected: true, hasDocument: false }
    });
    const b = contract.blockers.find((item) => item.code === 'photoshop_document_required');
    assert.ok(b, '应有 photoshop_document_required 阻断');
    assert.ok(/createDocument/.test(b.message), `消息应指路 createDocument：${b.message}`);
    // 交叉验证：指路工具走同一契约不再触发同类阻断（指路不进墙）
    for (const tool of ['createDocument', 'listDocuments', 'switchDocument']) {
        const followup = buildContract({
            toolCalls: [{ name: tool, arguments: tool === 'createDocument' ? { width: 800, height: 800 } : {} }],
            runtime: { photoshopConnected: true, hasDocument: false }
        });
        assert.ok(
            !followup.blockers.some((item) => item.code === 'photoshop_document_required'),
            `指路工具 ${tool} 不得被同一无文档门禁拦截`
        );
    }
});

check('契约：photoshop_not_connected → 消息含恢复动作与"可先用不依赖 PS 的工具"', () => {
    const contract = buildContract({
        toolCalls: [{ name: 'getDocumentInfo' }],
        runtime: { photoshopConnected: false, hasDocument: false }
    });
    const b = contract.blockers.find((item) => item.code === 'photoshop_not_connected');
    assert.ok(b, '应有 photoshop_not_connected 阻断');
    assert.ok(/插件面板|UXP/.test(b.message), `消息应含连接恢复动作：${b.message}`);
    assert.ok(/不依赖 Photoshop/.test(b.message), `消息应指出可先用不依赖 PS 的工具：${b.message}`);
});

check('契约：intent_scope_disallows_tools → 消息指路"直接用文字回答"', () => {
    const contract = buildContract({
        intentControlPlane: { toolScope: 'none', requestKind: 'conversation' },
        toolCalls: [{ name: 'getDocumentInfo' }],
        runtime: { photoshopConnected: true, hasDocument: true }
    });
    const b = contract.blockers.find((item) => item.code === 'intent_scope_disallows_tools');
    assert.ok(b, '应有 intent_scope_disallows_tools 阻断');
    assert.ok(/直接用文字回答/.test(b.message), `消息应给出替代动作：${b.message}`);
});

// ── 3. Skill 执行点拒绝出口（renderer 模块含 store 依赖，用源码文本钉住） ──

check('skill-tools：三个拒绝出口消息均含替代路径指引', () => {
    const source = fs.readFileSync(
        path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'skill-executors', 'skill-tools.ts'),
        'utf8'
    );
    assert.ok(
        source.includes('未注册的技能: ${toolName}。请改用本轮可用工具列表中的原子工具完成同一目标。'),
        '未注册技能拒绝应指路原子工具'
    );
    assert.ok(
        source.includes('请改用基础原子工具完成同一目标，或提示用户在设置中启用该技能。'),
        '技能关闭拒绝应指路原子工具/设置'
    );
    assert.ok(
        source.includes('请改用基础处理动作完成该任务'),
        '执行器缺失拒绝应指路基础处理动作'
    );
    const skuExecutorSource = fs.readFileSync(
        path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'skill-executors', 'sku-batch.executor.ts'),
        'utf8'
    );
    // SKU 模板设计移交已归 SKU Skill 所有，必须继续携带 suggestedNextActions（既有出口不退化）。
    assert.ok(
        skuExecutorSource.includes('suggestedNextActions'),
        'SKU 模板设计移交应携带建议动作列表'
    );
});

console.log(`\n✅ discipline-gate-exits smoke 全部通过（${passed} 项）`);
