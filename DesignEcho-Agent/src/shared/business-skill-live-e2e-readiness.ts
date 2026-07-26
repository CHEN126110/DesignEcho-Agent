export const BUSINESS_SKILL_LIVE_E2E_READINESS_VERSION = 'business-skill-live-e2e-readiness/v1' as const;

export const BUSINESS_SKILL_VALIDATION_RECORD_VERSION = 'business-skill-validation-record/v1' as const;

export const BUSINESS_SKILL_VALIDATION_LEVELS = [
    'static',
    'contract',
    'simulated',
    'live'
] as const;

export const BUSINESS_SKILL_VALIDATION_EXECUTION_STATES = [
    'executed',
    'skipped',
    'not_executed',
    'failed'
] as const;

export type BusinessSkillValidationLevel =
    typeof BUSINESS_SKILL_VALIDATION_LEVELS[number];

export type BusinessSkillValidationExecutionState =
    typeof BUSINESS_SKILL_VALIDATION_EXECUTION_STATES[number];

export interface BusinessSkillValidationRecordInput {
    level: BusinessSkillValidationLevel;
    state: BusinessSkillValidationExecutionState;
    passed?: boolean;
    source: string;
    reason?: string;
    reportPath?: string;
}

export interface BusinessSkillValidationRecord extends BusinessSkillValidationRecordInput {
    version: typeof BUSINESS_SKILL_VALIDATION_RECORD_VERSION;
    passed: boolean;
}

export interface BusinessSkillValidationMatrix {
    version: typeof BUSINESS_SKILL_VALIDATION_RECORD_VERSION;
    levels: Record<BusinessSkillValidationLevel, BusinessSkillValidationRecord>;
    highestPassedLevel: BusinessSkillValidationLevel | null;
    livePassed: boolean;
}

export const BUSINESS_SKILL_LIVE_E2E_IDS = [
    'main-image-design',
    'detail-page-design',
    'sku-batch'
] as const;

export type BusinessSkillLiveE2EId = typeof BUSINESS_SKILL_LIVE_E2E_IDS[number];

export interface BusinessSkillLiveE2EChecks {
    runnerPresent: boolean;
    usesRealAgentRuntime: boolean;
    usesRealModelProvider: boolean;
    usesManifestRuntimeStagePlan: boolean;
    invokesSelectedSkillBridge: boolean;
    usesLivePhotoshopTools: boolean;
    usesDisposableDocumentOrOutput: boolean;
    requiresExplicitLiveOptIn: boolean;
    requiresExplicitWriteOptIn: boolean;
    capturesPostWriteReadback: boolean;
    capturesEvaluationChecks: boolean;
    capturesDeliveryChecks: boolean;
}

export type BusinessSkillLiveE2EStatus =
    | 'missing_runner'
    | 'partial_runner'
    | 'ready_for_live_run';

export interface BusinessSkillLiveE2EReadinessInput {
    skillId: BusinessSkillLiveE2EId;
    runnerPath: string;
    checks: BusinessSkillLiveE2EChecks;
}

export interface BusinessSkillLiveE2EReadinessResult extends BusinessSkillLiveE2EReadinessInput {
    version: typeof BUSINESS_SKILL_LIVE_E2E_READINESS_VERSION;
    status: BusinessSkillLiveE2EStatus;
    missingChecks: Array<keyof BusinessSkillLiveE2EChecks>;
    ready: boolean;
}

export type BusinessSkillLiveE2EAggregateStatus =
    | 'blocked_missing_runner'
    | 'partial_coverage'
    | 'ready_for_live_run';

export interface BusinessSkillLiveE2EAggregateReadiness {
    version: typeof BUSINESS_SKILL_LIVE_E2E_READINESS_VERSION;
    status: BusinessSkillLiveE2EAggregateStatus;
    ready: boolean;
    skills: BusinessSkillLiveE2EReadinessResult[];
}

const REQUIRED_CHECK_KEYS: Array<keyof BusinessSkillLiveE2EChecks> = [
    'runnerPresent',
    'usesRealAgentRuntime',
    'usesRealModelProvider',
    'usesManifestRuntimeStagePlan',
    'invokesSelectedSkillBridge',
    'usesLivePhotoshopTools',
    'usesDisposableDocumentOrOutput',
    'requiresExplicitLiveOptIn',
    'requiresExplicitWriteOptIn',
    'capturesPostWriteReadback',
    'capturesEvaluationChecks',
    'capturesDeliveryChecks'
];

export function normalizeBusinessSkillValidationRecord(
    input: BusinessSkillValidationRecordInput
): BusinessSkillValidationRecord {
    const state = input.state === 'executed' && input.passed !== true
        ? 'failed'
        : input.state;

    return {
        ...input,
        version: BUSINESS_SKILL_VALIDATION_RECORD_VERSION,
        state,
        passed: state === 'executed' && input.passed === true
    };
}

export function buildBusinessSkillValidationMatrix(
    inputs: BusinessSkillValidationRecordInput[]
): BusinessSkillValidationMatrix {
    const inputByLevel = new Map<BusinessSkillValidationLevel, BusinessSkillValidationRecordInput>();
    for (const input of inputs) {
        inputByLevel.set(input.level, input);
    }

    const levels = {} as Record<BusinessSkillValidationLevel, BusinessSkillValidationRecord>;
    for (const level of BUSINESS_SKILL_VALIDATION_LEVELS) {
        levels[level] = normalizeBusinessSkillValidationRecord(inputByLevel.get(level) || {
            level,
            state: 'not_executed',
            passed: false,
            source: 'not_recorded',
            reason: `${level} validation was not recorded.`
        });
    }

    const passedLevels = BUSINESS_SKILL_VALIDATION_LEVELS.filter((level) => (
        levels[level].passed
    ));

    return {
        version: BUSINESS_SKILL_VALIDATION_RECORD_VERSION,
        levels,
        highestPassedLevel: passedLevels.length > 0
            ? passedLevels[passedLevels.length - 1]
            : null,
        livePassed: levels.live.passed
    };
}

export function hasPassedBusinessSkillValidation(
    matrix: BusinessSkillValidationMatrix,
    level: BusinessSkillValidationLevel
): boolean {
    const record = matrix.levels[level];
    return record.state === 'executed' && record.passed;
}

export function evaluateBusinessSkillLiveE2EReadiness(
    input: BusinessSkillLiveE2EReadinessInput
): BusinessSkillLiveE2EReadinessResult {
    const missingChecks = REQUIRED_CHECK_KEYS.filter((key) => input.checks[key] !== true);
    let status: BusinessSkillLiveE2EStatus = 'partial_runner';

    if (!input.checks.runnerPresent) {
        status = 'missing_runner';
    } else if (missingChecks.length === 0) {
        status = 'ready_for_live_run';
    }

    return {
        ...input,
        version: BUSINESS_SKILL_LIVE_E2E_READINESS_VERSION,
        status,
        missingChecks,
        ready: status === 'ready_for_live_run'
    };
}

export function evaluateBusinessSkillLiveE2EAggregate(
    inputs: BusinessSkillLiveE2EReadinessInput[]
): BusinessSkillLiveE2EAggregateReadiness {
    const skills = inputs.map(evaluateBusinessSkillLiveE2EReadiness);
    let status: BusinessSkillLiveE2EAggregateStatus = 'partial_coverage';

    if (skills.some((skill) => skill.status === 'missing_runner')) {
        status = 'blocked_missing_runner';
    } else if (
        skills.length === BUSINESS_SKILL_LIVE_E2E_IDS.length
        && skills.every((skill) => skill.ready)
    ) {
        status = 'ready_for_live_run';
    }

    return {
        version: BUSINESS_SKILL_LIVE_E2E_READINESS_VERSION,
        status,
        ready: status === 'ready_for_live_run',
        skills
    };
}
