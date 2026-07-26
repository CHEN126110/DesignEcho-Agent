export type ControlledPhotoshopScriptPlanKind = 'layer-lightness-sort';

export type ControlledPhotoshopScriptSortDirection = 'dark-to-light' | 'light-to-dark';

export type ControlledPhotoshopScriptPlanStatus =
    | 'blocked_forbidden_arbitrary_script'
    | 'blocked_insufficient_targets'
    | 'blocked_unreadable_color'
    | 'blocked_locked_targets'
    | 'ready_dry_run';

export interface ControlledPhotoshopScriptLayerTarget {
    layerId: number;
    layerName: string;
    colorHex?: string | null;
    lightness?: number | null;
    lightnessSource?: 'solid-color-hex' | 'inferred-layer-name' | 'external-verified';
    locked?: boolean;
    visible?: boolean;
    parentPath?: string[];
}

export interface ControlledPhotoshopScriptPlanInput {
    kind: ControlledPhotoshopScriptPlanKind;
    direction?: ControlledPhotoshopScriptSortDirection;
    layers?: ControlledPhotoshopScriptLayerTarget[];
    userIntent?: string;
    forbiddenArbitraryScript?: unknown;
    forbiddenBatchPlayDescriptors?: unknown;
}

export interface ControlledPhotoshopScriptDryRunOperation {
    id: string;
    tool: 'reorderLayer';
    layerId: number;
    layerName: string;
    parentPath?: string[];
    currentIndex: number;
    targetIndex: number;
    colorHex: string | null;
    lightness: number;
    lightnessSource: NonNullable<ControlledPhotoshopScriptLayerTarget['lightnessSource']>;
    payloadPreview: {
        layerId: number;
        orderStrategy: 'same-parent-front-sequence';
        expectedIndex: number;
    };
    actualResult: null;
}

export type ControlledPhotoshopScriptToolCallPlanStatus =
    | 'blocked_plan_not_ready'
    | 'blocked_mixed_parent_paths'
    | 'ready_tool_call_plan';

export interface ControlledPhotoshopScriptToolCall {
    id: string;
    sourceOperationId: string;
    tool: 'reorderLayer';
    params: {
        layerId: number;
        action: 'top';
    };
    reason: string;
    actualResult: null;
}

export interface ControlledPhotoshopScriptToolCallPlan {
    version: 'photoshop-controlled-script-tool-call-plan/v0';
    sourcePlanVersion: ControlledPhotoshopScriptExecutionPlan['version'];
    sourceStatus: ControlledPhotoshopScriptPlanStatus;
    status: ControlledPhotoshopScriptToolCallPlanStatus;
    mode: 'tool-call-plan';
    sequenceStrategy: 'move-desired-bottom-to-top-to-front';
    allowedTools: Array<'reorderLayer' | 'getLayerHierarchy'>;
    toolCalls: ControlledPhotoshopScriptToolCall[];
    blockers: string[];
    warnings: string[];
    verificationPlan: {
        requiredTools: Array<'getLayerHierarchy'>;
        expectedTopToBottomLayerIds: number[];
        tolerance: 'exact-layer-id-order';
        failureAction: 'stop_and_report';
    };
    requiresExplicitLiveExecution: true;
    noPhotoshopWrites: true;
    allowsArbitraryScript: false;
    allowsArbitraryBatchPlay: false;
    canClaimDesignQuality: false;
    canClaimDesignComplete: false;
}

export type ControlledPhotoshopScriptExecutionTarget =
    | 'fake-adapter'
    | 'disposable-photoshop'
    | 'user-approved-document';

export type ControlledPhotoshopScriptExecutionStatus =
    | 'blocked_plan_not_ready'
    | 'blocked_explicit_live_approval_required'
    | 'failed_tool_call'
    | 'failed_verification_readback'
    | 'completed_needs_verification'
    | 'completed_verified'
    | 'completed_verification_failed';

export interface ControlledPhotoshopScriptToolCallResult {
    callId: string;
    tool: ControlledPhotoshopScriptToolCall['tool'];
    layerId: number;
    success: boolean;
    error?: string;
    data?: unknown;
}

export interface ControlledPhotoshopScriptExecutionAdapter {
    runToolCall(call: ControlledPhotoshopScriptToolCall): Promise<{
        success: boolean;
        error?: string;
        data?: unknown;
    }>;
    readTargetTopToBottomLayerIds?: () => Promise<number[]>;
}

export interface ControlledPhotoshopScriptExecutionOptions {
    liveExecutionApproved?: boolean;
    executionTarget?: ControlledPhotoshopScriptExecutionTarget;
}

export interface ControlledPhotoshopScriptExecutionResult {
    version: 'photoshop-controlled-script-execution-result/v0';
    planVersion: ControlledPhotoshopScriptToolCallPlan['version'];
    status: ControlledPhotoshopScriptExecutionStatus;
    executionTarget: ControlledPhotoshopScriptExecutionTarget;
    executedToolCount: number;
    toolResults: ControlledPhotoshopScriptToolCallResult[];
    blockers: string[];
    warnings: string[];
    verificationReport: {
        required: boolean;
        status: 'not_run' | 'passed' | 'failed' | 'needs_review';
        expectedTopToBottomLayerIds: number[];
        actualTopToBottomLayerIds: number[];
    };
    requiresExplicitLiveExecution: true;
    allowsArbitraryScript: false;
    allowsArbitraryBatchPlay: false;
    canClaimDesignQuality: false;
    canClaimDesignComplete: false;
}

export interface ControlledPhotoshopScriptBenchmarkMeasurement {
    planningMs?: number;
    executionMs?: number;
    verificationMs?: number;
    totalMs?: number;
    sampleCount?: number;
}

export interface ControlledPhotoshopScriptBenchmarkReport {
    version: 'photoshop-controlled-script-benchmark/v0';
    status: 'blocked_no_ready_plan' | 'ready_estimate' | 'execution_sampled';
    sourcePlanStatus: ControlledPhotoshopScriptPlanStatus;
    toolCallPlanStatus?: ControlledPhotoshopScriptToolCallPlanStatus;
    executionStatus?: ControlledPhotoshopScriptExecutionStatus;
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
    measurement?: ControlledPhotoshopScriptBenchmarkMeasurement;
    warnings: string[];
    canClaimRuntimeSpeedup: false;
    canClaimTokenReduction: false;
    canClaimDesignQuality: false;
    canClaimDesignComplete: false;
}

export interface ControlledPhotoshopScriptEfficiencyEstimate {
    baselineModelToolDecisions: number;
    controlledPlanModelDecisions: 1;
    estimatedModelRoundTripReduction: number;
    photoshopWriteOperationCount: number;
    boundary: string;
}

export interface ControlledPhotoshopScriptExecutionPlan {
    version: 'photoshop-controlled-script-execution/v0';
    kind: ControlledPhotoshopScriptPlanKind;
    status: ControlledPhotoshopScriptPlanStatus;
    mode: 'dry-run';
    direction: ControlledPhotoshopScriptSortDirection;
    allowedTools: Array<'getLayerHierarchy' | 'getLayerProperties' | 'reorderLayer'>;
    targetCount: number;
    operations: ControlledPhotoshopScriptDryRunOperation[];
    sortedLayerIds: number[];
    skippedLayerIds: number[];
    blockers: string[];
    warnings: string[];
    efficiencyEstimate: ControlledPhotoshopScriptEfficiencyEstimate;
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

const HEX_COLOR_PATTERN = /^#?[0-9a-f]{6}$/i;

function normalizeDirection(value: unknown): ControlledPhotoshopScriptSortDirection {
    return value === 'light-to-dark' ? 'light-to-dark' : 'dark-to-light';
}

function cleanString(value: unknown): string {
    return String(value || '').trim().replace(/\s+/g, ' ');
}

function cleanParentPath(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value
        .map((part) => cleanString(part))
        .filter(Boolean);
}

function normalizeColorHex(value: unknown): string | null {
    const text = cleanString(value);
    if (!HEX_COLOR_PATTERN.test(text)) return null;
    return text.startsWith('#') ? text.toUpperCase() : `#${text.toUpperCase()}`;
}

function normalizeLightness(value: unknown): number | null {
    const numberValue = Number(value);
    if (!Number.isFinite(numberValue)) return null;
    return Math.max(0, Math.min(255, Math.round(numberValue * 100) / 100));
}

function normalizeLightnessSource(
    value: unknown,
    hasSolidColorHex: boolean
): NonNullable<ControlledPhotoshopScriptLayerTarget['lightnessSource']> {
    if (value === 'inferred-layer-name' || value === 'external-verified') return value;
    return hasSolidColorHex ? 'solid-color-hex' : 'external-verified';
}

function getRgb(hex: string): { r: number; g: number; b: number } {
    const cleanHex = hex.replace('#', '');
    return {
        r: Number.parseInt(cleanHex.slice(0, 2), 16),
        g: Number.parseInt(cleanHex.slice(2, 4), 16),
        b: Number.parseInt(cleanHex.slice(4, 6), 16)
    };
}

function getLightness(hex: string): number {
    const { r, g, b } = getRgb(hex);
    return Math.round((0.2126 * r + 0.7152 * g + 0.0722 * b) * 100) / 100;
}

function hasForbiddenPayload(input: ControlledPhotoshopScriptPlanInput): boolean {
    return input.forbiddenArbitraryScript !== undefined
        || input.forbiddenBatchPlayDescriptors !== undefined;
}

function makeEstimate(operationCount: number): ControlledPhotoshopScriptEfficiencyEstimate {
    const baselineModelToolDecisions = Math.max(operationCount, 0);
    return {
        baselineModelToolDecisions,
        controlledPlanModelDecisions: 1,
        estimatedModelRoundTripReduction: Math.max(0, baselineModelToolDecisions - 1),
        photoshopWriteOperationCount: operationCount,
        boundary: 'estimate only: this does not prove runtime speedup, visual quality or Photoshop execution success'
    };
}

function makeExecutionPlan(input: {
    status: ControlledPhotoshopScriptPlanStatus;
    direction?: ControlledPhotoshopScriptSortDirection;
    operations?: ControlledPhotoshopScriptDryRunOperation[];
    sortedLayerIds?: number[];
    skippedLayerIds?: number[];
    targetCount?: number;
    blockers?: string[];
    warnings?: string[];
}): ControlledPhotoshopScriptExecutionPlan {
    const operations = input.operations || [];
    const status = input.status;
    return {
        version: 'photoshop-controlled-script-execution/v0',
        kind: 'layer-lightness-sort',
        status,
        mode: 'dry-run',
        direction: input.direction || 'dark-to-light',
        allowedTools: ['getLayerHierarchy', 'getLayerProperties', 'reorderLayer'],
        targetCount: input.targetCount || 0,
        operations,
        sortedLayerIds: input.sortedLayerIds || [],
        skippedLayerIds: input.skippedLayerIds || [],
        blockers: input.blockers || [],
        warnings: input.warnings || [],
        efficiencyEstimate: makeEstimate(operations.length),
        noPhotoshopWrites: true,
        mustNotExecutePhotoshop: true,
        allowsArbitraryScript: false,
        allowsArbitraryBatchPlay: false,
        canClaimDesignQuality: false,
        canClaimDesignComplete: false,
        checks: [{
            source: 'photoshop-controlled-script-execution',
            summary: `status=${status}; operations=${operations.length}; targets=${input.targetCount || 0}`,
            status: status === 'ready_dry_run' ? 'ready' : 'blocked'
        }]
    };
}

function buildOperations(
    layers: Array<ControlledPhotoshopScriptLayerTarget & {
        colorHex: string | null;
        lightness: number;
        lightnessSource: NonNullable<ControlledPhotoshopScriptLayerTarget['lightnessSource']>;
    }>,
    direction: ControlledPhotoshopScriptSortDirection
): ControlledPhotoshopScriptDryRunOperation[] {
    const sorted = [...layers].sort((a, b) => {
        const delta = direction === 'dark-to-light'
            ? a.lightness - b.lightness
            : b.lightness - a.lightness;
        return delta || a.layerId - b.layerId;
    });

    return sorted.map((layer, index) => ({
        id: `controlled-layer-sort-${String(index + 1).padStart(3, '0')}-${layer.layerId}`,
        tool: 'reorderLayer',
        layerId: layer.layerId,
        layerName: layer.layerName,
        parentPath: cleanParentPath(layer.parentPath),
        currentIndex: layers.findIndex((item) => item.layerId === layer.layerId),
        targetIndex: index,
        colorHex: layer.colorHex,
        lightness: layer.lightness,
        lightnessSource: layer.lightnessSource,
        payloadPreview: {
            layerId: layer.layerId,
            orderStrategy: 'same-parent-front-sequence',
            expectedIndex: index
        },
        actualResult: null
    }));
}

function parentPathKey(value: unknown): string {
    return cleanParentPath(value).join('\u001f');
}

function uniqueParentPathKeys(operations: ControlledPhotoshopScriptDryRunOperation[]): string[] {
    return [...new Set(operations.map((operation) => parentPathKey(operation.parentPath)))];
}

function makeToolCallPlan(input: {
    plan: ControlledPhotoshopScriptExecutionPlan;
    status: ControlledPhotoshopScriptToolCallPlanStatus;
    toolCalls?: ControlledPhotoshopScriptToolCall[];
    blockers?: string[];
    warnings?: string[];
}): ControlledPhotoshopScriptToolCallPlan {
    return {
        version: 'photoshop-controlled-script-tool-call-plan/v0',
        sourcePlanVersion: input.plan.version,
        sourceStatus: input.plan.status,
        status: input.status,
        mode: 'tool-call-plan',
        sequenceStrategy: 'move-desired-bottom-to-top-to-front',
        allowedTools: ['reorderLayer', 'getLayerHierarchy'],
        toolCalls: input.toolCalls || [],
        blockers: input.blockers || [],
        warnings: input.warnings || [],
        verificationPlan: {
            requiredTools: ['getLayerHierarchy'],
            expectedTopToBottomLayerIds: input.plan.sortedLayerIds,
            tolerance: 'exact-layer-id-order',
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

function buildFrontSequenceToolCalls(
    operations: ControlledPhotoshopScriptDryRunOperation[]
): ControlledPhotoshopScriptToolCall[] {
    return [...operations].reverse().map((operation, index) => ({
        id: `controlled-tool-call-${String(index + 1).padStart(3, '0')}-${operation.layerId}`,
        sourceOperationId: operation.id,
        tool: 'reorderLayer',
        params: {
            layerId: operation.layerId,
            action: 'top'
        },
        reason: 'move desired bottom-to-top layers to front so final stack matches expected top-to-bottom order',
        actualResult: null
    }));
}

function makeExecutionResult(input: {
    plan: ControlledPhotoshopScriptToolCallPlan;
    status: ControlledPhotoshopScriptExecutionStatus;
    executionTarget: ControlledPhotoshopScriptExecutionTarget;
    toolResults?: ControlledPhotoshopScriptToolCallResult[];
    blockers?: string[];
    warnings?: string[];
    verificationStatus?: ControlledPhotoshopScriptExecutionResult['verificationReport']['status'];
    actualTopToBottomLayerIds?: number[];
}): ControlledPhotoshopScriptExecutionResult {
    const toolResults = input.toolResults || [];
    return {
        version: 'photoshop-controlled-script-execution-result/v0',
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
            expectedTopToBottomLayerIds: input.plan.verificationPlan.expectedTopToBottomLayerIds,
            actualTopToBottomLayerIds: input.actualTopToBottomLayerIds || []
        },
        requiresExplicitLiveExecution: true,
        allowsArbitraryScript: false,
        allowsArbitraryBatchPlay: false,
        canClaimDesignQuality: false,
        canClaimDesignComplete: false
    };
}

function makeBenchmarkReport(input: {
    plan: ControlledPhotoshopScriptExecutionPlan;
    toolCallPlan?: ControlledPhotoshopScriptToolCallPlan;
    executionResult?: ControlledPhotoshopScriptExecutionResult;
    measurement?: ControlledPhotoshopScriptBenchmarkMeasurement;
}): ControlledPhotoshopScriptBenchmarkReport {
    const toolCallPlan = input.toolCallPlan;
    const executionResult = input.executionResult;
    const readyToolPlan = toolCallPlan?.status === 'ready_tool_call_plan';
    const operationCount = input.plan.operations.length;
    const plannedWriteCount = readyToolPlan ? toolCallPlan.toolCalls.length : operationCount;
    const plannedVerificationReadCount = readyToolPlan ? 1 : 0;
    const baselineRoundTrips = operationCount > 0 ? operationCount : input.plan.targetCount;
    const controlledRoundTrips = readyToolPlan ? 1 : 0;
    const status = input.plan.status !== 'ready_dry_run' || (toolCallPlan && !readyToolPlan)
        ? 'blocked_no_ready_plan'
        : executionResult ? 'execution_sampled' : 'ready_estimate';

    return {
        version: 'photoshop-controlled-script-benchmark/v0',
        status,
        sourcePlanStatus: input.plan.status,
        toolCallPlanStatus: toolCallPlan?.status,
        executionStatus: executionResult?.status,
        targetCount: input.plan.targetCount,
        plannedPhotoshopWriteOperationCount: plannedWriteCount,
        plannedVerificationReadCount,
        baseline: {
            modelDecisionRoundTrips: baselineRoundTrips,
            photoshopWriteOperationCount: operationCount,
            verificationReadCount: 1,
            description: 'baseline assumes the model decides each layer reorder step separately, then performs one order readback'
        },
        controlled: {
            modelDecisionRoundTrips: controlledRoundTrips,
            photoshopWriteOperationCount: plannedWriteCount,
            verificationReadCount: plannedVerificationReadCount,
            description: 'controlled path compiles one deterministic plan, executes white-listed tool calls, then reads back hierarchy once'
        },
        estimatedReduction: {
            modelDecisionRoundTrips: Math.max(0, baselineRoundTrips - controlledRoundTrips),
            photoshopWriteOperationCount: Math.max(0, operationCount - plannedWriteCount),
            verificationReadCount: Math.max(0, 1 - plannedVerificationReadCount)
        },
        measurement: input.measurement,
        warnings: [
            'benchmark is an estimate or sample record only; it must not be used as a design quality claim',
            'Photoshop write operation count usually stays the same; the expected saving is model/tool decision round trips',
            'runtime speedup can only be claimed after repeated live samples under the same document and host conditions',
            ...input.plan.warnings,
            ...(toolCallPlan?.warnings || []),
            ...(executionResult?.warnings || [])
        ],
        canClaimRuntimeSpeedup: false,
        canClaimTokenReduction: false,
        canClaimDesignQuality: false,
        canClaimDesignComplete: false
    };
}

function normalizeExecutionTarget(value: unknown): ControlledPhotoshopScriptExecutionTarget {
    if (value === 'disposable-photoshop' || value === 'user-approved-document') {
        return value;
    }
    return 'fake-adapter';
}

function isExpectedLayerOrder(expected: number[], actual: number[]): boolean {
    if (expected.length !== actual.length) return false;
    return expected.every((layerId, index) => actual[index] === layerId);
}

async function readVerificationOrder(
    adapter: ControlledPhotoshopScriptExecutionAdapter
): Promise<number[] | null> {
    if (typeof adapter.readTargetTopToBottomLayerIds !== 'function') return null;
    const value = await adapter.readTargetTopToBottomLayerIds();
    if (!Array.isArray(value)) return [];
    return value
        .map((item) => Number(item))
        .filter((item) => Number.isFinite(item));
}

export async function executeControlledPhotoshopToolCallPlan(
    plan: ControlledPhotoshopScriptToolCallPlan,
    adapter: ControlledPhotoshopScriptExecutionAdapter,
    options: ControlledPhotoshopScriptExecutionOptions = {}
): Promise<ControlledPhotoshopScriptExecutionResult> {
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
            blockers: ['controlled_tool_call_execution_requires_explicit_approval'],
            warnings: plan.warnings
        });
    }

    const toolResults: ControlledPhotoshopScriptToolCallResult[] = [];
    for (const call of plan.toolCalls) {
        if (call.tool !== 'reorderLayer' || call.params.action !== 'top') {
            return makeExecutionResult({
                plan,
                status: 'failed_tool_call',
                executionTarget,
                toolResults,
                blockers: ['unexpected_tool_call_outside_controlled_whitelist'],
                warnings: plan.warnings
            });
        }

        let result: Awaited<ReturnType<ControlledPhotoshopScriptExecutionAdapter['runToolCall']>>;
        try {
            result = await adapter.runToolCall(call);
        } catch (error) {
            result = {
                success: false,
                error: error instanceof Error ? error.message : String(error)
            };
        }
        const toolResult: ControlledPhotoshopScriptToolCallResult = {
            callId: call.id,
            tool: call.tool,
            layerId: call.params.layerId,
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

    let actualOrder: number[] | null;
    try {
        actualOrder = await readVerificationOrder(adapter);
    } catch (error) {
        return makeExecutionResult({
            plan,
            status: 'failed_verification_readback',
            executionTarget,
            toolResults,
            blockers: ['post_run_hierarchy_readback_failed'],
            warnings: [
                ...plan.warnings,
                error instanceof Error ? error.message : String(error)
            ],
            verificationStatus: 'failed'
        });
    }
    if (actualOrder === null) {
        return makeExecutionResult({
            plan,
            status: 'completed_needs_verification',
            executionTarget,
            toolResults,
            warnings: [
                ...plan.warnings,
                'post-run hierarchy readback is unavailable, so execution cannot be verified'
            ],
            verificationStatus: 'needs_review'
        });
    }

    const passed = isExpectedLayerOrder(plan.verificationPlan.expectedTopToBottomLayerIds, actualOrder);
    return makeExecutionResult({
        plan,
        status: passed ? 'completed_verified' : 'completed_verification_failed',
        executionTarget,
        toolResults,
        blockers: passed ? [] : ['post_run_layer_order_does_not_match_expected_plan'],
        warnings: plan.warnings,
        verificationStatus: passed ? 'passed' : 'failed',
        actualTopToBottomLayerIds: actualOrder
    });
}

export function buildControlledPhotoshopLayerLightnessSortToolCallPlan(
    plan: ControlledPhotoshopScriptExecutionPlan
): ControlledPhotoshopScriptToolCallPlan {
    if (plan.status !== 'ready_dry_run') {
        return makeToolCallPlan({
            plan,
            status: 'blocked_plan_not_ready',
            blockers: ['dry_run_plan_must_be_ready_before_tool_call_compilation'],
            warnings: plan.warnings
        });
    }

    const parentKeys = uniqueParentPathKeys(plan.operations);
    if (parentKeys.length > 1) {
        return makeToolCallPlan({
            plan,
            status: 'blocked_mixed_parent_paths',
            blockers: ['all_target_layers_must_share_the_same_parent_for_safe_stack_reorder'],
            warnings: [
                ...plan.warnings,
                'mixed parent paths require a future group-aware reorder strategy instead of a flat top-sequence'
            ]
        });
    }

    return makeToolCallPlan({
        plan,
        status: 'ready_tool_call_plan',
        toolCalls: buildFrontSequenceToolCalls(plan.operations),
        warnings: [
            ...plan.warnings,
            'tool-call plan is still a no-write execution plan; live execution requires an explicit disposable-document or user-approved run'
        ]
    });
}

export function buildControlledPhotoshopScriptBenchmarkReport(
    plan: ControlledPhotoshopScriptExecutionPlan,
    toolCallPlan?: ControlledPhotoshopScriptToolCallPlan,
    executionResult?: ControlledPhotoshopScriptExecutionResult,
    measurement?: ControlledPhotoshopScriptBenchmarkMeasurement
): ControlledPhotoshopScriptBenchmarkReport {
    return makeBenchmarkReport({
        plan,
        toolCallPlan,
        executionResult,
        measurement
    });
}

export function buildControlledPhotoshopLayerLightnessSortPlan(
    input: ControlledPhotoshopScriptPlanInput
): ControlledPhotoshopScriptExecutionPlan {
    const direction = normalizeDirection(input.direction);
    const layers = Array.isArray(input.layers) ? input.layers : [];

    if (hasForbiddenPayload(input)) {
        return makeExecutionPlan({
            status: 'blocked_forbidden_arbitrary_script',
            direction,
            blockers: ['arbitrary_script_or_batchplay_descriptor_is_not_allowed']
        });
    }

    if (input.kind !== 'layer-lightness-sort') {
        return makeExecutionPlan({
            status: 'blocked_forbidden_arbitrary_script',
            direction,
            blockers: ['unsupported_controlled_script_kind']
        });
    }

    if (layers.length < 2) {
        return makeExecutionPlan({
            status: 'blocked_insufficient_targets',
            direction,
            targetCount: layers.length,
            blockers: ['at_least_two_layers_required_for_ordering']
        });
    }

    const lockedLayers = layers.filter((layer) => layer.locked === true);
    if (lockedLayers.length > 0) {
        return makeExecutionPlan({
            status: 'blocked_locked_targets',
            direction,
            targetCount: layers.length,
            skippedLayerIds: lockedLayers.map((layer) => layer.layerId),
            blockers: ['locked_layers_must_be_unlocked_before_batch_reorder'],
            warnings: lockedLayers.map((layer) => `locked layer skipped: ${layer.layerName || layer.layerId}`)
        });
    }

    const normalizedLayers = layers.map((layer) => {
        const colorHex = normalizeColorHex(layer.colorHex);
        const explicitLightness = normalizeLightness(layer.lightness);
        const lightness = colorHex ? getLightness(colorHex) : explicitLightness;
        return {
            ...layer,
            colorHex,
            lightness,
            lightnessSource: normalizeLightnessSource(layer.lightnessSource, Boolean(colorHex))
        };
    });
    const unknownColorLayers = normalizedLayers.filter((layer) => layer.lightness === null);
    if (unknownColorLayers.length > 0) {
        return makeExecutionPlan({
            status: 'blocked_unreadable_color',
            direction,
            targetCount: layers.length,
            skippedLayerIds: unknownColorLayers.map((layer) => layer.layerId),
            blockers: ['all_target_layers_need_readable_color_or_lightness_before_sort'],
            warnings: unknownColorLayers.map((layer) => `unreadable lightness: ${layer.layerName || layer.layerId}`)
        });
    }

    const sortableLayers = normalizedLayers.map((layer) => ({
        ...layer,
        lightness: layer.lightness as number
    }));
    const operations = buildOperations(sortableLayers, direction);

    return makeExecutionPlan({
        status: 'ready_dry_run',
        direction,
        targetCount: layers.length,
        operations,
        sortedLayerIds: operations.map((operation) => operation.layerId),
        warnings: [
            'dry-run only: actual Photoshop layer order must be verified by getLayerHierarchy after a future live run',
            'this only sorts by solid color or explicitly supplied lightness input; it does not understand visual hierarchy, group semantics or design quality'
        ]
    });
}
