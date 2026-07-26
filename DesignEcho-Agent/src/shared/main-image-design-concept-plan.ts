import type { MainImageAssetHeroStrategy } from './main-image-asset-hero-strategy';
import type {
    MainImageDeliveryDocumentSpec,
    MainImageDeliverableImageType,
    MainImageDesignCorePlan,
    MainImageDeliveryFolderKey
} from './main-image-design-core';
import type { MainImageCopyStrategy, MainImageTextSlotPlan } from './main-image-copy-strategy';
import type { MainImageProjectStyleStrategy } from './main-image-project-style-strategy';
import type { MainImageVariantPlacementStrategy } from './main-image-variant-placement-strategy';

export type MainImageDesignConceptPlanStatus =
    | 'blocked_missing_design_core'
    | 'blocked_missing_visual_context'
    | 'blocked_missing_copy_context'
    | 'ready_design_concept_plan';

export interface MainImageVariantConcept {
    id: string;
    folderKey: MainImageDeliveryFolderKey;
    ratio: string;
    imageType: MainImageDeliverableImageType;
    objective: string;
    visualHierarchy: string[];
    layoutIntent: string;
    copySlots: Array<{
        id: string;
        role: string;
        maxLines: number;
        maxChars: number;
        priority: string;
    }>;
    factClaims: string[];
    riskFlags: string[];
    manualConfirmations: string[];
    sourceContextIds: string[];
}

export interface MainImageDesignConceptPlan {
    version: 'main-image-design-concept-plan/v0';
    skillId: 'main-image-design';
    scene: 'ecommerce-socks';
    status: MainImageDesignConceptPlanStatus;
    productType: string;
    backgroundDirection: string;
    sharedConcept: {
        subjectFocus: string;
        tone: string;
        copyPrinciple: string;
        sizingPrinciple: string;
    };
    variantConcepts: MainImageVariantConcept[];
    canClaimOutputQuality: false;
    canClaimDesignComplete: false;
    noPhotoshopWrites: true;
    mustNotExecutePhotoshop: true;
    blockers: string[];
    warnings: string[];
    limitations: string[];
}

export interface BuildMainImageDesignConceptPlanInput {
    designCorePlan?: MainImageDesignCorePlan | null;
    projectStyleStrategy?: MainImageProjectStyleStrategy | null;
    assetHeroStrategy?: MainImageAssetHeroStrategy | null;
    copyStrategy?: MainImageCopyStrategy | null;
    variantPlacementStrategy?: MainImageVariantPlacementStrategy | null;
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

function uniqueClean(values: unknown[]): string[] {
    return Array.from(new Set(values.map(cleanString).filter(Boolean)));
}

function isVisualContextReady(styleStrategy: MainImageProjectStyleStrategy | null | undefined): boolean {
    return styleStrategy?.status === 'ready_visual_context'
        && styleStrategy.projectStyleUnderstanding.semanticStatus === 'visual_context_ready';
}

function resolveStatus(input: BuildMainImageDesignConceptPlanInput): MainImageDesignConceptPlanStatus {
    if (!input.designCorePlan) return 'blocked_missing_design_core';
    if (input.designCorePlan.status !== 'ready_design_core_plan') return 'blocked_missing_visual_context';
    if (!isVisualContextReady(input.projectStyleStrategy)) return 'blocked_missing_visual_context';
    if (!input.copyStrategy || input.copyStrategy.status === 'blocked_missing_project_style_strategy' || input.copyStrategy.status === 'blocked_missing_visual_context') {
        return 'blocked_missing_copy_context';
    }
    return 'ready_design_concept_plan';
}

function buildBlockers(status: MainImageDesignConceptPlanStatus): string[] {
    if (status === 'blocked_missing_design_core') return ['main_image_design_core_required'];
    if (status === 'blocked_missing_visual_context') return ['main_image_visual_context_required_for_design_concept'];
    if (status === 'blocked_missing_copy_context') return ['main_image_copy_context_required_for_design_concept'];
    return [];
}

function buildBackgroundDirection(input: {
    styleStrategy?: MainImageProjectStyleStrategy | null;
    copyStrategy?: MainImageCopyStrategy | null;
}): string {
    const decisionDirection = cleanString(input.styleStrategy?.agentDesignDecision?.backgroundDirection);
    if (decisionDirection) return decisionDirection;
    return '待模型 Agent 基于素材视觉观察、参考方向和商品事实决定背景；代码层只约束低干扰、主体可读、安全区和可编辑性。';
}

function buildSharedConcept(input: {
    styleStrategy?: MainImageProjectStyleStrategy | null;
    assetHeroStrategy?: MainImageAssetHeroStrategy | null;
    copyStrategy?: MainImageCopyStrategy | null;
}): MainImageDesignConceptPlan['sharedConcept'] {
    const subjectSummary = cleanString(
        input.assetHeroStrategy?.heroSubjectSelection.subjectSummary
        || input.styleStrategy?.projectStyleUnderstanding.subjectSummary
    ) || '袜子主体';
    const tone = cleanString(input.styleStrategy?.designDirection.recommendedTone) || '清爽、克制、商品优先';
    return {
        subjectFocus: `主视觉围绕${subjectSummary}，优先保留主体关键部位、材质纹理、颜色和轮廓真实性。`,
        tone,
        copyPrinciple: input.copyStrategy?.contextChecklist.ready
            ? '文案围绕视觉事实、商品事实和用户场景展开，点击图短，转化图一图一个理由。'
            : '文案来源不足时只保留可编辑槽位，不写强卖点。',
        sizingPrinciple: '800/750/1200 内容同源，按比例重排；1200 只做点击图，不做转化图。'
    };
}

function slotsForImageType(
    textSlotPlan: MainImageTextSlotPlan[],
    imageType: MainImageDeliverableImageType
): MainImageVariantConcept['copySlots'] {
    const slots = textSlotPlan.filter((slot) => (
        imageType === 'click'
            ? slot.targetImageType === 'click'
            : slot.targetImageType === 'conversion'
    ));
    return slots.map((slot) => ({
        id: slot.id,
        role: slot.role,
        maxLines: slot.maxLines,
        maxChars: slot.maxChars,
        priority: slot.priority
    }));
}

function claimsForImageType(
    copyStrategy: MainImageCopyStrategy | null | undefined,
    imageType: MainImageDeliverableImageType
): string[] {
    const context = copyStrategy?.productCopyContext;
    if (!context) return [];
    const claims = imageType === 'click'
        ? [
            ...context.productFacts,
            ...context.visualAnchors.map((anchor) => `视觉锚点：${anchor}`)
        ]
        : [
            ...context.productFacts,
            ...context.userScenes.map((scene) => `使用场景：${scene}`),
            ...context.userProblems.map((problem) => `用户顾虑：${problem}`)
        ];
    return uniqueClean(claims).slice(0, 8);
}

function findPlacementReason(
    placementStrategy: MainImageVariantPlacementStrategy | null | undefined,
    folderKey: string,
    imageType: MainImageDeliverableImageType
): string | undefined {
    const plan = placementStrategy?.variantPlacementPlans.find((item) => (
        item.sizeKey === folderKey && item.variantImageType === imageType
    ));
    return cleanString(plan?.targetSlot.layoutReason || plan?.objective) || undefined;
}

function buildVisualHierarchy(input: {
    document: MainImageDeliveryDocumentSpec;
    imageType: MainImageDeliverableImageType;
    styleStrategy?: MainImageProjectStyleStrategy | null;
    copySlots: MainImageVariantConcept['copySlots'];
}): string[] {
    const hierarchy = [
        '商品主体为第一层级，主体比例和安全区优先于装饰。',
        input.imageType === 'click'
            ? '短标题为第二层级，负责第一眼识别和点击动机。'
            : '卖点说明为第二层级，负责解释一个购买理由。',
        '背景、标签和辅助说明为第三层级，只服务主体和文案可读性。'
    ];
    if (input.document.folderKey === '1200') {
        hierarchy.push('1200 长竖图保留更强纵向呼吸，不放转化图信息堆叠。');
    }
    if (input.copySlots.length === 0) {
        hierarchy.push('文案槽位缺失时只保留主体与背景层级，不临场写入文案。');
    }
    return hierarchy;
}

function buildRiskFlags(input: {
    document: MainImageDeliveryDocumentSpec;
    imageType: MainImageDeliverableImageType;
    factClaims: string[];
    copySlots: MainImageVariantConcept['copySlots'];
}): string[] {
    const risks: string[] = [];
    if (input.document.excludedImageTypes.includes(input.imageType)) {
        risks.push(`${input.document.folderKey}-${input.imageType}-forbidden`);
    }
    if (input.document.folderKey === '1200' && input.imageType === 'click') {
        risks.push('1200-no-conversion-export');
    }
    if (input.factClaims.length === 0) risks.push('missing-product-fact-claims');
    if (input.copySlots.length === 0) risks.push('missing-copy-slots');
    return risks;
}

function buildManualConfirmations(input: {
    copyStrategy?: MainImageCopyStrategy | null;
    imageType: MainImageDeliverableImageType;
    folderKey: string;
}): string[] {
    const confirmations: string[] = [];
    if (!input.copyStrategy || input.copyStrategy.status !== 'ready_copy_strategy') {
        confirmations.push('确认可写入文案或允许只保留文案槽位。');
    }
    if ((input.copyStrategy?.productCopyContext.referenceNotes.length || 0) === 0) {
        confirmations.push('尚未记录外部参考来源，设计参考只能按本地规则和项目图片执行。');
    }
    if (input.folderKey === '1200') {
        confirmations.push('确认 1200 文件夹只输出点击图，不输出转化图。');
    }
    if (input.imageType === 'conversion') {
        confirmations.push('确认转化图卖点有商品事实或用户事实支撑。');
    }
    return confirmations;
}

function buildVariantConcepts(
    input: BuildMainImageDesignConceptPlanInput,
    status: MainImageDesignConceptPlanStatus
): MainImageVariantConcept[] {
    if (status !== 'ready_design_concept_plan') return [];
    const documents = input.designCorePlan?.deliveryDocuments || [];
    return documents.flatMap((document) => (
        document.includedImageTypes.map((imageType) => {
            const copySlots = slotsForImageType(input.copyStrategy?.textSlotPlan || [], imageType);
            const factClaims = claimsForImageType(input.copyStrategy, imageType);
            const layoutReason = findPlacementReason(input.variantPlacementStrategy, document.folderKey, imageType);
            return {
                id: `${document.folderKey}-${imageType}`,
                folderKey: document.folderKey,
                ratio: document.ratio,
                imageType,
                objective: imageType === 'click'
                    ? `${document.label}点击图：使用模型 Agent 决策的视觉 hook 建立第一眼识别。`
                    : `${document.label}转化图：使用模型 Agent 决策的商品事实解释一个购买理由。`,
                visualHierarchy: buildVisualHierarchy({
                    document,
                    imageType,
                    styleStrategy: input.projectStyleStrategy,
                    copySlots
                }),
                layoutIntent: layoutReason || document.contentPolicy,
                copySlots,
                factClaims,
                riskFlags: buildRiskFlags({ document, imageType, factClaims, copySlots }),
                manualConfirmations: buildManualConfirmations({
                    copyStrategy: input.copyStrategy,
                    imageType,
                    folderKey: document.folderKey
                }),
                sourceContextIds: uniqueClean([
                    input.designCorePlan?.version,
                    input.projectStyleStrategy?.version,
                    input.assetHeroStrategy?.version,
                    input.copyStrategy?.version,
                    input.variantPlacementStrategy?.version
                ])
            };
        })
    ));
}

function buildWarnings(input: {
    status: MainImageDesignConceptPlanStatus;
    copyStrategy?: MainImageCopyStrategy | null;
    placementStrategy?: MainImageVariantPlacementStrategy | null;
}): string[] {
    const warnings: string[] = [];
    if (input.status !== 'ready_design_concept_plan') {
        warnings.push('缺少可用视觉上下文、设计核心或文案上下文时，不生成主图设计概念。');
    }
    if (input.copyStrategy?.status === 'needs_copy_candidates') {
        warnings.push('主图概念可保留文案槽位，但还缺少可写入候选文案。');
    }
    if (input.placementStrategy && input.placementStrategy.status !== 'ready_variant_placement_plan') {
        warnings.push('变体落位策略未就绪，概念计划不能被当作最终执行布局。');
    }
    return warnings;
}

export function buildMainImageDesignConceptPlan(
    input: BuildMainImageDesignConceptPlanInput
): MainImageDesignConceptPlan {
    const status = resolveStatus(input);
    const productType = cleanString(
        input.projectStyleStrategy?.projectStyleUnderstanding.productType
        || input.designCorePlan?.productUnderstanding.productType
    ) || 'unknown';
    const variantConcepts = buildVariantConcepts(input, status);
    const blockers = buildBlockers(status);
    const warnings = buildWarnings({
        status,
        copyStrategy: input.copyStrategy,
        placementStrategy: input.variantPlacementStrategy
    });

    return {
        version: 'main-image-design-concept-plan/v0',
        skillId: 'main-image-design',
        scene: 'ecommerce-socks',
        status,
        productType,
        backgroundDirection: buildBackgroundDirection({
            styleStrategy: input.projectStyleStrategy,
            copyStrategy: input.copyStrategy
        }),
        sharedConcept: buildSharedConcept({
            styleStrategy: input.projectStyleStrategy,
            assetHeroStrategy: input.assetHeroStrategy,
            copyStrategy: input.copyStrategy
        }),
        variantConcepts,
        canClaimOutputQuality: false,
        canClaimDesignComplete: false,
        noPhotoshopWrites: true,
        mustNotExecutePhotoshop: true,
        blockers,
        warnings,
        limitations: [
            '主图设计概念计划只定义视觉层级、背景方向、文案槽和事实边界，不创建图层。',
            '概念计划必须由生产执行计划、Photoshop 读回、截图或人工复核继续验收。',
            '缺少与所选素材绑定的可用视觉上下文时不允许生成点击图/转化图创意方案。',
            '背景方向、视觉 hook 和文案角度必须来自模型 Agent 决策或人工标注；代码不能根据关键词自行判定。'
        ]
    };
}
