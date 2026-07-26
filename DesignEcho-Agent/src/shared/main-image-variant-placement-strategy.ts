import {
    buildImagePlacementPlan,
    type ImagePlacementBox,
    type ImagePlacementPlan
} from './design-image-placement-core';
import type { MainImageSizePlan } from './design-agent-os-contracts';
import type {
    MainImageDraftAsset,
    MainImageDraftSubjectBounds
} from './main-image-agent-draft-plan';
import type {
    MainImageProjectStyleStrategy,
    MainImageVariantDirection,
    MainImageVariantType
} from './main-image-project-style-strategy';

export type MainImageVariantPlacementStrategyStatus =
    | 'blocked_missing_project_style_strategy'
    | 'blocked_missing_visual_context'
    | 'blocked_missing_selected_asset'
    | 'blocked_missing_source_dimensions'
    | 'blocked_missing_subject_bounds'
    | 'blocked_missing_size_plans'
    | 'ready_variant_placement_plan';

export interface MainImageVariantPlacementStrategyInput {
    userText?: string;
    projectStyleStrategy?: MainImageProjectStyleStrategy | null;
    selectedAsset?: MainImageDraftAsset | null;
    subjectBounds?: MainImageDraftSubjectBounds | null;
    sizePlans?: MainImageSizePlan[];
}

export interface MainImageVariantPlacementPlan {
    id: string;
    variantId: string;
    variantImageType: MainImageVariantType;
    sizeKey: string;
    objective: string;
    targetSlot: {
        box: ImagePlacementBox;
        safeBox: ImagePlacementBox;
        slotRole: 'click-hero' | 'conversion-hero';
        layoutReason: string;
    };
    placementPlan: ImagePlacementPlan;
}

export interface MainImageVariantPlacementStrategy {
    version: 'main-image-variant-placement-strategy/v0';
    skillId: 'main-image-design';
    scene: 'ecommerce-socks';
    status: MainImageVariantPlacementStrategyStatus;
    selectedAsset?: {
        name?: string;
        path?: string;
        width?: number;
        height?: number;
    };
    projectStyle: {
        status: string;
        productType: string;
        styleKeywords: string[];
        clickVariantCount: number;
        conversionVariantCount: number;
    };
    variantPlacementPlans: MainImageVariantPlacementPlan[];
    verificationPolicy: {
        requiredReadback: Array<'actualBounds' | 'clippingState' | 'screenshot'>;
        qualityClaimBoundary: string;
    };
    canClaimOutputQuality: false;
    canClaimDesignComplete: false;
    noPhotoshopWrites: true;
    mustNotExecutePhotoshop: true;
    blockers: string[];
    warnings: string[];
    limitations: string[];
}

interface NormalizedAsset {
    name?: string;
    path?: string;
    width: number;
    height: number;
}

interface NormalizedSubjectBounds {
    left: number;
    top: number;
    right: number;
    bottom: number;
    width: number;
    height: number;
}

interface NormalizedSizePlan {
    sizeKey: string;
    targetSize: { width: number; height: number };
    subjectSize: { width: number; height: number };
    targetX: number;
    targetY: number;
    decisionReason: string;
}

const FORBIDDEN_PAYLOAD_PATTERNS = [
    /raw-image-payload/gi,
    /base64-image-payload/gi,
    /data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+/gi,
    /data:image\//gi
];

function cleanString(value: unknown): string {
    let text = String(value || '').trim();
    for (const pattern of FORBIDDEN_PAYLOAD_PATTERNS) {
        text = text.replace(pattern, '[redacted-image-payload]');
    }
    return text.replace(/\s+/g, ' ').trim();
}

function toPositiveNumber(value: unknown): number | undefined {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric > 0 ? numeric : undefined;
}

function normalizeAsset(asset: MainImageDraftAsset | null | undefined): NormalizedAsset | undefined {
    if (!asset) return undefined;
    const width = toPositiveNumber(asset.width);
    const height = toPositiveNumber(asset.height);
    if (!width || !height) return undefined;
    return {
        name: cleanString(asset.name) || undefined,
        path: cleanString(asset.path) || undefined,
        width: Math.round(width),
        height: Math.round(height)
    };
}

function normalizeSubjectBounds(
    bounds: MainImageDraftSubjectBounds | null | undefined
): NormalizedSubjectBounds | undefined {
    if (!bounds) return undefined;
    const left = Number(bounds.left ?? 0);
    const top = Number(bounds.top ?? 0);
    const right = Number(bounds.right ?? (left + Number(bounds.width || 0)));
    const bottom = Number(bounds.bottom ?? (top + Number(bounds.height || 0)));
    const width = Number(bounds.width ?? (right - left));
    const height = Number(bounds.height ?? (bottom - top));
    if (![left, top, right, bottom, width, height].every(Number.isFinite)) return undefined;
    if (width <= 0 || height <= 0) return undefined;
    return {
        left: Math.round(left),
        top: Math.round(top),
        right: Math.round(right),
        bottom: Math.round(bottom),
        width: Math.round(width),
        height: Math.round(height)
    };
}

function normalizeSizePlans(sizePlans: MainImageSizePlan[] | undefined): NormalizedSizePlan[] {
    return (sizePlans || [])
        .map((plan) => {
            const targetWidth = toPositiveNumber(plan.targetSize?.width);
            const targetHeight = toPositiveNumber(plan.targetSize?.height);
            if (!targetWidth || !targetHeight) return null;
            const subjectWidth = toPositiveNumber(plan.subjectSize?.width) || targetWidth * 0.78;
            const subjectHeight = toPositiveNumber(plan.subjectSize?.height) || targetHeight * 0.56;
            return {
                sizeKey: cleanString(plan.sizeKey) || `${Math.round(targetWidth)}x${Math.round(targetHeight)}`,
                targetSize: {
                    width: Math.round(targetWidth),
                    height: Math.round(targetHeight)
                },
                subjectSize: {
                    width: Math.round(subjectWidth),
                    height: Math.round(subjectHeight)
                },
                targetX: Math.round(Number(plan.targetX || 0)),
                targetY: Math.round(Number(plan.targetY || 0)),
                decisionReason: cleanString(plan.decisionReason) || 'main image size plan'
            };
        })
        .filter((plan): plan is NormalizedSizePlan => Boolean(plan));
}

function getStyleVariants(
    styleStrategy: MainImageProjectStyleStrategy | null | undefined
): MainImageVariantDirection[] {
    if (!styleStrategy) return [];
    return [
        ...styleStrategy.variantPlan.clickImages,
        ...styleStrategy.variantPlan.conversionImages
    ];
}

function buildSafeBox(targetSize: { width: number; height: number }): ImagePlacementBox {
    const marginX = Math.round(targetSize.width * 0.06);
    const marginY = Math.round(targetSize.height * 0.06);
    return {
        x: marginX,
        y: marginY,
        width: Math.max(1, targetSize.width - marginX * 2),
        height: Math.max(1, targetSize.height - marginY * 2)
    };
}

function clampBoxToSafeArea(box: ImagePlacementBox, safeBox: ImagePlacementBox): ImagePlacementBox {
    const width = Math.max(1, Math.min(box.width, safeBox.width));
    const height = Math.max(1, Math.min(box.height, safeBox.height));
    const maxX = safeBox.x + safeBox.width - width;
    const maxY = safeBox.y + safeBox.height - height;
    return {
        x: Math.max(safeBox.x, Math.min(box.x, maxX)),
        y: Math.max(safeBox.y, Math.min(box.y, maxY)),
        width,
        height
    };
}

function buildTargetSlot(
    variant: MainImageVariantDirection,
    sizePlan: NormalizedSizePlan
): MainImageVariantPlacementPlan['targetSlot'] {
    const safeBox = buildSafeBox(sizePlan.targetSize);
    const conversionReserveY = Math.round(sizePlan.targetSize.height * 0.22);
    const conversionY = Math.max(sizePlan.targetY, safeBox.y + conversionReserveY);
    const rawBox: ImagePlacementBox = {
        x: variant.imageType === 'click'
            ? sizePlan.targetX
            : Math.max(sizePlan.targetX, safeBox.x),
        y: variant.imageType === 'click'
            ? sizePlan.targetY
            : conversionY,
        width: variant.imageType === 'click'
            ? Math.round(sizePlan.subjectSize.width * 1.04)
            : Math.round(sizePlan.subjectSize.width * 0.94),
        height: variant.imageType === 'click'
            ? Math.round(sizePlan.subjectSize.height * 1.04)
            : Math.round(sizePlan.subjectSize.height * 0.94)
    };
    const box = clampBoxToSafeArea(rawBox, safeBox);
    return {
        box,
        safeBox,
        slotRole: variant.imageType === 'click' ? 'click-hero' : 'conversion-hero',
        layoutReason: variant.imageType === 'click'
            ? `点击图优先提高主体识别度：${sizePlan.decisionReason}`
            : `转化图保留文案和卖点空间：${sizePlan.decisionReason}`
    };
}

function buildPlacementPlan(input: {
    asset: NormalizedAsset;
    subjectBounds: NormalizedSubjectBounds;
    variant: MainImageVariantDirection;
    sizePlan: NormalizedSizePlan;
}): MainImageVariantPlacementPlan {
    const targetSlot = buildTargetSlot(input.variant, input.sizePlan);
    const placementPlan = buildImagePlacementPlan({
        source: {
            width: input.asset.width,
            height: input.asset.height,
            path: input.asset.path,
            assetId: input.asset.name,
            role: 'product',
            subjectBox: {
                x: input.subjectBounds.left,
                y: input.subjectBounds.top,
                width: input.subjectBounds.width,
                height: input.subjectBounds.height
            }
        },
        target: {
            box: targetSlot.box,
            safeBox: targetSlot.safeBox,
            slotId: `${input.variant.id}-${input.sizePlan.sizeKey}`,
            slotRole: targetSlot.slotRole
        },
        canvas: input.sizePlan.targetSize,
        designType: 'main-image',
        assetRole: 'product',
        intent: input.variant.imageType === 'click' ? 'hero' : 'fit-slot',
        cropPolicy: 'protect-subject',
        requireSubjectBounds: true,
        executionTool: 'transformLayer'
    });

    return {
        id: `${input.variant.id}-${input.sizePlan.sizeKey}`,
        variantId: input.variant.id,
        variantImageType: input.variant.imageType,
        sizeKey: input.sizePlan.sizeKey,
        objective: input.variant.objective,
        targetSlot,
        placementPlan
    };
}

function resolveStatus(input: {
    styleStrategy?: MainImageProjectStyleStrategy | null;
    asset?: NormalizedAsset;
    selectedAssetProvided: boolean;
    subjectBounds?: NormalizedSubjectBounds;
    sizePlans: NormalizedSizePlan[];
}): MainImageVariantPlacementStrategyStatus {
    if (!input.styleStrategy) return 'blocked_missing_project_style_strategy';
    if (input.styleStrategy.status !== 'ready_visual_context') return 'blocked_missing_visual_context';
    if (!input.selectedAssetProvided) return 'blocked_missing_selected_asset';
    if (!input.asset) return 'blocked_missing_source_dimensions';
    if (!input.subjectBounds) return 'blocked_missing_subject_bounds';
    if (input.sizePlans.length === 0) return 'blocked_missing_size_plans';
    return 'ready_variant_placement_plan';
}

function buildBlockers(status: MainImageVariantPlacementStrategyStatus): string[] {
    switch (status) {
        case 'blocked_missing_project_style_strategy':
            return ['main_image_project_style_strategy_missing'];
        case 'blocked_missing_visual_context':
            return ['main_image_visual_context_required'];
        case 'blocked_missing_selected_asset':
            return ['main_image_selected_asset_missing'];
        case 'blocked_missing_source_dimensions':
            return ['main_image_source_dimensions_missing'];
        case 'blocked_missing_subject_bounds':
            return ['main_image_subject_bounds_missing'];
        case 'blocked_missing_size_plans':
            return ['main_image_size_plans_missing'];
        case 'ready_variant_placement_plan':
        default:
            return [];
    }
}

function buildWarnings(input: {
    status: MainImageVariantPlacementStrategyStatus;
    plans: MainImageVariantPlacementPlan[];
    subjectBounds?: NormalizedSubjectBounds;
    asset?: NormalizedAsset;
}): string[] {
    const warnings: string[] = [];
    if (input.status === 'ready_variant_placement_plan') {
        warnings.push('当前只是主图变体置入/缩放计划，执行后必须读取 Photoshop actualBounds 和截图验收。');
    }
    if (input.subjectBounds && input.asset) {
        const outsideSource = input.subjectBounds.right > input.asset.width || input.subjectBounds.bottom > input.asset.height;
        if (outsideSource) {
            warnings.push('主体 bounds 超出源图尺寸，可能是 Photoshop 画布坐标而非源图坐标，执行前需要重新映射。');
        }
    }
    for (const plan of input.plans) {
        for (const warning of plan.placementPlan.warnings) {
            warnings.push(warning);
        }
    }
    return Array.from(new Set(warnings.map(cleanString).filter(Boolean)));
}

function buildVerificationPolicy(plans: MainImageVariantPlacementPlan[]): MainImageVariantPlacementStrategy['verificationPolicy'] {
    const readback = new Set<'actualBounds' | 'clippingState' | 'screenshot'>(['actualBounds', 'clippingState', 'screenshot']);
    for (const plan of plans) {
        for (const item of plan.placementPlan.execution.requiredReadback) {
            readback.add(item);
        }
    }
    return {
        requiredReadback: Array.from(readback),
        qualityClaimBoundary: '只有完成 transform 后读回 actualBounds、检查 clipping，并对导出图或截图做 QA，才能声明主图置入质量。'
    };
}

export function buildMainImageVariantPlacementStrategy(
    input: MainImageVariantPlacementStrategyInput
): MainImageVariantPlacementStrategy {
    const asset = normalizeAsset(input.selectedAsset);
    const subjectBounds = normalizeSubjectBounds(input.subjectBounds);
    const sizePlans = normalizeSizePlans(input.sizePlans);
    const status = resolveStatus({
        styleStrategy: input.projectStyleStrategy,
        asset,
        selectedAssetProvided: Boolean(input.selectedAsset),
        subjectBounds,
        sizePlans
    });
    const variants = getStyleVariants(input.projectStyleStrategy);
    const variantPlacementPlans = status === 'ready_variant_placement_plan' && asset && subjectBounds
        ? variants.flatMap((variant) => (
            sizePlans.map((sizePlan) => buildPlacementPlan({ asset, subjectBounds, variant, sizePlan }))
        ))
        : [];
    const projectStyle = input.projectStyleStrategy;
    const warnings = buildWarnings({
        status,
        plans: variantPlacementPlans,
        subjectBounds,
        asset
    });

    return {
        version: 'main-image-variant-placement-strategy/v0',
        skillId: 'main-image-design',
        scene: 'ecommerce-socks',
        status,
        selectedAsset: asset ? {
            name: asset.name,
            path: asset.path,
            width: asset.width,
            height: asset.height
        } : undefined,
        projectStyle: {
            status: projectStyle?.status || 'missing',
            productType: projectStyle?.projectStyleUnderstanding.productType || 'unknown',
            styleKeywords: projectStyle?.designDirection.styleKeywords || [],
            clickVariantCount: projectStyle?.variantPlan.clickImages.length || 0,
            conversionVariantCount: projectStyle?.variantPlan.conversionImages.length || 0
        },
        variantPlacementPlans,
        verificationPolicy: buildVerificationPolicy(variantPlacementPlans),
        canClaimOutputQuality: false,
        canClaimDesignComplete: false,
        noPhotoshopWrites: true,
        mustNotExecutePhotoshop: true,
        blockers: buildBlockers(status),
        warnings,
        limitations: [
            '主图变体置入策略只输出几何计划，不调用模型、不搜索网页、不读图片像素、不执行 Photoshop。',
            '款式判断必须来自 projectStyleStrategy 中与所选素材绑定的视觉上下文，不能从文件名猜测。',
            'destinationBox 和 subjectDestinationBox 是计划值，不是 Photoshop actualBounds。',
            '点击图/转化图只是同一素材下的设计方向与置入策略，最终质量仍依赖执行后验收。'
        ]
    };
}
