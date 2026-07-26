import type { BusinessDesignSkillId } from './business-skill-implementation-checkpoint';
import {
    buildProjectVisualInsightCacheFillPlan,
    type ProjectVisualInsightCacheFillPlan,
    type ProjectVisualInsightCacheFillStatus
} from './project-visual-insight-cache-fill';
import type { ProjectVisualSamplingPlan } from './project-visual-sampling';
import type { BusinessSkillPreflightPlannerContext } from './business-skill-preflight-planner-context';
import type { BusinessSkillVisualObservationRecord } from './business-skill-visual-context';

export type BusinessSkillVisualObservationRefreshStatus =
    | 'not_needed'
    | ProjectVisualInsightCacheFillStatus;

export interface BuildBusinessSkillVisualObservationRefreshPlanInput {
    skillId: BusinessDesignSkillId;
    plannerContext?: BusinessSkillPreflightPlannerContext;
    projectPath?: string | null;
    visualSamplingPlan?: ProjectVisualSamplingPlan | null;
    enabled?: unknown;
    runtimeCanAnalyze?: boolean;
    runtimeCanWriteCache?: boolean;
    maxCandidates?: number;
}

export interface BusinessSkillVisualObservationRefreshPlan {
    version: 'business-skill-visual-observation-refresh-plan/v0';
    skillId: BusinessDesignSkillId;
    status: BusinessSkillVisualObservationRefreshStatus;
    enabled: boolean;
    missingVisualUnderstanding: boolean;
    shouldRunRefresh: boolean;
    projectPath?: string;
    requiredInputs: string[];
    fillPlan?: ProjectVisualInsightCacheFillPlan;
    warnings: string[];
    limitations: string[];
    observations: BusinessSkillVisualObservationRecord[];
}

function cleanString(value: unknown): string {
    return String(value || '').trim();
}

function isEnabled(value: unknown): boolean {
    if (value === true) return true;
    const text = cleanString(value).toLowerCase();
    return ['true', '1', 'yes', 'on', 'enabled', 'auto', 'required'].includes(text);
}

function getMissingVisualUnderstanding(plannerContext: BusinessSkillPreflightPlannerContext | undefined): boolean {
    return Boolean(plannerContext?.requiredInputs.includes('visual_understanding'));
}

export function buildBusinessSkillVisualObservationRefreshPlan(
    input: BuildBusinessSkillVisualObservationRefreshPlanInput
): BusinessSkillVisualObservationRefreshPlan {
    const enabled = isEnabled(input.enabled);
    const projectPath = cleanString(input.projectPath);
    const requiredInputs = input.plannerContext?.requiredInputs || [];
    const missingVisualUnderstanding = getMissingVisualUnderstanding(input.plannerContext);
    const commonLimitations = [
        'This is a read-only control-plane plan; it does not call a model or write cache by itself.',
        'Visual observation refresh must be explicitly enabled and executed by a separate runner.',
        'A refresh plan cannot claim main-image, detail-page or SKU design quality.'
    ];

    if (!missingVisualUnderstanding) {
        return {
            version: 'business-skill-visual-observation-refresh-plan/v0',
            skillId: input.skillId,
            status: 'not_needed',
            enabled,
            missingVisualUnderstanding,
            shouldRunRefresh: false,
            projectPath: projectPath || undefined,
            requiredInputs,
            warnings: [],
            limitations: commonLimitations,
            observations: []
        };
    }

    const fillPlan = buildProjectVisualInsightCacheFillPlan({
        projectPath,
        visualSamplingPlan: input.visualSamplingPlan,
        enabled,
        hasAnalyzer: input.runtimeCanAnalyze === true,
        hasWriter: input.runtimeCanWriteCache === true,
        maxCandidates: input.maxCandidates
    });

    return {
        version: 'business-skill-visual-observation-refresh-plan/v0',
        skillId: input.skillId,
        status: fillPlan.status,
        enabled,
        missingVisualUnderstanding,
        shouldRunRefresh: fillPlan.shouldCallAnalyzer === true,
        projectPath: projectPath || undefined,
        requiredInputs,
        fillPlan,
        warnings: fillPlan.warnings,
        limitations: [
            ...commonLimitations,
            ...fillPlan.limitations
        ],
        observations: []
    };
}
