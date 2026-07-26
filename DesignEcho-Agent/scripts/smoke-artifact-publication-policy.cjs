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
  validateArtifactPublicationPolicy
} = require(path.join(
  ROOT,
  'src',
  'shared',
  'agent-runtime-v5',
  'artifact-publication-policy.ts'
));
const {
  V5_ARTIFACT_TYPES
} = require(path.join(ROOT, 'src', 'shared', 'agent-runtime-v5', 'contracts', 'index.ts'));
const {
  buildRuntimeArtifactId
} = require(path.join(ROOT, 'src', 'shared', 'agent-runtime-v5', 'runtime-artifact-finalization.ts'));
const {
  validateRuntimeDesignBriefDeclaration
} = require(path.join(ROOT, 'src', 'shared', 'agent-runtime-v5', 'runtime-design-brief-declaration.ts'));
const {
  buildRuntimeDesignStrategyDigest,
  validateRuntimeDesignStrategyDeclaration
} = require(path.join(ROOT, 'src', 'shared', 'agent-runtime-v5', 'runtime-design-strategy-declaration.ts'));
const {
  validateRuntimeActionPlanDeclaration
} = require(path.join(ROOT, 'src', 'shared', 'agent-runtime-v5', 'runtime-action-plan-declaration.ts'));

function check(name, fn) {
  fn();
  console.log(`  ✓ ${name}`);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function artifactRef(artifactId, artifactType, hex = 'a') {
  return {
    artifactId,
    artifactType,
    contentHash: `sha256-jcs-v1:${hex.repeat(64)}`
  };
}

function runtimeBinding() {
  return {
    sessionId: 'session-publication-policy',
    runId: 'run-publication-policy',
    generation: 1
  };
}

function jsonRequest(artifactType, value, overrides = {}) {
  return {
    artifactId: `${artifactType.replace(/_/g, '-')}-v1`,
    artifactType,
    projectId: 'publication-policy-project',
    skillId: 'design.generic.v1',
    sourceRevision: 1,
    sourceRefs: [],
    capabilityStatus: 'real',
    payload: {
      kind: 'json',
      value
    },
    ...overrides
  };
}

function binaryRequest(artifactType, overrides = {}) {
  return {
    artifactId: `${artifactType.replace(/_/g, '-')}-v1`,
    artifactType,
    projectId: 'publication-policy-project',
    skillId: 'design.generic.v1',
    sourceRevision: 1,
    sourceRefs: [],
    capabilityStatus: 'real',
    payload: {
      kind: 'binary',
      bytes: new Uint8Array([0, 255, 17, 31]),
      mediaType: 'application/octet-stream',
      fileName: 'artifact.bin'
    },
    ...overrides
  };
}

function runtimeRequest(artifactType, value, overrides = {}) {
  const binding = overrides.runtimeBinding || runtimeBinding();
  return jsonRequest(artifactType, value, {
    ...overrides,
    artifactId: buildRuntimeArtifactId(artifactType, binding),
    sourceRevision: binding.generation,
    capabilityStatus: 'manual_verification_pending',
    modelProfile: undefined,
    runtimeBinding: binding
  });
}

function validate(request, authority = 'internal', transport = 'main_process') {
  return validateArtifactPublicationPolicy({ authority, transport, request });
}

function assertOk(result) {
  assert.strictEqual(result.ok, true, JSON.stringify(result.issues, null, 2));
  assert.deepStrictEqual(result.issues, []);
}

function assertIssue(result, code, path) {
  assert.strictEqual(result.ok, false, 'expected policy rejection');
  assert(
    result.issues.some((issue) => issue.code === code && (!path || issue.path === path)),
    `missing ${code}${path ? ` at ${path}` : ''}: ${JSON.stringify(result.issues, null, 2)}`
  );
}

function briefPayload() {
  const result = validateRuntimeDesignBriefDeclaration({
    value: {
      taskGoal: '建立清晰的信息层级',
      deliverables: ['editable_design'],
      outputRequirements: [],
      constraints: [],
      inputCoverage: [],
      contextRefs: ['context:user_goal']
    },
    requiredInputKeys: [],
    optionalInputKeys: [],
    allowedContextRefs: ['context:user_goal'],
    inputSources: {},
    resolvedInputs: []
  });
  assert.strictEqual(result.ok, true, JSON.stringify(result.issues, null, 2));
  return result.declaration;
}

function strategyPayload() {
  const result = validateRuntimeDesignStrategyDeclaration({
    value: {
      stageGoal: '形成可执行策略',
      objective: {
        primaryGoal: '建立可信且清晰的信息层级',
        secondaryGoals: [],
        targetAudienceSummary: '重视真实产品信息的消费者'
      },
      messageArchitecture: {
        primaryMessage: '先理解核心卖点，再阅读支撑信息',
        supportingMessages: [],
        supportingFacts: [],
        objectionsToResolve: []
      },
      copyDirection: {
        toneKeywords: ['克制'],
        headlineOptions: [],
        subtitleOptions: [],
        tagOptions: [],
        prohibitedClaims: []
      },
      visualDirection: {
        moodKeywords: ['清晰'],
        paletteIntent: [],
        typographyIntent: [],
        compositionIntent: ['由主信息向证明信息递进'],
        imageTreatment: [],
        density: 'medium'
      },
      constraints: [],
      contextRefs: ['context:design_brief'],
      assumptions: [],
      missingInputs: []
    },
    allowedContextRefs: ['context:design_brief']
  });
  assert.strictEqual(result.ok, true, JSON.stringify(result.issues, null, 2));
  return result.declaration;
}

function actionPlanPayload() {
  const result = validateRuntimeActionPlanDeclaration({
    value: {
      planGoal: '按观察执行并读回',
      strategyRef: 'current:r3_design_strategy',
      contextRefs: ['context:design_strategy'],
      steps: [{
        stepId: 'observe_scene',
        kind: 'observe',
        goal: '观察当前画面与可用上下文',
        dependsOn: [],
        capabilityRefs: ['capability:visual_observation'],
        inputContextRefs: ['context:design_strategy'],
        expectedOutcomes: ['visual_observation'],
        completionCriteria: ['形成可追溯的视觉观察'],
        failurePolicy: 'request_input'
      }],
      missingInputs: []
    },
    strategyDigest: buildRuntimeDesignStrategyDigest(strategyPayload()),
    allowedContextRefs: ['context:design_strategy'],
    capabilityContext: {
      discoveredCapabilityRefs: ['capability:visual_observation'],
      activeActionCapabilityRefs: ['capability:visual_observation'],
      onDemandActionCapabilityRefs: []
    },
    forbiddenToolNames: []
  });
  assert.strictEqual(result.ok, true, JSON.stringify(result.issues, null, 2));
  return result.declaration;
}

function evaluationPayload() {
  return {
    version: 'design-quality-verdict/v0',
    status: 'passed',
    source: 'contract',
    contractStatus: 'completed',
    contractFailedRequirementIds: [],
    blockers: [],
    warnings: [],
    summary: '契约与质量结果可追溯。'
  };
}

function deliveryVerificationPayload() {
  return {
    version: 'runtime-delivery-verification/v1',
    status: 'passed',
    requiredOutputs: ['editable_design'],
    confirmedOutputs: ['editable_design'],
    missingOutputs: [],
    targetBound: true,
    reviewedPreviewBound: true,
    sourceHistoryStateBound: true,
    boundaries: {
      manifestRequirementsOnly: true,
      explicitReceiptRequired: true,
      sameTargetPreviewRequired: true,
      exactSourceHistoryRequired: true,
      qualityVerdictAuthority: false,
      grantsPermission: false,
      executesTools: false
    }
  };
}

function approvalPayload(previewRef, reviewRef) {
  return {
    approvalId: 'approval-policy-1',
    scope: 'preview_selection',
    subject: {
      projectId: 'publication-policy-project',
      versionId: 'preview-v1',
      stateRevision: 1,
      previewSceneRef: previewRef,
      previewArtifactHash: previewRef.contentHash,
      reviewReportRef: reviewRef,
      reviewReportHash: reviewRef.contentHash
    },
    decision: 'approved',
    actor: {
      actorType: 'user',
      actorId: 'user-policy-smoke'
    },
    approvedAt: '2026-07-22T12:00:00.000Z'
  };
}

function runSmoke() {
  console.log('smoke: artifact-publication-policy');

  check('runtime_renderer 只允许当前五类自动发布 payload 且都要求 Runtime identity', () => {
    const fixtures = [
      [V5_ARTIFACT_TYPES.runtimeDesignBrief, briefPayload()],
      [V5_ARTIFACT_TYPES.runtimeDesignStrategy, strategyPayload()],
      [V5_ARTIFACT_TYPES.runtimeActionPlan, actionPlanPayload()],
      [V5_ARTIFACT_TYPES.evaluationReport, evaluationPayload()],
      [V5_ARTIFACT_TYPES.runtimeDeliveryVerification, deliveryVerificationPayload()]
    ];
    for (const [artifactType, payload] of fixtures) {
      assertOk(validate(runtimeRequest(artifactType, payload), 'runtime_renderer', 'renderer_ipc'));
      assertIssue(
        validate(jsonRequest(artifactType, payload), 'runtime_renderer', 'renderer_ipc'),
        'runtime_binding_required',
        'request.runtimeBinding'
      );
    }
  });

  check('runtime_renderer 不得自报 ID、revision、能力成熟度或模型身份', () => {
    const request = runtimeRequest(V5_ARTIFACT_TYPES.runtimeDesignBrief, briefPayload());
    assertIssue(
      validate({ ...request, artifactId: 'renderer-forged-id' }, 'runtime_renderer', 'renderer_ipc'),
      'runtime_artifact_id_mismatch',
      'request.artifactId'
    );
    assertIssue(
      validate({ ...request, sourceRevision: 99 }, 'runtime_renderer', 'renderer_ipc'),
      'runtime_revision_mismatch',
      'request.sourceRevision'
    );
    assertIssue(
      validate({ ...request, capabilityStatus: 'real' }, 'runtime_renderer', 'renderer_ipc'),
      'runtime_capability_status_forbidden',
      'request.capabilityStatus'
    );
    assertIssue(
      validate({ ...request, modelProfile: 'renderer-forged-model' }, 'runtime_renderer', 'renderer_ipc'),
      'runtime_model_profile_forbidden',
      'request.modelProfile'
    );
  });

  check('runtime_renderer 拒绝未自动接线类型与非 IPC transport', () => {
    const contextRef = artifactRef('brief-v1', V5_ARTIFACT_TYPES.runtimeDesignBrief);
    const contextRequest = runtimeRequest(
      V5_ARTIFACT_TYPES.contextSnapshot,
      { briefRef: contextRef },
      { sourceRefs: [contextRef] }
    );
    assertIssue(
      validate(contextRequest, 'runtime_renderer', 'renderer_ipc'),
      'runtime_artifact_type_forbidden',
      'request.artifactType'
    );
    assertIssue(
      validate(runtimeRequest(V5_ARTIFACT_TYPES.runtimeDesignBrief, briefPayload()), 'runtime_renderer', 'main_process'),
      'authority_transport_mismatch',
      'transport'
    );
  });

  check('approval_service 仅允许 main-process approval_record 且禁止 runtimeBinding', () => {
    const previewRef = artifactRef('preview-v1', V5_ARTIFACT_TYPES.previewScene);
    const reviewRef = artifactRef('review-v1', V5_ARTIFACT_TYPES.reviewReport, 'b');
    const request = jsonRequest(
      V5_ARTIFACT_TYPES.approvalRecord,
      approvalPayload(previewRef, reviewRef),
      { sourceRefs: [previewRef, reviewRef] }
    );
    assertOk(validate(request, 'approval_service', 'main_process'));
    assertIssue(
      validate({ ...request, runtimeBinding: runtimeBinding() }, 'approval_service', 'main_process'),
      'approval_runtime_binding_forbidden',
      'request.runtimeBinding'
    );
    assertIssue(
      validate(request, 'approval_service', 'renderer_ipc'),
      'authority_transport_mismatch',
      'transport'
    );
    assertIssue(
      validate(jsonRequest(V5_ARTIFACT_TYPES.contextSnapshot, {}), 'approval_service', 'main_process'),
      'approval_artifact_type_forbidden',
      'request.artifactType'
    );
  });

  check('internal authority 保留在主进程且不能替代 ApprovalService', () => {
    assertIssue(
      validate(binaryRequest(V5_ARTIFACT_TYPES.photoshopDocument), 'internal', 'renderer_ipc'),
      'authority_transport_mismatch',
      'transport'
    );
    const previewRef = artifactRef('preview-v1', V5_ARTIFACT_TYPES.previewScene);
    const reviewRef = artifactRef('review-v1', V5_ARTIFACT_TYPES.reviewReport, 'b');
    assertIssue(
      validate(
        jsonRequest(
          V5_ARTIFACT_TYPES.approvalRecord,
          approvalPayload(previewRef, reviewRef),
          { sourceRefs: [previewRef, reviewRef] }
        ),
        'internal',
        'main_process'
      ),
      'internal_approval_forbidden',
      'request.artifactType'
    );
  });

  check('Photoshop document/export 只接受 binary，其他 canonical Artifact 只接受 JSON', () => {
    assertOk(validate(binaryRequest(V5_ARTIFACT_TYPES.photoshopDocument)));
    assertOk(validate(binaryRequest(V5_ARTIFACT_TYPES.exportedAsset)));
    assertIssue(
      validate(jsonRequest(V5_ARTIFACT_TYPES.photoshopDocument, { document: 'fake' })),
      'payload_kind_mismatch',
      'request.payload.kind'
    );
    assertIssue(
      validate({
        ...jsonRequest(V5_ARTIFACT_TYPES.visualObservation, {}),
        payload: binaryRequest(V5_ARTIFACT_TYPES.exportedAsset).payload
      }),
      'payload_kind_mismatch',
      'request.payload.kind'
    );
  });

  check('Brief 外层 version/source/readiness/exact keys/boundaries 全部 fail closed', () => {
    const invalid = briefPayload();
    invalid.version = 'runtime-design-brief-declaration/v99';
    invalid.source = 'renderer_claim';
    invalid.readiness = 'completed';
    invalid.boundaries.grantsPermission = true;
    invalid.extra = 'forbidden';
    const result = validate(runtimeRequest(V5_ARTIFACT_TYPES.runtimeDesignBrief, invalid), 'runtime_renderer', 'renderer_ipc');
    assertIssue(result, 'literal_mismatch', 'request.payload.value.version');
    assertIssue(result, 'literal_mismatch', 'request.payload.value.source');
    assertIssue(result, 'enum_mismatch', 'request.payload.value.readiness');
    assertIssue(result, 'literal_mismatch', 'request.payload.value.boundaries.grantsPermission');
    assertIssue(result, 'unknown_field', 'request.payload.value.extra');

    const emptyPayload = briefPayload();
    emptyPayload.payload = {};
    assertIssue(
      validate(runtimeRequest(V5_ARTIFACT_TYPES.runtimeDesignBrief, emptyPayload), 'runtime_renderer', 'renderer_ipc'),
      'declaration_shape_invalid',
      'request.payload.value'
    );
  });

  check('Strategy 与 Action Plan 的完整 boundary literals 不能自我提权', () => {
    const strategy = strategyPayload();
    strategy.boundaries.artifactPublished = true;
    assertIssue(
      validate(runtimeRequest(V5_ARTIFACT_TYPES.runtimeDesignStrategy, strategy), 'runtime_renderer', 'renderer_ipc'),
      'literal_mismatch',
      'request.payload.value.boundaries.artifactPublished'
    );
    const strategyWithUnknownNestedShape = strategyPayload();
    strategyWithUnknownNestedShape.payload.objective.unknown = true;
    assertIssue(
      validate(
        runtimeRequest(V5_ARTIFACT_TYPES.runtimeDesignStrategy, strategyWithUnknownNestedShape),
        'runtime_renderer',
        'renderer_ipc'
      ),
      'declaration_shape_invalid',
      'request.payload.value'
    );
    const emptyStrategy = strategyPayload();
    emptyStrategy.payload = {};
    assertIssue(
      validate(runtimeRequest(V5_ARTIFACT_TYPES.runtimeDesignStrategy, emptyStrategy), 'runtime_renderer', 'renderer_ipc'),
      'declaration_shape_invalid',
      'request.payload.value'
    );

    const plan = actionPlanPayload();
    plan.boundaries.schedulerAuthority = true;
    assertIssue(
      validate(runtimeRequest(V5_ARTIFACT_TYPES.runtimeActionPlan, plan), 'runtime_renderer', 'renderer_ipc'),
      'literal_mismatch',
      'request.payload.value.boundaries.schedulerAuthority'
    );
    const planWithForgedGraph = actionPlanPayload();
    planWithForgedGraph.graph.rootStepIds = ['forged_root'];
    assertIssue(
      validate(
        runtimeRequest(V5_ARTIFACT_TYPES.runtimeActionPlan, planWithForgedGraph),
        'runtime_renderer',
        'renderer_ipc'
      ),
      'declaration_shape_invalid',
      'request.payload.value'
    );
    const emptyPlan = actionPlanPayload();
    emptyPlan.payload = {};
    assertIssue(
      validate(runtimeRequest(V5_ARTIFACT_TYPES.runtimeActionPlan, emptyPlan), 'runtime_renderer', 'renderer_ipc'),
      'declaration_shape_invalid',
      'request.payload.value'
    );
  });

  check('Evaluation 与 Delivery Verification 严格校验 version/status/source/outer keys/boundaries', () => {
    const evaluation = evaluationPayload();
    evaluation.status = 'complete';
    evaluation.source = 'renderer';
    evaluation.payload = { hidden: true };
    const evaluationResult = validate(
      runtimeRequest(V5_ARTIFACT_TYPES.evaluationReport, evaluation),
      'runtime_renderer',
      'renderer_ipc'
    );
    assertIssue(evaluationResult, 'enum_mismatch', 'request.payload.value.status');
    assertIssue(evaluationResult, 'enum_mismatch', 'request.payload.value.source');
    assertIssue(evaluationResult, 'unknown_field', 'request.payload.value.payload');

    const incompleteEvaluationShape = evaluationPayload();
    incompleteEvaluationShape.scorecardGate = 'passed';
    assertIssue(
      validate(
        runtimeRequest(V5_ARTIFACT_TYPES.evaluationReport, incompleteEvaluationShape),
        'runtime_renderer',
        'renderer_ipc'
      ),
      'declaration_shape_invalid',
      'request.payload.value'
    );

    const delivery = deliveryVerificationPayload();
    delivery.status = 'ready';
    delivery.boundaries.qualityVerdictAuthority = true;
    const deliveryResult = validate(
      runtimeRequest(V5_ARTIFACT_TYPES.runtimeDeliveryVerification, delivery),
      'runtime_renderer',
      'renderer_ipc'
    );
    assertIssue(deliveryResult, 'enum_mismatch', 'request.payload.value.status');
    assertIssue(deliveryResult, 'literal_mismatch', 'request.payload.value.boundaries.qualityVerdictAuthority');

    const inconsistentDelivery = deliveryVerificationPayload();
    inconsistentDelivery.missingOutputs = ['editable_design'];
    assertIssue(
      validate(
        runtimeRequest(V5_ARTIFACT_TYPES.runtimeDeliveryVerification, inconsistentDelivery),
        'runtime_renderer',
        'renderer_ipc'
      ),
      'declaration_shape_invalid',
      'request.payload.value'
    );
  });

  check('五类 Runtime JSON 递归拒绝 nested payload/path/base64/data URL/binary', () => {
    const leaks = [
      { payload: { hidden: true } },
      { localPath: 'C:\\outside\\artifact.bin' },
      { imageBase64: 'AAAA' },
      { image: 'data:image/png;base64,AAAA' },
      { bytes: new Uint8Array([1, 2, 3]) }
    ];
    for (const leak of leaks) {
      const payload = briefPayload();
      payload.payload.observation = leak;
      const result = validate(
        runtimeRequest(V5_ARTIFACT_TYPES.runtimeDesignBrief, payload),
        'runtime_renderer',
        'renderer_ipc'
      );
      assert.strictEqual(result.ok, false, JSON.stringify(leak));
      assert(
        result.issues.some((issue) => [
          'authority_field_forbidden',
          'authority_value_forbidden',
          'binary_value_forbidden'
        ].includes(issue.code)),
        JSON.stringify(result.issues, null, 2)
      );
    }
  });

  check('sourceRefs 本身只接受不重复的严格三字段 ArtifactRef', () => {
    const contextRef = artifactRef('context-v1', V5_ARTIFACT_TYPES.contextSnapshot);
    assertIssue(
      validate(jsonRequest(
        V5_ARTIFACT_TYPES.creativeStrategy,
        { contextSnapshotRef: contextRef },
        { sourceRefs: [{ ...contextRef, path: 'C:\\outside.json' }] }
      )),
      'source_ref_not_strict',
      'request.sourceRefs[0]'
    );
    assertIssue(
      validate(jsonRequest(
        V5_ARTIFACT_TYPES.creativeStrategy,
        { contextSnapshotRef: contextRef },
        { sourceRefs: [contextRef, { ...contextRef }] }
      )),
      'source_ref_duplicate',
      'request.sourceRefs[1]'
    );
  });

  check('creative_strategy 引用必须严格且精确存在 sourceRefs', () => {
    const contextRef = artifactRef('context-v1', V5_ARTIFACT_TYPES.contextSnapshot);
    assertOk(validate(jsonRequest(
      V5_ARTIFACT_TYPES.creativeStrategy,
      { contextSnapshotRef: contextRef },
      { sourceRefs: [contextRef] }
    )));
    assertIssue(
      validate(jsonRequest(
        V5_ARTIFACT_TYPES.creativeStrategy,
        { contextSnapshotRef: { ...contextRef, payload: {} } },
        { sourceRefs: [contextRef] }
      )),
      'upstream_ref_not_strict',
      'payload.contextSnapshotRef'
    );
    assertIssue(
      validate(jsonRequest(V5_ARTIFACT_TYPES.creativeStrategy, { contextSnapshotRef: contextRef })),
      'upstream_ref_not_in_source_refs',
      'payload.contextSnapshotRef'
    );
  });

  check('detail_page_plan 要求两个严格上游 ref 都进入 sourceRefs', () => {
    const contextRef = artifactRef('context-v1', V5_ARTIFACT_TYPES.contextSnapshot);
    const strategyRef = artifactRef('strategy-v1', V5_ARTIFACT_TYPES.creativeStrategy, 'b');
    assertOk(validate(jsonRequest(
      V5_ARTIFACT_TYPES.detailPagePlan,
      { contextSnapshotRef: contextRef, creativeStrategyRef: strategyRef },
      { sourceRefs: [contextRef, strategyRef] }
    )));
    assertIssue(
      validate(jsonRequest(
        V5_ARTIFACT_TYPES.detailPagePlan,
        { contextSnapshotRef: contextRef, creativeStrategyRef: strategyRef },
        { sourceRefs: [contextRef] }
      )),
      'upstream_ref_not_in_source_refs',
      'payload.creativeStrategyRef'
    );
  });

  check('review_report subjectRef 必须严格且进入 sourceRefs', () => {
    const subjectRef = artifactRef('preview-v1', V5_ARTIFACT_TYPES.previewScene);
    assertOk(validate(jsonRequest(
      V5_ARTIFACT_TYPES.reviewReport,
      { subjectRef },
      { sourceRefs: [subjectRef] }
    )));
    assertIssue(
      validate(jsonRequest(V5_ARTIFACT_TYPES.reviewReport, { subjectRef })),
      'upstream_ref_not_in_source_refs',
      'payload.subjectRef'
    );
  });

  check('context_snapshot briefRef 与 preview_scene planRef 都必须进入 sourceRefs', () => {
    const briefRef = artifactRef('brief-v1', V5_ARTIFACT_TYPES.runtimeDesignBrief);
    const planRef = artifactRef('plan-v1', V5_ARTIFACT_TYPES.runtimeActionPlan, 'b');
    assertOk(validate(jsonRequest(
      V5_ARTIFACT_TYPES.contextSnapshot,
      { briefRef },
      { sourceRefs: [briefRef] }
    )));
    assertOk(validate(jsonRequest(
      V5_ARTIFACT_TYPES.previewScene,
      { planRef },
      { sourceRefs: [planRef] }
    )));
    assertIssue(
      validate(jsonRequest(V5_ARTIFACT_TYPES.contextSnapshot, { briefRef })),
      'upstream_ref_not_in_source_refs',
      'payload.briefRef'
    );
    assertIssue(
      validate(jsonRequest(V5_ARTIFACT_TYPES.previewScene, { planRef })),
      'upstream_ref_not_in_source_refs',
      'payload.planRef'
    );
  });

  check('approval_record 的 preview/review refs 均需严格进入 sourceRefs', () => {
    const previewRef = artifactRef('preview-v1', V5_ARTIFACT_TYPES.previewScene);
    const reviewRef = artifactRef('review-v1', V5_ARTIFACT_TYPES.reviewReport, 'b');
    const request = jsonRequest(
      V5_ARTIFACT_TYPES.approvalRecord,
      approvalPayload(previewRef, reviewRef),
      { sourceRefs: [previewRef] }
    );
    assertIssue(
      validate(request, 'approval_service', 'main_process'),
      'upstream_ref_not_in_source_refs',
      'payload.subject.reviewReportRef'
    );
  });

  check('策略函数不修改 request 或 payload', () => {
    const request = runtimeRequest(V5_ARTIFACT_TYPES.runtimeDesignBrief, briefPayload());
    const before = JSON.stringify(request);
    assertOk(validate(request, 'runtime_renderer', 'renderer_ipc'));
    assert.strictEqual(JSON.stringify(request), before);
  });

  console.log('smoke: artifact-publication-policy passed');
}

runSmoke();
