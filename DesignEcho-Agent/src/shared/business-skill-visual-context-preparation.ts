import type { BusinessDesignSkillId } from './business-skill-implementation-checkpoint';
import type { BusinessSkillVisualObservationRecord } from './business-skill-visual-context';
import {
    buildProjectVisualInsightCacheFillPlan,
    type ProjectVisualInsightCacheFillPlan
} from './project-visual-insight-cache-fill';
import type { ProjectVisualSamplingPlan, ProjectVisualSamplingScenario } from './project-visual-sampling';

export type BusinessSkillVisualContextPreparationStatus =
    | 'observation_available'
    | 'observation_missing'
    | 'refresh_requested'
    | 'context_missing'
    | 'sampling_scenario_mismatch'
    | 'not_applicable';

export interface BuildBusinessSkillVisualContextPreparationInput {
    skillId: BusinessDesignSkillId;
    projectPath?: string | null;
    visualSamplingPlan?: ProjectVisualSamplingPlan | null;
    expectedVisualSamplingScenario?: ProjectVisualSamplingScenario | null;
    hasProjectContext?: boolean;
    hasAssetIndex?: boolean;
    hasVisualSamplingPlan?: boolean;
    hasVisualUnderstanding?: boolean;
    runBeforeExecution?: unknown;
    requiresVisualObservation?: boolean;
    runtimeCanAnalyze?: boolean;
    runtimeCanWriteCache?: boolean;
    maxCandidates?: number;
}

export interface BusinessSkillVisualContextPreparation {
    version: 'business-skill-visual-context-preparation/v0';
    skillId: BusinessDesignSkillId;
    status: BusinessSkillVisualContextPreparationStatus;
    projectPath?: string;
    requiredInputs: string[];
    recommendedActions: string[];
    warnings: string[];
    limitations: string[];
    refreshPlan?: ProjectVisualInsightCacheFillPlan;
    observations: BusinessSkillVisualObservationRecord[];
}

function cleanString(value: unknown): string {
    return String(value || '').trim();
}

function parseBooleanFlag(value: unknown): boolean {
    if (value === true) return true;
    const text = cleanString(value).toLowerCase();
    return ['true', '1', 'yes', 'on', 'enabled'].includes(text);
}

function hasMatchingVisualSamplingScenario(input: BuildBusinessSkillVisualContextPreparationInput): boolean {
    if (!input.expectedVisualSamplingScenario) return true;
    return input.visualSamplingPlan?.scenario === input.expectedVisualSamplingScenario;
}

function buildRequiredInputs(
    input: BuildBusinessSkillVisualContextPreparationInput,
    visualSamplingScenarioMatches: boolean
): string[] {
    const required: string[] = [];
    if (input.hasProjectContext !== true) required.push('project_context');
    if (input.hasAssetIndex !== true) required.push('project_asset_index');
    if (input.hasVisualSamplingPlan !== true) required.push('visual_sampling_plan');
    if (input.expectedVisualSamplingScenario && !visualSamplingScenarioMatches) {
        required.push('matching_visual_sampling_scenario');
    }
    if (input.hasVisualUnderstanding !== true) required.push('visual_understanding');
    return Array.from(new Set(required));
}

function buildCommonLimitations(): string[] {
    return [
        'This object reports observation context and optional refresh readiness only.',
        'Missing observation context does not authorize or prevent business Skill execution.',
        'Photoshop write authorization remains owned by Tool preflight and Policy.',
        'A refresh result supplements context and does not validate the current design output.'
    ];
}

function buildGate(input: {
    skillId: BusinessDesignSkillId;
    status: BusinessSkillVisualContextPreparationStatus;
    projectPath?: string;
    requiredInputs?: string[];
    recommendedActions?: string[];
    warnings?: string[];
    limitations?: string[];
    refreshPlan?: ProjectVisualInsightCacheFillPlan;
}): BusinessSkillVisualContextPreparation {
    return {
        version: 'business-skill-visual-context-preparation/v0',
        skillId: input.skillId,
        status: input.status,
        projectPath: input.projectPath,
        requiredInputs: input.requiredInputs || [],
        recommendedActions: input.recommendedActions || [],
        warnings: input.warnings || [],
        limitations: input.limitations || buildCommonLimitations(),
        refreshPlan: input.refreshPlan,
        observations: []
    };
}

export function buildBusinessSkillVisualContextPreparation(
    input: BuildBusinessSkillVisualContextPreparationInput
): BusinessSkillVisualContextPreparation {
    const projectPath = cleanString(input.projectPath);
    const scenarioMatches = hasMatchingVisualSamplingScenario(input);
    const requiredInputs = buildRequiredInputs(input, scenarioMatches);
    const refreshRequested = parseBooleanFlag(input.runBeforeExecution);
    const refreshPlan = buildProjectVisualInsightCacheFillPlan({
        projectPath,
        visualSamplingPlan: input.visualSamplingPlan,
        enabled: refreshRequested,
        hasAnalyzer: input.runtimeCanAnalyze === true,
        hasWriter: input.runtimeCanWriteCache === true,
        maxCandidates: input.maxCandidates
    });
    const limitations = [
        ...buildCommonLimitations(),
        ...refreshPlan.limitations
    ];

    if (input.requiresVisualObservation === false) {
        return buildGate({
            skillId: input.skillId,
            status: 'not_applicable',
            projectPath: projectPath || undefined,
            limitations
        });
    }

    const missingContext = input.hasProjectContext !== true
        || input.hasAssetIndex !== true
        || input.hasVisualSamplingPlan !== true;
    if (missingContext) {
        return buildGate({
            skillId: input.skillId,
            status: 'context_missing',
            projectPath: projectPath || undefined,
            requiredInputs,
            recommendedActions: ['refresh_project_context', 'continue_with_skill_input_validation'],
            warnings: refreshPlan.warnings,
            limitations,
            refreshPlan
        });
    }

    if (!scenarioMatches) {
        return buildGate({
            skillId: input.skillId,
            status: 'sampling_scenario_mismatch',
            projectPath: projectPath || undefined,
            requiredInputs,
            recommendedActions: ['refresh_visual_sampling_plan', 'continue_with_skill_input_validation'],
            warnings: [
                `Visual sampling scenario mismatch: expected ${input.expectedVisualSamplingScenario}, got ${input.visualSamplingPlan?.scenario || 'missing'}.`,
                ...refreshPlan.warnings
            ],
            limitations,
            refreshPlan
        });
    }

    if (input.hasVisualUnderstanding === true) {
        return buildGate({
            skillId: input.skillId,
            status: 'observation_available',
            projectPath: projectPath || undefined,
            limitations
        });
    }

    if (refreshRequested && refreshPlan.shouldCallAnalyzer) {
        return buildGate({
            skillId: input.skillId,
            status: 'refresh_requested',
            projectPath: projectPath || undefined,
            requiredInputs,
            recommendedActions: ['run_bounded_visual_refresh', 'continue_with_skill_input_validation'],
            warnings: refreshPlan.warnings,
            limitations,
            refreshPlan
        });
    }

    return buildGate({
        skillId: input.skillId,
        status: 'observation_missing',
        projectPath: projectPath || undefined,
        requiredInputs,
        recommendedActions: refreshRequested
            ? ['review_refresh_readiness', 'continue_with_skill_input_validation']
            : ['offer_visual_analysis', 'continue_with_skill_input_validation'],
        warnings: refreshRequested ? refreshPlan.warnings : [],
        limitations,
        refreshPlan
    });
}
