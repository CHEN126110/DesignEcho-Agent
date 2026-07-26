import {
    BUSINESS_DESIGN_SKILL_IDS,
    type BusinessDesignSkillId,
    type BusinessSkillImplementationInputs,
    buildBusinessSkillImplementationCheckpoint
} from './business-skill-implementation-checkpoint';

const BUSINESS_SKILL_EXECUTION_PREFLIGHT_REQUIRED_SKILL_IDS: BusinessDesignSkillId[] = [
    'main-image-design',
    'detail-page-design',
    'sku-batch'
];

export const BUSINESS_SKILL_EXECUTION_PREFLIGHT_SKILL_IDS = BUSINESS_DESIGN_SKILL_IDS
    .filter((skillId) => BUSINESS_SKILL_EXECUTION_PREFLIGHT_REQUIRED_SKILL_IDS.includes(skillId));

export type BusinessSkillExecutionRequestKind =
    | 'inspect'
    | 'infra_check'
    | 'business_strategy'
    | 'execute_existing';

export type BusinessSkillExecutionPreflightStatus =
    | 'blocked'
    | 'needs_context'
    | 'ready_for_infra_only'
    | 'ready_for_strategy_design'
    | 'ready_for_existing_execution';

export type BusinessSkillExecutionPreflightAction =
    | 'inspect_current_state'
    | 'attach_readonly_context'
    | 'draft_business_strategy'
    | 'run_existing_skill_executor';

export interface BusinessSkillExecutionContextState {
    hasProjectContext?: boolean;
    hasAssetIndex?: boolean;
    hasVisualSamplingPlan?: boolean;
    hasVisualUnderstanding?: boolean;
    hasTemplateResult?: boolean;
    [key: string]: unknown;
}

export interface BuildBusinessSkillExecutionPreflightGateInput {
    skillId: BusinessDesignSkillId;
    requestKind?: BusinessSkillExecutionRequestKind;
    userCheckpointConfirmed?: boolean;
    implementationInputs?: BusinessSkillImplementationInputs;
    contextState?: BusinessSkillExecutionContextState;
}

export interface BusinessSkillExecutionPreflightGate {
    version: 'business-skill-execution-preflight-gate/v0';
    skillId: BusinessDesignSkillId;
    requestKind: BusinessSkillExecutionRequestKind;
    status: BusinessSkillExecutionPreflightStatus;
    canChangeBusinessStrategy: boolean;
    allowedActions: BusinessSkillExecutionPreflightAction[];
    blockers: string[];
    warnings: string[];
    requiredInputs: string[];
    implementationCheckpoint: ReturnType<typeof buildBusinessSkillImplementationCheckpoint>;
}

const REQUIRED_EXECUTION_CONTEXT = [
    'hasProjectContext',
    'hasAssetIndex',
    'hasVisualSamplingPlan',
    'hasVisualUnderstanding',
    'hasTemplateResult'
] as const;

const CONTEXT_REQUIREMENT_BY_KEY: Record<typeof REQUIRED_EXECUTION_CONTEXT[number], string> = {
    hasProjectContext: 'project_context_required',
    hasAssetIndex: 'asset_index_required',
    hasVisualSamplingPlan: 'visual_sampling_plan_required',
    hasVisualUnderstanding: 'visual_understanding_required',
    hasTemplateResult: 'template_result_required'
};

export function buildBusinessSkillExecutionPreflightGate(
    input: BuildBusinessSkillExecutionPreflightGateInput
): BusinessSkillExecutionPreflightGate {
    const requestKind = input.requestKind || 'inspect';
    const implementationCheckpoint = buildBusinessSkillImplementationCheckpoint({
        skillId: input.skillId,
        intendedChange: requestKind === 'business_strategy' ? 'business-strategy' : 'infra-only',
        userCheckpointConfirmed: input.userCheckpointConfirmed === true,
        inputs: input.implementationInputs || {}
    });
    const blockers = buildBlockers(requestKind, implementationCheckpoint);
    const missingContextInputs = buildMissingContextInputs(requestKind, input.contextState);
    const warnings = uniqueStrings(implementationCheckpoint.warnings);
    const requiredInputs = buildRequiredInputs(
        requestKind,
        implementationCheckpoint.missingInputs,
        missingContextInputs
    );
    const status = buildStatus({
        requestKind,
        implementationReady: implementationCheckpoint.canChangeBusinessStrategy,
        blockers,
        requiredInputs
    });

    return {
        version: 'business-skill-execution-preflight-gate/v0',
        skillId: input.skillId,
        requestKind,
        status,
        canChangeBusinessStrategy: status === 'ready_for_strategy_design',
        allowedActions: buildAllowedActions(status),
        blockers,
        warnings,
        requiredInputs,
        implementationCheckpoint
    };
}

function buildMissingContextInputs(
    requestKind: BusinessSkillExecutionRequestKind,
    contextState: BusinessSkillExecutionContextState | undefined
): string[] {
    if (requestKind !== 'execute_existing' && requestKind !== 'business_strategy') {
        return [];
    }

    return REQUIRED_EXECUTION_CONTEXT
        .filter((key) => contextState?.[key] !== true)
        .map((key) => CONTEXT_REQUIREMENT_BY_KEY[key]);
}

function buildBlockers(
    requestKind: BusinessSkillExecutionRequestKind,
    implementationCheckpoint: ReturnType<typeof buildBusinessSkillImplementationCheckpoint>
): string[] {
    const blockers: string[] = [];

    if (requestKind === 'business_strategy') {
        blockers.push(...implementationCheckpoint.blockers);
    }

    return uniqueStrings(blockers);
}

function buildRequiredInputs(
    requestKind: BusinessSkillExecutionRequestKind,
    missingImplementationInputs: string[],
    missingContextInputs: string[]
): string[] {
    const requiredInputs: string[] = [];

    if (requestKind === 'business_strategy') {
        requiredInputs.push(...missingImplementationInputs.map((key) => `implementation_${key}_required`));
    }

    requiredInputs.push(...missingContextInputs);

    return uniqueStrings(requiredInputs);
}

function buildStatus(input: {
    requestKind: BusinessSkillExecutionRequestKind;
    implementationReady: boolean;
    blockers: string[];
    requiredInputs: string[];
}): BusinessSkillExecutionPreflightStatus {
    if (input.blockers.length > 0) {
        return 'blocked';
    }

    switch (input.requestKind) {
        case 'business_strategy':
            if (input.requiredInputs.length > 0 || !input.implementationReady) {
                return 'needs_context';
            }
            return 'ready_for_strategy_design';
        case 'execute_existing':
            if (input.requiredInputs.length > 0) {
                return 'needs_context';
            }
            return 'ready_for_existing_execution';
        case 'infra_check':
        case 'inspect':
            return 'ready_for_infra_only';
        default:
            return 'blocked';
    }
}

function buildAllowedActions(
    status: BusinessSkillExecutionPreflightStatus
): BusinessSkillExecutionPreflightAction[] {
    switch (status) {
        case 'ready_for_strategy_design':
            return ['inspect_current_state', 'attach_readonly_context', 'draft_business_strategy'];
        case 'ready_for_existing_execution':
            return ['inspect_current_state', 'run_existing_skill_executor'];
        case 'ready_for_infra_only':
            return ['inspect_current_state', 'attach_readonly_context'];
        case 'needs_context':
            return ['inspect_current_state', 'attach_readonly_context'];
        case 'blocked':
        default:
            return ['inspect_current_state'];
    }
}

function uniqueStrings(values: string[]): string[] {
    return Array.from(new Set(values));
}
