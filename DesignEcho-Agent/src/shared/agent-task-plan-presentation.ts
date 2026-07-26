import type { AgentTaskPlanningContract } from './agent-task-planning-contract';
import type {
    RuntimeActionPlanDeclaration,
    RuntimeActionPlanStepKind
} from './agent-runtime-v5/runtime-action-plan-declaration';
import type {
    RuntimeActionPlanReconciliation,
    RuntimeActionPlanStepReconciliation
} from './agent-runtime-v5/runtime-action-plan-reconciliation';
import type { RuntimeSessionDigest } from './agent-runtime-v5/runtime-session';
import type { RuntimeStageTrace } from './agent-runtime-v5/runtime-stage-trace';
import {
    RUNTIME_TASK_SNAPSHOT_V1_VERSION,
    RUNTIME_TASK_SNAPSHOT_VERSION,
    type ReadableRuntimeTaskSnapshot,
    type RuntimeTaskSnapshotActionStepStatus
} from './agent-runtime-v5/runtime-task-snapshot';

export type AgentTaskPlanPresentationStepStatus =
    | 'pending'
    | 'running'
    | 'completed'
    | 'failed'
    | 'blocked';

export interface AgentTaskPlanPresentationIdentity {
    sessionId: string;
    runId: string;
    generation: number;
    revision: number;
    revisionHash: string;
    conversationId: string;
    projectId: string;
}

export interface AgentTaskPlanPresentationStep {
    id: string;
    kind: RuntimeActionPlanStepKind;
    label: string;
    status: AgentTaskPlanPresentationStepStatus;
}

/** 对话中的任务计划只保留用户可见的目标与步骤状态。 */
export interface AgentTaskPlanPresentation {
    version: 'agent-task-plan-presentation/v0';
    identity: AgentTaskPlanPresentationIdentity;
    goal: string;
    steps: AgentTaskPlanPresentationStep[];
}

export interface BuildAgentTaskPlanPresentationInput {
    runtimeTaskSnapshot?: ReadableRuntimeTaskSnapshot | null;
    taskPlan?: AgentTaskPlanningContract;
    declaration?: RuntimeActionPlanDeclaration;
    reconciliation?: RuntimeActionPlanReconciliation;
    runtimeSessionDigest?: RuntimeSessionDigest;
    runtimeStageTrace?: RuntimeStageTrace;
    conversationId?: string;
    projectId?: string;
}

export type AgentTaskPlanPresentationUpdateDecision =
    | 'accept_initial'
    | 'accept_new_generation'
    | 'accept_new_revision'
    | 'accept_status_update'
    | 'accept_idempotent'
    | 'reject_invalid_next'
    | 'reject_scope_mismatch'
    | 'reject_session_mismatch'
    | 'reject_late_generation'
    | 'reject_run_mismatch'
    | 'reject_late_revision'
    | 'reject_revision_conflict';

function cleanText(value: unknown, maxLength: number): string {
    return String(value || '').trim().replace(/\s+/g, ' ').slice(0, maxLength);
}

function stableHash(value: string): string {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return `r4-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function buildDeclarationRevisionHash(declaration: RuntimeActionPlanDeclaration): string {
    return stableHash(JSON.stringify({
        readiness: declaration.readiness,
        planGoal: declaration.payload.planGoal,
        steps: declaration.payload.steps.map((step) => ({
            stepId: step.stepId,
            kind: step.kind,
            goal: step.goal,
            dependsOn: step.dependsOn
        }))
    }));
}

function resolveDeclarationRevision(trace: RuntimeStageTrace | undefined): number {
    const sequences = (trace?.events || [])
        .filter((event) => event.stage === 'R4' && event.source === 'action_plan_declaration')
        .map((event) => event.sequence)
        .filter((sequence) => Number.isInteger(sequence) && sequence > 0);
    return sequences.length > 0 ? Math.max(...sequences) : 1;
}

function buildReconciliationByStepId(
    reconciliation: RuntimeActionPlanReconciliation | undefined
): Map<string, RuntimeActionPlanStepReconciliation> {
    if (!reconciliation || reconciliation.version !== 'runtime-action-plan-reconciliation/v0') {
        return new Map();
    }
    const byStepId = new Map<string, RuntimeActionPlanStepReconciliation>();
    const duplicateStepIds = new Set<string>();
    for (const step of reconciliation.steps) {
        if (byStepId.has(step.stepId)) {
            duplicateStepIds.add(step.stepId);
            continue;
        }
        byStepId.set(step.stepId, step);
    }
    for (const stepId of duplicateStepIds) {
        byStepId.delete(stepId);
    }
    return byStepId;
}

/**
 * 将 Runtime 对账结果压缩为用户可见的通用步骤状态。
 */
function projectRuntimeStepStatus(
    declarationKind: RuntimeActionPlanStepKind,
    reconciliation: RuntimeActionPlanStepReconciliation | undefined
): AgentTaskPlanPresentationStepStatus {
    if (!reconciliation || reconciliation.kind !== declarationKind) return 'pending';
    switch (reconciliation.status) {
        case 'completed':
            return 'completed';
        case 'in_progress':
            return 'running';
        case 'failed':
            return 'failed';
        case 'blocked_by_dependency':
            return 'blocked';
        case 'ready':
        default:
            return 'pending';
    }
}

function projectSnapshotStepStatus(
    status: RuntimeTaskSnapshotActionStepStatus
): AgentTaskPlanPresentationStepStatus {
    switch (status) {
        case 'completed':
            return 'completed';
        case 'in_progress':
            return 'running';
        case 'failed':
            return 'failed';
        case 'blocked_by_dependency':
            return 'blocked';
        case 'not_observed':
        case 'ready':
        default:
            return 'pending';
    }
}

function buildPresentationFromRuntimeTaskSnapshot(
    input: BuildAgentTaskPlanPresentationInput
): AgentTaskPlanPresentation | undefined {
    const snapshot = input.runtimeTaskSnapshot;
    const actionPlan = snapshot?.actionPlan;
    const conversationId = cleanText(input.conversationId, 160);
    const projectId = cleanText(input.projectId, 240);
    if (!snapshot
        || (
            snapshot.version !== RUNTIME_TASK_SNAPSHOT_VERSION
            && snapshot.version !== RUNTIME_TASK_SNAPSHOT_V1_VERSION
        )
        || !actionPlan
        || actionPlan.steps.length === 0
        || !conversationId
        || !projectId) {
        return undefined;
    }
    return {
        version: 'agent-task-plan-presentation/v0',
        identity: {
            sessionId: snapshot.identity.sessionId,
            runId: snapshot.identity.runId,
            generation: snapshot.identity.generation,
            revision: actionPlan.presentationRevision,
            revisionHash: actionPlan.presentationRevisionHash,
            conversationId,
            projectId
        },
        goal: cleanText(snapshot.goal.text, 360) || '完成当前任务',
        steps: actionPlan.steps.map((step) => ({
            id: step.stepId,
            kind: step.kind,
            label: cleanText(step.goal, 360) || step.stepId,
            status: projectSnapshotStepStatus(step.status)
        }))
    };
}

function hasValidIdentity(presentation: AgentTaskPlanPresentation | undefined): boolean {
    if (!presentation || presentation.version !== 'agent-task-plan-presentation/v0') return false;
    const identity = presentation.identity;
    return Boolean(
        cleanText(identity.sessionId, 160)
        && cleanText(identity.runId, 160)
        && Number.isInteger(identity.generation)
        && identity.generation > 0
        && Number.isInteger(identity.revision)
        && identity.revision > 0
        && cleanText(identity.revisionHash, 80)
        && cleanText(identity.conversationId, 160)
        && cleanText(identity.projectId, 240)
    );
}

export function buildAgentTaskPlanPresentation(
    input: BuildAgentTaskPlanPresentationInput
): AgentTaskPlanPresentation | undefined {
    if (Object.prototype.hasOwnProperty.call(input, 'runtimeTaskSnapshot')) {
        return buildPresentationFromRuntimeTaskSnapshot(input);
    }
    const taskPlan = input.taskPlan;
    const declaration = input.declaration;
    const runtimeSessionDigest = input.runtimeSessionDigest;
    const conversationId = cleanText(input.conversationId, 160);
    const projectId = cleanText(input.projectId, 240);
    if (!taskPlan || !declaration || !runtimeSessionDigest || !conversationId || !projectId) {
        return undefined;
    }
    if (declaration.version !== 'runtime-action-plan-declaration/v0') return undefined;
    if (runtimeSessionDigest.version !== 'runtime-session-digest/v0') return undefined;
    if (declaration.payload.steps.length === 0) return undefined;

    const reconciliationByStepId = buildReconciliationByStepId(input.reconciliation);
    const steps = declaration.payload.steps.map((step) => ({
        id: step.stepId,
        kind: step.kind,
        label: cleanText(step.goal, 360) || step.stepId,
        status: projectRuntimeStepStatus(step.kind, reconciliationByStepId.get(step.stepId))
    }));

    return {
        version: 'agent-task-plan-presentation/v0',
        identity: {
            sessionId: runtimeSessionDigest.sessionId,
            runId: runtimeSessionDigest.runId,
            generation: runtimeSessionDigest.generation,
            revision: resolveDeclarationRevision(input.runtimeStageTrace),
            revisionHash: buildDeclarationRevisionHash(declaration),
            conversationId,
            projectId
        },
        goal: cleanText(taskPlan.designBrief.goal, 360)
            || cleanText(declaration.payload.planGoal, 360)
            || '完成当前任务',
        steps
    };
}

function hasSameStepStatuses(
    current: AgentTaskPlanPresentation,
    next: AgentTaskPlanPresentation
): boolean {
    if (current.steps.length !== next.steps.length) return false;
    return current.steps.every((step, index) => {
        const nextStep = next.steps[index];
        return Boolean(nextStep && step.id === nextStep.id && step.status === nextStep.status);
    });
}

export function decideAgentTaskPlanPresentationUpdate(input: {
    current?: AgentTaskPlanPresentation;
    next?: AgentTaskPlanPresentation;
}): AgentTaskPlanPresentationUpdateDecision {
    if (!hasValidIdentity(input.next)) return 'reject_invalid_next';
    if (!input.current) return 'accept_initial';
    if (!hasValidIdentity(input.current)) return 'accept_initial';

    const current = input.current.identity;
    const next = input.next!.identity;
    if (current.conversationId !== next.conversationId || current.projectId !== next.projectId) {
        return 'reject_scope_mismatch';
    }
    if (current.sessionId !== next.sessionId) return 'reject_session_mismatch';
    if (next.generation < current.generation) return 'reject_late_generation';
    if (next.generation > current.generation) return 'accept_new_generation';
    if (current.runId !== next.runId) return 'reject_run_mismatch';
    if (next.revision < current.revision) return 'reject_late_revision';
    if (next.revision > current.revision) return 'accept_new_revision';
    if (next.revisionHash !== current.revisionHash) return 'reject_revision_conflict';
    if (!hasSameStepStatuses(input.current, input.next!)) return 'accept_status_update';
    return 'accept_idempotent';
}

export function shouldAcceptAgentTaskPlanPresentationUpdate(input: {
    current?: AgentTaskPlanPresentation;
    next?: AgentTaskPlanPresentation;
}): boolean {
    return decideAgentTaskPlanPresentationUpdate(input).startsWith('accept_');
}
