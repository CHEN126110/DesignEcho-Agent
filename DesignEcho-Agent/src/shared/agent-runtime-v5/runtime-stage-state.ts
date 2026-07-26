/**
 * Runtime Stage State（evaluation-only）。
 *
 * Stage plan 只声明阶段、预期结果和失败去向；本 reducer 只根据结构化 Evaluation
 * 事件记录状态转换，不调度 Tool、不读取用户文本、不改变任务成败。它是未来
 * 动态 Workflow / DAG 的状态基座，不是 DAG executor。
 */

import type { DesignVerdict } from '../design-quality-verdict-bundle';
import type { RuntimeStage } from './contracts';
import type { ReflexionHandoff } from './reflexion-contract';
import type { RuntimeStagePlan } from './runtime-stage-plan';

export type RuntimeStageObservedStatus =
    | 'unobserved'
    | 'passed'
    | 'needs_review'
    | 'failed'
    | 'awaiting_confirmation'
    | 'cancelled';

export type RuntimeStageStateStatus =
    | 'active'
    | 'awaiting_outcomes'
    | 'awaiting_confirmation'
    | 'reflexion_required'
    | 'completed'
    | 'cancelled';

export type RuntimeStageEvaluationOutcome =
    | 'passed'
    | 'needs_review'
    | 'missing_required_outcomes'
    | 'failed'
    | 'awaiting_confirmation'
    | 'cancelled';

export type RuntimeStageTransitionDecision =
    | 'advance'
    | 'complete'
    | 'continue_react'
    | 'await_outcome_or_review'
    | 'enter_reflexion'
    | 'await_user_confirmation'
    | 'stop_cancelled';

export interface RuntimeStageEvaluationEvent {
    stage: RuntimeStage;
    outcome: RuntimeStageEvaluationOutcome;
    observedOutcomes: string[];
    reason?: string;
    verdict?: DesignVerdict;
    reflexionHandoff?: ReflexionHandoff;
}

export interface RuntimeStageSnapshot {
    stage: RuntimeStage;
    status: RuntimeStageObservedStatus;
    attempts: number;
    requiredOutcomes: string[];
    observedOutcomes: string[];
    missingOutcomes: string[];
    lastEvaluation?: {
        outcome: RuntimeStageEvaluationOutcome;
        reason?: string;
        verdict?: {
            version: 'design-quality-verdict/v0';
            status: DesignVerdict['status'];
            source: DesignVerdict['source'];
            overallScore?: number;
        };
    };
}

export interface RuntimeStageTransitionRecord {
    sequence: number;
    evaluatedStage: RuntimeStage;
    decision: RuntimeStageTransitionDecision;
    targetStage?: RuntimeStage;
    outcome: RuntimeStageEvaluationOutcome;
    observedOutcomes: string[];
    missingOutcomes: string[];
    reason?: string;
}

export interface RuntimeStageState {
    version: 'runtime-stage-state/v0';
    planVersion: RuntimeStagePlan['version'];
    skillId: string;
    taskType: string;
    status: RuntimeStageStateStatus;
    currentStage?: RuntimeStage;
    stages: RuntimeStageSnapshot[];
    transitions: RuntimeStageTransitionRecord[];
    issues: string[];
    boundaries: {
        evaluationOnly: true;
        executesTools: false;
        changesTaskResult: false;
        categoryNeutral: true;
    };
}

export interface BuildRuntimeStageStateFromEvaluationInput {
    plan: RuntimeStagePlan;
    /** 真实运行点产生的结构化阶段事件；不允许由任务文本或 assistant content 推断。 */
    observedEvents?: RuntimeStageEvaluationEvent[];
    executionSummary: {
        status: 'completed' | 'needs_review' | 'failed' | 'cancelled' | 'awaiting_confirmation';
        stopReason?: string;
        blockers?: string[];
        warnings?: string[];
        designVerdict?: DesignVerdict;
    };
    reflexionHandoff?: ReflexionHandoff;
}

type RuntimeStageVerdictSnapshot = NonNullable<
    NonNullable<RuntimeStageSnapshot['lastEvaluation']>['verdict']
>;

function cleanText(value: unknown, limit = 240): string {
    return String(value || '').replace(/\s+/g, ' ').trim().slice(0, limit);
}

function unique(values: readonly unknown[]): string[] {
    return Array.from(new Set(values.map((value) => cleanText(value, 120)).filter(Boolean)));
}

function findStageIndex(plan: RuntimeStagePlan, stage: RuntimeStage): number {
    return plan.steps.findIndex((step) => step.stage === stage);
}

function buildVerdictSnapshot(verdict: DesignVerdict | undefined): RuntimeStageVerdictSnapshot | undefined {
    if (!verdict) return undefined;
    return {
        version: verdict.version,
        status: verdict.status,
        source: verdict.source,
        ...(typeof verdict.overallScore === 'number' ? { overallScore: verdict.overallScore } : {})
    };
}

function appendIssue(issues: string[], issue: string): string[] {
    return unique([...issues, issue]).slice(0, 30);
}

export function createRuntimeStageState(plan: RuntimeStagePlan): RuntimeStageState {
    return {
        version: 'runtime-stage-state/v0',
        planVersion: plan.version,
        skillId: plan.skillId,
        taskType: plan.taskType,
        status: 'active',
        currentStage: plan.steps[0]?.stage,
        stages: plan.steps.map((step) => ({
            stage: step.stage,
            status: 'unobserved',
            attempts: 0,
            requiredOutcomes: unique(step.requiredOutcomes),
            observedOutcomes: [],
            missingOutcomes: unique(step.requiredOutcomes)
        })),
        transitions: [],
        issues: [],
        boundaries: {
            evaluationOnly: true,
            executesTools: false,
            changesTaskResult: false,
            categoryNeutral: true
        }
    };
}

export function applyRuntimeStageEvaluation(input: {
    plan: RuntimeStagePlan;
    state: RuntimeStageState;
    event: RuntimeStageEvaluationEvent;
}): RuntimeStageState {
    const { plan, event } = input;
    const state: RuntimeStageState = {
        ...input.state,
        stages: input.state.stages.map((stage) => ({
            ...stage,
            requiredOutcomes: [...stage.requiredOutcomes],
            observedOutcomes: [...stage.observedOutcomes],
            missingOutcomes: [...stage.missingOutcomes],
            ...(stage.lastEvaluation ? {
                lastEvaluation: {
                    ...stage.lastEvaluation,
                    ...(stage.lastEvaluation.verdict ? { verdict: { ...stage.lastEvaluation.verdict } } : {})
                }
            } : {})
        })),
        transitions: input.state.transitions.map((transition) => ({
            ...transition,
            observedOutcomes: [...transition.observedOutcomes],
            missingOutcomes: [...transition.missingOutcomes]
        })),
        issues: [...input.state.issues]
    };
    const stageIndex = findStageIndex(plan, event.stage);
    if (stageIndex < 0) {
        return {
            ...state,
            issues: appendIssue(state.issues, `evaluation_stage_not_in_plan:${event.stage}`)
        };
    }

    const step = plan.steps[stageIndex];
    const snapshotIndex = state.stages.findIndex((snapshot) => snapshot.stage === event.stage);
    if (snapshotIndex < 0) {
        return {
            ...state,
            issues: appendIssue(state.issues, `stage_snapshot_missing:${event.stage}`)
        };
    }
    if (state.currentStage && state.currentStage !== event.stage) {
        state.issues = appendIssue(
            state.issues,
            `out_of_order_stage_observation:expected=${state.currentStage},observed=${event.stage}`
        );
    }

    const previous = state.stages[snapshotIndex];
    const observedOutcomes = unique([
        ...previous.observedOutcomes,
        ...event.observedOutcomes
    ]);
    const requiredOutcomes = unique(step.requiredOutcomes);
    const observedSet = new Set(observedOutcomes);
    const missingOutcomes = requiredOutcomes.filter((outcome) => !observedSet.has(outcome));
    let effectiveOutcome = event.outcome;
    if (event.outcome === 'passed' && missingOutcomes.length > 0) {
        effectiveOutcome = 'missing_required_outcomes';
        state.issues = appendIssue(
            state.issues,
            `stage_pass_downgraded_missing_outcomes:${event.stage}:${missingOutcomes.join(',')}`
        );
    }

    let decision: RuntimeStageTransitionDecision;
    let status: RuntimeStageStateStatus;
    let observedStatus: RuntimeStageObservedStatus;
    let targetStage: RuntimeStage | undefined;

    switch (effectiveOutcome) {
        case 'passed': {
            const nextStage = plan.steps[stageIndex + 1]?.stage;
            observedStatus = 'passed';
            if (nextStage) {
                decision = 'advance';
                status = 'active';
                targetStage = nextStage;
            } else {
                decision = 'complete';
                status = 'completed';
            }
            break;
        }
        case 'failed': {
            observedStatus = 'failed';
            if (step.failureTarget === 'reflexion') {
                decision = 'enter_reflexion';
                status = 'reflexion_required';
                const requestedTarget = event.reflexionHandoff?.status === 'reflexion_required'
                    ? event.reflexionHandoff.targetStage as RuntimeStage
                    : event.stage;
                if (findStageIndex(plan, requestedTarget) >= 0) {
                    targetStage = requestedTarget;
                } else {
                    targetStage = event.stage;
                    state.issues = appendIssue(
                        state.issues,
                        `reflexion_target_not_in_plan:${requestedTarget}`
                    );
                }
            } else {
                decision = 'continue_react';
                status = 'active';
                targetStage = event.stage;
            }
            break;
        }
        case 'awaiting_confirmation':
            observedStatus = 'awaiting_confirmation';
            decision = 'await_user_confirmation';
            status = 'awaiting_confirmation';
            targetStage = event.stage;
            break;
        case 'cancelled':
            observedStatus = 'cancelled';
            decision = 'stop_cancelled';
            status = 'cancelled';
            targetStage = event.stage;
            break;
        case 'needs_review':
        case 'missing_required_outcomes':
        default:
            observedStatus = 'needs_review';
            decision = 'await_outcome_or_review';
            status = 'awaiting_outcomes';
            targetStage = event.stage;
            break;
    }

    const verdict = buildVerdictSnapshot(event.verdict);
    state.stages[snapshotIndex] = {
        ...previous,
        status: observedStatus,
        attempts: previous.attempts + 1,
        requiredOutcomes,
        observedOutcomes,
        missingOutcomes,
        lastEvaluation: {
            outcome: effectiveOutcome,
            ...(cleanText(event.reason) ? { reason: cleanText(event.reason) } : {}),
            ...(verdict ? { verdict } : {})
        }
    };
    state.status = status;
    state.currentStage = targetStage;
    state.transitions.push({
        sequence: state.transitions.length + 1,
        evaluatedStage: event.stage,
        decision,
        ...(targetStage ? { targetStage } : {}),
        outcome: effectiveOutcome,
        observedOutcomes,
        missingOutcomes,
        ...(cleanText(event.reason) ? { reason: cleanText(event.reason) } : {})
    });
    return state;
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

export function buildRuntimeStageStateFromEvaluation(
    input: BuildRuntimeStageStateFromEvaluationInput
): RuntimeStageState {
    let state = createRuntimeStageState(input.plan);
    if (findStageIndex(input.plan, 'R0') >= 0) {
        state = applyRuntimeStageEvaluation({
            plan: input.plan,
            state,
            event: {
                stage: 'R0',
                outcome: 'passed',
                observedOutcomes: ['skill_manifest_selected', 'stage_plan_created'],
                reason: '运行时已由结构化 Skill manifest 生成 stage plan。'
            }
        });
    }

    const observedEvents = Array.isArray(input.observedEvents) ? input.observedEvents : [];
    for (const event of observedEvents) {
        if (event.stage === 'R0' || event.stage === 'R5' || event.stage === 'E2') continue;
        state = applyRuntimeStageEvaluation({
            plan: input.plan,
            state,
            event
        });
    }

    if (input.executionSummary.status === 'cancelled') {
        const target = state.currentStage || input.plan.steps[0]?.stage;
        if (!target) return state;
        return applyRuntimeStageEvaluation({
            plan: input.plan,
            state,
            event: {
                stage: target,
                outcome: 'cancelled',
                observedOutcomes: [],
                reason: '运行被取消；未观察阶段不补造完成。'
            }
        });
    }

    if (input.executionSummary.status === 'awaiting_confirmation') {
        const target = findStageIndex(input.plan, 'E2') >= 0
            ? 'E2'
            : (state.currentStage || input.plan.steps[input.plan.steps.length - 1]?.stage);
        if (!target) return state;
        return applyRuntimeStageEvaluation({
            plan: input.plan,
            state,
            event: {
                stage: target,
                outcome: 'awaiting_confirmation',
                observedOutcomes: [],
                reason: '任务停在用户确认点，不能推进交付阶段。'
            }
        });
    }

    if (findStageIndex(input.plan, 'R5') < 0) return state;
    const verdict = input.executionSummary.designVerdict;
    const outcome = verdict
        ? verdictOutcome(verdict)
        : (input.reflexionHandoff?.status === 'reflexion_required' ? 'failed' : 'missing_required_outcomes');
    const reason = verdict?.summary
        || firstMessage(input.executionSummary.blockers)
        || firstMessage(input.executionSummary.warnings)
        || `执行状态 ${input.executionSummary.status} 没有机读 DesignVerdict。`;
    state = applyRuntimeStageEvaluation({
        plan: input.plan,
        state,
        event: {
            stage: 'R5',
            outcome,
            observedOutcomes: verdict
                ? ['quality_gate_report', 'stage_evaluation']
                : ['stage_evaluation'],
            reason,
            ...(verdict ? { verdict } : {}),
            ...(input.reflexionHandoff ? { reflexionHandoff: input.reflexionHandoff } : {})
        }
    });
    const r5Passed = state.stages.find((stage) => stage.stage === 'R5')?.status === 'passed';
    if (!r5Passed) return state;
    for (const event of observedEvents) {
        if (event.stage !== 'E2') continue;
        state = applyRuntimeStageEvaluation({
            plan: input.plan,
            state,
            event
        });
    }
    return state;
}
