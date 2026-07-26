'use strict';

/**
 * smoke: 详情页套版能力整合（2026-07-07）
 *
 * 用户预期：用户提供模板 → Agent 不改版式，只替换文案/置入图片；内容部分由
 * Agent 发挥（按证据链撰写文案、按构图择图），不是机械填充。
 * 整合形态：套版不是独立技能/固定流水线，而是详情页能力在自主循环内的一条路
 * （拆牢笼后 parse→match→fill→verify→export 六件套即循环工具）。
 * 守护三点：路由归一自主循环；版式主权+内容发挥写进工作流工具与技能声明；
 * 填充实现天生只换内容（文字样式保留写入）。
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');

const agentRoot = path.resolve(__dirname, '..');
const uxpRoot = path.resolve(agentRoot, '..', 'DesignEcho-UXP');
require('ts-node').register({
    transpileOnly: true,
    project: path.resolve(agentRoot, 'tsconfig.main.json')
});
const { buildAgentIntentControlPlaneDecision } = require(path.resolve(agentRoot, 'src/shared/agent-intent-control-plane.ts'));
const { resolveDesignDisciplineContext } = require(path.resolve(agentRoot, 'src/shared/design-discipline-runtime.ts'));

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

console.log('── 路由：套版句归一自主循环 ──');

const TEMPLATE_FILL_CASES = [
    '帮我用这个模板做详情页',
    '用 2双装详情页模板.psd 套版做详情页',
    '按我的模板填充详情页内容'
];
for (const text of TEMPLATE_FILL_CASES) {
    check(`「${text}」→ autonomous，不进固定流水线`, () => {
        const d = buildAgentIntentControlPlaneDecision({ userInput: text });
        assert.strictEqual(d.requestKind, 'autonomous_execution', `实际 ${d.requestKind}`);
    });
}

check('套版句不激活从零设计纪律（套版≠从零，excludeSignals 生效）', () => {
    for (const text of TEMPLATE_FILL_CASES) {
        const d = buildAgentIntentControlPlaneDecision({ userInput: text });
        const creative = (d.matchedSignals || []).includes('explicit_creative_design');
        const ctx = resolveDesignDisciplineContext({ taskText: text, isCreativeDesignIntent: creative });
        assert.strictEqual(ctx.active, false, `「${text}」不应进从零设计纪律`);
    }
});

console.log('── 工具链：六件套在循环工具箱 ──');

const schemas = fs.readFileSync(path.join(agentRoot, 'src/renderer/services/agent-runtime/tool-schemas.ts'), 'utf8');
check('模板工作流六件套全部在暴露列表', () => {
    // 暴露列表段（详情页工作流工具注释块）中逐一出现
    const section = schemas.slice(schemas.indexOf('详情页工作流工具'));
    for (const tool of ['analyzeProjectForDetailPage', 'parseDetailPageTemplate', 'matchDetailPageContent', 'fillDetailPage', 'exportDetailPageSlices']) {
        assert.ok(section.includes(`'${tool}'`), `${tool} 应在暴露列表`);
    }
});

console.log('── 版式主权 + 内容发挥（工作流工具描述） ──');

function toolDescription(name) {
    const m = schemas.match(new RegExp(`name: '${name}',\\s*\\n\\s*description: '((?:[^'\\\\]|\\\\.)*)'`));
    assert.ok(m, `应找到 ${name} 描述`);
    return m[1];
}

check('parseDetailPageTemplate：版式主权红线 + 内容发挥引导', () => {
    const d = toolDescription('parseDetailPageTemplate');
    assert.ok(d.includes('版式主权'), '应有版式主权纪律');
    assert.ok(d.includes('不擅自调整') || d.includes('报告用户'), '版式问题应报告而非擅自改');
    assert.ok(d.includes('内容发挥'), '应有内容发挥纪律');
    assert.ok(d.includes('sellingPointEvidence') && d.includes('market_insight'), '内容发挥应接证据链（素材卖点证据+市场洞察）');
    assert.ok(d.includes('版式示意字符'), '应说明占位符原文不是成品');
});

check('matchDetailPageContent：plans 是机械候选，须过设计判断', () => {
    const d = toolDescription('matchDetailPageContent');
    assert.ok(d.includes('机械候选'));
    assert.ok(d.includes('sellingPointEvidence') || d.includes('market_insight'), '文案须按证据链撰写');
    assert.ok(d.includes('mainImageSuitability') || d.includes('构图字段'), '选图须按构图复核');
    assert.ok(d.includes('万金油'), '禁无证据万金油文案');
});

check('fillDetailPage：只换内容不动版式', () => {
    const d = toolDescription('fillDetailPage');
    assert.ok(d.includes('不改占位框位置/尺寸/版式') || d.includes('版式主权'));
    assert.ok(d.includes('verify with getScreenSnapshots'), '填后必看保留');
});

console.log('── 技能声明整合 ──');

check('DetailPageDesignSkill：套版路径带两条纪律', () => {
    const s = fs.readFileSync(path.join(agentRoot, 'src/shared/skills/skill-declarations.ts'), 'utf8');
    assert.ok(s.includes('模板套版路径。套版两条纪律：版式主权'));
    assert.ok(s.includes('内容发挥（文案按证据链撰写'));
});

check('DetailPageDesignSkill：套版仍是自主循环内路径（非固定流水线）', () => {
    const s = fs.readFileSync(path.join(agentRoot, 'src/shared/skills/skill-declarations.ts'), 'utf8');
    const block = s.slice(s.indexOf('DetailPageDesignSkill: SkillDeclaration'), s.indexOf('DetailPageDesignSkill: SkillDeclaration') + 2400);
    assert.ok(block.includes("controlledRouteEntry: 'autonomous-react-loop'"));
    assert.ok(block.includes("modelDirectExecution: 'forbidden'"));
});

console.log('── 填充实现语义（UXP 侧 pin） ──');

check('detail-page-filler：文字用 setTextContent 保留样式（版式主权的实现基础）', () => {
    const s = fs.readFileSync(path.join(uxpRoot, 'src/tools/layout/detail-page-filler.ts'), 'utf8');
    assert.ok(s.includes('setTextContent') && s.includes('preserve text style'));
});

const summary = { total: passed + failures.length, passed, failed: failures.length, failures };
const outDir = path.join(agentRoot, 'tmp');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'smoke-detail-page-template-fill-integration.json'), JSON.stringify(summary, null, 2), 'utf8');
console.log(`\n${passed}/${summary.total} 通过`);
if (failures.length > 0) process.exit(1);
