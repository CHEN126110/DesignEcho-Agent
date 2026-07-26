/**
 * Production Runtime Session（G1 增量 owner）。
 *
 * 它把一次用户任务中的 Skill / Stage Plan、实时 Stage State、Stage Trace 与
 * Reflexion 代次绑定到同一身份。它不是第三套 Workflow Runtime，不调度 Tool、
 * 不改变任务成败，也不从任务文本推断品类。
 */

import type { RuntimeStage } from './contracts';
import type { ReflexionHandoff } from './reflexion-contract';
import {
    applyRuntimeStageEvaluation,
    createRuntimeStageState,
    type RuntimeStageEvaluationEvent,
    type RuntimeStageEvaluationOutcome,
    type RuntimeStageState
} from './runtime-stage-state';
import type { RuntimeStagePlan } from './runtime-stage-plan';
import {
    appendRuntimeStageTraceEvent,
    buildRuntimeStageTraceDigest,
    createRuntimeStageTrace,
    type RuntimeStageTrace,
    type RuntimeStageTraceDigest,
    type RuntimeStageTraceEventInput
} from './runtime-stage-trace';
import type { DesignVerdict } from '../design-quality-verdict-bundle';
import type { AgentToolExecutionKind } from '../agent-tool-execution-preflight';
import {
    buildRuntimeAccountingDigest,
    createRuntimeAccountingLedger,
    recordRuntimeModelCall,
    recordRuntimeRecoveryAttempt,
    recordRuntimeReflexion,
    recordRuntimeToolCall,
    type RuntimeAccountingDigest,
    type RuntimeAccountingLedger
} from './runtime-accounting';

export const RUNTIME_SESSION_IDENTITY_VERSION = 'runtime-session-identity/v0' as const;
export const RUNTIME_SESSION_VERSION = 'runtime-session/v0' as const;
export const RUNTIME_SESSION_DIGEST_VERSION = 'runtime-session-digest/v0' as const;

export interface RuntimeSessionIdentity {
    version: typeof RUNTIME_SESSION_IDENTITY_VERSION;
    sessionId: string;
    runId: string;
    generation: number;
    parentRunId?: string;
    issuedAt: string;
    skillId?: string;
    taskType?: string;
    boundaries: {
        identityOnly: true;
        grantsPermission: false;
        executesTools: false;
        changesTaskResult: false;
        categoryNeutral: true;
    };
}

export interface RuntimeSession {
    version: typeof RUNTIME_SESSION_VERSION;
    identity: RuntimeSessionIdentity;
    planVersion: RuntimeStagePlan['version'];
    skillId: string;
    taskType: string;
    stageState: RuntimeStageState;
    stageTrace: RuntimeStageTrace;
    accounting: RuntimeAccountingLedger;
    /** 本 generation 开始前已有的 transition 数；Trace digest 只对账之后的增量。 */
    generationStartTransitionCount: number;
    finalized: boolean;
    issues: string[];
    boundaries: {
        singleStageOwner: true;
        stageOutcomeDriven: true;
        executesTools: false;
        grantsPermission: false;
        changesTaskResult: false;
        categoryNeutral: true;
    };
}

export interface RuntimeSessionDigest {
    version: typeof RUNTIME_SESSION_DIGEST_VERSION;
    sessionId: string;
    runId: string;
    generation: number;
    parentRunId?: string;
    issuedAt: string;
    planVersion: RuntimeStagePlan['version'];
    skillId: string;
    taskType: string;
    status: RuntimeStageState['status'];
    currentStage?: RuntimeStage;
    transitionCount: number;
    traceStatus: RuntimeStageTraceDigest['status'];
    traceEventCount: number;
    accounting: RuntimeAccountingDigest;
    finalized: boolean;
    issueCount: number;
    boundaries: {
        digestOnly: true;
        oneSessionIdentity: true;
        executesTools: false;
        grantsPermission: false;
        changesTaskResult: false;
    };
}

export interface RuntimeSessionIdentityValidation {
    ok: boolean;
    issues: string[];
}

export interface RuntimeSessionExecutionSummaryInput {
    status: 'completed' | 'needs_review' | 'failed' | 'cancelled' | 'awaiting_confirmation';
    stopReason?: string;
    blockers?: string[];
    warnings?: string[];
    designVerdict?: DesignVerdict;
}

export interface RuntimeSessionCompletionProjection {
    version: 'runtime-session-completion-projection/v0';
    status: RuntimeSessionExecutionSummaryInput['status'];
    changed: boolean;
    reasonCode?:
        | 'runtime_outcomes_incomplete'
        | 'quality_review_incomplete'
        | 'delivery_result_incomplete';
    /** 面向普通用户的简短状态，不包含阶段代号或内部枚举。 */
    summaryText?: string;
    /** 面向普通用户的具体原因，不包含 Runtime / R5 / E2 / unobserved。 */
    blocker?: string;
    boundaries: {
        projectsExistingRuntimeState: true;
        doesNotAdvanceStage: true;
        doesNotExecuteTools: true;
        categoryNeutral: true;
    };
}

export interface RuntimeSessionToolExecutionGate {
    status: 'allowed' | 'blocked' | 'not_applicable';
    allowed: boolean;
    code?: 'runtime_session_r4_not_ready';
    currentStage?: RuntimeStage;
    blockedTool?: string;
    boundaries: {
        executionPointOnly: true;
        executesTools: false;
        grantsPermission: false;
        categoryNeutral: true;
    };
}

const ID_PATTERN = /^(?:runtime|run)-[a-z0-9-]+$/i;
const MAX_SESSION_ISSUES = 30;

function cleanText(value: unknown, limit = 240): string {
    return String(value || '').replace(/\s+/g, ' ').trim().slice(0, limit);
}

function cleanIdentityToken(value: unknown, limit = 120): string {
    const normalized = cleanText(value, limit);
    return /^[A-Za-z0-9_.:-]+$/.test(normalized) ? normalized : '';
}

function compactTimestamp(value: string): string {
    return value.replace(/[-:TZ.]/g, '').slice(0, 17) || 'unknown';
}

function stableHash(input: string): string {
    let hash = 0x811c9dc5;
    for (let index = 0; index < input.length; index += 1) {
        hash ^= input.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash.toString(16).padStart(8, '0');
}

function uniqueIssues(values: readonly unknown[]): string[] {
    return Array.from(new Set(values.map((value) => cleanText(value, 160)).filter(Boolean)))
        .slice(0, MAX_SESSION_ISSUES);
}

function hasStage(plan: RuntimeStagePlan, stage: RuntimeStage): boolean {
    return plan.steps.some((step) => step.stage === stage);
}

function resetReflexionTargetAndDownstream(input: {
    state: RuntimeStageState;
    plan: RuntimeStagePlan;
}): RuntimeStageState {
    if (input.state.status !== 'reflexion_required' || !input.state.currentStage) {
        return input.state;
    }
    const targetIndex = input.plan.steps.findIndex((step) => step.stage === input.state.currentStage);
    if (targetIndex < 0) {
        return {
            ...input.state,
            issues: uniqueIssues([
                ...input.state.issues,
                `runtime_session_reflexion_target_not_in_plan:${input.state.currentStage}`
            ])
        };
    }
    const invalidatedStages = new Set(
        input.plan.steps.slice(targetIndex).map((step) => step.stage)
    );
    return {
        ...input.state,
        status: 'active',
        stages: input.state.stages.map((stage) => {
            if (!invalidatedStages.has(stage.stage)) return stage;
            return {
                ...stage,
                status: 'unobserved',
                observedOutcomes: [],
                missingOutcomes: [...stage.requiredOutcomes],
                lastEvaluation: undefined
            };
        }),
        issues: uniqueIssues([
            ...input.state.issues,
            `runtime_session_reflexion_generation_started:${input.state.currentStage}`
        ])
    };
}

function firstMessage(values: readonly string[] | undefined): string {
    return cleanText(Array.isArray(values) ? values[0] : '');
}

function verdictOutcome(verdict: DesignVerdict): RuntimeStageEvaluationOutcome {
    switch (verdict.status) {
        case 'passed':
            return 'passed';
        case 'failed':
            return 'failed';
        case 'needs_review':
            return 'needs_review';
        case 'passed_unverified':
        case 'not_applicable':
        default:
            return 'missing_required_outcomes';
    }
}

export function validateRuntimeSessionIdentity(
    identity: unknown
): RuntimeSessionIdentityValidation {
    if (!identity || typeof identity !== 'object') {
        return { ok: false, issues: ['runtime_session_identity_not_object'] };
    }
    const value = identity as Partial<RuntimeSessionIdentity>;
    const issues: string[] = [];
    if (value.version !== RUNTIME_SESSION_IDENTITY_VERSION) {
        issues.push('runtime_session_identity_version_invalid');
    }
    if (!value.sessionId || !ID_PATTERN.test(value.sessionId) || !value.sessionId.startsWith('runtime-')) {
        issues.push('runtime_session_id_invalid');
    }
    if (!value.runId || !ID_PATTERN.test(value.runId) || !value.runId.startsWith('run-')) {
        issues.push('runtime_session_run_id_invalid');
    }
    if (!Number.isInteger(value.generation) || Number(value.generation) < 1) {
        issues.push('runtime_session_generation_invalid');
    }
    if (!cleanText(value.issuedAt, 40) || !Number.isFinite(Date.parse(String(value.issuedAt)))) {
        issues.push('runtime_session_issued_at_invalid');
    }
    if (Number(value.generation) === 1 && value.parentRunId) {
        issues.push('runtime_session_first_generation_has_parent');
    }
    if (Number(value.generation) > 1 && (!value.parentRunId || !ID_PATTERN.test(value.parentRunId))) {
        issues.push('runtime_session_parent_run_id_missing');
    }
    if (value.parentRunId && value.parentRunId === value.runId) {
        issues.push('runtime_session_parent_equals_run');
    }
    if (value.skillId && !cleanIdentityToken(value.skillId)) {
        issues.push('runtime_session_skill_id_invalid');
    }
    if (value.taskType && !cleanIdentityToken(value.taskType)) {
        issues.push('runtime_session_task_type_invalid');
    }
    const boundaries = value.boundaries;
    if (!boundaries
        || boundaries.identityOnly !== true
        || boundaries.grantsPermission !== false
        || boundaries.executesTools !== false
        || boundaries.changesTaskResult !== false
        || boundaries.categoryNeutral !== true) {
        issues.push('runtime_session_identity_boundaries_invalid');
    }
    return { ok: issues.length === 0, issues };
}

export function createRuntimeSessionIdentity(input: {
    now: string;
    nonce: string;
    generation?: number;
    sessionId?: string;
    parentRunId?: string;
    skillId?: string;
    taskType?: string;
}): RuntimeSessionIdentity {
    const issuedAt = cleanText(input.now, 40);
    if (!issuedAt || !Number.isFinite(Date.parse(issuedAt))) {
        throw new Error('runtime_session_issued_at_invalid');
    }
    const nonce = cleanIdentityToken(input.nonce, 120);
    if (!nonce) throw new Error('runtime_session_nonce_invalid');
    const generation = Number.isInteger(input.generation) && Number(input.generation) > 0
        ? Number(input.generation)
        : 1;
    const skillId = cleanIdentityToken(input.skillId);
    const taskType = cleanIdentityToken(input.taskType);
    const timestamp = compactTimestamp(issuedAt);
    const generatedSessionId = `runtime-${timestamp}-${stableHash(`${nonce}|${skillId}|${taskType}`)}`;
    const sessionId = input.sessionId || generatedSessionId;
    const runId = `run-${timestamp}-${stableHash(`${sessionId}|${generation}|${nonce}`)}`;
    const identity: RuntimeSessionIdentity = {
        version: RUNTIME_SESSION_IDENTITY_VERSION,
        sessionId,
        runId,
        generation,
        ...(input.parentRunId ? { parentRunId: input.parentRunId } : {}),
        issuedAt,
        ...(skillId ? { skillId } : {}),
        ...(taskType ? { taskType } : {}),
        boundaries: {
            identityOnly: true,
            grantsPermission: false,
            executesTools: false,
            changesTaskResult: false,
            categoryNeutral: true
        }
    };
    const validation = validateRuntimeSessionIdentity(identity);
    if (!validation.ok) throw new Error(validation.issues.join(','));
    return identity;
}

export function advanceRuntimeSessionIdentity(input: {
    previous: RuntimeSessionIdentity;
    now: string;
    nonce: string;
}): RuntimeSessionIdentity {
    const validation = validateRuntimeSessionIdentity(input.previous);
    if (!validation.ok) throw new Error(validation.issues.join(','));
    return createRuntimeSessionIdentity({
        now: input.now,
        nonce: input.nonce,
        generation: input.previous.generation + 1,
        sessionId: input.previous.sessionId,
        parentRunId: input.previous.runId,
        skillId: input.previous.skillId,
        taskType: input.previous.taskType
    });
}

export function advanceRuntimeSessionGeneration(input: {
    previous: RuntimeSession;
    identity: RuntimeSessionIdentity;
    plan: RuntimeStagePlan;
}): RuntimeSession {
    const validation = validateRuntimeSessionIdentity(input.identity);
    if (!validation.ok) throw new Error(validation.issues.join(','));
    if (!input.previous.finalized) throw new Error('runtime_session_previous_generation_not_finalized');
    if (input.identity.sessionId !== input.previous.identity.sessionId) {
        throw new Error('runtime_session_generation_session_mismatch');
    }
    if (input.identity.generation !== input.previous.identity.generation + 1) {
        throw new Error('runtime_session_generation_not_monotonic');
    }
    if (input.identity.parentRunId !== input.previous.identity.runId) {
        throw new Error('runtime_session_generation_parent_mismatch');
    }
    if (input.plan.skillId !== input.previous.skillId || input.plan.taskType !== input.previous.taskType) {
        throw new Error('runtime_session_generation_plan_mismatch');
    }
    const copiedStageState: RuntimeStageState = {
        ...input.previous.stageState,
        stages: input.previous.stageState.stages.map((stage) => ({
            ...stage,
            requiredOutcomes: [...stage.requiredOutcomes],
            observedOutcomes: [...stage.observedOutcomes],
            missingOutcomes: [...stage.missingOutcomes],
            ...(stage.lastEvaluation ? {
                lastEvaluation: {
                    ...stage.lastEvaluation,
                    ...(stage.lastEvaluation.verdict
                        ? { verdict: { ...stage.lastEvaluation.verdict } }
                        : {})
                }
            } : {})
        })),
        transitions: input.previous.stageState.transitions.map((transition) => ({
            ...transition,
            observedOutcomes: [...transition.observedOutcomes],
            missingOutcomes: [...transition.missingOutcomes]
        })),
        issues: [...input.previous.stageState.issues]
    };
    return {
        ...input.previous,
        identity: input.identity,
        stageState: resetReflexionTargetAndDownstream({
            state: copiedStageState,
            plan: input.plan
        }),
        stageTrace: createRuntimeStageTrace(input.plan),
        accounting: recordRuntimeReflexion(input.previous.accounting, input.identity.issuedAt),
        generationStartTransitionCount: input.previous.stageState.transitions.length,
        finalized: false,
        issues: [...input.previous.issues]
    };
}

export function createRuntimeSession(input: {
    identity: RuntimeSessionIdentity;
    plan: RuntimeStagePlan;
}): RuntimeSession {
    const validation = validateRuntimeSessionIdentity(input.identity);
    if (!validation.ok) throw new Error(validation.issues.join(','));
    if (input.identity.skillId && input.identity.skillId !== input.plan.skillId) {
        throw new Error('runtime_session_skill_plan_mismatch');
    }
    if (input.identity.taskType && input.identity.taskType !== input.plan.taskType) {
        throw new Error('runtime_session_task_plan_mismatch');
    }
    let stageState = createRuntimeStageState(input.plan);
    if (hasStage(input.plan, 'R0')) {
        stageState = applyRuntimeStageEvaluation({
            plan: input.plan,
            state: stageState,
            event: {
                stage: 'R0',
                outcome: 'passed',
                observedOutcomes: ['skill_manifest_selected', 'stage_plan_created'],
                reason: 'Runtime Session 已绑定结构化 Skill manifest 与 stage plan。'
            }
        });
    }
    return {
        version: RUNTIME_SESSION_VERSION,
        identity: input.identity,
        planVersion: input.plan.version,
        skillId: input.plan.skillId,
        taskType: input.plan.taskType,
        stageState,
        stageTrace: createRuntimeStageTrace(input.plan),
        accounting: createRuntimeAccountingLedger(input.identity.issuedAt),
        generationStartTransitionCount: 0,
        finalized: false,
        issues: [],
        boundaries: {
            singleStageOwner: true,
            stageOutcomeDriven: true,
            executesTools: false,
            grantsPermission: false,
            changesTaskResult: false,
            categoryNeutral: true
        }
    };
}

export function appendRuntimeSessionObservation(input: {
    session: RuntimeSession;
    plan: RuntimeStagePlan;
    event: RuntimeStageTraceEventInput;
}): RuntimeSession {
    if (input.session.finalized) {
        return {
            ...input.session,
            issues: uniqueIssues([...input.session.issues, 'runtime_session_event_after_finalize'])
        };
    }
    const stageTrace = appendRuntimeStageTraceEvent({
        plan: input.plan,
        trace: input.session.stageTrace,
        event: input.event
    });
    return {
        ...input.session,
        stageTrace
    };
}

export function recordRuntimeSessionModelCall(input: {
    session: RuntimeSession;
    durationMs: number;
    succeeded: boolean;
    usage?: { inputTokens?: number; outputTokens?: number };
    now?: string;
}): RuntimeSession {
    return {
        ...input.session,
        accounting: recordRuntimeModelCall({
            ledger: input.session.accounting,
            stage: input.session.stageState.currentStage,
            durationMs: input.durationMs,
            succeeded: input.succeeded,
            usage: input.usage,
            now: input.now
        })
    };
}

export function recordRuntimeSessionToolCall(input: {
    session: RuntimeSession;
    durationMs: number;
    succeeded: boolean;
    now?: string;
}): RuntimeSession {
    return {
        ...input.session,
        accounting: recordRuntimeToolCall({
            ledger: input.session.accounting,
            stage: input.session.stageState.currentStage,
            durationMs: input.durationMs,
            succeeded: input.succeeded,
            now: input.now
        })
    };
}

export function recordRuntimeSessionRecoveryAttempt(input: {
    session: RuntimeSession;
    now?: string;
}): RuntimeSession {
    return {
        ...input.session,
        accounting: recordRuntimeRecoveryAttempt(input.session.accounting, input.now)
    };
}

export function applyRuntimeSessionStageEvaluation(input: {
    session: RuntimeSession;
    plan: RuntimeStagePlan;
    event: RuntimeStageEvaluationEvent;
}): RuntimeSession {
    if (input.session.finalized) {
        return {
            ...input.session,
            issues: uniqueIssues([...input.session.issues, 'runtime_session_evaluation_after_finalize'])
        };
    }
    if (input.session.stageState.currentStage !== input.event.stage) {
        return {
            ...input.session,
            issues: uniqueIssues([
                ...input.session.issues,
                `runtime_session_evaluation_stage_mismatch:expected=${input.session.stageState.currentStage || 'none'},observed=${input.event.stage}`
            ])
        };
    }
    return {
        ...input.session,
        stageState: applyRuntimeStageEvaluation({
            plan: input.plan,
            state: input.session.stageState,
            event: input.event
        })
    };
}

export function finalizeRuntimeSession(input: {
    session: RuntimeSession;
    plan: RuntimeStagePlan;
    executionSummary: RuntimeSessionExecutionSummaryInput;
    reflexionHandoff?: ReflexionHandoff;
}): RuntimeSession {
    if (input.session.finalized) return input.session;
    let session = input.session;
    if (input.executionSummary.status === 'cancelled') {
        const target = session.stageState.currentStage || input.plan.steps[0]?.stage;
        if (target) {
            session = applyRuntimeSessionStageEvaluation({
                session,
                plan: input.plan,
                event: {
                    stage: target,
                    outcome: 'cancelled',
                    observedOutcomes: [],
                    reason: '运行被取消；未观察阶段不补造完成。'
                }
            });
        }
        return { ...session, finalized: true };
    }
    if (input.executionSummary.status === 'awaiting_confirmation') {
        const target = session.stageState.currentStage || input.plan.steps[0]?.stage;
        if (target) {
            session = applyRuntimeSessionStageEvaluation({
                session,
                plan: input.plan,
                event: {
                    stage: target,
                    outcome: 'awaiting_confirmation',
                    observedOutcomes: [],
                    reason: '任务停在当前阶段的用户确认点；普通交互卡片不能推进到 E2。'
                }
            });
        }
        return { ...session, finalized: true };
    }
    if (hasStage(input.plan, 'R5') && session.stageState.currentStage === 'R5') {
        const verdict = input.executionSummary.designVerdict;
        const outcome = verdict
            ? verdictOutcome(verdict)
            : (input.reflexionHandoff?.status === 'reflexion_required' ? 'failed' : 'missing_required_outcomes');
        const reason = verdict?.summary
            || firstMessage(input.executionSummary.blockers)
            || firstMessage(input.executionSummary.warnings)
            || `执行状态 ${input.executionSummary.status} 没有机读 DesignVerdict。`;
        const reflexionHandoff = input.reflexionHandoff;
        const event: RuntimeStageEvaluationEvent = {
            stage: 'R5',
            outcome,
            observedOutcomes: verdict
                ? ['quality_gate_report', 'stage_evaluation']
                : ['stage_evaluation'],
            reason,
            ...(verdict ? { verdict } : {}),
            ...(reflexionHandoff ? { reflexionHandoff } : {})
        };
        session = applyRuntimeSessionStageEvaluation({
            session,
            plan: input.plan,
            event
        });
    }
    const r5Passed = session.stageState.stages.find((stage) => stage.stage === 'R5')?.status === 'passed';
    if (r5Passed) {
        for (const event of session.stageTrace.events) {
            if (event.stage !== 'E2') continue;
            session = applyRuntimeSessionStageEvaluation({
                session,
                plan: input.plan,
                event: {
                    stage: event.stage,
                    outcome: event.outcome,
                    observedOutcomes: event.observedOutcomes
                }
            });
        }
    }
    return { ...session, finalized: true };
}

/**
 * 把 Runtime Session 的唯一阶段事实投影到 Agent 最终状态。
 *
 * 本函数不推进阶段、不执行 Tool，也不重新评价质量；它只处理一种冲突：旧执行摘要
 * 已准备声明 completed，但同一生产 Session 尚未形成完整 R5 复核和 E2 交付结果。用户文案在
 * 这里一次生成，避免 Agent 核心和 UI 分别解释内部阶段枚举。
 */
export function projectRuntimeSessionCompletion(input: {
    executionStatus: RuntimeSessionExecutionSummaryInput['status'];
    stageState: RuntimeStageState;
}): RuntimeSessionCompletionProjection {
    const boundaries = {
        projectsExistingRuntimeState: true as const,
        doesNotAdvanceStage: true as const,
        doesNotExecuteTools: true as const,
        categoryNeutral: true as const
    };
    if (input.executionStatus !== 'completed' || input.stageState.status === 'completed') {
        return {
            version: 'runtime-session-completion-projection/v0',
            status: input.executionStatus,
            changed: false,
            boundaries
        };
    }

    const r5Status = input.stageState.stages.find((stage) => stage.stage === 'R5')?.status;
    const e2Status = input.stageState.stages.find((stage) => stage.stage === 'E2')?.status;
    if (r5Status !== 'passed') {
        const qualityWasEvaluated = Boolean(r5Status && r5Status !== 'unobserved');
        return {
            version: 'runtime-session-completion-projection/v0',
            status: 'needs_review',
            changed: true,
            reasonCode: qualityWasEvaluated ? 'quality_review_incomplete' : 'runtime_outcomes_incomplete',
            summaryText: '这稿先做到这里。',
            blocker: qualityWasEvaluated
                ? '这版我自己看着还没到位，想再调一下再给你。'
                : '这稿还没真正做完，你可以让我接着做。',
            boundaries
        };
    }

    return {
        version: 'runtime-session-completion-projection/v0',
        status: 'needs_review',
        changed: true,
        reasonCode: 'delivery_result_incomplete',
        summaryText: '这稿先做到这里。',
        blocker: e2Status === 'passed'
            ? '内容做好了，但还没最终确认交付，你先看看。'
            : '这版看着可以了，但还没导出/存好，稍等我收尾。',
        boundaries
    };
}

export function buildRuntimeSessionDigest(input: {
    session: RuntimeSession;
    plan: RuntimeStagePlan;
}): RuntimeSessionDigest {
    const traceDigest = buildRuntimeStageTraceDigest({
        plan: input.plan,
        trace: input.session.stageTrace,
        state: input.session.stageState,
        transitionSequenceFloor: input.session.generationStartTransitionCount
    });
    return {
        version: RUNTIME_SESSION_DIGEST_VERSION,
        sessionId: input.session.identity.sessionId,
        runId: input.session.identity.runId,
        generation: input.session.identity.generation,
        ...(input.session.identity.parentRunId ? { parentRunId: input.session.identity.parentRunId } : {}),
        issuedAt: input.session.identity.issuedAt,
        planVersion: input.session.planVersion,
        skillId: input.session.skillId,
        taskType: input.session.taskType,
        status: input.session.stageState.status,
        ...(input.session.stageState.currentStage ? { currentStage: input.session.stageState.currentStage } : {}),
        transitionCount: input.session.stageState.transitions.length,
        traceStatus: traceDigest.status,
        traceEventCount: traceDigest.eventCount,
        accounting: buildRuntimeAccountingDigest({ ledger: input.session.accounting }),
        finalized: input.session.finalized,
        issueCount: input.session.issues.length
            + input.session.stageState.issues.length
            + input.session.stageTrace.issues.length,
        boundaries: {
            digestOnly: true,
            oneSessionIdentity: true,
            executesTools: false,
            grantsPermission: false,
            changesTaskResult: false
        }
    };
}

export function evaluateRuntimeSessionToolExecutionGate(input: {
    session: RuntimeSession;
    toolName: string;
    toolKind: AgentToolExecutionKind;
}): RuntimeSessionToolExecutionGate {
    const changesExternalState = input.toolKind === 'photoshop_write'
        || input.toolKind === 'save_export'
        || input.toolKind === 'external_generation';
    const boundaries = {
        executionPointOnly: true as const,
        executesTools: false as const,
        grantsPermission: false as const,
        categoryNeutral: true as const
    };
    if (!changesExternalState) {
        return {
            status: 'not_applicable',
            allowed: true,
            currentStage: input.session.stageState.currentStage,
            boundaries
        };
    }
    const currentStage = input.session.stageState.currentStage;
    const allowedInExecutionStage = currentStage === 'E1'
        || (currentStage === 'E2' && input.toolKind === 'save_export');
    if (allowedInExecutionStage) {
        return {
            status: 'allowed',
            allowed: true,
            currentStage,
            boundaries
        };
    }
    return {
        status: 'blocked',
        allowed: false,
        code: 'runtime_session_r4_not_ready',
        currentStage: input.session.stageState.currentStage,
        blockedTool: cleanText(input.toolName, 80),
        boundaries
    };
}
