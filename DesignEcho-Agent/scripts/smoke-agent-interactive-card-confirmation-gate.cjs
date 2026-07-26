// 交互确认卡片闸门：自主循环里一旦成功创建「需要用户确认」的交互卡片，
// 必须停在确认点——不能继续执行后续工具（否则就是「把待确认方案自动确认、跑完生产」的 bug）。
//
// 治理2026-07-01：闸门此前只识别【顶层】output.interactiveCards，而真实技能（sku-batch/socks/
// autonomous）把卡片放在【嵌套】output.data.interactiveCards，路径不一致→闸门漏判→不停机→
// 模型出卡后仍在 SKU.psb 里建图层组（用户实测的飞车）。旧 smoke 只用顶层 mock=假绿。
// 现在参数化覆盖三处来源，钉住"卡在 data 层/toolResults 内层也必须停机"这条此前失守的不变量。

const path = require('path');

require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '..', 'tsconfig.json'),
  compilerOptions: { module: 'CommonJS', moduleResolution: 'node' }
});

const { Agent } = require(path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'agent-runtime', 'agent.ts'));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const CARD = { version: 'interactive-card/v0', id: 'c1', kind: 'sku_combo_editor', title: '确认 SKU 组合' };

// 把同一张待确认卡放到工具结果的不同位置，模拟不同产卡路径。
// 三处来源覆盖：顶层 interactiveCards（createInteractiveCard 直接产卡）、
// data.interactiveCards（sku-batch/socks/autonomous 透传技能结果——真实缺陷路径）、
// toolResults[].result.interactiveCards（技能内部逐工具结果）。
function buildCardResultByPlacement(placement) {
  if (placement === 'top-level') {
    return { success: true, message: '已创建 SKU 组合确认卡片。', interactiveCards: [CARD] };
  }
  if (placement === 'nested-data') {
    return {
      success: true,
      message: '我已经生成一版组合候选，请在下面卡片里确认或修改组合。',
      data: { status: 'pending_sku_combo_confirmation', requiresUserAction: true, interactiveCards: [CARD] }
    };
  }
  if (placement === 'nested-toolresults') {
    return {
      success: true,
      message: '已创建确认卡片。',
      toolResults: [{ toolName: 'skuLayout', result: { interactiveCards: [CARD] } }]
    };
  }
  throw new Error(`unknown placement: ${placement}`);
}

async function runGateScenario(placement) {
  let modelCalls = 0;
  let productionCalled = false;

  const agent = new Agent(
    {
      systemPrompt: '帮用户做 SKU。',
      tools: [
        { name: 'createInteractiveCard', description: '创建确认卡片', inputSchema: { type: 'object', properties: {} } },
        { name: 'sku-batch', description: 'SKU 批量生产', inputSchema: { type: 'object', properties: {} } }
      ],
      modelId: 'test-model',
      maxIterations: 4,
      callbacks: { onStep: () => {} }
    },
    async () => {
      modelCalls += 1;
      if (modelCalls === 1) {
        return {
          content: '我先创建一个确认卡片，让你确认组合再批量生产。',
          toolCalls: [{ id: 'card1', name: 'createInteractiveCard', arguments: { cardKind: 'sku_combo_editor', title: '确认 SKU 组合' } }]
        };
      }
      // 第二轮（若被调用即说明闸门失效）：模型开始瞎跑，直接进入批量生产。
      return {
        content: '现在批量生产。',
        toolCalls: [{ id: 'sku1', name: 'sku-batch', arguments: {} }]
      };
    },
    async (toolName) => {
      if (toolName === 'createInteractiveCard') return buildCardResultByPlacement(placement);
      if (toolName === 'sku-batch') {
        productionCalled = true;
        return { success: true };
      }
      return { success: true };
    }
  );

  const result = await agent.run('帮我做 SKU');

  assert(result.stopReason === 'awaiting_user_confirmation',
    `[${placement}] 应停在确认点，实际 stopReason=${result.stopReason}`);
  assert(Array.isArray(result.data && result.data.interactiveCards) && result.data.interactiveCards.length === 1,
    `[${placement}] 应把待确认交互卡片随结果返回（供 UI 渲染等待用户确认）`);
  assert(modelCalls === 1,
    `[${placement}] 循环应停在产卡那一轮，不再进入下一轮；实际 modelCalls=${modelCalls}`);
  assert(!productionCalled,
    `[${placement}] 出卡后不得在用户确认前继续执行后续生产工具（sku-batch）——这正是要修的"不停机、自动确认跑完生产/瞎跑建图层"飞车`);
  assert(result.success === true,
    `[${placement}] 等待确认应视为成功暂停，实际 success=${result.success}`);
  assert(result.executionSummary && result.executionSummary.status === 'awaiting_confirmation',
    `[${placement}] 执行摘要状态应为 awaiting_confirmation，实际 status=${result.executionSummary && result.executionSummary.status}`);
  assert(!result.executionSummary.reflexionHandoff,
    `[${placement}] 等待确认不应生成 reflexion handoff（不是质量失败，不能自动返工）`);
  assert(!String(result.executionSummary.summaryText || '').includes('未完成'),
    `[${placement}] 等待确认的摘要文案不应含"未完成"，实际="${result.executionSummary.summaryText}"`);
}

async function runSameRoundGateScenario() {
  let productionCalled = false;
  const agent = new Agent(
    {
      systemPrompt: '帮用户做 SKU。',
      tools: [
        { name: 'createInteractiveCard', description: '创建确认卡片', inputSchema: { type: 'object', properties: {} } },
        { name: 'sku-batch', description: 'SKU 批量生产', inputSchema: { type: 'object', properties: {} } }
      ],
      modelId: 'test-model',
      maxIterations: 2,
      callbacks: { onStep: () => {} }
    },
    async () => ({
      content: '先出确认卡，再执行生产。',
      toolCalls: [
        { id: 'same-round-card', name: 'createInteractiveCard', arguments: {} },
        { id: 'same-round-write', name: 'sku-batch', arguments: {} }
      ]
    }),
    async (toolName) => {
      if (toolName === 'createInteractiveCard') return buildCardResultByPlacement('nested-data');
      if (toolName === 'sku-batch') {
        productionCalled = true;
        return { success: true };
      }
      return { success: true };
    }
  );

  const result = await agent.run('帮我做 SKU');
  assert(result.stopReason === 'awaiting_user_confirmation',
    `同一模型轮的确认卡应立即暂停，实际 stopReason=${result.stopReason}`);
  assert(!productionCalled,
    '确认卡与生产写调用出现在同一模型轮时，后续写调用也不得越过确认点');
}

async function main() {
  // 三处产卡路径都必须触发停机（nested-data 是此前失守、导致用户飞车的真实路径）。
  for (const placement of ['top-level', 'nested-data', 'nested-toolresults']) {
    await runGateScenario(placement);
  }
  await runSameRoundGateScenario();
  console.log('[smoke-agent-interactive-card-confirmation-gate] passed');
}

main().catch((error) => {
  console.error(error && error.message ? error.message : String(error));
  process.exit(1);
});
