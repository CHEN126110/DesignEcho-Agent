/**
 * R4 Action Plan ↔ 真实执行观察的影子对账。
 *
 * Harness 只在依赖已满足且 Capability 唯一匹配时归属事件。它不解释 completionCriteria
 * 自然语言，不执行 failurePolicy，不调度、不阻断、不重试 Tool，也不声明任务或质量完成。
 */

import type {
    RuntimeActionPlanDeclaration,
    RuntimeActionPlanResultKind,
    RuntimeActionPlanStep,
    RuntimeActionPlanStepKind
} from './runtime-action-plan-declaration';
import type {
    RuntimeActionPlanExecutionJournal,
    RuntimeActionPlanExecutionObservation
} from './runtime-action-plan-observation';
import { computeFastFingerprint } from './content-hash';

export type RuntimeActionPlanStepReconciliationStatus =
    | 'blocked_by_dependency'
    | 'ready'
    | 'in_progress'
    | 'failed'
    | 'completed';

export type RuntimeActionPlanObservationAttributionOutcome =
    | 'attributed'
    | 'ambiguous'
    | 'dependency_blocked'
    | 'unmatched'
    | 'repeat_after_completion';

export interface RuntimeActionPlanStepReconciliation {
    stepId: string;
    kind: RuntimeActionPlanStepKind;
    status: RuntimeActionPlanStepReconciliationStatus;
    dependencyStepIds: string[];
    attempts: number;
    failedAttempts: number;
    recovered: boolean;
    declarationOutcomeUsed: boolean;
    observedCapabilityRefs: string[];
    observedOutcomes: RuntimeActionPlanResultKind[];
    missingExpectedOutcomes: RuntimeActionPlanResultKind[];
}

export interface RuntimeActionPlanObservationAttribution {
    observationSequence: number;
    outcome: RuntimeActionPlanObservationAttributionOutcome;
    stepId?: string;
    candidateStepIds: string[];
    capabilityRefs: string[];
    observedOutcomes: RuntimeActionPlanResultKind[];
    executionOutcome: RuntimeActionPlanExecutionObservation['outcome'];
    targetRef?: string;
    readbackOfMutationSequence?: number;
}

export interface RuntimeActionPlanVerificationBinding {
    mutationObservationSequence: number;
    mutationStepId: string;
    readbackObservationSequence: number;
    readbackStepId: string;
    targetRef: string;
}

export interface RuntimeActionPlanReconciliation {
    version: 'runtime-action-plan-reconciliation/v0';
    /** 仅用于把对账绑定到完整 R4 声明；非安全指纹，不承担审批或 Artifact 权威。 */
    declarationFingerprint: string;
    status:
        | 'plan_not_ready'
        | 'not_started'
        | 'in_progress'
        | 'needs_recovery'
        | 'needs_review'
        | 'completed';
    planReadiness: RuntimeActionPlanDeclaration['readiness'];
    steps: RuntimeActionPlanStepReconciliation[];
    attributions: RuntimeActionPlanObservationAttribution[];
    verificationBindings: RuntimeActionPlanVerificationBinding[];
    resumeStepIds: string[];
    droppedObservationCount: number;
    issues: string[];
    metrics: {
        observationCount: number;
        attributedObservationCount: number;
        ambiguousObservationCount: number;
        dependencyBlockedObservationCount: number;
        unmatchedObservationCount: number;
        repeatAfterCompletionCount: number;
        completedStepCount: number;
        failedStepCount: number;
        recoveredStepCount: number;
        targetBoundMutationCount: number;
        mutationReadbackBindingCount: number;
        unboundStateChangeCount: number;
        unboundReadbackCount: number;
    };
    boundaries: {
        observationOnly: true;
        shadowOnly: true;
        categoryNeutral: true;
        deterministicAttributionOnly: true;
        targetBoundObservationsOnly: true;
        evaluatesExpectedOutcomesOnly: true;
        evaluatesCompletionCriteriaText: false;
        executesFailurePolicy: false;
        schedulerAuthority: false;
        executesTools: false;
        blocksTools: false;
        retriesTools: false;
        grantsPermission: false;
        countsAsTaskProgress: false;
        countsAsQualityPass: false;
    };
}

export interface RuntimeActionPlanReconciliationDigest {
    version: 'runtime-action-plan-reconciliation-digest/v0';
    declarationFingerprint: string;
    status: RuntimeActionPlanReconciliation['status'];
    planReadiness: RuntimeActionPlanDeclaration['readiness'];
    stepCount: number;
    completedStepIds: string[];
    completedStepDescriptors: Array<{
        stepId: string;
        kind: RuntimeActionPlanStepKind;
        capabilityRefs: string[];
        observedOutcomes: RuntimeActionPlanResultKind[];
    }>;
    failedStepIds: string[];
    recoveredStepIds: string[];
    resumeStepIds: string[];
    observationCount: number;
    droppedObservationCount: number;
    ambiguousObservationCount: number;
    dependencyBlockedObservationCount: number;
    unmatchedObservationCount: number;
    repeatAfterCompletionCount: number;
    issueCount: number;
    boundaries: {
        digestOnly: true;
        shadowOnly: true;
        resumeAdvisoryOnly: true;
        executesTools: false;
        changesTaskResult: false;
        countsAsQualityPass: false;
    };
}

const MAX_ISSUES = 40;
const MAX_DIGEST_STEP_IDS = 12;

export function buildRuntimeActionPlanDeclarationFingerprint(
    declaration: RuntimeActionPlanDeclaration
): string {
    return computeFastFingerprint(declaration);
}

function unique(values: readonly string[]): string[] {
    return Array.from(new Set(values.map((value) => String(value || '').trim()).filter(Boolean)));
}

function outcomesForObservation(
    observation: RuntimeActionPlanExecutionObservation,
    journal: RuntimeActionPlanExecutionJournal
): RuntimeActionPlanResultKind[] {
    if (observation.outcome !== 'succeeded') return [];
    switch (observation.operationKind) {
        case 'read_only_observation':
            if (!observation.target || !observation.readbackOfMutationSequence) {
                return ['project_context'];
            }
            const mutation = journal.observations.find((candidate) => (
                candidate.sequence === observation.readbackOfMutationSequence
            ));
            if (!mutation
                || mutation.outcome !== 'succeeded'
                || mutation.operationKind !== 'photoshop_write'
                || !mutation.target
                || mutation.target.documentRef !== observation.target.documentRef
                || mutation.sequence >= observation.sequence) {
                return ['project_context'];
            }
            return ['project_context', 'readback'];
        case 'knowledge_search':
            return ['knowledge_result'];
        case 'photoshop_write':
            return observation.target ? ['document_change'] : [];
        case 'save_export':
            return ['delivery_record'];
        case 'external_generation':
            return ['generated_asset'];
        case 'stateful_context':
            return ['runtime_context'];
        default:
            return [];
    }
}

function createStepState(step: RuntimeActionPlanStep): RuntimeActionPlanStepReconciliation {
    return {
        stepId: step.stepId,
        kind: step.kind,
        status: step.dependsOn.length > 0 ? 'blocked_by_dependency' : 'ready',
        dependencyStepIds: [...step.dependsOn],
        attempts: 0,
        failedAttempts: 0,
        recovered: false,
        declarationOutcomeUsed: false,
        observedCapabilityRefs: [],
        observedOutcomes: [],
        missingExpectedOutcomes: [...step.expectedOutcomes]
    };
}

function dependenciesSatisfied(
    step: RuntimeActionPlanStep,
    stateById: ReadonlyMap<string, RuntimeActionPlanStepReconciliation>
): boolean {
    return step.dependsOn.every((dependency) => (
        stateById.get(dependency)?.status === 'completed'
    ));
}

function refreshMissingOutcomes(
    step: RuntimeActionPlanStep,
    state: RuntimeActionPlanStepReconciliation
): void {
    state.missingExpectedOutcomes = step.expectedOutcomes.filter((outcome) => (
        !state.observedOutcomes.includes(outcome)
    ));
}

function refreshDependencyStatuses(
    steps: readonly RuntimeActionPlanStep[],
    stateById: Map<string, RuntimeActionPlanStepReconciliation>
): void {
    for (const step of steps) {
        const state = stateById.get(step.stepId);
        if (!state || !['ready', 'blocked_by_dependency'].includes(state.status)) continue;
        state.status = dependenciesSatisfied(step, stateById) ? 'ready' : 'blocked_by_dependency';
    }
}

function applyDeclarationOutcomes(
    declaration: RuntimeActionPlanDeclaration,
    stateById: Map<string, RuntimeActionPlanStepReconciliation>
): void {
    if (!declaration.payload.designDsl) return;
    let changed = true;
    while (changed) {
        changed = false;
        refreshDependencyStatuses(declaration.payload.steps, stateById);
        for (const step of declaration.payload.steps) {
            const state = stateById.get(step.stepId);
            if (!state || step.kind !== 'compose_dsl' || state.declarationOutcomeUsed) continue;
            if (!dependenciesSatisfied(step, stateById)) continue;
            state.declarationOutcomeUsed = true;
            state.observedOutcomes = unique([...state.observedOutcomes, 'design_dsl']) as RuntimeActionPlanResultKind[];
            refreshMissingOutcomes(step, state);
            state.status = state.missingExpectedOutcomes.length === 0 ? 'completed' : 'in_progress';
            changed = true;
        }
    }
}

function capabilityMatches(step: RuntimeActionPlanStep, observation: RuntimeActionPlanExecutionObservation): boolean {
    return step.capabilityRefs.some((ref) => observation.capabilityRefs.includes(ref));
}

function appendIssue(issues: string[], issue: string): void {
    if (!issues.includes(issue) && issues.length < MAX_ISSUES) issues.push(issue);
}

function buildMetrics(input: {
    steps: RuntimeActionPlanStepReconciliation[];
    attributions: RuntimeActionPlanObservationAttribution[];
    journal: RuntimeActionPlanExecutionJournal;
    verificationBindings: RuntimeActionPlanVerificationBinding[];
}): RuntimeActionPlanReconciliation['metrics'] {
    function count(outcome: RuntimeActionPlanObservationAttributionOutcome): number {
        return input.attributions.filter((entry) => entry.outcome === outcome).length;
    }
    return {
        observationCount: input.journal.observations.length,
        attributedObservationCount: count('attributed'),
        ambiguousObservationCount: count('ambiguous'),
        dependencyBlockedObservationCount: count('dependency_blocked'),
        unmatchedObservationCount: count('unmatched'),
        repeatAfterCompletionCount: count('repeat_after_completion'),
        completedStepCount: input.steps.filter((step) => step.status === 'completed').length,
        failedStepCount: input.steps.filter((step) => step.status === 'failed').length,
        recoveredStepCount: input.steps.filter((step) => step.recovered).length,
        targetBoundMutationCount: input.journal.observations.filter((entry) => (
            entry.operationKind === 'photoshop_write'
            && entry.outcome === 'succeeded'
            && Boolean(entry.target)
        )).length,
        mutationReadbackBindingCount: input.verificationBindings.length,
        unboundStateChangeCount: input.journal.observations.filter((entry) => (
            entry.operationKind === 'photoshop_write' && !entry.target
        )).length,
        unboundReadbackCount: input.journal.observations.filter((entry) => (
            entry.operationKind === 'read_only_observation' && !entry.readbackOfMutationSequence
        )).length
    };
}

function buildVerificationBindings(input: {
    journal: RuntimeActionPlanExecutionJournal;
    attributions: RuntimeActionPlanObservationAttribution[];
}): RuntimeActionPlanVerificationBinding[] {
    const attributionBySequence = new Map(input.attributions.map((entry) => (
        [entry.observationSequence, entry]
    )));
    const observationBySequence = new Map(input.journal.observations.map((entry) => (
        [entry.sequence, entry]
    )));
    const bindings: RuntimeActionPlanVerificationBinding[] = [];
    for (const readback of input.journal.observations) {
        if (readback.operationKind !== 'read_only_observation'
            || readback.outcome !== 'succeeded'
            || !readback.target
            || !readback.readbackOfMutationSequence) {
            continue;
        }
        const mutation = observationBySequence.get(readback.readbackOfMutationSequence);
        const mutationAttribution = attributionBySequence.get(readback.readbackOfMutationSequence);
        const readbackAttribution = attributionBySequence.get(readback.sequence);
        if (!mutation
            || mutation.operationKind !== 'photoshop_write'
            || mutation.outcome !== 'succeeded'
            || !mutation.target
            || mutation.target.documentRef !== readback.target.documentRef
            || mutation.sequence >= readback.sequence
            || mutationAttribution?.outcome !== 'attributed'
            || !mutationAttribution.stepId
            || readbackAttribution?.outcome !== 'attributed'
            || !readbackAttribution.stepId
            || !readbackAttribution.observedOutcomes.includes('readback')) {
            continue;
        }
        bindings.push({
            mutationObservationSequence: mutation.sequence,
            mutationStepId: mutationAttribution.stepId,
            readbackObservationSequence: readback.sequence,
            readbackStepId: readbackAttribution.stepId,
            targetRef: readback.target.documentRef
        });
    }
    return bindings;
}

function buildStatus(input: {
    declaration: RuntimeActionPlanDeclaration;
    steps: RuntimeActionPlanStepReconciliation[];
    metrics: RuntimeActionPlanReconciliation['metrics'];
    issueCount: number;
}): RuntimeActionPlanReconciliation['status'] {
    if (input.declaration.readiness !== 'ready') return 'plan_not_ready';
    if (input.metrics.failedStepCount > 0) return 'needs_recovery';
    if (input.metrics.ambiguousObservationCount > 0
        || input.metrics.dependencyBlockedObservationCount > 0
        || input.metrics.unmatchedObservationCount > 0
        || input.metrics.repeatAfterCompletionCount > 0
        || input.issueCount > 0) {
        return 'needs_review';
    }
    if (input.steps.every((step) => step.status === 'completed')) return 'completed';
    if (input.metrics.observationCount === 0
        && input.steps.every((step) => step.observedOutcomes.length === 0)) {
        return 'not_started';
    }
    return 'in_progress';
}

export function reconcileRuntimeActionPlanExecution(input: {
    declaration: RuntimeActionPlanDeclaration;
    journal: RuntimeActionPlanExecutionJournal;
}): RuntimeActionPlanReconciliation {
    const steps = input.declaration.payload.steps;
    const stateById = new Map(steps.map((step) => [step.stepId, createStepState(step)]));
    const attributions: RuntimeActionPlanObservationAttribution[] = [];
    const issues = [...input.journal.issues].slice(0, MAX_ISSUES);
    applyDeclarationOutcomes(input.declaration, stateById);

    if (input.declaration.readiness === 'ready') {
        for (const observation of input.journal.observations) {
            refreshDependencyStatuses(steps, stateById);
            const matchingSteps = steps.filter((step) => capabilityMatches(step, observation));
            const unresolvedMatchingSteps = matchingSteps.filter((step) => (
                stateById.get(step.stepId)?.status !== 'completed'
            ));
            const eligibleSteps = unresolvedMatchingSteps.filter((step) => dependenciesSatisfied(step, stateById));
            const observedOutcomes = outcomesForObservation(observation, input.journal);

            if (eligibleSteps.length > 1) {
                const candidateStepIds = eligibleSteps.map((step) => step.stepId);
                attributions.push({
                    observationSequence: observation.sequence,
                    outcome: 'ambiguous',
                    candidateStepIds,
                    capabilityRefs: [...observation.capabilityRefs],
                    observedOutcomes,
                    executionOutcome: observation.outcome,
                    ...(observation.target ? { targetRef: observation.target.documentRef } : {}),
                    ...(observation.readbackOfMutationSequence
                        ? { readbackOfMutationSequence: observation.readbackOfMutationSequence }
                        : {})
                });
                appendIssue(issues, `ambiguous_observation:${observation.sequence}`);
                continue;
            }
            if (eligibleSteps.length === 0) {
                let outcome: RuntimeActionPlanObservationAttributionOutcome = 'unmatched';
                let candidateStepIds: string[] = [];
                if (unresolvedMatchingSteps.length > 0) {
                    outcome = 'dependency_blocked';
                    candidateStepIds = unresolvedMatchingSteps.map((step) => step.stepId);
                    appendIssue(issues, `dependency_blocked_observation:${observation.sequence}`);
                } else if (matchingSteps.length > 0) {
                    outcome = 'repeat_after_completion';
                    candidateStepIds = matchingSteps.map((step) => step.stepId);
                    appendIssue(issues, `repeat_after_completion:${observation.sequence}`);
                } else {
                    appendIssue(issues, `unmatched_observation:${observation.sequence}`);
                }
                attributions.push({
                    observationSequence: observation.sequence,
                    outcome,
                    candidateStepIds,
                    capabilityRefs: [...observation.capabilityRefs],
                    observedOutcomes,
                    executionOutcome: observation.outcome,
                    ...(observation.target ? { targetRef: observation.target.documentRef } : {}),
                    ...(observation.readbackOfMutationSequence
                        ? { readbackOfMutationSequence: observation.readbackOfMutationSequence }
                        : {})
                });
                continue;
            }

            const step = eligibleSteps[0];
            const state = stateById.get(step.stepId)!;
            const matchedCapabilityRefs = observation.capabilityRefs.filter((ref) => step.capabilityRefs.includes(ref));
            state.attempts += 1;
            state.observedCapabilityRefs = unique([...state.observedCapabilityRefs, ...matchedCapabilityRefs]);
            if (observation.outcome === 'failed') {
                state.failedAttempts += 1;
                state.status = 'failed';
            } else {
                if (state.failedAttempts > 0) state.recovered = true;
                state.observedOutcomes = unique([
                    ...state.observedOutcomes,
                    ...observedOutcomes
                ]) as RuntimeActionPlanResultKind[];
                refreshMissingOutcomes(step, state);
                state.status = state.missingExpectedOutcomes.length === 0
                    ? 'completed'
                    : 'in_progress';
                if (observedOutcomes.length === 0) {
                    appendIssue(issues, `observation_without_supported_outcome:${observation.sequence}`);
                }
            }
            attributions.push({
                observationSequence: observation.sequence,
                outcome: 'attributed',
                stepId: step.stepId,
                candidateStepIds: [step.stepId],
                capabilityRefs: matchedCapabilityRefs,
                observedOutcomes,
                executionOutcome: observation.outcome,
                ...(observation.target ? { targetRef: observation.target.documentRef } : {}),
                ...(observation.readbackOfMutationSequence
                    ? { readbackOfMutationSequence: observation.readbackOfMutationSequence }
                    : {})
            });
        }
    }

    refreshDependencyStatuses(steps, stateById);
    const reconciledSteps = steps.map((step) => stateById.get(step.stepId)!);
    const resumeStepIds = steps
        .filter((step) => {
            const state = stateById.get(step.stepId)!;
            return state.status !== 'completed' && dependenciesSatisfied(step, stateById);
        })
        .map((step) => step.stepId);
    const verificationBindings = buildVerificationBindings({
        journal: input.journal,
        attributions
    });
    const metrics = buildMetrics({
        steps: reconciledSteps,
        attributions,
        journal: input.journal,
        verificationBindings
    });
    const status = buildStatus({
        declaration: input.declaration,
        steps: reconciledSteps,
        metrics,
        issueCount: issues.length + input.journal.droppedObservationCount
    });
    return {
        version: 'runtime-action-plan-reconciliation/v0',
        declarationFingerprint: buildRuntimeActionPlanDeclarationFingerprint(input.declaration),
        status,
        planReadiness: input.declaration.readiness,
        steps: reconciledSteps,
        attributions,
        verificationBindings,
        resumeStepIds,
        droppedObservationCount: input.journal.droppedObservationCount,
        issues,
        metrics,
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

export function buildRuntimeActionPlanReconciliationDigest(
    reconciliation: RuntimeActionPlanReconciliation
): RuntimeActionPlanReconciliationDigest {
    return {
        version: 'runtime-action-plan-reconciliation-digest/v0',
        declarationFingerprint: reconciliation.declarationFingerprint,
        status: reconciliation.status,
        planReadiness: reconciliation.planReadiness,
        stepCount: reconciliation.steps.length,
        completedStepIds: reconciliation.steps
            .filter((step) => step.status === 'completed')
            .map((step) => step.stepId)
            .slice(0, MAX_DIGEST_STEP_IDS),
        completedStepDescriptors: reconciliation.steps
            .filter((step) => step.status === 'completed')
            .slice(0, MAX_DIGEST_STEP_IDS)
            .map((step) => ({
                stepId: step.stepId,
                kind: step.kind,
                capabilityRefs: step.observedCapabilityRefs.slice(0, 8),
                observedOutcomes: step.observedOutcomes.slice(0, 8)
            })),
        failedStepIds: reconciliation.steps
            .filter((step) => step.status === 'failed')
            .map((step) => step.stepId)
            .slice(0, MAX_DIGEST_STEP_IDS),
        recoveredStepIds: reconciliation.steps
            .filter((step) => step.recovered)
            .map((step) => step.stepId)
            .slice(0, MAX_DIGEST_STEP_IDS),
        resumeStepIds: reconciliation.resumeStepIds.slice(0, MAX_DIGEST_STEP_IDS),
        observationCount: reconciliation.metrics.observationCount,
        droppedObservationCount: reconciliation.droppedObservationCount,
        ambiguousObservationCount: reconciliation.metrics.ambiguousObservationCount,
        dependencyBlockedObservationCount: reconciliation.metrics.dependencyBlockedObservationCount,
        unmatchedObservationCount: reconciliation.metrics.unmatchedObservationCount,
        repeatAfterCompletionCount: reconciliation.metrics.repeatAfterCompletionCount,
        issueCount: reconciliation.issues.length,
        boundaries: {
            digestOnly: true,
            shadowOnly: true,
            resumeAdvisoryOnly: true,
            executesTools: false,
            changesTaskResult: false,
            countsAsQualityPass: false
        }
    };
}
