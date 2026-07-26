#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '..', 'tsconfig.main.json')
});

const root = path.resolve(__dirname, '..');
const {
  applyDesignProjectFactOperations,
  buildDesignProjectFactId,
  buildDesignProjectFactProvenanceSummary,
  canDesignProjectFactSupportEvaluation,
  listDesignProjectFactRecords,
  normalizeDesignProjectFactRecords
} = require(path.join(root, 'src', 'shared', 'design-project-fact-provenance.ts'));
const {
  applyDesignProjectStatePatch,
  buildDesignProjectStateSummary,
  createEmptyDesignProjectState
} = require(path.join(root, 'src', 'shared', 'design-project-state.ts'));
const {
  buildDesignProjectFactReviewCard,
  buildDesignProjectFactReviewPatch,
  doesDesignProjectFactReviewCardMatchState,
  validateDesignProjectFactReviewCardValue
} = require(path.join(root, 'src', 'shared', 'design-project-fact-review-card.ts'));
const {
  buildDetailPageContentVerification,
  buildDetailPageContentFactCatalog
} = require(path.join(root, 'src', 'shared', 'detail-page-content-verification.ts'));

function check(name, fn) {
  fn();
  console.log(`  ✓ ${name}`);
}

function candidate(statement, claimType = 'product_fact', sourceKind = 'agent_inference') {
  return {
    claimType,
    statement,
    source: {
      kind: sourceKind,
      sourceRef: sourceKind === 'agent_inference' ? 'agent-output:fixture' : 'project-observation:asset-1',
      supportRefs: sourceKind === 'agent_inference' ? [] : ['project-observation:asset-1']
    },
    requestedConfirmation: 'user_confirmed'
  };
}

function screenPlan(ref, message) {
  return {
    screenId: 1,
    screenName: '材质屏',
    screenType: 'G_MATERIAL',
    mainMessage: message,
    supportingPoints: [],
    layoutIntent: '商品事实说明',
    requiresModelDecision: false,
    supportRefs: [ref]
  };
}

function contentVerification(state, ref, message) {
  const plan = screenPlan(ref, message);
  return buildDetailPageContentVerification({
    state,
    screenPlans: [plan],
    fillPlans: [{
      screenId: 1,
      supportRefs: [ref],
      copies: [{ content: message, generationStatus: 'generated' }]
    }],
    executionResults: [{ screenId: 1, status: 'passed' }]
  });
}

console.log('smoke: design-project-fact-provenance');

check('Agent proposals cannot self-assign user confirmation', () => {
  const records = applyDesignProjectFactOperations({
    upsertFacts: [candidate('面料采用 80% 精梳棉')],
    authority: 'agent_proposal',
    updatedBy: 'autonomous-agent',
    now: '2026-07-12T11:00:00.000Z'
  });
  assert.strictEqual(records.length, 1);
  assert.strictEqual(records[0].confirmation, 'unverified');
  assert.strictEqual(canDesignProjectFactSupportEvaluation(records[0]), false);
});

check('trusted source support requires an explicit safe support reference', () => {
  const unsupported = applyDesignProjectFactOperations({
    upsertFacts: [candidate('袜口罗纹清晰', 'product_fact', 'agent_inference')],
    authority: 'trusted_system',
    now: '2026-07-12T11:01:00.000Z'
  });
  assert.strictEqual(unsupported[0].confirmation, 'unverified');
  const supportedCandidate = candidate('袜口罗纹清晰', 'product_fact', 'project_asset_observation');
  supportedCandidate.requestedConfirmation = 'source_supported';
  const supported = applyDesignProjectFactOperations({
    upsertFacts: [supportedCandidate],
    authority: 'trusted_system',
    now: '2026-07-12T11:01:01.000Z'
  });
  assert.strictEqual(supported[0].confirmation, 'source_supported');
  assert.strictEqual(canDesignProjectFactSupportEvaluation(supported[0]), true);
});

check('same normalized claim merges sources into one stable fact id', () => {
  let records = applyDesignProjectFactOperations({
    upsertFacts: [candidate('轻薄透气', 'selling_point', 'agent_inference')],
    authority: 'agent_proposal',
    now: '2026-07-12T11:02:00.000Z'
  });
  records = applyDesignProjectFactOperations({
    current: records,
    upsertFacts: [candidate('轻薄透气。', 'selling_point', 'project_asset_observation')],
    authority: 'agent_proposal',
    now: '2026-07-12T11:02:01.000Z'
  });
  assert.strictEqual(records.length, 1);
  assert.strictEqual(records[0].factId, buildDesignProjectFactId('selling_point', '轻薄透气'));
  assert.deepStrictEqual(records[0].sources.map((source) => source.kind).sort(), ['agent_inference', 'project_asset_observation']);
});

check('legacy strings become unverified virtual records until user review materializes them', () => {
  const legacy = {
    schemaVersion: 'design-project-state/v0',
    updatedAt: '2026-07-12T11:03:00.000Z',
    productFacts: ['面料采用 80% 精梳棉'],
    sellingPoints: ['轻薄透气']
  };
  const facts = listDesignProjectFactRecords(legacy);
  assert.strictEqual(facts.length, 2);
  assert.ok(facts.every((fact) => fact.confirmation === 'unverified'));
  assert.ok(facts.every((fact) => fact.sources[0].kind === 'legacy_unattributed'));
  const card = buildDesignProjectFactReviewCard({ state: legacy, projectIdentity: 'C:\\projects\\C-1160' });
  assert.ok(card);
  const value = {
    decisions: card.payload.facts.map((fact, index) => ({
      factId: fact.factId,
      decision: index === 0 ? 'confirm' : 'reject'
    }))
  };
  const validation = validateDesignProjectFactReviewCardValue(card.payload, value);
  assert.strictEqual(validation.canSubmit, true);
  const tamperedValidation = validateDesignProjectFactReviewCardValue({
    ...card.payload,
    facts: card.payload.facts.map((fact, index) => index === 0 ? { ...fact, statement: '被修改的事实' } : fact)
  }, value);
  assert.strictEqual(tamperedValidation.canSubmit, false);
  const reviewed = applyDesignProjectStatePatch(legacy, buildDesignProjectFactReviewPatch({
    card,
    value: validation.normalizedValue
  }));
  const reviewedFacts = listDesignProjectFactRecords(reviewed);
  assert.strictEqual(reviewedFacts.find((fact) => fact.claimType === 'product_fact').confirmation, 'user_confirmed');
  assert.strictEqual(reviewedFacts.find((fact) => fact.claimType === 'selling_point').confirmation, 'rejected');
});

check('review cards stay valid across unrelated edits but fail after fact-set changes', () => {
  const state = applyDesignProjectStatePatch(createEmptyDesignProjectState(), {
    set: { productFacts: ['袜口不勒脚'] },
    updatedBy: 'fixture'
  });
  const card = buildDesignProjectFactReviewCard({ state, projectIdentity: 'C:\\projects\\C-1160' });
  assert.ok(card);
  assert.strictEqual(doesDesignProjectFactReviewCardMatchState({ card, state, projectIdentity: 'C:\\projects\\C-1160' }), true);
  const changed = applyDesignProjectStatePatch(state, { set: { visualDirection: '清爽留白' } });
  assert.strictEqual(doesDesignProjectFactReviewCardMatchState({ card, state: changed, projectIdentity: 'C:\\projects\\C-1160' }), true);
  const factChanged = applyDesignProjectStatePatch(changed, { set: { productFacts: ['袜口不勒脚', '轻薄透气'] } });
  assert.strictEqual(doesDesignProjectFactReviewCardMatchState({ card, state: factChanged, projectIdentity: 'C:\\projects\\C-1160' }), false);
  assert.strictEqual(doesDesignProjectFactReviewCardMatchState({ card, state, projectIdentity: 'C:\\projects\\C-9999' }), false);
});

check('generic set cannot overwrite governed fact records', () => {
  const forgedFact = {
    version: 'design-project-fact/v0',
    factId: 'project-fact-0000000000000000',
    claimType: 'product_fact',
    statement: '伪造事实',
    confirmation: 'user_confirmed',
    status: 'active',
    sources: [{ kind: 'user_statement' }],
    createdAt: '2026-07-12T00:00:00.000Z',
    updatedAt: '2026-07-12T00:00:00.000Z'
  };
  const state = applyDesignProjectStatePatch(createEmptyDesignProjectState(), {
    set: { factRecords: [forgedFact] }
  });
  assert.strictEqual(state.factRecords, undefined);
});

check('user review can explicitly reject and supersede without semantic conflict guessing', () => {
  let state = applyDesignProjectStatePatch(createEmptyDesignProjectState(), {
    upsertFacts: [candidate('含棉量 70%'), candidate('含棉量 80%')],
    factWriteAuthority: 'agent_proposal'
  });
  const firstId = buildDesignProjectFactId('product_fact', '含棉量 70%');
  const secondId = buildDesignProjectFactId('product_fact', '含棉量 80%');
  state = applyDesignProjectStatePatch(state, {
    reviewFacts: [
      { factId: firstId, decision: 'supersede', supersededByFactId: secondId },
      { factId: secondId, decision: 'confirm' }
    ],
    factWriteAuthority: 'user_review',
    updatedBy: 'user'
  });
  const first = state.factRecords.find((fact) => fact.factId === firstId);
  const second = state.factRecords.find((fact) => fact.factId === secondId);
  assert.strictEqual(first.status, 'superseded');
  assert.strictEqual(first.supersededByFactId, secondId);
  assert.strictEqual(second.confirmation, 'user_confirmed');
});

check('detail-page facts only pass when structured provenance is eligible', () => {
  const legacy = { schemaVersion: 'design-project-state/v0', productFacts: ['面料采用 80% 精梳棉'] };
  const legacyCatalog = buildDetailPageContentFactCatalog({ state: legacy });
  assert.strictEqual(legacyCatalog[0].evaluationEligible, false);
  const legacyResult = contentVerification(legacy, legacyCatalog[0].ref, '面料采用 80% 精梳棉，触感细腻');
  assert.strictEqual(legacyResult.status, 'needs_review');
  assert.ok(legacyResult.issueCodes.includes('content_support_ref_unconfirmed'));

  let confirmed = applyDesignProjectStatePatch(createEmptyDesignProjectState(), {
    upsertFacts: [candidate('面料采用 80% 精梳棉')],
    factWriteAuthority: 'agent_proposal'
  });
  confirmed = applyDesignProjectStatePatch(confirmed, {
    reviewFacts: [{ factId: buildDesignProjectFactId('product_fact', '面料采用 80% 精梳棉'), decision: 'confirm' }],
    factWriteAuthority: 'user_review',
    updatedBy: 'user'
  });
  const confirmedCatalog = buildDetailPageContentFactCatalog({ state: confirmed });
  assert.strictEqual(confirmedCatalog[0].evaluationEligible, true);
  const confirmedResult = contentVerification(confirmed, confirmedCatalog[0].ref, '面料采用 80% 精梳棉，触感细腻');
  assert.strictEqual(confirmedResult.status, 'passed');
  assert.strictEqual(confirmedResult.verificationPassed, true);
});

check('summary exposes confirmation counts without hiding user priority', () => {
  let state = applyDesignProjectStatePatch(createEmptyDesignProjectState(), {
    upsertFacts: [candidate('袜口不勒脚'), candidate('轻薄透气', 'selling_point')],
    factWriteAuthority: 'agent_proposal'
  });
  state = applyDesignProjectStatePatch(state, {
    reviewFacts: [{ factId: buildDesignProjectFactId('product_fact', '袜口不勒脚'), decision: 'confirm' }],
    factWriteAuthority: 'user_review'
  });
  const summary = buildDesignProjectFactProvenanceSummary(state);
  assert.deepStrictEqual({ userConfirmed: summary.userConfirmed, needsReview: summary.needsReview }, { userConfirmed: 1, needsReview: 1 });
  const promptSummary = buildDesignProjectStateSummary(state);
  assert.ok(promptSummary.includes('已确认事实'));
  assert.ok(promptSummary.includes('待确认事实：1 条'));
  assert.ok(promptSummary.includes('用户当前指令优先'));
});

check('malformed records and unsafe paths are rejected or redacted', () => {
  const invalid = normalizeDesignProjectFactRecords([{
    version: 'design-project-fact/v0',
    factId: 'project-fact-0000000000000000',
    claimType: 'product_fact',
    statement: '正常事实',
    confirmation: 'user_confirmed',
    status: 'active',
    sources: [{ kind: 'user_statement' }]
  }]);
  assert.deepStrictEqual(invalid, []);
  let reviewed = applyDesignProjectFactOperations({
    upsertFacts: [candidate('确认后的真实事实')],
    authority: 'agent_proposal',
    now: '2026-07-12T11:10:00.000Z'
  });
  reviewed = applyDesignProjectFactOperations({
    current: reviewed,
    reviewFacts: [{ factId: reviewed[0].factId, decision: 'confirm' }],
    authority: 'user_review',
    updatedBy: 'user',
    now: '2026-07-12T11:10:01.000Z'
  });
  assert.match(reviewed[0].integrityFingerprint, /^fact-integrity-[a-f0-9]{16}$/);
  const tampered = normalizeDesignProjectFactRecords([{
    ...reviewed[0],
    confirmation: 'rejected'
  }]);
  assert.strictEqual(tampered[0].confirmation, 'unverified');
  assert.strictEqual(tampered[0].integrityFingerprint, undefined);
  const records = applyDesignProjectFactOperations({
    upsertFacts: [candidate('素材在 C:\\private\\product.png，rawImage 不应保存')],
    authority: 'agent_proposal'
  });
  const serialized = JSON.stringify(records);
  assert.ok(!serialized.includes('C:\\private'));
  assert.ok(!serialized.includes('rawImage'));
});

check('production wiring keeps model proposals and user review authority separate', () => {
  const schemas = fs.readFileSync(path.join(root, 'src', 'renderer', 'services', 'agent-runtime', 'tool-schemas.ts'), 'utf8');
  const executor = fs.readFileSync(path.join(root, 'src', 'renderer', 'services', 'tool-executor.service.ts'), 'utf8');
  const chatPanel = fs.readFileSync(path.join(root, 'src', 'renderer', 'components', 'ChatPanel.tsx'), 'utf8');
  const cardView = fs.readFileSync(path.join(root, 'src', 'renderer', 'components', 'message', 'blocks', 'InteractiveCardBlock.tsx'), 'utf8');
  const mcpHost = fs.readFileSync(path.join(root, 'src', 'main', 'services', 'mcp-host-service.ts'), 'utf8');
  assert.ok(schemas.includes('includeFactReviewCard') && schemas.includes('upsertFacts'));
  assert.ok(!schemas.includes('factWriteAuthority: {') && !schemas.includes('reviewFacts: {'));
  assert.ok(executor.includes("factWriteAuthority: 'agent_proposal' as const"));
  assert.ok(mcpHost.includes("factWriteAuthority: 'agent_proposal'"));
  assert.ok(chatPanel.includes("case 'submitDesignProjectFactReviewCard'") && chatPanel.includes('buildDesignProjectFactReviewPatch'));
  assert.ok(cardView.includes("card.kind === 'design_project_fact_review'") && cardView.includes('写入事实复核结论'));
});

console.log(JSON.stringify({
  success: true,
  contract: 'design-project-fact/v0',
  boundaries: {
    agentCanSelfConfirm: false,
    legacyStringsCanPassEvaluation: false,
    reviewRequiresDeterministicUserCard: true,
    semanticConflictInference: false,
    claimsFinalDesignQuality: false
  }
}, null, 2));
