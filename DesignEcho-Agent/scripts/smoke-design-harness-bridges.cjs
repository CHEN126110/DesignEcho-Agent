'use strict';

/**
 * smoke: 设计 harness 三桥（2026-07-07，对齐用户日常设计工作流四步）
 *
 * 背景：用户工作流 = ①看素材理解产品并分类标注 → ②市场调研提炼卖点定人群风格 →
 * ③结构化分屏规划卖点文案 → ④按痛点表现形式找参考做设计。
 * 系统知识层/数据层早已同构，但执行链有三处断桥，本 smoke 守护三桥不再断回去：
 * - 桥一：素材理解产出卖点证据（analyzeAssetContent 的 shotType/sellingPointEvidence）并引导沉淀
 * - 桥二：痛点/卖点/类目/材质/风格库接进 searchDesignKnowledge（market_insight 分面）
 * - 桥三：痛点表现形式的用法引导（stage-plan 证据来源 + Eagle 检索联动）
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const agentRoot = path.resolve(__dirname, '..');

require('ts-node').register({
    transpileOnly: true,
    project: path.resolve(agentRoot, 'tsconfig.main.json')
});

const { searchLocalDesignKnowledge } = require(path.resolve(agentRoot, 'src/shared/design-knowledge-search.ts'));

let passed = 0;
const failures = [];
function check(name, fn) {
    try {
        fn();
        passed += 1;
        console.log(`  ok  ${name}`);
    } catch (e) {
        failures.push({ name, error: e.message });
        console.error(`  FAIL ${name}: ${e.message}`);
    }
}

function read(rel) {
    return fs.readFileSync(path.join(agentRoot, rel), 'utf8');
}

console.log('── 桥二：市场洞察检索（行为级）──');

check('「起毛球」痛点具体命中排第一，且带视觉表现建议', () => {
    const r = searchLocalDesignKnowledge({ query: '袜子 起毛球 痛点', intents: ['market_insight'] });
    assert.ok(r.results.length > 0, '应有结果');
    assert.ok(r.results[0].title.includes('起球'), `第一名应是起球痛点，实际：${r.results[0].title}`);
    assert.ok(r.results[0].evidence.some((e) => e.includes('视觉表现建议')), '痛点条目应携带视觉表现建议');
});

check('「勒脚」不带分面也可达（intents 默认全开）', () => {
    const r = searchLocalDesignKnowledge({ query: '袜子 勒脚' });
    const hit = r.results.find((x) => x.intent === 'market_insight');
    assert.ok(hit, '默认意图下市场洞察应可达');
    assert.ok(hit.title.includes('勒脚'), `应命中勒脚痛点，实际：${hit.title}`);
});

check('「甜美 年轻女孩」命中可爱风（人群→风格判断素材）', () => {
    const r = searchLocalDesignKnowledge({ query: '袜子 甜美 年轻女孩', intents: ['market_insight'] });
    assert.ok(r.results.some((x) => x.title.includes('可爱风')), '应命中风格·可爱风');
});

check('「纯棉」命中材质类卖点', () => {
    const r = searchLocalDesignKnowledge({ query: '袜子 纯棉 卖点', intents: ['market_insight'] });
    assert.ok(r.results.some((x) => x.title.includes('100%纯棉') || x.title.includes('纯棉')), '应命中纯棉卖点');
});

check('空查询不返回市场洞察（不淹没）', () => {
    const r = searchLocalDesignKnowledge({ query: '' });
    assert.strictEqual(r.results.filter((x) => x.intent === 'market_insight').length, 0);
});

check('非市场查询不被市场条目淹没（第一名非 market_insight）', () => {
    const r = searchLocalDesignKnowledge({ query: '版式 排版' });
    assert.ok(r.results.length > 0);
    assert.notStrictEqual(r.results[0].intent, 'market_insight');
});

check('分面互斥：intents=[recipe] 时无市场条目', () => {
    const r = searchLocalDesignKnowledge({ query: '袜子 起毛球 痛点', intents: ['recipe'] });
    assert.strictEqual(r.results.filter((x) => x.intent === 'market_insight').length, 0);
});

check('来源标注：袜子品类调研沉淀（防照抄+品类边界）', () => {
    const r = searchLocalDesignKnowledge({ query: '袜子 勒脚', intents: ['market_insight'] });
    assert.ok(r.results[0].evidence.some((e) => e.includes('袜子品类') && e.includes('调研')), '应标注品类与来源');
});

check('sourceType 复用 manual_rule（不新增枚举，契约零破坏）', () => {
    const r = searchLocalDesignKnowledge({ query: '袜子 起毛球', intents: ['market_insight'] });
    assert.ok(r.results.every((x) => x.sourceType === 'manual_rule'));
});

check('卖点条目带提炼原则（有效卖点=优势∩在意∩竞品不突出）', () => {
    const r = searchLocalDesignKnowledge({ query: '袜子 纯棉 卖点', intents: ['market_insight'] });
    const selling = r.results.find((x) => x.tags.includes('selling-point'));
    assert.ok(selling, '应有卖点条目');
    assert.ok(selling.evidence.some((e) => e.includes('产品优势') && e.includes('竞品不突出')), '卖点应带提炼原则');
});

check('非袜子类目显式 fail-closed，不混入袜子市场知识', () => {
    const r = searchLocalDesignKnowledge({ query: '护肤品 痛点', intents: ['market_insight'] });
    assert.strictEqual(r.results.filter((x) => x.tags.includes('socks')).length, 0);
    assert.ok(r.warnings.some((warning) => warning.includes('仅覆盖袜子类目')));
});

console.log('── 桥一：素材理解卖点证据（源码 pin）──');

const resourceManager = read('src/main/services/resource-manager-service.ts');
check('视觉分析 prompt 含 shotType 归类（平铺/模特/细节特写）', () => {
    assert.ok(resourceManager.includes('"shotType": "flat_lay | on_model | detail_closeup | package | chart | scene | other"'));
    assert.ok(resourceManager.includes('flat_lay = product laid flat'));
});
check('视觉分析 prompt 含 sellingPointEvidence 严格指引（仅图中可见）', () => {
    assert.ok(resourceManager.includes('"sellingPointEvidence"'));
    assert.ok(resourceManager.includes('only claim what is actually visible in THIS image'));
});
check('AssetContentAnalysis 类型含两个新字段', () => {
    assert.ok(/shotType\?: string;/.test(resourceManager));
    assert.ok(/sellingPointEvidence\?: string\[\];/.test(resourceManager));
});
check('分析缓存版本已 bump（旧缓存不再缺新字段）', () => {
    assert.ok(resourceManager.includes("ASSET_ANALYSIS_VERSION = 'v4-selling-point-evidence'"));
});

const executor = read('src/renderer/services/tool-executor.service.ts');
check('分发点带版本化事实候选沉淀引导（upsertFacts）', () => {
    assert.ok(executor.includes('sellingPointEvidenceNotice'));
    assert.ok(executor.includes('updateDesignProjectState.upsertFacts'));
    assert.ok(executor.includes('未经用户或可信证据确认前只能待复核'));
});

const schemas = read('src/renderer/services/agent-runtime/tool-schemas.ts');
check('analyzeAssetContent 工具描述含卖点标注与沉淀引导', () => {
    const m = schemas.match(/name: 'analyzeAssetContent',\s*\n\s*description: '([^']+)'/);
    assert.ok(m, '应找到 analyzeAssetContent 描述');
    assert.ok(m[1].includes('shotType'));
    assert.ok(m[1].includes('sellingPointEvidence'));
    assert.ok(m[1].includes('updateDesignProjectState'));
});

console.log('── 桥三：表现形式用法引导（源码 pin）──');

const stagePlan = read('src/shared/creative-stage-plan.ts');
check('stage-plan 证据锚定纳入有来源项目事实、市场洞察与素材卖点证据', () => {
    assert.ok(stagePlan.includes('带来源和确认等级的项目事实'));
    assert.ok(stagePlan.includes('明确市场洞察'));
    assert.ok(stagePlan.includes('sellingPointEvidence'));
    assert.ok(stagePlan.includes('旧 productFacts/sellingPoints 字符串') && stagePlan.includes('待确认候选'));
});
check('stage-plan 有痛点表现形式→Eagle 参考的联动引导', () => {
    assert.ok(stagePlan.includes('视觉表现建议') && stagePlan.includes('searchEagleReferences'));
    assert.ok(stagePlan.includes('学表现手法不照抄成品') || stagePlan.includes('学表现手法'));
});
check('searchDesignKnowledge intents 枚举含 market_insight', () => {
    assert.ok(/enum: \['trend', 'reference', 'rule', 'recipe', 'brand', 'platform_spec', 'copywriting', 'market_insight'\]/.test(schemas));
});
check('searchDesignKnowledge 描述带 Knowledge freshness 与版本化事实候选边界', () => {
    const m = schemas.match(/name: 'searchDesignKnowledge',\s*\n\s*description: '([^']+)'/);
    assert.ok(m, '应找到 searchDesignKnowledge 描述');
    assert.ok(m[1].includes('version/freshness bindings'));
    assert.ok(m[1].includes('knowledge snapshot never grants Tool permission'));
    assert.ok(m[1].includes('updateDesignProjectState.upsertFacts'));
    assert.ok(m[1].includes('market_research'));
});
check('searchEagleReferences 描述含按痛点表现形式检索用法', () => {
    // 描述含转义单引号（user\'s），用「非引号或反斜杠转义」匹配完整字符串字面量
    const m = schemas.match(/name: 'searchEagleReferences',\s*\n\s*description: '((?:[^'\\]|\\.)*)'/);
    assert.ok(m, '应找到 searchEagleReferences 描述');
    assert.ok(m[1].includes('表现形式') || m[1].includes('表现手法'));
    assert.ok(m[1].includes('market_insight'));
});

console.log('── 一致性：v5 数据层对口 ──');

check('v5 Project State 有 market_insights scope（供给侧↔数据层对口）', () => {
    const ownerScopes = read('src/shared/agent-runtime-v5/owner-scopes.ts');
    assert.ok(ownerScopes.includes("'market_insights'"));
});

const summary = { total: passed + failures.length, passed, failed: failures.length, failures };
const outDir = path.join(agentRoot, 'tmp');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'smoke-design-harness-bridges.json'), JSON.stringify(summary, null, 2), 'utf8');
console.log(`\n${passed}/${summary.total} 通过`);
if (failures.length > 0) {
    process.exit(1);
}
