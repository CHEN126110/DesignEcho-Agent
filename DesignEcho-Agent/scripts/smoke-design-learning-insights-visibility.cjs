#!/usr/bin/env node
/* eslint-disable no-console */

/**
 * smoke: 学习洞察可见性（2026-07-03）
 *
 * 诉求：用户要看见 Agent 学到的真实内容（不只是数字/summary blob），以便判断与调整。
 * 此前 designLearningExperiencesToMemoryItems 把 reusableHeuristics 只留计数、avoidWhen/limitations
 * 整条丢弃。本 smoke 钉住：结构化洞察从 experience → memory item → 复核队列视图 全程无损保留。
 */

const path = require('path');
require('ts-node').register({
    transpileOnly: true,
    project: path.resolve(__dirname, '..', 'tsconfig.main.json')
});

function createLocalStorageMock() {
    const data = new Map();
    return {
        getItem(key) { return data.has(key) ? data.get(key) : null; },
        setItem(key, value) { data.set(key, String(value)); },
        removeItem(key) { data.delete(key); },
        clear() { data.clear(); }
    };
}

global.localStorage = createLocalStorageMock();

const { designLearningExperiencesToMemoryItems } = require(path.resolve(__dirname, '..', 'src', 'shared', 'design-learning-experience.ts'));
const { buildDesignLearningMemoryReviewQueueView } = require(path.resolve(__dirname, '..', 'src', 'shared', 'design-learning-memory-review-queue.ts'));
const MemoryService = require(path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'memory.service.ts')).default;

let failures = 0;
function check(name, ok, hint) {
    if (ok) { console.log(`  ok  ${name}`); }
    else { failures += 1; console.error(`  FAIL ${name}${hint ? ` — ${hint}` : ''}`); }
}

const record = {
    recordId: 'r1',
    title: '浅色影棚风袜品主图',
    source: { referenceId: 'ref1', tags: ['袜子', '主图'] },
    productCategory: '袜子',
    designType: 'main-image',
    summary: '浅灰渐变背景 + 居中主体 + 简短卖点',
    whatLooksGood: ['背景干净留白足', '主体占比约一半突出'],
    whyItWorks: ['低饱和背景衬托产品真实色', '强对比让卖点第一眼可读'],
    suitableScenarios: ['浅色针织类', '需要突出材质的产品'],
    avoidWhen: ['深色重工艺产品', '需要浓氛围的节日款'],
    reusableHeuristics: ['主体占画面 40-55%', '卖点字号≥主标题的 0.6', '背景与主体明度差≥30%'],
    reviewStatus: 'reviewed_pending',
    canBecomeMemory: true,
    sourceNotes: ['Eagle: 100 张浅色袜品参考'],
    limitations: ['样本偏浅色系，深色适配未验证']
};

const index = { version: 'design-learning-experience/v0', status: 'ready', records: [record], summary: { referenceCount: 1, observationCount: 1, recordCount: 1 } };
const items = designLearningExperiencesToMemoryItems(index, { now: '2026-07-03T00:00:00.000Z' });

check('转出 1 条记忆候选', items.length === 1, JSON.stringify(items.length));
const mem = items[0];
check('memory item 携带 learnedInsights', !!mem.learnedInsights);
if (mem.learnedInsights) {
    // 关键：此前被丢弃的三类必须全量保留
    check('reusableHeuristics 全量保留（此前只留计数）',
        JSON.stringify(mem.learnedInsights.reusableHeuristics) === JSON.stringify(record.reusableHeuristics),
        JSON.stringify(mem.learnedInsights.reusableHeuristics));
    check('avoidWhen 保留（此前丢弃）',
        JSON.stringify(mem.learnedInsights.avoidWhen) === JSON.stringify(record.avoidWhen));
    check('limitations 保留（此前丢弃）',
        JSON.stringify(mem.learnedInsights.limitations) === JSON.stringify(record.limitations));
    check('whatLooksGood/whyItWorks/suitableScenarios 保留',
        JSON.stringify(mem.learnedInsights.whatLooksGood) === JSON.stringify(record.whatLooksGood)
        && JSON.stringify(mem.learnedInsights.whyItWorks) === JSON.stringify(record.whyItWorks)
        && JSON.stringify(mem.learnedInsights.suitableScenarios) === JSON.stringify(record.suitableScenarios));
}

// summary 仍保持简洁（提示词注入用），不因保留明细而膨胀成整块
check('summary 仍是简洁串（不塞入全部手法）', typeof mem.summary === 'string' && !mem.summary.includes(record.reusableHeuristics[2]));

// 视觉案例端到端保留：observation.visualCase → record → memory → queue view
const idxWithVisual = {
    version: 'design-learning-experience/v0', status: 'ready',
    records: [], summary: { referenceCount: 1, observationCount: 1, recordCount: 1 }
};
const { buildDesignLearningExperienceIndex } = require(path.resolve(__dirname, '..', 'src', 'shared', 'design-learning-experience.ts'));
const builtIndex = buildDesignLearningExperienceIndex({
    generatedAt: '2026-07-03T00:00:00.000Z',
    observations: [{
        referenceId: 'ref-visual',
        analysisSource: 'analyzeDesignReference',
        summary: '浅色影棚风',
        strengths: [{ observation: '主体突出', reason: '强对比' }, { observation: '留白足', reason: '低饱和背景' }],
        suitableScenarios: ['浅色针织'],
        reusableHeuristics: ['主体占40-55%'],
        visualCase: { previewDataUrl: 'data:image/png;base64,AAA', sourceKind: 'project_image', subjectRect: { x: 0.3, y: 0.25, w: 0.4, h: 0.5 }, showCompositionGrid: true, caption: '项目图 · 月子袜' }
    }]
});
const visualItems = designLearningExperiencesToMemoryItems(builtIndex, { now: '2026-07-03T00:00:00.000Z' });
check('带视觉案例的记录转出 memory item', visualItems.length === 1 && !!visualItems[0].visualCase, JSON.stringify(visualItems.length));
if (visualItems[0] && visualItems[0].visualCase) {
    check('视觉案例 subjectRect 无损', JSON.stringify(visualItems[0].visualCase.subjectRect) === JSON.stringify({ x: 0.3, y: 0.25, w: 0.4, h: 0.5 }));
    check('视觉案例 sourceKind/previewDataUrl 保留', visualItems[0].visualCase.sourceKind === 'project_image' && String(visualItems[0].visualCase.previewDataUrl).startsWith('data:'));
    const vView = buildDesignLearningMemoryReviewQueueView({ items: visualItems });
    check('队列视图透传 visualCase 供面板展示', !!vView.items[0] && !!vView.items[0].visualCase && !!vView.items[0].visualCase.subjectRect);

    const memoryService = new MemoryService();
    memoryService.recordDesignLearningMemoryReview({
        candidate: visualItems[0],
        decision: 'needs_review',
        reviewer: 'smoke-reviewer',
        reviewedAt: '2026-07-03T00:05:00.000Z'
    });
    const reloaded = new MemoryService();
    const persisted = reloaded.listPersistedDesignMemoryItems({ status: 'needs_review' })[0];
    check('学习洞察跨持久化重载保留', !!persisted && !!persisted.learnedInsights && persisted.learnedInsights.reusableHeuristics[0] === '主体占40-55%');
    check('视觉案例跨持久化重载保留', !!persisted && !!persisted.visualCase && !!persisted.visualCase.subjectRect && persisted.visualCase.caption === '项目图 · 月子袜');
}

// 复核队列视图必须透传 insights 供面板展示
const view = buildDesignLearningMemoryReviewQueueView({ items });
check('队列视图返回 1 条', view.items.length === 1, JSON.stringify(view.items.length));
const v = view.items[0];
check('队列视图 item 携带 insights', !!v.insights);
if (v.insights) {
    check('视图 insights.reusableHeuristics 无损',
        JSON.stringify(v.insights.reusableHeuristics) === JSON.stringify(record.reusableHeuristics));
    check('视图 insights 六类齐全',
        !!v.insights.whatLooksGood && !!v.insights.whyItWorks && !!v.insights.reusableHeuristics
        && !!v.insights.suitableScenarios && !!v.insights.avoidWhen && !!v.insights.limitations);
}

// 空洞察不产出空块
const emptyItems = designLearningExperiencesToMemoryItems({
    version: 'design-learning-experience/v0', status: 'ready',
    records: [{ ...record, whatLooksGood: [], whyItWorks: [], reusableHeuristics: [], suitableScenarios: [], avoidWhen: [], limitations: [] }],
    summary: { referenceCount: 1, observationCount: 1, recordCount: 1 }
}, { now: '2026-07-03T00:00:00.000Z' });
const emptyView = buildDesignLearningMemoryReviewQueueView({ items: emptyItems });
check('全空洞察 → 视图不带 insights（面板不渲染空块）', emptyView.items[0] && emptyView.items[0].insights === undefined);

if (failures > 0) { console.error(`[smoke-design-learning-insights-visibility] FAILED (${failures})`); process.exit(1); }
console.log('[smoke-design-learning-insights-visibility] passed');
