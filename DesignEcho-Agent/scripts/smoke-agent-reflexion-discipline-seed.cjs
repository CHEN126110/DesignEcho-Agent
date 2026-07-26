'use strict';

/**
 * smoke: reflexion 重入纪律播种（V0-4）
 *
 * 病灶（治理审计 2026-07-08）：reflexion 重入时 autonomous 执行器用 createExecuteToolWrapper
 * 新建 disciplineState，被 createDesignDisciplineState() 重置为全 false；上一轮 documentCreated=true
 * 只活在软 brief 里不回灌。通用 Harness 现已允许 placeImage 自由执行，但如果模型在重入轮再次
 * 调用 createDocument，缺失的 documentCreated 事实仍会让它在存量画布旁另建空文档。
 *
 * 修复：重入时用上一轮 run-record checkpoint 的确定性旗标
 * createDesignDisciplineState({ documentCreated, layoutRendered }) 播种。
 *
 * 本 smoke 用 ts-node 真跑 design-discipline-runtime + agent-run-record：
 *  A) 行为层：checkpoint 派生 → 播种状态；placeImage 保持自由，显式 createDocument 被
 *     「已建画布」分支拦下，不产生第二份画布语义。
 *  B) 对照：不播种（全 false）时 placeImage 仍自由，但重复 createDocument 无法被识别。
 *  C) 健壮性：空/异常结果派生 → 不播种（回退全 false），绝不抛错。
 *  D) 接线层：读执行器源码，确认播种旗标被真正接进重入路径与 wrapper 初始化。
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

require('ts-node').register({
    transpileOnly: true,
    project: path.resolve(__dirname, '..', 'tsconfig.main.json')
});

const ROOT = path.resolve(__dirname, '..');
const D = require(path.join(ROOT, 'src', 'shared', 'design-discipline-runtime.ts'));
const R = require(path.join(ROOT, 'src', 'shared', 'agent-run-record.ts'));

const {
    resolveDesignDisciplineContext,
    createDesignDisciplineState,
    evaluateDesignToolStateGuard
} = D;
const { buildAgentRunRecord } = R;

let passed = 0;
function check(name, fn) {
    fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
}

/**
 * 与执行器 deriveReflexionDisciplineSeed 一致的纯派生：从上一轮结果取 run-record checkpoint 的
 * documentCreated/layoutRendered；两者皆 false 时返回 undefined（不播种）。
 */
function deriveSeed(result) {
    try {
        const cp = buildAgentRunRecord({ now: '', goal: '', result: result || {} }).checkpoint;
        if (!cp.documentCreated && !cp.layoutRendered) return undefined;
        return { documentCreated: cp.documentCreated, layoutRendered: cp.layoutRendered };
    } catch (_e) {
        return undefined;
    }
}

function guard(ctx, state, toolName, toolParams) {
    return evaluateDesignToolStateGuard({ context: ctx, state, toolName, toolParams: toolParams || {} });
}

console.log('smoke: agent-reflexion-discipline-seed');

// 从零详情页设计上下文（active，方法论工具=getDetailPageDesignFramework）
const ctx = resolveDesignDisciplineContext({ taskText: '帮我做详情页', isCreativeDesignIntent: true });
assert.strictEqual(ctx.active, true, '详情页从零设计上下文应激活');
assert.strictEqual(ctx.frameworkToolName, 'getDetailPageDesignFramework');

// 上一轮：成功 createDocument + placeImage（未排版）→ checkpoint doc=T, layout=F
const prevRoundDocOnly = {
    success: false,
    iterations: 3,
    stopReason: 'design_quality_hard_blocked',
    toolCallLog: [
        { name: 'createDocument', arguments: { name: '详情页' }, result: { success: true } },
        { name: 'placeImage', arguments: { path: 'a.png' }, result: { success: true, layerId: 12, layerName: '产品图' } }
    ],
    executionSummary: { status: 'needs_review' }
};
// 上一轮：成功 createDocument + renderLayout → checkpoint doc=T, layout=T
const prevRoundWithLayout = {
    success: false,
    iterations: 5,
    toolCallLog: [
        { name: 'createDocument', arguments: {}, result: { success: true } },
        { name: 'renderLayout', arguments: {}, result: { success: true } }
    ],
    executionSummary: { status: 'needs_review' }
};

// ── A) checkpoint 派生的真值（run-record 口径） ──
check('checkpoint 派生：createDocument+placeImage → documentCreated=true, layoutRendered=false', () => {
    const cp = buildAgentRunRecord({ now: '', goal: '', result: prevRoundDocOnly }).checkpoint;
    assert.strictEqual(cp.documentCreated, true);
    assert.strictEqual(cp.layoutRendered, false);
    // 实体锚也在档案里（供 H2 续跑 brief）：layerId 必需，提得到就记
    assert.deepStrictEqual(cp.placedLayers, [{ layerId: 12, name: '产品图' }]);
});

check('checkpoint 派生：createDocument+renderLayout → layoutRendered=true', () => {
    const cp = buildAgentRunRecord({ now: '', goal: '', result: prevRoundWithLayout }).checkpoint;
    assert.strictEqual(cp.documentCreated, true);
    assert.strictEqual(cp.layoutRendered, true);
});

// ── B) 修复：播种后 placeImage 自由，重复 createDocument 仍被确定性拦截 ──
check('播种 doc=T,layout=F 后：首个 placeImage 自由放行', () => {
    const seed = deriveSeed(prevRoundDocOnly);
    assert.deepStrictEqual(seed, { documentCreated: true, layoutRendered: false });
    const state = createDesignDisciplineState(seed);
    const g = guard(ctx, state, 'placeImage');
    assert.strictEqual(g, null, 'placeImage 不应被通用 Harness 规定固定顺序');
});

check('播种 doc=T,layout=T 后：首个 placeImage 仍自由放行', () => {
    const seed = deriveSeed(prevRoundWithLayout);
    assert.deepStrictEqual(seed, { documentCreated: true, layoutRendered: true });
    const state = createDesignDisciplineState(seed);
    const g = guard(ctx, state, 'placeImage');
    assert.strictEqual(g, null, '已有排版也不能禁止 Agent 继续置入新素材');
});

check('播种 doc=T 后：显式 createDocument 被「已建画布」分支拦下 → 不产生第二份画布语义', () => {
    const state = createDesignDisciplineState(deriveSeed(prevRoundDocOnly));
    const g = guard(ctx, state, 'createDocument');
    assert.ok(g && g.success === false, '重入后再 createDocument 必须被拦，避免旁建空文档');
    assert.notStrictEqual(g.nextRequiredTool, 'createDocument');
});

// ── C) 对照：不播种不会限制 placeImage，但会失去重复建档保护 ──
check('对照：不播种(全 false) → placeImage 仍自由，createDocument 也无法识别为重复建档', () => {
    const fresh = createDesignDisciplineState();
    assert.strictEqual(guard(ctx, fresh, 'placeImage'), null, 'placeImage 的自由度不依赖播种');
    assert.strictEqual(
        guard(ctx, fresh, 'createDocument'),
        null,
        '未播种时 runtime 不知道上一轮已经建档，证明 documentCreated 回灌仍是必要事实'
    );
});

// ── D) 健壮性：空/异常结果派生不抛错、不播种（回退全 false） ──
check('健壮性：空结果 / undefined / 失败无产物 → 不播种（seed=undefined），createDesignDisciplineState 全 false', () => {
    assert.strictEqual(deriveSeed({}), undefined);
    assert.strictEqual(deriveSeed(undefined), undefined);
    assert.strictEqual(deriveSeed({ toolCallLog: [] }), undefined);
    // 上一轮 createDocument 失败（success:false）→ 不算已建画布，不播种
    assert.strictEqual(deriveSeed({
        toolCallLog: [{ name: 'createDocument', result: { success: false } }]
    }), undefined);
    const state = createDesignDisciplineState(deriveSeed(undefined));
    assert.strictEqual(state.documentCreated, false);
    assert.strictEqual(state.layoutRendered, false);
});

// ── E) 接线层：确认播种旗标被真正接进执行器（防日后被摘线） ──
check('执行器接线：重入路径播种 + wrapper 用种子初始化 disciplineState', () => {
    const src = fs.readFileSync(
        path.join(ROOT, 'src', 'renderer', 'services', 'skill-executors', 'autonomous-agent.executor.ts'),
        'utf8'
    );
    assert.ok(src.includes('function deriveReflexionDisciplineSeed'), '缺派生函数 deriveReflexionDisciplineSeed');
    // 累积并集写法（旗标只增不减，防多轮衰减）：断言"用 result 派生"+"回灌到 runtimeParams.reflexionDisciplineSeed"
    // 两个事实即可，不写死单轮字面量，兼容单轮/累积两种实现。
    assert.ok(
        src.includes('deriveReflexionDisciplineSeed(result)'),
        '重入循环必须用上一轮 result 派生种子'
    );
    assert.ok(
        /runtimeParams\.reflexionDisciplineSeed\s*=/.test(src),
        '重入循环必须把纪律种子回灌到 runtimeParams.reflexionDisciplineSeed'
    );
    assert.ok(
        src.includes('createDesignDisciplineState(reflexionDisciplineSeed)'),
        'wrapper 必须用种子初始化 disciplineState'
    );
    // 派生取自 run-record 的 checkpoint 口径（buildAgentRunRecord 无 IPC/FS 副作用）
    assert.ok(src.includes('buildAgentRunRecord('), '派生应复用 buildAgentRunRecord 的 checkpoint 口径');
});

console.log(`\n✅ agent-reflexion-discipline-seed smoke 全部通过（${passed} 项）`);
