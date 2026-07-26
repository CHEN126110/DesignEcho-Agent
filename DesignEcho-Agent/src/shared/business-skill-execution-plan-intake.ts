import type { BusinessDesignSkillId } from './business-skill-implementation-checkpoint';
import type {
    DesignAgentOsRecord,
    DesignAgentOsStatus,
    ExecutionPlan,
    ExecutionTrace,
    VerificationReport
} from './design-agent-os-contracts';

export type BusinessSkillExecutionPlanIntakeVersion =
    'business-skill-execution-plan-intake/v0';

export type BusinessSkillExecutionPlanIntakeStatus =
    | 'no_execution_plan_record'
    | 'plan_only_needs_execution_trace'
    | 'executed_with_trace_needs_verification'
    | 'verified_execution'
    | 'failed_execution';

export interface BusinessSkillExecutionPlanSummary {
    hasDesignAgentOs: boolean;
    hasExecutionPlan: boolean;
    planStatus?: string;
    stepCount: number;
    operations: string[];
    hasExecutionTrace: boolean;
    toolCallCount: number;
    successfulToolCalls: number;
    failedToolCalls: number;
    hasVerificationReport: boolean;
    verificationStatus?: DesignAgentOsStatus;
    plannerAlignmentStatus?: string;
    placementVerificationStatus?: string;
    hasPlacementVerificationIntake: boolean;
    hasBusinessSkillExecutionIntake: boolean;
}

export interface BusinessSkillExecutionPlanIntake {
    version: BusinessSkillExecutionPlanIntakeVersion;
    skillId: BusinessDesignSkillId;
    status: BusinessSkillExecutionPlanIntakeStatus;
    runRecordOnly: true;
    userVisible: false;
    canClaimDesignQuality: false;
    mustNotChangeBusinessStrategy: true;
    mustNotChangeExecutor: true;
    planSummary: BusinessSkillExecutionPlanSummary;
    requiredNextChecks: string[];
    blockers: string[];
    warnings: string[];
    limitations: string[];
}

export interface BuildBusinessSkillExecutionPlanIntakeInput {
    skillId: BusinessDesignSkillId;
    resultData?: Record<string, unknown> | null;
}

interface NormalizedExecutionRunRecord {
    designAgentOs?: DesignAgentOsRecord;
    executionPlan?: ExecutionPlan;
    executionTrace?: ExecutionTrace;
    verificationReport?: VerificationReport;
    plannerAlignmentStatus?: string;
    placementVerificationStatus?: string;
    placementBlockers: string[];
    businessExecutionIntakePresent: boolean;
}

function isObject(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readObject(value: unknown): Record<string, unknown> | undefined {
    return isObject(value) ? value : undefined;
}

function normalizeText(value: unknown): string {
    return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function uniqueStrings(values: unknown[]): string[] {
    const result: string[] = [];
    for (const value of values) {
        const normalized = normalizeText(value);
        if (normalized && !result.includes(normalized)) result.push(normalized);
    }
    return result;
}

function normalizeDesignAgentOs(value: unknown): DesignAgentOsRecord | undefined {
    const candidate = readObject(value);
    if (!candidate) return undefined;
    if (!readObject(candidate.intentContext) || !readObject(candidate.planInputs)) return undefined;
    return candidate as unknown as DesignAgentOsRecord;
}

function normalizeExecutionPlan(value: unknown): ExecutionPlan | undefined {
    const candidate = readObject(value);
    if (!candidate) return undefined;
    if (!Array.isArray(candidate.steps)) return undefined;
    if (!normalizeText(candidate.planId)) return undefined;
    return candidate as unknown as ExecutionPlan;
}

function normalizeExecutionTrace(value: unknown): ExecutionTrace | undefined {
    const candidate = readObject(value);
    if (!candidate) return undefined;
    if (!Array.isArray(candidate.toolCalls)) return undefined;
    if (!Number.isFinite(Number(candidate.toolCallCount))) return undefined;
    return candidate as unknown as ExecutionTrace;
}

function normalizeVerificationReport(value: unknown): VerificationReport | undefined {
    const candidate = readObject(value);
    if (!candidate) return undefined;
    if (!normalizeText(candidate.reportId)) return undefined;
    if (!normalizeText(candidate.status)) return undefined;
    return candidate as unknown as VerificationReport;
}

function normalizeRunStatus(value: unknown): DesignAgentOsStatus | undefined {
    switch (normalizeText(value)) {
        case 'passed':
        case 'needs_review':
        case 'failed':
        case 'not_run':
        case 'unknown':
            return normalizeText(value) as DesignAgentOsStatus;
        default:
            return undefined;
    }
}

function normalizeStringArray(value: unknown): string[] {
    if (Array.isArray(value)) return uniqueStrings(value);
    return normalizeText(value)
        .split(/[，,；;\n|]/)
        .map((item) => item.trim())
        .filter(Boolean);
}

function normalizeExecutionRunRecord(
    resultData: Record<string, unknown>
): NormalizedExecutionRunRecord {
    const designAgentOs = normalizeDesignAgentOs(resultData.designAgentOs);
    const executionPlan = normalizeExecutionPlan(designAgentOs?.executionPlan);
    const executionTrace = normalizeExecutionTrace(designAgentOs?.executionTrace);
    const verificationReport = normalizeVerificationReport(designAgentOs?.verificationReport);
    const plannerAlignment = readObject(resultData.designPlannerExecutionAlignment);
    const placementIntake = readObject(resultData.businessSkillImagePlacementVerificationIntake);

    return {
        designAgentOs,
        executionPlan,
        executionTrace,
        verificationReport,
        plannerAlignmentStatus: normalizeText(plannerAlignment?.status) || undefined,
        placementVerificationStatus: normalizeText(placementIntake?.status) || undefined,
        placementBlockers: normalizeStringArray(placementIntake?.blockers),
        businessExecutionIntakePresent: Boolean(readObject(resultData.businessSkillExecutionIntake))
    };
}

function traceHasFailure(trace?: ExecutionTrace): boolean {
    if (!trace) return false;
    if (Number(trace.failedToolCalls || 0) > 0) return true;
    return trace.toolCalls.some((call) => call.success === false);
}

function verificationHasFailure(report?: VerificationReport): boolean {
    if (!report) return false;
    return report.status === 'failed' || (report.blockers || []).length > 0;
}

function placementHasFailure(record: NormalizedExecutionRunRecord): boolean {
    return record.placementVerificationStatus === 'failed_bounds_or_screenshot'
        || record.placementBlockers.length > 0;
}

function resolveStatus(
    record: NormalizedExecutionRunRecord
): BusinessSkillExecutionPlanIntakeStatus {
    if (!record.executionPlan) return 'no_execution_plan_record';
    if (traceHasFailure(record.executionTrace) || verificationHasFailure(record.verificationReport) || placementHasFailure(record)) {
        return 'failed_execution';
    }
    if (!record.executionTrace) return 'plan_only_needs_execution_trace';
    if (record.verificationReport?.status === 'passed') return 'verified_execution';
    return 'executed_with_trace_needs_verification';
}

function buildRequiredNextChecks(
    record: NormalizedExecutionRunRecord,
    status: BusinessSkillExecutionPlanIntakeStatus
): string[] {
    const required: string[] = [];
    if (!record.executionPlan) required.push('design_agent_os_execution_plan_required');
    if (record.executionPlan && !record.executionTrace) required.push('execution_trace_required');
    if (record.executionTrace && !record.verificationReport) required.push('verification_report_required');
    if (status === 'executed_with_trace_needs_verification') required.push('screenshot_or_manual_review_required');
    return uniqueStrings(required);
}

function buildBlockers(record: NormalizedExecutionRunRecord): string[] {
    const blockers: string[] = [];
    if (traceHasFailure(record.executionTrace)) blockers.push('execution_trace_failed');
    if (verificationHasFailure(record.verificationReport)) {
        blockers.push(...(record.verificationReport?.blockers || []));
    }
    if (placementHasFailure(record)) {
        blockers.push('image_placement_verification_failed');
        blockers.push(...record.placementBlockers);
    }
    return uniqueStrings(blockers);
}

function buildWarnings(
    record: NormalizedExecutionRunRecord,
    status: BusinessSkillExecutionPlanIntakeStatus
): string[] {
    const warnings: string[] = [];
    if (!record.executionPlan) warnings.push('缺少 Design Agent OS executionPlan，不能说明本次 Photoshop 执行依据。');
    if (status === 'plan_only_needs_execution_trace') warnings.push('当前只有执行计划，没有工具调用追踪记录。');
    if (status === 'executed_with_trace_needs_verification') warnings.push('已有工具调用追踪，但仍需要截图、bounds 或人工验收。');
    warnings.push(...(record.verificationReport?.warnings || []));
    return uniqueStrings(warnings);
}

function buildLimitations(): string[] {
    return [
        '该 intake 是隐藏执行运行记录，不是模型思考，不进入 Pondering。',
        '它只总结 Design Agent OS executionPlan、executionTrace 和 verificationReport，不改变业务 skill 策略。',
        '工具调用追踪存在不等于设计质量通过；截图、bounds、人工验收仍需独立检查。',
        '该入口不得改变 main-image、detail-page、SKU 的 prompt、DSL、executor 或 Photoshop 写入顺序。'
    ];
}

function buildExecutionPlanSummary(
    record: NormalizedExecutionRunRecord
): BusinessSkillExecutionPlanSummary {
    const steps = record.executionPlan?.steps || [];
    return {
        hasDesignAgentOs: Boolean(record.designAgentOs),
        hasExecutionPlan: Boolean(record.executionPlan),
        planStatus: record.executionPlan?.status,
        stepCount: steps.length,
        operations: uniqueStrings(steps.map((step) => step.operation)),
        hasExecutionTrace: Boolean(record.executionTrace),
        toolCallCount: Number(record.executionTrace?.toolCallCount || 0),
        successfulToolCalls: Number(record.executionTrace?.successfulToolCalls || 0),
        failedToolCalls: Number(record.executionTrace?.failedToolCalls || 0),
        hasVerificationReport: Boolean(record.verificationReport),
        verificationStatus: normalizeRunStatus(record.verificationReport?.status),
        plannerAlignmentStatus: record.plannerAlignmentStatus,
        placementVerificationStatus: record.placementVerificationStatus,
        hasPlacementVerificationIntake: Boolean(record.placementVerificationStatus),
        hasBusinessSkillExecutionIntake: record.businessExecutionIntakePresent
    };
}

export function buildBusinessSkillExecutionPlanIntake(
    input: BuildBusinessSkillExecutionPlanIntakeInput
): BusinessSkillExecutionPlanIntake {
    const resultData = input.resultData || {};
    const normalized = normalizeExecutionRunRecord(resultData);
    const status = resolveStatus(normalized);

    return {
        version: 'business-skill-execution-plan-intake/v0',
        skillId: input.skillId,
        status,
        runRecordOnly: true,
        userVisible: false,
        canClaimDesignQuality: false,
        mustNotChangeBusinessStrategy: true,
        mustNotChangeExecutor: true,
        planSummary: buildExecutionPlanSummary(normalized),
        requiredNextChecks: buildRequiredNextChecks(normalized, status),
        blockers: buildBlockers(normalized),
        warnings: buildWarnings(normalized, status),
        limitations: buildLimitations()
    };
}
