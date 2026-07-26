#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

require('ts-node').register({
  transpileOnly: true,
  project: path.join(ROOT, 'tsconfig.json'),
  compilerOptions: {
    module: 'CommonJS',
    moduleResolution: 'node'
  }
});

const {
  DesignAgentEngine,
  buildAutonomousSkillParams,
  buildControlledRouteSelectedSkillRuntimeHandoff,
  buildModelSelectedSkillRuntimeHandoff,
  buildRuntimeSelectedSkillHandoffForExecution
} = require(path.join(ROOT, 'src', 'renderer', 'services', 'design-agent', 'engine.ts'));
const skillExecutors = require(path.join(ROOT, 'src', 'renderer', 'services', 'skill-executors', 'index.ts'));
const {
  autonomousAgentExecutor,
  resolveAutonomousCapabilityRuntime
} = require(path.join(ROOT, 'src', 'renderer', 'services', 'skill-executors', 'autonomous-agent.executor.ts'));
const {
  buildRuntimeSelectedSkillHandoff,
  validateRuntimeSelectedSkillHandoff
} = require(path.join(ROOT, 'src', 'shared', 'agent-runtime-v5', 'runtime-selected-skill-handoff.ts'));
const {
  getSkillById
} = require(path.join(ROOT, 'src', 'shared', 'skills', 'skill-declarations.ts'));
const { Agent } = require(path.join(ROOT, 'src', 'renderer', 'services', 'agent-runtime', 'agent.ts'));
const runtimeSession = require(path.join(ROOT, 'src', 'shared', 'agent-runtime-v5', 'runtime-session.ts'));
const { buildRuntimeStagePlan } = require(path.join(ROOT, 'src', 'shared', 'agent-runtime-v5', 'runtime-stage-plan.ts'));
const { SKU_COLOR_CARD_MANIFEST } = require(path.join(ROOT, 'src', 'shared', 'agent-runtime-v5', 'manifests', 'sku-color-card.manifest.ts'));

const CASES = [
  ['sku-color-card', 'ecommerce.sku_color_card'],
  ['main-image-design', 'ecommerce.main_image'],
  ['detail-page-design', 'ecommerce.detail_page'],
  ['sku-batch', 'ecommerce.sku_batch'],
  ['layout-replication', 'design.reference_replication']
];
const AUTONOMOUS_INTENT = {
  requestKind: 'autonomous_execution',
  allowsAutonomousExecution: true
};

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

async function checkAsync(name, fn) {
  await fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

async function main() {
  console.log('smoke: runtime-selected-skill-handoff');

  for (const [legacySkillId, manifestSkillId] of CASES) {
    const declaration = getSkillById(legacySkillId);
    check(`${legacySkillId}: declaration produces generic R0 handoff`, () => {
      const handoff = buildRuntimeSelectedSkillHandoff({
        skillId: legacySkillId,
        routeClass: declaration.routeClass,
        directExecution: declaration.modelDirectExecution
      });
      assert.ok(handoff, legacySkillId);
      assert.strictEqual(validateRuntimeSelectedSkillHandoff(handoff), true);
      assert.strictEqual(handoff.boundaries.executesSkill, false);
      assert.strictEqual(handoff.boundaries.grantsToolPermission, false);
      assert.strictEqual(handoff.boundaries.derivedFromTaskText, false);
    });

    const modelHandoff = buildModelSelectedSkillRuntimeHandoff({
      route: 'skill_execution',
      skillId: legacySkillId,
      skillParams: {}
    }, AUTONOMOUS_INTENT);
    check(`${legacySkillId}: direct-forbidden model selection survives autonomous conversion`, () => {
      assert.ok(modelHandoff, legacySkillId);
      const params = buildAutonomousSkillParams(
        { userInput: `执行 ${legacySkillId}` },
        null,
        undefined,
        modelHandoff
      );
      assert.strictEqual(params.declaredSkillId, legacySkillId);
      assert.deepStrictEqual(params.runtimeSelectedSkillHandoff, modelHandoff);
    });

    // 结构化生产（规格已确认）走精简阶段链，去掉 R1/R3/R4 三道声明门；创意任务保留完整八阶段。
  const STRUCTURED_MANIFEST_IDS = new Set(['ecommerce.sku_batch', 'ecommerce.sku_color_card']);
  const expectedStages = STRUCTURED_MANIFEST_IDS.has(manifestSkillId)
    ? ['R0', 'R2', 'E1', 'R5']
    : ['R0', 'R1', 'R2', 'R3', 'R4', 'E1', 'R5', 'E2'];
  check(`${legacySkillId}: selected handoff resolves one manifest and ${expectedStages.length} stages`, () => {
      const params = buildAutonomousSkillParams(
        { userInput: `执行 ${legacySkillId}` },
        null,
        undefined,
        modelHandoff
      );
      const runtime = resolveAutonomousCapabilityRuntime(params);
      assert.strictEqual(runtime.runtimeContractStatus.status, 'resolved');
      assert.strictEqual(runtime.runtimeContractStatus.selectedSkillId, legacySkillId);
      assert.strictEqual(runtime.runtimeContractStatus.manifestSkillId, manifestSkillId);
      assert.strictEqual(runtime.runtimeContractBundle.manifest.skill_id, manifestSkillId);
      assert.strictEqual(runtime.runtimeContractBundle.stagePlan.steps.length, expectedStages.length);
      assert.deepStrictEqual(
        runtime.runtimeContractBundle.stagePlan.steps.map((step) => step.stage),
        expectedStages
      );
      assert.strictEqual(
        runtime.capabilitySession.getResolution().manifestRef?.skillId,
        manifestSkillId
      );
      assert.strictEqual(
        runtime.capabilitySession.activeTools.some((tool) => tool.name === 'declareDesignIntent'),
        false,
        'Manifest 已给出 task_type，不应再次暴露影子意图声明工具'
      );
    });
  }

  check('non-business or direct-executable Skill cannot forge business handoff', () => {
    assert.strictEqual(buildRuntimeSelectedSkillHandoff({
      skillId: 'document-management',
      routeClass: 'atomic-operation',
      directExecution: undefined
    }), undefined);
    assert.strictEqual(buildModelSelectedSkillRuntimeHandoff({
      route: 'skill_execution',
      skillId: 'document-management',
      skillParams: {}
    }, AUTONOMOUS_INTENT), undefined);
  });

  check('controlled route handoff keeps context-aware Skill provenance without granting permission', () => {
    const handoff = buildControlledRouteSelectedSkillRuntimeHandoff(
      'layout-replication',
      {
        requestKind: 'autonomous_execution',
        toolScope: 'write_photoshop',
        executionAuthorization: 'confirmed_tool_required'
      }
    );
    assert.ok(handoff);
    assert.strictEqual(handoff.skillId, 'layout-replication');
    assert.strictEqual(handoff.source, 'controlled_route_react_handoff');
    assert.strictEqual(handoff.boundaries.derivedFromTaskText, false);
    assert.strictEqual(handoff.boundaries.executesSkill, false);
    assert.strictEqual(handoff.boundaries.grantsToolPermission, false);
  });

  check('strict reference wording activates the selected layout workflow inside ReAct', () => {
    const userInput = '参考图照着做生成同款版式，保持可编辑文本层';
    const handoff = buildRuntimeSelectedSkillHandoffForExecution(
      userInput,
      { route: 'autonomous_agent', intentSummary: '按参考图复刻可编辑版式。' },
      AUTONOMOUS_INTENT
    );
    assert.ok(handoff);
    assert.strictEqual(handoff.skillId, 'layout-replication');
    assert.strictEqual(handoff.source, 'skill_declaration_unique_match');

    const params = buildAutonomousSkillParams(
      { userInput, hasAttachedImage: true, attachedImageData: 'fixture-image' },
      { route: 'autonomous_agent', intentSummary: '按参考图复刻可编辑版式。' },
      undefined,
      handoff
    );
    const runtime = resolveAutonomousCapabilityRuntime(params);
    assert.strictEqual(runtime.runtimeContractStatus.status, 'resolved');
    assert.strictEqual(runtime.runtimeContractBundle.manifest.skill_id, 'design.reference_replication');
    assert.ok(
      runtime.capabilitySession.activeTools.some((tool) => tool.name === 'layout-replication'),
      'selected reference workflow must be visible to the autonomous model'
    );
  });

  check('read-only or conversational intent cannot turn a business Skill hint into R0 selection', () => {
    assert.strictEqual(buildModelSelectedSkillRuntimeHandoff({
      route: 'skill_execution',
      skillId: 'sku-batch',
      skillParams: {}
    }, {
      requestKind: 'read_only_inspect',
      allowsAutonomousExecution: false
    }), undefined);
  });

  check('no structured selection preserves generic broad discovery', () => {
    const params = buildAutonomousSkillParams(
      { userInput: '设计一个没有现成 Skill 的新场景' },
      undefined,
      undefined
    );
    const runtime = resolveAutonomousCapabilityRuntime(params);
    assert.strictEqual(params.declaredSkillId, undefined);
    assert.strictEqual(runtime.runtimeContractStatus.status, 'no_skill_selected');
    assert.strictEqual(runtime.runtimeContractBundle, undefined);
    assert.strictEqual(runtime.capabilitySession.getResolution().selectionMode, 'broad_discovery');
    assert.strictEqual(
      runtime.capabilitySession.activeTools.some((tool) => tool.name === 'declareDesignIntent'),
      true,
      '通用 broad discovery 仍可使用意图影子声明'
    );
  });

  check('template-context detail-page wording survives autonomous router fallback (P-d regression)', () => {
    const userInput = '这是一个新的项目我在项目内放了摄影图文件夹是"2623 女孩刺绣 3.3"，我需要你先帮我提炼卖点，然后呢我们需要继续做详情页，我已经打开了一个详情页文件作为模板';
    const handoff = buildRuntimeSelectedSkillHandoffForExecution(userInput, {
      route: 'autonomous_agent',
      intentSummary: '进入通用自主处理。'
    }, AUTONOMOUS_INTENT);
    assert.ok(handoff, '已打开模板 + 继续做详情页必须产出 detail-page-design handoff（P-d 悬案回归）');
    assert.strictEqual(handoff.skillId, 'detail-page-design');
    assert.strictEqual(handoff.source, 'skill_declaration_unique_match');
  });

  check('bare continue-detail-page wording routes to detail-page-design instead of broad discovery', () => {
    const handoff = buildRuntimeSelectedSkillHandoffForExecution('然后呢我们需要继续做详情页', {
      route: 'autonomous_agent',
      intentSummary: '进入通用自主处理。'
    }, AUTONOMOUS_INTENT);
    assert.ok(handoff, '裸「继续做详情页」应归 detail-page-design（其声明范围含从零路径）');
    assert.strictEqual(handoff.skillId, 'detail-page-design');
  });

  check('explicit from-scratch detail-page wording stays excluded from the template workflow', () => {
    const handoff = buildRuntimeSelectedSkillHandoffForExecution('帮我从零设计一个全新的详情页', {
      route: 'autonomous_agent',
      intentSummary: '进入通用自主处理。'
    }, AUTONOMOUS_INTENT);
    assert.ok(!handoff || handoff.skillId !== 'detail-page-design',
      '明确的从零设计措辞仍不得进入 detail-page-design 模板工作流');
  });

  check('bare main-image wording keeps its from-scratch exclusion unchanged', () => {
    const handoff = buildRuntimeSelectedSkillHandoffForExecution('帮我做一张主图', {
      route: 'autonomous_agent',
      intentSummary: '进入通用自主处理。'
    }, AUTONOMOUS_INTENT);
    assert.ok(!handoff || handoff.skillId !== 'main-image-design',
      '裸「做一张主图」对 main-image-design 的从零排除保持不变');
  });

  check('natural-language deliverable with one declaration owner survives autonomous router fallback', () => {
    const userInput = '帮我把项目里已经按颜色命名的四张袜子图片做成一张 1500×1500 的 SKU 色卡，顺序是蓝条纹、咖条纹、奶白黑条纹、黑色白条纹。每个颜色一张卡片，序号放在卡片外面方便查看。完成后另存为 PSD/SKU-用户验收-3.psb，不要改动我现在打开的文档，也不用重新分析项目里的其他图片，直接使用这四张同名图片。';
    const handoff = buildRuntimeSelectedSkillHandoffForExecution(userInput, {
      route: 'autonomous_agent',
      intentSummary: '进入通用自主处理。'
    }, AUTONOMOUS_INTENT);
    assert.ok(handoff);
    assert.strictEqual(handoff.skillId, 'sku-color-card');
    assert.strictEqual(handoff.source, 'skill_declaration_unique_match');
    assert.strictEqual(handoff.boundaries.derivedFromTaskText, true);
    assert.strictEqual(handoff.boundaries.executesSkill, false);
    assert.strictEqual(handoff.boundaries.grantsToolPermission, false);

    const params = buildAutonomousSkillParams(
      { userInput },
      { route: 'autonomous_agent', intentSummary: '进入通用自主处理。' },
      undefined,
      handoff
    );
    const runtime = resolveAutonomousCapabilityRuntime(params);
    assert.strictEqual(runtime.runtimeContractStatus.status, 'resolved');
    assert.strictEqual(runtime.runtimeContractStatus.selectedSkillId, 'sku-color-card');
    assert.strictEqual(runtime.runtimeContractStatus.selectionSource, 'skill_declaration_unique_match');
    assert.strictEqual(runtime.runtimeContractBundle.manifest.skill_id, 'ecommerce.sku_color_card');
    assert.ok(
      runtime.capabilitySession.activeTools.some((tool) => tool.name === 'sku-color-card'),
      'selected workflow bridge must remain activated in the Capability Session'
    );
    assert.ok(
      runtime.capabilitySession.getResolution().onDemandCapabilityIds.length > 0,
      'post-Skill atomic adjustment capabilities must remain discoverable on demand'
    );
    const executorSource = fs.readFileSync(
      path.join(ROOT, 'src', 'renderer', 'services', 'skill-executors', 'autonomous-agent.executor.ts'),
      'utf8'
    );
    assert.ok(
      executorSource.includes('当前 Skill 已拥有这项交付物的方法')
        && executorSource.includes('不要先用原子 Photoshop 工具重新手工拼一遍'),
      'selected Skill ownership must be explicit in the model runtime context'
    );
    assert.ok(
      executorSource.includes('onToolStart: undefined')
        && executorSource.includes('onToolComplete: undefined'),
      'workflow Skill internals must not be promoted to top-level user tool rows'
    );
  });

  await checkAsync('selected workflow stays visible without hiding E1 prerequisites or atomic capabilities', async () => {
    const plan = buildRuntimeStagePlan(SKU_COLOR_CARD_MANIFEST);
    const identity = runtimeSession.createRuntimeSessionIdentity({
      now: '2026-07-14T04:00:00.000Z',
      nonce: 'workflow-first',
      skillId: plan.skillId,
      taskType: plan.taskType
    });
    let session = runtimeSession.createRuntimeSession({ identity, plan });
    for (const event of [
      ['R1', ['required_inputs_checked', 'blocking_inputs_identified']],
      ['R2', ['project_context_observed', 'visual_or_readback_observation']],
      ['R3', ['design_strategy_recorded', 'stage_goal_defined']],
      ['R4', ['preview_or_action_plan', 'stage_output_candidate']]
    ]) {
      session = runtimeSession.applyRuntimeSessionStageEvaluation({
        session,
        plan,
        event: {
          stage: event[0],
          outcome: 'passed',
          observedOutcomes: event[1]
        }
      });
    }
    assert.strictEqual(session.stageState.currentStage, 'E1');

    const tools = [
      'sku-color-card',
      'createDocument',
      'listDocuments',
      'getDocumentInfo',
      'createRectangle',
      'placeImage'
    ].map((name) => ({
      name,
      description: name,
      inputSchema: { type: 'object', properties: {} }
    }));
    const agent = new Agent({
      systemPrompt: 'test',
      tools,
      modelId: 'test-model',
      maxIterations: 2,
      callbacks: {},
      runtimeStagePlan: plan
    }, async () => ({ content: '', toolCalls: [] }), async () => ({ success: true }));
    agent.runtimeSession = session;

    const firstEntryNames = (await agent.buildModelVisibleToolsForIteration()).map((tool) => tool.name);
    assert.deepStrictEqual(firstEntryNames, tools.map((tool) => tool.name));
    assert(firstEntryNames.includes('sku-color-card'));
    assert(firstEntryNames.includes('createDocument'));
    assert(firstEntryNames.includes('listDocuments'));
    assert(firstEntryNames.includes('getDocumentInfo'));

    agent.toolCallLog.push({ name: 'sku-color-card' });
    const postWorkflowNames = (await agent.buildModelVisibleToolsForIteration()).map((tool) => tool.name);
    assert(postWorkflowNames.includes('createDocument'));
    assert(postWorkflowNames.includes('listDocuments'));
    assert(postWorkflowNames.includes('createRectangle'));
    assert(postWorkflowNames.includes('placeImage'));
    assert(postWorkflowNames.includes('getDocumentInfo'));

    agent.currentTask = '创建卡片后继续处理';
    agent.toolCallLog = [{
      name: 'createRectangle',
      arguments: { x: 10, y: 10, width: 100, height: 100 },
      result: { success: true }
    }];
    const partialWriteSummary = agent.buildExecutionSummary('tool_preflight_blocked', 1);
    assert.strictEqual(partialWriteSummary.successfulMutationCalls, 1);
    assert(partialWriteSummary.summaryText.includes('这稿已经改了一部分'));
    assert(!partialWriteSummary.summaryText.includes('本轮不会改动画面'));
  });

  check('declaration fallback does not override a non-autonomous model decision', () => {
    const handoff = buildRuntimeSelectedSkillHandoffForExecution('帮我制作 SKU 色卡', {
      route: 'clarification_needed',
      clarificationQuestion: '需要哪些颜色？'
    }, AUTONOMOUS_INTENT);
    assert.strictEqual(handoff, undefined);
  });

  check('explicit unknown Skill reports selected_manifest_missing instead of guessing', () => {
    const runtime = resolveAutonomousCapabilityRuntime({
      userTask: '测试未知 Skill',
      declaredSkillId: 'unknown-design-skill'
    });
    assert.strictEqual(runtime.runtimeContractStatus.status, 'selected_manifest_missing');
    assert.strictEqual(runtime.runtimeContractStatus.selectedSkillId, 'unknown-design-skill');
    assert.strictEqual(runtime.runtimeContractBundle, undefined);
  });

  await checkAsync('executor fails before model and Photoshop for unknown explicit Skill', async () => {
    let callbackCount = 0;
    const result = await autonomousAgentExecutor.execute({
      params: {
        userTask: '测试未知 Skill',
        declaredSkillId: 'unknown-design-skill'
      },
      callbacks: {
        onToolStart: () => { callbackCount += 1; },
        onToolComplete: () => { callbackCount += 1; }
      }
    });
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.error, 'runtime_selected_manifest_missing');
    assert.strictEqual(result.data.runtimeContractStatus.status, 'selected_manifest_missing');
    assert.strictEqual(result.data.executesModel, false);
    assert.strictEqual(result.data.executesPhotoshop, false);
    assert.strictEqual(result.data.grantsToolPermission, false);
    assert.strictEqual(callbackCount, 0);
  });

  await checkAsync('malformed handoff also fails closed before execution', async () => {
    const result = await autonomousAgentExecutor.execute({
      params: {
        userTask: '测试损坏 handoff',
        runtimeSelectedSkillHandoff: {
          version: 'runtime-selected-skill-handoff/v0',
          skillId: '../detail-page-design'
        }
      }
    });
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.error, 'runtime_selected_manifest_missing');
    assert.strictEqual(result.data.runtimeContractStatus.status, 'selected_manifest_missing');
    assert.strictEqual(result.data.executesModel, false);
    assert.strictEqual(result.data.executesPhotoshop, false);
  });

  check('handoff and declaredSkillId mismatch fails closed', () => {
    const handoff = buildRuntimeSelectedSkillHandoff({
      skillId: 'main-image-design',
      routeClass: 'business-workflow',
      directExecution: 'forbidden'
    });
    const runtime = resolveAutonomousCapabilityRuntime({
      userTask: '测试冲突选择',
      declaredSkillId: 'detail-page-design',
      runtimeSelectedSkillHandoff: handoff
    });
    assert.strictEqual(runtime.runtimeContractStatus.status, 'selected_manifest_missing');
    assert.strictEqual(runtime.runtimeContractBundle, undefined);
  });

  await checkAsync('production Engine preserves forbidden business Skill selection when entering ReAct', async () => {
    const originalGetSkillExecutor = skillExecutors.getSkillExecutor;
    const originalExecuteSkillWithExecutor = skillExecutors.executeSkillWithExecutor;
    const executed = [];
    const userInput = '我已确认 SKU 组合，请继续生成 SKU 组合图和自选备注。';
    try {
      skillExecutors.getSkillExecutor = (skillId) => ({
        skillId,
        execute: async () => ({ success: true, message: `stub:${skillId}` })
      });
      skillExecutors.executeSkillWithExecutor = async (skillId, payload) => {
        executed.push({ skillId, params: payload?.params || {} });
        return { success: true, message: `stub:${skillId}`, data: { stubbed: true } };
      };
      const engine = new DesignAgentEngine();
      await engine.run({
        userInput,
        conversationHistory: [],
        isPluginConnected: true,
        photoshopContext: {
          hasDocument: true,
          documentName: 'SKU.psb',
          activeLayerName: 'SKU'
        },
        projectContext: {
          projectPath: 'C:/DesignEcho/test-project',
          projectImageCount: 3,
          sampleImagePaths: ['C:/DesignEcho/test-project/SKU/white.jpg']
        }
      }, {
        callModel: async (_messages, options = {}) => {
          if (options.purpose === 'router') {
            return {
              text: JSON.stringify({
                route: 'skill_execution',
                skillId: 'sku-batch',
                mode: 'execute',
                intentSummary: '选择 SKU 批量设计能力并交给 ReAct 执行。'
              })
            };
          }
          return { text: '进入自主执行。' };
        }
      });
      assert.strictEqual(executed.length, 1, JSON.stringify(executed));
      assert.strictEqual(executed[0].skillId, 'autonomous-agent');
      assert.strictEqual(executed[0].params.declaredSkillId, 'sku-batch');
      assert.strictEqual(
        executed[0].params.runtimeSelectedSkillHandoff?.skillId,
        'sku-batch'
      );
      assert.strictEqual(
        executed[0].params.runtimeSelectedSkillHandoff?.boundaries?.grantsToolPermission,
        false
      );
    } finally {
      skillExecutors.getSkillExecutor = originalGetSkillExecutor;
      skillExecutors.executeSkillWithExecutor = originalExecuteSkillWithExecutor;
    }
  });

  console.log(`\n✅ runtime-selected-skill-handoff smoke 通过（${passed} 项）`);
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exit(1);
});
