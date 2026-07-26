#!/usr/bin/env node
'use strict';

const assert = require('assert');
const path = require('path');

require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '..', 'tsconfig.main.json')
});

const ROOT = path.resolve(__dirname, '..');
const {
  attachArtifactRepositoryProjectionToRuntimeTaskSnapshot,
  buildRuntimeTaskSnapshot,
  readRuntimeTaskSnapshot
} = require(path.join(ROOT, 'src', 'shared', 'agent-runtime-v5', 'runtime-task-snapshot.ts'));
const {
  computeFastFingerprint
} = require(path.join(ROOT, 'src', 'shared', 'agent-runtime-v5', 'content-hash.ts'));
const {
  buildRuntimeActionPlanDeclarationFingerprint
} = require(path.join(
  ROOT,
  'src',
  'shared',
  'agent-runtime-v5',
  'runtime-action-plan-reconciliation.ts'
));
const {
  buildCancelledAutonomousAgentResult
} = require(path.join(
  ROOT,
  'src',
  'renderer',
  'services',
  'skill-executors',
  'autonomous-agent-result-projection.ts'
));

function check(name, fn) {
  fn();
  console.log(`  ✓ ${name}`);
}

function createStage(stage, status, missingOutcomes = []) {
  return {
    stage,
    status,
    attempts: status === 'unobserved' ? 0 : 1,
    requiredOutcomes: [...missingOutcomes, ...(status === 'passed' ? [`${stage.toLowerCase()}_done`] : [])],
    observedOutcomes: status === 'passed' ? [`${stage.toLowerCase()}_done`] : [],
    missingOutcomes
  };
}

function createSession(taskType = 'design.generic.v1') {
  return {
    version: 'runtime-session/v0',
    identity: {
      version: 'runtime-session-identity/v0',
      sessionId: 'runtime-session-snapshot-1',
      runId: 'run-snapshot-1',
      generation: 2,
      parentRunId: 'run-snapshot-0',
      issuedAt: '2026-07-22T15:30:00.000Z',
      boundaries: {
        identityOnly: true,
        grantsPermission: false,
        executesTools: false,
        changesTaskResult: false,
        categoryNeutral: true
      }
    },
    planVersion: 'runtime-stage-plan/v0',
    skillId: 'autonomous-agent',
    taskType,
    stageState: {
      version: 'runtime-stage-state/v0',
      planVersion: 'runtime-stage-plan/v0',
      skillId: 'autonomous-agent',
      taskType,
      status: 'awaiting_outcomes',
      currentStage: 'E1',
      stages: [
        createStage('R0', 'passed'),
        createStage('R1', 'passed'),
        createStage('R4', 'passed'),
        createStage('E1', 'needs_review', ['readback']),
        createStage('R5', 'unobserved', ['quality_verdict']),
        createStage('E2', 'unobserved', ['delivery_record'])
      ],
      transitions: [{
        sequence: 1,
        evaluatedStage: 'R4',
        decision: 'advance',
        targetStage: 'E1',
        outcome: 'passed',
        observedOutcomes: ['action_plan'],
        missingOutcomes: []
      }],
      issues: ['stage_issue'],
      boundaries: {
        evaluationOnly: true,
        executesTools: false,
        changesTaskResult: false,
        categoryNeutral: true
      }
    },
    stageTrace: {
      version: 'runtime-stage-trace/v0',
      events: [{
        sequence: 7,
        stage: 'R4',
        source: 'action_plan_declaration',
        outcome: 'passed',
        observedOutcomes: ['action_plan']
      }]
    },
    accounting: {},
    generationStartTransitionCount: 0,
    finalized: false,
    issues: ['session_issue'],
    boundaries: {
      singleStageOwner: true,
      stageOutcomeDriven: true,
      executesTools: false,
      grantsPermission: false,
      changesTaskResult: false,
      categoryNeutral: true
    }
  };
}

function createTaskPlan() {
  return {
    version: 'agent-task-planning-contract/v0',
    designBrief: {
      goal: '修改当前画面并验证最终结果'
    }
  };
}

function createActionPlan() {
  return {
    version: 'runtime-action-plan-declaration/v0',
    source: 'model_tool_call',
    readiness: 'ready',
    payload: {
      planGoal: '这是低优先级的 R4 目标',
      steps: [
        {
          stepId: 'observe-target',
          kind: 'observe',
          goal: '读取目标',
          dependsOn: [],
          capabilityRefs: ['cap.observe'],
          inputContextRefs: [],
          expectedOutcomes: ['project_context'],
          completionCriteria: ['已读取'],
          failurePolicy: 'stop'
        },
        {
          stepId: 'mutate-target',
          kind: 'mutate',
          goal: '修改目标',
          dependsOn: ['observe-target'],
          capabilityRefs: ['cap.mutate'],
          inputContextRefs: [],
          expectedOutcomes: ['document_change'],
          completionCriteria: ['已修改'],
          failurePolicy: 'enter_reflexion'
        },
        {
          stepId: 'verify-target',
          kind: 'verify',
          goal: '读回验证目标',
          dependsOn: ['mutate-target'],
          capabilityRefs: ['cap.observe'],
          inputContextRefs: [],
          expectedOutcomes: ['readback'],
          completionCriteria: ['已读回'],
          failurePolicy: 'retry_after_observation'
        }
      ],
      contextRefs: [],
      missingInputs: []
    },
    graph: {
      acyclic: true,
      rootStepIds: ['observe-target'],
      terminalStepIds: ['verify-target'],
      parallelGroups: []
    },
    missingCapabilityRefs: [],
    boundaries: {}
  };
}

function createReconciliation() {
  return {
    version: 'runtime-action-plan-reconciliation/v0',
    declarationFingerprint: buildRuntimeActionPlanDeclarationFingerprint(createActionPlan()),
    status: 'in_progress',
    planReadiness: 'ready',
    steps: [
      {
        stepId: 'observe-target',
        kind: 'observe',
        status: 'completed',
        dependencyStepIds: [],
        attempts: 1,
        failedAttempts: 0,
        recovered: false,
        declarationOutcomeUsed: false,
        observedCapabilityRefs: ['cap.observe'],
        observedOutcomes: ['project_context'],
        missingExpectedOutcomes: []
      },
      {
        stepId: 'mutate-target',
        kind: 'mutate',
        status: 'completed',
        dependencyStepIds: ['observe-target'],
        attempts: 2,
        failedAttempts: 1,
        recovered: true,
        declarationOutcomeUsed: false,
        observedCapabilityRefs: ['cap.mutate'],
        observedOutcomes: ['document_change'],
        missingExpectedOutcomes: []
      },
      {
        stepId: 'verify-target',
        kind: 'verify',
        status: 'in_progress',
        dependencyStepIds: ['mutate-target'],
        attempts: 1,
        failedAttempts: 0,
        recovered: false,
        declarationOutcomeUsed: false,
        observedCapabilityRefs: ['cap.observe'],
        observedOutcomes: [],
        missingExpectedOutcomes: ['readback']
      }
    ],
    attributions: [],
    verificationBindings: [{
      mutationObservationSequence: 2,
      mutationStepId: 'mutate-target',
      readbackObservationSequence: 3,
      readbackStepId: 'verify-target',
      targetRef: 'photoshop-document:42'
    }],
    resumeStepIds: ['verify-target'],
    droppedObservationCount: 1,
    issues: ['reconciliation_issue'],
    metrics: {
      observationCount: 4,
      attributedObservationCount: 3,
      ambiguousObservationCount: 0,
      dependencyBlockedObservationCount: 0,
      unmatchedObservationCount: 1,
      repeatAfterCompletionCount: 0,
      completedStepCount: 2,
      failedStepCount: 0,
      recoveredStepCount: 1,
      targetBoundMutationCount: 1,
      mutationReadbackBindingCount: 1,
      unboundStateChangeCount: 0,
      unboundReadbackCount: 2
    },
    boundaries: {}
  };
}

function createVerdict() {
  return {
    version: 'design-quality-verdict/v0',
    status: 'needs_review',
    source: 'contract+scorecard',
    contractFailedRequirementIds: [],
    overallScore: 78,
    blockers: [],
    warnings: ['文字层级需人工复核'],
    summary: '产物存在，但质量仍需复核。'
  };
}

function createInput() {
  return {
    runtimeSession: createSession(),
    taskPlan: createTaskPlan(),
    runtimeActionPlan: createActionPlan(),
    runtimeActionPlanReconciliation: createReconciliation(),
    executionStatus: 'needs_review',
    designVerdict: createVerdict(),
    approvalFacts: [{
      source: 'public_plan_control',
      status: 'approved_unverified',
      scope: 'preview_only'
    }],
    repositoryPublishedArtifactRefs: [
      {
        artifactId: 'artifact-1',
        artifactType: 'design.preview',
        contentHash: `sha256:${'a'.repeat(64)}`,
        payload: 'must-not-survive'
      },
      {
        artifactId: 'invalid-path',
        artifactType: 'C:\\private\\result.psd',
        contentHash: `sha256:${'c'.repeat(64)}`
      }
    ]
  };
}

function createArtifactRepositoryProjection(overrides = {}) {
  return {
    version: 'artifact-repository-read-projection/v0',
    source: 'artifact_repository',
    scope: {
      sessionId: 'runtime-session-snapshot-1',
      runId: 'run-snapshot-1',
      generation: 2
    },
    refs: [
      {
        artifactId: 'artifact-preview-1',
        artifactType: 'preview_scene',
        contentHash: `sha256-jcs-v1:${'a'.repeat(64)}`
      },
      {
        artifactId: 'artifact-review-1',
        artifactType: 'review_report',
        contentHash: `sha256-jcs-v1:${'b'.repeat(64)}`
      }
    ],
    droppedRefCount: 0,
    issues: [{ code: 'corrupt_unrelated_record', message: 'must-not-enter-snapshot' }],
    boundaries: {
      repositoryOwned: true,
      artifactRefsOnly: true,
      payloadsExcluded: true,
      pathsExcluded: true,
      grantsPermission: false
    },
    ...overrides
  };
}

function refingerprint(snapshot) {
  const fingerprintInput = { ...snapshot };
  delete fingerprintInput.projectionFingerprint;
  return {
    ...snapshot,
    projectionFingerprint: computeFastFingerprint(fingerprintInput)
  };
}

check('snapshot is deterministic and does not mutate canonical inputs', () => {
  const input = createInput();
  const before = JSON.stringify(input);
  const first = buildRuntimeTaskSnapshot(input);
  const second = buildRuntimeTaskSnapshot(input);
  assert.deepStrictEqual(first, second);
  assert.strictEqual(JSON.stringify(input), before);
  assert.strictEqual(readRuntimeTaskSnapshot(first), first);
});

check('result boundary reader rejects malformed and owner-spoofed snapshots', () => {
  const snapshot = buildRuntimeTaskSnapshot(createInput());
  assert.strictEqual(readRuntimeTaskSnapshot({ ...snapshot, version: 'runtime-task-snapshot/fake' }), undefined);
  assert.strictEqual(readRuntimeTaskSnapshot({
    ...snapshot,
    artifactRefs: [{
      artifactId: 'caller-spoof',
      artifactType: 'preview_scene',
      contentHash: `sha256:${'f'.repeat(64)}`
    }]
  }), undefined);
  assert.strictEqual(readRuntimeTaskSnapshot({
    ...snapshot,
    approval: {
      ...snapshot.approval,
      status: 'observed',
      facts: [{ source: 'approval_service' }]
    }
  }), undefined);
  for (const mutate of [
    (candidate) => { candidate.runtime.status = 'completed'; },
    (candidate) => { candidate.evaluation.status = 'passed'; },
    (candidate) => { candidate.delivery = { status: 'passed', source: 'none' }; },
    (candidate) => { candidate.outcome.status = 'completed'; },
    (candidate) => { candidate.boundaries.changesTaskResult = true; },
    (candidate) => { candidate.unexpectedAuthority = { completed: true }; }
  ]) {
    const candidate = JSON.parse(JSON.stringify(snapshot));
    mutate(candidate);
    assert.strictEqual(readRuntimeTaskSnapshot(candidate), undefined);
  }
});

check('identity, goal and runtime obligations come only from canonical owners', () => {
  const snapshot = buildRuntimeTaskSnapshot(createInput());
  assert.deepStrictEqual(snapshot.identity, {
    sessionId: 'runtime-session-snapshot-1',
    runId: 'run-snapshot-1',
    generation: 2,
    parentRunId: 'run-snapshot-0',
    issuedAt: '2026-07-22T15:30:00.000Z',
    skillId: 'autonomous-agent',
    taskType: 'design.generic.v1',
    planVersion: 'runtime-stage-plan/v0',
    finalized: false
  });
  assert.deepStrictEqual(snapshot.goal, {
    text: '修改当前画面并验证最终结果',
    source: 'request_task_plan'
  });
  assert(snapshot.runtime.openObligations.some((item) => (
    item.obligationId === 'runtime-stage:E1'
      && item.status === 'needs_review'
      && item.missingOutcomes.includes('readback')
  )));
  assert(snapshot.runtime.openObligations.some((item) => (
    item.obligationId === 'action-plan:verify-target' && item.status === 'open'
  )));
  assert(!snapshot.runtime.openObligations.some((item) => item.ownerRef === 'mutate-target'));
});

check('failed or review stages remain open even when no named outcome is missing', () => {
  const input = createInput();
  const executionStage = input.runtimeSession.stageState.stages.find((stage) => stage.stage === 'E1');
  executionStage.missingOutcomes = [];
  const snapshot = buildRuntimeTaskSnapshot(input);
  assert(snapshot.runtime.openObligations.some((item) => (
    item.obligationId === 'runtime-stage:E1'
      && item.status === 'needs_review'
      && item.missingOutcomes.length === 0
  )));
});

check('R4 reconciliation remains observation-only and keeps recovery plus readback bindings', () => {
  const snapshot = buildRuntimeTaskSnapshot(createInput());
  assert.strictEqual(snapshot.actionPlan.presentationRevision, 7);
  assert(snapshot.actionPlan.presentationRevisionHash.startsWith('r4-'));
  assert.deepStrictEqual(snapshot.actionPlan.steps.map((step) => step.status), [
    'completed',
    'completed',
    'in_progress'
  ]);
  assert.strictEqual(snapshot.actionPlan.steps[1].attempts, 2);
  assert.strictEqual(snapshot.actionPlan.steps[1].failedAttempts, 1);
  assert.strictEqual(snapshot.actionPlan.steps[1].recovered, true);
  assert.deepStrictEqual(snapshot.recovery.recoveredStepIds, ['mutate-target']);
  assert.deepStrictEqual(snapshot.recovery.resumeStepIds, ['verify-target']);
  assert.strictEqual(snapshot.execution.targetBoundMutationCount, 1);
  assert.strictEqual(snapshot.execution.mutationReadbackBindingCount, 1);
  assert.strictEqual(snapshot.execution.unboundReadbackCount, 2);
  assert.deepStrictEqual(snapshot.execution.mutationReadbackBindings, [{
    mutationObservationSequence: 2,
    mutationStepId: 'mutate-target',
    readbackObservationSequence: 3,
    readbackStepId: 'verify-target',
    targetRef: 'photoshop-document:42'
  }]);
});

check('declaration without reconciliation never invents completed action steps', () => {
  const input = createInput();
  delete input.runtimeActionPlanReconciliation;
  const snapshot = buildRuntimeTaskSnapshot(input);
  assert(snapshot.actionPlan.steps.every((step) => step.status === 'not_observed'));
  assert.strictEqual(snapshot.actionPlan.reconciliationStatus, 'not_observed');
  assert.strictEqual(snapshot.execution, undefined);
});

check('reconciliation that disagrees with its declaration is rejected as a whole', () => {
  const input = createInput();
  input.runtimeActionPlanReconciliation.steps[1].kind = 'verify';
  input.runtimeActionPlanReconciliation.issues = ['must-not-leak-from-incompatible-reconciliation'];
  const snapshot = buildRuntimeTaskSnapshot(input);
  assert(snapshot.actionPlan.steps.every((step) => step.status === 'not_observed'));
  assert.strictEqual(snapshot.actionPlan.reconciliationStatus, 'not_observed');
  assert.strictEqual(snapshot.execution, undefined);
  assert.deepStrictEqual(snapshot.recovery, {
    failedStepIds: [],
    recoveredStepIds: [],
    resumeStepIds: []
  });
  assert(!snapshot.sources.runtimeActionPlanReconciliation);
  assert(!JSON.stringify(snapshot).includes('must-not-leak-from-incompatible-reconciliation'));
});

check('reconciliation fingerprint rejects a stale plan with reused step ids and kinds', () => {
  const input = createInput();
  input.runtimeActionPlan.payload.planGoal = '这是复用了节点 ID 的新计划';
  input.runtimeActionPlan.payload.steps[1].goal = '生成另一种类型的资产';
  input.runtimeActionPlan.payload.steps[1].expectedOutcomes = ['generated_asset'];
  const snapshot = buildRuntimeTaskSnapshot(input);
  assert(snapshot.actionPlan.steps.every((step) => step.status === 'not_observed'));
  assert.strictEqual(snapshot.execution, undefined);
  assert.deepStrictEqual(snapshot.recovery.recoveredStepIds, []);
  assert(!snapshot.sources.runtimeActionPlanReconciliation);
});

check('evaluation and final outcome are copied without recomputing a second verdict', () => {
  const snapshot = buildRuntimeTaskSnapshot(createInput());
  assert.strictEqual(snapshot.outcome.status, 'needs_review');
  assert.strictEqual(snapshot.evaluation.status, 'needs_review');
  assert.strictEqual(snapshot.evaluation.source, 'contract+scorecard');
  assert.strictEqual(snapshot.evaluation.overallScore, 78);

  const input = createInput();
  delete input.designVerdict;
  delete input.executionStatus;
  const unobserved = buildRuntimeTaskSnapshot(input);
  assert.strictEqual(unobserved.outcome, undefined);
  assert.deepStrictEqual(unobserved.evaluation, {
    status: 'not_observed',
    source: 'none',
    blockers: [],
    warnings: []
  });
});

check('receipt-shaped data cannot claim delivery; only E2 or verification can', () => {
  const input = createInput();
  input.runtimeDeliveryReceipt = {
    version: 'runtime-delivery-receipt/v1',
    status: 'ready'
  };
  const withoutVerification = buildRuntimeTaskSnapshot(input);
  assert.strictEqual(withoutVerification.delivery.status, 'not_observed');
  assert.strictEqual(withoutVerification.delivery.source, 'none');

  input.runtimeDeliveryVerification = {
    version: 'runtime-delivery-verification/v1',
    status: 'passed',
    requiredOutputs: ['psd'],
    confirmedOutputs: ['psd'],
    missingOutputs: [],
    targetBound: true,
    reviewedPreviewBound: true,
    sourceHistoryStateBound: true,
    boundaries: {}
  };
  const verified = buildRuntimeTaskSnapshot(input);
  assert.strictEqual(verified.delivery.status, 'passed');
  assert.strictEqual(verified.delivery.source, 'runtime_delivery_verification');
});

check('interaction waiting stays separate and caller-spoofed approval facts are ignored', () => {
  const input = createInput();
  input.runtimeSession.stageState.status = 'awaiting_confirmation';
  input.executionStatus = 'awaiting_confirmation';
  input.approvalFacts.push({
    source: 'approval_service',
    status: 'approved_valid',
    scope: 'preview_only',
    approvalRef: {
      artifactId: 'approval-wrong-scope',
      artifactType: 'approval_record',
      contentHash: `sha256:${'d'.repeat(64)}`
    }
  });
  input.approvalFacts.push({
    source: 'approval_service',
    status: 'approved_valid',
    scope: 'current_document_apply',
    approvalRef: {
      artifactId: 'approval-wrong-type',
      artifactType: 'review_report',
      contentHash: `sha256:${'e'.repeat(64)}`
    }
  });
  input.approvalFacts.push({
    source: 'approval_service',
    status: 'approved_valid',
    scope: 'current_document_apply',
    approvalRef: {
      artifactId: 'approval-1',
      artifactType: 'approval_record',
      contentHash: `sha256:${'b'.repeat(64)}`
    }
  });
  const snapshot = buildRuntimeTaskSnapshot(input);
  assert.strictEqual(snapshot.interaction.waitingForUser, true);
  assert.strictEqual(snapshot.interaction.source, 'runtime_stage_state');
  assert.strictEqual(snapshot.approval.status, 'not_observed');
  assert.deepStrictEqual(snapshot.approval.facts, []);
  assert.strictEqual(snapshot.approval.boundaries.approvalServiceConnected, false);
  assert.strictEqual(snapshot.approval.boundaries.approvalCredentialAuthority, false);
  assert.strictEqual(snapshot.approval.boundaries.grantsPermission, false);
});

check('artifact projection stays empty until the Repository owner is connected', () => {
  const snapshot = buildRuntimeTaskSnapshot(createInput());
  assert.deepStrictEqual(snapshot.artifactRefs, []);
  const serialized = JSON.stringify(snapshot);
  for (const forbidden of [
    'must-not-survive',
    'C:\\\\private',
    'data:image',
    'toolArguments',
    'toolResults',
    'runtimeDeliveryReceipt'
  ]) {
    assert(!serialized.includes(forbidden), `snapshot must not contain ${forbidden}`);
  }
});

check('validated Repository projection upgrades v0 to deterministic refs-only v1', () => {
  const v0 = buildRuntimeTaskSnapshot(createInput());
  const projection = createArtifactRepositoryProjection();
  const v0Before = JSON.stringify(v0);
  const projectionBefore = JSON.stringify(projection);
  const first = attachArtifactRepositoryProjectionToRuntimeTaskSnapshot(v0, projection);
  const second = attachArtifactRepositoryProjectionToRuntimeTaskSnapshot(v0, projection);

  assert(first);
  assert.deepStrictEqual(first, second);
  assert.strictEqual(JSON.stringify(v0), v0Before);
  assert.strictEqual(JSON.stringify(projection), projectionBefore);
  assert.strictEqual(first.version, 'runtime-task-snapshot/v1');
  assert.notStrictEqual(first.projectionFingerprint, v0.projectionFingerprint);
  assert.strictEqual(readRuntimeTaskSnapshot(first), first);
  assert.strictEqual(first.boundaries.artifactRepositoryConnected, true);
  assert.strictEqual(
    first.sources.artifactRepository,
    'artifact-repository-read-projection/v0'
  );
  assert.deepStrictEqual(first.artifactRefs, projection.refs);
  assert(first.artifactRefs.every((ref) => (
    JSON.stringify(Object.keys(ref).sort())
      === JSON.stringify(['artifactId', 'artifactType', 'contentHash'])
  )));
  const serialized = JSON.stringify(first);
  assert(!serialized.includes('must-not-enter-snapshot'));
  assert(!serialized.includes('droppedRefCount'));
  assert(!serialized.includes('payloadsExcluded'));
});

check('Repository projection scope must exactly match runtime identity', () => {
  const v0 = buildRuntimeTaskSnapshot(createInput());
  for (const scope of [
    {
      sessionId: 'other-session',
      runId: 'run-snapshot-1',
      generation: 2
    },
    {
      sessionId: 'runtime-session-snapshot-1',
      runId: 'other-run',
      generation: 2
    },
    {
      sessionId: 'runtime-session-snapshot-1',
      runId: 'run-snapshot-1',
      generation: 3
    }
  ]) {
    assert.strictEqual(
      attachArtifactRepositoryProjectionToRuntimeTaskSnapshot(
        v0,
        createArtifactRepositoryProjection({ scope })
      ),
      undefined
    );
  }
});

check('v1 attachment rejects raw refs and non-canonical Repository projections', () => {
  const v0 = buildRuntimeTaskSnapshot(createInput());
  const projection = createArtifactRepositoryProjection();
  assert.strictEqual(
    attachArtifactRepositoryProjectionToRuntimeTaskSnapshot(v0, projection.refs),
    undefined
  );
  assert.strictEqual(
    attachArtifactRepositoryProjectionToRuntimeTaskSnapshot(v0, {
      ...projection,
      refs: [{
        ...projection.refs[0],
        payload: 'caller-owned-payload'
      }]
    }),
    undefined
  );
  assert.strictEqual(
    attachArtifactRepositoryProjectionToRuntimeTaskSnapshot(v0, {
      ...projection,
      refs: [projection.refs[0], { ...projection.refs[0] }]
    }),
    undefined
  );
});

check('unified reader keeps v1 fail-closed after fingerprint recomputation', () => {
  const v1 = attachArtifactRepositoryProjectionToRuntimeTaskSnapshot(
    buildRuntimeTaskSnapshot(createInput()),
    createArtifactRepositoryProjection()
  );
  assert(v1);

  const staleFingerprint = JSON.parse(JSON.stringify(v1));
  staleFingerprint.artifactRefs[0].contentHash = `sha256-jcs-v1:${'c'.repeat(64)}`;
  assert.strictEqual(readRuntimeTaskSnapshot(staleFingerprint), undefined);

  const invalidHash = JSON.parse(JSON.stringify(v1));
  invalidHash.artifactRefs[0].contentHash = `sha256:${'c'.repeat(64)}`;
  assert.strictEqual(readRuntimeTaskSnapshot(refingerprint(invalidHash)), undefined);

  const reordered = JSON.parse(JSON.stringify(v1));
  reordered.artifactRefs.reverse();
  assert.strictEqual(readRuntimeTaskSnapshot(refingerprint(reordered)), undefined);

  const sourceSpoof = JSON.parse(JSON.stringify(v1));
  sourceSpoof.sources.artifactRepository = 'caller_result_data';
  assert.strictEqual(readRuntimeTaskSnapshot(refingerprint(sourceSpoof)), undefined);

  const boundarySpoof = JSON.parse(JSON.stringify(v1));
  boundarySpoof.boundaries.artifactRepositoryConnected = false;
  assert.strictEqual(readRuntimeTaskSnapshot(refingerprint(boundarySpoof)), undefined);
});

check('all non-authority boundaries are explicit and category-neutral', () => {
  const snapshot = buildRuntimeTaskSnapshot(createInput());
  assert.deepStrictEqual(snapshot.boundaries, {
    readModelOnly: true,
    derivedFromCanonicalOwners: true,
    persistsRuntimeState: false,
    advancesRuntimeStage: false,
    schedulesTools: false,
    executesTools: false,
    grantsPermission: false,
    changesTaskResult: false,
    changesQualityVerdict: false,
    changesDeliveryStatus: false,
    artifactRefsOnly: true,
    artifactRepositoryConnected: false,
    acceptsUnverifiedArtifactRefs: false,
    categoryNeutral: true
  });
  const shapes = ['ecommerce.main_image.v1', 'ecommerce.detail_page.v1', 'ecommerce.sku_batch.v1']
    .map((taskType) => Object.keys(buildRuntimeTaskSnapshot({
      ...createInput(),
      runtimeSession: createSession(taskType)
    })).sort());
  assert.deepStrictEqual(shapes[0], shapes[1]);
  assert.deepStrictEqual(shapes[1], shapes[2]);
});

check('outer autonomous executor preserves cancelled snapshot and diagnostics', () => {
  const runtimeTaskSnapshot = buildRuntimeTaskSnapshot({
    ...createInput(),
    executionStatus: 'cancelled'
  });
  const projected = buildCancelledAutonomousAgentResult({
    success: false,
    message: 'inner cancellation',
    messages: [],
    iterations: 3,
    toolCallLog: [{ name: 'getDocumentInfo' }],
    cancelled: true,
    stopReason: 'cancelled',
    executionSummary: { status: 'cancelled' },
    data: { runtimeTaskSnapshot }
  });
  assert.strictEqual(projected.success, false);
  assert.strictEqual(projected.cancelled, true);
  assert.strictEqual(projected.data.runtimeTaskSnapshot.outcome.status, 'cancelled');
  assert.strictEqual(projected.data.executionSummary.status, 'cancelled');
  assert.strictEqual(projected.data.iterations, 3);
  assert.strictEqual(projected.data.stopReason, 'cancelled');
  assert.strictEqual(projected.data.toolCallLog, undefined);
});

console.log('runtime task snapshot smoke passed');
