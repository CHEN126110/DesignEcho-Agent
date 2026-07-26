/**
 * R4 计划声明后的真实执行观察日志。
 *
 * 只保存 Capability、执行类别、成败和轮次；不保存 Tool 名、参数、结果、模型文本或本地路径。
 * 日志是只读运行观察，不阻断、不调度、不重试任何动作。
 */

import type { AgentToolExecutionKind } from '../agent-tool-execution-preflight';
import type { RuntimeExecutionTargetAnchor } from './runtime-execution-target';

export type RuntimeActionPlanExecutionObservationOutcome = 'succeeded' | 'failed';
export type RuntimeActionPlanOperationKind =
    | Exclude<AgentToolExecutionKind, 'read_only_observation'>
    | 'read_only_observation';

export interface RuntimeActionPlanExecutionObservationInput {
    capabilityRefs: string[];
    toolKind: AgentToolExecutionKind;
    outcome: RuntimeActionPlanExecutionObservationOutcome;
    iteration?: number;
    target?: RuntimeExecutionTargetAnchor;
    readbackOfMutationSequence?: number;
}

export interface RuntimeActionPlanExecutionObservation {
    sequence: number;
    capabilityRefs: string[];
    operationKind: RuntimeActionPlanOperationKind;
    outcome: RuntimeActionPlanExecutionObservationOutcome;
    iteration?: number;
    target?: RuntimeExecutionTargetAnchor;
    readbackOfMutationSequence?: number;
}

export interface RuntimeActionPlanExecutionJournal {
    version: 'runtime-action-plan-execution-journal/v0';
    observations: RuntimeActionPlanExecutionObservation[];
    droppedObservationCount: number;
    issues: string[];
    boundaries: {
        observationOnly: true;
        postDeclarationOnly: true;
        containsToolNames: false;
        containsToolArguments: false;
        containsToolResults: false;
        containsModelText: false;
        containsOpaqueTargetIdentity: true;
        bindsReadbackToMutation: true;
        categoryNeutral: true;
        executesTools: false;
        blocksTools: false;
        maxObservations: number;
    };
}

const MAX_OBSERVATIONS = 120;
const MAX_ISSUES = 20;
const CAPABILITY_ID_PATTERN = /^[A-Za-z][A-Za-z0-9_.:-]{0,99}$/;

function uniqueCapabilityRefs(values: readonly unknown[]): string[] {
    return Array.from(new Set(values
        .map((value) => String(value || '').trim())
        .filter((value) => CAPABILITY_ID_PATTERN.test(value))))
        .slice(0, 16);
}

function appendIssue(journal: RuntimeActionPlanExecutionJournal, issue: string): string[] {
    return Array.from(new Set([...journal.issues, issue])).slice(0, MAX_ISSUES);
}

function normalizeOperationKind(toolKind: AgentToolExecutionKind): RuntimeActionPlanOperationKind {
    return toolKind;
}

export function createRuntimeActionPlanExecutionJournal(): RuntimeActionPlanExecutionJournal {
    return {
        version: 'runtime-action-plan-execution-journal/v0',
        observations: [],
        droppedObservationCount: 0,
        issues: [],
        boundaries: {
            observationOnly: true,
            postDeclarationOnly: true,
            containsToolNames: false,
            containsToolArguments: false,
            containsToolResults: false,
            containsModelText: false,
            containsOpaqueTargetIdentity: true,
            bindsReadbackToMutation: true,
            categoryNeutral: true,
            executesTools: false,
            blocksTools: false,
            maxObservations: MAX_OBSERVATIONS
        }
    };
}

export function appendRuntimeActionPlanExecutionObservation(input: {
    journal: RuntimeActionPlanExecutionJournal;
    observation: RuntimeActionPlanExecutionObservationInput;
}): RuntimeActionPlanExecutionJournal {
    if (input.journal.observations.length >= MAX_OBSERVATIONS) {
        return {
            ...input.journal,
            droppedObservationCount: input.journal.droppedObservationCount + 1,
            issues: appendIssue(input.journal, 'observation_limit_reached')
        };
    }
    const capabilityRefs = uniqueCapabilityRefs(input.observation.capabilityRefs);
    const iteration = Number.isFinite(input.observation.iteration)
        ? Math.max(0, Math.floor(Number(input.observation.iteration)))
        : undefined;
    const readbackOfMutationSequence = Number.isFinite(input.observation.readbackOfMutationSequence)
        ? Math.max(1, Math.floor(Number(input.observation.readbackOfMutationSequence)))
        : undefined;
    const target = input.observation.target;
    return {
        ...input.journal,
        observations: [
            ...input.journal.observations,
            {
                sequence: input.journal.observations.length + 1,
                capabilityRefs,
                operationKind: normalizeOperationKind(input.observation.toolKind),
                outcome: input.observation.outcome,
                ...(iteration !== undefined ? { iteration } : {}),
                ...(target ? {
                    target: {
                        ...target,
                        objectRefs: [...target.objectRefs],
                        boundaries: { ...target.boundaries }
                    }
                } : {}),
                ...(readbackOfMutationSequence !== undefined ? { readbackOfMutationSequence } : {})
            }
        ],
        issues: [
            ...(capabilityRefs.length === 0 ? ['observation_without_active_capability'] : []),
            ...((input.observation.toolKind === 'photoshop_write'
                || input.observation.toolKind === 'save_export') && !target
                ? ['state_change_without_target_identity']
                : [])
        ].reduce((issues, issue) => appendIssue({ ...input.journal, issues }, issue), input.journal.issues)
    };
}
