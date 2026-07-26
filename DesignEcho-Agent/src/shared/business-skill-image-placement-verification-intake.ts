import {
    verifyImagePlacement,
    type ImagePlacementBox,
    type ImagePlacementPlan,
    type ImagePlacementVerification
} from './design-image-placement-core';

export type BusinessSkillImagePlacementVerificationIntakeVersion =
    'business-skill-image-placement-verification-intake/v0';

export type BusinessSkillImagePlacementVerificationStatus =
    | 'no_placement_plan'
    | 'needs_actual_bounds'
    | 'needs_screenshot_review'
    | 'verified_by_bounds'
    | 'failed_bounds_or_screenshot';

export interface BusinessSkillImagePlacementCheckSummary {
    hasPlacementPlan: boolean;
    hasPlannedDestinationBox: boolean;
    hasActualBounds: boolean;
    hasScreenshotReview: boolean;
    placementCount: number;
    verifiedCount: number;
    failedCount: number;
}

export interface BusinessSkillImagePlacementVerificationIntake {
    version: BusinessSkillImagePlacementVerificationIntakeVersion;
    skillId: string;
    status: BusinessSkillImagePlacementVerificationStatus;
    readOnly: true;
    userVisible: false;
    canClaimDesignQuality: false;
    mustNotChangeBusinessStrategy: true;
    placementCheck: BusinessSkillImagePlacementCheckSummary;
    requiredNextChecks: string[];
    warnings: string[];
    blockers: string[];
    limitations: string[];
    verification?: ImagePlacementVerification;
}

export interface BusinessSkillImagePlacementVerificationIntakeInput {
    skillId: string;
    resultData?: Record<string, unknown> | null;
}

interface NormalizedPlacementContext {
    plan?: ImagePlacementPlan;
    actualBounds?: ImagePlacementBox;
    clippingApplied?: boolean;
    screenshotReview?: {
        available: boolean;
        reviewStatus?: 'passed' | 'needs_review' | 'failed';
        reason?: string;
    };
}

function isObject(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readObject(value: unknown): Record<string, unknown> | undefined {
    return isObject(value) ? value : undefined;
}

function readImagePlacementPlan(data: Record<string, unknown>): ImagePlacementPlan | undefined {
    const candidates = [
        data.imagePlacementPlan,
        data.placementPlan,
        readObject(data.imagePlacement)?.plan,
        readObject(data.imagePlacement)?.imagePlacementPlan
    ];

    return candidates.find((candidate): candidate is ImagePlacementPlan => {
        const plan = readObject(candidate);
        return plan?.version === 'image-placement-core/v0' && isObject(plan.execution);
    });
}

function readBox(value: unknown): ImagePlacementBox | undefined {
    const box = readObject(value);
    if (!box) return undefined;

    const x = Number(box.x);
    const y = Number(box.y);
    const width = Number(box.width);
    const height = Number(box.height);
    if (![x, y, width, height].every(Number.isFinite)) return undefined;
    if (width <= 0 || height <= 0) return undefined;

    return { x, y, width, height };
}

function readActualBounds(data: Record<string, unknown>): ImagePlacementBox | undefined {
    const placementAudit = readObject(data.placementAudit);
    const placementAuditSummary = readObject(data.placementAuditSummary);
    const imagePlacement = readObject(data.imagePlacement);
    const candidates = [
        data.imagePlacementActualBounds,
        data.actualBounds,
        imagePlacement?.actualBounds,
        placementAudit?.actualBounds,
        placementAudit?.bounds,
        placementAuditSummary?.actualBounds
    ];

    for (const candidate of candidates) {
        const box = readBox(candidate);
        if (box) return box;
    }

    return undefined;
}

function readScreenshotReview(data: Record<string, unknown>): NormalizedPlacementContext['screenshotReview'] {
    const candidate = readObject(data.imagePlacementScreenshotReview)
        || readObject(data.screenshotReview)
        || readObject(data.mainImageScreenshotQa);
    if (!candidate) return undefined;

    const reviewStatus = String(candidate.reviewStatus || candidate.status || '').trim();
    const normalizedStatus = normalizeScreenshotStatus(reviewStatus);
    return {
        available: candidate.available === true || Boolean(normalizedStatus),
        reviewStatus: normalizedStatus,
        reason: String(candidate.reason || candidate.message || '').trim() || undefined
    };
}

function normalizeScreenshotStatus(value: string): 'passed' | 'needs_review' | 'failed' | undefined {
    switch (value) {
        case 'passed':
        case 'pass':
        case 'ok':
            return 'passed';
        case 'failed':
        case 'fail':
        case 'error':
            return 'failed';
        case 'needs_review':
        case 'watch':
        case 'warning':
            return 'needs_review';
        default:
            return undefined;
    }
}

function normalizePlacementContext(data: Record<string, unknown>): NormalizedPlacementContext {
    const plan = readImagePlacementPlan(data);

    const actualBounds = readActualBounds(data);

    const screenshotReview = readScreenshotReview(data);

    const clippingApplied = data.imagePlacementClippingApplied === true
        || data.clippingApplied === true
        || readObject(data.imagePlacement)?.clippingApplied === true;

    return {
        plan,
        actualBounds,
        clippingApplied,
        screenshotReview
    };
}

function buildRequiredNextChecks(input: {
    context: NormalizedPlacementContext;
    verification?: ImagePlacementVerification;
}): string[] {
    const required: string[] = [];
    if (!input.context.plan) {
        required.push('image_placement_plan_required');
    }
    if (input.context.plan && !input.context.actualBounds) {
        required.push('photoshop_actual_bounds_required');
    }
    if (input.verification?.status === 'needs_review') {
        required.push('screenshot_or_manual_review_required');
    }
    return Array.from(new Set(required));
}

function resolveStatus(input: {
    context: NormalizedPlacementContext;
    verification?: ImagePlacementVerification;
}): BusinessSkillImagePlacementVerificationStatus {
    if (!input.context.plan) return 'no_placement_plan';
    if (!input.context.actualBounds) return 'needs_actual_bounds';
    if (input.verification?.status === 'failed') return 'failed_bounds_or_screenshot';
    if (input.verification?.status === 'passed') return 'verified_by_bounds';
    return 'needs_screenshot_review';
}

function buildWarnings(input: {
    context: NormalizedPlacementContext;
    verification?: ImagePlacementVerification;
}): string[] {
    const warnings: string[] = [];
    if (!input.context.plan) {
        warnings.push('缺少图片置入计划，无法确认缩放和目标区域是否有可执行依据。');
    }
    if (input.context.plan && !input.context.actualBounds) {
        warnings.push('缺少 Photoshop 执行后 actualBounds，不能确认图片是否真的落位。');
    }
    if (input.verification) {
        warnings.push(...input.verification.warnings);
    }
    return Array.from(new Set(warnings));
}

function buildBlockers(verification?: ImagePlacementVerification): string[] {
    if (!verification) return [];
    return Array.from(new Set(verification.blockers));
}

function buildPlacementCheckSummary(input: {
    context: NormalizedPlacementContext;
    status: BusinessSkillImagePlacementVerificationStatus;
}): BusinessSkillImagePlacementCheckSummary {
    const hasPlacementPlan = Boolean(input.context.plan);
    const hasActualBounds = Boolean(input.context.actualBounds);
    const failedCount = input.status === 'failed_bounds_or_screenshot' ? 1 : 0;
    const verifiedCount = input.status === 'verified_by_bounds' ? 1 : 0;
    return {
        hasPlacementPlan,
        hasPlannedDestinationBox: Boolean(input.context.plan?.execution?.destinationBox),
        hasActualBounds,
        hasScreenshotReview: Boolean(input.context.screenshotReview?.available),
        placementCount: hasPlacementPlan ? 1 : 0,
        verifiedCount,
        failedCount
    };
}

export function buildBusinessSkillImagePlacementVerificationIntake(
    input: BusinessSkillImagePlacementVerificationIntakeInput
): BusinessSkillImagePlacementVerificationIntake {
    const resultData = input.resultData || {};
    const context = normalizePlacementContext(resultData);
    const verification = context.plan
        ? verifyImagePlacement({
            plan: context.plan,
            actualBounds: context.actualBounds,
            clippingApplied: context.clippingApplied,
            screenshotReview: context.screenshotReview
        })
        : undefined;
    const status = resolveStatus({ context, verification });

    return {
        version: 'business-skill-image-placement-verification-intake/v0',
        skillId: input.skillId,
        status,
        readOnly: true,
        userVisible: false,
        canClaimDesignQuality: false,
        mustNotChangeBusinessStrategy: true,
        placementCheck: buildPlacementCheckSummary({ context, status }),
        requiredNextChecks: buildRequiredNextChecks({ context, verification }),
        warnings: buildWarnings({ context, verification }),
        blockers: buildBlockers(verification),
        limitations: [
            '该 intake 只总结图片置入计划与执行后 bounds 检查结果，不调用 Photoshop、不调用 provider。',
            'actualBounds 通过只证明几何落位接近，不等于设计质量、主体审美或整屏排版通过。',
            '没有截图或人工复核时，不能声明裁切观感、画面重心或最终设计质量通过。',
            '本入口不得改变 main-image、detail-page、SKU 的业务策略、prompt、DSL 或 Photoshop 写入顺序。'
        ],
        verification
    };
}
