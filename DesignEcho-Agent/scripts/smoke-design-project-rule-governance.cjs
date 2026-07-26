#!/usr/bin/env node
'use strict';

const assert = require('assert');
const path = require('path');

require('ts-node').register({ transpileOnly: true, project: path.resolve(__dirname, '..', 'tsconfig.main.json') });

const root = path.resolve(__dirname, '..');
const {
  applyDesignProjectRuleOperations,
  buildDesignProjectRulePolicy,
  canDesignProjectRuleActAsPolicy,
  listDesignProjectRuleRecords,
  normalizeDesignProjectRuleRecords
} = require(path.join(root, 'src', 'shared', 'design-project-rule-governance.ts'));
const {
  applyDesignProjectStatePatch,
  buildDesignProjectStateSummary,
  createEmptyDesignProjectState
} = require(path.join(root, 'src', 'shared', 'design-project-state.ts'));
const {
  buildDesignProjectRuleReviewCard,
  buildDesignProjectRuleReviewPatch,
  doesDesignProjectRuleReviewCardMatchState,
  validateDesignProjectRuleReviewCardValue
} = require(path.join(root, 'src', 'shared', 'design-project-rule-review-card.ts'));

function check(name, fn) {
  fn();
  console.log(`  ✓ ${name}`);
}

function candidate(statement, enforcement = 'guidance', sourceKind = 'agent_inference', constraintKey) {
  return {
    ruleKind: 'visual_style',
    statement,
    ...(constraintKey ? { constraintKey } : {}),
    enforcement,
    applicability: { taskTypes: ['detail-page'] },
    source: {
      kind: sourceKind,
      sourceRef: sourceKind === 'brand_guideline' ? 'brand-guideline:fixture-v1' : 'design-memory:fixture'
    },
    requestedConfirmation: 'user_confirmed'
  };
}

console.log('smoke: design-project-rule-governance');

check('Agent proposal cannot self-confirm a project rule', () => {
  const [rule] = applyDesignProjectRuleOperations({
    upsertRules: [candidate('保持年轻简洁')],
    authority: 'agent_proposal',
    now: '2026-07-12T12:00:00.000Z'
  });
  assert.strictEqual(rule.confirmation, 'unverified');
  assert.strictEqual(canDesignProjectRuleActAsPolicy(rule), false);
});

check('Trusted system requires a supported source reference', () => {
  const [unsafe] = applyDesignProjectRuleOperations({
    upsertRules: [candidate('保持年轻简洁', 'quality_gate')],
    authority: 'trusted_system'
  });
  assert.strictEqual(unsafe.confirmation, 'unverified');
  const [safe] = applyDesignProjectRuleOperations({
    upsertRules: [{ ...candidate('品牌主色不超过三种', 'quality_gate', 'brand_guideline'), requestedConfirmation: 'source_supported' }],
    authority: 'trusted_system'
  });
  assert.strictEqual(safe.confirmation, 'source_supported');
});

check('User review activates a rule without granting tool permission', () => {
  const pending = applyDesignProjectRuleOperations({ upsertRules: [candidate('保留商品真实纹理', 'quality_gate')] });
  const confirmed = applyDesignProjectRuleOperations({
    current: pending,
    reviewRules: [{ ruleId: pending[0].ruleId, decision: 'confirm' }],
    authority: 'user_review',
    updatedBy: 'user'
  });
  const policy = buildDesignProjectRulePolicy({ schemaVersion: 'design-project-state/v0', ruleRecords: confirmed }, { taskType: 'detail-page' });
  assert.strictEqual(policy.qualityGateRules.length, 1);
  assert.strictEqual(policy.doesNotGrantToolPermission, true);
  assert.strictEqual(policy.canClaimQualityPass, true);
});

check('Pending critical rule blocks quality-pass claim until reviewed', () => {
  const pending = applyDesignProjectRuleOperations({ upsertRules: [candidate('交付前检查产品纹理', 'quality_gate')] });
  const policy = buildDesignProjectRulePolicy({ schemaVersion: 'design-project-state/v0', ruleRecords: pending }, { taskType: 'detail-page' });
  assert.strictEqual(policy.status, 'needs_review');
  assert.strictEqual(policy.canClaimQualityPass, false);
});

check('Legacy brandStyle remains unverified guidance only', () => {
  const rules = listDesignProjectRuleRecords({ schemaVersion: 'design-project-state/v0', brandStyle: '年轻、简洁' });
  assert.strictEqual(rules.length, 1);
  assert.strictEqual(rules[0].confirmation, 'unverified');
  assert.strictEqual(rules[0].sources[0].kind, 'legacy_brand_style');
});

check('Rule provenance strips local paths and sensitive source refs', () => {
  const [rule] = applyDesignProjectRuleOperations({
    upsertRules: [{
      ...candidate('使用品牌蓝'),
      source: { kind: 'project_brief', sourceRef: 'C:\\private\\brief.docx', supportRefs: ['project-brief:safe-v1'] }
    }]
  });
  const serialized = JSON.stringify(rule);
  assert.ok(!serialized.includes('C:\\private'));
  assert.ok(serialized.includes('project-brief:safe-v1'));
});

check('Conflicting confirmed rules are explicit and block quality-pass claim', () => {
  const pending = applyDesignProjectRuleOperations({
    upsertRules: [
      candidate('使用高饱和红色', 'quality_gate', 'agent_inference', 'primary_color'),
      candidate('禁止高饱和红色', 'quality_gate', 'agent_inference', 'primary_color')
    ]
  });
  const confirmed = applyDesignProjectRuleOperations({
    current: pending,
    reviewRules: pending.map((rule) => ({ ruleId: rule.ruleId, decision: 'confirm' })),
    authority: 'user_review'
  });
  const policy = buildDesignProjectRulePolicy({ schemaVersion: 'design-project-state/v0', ruleRecords: confirmed }, { taskType: 'detail-page' });
  assert.strictEqual(policy.status, 'conflict');
  assert.strictEqual(policy.conflicts.length, 1);
  assert.strictEqual(policy.canClaimQualityPass, false);
});

check('Compatible rules of the same kind are not guessed as conflicts', () => {
  const pending = applyDesignProjectRuleOperations({
    upsertRules: [candidate('使用品牌蓝'), candidate('保留商品真实纹理')]
  });
  const confirmed = applyDesignProjectRuleOperations({
    current: pending,
    reviewRules: pending.map((rule) => ({ ruleId: rule.ruleId, decision: 'confirm' })),
    authority: 'user_review'
  });
  const policy = buildDesignProjectRulePolicy({ schemaVersion: 'design-project-state/v0', ruleRecords: confirmed }, { taskType: 'detail-page' });
  assert.strictEqual(policy.conflicts.length, 0);
});

check('Rules support explicit supersede and revoke lifecycle', () => {
  const pending = applyDesignProjectRuleOperations({ upsertRules: [candidate('使用暖色调'), candidate('使用冷色调')] });
  const superseded = applyDesignProjectRuleOperations({
    current: pending,
    reviewRules: [{ ruleId: pending[0].ruleId, decision: 'supersede', supersededByRuleId: pending[1].ruleId }],
    authority: 'user_review'
  });
  assert.strictEqual(superseded.find((rule) => rule.ruleId === pending[0].ruleId).status, 'superseded');
  const revoked = applyDesignProjectRuleOperations({
    current: superseded,
    reviewRules: [{ ruleId: pending[1].ruleId, decision: 'revoke' }],
    authority: 'user_review'
  });
  assert.strictEqual(revoked.find((rule) => rule.ruleId === pending[1].ruleId).status, 'revoked');
});

check('Tampered confirmed rule is downgraded to unverified', () => {
  const pending = applyDesignProjectRuleOperations({ upsertRules: [candidate('避免过度营销')] });
  const confirmed = applyDesignProjectRuleOperations({
    current: pending,
    reviewRules: [{ ruleId: pending[0].ruleId, decision: 'confirm' }],
    authority: 'user_review'
  });
  const tampered = [{ ...confirmed[0], reviewedBy: 'attacker' }];
  const [normalized] = normalizeDesignProjectRuleRecords(tampered);
  assert.strictEqual(normalized.confirmation, 'unverified');
  assert.match(normalized.reviewNote, /完整性校验失败/);
});

check('Deterministic review card rejects stale state and writes user review', () => {
  const state = applyDesignProjectStatePatch(createEmptyDesignProjectState(), {
    upsertRules: [candidate('正文使用清晰无衬线字体', 'quality_gate')],
    ruleWriteAuthority: 'agent_proposal'
  });
  const card = buildDesignProjectRuleReviewCard({ state, projectIdentity: 'C:/project/rule-smoke' });
  assert(card);
  const validation = validateDesignProjectRuleReviewCardValue(card.payload, {
    decisions: card.payload.rules.map((rule) => ({ ruleId: rule.ruleId, decision: 'confirm' }))
  });
  assert.strictEqual(validation.canSubmit, true);
  const updated = applyDesignProjectStatePatch(state, buildDesignProjectRuleReviewPatch({ card, value: validation.normalizedValue }));
  assert.strictEqual(updated.ruleRecords[0].confirmation, 'user_confirmed');
  assert.strictEqual(doesDesignProjectRuleReviewCardMatchState({ card, state: updated, projectIdentity: 'C:/project/rule-smoke' }), false);
});

check('Ordinary set cannot overwrite governed rule records', () => {
  const state = applyDesignProjectStatePatch(createEmptyDesignProjectState(), { upsertRules: [candidate('标题简洁')] });
  const next = applyDesignProjectStatePatch(state, { set: { ruleRecords: [] } });
  assert.strictEqual(next.ruleRecords.length, 1);
});

check('State summary distinguishes legacy reference, confirmed rules, pending and approval', () => {
  const pending = applyDesignProjectRuleOperations({ upsertRules: [candidate('发布前由品牌负责人审批', 'approval_required')] });
  const confirmed = applyDesignProjectRuleOperations({
    current: pending,
    reviewRules: [{ ruleId: pending[0].ruleId, decision: 'confirm' }],
    authority: 'user_review'
  });
  const summary = buildDesignProjectStateSummary({
    schemaVersion: 'design-project-state/v0',
    brandStyle: '旧风格文本',
    taskType: 'detail-page',
    ruleRecords: confirmed
  });
  assert.match(summary, /旧品牌风格参考（未确认）/);
  assert.match(summary, /approval_required/);
  assert.match(summary, /不授予工具执行权限/);
});

console.log('smoke-design-project-rule-governance passed (13 checks)');
