'use strict';

/**
 * smoke: 主图路由现状基线（「去刻意路线、把主图交给 Agent」治理的红线钉桩）
 *
 * 背景：调研确认「做一张主图」类开放创意请求已被治理为 autonomous_execution → 通用 ReAct 自主循环
 * （main-image-design 仅作模型可选工具），符合「技能不渗透进 Agent / 理解优于硬编码」。
 * 白底图（把 SKU 当素材导出白底图）已按用户要求「交给 Agent」治理为 autonomous_execution
 * → 通用 ReAct 自主循环（main-image-design 降为可选技能提示，不再走固定生产流水线）。
 * 其余规格化措辞（点击图 / 转化图）暂仍判 execute_skill，作为后续迁移的对照基线。
 *
 * 本 smoke 的作用（红线钉桩，防回潮）：
 *  ① 不变量：开放创意主图必须判 autonomous_execution（防回潮被重新硬路由到 executor）。
 *  ② 不变量：白底图必须判 autonomous_execution（已交给 Agent，防回潮重新硬路由到固定流水线）。
 */

const assert = require('assert');
const path = require('path');

require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '..', 'tsconfig.json'),
  compilerOptions: {
    module: 'CommonJS',
    moduleResolution: 'node'
  }
});

const {
  buildAgentIntentControlPlaneDecision
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'agent-intent-control-plane.ts'));

function requestKindOf(userInput) {
  return buildAgentIntentControlPlaneDecision({
    userInput,
    hasDocument: true,
    photoshopConnected: true
  }).requestKind;
}

function main() {
  console.log('smoke: main-image-routing-baseline');

  // ① 不变量：开放创意主图已交给 Agent 自主循环
  const autonomousPhrasings = [
    '做一张主图',
    '设计一张主图',
    '帮我设计一张主图',
    '从零设计一张主图'
  ];
  for (const text of autonomousPhrasings) {
    const kind = requestKindOf(text);
    assert.strictEqual(
      kind,
      'autonomous_execution',
      `开放创意主图必须进自主循环（交给 Agent），但「${text}」得到 ${kind}`
    );
  }
  console.log(`  ✓ 开放创意主图 ${autonomousPhrasings.length} 例均判 autonomous_execution（已交给 Agent，钉为不变量）`);

  // ② 不变量：白底图已交给 Agent 自主循环（去刻意路线，防回潮重新硬路由到固定流水线）。
  const whiteBgPhrasings = [
    '把SKU白底图素材导出主图',
    '帮我使用SKU素材做白底图导出到主图目录下'
  ];
  for (const text of whiteBgPhrasings) {
    const kind = requestKindOf(text);
    assert.strictEqual(
      kind,
      'autonomous_execution',
      `白底图已交给 Agent，必须判 autonomous_execution（防回潮重新硬路由到固定流水线），但「${text}」得到 ${kind}`
    );
  }
  console.log(`  ✓ 白底图 ${whiteBgPhrasings.length} 例均判 autonomous_execution（已交给 Agent，钉为不变量）`);

  console.log('\n✅ main-image-routing-baseline smoke 全部通过');
}

main();
