import type { MainImageSizePlan } from './design-agent-os-contracts';
import {
    buildMainImageAssetHeroStrategy,
    type MainImageAssetHeroStrategy
} from './main-image-asset-hero-strategy';
import {
    buildMainImageProjectStyleStrategy,
    type MainImageAgentDesignDecision,
    type MainImageReferenceHint,
    type MainImageProjectStyleStrategy
} from './main-image-project-style-strategy';
import {
    buildMainImageDesignCorePlan,
    type MainImageDesignCorePlan
} from './main-image-design-core';
import {
    buildMainImageCopyStrategy,
    type MainImageCopyStrategy
} from './main-image-copy-strategy';
import {
    buildMainImageDesignConceptPlan,
    type MainImageDesignConceptPlan
} from './main-image-design-concept-plan';
import {
    buildMainImageDesignStandards,
    type MainImageDesignStandards
} from './main-image-design-standards';
import {
    buildMainImagePlatformSizeProfile,
    buildMainImageProductionDocumentStructure,
    type MainImagePlatformSizeProfile,
    type MainImageProductionDocumentStructure
} from './main-image-production-document-structure';
import {
    buildMainImageProductionExecutionPlan,
    type MainImageProductionExecutionPlan
} from './main-image-production-execution-plan';
import {
    buildMainImageProductionExecutorHandoff,
    type MainImageProductionExecutorHandoff
} from './main-image-production-executor-handoff';
import {
    buildMainImageProductionExecutorDispatchPlan,
    type MainImageProductionExecutorDispatchPlan
} from './main-image-production-executor-bridge';
import {
    buildMainImageProductionExecutorDryRunPreview,
    type MainImageProductionExecutorDryRunPreview
} from './main-image-production-executor-dry-run';
import {
    buildMainImageDesignReadinessReport,
    type MainImageDesignReadinessReport
} from './main-image-design-readiness-report';
import {
    buildMainImageLiveExecutorRequestPackage,
    type MainImageLiveExecutorRequestPackage
} from './main-image-live-executor-request';
import {
    buildMainImageVariantPlacementStrategy,
    type MainImageVariantPlacementStrategy
} from './main-image-variant-placement-strategy';
import type {
    MainImageDraftAsset,
    MainImageDraftDocument,
    MainImageDraftSubjectBounds
} from './main-image-agent-draft-plan';
import type { MainImageStrategyInputKey } from './main-image-strategy-contract';
import type { MainImageVisionSignal } from './main-image-visual-loop';
import type { DesignKnowledgeResult } from './design-knowledge-search';
import type { DesignPlacementIntelligencePlan } from './design-placement-intelligence';
import {
    buildMainImageMemoryContext,
    type MainImageMemoryContext
} from './main-image-memory-context';

export type MainImageStrategyInputBuilderStatus =
    | 'blocked_missing_strategy_inputs'
    | 'ready_for_strategy_contract';

export interface MainImageStrategyInputBuilderInput {
    userText?: string;
    imageType?: string;
    currentDocument?: MainImageDraftDocument | null;
    projectAssets?: MainImageDraftAsset[];
    selectedAsset?: MainImageDraftAsset | null;
    subjectBounds?: MainImageDraftSubjectBounds | null;
    sizePlans?: MainImageSizePlan[];
    copyCandidates?: string[];
    outputDir?: string;
    toolNames?: string[];
    visionSignal?: MainImageVisionSignal | null;
    agentDesignDecision?: MainImageAgentDesignDecision | null;
    referenceHints?: MainImageReferenceHint[];
    knowledgeResults?: DesignKnowledgeResult[];
    mainImageMemoryContext?: MainImageMemoryContext | null;
    designPlacementIntelligencePlan?: DesignPlacementIntelligencePlan | null;
    mainImagePlatformProfile?: MainImagePlatformSizeProfile | null;
    allowPendingRatioExecution?: boolean;
    userCheckpointApproved?: boolean;
}

export interface MainImageStrategyInputBundle {
    version: 'main-image-strategy-input-builder/v0';
    skillId: 'main-image-design';
    scene: 'ecommerce-socks';
    status: MainImageStrategyInputBuilderStatus;
    strategyInputs: Partial<Record<MainImageStrategyInputKey, unknown>>;
    providedInputs: MainImageStrategyInputKey[];
    missingInputs: MainImageStrategyInputKey[];
    canClaimOutputQuality: false;
    canClaimDesignComplete: false;
    noPhotoshopWrites: true;
    mustNotExecutePhotoshop: true;
    assetHeroStrategy: MainImageAssetHeroStrategy;
    projectStyleStrategy: MainImageProjectStyleStrategy;
    designCorePlan: MainImageDesignCorePlan;
    copyStrategy: MainImageCopyStrategy;
    designConceptPlan: MainImageDesignConceptPlan;
    mainImageMemoryContext: MainImageMemoryContext;
    designPlacementIntelligencePlan: DesignPlacementIntelligencePlan | null;
    designStandards: MainImageDesignStandards;
    variantPlacementStrategy: MainImageVariantPlacementStrategy;
    productionDocumentStructure: MainImageProductionDocumentStructure;
    productionExecutionPlan: MainImageProductionExecutionPlan;
    productionExecutorHandoff: MainImageProductionExecutorHandoff;
    productionExecutorDispatchPlan: MainImageProductionExecutorDispatchPlan;
    productionExecutorDryRunPreview: MainImageProductionExecutorDryRunPreview;
    designReadinessReport: MainImageDesignReadinessReport;
    liveExecutorRequestPackage: MainImageLiveExecutorRequestPackage;
    blockers: string[];
    warnings: string[];
    limitations: string[];
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
    scale: number;
    targetX: number;
    targetY: number;
    smartLayoutPlanned: boolean;
    quickExportPlanned: boolean;
    decisionReason: string;
}

const REQUIRED_INPUTS: MainImageStrategyInputKey[] = [
    'heroSubjectPolicy',
    'assetSelectionPolicy',
    'imagePlacementPolicy',
    'smartScalingPolicy',
    'copyRolePolicy',
    'exportAcceptancePolicy',
    'performanceBudget'
];

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

function cleanStrings(values: unknown): string[] {
    if (!Array.isArray(values)) return [];
    return values.map(cleanString).filter(Boolean);
}

function normalizeReferenceHint(input: MainImageReferenceHint | undefined): MainImageReferenceHint | undefined {
    if (!input) return undefined;
    const title = cleanString(input.title);
    const source = cleanString(input.source);
    const url = cleanString(input.url);
    const note = cleanString(input.note);
    if (!title && !source && !url && !note) return undefined;
    return {
        title: title || undefined,
        source: source || undefined,
        url: url || undefined,
        note: note || undefined
    };
}

function canUseKnowledgeAsReference(result: DesignKnowledgeResult): boolean {
    const allowedUses = Array.isArray(result.allowedUses) ? result.allowedUses : [];
    return result.sourceType !== 'local_case'
        && (allowedUses.includes('prompt_context') || allowedUses.includes('user_reference'));
}

function mapKnowledgeResultToReferenceHint(result: DesignKnowledgeResult): MainImageReferenceHint | undefined {
    if (!result || !canUseKnowledgeAsReference(result)) return undefined;
    const title = cleanString(result.title);
    const sourceType = cleanString(result.sourceType);
    const sourceLevel = cleanString(result.sourceLevel);
    const sourceUrl = cleanString(result.sourceUrl);
    const summary = cleanString(result.summary);
    const sourceNotes = cleanStrings(result.sourceNotes).slice(0, 2).join(' / ');
    return normalizeReferenceHint({
        title: title || result.id,
        source: [sourceType, sourceLevel].filter(Boolean).join(':'),
        url: sourceUrl || undefined,
        note: [summary, sourceNotes].filter(Boolean).join('；')
    });
}

function buildReferenceHints(input: MainImageStrategyInputBuilderInput): MainImageReferenceHint[] {
    const hints = [
        ...(Array.isArray(input.referenceHints) ? input.referenceHints : []).map(normalizeReferenceHint),
        ...(Array.isArray(input.knowledgeResults) ? input.knowledgeResults : []).map(mapKnowledgeResultToReferenceHint)
    ].filter((hint): hint is MainImageReferenceHint => Boolean(hint));
    const seen = new Set<string>();
    const deduped: MainImageReferenceHint[] = [];
    for (const hint of hints) {
        const key = [
            cleanString(hint.url),
            cleanString(hint.title),
            cleanString(hint.source)
        ].filter(Boolean).join('|');
        if (key && seen.has(key)) continue;
        if (key) seen.add(key);
        deduped.push(hint);
        if (deduped.length >= 8) break;
    }
    return deduped;
}

function toPositiveNumber(value: unknown): number | undefined {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric > 0 ? numeric : undefined;
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
            const width = toPositiveNumber(plan.targetSize?.width);
            const height = toPositiveNumber(plan.targetSize?.height);
            const scale = toPositiveNumber(plan.scale);
            if (!width || !height || !scale) return null;
            return {
                sizeKey: cleanString(plan.sizeKey) || `${Math.round(width)}x${Math.round(height)}`,
                targetSize: {
                    width: Math.round(width),
                    height: Math.round(height)
                },
                scale,
                targetX: Math.round(Number(plan.targetX || 0)),
                targetY: Math.round(Number(plan.targetY || 0)),
                smartLayoutPlanned: plan.smartLayoutPlanned === true,
                quickExportPlanned: plan.quickExportPlanned === true,
                decisionReason: cleanString(plan.decisionReason) || 'size plan context'
            };
        })
        .filter((plan): plan is NormalizedSizePlan => Boolean(plan));
}

function resolveProductionStructureSizeScope(sizePlans: NormalizedSizePlan[]): string[] | undefined {
    const keys = Array.from(new Set(sizePlans.map((plan) => cleanString(plan.sizeKey)).filter(Boolean)));
    return keys.length > 0 ? keys : undefined;
}

function resolveProductionStructureImageTypeScope(input: {
    userText: string;
    imageType: string;
    sizePlans: NormalizedSizePlan[];
}): 'click' | 'conversion' | undefined {
    const text = input.userText;
    const hasConversionTarget = /(转化图|卖点图|利益点图)/i.test(text);
    const hasClickTarget = /(点击图|首图|商品首图|淘宝商品首图)/i.test(text);
    const asksSingleMainImage = /(一张|单张|1张).{0,12}(主图|首图)|(?:800x800|800×800|800\*800).{0,18}(主图|首图)|(?:主图|首图).{0,18}(?:800x800|800×800|800\*800)/i.test(text);
    if (hasConversionTarget && !hasClickTarget) return 'conversion';
    if ((hasClickTarget || asksSingleMainImage) && !hasConversionTarget) return 'click';
    const normalizedImageType = cleanString(input.imageType).toLowerCase();
    if (hasConversionTarget && !hasClickTarget && normalizedImageType === 'conversion') return 'conversion';
    if (hasClickTarget && !hasConversionTarget && normalizedImageType === 'click') return 'click';
    if (input.sizePlans.length === 1 && normalizedImageType === 'click' && asksSingleMainImage && !hasConversionTarget) {
        return 'click';
    }
    return undefined;
}

function buildPlacementPolicy(
    subjectBounds: NormalizedSubjectBounds | undefined,
    sizePlans: NormalizedSizePlan[],
    imageType: string,
    variantPlacementStrategy: MainImageVariantPlacementStrategy,
    designConceptPlan: MainImageDesignConceptPlan,
    designPlacementIntelligencePlan: DesignPlacementIntelligencePlan | null
): Record<string, unknown> | undefined {
    if (!subjectBounds || sizePlans.length === 0) return undefined;
    return {
        imageType: imageType || 'unknown',
        subjectBounds,
        targetSizes: sizePlans.map((plan) => plan.targetSize),
        placementMode: 'derive-from-subject-bounds-and-size-plan',
        variantPlacementStrategyStatus: variantPlacementStrategy.status,
        variantPlacementPlanCount: variantPlacementStrategy.variantPlacementPlans.length,
        designConceptStatus: designConceptPlan.status,
        designConceptVariantCount: designConceptPlan.variantConcepts.length,
        ...(designPlacementIntelligencePlan ? {
            designPlacementIntelligence: {
                status: designPlacementIntelligencePlan.status,
                candidateCount: designPlacementIntelligencePlan.summary.candidateCount,
                selectedCandidateId: designPlacementIntelligencePlan.selectedCandidateId || null,
                reviewRequirements: designPlacementIntelligencePlan.reviewRequirements.map((item) => item.type),
                boundary: 'DPI ranks placement candidates only; it does not execute Photoshop or claim design quality.'
            }
        } : {}),
        safeAreaRequired: true,
        boundary: 'placement policy is a plan input, not a Photoshop transform result'
    };
}

function buildSmartScalingPolicy(
    subjectBounds: NormalizedSubjectBounds | undefined,
    sizePlans: NormalizedSizePlan[],
    variantPlacementStrategy: MainImageVariantPlacementStrategy
): Record<string, unknown> | undefined {
    if (!subjectBounds || sizePlans.length === 0) return undefined;
    return {
        subjectBounds,
        plans: sizePlans.map((plan) => ({
            sizeKey: plan.sizeKey,
            targetSize: plan.targetSize,
            scale: plan.scale,
            targetX: plan.targetX,
            targetY: plan.targetY,
            smartLayoutPlanned: plan.smartLayoutPlanned,
            decisionReason: plan.decisionReason
        })),
        variantPlacementStrategyStatus: variantPlacementStrategy.status,
        variantPlacementPlanCount: variantPlacementStrategy.variantPlacementPlans.length,
        variantPlacementVerificationPolicy: variantPlacementStrategy.verificationPolicy,
        cropRiskPolicy: 'must verify post-transform bounds and screenshot before claiming quality',
        boundary: 'smart scaling policy does not execute transformLayer'
    };
}

function buildCopyRolePolicy(input: {
    copyCandidates: string[];
    userText: string;
    projectStyleStrategy: MainImageProjectStyleStrategy;
    designCorePlan: MainImageDesignCorePlan;
    copyStrategy: MainImageCopyStrategy;
    designConceptPlan: MainImageDesignConceptPlan;
    mainImageMemoryContext: MainImageMemoryContext;
    designStandards: MainImageDesignStandards;
}): Record<string, unknown> | undefined {
    const styleContext = {
        projectStyleStrategyStatus: input.projectStyleStrategy.status,
        designCoreStatus: input.designCorePlan.status,
        deliveryDocuments: input.designCorePlan.deliveryDocuments.map((document) => ({
            folderKey: document.folderKey,
            ratio: document.ratio,
            sourceDocumentPath: document.sourceDocumentPath,
            exportFolder: document.exportFolder,
            includedImageTypes: document.includedImageTypes.slice(),
            excludedImageTypes: document.excludedImageTypes.slice()
        })),
        designStandardsStatus: input.designStandards.status,
        designStandardsCanGuideDesignPlan: input.designStandards.canGuideDesignPlan,
        productType: input.projectStyleStrategy.projectStyleUnderstanding.productType,
        styleKeywords: input.projectStyleStrategy.designDirection.styleKeywords,
        plannedClickImageCount: input.projectStyleStrategy.variantPlan.clickImages.length,
        plannedConversionImageCount: input.projectStyleStrategy.variantPlan.conversionImages.length
    };
    const copyStrategyPatch = input.copyStrategy.strategyInputPatch.copyRolePolicy || {};
    const conceptPatch = {
        designConceptStatus: input.designConceptPlan.status,
        designConceptVariantCount: input.designConceptPlan.variantConcepts.length,
        designConceptBackgroundDirection: input.designConceptPlan.backgroundDirection
    };
    const memoryPatch = input.mainImageMemoryContext.strategyInputPatch.copyRolePolicy || {};
    if (input.copyCandidates.length > 0) {
        return {
            mode: 'fit-provided-copy-candidates',
            candidateCount: input.copyCandidates.length,
            candidates: input.copyCandidates.slice(0, 5),
            ...copyStrategyPatch,
            ...conceptPatch,
            ...memoryPatch,
            ...styleContext,
            boundary: 'copy candidates must be fitted to editable text slots'
        };
    }
    if (!input.userText) return undefined;
    return {
        mode: 'reserve-editable-copy-slots-without-inventing-selling-points',
        candidateCount: 0,
        ...copyStrategyPatch,
        ...conceptPatch,
        ...memoryPatch,
        ...styleContext,
        boundary: 'missing product facts; do not fabricate copy semantics'
    };
}

function buildExportAcceptancePolicy(
    sizePlans: NormalizedSizePlan[],
    outputDir: string,
    designCorePlan: MainImageDesignCorePlan,
    productionDocumentStructure: MainImageProductionDocumentStructure,
    productionExecutionPlan: MainImageProductionExecutionPlan,
    productionExecutorHandoff: MainImageProductionExecutorHandoff,
    productionExecutorDispatchPlan: MainImageProductionExecutorDispatchPlan,
    productionExecutorDryRunPreview: MainImageProductionExecutorDryRunPreview,
    designConceptPlan: MainImageDesignConceptPlan
): Record<string, unknown> | undefined {
    if (sizePlans.length === 0) return undefined;
    return {
        outputDir: outputDir || undefined,
        exportPlanned: Boolean(outputDir) || sizePlans.some((plan) => plan.quickExportPlanned),
        designCoreStatus: designCorePlan.status,
        expectedSourceDocuments: Array.from(new Set([
            ...designCorePlan.deliveryDocuments.map((document) => document.sourceDocumentPath),
            designCorePlan.whiteBackgroundSpec.sourceDocumentPath
        ])),
        expectedExportFolders: designCorePlan.deliveryDocuments.map((document) => document.exportFolder),
        whiteBackgroundOutputPath: designCorePlan.whiteBackgroundSpec.outputPath,
        noConversionExportFolderKeys: designCorePlan.deliveryDocuments
            .filter((document) => document.excludedImageTypes.includes('conversion'))
            .map((document) => document.folderKey),
        productionDocumentStatus: productionDocumentStructure.status,
        productionDocumentCount: productionDocumentStructure.documents.length,
        exportSpecCount: productionDocumentStructure.exportSpecs.length,
        productionExecutionPlanStatus: productionExecutionPlan.status,
        plannedOperationCount: productionExecutionPlan.plannedOperationCount,
        productionExecutorHandoffStatus: productionExecutorHandoff.status,
        executorHandoffRequestCount: productionExecutorHandoff.toolRequests.length,
        executorHandoffMissingTools: productionExecutorHandoff.missingToolNames,
        productionExecutorDispatchStatus: productionExecutorDispatchPlan.status,
        executorDispatchQueueCount: productionExecutorDispatchPlan.executorQueue.length,
        executorDispatchMissingTools: productionExecutorDispatchPlan.missingToolNames,
        productionExecutorDryRunStatus: productionExecutorDryRunPreview.status,
        executorDryRunOperationCount: productionExecutorDryRunPreview.operationCount,
        designConceptStatus: designConceptPlan.status,
        designConceptVariantCount: designConceptPlan.variantConcepts.length,
        pendingConfirmationCount: productionExecutionPlan.pendingConfirmations.length,
        canExecuteWithoutReview: productionExecutionPlan.canExecuteWithoutReview,
        pendingRatioWarnings: productionDocumentStructure.warnings.filter((warning) => warning.includes('第三比例')),
        acceptedWhen: [
            'export path exists if export is requested',
            'planned production documents and child groups exist after Photoshop execution',
            'planned operation sequence has been read back through Photoshop execution results',
            'post-export screenshot or pixel probe is available',
            'manual or QA report does not reject the result'
        ],
        boundary: 'export acceptance policy is not an exported file'
    };
}

function buildPerformanceBudget(
    sizePlans: NormalizedSizePlan[],
    projectAssetCount: number,
    toolNames: string[],
    memoryContext: MainImageMemoryContext
): Record<string, unknown> {
    return {
        maxStrategyInputAssets: Math.max(1, Math.min(8, projectAssetCount || 1)),
        plannedSizeCount: sizePlans.length,
        toolResultCount: toolNames.length,
        memorySourceCount: memoryContext.preferenceSummary.sourceResultCount,
        allowProviderCalls: false,
        allowPhotoshopExecution: false,
        boundary: 'strategy input builder must stay local and read-only'
    };
}

function collectProvidedInputs(
    strategyInputs: Partial<Record<MainImageStrategyInputKey, unknown>>
): MainImageStrategyInputKey[] {
    return REQUIRED_INPUTS.filter((key) => strategyInputs[key] !== undefined && strategyInputs[key] !== null);
}

function buildWarnings(input: {
    hasAsset: boolean;
    subjectBounds?: NormalizedSubjectBounds;
    sizePlans: NormalizedSizePlan[];
    copyCandidates: string[];
    outputDir: string;
    visualContextReady: boolean;
}): string[] {
    const warnings: string[] = [];
    if (!input.hasAsset) {
        warnings.push('缺少素材、项目图片或当前文档上下文，不能生成素材策略。');
    }
    if (!input.subjectBounds) {
        warnings.push('缺少主体 bounds，不能生成主视觉、落位和智能缩放策略。');
    }
    if (input.sizePlans.length === 0) {
        warnings.push('缺少尺寸计划，不能生成落位、缩放和导出验收策略。');
    }
    if (input.copyCandidates.length === 0) {
        warnings.push('缺少文案候选；只能保留可编辑文案槽，不能编造卖点。');
    }
    if (!input.outputDir && !input.sizePlans.some((plan) => plan.quickExportPlanned)) {
        warnings.push('未提供导出目录且尺寸计划未声明导出，不能声明导出完成。');
    }
    if (!input.visualContextReady) {
        warnings.push('缺少与所选素材绑定的可用视觉分析，素材语义只能保持 unknown 或 metadata-only。');
    }
    return warnings;
}

export function buildMainImageStrategyInputs(
    input: MainImageStrategyInputBuilderInput
): MainImageStrategyInputBundle {
    const userText = cleanString(input.userText);
    const imageType = cleanString(input.imageType);
    const outputDir = cleanString(input.outputDir);
    const subjectBounds = normalizeSubjectBounds(input.subjectBounds);
    const sizePlans = normalizeSizePlans(input.sizePlans);
    const copyCandidates = cleanStrings(input.copyCandidates);
    const toolNames = cleanStrings(input.toolNames);
    const referenceHints = buildReferenceHints(input);
    const mainImageMemoryContext = input.mainImageMemoryContext || buildMainImageMemoryContext({
        userText: input.userText,
        knowledgeResults: input.knowledgeResults
    });
    const designPlacementIntelligencePlan = input.designPlacementIntelligencePlan || null;
    const strategyInputs: Partial<Record<MainImageStrategyInputKey, unknown>> = {};
    const assetHeroStrategy = buildMainImageAssetHeroStrategy({
        userText: input.userText,
        currentDocument: input.currentDocument,
        projectAssets: input.projectAssets || [],
        selectedAsset: input.selectedAsset,
        subjectBounds: input.subjectBounds,
        visionSignal: input.visionSignal
    });
    const projectStyleStrategy = buildMainImageProjectStyleStrategy({
        userText: input.userText,
        projectAssets: input.projectAssets || [],
        selectedAsset: input.selectedAsset,
        visionSignal: input.visionSignal,
        agentDesignDecision: input.agentDesignDecision,
        referenceHints
    });
    const designCorePlan = buildMainImageDesignCorePlan({
        projectStyleStrategy,
        copyCandidates
    });
    const copyStrategy = buildMainImageCopyStrategy({
        userText: input.userText,
        projectStyleStrategy,
        copyCandidates
    });
    const designStandards = buildMainImageDesignStandards({
        projectStyleStrategy
    });
    const mainImagePlatformProfile = input.mainImagePlatformProfile || buildMainImagePlatformSizeProfile();
    const productionDocumentStructure = buildMainImageProductionDocumentStructure({
        platformSizeProfile: mainImagePlatformProfile,
        projectStyleStrategy,
        requestedSizeKeys: resolveProductionStructureSizeScope(sizePlans),
        requestedImageType: resolveProductionStructureImageTypeScope({
            userText,
            imageType,
            sizePlans
        })
    });
    const variantPlacementStrategy = buildMainImageVariantPlacementStrategy({
        userText: input.userText,
        projectStyleStrategy,
        selectedAsset: input.selectedAsset,
        subjectBounds: input.subjectBounds,
        sizePlans: input.sizePlans
    });
    const designConceptPlan = buildMainImageDesignConceptPlan({
        designCorePlan,
        projectStyleStrategy,
        assetHeroStrategy,
        copyStrategy,
        variantPlacementStrategy
    });
    const productionExecutionPlan = buildMainImageProductionExecutionPlan({
        productionDocumentStructure,
        variantPlacementStrategy,
        selectedAsset: input.selectedAsset,
        outputDir,
        allowPendingRatioExecution: input.allowPendingRatioExecution
    });
    const productionExecutorHandoff = buildMainImageProductionExecutorHandoff({
        productionExecutionPlan,
        availableToolNames: toolNames,
        outputDir,
        mode: 'dry-run'
    });
    const productionExecutorDispatchPlan = buildMainImageProductionExecutorDispatchPlan({
        productionExecutorHandoff,
        availableToolNames: toolNames,
        mode: 'dry-run-bridge'
    });
    const productionExecutorDryRunPreview = buildMainImageProductionExecutorDryRunPreview({
        productionExecutorDispatchPlan
    });

    const assetSelectionPolicy = assetHeroStrategy.strategyInputPatch.assetSelectionPolicy;
    if (assetSelectionPolicy) strategyInputs.assetSelectionPolicy = assetSelectionPolicy;

    const heroSubjectPolicy = assetHeroStrategy.strategyInputPatch.heroSubjectPolicy;
    if (heroSubjectPolicy) strategyInputs.heroSubjectPolicy = heroSubjectPolicy;

    const imagePlacementPolicy = buildPlacementPolicy(
        subjectBounds,
        sizePlans,
        imageType,
        variantPlacementStrategy,
        designConceptPlan,
        designPlacementIntelligencePlan
    );
    if (imagePlacementPolicy) strategyInputs.imagePlacementPolicy = imagePlacementPolicy;

    const smartScalingPolicy = buildSmartScalingPolicy(
        subjectBounds,
        sizePlans,
        variantPlacementStrategy
    );
    if (smartScalingPolicy) strategyInputs.smartScalingPolicy = smartScalingPolicy;

    const copyRolePolicy = buildCopyRolePolicy({
        copyCandidates,
        userText,
        projectStyleStrategy,
        designCorePlan,
        copyStrategy,
        designConceptPlan,
        mainImageMemoryContext,
        designStandards
    });
    if (copyRolePolicy) strategyInputs.copyRolePolicy = copyRolePolicy;

    const exportAcceptancePolicy = buildExportAcceptancePolicy(
        sizePlans,
        outputDir,
        designCorePlan,
        productionDocumentStructure,
        productionExecutionPlan,
        productionExecutorHandoff,
        productionExecutorDispatchPlan,
        productionExecutorDryRunPreview,
        designConceptPlan
    );
    if (exportAcceptancePolicy) strategyInputs.exportAcceptancePolicy = exportAcceptancePolicy;

    strategyInputs.performanceBudget = buildPerformanceBudget(
        sizePlans,
        (input.projectAssets || []).length,
        toolNames,
        mainImageMemoryContext
    );

    const providedInputs = collectProvidedInputs(strategyInputs);
    const missingInputs = REQUIRED_INPUTS.filter((key) => !providedInputs.includes(key));
    const status: MainImageStrategyInputBuilderStatus = missingInputs.length === 0
        ? 'ready_for_strategy_contract'
        : 'blocked_missing_strategy_inputs';
    const designReadinessReport = buildMainImageDesignReadinessReport({
        strategyInputContext: {
            status,
            missingInputs,
            blockers: missingInputs.length > 0 ? ['main_image_strategy_inputs_missing'] : [],
            warnings: [],
            designStandards,
            productionExecutorDryRunPreview
        },
        userCheckpointApproved: input.userCheckpointApproved
    });
    const liveExecutorRequestPackage = buildMainImageLiveExecutorRequestPackage({
        designReadinessReport,
        productionExecutorDryRunPreview,
        requestLabel: cleanString(input.userText) || 'main-image-live-executor-request'
    });
    const warnings = buildWarnings({
        hasAsset: Boolean(assetSelectionPolicy),
        subjectBounds,
        sizePlans,
        copyCandidates,
        outputDir,
        visualContextReady: projectStyleStrategy.status === 'ready_visual_context'
    });

    return {
        version: 'main-image-strategy-input-builder/v0',
        skillId: 'main-image-design',
        scene: 'ecommerce-socks',
        status,
        strategyInputs,
        providedInputs,
        missingInputs,
        canClaimOutputQuality: false,
        canClaimDesignComplete: false,
        noPhotoshopWrites: true,
        mustNotExecutePhotoshop: true,
        assetHeroStrategy,
        projectStyleStrategy,
        designCorePlan,
        copyStrategy,
        designConceptPlan,
        mainImageMemoryContext,
        designPlacementIntelligencePlan,
        designStandards,
        variantPlacementStrategy,
        productionDocumentStructure,
        productionExecutionPlan,
        productionExecutorHandoff,
        productionExecutorDispatchPlan,
        productionExecutorDryRunPreview,
        designReadinessReport,
        liveExecutorRequestPackage,
        blockers: missingInputs.length > 0 ? ['main_image_strategy_inputs_missing'] : [],
        warnings: [
            ...warnings,
            ...assetHeroStrategy.warnings,
            ...projectStyleStrategy.warnings,
            ...designCorePlan.warnings,
            ...copyStrategy.warnings,
            ...designConceptPlan.warnings,
            ...mainImageMemoryContext.warnings,
            ...(designPlacementIntelligencePlan?.warnings || []),
            ...designStandards.warnings,
            ...variantPlacementStrategy.warnings,
            ...productionDocumentStructure.warnings,
            ...productionExecutionPlan.warnings,
            ...productionExecutorHandoff.warnings,
            ...productionExecutorDispatchPlan.warnings,
            ...productionExecutorDryRunPreview.warnings,
            ...designReadinessReport.warnings,
            ...liveExecutorRequestPackage.warnings
        ],
        limitations: [
            ...designCorePlan.limitations,
            ...copyStrategy.limitations,
            ...designConceptPlan.limitations,
            ...(designPlacementIntelligencePlan?.limitations || []),
            '策略输入生成器只整理上下文，不调用模型、不读取图片像素、不执行 Photoshop。',
            'metadata-only 素材和 bounds 只能进入策略讨论，不能证明设计质量。',
            '缺少真实视觉理解时，不能猜测产品款式、材质、风格和最佳构图。',
            '主图设计规范只约束点击图/转化图设计策略，不代表已经完成设计或参考搜索。',
            '主图本地记忆只提供用户偏好候选，不替代视觉观察、商品事实、平台规范或 Photoshop 验收。',
            'DesignPlacementIntelligence 只提供选图和落位候选解释，不替代主体 bounds、actualBounds、截图 QA 或人工验收。',
            '生产文档结构只描述文档/分组/导出计划，不创建 PSD/PSB。',
            '生产执行计划只描述 Photoshop 操作顺序，不执行 Photoshop。',
            '生产执行交接只描述 dry-run/tool handoff 请求，不执行 Photoshop。',
            '生产 executor dispatch plan 只描述真实执行前门禁和队列预览，不执行 Photoshop。',
            '生产 executor dry-run preview 只记录将要执行的操作和读回计划，不执行 Photoshop、不伪造读回结果。',
            '设计 readiness report 只判断是否具备进入真实 executor 或质量声明的条件，不执行 Photoshop。',
            'live executor request package 只生成未来执行请求包和验收要求，不执行 Photoshop。'
        ]
    };
}
