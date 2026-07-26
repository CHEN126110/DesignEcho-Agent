/**
 * Runtime Task Snapshot — 现有任务事实的唯一只读投影。
 *
 * 它只复制 Runtime Session、请求计划、R4 对账、Verdict 与 Delivery Verification
 * 的已有事实。v0 在 Artifact Repository 未接入时保持空槽；v1 只附加通过 Repository
 * reader 校验且与 Runtime 身份一致的 ArtifactRef。它不接受调用方自报来源、不持久化、
 * 不调度或执行 Tool、不授予权限、不推进 Stage，也不重新裁决任务、质量或交付结果。
 */

import type { AgentTaskPlanningContract } from '../agent-task-planning-contract';
import type { DesignVerdict } from '../design-quality-verdict-bundle';
import {
    ARTIFACT_REPOSITORY_READ_PROJECTION_VERSION,
    readArtifactRepositoryProjection,
    type ArtifactRepositoryReadProjection
} from './artifact-repository-contract';
import type { RuntimeStage } from './contracts';
import type { ApprovalRecord } from './contracts/approval-record';
import type { ArtifactRef } from './contracts/common';
import type { V5_ARTIFACT_TYPES } from './contracts/index';
import { computeFastFingerprint } from './content-hash';
import type {
    RuntimeActionPlanDeclaration,
    RuntimeActionPlanReadiness,
    RuntimeActionPlanResultKind,
    RuntimeActionPlanStepKind
} from './runtime-action-plan-declaration';
import { buildRuntimeActionPlanDeclarationFingerprint } from './runtime-action-plan-reconciliation';
import type {
    RuntimeActionPlanReconciliation,
    RuntimeActionPlanStepReconciliationStatus,
    RuntimeActionPlanVerificationBinding
} from './runtime-action-plan-reconciliation';
import type { RuntimeDeliveryVerification } from './runtime-delivery-receipt';
import type { RuntimeDesignBriefDeclaration } from './runtime-design-brief-declaration';
import type { RuntimeSession } from './runtime-session';
import type {
    RuntimeStageObservedStatus,
    RuntimeStageStateStatus
} from './runtime-stage-state';

export const RUNTIME_TASK_SNAPSHOT_VERSION = 'runtime-task-snapshot/v0' as const;
export const RUNTIME_TASK_SNAPSHOT_V1_VERSION = 'runtime-task-snapshot/v1' as const;

export type RuntimeTaskSnapshotExecutionStatus =
    | 'completed'
    | 'needs_review'
    | 'failed'
    | 'cancelled'
    | 'awaiting_confirmation';

export type RuntimeTaskSnapshotActionStepStatus =
    | 'not_observed'
    | RuntimeActionPlanStepReconciliationStatus;

export type RuntimeTaskSnapshotApprovalSource = 'approval_service';

export type RuntimeTaskSnapshotApprovalScope = ApprovalRecord['payload']['scope'];

export type RuntimeTaskSnapshotApprovalStatus =
    | 'approved_valid'
    | 'rejected'
    | 'revoked'
    | 'expired';

export interface RuntimeTaskSnapshotApprovalRef extends ArtifactRef {
    artifactType: typeof V5_ARTIFACT_TYPES.approvalRecord;
}

export interface RuntimeTaskSnapshotIdentity {
    sessionId: string;
    runId: string;
    generation: number;
    parentRunId?: string;
    issuedAt: string;
    skillId: string;
    taskType: string;
    planVersion: RuntimeSession['planVersion'];
    finalized: boolean;
}

export interface RuntimeTaskSnapshotStage {
    stage: RuntimeStage;
    status: RuntimeStageObservedStatus;
    attempts: number;
    requiredOutcomes: string[];
    observedOutcomes: string[];
    missingOutcomes: string[];
}

export interface RuntimeTaskSnapshotOpenObligation {
    obligationId: string;
    source: 'runtime_stage' | 'action_plan';
    ownerRef: string;
    status: 'open' | 'blocked' | 'needs_review' | 'failed' | 'awaiting_confirmation';
    missingOutcomes: string[];
}

export interface RuntimeTaskSnapshotActionStep {
    stepId: string;
    kind: RuntimeActionPlanStepKind;
    goal: string;
    dependsOn: string[];
    status: RuntimeTaskSnapshotActionStepStatus;
    attempts: number;
    failedAttempts: number;
    recovered: boolean;
    observedCapabilityRefs: string[];
    observedOutcomes: RuntimeActionPlanResultKind[];
    missingExpectedOutcomes: RuntimeActionPlanResultKind[];
}

export interface RuntimeTaskSnapshotActionPlan {
    readiness: RuntimeActionPlanReadiness;
    goal: string;
    presentationRevision: number;
    presentationRevisionHash: string;
    reconciliationStatus: RuntimeActionPlanReconciliation['status'] | 'not_observed';
    steps: RuntimeTaskSnapshotActionStep[];
}

export interface RuntimeTaskSnapshotExecution {
    observationCount: number;
    attributedObservationCount: number;
    ambiguousObservationCount: number;
    dependencyBlockedObservationCount: number;
    unmatchedObservationCount: number;
    droppedObservationCount: number;
    targetBoundMutationCount: number;
    mutationReadbackBindingCount: number;
    unboundStateChangeCount: number;
    unboundReadbackCount: number;
    mutationReadbackBindings: RuntimeActionPlanVerificationBinding[];
}

export interface RuntimeTaskSnapshot {
    version: typeof RUNTIME_TASK_SNAPSHOT_VERSION;
    /** 同进程传输完整性校验；不是审批、Artifact 或安全签名。 */
    projectionFingerprint: string;
    identity: RuntimeTaskSnapshotIdentity;
    goal: {
        text: string;
        source: 'request_task_plan' | 'runtime_design_brief' | 'runtime_action_plan' | 'fallback';
    };
    runtime: {
        status: RuntimeStageStateStatus;
        currentStage?: RuntimeStage;
        stages: RuntimeTaskSnapshotStage[];
        openObligations: RuntimeTaskSnapshotOpenObligation[];
    };
    actionPlan?: RuntimeTaskSnapshotActionPlan;
    execution?: RuntimeTaskSnapshotExecution;
    recovery: {
        failedStepIds: string[];
        recoveredStepIds: string[];
        resumeStepIds: string[];
    };
    interaction: {
        waitingForUser: boolean;
        source: 'runtime_stage_state' | 'execution_summary' | 'none';
    };
    approval: {
        status: 'not_observed' | 'observed';
        facts: Array<{
            source: RuntimeTaskSnapshotApprovalSource;
            status: RuntimeTaskSnapshotApprovalStatus;
            scope: RuntimeTaskSnapshotApprovalScope;
            approvalRef: RuntimeTaskSnapshotApprovalRef;
        }>;
        boundaries: {
            approvalServiceConnected: false;
            approvalCredentialAuthority: false;
            grantsPermission: false;
        };
    };
    evaluation: {
        status: DesignVerdict['status'] | 'not_observed';
        source: DesignVerdict['source'] | 'none';
        overallScore?: number;
        blockers: string[];
        warnings: string[];
        summary?: string;
    };
    delivery:
        | {
            status: 'not_observed';
            source: 'none';
        }
        | {
            status: RuntimeDeliveryVerification['status'];
            source: 'runtime_delivery_verification';
            requiredOutputs: string[];
            confirmedOutputs: string[];
            missingOutputs: string[];
        }
        | {
            status: RuntimeDeliveryVerification['status'];
            source: 'runtime_stage_state';
            stageStatus: RuntimeStageObservedStatus;
            requiredStageOutcomes: string[];
            observedStageOutcomes: string[];
            missingStageOutcomes: string[];
        };
    artifactRefs: ArtifactRef[];
    outcome?: {
        status: RuntimeTaskSnapshotExecutionStatus;
        source: 'execution_summary';
    };
    issues: Array<{
        source: 'runtime_session' | 'runtime_stage_state' | 'action_plan_reconciliation';
        message: string;
    }>;
    sources: {
        runtimeSession: RuntimeSession['version'];
        taskPlan?: AgentTaskPlanningContract['version'];
        runtimeDesignBrief?: RuntimeDesignBriefDeclaration['version'];
        runtimeActionPlan?: RuntimeActionPlanDeclaration['version'];
        runtimeActionPlanReconciliation?: RuntimeActionPlanReconciliation['version'];
        designVerdict?: DesignVerdict['version'];
        runtimeDeliveryVerification?: RuntimeDeliveryVerification['version'];
    };
    boundaries: {
        readModelOnly: true;
        derivedFromCanonicalOwners: true;
        persistsRuntimeState: false;
        advancesRuntimeStage: false;
        schedulesTools: false;
        executesTools: false;
        grantsPermission: false;
        changesTaskResult: false;
        changesQualityVerdict: false;
        changesDeliveryStatus: false;
        artifactRefsOnly: true;
        artifactRepositoryConnected: false;
        acceptsUnverifiedArtifactRefs: false;
        categoryNeutral: true;
    };
}

export interface RuntimeTaskSnapshotV1 extends Omit<
    RuntimeTaskSnapshot,
    'version' | 'projectionFingerprint' | 'sources' | 'boundaries'
> {
    version: typeof RUNTIME_TASK_SNAPSHOT_V1_VERSION;
    /** 同进程传输完整性校验；不是审批、Artifact 或安全签名。 */
    projectionFingerprint: string;
    sources: RuntimeTaskSnapshot['sources'] & {
        artifactRepository: ArtifactRepositoryReadProjection['version'];
    };
    boundaries: Omit<RuntimeTaskSnapshot['boundaries'], 'artifactRepositoryConnected'> & {
        artifactRepositoryConnected: true;
    };
}

export type ReadableRuntimeTaskSnapshot = RuntimeTaskSnapshot | RuntimeTaskSnapshotV1;

export interface BuildRuntimeTaskSnapshotInput {
    runtimeSession: RuntimeSession;
    taskPlan?: AgentTaskPlanningContract;
    runtimeDesignBrief?: RuntimeDesignBriefDeclaration;
    runtimeActionPlan?: RuntimeActionPlanDeclaration;
    runtimeActionPlanReconciliation?: RuntimeActionPlanReconciliation;
    executionStatus?: RuntimeTaskSnapshotExecutionStatus;
    designVerdict?: DesignVerdict;
    runtimeDeliveryVerification?: RuntimeDeliveryVerification;
}

const MAX_TEXT = 360;
const MAX_LIST = 32;
const MAX_ISSUES = 40;

function cleanText(value: unknown, limit = MAX_TEXT): string {
    return String(value || '').replace(/\s+/g, ' ').trim().slice(0, limit);
}

function uniqueText(values: readonly unknown[], limit = MAX_LIST): string[] {
    return Array.from(new Set(values
        .map((value) => cleanText(value, 180))
        .filter(Boolean)))
        .slice(0, limit);
}

function stableHash(value: string): string {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return `r4-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function buildActionPlanRevision(declaration: RuntimeActionPlanDeclaration): {
    revision: number;
    revisionHash: string;
} {
    return {
        revision: 1,
        revisionHash: stableHash(JSON.stringify({
            readiness: declaration.readiness,
            planGoal: declaration.payload.planGoal,
            steps: declaration.payload.steps.map((step) => ({
                stepId: step.stepId,
                kind: step.kind,
                goal: step.goal,
                dependsOn: step.dependsOn
            }))
        }))
    };
}

function resolveActionPlanRevision(input: BuildRuntimeTaskSnapshotInput): {
    revision: number;
    revisionHash: string;
} | undefined {
    const declaration = input.runtimeActionPlan;
    if (!declaration || declaration.version !== 'runtime-action-plan-declaration/v0') return undefined;
    const revision = buildActionPlanRevision(declaration);
    const sequences = input.runtimeSession.stageTrace.events
        .filter((event) => event.stage === 'R4' && event.source === 'action_plan_declaration')
        .map((event) => event.sequence)
        .filter((sequence) => Number.isInteger(sequence) && sequence > 0);
    return {
        ...revision,
        revision: sequences.length > 0 ? Math.max(...sequences) : revision.revision
    };
}

function resolveGoal(input: BuildRuntimeTaskSnapshotInput): RuntimeTaskSnapshot['goal'] {
    const requestGoal = cleanText(input.taskPlan?.designBrief.goal);
    if (requestGoal) return { text: requestGoal, source: 'request_task_plan' };
    const briefGoal = cleanText(input.runtimeDesignBrief?.payload.taskGoal);
    if (briefGoal) return { text: briefGoal, source: 'runtime_design_brief' };
    const actionGoal = cleanText(input.runtimeActionPlan?.payload.planGoal);
    if (actionGoal) return { text: actionGoal, source: 'runtime_action_plan' };
    return { text: '完成当前任务', source: 'fallback' };
}

function buildReconciliationByStepId(
    reconciliation: RuntimeActionPlanReconciliation | undefined
): Map<string, RuntimeActionPlanReconciliation['steps'][number]> {
    if (!reconciliation || reconciliation.version !== 'runtime-action-plan-reconciliation/v0') {
        return new Map();
    }
    const byStepId = new Map<string, RuntimeActionPlanReconciliation['steps'][number]>();
    const duplicateIds = new Set<string>();
    for (const step of reconciliation.steps) {
        if (byStepId.has(step.stepId)) {
            duplicateIds.add(step.stepId);
            continue;
        }
        byStepId.set(step.stepId, step);
    }
    for (const stepId of duplicateIds) byStepId.delete(stepId);
    return byStepId;
}

function resolveCompatibleReconciliation(
    declaration: RuntimeActionPlanDeclaration | undefined,
    reconciliation: RuntimeActionPlanReconciliation | undefined
): RuntimeActionPlanReconciliation | undefined {
    if (!declaration
        || declaration.version !== 'runtime-action-plan-declaration/v0'
        || !reconciliation
        || reconciliation.version !== 'runtime-action-plan-reconciliation/v0'
        || reconciliation.declarationFingerprint
            !== buildRuntimeActionPlanDeclarationFingerprint(declaration)
        || reconciliation.planReadiness !== declaration.readiness
        || reconciliation.steps.length !== declaration.payload.steps.length) {
        return undefined;
    }
    const declarationByStepId = new Map<string, RuntimeActionPlanStepKind>();
    for (const step of declaration.payload.steps) {
        if (declarationByStepId.has(step.stepId)) return undefined;
        declarationByStepId.set(step.stepId, step.kind);
    }
    const reconciliationStepIds = new Set<string>();
    for (const step of reconciliation.steps) {
        if (reconciliationStepIds.has(step.stepId)
            || declarationByStepId.get(step.stepId) !== step.kind) {
            return undefined;
        }
        reconciliationStepIds.add(step.stepId);
    }
    return reconciliationStepIds.size === declarationByStepId.size
        ? reconciliation
        : undefined;
}

function buildActionPlan(
    input: BuildRuntimeTaskSnapshotInput,
    reconciliation: RuntimeActionPlanReconciliation | undefined
): RuntimeTaskSnapshotActionPlan | undefined {
    const declaration = input.runtimeActionPlan;
    if (!declaration || declaration.version !== 'runtime-action-plan-declaration/v0') return undefined;
    const reconciliationByStepId = buildReconciliationByStepId(reconciliation);
    const revision = resolveActionPlanRevision(input)!;
    return {
        readiness: declaration.readiness,
        goal: cleanText(declaration.payload.planGoal),
        presentationRevision: revision.revision,
        presentationRevisionHash: revision.revisionHash,
        reconciliationStatus: reconciliation?.status || 'not_observed',
        steps: declaration.payload.steps.slice(0, MAX_LIST).map((step) => {
            const candidate = reconciliationByStepId.get(step.stepId);
            const reconciled = candidate?.kind === step.kind ? candidate : undefined;
            return {
                stepId: cleanText(step.stepId, 120),
                kind: step.kind,
                goal: cleanText(step.goal),
                dependsOn: uniqueText(step.dependsOn, 16),
                status: reconciled?.status || 'not_observed',
                attempts: reconciled?.attempts || 0,
                failedAttempts: reconciled?.failedAttempts || 0,
                recovered: reconciled?.recovered === true,
                observedCapabilityRefs: uniqueText(reconciled?.observedCapabilityRefs || [], 16),
                observedOutcomes: [...(reconciled?.observedOutcomes || [])].slice(0, 16),
                missingExpectedOutcomes: [...(
                    reconciled?.missingExpectedOutcomes || step.expectedOutcomes
                )].slice(0, 16)
            };
        })
    };
}

function buildExecution(
    reconciliation: RuntimeActionPlanReconciliation | undefined
): RuntimeTaskSnapshotExecution | undefined {
    if (!reconciliation || reconciliation.version !== 'runtime-action-plan-reconciliation/v0') {
        return undefined;
    }
    const metrics = reconciliation.metrics;
    return {
        observationCount: metrics.observationCount,
        attributedObservationCount: metrics.attributedObservationCount,
        ambiguousObservationCount: metrics.ambiguousObservationCount,
        dependencyBlockedObservationCount: metrics.dependencyBlockedObservationCount,
        unmatchedObservationCount: metrics.unmatchedObservationCount,
        droppedObservationCount: reconciliation.droppedObservationCount,
        targetBoundMutationCount: metrics.targetBoundMutationCount,
        mutationReadbackBindingCount: metrics.mutationReadbackBindingCount,
        unboundStateChangeCount: metrics.unboundStateChangeCount,
        unboundReadbackCount: metrics.unboundReadbackCount,
        mutationReadbackBindings: reconciliation.verificationBindings.slice(0, MAX_LIST).map((binding) => ({
            mutationObservationSequence: binding.mutationObservationSequence,
            mutationStepId: cleanText(binding.mutationStepId, 120),
            readbackObservationSequence: binding.readbackObservationSequence,
            readbackStepId: cleanText(binding.readbackStepId, 120),
            targetRef: cleanText(binding.targetRef, 180)
        }))
    };
}

function buildOpenObligations(input: {
    runtimeStages: RuntimeTaskSnapshotStage[];
    actionPlan?: RuntimeTaskSnapshotActionPlan;
}): RuntimeTaskSnapshotOpenObligation[] {
    const obligations: RuntimeTaskSnapshotOpenObligation[] = [];
    for (const stage of input.runtimeStages) {
        if (stage.status === 'passed' || stage.status === 'cancelled') continue;
        const requiresAttention = stage.status === 'needs_review'
            || stage.status === 'failed'
            || stage.status === 'awaiting_confirmation';
        if (stage.missingOutcomes.length === 0 && !requiresAttention) continue;
        let status: RuntimeTaskSnapshotOpenObligation['status'] = 'open';
        if (stage.status === 'needs_review') status = 'needs_review';
        if (stage.status === 'failed') status = 'failed';
        if (stage.status === 'awaiting_confirmation') status = 'awaiting_confirmation';
        obligations.push({
            obligationId: `runtime-stage:${stage.stage}`,
            source: 'runtime_stage',
            ownerRef: stage.stage,
            status,
            missingOutcomes: [...stage.missingOutcomes]
        });
    }
    for (const step of input.actionPlan?.steps || []) {
        if (step.status === 'completed') continue;
        let status: RuntimeTaskSnapshotOpenObligation['status'] = 'open';
        if (step.status === 'blocked_by_dependency') status = 'blocked';
        if (step.status === 'failed') status = 'failed';
        obligations.push({
            obligationId: `action-plan:${step.stepId}`,
            source: 'action_plan',
            ownerRef: step.stepId,
            status,
            missingOutcomes: [...step.missingExpectedOutcomes]
        });
    }
    return obligations.slice(0, MAX_LIST);
}

function buildApproval(): RuntimeTaskSnapshot['approval'] {
    return {
        status: 'not_observed',
        facts: [],
        boundaries: {
            approvalServiceConnected: false,
            approvalCredentialAuthority: false,
            grantsPermission: false
        }
    };
}

function buildEvaluation(verdict: DesignVerdict | undefined): RuntimeTaskSnapshot['evaluation'] {
    if (!verdict) {
        return {
            status: 'not_observed',
            source: 'none',
            blockers: [],
            warnings: []
        };
    }
    return {
        status: verdict.status,
        source: verdict.source,
        ...(typeof verdict.overallScore === 'number' ? { overallScore: verdict.overallScore } : {}),
        blockers: uniqueText(verdict.blockers, 16),
        warnings: uniqueText(verdict.warnings, 16),
        summary: cleanText(verdict.summary)
    };
}

function buildDelivery(input: BuildRuntimeTaskSnapshotInput): RuntimeTaskSnapshot['delivery'] {
    const verification = input.runtimeDeliveryVerification;
    if (verification?.version === 'runtime-delivery-verification/v1') {
        return {
            status: verification.status,
            source: 'runtime_delivery_verification',
            requiredOutputs: uniqueText(verification.requiredOutputs),
            confirmedOutputs: uniqueText(verification.confirmedOutputs),
            missingOutputs: uniqueText(verification.missingOutputs)
        };
    }
    const deliveryStage = input.runtimeSession.stageState.stages.find((stage) => stage.stage === 'E2');
    if (!deliveryStage || deliveryStage.status === 'unobserved') {
        return {
            status: 'not_observed',
            source: 'none'
        };
    }
    return {
        status: deliveryStage.status === 'passed' ? 'passed' : 'incomplete',
        source: 'runtime_stage_state',
        stageStatus: deliveryStage.status,
        requiredStageOutcomes: uniqueText(deliveryStage.requiredOutcomes),
        observedStageOutcomes: uniqueText(deliveryStage.observedOutcomes),
        missingStageOutcomes: uniqueText(deliveryStage.missingOutcomes)
    };
}

function buildIssues(
    input: BuildRuntimeTaskSnapshotInput,
    reconciliation: RuntimeActionPlanReconciliation | undefined
): RuntimeTaskSnapshot['issues'] {
    const issues: RuntimeTaskSnapshot['issues'] = [];
    function append(source: RuntimeTaskSnapshot['issues'][number]['source'], values: readonly unknown[]): void {
        for (const value of values) {
            const message = cleanText(value);
            if (!message || issues.some((issue) => issue.source === source && issue.message === message)) continue;
            issues.push({ source, message });
            if (issues.length >= MAX_ISSUES) return;
        }
    }
    append('runtime_session', input.runtimeSession.issues);
    append('runtime_stage_state', input.runtimeSession.stageState.issues);
    append('action_plan_reconciliation', reconciliation?.issues || []);
    return issues;
}

function resolveInteractionSource(input: {
    waitingForRuntime: boolean;
    waitingForExecution: boolean;
}): RuntimeTaskSnapshot['interaction']['source'] {
    if (input.waitingForRuntime) return 'runtime_stage_state';
    if (input.waitingForExecution) return 'execution_summary';
    return 'none';
}

export function buildRuntimeTaskSnapshot(
    input: BuildRuntimeTaskSnapshotInput
): RuntimeTaskSnapshot {
    const session = input.runtimeSession;
    const runtimeStages = session.stageState.stages.map((stage) => ({
        stage: stage.stage,
        status: stage.status,
        attempts: stage.attempts,
        requiredOutcomes: uniqueText(stage.requiredOutcomes),
        observedOutcomes: uniqueText(stage.observedOutcomes),
        missingOutcomes: uniqueText(stage.missingOutcomes)
    }));
    const reconciliation = resolveCompatibleReconciliation(
        input.runtimeActionPlan,
        input.runtimeActionPlanReconciliation
    );
    const actionPlan = buildActionPlan(input, reconciliation);
    const execution = buildExecution(reconciliation);
    const waitingForRuntime = session.stageState.status === 'awaiting_confirmation';
    const waitingForExecution = input.executionStatus === 'awaiting_confirmation';
    const snapshot: Omit<RuntimeTaskSnapshot, 'projectionFingerprint'> = {
        version: RUNTIME_TASK_SNAPSHOT_VERSION,
        identity: {
            sessionId: session.identity.sessionId,
            runId: session.identity.runId,
            generation: session.identity.generation,
            ...(session.identity.parentRunId ? { parentRunId: session.identity.parentRunId } : {}),
            issuedAt: session.identity.issuedAt,
            skillId: session.skillId,
            taskType: session.taskType,
            planVersion: session.planVersion,
            finalized: session.finalized
        },
        goal: resolveGoal(input),
        runtime: {
            status: session.stageState.status,
            ...(session.stageState.currentStage ? { currentStage: session.stageState.currentStage } : {}),
            stages: runtimeStages,
            openObligations: buildOpenObligations({ runtimeStages, actionPlan })
        },
        ...(actionPlan ? { actionPlan } : {}),
        ...(execution ? { execution } : {}),
        recovery: {
            failedStepIds: uniqueText(
                reconciliation?.steps.filter((step) => step.status === 'failed').map((step) => step.stepId) || []
            ),
            recoveredStepIds: uniqueText(
                reconciliation?.steps.filter((step) => step.recovered).map((step) => step.stepId) || []
            ),
            resumeStepIds: uniqueText(reconciliation?.resumeStepIds || [])
        },
        interaction: {
            waitingForUser: waitingForRuntime || waitingForExecution,
            source: resolveInteractionSource({ waitingForRuntime, waitingForExecution })
        },
        approval: buildApproval(),
        evaluation: buildEvaluation(input.designVerdict),
        delivery: buildDelivery(input),
        artifactRefs: [],
        ...(input.executionStatus ? {
            outcome: {
                status: input.executionStatus,
                source: 'execution_summary' as const
            }
        } : {}),
        issues: buildIssues(input, reconciliation),
        sources: {
            runtimeSession: session.version,
            ...(input.taskPlan ? { taskPlan: input.taskPlan.version } : {}),
            ...(input.runtimeDesignBrief ? { runtimeDesignBrief: input.runtimeDesignBrief.version } : {}),
            ...(input.runtimeActionPlan ? { runtimeActionPlan: input.runtimeActionPlan.version } : {}),
            ...(reconciliation ? { runtimeActionPlanReconciliation: reconciliation.version } : {}),
            ...(input.designVerdict ? { designVerdict: input.designVerdict.version } : {}),
            ...(input.runtimeDeliveryVerification
                ? { runtimeDeliveryVerification: input.runtimeDeliveryVerification.version }
                : {})
        },
        boundaries: {
            readModelOnly: true,
            derivedFromCanonicalOwners: true,
            persistsRuntimeState: false,
            advancesRuntimeStage: false,
            schedulesTools: false,
            executesTools: false,
            grantsPermission: false,
            changesTaskResult: false,
            changesQualityVerdict: false,
            changesDeliveryStatus: false,
            artifactRefsOnly: true,
            artifactRepositoryConnected: false,
            acceptsUnverifiedArtifactRefs: false,
            categoryNeutral: true
        }
    };
    return {
        ...snapshot,
        projectionFingerprint: computeFastFingerprint(snapshot)
    };
}

/**
 * 把 Repository 的只读投影附加到已校验的 v0 Snapshot。
 *
 * 这里只复制 ArtifactRef，不复制 Repository issue、路径或载荷；scope 必须与当前
 * Runtime 身份完全一致。返回新对象，不修改 Snapshot 或 Repository 投影。
 */
export function attachArtifactRepositoryProjectionToRuntimeTaskSnapshot(
    snapshot: RuntimeTaskSnapshot,
    projection: ArtifactRepositoryReadProjection
): RuntimeTaskSnapshotV1 | undefined {
    const validatedSnapshot = readRuntimeTaskSnapshot(snapshot);
    const validatedProjection = readArtifactRepositoryProjection(projection);
    if (!validatedSnapshot
        || validatedSnapshot.version !== RUNTIME_TASK_SNAPSHOT_VERSION
        || !validatedProjection
        || validatedProjection.scope.sessionId !== validatedSnapshot.identity.sessionId
        || validatedProjection.scope.runId !== validatedSnapshot.identity.runId
        || validatedProjection.scope.generation !== validatedSnapshot.identity.generation) {
        return undefined;
    }

    const {
        projectionFingerprint: _v0ProjectionFingerprint,
        ...snapshotWithoutFingerprint
    } = validatedSnapshot;
    const attached: Omit<RuntimeTaskSnapshotV1, 'projectionFingerprint'> = {
        ...snapshotWithoutFingerprint,
        version: RUNTIME_TASK_SNAPSHOT_V1_VERSION,
        artifactRefs: validatedProjection.refs.map((ref) => ({
            artifactId: ref.artifactId,
            artifactType: ref.artifactType,
            contentHash: ref.contentHash
        })),
        sources: {
            ...validatedSnapshot.sources,
            artifactRepository: validatedProjection.version
        },
        boundaries: {
            ...validatedSnapshot.boundaries,
            artifactRepositoryConnected: true
        }
    };
    return {
        ...attached,
        projectionFingerprint: computeFastFingerprint(attached)
    };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
    return Object.prototype.hasOwnProperty.call(value, key);
}

function hasOnlyKeys(value: Record<string, unknown>, allowedKeys: readonly string[]): boolean {
    const allowed = new Set(allowedKeys);
    return Object.keys(value).every((key) => allowed.has(key));
}

function hasBoundedString(value: unknown, limit = MAX_TEXT, allowEmpty = false): value is string {
    if (typeof value !== 'string' || value.length > limit || value.includes('\0')) return false;
    return allowEmpty || value.trim().length > 0;
}

function hasStringArray(value: unknown, limit = MAX_LIST): value is string[] {
    return Array.isArray(value)
        && value.length <= limit
        && value.every((item) => hasBoundedString(item, 360));
}

function hasEnumValue<T extends string>(value: unknown, allowed: readonly T[]): value is T {
    return typeof value === 'string' && allowed.includes(value as T);
}

function hasEnumArray<T extends string>(value: unknown, allowed: readonly T[]): value is T[] {
    return Array.isArray(value)
        && value.length <= MAX_LIST
        && value.every((item) => hasEnumValue(item, allowed));
}

function hasNonNegativeInteger(value: unknown): value is number {
    return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

const RUNTIME_STAGE_VALUES: readonly RuntimeStage[] = ['R0', 'R1', 'R2', 'R3', 'R4', 'E1', 'R5', 'E2'];
const RUNTIME_STAGE_STATUS_VALUES: readonly RuntimeStageObservedStatus[] = [
    'unobserved', 'passed', 'needs_review', 'failed', 'awaiting_confirmation', 'cancelled'
];
const RUNTIME_STATE_STATUS_VALUES: readonly RuntimeStageStateStatus[] = [
    'active', 'awaiting_outcomes', 'awaiting_confirmation', 'reflexion_required', 'completed', 'cancelled'
];
const ACTION_STEP_KIND_VALUES: readonly RuntimeActionPlanStepKind[] = [
    'observe', 'research', 'compose_dsl', 'preview', 'mutate', 'verify', 'deliver', 'request_input'
];
const ACTION_STEP_STATUS_VALUES: readonly RuntimeTaskSnapshotActionStepStatus[] = [
    'not_observed', 'blocked_by_dependency', 'ready', 'in_progress', 'failed', 'completed'
];
const ACTION_PLAN_READINESS_VALUES: readonly RuntimeActionPlanReadiness[] = [
    'ready', 'needs_capability', 'needs_input'
];
const ACTION_PLAN_RECONCILIATION_STATUS_VALUES: readonly RuntimeTaskSnapshotActionPlan['reconciliationStatus'][] = [
    'not_observed', 'plan_not_ready', 'not_started', 'in_progress', 'needs_recovery', 'needs_review', 'completed'
];
const ACTION_RESULT_KIND_VALUES: readonly RuntimeActionPlanResultKind[] = [
    'project_context', 'visual_observation', 'knowledge_result', 'runtime_context', 'design_dsl',
    'preview', 'document_change', 'readback', 'quality_report', 'delivery_record',
    'user_confirmation', 'generated_asset'
];
const EXECUTION_STATUS_VALUES: readonly RuntimeTaskSnapshotExecutionStatus[] = [
    'completed', 'needs_review', 'failed', 'cancelled', 'awaiting_confirmation'
];

function hasSnapshotIdentity(value: unknown): boolean {
    if (!isRecord(value)) return false;
    return hasOnlyKeys(value, [
        'sessionId', 'runId', 'generation', 'parentRunId', 'issuedAt',
        'skillId', 'taskType', 'planVersion', 'finalized'
    ])
        && hasBoundedString(value.sessionId, 160)
        && hasBoundedString(value.runId, 160)
        && typeof value.generation === 'number'
        && Number.isInteger(value.generation)
        && value.generation > 0
        && (!hasOwn(value, 'parentRunId') || hasBoundedString(value.parentRunId, 160))
        && hasBoundedString(value.issuedAt, 80)
        && hasBoundedString(value.skillId, 120)
        && hasBoundedString(value.taskType, 160)
        && value.planVersion === 'runtime-stage-plan/v0'
        && typeof value.finalized === 'boolean';
}

function hasSnapshotStage(value: unknown): boolean {
    if (!isRecord(value)) return false;
    return hasOnlyKeys(value, [
        'stage', 'status', 'attempts', 'requiredOutcomes', 'observedOutcomes', 'missingOutcomes'
    ])
        && hasEnumValue(value.stage, RUNTIME_STAGE_VALUES)
        && hasEnumValue(value.status, RUNTIME_STAGE_STATUS_VALUES)
        && hasNonNegativeInteger(value.attempts)
        && hasStringArray(value.requiredOutcomes)
        && hasStringArray(value.observedOutcomes)
        && hasStringArray(value.missingOutcomes);
}

function hasSnapshotOpenObligation(value: unknown): boolean {
    if (!isRecord(value)) return false;
    return hasOnlyKeys(value, ['obligationId', 'source', 'ownerRef', 'status', 'missingOutcomes'])
        && hasBoundedString(value.obligationId, 200)
        && hasEnumValue(value.source, ['runtime_stage', 'action_plan'] as const)
        && hasBoundedString(value.ownerRef, 160)
        && hasEnumValue(value.status, [
            'open', 'blocked', 'needs_review', 'failed', 'awaiting_confirmation'
        ] as const)
        && hasStringArray(value.missingOutcomes);
}

function hasSnapshotRuntime(value: unknown): boolean {
    if (!isRecord(value)
        || !hasOnlyKeys(value, ['status', 'currentStage', 'stages', 'openObligations'])
        || !hasEnumValue(value.status, RUNTIME_STATE_STATUS_VALUES)
        || (hasOwn(value, 'currentStage') && !hasEnumValue(value.currentStage, RUNTIME_STAGE_VALUES))
        || !Array.isArray(value.stages)
        || value.stages.length > MAX_LIST
        || !value.stages.every(hasSnapshotStage)
        || !Array.isArray(value.openObligations)
        || value.openObligations.length > MAX_LIST
        || !value.openObligations.every(hasSnapshotOpenObligation)) {
        return false;
    }
    return true;
}

function hasSnapshotActionStep(value: unknown): boolean {
    if (!isRecord(value)) return false;
    return hasOnlyKeys(value, [
        'stepId', 'kind', 'goal', 'dependsOn', 'status', 'attempts', 'failedAttempts',
        'recovered', 'observedCapabilityRefs', 'observedOutcomes', 'missingExpectedOutcomes'
    ])
        && hasBoundedString(value.stepId, 120)
        && hasEnumValue(value.kind, ACTION_STEP_KIND_VALUES)
        && hasBoundedString(value.goal)
        && hasStringArray(value.dependsOn, 16)
        && hasEnumValue(value.status, ACTION_STEP_STATUS_VALUES)
        && hasNonNegativeInteger(value.attempts)
        && hasNonNegativeInteger(value.failedAttempts)
        && typeof value.recovered === 'boolean'
        && hasStringArray(value.observedCapabilityRefs, 16)
        && hasEnumArray(value.observedOutcomes, ACTION_RESULT_KIND_VALUES)
        && hasEnumArray(value.missingExpectedOutcomes, ACTION_RESULT_KIND_VALUES);
}

function hasSnapshotActionPlan(value: unknown): boolean {
    if (!isRecord(value)
        || !hasOnlyKeys(value, [
            'readiness', 'goal', 'presentationRevision', 'presentationRevisionHash',
            'reconciliationStatus', 'steps'
        ])
        || !hasEnumValue(value.readiness, ACTION_PLAN_READINESS_VALUES)
        || !hasBoundedString(value.goal)
        || typeof value.presentationRevision !== 'number'
        || !Number.isInteger(value.presentationRevision)
        || value.presentationRevision <= 0
        || !hasBoundedString(value.presentationRevisionHash, 80)
        || !hasEnumValue(value.reconciliationStatus, ACTION_PLAN_RECONCILIATION_STATUS_VALUES)
        || !Array.isArray(value.steps)
        || value.steps.length > MAX_LIST) {
        return false;
    }
    return value.steps.every(hasSnapshotActionStep);
}

function hasSnapshotVerificationBinding(value: unknown): boolean {
    if (!isRecord(value)) return false;
    return hasOnlyKeys(value, [
        'mutationObservationSequence', 'mutationStepId', 'readbackObservationSequence',
        'readbackStepId', 'targetRef'
    ])
        && hasNonNegativeInteger(value.mutationObservationSequence)
        && Number(value.mutationObservationSequence) > 0
        && hasBoundedString(value.mutationStepId, 120)
        && hasNonNegativeInteger(value.readbackObservationSequence)
        && Number(value.readbackObservationSequence) > 0
        && hasBoundedString(value.readbackStepId, 120)
        && hasBoundedString(value.targetRef, 180);
}

function hasSnapshotExecution(value: unknown): boolean {
    if (!isRecord(value)
        || !hasOnlyKeys(value, [
            'observationCount', 'attributedObservationCount', 'ambiguousObservationCount',
            'dependencyBlockedObservationCount', 'unmatchedObservationCount', 'droppedObservationCount',
            'targetBoundMutationCount', 'mutationReadbackBindingCount', 'unboundStateChangeCount',
            'unboundReadbackCount', 'mutationReadbackBindings'
        ])) {
        return false;
    }
    const metricKeys = [
        'observationCount', 'attributedObservationCount', 'ambiguousObservationCount',
        'dependencyBlockedObservationCount', 'unmatchedObservationCount', 'droppedObservationCount',
        'targetBoundMutationCount', 'mutationReadbackBindingCount', 'unboundStateChangeCount',
        'unboundReadbackCount'
    ];
    return metricKeys.every((key) => hasNonNegativeInteger(value[key]))
        && Array.isArray(value.mutationReadbackBindings)
        && value.mutationReadbackBindings.length <= MAX_LIST
        && value.mutationReadbackBindings.every(hasSnapshotVerificationBinding);
}

function hasSnapshotRecovery(value: unknown): boolean {
    if (!isRecord(value)) return false;
    return hasOnlyKeys(value, ['failedStepIds', 'recoveredStepIds', 'resumeStepIds'])
        && hasStringArray(value.failedStepIds)
        && hasStringArray(value.recoveredStepIds)
        && hasStringArray(value.resumeStepIds);
}

function hasSnapshotInteraction(value: unknown): boolean {
    if (!isRecord(value)
        || !hasOnlyKeys(value, ['waitingForUser', 'source'])
        || typeof value.waitingForUser !== 'boolean'
        || !hasEnumValue(value.source, ['runtime_stage_state', 'execution_summary', 'none'] as const)) {
        return false;
    }
    return value.waitingForUser ? value.source !== 'none' : value.source === 'none';
}

function hasSnapshotApproval(value: unknown): boolean {
    if (!isRecord(value)
        || !hasOnlyKeys(value, ['status', 'facts', 'boundaries'])
        || value.status !== 'not_observed'
        || !Array.isArray(value.facts)
        || value.facts.length !== 0
        || !isRecord(value.boundaries)) {
        return false;
    }
    return hasOnlyKeys(value.boundaries, [
        'approvalServiceConnected', 'approvalCredentialAuthority', 'grantsPermission'
    ])
        && value.boundaries.approvalServiceConnected === false
        && value.boundaries.approvalCredentialAuthority === false
        && value.boundaries.grantsPermission === false;
}

function hasSnapshotEvaluation(value: unknown): boolean {
    if (!isRecord(value)
        || !hasOnlyKeys(value, ['status', 'source', 'overallScore', 'blockers', 'warnings', 'summary'])
        || !hasEnumValue(value.status, [
            'passed', 'failed', 'needs_review', 'passed_unverified', 'not_applicable', 'not_observed'
        ] as const)
        || !hasEnumValue(value.source, ['contract', 'scorecard', 'contract+scorecard', 'none'] as const)
        || !hasStringArray(value.blockers, 16)
        || !hasStringArray(value.warnings, 16)
        || (hasOwn(value, 'overallScore') && (
            typeof value.overallScore !== 'number'
            || !Number.isFinite(value.overallScore)
            || value.overallScore < 0
            || value.overallScore > 100
        ))
        || (hasOwn(value, 'summary') && !hasBoundedString(value.summary, MAX_TEXT, true))) {
        return false;
    }
    if (value.status === 'not_observed') return value.source === 'none';
    if (value.source === 'none') return value.status === 'not_applicable';
    return true;
}

function hasSnapshotDelivery(value: unknown): boolean {
    if (!isRecord(value)
        || !hasEnumValue(value.source, ['none', 'runtime_delivery_verification', 'runtime_stage_state'] as const)) {
        return false;
    }
    if (value.source === 'none') {
        return hasOnlyKeys(value, ['status', 'source']) && value.status === 'not_observed';
    }
    if (value.source === 'runtime_delivery_verification') {
        return hasOnlyKeys(value, [
            'status', 'source', 'requiredOutputs', 'confirmedOutputs', 'missingOutputs'
        ])
            && hasEnumValue(value.status, ['passed', 'incomplete'] as const)
            && hasStringArray(value.requiredOutputs)
            && hasStringArray(value.confirmedOutputs)
            && hasStringArray(value.missingOutputs)
            && (value.status !== 'passed' || value.missingOutputs.length === 0);
    }
    return hasOnlyKeys(value, [
        'status', 'source', 'stageStatus', 'requiredStageOutcomes',
        'observedStageOutcomes', 'missingStageOutcomes'
    ])
        && hasEnumValue(value.status, ['passed', 'incomplete'] as const)
        && hasEnumValue(value.stageStatus, RUNTIME_STAGE_STATUS_VALUES)
        && hasStringArray(value.requiredStageOutcomes)
        && hasStringArray(value.observedStageOutcomes)
        && hasStringArray(value.missingStageOutcomes)
        && (value.status === 'passed' ? value.stageStatus === 'passed' : value.stageStatus !== 'passed');
}

function hasSnapshotOutcome(value: unknown): boolean {
    if (!isRecord(value)) return false;
    return hasOnlyKeys(value, ['status', 'source'])
        && hasEnumValue(value.status, EXECUTION_STATUS_VALUES)
        && value.source === 'execution_summary';
}

function hasSnapshotIssues(value: unknown): boolean {
    return Array.isArray(value)
        && value.length <= MAX_ISSUES
        && value.every((issue) => (
            isRecord(issue)
            && hasOnlyKeys(issue, ['source', 'message'])
            && hasEnumValue(issue.source, [
                'runtime_session', 'runtime_stage_state', 'action_plan_reconciliation'
            ] as const)
            && hasBoundedString(issue.message)
        ));
}

function hasOptionalExactValue(
    value: Record<string, unknown>,
    key: string,
    expected: string
): boolean {
    return !hasOwn(value, key) || value[key] === expected;
}

function hasSnapshotSources(value: unknown): boolean {
    if (!isRecord(value)
        || !hasOnlyKeys(value, [
            'runtimeSession', 'taskPlan', 'runtimeDesignBrief', 'runtimeActionPlan',
            'runtimeActionPlanReconciliation', 'designVerdict', 'runtimeDeliveryVerification'
        ])
        || value.runtimeSession !== 'runtime-session/v0') {
        return false;
    }
    return hasOptionalExactValue(value, 'taskPlan', 'agent-task-planning-contract/v0')
        && hasOptionalExactValue(value, 'runtimeDesignBrief', 'runtime-design-brief-declaration/v0')
        && hasOptionalExactValue(value, 'runtimeActionPlan', 'runtime-action-plan-declaration/v0')
        && hasOptionalExactValue(
            value,
            'runtimeActionPlanReconciliation',
            'runtime-action-plan-reconciliation/v0'
        )
        && hasOptionalExactValue(value, 'designVerdict', 'design-quality-verdict/v0')
        && hasOptionalExactValue(
            value,
            'runtimeDeliveryVerification',
            'runtime-delivery-verification/v1'
        );
}

function hasSnapshotBoundaries(value: unknown): boolean {
    if (!isRecord(value)
        || !hasOnlyKeys(value, [
            'readModelOnly', 'derivedFromCanonicalOwners', 'persistsRuntimeState',
            'advancesRuntimeStage', 'schedulesTools', 'executesTools', 'grantsPermission',
            'changesTaskResult', 'changesQualityVerdict', 'changesDeliveryStatus',
            'artifactRefsOnly', 'artifactRepositoryConnected', 'acceptsUnverifiedArtifactRefs',
            'categoryNeutral'
        ])) {
        return false;
    }
    return value.readModelOnly === true
        && value.derivedFromCanonicalOwners === true
        && value.persistsRuntimeState === false
        && value.advancesRuntimeStage === false
        && value.schedulesTools === false
        && value.executesTools === false
        && value.grantsPermission === false
        && value.changesTaskResult === false
        && value.changesQualityVerdict === false
        && value.changesDeliveryStatus === false
        && value.artifactRefsOnly === true
        && value.artifactRepositoryConnected === false
        && value.acceptsUnverifiedArtifactRefs === false
        && value.categoryNeutral === true;
}

function hasSnapshotV1Sources(value: unknown): boolean {
    if (!isRecord(value)
        || !hasOnlyKeys(value, [
            'runtimeSession', 'taskPlan', 'runtimeDesignBrief', 'runtimeActionPlan',
            'runtimeActionPlanReconciliation', 'designVerdict', 'runtimeDeliveryVerification',
            'artifactRepository'
        ])
        || value.artifactRepository !== ARTIFACT_REPOSITORY_READ_PROJECTION_VERSION) {
        return false;
    }
    const { artifactRepository: _artifactRepository, ...v0Sources } = value;
    return hasSnapshotSources(v0Sources);
}

function hasSnapshotV1Boundaries(value: unknown): boolean {
    if (!isRecord(value) || value.artifactRepositoryConnected !== true) return false;
    return hasSnapshotBoundaries({
        ...value,
        artifactRepositoryConnected: false
    });
}

function hasSameArtifactRefs(left: unknown[], right: ArtifactRef[]): boolean {
    return left.length === right.length && left.every((candidate, index) => {
        const expected = right[index];
        return isRecord(candidate)
            && Boolean(expected)
            && candidate.artifactId === expected.artifactId
            && candidate.artifactType === expected.artifactType
            && candidate.contentHash === expected.contentHash;
    });
}

function readRuntimeTaskSnapshotV1(
    value: Record<string, unknown>
): RuntimeTaskSnapshotV1 | undefined {
    if (value.version !== RUNTIME_TASK_SNAPSHOT_V1_VERSION
        || !isRecord(value.sources)
        || !hasSnapshotV1Sources(value.sources)
        || !isRecord(value.boundaries)
        || !hasSnapshotV1Boundaries(value.boundaries)
        || !Array.isArray(value.artifactRefs)) {
        return undefined;
    }

    const {
        artifactRepository: _artifactRepository,
        ...v0Sources
    } = value.sources;
    const v0FingerprintInput: Record<string, unknown> = {
        ...value,
        version: RUNTIME_TASK_SNAPSHOT_VERSION,
        artifactRefs: [],
        sources: v0Sources,
        boundaries: {
            ...value.boundaries,
            artifactRepositoryConnected: false
        }
    };
    delete v0FingerprintInput.projectionFingerprint;
    const v0Candidate = {
        ...v0FingerprintInput,
        projectionFingerprint: computeFastFingerprint(v0FingerprintInput)
    };
    const v0Snapshot = readRuntimeTaskSnapshot(v0Candidate);
    if (!v0Snapshot || v0Snapshot.version !== RUNTIME_TASK_SNAPSHOT_VERSION) return undefined;

    const repositoryProjection = readArtifactRepositoryProjection({
        version: ARTIFACT_REPOSITORY_READ_PROJECTION_VERSION,
        source: 'artifact_repository',
        scope: {
            sessionId: v0Snapshot.identity.sessionId,
            runId: v0Snapshot.identity.runId,
            generation: v0Snapshot.identity.generation
        },
        refs: value.artifactRefs,
        droppedRefCount: 0,
        issues: [],
        boundaries: {
            repositoryOwned: true,
            artifactRefsOnly: true,
            payloadsExcluded: true,
            pathsExcluded: true,
            grantsPermission: false
        }
    });
    if (!repositoryProjection
        || !hasSameArtifactRefs(value.artifactRefs, repositoryProjection.refs)) {
        return undefined;
    }

    const fingerprintInput = { ...value };
    delete fingerprintInput.projectionFingerprint;
    if (value.projectionFingerprint !== computeFastFingerprint(fingerprintInput)) return undefined;
    return value as unknown as RuntimeTaskSnapshotV1;
}

/**
 * Result/UI 边界的 fail-closed reader。v0 继续要求 Repository 空槽；v1 只接受
 * Repository reader 形状的规范化 ArtifactRef。ApprovalService 仍必须为空。
 */
export function readRuntimeTaskSnapshot(value: unknown): ReadableRuntimeTaskSnapshot | undefined {
    if (isRecord(value) && value.version === RUNTIME_TASK_SNAPSHOT_V1_VERSION) {
        return readRuntimeTaskSnapshotV1(value);
    }
    if (!isRecord(value)
        || !hasOnlyKeys(value, [
            'version', 'projectionFingerprint', 'identity', 'goal', 'runtime', 'actionPlan', 'execution', 'recovery',
            'interaction', 'approval', 'evaluation', 'delivery', 'artifactRefs', 'outcome',
            'issues', 'sources', 'boundaries'
        ])
        || value.version !== RUNTIME_TASK_SNAPSHOT_VERSION
        || !hasBoundedString(value.projectionFingerprint, 32)
        || !hasSnapshotIdentity(value.identity)
        || !isRecord(value.goal)
        || !hasOnlyKeys(value.goal, ['text', 'source'])
        || !hasBoundedString(value.goal.text)
        || !hasEnumValue(value.goal.source, [
            'request_task_plan', 'runtime_design_brief', 'runtime_action_plan', 'fallback'
        ] as const)
        || !hasSnapshotRuntime(value.runtime)
        || !hasSnapshotRecovery(value.recovery)
        || !hasSnapshotInteraction(value.interaction)
        || !hasSnapshotApproval(value.approval)
        || !hasSnapshotEvaluation(value.evaluation)
        || !hasSnapshotDelivery(value.delivery)
        || !Array.isArray(value.artifactRefs)
        || value.artifactRefs.length !== 0
        || (hasOwn(value, 'outcome') && !hasSnapshotOutcome(value.outcome))
        || !hasSnapshotIssues(value.issues)
        || !hasSnapshotSources(value.sources)
        || !hasSnapshotBoundaries(value.boundaries)) {
        return undefined;
    }
    const fingerprintInput = { ...value };
    delete fingerprintInput.projectionFingerprint;
    if (value.projectionFingerprint !== computeFastFingerprint(fingerprintInput)) return undefined;
    if (value.actionPlan !== undefined && !hasSnapshotActionPlan(value.actionPlan)) return undefined;
    if (value.execution !== undefined && !hasSnapshotExecution(value.execution)) return undefined;

    const sources = value.sources as Record<string, unknown>;
    const actionPlan = value.actionPlan as Record<string, unknown> | undefined;
    const recovery = value.recovery as Record<string, unknown>;
    const evaluation = value.evaluation as Record<string, unknown>;
    const delivery = value.delivery as Record<string, unknown>;
    const goal = value.goal as Record<string, unknown>;
    const hasReconciliation = hasOwn(sources, 'runtimeActionPlanReconciliation');
    if (hasOwn(sources, 'runtimeActionPlan') !== Boolean(actionPlan)
        || hasReconciliation !== Boolean(
            actionPlan && actionPlan.reconciliationStatus !== 'not_observed'
        )
        || hasReconciliation !== hasOwn(value, 'execution')
        || hasOwn(sources, 'designVerdict') !== (evaluation.status !== 'not_observed')
        || hasOwn(sources, 'runtimeDeliveryVerification')
            !== (delivery.source === 'runtime_delivery_verification')
        || (goal.source === 'request_task_plan' && !hasOwn(sources, 'taskPlan'))
        || (goal.source === 'runtime_design_brief' && !hasOwn(sources, 'runtimeDesignBrief'))
        || (goal.source === 'runtime_action_plan' && !hasOwn(sources, 'runtimeActionPlan'))) {
        return undefined;
    }
    if (!hasReconciliation
        && (
            (recovery.failedStepIds as unknown[]).length > 0
            || (recovery.recoveredStepIds as unknown[]).length > 0
            || (recovery.resumeStepIds as unknown[]).length > 0
        )) {
        return undefined;
    }
    return value as unknown as RuntimeTaskSnapshot;
}
