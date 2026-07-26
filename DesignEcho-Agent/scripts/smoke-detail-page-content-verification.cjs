'use strict';

/**
 * 详情页逐屏内容校验 smoke。
 *
 * 只运行共享纯逻辑与静态接线检查，不调用模型、Tool 或 Photoshop。
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '..', 'tsconfig.main.json')
});

const root = path.resolve(__dirname, '..');
const verificationModule = require(path.join(root, 'src', 'shared', 'detail-page-content-verification.ts'));
const stateModule = require(path.join(root, 'src', 'shared', 'detail-page-state-consumption.ts'));
const projectStateModule = require(path.join(root, 'src', 'shared', 'design-project-state.ts'));
const factProvenanceModule = require(path.join(root, 'src', 'shared', 'design-project-fact-provenance.ts'));
const screenPlanModule = require(path.join(root, 'src', 'shared', 'detail-page-screen-plan.ts'));
const adapterModule = require(path.join(root, 'src', 'shared', 'agent-runtime-v5', 'design-evaluation-result-adapters.ts'));
const profileModule = require(path.join(root, 'src', 'shared', 'agent-runtime-v5', 'design-evaluation-profiles.ts'));

const {
  buildDetailPageContentVerification,
  buildDetailPageContentFactCatalog,
  resolveDetailPageContentSupportRefs
} = verificationModule;
const { buildDetailPageStateContext } = stateModule;
const { applyDesignProjectStatePatch, createEmptyDesignProjectState } = projectStateModule;
const { buildDesignProjectFactId } = factProvenanceModule;
const { inferDetailScreenPlans } = screenPlanModule;
const { adaptDesignEvaluationRecordsFromToolResults } = adapterModule;
const {
  DETAIL_PAGE_EVALUATION_PROFILE_ID,
  getDesignEvaluationProfileById
} = profileModule;

function check(name, fn) {
  fn();
  console.log(`  ✓ ${name}`);
}

function screen(id, name, type = 'C_SELLING_POINT') {
  return {
    id,
    name,
    type,
    order: id - 1,
    copyPlaceholders: [{ layerId: id * 10, currentText: '占位文案', role: 'headline' }],
    imagePlaceholders: [{ layerId: id * 10 + 1 }]
  };
}

function projectState() {
  let state = applyDesignProjectStatePatch(createEmptyDesignProjectState(), {
    set: {
      productFacts: ['面料采用 80% 精梳棉'],
      sellingPoints: ['轻薄透气'],
      copywriting: [
        { slot: '首屏', text: '轻薄透气，自在一整天', basis: '轻薄透气' },
        { slot: '材质屏', text: '面料采用 80% 精梳棉，触感细腻', basis: '面料采用 80% 精梳棉' }
      ]
    },
    upsertFacts: [
      { claimType: 'product_fact', statement: '面料采用 80% 精梳棉', source: { kind: 'user_statement' } },
      { claimType: 'selling_point', statement: '轻薄透气', source: { kind: 'user_statement' } }
    ],
    factWriteAuthority: 'agent_proposal'
  });
  state = applyDesignProjectStatePatch(state, {
    reviewFacts: [
      { factId: buildDesignProjectFactId('product_fact', '面料采用 80% 精梳棉'), decision: 'confirm' },
      { factId: buildDesignProjectFactId('selling_point', '轻薄透气'), decision: 'confirm' }
    ],
    factWriteAuthority: 'user_review',
    updatedBy: 'user'
  });
  return state;
}

function buildLinkedPlans() {
  const screens = [screen(1, '首屏'), screen(2, '材质屏', 'G_MATERIAL')];
  const context = buildDetailPageStateContext({
    state: projectState(),
    screens
  });
  const plans = inferDetailScreenPlans(screens, undefined, {
    agentDecisions: context.agentDecisions
  });
  return { screens, context, plans };
}

function fillPlansFor(plans) {
  return plans.map((plan) => ({
    screenId: plan.screenId,
    supportRefs: plan.supportRefs,
    copies: [{ content: plan.mainMessage, generationStatus: 'generated' }]
  }));
}

console.log('smoke: detail-page-content-verification');

check('fact catalog creates stable support refs without paths or raw payloads', () => {
  const catalog = buildDetailPageContentFactCatalog({
    state: projectState()
  });
  assert.strictEqual(catalog.length, 2);
  assert.ok(catalog[0].ref.startsWith('detail-fact:state-record:'));
  assert.ok(catalog[1].ref.startsWith('detail-fact:state-record:'));
  const refs = resolveDetailPageContentSupportRefs({
    catalog,
    statements: ['轻薄透气，自在一整天', '面料采用 80% 精梳棉，触感细腻']
  });
  assert.strictEqual(refs.length, 2);
  assert.ok(refs[0].startsWith('detail-fact:state-record:'));
  assert.ok(refs[1].startsWith('detail-fact:state-record:'));
});

check('project-state copy basis flows into screen plans as known support refs', () => {
  const { context, plans } = buildLinkedPlans();
  assert.strictEqual(context.agentDecisions.length, 2);
  assert.deepStrictEqual(plans.map((plan) => plan.requiresModelDecision), [false, false]);
  assert.ok(plans.every((plan) => plan.supportRefs.length === 1));
  assert.ok(plans.every((plan) => plan.supportRefs[0].startsWith('detail-fact:state-record:')));
});

check('all executed screens with applied copy and known fact refs pass content verification', () => {
  const { plans } = buildLinkedPlans();
  const result = buildDetailPageContentVerification({
    state: projectState(),
    screenPlans: plans,
    fillPlans: fillPlansFor(plans),
    executionResults: plans.map((plan) => ({ screenId: plan.screenId, status: 'passed' }))
  });
  assert.strictEqual(result.status, 'passed');
  assert.strictEqual(result.verificationPassed, true);
  assert.strictEqual(result.summary.supportCoverageRatio, 1);
  assert.strictEqual(result.summary.passedScreenCount, 2);
  assert.strictEqual(result.summary.supportedCopyScreenCount, 2);
  assert.strictEqual(result.boundaries.claimsDesignQuality, false);
  const serialized = JSON.stringify(result);
  assert.ok(!serialized.includes('精梳棉'));
  assert.ok(!serialized.includes('轻薄透气'));
});

check('missing refs or applied copy remains needs_review rather than fabricated pass', () => {
  const { plans } = buildLinkedPlans();
  const missingRefs = plans.map((plan) => ({ ...plan, supportRefs: [] }));
  const result = buildDetailPageContentVerification({
    state: projectState(),
    screenPlans: missingRefs,
    fillPlans: fillPlansFor(missingRefs),
    executionResults: missingRefs.map((plan) => ({ screenId: plan.screenId, status: 'passed' }))
  });
  assert.strictEqual(result.status, 'needs_review');
  assert.strictEqual(result.verificationPassed, false);
  assert.ok(result.issueCodes.includes('content_support_ref_missing'));
});

check('legacy project-state strings remain unconfirmed and cannot pass content verification', () => {
  const state = {
    schemaVersion: 'design-project-state/v0',
    productFacts: ['面料采用 80% 精梳棉']
  };
  const catalog = buildDetailPageContentFactCatalog({ state });
  assert.strictEqual(catalog.length, 1);
  assert.strictEqual(catalog[0].evaluationEligible, false);
  const plan = {
    screenId: 1,
    screenName: '材质屏',
    screenType: 'G_MATERIAL',
    mainMessage: '面料采用 80% 精梳棉，触感细腻',
    supportingPoints: [],
    layoutIntent: '材质说明',
    requiresModelDecision: false,
    supportRefs: [catalog[0].ref]
  };
  const result = buildDetailPageContentVerification({
    state,
    screenPlans: [plan],
    fillPlans: [{
      screenId: 1,
      supportRefs: [catalog[0].ref],
      copies: [{ content: plan.mainMessage, generationStatus: 'generated' }]
    }],
    executionResults: [{ screenId: 1, status: 'passed' }]
  });
  assert.strictEqual(result.status, 'needs_review');
  assert.ok(result.issueCodes.includes('content_support_ref_unconfirmed'));
});

check('known refs with unrelated applied copy stay needs_review without semantic guessing', () => {
  const { plans } = buildLinkedPlans();
  const unrelatedCopies = fillPlansFor(plans).map((plan) => ({
    ...plan,
    copies: [{ content: '品质生活新选择', generationStatus: 'generated' }]
  }));
  const result = buildDetailPageContentVerification({
    state: projectState(),
    screenPlans: plans,
    fillPlans: unrelatedCopies,
    executionResults: plans.map((plan) => ({ screenId: plan.screenId, status: 'passed' }))
  });
  assert.strictEqual(result.status, 'needs_review');
  assert.strictEqual(result.summary.supportedCopyScreenCount, 0);
  assert.ok(result.issueCodes.includes('applied_copy_not_supported'));
  assert.strictEqual(result.boundaries.performsSemanticInference, false);
});

check('unknown or unsafe support refs fail closed', () => {
  const { plans } = buildLinkedPlans();
  const forgedPlans = plans.map((plan, index) => ({
    ...plan,
    supportRefs: index === 0
      ? ['detail-fact:product-fact:999']
      : ['C:\\private\\fact.txt']
  }));
  const result = buildDetailPageContentVerification({
    state: projectState(),
    screenPlans: forgedPlans,
    fillPlans: fillPlansFor(forgedPlans),
    executionResults: forgedPlans.map((plan) => ({ screenId: plan.screenId, status: 'passed' }))
  });
  assert.strictEqual(result.status, 'failed');
  assert.ok(result.issueCodes.includes('content_support_ref_unknown'));
  assert.ok(result.issueCodes.includes('content_support_ref_unsafe'));
  assert.ok(!JSON.stringify(result).includes('C:\\private'));
});

check('failed execution or pending model decision remains explicit failure', () => {
  const { plans } = buildLinkedPlans();
  const pendingPlans = plans.map((plan, index) => index === 0
    ? { ...plan, requiresModelDecision: true, mainMessage: '待模型决定' }
    : plan);
  const result = buildDetailPageContentVerification({
    state: projectState(),
    screenPlans: pendingPlans,
    fillPlans: fillPlansFor(pendingPlans),
    executionResults: [
      { screenId: 1, status: 'passed' },
      { screenId: 2, status: 'failed:fill-tool' }
    ]
  });
  assert.strictEqual(result.status, 'failed');
  assert.ok(result.issueCodes.includes('screen_decision_incomplete'));
  assert.ok(result.issueCodes.includes('screen_execution_failed'));
});

check('Evaluation adapter accepts only the versioned content verification contract', () => {
  const selectedProfile = getDesignEvaluationProfileById(DETAIL_PAGE_EVALUATION_PROFILE_ID);
  assert.ok(selectedProfile);
  const { plans } = buildLinkedPlans();
  const detailPageContentVerification = buildDetailPageContentVerification({
    state: projectState(),
    screenPlans: plans,
    fillPlans: fillPlansFor(plans),
    executionResults: plans.map((plan) => ({ screenId: plan.screenId, status: 'passed' }))
  });
  const adapted = adaptDesignEvaluationRecordsFromToolResults({
    profile: selectedProfile,
    toolResults: [{
      name: 'detail-page-design',
      result: {
        success: true,
        data: {
          detailPageAgentResultSummary: {
            summaryVersion: 'detail-page-agent-result-summary/v0',
            status: 'completed'
          },
          stats: { screensProcessed: 2, screensSuccess: 2, screensFailed: 0 },
          screenPlans: plans,
          placementAudit: { success: true, warnings: [], riskyScreenIds: [] },
          livePlacementDiagnostics: { placementCount: 2, unmatchedPlaceholderCount: 0 },
          detailPageContentVerification
        }
      }
    }],
    lastMutationIndex: 0
  });
  const contentRecord = adapted.records.find((record) => record.key === 'detail_page_content_verification');
  assert.strictEqual(contentRecord.status, 'passed');
});

check('executor and ranker retain fact refs without moving logic into Agent core', () => {
  const executorSource = fs.readFileSync(path.join(root, 'src', 'renderer', 'services', 'skill-executors', 'detail-page.executor.ts'), 'utf8');
  const rankerSource = fs.readFileSync(path.join(root, 'src', 'renderer', 'services', 'skill-executors', 'detail-page-asset-ranker.ts'), 'utf8');
  assert.ok(executorSource.includes('buildDetailPageContentVerification({'));
  assert.ok(executorSource.includes('detailPageContentVerification,'));
  assert.ok(rankerSource.includes('supportRefs: screenPlan?.supportRefs || []'));
});

console.log(JSON.stringify({
  success: true,
  contract: 'detail-page-content-verification/v0',
  boundaries: {
    callsModel: false,
    executesTools: false,
    containsFactStatements: false,
    containsPaths: false,
    claimsDesignQuality: false
  }
}, null, 2));
