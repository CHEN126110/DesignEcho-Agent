'use strict';

/**
 * smoke: 委派子代理安全纵深（治理审计 2026-07-08 既有盲区收口）。
 *
 * DesignTeamCoordinator 给设计队友子代理用的是原始 executeToolCall，绕过主循环
 * createExecuteToolWrapper 的破坏性动作 hook / HITL 卡。本 smoke 两层守护：
 * (1) 不变量 tripwire：所有队友角色 allowedTools ∩ (安全策略拦截工具集 ∪ 复合破坏性工具) = ∅。
 *     直接加 closeDocument/interactWithBrowserPage 会变红；若未来出现内部调用 gated 工具的复合工具，
 *     也必须进入同一清单——因为顶层硬拦看不到工具内部的嵌套裸调用（对抗核验 F1）。
 * (2) 复合工具基线守卫：扫 tool-executor.service.ts，断言当前没有内部对 gated 工具的裸调用；
 *     一旦新增内部破坏性调用点即变红，强制复核 COMPOSITE_TOOLS_INVOKING_GATED 是否要更新。
 * (3) 纵深硬拦：evaluateDelegatedToolSafetyBlock 对委派语境的破坏性动作硬拦，且**忽略模型自带确认
 *     参数**（红线A：队友不能自我授权不可逆动作，委派中无人类确认通道）；非破坏性分支/工具放行。
 * (4) 接线断言：autonomous-agent.executor.ts 确实用该硬拦包装 coordinator 的 executeTool（防回退成裸
 *     executeToolCall）、且补了 markExternalContentTrust（对抗核验 F2）。
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
require('ts-node').register({ transpileOnly: true, project: path.resolve(ROOT, 'tsconfig.main.json') });

const {
  evaluateDelegatedToolSafetyBlock,
  getSafetyGatedToolNames,
  evaluateToolSafety
} = require(path.resolve(ROOT, 'src', 'shared', 'tool-safety-policy.ts'));
const {
  DESIGN_TEAMMATE_ROLES,
  getDesignTeammateDefinition
} = require(path.resolve(ROOT, 'src', 'renderer', 'services', 'design-teams', 'registry.ts'));

function check(name, fn) {
  fn();
  console.log(`  ✓ ${name}`);
}

console.log('smoke: teammate-tool-safety');

const gated = getSafetyGatedToolNames();

// 复合破坏性工具：本身不在 gated 集，但实现内部会裸调 gated 工具（绕过顶层硬拦）。队友也不得拥有。
// 当前没有此类工具；renderLayout 内部的 deleteLayer 属于 Photoshop 历史可撤销写入，不再进入本清单。
// 下方基线守卫会在出现新的 gated 内部调用时变红，强制复核并更新这里。
const COMPOSITE_TOOLS_INVOKING_GATED = [];

// ---------- (1) 不变量 tripwire：队友 allowedTools ∩ (被拦工具 ∪ 复合破坏性工具) = ∅ ----------
check('安全策略拦截集只保留真正跨越恢复边界或产生外部副作用的动作', () => {
  assert.ok(gated.length >= 2, `gated tools count=${gated.length}`);
  assert.ok(!gated.includes('deleteLayer'), 'Photoshop 历史可撤销的 deleteLayer 不应被安全硬拦');
  for (const t of ['closeDocument', 'interactWithBrowserPage']) {
    assert.ok(gated.includes(t), `${t} 应在安全策略拦截集内`);
  }
});

check('每个队友角色 allowedTools 都不含被拦工具或复合破坏性工具（地雷 tripwire）', () => {
  const forbidden = new Set([...gated, ...COMPOSITE_TOOLS_INVOKING_GATED]);
  for (const role of DESIGN_TEAMMATE_ROLES) {
    const def = getDesignTeammateDefinition(role);
    const overlap = (def.allowedTools || []).filter((t) => forbidden.has(t));
    assert.strictEqual(
      overlap.length, 0,
      `角色 ${role} 的 allowedTools 含被安全策略拦截或复合破坏性工具 [${overlap.join(', ')}]——委派路径绕过安全 hook`
      + `（复合工具还会经内部嵌套裸调用绕过顶层硬拦）。若确需委派执行破坏性动作，必须先把安全 hook 下沉到`
      + `委派执行层并接线队友 HITL，不能直接放进 allowedTools。`
    );
  }
});

// ---------- (2) 复合工具基线守卫：内部裸调 gated 工具的调用点只有已知那种 ----------
check('tool-executor 内部对 gated 工具的裸调用未超出已知基线（新增即强制复核复合工具清单）', () => {
  const src = fs.readFileSync(
    path.resolve(ROOT, 'src', 'renderer', 'services', 'tool-executor.service.ts'), 'utf8');
  // 内部裸调用形如 executeToolCall('deleteLayer', ...)。收集被内部调用的 gated 工具名集合。
  const internalGatedCalls = new Set();
  for (const g of gated) {
    const re = new RegExp(`executeToolCall\\(\\s*['"]${g}['"]`, 'g');
    if (re.test(src)) internalGatedCalls.add(g);
  }
  // 当前基线：没有 gated 工具被复合工具内部裸调用。若出现 closeDocument/
  // interactWithBrowserPage 等内部破坏性调用点，说明可能有新的复合破坏性工具，必须复核
  // COMPOSITE_TOOLS_INVOKING_GATED 是否需纳入该工具。
  const baseline = [];
  const unexpected = [...internalGatedCalls].filter((t) => !baseline.includes(t));
  assert.strictEqual(
    unexpected.length, 0,
    `tool-executor 出现新的内部破坏性调用点 [${unexpected.join(', ')}]——请确认其所属复合工具已纳入 `
    + `COMPOSITE_TOOLS_INVOKING_GATED，并确保没有队友角色的 allowedTools 拥有它。`
  );
});

// ---------- (2) 纵深硬拦：委派语境真正不可逆动作，忽略确认参数 ----------
check('deleteLayer 是普通受控 Photoshop 写入，不由主循环或委派安全确认门额外拦截', () => {
  assert.strictEqual(evaluateDelegatedToolSafetyBlock('deleteLayer', {}), null);
  assert.strictEqual(
    evaluateDelegatedToolSafetyBlock('deleteLayer', { confirmDestructive: true }),
    null
  );
  assert.strictEqual(evaluateToolSafety('deleteLayer', {}), null);
});

check('closeDocument：不保存关闭硬拦（含自带确认）；save:true 正常保存关闭放行', () => {
  assert.ok(evaluateDelegatedToolSafetyBlock('closeDocument', {}), '缺省不保存应硬拦');
  assert.ok(evaluateDelegatedToolSafetyBlock('closeDocument', { save: false }), 'save:false 应硬拦');
  assert.ok(evaluateDelegatedToolSafetyBlock('closeDocument', { save: false, confirmDestructive: true }),
    'save:false 自带确认仍硬拦');
  assert.strictEqual(evaluateDelegatedToolSafetyBlock('closeDocument', { save: true }), null,
    'save:true 是正常保存关闭，非破坏性分支，放行');
});

check('interactWithBrowserPage：click 硬拦（含自带确认）；fill/scroll 放行', () => {
  assert.ok(evaluateDelegatedToolSafetyBlock('interactWithBrowserPage', { action: 'click' }), 'click 应硬拦');
  assert.ok(evaluateDelegatedToolSafetyBlock('interactWithBrowserPage', { action: 'click', confirmSensitiveAction: true }),
    'click 自带确认仍硬拦');
  assert.strictEqual(evaluateDelegatedToolSafetyBlock('interactWithBrowserPage', { action: 'fill' }), null, 'fill 放行');
  assert.strictEqual(evaluateDelegatedToolSafetyBlock('interactWithBrowserPage', { action: 'scroll' }), null, 'scroll 放行');
});

check('非破坏性工具委派中一律放行（零行为改变）', () => {
  for (const t of ['placeImage', 'setTextContent', 'moveLayer', 'deleteLayer', 'getLayerHierarchy', 'renderLayout', 'getCanvasSnapshot']) {
    assert.strictEqual(evaluateDelegatedToolSafetyBlock(t, { layerId: 1 }), null, `${t} 应放行`);
  }
});

// ---------- (3) 接线断言：coordinator executeTool 被硬拦包装 ----------
check('autonomous-agent.executor.ts 用委派硬拦包装 coordinator 的 executeTool（防回退成裸 executeToolCall）', () => {
  const src = fs.readFileSync(
    path.resolve(ROOT, 'src', 'renderer', 'services', 'skill-executors', 'autonomous-agent.executor.ts'), 'utf8');
  assert.ok(src.includes("import { evaluateDelegatedToolSafetyBlock } from '../../../shared/tool-safety-policy';"),
    '应导入 evaluateDelegatedToolSafetyBlock');
  assert.ok(/const executeToolForTeammate\s*=\s*(async\s*)?\(/.test(src), '应定义 executeToolForTeammate 包装器');
  assert.ok(/executeToolForTeammate[\s\S]{0,400}evaluateDelegatedToolSafetyBlock/.test(src),
    'executeToolForTeammate 内应调用 evaluateDelegatedToolSafetyBlock');
  // F2：委派 wrapper 应与主 wrapper 对齐，给结果打外部内容信任标记。
  assert.ok(/executeToolForTeammate[\s\S]{0,600}markExternalContentTrust\(/.test(src),
    'executeToolForTeammate 应对结果调用 markExternalContentTrust（与主 wrapper 对齐，防间接提示注入）');
  // coordinator 的 executeTool 必须是包装器，不能是裸 executeToolCall。
  assert.ok(/executeTool:\s*executeToolForTeammate/.test(src),
    'DesignTeamCoordinator 的 executeTool 应为 executeToolForTeammate（不是裸 executeToolCall）');
  assert.ok(!/new DesignTeamCoordinator\(\{[\s\S]{0,120}executeTool:\s*executeToolCall\b/.test(src),
    'coordinator 不应再直接用裸 executeToolCall');
});

console.log('\nteammate-tool-safety smoke passed');
