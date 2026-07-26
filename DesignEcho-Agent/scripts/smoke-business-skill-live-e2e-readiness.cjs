#!/usr/bin/env node
/* eslint-disable no-console */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

require('ts-node').register({
  transpileOnly: true,
  project: path.join(ROOT, 'tsconfig.main.json')
});

const {
  BUSINESS_SKILL_LIVE_E2E_IDS,
  buildBusinessSkillValidationMatrix,
  evaluateBusinessSkillLiveE2EAggregate,
  evaluateBusinessSkillLiveE2EReadiness,
  normalizeBusinessSkillValidationRecord
} = require(path.join(ROOT, 'src', 'shared', 'business-skill-live-e2e-readiness.ts'));
const {
  RUNNERS,
  buildPersistedRunEvidence,
  buildSkillValidationEvidence,
  buildSourceReadiness,
  buildSystemPathContractEvidence,
  evaluatePreflightAcceptance,
  resolvePreflightExitCode
} = require(path.join(ROOT, 'scripts', 'run-business-skill-live-e2e-preflight.cjs'));

function allChecks(value) {
  return {
    runnerPresent: value,
    usesRealAgentRuntime: value,
    usesRealModelProvider: value,
    usesManifestRuntimeStagePlan: value,
    invokesSelectedSkillBridge: value,
    usesLivePhotoshopTools: value,
    usesDisposableDocumentOrOutput: value,
    requiresExplicitLiveOptIn: value,
    requiresExplicitWriteOptIn: value,
    capturesPostWriteReadback: value,
    capturesEvaluationChecks: value,
    capturesDeliveryChecks: value
  };
}

function main() {
  const skippedCannotPass = normalizeBusinessSkillValidationRecord({
    level: 'live',
    state: 'skipped',
    passed: true,
    source: 'fixture'
  });
  assert.strictEqual(skippedCannotPass.state, 'skipped');
  assert.strictEqual(skippedCannotPass.passed, false, 'skipped evidence must never pass.');

  const notExecutedCannotPass = normalizeBusinessSkillValidationRecord({
    level: 'live',
    state: 'not_executed',
    passed: true,
    source: 'fixture'
  });
  assert.strictEqual(notExecutedCannotPass.passed, false, 'not_executed evidence must never pass.');

  const incompleteMatrix = buildBusinessSkillValidationMatrix([
    { level: 'static', state: 'executed', passed: true, source: 'fixture' },
    { level: 'contract', state: 'executed', passed: true, source: 'fixture' }
  ]);
  assert.strictEqual(incompleteMatrix.highestPassedLevel, 'contract');
  assert.strictEqual(incompleteMatrix.levels.simulated.state, 'not_executed');
  assert.strictEqual(incompleteMatrix.levels.live.state, 'not_executed');
  assert.strictEqual(incompleteMatrix.livePassed, false);

  const missing = evaluateBusinessSkillLiveE2EReadiness({
    skillId: 'main-image-design',
    runnerPath: 'missing.cjs',
    checks: allChecks(false)
  });
  assert.strictEqual(missing.status, 'missing_runner');
  assert.strictEqual(missing.ready, false);
  assert(missing.missingChecks.includes('runnerPresent'));

  const readyInputs = BUSINESS_SKILL_LIVE_E2E_IDS.map((skillId) => ({
    skillId,
    runnerPath: `${skillId}.cjs`,
    checks: allChecks(true)
  }));
  const ready = evaluateBusinessSkillLiveE2EAggregate(readyInputs);
  assert.strictEqual(ready.status, 'ready_for_live_run');
  assert.strictEqual(ready.ready, true);

  const sourceReadiness = buildSourceReadiness();
  const systemPath = buildSystemPathContractEvidence();
  assert.strictEqual(sourceReadiness.status, 'partial_coverage');
  assert.strictEqual(sourceReadiness.ready, false);
  assert.deepStrictEqual(
    sourceReadiness.skills.map((skill) => skill.skillId),
    [...BUSINESS_SKILL_LIVE_E2E_IDS]
  );
  for (const skill of sourceReadiness.skills) {
    assert.strictEqual(skill.status, 'partial_runner', `${skill.skillId} must be reported as partial, not complete.`);
    assert.strictEqual(skill.checks.runnerPresent, true, `${skill.skillId} runner must exist.`);
    assert.strictEqual(skill.checks.usesLivePhotoshopTools, true, `${skill.skillId} must retain a real Photoshop path.`);
    assert.strictEqual(skill.checks.requiresExplicitWriteOptIn, true, `${skill.skillId} must require explicit write opt-in.`);
    assert.strictEqual(skill.checks.usesManifestRuntimeStagePlan, false, `${skill.skillId} must not claim manifest coverage before it exists.`);
    assert.strictEqual(skill.checks.invokesSelectedSkillBridge, false, `${skill.skillId} must not claim selected-Skill bridge coverage before it exists.`);
    assert(skill.missingChecks.includes('capturesDeliveryChecks'), `${skill.skillId} must not claim R4 delivery checks.`);
  }

  const detail = sourceReadiness.skills.find((skill) => skill.skillId === 'detail-page-design');
  assert.strictEqual(detail.checks.usesRealAgentRuntime, true);
  assert.strictEqual(detail.checks.usesRealModelProvider, true);

  for (const skillId of ['main-image-design', 'sku-batch']) {
    const skill = sourceReadiness.skills.find((item) => item.skillId === skillId);
    assert.strictEqual(skill.checks.usesRealAgentRuntime, false);
    assert.strictEqual(skill.checks.usesRealModelProvider, false);
  }
  assert.strictEqual(systemPath.ready, true);
  assert.strictEqual(systemPath.checks.coversAllThreeSkills, true);
  assert.strictEqual(systemPath.checks.usesProductionAgentRuntime, true);
  assert.strictEqual(systemPath.checks.usesProductionManifestResolver, true);
  assert.strictEqual(systemPath.checks.usesProductionSkillBridge, true);
  assert.strictEqual(systemPath.checks.preservesFixtureBoundary, true);

  const mainImageRunner = RUNNERS.find((item) => item.skillId === 'main-image-design');
  const fakeMainImage = buildPersistedRunEvidence(mainImageRunner, {
    exists: true,
    reportPath: mainImageRunner.reportPath,
    parseError: null,
    payload: {
      success: true,
      mode: 'guarded-fake-disposable-product-e2e',
      skippedLiveWrite: true
    }
  });
  assert.strictEqual(fakeMainImage.simulated.state, 'executed');
  assert.strictEqual(fakeMainImage.simulated.passed, true);
  assert.strictEqual(fakeMainImage.live.state, 'skipped');
  assert.strictEqual(fakeMainImage.live.passed, false, 'fake adapter evidence must not become live evidence.');

  const liveMainImage = buildPersistedRunEvidence(mainImageRunner, {
    exists: true,
    reportPath: mainImageRunner.reportPath,
    parseError: null,
    payload: {
      success: true,
      mode: 'live-disposable-product-e2e',
      liveWriteArmed: true,
      skippedLiveWrite: false,
      executedTools: ['createDocument', 'placeImage', 'getAcceptanceSnapshot', 'closeDocument'],
      statuses: { runner: 'completed_requires_review' },
      cleanup: { attempted: true, closed: true }
    }
  });
  assert.strictEqual(liveMainImage.live.state, 'executed');
  assert.strictEqual(liveMainImage.live.passed, true);

  const detailRunner = RUNNERS.find((item) => item.skillId === 'detail-page-design');
  const skippedDetail = buildPersistedRunEvidence(detailRunner, {
    exists: true,
    reportPath: detailRunner.reportPath,
    parseError: null,
    payload: {
      success: true,
      skipped: true,
      mode: 'guarded-live-agent-photoshop-detail-page-workflow'
    }
  });
  assert.strictEqual(skippedDetail.simulated.state, 'skipped');
  assert.strictEqual(skippedDetail.live.state, 'skipped');
  assert.strictEqual(skippedDetail.live.passed, false, 'guarded detail-page report must not pass live evidence.');

  const liveDetailPayload = {
    success: true,
    skipped: false,
    mode: 'live-agent-real-model-real-photoshop-detail-page-workflow',
    agent: { toolCount: 9, failedToolCount: 0 },
    requiredSignals: [
      { name: 'created-document', passed: true },
      { name: 'document-not-left-open', passed: true }
    ],
    document: { openAfter: false }
  };
  const liveDetail = buildPersistedRunEvidence(detailRunner, {
    exists: true,
    reportPath: detailRunner.reportPath,
    parseError: null,
    payload: liveDetailPayload
  });
  assert.strictEqual(liveDetail.live.state, 'executed');
  assert.strictEqual(liveDetail.live.passed, true);

  const insufficientDetail = buildPersistedRunEvidence(detailRunner, {
    exists: true,
    reportPath: detailRunner.reportPath,
    parseError: null,
    payload: {
      ...liveDetailPayload,
      requiredSignals: [{ name: 'document-not-left-open', passed: false }]
    }
  });
  assert.strictEqual(insufficientDetail.live.state, 'failed');
  assert.strictEqual(insufficientDetail.live.passed, false, 'success=true without required readback must fail live evidence.');

  const skuRunner = RUNNERS.find((item) => item.skillId === 'sku-batch');
  const liveSku = buildPersistedRunEvidence(skuRunner, {
    exists: true,
    reportPath: skuRunner.reportPath,
    parseError: null,
    payload: {
      success: true,
      skipped: false,
      mode: 'live-configured-execution',
      configuredExecution: {
        executed: true,
        status: 'ready_for_manual_review'
      },
      boundaries: {
        writesPhotoshop: true,
        usesDisposableOutputDir: true
      }
    }
  });
  assert.strictEqual(liveSku.live.state, 'executed');
  assert.strictEqual(liveSku.live.passed, true);

  const missingReports = new Map(RUNNERS.map((runner) => [
    runner.skillId,
    {
      exists: false,
      reportPath: runner.reportPath,
      parseError: null,
      payload: null
    }
  ]));
  const missingReportEvidence = buildSkillValidationEvidence(ready, systemPath, missingReports);
  const readyInfrastructure = {
    photoshopBridgeReachable: true,
    modelProviderReachable: true
  };
  const strictMissingReport = evaluatePreflightAcceptance({
    requireLive: true,
    architecture: ready,
    offlineSystemPath: systemPath,
    infrastructure: readyInfrastructure,
    skillValidation: missingReportEvidence
  });
  assert.strictEqual(strictMissingReport.passed, false);
  assert.strictEqual(strictMissingReport.executionState, 'failed');
  assert(strictMissingReport.blockers.every((item) => item.includes('live_not_executed')), 'missing reports must be explicit strict blockers.');
  assert.strictEqual(resolvePreflightExitCode({ requireLive: true, passed: false }), 1);
  assert.strictEqual(resolvePreflightExitCode({ requireLive: true, passed: true }), 0);
  assert.strictEqual(resolvePreflightExitCode({ requireLive: false, passed: false }), 0, 'advisory preflight may report failure without blocking local inspection.');

  const livePassedSkillEvidence = ready.skills.map((skill) => ({
    skillId: skill.skillId,
    evidence: buildBusinessSkillValidationMatrix([
      { level: 'static', state: 'executed', passed: true, source: 'fixture' },
      { level: 'contract', state: 'executed', passed: true, source: 'fixture' },
      { level: 'live', state: 'executed', passed: true, source: 'fixture' }
    ])
  }));
  const strictPassed = evaluatePreflightAcceptance({
    requireLive: true,
    architecture: ready,
    offlineSystemPath: systemPath,
    infrastructure: readyInfrastructure,
    skillValidation: livePassedSkillEvidence
  });
  assert.strictEqual(strictPassed.passed, true);
  assert.strictEqual(strictPassed.executionState, 'executed');

  const contractSource = fs.readFileSync(
    path.join(ROOT, 'src', 'shared', 'business-skill-live-e2e-readiness.ts'),
    'utf8'
  );
  assert(!contractSource.includes('用户输入'), 'readiness contract must not parse user task text.');
  assert(!contractSource.includes('permissionGranted'), 'readiness contract must not grant runtime permission.');
  assert(!contractSource.includes('qualityPassed'), 'readiness contract must not claim design quality.');

  console.log(JSON.stringify({
    success: true,
    aggregateStatus: sourceReadiness.status,
    skills: sourceReadiness.skills.map((skill) => ({
      skillId: skill.skillId,
      status: skill.status,
      missingChecks: skill.missingChecks
    })),
    checks: [
      'fail-closed readiness evaluation',
      'static, contract, simulated and live evidence levels use explicit execution states',
      'skipped and not_executed evidence can never pass',
      'require-live fails on missing or insufficient persisted runner reports',
      'three current runners are reported as partial coverage',
      'offline production Agent/Manifest/Capability/Skill topology is present and explicitly fixture-bounded',
      'detail-page real Agent/provider evidence is distinguished from Manifest/Skill bridge evidence',
      'live write opt-in and delivery evidence boundaries are explicit'
    ]
  }, null, 2));
}

main();
