import {
    buildDesignIntentContextFromText,
    buildDesignPlanInputsFromIntent,
    type DesignAgentOsScenario,
    type DesignAgentOsStatus,
    type DesignIntentContext,
    type DesignPlanInputs,
    type DesignDSL,
    type ExecutionPlan,
    type ExecutionPlanStep,
    type MainImageSizePlan,
    type VerificationReport
} from './design-agent-os-contracts';
import {
    selectMainImageAssetCandidate,
    type MainImageAssetSelectionResult
} from './main-image-asset-selection';
import {
    buildMainImageStrategyContract,
    type MainImageStrategyContract,
    type MainImageStrategyInputKey
} from './main-image-strategy-contract';
import {
    buildMainImageStrategyInputs,
    type MainImageStrategyInputBundle
} from './main-image-strategy-input-builder';
import {
    buildMainImageVisualUnderstanding,
    buildMainImageVisualUnderstandingContract,
    buildMainImageVisualVerification,
    buildMainImageScreenshotObservationFromSizePlans,
    type MainImageResultScreenshotObservation,
    type MainImageManualReviewRecord,
    type MainImageVisionSignal,
    type MainImageVisualUnderstanding,
    type MainImageVisualVerification
} from './main-image-visual-loop';
import type { EcommerceSocksChildStrategyReviewGate } from './ecommerce-socks-child-strategy-review-gate';
import type { DesignKnowledgeResult } from './design-knowledge-search';
import type { MainImageAgentDesignDecision, MainImageReferenceHint } from './main-image-project-style-strategy';
import type { MainImageMemoryContext } from './main-image-memory-context';
import type { DesignPlacementIntelligencePlan } from './design-placement-intelligence';
import type { EcommerceSocksChildStrategyInput } from './ecommerce-socks-child-strategy-consumer';

export type MainImageDraftReadiness = 'ready' | 'needs_context' | 'blocked';

export interface MainImageDraftDocument {
    id?: number | string;
    name?: string;
    width?: number;
    height?: number;
    path?: string;
}

export interface MainImageDraftAsset {
    id?: string;
    name?: string;
    path?: string;
    width?: number;
    height?: number;
    role?: string;
    source?: string;
}

export interface MainImageDraftSubjectBounds {
    left?: number;
    top?: number;
    right?: number;
    bottom?: number;
    width?: number;
    height?: number;
}

export interface MainImageDraftInput {
    userText?: string;
    imageType?: string;
    targetSizes?: Array<{ key?: string; width: number; height: number }>;
    currentDocument?: MainImageDraftDocument | null;
    projectAssets?: MainImageDraftAsset[];
    selectedAsset?: MainImageDraftAsset | null;
    subjectBounds?: MainImageDraftSubjectBounds | null;
    sizePlans?: MainImageSizePlan[];
    copyCandidates?: string[];
    outputDir?: string;
    toolNames?: string[];
    critique?: { beforeScore?: number; afterScore?: number; delta?: number } | null;
    visionSignal?: MainImageVisionSignal | null;
    agentDesignDecision?: MainImageAgentDesignDecision | null;
    screenshotObservation?: MainImageResultScreenshotObservation | null;
    manualReview?: MainImageManualReviewRecord | null;
    strategyReviewGate?: EcommerceSocksChildStrategyReviewGate | null;
    strategyInputs?: Partial<Record<MainImageStrategyInputKey, unknown>>;
    referenceHints?: MainImageReferenceHint[];
    knowledgeResults?: DesignKnowledgeResult[];
    mainImageMemoryContext?: MainImageMemoryContext | null;
    designPlacementIntelligencePlan?: DesignPlacementIntelligencePlan | null;
    ecommerceSocksChildStrategyInput?: EcommerceSocksChildStrategyInput | null;
}

export interface MainImageAgentDraftPlan {
    planVersion: 'main-image-agent-draft/v0';
    scenario: 'main-image';
    readiness: MainImageDraftReadiness;
    intent: DesignIntentContext;
    brief: DesignPlanInputs;
    designDsl: DesignDSL;
    executionPlan: ExecutionPlan;
    verificationReport: VerificationReport;
    assetSelection: MainImageAssetSelectionResult;
    assetVisualUnderstanding: MainImageVisualUnderstanding;
    visualUnderstanding: ReturnType<typeof buildMainImageVisualUnderstandingContract>;
    visualVerification: MainImageVisualVerification;
    mainImageStrategyInputBundle: MainImageStrategyInputBundle;
    mainImageDesignPlacementIntelligence: DesignPlacementIntelligencePlan | null;
    ecommerceSocksChildStrategyInput: EcommerceSocksChildStrategyInput | null;
    mainImageStrategyContract: MainImageStrategyContract;
    selectedAssetStrategy: {
        mode: 'active-document-layer' | 'project-asset-candidate' | 'explicit-asset' | 'missing';
        candidateCount: number;
        selectedAssetName?: string;
        selectedAssetPath?: string;
        reason: string;
    };
    layoutStrategy: {
        targetSizeCount: number;
        sizePlanCount: number;
        smartLayoutPlanned: boolean;
        exportPlanned: boolean;
        subjectBoundsReady: boolean;
        primaryTargetSize?: { width: number; height: number };
    };
    copyStrategy: {
        candidateCount: number;
        hasCopyContext: boolean;
        needsCopyContext: boolean;
        reason: string;
    };
    blockers: string[];
    warnings: string[];
    limitations: string[];
}

function normalizeText(value: unknown): string {
    return String(value || '').trim();
}

function toPositiveNumber(value: unknown): number | undefined {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric > 0 ? numeric : undefined;
}

function hasPositiveSize(value: { width?: unknown; height?: unknown } | null | undefined): boolean {
    return Boolean(toPositiveNumber(value?.width) && toPositiveNumber(value?.height));
}

function normalizeTargetSizes(input: MainImageDraftInput): Array<{ key?: string; width: number; height: number }> {
    const fromSizePlans = (input.sizePlans || [])
        .map((plan) => ({
            key: plan.sizeKey,
            width: Math.round(Number(plan.targetSize?.width || 0)),
            height: Math.round(Number(plan.targetSize?.height || 0))
        }))
        .filter(hasPositiveSize);
    if (fromSizePlans.length > 0) return fromSizePlans;
    const explicit = (input.targetSizes || [])
        .map((item) => ({
            key: item.key,
            width: Math.round(Number(item.width || 0)),
            height: Math.round(Number(item.height || 0))
        }))
        .filter(hasPositiveSize);
    return explicit.length > 0 ? explicit : [{ key: '800', width: 800, height: 800 }];
}

function normalizeSubjectBounds(bounds: MainImageDraftSubjectBounds | null | undefined): MainImageDraftSubjectBounds | undefined {
    if (!bounds) return undefined;
    const left = Number(bounds.left ?? 0);
    const top = Number(bounds.top ?? 0);
    const right = Number(bounds.right ?? (left + Number(bounds.width || 0)));
    const bottom = Number(bounds.bottom ?? (top + Number(bounds.height || 0)));
    const width = Number(bounds.width ?? (right - left));
    const height = Number(bounds.height ?? (bottom - top));
    if (![left, top, right, bottom, width, height].every(Number.isFinite) || width <= 0 || height <= 0) {
        return undefined;
    }
    return { left, top, right, bottom, width, height };
}

function inferSelectedAssetStrategy(
    input: MainImageDraftInput,
    assetSelection: MainImageAssetSelectionResult
): MainImageAgentDraftPlan['selectedAssetStrategy'] {
    const projectAssets = (input.projectAssets || []).filter((asset) => asset.path || asset.name);
    const selected = assetSelection.selectedAsset;
    if (assetSelection.selectionMode === 'explicit-asset') {
        return {
            mode: 'explicit-asset',
            candidateCount: projectAssets.length,
            selectedAssetName: selected?.name,
            selectedAssetPath: selected?.path,
            reason: '用户或上下文已经提供明确素材，主图草案应优先使用该素材。'
        };
    }
    if (assetSelection.selectionMode === 'selected-project-image' || assetSelection.selectionMode === 'project-asset-candidate') {
        return {
            mode: 'project-asset-candidate',
            candidateCount: assetSelection.candidateCount,
            selectedAssetName: selected?.name,
            selectedAssetPath: selected?.path,
            reason: assetSelection.selectionMode === 'selected-project-image'
                ? '项目面板已有选中图片，主图草案可把它作为优先素材候选。'
                : '项目素材可作为候选，但尚未经过真实视觉筛选和 Photoshop 置入。'
        };
    }
    const currentDocument = input.currentDocument || undefined;
    if (assetSelection.selectionMode === 'active-document-fallback' && currentDocument && (currentDocument.name || hasPositiveSize(currentDocument))) {
        return {
            mode: 'active-document-layer',
            candidateCount: assetSelection.candidateCount,
            selectedAssetName: selected?.name || currentDocument.name,
            selectedAssetPath: selected?.path || currentDocument.path,
            reason: '当前 Photoshop 文档可作为主图草案的活动素材上下文。'
        };
    }
    return {
        mode: 'missing',
        candidateCount: assetSelection.candidateCount,
        reason: '缺少当前文档、明确素材或项目候选图，不能编造主图素材。'
    };
}

function buildMainImageDsl(input: {
    targetSize: { width: number; height: number };
    imageType: string;
    subjectReady: boolean;
    copyCandidateCount: number;
}): DesignDSL {
    const { width, height } = input.targetSize;
    const safe = {
        x: Math.round(width * 0.06),
        y: Math.round(height * 0.06),
        width: Math.round(width * 0.88),
        height: Math.round(height * 0.88)
    };
    const headlineHeight = Math.max(56, Math.round(height * 0.13));
    const tagHeight = Math.max(42, Math.round(height * 0.075));
    return {
        dslVersion: 'design-agent-os/v0',
        scenario: 'main-image',
        canvas: { width, height },
        layoutType: input.imageType === 'conversion'
            ? 'main-image-conversion-draft'
            : 'main-image-click-draft',
        regions: [
            {
                id: 'safe-area',
                kind: 'region',
                role: 'safe-area',
                box: safe,
                styleKeys: []
            },
            {
                id: 'hero-subject-slot',
                kind: 'image-slot',
                role: 'hero-subject',
                box: {
                    x: Math.round(width * 0.12),
                    y: Math.round(height * 0.18),
                    width: Math.round(width * 0.76),
                    height: Math.round(height * 0.66)
                },
                styleKeys: ['subject-fit', 'visual-center']
            },
            {
                id: 'headline-slot',
                kind: 'text-slot',
                role: 'headline',
                box: {
                    x: Math.round(width * 0.08),
                    y: Math.round(height * 0.07),
                    width: Math.round(width * 0.84),
                    height: headlineHeight
                },
                styleKeys: ['large-title', 'high-contrast']
            },
            {
                id: 'benefit-tag-slot',
                kind: 'text-slot',
                role: 'benefit-tag',
                box: {
                    x: Math.round(width * 0.1),
                    y: Math.round(height * 0.86),
                    width: Math.round(width * 0.8),
                    height: tagHeight
                },
                styleKeys: ['short-benefit', 'safe-bottom']
            }
        ],
        constraints: [
            '主图草案 DSL 是 Agent 控制层计划，不是固定模板。',
            input.subjectReady ? '已存在主体 bounds，可进入缩放落位复核。' : '缺少主体 bounds，执行前必须检测或读取活动图层 bounds。',
            input.copyCandidateCount > 0 ? '已有文案候选，可进入文本槽位适配。' : '缺少可靠文案候选时只能保留文本槽位或请求补充商品事实。'
        ],
        sourceRefs: []
    };
}

function makeStep(
    id: string,
    operation: string,
    target: string,
    params: Record<string, unknown>,
    reason: string,
    expectedOutcomes: string[]
): ExecutionPlanStep {
    return { id, operation, target, params, reason, expectedOutcomes };
}

function buildExecutionPlan(input: {
    readiness: MainImageDraftReadiness;
    selectedAssetStrategy: MainImageAgentDraftPlan['selectedAssetStrategy'];
    assetSelection: MainImageAssetSelectionResult;
    designDsl: DesignDSL;
    sizePlans: MainImageSizePlan[];
    outputDir?: string;
    copyCandidateCount: number;
    subjectReady: boolean;
}): ExecutionPlan {
    const steps: ExecutionPlanStep[] = [
        makeStep(
            'read-main-image-context',
            'readDesignContext',
            'photoshop-and-project-context',
            {
                assetMode: input.selectedAssetStrategy.mode,
                candidateCount: input.selectedAssetStrategy.candidateCount,
                assetGate: input.assetSelection.preflightGate,
                assetSelectionMode: input.assetSelection.selectionMode
            },
            'Agent 必须先确认素材、当前文档和项目上下文，不能只靠关键词生成主图。',
            ['current document info', 'project assets', 'selected asset context']
        ),
        makeStep(
            'select-main-image-asset',
            'selectMainImageAsset',
            input.selectedAssetStrategy.selectedAssetName || 'main-image-asset',
            {
                mode: input.selectedAssetStrategy.mode,
                path: input.selectedAssetStrategy.selectedAssetPath || null,
                score: input.assetSelection.selectedAsset?.score ?? null,
                selectionOnly: true
            },
            input.selectedAssetStrategy.reason,
            ['selected asset name/path', 'asset dimensions or current document state']
        ),
        makeStep(
            'detect-main-image-subject',
            'detectSubjectBounds',
            'hero-subject',
            { required: true, alreadyAvailable: input.subjectReady },
            '主图核心是主体视觉大小和位置，必须检测或读取主体 bounds。',
            ['subject bounds', 'fallback layer bounds']
        ),
        makeStep(
            'compose-main-image-dsl',
            'composeDesignDsl',
            input.designDsl.layoutType || 'main-image-dsl',
            {
                regionCount: input.designDsl.regions.length,
                canvas: input.designDsl.canvas
            },
            '把主图任务转成安全区、主视觉槽、标题槽和卖点槽，执行器后续消费计划而不是临场猜测。',
            ['DesignDSL', 'slot bounds', 'layout constraints']
        )
    ];

    for (const plan of input.sizePlans) {
        steps.push(makeStep(
            `place-main-image-subject-${plan.sizeKey}`,
            plan.smartLayoutPlanned ? 'smartLayout' : 'transformLayer+moveLayer',
            `size-${plan.sizeKey}`,
            {
                targetSize: plan.targetSize,
                scale: plan.scale,
                targetX: plan.targetX,
                targetY: plan.targetY,
                layoutCandidateScore: plan.layoutCandidateScore ?? null
            },
            plan.decisionReason || '按主图 DSL 和主体 bounds 计算缩放与位置。',
            ['tool result', 'post-transform layer bounds', 'focus check']
        ));
    }

    steps.push(makeStep(
        'write-or-reserve-main-image-copy',
        input.copyCandidateCount > 0 ? 'fitCopyToTextSlots' : 'reserveCopySlots',
        'headline-and-benefit-slots',
        { candidateCount: input.copyCandidateCount },
        input.copyCandidateCount > 0
            ? '已有文案候选，应按文本槽位、字数和可读性适配。'
            : '缺少可靠商品事实时不编造卖点，只保留可编辑文本槽位或请求补充。',
        ['copy candidates', 'text layer bounds', 'text overflow check']
    ));

    if (input.outputDir || input.sizePlans.some((plan) => plan.quickExportPlanned)) {
        steps.push(makeStep(
            'export-main-image-draft',
            'quickExport',
            'main-image-output',
            { outputDir: input.outputDir || null },
            '用户提供导出目录或执行计划启用导出时，才导出主图草案。',
            ['export result', 'output path']
        ));
    }

    steps.push(makeStep(
        'verify-main-image-draft',
        'verifyDesignResult',
        'main-image-photoshop-result',
        {
            requiredChecks: ['subject bounds', 'text overflow', 'safe area', 'screenshot or manual review']
        },
        '主图工具执行成功不等于设计完成，必须检查 bounds、结果截图或人工复核记录。',
        ['VerificationReport', 'bounds QA', 'screenshot/manual review']
    ));

    return {
        planId: 'main-image-agent-draft-plan',
        scenario: 'main-image',
        status: input.readiness === 'blocked' ? 'partial' : 'planned',
        steps,
        inputs: input.assetSelection.selectedAsset ? [{
            source: input.assetSelection.selectedAsset.path || input.assetSelection.selectedAsset.name || 'selected-main-image-asset',
            summary: `主图草案选中素材：${input.assetSelection.selectedAsset.name || input.assetSelection.selectedAsset.path || 'unknown'}`
        }] : [],
        limitations: [
            '该计划是 Agent 控制层，不等于 Photoshop 已完成执行。',
            '主图草案必须继续通过真实工具结果、bounds、截图或人工验收确认。',
            '当前不反推出最佳审美，只建立可编辑草案闭环所需的事实和约束。'
        ]
    };
}

function buildVerificationReport(input: {
    readiness: MainImageDraftReadiness;
    blockers: string[];
    warnings: string[];
    selectedAssetStrategy: MainImageAgentDraftPlan['selectedAssetStrategy'];
    layoutStrategy: MainImageAgentDraftPlan['layoutStrategy'];
    copyStrategy: MainImageAgentDraftPlan['copyStrategy'];
    toolNames: string[];
    critique?: { beforeScore?: number; afterScore?: number; delta?: number } | null;
}): VerificationReport {
    const status: DesignAgentOsStatus = input.blockers.length > 0
        ? 'failed'
        : 'needs_review';
    const toolResultSummary = input.toolNames.length > 0
        ? `已记录工具链：${input.toolNames.slice(0, 8).join(', ')}${input.toolNames.length > 8 ? '...' : ''}`
        : '尚未记录真实 Photoshop 工具结果。';
    return {
        reportId: 'main-image-agent-draft-verification',
        scenario: 'main-image',
        status,
        scope: 'task',
        summary: input.readiness === 'ready'
            ? 'Agent-first 主图草案计划已具备进入执行/复核的基础上下文。'
            : input.readiness === 'blocked'
                ? 'Agent-first 主图草案计划存在阻断项，不能安全推进。'
                : 'Agent-first 主图草案计划仍需补充素材、主体或文案上下文。',
        checks: [
            {
                id: 'main-image-asset-context',
                label: '素材上下文',
                status: input.selectedAssetStrategy.mode === 'missing' ? 'failed' : 'needs_review',
                summary: input.selectedAssetStrategy.reason
            },
            {
                id: 'main-image-subject-bounds',
                label: '主体 bounds',
                status: input.layoutStrategy.subjectBoundsReady ? 'needs_review' : 'failed',
                summary: input.layoutStrategy.subjectBoundsReady
                    ? '已有主体 bounds，可用于缩放落位。'
                    : '缺少主体 bounds，执行前必须检测或读取活动图层 bounds。'
            },
            {
                id: 'main-image-size-plan',
                label: '尺寸计划',
                status: input.layoutStrategy.sizePlanCount > 0 ? 'needs_review' : 'failed',
                summary: `sizePlanCount=${input.layoutStrategy.sizePlanCount}; smartLayoutPlanned=${input.layoutStrategy.smartLayoutPlanned}。`
            },
            {
                id: 'main-image-copy-context',
                label: '文案上下文',
                status: input.copyStrategy.hasCopyContext ? 'needs_review' : 'unknown',
                summary: input.copyStrategy.reason
            },
            {
                id: 'main-image-tool-results',
                label: '工具执行结果',
                status: input.toolNames.length > 0 ? 'needs_review' : 'not_run',
                summary: toolResultSummary
            }
        ],
        blockers: input.blockers,
        warnings: [
            ...input.warnings,
            input.critique ? `设计评审摘要：${input.critique.beforeScore ?? '?'} -> ${input.critique.afterScore ?? '?'}，delta=${input.critique.delta ?? '?'}` : ''
        ].filter(Boolean),
        limitations: [
            '主图草案计划不证明主图审美质量。',
            '没有真实结果截图和人工评分时，不能声明自动主图设计闭环完成。',
            '工具调用成功仍需文本越界、主体安全区、截图或人工复核。'
        ]
    };
}

export function buildMainImageAgentDraftPlan(input: MainImageDraftInput): MainImageAgentDraftPlan {
    const targetSizes = normalizeTargetSizes(input);
    const primaryTargetSize = targetSizes[0];
    const subjectBounds = normalizeSubjectBounds(input.subjectBounds);
    const sizePlans = input.sizePlans || [];
    const screenshotObservation = input.screenshotObservation
        || buildMainImageScreenshotObservationFromSizePlans(sizePlans);
    const copyCandidates = (input.copyCandidates || []).map(normalizeText).filter(Boolean);
    const assetSelection = selectMainImageAssetCandidate({
        userText: input.userText,
        currentDocument: input.currentDocument,
        projectAssets: input.projectAssets || [],
        selectedAsset: input.selectedAsset
    });
    const assetVisualUnderstanding = buildMainImageVisualUnderstanding({
        assetSelection,
        currentDocument: input.currentDocument,
        subjectBounds: input.subjectBounds,
        sizePlans,
        toolNames: input.toolNames || [],
        visionSignal: input.visionSignal,
        screenshotObservation,
        manualReview: input.manualReview
    });
    const visualUnderstanding = buildMainImageVisualUnderstandingContract({
        assetSelection,
        currentDocument: input.currentDocument,
        subjectBounds: input.subjectBounds,
        sizePlans,
        toolNames: input.toolNames || [],
        visionSignal: input.visionSignal,
        screenshotObservation,
        manualReview: input.manualReview
    });
    const visualVerification = buildMainImageVisualVerification({
        assetSelection,
        currentDocument: input.currentDocument,
        subjectBounds: input.subjectBounds,
        sizePlans,
        toolNames: input.toolNames || [],
        visionSignal: input.visionSignal,
        screenshotObservation,
        manualReview: input.manualReview
    });
    const mainImageStrategyInputBundle = buildMainImageStrategyInputs({
        userText: input.userText,
        imageType: input.imageType,
        currentDocument: input.currentDocument,
        projectAssets: input.projectAssets || [],
        selectedAsset: input.selectedAsset,
        subjectBounds: input.subjectBounds,
        sizePlans,
        copyCandidates: input.copyCandidates || [],
        outputDir: input.outputDir,
        toolNames: input.toolNames || [],
        visionSignal: input.visionSignal,
        agentDesignDecision: input.agentDesignDecision,
        referenceHints: input.referenceHints,
        knowledgeResults: input.knowledgeResults,
        mainImageMemoryContext: input.mainImageMemoryContext,
        designPlacementIntelligencePlan: input.designPlacementIntelligencePlan
    });
    const effectiveStrategyInputs = input.strategyInputs
        ? {
            ...mainImageStrategyInputBundle.strategyInputs,
            ...input.strategyInputs
        }
        : mainImageStrategyInputBundle.strategyInputs;
    const mainImageStrategyContract = buildMainImageStrategyContract({
        userIntent: input.userText || '',
        parentReviewGate: input.strategyReviewGate || null,
        strategyInputs: effectiveStrategyInputs
    });
    const selectedAssetStrategy = inferSelectedAssetStrategy(input, assetSelection);
    const blockers: string[] = [];
    const warnings: string[] = [...assetSelection.warnings];

    if (!primaryTargetSize || !hasPositiveSize(primaryTargetSize)) {
        blockers.push('缺少有效主图目标尺寸。');
    }
    blockers.push(...assetSelection.blockers);
    if (selectedAssetStrategy.mode === 'missing') {
        warnings.push('缺少当前文档、明确素材或项目候选图；需要先选择或导入主图素材。');
    }
    if (!subjectBounds) {
        warnings.push('缺少主体 bounds；执行前必须调用主体检测或读取活动图层 bounds。');
    }
    if (sizePlans.length === 0) {
        warnings.push('尚未生成尺寸级缩放计划；不能把主图草案称为已执行。');
    }
    if (copyCandidates.length === 0) {
        warnings.push('缺少可验证文案候选；不要编造商品卖点。');
    }
    warnings.push(...assetVisualUnderstanding.warnings);
    warnings.push(...visualVerification.warnings);
    if (!input.outputDir && !sizePlans.some((plan) => plan.quickExportPlanned)) {
        warnings.push('未提供导出目录；草案可编辑但不应宣称已导出。');
    }

    const readiness: MainImageDraftReadiness = blockers.length > 0
        ? 'blocked'
        : assetSelection.readiness !== 'ready' || selectedAssetStrategy.mode === 'missing' || !subjectBounds || sizePlans.length === 0
            ? 'needs_context'
            : 'ready';
    const intent = buildDesignIntentContextFromText(input.userText || '帮我做主图', {
        scenario: 'main-image' as DesignAgentOsScenario,
        action: 'create',
        constraints: [
            'M5-P1 Agent-first 主图草案闭环。',
            'Planner/DSL/验收目标必须先于工具成功结论。',
            `readiness=${readiness}`
        ]
    });
    const brief = buildDesignPlanInputsFromIntent(intent, {
        goal: intent.normalizedText || '生成一张可编辑主图草案',
        outputSpec: {
            width: primaryTargetSize.width,
            height: primaryTargetSize.height,
            format: input.outputDir ? 'exportable-draft' : 'editable-psd-draft'
        },
        constraints: [
            `imageType=${normalizeText(input.imageType) || 'unknown'}`,
            `targetSizes=${targetSizes.map((size) => `${size.key || 'custom'}:${size.width}x${size.height}`).join('/')}`,
            `assetMode=${selectedAssetStrategy.mode}`,
            `assetGate=${assetSelection.preflightGate}`,
            `visualReadiness=${assetVisualUnderstanding.readiness}`,
            `visualVerification=${visualVerification.stage}`,
            '主图草案是业务场景验证路径，不是 Agent 能力边界。'
        ]
    });
    const designDsl = buildMainImageDsl({
        targetSize: primaryTargetSize,
        imageType: normalizeText(input.imageType) || 'click',
        subjectReady: Boolean(subjectBounds),
        copyCandidateCount: copyCandidates.length
    });
    designDsl.sourceRefs = brief.sourceRefs;
    const layoutStrategy = {
        targetSizeCount: targetSizes.length,
        sizePlanCount: sizePlans.length,
        smartLayoutPlanned: sizePlans.some((plan) => plan.smartLayoutPlanned),
        exportPlanned: sizePlans.some((plan) => plan.quickExportPlanned) || Boolean(input.outputDir),
        subjectBoundsReady: Boolean(subjectBounds),
        primaryTargetSize: { width: primaryTargetSize.width, height: primaryTargetSize.height }
    };
    const copyStrategy = {
        candidateCount: copyCandidates.length,
        hasCopyContext: copyCandidates.length > 0,
        needsCopyContext: copyCandidates.length === 0,
        reason: copyCandidates.length > 0
            ? '已有候选文案，但仍需按主图文本槽位和真实商品事实复核。'
            : '缺少候选文案或商品事实，执行器不应凭空生成强卖点。'
    };
    const executionPlan = buildExecutionPlan({
        readiness,
        selectedAssetStrategy,
        assetSelection,
        designDsl,
        sizePlans,
        outputDir: input.outputDir,
        copyCandidateCount: copyCandidates.length,
        subjectReady: Boolean(subjectBounds)
    });
    const verificationReport = buildVerificationReport({
        readiness,
        blockers,
        warnings,
        selectedAssetStrategy,
        layoutStrategy,
        copyStrategy,
        toolNames: input.toolNames || [],
        critique: input.critique
    });

    return {
        planVersion: 'main-image-agent-draft/v0',
        scenario: 'main-image',
        readiness,
        intent,
        brief,
        designDsl,
        executionPlan,
        verificationReport,
        assetSelection,
        assetVisualUnderstanding,
        visualUnderstanding,
        visualVerification,
        mainImageStrategyInputBundle,
        mainImageDesignPlacementIntelligence: input.designPlacementIntelligencePlan || null,
        ecommerceSocksChildStrategyInput: input.ecommerceSocksChildStrategyInput || null,
        mainImageStrategyContract,
        selectedAssetStrategy,
        layoutStrategy,
        copyStrategy,
        blockers,
        warnings,
        limitations: [
            '这是 M5-P1 自动主图草案的控制层计划，不是完整自动设计能力完成证明。',
            '当前不替代现有主图 executor 参数，不破坏已可用功能。',
            '必须通过真实 Photoshop 工具结果、bounds、截图或人工评分继续闭环。'
        ]
    };
}
