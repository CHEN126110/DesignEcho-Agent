'use strict';

/**
 * smoke: 公开计划确认门的适用面（2026-07-07）
 *
 * 治理目标：public-plan 门只处理明确选择公开计划的请求，
 * 不能由主图、详情页、SKU 等品类信号或豁免词表决定 Agent 是否有规划自由。
 *
 * 本 smoke 钉住确认门的适用面两侧：
 * - 明确授权的执行/修改请求直进循环，不出确认卡
 * - 真含糊请求进入同一 Agent 循环做模型规划，但不因此生成确认卡或获得写权限
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
const { buildAgentTaskPlanningContract } = require(path.resolve(agentRoot, 'src/shared/agent-task-planning-contract.ts'));

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

function contractStatus(text, options = {}) {
    const d = buildAgentIntentControlPlaneDecision({ userInput: text });
    const contract = buildAgentTaskPlanningContract({
        userInput: text,
        route: 'autonomous_agent',
        skillId: 'autonomous-agent',
        intentControlPlane: d,
        forcePublicPlanGeneration: options.forcePublicPlanGeneration === true
    });
    return {
        decision: d,
        contract,
        status: contract.status,
        requiresUserApproval: contract.executionPlan.requiresUserApproval
    };
}

console.log('── 明确请求直进循环（不出确认卡） ──');

const DIRECT_CASES = [
    // 真机病例原句：文案内容含「一双」被 SKU 域词咬中，仍须直进循环
    '详情页 的这个文案 不是很好 从在窗边坐一会，到出门走走，都想先穿这一双 轻一点的软感。\n帮我改一下',
    '帮我改一下详情页的文案',
    '帮我修改第三屏文案\n图层组是 3-产品信息/icon 下有文案内容 是带有氛围场景的文案 我需要你提供三版不同的文案',
    '帮我改第三屏文案，图层组是 3-产品信息/icon',
    '帮我做SKU图',
    '把当前画面整理得更高级一点'
];
for (const text of DIRECT_CASES) {
    const label = text.slice(0, 22).replace(/\n/g, ' ');
    check(`「${label}…」→ ready_for_tool_execution`, () => {
        const r = contractStatus(text);
        assert.strictEqual(r.status, 'ready_for_tool_execution', `实际 ${r.status}（signals=${(r.decision.matchedSignals || []).join(',')}）`);
        assert.strictEqual(r.requiresUserApproval, false);
    });
}

check('明确执行请求依据 confirmed 授权直进循环，不依赖品类豁免集', () => {
    const d = buildAgentIntentControlPlaneDecision({
        userInput: '详情页 的这个文案 不是很好 从在窗边坐一会，到出门走走，都想先穿这一双 轻一点的软感。\n帮我改一下'
    });
    assert.strictEqual(d.executionAuthorization, 'confirmed_tool_required');
});

console.log('── 真含糊请求同轮规划，但不自动进入确认门 ──');

const GATED_CASES = [
    '帮我处理一下'
];
for (const text of GATED_CASES) {
    check(`「${text}」→ ready_for_model_planning（不自动确认）`, () => {
        const r = contractStatus(text);
        assert.strictEqual(r.status, 'ready_for_model_planning', `实际 ${r.status}`);
        assert.strictEqual(r.requiresUserApproval, false);
    });
}

check('弱授权候选仍需模型规划（授权强度不静默升级）', () => {
    const r = contractStatus('详情页排版');
    assert.strictEqual(r.status, 'ready_for_model_planning', `实际 ${r.status}`);
    assert.strictEqual(r.requiresUserApproval, false);
    assert.strictEqual(r.contract.executionPlan.canExecuteTools, false);
});

check('只有显式公开方案模式才产生用户批准语义', () => {
    const r = contractStatus('帮我处理一下', { forcePublicPlanGeneration: true });
    assert.strictEqual(r.status, 'ready_for_model_planning');
    assert.strictEqual(r.requiresUserApproval, true);
});

check('含糊动作保持 candidate_only，不会静默升级写入授权', () => {
    const d = buildAgentIntentControlPlaneDecision({ userInput: '帮我处理一下' });
    assert.strictEqual(d.executionAuthorization, 'candidate_only');
});

check('纯文案候选请求不会在没有 Photoshop 修改语境时被强制升级为画布写入', () => {
    const d = buildAgentIntentControlPlaneDecision({ userInput: '请提供三版氛围场景文案' });
    assert.notStrictEqual(d.executionAuthorization, 'confirmed_tool_required');
    assert.notStrictEqual(d.toolScope, 'write_photoshop');
});

check('重新撰写详情页文案只交付内容，不把详情页名词当成画面写入授权', () => {
    const r = contractStatus('帮我重新撰写详情页文案');
    assert.strictEqual(r.decision.requestKind, 'chat_only');
    assert.strictEqual(r.decision.toolScope, 'none');
    assert.strictEqual(r.status, 'ready_direct_response');
    assert.deepStrictEqual(r.contract.designBrief.deliverables, ['copy_candidates']);
});

check('文案修改咨询保持对话路径，不把“怎么改”误判为执行授权', () => {
    const d = buildAgentIntentControlPlaneDecision({ userInput: '文案应该怎么修改？' });
    assert.strictEqual(d.requestKind, 'chat_only');
    assert.strictEqual(d.executionAuthorization, 'none');
});

const summary = { total: passed + failures.length, passed, failed: failures.length, failures };
const outDir = path.join(agentRoot, 'tmp');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'smoke-public-plan-gate-scope.json'), JSON.stringify(summary, null, 2), 'utf8');
console.log(`\n${passed}/${summary.total} 通过`);
if (failures.length > 0) process.exit(1);
