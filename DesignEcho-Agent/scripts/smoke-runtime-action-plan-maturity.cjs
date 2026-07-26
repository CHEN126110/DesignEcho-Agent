'use strict';

const assert = require('assert');
const path = require('path');

require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '..', 'tsconfig.main.json')
});

const root = path.resolve(__dirname, '..');
const { evaluateRuntimeActionPlanMaturity } = require(path.join(
  root,
  'src',
  'shared',
  'agent-runtime-v5',
  'runtime-action-plan-maturity.ts'
));

function reconciliation(metrics) {
  return {
    version: 'runtime-action-plan-reconciliation/v0',
    status: 'completed',
    planReadiness: 'ready',
    steps: [],
    attributions: [],
    verificationBindings: [],
    resumeStepIds: [],
    droppedObservationCount: metrics.droppedObservationCount || 0,
    issues: [],
    metrics: {
      observationCount: metrics.observationCount,
      attributedObservationCount: metrics.attributedObservationCount,
      ambiguousObservationCount: metrics.ambiguousObservationCount || 0,
      dependencyBlockedObservationCount: metrics.dependencyBlockedObservationCount || 0,
      unmatchedObservationCount: metrics.unmatchedObservationCount || 0,
      repeatAfterCompletionCount: metrics.repeatAfterCompletionCount || 0,
      completedStepCount: metrics.completedStepCount || 1,
      failedStepCount: metrics.failedStepCount || 0,
      recoveredStepCount: metrics.recoveredStepCount || 0,
      targetBoundMutationCount: metrics.targetBoundMutationCount,
      mutationReadbackBindingCount: metrics.mutationReadbackBindingCount,
      unboundStateChangeCount: metrics.unboundStateChangeCount || 0,
      unboundReadbackCount: metrics.unboundReadbackCount || 0
    },
    boundaries: {
      observationOnly: true,
      shadowOnly: true,
      categoryNeutral: true,
      deterministicAttributionOnly: true,
      targetBoundObservationsOnly: true,
      evaluatesExpectedOutcomesOnly: true,
      evaluatesCompletionCriteriaText: false,
      executesFailurePolicy: false,
      schedulerAuthority: false,
      executesTools: false,
      blocksTools: false,
      retriesTools: false,
      grantsPermission: false,
      countsAsTaskProgress: false,
      countsAsQualityPass: false
    }
  };
}

function sample(index, mode, overrides = {}) {
  const skillIds = ['ecommerce.main_image', 'ecommerce.detail_page', 'ecommerce.sku_batch'];
  return {
    sampleId: `sample-${index}`,
    skillId: skillIds[index % skillIds.length],
    observationMode: mode,
    providerRunVerified: mode === 'real_provider_photoshop',
    photoshopRunVerified: mode === 'real_provider_photoshop',
    reconciliation: reconciliation({
      observationCount: 10,
      attributedObservationCount: 10,
      recoveredStepCount: index < 5 ? 1 : 0,
      targetBoundMutationCount: 2,
      mutationReadbackBindingCount: 2,
      ...overrides
    })
  };
}

const offlineOnly = evaluateRuntimeActionPlanMaturity({
  samples: Array.from({ length: 20 }, (_, index) => sample(index, 'offline_fixture'))
});
assert.strictEqual(offlineOnly.status, 'insufficient_real_observations');
assert.strictEqual(offlineOnly.verifiedReal.sampleCount, 0);
assert.strictEqual(offlineOnly.recommendation.readOnlyReplayExperimentEligible, false);
assert.strictEqual(offlineOnly.recommendation.writeSchedulerEligible, false);

const insufficientReal = evaluateRuntimeActionPlanMaturity({
  samples: [sample(1, 'real_provider_photoshop')]
});
assert.strictEqual(insufficientReal.status, 'insufficient_real_observations');
assert(insufficientReal.failedGates.includes('minimum_real_samples'));

const strongReal = evaluateRuntimeActionPlanMaturity({
  samples: Array.from({ length: 12 }, (_, index) => sample(index, 'real_provider_photoshop'))
});
assert.strictEqual(strongReal.status, 'read_only_experiment_candidate');
assert.deepStrictEqual(strongReal.failedGates, []);
assert.strictEqual(strongReal.verifiedReal.nodeAttributionAccuracy, 1);
assert.strictEqual(strongReal.verifiedReal.recoveryCorrectnessRate, 1);
assert.strictEqual(strongReal.verifiedReal.targetReadbackBindingRate, 1);
assert.strictEqual(strongReal.recommendation.readOnlyReplayExperimentEligible, true);
assert.strictEqual(strongReal.recommendation.writeSchedulerEligible, false);
assert.strictEqual(strongReal.boundaries.schedulerAuthority, false);

const weakRealSamples = Array.from({ length: 12 }, (_, index) => sample(
  index,
  'real_provider_photoshop',
  {
    observationCount: 10,
    attributedObservationCount: 8,
    dependencyBlockedObservationCount: 1,
    repeatAfterCompletionCount: 1,
    recoveredStepCount: index < 3 ? 1 : 0,
    failedStepCount: index < 5 ? 1 : 0,
    targetBoundMutationCount: 2,
    mutationReadbackBindingCount: 1
  }
));
const weakReal = evaluateRuntimeActionPlanMaturity({ samples: weakRealSamples });
assert.strictEqual(weakReal.status, 'keep_shadow');
assert(weakReal.failedGates.includes('node_attribution_accuracy'));
assert(weakReal.failedGates.includes('repeat_action_rate'));
assert(weakReal.failedGates.includes('invalid_dependency_skip_attempt_rate'));
assert(weakReal.failedGates.includes('recovery_correctness_rate'));
assert(weakReal.failedGates.includes('target_readback_binding_rate'));
assert.strictEqual(weakReal.recommendation.writeSchedulerEligible, false);

const unverifiedReal = sample(99, 'real_provider_photoshop');
unverifiedReal.photoshopRunVerified = false;
const excluded = evaluateRuntimeActionPlanMaturity({ samples: [unverifiedReal] });
assert.strictEqual(excluded.verifiedReal.sampleCount, 0);
assert(excluded.excludedSampleIds.includes('sample-99'));

console.log(JSON.stringify({
  success: true,
  offlineStatus: offlineOnly.status,
  insufficientRealStatus: insufficientReal.status,
  strongRealStatus: strongReal.status,
  weakRealStatus: weakReal.status,
  thresholds: strongReal.thresholds,
  boundaries: strongReal.boundaries
}, null, 2));
