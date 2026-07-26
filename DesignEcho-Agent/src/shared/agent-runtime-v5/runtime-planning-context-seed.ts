/**
 * Runtime planning context seed。
 *
 * 只在同一活动 Runtime Session 的 Reflexion generation 之间承接模型已经声明、
 * Harness 已经校验且位于回退目标之前的 Brief / Strategy / Plan。它不从长期
 * Run Record 恢复完整内容，不生成模型内容，也不授予 Tool 或 Scheduler 权限。
 */

import type { RuntimeStage } from './contracts';
import type { RuntimeActionPlanDeclaration } from './runtime-action-plan-declaration';
import type { RuntimeDesignBriefDeclaration } from './runtime-design-brief-declaration';
import type { RuntimeReferenceBriefDeclaration } from './runtime-reference-context';
import type { RuntimeDesignStrategyDeclaration } from './runtime-design-strategy-declaration';
import type { RuntimeSession } from './runtime-session';
import type { RuntimeStagePlan } from './runtime-stage-plan';

export const RUNTIME_PLANNING_CONTEXT_SEED_VERSION = 'runtime-planning-context-seed/v0' as const;
export const RUNTIME_PLANNING_CONTEXT_SEED_DIGEST_VERSION = 'runtime-planning-context-seed-digest/v0' as const;

export type RuntimePlanningDeclarationStage = 'R1' | 'R2' | 'R3' | 'R4';

export interface RuntimePlanningContextSeed {
    version: typeof RUNTIME_PLANNING_CONTEXT_SEED_VERSION;
    sessionId: string;
    sourceRunId: string;
    targetRunId: string;
    sourceGeneration: number;
    targetGeneration: number;
    targetStage: RuntimeStage;
    planVersion: RuntimeStagePlan['version'];
    skillId: string;
    taskType: string;
    carriedStages: RuntimePlanningDeclarationStage[];
    invalidatedStages: RuntimePlanningDeclarationStage[];
    declarations: {
        brief?: RuntimeDesignBriefDeclaration;
        referenceBrief?: RuntimeReferenceBriefDeclaration;
        strategy?: RuntimeDesignStrategyDeclaration;
        actionPlan?: RuntimeActionPlanDeclaration;
    };
    boundaries: {
        activeSessionOnly: true;
        modelAuthoredContentPreserved: true;
        harnessDoesNotAuthorContent: true;
        targetAndDownstreamInvalidated: true;
        persistedAsDigestOnly: true;
        executesTools: false;
        grantsPermission: false;
        schedulerAuthority: false;
        changesTaskResult: false;
        categoryNeutral: true;
    };
}

export interface RuntimePlanningContextSeedDigest {
    version: typeof RUNTIME_PLANNING_CONTEXT_SEED_DIGEST_VERSION;
    sessionId: string;
    sourceRunId: string;
    targetRunId: string;
    sourceGeneration: number;
    targetGeneration: number;
    targetStage: RuntimeStage;
    carriedStages: RuntimePlanningDeclarationStage[];
    invalidatedStages: RuntimePlanningDeclarationStage[];
    boundaries: {
        digestOnly: true;
        activeSessionOnly: true;
        modelAuthoredContentPreserved: true;
        executesTools: false;
        grantsPermission: false;
        schedulerAuthority: false;
        changesTaskResult: false;
    };
}

export interface RuntimePlanningContextSeedValidation {
    ok: boolean;
    issues: string[];
}

export interface RuntimePlanningDeclarations {
    brief?: RuntimeDesignBriefDeclaration;
    referenceBrief?: RuntimeReferenceBriefDeclaration;
    strategy?: RuntimeDesignStrategyDeclaration;
    actionPlan?: RuntimeActionPlanDeclaration;
}

const PLANNING_STAGES_WITHOUT_REFERENCE: readonly RuntimePlanningDeclarationStage[] = Object.freeze(['R1', 'R3', 'R4']);
const PLANNING_STAGES_WITH_REFERENCE: readonly RuntimePlanningDeclarationStage[] = Object.freeze(['R1', 'R2', 'R3', 'R4']);

function unique(values: readonly string[]): string[] {
    return Array.from(new Set(values));
}

function cloneJson<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
}

function findStageIndex(plan: RuntimeStagePlan, stage: RuntimeStage): number {
    return plan.steps.findIndex((step) => step.stage === stage);
}

function resolveCarryPolicy(input: {
    plan: RuntimeStagePlan;
    targetStage: RuntimeStage;
}): {
    carriedStages: RuntimePlanningDeclarationStage[];
    invalidatedStages: RuntimePlanningDeclarationStage[];
} {
    const targetIndex = findStageIndex(input.plan, input.targetStage);
    if (targetIndex < 0) throw new Error('runtime_planning_context_target_stage_not_in_plan');
    const planningStages = input.plan.referencePolicy
        ? PLANNING_STAGES_WITH_REFERENCE
        : PLANNING_STAGES_WITHOUT_REFERENCE;
    const presentPlanningStages = planningStages.filter((stage) => findStageIndex(input.plan, stage) >= 0);
    return {
        carriedStages: presentPlanningStages.filter((stage) => findStageIndex(input.plan, stage) < targetIndex),
        invalidatedStages: presentPlanningStages.filter((stage) => findStageIndex(input.plan, stage) >= targetIndex)
    };
}

function arraysEqual(left: readonly string[], right: readonly string[]): boolean {
    return left.length === right.length && left.every((value, index) => value === right[index]);
}

function validateBrief(value: RuntimeDesignBriefDeclaration | undefined): boolean {
    return value?.version === 'runtime-design-brief-declaration/v0'
        && value.source === 'model_tool_call'
        && value.readiness === 'ready'
        && value.boundaries?.modelAuthored === true
        && value.boundaries?.harnessValidatedOnly === true
        && value.boundaries?.executesTools === false
        && value.boundaries?.grantsPermission === false;
}

function validateStrategy(value: RuntimeDesignStrategyDeclaration | undefined): boolean {
    return value?.version === 'runtime-design-strategy-declaration/v0'
        && value.source === 'model_tool_call'
        && value.readiness === 'ready'
        && value.boundaries?.modelAuthored === true
        && value.boundaries?.harnessValidatedOnly === true
        && value.boundaries?.executesTools === false
        && value.boundaries?.grantsPermission === false;
}

function validateReferenceBrief(value: RuntimeReferenceBriefDeclaration | undefined): boolean {
    return value?.version === 'runtime-reference-brief/v0'
        && value.source === 'model_tool_call'
        && ['ready', 'degraded', 'waived'].includes(value.readiness)
        && value.boundaries?.modelAuthored === true
        && value.boundaries?.harnessValidatedOnly === true
        && value.boundaries?.executesTools === false;
}

function validateActionPlan(value: RuntimeActionPlanDeclaration | undefined): boolean {
    return value?.version === 'runtime-action-plan-declaration/v0'
        && value.source === 'model_tool_call'
        && value.readiness === 'ready'
        && value.boundaries?.modelAuthored === true
        && value.boundaries?.harnessValidatedOnly === true
        && value.boundaries?.shadowOnly === true
        && value.boundaries?.executable === false
        && value.boundaries?.schedulerAuthority === false
        && value.boundaries?.executesTools === false
        && value.boundaries?.grantsPermission === false;
}

function declarationForStage(
    declarations: RuntimePlanningDeclarations,
    stage: RuntimePlanningDeclarationStage
): RuntimeDesignBriefDeclaration
    | RuntimeReferenceBriefDeclaration
    | RuntimeDesignStrategyDeclaration
    | RuntimeActionPlanDeclaration
    | undefined {
    switch (stage) {
        case 'R1':
            return declarations.brief;
        case 'R2':
            return declarations.referenceBrief;
        case 'R3':
            return declarations.strategy;
        case 'R4':
            return declarations.actionPlan;
    }
}

function declarationIsValid(
    declarations: RuntimePlanningDeclarations,
    stage: RuntimePlanningDeclarationStage
): boolean {
    switch (stage) {
        case 'R1':
            return validateBrief(declarations.brief);
        case 'R2':
            return validateReferenceBrief(declarations.referenceBrief);
        case 'R3':
            return validateStrategy(declarations.strategy);
        case 'R4':
            return validateActionPlan(declarations.actionPlan);
    }
}

function boundariesAreValid(seed: RuntimePlanningContextSeed): boolean {
    const value = seed.boundaries;
    return value?.activeSessionOnly === true
        && value.modelAuthoredContentPreserved === true
        && value.harnessDoesNotAuthorContent === true
        && value.targetAndDownstreamInvalidated === true
        && value.persistedAsDigestOnly === true
        && value.executesTools === false
        && value.grantsPermission === false
        && value.schedulerAuthority === false
        && value.changesTaskResult === false
        && value.categoryNeutral === true;
}

function briefMatchesExpectedWorkMode(
    plan: RuntimeStagePlan,
    brief: RuntimeDesignBriefDeclaration | undefined
): boolean {
    if (!plan.expectedWorkMode) return true;
    return brief?.payload.workMode === plan.expectedWorkMode;
}

export function validateRuntimePlanningContextSeed(input: {
    seed: RuntimePlanningContextSeed;
    session: RuntimeSession;
    plan: RuntimeStagePlan;
}): RuntimePlanningContextSeedValidation {
    const { seed, session, plan } = input;
    const issues: string[] = [];
    if (seed.version !== RUNTIME_PLANNING_CONTEXT_SEED_VERSION) {
        issues.push('runtime_planning_context_seed_version_invalid');
    }
    if (!boundariesAreValid(seed)) issues.push('runtime_planning_context_seed_boundaries_invalid');
    if (session.finalized) issues.push('runtime_planning_context_target_session_finalized');
    if (seed.sessionId !== session.identity.sessionId) issues.push('runtime_planning_context_session_mismatch');
    if (seed.targetRunId !== session.identity.runId) issues.push('runtime_planning_context_target_run_mismatch');
    if (seed.targetGeneration !== session.identity.generation) issues.push('runtime_planning_context_target_generation_mismatch');
    if (seed.sourceRunId !== session.identity.parentRunId) issues.push('runtime_planning_context_parent_run_mismatch');
    if (seed.sourceGeneration + 1 !== seed.targetGeneration) issues.push('runtime_planning_context_generation_not_monotonic');
    if (seed.planVersion !== plan.version) issues.push('runtime_planning_context_plan_version_mismatch');
    if (seed.skillId !== plan.skillId || seed.skillId !== session.skillId) {
        issues.push('runtime_planning_context_skill_mismatch');
    }
    if (seed.taskType !== plan.taskType || seed.taskType !== session.taskType) {
        issues.push('runtime_planning_context_task_type_mismatch');
    }
    if (seed.targetStage !== session.stageState.currentStage) {
        issues.push('runtime_planning_context_target_stage_mismatch');
    }
    let policy: ReturnType<typeof resolveCarryPolicy> | undefined;
    try {
        policy = resolveCarryPolicy({ plan, targetStage: seed.targetStage });
    } catch {
        issues.push('runtime_planning_context_target_stage_not_in_plan');
    }
    if (policy) {
        if (!arraysEqual(seed.carriedStages, policy.carriedStages)) {
            issues.push('runtime_planning_context_carried_stages_invalid');
        }
        if (!arraysEqual(seed.invalidatedStages, policy.invalidatedStages)) {
            issues.push('runtime_planning_context_invalidated_stages_invalid');
        }
        for (const stage of policy.carriedStages) {
            if (!declarationIsValid(seed.declarations, stage)) {
                issues.push(`runtime_planning_context_carried_declaration_invalid:${stage}`);
            }
        }
        if (
            policy.carriedStages.includes('R1')
            && !briefMatchesExpectedWorkMode(plan, seed.declarations.brief)
        ) {
            issues.push('runtime_planning_context_work_mode_mismatch');
        }
        for (const stage of policy.invalidatedStages) {
            if (declarationForStage(seed.declarations, stage)) {
                issues.push(`runtime_planning_context_invalidated_declaration_present:${stage}`);
            }
        }
    }
    return { ok: issues.length === 0, issues: unique(issues) };
}

export function buildRuntimePlanningContextSeed(input: {
    previousSession: RuntimeSession;
    nextSession: RuntimeSession;
    plan: RuntimeStagePlan;
    declarations: RuntimePlanningDeclarations;
}): RuntimePlanningContextSeed {
    const { previousSession, nextSession, plan } = input;
    if (!previousSession.finalized) throw new Error('runtime_planning_context_source_session_not_finalized');
    if (previousSession.stageState.status !== 'reflexion_required') {
        throw new Error('runtime_planning_context_source_not_reflexion');
    }
    if (nextSession.identity.parentRunId !== previousSession.identity.runId) {
        throw new Error('runtime_planning_context_parent_run_mismatch');
    }
    const targetStage = nextSession.stageState.currentStage;
    if (!targetStage) throw new Error('runtime_planning_context_target_stage_missing');
    const policy = resolveCarryPolicy({ plan, targetStage });
    for (const stage of policy.carriedStages) {
        const sourceStage = previousSession.stageState.stages.find((entry) => entry.stage === stage);
        if (sourceStage?.status !== 'passed') {
            throw new Error(`runtime_planning_context_source_stage_not_passed:${stage}`);
        }
        if (!declarationIsValid(input.declarations, stage)) {
            throw new Error(`runtime_planning_context_source_declaration_invalid:${stage}`);
        }
    }
    if (
        policy.carriedStages.includes('R1')
        && !briefMatchesExpectedWorkMode(plan, input.declarations.brief)
    ) {
        throw new Error('runtime_planning_context_work_mode_mismatch');
    }
    const declarations: RuntimePlanningContextSeed['declarations'] = {};
    if (policy.carriedStages.includes('R1') && input.declarations.brief) {
        declarations.brief = cloneJson(input.declarations.brief);
    }
    if (policy.carriedStages.includes('R2') && input.declarations.referenceBrief) {
        declarations.referenceBrief = cloneJson(input.declarations.referenceBrief);
    }
    if (policy.carriedStages.includes('R3') && input.declarations.strategy) {
        declarations.strategy = cloneJson(input.declarations.strategy);
    }
    if (policy.carriedStages.includes('R4') && input.declarations.actionPlan) {
        declarations.actionPlan = cloneJson(input.declarations.actionPlan);
    }
    const seed: RuntimePlanningContextSeed = {
        version: RUNTIME_PLANNING_CONTEXT_SEED_VERSION,
        sessionId: nextSession.identity.sessionId,
        sourceRunId: previousSession.identity.runId,
        targetRunId: nextSession.identity.runId,
        sourceGeneration: previousSession.identity.generation,
        targetGeneration: nextSession.identity.generation,
        targetStage,
        planVersion: plan.version,
        skillId: plan.skillId,
        taskType: plan.taskType,
        carriedStages: [...policy.carriedStages],
        invalidatedStages: [...policy.invalidatedStages],
        declarations,
        boundaries: {
            activeSessionOnly: true,
            modelAuthoredContentPreserved: true,
            harnessDoesNotAuthorContent: true,
            targetAndDownstreamInvalidated: true,
            persistedAsDigestOnly: true,
            executesTools: false,
            grantsPermission: false,
            schedulerAuthority: false,
            changesTaskResult: false,
            categoryNeutral: true
        }
    };
    const validation = validateRuntimePlanningContextSeed({ seed, session: nextSession, plan });
    if (!validation.ok) throw new Error(validation.issues.join(','));
    return seed;
}

export function buildRuntimePlanningContextSeedDigest(
    seed: RuntimePlanningContextSeed
): RuntimePlanningContextSeedDigest {
    return {
        version: RUNTIME_PLANNING_CONTEXT_SEED_DIGEST_VERSION,
        sessionId: seed.sessionId,
        sourceRunId: seed.sourceRunId,
        targetRunId: seed.targetRunId,
        sourceGeneration: seed.sourceGeneration,
        targetGeneration: seed.targetGeneration,
        targetStage: seed.targetStage,
        carriedStages: [...seed.carriedStages],
        invalidatedStages: [...seed.invalidatedStages],
        boundaries: {
            digestOnly: true,
            activeSessionOnly: true,
            modelAuthoredContentPreserved: true,
            executesTools: false,
            grantsPermission: false,
            schedulerAuthority: false,
            changesTaskResult: false
        }
    };
}
