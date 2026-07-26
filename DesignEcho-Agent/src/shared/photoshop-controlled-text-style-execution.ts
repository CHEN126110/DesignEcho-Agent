export type ControlledPhotoshopTextStylePlanKind = 'text-style-batch';

export type ControlledPhotoshopTextStylePlanStatus =
    | 'blocked_forbidden_arbitrary_script'
    | 'blocked_insufficient_targets'
    | 'blocked_invalid_targets'
    | 'blocked_no_style_changes'
    | 'blocked_invalid_style'
    | 'blocked_locked_targets'
    | 'ready_dry_run';

export type ControlledPhotoshopTextStyleToolCallPlanStatus =
    | 'blocked_plan_not_ready'
    | 'ready_tool_call_plan';

export type ControlledPhotoshopTextStyleExecutionTarget =
    | 'fake-adapter'
    | 'disposable-photoshop'
    | 'user-approved-document';

export type ControlledPhotoshopTextStyleExecutionStatus =
    | 'blocked_plan_not_ready'
    | 'blocked_explicit_live_approval_required'
    | 'failed_tool_call'
    | 'failed_verification_readback'
    | 'completed_needs_verification'
    | 'completed_verified'
    | 'completed_verification_failed';

export interface ControlledPhotoshopTextStyleTarget {
    layerId: number;
    layerName: string;
    kind?: string;
    locked?: boolean;
    visible?: boolean;
    parentPath?: string[];
    style?: {
        fontName?: string;
        fontSize?: number;
        tracking?: number;
        leading?: number;
    };
}

export interface ControlledPhotoshopTextStylePatch {
    fontName?: string;
    acceptedFontNames?: string[];
    fontSize?: number;
    tracking?: number;
    leading?: number;
}

export interface ControlledPhotoshopTextStylePlanInput {
    kind: ControlledPhotoshopTextStylePlanKind;
    userIntent?: string;
    targets?: ControlledPhotoshopTextStyleTarget[];
    style?: ControlledPhotoshopTextStylePatch;
    forbiddenArbitraryScript?: unknown;
    forbiddenBatchPlayDescriptors?: unknown;
}

export interface ControlledPhotoshopTextStyleDryRunOperation {
    id: string;
    tool: 'setTextStyle';
    layerId: number;
    layerName: string;
    parentPath?: string[];
    targetIndex: number;
    style: Required<Pick<ControlledPhotoshopTextStylePatch, 'acceptedFontNames'>> & Omit<ControlledPhotoshopTextStylePatch, 'acceptedFontNames'>;
    changedKeys: Array<'fontName' | 'fontSize' | 'tracking' | 'leading'>;
    payloadPreview: {
        layerId: number;
        expectedStyleKeys: Array<'fontName' | 'fontSize' | 'tracking' | 'leading'>;
    };
    actualResult: null;
}

export interface ControlledPhotoshopTextStyleExecutionPlan {
    version: 'photoshop-controlled-text-style-execution/v0';
    kind: ControlledPhotoshopTextStylePlanKind;
    status: ControlledPhotoshopTextStylePlanStatus;
    mode: 'dry-run';
    allowedTools: Array<'getAllTextLayers' | 'setTextStyle'>;
    targetCount: number;
    operations: ControlledPhotoshopTextStyleDryRunOperation[];
    targetLayerIds: number[];
    skippedLayerIds: number[];
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
    canClaimDesignQuality: false;
    canClaimDesignComplete: false;
    checks: Array<{
        source: string;
        summary: string;
        status: 'ready' | 'blocked' | 'needs_review';
    }>;
}

export interface ControlledPhotoshopTextStyleToolCall {
    id: string;
    sourceOperationId: string;
    tool: 'setTextStyle';
    params: {
        layerId: number;
        fontName?: string;
        fontSize?: number;
        tracking?: number;
        leading?: number;
    };
    acceptedFontNames: string[];
    reason: string;
    actualResult: null;
}

export interface ControlledPhotoshopTextStyleToolCallPlan {
    version: 'photoshop-controlled-text-style-tool-call-plan/v0';
    sourcePlanVersion: ControlledPhotoshopTextStyleExecutionPlan['version'];
    sourceStatus: ControlledPhotoshopTextStylePlanStatus;
    status: ControlledPhotoshopTextStyleToolCallPlanStatus;
    mode: 'tool-call-plan';
    allowedTools: Array<'setTextStyle' | 'getAllTextLayers'>;
    toolCalls: ControlledPhotoshopTextStyleToolCall[];
    blockers: string[];
    warnings: string[];
    verificationPlan: {
        requiredTools: Array<'getAllTextLayers'>;
        expectedStyle: ControlledPhotoshopTextStylePatch;
        expectedLayerIds: number[];
        tolerance: {
            fontSize: number;
            tracking: number;
            leading: number;
        };
        failureAction: 'stop_and_report';
    };
    requiresExplicitLiveExecution: true;
    noPhotoshopWrites: true;
    allowsArbitraryScript: false;
    allowsArbitraryBatchPlay: false;
    canClaimDesignQuality: false;
    canClaimDesignComplete: false;
}

export interface ControlledPhotoshopTextStyleReadback {
    layerId: number;
    layerName?: string;
    style?: {
        fontName?: string;
        fontSize?: number;
        tracking?: number;
        leading?: number;
    };
}

export interface ControlledPhotoshopTextStyleToolCallResult {
    callId: string;
    tool: ControlledPhotoshopTextStyleToolCall['tool'];
    layerId: number;
    success: boolean;
    error?: string;
    data?: unknown;
}

export interface ControlledPhotoshopTextStyleExecutionAdapter {
    runToolCall(call: ControlledPhotoshopTextStyleToolCall): Promise<{
        success: boolean;
        error?: string;
        data?: unknown;
    }>;
    readTargetTextStyles?: () => Promise<ControlledPhotoshopTextStyleReadback[]>;
}

export interface ControlledPhotoshopTextStyleExecutionOptions {
    liveExecutionApproved?: boolean;
    executionTarget?: ControlledPhotoshopTextStyleExecutionTarget;
    continueOnToolFailure?: boolean;
}

export interface ControlledPhotoshopTextStyleExecutionResult {
    version: 'photoshop-controlled-text-style-execution-result/v0';
    planVersion: ControlledPhotoshopTextStyleToolCallPlan['version'];
    status: ControlledPhotoshopTextStyleExecutionStatus;
    executionTarget: ControlledPhotoshopTextStyleExecutionTarget;
    executedToolCount: number;
    toolResults: ControlledPhotoshopTextStyleToolCallResult[];
    blockers: string[];
    warnings: string[];
    verificationReport: {
        required: boolean;
        status: 'not_run' | 'passed' | 'failed' | 'needs_review';
        expectedLayerIds: number[];
        actualLayerIds: number[];
        mismatches: Array<{
            layerId: number;
            field: 'fontName' | 'fontSize' | 'tracking' | 'leading';
            expected: string | number;
            actual: string | number | null;
        }>;
    };
    requiresExplicitLiveExecution: true;
    allowsArbitraryScript: false;
    allowsArbitraryBatchPlay: false;
    canClaimDesignQuality: false;
    canClaimDesignComplete: false;
}

export interface ControlledPhotoshopTextStyleBenchmarkMeasurement {
    planningMs?: number;
    executionMs?: number;
    verificationMs?: number;
    totalMs?: number;
    sampleCount?: number;
}

export interface ControlledPhotoshopTextStyleBenchmarkReport {
    version: 'photoshop-controlled-text-style-benchmark/v0';
    status: 'blocked_no_ready_plan' | 'ready_estimate' | 'execution_sampled';
    sourcePlanStatus: ControlledPhotoshopTextStylePlanStatus;
    toolCallPlanStatus?: ControlledPhotoshopTextStyleToolCallPlanStatus;
    executionStatus?: ControlledPhotoshopTextStyleExecutionStatus;
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
    measurement?: ControlledPhotoshopTextStyleBenchmarkMeasurement;
    warnings: string[];
    canClaimRuntimeSpeedup: false;
    canClaimTokenReduction: false;
    canClaimDesignQuality: false;
    canClaimDesignComplete: false;
}

function cleanString(value: unknown): string {
    return String(value || '').trim().replace(/\s+/g, ' ');
}

function cleanParentPath(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value.map((part) => cleanString(part)).filter(Boolean);
}

function cleanFontName(value: unknown): string | undefined {
    const text = cleanString(value);
    return text || undefined;
}

function normalizeFontToken(value: unknown): string {
    return cleanString(value)
        .toLowerCase()
        .replace(/[\s\-_/]+/g, '')
        .replace(/[()（）]/g, '');
}

function uniqueStrings(values: unknown[]): string[] {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const value of values) {
        const text = cleanString(value);
        if (!text || seen.has(text)) continue;
        seen.add(text);
        result.push(text);
    }
    return result;
}

function normalizeNumber(value: unknown, min: number, max: number): number | undefined {
    const numberValue = Number(value);
    if (!Number.isFinite(numberValue)) return undefined;
    return Math.max(min, Math.min(max, Math.round(numberValue * 100) / 100));
}

function isNumberOutsideRange(value: unknown, min: number, max: number): boolean {
    if (value === undefined || value === null || value === '') return false;
    const numberValue = Number(value);
    return !Number.isFinite(numberValue) || numberValue < min || numberValue > max;
}

function normalizeStylePatch(style: ControlledPhotoshopTextStylePatch | undefined): ControlledPhotoshopTextStylePatch {
    const fontName = cleanFontName(style?.fontName);
    const acceptedFontNames = uniqueStrings([fontName, ...(Array.isArray(style?.acceptedFontNames) ? style.acceptedFontNames : [])]);
    return {
        ...(fontName ? { fontName } : {}),
        ...(acceptedFontNames.length > 0 ? { acceptedFontNames } : {}),
        ...(style?.fontSize !== undefined ? { fontSize: normalizeNumber(style.fontSize, 1, 400) } : {}),
        ...(style?.tracking !== undefined ? { tracking: normalizeNumber(style.tracking, -1000, 1000) } : {}),
        ...(style?.leading !== undefined ? { leading: normalizeNumber(style.leading, 1, 800) } : {})
    };
}

function changedKeys(style: ControlledPhotoshopTextStylePatch): Array<'fontName' | 'fontSize' | 'tracking' | 'leading'> {
    const keys: Array<'fontName' | 'fontSize' | 'tracking' | 'leading'> = [];
    if (style.fontName) keys.push('fontName');
    if (style.fontSize !== undefined) keys.push('fontSize');
    if (style.tracking !== undefined) keys.push('tracking');
    if (style.leading !== undefined) keys.push('leading');
    return keys;
}

function hasInvalidStyle(style: ControlledPhotoshopTextStylePatch | undefined): boolean {
    return isNumberOutsideRange(style?.fontSize, 1, 400)
        || isNumberOutsideRange(style?.tracking, -1000, 1000)
        || isNumberOutsideRange(style?.leading, 1, 800);
}

function hasForbiddenPayload(input: ControlledPhotoshopTextStylePlanInput): boolean {
    return input.forbiddenArbitraryScript !== undefined
        || input.forbiddenBatchPlayDescriptors !== undefined;
}

function collectInvalidTargetIssues(targets: ControlledPhotoshopTextStyleTarget[]): {
    invalidTargetLabels: string[];
    duplicateLayerIds: number[];
} {
    const seenLayerIds = new Set<number>();
    const duplicateLayerIds = new Set<number>();
    const invalidTargetLabels: string[] = [];

    for (const target of targets) {
        const layerId = Number(target.layerId);
        if (!Number.isFinite(layerId) || layerId <= 0) {
            invalidTargetLabels.push(cleanString(target.layerName) || String(target.layerId));
            continue;
        }
        if (seenLayerIds.has(layerId)) {
            duplicateLayerIds.add(layerId);
            continue;
        }
        seenLayerIds.add(layerId);
    }

    return {
        invalidTargetLabels,
        duplicateLayerIds: Array.from(duplicateLayerIds)
    };
}

function makeEfficiencyEstimate(operationCount: number): ControlledPhotoshopTextStyleExecutionPlan['efficiencyEstimate'] {
    const baselineModelToolDecisions = Math.max(0, operationCount);
    return {
        baselineModelToolDecisions,
        controlledPlanModelDecisions: 1,
        estimatedModelRoundTripReduction: Math.max(0, baselineModelToolDecisions - 1),
        photoshopWriteOperationCount: operationCount,
        boundary: 'estimate only: this does not prove runtime speedup, token reduction, typography quality or Photoshop execution success'
    };
}

function makeExecutionPlan(input: {
    status: ControlledPhotoshopTextStylePlanStatus;
    targetCount?: number;
    operations?: ControlledPhotoshopTextStyleDryRunOperation[];
    targetLayerIds?: number[];
    skippedLayerIds?: number[];
    blockers?: string[];
    warnings?: string[];
}): ControlledPhotoshopTextStyleExecutionPlan {
    const operations = input.operations || [];
    const status = input.status;
    return {
        version: 'photoshop-controlled-text-style-execution/v0',
        kind: 'text-style-batch',
        status,
        mode: 'dry-run',
        allowedTools: ['getAllTextLayers', 'setTextStyle'],
        targetCount: input.targetCount || 0,
        operations,
        targetLayerIds: input.targetLayerIds || [],
        skippedLayerIds: input.skippedLayerIds || [],
        blockers: input.blockers || [],
        warnings: input.warnings || [],
        efficiencyEstimate: makeEfficiencyEstimate(operations.length),
        noPhotoshopWrites: true,
        mustNotExecutePhotoshop: true,
        allowsArbitraryScript: false,
        allowsArbitraryBatchPlay: false,
        canClaimDesignQuality: false,
        canClaimDesignComplete: false,
        checks: [{
            source: 'photoshop-controlled-text-style-execution',
            summary: `status=${status}; operations=${operations.length}; targets=${input.targetCount || 0}`,
            status: status === 'ready_dry_run' ? 'ready' : 'blocked'
        }]
    };
}

function buildOperations(
    targets: ControlledPhotoshopTextStyleTarget[],
    style: ControlledPhotoshopTextStylePatch
): ControlledPhotoshopTextStyleDryRunOperation[] {
    const keys = changedKeys(style);
    const acceptedFontNames = style.acceptedFontNames || (style.fontName ? [style.fontName] : []);
    return targets.map((target, index) => ({
        id: `controlled-text-style-${String(index + 1).padStart(3, '0')}-${target.layerId}`,
        tool: 'setTextStyle',
        layerId: Number(target.layerId),
        layerName: cleanString(target.layerName) || String(target.layerId),
        parentPath: cleanParentPath(target.parentPath),
        targetIndex: index,
        style: {
            ...style,
            acceptedFontNames
        },
        changedKeys: keys,
        payloadPreview: {
            layerId: Number(target.layerId),
            expectedStyleKeys: keys
        },
        actualResult: null
    }));
}

function makeToolCallPlan(input: {
    plan: ControlledPhotoshopTextStyleExecutionPlan;
    status: ControlledPhotoshopTextStyleToolCallPlanStatus;
    toolCalls?: ControlledPhotoshopTextStyleToolCall[];
    blockers?: string[];
    warnings?: string[];
}): ControlledPhotoshopTextStyleToolCallPlan {
    const expectedStyle = input.toolCalls?.[0]
        ? {
            fontName: input.toolCalls[0].params.fontName,
            acceptedFontNames: input.toolCalls[0].acceptedFontNames,
            fontSize: input.toolCalls[0].params.fontSize,
            tracking: input.toolCalls[0].params.tracking,
            leading: input.toolCalls[0].params.leading
        }
        : {};
    return {
        version: 'photoshop-controlled-text-style-tool-call-plan/v0',
        sourcePlanVersion: input.plan.version,
        sourceStatus: input.plan.status,
        status: input.status,
        mode: 'tool-call-plan',
        allowedTools: ['setTextStyle', 'getAllTextLayers'],
        toolCalls: input.toolCalls || [],
        blockers: input.blockers || [],
        warnings: input.warnings || [],
        verificationPlan: {
            requiredTools: ['getAllTextLayers'],
            expectedStyle,
            expectedLayerIds: input.plan.targetLayerIds,
            tolerance: {
                fontSize: 0.5,
                tracking: 1,
                leading: 0.5
            },
            failureAction: 'stop_and_report'
        },
        requiresExplicitLiveExecution: true,
        noPhotoshopWrites: true,
        allowsArbitraryScript: false,
        allowsArbitraryBatchPlay: false,
        canClaimDesignQuality: false,
        canClaimDesignComplete: false
    };
}

function buildToolCalls(operations: ControlledPhotoshopTextStyleDryRunOperation[]): ControlledPhotoshopTextStyleToolCall[] {
    return operations.map((operation, index) => ({
        id: `controlled-text-style-tool-call-${String(index + 1).padStart(3, '0')}-${operation.layerId}`,
        sourceOperationId: operation.id,
        tool: 'setTextStyle',
        params: {
            layerId: operation.layerId,
            fontName: operation.style.fontName,
            fontSize: operation.style.fontSize,
            tracking: operation.style.tracking,
            leading: operation.style.leading
        },
        acceptedFontNames: operation.style.acceptedFontNames,
        reason: `apply controlled text style to ${operation.layerName}`,
        actualResult: null
    }));
}

function normalizeExecutionTarget(value: unknown): ControlledPhotoshopTextStyleExecutionTarget {
    if (value === 'disposable-photoshop' || value === 'user-approved-document') return value;
    return 'fake-adapter';
}

function numericMatches(actual: unknown, expected: unknown, tolerance: number): boolean {
    const actualNumber = Number(actual);
    const expectedNumber = Number(expected);
    return Number.isFinite(actualNumber)
        && Number.isFinite(expectedNumber)
        && Math.abs(actualNumber - expectedNumber) <= tolerance;
}

function fontMatches(actualFont: unknown, acceptedFontNames: string[]): boolean {
    const actual = normalizeFontToken(actualFont);
    if (!actual) return false;
    return acceptedFontNames.some((fontName) => normalizeFontToken(fontName) === actual);
}

function buildMismatches(
    plan: ControlledPhotoshopTextStyleToolCallPlan,
    readback: ControlledPhotoshopTextStyleReadback[]
): ControlledPhotoshopTextStyleExecutionResult['verificationReport']['mismatches'] {
    const byId = new Map(readback.map((item) => [Number(item.layerId), item]));
    const mismatches: ControlledPhotoshopTextStyleExecutionResult['verificationReport']['mismatches'] = [];
    const expected = plan.verificationPlan.expectedStyle;
    const acceptedFontNames = expected.acceptedFontNames || (expected.fontName ? [expected.fontName] : []);
    for (const layerId of plan.verificationPlan.expectedLayerIds) {
        const actual = byId.get(Number(layerId));
        if (!actual) {
            for (const field of Object.keys(expected).filter((key) => key !== 'acceptedFontNames') as Array<'fontName' | 'fontSize' | 'tracking' | 'leading'>) {
                mismatches.push({ layerId, field, expected: expected[field] as string | number, actual: null });
            }
            continue;
        }
        if (expected.fontName && !fontMatches(actual.style?.fontName, acceptedFontNames)) {
            mismatches.push({ layerId, field: 'fontName', expected: expected.fontName, actual: actual.style?.fontName || null });
        }
        if (expected.fontSize !== undefined && !numericMatches(actual.style?.fontSize, expected.fontSize, plan.verificationPlan.tolerance.fontSize)) {
            mismatches.push({ layerId, field: 'fontSize', expected: expected.fontSize, actual: actual.style?.fontSize ?? null });
        }
        if (expected.tracking !== undefined && !numericMatches(actual.style?.tracking, expected.tracking, plan.verificationPlan.tolerance.tracking)) {
            mismatches.push({ layerId, field: 'tracking', expected: expected.tracking, actual: actual.style?.tracking ?? null });
        }
        if (expected.leading !== undefined && !numericMatches(actual.style?.leading, expected.leading, plan.verificationPlan.tolerance.leading)) {
            mismatches.push({ layerId, field: 'leading', expected: expected.leading, actual: actual.style?.leading ?? null });
        }
    }
    return mismatches;
}

async function readVerificationStyles(
    adapter: ControlledPhotoshopTextStyleExecutionAdapter
): Promise<ControlledPhotoshopTextStyleReadback[] | null> {
    if (typeof adapter.readTargetTextStyles !== 'function') return null;
    const value = await adapter.readTargetTextStyles();
    if (!Array.isArray(value)) return [];
    return value
        .map((item) => ({
            ...item,
            layerId: Number(item.layerId)
        }))
        .filter((item) => Number.isFinite(item.layerId));
}

function makeExecutionResult(input: {
    plan: ControlledPhotoshopTextStyleToolCallPlan;
    status: ControlledPhotoshopTextStyleExecutionStatus;
    executionTarget: ControlledPhotoshopTextStyleExecutionTarget;
    toolResults?: ControlledPhotoshopTextStyleToolCallResult[];
    blockers?: string[];
    warnings?: string[];
    verificationStatus?: ControlledPhotoshopTextStyleExecutionResult['verificationReport']['status'];
    actualStyles?: ControlledPhotoshopTextStyleReadback[];
    mismatches?: ControlledPhotoshopTextStyleExecutionResult['verificationReport']['mismatches'];
}): ControlledPhotoshopTextStyleExecutionResult {
    const actualStyles = input.actualStyles || [];
    const toolResults = input.toolResults || [];
    return {
        version: 'photoshop-controlled-text-style-execution-result/v0',
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
            expectedLayerIds: input.plan.verificationPlan.expectedLayerIds,
            actualLayerIds: actualStyles.map((item) => Number(item.layerId)),
            mismatches: input.mismatches || []
        },
        requiresExplicitLiveExecution: true,
        allowsArbitraryScript: false,
        allowsArbitraryBatchPlay: false,
        canClaimDesignQuality: false,
        canClaimDesignComplete: false
    };
}

function makeBenchmarkReport(input: {
    plan: ControlledPhotoshopTextStyleExecutionPlan;
    toolCallPlan?: ControlledPhotoshopTextStyleToolCallPlan;
    executionResult?: ControlledPhotoshopTextStyleExecutionResult;
    measurement?: ControlledPhotoshopTextStyleBenchmarkMeasurement;
}): ControlledPhotoshopTextStyleBenchmarkReport {
    const readyToolPlan = input.toolCallPlan?.status === 'ready_tool_call_plan';
    const operationCount = input.plan.operations.length;
    const plannedWriteCount = readyToolPlan ? input.toolCallPlan?.toolCalls.length || 0 : operationCount;
    const plannedVerificationReadCount = readyToolPlan ? 1 : 0;
    const baselineRoundTrips = operationCount > 0 ? operationCount : input.plan.targetCount;
    const controlledRoundTrips = readyToolPlan ? 1 : 0;
    const status = input.plan.status !== 'ready_dry_run' || (input.toolCallPlan && !readyToolPlan)
        ? 'blocked_no_ready_plan'
        : input.executionResult ? 'execution_sampled' : 'ready_estimate';

    return {
        version: 'photoshop-controlled-text-style-benchmark/v0',
        status,
        sourcePlanStatus: input.plan.status,
        toolCallPlanStatus: input.toolCallPlan?.status,
        executionStatus: input.executionResult?.status,
        targetCount: input.plan.targetCount,
        plannedPhotoshopWriteOperationCount: plannedWriteCount,
        plannedVerificationReadCount,
        baseline: {
            modelDecisionRoundTrips: baselineRoundTrips,
            photoshopWriteOperationCount: operationCount,
            verificationReadCount: 1,
            description: 'baseline assumes the model decides each text style write separately, then performs one text layer readback'
        },
        controlled: {
            modelDecisionRoundTrips: controlledRoundTrips,
            photoshopWriteOperationCount: plannedWriteCount,
            verificationReadCount: plannedVerificationReadCount,
            description: 'controlled path compiles one text style plan, executes white-listed setTextStyle calls, then reads back text layers once'
        },
        estimatedReduction: {
            modelDecisionRoundTrips: Math.max(0, baselineRoundTrips - controlledRoundTrips),
            photoshopWriteOperationCount: Math.max(0, operationCount - plannedWriteCount),
            verificationReadCount: Math.max(0, 1 - plannedVerificationReadCount)
        },
        measurement: input.measurement,
        warnings: [
            'benchmark is an estimate or sample record only; it must not be used as a typography quality claim',
            'Photoshop write operation count usually stays the same; the expected saving is model/tool decision round trips',
            'runtime speedup can only be claimed after repeated live samples under the same document and host conditions',
            ...input.plan.warnings,
            ...(input.toolCallPlan?.warnings || []),
            ...(input.executionResult?.warnings || [])
        ],
        canClaimRuntimeSpeedup: false,
        canClaimTokenReduction: false,
        canClaimDesignQuality: false,
        canClaimDesignComplete: false
    };
}

export function buildControlledPhotoshopTextStyleBatchPlan(
    input: ControlledPhotoshopTextStylePlanInput
): ControlledPhotoshopTextStyleExecutionPlan {
    const targets = Array.isArray(input.targets) ? input.targets : [];
    if (hasForbiddenPayload(input)) {
        return makeExecutionPlan({
            status: 'blocked_forbidden_arbitrary_script',
            blockers: ['arbitrary_script_or_batchplay_descriptor_is_not_allowed']
        });
    }
    if (input.kind !== 'text-style-batch') {
        return makeExecutionPlan({
            status: 'blocked_forbidden_arbitrary_script',
            blockers: ['unsupported_controlled_text_style_kind']
        });
    }
    if (targets.length < 1) {
        return makeExecutionPlan({
            status: 'blocked_insufficient_targets',
            blockers: ['at_least_one_text_layer_required_for_style_batch']
        });
    }

    const invalidTargetIssues = collectInvalidTargetIssues(targets);
    if (invalidTargetIssues.invalidTargetLabels.length > 0 || invalidTargetIssues.duplicateLayerIds.length > 0) {
        return makeExecutionPlan({
            status: 'blocked_invalid_targets',
            targetCount: targets.length,
            skippedLayerIds: invalidTargetIssues.duplicateLayerIds,
            blockers: ['text_style_targets_must_have_unique_positive_layer_ids'],
            warnings: [
                ...invalidTargetIssues.invalidTargetLabels.map((label) => `invalid text layer target skipped: ${label}`),
                ...invalidTargetIssues.duplicateLayerIds.map((layerId) => `duplicate text layer target skipped: ${layerId}`)
            ]
        });
    }

    if (hasInvalidStyle(input.style)) {
        return makeExecutionPlan({
            status: 'blocked_invalid_style',
            targetCount: targets.length,
            blockers: ['text_style_patch_contains_invalid_numeric_values']
        });
    }

    const style = normalizeStylePatch(input.style);
    const keys = changedKeys(style);
    if (keys.length === 0) {
        return makeExecutionPlan({
            status: 'blocked_no_style_changes',
            targetCount: targets.length,
            blockers: ['text_style_patch_must_include_fontName_fontSize_tracking_or_leading']
        });
    }

    const lockedTargets = targets.filter((target) => target.locked === true);
    if (lockedTargets.length > 0) {
        return makeExecutionPlan({
            status: 'blocked_locked_targets',
            targetCount: targets.length,
            skippedLayerIds: lockedTargets.map((target) => Number(target.layerId)),
            blockers: ['locked_text_layers_must_be_unlocked_before_batch_style_write'],
            warnings: lockedTargets.map((target) => `locked text layer skipped: ${target.layerName || target.layerId}`)
        });
    }

    const operations = buildOperations(targets, style);
    return makeExecutionPlan({
        status: 'ready_dry_run',
        targetCount: targets.length,
        operations,
        targetLayerIds: operations.map((operation) => operation.layerId),
        warnings: [
            'dry-run only: no Photoshop text styles were changed',
            'field readback can verify fontName/fontSize/tracking/leading values but cannot prove visual typography quality'
        ]
    });
}

export function buildControlledPhotoshopTextStyleToolCallPlan(
    plan: ControlledPhotoshopTextStyleExecutionPlan
): ControlledPhotoshopTextStyleToolCallPlan {
    if (plan.status !== 'ready_dry_run') {
        return makeToolCallPlan({
            plan,
            status: 'blocked_plan_not_ready',
            blockers: ['dry_run_plan_must_be_ready_before_text_style_tool_call_compilation'],
            warnings: plan.warnings
        });
    }

    return makeToolCallPlan({
        plan,
        status: 'ready_tool_call_plan',
        toolCalls: buildToolCalls(plan.operations),
        warnings: [
            ...plan.warnings,
            'tool-call plan is still a no-write execution plan; live execution requires explicit approval'
        ]
    });
}

export async function executeControlledPhotoshopTextStyleToolCallPlan(
    plan: ControlledPhotoshopTextStyleToolCallPlan,
    adapter: ControlledPhotoshopTextStyleExecutionAdapter,
    options: ControlledPhotoshopTextStyleExecutionOptions = {}
): Promise<ControlledPhotoshopTextStyleExecutionResult> {
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
            blockers: ['controlled_text_style_execution_requires_explicit_approval'],
            warnings: plan.warnings
        });
    }

    const toolResults: ControlledPhotoshopTextStyleToolCallResult[] = [];
    const continueOnToolFailure = options.continueOnToolFailure === true;
    for (const call of plan.toolCalls) {
        if (call.tool !== 'setTextStyle') {
            return makeExecutionResult({
                plan,
                status: 'failed_tool_call',
                executionTarget,
                toolResults,
                blockers: ['unexpected_tool_call_outside_controlled_text_style_whitelist'],
                warnings: plan.warnings
            });
        }

        let result: Awaited<ReturnType<ControlledPhotoshopTextStyleExecutionAdapter['runToolCall']>>;
        try {
            result = await adapter.runToolCall(call);
        } catch (error) {
            result = {
                success: false,
                error: error instanceof Error ? error.message : String(error)
            };
        }
        const toolResult: ControlledPhotoshopTextStyleToolCallResult = {
            callId: call.id,
            tool: call.tool,
            layerId: call.params.layerId,
            success: result.success === true,
            error: result.error,
            data: result.data
        };
        toolResults.push(toolResult);
        if (!toolResult.success) {
            if (!continueOnToolFailure) {
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
    }

    const failedToolCallIds = toolResults
        .filter((result) => result.success !== true)
        .map((result) => result.callId);

    let actualStyles: ControlledPhotoshopTextStyleReadback[] | null;
    try {
        actualStyles = await readVerificationStyles(adapter);
    } catch (error) {
        return makeExecutionResult({
            plan,
            status: 'failed_verification_readback',
            executionTarget,
            toolResults,
            blockers: ['post_run_text_style_readback_failed'],
            warnings: [
                ...plan.warnings,
                error instanceof Error ? error.message : String(error)
            ],
            verificationStatus: 'failed'
        });
    }
    if (actualStyles === null) {
        if (failedToolCallIds.length > 0) {
            return makeExecutionResult({
                plan,
                status: 'failed_tool_call',
                executionTarget,
                toolResults,
                blockers: failedToolCallIds.map((callId) => `tool_call_failed:${callId}`),
                warnings: [
                    ...plan.warnings,
                    'post-run text layer readback is unavailable, so execution cannot be fully verified'
                ],
                verificationStatus: 'needs_review'
            });
        }
        return makeExecutionResult({
            plan,
            status: 'completed_needs_verification',
            executionTarget,
            toolResults,
            warnings: [
                ...plan.warnings,
                'post-run text layer readback is unavailable, so execution cannot be verified'
            ],
            verificationStatus: 'needs_review'
        });
    }

    const mismatches = buildMismatches(plan, actualStyles);
    let status: ControlledPhotoshopTextStyleExecutionStatus = 'completed_verified';
    const blockers: string[] = [];
    if (mismatches.length > 0) {
        status = 'completed_verification_failed';
        blockers.push('post_run_text_style_does_not_match_expected_plan');
    }
    if (failedToolCallIds.length > 0) {
        status = 'failed_tool_call';
        blockers.push(...failedToolCallIds.map((callId) => `tool_call_failed:${callId}`));
    }

    return makeExecutionResult({
        plan,
        status,
        executionTarget,
        toolResults,
        blockers,
        warnings: plan.warnings,
        verificationStatus: mismatches.length === 0 ? 'passed' : 'failed',
        actualStyles,
        mismatches
    });
}

export function buildControlledPhotoshopTextStyleBenchmarkReport(
    plan: ControlledPhotoshopTextStyleExecutionPlan,
    toolCallPlan?: ControlledPhotoshopTextStyleToolCallPlan,
    executionResult?: ControlledPhotoshopTextStyleExecutionResult,
    measurement?: ControlledPhotoshopTextStyleBenchmarkMeasurement
): ControlledPhotoshopTextStyleBenchmarkReport {
    return makeBenchmarkReport({
        plan,
        toolCallPlan,
        executionResult,
        measurement
    });
}
