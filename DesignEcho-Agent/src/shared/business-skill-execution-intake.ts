import type { BusinessDesignSkillId } from './business-skill-implementation-checkpoint';
import type { BusinessSkillPreflightPlannerContext } from './business-skill-preflight-planner-context';
import type { BusinessSkillVisualObservationRecord } from './business-skill-visual-context';
import type { BusinessSkillVisualContextPreparation } from './business-skill-visual-context-preparation';
import type { BusinessSkillVisualObservationRefreshPlan } from './business-skill-visual-observation-refresh-plan';

export type BusinessSkillExecutionIntakeStage = 'before_executor' | 'after_executor';

export type BusinessSkillExecutionIntakeDecision =
    | 'observation_available'
    | 'observation_incomplete'
    | 'refresh_requested'
    | 'refresh_recorded'
    | 'not_applicable'
    | 'context_summary_only';

export interface BusinessSkillVisualContextPreparationRunRecord {
    status?: string;
    attempted?: boolean;
    planStatus?: string;
    reason?: string;
    analyzedCount?: number;
    successCount?: number;
    failedCount?: number;
    writtenEntryCount?: number;
    warnings?: string[];
    limitations?: string[];
    observations?: BusinessSkillVisualObservationRecord[];
    error?: string;
}

export interface BuildBusinessSkillExecutionIntakeInput {
    skillId: BusinessDesignSkillId;
    stage: BusinessSkillExecutionIntakeStage;
    visualContextPreparation?: BusinessSkillVisualContextPreparation;
    visualContextPreparationRun?: BusinessSkillVisualContextPreparationRunRecord;
    plannerContext?: BusinessSkillPreflightPlannerContext;
    refreshPlan?: BusinessSkillVisualObservationRefreshPlan;
    refreshRun?: BusinessSkillVisualContextPreparationRunRecord;
}

export interface BusinessSkillExecutionIntake {
    version: 'business-skill-execution-intake/v0';
    skillId: BusinessDesignSkillId;
    stage: BusinessSkillExecutionIntakeStage;
    decision: BusinessSkillExecutionIntakeDecision;
    requiredInputs: string[];
    recommendedActions: string[];
    warnings: string[];
    limitations: string[];
    observations: BusinessSkillVisualObservationRecord[];
}

export function buildBusinessSkillExecutionIntake(
    input: BuildBusinessSkillExecutionIntakeInput
): BusinessSkillExecutionIntake {
    const decision = inferDecision(input);
    return {
        version: 'business-skill-execution-intake/v0',
        skillId: input.skillId,
        stage: input.stage,
        decision,
        requiredInputs: collectRequiredInputs(input),
        recommendedActions: collectRecommendedActions(input, decision),
        warnings: collectWarnings(input),
        limitations: collectLimitations(input),
        observations: collectObservations(input)
    };
}

function inferDecision(input: BuildBusinessSkillExecutionIntakeInput): BusinessSkillExecutionIntakeDecision {
    if (input.visualContextPreparation?.status === 'not_applicable') return 'not_applicable';
    if (input.visualContextPreparationRun?.attempted === true || input.refreshRun?.attempted === true) {
        return 'refresh_recorded';
    }
    if (input.visualContextPreparation?.status === 'refresh_requested') return 'refresh_requested';
    if (input.visualContextPreparation?.status === 'observation_available') return 'observation_available';
    if (
        input.visualContextPreparation?.status === 'observation_missing'
        || input.visualContextPreparation?.status === 'context_missing'
        || input.visualContextPreparation?.status === 'sampling_scenario_mismatch'
        || collectRequiredInputs(input).length > 0
    ) {
        return 'observation_incomplete';
    }
    return 'context_summary_only';
}

function collectRequiredInputs(input: BuildBusinessSkillExecutionIntakeInput): string[] {
    return uniqueStrings([
        ...(input.visualContextPreparation?.requiredInputs || []),
        ...(input.plannerContext?.requiredInputs || []),
        ...(input.refreshPlan?.requiredInputs || [])
    ]);
}

function collectRecommendedActions(
    input: BuildBusinessSkillExecutionIntakeInput,
    decision: BusinessSkillExecutionIntakeDecision
): string[] {
    const actions = [...(input.visualContextPreparation?.recommendedActions || [])];
    if (decision === 'refresh_requested') actions.push('run_bounded_visual_refresh');
    if (decision === 'refresh_recorded') actions.push('use_refresh_summary_as_context');
    if (decision === 'observation_incomplete') actions.push('continue_with_skill_input_validation');
    return uniqueStrings(actions);
}

function collectWarnings(input: BuildBusinessSkillExecutionIntakeInput): string[] {
    return uniqueStrings([
        ...(input.visualContextPreparation?.warnings || []),
        ...(input.visualContextPreparationRun?.warnings || []),
        ...(input.plannerContext?.warnings || []),
        ...(input.refreshPlan?.warnings || []),
        ...(input.refreshRun?.warnings || [])
    ]);
}

function collectLimitations(input: BuildBusinessSkillExecutionIntakeInput): string[] {
    return uniqueStrings([
        'This intake summarizes observation context and optional refresh activity only.',
        'It does not authorize, block, or rewrite business Skill execution.',
        'Photoshop write authorization remains owned by Tool preflight and Policy.',
        ...(input.visualContextPreparation?.limitations || []),
        ...(input.visualContextPreparationRun?.limitations || []),
        ...(input.plannerContext?.limitations || []),
        ...(input.refreshPlan?.limitations || []),
        ...(input.refreshRun?.limitations || [])
    ]);
}

function collectObservations(input: BuildBusinessSkillExecutionIntakeInput): BusinessSkillVisualObservationRecord[] {
    return [
        ...normalizeObservations(input.visualContextPreparation?.observations),
        ...normalizeObservations(input.visualContextPreparationRun?.observations),
        ...normalizeObservations(input.plannerContext?.observations),
        ...normalizeObservations(input.refreshPlan?.observations),
        ...normalizeObservations(input.refreshRun?.observations)
    ];
}

function normalizeObservations(
    observations: Array<{ source: string; summary: string }> | undefined
): BusinessSkillVisualObservationRecord[] {
    return (observations || []).map((item) => ({
        source: item.source,
        summary: item.summary
    }));
}

function uniqueStrings(values: string[]): string[] {
    return Array.from(new Set(values.filter((value) => String(value || '').trim())));
}
