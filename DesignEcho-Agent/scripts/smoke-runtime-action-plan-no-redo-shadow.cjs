'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '..', 'tsconfig.main.json')
});

const root = path.resolve(__dirname, '..');
const { createRuntimeSessionIdentityForPlan } = require('./runtime-session-smoke-fixture.cjs');
const {
  CURRENT_R3_STRATEGY_REF,
  DECLARE_RUNTIME_ACTION_PLAN_TOOL_NAME,
  buildDeclareRuntimeActionPlanToolSchema,
  buildRuntimeActionPlanDigest,
  validateRuntimeActionPlanDeclaration
} = require(path.join(root, 'src', 'shared', 'agent-runtime-v5', 'runtime-action-plan-declaration.ts'));
const {
  appendRuntimeActionPlanExecutionObservation,
  createRuntimeActionPlanExecutionJournal
} = require(path.join(root, 'src', 'shared', 'agent-runtime-v5', 'runtime-action-plan-observation.ts'));
const {
  reconcileRuntimeActionPlanExecution
} = require(path.join(root, 'src', 'shared', 'agent-runtime-v5', 'runtime-action-plan-reconciliation.ts'));
const {
  buildRuntimeActionPlanNoRedoShadowDecision,
  buildRuntimeActionPlanNoRedoShadowDigest
} = require(path.join(root, 'src', 'shared', 'agent-runtime-v5', 'runtime-action-plan-no-redo-shadow.ts'));
const {
  buildRuntimeResumeContextAnchor,
  evaluateRuntimeActionPlanResumeFreshness
} = require(path.join(root, 'src', 'shared', 'agent-runtime-v5', 'runtime-action-plan-resume-freshness.ts'));
const {
  DECLARE_DESIGN_BRIEF_TOOL_NAME
} = require(path.join(root, 'src', 'shared', 'agent-runtime-v5', 'runtime-design-brief-declaration.ts'));
const {
  DECLARE_DESIGN_STRATEGY_TOOL_NAME,
  buildRuntimeDesignStrategyDigest,
  validateRuntimeDesignStrategyDeclaration
} = require(path.join(root, 'src', 'shared', 'agent-runtime-v5', 'runtime-design-strategy-declaration.ts'));
const { buildRuntimeStagePlan } = require(path.join(root, 'src', 'shared', 'agent-runtime-v5', 'runtime-stage-plan.ts'));
const { GENERAL_DESIGN_MANIFEST } = require(path.join(root, 'src', 'shared', 'agent-runtime-v5', 'manifests', 'general-design.manifest.ts'));
const {
  createAgentCapabilitySession
} = require(path.join(root, 'src', 'renderer', 'services', 'agent-runtime', 'capability-session.ts'));
const { Agent } = require(path.join(root, 'src', 'renderer', 'services', 'agent-runtime', 'agent.ts'));
const {
  buildAgentIntentControlPlaneDecision
} = require(path.join(root, 'src', 'shared', 'agent-intent-control-plane.ts'));
const {
  buildAgentRunRecord,
  validateAgentRunRecordForPersist
} = require(path.join(root, 'src', 'shared', 'agent-run-record.ts'));

const allowedContextRefs = [
  'context:user_goal',
  'context:skill_manifest',
  'context:opening_observation',
  'context:readback',
  'context:design_brief',
  'context:design_strategy'
];
const capabilityContext = {
  discoveredCapabilityRefs: ['photoshop.write.setLayerOpacity', 'photoshop.read.getDocumentSummary'],
  activeActionCapabilityRefs: ['photoshop.write.setLayerOpacity', 'photoshop.read.getDocumentSummary'],
  onDemandActionCapabilityRefs: []
};

function hierarchyResult() {
  return {
    success: true,
    totalLayers: 1,
    flatList: [{
      id: 7,
      kind: 'pixel',
      visible: true,
      locked: false,
      opacity: 80,
      blendMode: 'normal',
      parentId: 0,
      index: 0,
      depth: 0
    }]
  };
}

const anchor = buildRuntimeResumeContextAnchor({
  toolCallLog: [{
    name: 'getLayerHierarchy',
    arguments: { includeHidden: true, flatList: true },
    result: hierarchyResult()
  }]
});
const freshness = evaluateRuntimeActionPlanResumeFreshness({
  sourceRunId: 'run-prior',
  previousAnchor: anchor,
  currentAnchor: anchor,
  completedStepIds: ['prior-completed'],
  completedStepDescriptors: [{
    stepId: 'prior-completed',
    kind: 'mutate',
    capabilityRefs: ['photoshop.write.setLayerOpacity'],
    observedOutcomes: ['document_change']
  }],
  resumeStepIds: ['prior-pending'],
  probeSucceeded: true
});
assert.strictEqual(freshness.status, 'verified');
assert.deepStrictEqual(freshness.verifiedCompletedStepIds, ['prior-completed']);
assert.deepStrictEqual(freshness.verifiedCompletedSteps, [{
  stepId: 'prior-completed',
  kind: 'mutate',
  capabilityRefs: ['photoshop.write.setLayerOpacity'],
  observedOutcomes: ['document_change']
}]);
assert.deepStrictEqual(freshness.verifiedResumeStepIds, ['prior-pending']);

function strategyArguments() {
  return {
    stageGoal: '基于当前事实形成最小且可复核的调整策略。',
    objective: {
      primaryGoal: '建立清晰层级。',
      secondaryGoals: ['保持真实素材质感'],
      targetAudienceSummary: '需要快速理解核心信息的用户。'
    },
    messageArchitecture: {
      primaryMessage: '核心价值先被看到。',
      supportingMessages: [],
      supportingFacts: ['当前结构已读取。'],
      objectionsToResolve: ['层级是否清晰']
    },
    copyDirection: {
      toneKeywords: ['清晰'],
      headlineOptions: ['聚焦核心'],
      subtitleOptions: [],
      tagOptions: [],
      prohibitedClaims: ['无依据承诺']
    },
    visualDirection: {
      moodKeywords: ['克制'],
      paletteIntent: ['强调色只服务焦点。'],
      typographyIntent: ['标题与说明形成层级。'],
      compositionIntent: ['主体承担主要重量。'],
      imageTreatment: ['保留真实纹理。'],
      density: 'medium'
    },
    constraints: ['不改变素材事实。'],
    contextRefs: ['context:design_brief', 'context:readback'],
    assumptions: [],
    missingInputs: []
  };
}

function briefArguments() {
  return {
    taskGoal: '基于当前文档继续设计，并显式核对旧节点后执行本轮计划。',
    deliverables: ['可编辑设计文档', '本轮执行记录'],
    outputRequirements: ['写入后必须读取结果'],
    constraints: ['不把旧节点复用推断成当前已完成'],
    inputCoverage: [{
      inputKey: 'goal',
      status: 'provided',
      contextRefs: ['input:goal:user_goal']
    }],
    contextRefs: ['context:user_goal', 'context:skill_manifest', 'input:goal:user_goal']
  };
}

function strategyDigest() {
  const validation = validateRuntimeDesignStrategyDeclaration({
    value: strategyArguments(),
    allowedContextRefs
  });
  assert.strictEqual(validation.ok, true, JSON.stringify(validation.issues));
  return buildRuntimeDesignStrategyDigest(validation.declaration);
}

function planArguments(policy = 'reuse_completed_step', priorStepId = 'prior-completed') {
  return {
    planGoal: '依据当前目标判断是否复用已核实旧步骤，并保持真实执行可审计。',
    strategyRef: CURRENT_R3_STRATEGY_REF,
    contextRefs: ['context:user_goal', 'context:readback', 'context:design_strategy'],
    steps: [{
      stepId: 'apply-change',
      kind: 'mutate',
      goal: '实施当前目标要求的画面调整。',
      dependsOn: [],
      capabilityRefs: ['photoshop.write.setLayerOpacity'],
      inputContextRefs: ['context:design_strategy', 'context:readback'],
      expectedOutcomes: ['document_change'],
      completionCriteria: ['产生当前目标要求的文档变化。'],
      failurePolicy: 'retry_after_observation',
      resumeMapping: { priorStepId, policy }
    }],
    missingInputs: []
  };
}

function validatePlan(value, resumeFreshness = freshness) {
  return validateRuntimeActionPlanDeclaration({
    value,
    strategyDigest: strategyDigest(),
    allowedContextRefs,
    capabilityContext,
    resumeFreshness
  });
}

const reuseValidation = validatePlan(planArguments());
assert.strictEqual(reuseValidation.ok, true, JSON.stringify(reuseValidation.issues));
assert.strictEqual(reuseValidation.declaration.payload.steps[0].resumeMapping.policy, 'reuse_completed_step');
const reusePlanDigest = buildRuntimeActionPlanDigest({
  declaration: reuseValidation.declaration,
  strategyDigest: strategyDigest()
});
assert.strictEqual(reusePlanDigest.resumeReuseCount, 1);
assert.strictEqual(reusePlanDigest.resumeRedoRequiredCount, 0);

const schemaWithCompleted = buildDeclareRuntimeActionPlanToolSchema({
  allowedContextRefs,
  discoveredCapabilityRefs: capabilityContext.discoveredCapabilityRefs,
  verifiedCompletedStepIds: freshness.verifiedCompletedStepIds
});
assert.deepStrictEqual(
  schemaWithCompleted.inputSchema.properties.steps.items.properties.resumeMapping.properties.priorStepId.enum,
  ['prior-completed']
);
const schemaWithoutCompleted = buildDeclareRuntimeActionPlanToolSchema({
  allowedContextRefs,
  discoveredCapabilityRefs: capabilityContext.discoveredCapabilityRefs
});
assert.strictEqual(
  schemaWithoutCompleted.inputSchema.properties.steps.items.properties.resumeMapping,
  undefined
);

const pendingValidation = validatePlan(planArguments('reuse_completed_step', 'prior-pending'));
assert.strictEqual(pendingValidation.ok, false);
assert(pendingValidation.issues.some((issue) => issue.code === 'resume_mapping_prior_step_pending'));

const unverifiedFreshness = {
  ...freshness,
  status: 'mismatch',
  verifiedCompletedStepIds: [],
  invalidatedCompletedStepIds: ['prior-completed'],
  verifiedCompletedSteps: [],
  invalidatedCompletedSteps: freshness.verifiedCompletedSteps,
  verifiedResumeStepIds: [],
  invalidatedResumeStepIds: ['prior-pending']
};
const unverifiedValidation = validatePlan(planArguments(), unverifiedFreshness);
assert.strictEqual(unverifiedValidation.ok, false);
assert(unverifiedValidation.issues.some((issue) => issue.code === 'resume_mapping_freshness_not_verified'));

const duplicatePlan = planArguments();
duplicatePlan.steps.push({
  ...duplicatePlan.steps[0],
  stepId: 'apply-change-again'
});
const duplicateValidation = validatePlan(duplicatePlan);
assert.strictEqual(duplicateValidation.ok, false);
assert(duplicateValidation.issues.some((issue) => issue.code === 'resume_mapping_prior_step_duplicate'));

const noMappingPlan = planArguments();
delete noMappingPlan.steps[0].resumeMapping;
const noMappingValidation = validatePlan(noMappingPlan);
assert.strictEqual(noMappingValidation.ok, true, JSON.stringify(noMappingValidation.issues));
const notApplicable = buildRuntimeActionPlanNoRedoShadowDecision({
  freshness,
  declaration: noMappingValidation.declaration
});
assert.strictEqual(notApplicable.status, 'not_applicable');

const observing = buildRuntimeActionPlanNoRedoShadowDecision({
  freshness,
  declaration: reuseValidation.declaration
});
assert.strictEqual(observing.status, 'observing');
assert.deepStrictEqual(observing.reuseCandidateStepIds, ['apply-change']);
assert.deepStrictEqual(observing.repeatObservedStepIds, []);

let journal = createRuntimeActionPlanExecutionJournal();
journal = appendRuntimeActionPlanExecutionObservation({
  journal,
  observation: {
    capabilityRefs: ['photoshop.write.setLayerOpacity'],
    toolKind: 'photoshop_write',
    outcome: 'succeeded',
    iteration: 1
  }
});
const reuseReconciliation = reconcileRuntimeActionPlanExecution({
  declaration: reuseValidation.declaration,
  journal
});
const repeated = buildRuntimeActionPlanNoRedoShadowDecision({
  freshness,
  declaration: reuseValidation.declaration,
  reconciliation: reuseReconciliation
});
assert.strictEqual(repeated.status, 'repeat_observed');
assert.deepStrictEqual(repeated.repeatObservedStepIds, ['apply-change']);
assert.strictEqual(repeated.boundaries.blocksTools, false);
assert.strictEqual(repeated.boundaries.skipsTools, false);
assert.strictEqual(repeated.boundaries.schedulerAuthority, false);

const redoValidation = validatePlan(planArguments('redo_required'));
assert.strictEqual(redoValidation.ok, true, JSON.stringify(redoValidation.issues));
const redoReconciliation = reconcileRuntimeActionPlanExecution({
  declaration: redoValidation.declaration,
  journal
});
const intentionalRedo = buildRuntimeActionPlanNoRedoShadowDecision({
  freshness,
  declaration: redoValidation.declaration,
  reconciliation: redoReconciliation
});
assert.strictEqual(intentionalRedo.status, 'no_repeat_observed');
assert.deepStrictEqual(intentionalRedo.repeatObservedStepIds, []);
assert.deepStrictEqual(intentionalRedo.intentionalRedoObservedStepIds, ['apply-change']);

const resetReconciliation = reconcileRuntimeActionPlanExecution({
  declaration: noMappingValidation.declaration,
  journal: createRuntimeActionPlanExecutionJournal()
});
const generationReset = buildRuntimeActionPlanNoRedoShadowDecision({
  freshness,
  declaration: noMappingValidation.declaration,
  reconciliation: resetReconciliation
});
assert.strictEqual(generationReset.status, 'not_applicable');
assert.deepStrictEqual(generationReset.reuseCandidateStepIds, []);
assert.deepStrictEqual(generationReset.repeatObservedStepIds, []);

const repeatedDigest = buildRuntimeActionPlanNoRedoShadowDigest(repeated);
assert.strictEqual(repeatedDigest.version, 'runtime-action-plan-no-redo-shadow-digest/v0');
assert.strictEqual(repeatedDigest.boundaries.digestOnly, true);
assert(!Object.prototype.hasOwnProperty.call(repeatedDigest, 'mappings'));
assert(!Object.prototype.hasOwnProperty.call(repeatedDigest, 'reconciliation'));

const record = buildAgentRunRecord({
  now: '2026-07-12T02:00:00.000Z',
  goal: '继续设计任务',
  result: {
    success: false,
    iterations: 4,
    stopReason: 'max_iterations',
    toolCallLog: [],
    executionSummary: {
      status: 'failed',
      runtimeActionPlanNoRedoShadowDigest: repeatedDigest
    }
  }
});
assert.strictEqual(record.actionPlanNoRedoShadow.status, 'repeat_observed');
assert.strictEqual(record.boundaries.actionPlanNoRedoShadowDigestOnly, true);
assert.strictEqual(validateAgentRunRecordForPersist(record).ok, true);
const poisonedRecord = JSON.parse(JSON.stringify(record));
poisonedRecord.actionPlanNoRedoShadow.mappings = [{ priorStepId: 'prior-completed' }];
assert.strictEqual(validateAgentRunRecordForPersist(poisonedRecord).ok, false);

const candidateTools = [
  { name: 'getDocumentInfo', description: 'Read document.', inputSchema: { type: 'object', properties: {} } },
  { name: 'setLayerOpacity', description: 'Change opacity.', inputSchema: { type: 'object', properties: { opacity: { type: 'number' } }, required: ['opacity'] } }
];

async function runAgentIntegration() {
  const task = '继续当前设计，显式核对旧节点后执行本轮计划';
  const capabilitySession = createAgentCapabilitySession({
    candidateTools,
    requestedTaskType: GENERAL_DESIGN_MANIFEST.task_type,
    manifest: GENERAL_DESIGN_MANIFEST
  });
  capabilitySession.requestCapabilities(['photoshop.write.setLayerOpacity']);
  const externalCalls = [];
  let modelCallCount = 0;
  const stagePlan = buildRuntimeStagePlan(GENERAL_DESIGN_MANIFEST);
  const agent = new Agent(
    {
      systemPrompt: 'No-redo shadow integration smoke.',
      tools: capabilitySession.activeTools,
      modelId: 'test-model',
      maxIterations: 7,
      runtimeStagePlan: stagePlan,
      runtimeSessionIdentity: createRuntimeSessionIdentityForPlan(stagePlan, 'no-redo'),
      runtimeActionPlanResumeFreshness: freshness,
      getCapabilityResolution: () => capabilitySession.getResolution(),
      getActiveCapabilityIdsForTool: (toolName) => capabilitySession.getActiveCapabilityIdsForTool(toolName),
      toolDecisionContext: {
        intentControlPlane: buildAgentIntentControlPlaneDecision({ userInput: task }),
        photoshopConnected: true,
        hasDocument: true
      },
      callbacks: {}
    },
    async (_modelId, _messages, tools) => {
      modelCallCount += 1;
      if (modelCallCount === 1) {
        return { content: '先读取当前文档。', toolCalls: [{ id: 'read-doc', name: 'getDocumentInfo', arguments: {} }] };
      }
      if (modelCallCount === 2) {
        return {
          content: '声明当前设计简报。',
          toolCalls: [{ id: 'brief', name: DECLARE_DESIGN_BRIEF_TOOL_NAME, arguments: briefArguments() }]
        };
      }
      if (modelCallCount === 3) {
        return {
          content: '声明当前策略。',
          toolCalls: [{ id: 'strategy', name: DECLARE_DESIGN_STRATEGY_TOOL_NAME, arguments: strategyArguments() }]
        };
      }
      if (modelCallCount === 4) {
        const planTool = tools.find((tool) => tool.name === DECLARE_RUNTIME_ACTION_PLAN_TOOL_NAME);
        assert(planTool, 'R4 declaration Tool must be visible after ready strategy');
        assert.deepStrictEqual(
          planTool.inputSchema.properties.steps.items.properties.resumeMapping.properties.priorStepId.enum,
          ['prior-completed']
        );
        return {
          content: '显式映射旧完成节点。',
          toolCalls: [{ id: 'plan', name: DECLARE_RUNTIME_ACTION_PLAN_TOOL_NAME, arguments: planArguments() }]
        };
      }
      if (modelCallCount === 5) {
        return {
          content: '执行当前模型计划。',
          toolCalls: [{ id: 'write', name: 'setLayerOpacity', arguments: { layerId: 7, opacity: 80 } }]
        };
      }
      return { content: '影子证据已记录，质量仍由独立评价决定。', toolCalls: [] };
    },
    async (toolName) => {
      externalCalls.push(toolName);
      if (toolName === 'getAnnotatedSnapshot') return { success: true, elements: [{ id: 7 }] };
      if (toolName === 'getDocumentInfo') {
        return {
          success: true,
          observedAt: '2026-07-16T00:00:00.000Z',
          documentState: 'present',
          document: { id: 1, name: 'runtime-no-redo.psd', activeLayerId: 7, activeLayerName: '目标图层' }
        };
      }
      if (toolName === 'setLayerOpacity') return { success: true };
      throw new Error(`Unexpected Tool: ${toolName}`);
    }
  );
  const result = await agent.run(task);
  const decision = result.data.runtimeActionPlanNoRedoShadow;
  const digest = result.executionSummary.runtimeActionPlanNoRedoShadowDigest;
  assert(decision, JSON.stringify(result.data, null, 2));
  assert(digest, JSON.stringify(result.executionSummary, null, 2));
  assert.strictEqual(decision.status, 'repeat_observed');
  assert.deepStrictEqual(decision.repeatObservedStepIds, ['apply-change']);
  assert.deepStrictEqual(digest.repeatObservedStepIds, ['apply-change']);
  assert(externalCalls.includes('setLayerOpacity'), 'shadow decision must not block the real write Tool');
  assert.notStrictEqual(result.executionSummary.designVerdict?.status, 'passed');
  return {
    modelCallCount,
    externalCalls,
    decisionStatus: decision.status,
    repeatObservedStepIds: decision.repeatObservedStepIds,
    executionStatus: result.executionSummary.status
  };
}

const shadowSource = fs.readFileSync(
  path.join(root, 'src', 'shared', 'agent-runtime-v5', 'runtime-action-plan-no-redo-shadow.ts'),
  'utf8'
);
assert(!/taskText|detailPage|mainImage|sku/i.test(shadowSource));
assert(!/详情页|主图|SKU/.test(shadowSource));
assert(!shadowSource.includes('executeTool('));
assert(!shadowSource.includes('toolName'));

runAgentIntegration()
  .then((agentIntegration) => {
    console.log(JSON.stringify({
      success: true,
      freshness: {
        completed: freshness.verifiedCompletedStepIds,
        resume: freshness.verifiedResumeStepIds
      },
      validation: {
        pendingRejected: pendingValidation.issues.map((issue) => issue.code),
        unverifiedRejected: unverifiedValidation.issues.map((issue) => issue.code),
        duplicateRejected: duplicateValidation.issues.map((issue) => issue.code)
      },
      decisions: {
        observing: observing.status,
        repeated: repeated.status,
        intentionalRedo: intentionalRedo.status,
        generationReset: generationReset.status
      },
      persistence: {
        digestOnly: record.boundaries.actionPlanNoRedoShadowDigestOnly,
        poisonRejected: validateAgentRunRecordForPersist(poisonedRecord).ok === false
      },
      agentIntegration,
      boundary: 'model-explicit mapping and shadow observation only; no Tool block, skip, retry, scheduling, permission, progress or quality authority'
    }, null, 2));
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
