import {
    computeSmartScalingDecision,
    type SmartScalingAssetRole,
    type SmartScalingBox,
    type SmartScalingCropPolicy,
    type SmartScalingDecision,
    type SmartScalingDesignType,
    type SmartScalingIntent,
    type SmartScalingPreset
} from './design-smart-scaling-policy';

export type ImagePlacementCoreVersion = 'image-placement-core/v0';
export type ImagePlacementInputDetail = 'metadata' | 'subject-bounds';
export type ImagePlacementVerificationMethod = 'none' | 'bounds' | 'screenshot';
export type ImagePlacementStatus = 'ready' | 'needs_review' | 'blocked';
export type ImagePlacementVerificationStatus = 'passed' | 'needs_review' | 'failed';
export type ImagePlacementExecutionTool =
    | 'placeImage'
    | 'replaceImagePlaceholder'
    | 'fillDetailPage'
    | 'transformLayer'
    | 'custom-adapter';

export interface ImagePlacementBox {
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface ImagePlacementSource {
    width: number;
    height: number;
    path?: string;
    assetId?: string;
    checksum?: string;
    role?: SmartScalingAssetRole;
    subjectBox?: ImagePlacementBox;
}

export interface ImagePlacementTarget {
    box: ImagePlacementBox;
    safeBox?: ImagePlacementBox;
    screenId?: string | number;
    slotId?: string;
    slotRole?: string;
}

export interface ImagePlacementPlanInput {
    source: ImagePlacementSource;
    target: ImagePlacementTarget;
    canvas?: { width: number; height: number };
    designType?: SmartScalingDesignType;
    assetRole?: SmartScalingAssetRole;
    intent?: SmartScalingIntent;
    cropPolicy?: SmartScalingCropPolicy;
    presetOverride?: Partial<SmartScalingPreset>;
    requireSubjectBounds?: boolean;
    executionTool?: ImagePlacementExecutionTool;
}

export interface ImagePlacementExecutionPlan {
    tool: ImagePlacementExecutionTool;
    operation: 'place-and-transform' | 'replace-placeholder-and-transform' | 'transform-existing-layer';
    destinationBox: ImagePlacementBox;
    targetBox: ImagePlacementBox;
    subjectDestinationBox: ImagePlacementBox;
    scalePercent: number;
    requiredReadback: Array<'actualBounds' | 'clippingState' | 'screenshot'>;
}

export interface ImagePlacementPlan {
    version: ImagePlacementCoreVersion;
    status: ImagePlacementStatus;
    designType: SmartScalingDesignType;
    assetRole: SmartScalingAssetRole;
    intent: SmartScalingIntent;
    inputDetail: ImagePlacementInputDetail;
    source: ImagePlacementSource;
    target: ImagePlacementTarget;
    decision: SmartScalingDecision;
    execution: ImagePlacementExecutionPlan;
    warnings: string[];
    blockers: string[];
    limitations: string[];
}

export interface ImagePlacementVerificationInput {
    plan: ImagePlacementPlan;
    actualBounds?: ImagePlacementBox | null;
    clippingApplied?: boolean;
    screenshotReview?: {
        available: boolean;
        reviewStatus?: 'passed' | 'needs_review' | 'failed';
        reason?: string;
    } | null;
}

export interface ImagePlacementVerification {
    version: ImagePlacementCoreVersion;
    status: ImagePlacementVerificationStatus;
    verificationMethod: ImagePlacementVerificationMethod;
    deviation?: {
        x: number;
        y: number;
        width: number;
        height: number;
        maxAbs: number;
    };
    cropRisk: SmartScalingDecision['cropRisk'];
    subjectVisibleRatio: number;
    passedChecks: string[];
    warnings: string[];
    blockers: string[];
    limitations: string[];
}

function finiteNumber(value: unknown): number | null {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
}

function normalizePositive(value: unknown, fallback: number): number {
    const numeric = finiteNumber(value);
    if (numeric === null || numeric <= 0) return fallback;
    return numeric;
}

function normalizeBox(value: ImagePlacementBox | undefined, fallback: ImagePlacementBox): ImagePlacementBox {
    if (!value) return { ...fallback };
    return {
        x: finiteNumber(value.x) ?? fallback.x,
        y: finiteNumber(value.y) ?? fallback.y,
        width: normalizePositive(value.width, fallback.width),
        height: normalizePositive(value.height, fallback.height)
    };
}

function normalizeDesignType(value: SmartScalingDesignType | undefined): SmartScalingDesignType {
    return value || 'generic';
}

function normalizeAssetRole(value: SmartScalingAssetRole | undefined): SmartScalingAssetRole {
    return value || 'unknown';
}

function normalizeIntent(value: SmartScalingIntent | undefined): SmartScalingIntent {
    return value || 'supporting';
}

function toSmartBox(box: ImagePlacementBox): SmartScalingBox {
    return {
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height
    };
}

function fromSmartBox(box: SmartScalingBox): ImagePlacementBox {
    return {
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height
    };
}

function buildCanvas(input: ImagePlacementPlanInput, targetBox: ImagePlacementBox): { width: number; height: number } {
    return {
        width: normalizePositive(input.canvas?.width, targetBox.x + targetBox.width),
        height: normalizePositive(input.canvas?.height, targetBox.y + targetBox.height)
    };
}

function resolveInputDetail(input: ImagePlacementPlanInput): ImagePlacementInputDetail {
    if (input.source.subjectBox) return 'subject-bounds';
    return 'metadata';
}

function resolveExecutionTool(input: ImagePlacementPlanInput): ImagePlacementExecutionTool {
    return input.executionTool || 'custom-adapter';
}

function resolveOperation(tool: ImagePlacementExecutionTool): ImagePlacementExecutionPlan['operation'] {
    switch (tool) {
        case 'replaceImagePlaceholder':
        case 'fillDetailPage':
            return 'replace-placeholder-and-transform';
        case 'transformLayer':
            return 'transform-existing-layer';
        case 'placeImage':
        case 'custom-adapter':
        default:
            return 'place-and-transform';
    }
}

function buildReadback(decision: SmartScalingDecision): ImagePlacementExecutionPlan['requiredReadback'] {
    const required: ImagePlacementExecutionPlan['requiredReadback'] = ['actualBounds', 'clippingState'];
    if (decision.cropRisk === 'medium' || decision.cropRisk === 'high' || decision.confidence < 0.7) {
        required.push('screenshot');
    }
    return required;
}

function buildPlanWarnings(input: ImagePlacementPlanInput, decision: SmartScalingDecision, inputDetail: ImagePlacementInputDetail): string[] {
    const warnings = [...decision.warnings];
    if (inputDetail === 'metadata') {
        warnings.push('缺少 subjectBox，当前只能按整图边界规划置入，不能声称主体级审美缩放通过。');
    }
    if (decision.cropRisk !== 'none') {
        warnings.push(`裁切风险为 ${decision.cropRisk}，执行后需要 Photoshop bounds 或截图复核。`);
    }
    if (!input.source.path && !input.source.assetId) {
        warnings.push('缺少 source path / assetId，后续执行难以追踪素材来源。');
    }
    return Array.from(new Set(warnings));
}

function buildPlanBlockers(input: ImagePlacementPlanInput): string[] {
    const blockers: string[] = [];
    if (input.requireSubjectBounds === true && !input.source.subjectBox) {
        blockers.push('当前策略要求 subjectBox，但输入没有真实主体边界。');
    }
    if (normalizePositive(input.source.width, 0) <= 0 || normalizePositive(input.source.height, 0) <= 0) {
        blockers.push('源图片尺寸无效，不能计算置入比例。');
    }
    if (normalizePositive(input.target.box.width, 0) <= 0 || normalizePositive(input.target.box.height, 0) <= 0) {
        blockers.push('目标 slot 尺寸无效，不能计算置入比例。');
    }
    return blockers;
}

function resolvePlanStatus(input: {
    blockers: string[];
    decision: SmartScalingDecision;
    inputDetail: ImagePlacementInputDetail;
}): ImagePlacementStatus {
    if (input.blockers.length > 0) return 'blocked';
    if (input.decision.confidence < 0.72) return 'needs_review';
    if (input.decision.cropRisk === 'high') return 'needs_review';
    if (input.inputDetail === 'metadata') return 'needs_review';
    return 'ready';
}

export function buildImagePlacementPlan(input: ImagePlacementPlanInput): ImagePlacementPlan {
    const sourceWidth = normalizePositive(input.source.width, 1);
    const sourceHeight = normalizePositive(input.source.height, 1);
    const targetBox = normalizeBox(input.target.box, { x: 0, y: 0, width: sourceWidth, height: sourceHeight });
    const safeBox = input.target.safeBox ? normalizeBox(input.target.safeBox, targetBox) : undefined;
    const subjectBox = input.source.subjectBox ? normalizeBox(input.source.subjectBox, { x: 0, y: 0, width: sourceWidth, height: sourceHeight }) : undefined;
    const designType = normalizeDesignType(input.designType);
    const assetRole = normalizeAssetRole(input.assetRole || input.source.role);
    const intent = normalizeIntent(input.intent);
    const blockers = buildPlanBlockers(input);

    const decision = computeSmartScalingDecision({
        canvas: buildCanvas(input, targetBox),
        source: { width: sourceWidth, height: sourceHeight },
        subjectBox: subjectBox ? toSmartBox(subjectBox) : undefined,
        targetBox: toSmartBox(targetBox),
        safeBox: safeBox ? toSmartBox(safeBox) : undefined,
        designType,
        assetRole,
        intent,
        presetOverride: {
            ...(input.cropPolicy ? { cropPolicy: input.cropPolicy } : {}),
            ...(input.presetOverride || {})
        }
    });
    const inputDetail = resolveInputDetail(input);
    const status = resolvePlanStatus({
        blockers,
        decision,
        inputDetail
    });
    const executionTool = resolveExecutionTool(input);

    return {
        version: 'image-placement-core/v0',
        status,
        designType,
        assetRole,
        intent,
        inputDetail,
        source: {
            ...input.source,
            width: sourceWidth,
            height: sourceHeight,
            subjectBox
        },
        target: {
            ...input.target,
            box: targetBox,
            safeBox
        },
        decision,
        execution: {
            tool: executionTool,
            operation: resolveOperation(executionTool),
            destinationBox: fromSmartBox(decision.destinationBox),
            targetBox: fromSmartBox(decision.targetBox),
            subjectDestinationBox: fromSmartBox(decision.subjectDestinationBox),
            scalePercent: decision.scalePercent,
            requiredReadback: buildReadback(decision)
        },
        warnings: buildPlanWarnings(input, decision, inputDetail),
        blockers,
        limitations: [
            'ImagePlacementPlan 只是执行前计划，不是 Photoshop 执行结果。',
            'planned destinationBox 不能当成 actualBounds；必须由 UXP 执行后读回。',
            '仅有图像元数据时只能做保守几何规划，不能判定主体级审美质量。',
            '截图 QA 应只用于高风险或最终验收，不能默认全量截图拖慢详情页任务。'
        ]
    };
}

function buildDeviation(expected: ImagePlacementBox, actual: ImagePlacementBox): ImagePlacementVerification['deviation'] {
    const deviation = {
        x: actual.x - expected.x,
        y: actual.y - expected.y,
        width: actual.width - expected.width,
        height: actual.height - expected.height,
        maxAbs: 0
    };
    deviation.maxAbs = Math.max(
        Math.abs(deviation.x),
        Math.abs(deviation.y),
        Math.abs(deviation.width),
        Math.abs(deviation.height)
    );
    return deviation;
}

function verifyStatus(input: {
    plan: ImagePlacementPlan;
    deviation?: ImagePlacementVerification['deviation'];
    screenshotStatus?: 'passed' | 'needs_review' | 'failed';
}): ImagePlacementVerificationStatus {
    if (input.plan.status === 'blocked') return 'failed';
    if (input.screenshotStatus === 'failed') return 'failed';
    if (!input.deviation) return 'needs_review';
    if (input.deviation.maxAbs > 8) return 'failed';
    if (input.plan.decision.cropRisk === 'high') return 'needs_review';
    if (input.plan.inputDetail === 'metadata') return 'needs_review';
    if (input.deviation.maxAbs > 2) return 'needs_review';
    if (input.screenshotStatus === 'needs_review') return 'needs_review';
    return 'passed';
}

function resolveVerificationMethod(input: {
    hasActualBounds: boolean;
    screenshotStatus?: 'passed' | 'needs_review' | 'failed';
}): ImagePlacementVerificationMethod {
    if (input.screenshotStatus === 'passed') return 'screenshot';
    if (input.hasActualBounds) return 'bounds';
    return 'none';
}

function buildVerificationWarnings(input: ImagePlacementVerificationInput, deviation?: ImagePlacementVerification['deviation']): string[] {
    const warnings = [...input.plan.warnings];
    if (!input.actualBounds) {
        warnings.push('缺少执行后 actualBounds，不能验证 Photoshop 置入是否真的落位。');
    } else if (deviation && deviation.maxAbs > 2) {
        warnings.push(`执行后 bounds 与计划偏差 ${deviation.maxAbs.toFixed(1)}px，需要复核或局部微调。`);
    }
    if (input.plan.execution.requiredReadback.includes('screenshot') && !input.screenshotReview?.available) {
        warnings.push('当前计划要求截图复核，但还没有截图复核结果。');
    }
    return Array.from(new Set(warnings));
}

function buildVerificationBlockers(input: ImagePlacementVerificationInput, status: ImagePlacementVerificationStatus): string[] {
    const blockers = [...input.plan.blockers];
    if (status === 'failed' && !input.actualBounds) {
        blockers.push('无 actualBounds，无法确认 Photoshop 实际执行结果。');
    }
    if (input.screenshotReview?.reviewStatus === 'failed') {
        blockers.push(input.screenshotReview.reason || '截图复核失败。');
    }
    return Array.from(new Set(blockers));
}

export function verifyImagePlacement(input: ImagePlacementVerificationInput): ImagePlacementVerification {
    const actualBounds = input.actualBounds ? normalizeBox(input.actualBounds, input.plan.execution.destinationBox) : null;
    const deviation = actualBounds ? buildDeviation(input.plan.execution.destinationBox, actualBounds) : undefined;
    const screenshotStatus = input.screenshotReview?.reviewStatus;
    const status = verifyStatus({
        plan: input.plan,
        deviation,
        screenshotStatus
    });
    const warnings = buildVerificationWarnings(input, deviation);
    const blockers = buildVerificationBlockers(input, status);

    const passedChecks: string[] = [];
    if (actualBounds && deviation && deviation.maxAbs <= 2) {
        passedChecks.push('actualBounds matches planned destinationBox within 2px');
    }
    if (input.clippingApplied === true) {
        passedChecks.push('clipping state was reported by executor');
    }
    if (input.screenshotReview?.reviewStatus === 'passed') {
        passedChecks.push('screenshot review passed');
    }

    return {
        version: 'image-placement-core/v0',
        status,
        verificationMethod: resolveVerificationMethod({
            hasActualBounds: Boolean(actualBounds),
            screenshotStatus
        }),
        deviation,
        cropRisk: input.plan.decision.cropRisk,
        subjectVisibleRatio: input.plan.decision.subjectVisibleRatio,
        passedChecks,
        warnings,
        blockers,
        limitations: [
            'bounds 通过只证明几何位置接近，不等于截图级审美通过。',
            '没有截图复核时，不能判定画面重心、裁切观感或详情页整体质量通过。',
            'verification status 是单次置入验证，不替代整屏或整页 QA。'
        ]
    };
}

export function formatImagePlacementCorePolicyForPlanner(): string[] {
    return [
        'Image placement must be planned as source image + subjectBox + target slot + crop policy + destinationBox.',
        'Use metadata-only planning as a fast path, but keep status needs_review when subjectBox is missing.',
        'Never treat planned destinationBox as a Photoshop execution result; read actualBounds after UXP execution.',
        'Use screenshot QA only for high-risk placements or final review to avoid slowing long detail-page tasks.',
        'High crop risk or missing source trace must produce warnings instead of a successful quality claim.'
    ];
}
