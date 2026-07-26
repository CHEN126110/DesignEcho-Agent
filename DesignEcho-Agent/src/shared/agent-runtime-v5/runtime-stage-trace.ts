/**
 * Runtime Stage Trace（shadow / trace-only）。
 *
 * 只记录结构化运行事实的白名单字段，供 Stage State 与未来影子任务图对账。
 * 不保存 Tool 参数/结果、图片、模型文本或本地路径，不调度 Tool，也不改变任务结果。
 */

import type { AgentToolExecutionKind } from '../agent-tool-execution-preflight';
import type { RuntimeStage } from './contracts';
import type {
    RuntimeStageEvaluationEvent,
    RuntimeStageEvaluationOutcome,
    RuntimeStageState
} from './runtime-stage-state';
import type { RuntimeStagePlan } from './runtime-stage-plan';

export type RuntimeStageTraceSource =
    | 'opening_observation'
    | 'attached_image_observation'
    | 'brief_declaration'
    | 'reference_brief_declaration'
    | 'model_tool_plan'
    | 'strategy_declaration'
    | 'action_plan_declaration'
    | 'tool_result'
    | 'delivery_result';

export interface RuntimeStageTraceEventInput {
    stage: RuntimeStage;
    source: RuntimeStageTraceSource;
    outcome: RuntimeStageEvaluationOutcome;
    observedOutcomes: string[];
    iteration?: number;
    toolName?: string;
    toolKind?: AgentToolExecutionKind;
}

export interface RuntimeStageTraceEvent extends RuntimeStageTraceEventInput {
    sequence: number;
}

export interface RuntimeStageTrace {
    version: 'runtime-stage-trace/v0';
    planVersion: RuntimeStagePlan['version'];
    skillId: string;
    taskType: string;
    events: RuntimeStageTraceEvent[];
    droppedEventCount: number;
    issues: string[];
    boundaries: {
        traceOnly: true;
        executesTools: false;
        changesTaskResult: false;
        containsToolArguments: false;
        containsToolResults: false;
        containsModelText: false;
        categoryNeutral: true;
        maxEvents: number;
    };
}

export interface RuntimeStageTraceDigest {
    version: 'runtime-stage-trace-digest/v0';
    status: 'consistent' | 'incomplete' | 'inconsistent';
    eventCount: number;
    droppedEventCount: number;
    observedStages: RuntimeStage[];
    missingStages: RuntimeStage[];
    outOfOrderCount: number;
    traceBackedTransitionCount: number;
    derivedTransitionCount: number;
    unbackedTransitionCount: number;
    traceEventWithoutTransitionCount: number;
    issueCount: number;
    boundaries: {
        digestOnly: true;
        shadowOnly: true;
        changesTaskResult: false;
    };
}

const MAX_TRACE_EVENTS = 120;
const MAX_TRACE_ISSUES = 30;

function cleanToken(value: unknown, limit = 100): string {
    const normalized = String(value || '').trim();
    if (normalized.length === 0 || normalized.length > limit) return '';
    return /^[A-Za-z][A-Za-z0-9_.:-]*$/.test(normalized) ? normalized : '';
}

function cleanToolName(value: unknown): string {
    const normalized = String(value || '').trim();
    return /^[A-Za-z][A-Za-z0-9_.-]{0,79}$/.test(normalized) ? normalized : '';
}

function uniqueTokens(values: readonly unknown[]): string[] {
    return Array.from(new Set(values.map((value) => cleanToken(value)).filter(Boolean)));
}

function hasStage(plan: RuntimeStagePlan, stage: RuntimeStage): boolean {
    return plan.steps.some((step) => step.stage === stage);
}

function appendIssue(trace: RuntimeStageTrace, issue: string): RuntimeStageTrace {
    const issues = uniqueTokens([...trace.issues, issue]).slice(0, MAX_TRACE_ISSUES);
    return { ...trace, issues };
}

export function createRuntimeStageTrace(plan: RuntimeStagePlan): RuntimeStageTrace {
    return {
        version: 'runtime-stage-trace/v0',
        planVersion: plan.version,
        skillId: plan.skillId,
        taskType: plan.taskType,
        events: [],
        droppedEventCount: 0,
        issues: [],
        boundaries: {
            traceOnly: true,
            executesTools: false,
            changesTaskResult: false,
            containsToolArguments: false,
            containsToolResults: false,
            containsModelText: false,
            categoryNeutral: true,
            maxEvents: MAX_TRACE_EVENTS
        }
    };
}

export function appendRuntimeStageTraceEvent(input: {
    plan: RuntimeStagePlan;
    trace: RuntimeStageTrace;
    event: RuntimeStageTraceEventInput;
}): RuntimeStageTrace {
    const { plan, event } = input;
    if (!hasStage(plan, event.stage)) {
        return appendIssue(input.trace, `trace_stage_not_in_plan:${event.stage}`);
    }
    if (input.trace.events.length >= MAX_TRACE_EVENTS) {
        return {
            ...appendIssue(input.trace, 'trace_event_limit_reached'),
            droppedEventCount: input.trace.droppedEventCount + 1
        };
    }
    const observedOutcomes = uniqueTokens(event.observedOutcomes).slice(0, 12);
    const toolName = cleanToolName(event.toolName);
    const iteration = Number.isFinite(event.iteration)
        ? Math.max(0, Math.floor(Number(event.iteration)))
        : undefined;
    return {
        ...input.trace,
        events: [
            ...input.trace.events,
            {
                sequence: input.trace.events.length + 1,
                stage: event.stage,
                source: event.source,
                outcome: event.outcome,
                observedOutcomes,
                ...(iteration !== undefined ? { iteration } : {}),
                ...(toolName ? { toolName } : {}),
                ...(event.toolKind ? { toolKind: event.toolKind } : {})
            }
        ]
    };
}

export function runtimeStageTraceToEvaluationEvents(
    trace: RuntimeStageTrace | undefined
): RuntimeStageEvaluationEvent[] {
    if (!trace) return [];
    return trace.events.map((event) => ({
        stage: event.stage,
        outcome: event.outcome,
        observedOutcomes: [...event.observedOutcomes]
    }));
}

function transitionMatchesEvent(
    transition: RuntimeStageState['transitions'][number],
    event: RuntimeStageTraceEvent
): boolean {
    if (transition.evaluatedStage !== event.stage) return false;
    if (transition.outcome === event.outcome) return true;
    return transition.outcome === 'missing_required_outcomes' && event.outcome === 'passed';
}

function isDerivedTransition(transition: RuntimeStageState['transitions'][number]): boolean {
    return transition.evaluatedStage === 'R0'
        || transition.evaluatedStage === 'R5'
        || transition.outcome === 'awaiting_confirmation'
        || transition.outcome === 'cancelled';
}

export function buildRuntimeStageTraceDigest(input: {
    plan: RuntimeStagePlan;
    trace: RuntimeStageTrace;
    state: RuntimeStageState;
    /** Reflexion 新 generation 只对账本代新增 transition，旧代 ledger 不重复归因。 */
    transitionSequenceFloor?: number;
}): RuntimeStageTraceDigest {
    const matchedEventSequences = new Set<number>();
    let traceBackedTransitionCount = 0;
    let derivedTransitionCount = 0;
    let unbackedTransitionCount = 0;

    const transitionSequenceFloor = Math.max(0, Number(input.transitionSequenceFloor) || 0);
    const currentGenerationTransitions = input.state.transitions.filter((transition) => (
        transition.sequence > transitionSequenceFloor
    ));
    for (const transition of currentGenerationTransitions) {
        if (isDerivedTransition(transition)) {
            derivedTransitionCount += 1;
            continue;
        }
        const event = input.trace.events.find((candidate) => (
            !matchedEventSequences.has(candidate.sequence)
            && transitionMatchesEvent(transition, candidate)
        ));
        if (event) {
            matchedEventSequences.add(event.sequence);
            traceBackedTransitionCount += 1;
        } else {
            unbackedTransitionCount += 1;
        }
    }

    const observedStages = input.state.stages
        .filter((stage) => stage.status !== 'unobserved')
        .map((stage) => stage.stage);
    const missingStages = input.plan.steps
        .map((step) => step.stage)
        .filter((stage) => !observedStages.includes(stage));
    const outOfOrderCount = input.state.issues
        .filter((issue) => issue.startsWith('out_of_order_stage_observation:'))
        .length;
    const traceEventWithoutTransitionCount = input.trace.events.length - matchedEventSequences.size;
    const issueCount = input.trace.issues.length + input.state.issues.length;
    const inconsistent = unbackedTransitionCount > 0 || traceEventWithoutTransitionCount > 0;
    const incomplete = missingStages.length > 0
        || outOfOrderCount > 0
        || input.trace.droppedEventCount > 0
        || issueCount > 0;
    return {
        version: 'runtime-stage-trace-digest/v0',
        status: inconsistent ? 'inconsistent' : (incomplete ? 'incomplete' : 'consistent'),
        eventCount: input.trace.events.length,
        droppedEventCount: input.trace.droppedEventCount,
        observedStages,
        missingStages,
        outOfOrderCount,
        traceBackedTransitionCount,
        derivedTransitionCount,
        unbackedTransitionCount,
        traceEventWithoutTransitionCount,
        issueCount,
        boundaries: {
            digestOnly: true,
            shadowOnly: true,
            changesTaskResult: false
        }
    };
}
