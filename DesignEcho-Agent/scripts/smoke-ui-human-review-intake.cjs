#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '..', 'tsconfig.main.json')
});

const {
  buildHumanReviewIntake
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'human-review-intake.ts'));
const {
  buildHumanReviewRecord
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'human-review-record.ts'));

const ROOT = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function exists(relativePath) {
  return fs.existsSync(path.join(ROOT, relativePath));
}

function assert(condition, message, details) {
  if (!condition) {
    const suffix = details ? `\n${JSON.stringify(details, null, 2)}` : '';
    throw new Error(`${message}${suffix}`);
  }
}

const missingSource = buildHumanReviewIntake({
  scenario: 'main-image',
  source: null,
  draft: { decision: 'approved', reviewer: 'designer', score: 0.9, notes: 'ok' },
  generatedAt: '2026-05-27T00:00:00.000Z'
});
assert(missingSource.status === 'blocked_missing_review_source', 'missing source should block review draft', missingSource);
assert(missingSource.canPrepareReviewDraft === false, 'missing source cannot prepare review draft', missingSource);
assert(missingSource.canRecordReview === false, 'missing source must not record review', missingSource);

const waitingDecision = buildHumanReviewIntake({
  scenario: 'main-image',
  source: { kind: 'qa_report', stage: 'needs_manual_review', summary: '需要人工复核' },
  draft: {},
  generatedAt: '2026-05-27T00:00:00.000Z'
});
assert(waitingDecision.status === 'awaiting_review_decision', 'source with empty draft should wait for review decision', waitingDecision);
assert(waitingDecision.requiredFields.includes('decision'), 'empty draft should require decision', waitingDecision);

const approvedMissingReviewer = buildHumanReviewIntake({
  scenario: 'main-image',
  source: { kind: 'qa_report', stage: 'needs_manual_review', summary: '需要人工复核' },
  draft: { decision: 'approved', score: 0.88 },
  generatedAt: '2026-05-27T00:00:00.000Z'
});
assert(approvedMissingReviewer.status === 'blocked_reviewer_required', 'approved review should require reviewer', approvedMissingReviewer);
assert(approvedMissingReviewer.requiredFields.includes('reviewer'), 'approved review should expose reviewer field requirement', approvedMissingReviewer);

const approvedMissingScore = buildHumanReviewIntake({
  scenario: 'main-image',
  source: { kind: 'qa_report', stage: 'needs_manual_review', summary: '需要人工复核' },
  draft: { decision: 'approved', reviewer: 'designer' },
  generatedAt: '2026-05-27T00:00:00.000Z'
});
assert(approvedMissingScore.status === 'blocked_score_required', 'approved review should require score', approvedMissingScore);
assert(approvedMissingScore.requiredFields.includes('score'), 'approved review should expose score field requirement', approvedMissingScore);

const rejected = buildHumanReviewIntake({
  scenario: 'main-image',
  source: { kind: 'qa_report', stage: 'needs_manual_review', summary: '像素探针通过但版式不够稳' },
  draft: {
    decision: 'rejected',
    reviewer: 'designer',
    score: 0.3,
    notes: ['不要保存 data:image/png;base64,AAAA', 'C:\\tmp\\bad.png 这张不行']
  },
  generatedAt: '2026-05-27T00:00:00.000Z'
});
assert(rejected.status === 'draft_ready', 'rejected review with reviewer should prepare draft', rejected);
assert(rejected.reviewDraft.decision === 'rejected', 'review draft should preserve rejected decision', rejected);
assert(rejected.reviewDraft.notes.every((item) => !item.includes('data:image') && !item.includes('C:\\')), 'review notes should redact raw image payloads and paths', rejected.reviewDraft);
assert(rejected.canRecordReview === true, 'ready review intake should be recordable after record adapter exists', rejected);
assert(rejected.canClaimDesignQuality === false, 'review intake must not claim design quality', rejected);
assert(rejected.canRunProvider === false, 'review intake must not run providers', rejected);
assert(rejected.canRunPhotoshop === false, 'review intake must not run Photoshop', rejected);

const approved = buildHumanReviewIntake({
  scenario: 'main-image',
  source: { kind: 'qa_report', stage: 'needs_manual_review', summary: '结果图、pixel probe 已就绪' },
  draft: {
    decision: 'approved',
    reviewer: 'designer',
    score: 0.92,
    notes: ['构图稳定', '文案可读']
  },
  generatedAt: '2026-05-27T00:00:00.000Z'
});
assert(approved.status === 'draft_ready', 'approved review with reviewer and score should prepare draft', approved);
assert(approved.canPrepareReviewDraft === true, 'valid approved review should prepare draft', approved);
assert(approved.canRecordReview === true, 'valid approved review should be recordable', approved);
assert(approved.reviewDraft.decision === 'approved', 'approved draft should preserve decision', approved);
assert(approved.reviewDraft.score === 0.92, 'approved draft should preserve bounded score', approved);
assert(approved.boundary.includes('本地复核记录'), 'review intake boundary should state local record behavior', approved);

const approvedRecord = buildHumanReviewRecord({
  projectId: 'C-1160',
  recordId: 'human-review-smoke-approved',
  recordedAt: '2026-05-27T00:00:01.000Z',
  intake: approved
});
assert(approvedRecord.recordVersion === 'human-review-record/v0', 'record contract should expose version', approvedRecord);
assert(approvedRecord.status === 'recorded_approved', 'approved intake should build approved record', approvedRecord);
assert(approvedRecord.canPersist === true, 'valid approved record should be persistable', approvedRecord);
assert(approvedRecord.qualityClaim.allowed === false, 'human review record must not claim design quality', approvedRecord);
assert(approvedRecord.canClaimDesignQuality === false, 'human review record must keep design quality claim disabled', approvedRecord);
assert(approvedRecord.canRunProvider === false, 'human review record must not run providers', approvedRecord);
assert(approvedRecord.canRunPhotoshop === false, 'human review record must not run Photoshop', approvedRecord);

const combinedText = JSON.stringify({ missingSource, waitingDecision, approvedMissingReviewer, approvedMissingScore, rejected, approved, approvedRecord });
for (const forbidden of ['confidence', '置信', 'data:image', 'rawImage', 'base64', 'C:\\tmp']) {
  assert(!combinedText.includes(forbidden), `human review intake payload must not expose forbidden marker: ${forbidden}`);
}

const workbench = read('src/renderer/components/DesignAgentWorkbench.tsx');
const packageJson = read('package.json');
const changeBoundaries = read('scripts/report-change-boundaries.cjs');
const maintenance = read('scripts/validate-maintenance-hygiene.cjs');

assert(!workbench.includes('buildHumanReviewIntake'), 'Workbench should not mount human review intake by default');
assert(!workbench.includes('buildHumanReviewRecord') && !workbench.includes('recordHumanReview'), 'Workbench should not connect hidden review intake to record persistence');
assert(!workbench.includes('getMemoryService'), 'Workbench should not load review records for a removed right rail');
assert(!workbench.includes('data-testid="workbench-human-review-panel"'), 'Workbench should not expose human review panel in the default surface');
assert(!workbench.includes('data-testid="workbench-human-review-decision"'), 'Workbench should not expose review decision controls in the default surface');
assert(!workbench.includes('data-testid="workbench-human-review-score"'), 'Workbench should not expose review score input in the default surface');
assert(!workbench.includes('data-testid="workbench-human-review-notes"'), 'Workbench should not expose review notes input in the default surface');
assert(!workbench.includes('data-testid="workbench-human-review-record-button"'), 'Workbench should not expose record review action in the default surface');
assert(!workbench.includes('data-testid="workbench-human-review-record-list"'), 'Workbench should not expose local review records in the default surface');
assert(!workbench.includes('window.designEcho'), 'Workbench review intake must not call desktop APIs directly');
assert(!workbench.includes('executeToolCall'), 'Workbench review intake must not execute tools');
assert(!workbench.includes('processWithUnifiedAgent'), 'Workbench review intake must not call Agent runtime');
assert(packageJson.includes('"smoke:ui:human-review-intake"'), 'package script should expose human review intake smoke');
assert(packageJson.includes('"smoke:ui:human-review-record-persistence"'), 'package script should expose human review record persistence smoke');
assert(packageJson.includes('smoke:ui:human-review-intake'), 'maintenance preflight should run human review intake smoke');
assert(packageJson.includes('smoke:ui:human-review-record-persistence'), 'maintenance preflight should run human review record persistence smoke');
assert(changeBoundaries.includes('human-review-intake'), 'change boundaries should include shared human review intake contract');
assert(changeBoundaries.includes('human-review-record'), 'change boundaries should include shared human review record contract');
assert(maintenance.includes('smoke-ui-human-review-intake.cjs'), 'maintenance hygiene should run/check human review intake smoke');
assert(maintenance.includes('smoke-human-review-record-persistence.cjs'), 'maintenance hygiene should run/check human review record persistence smoke');
assert(exists('src/shared/human-review-intake.ts'), 'shared human review intake contract should exist');
assert(exists('src/shared/human-review-record.ts'), 'shared human review record contract should exist');

console.log(JSON.stringify({
  success: true,
  checks: [
    'human review intake normalizes missing source, empty decision, reviewer-required, score-required and valid draft states',
    'human review draft sanitizes raw/base64 image payloads and local paths',
    'human review intake can be recorded only after draft readiness and still cannot call provider, call Photoshop or claim design quality',
    'human review record contract captures local review evidence without upgrading it to final design acceptance',
    'Workbench no longer exposes human review controls in the default user surface',
    'package, maintenance preflight, change boundaries and maintenance hygiene are wired for intake and persistence'
  ]
}, null, 2));
