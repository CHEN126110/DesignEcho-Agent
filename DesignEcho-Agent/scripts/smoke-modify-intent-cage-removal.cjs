'use strict';

/**
 * smoke: 拆牢笼——修改类需求不再被派进固定流水线（2026-07-07）
 *
 * 真机病例：「帮我重新撰写详情页文案」这类修改需求走了详情页设计路线。
 * 病根不是缺一个"修改分类器"，而是牢笼结构：入口预判把任务塞进固定流水线笼子，
 * 判错没有自救出口。系统性两刀（零新分类器）：
 * 1. 授权动词表补修改动词——「重写/换成/替换」本来就是明确执行指令，不是讨论
 * 2. 自主入口技能（detail-page-design/main-image-design/sku-batch 声明
 *    controlledRouteEntry=autonomous-react-loop）弱授权也归一自主循环——
 *    不再回落 execute_skill 候选给路由机制派固定流水线；授权强度保持不升
 * 最后一道护栏：modelDirectExecution=forbidden 保证 router 在通用分支选中
 * 业务技能时也被挡回自主循环。
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');

const agentRoot = path.resolve(__dirname, '..');
require('ts-node').register({
    transpileOnly: true,
    project: path.resolve(agentRoot, 'tsconfig.main.json')
});
const { buildAgentIntentControlPlaneDecision } = require(path.resolve(agentRoot, 'src/shared/agent-intent-control-plane.ts'));
const { resolveDesignDisciplineContext } = require(path.resolve(agentRoot, 'src/shared/design-discipline-runtime.ts'));
const { isModelDirectExecutionForbiddenSkill, getControlledRouteAutonomousEntrySkillIds } = require(path.resolve(agentRoot, 'src/shared/skills/skill-declarations.ts'));

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

function decide(text) {
    return buildAgentIntentControlPlaneDecision({ userInput: text });
}

console.log('── 修改句归一自主循环（明确授权） ──');

const MODIFY_CONFIRMED_CASES = [
    '帮我重新撰写详情页文案',
    '详情页文案重写一下',
    '帮我改一下详情页的文案',
    '详情页的主图换一张',
    '帮我把详情页第三屏的标题换成 XXX',
    '详情页第二屏的背景替换成浅粉色'
];
for (const text of MODIFY_CONFIRMED_CASES) {
    check(`「${text}」→ autonomous+confirmed，不落固定流水线`, () => {
        const d = decide(text);
        assert.strictEqual(d.requestKind, 'autonomous_execution', `实际 ${d.requestKind}`);
        assert.strictEqual(d.executionAuthorization, 'confirmed_tool_required', `实际 ${d.executionAuthorization}`);
        assert.ok((d.matchedSignals || []).includes('controlled_skill_autonomous_entry'));
    });
}

check('修改句不误入从零设计纪律', () => {
    for (const text of MODIFY_CONFIRMED_CASES) {
        const d = decide(text);
        const creative = (d.matchedSignals || []).includes('explicit_creative_design');
        const ctx = resolveDesignDisciplineContext({ taskText: text, isCreativeDesignIntent: creative });
        assert.strictEqual(ctx.active, false, `「${text}」不应激活从零设计纪律`);
    }
});

console.log('── 弱授权也不回落固定流水线候选 ──');

check('自主入口技能弱授权 → autonomous+candidate（信号带 _candidate 后缀）', () => {
    // 「详情页排版」：命中详情页路由词但无执行动词也无讨论词
    const d = decide('详情页排版');
    assert.strictEqual(d.requestKind, 'autonomous_execution', `实际 ${d.requestKind}（不允许回落 execute_skill）`);
    assert.strictEqual(d.executionAuthorization, 'candidate_only', '弱授权不得静默升级');
    assert.ok((d.matchedSignals || []).includes('controlled_skill_autonomous_entry_candidate'));
});

check('三大业务技能都声明了自主入口（本护栏的适用面）', () => {
    const ids = getControlledRouteAutonomousEntrySkillIds();
    for (const id of ['detail-page-design', 'main-image-design', 'sku-batch']) {
        assert.ok(ids.includes(id), `${id} 应声明 controlledRouteEntry=autonomous-react-loop`);
    }
});

console.log('── 原有语义不受损 ──');

check('从零设计「帮我做一个详情页」仍激活纪律', () => {
    const d = decide('帮我做一个详情页');
    const creative = (d.matchedSignals || []).includes('explicit_creative_design');
    const ctx = resolveDesignDisciplineContext({ taskText: '帮我做一个详情页', isCreativeDesignIntent: creative });
    assert.strictEqual(d.requestKind, 'autonomous_execution');
    assert.strictEqual(ctx.active, true, '从零设计纪律不能因拆牢笼而丢失');
});

check('讨论句「详情页怎么做比较好」不进执行', () => {
    const d = decide('详情页怎么做比较好');
    assert.notStrictEqual(d.requestKind, 'autonomous_execution');
    assert.notStrictEqual(d.requestKind, 'execute_skill');
});

check('SKU 领域词无执行授权仍走澄清（保护链不动）', () => {
    const d = decide('袜子 SKU');
    assert.ok(['clarify', 'chat_only'].includes(d.requestKind), `实际 ${d.requestKind}`);
});

check('SKU 明确执行仍走 SKU 信号链', () => {
    const d = decide('帮我做SKU图');
    assert.strictEqual(d.requestKind, 'autonomous_execution');
    assert.ok((d.matchedSignals || []).some((s) => String(s).includes('sku')));
});

check('对话限定句不被修改动词误判（只说说不要动）', () => {
    const d = decide('先别动手，只说说详情页文案怎么改');
    assert.notStrictEqual(d.requestKind, 'autonomous_execution', `实际 ${d.requestKind}`);
});

console.log('── 最后一道护栏：forbidden 挡回 ──');

check('三大业务技能 + find-and-edit-element 均为 modelDirectExecution=forbidden', () => {
    for (const id of ['detail-page-design', 'main-image-design', 'sku-batch', 'find-and-edit-element']) {
        assert.ok(isModelDirectExecutionForbiddenSkill(id), `${id} 应为 forbidden（router 兜底选中时挡回自主循环）`);
    }
});

console.log('── 源码 pin ──');

check('控制面：授权动词表含修改动词', () => {
    const s = fs.readFileSync(path.join(agentRoot, 'src/shared/agent-intent-control-plane.ts'), 'utf8');
    assert.ok(/SKILL_ROUTING_AUTHORIZATION_ACTION_PATTERN = \/.*修改\|重写\|撰写/.test(s));
});
check('控制面：自主入口技能归一（仅显式只聊句除外）', () => {
    const s = fs.readFileSync(path.join(agentRoot, 'src/shared/agent-intent-control-plane.ts'), 'utf8');
    assert.ok(/isControlledRouteAutonomousEntrySkill\(skillRoutingIntent\.skillId\)\s*\n\s*&& !hasExplicitConversationOnlyDirective\(normalized\)/.test(s));
    assert.ok(s.includes('controlled_skill_autonomous_entry_candidate'));
});

const summary = { total: passed + failures.length, passed, failed: failures.length, failures };
const outDir = path.join(agentRoot, 'tmp');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'smoke-modify-intent-cage-removal.json'), JSON.stringify(summary, null, 2), 'utf8');
console.log(`\n${passed}/${summary.total} 通过`);
if (failures.length > 0) process.exit(1);
