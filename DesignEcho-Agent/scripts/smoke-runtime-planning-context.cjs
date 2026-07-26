#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '..', 'tsconfig.main.json')
});

const ROOT = path.resolve(__dirname, '..');
const runtime = require(path.join(ROOT, 'src', 'shared', 'agent-runtime-v5', 'runtime-session.ts'));
const planning = require(path.join(ROOT, 'src', 'shared', 'agent-runtime-v5', 'runtime-planning-context-seed.ts'));
const { buildRuntimeStagePlan } = require(path.join(ROOT, 'src', 'shared', 'agent-runtime-v5', 'runtime-stage-plan.ts'));
const { GENERAL_DESIGN_MANIFEST } = require(path.join(
  ROOT,
  'src',
  'shared',
  'agent-runtime-v5',
  'manifests',
  'general-design.manifest.ts'
));
const { DETAIL_PAGE_MANIFEST } = require(path.join(
  ROOT,
  'src',
  'shared',
  'agent-runtime-v5',
  'manifests',
  'detail-page.manifest.ts'
));
const { Agent } = require(path.join(ROOT, 'src', 'renderer', 'services', 'agent-runtime', 'agent.ts'));
const { buildAgentRunRecord, validateAgentRunRecordForPersist } = require(path.join(
  ROOT,
  'src',
  'shared',
  'agent-run-record.ts'
));

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

const plan = buildRuntimeStagePlan(GENERAL_DESIGN_MANIFEST);
const detailEditPlan = buildRuntimeStagePlan(DETAIL_PAGE_MANIFEST, 'edit_existing');

function evaluate(session, stage, outcome, observedOutcomes) {
  return runtime.applyRuntimeSessionStageEvaluation({
    session,
    plan,
    event: { stage, outcome, observedOutcomes, reason: `planning-context:${stage}` }
  });
}

function advanceToR5(identity) {
  let session = runtime.createRuntimeSession({ identity, plan });
  session = evaluate(session, 'R1', 'passed', ['required_inputs_checked', 'blocking_inputs_identified']);
  session = evaluate(session, 'R2', 'passed', ['project_context_observed', 'visual_or_readback_observation']);
  session = evaluate(session, 'R3', 'passed', ['design_strategy_recorded', 'stage_goal_defined']);
  session = evaluate(session, 'R4', 'passed', ['preview_or_action_plan', 'stage_output_candidate']);
  session = evaluate(session, 'E1', 'passed', ['tool_action_result', 'tool_observation_recorded']);
  return session;
}

function handoff(targetStage) {
  return {
    version: 'quality-gate-reflexion-handoff/v0',
    status: 'reflexion_required',
    sourceOwner: 'R5',
    targetStage,
    reenterLoop: 'react',
    failureAnalysis: ['当前结果没有通过质量门禁。'],
    strategyAdjustments: ['从回退目标重新处理。'],
    nextRoundConstraints: ['保留未失效的上游模型声明。']
  };
}

function declarations() {
  return {
    brief: {
      version: 'runtime-design-brief-declaration/v0',
      source: 'model_tool_call',
      readiness: 'ready',
      payload: {
        taskGoal: '在当前画布完成清晰、可编辑的设计结果。',
        deliverables: ['可编辑设计稿'],
        outputRequirements: ['写入后读回'],
        constraints: ['保护真实素材'],
        inputCoverage: plan.requiredInputs.map((inputKey) => ({
          inputKey,
          status: 'provided',
          contextRefs: ['context:user_goal']
        })),
        contextRefs: ['context:user_goal', 'context:skill_manifest']
      },
      boundaries: {
        modelAuthored: true,
        harnessValidatedOnly: true,
        manifestInputsAreSourceOfTruth: true,
        categoryNeutral: true,
        executesTools: false,
        grantsPermission: false,
        autoActivatesCapabilities: false,
        countsAsTaskProgress: false,
        countsAsQualityPass: false
      }
    },
    strategy: {
      version: 'runtime-design-strategy-declaration/v0',
      source: 'model_tool_call',
      readiness: 'ready',
      payload: {
        stageGoal: '建立清晰的信息层级。',
        objective: {
          primaryGoal: '让用户快速理解核心信息。',
          secondaryGoals: ['保持素材真实性'],
          targetAudienceSummary: '需要快速读取信息的用户。'
        },
        messageArchitecture: {
          primaryMessage: '核心信息优先。',
          supportingMessages: ['辅助信息保持次级。'],
          supportingFacts: ['当前项目上下文已读取。'],
          objectionsToResolve: ['主体是否突出']
        },
        copyDirection: {
          toneKeywords: ['清晰'],
          headlineOptions: ['聚焦核心'],
          subtitleOptions: [],
          tagOptions: [],
          prohibitedClaims: ['未经确认的承诺']
        },
        visualDirection: {
          moodKeywords: ['简洁'],
          paletteIntent: ['中性色承载主体。'],
          typographyIntent: ['建立明显层级。'],
          compositionIntent: ['主体承担主要视觉重量。'],
          imageTreatment: ['保护真实纹理。'],
          density: 'medium'
        },
        constraints: ['不改变素材事实。'],
        contextRefs: ['context:user_goal', 'context:design_brief'],
        assumptions: [],
        missingInputs: []
      },
      boundaries: {
        modelAuthored: true,
        harnessValidatedOnly: true,
        artifactPublished: false,
        executesTools: false,
        grantsPermission: false,
        countsAsTaskProgress: false,
        countsAsQualityPass: false,
        categoryNeutral: true
      }
    },
    actionPlan: {
      version: 'runtime-action-plan-declaration/v0',
      source: 'model_tool_call',
      readiness: 'ready',
      payload: {
        planGoal: '完成一次修改并读回复核。',
        strategyRef: 'current:r3_design_strategy',
        contextRefs: ['context:design_strategy'],
        steps: [{
          stepId: 'adjust-layout',
          kind: 'mutate',
          goal: '调整信息层级。',
          dependsOn: [],
          capabilityRefs: [],
          inputContextRefs: ['context:design_strategy'],
          expectedOutcomes: ['document_change', 'readback'],
          completionCriteria: ['实际读回支持目标。'],
          failurePolicy: 'enter_reflexion'
        }],
        missingInputs: []
      },
      missingCapabilityRefs: [],
      graph: {
        acyclic: true,
        rootStepIds: ['adjust-layout'],
        terminalStepIds: ['adjust-layout'],
        parallelGroups: []
      },
      boundaries: {
        modelAuthored: true,
        harnessValidatedOnly: true,
        strategyAligned: true,
        categoryNeutral: true,
        semanticDslOnly: true,
        resumeMappingModelAuthored: true,
        shadowOnly: true,
        executable: false,
        schedulerAuthority: false,
        autoActivatesCapabilities: false,
        executesTools: false,
        grantsPermission: false,
        countsAsTaskProgress: false,
        countsAsQualityPass: false
      }
    }
  };
}

function createEditModeReflexionGeneration() {
  const firstIdentity = runtime.createRuntimeSessionIdentity({
    now: '2026-07-13T07:00:20.000Z',
    nonce: 'planning-edit-mode',
    skillId: detailEditPlan.skillId,
    taskType: detailEditPlan.taskType
  });
  let previous = runtime.createRuntimeSession({ identity: firstIdentity, plan: detailEditPlan });
  for (const stage of ['R1', 'R2', 'R3', 'R4', 'E1']) {
    const step = detailEditPlan.steps.find((item) => item.stage === stage);
    previous = runtime.applyRuntimeSessionStageEvaluation({
      session: previous,
      plan: detailEditPlan,
      event: {
        stage,
        outcome: 'passed',
        observedOutcomes: [...step.requiredOutcomes],
        reason: `planning-context-edit:${stage}`
      }
    });
  }
  const reflexionHandoff = handoff('R2');
  previous = runtime.finalizeRuntimeSession({
    session: previous,
    plan: detailEditPlan,
    executionSummary: { status: 'failed', blockers: ['需要重新建立参考决策'] },
    reflexionHandoff
  });
  const nextIdentity = runtime.advanceRuntimeSessionIdentity({
    previous: previous.identity,
    now: '2026-07-13T07:01:20.000Z',
    nonce: 'planning-edit-mode-next'
  });
  const next = runtime.advanceRuntimeSessionGeneration({
    previous,
    identity: nextIdentity,
    plan: detailEditPlan
  });
  return { previous, next };
}

function editModeBrief(workMode) {
  const brief = declarations().brief;
  return {
    ...brief,
    payload: {
      ...brief.payload,
      workMode
    }
  };
}

function createReflexionGeneration(label, targetStage) {
  const firstIdentity = runtime.createRuntimeSessionIdentity({
    now: `2026-07-13T07:00:${label === 'r4' ? '00' : '10'}.000Z`,
    nonce: `planning-${label}`,
    skillId: plan.skillId,
    taskType: plan.taskType
  });
  let previous = advanceToR5(firstIdentity);
  const reflexionHandoff = handoff(targetStage);
  previous = runtime.finalizeRuntimeSession({
    session: previous,
    plan,
    executionSummary: { status: 'failed', blockers: ['质量门禁未通过'] },
    reflexionHandoff
  });
  const nextIdentity = runtime.advanceRuntimeSessionIdentity({
    previous: previous.identity,
    now: `2026-07-13T07:01:${label === 'r4' ? '00' : '10'}.000Z`,
    nonce: `planning-${label}-next`
  });
  const next = runtime.advanceRuntimeSessionGeneration({
    previous,
    identity: nextIdentity,
    plan
  });
  return { previous, next, reflexionHandoff };
}

console.log('smoke: runtime-planning-context');

const r4 = createReflexionGeneration('r4', 'R4');

check('Reflexion 新代把 target=R4 及下游快照失效而保留上游事实', () => {
  assert.strictEqual(r4.next.stageState.status, 'active');
  assert.strictEqual(r4.next.stageState.currentStage, 'R4');
  assert.strictEqual(r4.next.stageState.stages.find((item) => item.stage === 'R3').status, 'passed');
  assert.strictEqual(r4.next.stageState.stages.find((item) => item.stage === 'R4').status, 'unobserved');
  assert.strictEqual(r4.next.stageState.stages.find((item) => item.stage === 'R5').status, 'unobserved');
  assert.deepStrictEqual(r4.next.stageState.stages.find((item) => item.stage === 'R4').observedOutcomes, []);
  assert.strictEqual(
    r4.next.stageState.transitions.length,
    r4.previous.stageState.transitions.length,
    '历史 transition ledger 必须保留'
  );
});

const r4Seed = planning.buildRuntimePlanningContextSeed({
  previousSession: r4.previous,
  nextSession: r4.next,
  plan,
  declarations: declarations()
});

check('target=R4 只承接模型 R1/R3，旧 R4 Plan 必须失效', () => {
  assert.deepStrictEqual(r4Seed.carriedStages, ['R1', 'R3']);
  assert.deepStrictEqual(r4Seed.invalidatedStages, ['R4']);
  assert(r4Seed.declarations.brief);
  assert(r4Seed.declarations.strategy);
  assert.strictEqual(r4Seed.declarations.actionPlan, undefined);
  assert.strictEqual(r4Seed.boundaries.schedulerAuthority, false);
});

const e1 = createReflexionGeneration('e1', 'E1');
const e1Seed = planning.buildRuntimePlanningContextSeed({
  previousSession: e1.previous,
  nextSession: e1.next,
  plan,
  declarations: declarations()
});

check('target=E1 承接 R1/R3/R4，但 Plan 仍保持 shadowOnly', () => {
  assert.deepStrictEqual(e1Seed.carriedStages, ['R1', 'R3', 'R4']);
  assert.deepStrictEqual(e1Seed.invalidatedStages, []);
  assert.strictEqual(e1Seed.declarations.actionPlan.boundaries.shadowOnly, true);
  assert.strictEqual(e1Seed.declarations.actionPlan.boundaries.executable, false);
  assert.strictEqual(e1Seed.declarations.actionPlan.boundaries.schedulerAuthority, false);
});

check('伪造 target run 或承接被失效声明会被 validator 拒绝', () => {
  const tampered = {
    ...r4Seed,
    targetRunId: 'run-tampered',
    declarations: {
      ...r4Seed.declarations,
      actionPlan: declarations().actionPlan
    }
  };
  const validation = planning.validateRuntimePlanningContextSeed({ seed: tampered, session: r4.next, plan });
  assert.strictEqual(validation.ok, false);
  assert(validation.issues.includes('runtime_planning_context_target_run_mismatch'));
  assert(validation.issues.includes('runtime_planning_context_invalidated_declaration_present:R4'));
});

check('缺失目标之前的必需模型声明时 fail closed，不补造内容', () => {
  assert.throws(() => planning.buildRuntimePlanningContextSeed({
    previousSession: r4.previous,
    nextSession: r4.next,
    plan,
    declarations: { brief: declarations().brief }
  }), /runtime_planning_context_source_declaration_invalid:R3/);
});

check('Seed digest 只保留身份、阶段和承接矩阵，不包含完整声明', () => {
  const digest = planning.buildRuntimePlanningContextSeedDigest(r4Seed);
  assert.strictEqual(digest.version, 'runtime-planning-context-seed-digest/v0');
  assert.deepStrictEqual(digest.carriedStages, ['R1', 'R3']);
  assert.strictEqual('declarations' in digest, false);
  assert.strictEqual(digest.boundaries.digestOnly, true);
});

const editModeReflexion = createEditModeReflexionGeneration();

check('expectedWorkMode=edit_existing 时拒绝承接 create_new Brief', () => {
  assert.throws(() => planning.buildRuntimePlanningContextSeed({
    previousSession: editModeReflexion.previous,
    nextSession: editModeReflexion.next,
    plan: detailEditPlan,
    declarations: { brief: editModeBrief('create_new') }
  }), /runtime_planning_context_work_mode_mismatch/);
});

const editModeSeed = planning.buildRuntimePlanningContextSeed({
  previousSession: editModeReflexion.previous,
  nextSession: editModeReflexion.next,
  plan: detailEditPlan,
  declarations: { brief: editModeBrief('edit_existing') }
});

check('与 expectedWorkMode 一致的 Brief 可以跨 Reflexion generation 承接', () => {
  assert.strictEqual(editModeSeed.declarations.brief.payload.workMode, 'edit_existing');
  assert.strictEqual(
    planning.validateRuntimePlanningContextSeed({
      seed: editModeSeed,
      session: editModeReflexion.next,
      plan: detailEditPlan
    }).ok,
    true
  );
});

check('恢复前 validator 对被篡改的跨模式 Brief fail closed', () => {
  const tampered = {
    ...editModeSeed,
    declarations: {
      ...editModeSeed.declarations,
      brief: editModeBrief('create_new')
    }
  };
  const validation = planning.validateRuntimePlanningContextSeed({
    seed: tampered,
    session: editModeReflexion.next,
    plan: detailEditPlan
  });
  assert.strictEqual(validation.ok, false);
  assert(validation.issues.includes('runtime_planning_context_work_mode_mismatch'));
});

async function runAgentSeedIntegration() {
  let modelCallCount = 0;
  let systemPrompt = '';
  const agent = new Agent(
    {
      systemPrompt: 'Runtime planning context integration smoke.',
      tools: [],
      modelId: 'fixture-model',
      maxIterations: 1,
      runtimeStagePlan: plan,
      runtimeSessionIdentity: r4.next.identity,
      runtimeSessionSeed: r4.next,
      runtimePlanningContextSeed: r4Seed,
      reflexionHandoff: r4.reflexionHandoff,
      callbacks: {}
    },
    async (_modelId, messages) => {
      modelCallCount += 1;
      systemPrompt = String(messages[0]?.content || '');
      return { content: '已收到上游声明，将从 R4 重新规划。', toolCalls: [] };
    },
    async () => ({ success: false, error: 'unexpected external tool' })
  );
  const result = await agent.run('根据质量反馈重新规划。');
  return { result, modelCallCount, systemPrompt };
}

async function runMissingSeedFailure() {
  let modelCallCount = 0;
  const agent = new Agent(
    {
      systemPrompt: 'Missing seed fail-closed smoke.',
      tools: [],
      modelId: 'fixture-model',
      maxIterations: 1,
      runtimeStagePlan: plan,
      runtimeSessionIdentity: r4.next.identity,
      runtimeSessionSeed: r4.next,
      callbacks: {}
    },
    async () => {
      modelCallCount += 1;
      return { content: '不应执行', toolCalls: [] };
    },
    async () => ({ success: false, error: 'unexpected external tool' })
  );
  await assert.rejects(() => agent.run('不能在语义上下文缺失时继续。'), /runtime_planning_context_seed_required/);
  return modelCallCount;
}

async function runE1SkillRuntimeContextHandoff() {
  let capturedContext;
  const agent = new Agent(
    {
      systemPrompt: 'E1 Skill runtime context handoff smoke.',
      tools: [{
        name: 'main-image-design',
        description: 'fixture workflow bridge',
        inputSchema: { type: 'object', properties: {} }
      }],
      modelId: 'fixture-model',
      maxIterations: 1,
      runtimeStagePlan: plan,
      runtimeSessionIdentity: e1.next.identity,
      runtimeSessionSeed: e1.next,
      runtimePlanningContextSeed: e1Seed,
      callbacks: {}
    },
    async () => ({ content: 'unused', toolCalls: [] }),
    async (_name, _args, runtimeContext) => {
      capturedContext = runtimeContext;
      return { success: true, data: { version: 'fixture-skill-result/v0' } };
    }
  );
  agent.runtimeSession = e1.next;
  agent.restoreRuntimePlanningContextSeed();
  const result = await agent.executeToolWithFailureBreaker('main-image-design', {});
  return { capturedContext, result };
}

Promise.all([
  runAgentSeedIntegration(),
  runMissingSeedFailure(),
  runE1SkillRuntimeContextHandoff()
]).then(([integration, missingSeedModelCalls, skillHandoff]) => {
  check('下一代 Agent 在模型调用前恢复 R1/R3，并明确要求重新声明 R4', () => {
    assert.strictEqual(integration.modelCallCount, 1);
    assert(integration.systemPrompt.includes('Carried model declarations: R1, R3'));
    assert(integration.systemPrompt.includes('Invalidated declarations: R4'));
    assert(integration.systemPrompt.includes('Carried Brief goal'));
    assert(integration.systemPrompt.includes('Carried Strategy stage goal'));
    assert(!integration.systemPrompt.includes('Carried shadow Plan goal'));
    assert(integration.result.data.runtimeDesignBriefDeclaration);
    assert(integration.result.data.runtimeDesignStrategyDeclaration);
    assert.strictEqual(integration.result.data.runtimeActionPlanDeclaration, undefined);
    assert.strictEqual(
      integration.result.executionSummary.runtimePlanningContextSeedDigest.targetRunId,
      r4.next.identity.runId
    );
  });

  check('generation>1 缺 Planning Seed 时在模型调用前停止', () => {
    assert.strictEqual(missingSeedModelCalls, 0);
  });

  check('Run Record 只持久化 Planning Seed digest 并绑定同一 Session identity', () => {
    const record = buildAgentRunRecord({
      now: '2026-07-13T07:02:00.000Z',
      goal: '根据质量反馈重新规划。',
      runtimeSessionIdentity: r4.next.identity,
      result: integration.result
    });
    assert.strictEqual(record.planningContextCarry.targetRunId, record.runId);
    assert.strictEqual(record.planningContextCarry.sessionId, record.runtimeSession.sessionId);
    assert.strictEqual(record.boundaries.planningContextCarryDigestOnly, true);
    assert.strictEqual('declarations' in record.planningContextCarry, false);
    assert.strictEqual(validateAgentRunRecordForPersist(record).ok, true);
  });

  check('生产 Skill bridge 下传 R3/R4 只读上下文，不改变 Plan shadow 边界', () => {
    const agentSource = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'services', 'agent-runtime', 'agent.ts'), 'utf8');
    const skillToolsSource = fs.readFileSync(path.join(
      ROOT,
      'src',
      'renderer',
      'services',
      'skill-executors',
      'skill-tools.ts'
    ), 'utf8');
    assert(agentSource.includes('runtimeDesignStrategyDeclaration: this.runtimeDesignStrategyDeclaration'));
    assert(agentSource.includes('runtimeActionPlanDeclaration: this.runtimeActionPlanDeclaration'));
    assert(skillToolsSource.includes('runtimeDesignStrategyDeclaration: options.runtimeDesignStrategyDeclaration'));
    assert(skillToolsSource.includes('runtimeActionPlanDeclaration: options.runtimeActionPlanDeclaration'));
    assert(skillToolsSource.includes('runtimeActionPlanDigest: options.runtimeActionPlanDigest'));
    assert.strictEqual(skillHandoff.result.success, true);
    assert.strictEqual(skillHandoff.capturedContext.runtimeDesignBriefDeclaration.readiness, 'ready');
    assert.strictEqual(skillHandoff.capturedContext.runtimeDesignStrategyDeclaration.readiness, 'ready');
    assert.strictEqual(skillHandoff.capturedContext.runtimeDesignStrategyDigest.version, 'runtime-design-strategy-digest/v0');
    assert.strictEqual(skillHandoff.capturedContext.runtimeActionPlanDeclaration.readiness, 'ready');
    assert.strictEqual(skillHandoff.capturedContext.runtimeActionPlanDeclaration.boundaries.shadowOnly, true);
    assert.strictEqual(skillHandoff.capturedContext.runtimeActionPlanDeclaration.boundaries.schedulerAuthority, false);
    assert.strictEqual(skillHandoff.capturedContext.runtimeActionPlanDigest.version, 'runtime-action-plan-digest/v0');
  });

  console.log(`\n✅ runtime-planning-context smoke 全部通过（${passed} 项）`);
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
