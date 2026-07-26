'use strict';

/**
 * smoke: 工具安全策略（tool-safety-policy）——V0-3 破坏性动作确定性守卫 + V0-1 policyGate 判定。
 * 锁定：破坏性动作缺确认→拦截（全任务生效，与设计上下文无关）；带确认/非破坏分支→放行；
 *       非表内工具→放行；拦截结果被 isPolicyGateResult 识别为控制信号（不计入失败熔断）。
 */

const assert = require('assert');
const path = require('path');

require('ts-node').register({
    transpileOnly: true,
    project: path.resolve(__dirname, '..', 'tsconfig.main.json')
});

const M = require(path.resolve(__dirname, '..', 'src', 'shared', 'tool-safety-policy.ts'));
const { evaluateToolSafety, isPolicyGateResult, TOOL_SAFETY_POLICY } = M;

let passed = 0;
function check(name, fn) {
    fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
}

console.log('smoke: tool-safety-policy');

check('deleteLayer 属于 Photoshop 历史可撤销写入 → 不进入不可逆确认策略', () => {
    assert.strictEqual(evaluateToolSafety('deleteLayer', { layerId: 123 }), null);
    assert.strictEqual(evaluateToolSafety('deleteLayer', { layerId: 123, confirmDestructive: true }), null);
    assert.strictEqual(evaluateToolSafety('deleteLayer', { layerId: 123, confirmDestructive: 'true' }), null);
    assert.ok(!Object.prototype.hasOwnProperty.call(TOOL_SAFETY_POLICY, 'deleteLayer'));
});

check('closeDocument save!==true → 拦截（丢弃未保存修改）', () => {
    assert.ok(evaluateToolSafety('closeDocument', { save: false }), 'save:false 应拦截');
    assert.ok(evaluateToolSafety('closeDocument', {}), 'save 缺省应拦截');
    assert.ok(evaluateToolSafety('closeDocument', { documentName: 'x' }), '未显式保存应拦截');
});

check('closeDocument save:true → 放行（正常保存关闭不拦）', () => {
    assert.strictEqual(evaluateToolSafety('closeDocument', { save: true }), null);
});

check('closeDocument save!==true 但带确认 → 放行', () => {
    assert.strictEqual(evaluateToolSafety('closeDocument', { save: false, confirmDestructive: true }), null);
});

// V1-7a：真实浏览器 click 纳入安全表（现状"不拦"→本票"拦 click"，有意收紧，非等价）
check('interactWithBrowserPage action:click 无确认 → 拦截，消息含工具名与 confirmSensitiveAction', () => {
    const v = evaluateToolSafety('interactWithBrowserPage', { tabId: 1, action: 'click', elementRef: 3 });
    assert.ok(v && v.blocked === true, 'click 无确认应被拦截');
    assert.strictEqual(v.class, 'destructive');
    assert.strictEqual(v.requiredConfirmParam, 'confirmSensitiveAction');
    assert.ok(
        v.message.includes('interactWithBrowserPage') && v.message.includes('confirmSensitiveAction'),
        v.message
    );
});

check('interactWithBrowserPage action:click 带 confirmSensitiveAction:true → 放行', () => {
    assert.strictEqual(
        evaluateToolSafety('interactWithBrowserPage', { tabId: 1, action: 'click', confirmSensitiveAction: true }),
        null
    );
});

check('interactWithBrowserPage confirmSensitiveAction 非 true（"true"/1）→ 仍拦截', () => {
    assert.ok(evaluateToolSafety('interactWithBrowserPage', { action: 'click', confirmSensitiveAction: 'true' }));
    assert.ok(evaluateToolSafety('interactWithBrowserPage', { action: 'click', confirmSensitiveAction: 1 }));
});

check('interactWithBrowserPage action:fill / scroll → 放行（fill 不提交、scroll 只读，只拦 click）', () => {
    assert.strictEqual(evaluateToolSafety('interactWithBrowserPage', { tabId: 1, action: 'fill', value: 'x' }), null);
    assert.strictEqual(evaluateToolSafety('interactWithBrowserPage', { tabId: 1, action: 'scroll', deltaY: 800 }), null);
});

check('action:click 只对 interactWithBrowserPage 生效，其它工具带 click 不受影响', () => {
    assert.strictEqual(evaluateToolSafety('navigateBrowserTab', { action: 'click' }), null);
    assert.strictEqual(evaluateToolSafety('readBrowserPage', { action: 'click' }), null);
});

check('非表内工具（placeImage/saveDocument）→ 放行（V0 保守收口，不误伤常见流程）', () => {
    assert.strictEqual(evaluateToolSafety('placeImage', {}), null);
    assert.strictEqual(evaluateToolSafety('saveDocument', { path: 'a.psd' }), null);
    assert.strictEqual(evaluateToolSafety('renderLayout', {}), null);
});

check('安全表只含高危不可逆动作，且都 reversible:false', () => {
    const keys = Object.keys(TOOL_SAFETY_POLICY);
    assert.ok(!keys.includes('deleteLayer'), 'Photoshop 历史可撤销的 deleteLayer 不应进入不可逆策略表');
    assert.ok(keys.includes('closeDocument') && keys.includes('interactWithBrowserPage'));
    for (const k of keys) {
        assert.strictEqual(TOOL_SAFETY_POLICY[k].reversible, false, `${k} 应为不可逆`);
        assert.ok(TOOL_SAFETY_POLICY[k].confirmParam, `${k} 应声明确认参数`);
    }
});

check('isPolicyGateResult 识别控制信号，普通失败/成功/空值不算', () => {
    assert.strictEqual(isPolicyGateResult({ policyGate: true }), true);
    assert.strictEqual(isPolicyGateResult({ success: false, policyGate: true }), true);
    assert.strictEqual(isPolicyGateResult({ success: false }), false, '普通工具失败不是 policyGate');
    assert.strictEqual(isPolicyGateResult({ success: true }), false);
    assert.strictEqual(isPolicyGateResult(null), false);
    assert.strictEqual(isPolicyGateResult(undefined), false);
    assert.strictEqual(isPolicyGateResult('x'), false);
});

check('安全拦截结果形状可直接作 policyGate 返回（模拟执行器包装）', () => {
    const v = evaluateToolSafety('closeDocument', { save: false });
    const wrapped = { success: false, policyGate: true, safetyBlock: true, error: v.message, message: v.message };
    assert.strictEqual(isPolicyGateResult(wrapped), true, '安全拦截应被判为控制信号→不计入失败熔断');
});

console.log(`\n✅ tool-safety-policy smoke 全部通过（${passed} 项）`);
