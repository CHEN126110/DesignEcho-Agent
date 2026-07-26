/**
 * R4 Action Plan shadow 的运行观察成熟度评估。
 *
 * 本模块只汇总已有 reconciliation 指标并给出只读实验建议。它不调度、不跳过、
 * 不阻断 Tool，也永远不会开启写入 Scheduler authority。
 */

import type { RuntimeActionPlanReconciliation } from './runtime-action-plan-reconciliation';

export type RuntimeActionPlanMaturityObservationMode =
    | 'offline_fixture'
    | 'real_provider_photoshop';

export interface RuntimeActionPlanMaturitySample {
    sampleId: string;
    skillId: string;
    observationMode: RuntimeActionPlanMaturityObservationMode;
    providerRunVerified: boolean;
    photoshopRunVerified: boolean;
    reconciliation: RuntimeActionPlanReconciliation;
}

export interface RuntimeActionPlanMaturityMetrics {
    sampleCount: number;
    skillCount: number;
    observationCount: number;
    failureIncidentCount: number;
    targetBoundMutationCount: number;
    nodeAttributionAccuracy: number | null;
    repeatActionRate: number | null;
    invalidDependencySkipAttemptRate: number | null;
    recoveryCorrectnessRate: number | null;
    targetReadbackBindingRate: number | null;
    droppedObservationRate: number | null;
}

export interface RuntimeActionPlanMaturityReport {
    version: 'runtime-action-plan-maturity-report/v0';
    status: 'insufficient_real_observations' | 'keep_shadow' | 'read_only_experiment_candidate';
    allObserved: RuntimeActionPlanMaturityMetrics;
    verifiedReal: RuntimeActionPlanMaturityMetrics;
    excludedSampleIds: string[];
    failedGates: string[];
    thresholds: {
        minimumRealSamples: number;
        minimumRealSkills: number;
        minimumRealObservations: number;
        minimumFailureIncidents: number;
        minimumNodeAttributionAccuracy: number;
        maximumRepeatActionRate: number;
        maximumInvalidDependencySkipAttemptRate: number;
        minimumRecoveryCorrectnessRate: number;
        minimumTargetReadbackBindingRate: number;
        maximumDroppedObservationRate: number;
    };
    recommendation: {
        keepShadow: boolean;
        readOnlyReplayExperimentEligible: boolean;
        writeSchedulerEligible: false;
    };
    boundaries: {
        observationalOnly: true;
        realObservationsRequired: true;
        offlineFixturesCannotPromote: true;
        schedulerAuthority: false;
        autoSkipsSteps: false;
        executesTools: false;
        blocksTools: false;
        grantsPermission: false;
        changesTaskResult: false;
        countsAsQualityPass: false;
    };
}

const THRESHOLDS: RuntimeActionPlanMaturityReport['thresholds'] = Object.freeze({
    minimumRealSamples: 12,
    minimumRealSkills: 3,
    minimumRealObservations: 100,
    minimumFailureIncidents: 5,
    minimumNodeAttributionAccuracy: 0.97,
    maximumRepeatActionRate: 0.01,
    maximumInvalidDependencySkipAttemptRate: 0.005,
    minimumRecoveryCorrectnessRate: 0.95,
    minimumTargetReadbackBindingRate: 1,
    maximumDroppedObservationRate: 0
});

function cleanToken(value: unknown): string {
    const token = String(value || '').trim();
    return /^[A-Za-z0-9_.:-]{1,100}$/.test(token) ? token : '';
}

function rate(numerator: number, denominator: number): number | null {
    if (denominator <= 0) return null;
    return Math.round((numerator / denominator) * 10000) / 10000;
}

function aggregate(samples: readonly RuntimeActionPlanMaturitySample[]): RuntimeActionPlanMaturityMetrics {
    const totals = samples.reduce((result, sample) => {
        const metrics = sample.reconciliation.metrics;
        result.observationCount += metrics.observationCount;
        result.attributedObservationCount += metrics.attributedObservationCount;
        result.repeatAfterCompletionCount += metrics.repeatAfterCompletionCount;
        result.dependencyBlockedObservationCount += metrics.dependencyBlockedObservationCount;
        result.failedStepCount += metrics.failedStepCount;
        result.recoveredStepCount += metrics.recoveredStepCount;
        result.targetBoundMutationCount += metrics.targetBoundMutationCount;
        result.mutationReadbackBindingCount += metrics.mutationReadbackBindingCount;
        result.droppedObservationCount += sample.reconciliation.droppedObservationCount;
        return result;
    }, {
        observationCount: 0,
        attributedObservationCount: 0,
        repeatAfterCompletionCount: 0,
        dependencyBlockedObservationCount: 0,
        failedStepCount: 0,
        recoveredStepCount: 0,
        targetBoundMutationCount: 0,
        mutationReadbackBindingCount: 0,
        droppedObservationCount: 0
    });
    const failureIncidentCount = totals.failedStepCount + totals.recoveredStepCount;
    return {
        sampleCount: samples.length,
        skillCount: new Set(samples.map((sample) => cleanToken(sample.skillId)).filter(Boolean)).size,
        observationCount: totals.observationCount,
        failureIncidentCount,
        targetBoundMutationCount: totals.targetBoundMutationCount,
        nodeAttributionAccuracy: rate(totals.attributedObservationCount, totals.observationCount),
        repeatActionRate: rate(totals.repeatAfterCompletionCount, totals.observationCount),
        invalidDependencySkipAttemptRate: rate(
            totals.dependencyBlockedObservationCount,
            totals.observationCount
        ),
        recoveryCorrectnessRate: rate(totals.recoveredStepCount, failureIncidentCount),
        targetReadbackBindingRate: rate(
            totals.mutationReadbackBindingCount,
            totals.targetBoundMutationCount
        ),
        droppedObservationRate: rate(totals.droppedObservationCount, totals.observationCount)
    };
}

function below(value: number | null, minimum: number): boolean {
    return value === null || value < minimum;
}

function above(value: number | null, maximum: number): boolean {
    return value === null || value > maximum;
}

export function evaluateRuntimeActionPlanMaturity(input: {
    samples: readonly RuntimeActionPlanMaturitySample[];
}): RuntimeActionPlanMaturityReport {
    const seenIds = new Set<string>();
    const uniqueSamples: RuntimeActionPlanMaturitySample[] = [];
    const excludedSampleIds: string[] = [];
    for (const sample of input.samples) {
        const sampleId = cleanToken(sample.sampleId);
        if (!sampleId || seenIds.has(sampleId)) {
            excludedSampleIds.push(sampleId || 'invalid');
            continue;
        }
        seenIds.add(sampleId);
        uniqueSamples.push(sample);
    }
    const verifiedRealSamples = uniqueSamples.filter((sample) => (
        sample.observationMode === 'real_provider_photoshop'
        && sample.providerRunVerified === true
        && sample.photoshopRunVerified === true
    ));
    uniqueSamples.forEach((sample) => {
        if (sample.observationMode === 'real_provider_photoshop'
            && (!sample.providerRunVerified || !sample.photoshopRunVerified)) {
            excludedSampleIds.push(cleanToken(sample.sampleId) || 'invalid');
        }
    });

    const allObserved = aggregate(uniqueSamples);
    const verifiedReal = aggregate(verifiedRealSamples);
    const failedGates: string[] = [];
    if (verifiedReal.sampleCount < THRESHOLDS.minimumRealSamples) failedGates.push('minimum_real_samples');
    if (verifiedReal.skillCount < THRESHOLDS.minimumRealSkills) failedGates.push('minimum_real_skills');
    if (verifiedReal.observationCount < THRESHOLDS.minimumRealObservations) {
        failedGates.push('minimum_real_observations');
    }
    if (verifiedReal.failureIncidentCount < THRESHOLDS.minimumFailureIncidents) {
        failedGates.push('minimum_failure_incidents');
    }
    if (below(verifiedReal.nodeAttributionAccuracy, THRESHOLDS.minimumNodeAttributionAccuracy)) {
        failedGates.push('node_attribution_accuracy');
    }
    if (above(verifiedReal.repeatActionRate, THRESHOLDS.maximumRepeatActionRate)) {
        failedGates.push('repeat_action_rate');
    }
    if (above(
        verifiedReal.invalidDependencySkipAttemptRate,
        THRESHOLDS.maximumInvalidDependencySkipAttemptRate
    )) {
        failedGates.push('invalid_dependency_skip_attempt_rate');
    }
    if (below(verifiedReal.recoveryCorrectnessRate, THRESHOLDS.minimumRecoveryCorrectnessRate)) {
        failedGates.push('recovery_correctness_rate');
    }
    if (below(
        verifiedReal.targetReadbackBindingRate,
        THRESHOLDS.minimumTargetReadbackBindingRate
    )) {
        failedGates.push('target_readback_binding_rate');
    }
    if (above(verifiedReal.droppedObservationRate, THRESHOLDS.maximumDroppedObservationRate)) {
        failedGates.push('dropped_observation_rate');
    }

    const insufficientRealObservations = failedGates.some((gate) => (
        gate.startsWith('minimum_')
    ));
    const status: RuntimeActionPlanMaturityReport['status'] = failedGates.length === 0
        ? 'read_only_experiment_candidate'
        : (insufficientRealObservations ? 'insufficient_real_observations' : 'keep_shadow');
    return {
        version: 'runtime-action-plan-maturity-report/v0',
        status,
        allObserved,
        verifiedReal,
        excludedSampleIds: Array.from(new Set(excludedSampleIds)),
        failedGates,
        thresholds: { ...THRESHOLDS },
        recommendation: {
            keepShadow: status !== 'read_only_experiment_candidate',
            readOnlyReplayExperimentEligible: status === 'read_only_experiment_candidate',
            writeSchedulerEligible: false
        },
        boundaries: {
            observationalOnly: true,
            realObservationsRequired: true,
            offlineFixturesCannotPromote: true,
            schedulerAuthority: false,
            autoSkipsSteps: false,
            executesTools: false,
            blocksTools: false,
            grantsPermission: false,
            changesTaskResult: false,
            countsAsQualityPass: false
        }
    };
}
