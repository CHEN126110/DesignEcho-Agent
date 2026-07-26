/**
 * 跨轮已完成节点的 no-redo 影子决策。
 *
 * 节点等价关系只能来自当前模型在 R4 step 上显式提交的 resumeMapping，Harness 不读取
 * goal、Tool、Capability、任务文本或业务品类猜测。该决策只观察，不阻断、不跳过、不调度 Tool。
 */

import type { RuntimeActionPlanDeclaration } from './runtime-action-plan-declaration';
import type { RuntimeActionPlanReconciliation } from './runtime-action-plan-reconciliation';
import type { RuntimeActionPlanResumeFreshness } from './runtime-action-plan-resume-freshness';

export type RuntimeActionPlanNoRedoShadowStatus =
    | 'not_applicable'
    | 'observing'
    | 'no_repeat_observed'
    | 'repeat_observed';

export interface RuntimeActionPlanNoRedoShadowDecision {
    version: 'runtime-action-plan-no-redo-shadow/v0';
    status: RuntimeActionPlanNoRedoShadowStatus;
    sourceRunId?: string;
    reuseCandidateStepIds: string[];
    repeatObservedStepIds: string[];
    intentionalRedoStepIds: string[];
    intentionalRedoObservedStepIds: string[];
    mappedPriorStepIds: string[];
    unmappedVerifiedPriorStepIds: string[];
    metrics: {
        verifiedPriorCompletedStepCount: number;
        mappingCount: number;
        reuseCandidateCount: number;
        repeatObservedCount: number;
        intentionalRedoCount: number;
        intentionalRedoObservedCount: number;
        unmappedVerifiedPriorStepCount: number;
    };
    boundaries: {
        observationOnly: true;
        shadowOnly: true;
        modelMappingRequired: true;
        categoryNeutral: true;
        infersEquivalence: false;
        executesTools: false;
        blocksTools: false;
        skipsTools: false;
        schedulerAuthority: false;
        retriesTools: false;
        grantsPermission: false;
        changesDependencyState: false;
        changesTaskResult: false;
        countsAsTaskProgress: false;
        countsAsQualityPass: false;
    };
}

export interface RuntimeActionPlanNoRedoShadowDigest {
    version: 'runtime-action-plan-no-redo-shadow-digest/v0';
    status: RuntimeActionPlanNoRedoShadowStatus;
    sourceRunId?: string;
    reuseCandidateStepIds: string[];
    repeatObservedStepIds: string[];
    intentionalRedoStepIds: string[];
    intentionalRedoObservedStepIds: string[];
    verifiedPriorCompletedStepCount: number;
    mappingCount: number;
    unmappedVerifiedPriorStepCount: number;
    boundaries: {
        digestOnly: true;
        shadowOnly: true;
        modelMappingRequired: true;
        executesTools: false;
        blocksTools: false;
        skipsTools: false;
        schedulerAuthority: false;
        changesTaskResult: false;
        countsAsQualityPass: false;
    };
}

const MAX_STEP_IDS = 12;

function uniqueStepIds(values: readonly unknown[]): string[] {
    return Array.from(new Set(values
        .map((value) => String(value || '').trim())
        .filter((value) => /^[a-z][a-z0-9_-]{0,47}$/.test(value))))
        .slice(0, MAX_STEP_IDS);
}

export function buildRuntimeActionPlanNoRedoShadowDecision(input: {
    freshness?: RuntimeActionPlanResumeFreshness;
    declaration?: RuntimeActionPlanDeclaration;
    reconciliation?: RuntimeActionPlanReconciliation;
}): RuntimeActionPlanNoRedoShadowDecision {
    const verifiedPriorStepIds = input.freshness?.status === 'verified'
        ? uniqueStepIds(input.freshness.verifiedCompletedStepIds || [])
        : [];
    const verifiedPriorStepSet = new Set(verifiedPriorStepIds);
    const mappings = input.declaration?.payload.steps
        .filter((step) => step.resumeMapping && verifiedPriorStepSet.has(step.resumeMapping.priorStepId))
        .map((step) => ({ stepId: step.stepId, mapping: step.resumeMapping! })) || [];
    const reuseCandidateStepIds = uniqueStepIds(mappings
        .filter((entry) => entry.mapping.policy === 'reuse_completed_step')
        .map((entry) => entry.stepId));
    const intentionalRedoStepIds = uniqueStepIds(mappings
        .filter((entry) => entry.mapping.policy === 'redo_required')
        .map((entry) => entry.stepId));
    const attemptsByStepId = new Map((input.reconciliation?.steps || []).map((step) => (
        [step.stepId, step.attempts] as const
    )));
    const repeatObservedStepIds = reuseCandidateStepIds.filter((stepId) => (
        (attemptsByStepId.get(stepId) || 0) > 0
    ));
    const intentionalRedoObservedStepIds = intentionalRedoStepIds.filter((stepId) => (
        (attemptsByStepId.get(stepId) || 0) > 0
    ));
    const mappedPriorStepIds = uniqueStepIds(mappings.map((entry) => entry.mapping.priorStepId));
    const mappedPriorStepSet = new Set(mappedPriorStepIds);
    const unmappedVerifiedPriorStepIds = verifiedPriorStepIds.filter((stepId) => (
        !mappedPriorStepSet.has(stepId)
    ));
    let status: RuntimeActionPlanNoRedoShadowStatus = 'not_applicable';
    if (mappings.length > 0) {
        if (repeatObservedStepIds.length > 0) status = 'repeat_observed';
        else if (input.reconciliation) status = 'no_repeat_observed';
        else status = 'observing';
    }
    return {
        version: 'runtime-action-plan-no-redo-shadow/v0',
        status,
        ...(input.freshness?.sourceRunId ? { sourceRunId: input.freshness.sourceRunId.slice(0, 100) } : {}),
        reuseCandidateStepIds,
        repeatObservedStepIds,
        intentionalRedoStepIds,
        intentionalRedoObservedStepIds,
        mappedPriorStepIds,
        unmappedVerifiedPriorStepIds,
        metrics: {
            verifiedPriorCompletedStepCount: verifiedPriorStepIds.length,
            mappingCount: mappings.length,
            reuseCandidateCount: reuseCandidateStepIds.length,
            repeatObservedCount: repeatObservedStepIds.length,
            intentionalRedoCount: intentionalRedoStepIds.length,
            intentionalRedoObservedCount: intentionalRedoObservedStepIds.length,
            unmappedVerifiedPriorStepCount: unmappedVerifiedPriorStepIds.length
        },
        boundaries: {
            observationOnly: true,
            shadowOnly: true,
            modelMappingRequired: true,
            categoryNeutral: true,
            infersEquivalence: false,
            executesTools: false,
            blocksTools: false,
            skipsTools: false,
            schedulerAuthority: false,
            retriesTools: false,
            grantsPermission: false,
            changesDependencyState: false,
            changesTaskResult: false,
            countsAsTaskProgress: false,
            countsAsQualityPass: false
        }
    };
}

export function buildRuntimeActionPlanNoRedoShadowDigest(
    decision: RuntimeActionPlanNoRedoShadowDecision
): RuntimeActionPlanNoRedoShadowDigest {
    return {
        version: 'runtime-action-plan-no-redo-shadow-digest/v0',
        status: decision.status,
        ...(decision.sourceRunId ? { sourceRunId: decision.sourceRunId } : {}),
        reuseCandidateStepIds: decision.reuseCandidateStepIds.slice(0, MAX_STEP_IDS),
        repeatObservedStepIds: decision.repeatObservedStepIds.slice(0, MAX_STEP_IDS),
        intentionalRedoStepIds: decision.intentionalRedoStepIds.slice(0, MAX_STEP_IDS),
        intentionalRedoObservedStepIds: decision.intentionalRedoObservedStepIds.slice(0, MAX_STEP_IDS),
        verifiedPriorCompletedStepCount: decision.metrics.verifiedPriorCompletedStepCount,
        mappingCount: decision.metrics.mappingCount,
        unmappedVerifiedPriorStepCount: decision.metrics.unmappedVerifiedPriorStepCount,
        boundaries: {
            digestOnly: true,
            shadowOnly: true,
            modelMappingRequired: true,
            executesTools: false,
            blocksTools: false,
            skipsTools: false,
            schedulerAuthority: false,
            changesTaskResult: false,
            countsAsQualityPass: false
        }
    };
}
