'use strict';

/**
 * smoke: 正则意图谓词行为冻结（去重收敛的前置钉桩）
 *
 * 背景：routing.ts / shared/agent-intent-control-plane.ts / engine.ts 历史上存在多份
 * 重复或近似重复的正则意图谓词（它们只作提示/路线建议，不拦截模型——v3 原则）。
 * 治理方式是去重收敛而非删除，且要求【行为逐字节不变】。
 *
 * 本 smoke 在收敛前采集了 29 条代表性输入（SKU/主图/详情页/开放创意/咨询/模糊/寒暄/
 * 团队流水线各若干）的谓词输出作为期望值（采集时点：收敛改动之前的工作区），收敛后必须原样通过。
 *
 * 已收敛（单一来源=shared/agent-intent-control-plane.ts）：
 *  - EXPLICIT_TEAM_PIPELINE（原 engine.ts EXPLICIT_TEAM_PIPELINE_INTENT_PATTERN 为逐字节等价副本）
 *    → 导出 hasExplicitTeamPipelineIntent，engine 改引用。
 *  - GREETING / THANKS / FOLLOW_UP_QUESTION（原 routing.ts 有 \uXXXX 转义形式的逐字节等价副本）
 *    → control-plane 导出，routing 改引用。
 *
 * 有意不收敛（真实语义分歧，冻结现状、取舍留待用户决策）：
 *  - ACK：routing 把「开始」当确认（→ lightweightIntent 'ack'）；control-plane 把「明白」当
 *    casual_conversation。两处各有调用方依赖，本 smoke 把分歧行为原样钉住。
 *
 * ────────────────────────────────────────────────────────────────────────
 * V0-5 扩展（路由冻结基线：三分类器现状快照，为后续 V2 意图路由重构建防漂移网）
 *
 * 目的：把「同一句话经过三个独立分类器」的真实当前输出逐字段冻结，任何一处后续重构导致
 * 输出漂移都会在此立即失败。价值是「冻结现状防漂移」，不是「断言正确」——其中若干现状是
 * 已知误判（见每例注释 [待V2修正]），仍原样冻结，V2 修正时由改动方主动更新本快照并说明。
 *
 * 纳入冻结的三个分类器（全部可在 tsconfig.json + ts-node/transpileOnly 下加载并实跑）：
 *  1. 控制面 buildAgentIntentControlPlaneDecision（src/shared/agent-intent-control-plane.ts）
 *     —— 冻结 requestKind / toolScope / matchedSignals(全量) / executionAuthorization。
 *  2. 设计任务类型 resolveDesignTaskTypeSpec（src/shared/design-task-types.ts）
 *     —— 冻结返回 spec 的 id（未命中为 null）。
 *  3. 路由确定性匹配 matchDeterministicIntent（src/renderer/services/agent-orchestration/routing.ts）
 *     —— 该函数非导出，其唯一公开出口是 fastDeterministicRoute（返回 skillId）；此处冻结
 *     fastDeterministicRoute().skillId（未命中确定性技能为 null，表示落 autonomous 兜底），
 *     并同时冻结 detectLightweightIntent。renderer 依赖（app.store 等）在 node 下可正常加载，
 *     故 routing 已纳入冻结，非「未纳入」。
 *
 * 期望值来源：2026-07-08 在 C:/DesignEcho/DesignEcho-Agent 工作区用 ts-node 实跑三分类器采集，
 * 非人工推断。改变任何一项都意味着行为漂移，必须先向用户说明再更新本快照。
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '..', 'tsconfig.json'),
  compilerOptions: {
    module: 'CommonJS',
    moduleResolution: 'node'
  }
});

const routing = require(path.resolve(
  __dirname, '..', 'src', 'renderer', 'services', 'agent-orchestration', 'routing.ts'
));
const controlPlane = require(path.resolve(
  __dirname, '..', 'src', 'shared', 'agent-intent-control-plane.ts'
));
const designTaskTypes = require(path.resolve(
  __dirname, '..', 'src', 'shared', 'design-task-types.ts'
));

// [input, 期望 detectLightweightIntent, 期望 requestKind, 期望 matchedSignals[0], 期望 hasExplicitTeamPipelineIntent]
// 期望值 = 收敛前实测快照，不是设计期望；改变任何一项都意味着行为漂移，必须先向用户说明。
const FROZEN_CASES = [
  // 寒暄/确认/感谢/追问（GREETING/THANKS/ACK/FOLLOW_UP 的行为面）
  ['你好', 'greeting', 'chat_only', 'casual_conversation', false],
  ['您好呀', 'greeting', 'chat_only', 'casual_conversation', false],
  ['hello', 'greeting', 'chat_only', 'casual_conversation', false],
  ['谢谢啦', 'thanks', 'chat_only', 'casual_conversation', false],
  ['好的', 'ack', 'chat_only', 'casual_conversation', false],
  ['收到', 'ack', 'chat_only', 'casual_conversation', false],
  ['我还有一个问题', 'chat', 'chat_only', 'follow_up_question', false],
  ['继续', 'continuation', 'chat_only', 'default_chat', false],
  // ACK 语义分歧的冻结（不收敛项）：routing 认「开始」，control-plane 认「明白」
  ['开始', 'ack', 'chat_only', 'default_chat', false],
  ['明白', 'chat', 'chat_only', 'casual_conversation', false],
  // 团队流水线（EXPLICIT_TEAM_PIPELINE 收敛项的行为面）
  ['用设计团队流水线评审详情页', 'none', 'autonomous_execution', 'explicit_team_pipeline', true],
  ['让团队协作做一版主图', 'none', 'autonomous_execution', 'explicit_team_pipeline', true],
  ['请用 team pipeline 评审一下当前画面', 'none', 'autonomous_execution', 'explicit_team_pipeline', true],
  ['多智能体一起分析这个设计', 'none', 'autonomous_execution', 'explicit_team_pipeline', true],
  // SKU
  ['帮我做SKU', 'none', 'autonomous_execution', 'explicit_business_execution', false],
  ['生成sku组合图', 'none', 'autonomous_execution', 'explicit_business_execution', false],
  ['SKU是什么', 'chat', 'chat_only', 'chat_question', false],
  // 主图
  ['做一张主图', 'none', 'autonomous_execution', 'explicit_creative_design', false],
  ['帮我设计一张主图', 'none', 'autonomous_execution', 'explicit_creative_design', false],
  ['导出白底图', 'none', 'autonomous_execution', 'shared_skill_routing:main-image-design', false],
  // 详情页
  ['设计一张详情页', 'none', 'autonomous_execution', 'explicit_creative_design', false],
  ['帮我把当前详情页模板填充产品图', 'none', 'autonomous_execution', 'shared_skill_routing:detail-page-design', false],
  // 开放创意/开放改进
  ['从零设计一张海报', 'none', 'autonomous_execution', 'explicit_creative_design', false],
  ['把当前画面整理得更高级一点', 'none', 'autonomous_execution', 'open_autonomous_execution', false],
  // 咨询/只读
  ['为什么详情页要分屏', 'chat', 'chat_only', 'chat_question', false],
  ['看看当前文档有几屏', 'none', 'read_only_inspect', 'read_only_inspection', false],
  ['这个项目是什么项目', 'none', 'read_only_inspect', 'read_only_inspection', false],
  // 模糊
  ['帮我处理一下', 'none', 'autonomous_execution', 'ambiguous_action', false],
  ['优化一下这个画面', 'none', 'autonomous_execution', 'ambiguous_action', false]
];

/**
 * V0-5 三分类器现状快照（防漂移网）。字段全部为 2026-07-08 实跑真值。
 * 每例形如：
 *   {
 *     input,
 *     control: { requestKind, toolScope, matchedSignals(全量数组), executionAuthorization },
 *     designTaskTypeId: <resolveDesignTaskTypeSpec 返回 spec.id，未命中为 null>,
 *     routing: { fastRouteSkillId: <fastDeterministicRoute().skillId，未命中为 null>, lightweight }
 *   }
 * note：标注该例的现状语义，[待V2修正] 表示这是已知误判、仅冻结现状。
 */
const V0_5_THREE_CLASSIFIER_FREEZE = [
  {
    input: '导出主图详情页',
    control: {
      requestKind: 'autonomous_execution',
      toolScope: 'write_photoshop',
      matchedSignals: ['shared_skill_routing:detail-page-design', 'controlled_skill_autonomous_entry'],
      executionAuthorization: 'confirmed_tool_required'
    },
    designTaskTypeId: 'ecommerce.detail_page.v1',
    routing: { fastRouteSkillId: 'detail-page-design', lightweight: 'none' },
    // [待V2修正] “导出”本是操作既有文件的维护语义，现状三分类器仍把它当「从零设计详情页」：
    // 控制面首信号 detail-page-design、任务类型判 detail_page spec、路由落 detail-page-design。
    note: '导出既有主图/详情页被误判为从零设计详情页（治理报告 V2 靶心之一）'
  },
  {
    input: '导出这张详情页',
    control: {
      requestKind: 'autonomous_execution',
      toolScope: 'write_photoshop',
      matchedSignals: ['shared_skill_routing:detail-page-design', 'controlled_skill_autonomous_entry'],
      executionAuthorization: 'confirmed_tool_required'
    },
    designTaskTypeId: 'ecommerce.detail_page.v1',
    routing: { fastRouteSkillId: 'detail-page-design', lightweight: 'none' },
    // [待V2修正] 同上：“导出既有”仍被任务类型判为从零设计 detail_page spec。
    note: '导出既有详情页被误判为从零设计详情页'
  },
  {
    input: '帮我改一下详情页文案',
    control: {
      requestKind: 'autonomous_execution',
      toolScope: 'write_photoshop',
      matchedSignals: ['shared_skill_routing:detail-page-design', 'controlled_skill_autonomous_entry'],
      executionAuthorization: 'confirmed_tool_required'
    },
    designTaskTypeId: 'ecommerce.detail_page.v1',
    routing: { fastRouteSkillId: 'find-and-edit-element', lightweight: 'none' },
    // [待V2修正] 三分类器现状不一致：控制面首信号与任务类型都判「详情页」（含从零设计 spec），
    // 但路由确定性匹配落 find-and-edit-element（改文案专用路径）。改文案不应触发从零设计详情页。
    note: '改文案：控制面/任务类型判详情页设计，路由判 find-and-edit-element（三者现状不一致）'
  },
  {
    input: '看看这张详情页做得怎样',
    control: {
      requestKind: 'autonomous_execution',
      toolScope: 'write_photoshop',
      matchedSignals: ['shared_skill_routing:detail-page-design', 'controlled_skill_autonomous_entry'],
      executionAuthorization: 'confirmed_tool_required'
    },
    designTaskTypeId: null,
    routing: { fastRouteSkillId: 'detail-page-design', lightweight: 'none' },
    // [待V2修正] “看看…做得怎样”是只读评审语义：任务类型正确排除（“看看”命中 excludeSignals → null），
    // 但控制面仍判 autonomous_execution/write_photoshop、路由仍落 detail-page-design，而非 read_only_inspect。
    note: '只读评审：任务类型正确排除为 null，但控制面/路由仍判从零设计详情页写入（非只读）'
  },
  {
    input: '帮我做一张主图',
    control: {
      requestKind: 'autonomous_execution',
      toolScope: 'write_photoshop',
      matchedSignals: ['explicit_creative_design'],
      executionAuthorization: 'confirmed_tool_required'
    },
    designTaskTypeId: 'ecommerce.main_image.v1',
    routing: { fastRouteSkillId: null, lightweight: 'none' },
    // 现状：控制面判 explicit_creative_design，任务类型判主图 spec，路由不落确定性技能（走 autonomous 兜底）。
    note: '从零做主图：控制面 explicit_creative_design + 任务类型 main_image + 路由落 autonomous 兜底'
  },
  {
    input: '帮我做详情页',
    control: {
      requestKind: 'autonomous_execution',
      toolScope: 'write_photoshop',
      matchedSignals: ['explicit_creative_design'],
      executionAuthorization: 'confirmed_tool_required'
    },
    designTaskTypeId: 'ecommerce.detail_page.v1',
    routing: { fastRouteSkillId: 'detail-page-design', lightweight: 'none' },
    // 已修正（P-d / D-058）：裸「做详情页」不再按从零设计排除——detail-page-design 声明范围含从零路径，
    // 控制面 explicit_creative_design、任务类型 detail_page、路由落 detail-page-design。
    note: '做详情页：explicit_creative_design + detail_page + 路由 detail-page-design（P-d 修正）'
  },
  {
    input: '做一张800白底图',
    control: {
      requestKind: 'autonomous_execution',
      toolScope: 'write_photoshop',
      matchedSignals: ['shared_skill_routing:main-image-design', 'controlled_skill_autonomous_entry'],
      executionAuthorization: 'confirmed_tool_required'
    },
    designTaskTypeId: null,
    routing: { fastRouteSkillId: 'main-image-design', lightweight: 'none' },
    // 现状：白底图规格子集，控制面首信号 main-image-design、任务类型排除为 null（“白底图”命中 main_image excludeSignals）、
    // 路由落 main-image-design。
    note: '白底图规格：控制面/路由判 main-image-design，任务类型排除为 null（白底图属规格路径非从零设计）'
  },
  {
    input: '帮我做SKU',
    control: {
      requestKind: 'autonomous_execution',
      toolScope: 'write_photoshop',
      matchedSignals: [
        'explicit_business_execution',
        'business_workflow_react_entry',
        'sku_execution',
        'stage:inspect_existing_resources',
        'stage:confirm_combos'
      ],
      executionAuthorization: 'confirmed_tool_required'
    },
    designTaskTypeId: null,
    routing: { fastRouteSkillId: 'sku-batch', lightweight: 'none' },
    // 现状：SKU 批量执行，控制面 explicit_business_execution（带 sku_execution 阶段信号）、路由落 sku-batch；
    // 任务类型为 null（裸“SKU”不含“SKU模板”关键词，SKU 模板设计品类不命中——正确）。
    note: 'SKU 批量执行：控制面 explicit_business_execution + 路由 sku-batch，任务类型 null（非 SKU 模板设计）'
  },
  {
    input: '帮我做详情页最后导出',
    control: {
      requestKind: 'autonomous_execution',
      toolScope: 'write_photoshop',
      matchedSignals: ['explicit_creative_design'],
      executionAuthorization: 'confirmed_tool_required'
    },
    designTaskTypeId: 'ecommerce.detail_page.v1',
    routing: { fastRouteSkillId: 'detail-page-design', lightweight: 'none' },
    // 已修正（P-d / D-058）：句中含"导出"但主体是做详情页，控制面 explicit_creative_design 优先、
    // 任务类型 detail_page、路由落 detail-page-design（裸"做详情页"不再按从零排除）。
    note: '做详情页并最后导出：explicit_creative_design + detail_page + 路由 detail-page-design（P-d 修正）'
  }
];

function verifyLegacyFrozenCases() {
  assert.ok(FROZEN_CASES.length >= 20, `冻结用例必须 ≥ 20 条（当前 ${FROZEN_CASES.length}）`);

  assert.strictEqual(
    typeof controlPlane.hasExplicitTeamPipelineIntent,
    'function',
    'shared/agent-intent-control-plane 必须导出 hasExplicitTeamPipelineIntent（团队流水线谓词单一来源）'
  );

  let checked = 0;
  for (const [input, expectedLightweight, expectedKind, expectedPrimarySignal, expectedTeam] of FROZEN_CASES) {
    const lightweight = routing.detectLightweightIntent(input);
    assert.strictEqual(
      lightweight,
      expectedLightweight,
      `detectLightweightIntent 行为漂移：「${input}」期望 ${expectedLightweight}，得到 ${lightweight}`
    );

    const decision = controlPlane.buildAgentIntentControlPlaneDecision({ userInput: input });
    assert.strictEqual(
      decision.requestKind,
      expectedKind,
      `requestKind 行为漂移：「${input}」期望 ${expectedKind}，得到 ${decision.requestKind}`
    );
    assert.strictEqual(
      decision.matchedSignals[0],
      expectedPrimarySignal,
      `首个 matchedSignal 行为漂移：「${input}」期望 ${expectedPrimarySignal}，得到 ${decision.matchedSignals[0]}`
    );

    assert.strictEqual(
      controlPlane.hasExplicitTeamPipelineIntent(input),
      expectedTeam,
      `hasExplicitTeamPipelineIntent 行为漂移：「${input}」期望 ${expectedTeam}`
    );
    checked += 1;
  }
  console.log(`  ✓ ${checked} 条冻结用例全部与收敛前快照一致`);
}

function verifyV05ThreeClassifierFreeze() {
  assert.strictEqual(
    typeof designTaskTypes.resolveDesignTaskTypeSpec,
    'function',
    'shared/design-task-types 必须导出 resolveDesignTaskTypeSpec（设计任务类型分类器）'
  );
  assert.strictEqual(
    typeof routing.fastDeterministicRoute,
    'function',
    'routing 必须导出 fastDeterministicRoute（matchDeterministicIntent 的唯一公开出口）'
  );

  let checked = 0;
  for (const row of V0_5_THREE_CLASSIFIER_FREEZE) {
    const { input, control, designTaskTypeId, routing: routingExpected } = row;

    // 1) 控制面 buildAgentIntentControlPlaneDecision
    const decision = controlPlane.buildAgentIntentControlPlaneDecision({ userInput: input });
    assert.strictEqual(
      decision.requestKind,
      control.requestKind,
      `[V0-5] 控制面 requestKind 漂移：「${input}」期望 ${control.requestKind}，得到 ${decision.requestKind}`
    );
    assert.strictEqual(
      decision.toolScope,
      control.toolScope,
      `[V0-5] 控制面 toolScope 漂移：「${input}」期望 ${control.toolScope}，得到 ${decision.toolScope}`
    );
    assert.strictEqual(
      decision.executionAuthorization,
      control.executionAuthorization,
      `[V0-5] 控制面 executionAuthorization 漂移：「${input}」期望 ${control.executionAuthorization}，得到 ${decision.executionAuthorization}`
    );
    assert.deepStrictEqual(
      decision.matchedSignals,
      control.matchedSignals,
      `[V0-5] 控制面 matchedSignals 漂移：「${input}」期望 ${JSON.stringify(control.matchedSignals)}，得到 ${JSON.stringify(decision.matchedSignals)}`
    );

    // 2) 设计任务类型 resolveDesignTaskTypeSpec
    const spec = designTaskTypes.resolveDesignTaskTypeSpec(input);
    const actualTaskTypeId = spec ? spec.id : null;
    assert.strictEqual(
      actualTaskTypeId,
      designTaskTypeId,
      `[V0-5] resolveDesignTaskTypeSpec 漂移：「${input}」期望 ${designTaskTypeId}，得到 ${actualTaskTypeId}`
    );

    // 3) 路由确定性匹配（matchDeterministicIntent 经 fastDeterministicRoute 出口）+ detectLightweightIntent
    const route = routing.fastDeterministicRoute(input);
    const actualSkillId = route && route.skillId ? route.skillId : null;
    assert.strictEqual(
      actualSkillId,
      routingExpected.fastRouteSkillId,
      `[V0-5] fastDeterministicRoute().skillId 漂移：「${input}」期望 ${routingExpected.fastRouteSkillId}，得到 ${actualSkillId}`
    );
    const lightweight = routing.detectLightweightIntent(input);
    assert.strictEqual(
      lightweight,
      routingExpected.lightweight,
      `[V0-5] detectLightweightIntent 漂移：「${input}」期望 ${routingExpected.lightweight}，得到 ${lightweight}`
    );

    checked += 1;
  }
  console.log(`  ✓ ${checked} 条 V0-5 三分类器现状快照全部一致（冻结现状，含 [待V2修正] 的已知误判）`);
}

function verifyStructuralPins() {
  // 结构性钉桩：重复定义确实已删除（防止「收敛后又长回来」）
  const engineSource = fs.readFileSync(path.resolve(
    __dirname, '..', 'src', 'renderer', 'services', 'design-agent', 'engine.ts'
  ), 'utf8');
  assert.ok(
    !engineSource.includes('EXPLICIT_TEAM_PIPELINE_INTENT_PATTERN ='),
    'engine.ts 不得再维护本地 EXPLICIT_TEAM_PIPELINE_INTENT_PATTERN 副本（单一来源=control-plane）'
  );
  assert.ok(
    engineSource.includes('hasExplicitTeamPipelineIntent'),
    'engine.ts 必须继续使用 hasExplicitTeamPipelineIntent（显式团队协作指令保护是护栏，不删除）'
  );

  const routingSource = fs.readFileSync(path.resolve(
    __dirname, '..', 'src', 'renderer', 'services', 'agent-orchestration', 'routing.ts'
  ), 'utf8');
  for (const name of ['GREETING_PATTERN', 'THANKS_PATTERN', 'FOLLOW_UP_QUESTION_PATTERN']) {
    assert.ok(
      !new RegExp(`const ${name} =`).test(routingSource),
      `routing.ts 不得再维护本地 ${name} 副本（单一来源=control-plane 导出）`
    );
  }
  assert.ok(
    /const ACK_PATTERN =/.test(routingSource),
    'routing.ts 的本地 ACK_PATTERN 必须保留（与 control-plane 存在真实语义分歧，未合并，留用户决策）'
  );
  console.log('  ✓ 结构性钉桩通过：收敛项无本地副本，分歧项（ACK）保持双份现状');
}

function main() {
  console.log('smoke: intent-predicate-freeze');
  verifyLegacyFrozenCases();
  verifyV05ThreeClassifierFreeze();
  verifyStructuralPins();
  console.log('smoke: intent-predicate-freeze 全部通过');
}

main();
