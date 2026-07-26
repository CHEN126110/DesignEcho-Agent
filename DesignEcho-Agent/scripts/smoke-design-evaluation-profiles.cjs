'use strict';

/**
 * Evaluation Profile capability smoke。
 *
 * 使用纯逻辑和真实 Agent 收尾方法的验证记录，不调用模型、不执行 Tool、
 * 不连接 Photoshop。验证 Profile 不是空 rubric，也不拥有第二套最终 verdict。
 */

const assert = require('assert');
const path = require('path');

require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '..', 'tsconfig.main.json')
});

const root = path.resolve(__dirname, '..');
const profileModule = require(path.join(root, 'src', 'shared', 'agent-runtime-v5', 'design-evaluation-profiles.ts'));
const { DESIGN_ASSERTIONS } = require(path.join(root, 'src', 'shared', 'design-quality-assertion.ts'));
const { buildDesignVerdict } = require(path.join(root, 'src', 'shared', 'design-quality-verdict-bundle.ts'));
const { buildRuntimeContractBundleForAgentTask } = require(path.join(root, 'src', 'shared', 'agent-runtime-v5', 'runtime-contract-bundle.ts'));
const { Agent } = require(path.join(root, 'src', 'renderer', 'services', 'agent-runtime', 'agent.ts'));
const { getDefaultAgentTools } = require(path.join(root, 'src', 'renderer', 'services', 'agent-runtime', 'tool-schemas.ts'));
const { getManifestBySkillId } = require(path.join(root, 'src', 'shared', 'agent-runtime-v5', 'skill-runtime.ts'));

const {
  DETAIL_PAGE_EVALUATION_PROFILE_ID,
  DETAIL_PAGE_SCOPED_EDIT_EVALUATION_PROFILE_ID,
  MAIN_IMAGE_EVALUATION_PROFILE_ID,
  SKU_COLOR_CARD_EVALUATION_PROFILE_ID,
  SKU_BATCH_EVALUATION_PROFILE_ID,
  buildDesignEvaluationProfileDigest,
  evaluateDesignEvaluationProfile,
  getDesignEvaluationProfileAssertions,
  getDesignEvaluationProfileVlmAssertions,
  listDesignEvaluationProfileCapabilityProviders,
  listDesignEvaluationProfiles,
  validateDesignEvaluationProfile
} = profileModule;

const FIXTURE_HISTORY_REF = { documentId: 42, historyStateId: 7001 };
const FIXTURE_SNAPSHOT_BASE64 = 'A'.repeat(600);

function check(name, fn) {
  fn();
  console.log(`  ✓ ${name}`);
}

function resultFor(assertion, status = 'pass') {
  return {
    id: assertion.id,
    dimension: assertion.dimension,
    status,
    score: status === 'pass' ? 1 : status === 'needs_review' ? 0.5 : 0,
    confidence: 1,
    method: assertion.method,
    severity: assertion.severity,
    owner: assertion.owner,
    rationale: `fixture:${assertion.id}:${status}`,
    expectedFix: assertion.expectedFix
  };
}

function allPassedAssertionResults(profile) {
  const sharedById = new Map(DESIGN_ASSERTIONS.map((assertion) => [assertion.id, assertion]));
  return profile.assertionRefs.map((assertionId) => resultFor(sharedById.get(assertionId)));
}

function allPassedVerificationRecords(profile) {
  return profile.checks.map((check) => ({
    key: check.key,
    status: 'passed',
    source: check.allowedSources[0],
    verificationRef: `fixture:${check.key}:passed`
  }));
}

console.log('smoke: design-evaluation-profiles');

const profiles = listDesignEvaluationProfiles();
const profileById = new Map(profiles.map((profile) => [profile.profileId, profile]));

check('five non-empty, distinct Profile providers validate strictly', () => {
  assert.deepStrictEqual(profiles.map((profile) => profile.profileId), [
    MAIN_IMAGE_EVALUATION_PROFILE_ID,
    DETAIL_PAGE_EVALUATION_PROFILE_ID,
    DETAIL_PAGE_SCOPED_EDIT_EVALUATION_PROFILE_ID,
    SKU_COLOR_CARD_EVALUATION_PROFILE_ID,
    SKU_BATCH_EVALUATION_PROFILE_ID
  ]);
  for (const profile of profiles) {
    assert.deepStrictEqual(validateDesignEvaluationProfile(profile), { valid: true, issues: [] });
    assert.ok(profile.assertionRefs.length >= 6, profile.profileId);
    assert.strictEqual(profile.methodKnowledgeRefs.length, 4, profile.profileId);
    const manifest = getManifestBySkillId(profile.skillId);
    assert.ok(manifest, profile.skillId);
    profile.methodKnowledgeRefs.forEach((capabilityId) => {
      assert.ok(manifest.knowledge_refs.includes(capabilityId), `${profile.profileId}:${capabilityId}`);
    });
    assert.ok(profile.checks.length >= 3, profile.profileId);
    assert.ok(profile.checks.some((check) => check.required), profile.profileId);
    profile.checks.forEach((check) => assert.ok(check.allowedSources.length > 0, check.key));
    assert.strictEqual(profile.boundaries.finalVerdictOwnedByProfile, false);
  }
  assert.notDeepStrictEqual(profiles[0].assertionRefs, profiles[1].assertionRefs);
  assert.notDeepStrictEqual(profiles[1].assertionRefs, profiles[2].assertionRefs);
  assert.notDeepStrictEqual(profiles[2].assertionRefs, profiles[3].assertionRefs);
  assert.notDeepStrictEqual(profiles[3].assertionRefs, profiles[4].assertionRefs);
});

check('invalid and empty Profiles are rejected instead of registered', () => {
  const invalid = {
    ...profiles[0],
    profileId: 'unsafe profile',
    capabilityGoal: '',
    methodKnowledgeRefs: ['missing.method', 'missing.method'],
    assertionRefs: ['missing.assertion', 'missing.assertion'],
    checks: [],
    scoring: { passThreshold: 0, minCoverage: 2 },
    finalVerdictProvider: 'parallel-verdict/v0'
  };
  const result = validateDesignEvaluationProfile(invalid);
  assert.strictEqual(result.valid, false);
  for (const code of [
    'profile_id_invalid',
    'profile_goal_missing',
    'profile_method_knowledge_duplicate',
    'profile_method_knowledge_unknown',
    'profile_assertion_duplicate',
    'profile_assertion_unknown',
    'profile_checks_empty',
    'profile_required_check_missing',
    'profile_threshold_invalid',
    'profile_final_verdict_provider_invalid'
  ]) {
    assert.ok(result.issues.some((issue) => issue.code === code), code);
  }
});

check('all-pass verification records produce the existing DesignScorecard and single DesignVerdict', () => {
  for (const profile of profiles) {
    const result = evaluateDesignEvaluationProfile({
      profile,
      assertionResults: allPassedAssertionResults(profile),
      verificationRecords: allPassedVerificationRecords(profile)
    });
    assert.strictEqual(result.status, 'passed', `${profile.profileId}: ${result.scorecard.summary}`);
    assert.strictEqual(result.scorecard.gate, 'passed');
    assert.strictEqual(result.scorecard.coverage.total, getDesignEvaluationProfileAssertions(profile).length);
    assert.strictEqual(result.scorecard.coverage.ratio, 1);
    assert.strictEqual(result.boundaries.finalVerdictOwnedByProfile, false);
    const verdict = buildDesignVerdict({
      contract: {
        kind: 'creative_design',
        status: 'completed',
        required: [],
        blockers: [],
        warnings: [],
        summary: 'fixture contract passed'
      },
      scorecard: result.scorecard
    });
    assert.strictEqual(verdict.status, 'passed');
    assert.strictEqual(verdict.version, 'design-quality-verdict/v0');
  }
});

check('missing required checks force incomplete_verification with no default pass', () => {
  const profile = profiles[0];
  const verificationRecords = allPassedVerificationRecords(profile).slice(1);
  const result = evaluateDesignEvaluationProfile({
    profile,
    assertionResults: allPassedAssertionResults(profile),
    verificationRecords
  });
  assert.strictEqual(result.status, 'incomplete_verification');
  assert.strictEqual(result.scorecard.passed, false);
  assert.ok(result.verification.missingRequiredCheckKeys.includes(profile.checks[0].key));
  assert.ok(result.issueCodes.includes('critical_check_missing'));
  assert.strictEqual(result.boundaries.defaultPassWhenChecksMissing, false);
});

check('scoped edit cannot pass from a fresh snapshot without target and collateral proof', () => {
  const profile = profileById.get(DETAIL_PAGE_SCOPED_EDIT_EVALUATION_PROFILE_ID);
  const requiredKeys = profile.checks
    .filter((check) => check.required)
    .map((check) => check.key);
  assert.deepStrictEqual(requiredKeys, [
    'requested_change_applied',
    'outside_scope_preserved',
    'fresh_structure_snapshot'
  ]);
  const snapshotOnly = evaluateDesignEvaluationProfile({
    profile,
    assertionResults: allPassedAssertionResults(profile),
    verificationRecords: [{
      key: 'fresh_structure_snapshot',
      status: 'passed',
      source: 'runtime_observation',
      verificationRef: 'fixture:fresh-structure-only'
    }]
  });
  assert.strictEqual(snapshotOnly.status, 'incomplete_verification');
  assert.deepStrictEqual(snapshotOnly.verification.missingRequiredCheckKeys, [
    'requested_change_applied',
    'outside_scope_preserved'
  ]);
  const mainImageProfile = profileById.get(MAIN_IMAGE_EVALUATION_PROFILE_ID);
  assert.ok(!mainImageProfile.checks.some((check) => (
    check.key === 'requested_change_applied' || check.key === 'outside_scope_preserved'
  )));
});

check('explicit blocker failure stays failed while unobserved checks are not fabricated as failure', () => {
  const profile = profileById.get(SKU_BATCH_EVALUATION_PROFILE_ID);
  const failedKey = 'sku_export_readback';
  const verificationRecords = allPassedVerificationRecords(profile).map((record) => (
    record.key === failedKey ? { ...record, status: 'failed' } : record
  ));
  const result = evaluateDesignEvaluationProfile({
    profile,
    assertionResults: allPassedAssertionResults(profile),
    verificationRecords
  });
  assert.strictEqual(result.status, 'failed');
  assert.ok(result.verification.failedCheckKeys.includes(failedKey));
  assert.ok(result.scorecard.blockers.some((item) => item.id === 'sku.export-readback'));
  assert.ok(result.issueCodes.includes('verification_explicitly_failed'));
});

check('required needs-review verification cannot produce passed', () => {
  const profile = profiles[1];
  const reviewKey = profile.checks[0].key;
  const verificationRecords = allPassedVerificationRecords(profile).map((record) => (
    record.key === reviewKey ? { ...record, status: 'needs_review' } : record
  ));
  const result = evaluateDesignEvaluationProfile({
    profile,
    assertionResults: allPassedAssertionResults(profile),
    verificationRecords
  });
  assert.strictEqual(result.status, 'needs_review');
  assert.ok(result.issueCodes.includes('critical_check_needs_review'));
});

check('unsafe verification token is ignored and redacted from result', () => {
  const profile = profiles[0];
  const key = profile.checks[0].key;
  const verificationRecords = allPassedVerificationRecords(profile).map((record) => (
    record.key === key ? { ...record, verificationRef: 'C:\\private\\api-key.txt' } : record
  ));
  const result = evaluateDesignEvaluationProfile({
    profile,
    assertionResults: allPassedAssertionResults(profile),
    verificationRecords
  });
  const serialized = JSON.stringify(result);
  assert.strictEqual(result.status, 'incomplete_verification');
  assert.ok(result.issueCodes.includes('unsafe_verification_record_ignored'));
  assert.ok(!serialized.includes('C:\\private'));
  assert.ok(!serialized.includes('api-key'));
});

check('forged verification status cannot satisfy a required check', () => {
  const profile = profiles[0];
  const key = profile.checks[0].key;
  const verificationRecords = allPassedVerificationRecords(profile).map((record) => (
    record.key === key ? { ...record, status: 'approved_by_model' } : record
  ));
  const result = evaluateDesignEvaluationProfile({
    profile,
    assertionResults: allPassedAssertionResults(profile),
    verificationRecords
  });
  assert.strictEqual(result.status, 'incomplete_verification');
  assert.ok(result.verification.missingRequiredCheckKeys.includes(key));
  assert.ok(result.issueCodes.includes('unsafe_verification_record_ignored'));
});

check('verification source policy rejects forged fresh visual credit', () => {
  const profile = profileById.get(MAIN_IMAGE_EVALUATION_PROFILE_ID);
  const verificationRecords = allPassedVerificationRecords(profile).map((record) => (
    record.key === 'fresh_visual_evaluation'
      ? { ...record, source: 'quality_adapter' }
      : record
  ));
  const result = evaluateDesignEvaluationProfile({
    profile,
    assertionResults: allPassedAssertionResults(profile),
    verificationRecords
  });
  assert.strictEqual(result.status, 'incomplete_verification');
  assert.ok(result.verification.missingRequiredCheckKeys.includes('fresh_visual_evaluation'));
  assert.ok(result.issueCodes.includes('verification_source_not_allowed'));
});

check('conflicting duplicate verification records merge fail closed', () => {
  const profile = profileById.get(MAIN_IMAGE_EVALUATION_PROFILE_ID);
  const verificationRecords = allPassedVerificationRecords(profile);
  const freshStructure = verificationRecords.find((record) => record.key === 'fresh_structure_snapshot');
  verificationRecords.push({
    ...freshStructure,
    status: 'failed',
    verificationRef: 'fixture:fresh-structure:failed'
  });
  const result = evaluateDesignEvaluationProfile({
    profile,
    assertionResults: allPassedAssertionResults(profile),
    verificationRecords
  });
  assert.strictEqual(result.status, 'failed');
  assert.ok(result.verification.failedCheckKeys.includes('fresh_structure_snapshot'));
  assert.ok(result.issueCodes.includes('verification_record_conflict'));
});

check('manifest runtime bundles select Profile by review_rubric_ref only', () => {
  const toolNames = getDefaultAgentTools().map((tool) => tool.name);
  const expected = [
    ['ecommerce.main_image.v1', MAIN_IMAGE_EVALUATION_PROFILE_ID],
    ['ecommerce.detail_page.v1', DETAIL_PAGE_EVALUATION_PROFILE_ID],
    ['ecommerce.sku_color_card.v1', SKU_COLOR_CARD_EVALUATION_PROFILE_ID],
    ['ecommerce.sku_batch.v1', SKU_BATCH_EVALUATION_PROFILE_ID]
  ];
  for (const [taskType, profileId] of expected) {
    const bundle = buildRuntimeContractBundleForAgentTask({ taskType, executableToolNames: toolNames });
    assert.ok(bundle, taskType);
    assert.strictEqual(bundle.evaluationProfile.profileId, profileId);
    assert.strictEqual(bundle.evaluationProfile.taskType, taskType);
  }
  const detailEdit = buildRuntimeContractBundleForAgentTask({
    taskType: 'ecommerce.detail_page.v1',
    workMode: 'edit_existing',
    executableToolNames: toolNames
  });
  assert.ok(detailEdit);
  assert.strictEqual(detailEdit.evaluationProfile.profileId, DETAIL_PAGE_SCOPED_EDIT_EVALUATION_PROFILE_ID);
  assert.strictEqual(detailEdit.stagePlan.workModeContracts.edit_existing.review_rubric_ref, DETAIL_PAGE_SCOPED_EDIT_EVALUATION_PROFILE_ID);
  const generic = buildRuntimeContractBundleForAgentTask({
    taskType: 'design.generic.v1',
    executableToolNames: toolNames
  });
  assert.ok(generic);
  assert.strictEqual(generic.evaluationProfile, undefined);
});

check('Profile Capability providers are non-executable identities', () => {
  const providers = listDesignEvaluationProfileCapabilityProviders();
  assert.strictEqual(providers.length, 5);
  for (const provider of providers) {
    assert.strictEqual(provider.kind, 'evaluation');
    assert.strictEqual(provider.exposure, 'evaluation_gate');
    assert.strictEqual(provider.exposedAsToolSchema, false);
  }
});

check('real Agent summary consumes the selected Profile without model or Tool execution', () => {
  const profile = profileById.get(MAIN_IMAGE_EVALUATION_PROFILE_ID);
  const agent = new Agent(
    {
      systemPrompt: 'evaluation profile smoke',
      tools: [],
      modelId: 'test-model',
      maxIterations: 1,
      taskCompletionContext: { skillId: 'main-image-design', intentMode: 'creative_design' },
      evaluationProfile: profile,
      callbacks: {}
    },
    async () => { throw new Error('model must not be called'); },
    async () => { throw new Error('Tool must not be executed'); }
  );
  agent.currentTask = '设计一张主图';
  agent.toolCallLog = [
    { name: 'createDocument', arguments: {}, result: { success: true, document: { id: 42, name: 'profile-fixture.psd' } } },
    { name: 'renderLayout', arguments: {}, result: { success: true, documentId: 42, subjectLayerIds: [2] } },
    {
      name: 'getDocumentInfo',
      arguments: {},
      result: {
        success: true,
        document: { id: 42, name: 'profile-fixture.psd', width: 1000, height: 1000 },
        historyStateRef: FIXTURE_HISTORY_REF
      }
    },
    {
      name: 'getLayerHierarchy',
      arguments: {},
      result: {
        success: true,
        historyStateRef: FIXTURE_HISTORY_REF,
        flatList: [
          { id: 1, kind: 'background', visible: true, bounds: { left: 0, top: 0, right: 1000, bottom: 1000, width: 1000, height: 1000 }, fillColor: { r: 230, g: 240, b: 250 } },
          { id: 2, kind: 'smartObject', visible: true, bounds: { left: 200, top: 100, right: 800, bottom: 700, width: 600, height: 600 } },
          { id: 3, kind: 'shape', visible: true, bounds: { left: 100, top: 750, right: 900, bottom: 950, width: 800, height: 200 } },
          { id: 4, kind: 'text', visible: true, bounds: { left: 200, top: 780, right: 800, bottom: 850, width: 600, height: 70 } },
          { id: 5, kind: 'text', visible: true, bounds: { left: 300, top: 870, right: 700, bottom: 910, width: 400, height: 40 } }
        ]
      }
    },
    {
      name: 'getAllTextLayers',
      arguments: {},
      result: {
        success: true,
        historyStateRef: FIXTURE_HISTORY_REF,
        layers: [
          { id: 4, style: { fontSize: 48, textAlign: 'center' } },
          { id: 5, style: { fontSize: 24, textAlign: 'center' } }
        ]
      }
    },
    {
      name: 'getCanvasSnapshot',
      arguments: {},
      result: {
        success: true,
        snapshot: { base64: FIXTURE_SNAPSHOT_BASE64, width: 1000, height: 1000, format: 'jpeg' },
        documentInfo: { id: 42, name: 'profile-fixture.psd', width: 1000, height: 1000 },
        historyStateRef: FIXTURE_HISTORY_REF
      }
    },
    {
      name: 'getDocumentInfo',
      arguments: {},
      result: {
        success: true,
        document: { id: 42, name: 'profile-fixture.psd', width: 1000, height: 1000 },
        historyStateRef: FIXTURE_HISTORY_REF
      },
      origin: 'harness_quality_verification',
      qualityVerificationPhase: 'final_summary'
    }
  ];
  const vlmResults = getDesignEvaluationProfileVlmAssertions(profile).map((assertion) => resultFor(assertion));
  const summary = agent.buildExecutionSummary('final_response', 1, vlmResults);
  assert.strictEqual(summary.designEvaluationProfileDigest.profileId, MAIN_IMAGE_EVALUATION_PROFILE_ID);
  assert.ok(summary.designEvaluationProfileDigest.missingRequiredCheckCount > 0,
    'missing business evidence must remain visible when no real result adapter produced it');
  assert.strictEqual(summary.designScorecard.coverage.total, getDesignEvaluationProfileAssertions(profile).length);
  assert.ok(summary.designVerdict, 'single DesignVerdict must remain the final quality output');
  assert.notStrictEqual(summary.designVerdict.status, 'passed',
    'a selected Profile must not pass from test-injected verification evidence');
  assert.strictEqual(summary.designEvaluationProfileDigest.boundaries.notFinalVerdict, true);
  const partialSummary = agent.buildExecutionSummary('final_response', 1, vlmResults.slice(0, 3));
  assert.ok(partialSummary.designEvaluationProfileDigest.missingRequiredCheckCount > 0,
    'partial VLM assertion batch must not create fresh_visual_evaluation');
  assert.notStrictEqual(partialSummary.designVerdict?.status, 'passed',
    'partial VLM assertion batch must not pass the single DesignVerdict');

  const actionableVlmResults = vlmResults.map((result, index) => {
    if (index !== 0) return result;
    return {
      ...result,
      status: 'fail',
      score: 0.25,
      confidence: 0.9,
      rationale: '主标题与产品主体竞争第一视觉焦点。',
      diagnosis: {
        version: 'design-quality-issue-diagnosis/v0',
        visualFinding: {
          scope: 'global',
          target: '整体信息层级',
          description: '主标题与产品主体的视觉重量接近。',
          relationship: '两者竞争第一视觉焦点。',
          affectedRoles: ['headline', 'subject']
        },
        causalExplanation: {
          basis: 'goal_effect_hypothesis',
          goalRelation: 'conflicts',
          mechanism: '这会延迟用户识别产品主体。'
        },
        revision: {
          action: '把标题直接缩小到 40%。',
          expectedEffect: '产品先被识别，标题保持第二层可读。',
          preserve: ['产品真实性'],
          verify: ['缩略查看时先识别产品']
        }
      }
    };
  });
  const actionableSummary = agent.buildExecutionSummary('final_response', 1, actionableVlmResults);
  const actionableHandoff = agent.buildQualityGateReflexionHandoff(actionableSummary);
  assert.strictEqual(actionableHandoff?.status, 'reflexion_required',
    '可靠且带合法三层诊断的视觉非通过项应进入既有有界 Reflexion');
  assert.strictEqual(actionableHandoff?.targetStage, 'R4',
    '审美诊断只能回到 R4 重规划，不能直接取得 Photoshop 执行权');
  assert.ok(actionableHandoff?.nextRoundConstraints.some((value) => (
    value.includes('untrusted_vlm_diagnosis')
    && value.includes('缩略查看时先识别产品')
    && !value.includes('缩小到 40%')
  )), '生产 Agent handoff 应携带观察/效果/保留/复核数据，但剥离原始 VLM action');

  const advisoryOnlyVlmResults = vlmResults.map((result, index) => (
    index === 0
      ? { ...result, status: 'needs_review', score: undefined, confidence: 0.4, diagnosis: undefined }
      : result
  ));
  const advisoryOnlySummary = agent.buildExecutionSummary('final_response', 1, advisoryOnlyVlmResults);
  assert.strictEqual(agent.buildQualityGateReflexionHandoff(advisoryOnlySummary), undefined,
    '低置信或无合法诊断的 warning-only 结果必须停在人工复核，不能自动返工');
  assert.deepStrictEqual(
    buildDesignEvaluationProfileDigest(evaluateDesignEvaluationProfile({
      profile,
      assertionResults: allPassedAssertionResults(profile),
      verificationRecords: allPassedVerificationRecords(profile)
    })).profileId,
    MAIN_IMAGE_EVALUATION_PROFILE_ID
  );
});

console.log(JSON.stringify({
  success: true,
  profileIds: profiles.map((profile) => profile.profileId),
  providerCount: listDesignEvaluationProfileCapabilityProviders().length,
  boundaries: {
    callsModel: false,
    executesTools: false,
    ownsFinalVerdict: false,
    defaultsMissingChecksToPass: false
  }
}, null, 2));
