'use strict';

/**
 * smoke: 破坏性动作 HITL 确定性重放（V1-7b, pending-destructive-action-card）。
 * 锁定两条红线：
 *   (A) 真同意门：模型自带 confirm 参数在自主门里被剥离——命中破坏性分支必出卡；未确认绝不产出 execute。
 *   (B) 消灭错目标：CONFIRM_EXECUTE 重放的 params === 暂存的原始 params（+确认参数），非模型重建。
 * 另锁：agent.ts 收集门放开 safetyBlock 的 success:false 卡 → 循环停在 awaiting_user_confirmation。
 */

const assert = require('assert');
const path = require('path');

require('ts-node').register({
    transpileOnly: true,
    project: path.resolve(__dirname, '..', 'tsconfig.json'),
    compilerOptions: { module: 'CommonJS', moduleResolution: 'node' }
});

const M = require(path.resolve(__dirname, '..', 'src', 'shared', 'pending-destructive-action-card.ts'));
const {
    evaluateHumanConfirmationGate,
    buildPendingDestructiveActionCard,
    buildPendingDestructiveActionBlockResult,
    resolvePendingDestructiveActionSubmission,
    isPendingDestructiveActionCard,
    PENDING_DESTRUCTIVE_ACTION_SUBMIT_ACTION
} = M;
const { isPolicyGateResult } = require(path.resolve(__dirname, '..', 'src', 'shared', 'tool-safety-policy.ts'));
const { collectPendingInteractiveConfirmationCards } = require(path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'agent-runtime', 'agent.ts'));

let passed = 0;
function check(name, fn) {
    return Promise.resolve(fn()).then(() => {
        passed += 1;
        console.log(`  ✓ ${name}`);
    });
}

function buildCloseWithoutSaveCard(documentName = '海报.psd') {
    const gate = evaluateHumanConfirmationGate('closeDocument', {
        save: false,
        documentName,
        confirmDestructive: true
    });
    assert.ok(gate, 'closeDocument save:false 应命中人类确认门');
    const card = buildPendingDestructiveActionCard({
        verdict: gate.verdict,
        toolName: 'closeDocument',
        params: gate.strippedParams
    });
    return { gate, card };
}

function buildLegacyDeleteLayerCard() {
    return {
        version: 'interactive-card/v0',
        id: 'legacy-delete-layer-card',
        kind: 'destructive-action.confirmation',
        title: '需要你确认这个不可逆操作',
        description: '旧版本删除图层确认',
        status: 'draft',
        payload: {
            version: 'destructive-action-confirmation/v0',
            call: {
                toolName: 'deleteLayer',
                params: { layerId: 7, layerName: '旧文字' },
                requiredConfirmParam: 'confirmDestructive'
            },
            safetyClass: 'destructive',
            riskReason: 'legacy',
            targetSummary: '旧版本删除图层确认'
        },
        actions: [
            { actionId: 'CONFIRM_EXECUTE', label: '确认执行', state: 'enabled', intent: 'confirm' },
            { actionId: 'CANCEL', label: '取消', state: 'enabled', intent: 'cancel' }
        ],
        submitAction: PENDING_DESTRUCTIVE_ACTION_SUBMIT_ACTION
    };
}

async function main() {
    console.log('smoke: pending-destructive-action-card');

    await check('deleteLayer 属于 Photoshop 历史可撤销写入 → 不生成破坏性确认卡', () => {
        assert.strictEqual(evaluateHumanConfirmationGate('deleteLayer', { layerId: 7 }), null);
        assert.strictEqual(
            evaluateHumanConfirmationGate('deleteLayer', { layerId: 7, confirmDestructive: true }),
            null
        );
    });

    await check('closeDocument save:false → 需真人确认，模型自带确认参数仍会被剥离', () => {
        const gate = evaluateHumanConfirmationGate('closeDocument', {
            save: false,
            documentName: '海报.psd',
            confirmDestructive: true
        });
        assert.ok(gate, '不保存关闭文档应命中人类确认门');
        assert.strictEqual(gate.verdict.class, 'destructive');
        assert.strictEqual(gate.verdict.requiredConfirmParam, 'confirmDestructive');
        assert.ok(!('confirmDestructive' in gate.strippedParams), 'strippedParams 不应含确认参数');
        assert.deepStrictEqual(gate.strippedParams, { save: false, documentName: '海报.psd' });
    });

    await check('closeDocument save:true → 门放行（null，非破坏分支）', () => {
        assert.strictEqual(evaluateHumanConfirmationGate('closeDocument', { save: true }), null);
    });

    await check('非策略工具 placeImage → 门放行（null）', () => {
        assert.strictEqual(evaluateHumanConfirmationGate('placeImage', {}), null);
    });

    await check('interactWithBrowserPage click → 命中，确认参数为 confirmSensitiveAction', () => {
        const gate = evaluateHumanConfirmationGate('interactWithBrowserPage', { tabId: 1, action: 'click', elementRef: 3 });
        assert.ok(gate);
        assert.strictEqual(gate.verdict.requiredConfirmParam, 'confirmSensitiveAction');
    });

    await check('建卡：暂存确切调用 + 两枚显式动作 + 无 boolean 字段', () => {
        const { card } = buildCloseWithoutSaveCard();
        assert.ok(isPendingDestructiveActionCard(card));
        assert.strictEqual(card.kind, 'destructive-action.confirmation');
        assert.strictEqual(card.submitAction, PENDING_DESTRUCTIVE_ACTION_SUBMIT_ACTION);
        assert.strictEqual(card.payload.call.toolName, 'closeDocument');
        assert.strictEqual(card.payload.call.requiredConfirmParam, 'confirmDestructive');
        assert.deepStrictEqual(
            card.payload.call.params,
            { save: false, documentName: '海报.psd' },
            '应原样暂存调用参数'
        );
        const ids = card.actions.map((a) => a.actionId).sort();
        assert.deepStrictEqual(ids, ['CANCEL', 'CONFIRM_EXECUTE'], '应为两枚显式提交动作');
    });

    await check('红线B：确认执行重放暂存原始调用（+确认参数），非模型重建', () => {
        const { card } = buildCloseWithoutSaveCard();
        const sub = resolvePendingDestructiveActionSubmission(card, 'CONFIRM_EXECUTE');
        assert.strictEqual(sub.type, 'execute');
        assert.strictEqual(sub.toolName, 'closeDocument');
        assert.deepStrictEqual(sub.params, {
            save: false,
            documentName: '海报.psd',
            confirmDestructive: true
        },
            '重放 params 必须等于暂存原始参数叠加确认参数');
    });

    await check('历史 deleteLayer 确认卡保持可解析与确定性重放，但新调用不再产卡', () => {
        const card = buildLegacyDeleteLayerCard();
        assert.ok(isPendingDestructiveActionCard(card));
        const sub = resolvePendingDestructiveActionSubmission(card, 'CONFIRM_EXECUTE');
        assert.strictEqual(sub.type, 'execute');
        assert.strictEqual(sub.toolName, 'deleteLayer');
        assert.deepStrictEqual(sub.params, {
            layerId: 7,
            layerName: '旧文字',
            confirmDestructive: true
        });
    });

    await check('浏览器点击确认执行 → 注入 confirmSensitiveAction:true', () => {
        const gate = evaluateHumanConfirmationGate('interactWithBrowserPage', { tabId: 1, action: 'click', elementRef: 3 });
        const card = buildPendingDestructiveActionCard({ verdict: gate.verdict, toolName: 'interactWithBrowserPage', params: gate.strippedParams });
        const sub = resolvePendingDestructiveActionSubmission(card, 'CONFIRM_EXECUTE');
        assert.strictEqual(sub.type, 'execute');
        assert.deepStrictEqual(sub.params, { tabId: 1, action: 'click', elementRef: 3, confirmSensitiveAction: true });
    });

    await check('取消 → cancelled（不产出任何 execute）', () => {
        const { card } = buildCloseWithoutSaveCard();
        const sub = resolvePendingDestructiveActionSubmission(card, 'CANCEL');
        assert.strictEqual(sub.type, 'cancelled');
    });

    await check('未知动作 / 无效卡 → rejected', () => {
        const { card } = buildCloseWithoutSaveCard();
        assert.strictEqual(resolvePendingDestructiveActionSubmission(card, 'NOPE').type, 'rejected');
        assert.strictEqual(resolvePendingDestructiveActionSubmission({}, 'CONFIRM_EXECUTE').type, 'rejected');
        assert.strictEqual(resolvePendingDestructiveActionSubmission(null, 'CONFIRM_EXECUTE').type, 'rejected');
    });

    await check('block 结果是 policyGate 控制信号 + 携卡 + 不指示自补确认重试', () => {
        const { gate, card } = buildCloseWithoutSaveCard();
        const res = buildPendingDestructiveActionBlockResult({ verdict: gate.verdict, card });
        assert.strictEqual(res.success, false);
        assert.strictEqual(isPolicyGateResult(res), true, '安全拦截应被判为控制信号（不计入熔断）');
        assert.strictEqual(res.safetyBlock, true);
        assert.strictEqual(res.awaitingUserConfirmation, true);
        assert.ok(Array.isArray(res.interactiveCards) && res.interactiveCards.length === 1);
        assert.ok(!res.message.includes('重试'), '面向模型的说明不应指示自补 confirm 重试');
    });

    // 循环侧兑现（直接验收集门，而非整跑 agent——整跑需真实模型响应形状，属真机验证范畴）：
    // agent.ts 的 collectPendingInteractiveConfirmationCards 是暂停触发点（返回非空→停在
    // awaiting_user_confirmation）。执行器把工具返回值包成 toolResult.output（agent.ts:1409 `output: result`）。
    await check('收集门放行 safetyBlock 携卡的 success:false 结果 → 暂停会触发（红线A循环侧）', () => {
        const { gate, card } = buildCloseWithoutSaveCard();
        const block = buildPendingDestructiveActionBlockResult({ verdict: gate.verdict, card });
        const collected = collectPendingInteractiveConfirmationCards([{ callId: 'c1', success: false, output: block }]);
        assert.strictEqual(collected.length, 1, 'safetyBlock 携卡的 success:false 结果必须被收集，否则循环不停机、退回旧路');
        assert.strictEqual(collected[0].kind, 'destructive-action.confirmation');
    });

    await check('收集门仍跳过普通失败（无卡的 success:false）→ 不误停机', () => {
        const collected = collectPendingInteractiveConfirmationCards([{ callId: 'c1', success: false, output: { success: false, error: 'boom' } }]);
        assert.strictEqual(collected.length, 0, '普通工具失败不应被当作待确认卡收集');
    });

    await check('收集门零回归：普通 success:true 携卡仍被收集', () => {
        const okCard = { version: 'interactive-card/v0', id: 'ok1', kind: 'editable_confirmation', title: 't', status: 'draft', payload: {} };
        const collected = collectPendingInteractiveConfirmationCards([{ callId: 'c1', success: true, output: { success: true, interactiveCards: [okCard] } }]);
        assert.strictEqual(collected.length, 1, 'success:true 携卡应照常收集（零回归）');
    });

    console.log(`\n✅ pending-destructive-action-card smoke 全部通过（${passed} 项）`);
}

main().catch((error) => {
    console.error(error && error.message ? error.message : String(error));
    process.exit(1);
});
