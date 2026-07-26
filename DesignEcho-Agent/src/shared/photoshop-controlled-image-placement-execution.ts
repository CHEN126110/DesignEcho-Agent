import {
    type ImagePlacementBox,
    type ImagePlacementPlan,
    type ImagePlacementVerification,
    verifyImagePlacement
} from './design-image-placement-core';
import { DEFAULT_SMART_SCALING_PRESET } from './design-smart-scaling-policy';

export type ControlledPhotoshopImagePlacementPlanKind = 'image-slot-placement';

export type ControlledPhotoshopImagePlacementPlanStatus =
    | 'blocked_forbidden_arbitrary_script'
    | 'blocked_empty_targets'
    | 'blocked_invalid_targets'
    | 'blocked_duplicate_placement_id'
    | 'blocked_unsafe_source_path'
    | 'blocked_placement_plan_not_ready'
    | 'ready_dry_run';

export type ControlledPhotoshopImagePlacementToolCallPlanStatus =
    | 'blocked_plan_not_ready'
    | 'ready_tool_call_plan';

export type ControlledPhotoshopImagePlacementExecutionTarget =
    | 'fake-adapter'
    | 'disposable-photoshop'
    | 'user-approved-document';

export type ControlledPhotoshopImagePlacementExecutionStatus =
    | 'blocked_plan_not_ready'
    | 'blocked_explicit_live_approval_required'
    | 'failed_tool_call'
    | 'failed_verification_readback'
    | 'completed_needs_verification'
    | 'completed_bounds_verified'
    | 'completed_bounds_needs_review'
    | 'completed_verification_failed';

export interface ControlledPhotoshopImagePlacementTarget {
    id: string;
    label?: string;
    sourcePath: string;
    imageFormat?: string;
    layerName?: string;
    targetGroupId?: number;
    placementPlan: ImagePlacementPlan;
}

export interface ControlledPhotoshopImagePlacementPlanInput {
    kind: ControlledPhotoshopImagePlacementPlanKind;
    userIntent?: string;
    targets?: ControlledPhotoshopImagePlacementTarget[];
    forbiddenArbitraryScript?: unknown;
    forbiddenBatchPlayDescriptors?: unknown;
}

export interface ControlledPhotoshopImagePlacementDryRunOperation {
    id: string;
    placementId: string;
    targetIndex: number;
    targetLabel: string;
    sourcePath: string;
    imageFormat: 'png' | 'jpg' | 'jpeg' | 'webp';
    layerName: string;
    targetGroupId?: number;
    destinationBox: ImagePlacementBox;
    scalePercent: number;
    sourcePlanStatus: ImagePlacementPlan['status'];
    sourceInputDetail: ImagePlacementPlan['inputDetail'];
    requiredReadback: Array<'actualBounds'>;
    payloadPreview: {
        filePath: string;
        destinationBox: ImagePlacementBox;
        scalePercent: number;
        targetGroupId?: number;
    };
    actualResult: null;
}

export interface ControlledPhotoshopImagePlacementExecutionPlan {
    version: 'photoshop-controlled-image-placement-execution/v0';
    kind: ControlledPhotoshopImagePlacementPlanKind;
    status: ControlledPhotoshopImagePlacementPlanStatus;
    mode: 'dry-run';
    allowedTools: Array<'placeImage' | 'transformLayer' | 'moveLayer' | 'moveLayerToGroup' | 'getLayerProperties'>;
    targetCount: number;
    operations: ControlledPhotoshopImagePlacementDryRunOperation[];
    placementIds: string[];
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

export type ControlledPhotoshopImagePlacementToolName =
    | 'placeImage'
    | 'moveLayerToGroup'
    | 'transformLayer'
    | 'moveLayer';

export interface ControlledPhotoshopImagePlacementToolCall {
    id: string;
    sourceOperationId: string;
    placementId: string;
    tool: ControlledPhotoshopImagePlacementToolName;
    params: Record<string, unknown>;
    layerIdSource?: 'previous_placeImage_result';
    reason: string;
    actualResult: null;
}

export interface ControlledPhotoshopImagePlacementToolCallPlan {
    version: 'photoshop-controlled-image-placement-tool-call-plan/v0';
    sourcePlanVersion: ControlledPhotoshopImagePlacementExecutionPlan['version'];
    sourceStatus: ControlledPhotoshopImagePlacementPlanStatus;
    status: ControlledPhotoshopImagePlacementToolCallPlanStatus;
    mode: 'tool-call-plan';
    allowedTools: Array<'placeImage' | 'transformLayer' | 'moveLayer' | 'moveLayerToGroup' | 'getLayerProperties'>;
    toolCalls: ControlledPhotoshopImagePlacementToolCall[];
    blockers: string[];
    warnings: string[];
    verificationPlan: {
        requiredTools: Array<'getLayerProperties'>;
        expectedPlacements: Array<{
            placementId: string;
            destinationBox: ImagePlacementBox;
            placementPlan: ImagePlacementPlan;
        }>;
        tolerance: 'image-placement-core-bounds-policy';
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

export interface ControlledPhotoshopImagePlacementResolvedToolCall
    extends ControlledPhotoshopImagePlacementToolCall {
    params: Record<string, unknown>;
}

export interface ControlledPhotoshopImagePlacementToolCallResult {
    callId: string;
    placementId: string;
    tool: ControlledPhotoshopImagePlacementToolName;
    layerId?: number;
    success: boolean;
    error?: string;
    data?: unknown;
}

export interface ControlledPhotoshopImagePlacementExecutionAdapter {
    runToolCall(call: ControlledPhotoshopImagePlacementResolvedToolCall): Promise<{
        success: boolean;
        layerId?: number;
        error?: string;
        data?: unknown;
    }>;
    readPlacementActualBounds?: () => Promise<Record<string, ImagePlacementBox | null>>;
}

export interface ControlledPhotoshopImagePlacementExecutionOptions {
    liveExecutionApproved?: boolean;
    executionTarget?: ControlledPhotoshopImagePlacementExecutionTarget;
}

export interface ControlledPhotoshopImagePlacementExecutionResult {
    version: 'photoshop-controlled-image-placement-execution-result/v0';
    planVersion: ControlledPhotoshopImagePlacementToolCallPlan['version'];
    status: ControlledPhotoshopImagePlacementExecutionStatus;
    executionTarget: ControlledPhotoshopImagePlacementExecutionTarget;
    executedToolCount: number;
    toolResults: ControlledPhotoshopImagePlacementToolCallResult[];
    blockers: string[];
    warnings: string[];
    verificationReport: {
        required: boolean;
        status: 'not_run' | 'passed' | 'failed' | 'needs_review';
        placements: Array<{
            placementId: string;
            expectedDestinationBox: ImagePlacementBox;
            actualBounds: ImagePlacementBox | null;
            verification: ImagePlacementVerification;
        }>;
    };
    requiresExplicitLiveExecution: true;
    allowsArbitraryScript: false;
    allowsArbitraryBatchPlay: false;
    canClaimRuntimeSpeedup: false;
    canClaimDesignQuality: false;
    canClaimDesignComplete: false;
}

export interface ControlledPhotoshopImagePlacementBenchmarkReport {
    version: 'photoshop-controlled-image-placement-benchmark/v0';
    status: 'blocked_no_ready_plan' | 'ready_estimate' | 'execution_sampled';
    sourcePlanStatus: ControlledPhotoshopImagePlacementPlanStatus;
    toolCallPlanStatus?: ControlledPhotoshopImagePlacementToolCallPlanStatus;
    executionStatus?: ControlledPhotoshopImagePlacementExecutionStatus;
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
const SAFE_IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp']);

function cleanString(value: unknown): string {
    return String(value || '').trim().replace(/\s+/g, ' ');
}

function cleanPath(value: unknown): string {
    return cleanString(value).replace(/\\/g, '/');
}

function normalizePlacementId(value: unknown, index: number): string {
    const text = cleanString(value).replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '');
    return text || `placement-${index + 1}`;
}

function normalizeLayerName(value: unknown, placementId: string): string {
    return cleanString(value) || `controlled_image_${placementId}`;
}

function normalizeImageFormat(format: unknown, sourcePath: string): ControlledPhotoshopImagePlacementDryRunOperation['imageFormat'] | null {
    const explicit = cleanString(format).toLowerCase();
    const fromPath = cleanString(sourcePath.split('.').pop()).toLowerCase();
    const normalized = explicit || fromPath;
    if (!SAFE_IMAGE_EXTENSIONS.has(normalized)) return null;
    return normalized as ControlledPhotoshopImagePlacementDryRunOperation['imageFormat'];
}

function normalizeLayerId(value: unknown): number | undefined {
    const numberValue = Number(value);
    if (!Number.isInteger(numberValue) || numberValue <= 0) return undefined;
    return numberValue;
}

function normalizePositiveNumber(value: unknown): number | null {
    const numberValue = Number(value);
    if (!Number.isFinite(numberValue) || numberValue <= 0) return null;
    return Math.round(numberValue * 100) / 100;
}

function normalizeBox(value: ImagePlacementBox | undefined): ImagePlacementBox | null {
    if (!value) return null;
    const x = Number(value.x);
    const y = Number(value.y);
    const width = normalizePositiveNumber(value.width);
    const height = normalizePositiveNumber(value.height);
    if (!Number.isFinite(x) || !Number.isFinite(y) || width === null || height === null) return null;
    return { x, y, width, height };
}

function hasForbiddenPayload(input: ControlledPhotoshopImagePlacementPlanInput): boolean {
    return input.forbiddenArbitraryScript !== undefined
        || input.forbiddenBatchPlayDescriptors !== undefined;
}

function isAbsolutePath(value: string): boolean {
    return WINDOWS_ABSOLUTE_PATH_PATTERN.test(value)
        || UNC_PATH_PATTERN.test(value.replace(/\//g, '\\'))
        || POSIX_ABSOLUTE_PATH_PATTERN.test(value);
}

function hasUnsafePathSegment(value: string): boolean {
    return value.split(/[\\/]+/).some((part) => part === '..' || part === '.');
}

function isSafeSourcePath(value: string): boolean {
    if (!value) return false;
    if (!isAbsolutePath(value)) return false;
    return !hasUnsafePathSegment(value);
}

function makeEstimate(operationCount: number): ControlledPhotoshopImagePlacementExecutionPlan['efficiencyEstimate'] {
    const writeCount = operationCount * 3;
    return {
        baselineModelToolDecisions: writeCount,
        controlledPlanModelDecisions: 1,
        estimatedModelRoundTripReduction: Math.max(0, writeCount - 1),
        photoshopWriteOperationCount: writeCount,
        boundary: 'estimate only: this does not prove runtime speedup, token reduction, visual quality or Photoshop execution success'
    };
}

function makeExecutionPlan(input: {
    status: ControlledPhotoshopImagePlacementPlanStatus;
    targetCount?: number;
    operations?: ControlledPhotoshopImagePlacementDryRunOperation[];
    blockers?: string[];
    warnings?: string[];
}): ControlledPhotoshopImagePlacementExecutionPlan {
    const operations = input.operations || [];
    const checkStatus = resolvePlanCheckStatus(input.status, operations);

    return {
        version: 'photoshop-controlled-image-placement-execution/v0',
        kind: 'image-slot-placement',
        status: input.status,
        mode: 'dry-run',
        allowedTools: ['placeImage', 'transformLayer', 'moveLayer', 'moveLayerToGroup', 'getLayerProperties'],
        targetCount: input.targetCount || 0,
        operations,
        placementIds: operations.map((operation) => operation.placementId),
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
            source: 'photoshop-controlled-image-placement-execution',
            summary: `status=${input.status}; operations=${operations.length}; targets=${input.targetCount || 0}`,
            status: checkStatus
        }]
    };
}

function resolvePlanCheckStatus(
    status: ControlledPhotoshopImagePlacementPlanStatus,
    operations: ControlledPhotoshopImagePlacementDryRunOperation[]
): 'ready' | 'blocked' | 'needs_review' {
    if (status !== 'ready_dry_run') return 'blocked';
    if (operations.some((operation) => operation.sourcePlanStatus === 'needs_review')) return 'needs_review';
    return 'ready';
}

function normalizeOperation(
    target: ControlledPhotoshopImagePlacementTarget,
    index: number
): ControlledPhotoshopImagePlacementDryRunOperation | null {
    const sourcePath = cleanPath(target.sourcePath);
    const imageFormat = normalizeImageFormat(target.imageFormat, sourcePath);
    const destinationBox = normalizeBox(target.placementPlan?.execution?.destinationBox);
    const scalePercent = normalizePositiveNumber(target.placementPlan?.execution?.scalePercent);
    const targetGroupId = normalizeLayerId(target.targetGroupId);
    const placementId = normalizePlacementId(target.id, index);

    if (!sourcePath || !imageFormat || !destinationBox || scalePercent === null) return null;

    const operation: ControlledPhotoshopImagePlacementDryRunOperation = {
        id: `controlled-image-placement-${String(index + 1).padStart(3, '0')}-${placementId}`,
        placementId,
        targetIndex: index,
        targetLabel: cleanString(target.label || target.id || placementId),
        sourcePath,
        imageFormat,
        layerName: normalizeLayerName(target.layerName, placementId),
        destinationBox,
        scalePercent,
        sourcePlanStatus: target.placementPlan.status,
        sourceInputDetail: target.placementPlan.inputDetail,
        requiredReadback: ['actualBounds'],
        payloadPreview: {
            filePath: sourcePath,
            destinationBox,
            scalePercent
        },
        actualResult: null
    };
    if (targetGroupId) {
        operation.targetGroupId = targetGroupId;
        operation.payloadPreview.targetGroupId = targetGroupId;
    }
    return operation;
}

function buildInvalidTargetWarnings(targets: ControlledPhotoshopImagePlacementTarget[]): string[] {
    return targets.map((target, index) => {
        const id = cleanString(target.id) || `target-${index + 1}`;
        return `invalid image placement target: ${id}`;
    });
}

function targetHasBlockedPlan(target: ControlledPhotoshopImagePlacementTarget): boolean {
    return target.placementPlan?.status === 'blocked';
}

function targetHasUnsafeSource(target: ControlledPhotoshopImagePlacementTarget): boolean {
    return !isSafeSourcePath(cleanPath(target.sourcePath));
}

function buildToolCallsForOperation(
    operation: ControlledPhotoshopImagePlacementDryRunOperation
): ControlledPhotoshopImagePlacementToolCall[] {
    const toolCalls: ControlledPhotoshopImagePlacementToolCall[] = [{
        id: `${operation.id}-place`,
        sourceOperationId: operation.id,
        placementId: operation.placementId,
        tool: 'placeImage',
        params: {
            filePath: operation.sourcePath,
            imageFormat: operation.imageFormat,
            name: operation.layerName,
            center: false,
            x: operation.destinationBox.x,
            y: operation.destinationBox.y,
            scale: 100,
            fitToCanvas: false
        },
        reason: 'place the source image as a new editable layer before controlled transform and bounds verification',
        actualResult: null
    }];

    if (operation.targetGroupId) {
        toolCalls.push({
            id: `${operation.id}-move-to-group`,
            sourceOperationId: operation.id,
            placementId: operation.placementId,
            tool: 'moveLayerToGroup',
            layerIdSource: 'previous_placeImage_result',
            params: {
                targetGroupId: operation.targetGroupId,
                position: 'inside-bottom'
            },
            reason: 'move the placed image into the intended Photoshop group before geometry adjustment',
            actualResult: null
        });
    }

    toolCalls.push({
        id: `${operation.id}-scale`,
        sourceOperationId: operation.id,
        placementId: operation.placementId,
        tool: 'transformLayer',
        layerIdSource: 'previous_placeImage_result',
        params: {
            scaleUniform: operation.scalePercent
        },
        reason: 'apply the deterministic scale from ImagePlacementPlan',
        actualResult: null
    });
    toolCalls.push({
        id: `${operation.id}-move`,
        sourceOperationId: operation.id,
        placementId: operation.placementId,
        tool: 'moveLayer',
        layerIdSource: 'previous_placeImage_result',
        params: {
            x: operation.destinationBox.x,
            y: operation.destinationBox.y,
            relative: false
        },
        reason: 'move the layer to the planned top-left destination for actualBounds readback',
        actualResult: null
    });

    return toolCalls;
}

function makeToolCallPlan(input: {
    plan: ControlledPhotoshopImagePlacementExecutionPlan;
    status: ControlledPhotoshopImagePlacementToolCallPlanStatus;
    toolCalls?: ControlledPhotoshopImagePlacementToolCall[];
    sourcePlansByPlacementId?: Record<string, ImagePlacementPlan>;
    blockers?: string[];
    warnings?: string[];
}): ControlledPhotoshopImagePlacementToolCallPlan {
    const toolCalls = input.toolCalls || [];
    const sourcePlansByPlacementId = input.sourcePlansByPlacementId || {};
    return {
        version: 'photoshop-controlled-image-placement-tool-call-plan/v0',
        sourcePlanVersion: input.plan.version,
        sourceStatus: input.plan.status,
        status: input.status,
        mode: 'tool-call-plan',
        allowedTools: ['placeImage', 'transformLayer', 'moveLayer', 'moveLayerToGroup', 'getLayerProperties'],
        toolCalls,
        blockers: input.blockers || [],
        warnings: input.warnings || [],
        verificationPlan: {
            requiredTools: ['getLayerProperties'],
            expectedPlacements: input.plan.operations.map((operation) => ({
                placementId: operation.placementId,
                destinationBox: operation.destinationBox,
                placementPlan: sourcePlansByPlacementId[operation.placementId] || makeFallbackPlacementPlan(operation)
            })),
            tolerance: 'image-placement-core-bounds-policy',
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

function makeFallbackPlacementPlan(
    operation: ControlledPhotoshopImagePlacementDryRunOperation
): ImagePlacementPlan {
    return {
        version: 'image-placement-core/v0',
        status: operation.sourcePlanStatus,
        designType: 'generic',
        assetRole: 'unknown',
        intent: 'supporting',
        inputDetail: operation.sourceInputDetail,
        source: {
            width: Math.max(1, operation.destinationBox.width),
            height: Math.max(1, operation.destinationBox.height),
            path: operation.sourcePath
        },
        target: {
            box: operation.destinationBox
        },
        decision: {
            scale: operation.scalePercent / 100,
            scalePercent: operation.scalePercent,
            destinationBox: operation.destinationBox,
            subjectDestinationBox: operation.destinationBox,
            targetBox: operation.destinationBox,
            sourceBox: {
                x: 0,
                y: 0,
                width: Math.max(1, operation.destinationBox.width),
                height: Math.max(1, operation.destinationBox.height)
            },
            subjectBox: {
                x: 0,
                y: 0,
                width: Math.max(1, operation.destinationBox.width),
                height: Math.max(1, operation.destinationBox.height)
            },
            fillRatio: 1,
            subjectVisibleRatio: 1,
            cropRisk: 'none',
            confidence: 0.5,
            fallbackUsed: true,
            reasons: ['fallback-controlled-image-placement'],
            warnings: ['fallback placement plan used because source plan was not attached to tool-call compilation'],
            preset: DEFAULT_SMART_SCALING_PRESET
        },
        execution: {
            tool: 'placeImage',
            operation: 'place-and-transform',
            destinationBox: operation.destinationBox,
            targetBox: operation.destinationBox,
            subjectDestinationBox: operation.destinationBox,
            scalePercent: operation.scalePercent,
            requiredReadback: ['actualBounds']
        },
        warnings: ['fallback placement plan used for verification only'],
        blockers: [],
        limitations: [
            'Fallback placement plan only preserves controlled geometry verification.',
            'It cannot support subject-level visual, crop or design-quality claims.'
        ]
    };
}

function normalizeExecutionTarget(value: unknown): ControlledPhotoshopImagePlacementExecutionTarget {
    if (value === 'disposable-photoshop' || value === 'user-approved-document') return value;
    return 'fake-adapter';
}

function extractLayerId(result: { layerId?: number; data?: unknown }): number | undefined {
    const direct = normalizeLayerId(result.layerId);
    if (direct) return direct;
    if (result.data && typeof result.data === 'object' && !Array.isArray(result.data)) {
        return normalizeLayerId((result.data as Record<string, unknown>).layerId);
    }
    return undefined;
}

function normalizeBoundsLike(value: unknown): ImagePlacementBox | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const bounds = value as Record<string, unknown>;
    const x = Number(bounds.x ?? bounds.left);
    const y = Number(bounds.y ?? bounds.top);
    const width = Number(bounds.width);
    const height = Number(bounds.height);
    const right = Number(bounds.right);
    const bottom = Number(bounds.bottom);
    const resolvedWidth = Number.isFinite(width) ? width : right - x;
    const resolvedHeight = Number.isFinite(height) ? height : bottom - y;

    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    if (!Number.isFinite(resolvedWidth) || !Number.isFinite(resolvedHeight)) return null;
    if (resolvedWidth <= 0 || resolvedHeight <= 0) return null;
    return {
        x,
        y,
        width: resolvedWidth,
        height: resolvedHeight
    };
}

function extractPlacementBounds(result: { data?: unknown }): ImagePlacementBox | null {
    const direct = normalizeBoundsLike(result.data);
    if (direct) return direct;
    if (!result.data || typeof result.data !== 'object' || Array.isArray(result.data)) return null;

    const data = result.data as Record<string, unknown>;
    const directBounds = normalizeBoundsLike(data.bounds);
    if (directBounds) return directBounds;

    const layerBounds = normalizeBoundsLike(data.layerBounds);
    if (layerBounds) return layerBounds;

    const properties = data.properties;
    if (properties && typeof properties === 'object' && !Array.isArray(properties)) {
        const propertyBounds = normalizeBoundsLike((properties as Record<string, unknown>).bounds);
        if (propertyBounds) return propertyBounds;
    }

    const nestedData = data.data;
    if (nestedData && typeof nestedData === 'object' && !Array.isArray(nestedData)) {
        const nestedBounds = normalizeBoundsLike((nestedData as Record<string, unknown>).bounds);
        if (nestedBounds) return nestedBounds;
    }

    return null;
}

function computeRuntimeScalePercent(
    placedBounds: ImagePlacementBox | undefined,
    destinationBox: ImagePlacementBox | undefined
): number | null {
    if (!placedBounds || !destinationBox) return null;
    if (placedBounds.width <= 0 || placedBounds.height <= 0) return null;
    const scaleX = destinationBox.width / placedBounds.width;
    const scaleY = destinationBox.height / placedBounds.height;
    const scale = Math.min(scaleX, scaleY) * 100;
    if (!Number.isFinite(scale) || scale <= 0) return null;
    return Math.round(scale * 100) / 100;
}

function resolveToolCall(
    call: ControlledPhotoshopImagePlacementToolCall,
    layerIdsByPlacementId: Map<string, number>,
    placedBoundsByPlacementId: Map<string, ImagePlacementBox>,
    destinationBoxesByPlacementId: Map<string, ImagePlacementBox>
): ControlledPhotoshopImagePlacementResolvedToolCall | null {
    const params: Record<string, unknown> = { ...call.params };
    if (call.layerIdSource === 'previous_placeImage_result') {
        const layerId = layerIdsByPlacementId.get(call.placementId);
        if (!layerId) return null;
        params.layerId = layerId;
    }
    if (call.tool === 'transformLayer' && params.scaleUniform !== undefined) {
        const runtimeScale = computeRuntimeScalePercent(
            placedBoundsByPlacementId.get(call.placementId),
            destinationBoxesByPlacementId.get(call.placementId)
        );
        if (runtimeScale !== null) {
            params.scaleUniform = runtimeScale;
        }
    }
    return {
        ...call,
        params
    };
}

function makeEmptyVerificationReport(
    status: ControlledPhotoshopImagePlacementExecutionResult['verificationReport']['status'] = 'not_run'
): ControlledPhotoshopImagePlacementExecutionResult['verificationReport'] {
    return {
        required: true,
        status,
        placements: []
    };
}

function makeExecutionResult(input: {
    plan: ControlledPhotoshopImagePlacementToolCallPlan;
    status: ControlledPhotoshopImagePlacementExecutionStatus;
    executionTarget: ControlledPhotoshopImagePlacementExecutionTarget;
    toolResults?: ControlledPhotoshopImagePlacementToolCallResult[];
    blockers?: string[];
    warnings?: string[];
    verificationReport?: ControlledPhotoshopImagePlacementExecutionResult['verificationReport'];
}): ControlledPhotoshopImagePlacementExecutionResult {
    const toolResults = input.toolResults || [];
    return {
        version: 'photoshop-controlled-image-placement-execution-result/v0',
        planVersion: input.plan.version,
        status: input.status,
        executionTarget: input.executionTarget,
        executedToolCount: toolResults.length,
        toolResults,
        blockers: input.blockers || [],
        warnings: input.warnings || [],
        verificationReport: input.verificationReport || makeEmptyVerificationReport(),
        requiresExplicitLiveExecution: true,
        allowsArbitraryScript: false,
        allowsArbitraryBatchPlay: false,
        canClaimRuntimeSpeedup: false,
        canClaimDesignQuality: false,
        canClaimDesignComplete: false
    };
}

function buildVerificationReport(
    plan: ControlledPhotoshopImagePlacementToolCallPlan,
    actualBoundsByPlacementId: Record<string, ImagePlacementBox | null>
): ControlledPhotoshopImagePlacementExecutionResult['verificationReport'] {
    const placements = plan.verificationPlan.expectedPlacements.map((expected) => {
        const actualBounds = actualBoundsByPlacementId[expected.placementId] || null;
        return {
            placementId: expected.placementId,
            expectedDestinationBox: expected.destinationBox,
            actualBounds,
            verification: verifyImagePlacement({
                plan: expected.placementPlan,
                actualBounds,
                clippingApplied: false
            })
        };
    });
    const hasFailed = placements.some((item) => item.verification.status === 'failed');
    const hasNeedsReview = placements.some((item) => item.verification.status === 'needs_review');
    const status = resolveVerificationReportStatus(hasFailed, hasNeedsReview);

    return {
        required: true,
        status,
        placements
    };
}

function resolveVerificationReportStatus(
    hasFailed: boolean,
    hasNeedsReview: boolean
): ControlledPhotoshopImagePlacementExecutionResult['verificationReport']['status'] {
    if (hasFailed) return 'failed';
    if (hasNeedsReview) return 'needs_review';
    return 'passed';
}

function makeBenchmarkReport(input: {
    plan: ControlledPhotoshopImagePlacementExecutionPlan;
    toolCallPlan?: ControlledPhotoshopImagePlacementToolCallPlan;
    executionResult?: ControlledPhotoshopImagePlacementExecutionResult;
}): ControlledPhotoshopImagePlacementBenchmarkReport {
    const readyToolPlan = input.toolCallPlan?.status === 'ready_tool_call_plan';
    const operationCount = input.plan.operations.length;
    const plannedWriteCount = readyToolPlan ? input.toolCallPlan?.toolCalls.length || 0 : operationCount * 3;
    const plannedVerificationReadCount = readyToolPlan ? input.plan.operations.length : 0;
    const baselineRoundTrips = operationCount > 0 ? operationCount * 3 : input.plan.targetCount;
    const controlledRoundTrips = readyToolPlan ? 1 : 0;
    const status = resolveBenchmarkStatus(input.plan, input.toolCallPlan, input.executionResult);

    return {
        version: 'photoshop-controlled-image-placement-benchmark/v0',
        status,
        sourcePlanStatus: input.plan.status,
        toolCallPlanStatus: input.toolCallPlan?.status,
        executionStatus: input.executionResult?.status,
        targetCount: input.plan.targetCount,
        plannedPhotoshopWriteOperationCount: plannedWriteCount,
        plannedVerificationReadCount,
        baseline: {
            modelDecisionRoundTrips: baselineRoundTrips,
            photoshopWriteOperationCount: operationCount * 3,
            verificationReadCount: operationCount,
            description: 'baseline assumes the model decides place, transform and move separately for each image slot, then checks bounds'
        },
        controlled: {
            modelDecisionRoundTrips: controlledRoundTrips,
            photoshopWriteOperationCount: plannedWriteCount,
            verificationReadCount: plannedVerificationReadCount,
            description: 'controlled path compiles one image placement manifest, executes white-listed tool calls, then reads actualBounds'
        },
        estimatedReduction: {
            modelDecisionRoundTrips: Math.max(0, baselineRoundTrips - controlledRoundTrips),
            photoshopWriteOperationCount: Math.max(0, operationCount * 3 - plannedWriteCount),
            verificationReadCount: Math.max(0, operationCount - plannedVerificationReadCount)
        },
        warnings: [
            'benchmark is an estimate or sample record only; it must not be used as a design quality claim',
            'Photoshop write operation count usually stays the same; the expected saving is model/tool decision round trips',
            'actualBounds verification only proves geometry, not visual balance, crop quality, image semantics or design completion',
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

function resolveBenchmarkStatus(
    plan: ControlledPhotoshopImagePlacementExecutionPlan,
    toolCallPlan?: ControlledPhotoshopImagePlacementToolCallPlan,
    executionResult?: ControlledPhotoshopImagePlacementExecutionResult
): ControlledPhotoshopImagePlacementBenchmarkReport['status'] {
    if (plan.status !== 'ready_dry_run') return 'blocked_no_ready_plan';
    if (toolCallPlan && toolCallPlan.status !== 'ready_tool_call_plan') return 'blocked_no_ready_plan';
    if (executionResult) return 'execution_sampled';
    return 'ready_estimate';
}

export function buildControlledPhotoshopImagePlacementPlan(
    input: ControlledPhotoshopImagePlacementPlanInput
): ControlledPhotoshopImagePlacementExecutionPlan {
    const targets = Array.isArray(input.targets) ? input.targets : [];
    if (hasForbiddenPayload(input) || input.kind !== 'image-slot-placement') {
        return makeExecutionPlan({
            status: 'blocked_forbidden_arbitrary_script',
            targetCount: targets.length,
            blockers: ['arbitrary_script_batchplay_or_unsupported_image_placement_kind_is_not_allowed']
        });
    }

    if (targets.length < 1) {
        return makeExecutionPlan({
            status: 'blocked_empty_targets',
            blockers: ['at_least_one_image_placement_target_is_required']
        });
    }

    const placementIds = targets.map((target, index) => normalizePlacementId(target.id, index).toLowerCase());
    if (new Set(placementIds).size !== placementIds.length) {
        return makeExecutionPlan({
            status: 'blocked_duplicate_placement_id',
            targetCount: targets.length,
            blockers: ['each_image_placement_target_needs_a_unique_id']
        });
    }

    const blockedPlanTargets = targets.filter(targetHasBlockedPlan);
    if (blockedPlanTargets.length > 0) {
        return makeExecutionPlan({
            status: 'blocked_placement_plan_not_ready',
            targetCount: targets.length,
            blockers: ['blocked_image_placement_plan_cannot_compile_photoshop_write_calls'],
            warnings: blockedPlanTargets.map((target) => `blocked placement plan: ${cleanString(target.id)}`)
        });
    }

    const unsafeSourceTargets = targets.filter(targetHasUnsafeSource);
    if (unsafeSourceTargets.length > 0) {
        return makeExecutionPlan({
            status: 'blocked_unsafe_source_path',
            targetCount: targets.length,
            blockers: ['each_image_placement_target_needs_an_absolute_safe_source_path'],
            warnings: unsafeSourceTargets.map((target) => `unsafe image source path: ${cleanString(target.sourcePath)}`)
        });
    }

    const operations = targets
        .map((target, index) => normalizeOperation(target, index))
        .filter((operation): operation is ControlledPhotoshopImagePlacementDryRunOperation => Boolean(operation));

    if (operations.length !== targets.length) {
        return makeExecutionPlan({
            status: 'blocked_invalid_targets',
            targetCount: targets.length,
            operations,
            blockers: ['all_image_placement_targets_need_source_path_image_format_destination_box_and_scale'],
            warnings: buildInvalidTargetWarnings(targets)
        });
    }

    return makeExecutionPlan({
        status: 'ready_dry_run',
        targetCount: targets.length,
        operations,
        warnings: [
            'dry-run only: actual Photoshop bounds must be verified by getLayerProperties after a future live run',
            'controlled image placement only verifies geometry; it does not understand visual balance, crop aesthetics, product identity or design quality',
            ...targets.flatMap((target) => target.placementPlan.warnings || [])
        ]
    });
}

export function buildControlledPhotoshopImagePlacementToolCallPlan(
    plan: ControlledPhotoshopImagePlacementExecutionPlan,
    sourcePlansByPlacementId: Record<string, ImagePlacementPlan> = {}
): ControlledPhotoshopImagePlacementToolCallPlan {
    if (plan.status !== 'ready_dry_run') {
        return makeToolCallPlan({
            plan,
            status: 'blocked_plan_not_ready',
            blockers: ['dry_run_image_placement_plan_must_be_ready_before_tool_call_compilation'],
            warnings: plan.warnings
        });
    }

    const toolCalls = plan.operations.flatMap((operation) => buildToolCallsForOperation(operation));

    return makeToolCallPlan({
        plan,
        status: 'ready_tool_call_plan',
        toolCalls,
        sourcePlansByPlacementId,
        warnings: [
            ...plan.warnings,
            'runtime transform scale is corrected from placeImage actual bounds when the adapter returns bounds, because Photoshop placed size can differ from file metadata',
            'tool-call plan is still a no-write execution plan; live execution requires an explicit disposable-document or user-approved run'
        ]
    });
}

export async function executeControlledPhotoshopImagePlacementToolCallPlan(
    plan: ControlledPhotoshopImagePlacementToolCallPlan,
    adapter: ControlledPhotoshopImagePlacementExecutionAdapter,
    options: ControlledPhotoshopImagePlacementExecutionOptions = {}
): Promise<ControlledPhotoshopImagePlacementExecutionResult> {
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
            blockers: ['controlled_image_placement_execution_requires_explicit_approval'],
            warnings: plan.warnings
        });
    }

    const toolResults: ControlledPhotoshopImagePlacementToolCallResult[] = [];
    const layerIdsByPlacementId = new Map<string, number>();
    const placedBoundsByPlacementId = new Map<string, ImagePlacementBox>();
    const destinationBoxesByPlacementId = new Map<string, ImagePlacementBox>(
        plan.verificationPlan.expectedPlacements.map((placement) => [placement.placementId, placement.destinationBox])
    );
    for (const call of plan.toolCalls) {
        const resolved = resolveToolCall(
            call,
            layerIdsByPlacementId,
            placedBoundsByPlacementId,
            destinationBoxesByPlacementId
        );
        if (!resolved) {
            return makeExecutionResult({
                plan,
                status: 'failed_tool_call',
                executionTarget,
                toolResults,
                blockers: [`missing_runtime_layer_id_for:${call.id}`],
                warnings: plan.warnings
            });
        }

        let result: Awaited<ReturnType<ControlledPhotoshopImagePlacementExecutionAdapter['runToolCall']>>;
        try {
            result = await adapter.runToolCall(resolved);
        } catch (error) {
            result = {
                success: false,
                error: error instanceof Error ? error.message : String(error)
            };
        }

        const layerId = extractLayerId(result);
        if (call.tool === 'placeImage' && layerId) {
            layerIdsByPlacementId.set(call.placementId, layerId);
            const placedBounds = extractPlacementBounds(result);
            if (placedBounds) {
                placedBoundsByPlacementId.set(call.placementId, placedBounds);
            }
        }

        const toolResult: ControlledPhotoshopImagePlacementToolCallResult = {
            callId: call.id,
            placementId: call.placementId,
            tool: call.tool,
            layerId,
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

    let actualBounds: Record<string, ImagePlacementBox | null> | null;
    try {
        actualBounds = typeof adapter.readPlacementActualBounds === 'function'
            ? await adapter.readPlacementActualBounds()
            : null;
    } catch (error) {
        return makeExecutionResult({
            plan,
            status: 'failed_verification_readback',
            executionTarget,
            toolResults,
            blockers: ['post_run_actual_bounds_readback_failed'],
            warnings: [
                ...plan.warnings,
                error instanceof Error ? error.message : String(error)
            ],
            verificationReport: makeEmptyVerificationReport('failed')
        });
    }

    if (!actualBounds) {
        return makeExecutionResult({
            plan,
            status: 'completed_needs_verification',
            executionTarget,
            toolResults,
            warnings: [
                ...plan.warnings,
                'post-run actualBounds readback is unavailable, so execution cannot be verified'
            ],
            verificationReport: makeEmptyVerificationReport('needs_review')
        });
    }

    const verificationReport = buildVerificationReport(plan, actualBounds);
    const status = resolveExecutionStatusFromVerification(verificationReport.status);

    return makeExecutionResult({
        plan,
        status,
        executionTarget,
        toolResults,
        blockers: verificationReport.status === 'failed' ? ['post_run_actual_bounds_do_not_match_expected_plan'] : [],
        warnings: plan.warnings,
        verificationReport
    });
}

function resolveExecutionStatusFromVerification(
    status: ControlledPhotoshopImagePlacementExecutionResult['verificationReport']['status']
): ControlledPhotoshopImagePlacementExecutionStatus {
    if (status === 'passed') return 'completed_bounds_verified';
    if (status === 'needs_review') return 'completed_bounds_needs_review';
    return 'completed_verification_failed';
}

export function buildControlledPhotoshopImagePlacementBenchmarkReport(
    plan: ControlledPhotoshopImagePlacementExecutionPlan,
    toolCallPlan?: ControlledPhotoshopImagePlacementToolCallPlan,
    executionResult?: ControlledPhotoshopImagePlacementExecutionResult
): ControlledPhotoshopImagePlacementBenchmarkReport {
    return makeBenchmarkReport({
        plan,
        toolCallPlan,
        executionResult
    });
}
