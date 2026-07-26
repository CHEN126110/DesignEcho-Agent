export type ControlledPhotoshopExportPlanKind = 'group-export-batch';

export type ControlledPhotoshopExportPlanStatus =
    | 'blocked_forbidden_arbitrary_script'
    | 'blocked_empty_targets'
    | 'blocked_invalid_targets'
    | 'blocked_unsupported_format'
    | 'blocked_unsafe_output_path'
    | 'blocked_duplicate_output_path'
    | 'ready_dry_run';

export type ControlledPhotoshopExportToolCallPlanStatus =
    | 'blocked_plan_not_ready'
    | 'ready_tool_call_plan';

export type ControlledPhotoshopExportExecutionTarget =
    | 'fake-adapter'
    | 'disposable-photoshop'
    | 'user-approved-document';

export type ControlledPhotoshopExportExecutionStatus =
    | 'blocked_plan_not_ready'
    | 'blocked_explicit_live_approval_required'
    | 'failed_tool_call'
    | 'failed_verification_readback'
    | 'completed_needs_verification'
    | 'completed_verified'
    | 'completed_verification_failed';

export interface ControlledPhotoshopExportTarget {
    id?: string;
    label?: string;
    groupPath?: string[];
    layerId?: number;
    outputPath: string;
    format?: 'png' | 'jpg' | 'jpeg' | string;
    targetWidth?: number;
    targetHeight?: number;
    maxSize?: number;
}

export interface ControlledPhotoshopExportPlanInput {
    kind: ControlledPhotoshopExportPlanKind;
    userIntent?: string;
    targets?: ControlledPhotoshopExportTarget[];
    forbiddenArbitraryScript?: unknown;
    forbiddenBatchPlayDescriptors?: unknown;
}

export interface ControlledPhotoshopExportDryRunOperation {
    id: string;
    tool: 'exportGroup';
    targetIndex: number;
    targetLabel: string;
    groupPath?: string[];
    layerId?: number;
    outputPath: string;
    format: 'png';
    targetWidth?: number;
    targetHeight?: number;
    maxSize?: number;
    payloadPreview: {
        selector: 'groupPath' | 'layerId';
        outputPath: string;
        format: 'png';
    };
    actualResult: null;
}

export interface ControlledPhotoshopExportExecutionPlan {
    version: 'photoshop-controlled-export-execution/v0';
    kind: ControlledPhotoshopExportPlanKind;
    status: ControlledPhotoshopExportPlanStatus;
    mode: 'dry-run';
    allowedTools: Array<'exportGroup'>;
    targetCount: number;
    operations: ControlledPhotoshopExportDryRunOperation[];
    outputPaths: string[];
    blockers: string[];
    warnings: string[];
    efficiencyEstimate: {
        baselineModelToolDecisions: number;
        controlledPlanModelDecisions: 1;
        estimatedModelRoundTripReduction: number;
        photoshopWriteOperationCount: number;
        boundary: string;
    };
    noPhotoshopWrites: true;
    mustNotExecutePhotoshop: true;
    allowsArbitraryScript: false;
    allowsArbitraryBatchPlay: false;
    canClaimRuntimeSpeedup: false;
    canClaimDesignQuality: false;
    canClaimDesignComplete: false;
    checks: Array<{
        source: string;
        summary: string;
        status: 'ready' | 'blocked' | 'needs_review';
    }>;
}

export interface ControlledPhotoshopExportToolCall {
    id: string;
    sourceOperationId: string;
    tool: 'exportGroup';
    params: {
        groupPath?: string[];
        layerId?: number;
        outputPath: string;
        format: 'png';
        targetWidth?: number;
        targetHeight?: number;
        maxSize?: number;
    };
    reason: string;
    actualResult: null;
}

export interface ControlledPhotoshopExportToolCallPlan {
    version: 'photoshop-controlled-export-tool-call-plan/v0';
    sourcePlanVersion: ControlledPhotoshopExportExecutionPlan['version'];
    sourceStatus: ControlledPhotoshopExportPlanStatus;
    status: ControlledPhotoshopExportToolCallPlanStatus;
    mode: 'tool-call-plan';
    allowedTools: Array<'exportGroup'>;
    toolCalls: ControlledPhotoshopExportToolCall[];
    blockers: string[];
    warnings: string[];
    verificationPlan: {
        requiredTools: Array<'filesystem-exists'>;
        expectedOutputPaths: string[];
        tolerance: 'exact-output-path-exists';
        failureAction: 'stop_and_report';
    };
    requiresExplicitLiveExecution: true;
    noPhotoshopWrites: true;
    allowsArbitraryScript: false;
    allowsArbitraryBatchPlay: false;
    canClaimRuntimeSpeedup: false;
    canClaimDesignQuality: false;
    canClaimDesignComplete: false;
}

export interface ControlledPhotoshopExportToolCallResult {
    callId: string;
    tool: ControlledPhotoshopExportToolCall['tool'];
    outputPath: string;
    success: boolean;
    error?: string;
    data?: unknown;
}

export interface ControlledPhotoshopExportExecutionAdapter {
    runToolCall(call: ControlledPhotoshopExportToolCall): Promise<{
        success: boolean;
        error?: string;
        data?: unknown;
    }>;
    readExportedOutputPaths?: () => Promise<string[]>;
}

export interface ControlledPhotoshopExportExecutionOptions {
    liveExecutionApproved?: boolean;
    executionTarget?: ControlledPhotoshopExportExecutionTarget;
}

export interface ControlledPhotoshopExportExecutionResult {
    version: 'photoshop-controlled-export-execution-result/v0';
    planVersion: ControlledPhotoshopExportToolCallPlan['version'];
    status: ControlledPhotoshopExportExecutionStatus;
    executionTarget: ControlledPhotoshopExportExecutionTarget;
    executedToolCount: number;
    toolResults: ControlledPhotoshopExportToolCallResult[];
    blockers: string[];
    warnings: string[];
    verificationReport: {
        required: boolean;
        status: 'not_run' | 'passed' | 'failed' | 'needs_review';
        expectedOutputPaths: string[];
        actualOutputPaths: string[];
        missingOutputPaths: string[];
    };
    requiresExplicitLiveExecution: true;
    allowsArbitraryScript: false;
    allowsArbitraryBatchPlay: false;
    canClaimRuntimeSpeedup: false;
    canClaimDesignQuality: false;
    canClaimDesignComplete: false;
}

export interface ControlledPhotoshopExportBenchmarkReport {
    version: 'photoshop-controlled-export-benchmark/v0';
    status: 'blocked_no_ready_plan' | 'ready_estimate' | 'execution_sampled';
    sourcePlanStatus: ControlledPhotoshopExportPlanStatus;
    toolCallPlanStatus?: ControlledPhotoshopExportToolCallPlanStatus;
    executionStatus?: ControlledPhotoshopExportExecutionStatus;
    targetCount: number;
    plannedPhotoshopWriteOperationCount: number;
    plannedVerificationReadCount: number;
    baseline: {
        modelDecisionRoundTrips: number;
        photoshopWriteOperationCount: number;
        verificationReadCount: number;
        description: string;
    };
    controlled: {
        modelDecisionRoundTrips: number;
        photoshopWriteOperationCount: number;
        verificationReadCount: number;
        description: string;
    };
    estimatedReduction: {
        modelDecisionRoundTrips: number;
        photoshopWriteOperationCount: number;
        verificationReadCount: number;
    };
    warnings: string[];
    canClaimRuntimeSpeedup: false;
    canClaimTokenReduction: false;
    canClaimDesignQuality: false;
    canClaimDesignComplete: false;
}

const WINDOWS_ABSOLUTE_PATH_PATTERN = /^[a-zA-Z]:[\\/][^:*?"<>|]+/;
const UNC_PATH_PATTERN = /^\\\\[^\\/]+[\\/][^\\/]+/;
const POSIX_ABSOLUTE_PATH_PATTERN = /^\/[^\0]+/;

function cleanString(value: unknown): string {
    return String(value || '').trim();
}

function cleanLabel(value: unknown): string {
    return cleanString(value).replace(/\s+/g, ' ');
}

function cleanGroupPath(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value.map((part) => cleanLabel(part)).filter(Boolean);
}

function cleanOutputPath(value: unknown): string {
    return cleanString(value).replace(/\\/g, '/');
}

function normalizeOptionalPositiveNumber(value: unknown): number | undefined {
    if (value === undefined || value === null || value === '') return undefined;
    const numberValue = Number(value);
    if (!Number.isFinite(numberValue) || numberValue <= 0) return undefined;
    return Math.round(numberValue);
}

function hasForbiddenPayload(input: ControlledPhotoshopExportPlanInput): boolean {
    return input.forbiddenArbitraryScript !== undefined
        || input.forbiddenBatchPlayDescriptors !== undefined;
}

function isAbsoluteOutputPath(value: string): boolean {
    return WINDOWS_ABSOLUTE_PATH_PATTERN.test(value)
        || UNC_PATH_PATTERN.test(value.replace(/\//g, '\\'))
        || POSIX_ABSOLUTE_PATH_PATTERN.test(value);
}

function hasUnsafePathSegment(value: string): boolean {
    return value.split(/[\\/]+/).some((part) => part === '..' || part === '.');
}

function isSafePngOutputPath(value: string): boolean {
    if (!value) return false;
    if (!isAbsoluteOutputPath(value)) return false;
    if (hasUnsafePathSegment(value)) return false;
    return /\.png$/i.test(value);
}

function normalizeFormat(value: unknown): 'png' | null {
    const format = cleanString(value || 'png').toLowerCase();
    return format === 'png' ? 'png' : null;
}

function normalizeLayerId(value: unknown): number | undefined {
    const numberValue = Number(value);
    if (!Number.isInteger(numberValue) || numberValue <= 0) return undefined;
    return numberValue;
}

function hasValidSelector(target: ControlledPhotoshopExportTarget): boolean {
    const hasGroupPath = cleanGroupPath(target.groupPath).length > 0;
    const hasLayerId = normalizeLayerId(target.layerId) !== undefined;
    return hasGroupPath !== hasLayerId;
}

function normalizeTarget(
    target: ControlledPhotoshopExportTarget,
    index: number
): ControlledPhotoshopExportDryRunOperation | null {
    const format = normalizeFormat(target.format);
    const outputPath = cleanOutputPath(target.outputPath);
    const groupPath = cleanGroupPath(target.groupPath);
    const layerId = normalizeLayerId(target.layerId);
    const selector = groupPath.length > 0 ? 'groupPath' : layerId ? 'layerId' : null;
    if (!format || !isSafePngOutputPath(outputPath) || !hasValidSelector(target) || !selector) return null;

    const operation: ControlledPhotoshopExportDryRunOperation = {
        id: `controlled-export-${String(index + 1).padStart(3, '0')}`,
        tool: 'exportGroup',
        targetIndex: index,
        targetLabel: cleanLabel(target.label || target.id || `export-${index + 1}`),
        outputPath,
        format,
        payloadPreview: {
            selector,
            outputPath,
            format
        },
        actualResult: null
    };

    if (selector === 'groupPath') operation.groupPath = groupPath;
    if (selector === 'layerId' && layerId) operation.layerId = layerId;

    const targetWidth = normalizeOptionalPositiveNumber(target.targetWidth);
    const targetHeight = normalizeOptionalPositiveNumber(target.targetHeight);
    const maxSize = normalizeOptionalPositiveNumber(target.maxSize);
    if (targetWidth) operation.targetWidth = targetWidth;
    if (targetHeight) operation.targetHeight = targetHeight;
    if (maxSize) operation.maxSize = maxSize;

    return operation;
}

function makeEstimate(operationCount: number): ControlledPhotoshopExportExecutionPlan['efficiencyEstimate'] {
    return {
        baselineModelToolDecisions: operationCount,
        controlledPlanModelDecisions: 1,
        estimatedModelRoundTripReduction: Math.max(0, operationCount - 1),
        photoshopWriteOperationCount: operationCount,
        boundary: 'estimate only: this does not prove runtime speedup, file quality or Photoshop export success'
    };
}

function makeExecutionPlan(input: {
    status: ControlledPhotoshopExportPlanStatus;
    targetCount?: number;
    operations?: ControlledPhotoshopExportDryRunOperation[];
    blockers?: string[];
    warnings?: string[];
}): ControlledPhotoshopExportExecutionPlan {
    const operations = input.operations || [];
    return {
        version: 'photoshop-controlled-export-execution/v0',
        kind: 'group-export-batch',
        status: input.status,
        mode: 'dry-run',
        allowedTools: ['exportGroup'],
        targetCount: input.targetCount || 0,
        operations,
        outputPaths: operations.map((operation) => operation.outputPath),
        blockers: input.blockers || [],
        warnings: input.warnings || [],
        efficiencyEstimate: makeEstimate(operations.length),
        noPhotoshopWrites: true,
        mustNotExecutePhotoshop: true,
        allowsArbitraryScript: false,
        allowsArbitraryBatchPlay: false,
        canClaimRuntimeSpeedup: false,
        canClaimDesignQuality: false,
        canClaimDesignComplete: false,
        checks: [{
            source: 'photoshop-controlled-export-execution',
            summary: `status=${input.status}; operations=${operations.length}; targets=${input.targetCount || 0}`,
            status: input.status === 'ready_dry_run' ? 'ready' : 'blocked'
        }]
    };
}

function buildToolCall(operation: ControlledPhotoshopExportDryRunOperation): ControlledPhotoshopExportToolCall {
    const params: ControlledPhotoshopExportToolCall['params'] = {
        outputPath: operation.outputPath,
        format: 'png'
    };
    if (operation.groupPath) params.groupPath = operation.groupPath;
    if (operation.layerId) params.layerId = operation.layerId;
    if (operation.targetWidth) params.targetWidth = operation.targetWidth;
    if (operation.targetHeight) params.targetHeight = operation.targetHeight;
    if (operation.maxSize) params.maxSize = operation.maxSize;

    return {
        id: `controlled-export-tool-call-${String(operation.targetIndex + 1).padStart(3, '0')}`,
        sourceOperationId: operation.id,
        tool: 'exportGroup',
        params,
        reason: 'export a verified group or layer to a bounded PNG output path using the white-listed exportGroup tool',
        actualResult: null
    };
}

function makeToolCallPlan(input: {
    plan: ControlledPhotoshopExportExecutionPlan;
    status: ControlledPhotoshopExportToolCallPlanStatus;
    toolCalls?: ControlledPhotoshopExportToolCall[];
    blockers?: string[];
    warnings?: string[];
}): ControlledPhotoshopExportToolCallPlan {
    const toolCalls = input.toolCalls || [];
    return {
        version: 'photoshop-controlled-export-tool-call-plan/v0',
        sourcePlanVersion: input.plan.version,
        sourceStatus: input.plan.status,
        status: input.status,
        mode: 'tool-call-plan',
        allowedTools: ['exportGroup'],
        toolCalls,
        blockers: input.blockers || [],
        warnings: input.warnings || [],
        verificationPlan: {
            requiredTools: ['filesystem-exists'],
            expectedOutputPaths: toolCalls.map((call) => call.params.outputPath),
            tolerance: 'exact-output-path-exists',
            failureAction: 'stop_and_report'
        },
        requiresExplicitLiveExecution: true,
        noPhotoshopWrites: true,
        allowsArbitraryScript: false,
        allowsArbitraryBatchPlay: false,
        canClaimRuntimeSpeedup: false,
        canClaimDesignQuality: false,
        canClaimDesignComplete: false
    };
}

function normalizeExecutionTarget(value: unknown): ControlledPhotoshopExportExecutionTarget {
    if (value === 'disposable-photoshop' || value === 'user-approved-document') return value;
    return 'fake-adapter';
}

function makeExecutionResult(input: {
    plan: ControlledPhotoshopExportToolCallPlan;
    status: ControlledPhotoshopExportExecutionStatus;
    executionTarget: ControlledPhotoshopExportExecutionTarget;
    toolResults?: ControlledPhotoshopExportToolCallResult[];
    blockers?: string[];
    warnings?: string[];
    verificationStatus?: ControlledPhotoshopExportExecutionResult['verificationReport']['status'];
    actualOutputPaths?: string[];
}): ControlledPhotoshopExportExecutionResult {
    const actualOutputPaths = input.actualOutputPaths || [];
    const expectedOutputPaths = input.plan.verificationPlan.expectedOutputPaths;
    const actualSet = new Set(actualOutputPaths.map((item) => cleanOutputPath(item).toLowerCase()));
    const missingOutputPaths = expectedOutputPaths.filter((item) => !actualSet.has(cleanOutputPath(item).toLowerCase()));
    const toolResults = input.toolResults || [];

    return {
        version: 'photoshop-controlled-export-execution-result/v0',
        planVersion: input.plan.version,
        status: input.status,
        executionTarget: input.executionTarget,
        executedToolCount: toolResults.length,
        toolResults,
        blockers: input.blockers || [],
        warnings: input.warnings || [],
        verificationReport: {
            required: true,
            status: input.verificationStatus || 'not_run',
            expectedOutputPaths,
            actualOutputPaths,
            missingOutputPaths
        },
        requiresExplicitLiveExecution: true,
        allowsArbitraryScript: false,
        allowsArbitraryBatchPlay: false,
        canClaimRuntimeSpeedup: false,
        canClaimDesignQuality: false,
        canClaimDesignComplete: false
    };
}

async function readExportedOutputPaths(
    adapter: ControlledPhotoshopExportExecutionAdapter
): Promise<string[] | null> {
    if (typeof adapter.readExportedOutputPaths !== 'function') return null;
    const value = await adapter.readExportedOutputPaths();
    if (!Array.isArray(value)) return [];
    return value.map((item) => cleanOutputPath(item)).filter(Boolean);
}

function pathsMatch(expected: string[], actual: string[]): boolean {
    const actualSet = new Set(actual.map((item) => cleanOutputPath(item).toLowerCase()));
    return expected.every((item) => actualSet.has(cleanOutputPath(item).toLowerCase()));
}

export function buildControlledPhotoshopExportBatchPlan(
    input: ControlledPhotoshopExportPlanInput
): ControlledPhotoshopExportExecutionPlan {
    const targets = Array.isArray(input.targets) ? input.targets : [];
    if (hasForbiddenPayload(input) || input.kind !== 'group-export-batch') {
        return makeExecutionPlan({
            status: 'blocked_forbidden_arbitrary_script',
            targetCount: targets.length,
            blockers: ['arbitrary_script_batchplay_or_unsupported_export_kind_is_not_allowed']
        });
    }

    if (targets.length < 1) {
        return makeExecutionPlan({
            status: 'blocked_empty_targets',
            blockers: ['at_least_one_export_target_is_required']
        });
    }

    const unsupportedFormatTargets = targets.filter((target) => normalizeFormat(target.format) === null);
    if (unsupportedFormatTargets.length > 0) {
        return makeExecutionPlan({
            status: 'blocked_unsupported_format',
            targetCount: targets.length,
            blockers: ['controlled_export_batch_only_allows_png_format'],
            warnings: unsupportedFormatTargets.map((target) => `unsupported export format: ${cleanLabel(target.label || target.id || target.outputPath)}`)
        });
    }

    const invalidSelectorTargets = targets.filter((target) => !hasValidSelector(target));
    if (invalidSelectorTargets.length > 0) {
        return makeExecutionPlan({
            status: 'blocked_invalid_targets',
            targetCount: targets.length,
            blockers: ['each_export_target_must_define_exactly_one_groupPath_or_layerId'],
            warnings: invalidSelectorTargets.map((target) => `invalid export target selector: ${cleanLabel(target.label || target.id || target.outputPath)}`)
        });
    }

    const unsafePathTargets = targets.filter((target) => !isSafePngOutputPath(cleanOutputPath(target.outputPath)));
    if (unsafePathTargets.length > 0) {
        return makeExecutionPlan({
            status: 'blocked_unsafe_output_path',
            targetCount: targets.length,
            blockers: ['each_export_target_needs_an_absolute_safe_png_output_path'],
            warnings: unsafePathTargets.map((target) => `unsafe export output path: ${cleanLabel(target.label || target.id || target.outputPath)}`)
        });
    }

    const outputPaths = targets.map((target) => cleanOutputPath(target.outputPath).toLowerCase());
    if (new Set(outputPaths).size !== outputPaths.length) {
        return makeExecutionPlan({
            status: 'blocked_duplicate_output_path',
            targetCount: targets.length,
            blockers: ['duplicate_output_paths_would_overwrite_export_results']
        });
    }

    const operations = targets
        .map((target, index) => normalizeTarget(target, index))
        .filter((operation): operation is ControlledPhotoshopExportDryRunOperation => Boolean(operation));

    return makeExecutionPlan({
        status: 'ready_dry_run',
        targetCount: targets.length,
        operations,
        warnings: [
            'dry-run only: actual export files must be verified by filesystem existence after a future live run',
            'controlled export only writes PNG files through exportGroup; it does not validate visual crop, alpha quality or platform compliance'
        ]
    });
}

export function buildControlledPhotoshopExportToolCallPlan(
    plan: ControlledPhotoshopExportExecutionPlan
): ControlledPhotoshopExportToolCallPlan {
    if (plan.status !== 'ready_dry_run') {
        return makeToolCallPlan({
            plan,
            status: 'blocked_plan_not_ready',
            blockers: ['dry_run_export_plan_must_be_ready_before_tool_call_compilation'],
            warnings: plan.warnings
        });
    }

    return makeToolCallPlan({
        plan,
        status: 'ready_tool_call_plan',
        toolCalls: plan.operations.map((operation) => buildToolCall(operation)),
        warnings: [
            ...plan.warnings,
            'tool-call plan is still a no-write execution plan; live execution requires an explicit disposable-document or user-approved run'
        ]
    });
}

export async function executeControlledPhotoshopExportToolCallPlan(
    plan: ControlledPhotoshopExportToolCallPlan,
    adapter: ControlledPhotoshopExportExecutionAdapter,
    options: ControlledPhotoshopExportExecutionOptions = {}
): Promise<ControlledPhotoshopExportExecutionResult> {
    const executionTarget = normalizeExecutionTarget(options.executionTarget);

    if (plan.status !== 'ready_tool_call_plan') {
        return makeExecutionResult({
            plan,
            status: 'blocked_plan_not_ready',
            executionTarget,
            blockers: ['tool_call_plan_must_be_ready_before_execution'],
            warnings: plan.warnings
        });
    }

    if (options.liveExecutionApproved !== true) {
        return makeExecutionResult({
            plan,
            status: 'blocked_explicit_live_approval_required',
            executionTarget,
            blockers: ['controlled_export_execution_requires_explicit_approval'],
            warnings: plan.warnings
        });
    }

    const toolResults: ControlledPhotoshopExportToolCallResult[] = [];
    for (const call of plan.toolCalls) {
        if (call.tool !== 'exportGroup' || call.params.format !== 'png') {
            return makeExecutionResult({
                plan,
                status: 'failed_tool_call',
                executionTarget,
                toolResults,
                blockers: ['unexpected_tool_call_outside_controlled_export_whitelist'],
                warnings: plan.warnings
            });
        }

        let result: Awaited<ReturnType<ControlledPhotoshopExportExecutionAdapter['runToolCall']>>;
        try {
            result = await adapter.runToolCall(call);
        } catch (error) {
            result = {
                success: false,
                error: error instanceof Error ? error.message : String(error)
            };
        }

        const toolResult: ControlledPhotoshopExportToolCallResult = {
            callId: call.id,
            tool: call.tool,
            outputPath: call.params.outputPath,
            success: result.success === true,
            error: result.error,
            data: result.data
        };
        toolResults.push(toolResult);

        if (!toolResult.success) {
            return makeExecutionResult({
                plan,
                status: 'failed_tool_call',
                executionTarget,
                toolResults,
                blockers: [`tool_call_failed:${call.id}`],
                warnings: plan.warnings
            });
        }
    }

    let actualOutputPaths: string[] | null;
    try {
        actualOutputPaths = await readExportedOutputPaths(adapter);
    } catch (error) {
        return makeExecutionResult({
            plan,
            status: 'failed_verification_readback',
            executionTarget,
            toolResults,
            blockers: ['post_run_export_file_readback_failed'],
            warnings: [
                ...plan.warnings,
                error instanceof Error ? error.message : String(error)
            ],
            verificationStatus: 'failed'
        });
    }

    if (actualOutputPaths === null) {
        return makeExecutionResult({
            plan,
            status: 'completed_needs_verification',
            executionTarget,
            toolResults,
            warnings: [
                ...plan.warnings,
                'post-run export file readback is unavailable, so execution cannot be verified'
            ],
            verificationStatus: 'needs_review'
        });
    }

    const passed = pathsMatch(plan.verificationPlan.expectedOutputPaths, actualOutputPaths);
    return makeExecutionResult({
        plan,
        status: passed ? 'completed_verified' : 'completed_verification_failed',
        executionTarget,
        toolResults,
        blockers: passed ? [] : ['post_run_export_files_do_not_match_expected_plan'],
        warnings: plan.warnings,
        verificationStatus: passed ? 'passed' : 'failed',
        actualOutputPaths
    });
}

export function buildControlledPhotoshopExportBenchmarkReport(
    plan: ControlledPhotoshopExportExecutionPlan,
    toolCallPlan?: ControlledPhotoshopExportToolCallPlan,
    executionResult?: ControlledPhotoshopExportExecutionResult
): ControlledPhotoshopExportBenchmarkReport {
    const readyToolPlan = toolCallPlan?.status === 'ready_tool_call_plan';
    const operationCount = plan.operations.length;
    const plannedWriteCount = readyToolPlan ? toolCallPlan.toolCalls.length : operationCount;
    const plannedVerificationReadCount = readyToolPlan ? 1 : 0;
    const baselineRoundTrips = operationCount > 0 ? operationCount : plan.targetCount;
    const controlledRoundTrips = readyToolPlan ? 1 : 0;
    const status = plan.status !== 'ready_dry_run' || (toolCallPlan && !readyToolPlan)
        ? 'blocked_no_ready_plan'
        : executionResult ? 'execution_sampled' : 'ready_estimate';

    return {
        version: 'photoshop-controlled-export-benchmark/v0',
        status,
        sourcePlanStatus: plan.status,
        toolCallPlanStatus: toolCallPlan?.status,
        executionStatus: executionResult?.status,
        targetCount: plan.targetCount,
        plannedPhotoshopWriteOperationCount: plannedWriteCount,
        plannedVerificationReadCount,
        baseline: {
            modelDecisionRoundTrips: baselineRoundTrips,
            photoshopWriteOperationCount: operationCount,
            verificationReadCount: 1,
            description: 'baseline assumes the model decides each export step separately, then checks output files'
        },
        controlled: {
            modelDecisionRoundTrips: controlledRoundTrips,
            photoshopWriteOperationCount: plannedWriteCount,
            verificationReadCount: plannedVerificationReadCount,
            description: 'controlled path compiles one export manifest, executes white-listed exportGroup calls, then verifies files once'
        },
        estimatedReduction: {
            modelDecisionRoundTrips: Math.max(0, baselineRoundTrips - controlledRoundTrips),
            photoshopWriteOperationCount: Math.max(0, operationCount - plannedWriteCount),
            verificationReadCount: Math.max(0, 1 - plannedVerificationReadCount)
        },
        warnings: [
            'benchmark is an estimate or sample record only; it must not be used as an export quality claim',
            'Photoshop write operation count usually stays the same; the expected saving is model/tool decision round trips',
            'runtime speedup can only be claimed after repeated live samples under the same document and host conditions',
            ...plan.warnings,
            ...(toolCallPlan?.warnings || []),
            ...(executionResult?.warnings || [])
        ],
        canClaimRuntimeSpeedup: false,
        canClaimTokenReduction: false,
        canClaimDesignQuality: false,
        canClaimDesignComplete: false
    };
}
