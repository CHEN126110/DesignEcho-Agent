import type { MinimalDesignRepresentation } from './reference-replication';
import type { ProjectAssetIndex } from './project-asset-index';
import type { ProjectVisualInsightCacheReadResult } from './project-visual-insight-cache';
import type { ProjectVisualSamplingPlan } from './project-visual-sampling';
import type { DesignKnowledgeResult } from './design-knowledge-search';
import {
    selectDesignKnowledgeResultsForUse,
    type DesignKnowledgeUsageSnapshot
} from './design-knowledge-governance';
import {
    buildBusinessSkillVisualContext,
    type BusinessSkillVisualContext
} from './business-skill-visual-context';
import { buildProjectDesignUnderstandingSummary } from './project-design-understanding-summary';
import {
    buildAgentPerformancePolicyFromIntent,
    type AgentPerformancePolicy
} from './agent-performance-policy';
import {
    buildDesignPlanInputsFromIntent,
    buildDesignDslFromMinimalRepresentation,
    buildExecutionTraceFromToolResults,
    buildDesignIntentContextFromText,
    type DesignAgentOsRecord,
    type DesignAgentOsScenario,
    type DesignAgentOsStatus,
    type DesignPlanInputs,
    type DesignDSL,
    type ExecutionPlan,
    type ExecutionPlanStep,
    type DesignAgentSourceRef,
    type DesignIntentContext,
    type VerificationReport
} from './design-agent-os-contracts';

export type DesignPlannerExecutionMode = 'plan-only' | 'dry-run' | 'execute-with-acceptance';
export type DesignPlannerReadiness = 'ready' | 'needs_context' | 'blocked';
export type DesignPlannerPreflightDecision = 'execute' | 'request_context' | 'block';

export interface DesignPlannerAttachment {
    id?: string;
    kind: 'reference-image' | 'asset-image' | 'document' | 'unknown';
    name?: string;
    path?: string;
    width?: number;
    height?: number;
    sourceRefs?: DesignAgentSourceRef[];
}

export interface DesignPlannerProjectAsset {
    id?: string;
    name?: string;
    path?: string;
    width?: number;
    height?: number;
    role?: string;
}

export interface DesignPlannerCurrentDocument {
    id?: number | string;
    name?: string;
    width?: number;
    height?: number;
    path?: string;
    hasUnsavedChanges?: boolean;
}

export interface DesignPlannerProjectContext {
    projectPath?: string;
    assets?: DesignPlannerProjectAsset[];
    assetIndex?: ProjectAssetIndex;
    visualSamplingPlan?: ProjectVisualSamplingPlan;
    visualInsightCache?: ProjectVisualInsightCacheReadResult;
    templates?: Array<{ id?: string; name?: string; path?: string; kind?: string }>;
}

export interface DesignPlannerInput {
    userText: string;
    attachments?: DesignPlannerAttachment[];
    currentDocument?: DesignPlannerCurrentDocument | null;
    projectContext?: DesignPlannerProjectContext | null;
    priorRunRecords?: DesignAgentOsRecord[];
    knowledgeResults?: DesignKnowledgeResult[];
    referenceRepresentation?: MinimalDesignRepresentation | null;
    constraints?: string[];
    executionMode?: DesignPlannerExecutionMode;
}

export interface DesignPlannerSelectedContext {
    attachments: DesignPlannerAttachment[];
    assets: DesignPlannerProjectAsset[];
    assetIndex?: {
        indexVersion: ProjectAssetIndex['indexVersion'];
        totalFiles: number;
        totalImages: number;
        roleCounts: ProjectAssetIndex['summary']['roleCounts'];
        visionCandidateCount: number;
        limitations: string[];
    };
    visualSamplingPlan?: {
        planVersion: ProjectVisualSamplingPlan['planVersion'];
        scenario: ProjectVisualSamplingPlan['scenario'];
        maxCandidates: number;
        selectedCandidateCount: number;
        shouldAnalyzeCount: number;
        cacheSummary: ProjectVisualSamplingPlan['cacheSummary'];
        limitations: string[];
    };
    visualInsightCache?: {
        cacheVersion: ProjectVisualInsightCacheReadResult['cacheVersion'];
        source: ProjectVisualInsightCacheReadResult['source'];
        exists: boolean;
        totalEntries: number;
        entriesWithInsight: number;
        limitations: string[];
    };
    businessVisualContext?: BusinessSkillVisualContext;
    knowledge: DesignKnowledgeResult[];
    knowledgeUsageSnapshot: DesignKnowledgeUsageSnapshot;
    priorRunRecords: DesignAgentOsRecord[];
    performancePolicy?: {
        policyVersion: AgentPerformancePolicy['policyVersion'];
        taskClass: AgentPerformancePolicy['taskClass'];
        verificationTier: AgentPerformancePolicy['verificationTier'];
        budget: AgentPerformancePolicy['budget'];
        costProfile: AgentPerformancePolicy['costProfile'];
        controls: AgentPerformancePolicy['controls'];
    };
    notes: string[];
}

export interface DesignPlannerOutput {
    plannerVersion: 'design-planner/mvp-v0';
    executionMode: DesignPlannerExecutionMode;
    readiness: DesignPlannerReadiness;
    intentContext: DesignIntentContext;
    planInputs: DesignPlanInputs;
    selectedContext: DesignPlannerSelectedContext;
    designDsl?: DesignDSL;
    executionPlan: ExecutionPlan;
    verificationPlan: VerificationReport;
    performancePolicy: AgentPerformancePolicy;
    blockers: string[];
    warnings: string[];
    limits: string[];
}

export interface DesignPlannerExecutionPreflightGateOptions {
    stage?: string;
    allowNeedsContextExecution?: boolean;
}

export interface DesignPlannerExecutionPreflightGate {
    gateVersion: 'design-planner/preflight-gate-v0';
    stage: string;
    readiness: DesignPlannerReadiness;
    decision: DesignPlannerPreflightDecision;
    shouldExecute: boolean;
    reason: string;
    blockers: string[];
    warnings: string[];
    requiredContext: string[];
    verificationTargets: string[];
    plannedStepIds: string[];
    limitations: string[];
}

function normalizeText(value: unknown): string {
    return String(value || '').trim();
}

function unique(values: string[]): string[] {
    return Array.from(new Set(values.map(item => item.trim()).filter(Boolean)));
}

function isPositiveNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function isChatOnlyIntent(intent: DesignIntentContext): boolean {
    return intent.action === 'chat' || (!intent.requiresPhotoshop && intent.targetScenario === 'unknown');
}

function isSaveOrExportIntent(intent: DesignIntentContext): boolean {
    return intent.action === 'save' || intent.action === 'export';
}

function hasReferenceAttachment(input: DesignPlannerInput): boolean {
    return Boolean(input.referenceRepresentation)
        || (input.attachments || []).some(item => item.kind === 'reference-image');
}

function hasUsableAsset(input: DesignPlannerInput): boolean {
    return (input.attachments || []).some(item => item.kind === 'asset-image' && (item.path || item.name))
        || (input.projectContext?.assets || []).some(item => item.path || item.name)
        || Boolean(input.projectContext?.assetIndex?.summary.totalImages);
}

function knowledgeHasDirectPhotoshopAction(results: DesignKnowledgeResult[]): boolean {
    return results.some(item => (item.allowedUses as unknown[]).includes('direct_photoshop_action'));
}

function scenarioFromInput(input: DesignPlannerInput): DesignAgentOsScenario | undefined {
    const text = normalizeText(input.userText);
    if (/保存|存成|导出/.test(text)) return undefined;
    if (/sku|SKU|组合图|双装|三双/.test(text)) return 'sku';
    if (/详情页|长图/.test(text)) return 'detail-page';
    if (/主图|白底图/.test(text)) return 'main-image';
    if (/参考图|复刻|照着|海报/.test(text) || hasReferenceAttachment(input)) return 'reference-replication';
    if (/文案|配文|标题|卖点/.test(text)) return 'copywriting';
    return undefined;
}

function mapScenarioToVisualSamplingScenario(scenario: DesignAgentOsScenario) {
    switch (scenario) {
        case 'main-image':
        case 'detail-page':
        case 'sku':
        case 'reference-replication':
        case 'general-design':
            return scenario;
        default:
            return 'general-design';
    }
}

function buildSelectedContext(
    input: DesignPlannerInput,
    performancePolicy?: AgentPerformancePolicy,
    options: {
        scenario?: DesignAgentOsScenario;
        requiresVisualObservation?: boolean;
    } = {}
): DesignPlannerSelectedContext {
    const knowledgeSelection = selectDesignKnowledgeResultsForUse(input.knowledgeResults, {
        query: input.userText,
        purpose: 'planning'
    });
    const knowledge = knowledgeSelection.usableResults;
    const attachments = input.attachments || [];
    const indexedAssets = (input.projectContext?.assetIndex?.assets || [])
        .filter((asset) => asset.isImage && !asset.isOutput && (asset.path || asset.name))
        .slice(0, 12)
        .map((asset) => ({
            id: asset.id,
            path: asset.path,
            name: asset.name,
            width: asset.width,
            height: asset.height,
            role: asset.role
        }));
    const assets = [
        ...(input.projectContext?.assets || []),
        ...indexedAssets
    ].slice(0, 12);
    const assetIndex = input.projectContext?.assetIndex
        ? {
            indexVersion: input.projectContext.assetIndex.indexVersion,
            totalFiles: input.projectContext.assetIndex.summary.totalFiles,
            totalImages: input.projectContext.assetIndex.summary.totalImages,
            roleCounts: input.projectContext.assetIndex.summary.roleCounts,
            visionCandidateCount: input.projectContext.assetIndex.visionCandidates.length,
            limitations: input.projectContext.assetIndex.limitations
        }
        : undefined;
    const visualSamplingPlan = input.projectContext?.visualSamplingPlan
        ? {
            planVersion: input.projectContext.visualSamplingPlan.planVersion,
            scenario: input.projectContext.visualSamplingPlan.scenario,
            maxCandidates: input.projectContext.visualSamplingPlan.maxCandidates,
            selectedCandidateCount: input.projectContext.visualSamplingPlan.selectedCandidates.length,
            shouldAnalyzeCount: input.projectContext.visualSamplingPlan.cacheSummary.shouldAnalyze,
            cacheSummary: input.projectContext.visualSamplingPlan.cacheSummary,
            limitations: input.projectContext.visualSamplingPlan.limitations
        }
        : undefined;
    const visualInsightCache = input.projectContext?.visualInsightCache
        ? {
            cacheVersion: input.projectContext.visualInsightCache.cacheVersion,
            source: input.projectContext.visualInsightCache.source,
            exists: input.projectContext.visualInsightCache.exists,
            totalEntries: input.projectContext.visualInsightCache.summary.totalEntries,
            entriesWithInsight: input.projectContext.visualInsightCache.summary.entriesWithInsight,
            limitations: input.projectContext.visualInsightCache.limitations
        }
        : undefined;
    const priorRunRecords = input.priorRunRecords || [];
    const productDesignUnderstanding = buildProjectDesignUnderstandingSummary({
        projectContext: input.projectContext
    });
    const businessVisualContext = buildBusinessSkillVisualContext({
        scenario: mapScenarioToVisualSamplingScenario(options.scenario || 'general-design'),
        projectPath: input.projectContext?.projectPath,
        assetIndex: input.projectContext?.assetIndex,
        visualSamplingPlan: input.projectContext?.visualSamplingPlan,
        visualInsightCache: input.projectContext?.visualInsightCache,
        requiresVisualObservation: options.requiresVisualObservation
    });
    const notes: string[] = [];
    if (knowledge.length) {
        notes.push(`知识结果 ${knowledge.length} 条只作为上下文，不直接执行 Photoshop。`);
    }
    if (knowledgeSelection.reviewResults.length > 0) {
        notes.push(`知识结果 ${knowledgeSelection.reviewResults.length} 条因过期或缺少版本只能待复核，未进入当前规划上下文。`);
    }
    if (knowledgeSelection.blockedResults.length > 0) {
        notes.push(`知识结果 ${knowledgeSelection.blockedResults.length} 条因撤回、取代或完整性异常已阻断。`);
    }
    if (input.referenceRepresentation) {
        notes.push('存在参考图结构化表示，可用于生成 DesignDSL。');
    }
    if (assetIndex) {
        notes.push(`项目素材索引 ${assetIndex.totalImages} 张图片；候选视觉抽样 ${assetIndex.visionCandidateCount} 张。`);
    }
    if (visualSamplingPlan) {
        notes.push(`视觉抽样计划 ${visualSamplingPlan.selectedCandidateCount}/${visualSamplingPlan.maxCandidates}；cache hit=${visualSamplingPlan.cacheSummary.hit}，待分析=${visualSamplingPlan.shouldAnalyzeCount}。`);
    }
    if (visualInsightCache) {
        notes.push(`视觉理解缓存 source=${visualInsightCache.source}；insights=${visualInsightCache.entriesWithInsight}/${visualInsightCache.totalEntries}。`);
    }
    for (const understandingLine of productDesignUnderstanding.lines.slice(0, 6)) {
        notes.push(`项目产品理解：${understandingLine}`);
    }
    if (performancePolicy) {
        notes.push(`性能策略 taskClass=${performancePolicy.taskClass}；maxToolCalls=${performancePolicy.budget.maxToolCalls}；maxVisionCandidates=${performancePolicy.budget.maxVisionCandidates}。`);
    }
    if (!attachments.length && !assets.length) {
        notes.push('未提供附件或项目素材。');
    }
    return {
        attachments,
        assets,
        assetIndex,
        visualSamplingPlan,
        visualInsightCache,
        businessVisualContext,
        knowledge,
        knowledgeUsageSnapshot: knowledgeSelection.snapshot,
        priorRunRecords,
        performancePolicy: performancePolicy
            ? {
                policyVersion: performancePolicy.policyVersion,
                taskClass: performancePolicy.taskClass,
                verificationTier: performancePolicy.verificationTier,
                budget: performancePolicy.budget,
                costProfile: performancePolicy.costProfile,
                controls: performancePolicy.controls
            }
            : undefined,
        notes
    };
}

function buildGenericDesignDsl(input: DesignPlannerInput, scenario: DesignAgentOsScenario): DesignDSL | undefined {
    const doc = input.currentDocument || null;
    if (!doc || !isPositiveNumber(doc.width) || !isPositiveNumber(doc.height)) return undefined;
    const width = Math.round(doc.width);
    const height = Math.round(doc.height);
    const documentSource = normalizeText(doc.path) || normalizeText(doc.name) || 'current-document';
    return {
        dslVersion: 'design-agent-os/v0',
        scenario,
        canvas: { width, height },
        layoutType: 'planner-generic-frame',
        regions: [
            {
                id: 'safe-area',
                kind: 'region',
                role: 'safe-area',
                box: {
                    x: Math.round(width * 0.08),
                    y: Math.round(height * 0.08),
                    width: Math.round(width * 0.84),
                    height: Math.round(height * 0.84)
                },
                styleKeys: []
            }
        ],
        constraints: [
            'Generic planner DSL only marks canvas and safe area; it is not a complete design layout.'
        ],
        sourceRefs: [{
            source: documentSource,
            summary: `当前 Photoshop 文档尺寸：${width}x${height}。`
        }]
    };
}

function buildPlannerDesignDsl(input: DesignPlannerInput, scenario: DesignAgentOsScenario): DesignDSL | undefined {
    if (input.referenceRepresentation) {
        const referenceSourceRefs = (input.attachments || [])
            .filter((attachment) => attachment.kind === 'reference-image')
            .map((attachment) => {
                const source = normalizeText(attachment.path) || normalizeText(attachment.name);
                return source
                    ? {
                        source,
                        summary: `参考素材：${normalizeText(attachment.name) || source}。`
                    }
                    : null;
            })
            .filter(Boolean) as DesignAgentSourceRef[];
        return buildDesignDslFromMinimalRepresentation(input.referenceRepresentation, {
            scenario,
            constraints: [
                'Planner 只消费参考图结构化表示，不还原原作者 PSD。',
                '该 DSL 是执行计划输入，不等于设计质量验收通过。'
            ],
            sourceRefs: referenceSourceRefs
        });
    }
    return buildGenericDesignDsl(input, scenario);
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

function buildPlannerSteps(input: DesignPlannerInput, intent: DesignIntentContext, dsl: DesignDSL | undefined): ExecutionPlanStep[] {
    const steps: ExecutionPlanStep[] = [];
    const knowledgeSelection = selectDesignKnowledgeResultsForUse(input.knowledgeResults, {
        query: input.userText,
        purpose: 'planning'
    });
    const knowledge = knowledgeSelection.usableResults;
    const assets = input.projectContext?.assets || [];
    const assetIndex = input.projectContext?.assetIndex;
    const visualSamplingPlan = input.projectContext?.visualSamplingPlan;
    const visualInsightCache = input.projectContext?.visualInsightCache;

    if (isChatOnlyIntent(intent)) {
        return [];
    }

    if (isSaveOrExportIntent(intent)) {
        steps.push(makeStep(
            'save-or-export',
            intent.action === 'export' ? 'exportDocument' : 'saveDocument',
            input.currentDocument?.name || 'active-document',
            { action: intent.action, documentId: input.currentDocument?.id || null },
            '用户请求保存或导出；不应因为文本里出现详情页/主图/SKU而生成设计。',
            ['document save/export result', 'file path or Photoshop document state']
        ));
        return steps;
    }

    steps.push(makeStep(
        'read-context',
        'readDesignContext',
        'project-and-photoshop-context',
        {
            hasCurrentDocument: Boolean(input.currentDocument),
            projectPath: input.projectContext?.projectPath || null,
            assetCount: assets.length,
            projectAssetIndex: assetIndex
                ? {
                    totalImages: assetIndex.summary.totalImages,
                    totalDesignDocuments: assetIndex.summary.totalDesignDocuments,
                    roleCounts: assetIndex.summary.roleCounts,
                    visionCandidateCount: assetIndex.visionCandidates.length
                }
                : null,
            visualSamplingPlan: visualSamplingPlan
                ? {
                    scenario: visualSamplingPlan.scenario,
                    selectedCandidateCount: visualSamplingPlan.selectedCandidates.length,
                    shouldAnalyzeCount: visualSamplingPlan.cacheSummary.shouldAnalyze,
                    cacheSummary: visualSamplingPlan.cacheSummary
                }
                : null,
            visualInsightCache: visualInsightCache
                ? {
                    source: visualInsightCache.source,
                    exists: visualInsightCache.exists,
                    totalEntries: visualInsightCache.summary.totalEntries,
                    entriesWithInsight: visualInsightCache.summary.entriesWithInsight
                }
                : null,
            attachmentCount: (input.attachments || []).length
        },
        '设计任务必须先确认项目、素材、当前文档和用户附件。',
        ['project assets', 'ProjectAssetIndex', 'VisualSamplingPlan', 'VisualInsightCache', 'current document info', 'attachments']
    ));

    if (knowledge.length) {
        steps.push(makeStep(
            'use-knowledge-context',
            'useKnowledgeContext',
            'selected-knowledge-results',
            {
                resultCount: knowledge.length,
                allowedUses: Array.from(new Set(knowledge.flatMap(item => item.allowedUses))),
                knowledgeSnapshotFingerprint: knowledgeSelection.snapshot.snapshotFingerprint,
                knowledgeContentFingerprints: knowledge.map((item) => item.governance?.contentFingerprint).filter(Boolean)
            },
            '知识搜索结果只进入 planner 上下文或 recipe 线索，不直接执行 Photoshop。',
            ['knowledge result ids', 'allowedUses', 'source summaries']
        ));
    }

    if (dsl) {
        steps.push(makeStep(
            'compose-design-dsl',
            'composeDesignDsl',
            dsl.layoutType || 'design-dsl',
            {
                regionCount: dsl.regions.length,
                canvas: dsl.canvas
            },
            '将视觉理解或当前文档约束转成可执行中间表示。',
            ['DesignDSL', 'regions', 'constraints']
        ));
    }

    if (hasUsableAsset(input)) {
        steps.push(makeStep(
            'select-asset',
            'selectAsset',
            'project-or-attached-assets',
            {
                projectAssetCount: assets.length,
                indexedImageCount: assetIndex?.summary.totalImages || 0,
                indexedVisionCandidateCount: assetIndex?.visionCandidates.length || 0,
                selectedVisualSampleCount: visualSamplingPlan?.selectedCandidates.length || 0,
                visualSamplesNeedingAnalysis: visualSamplingPlan?.cacheSummary.shouldAnalyze || 0,
                reusableVisualInsights: visualInsightCache?.summary.entriesWithInsight || 0,
                attachmentCount: (input.attachments || []).length
            },
            '从附件、项目素材或 ProjectAssetIndex 中选择候选素材，但 MVP 不在 planner 中执行真实 Photoshop 置入。',
            ['selected asset path', 'asset dimensions', 'asset role', 'ProjectAssetIndex candidate record', 'VisualSamplingPlan', 'VisualInsightCache']
        ));
    }

    steps.push(makeStep(
        'verify-after-execution',
        'verifyDesignResult',
        'photoshop-result',
        {
            requiredChecks: ['tool result', 'layer bounds', 'verification report']
        },
        '工具成功不等于设计完成；执行后必须完成结果读回与验收检查。',
        ['VerificationReport', 'bounds or screenshot check']
    ));

    return steps;
}

function determineReadiness(
    input: DesignPlannerInput,
    intent: DesignIntentContext,
    blockers: string[],
    warnings: string[]
): DesignPlannerReadiness {
    if (blockers.length) return 'blocked';
    if (isChatOnlyIntent(intent)) return 'ready';
    if (isSaveOrExportIntent(intent)) {
        if (!input.currentDocument) {
            warnings.push('保存/导出需要当前 Photoshop 文档上下文。');
            return 'needs_context';
        }
        return 'ready';
    }
    if (!hasReferenceAttachment(input) && !hasUsableAsset(input) && !input.currentDocument) {
        warnings.push('设计任务缺少参考图、项目素材或当前文档上下文。');
        return 'needs_context';
    }
    if (!hasReferenceAttachment(input) && intent.targetScenario === 'reference-replication') {
        warnings.push('参考图复刻任务缺少参考图输入。');
        return 'needs_context';
    }
    return 'ready';
}

function buildVerificationPlan(input: {
    scenario: DesignAgentOsScenario;
    readiness: DesignPlannerReadiness;
    blockers: string[];
    warnings: string[];
    steps: ExecutionPlanStep[];
}): VerificationReport {
    const status: DesignAgentOsStatus = input.readiness === 'blocked'
        ? 'failed'
        : input.readiness === 'ready'
            ? 'needs_review'
            : 'needs_review';
    return {
        reportId: 'design-planner-readiness',
        scenario: input.scenario,
        status,
        scope: 'task',
        summary: input.readiness === 'ready'
            ? 'Planner 已生成 plan-only 执行计划；仍需真实 Photoshop 执行和验收。'
            : input.readiness === 'blocked'
                ? 'Planner 发现阻断项，不能安全进入执行。'
                : 'Planner 需要更多上下文，不能编造素材或 Photoshop 状态。',
        checks: [
            {
                id: 'planner-readiness',
                label: 'Planner readiness',
                status,
                summary: `readiness=${input.readiness}; steps=${input.steps.length}。`
            },
            {
                id: 'planner-execution-boundary',
                label: '执行边界',
                status: 'needs_review',
                summary: '当前是 plan-only 输出，不代表 Photoshop 已执行。'
            }
        ],
        blockers: input.blockers,
        warnings: input.warnings,
        limitations: [
            'Design Planner MVP 只生成计划，不证明审美质量。',
            'ExecutionPlan 不能替代真实工具结果、bounds、截图或人工验收。',
            '知识搜索、智能缩放和文案记录只能作为上下文，不能跳过验收层。'
        ]
    };
}

export function planDesignTask(input: DesignPlannerInput): DesignPlannerOutput {
    const executionMode = input.executionMode || 'plan-only';
    const scenario = scenarioFromInput(input);
    const intentContext = buildDesignIntentContextFromText(input.userText, {
        scenario,
        constraints: [
            ...(input.constraints || []),
            'Design Planner MVP 只生成计划，不直接执行 Photoshop。'
        ]
    });
    const blockers: string[] = [];
    const warnings: string[] = [];
    const knowledge = input.knowledgeResults || [];
    const knowledgeSelection = selectDesignKnowledgeResultsForUse(knowledge, {
        query: input.userText,
        purpose: 'planning'
    });

    if (knowledgeHasDirectPhotoshopAction(knowledge)) {
        blockers.push('知识搜索结果包含 direct_photoshop_action 用途，违反 Planner 边界。');
    }
    if (knowledgeSelection.reviewResults.length > 0) {
        warnings.push(`${knowledgeSelection.reviewResults.length} 条知识因过期或缺少版本未进入规划上下文。`);
    }
    if (knowledgeSelection.blockedResults.length > 0) {
        warnings.push(`${knowledgeSelection.blockedResults.length} 条知识因撤回、取代或完整性异常被阻断。`);
    }
    if (executionMode !== 'plan-only') {
        warnings.push(`当前 MVP 只验证 plan-only；请求的 executionMode=${executionMode} 不能证明执行能力。`);
    }

    const performancePolicy = buildAgentPerformancePolicyFromIntent({
        intent: intentContext,
        hasAttachedImage: (input.attachments || []).some((item) => item.kind === 'reference-image' || item.kind === 'asset-image'),
        projectImageCount: input.projectContext?.assetIndex?.summary.totalImages || input.projectContext?.assets?.length || 0,
        visualSamplingCandidateCount: input.projectContext?.visualSamplingPlan?.selectedCandidates.length || 0
    });
    warnings.push(...performancePolicy.warnings);

    const scenarioForPlan = intentContext.targetScenario === 'unknown' ? 'general-design' : intentContext.targetScenario;
    const requiresVisualObservation = !isChatOnlyIntent(intentContext) && !isSaveOrExportIntent(intentContext);
    const selectedContext = buildSelectedContext(input, performancePolicy, {
        scenario: scenarioForPlan,
        requiresVisualObservation
    });
    const designDsl = isChatOnlyIntent(intentContext) || isSaveOrExportIntent(intentContext)
        ? undefined
        : buildPlannerDesignDsl(input, intentContext.targetScenario === 'unknown' ? 'general-design' : intentContext.targetScenario);
    const steps = buildPlannerSteps(input, intentContext, designDsl);
    const readiness = determineReadiness(input, intentContext, blockers, warnings);
    const planInputs = buildDesignPlanInputsFromIntent(intentContext, {
        goal: intentContext.normalizedText || '未提供明确设计任务。',
        constraints: [
            ...(input.constraints || []),
            `readiness=${readiness}`,
            `executionMode=${executionMode}`
        ]
    });
    const executionPlan: ExecutionPlan = {
        planId: 'design-planner-mvp-plan',
        scenario: scenarioForPlan,
        status: readiness === 'ready' ? 'planned' : steps.length ? 'partial' : 'unknown',
        steps,
        inputs: intentContext.sourceRefs,
        limitations: [
            'Planner MVP 不调用 Photoshop，不改变已有执行器参数。',
            'Planner 输出是控制层计划，不是设计质量完成结论。'
        ]
    };

    return {
        plannerVersion: 'design-planner/mvp-v0',
        executionMode,
        readiness,
        intentContext,
        planInputs,
        selectedContext,
        designDsl,
        executionPlan,
        verificationPlan: buildVerificationPlan({
            scenario: scenarioForPlan,
            readiness,
            blockers,
            warnings,
            steps
        }),
        performancePolicy,
        blockers,
        warnings,
        limits: [
            '不暴露私有 chain-of-thought。',
            '不把知识搜索结果直接变成 Photoshop 动作。',
            '不把 planned destinationBox 当成执行后 bounds。',
            '不把 plan-only 输出声明为自动设计完成。',
            '性能策略只定义预算和资源边界，不改变 Photoshop 执行行为。'
        ]
    };
}

export function mapPlannerOutputToDesignAgentOsRecord(output: DesignPlannerOutput): DesignAgentOsRecord {
    return {
        intentContext: output.intentContext,
        planInputs: output.planInputs,
        designDsl: output.designDsl,
        executionPlan: output.executionPlan,
        executionTrace: buildExecutionTraceFromToolResults([], output.executionPlan.scenario),
        verificationReport: output.verificationPlan
    };
}

function extractRequiredContext(output: DesignPlannerOutput): string[] {
    const required = new Set<string>();
    for (const warning of output.warnings) {
        if (/参考图/.test(warning)) required.add('reference-image');
        if (/项目素材|素材/.test(warning)) required.add('project-or-attached-assets');
        if (/当前 Photoshop 文档|当前文档/.test(warning)) required.add('current-photoshop-document');
    }
    if (output.readiness === 'needs_context' && required.size === 0) {
        required.add('additional-design-context');
    }
    return Array.from(required);
}

function extractVerificationTargets(output: DesignPlannerOutput): string[] {
    const targets = new Set<string>();
    for (const step of output.executionPlan.steps || []) {
        for (const item of step.expectedOutcomes || []) {
            targets.add(item);
        }
    }
    if (targets.size === 0 && output.intentContext.requiresPhotoshop) {
        targets.add('VerificationReport');
    }
    return Array.from(targets);
}

export function buildPlannerExecutionPreflightGate(
    output: DesignPlannerOutput,
    options: DesignPlannerExecutionPreflightGateOptions = {}
): DesignPlannerExecutionPreflightGate {
    const stage = normalizeText(options.stage) || 'planner-execution-preflight';
    const allowNeedsContextExecution = options.allowNeedsContextExecution === true;
    const requiredContext = extractRequiredContext(output);
    const verificationTargets = extractVerificationTargets(output);
    const plannedStepIds = (output.executionPlan.steps || []).map((step) => step.id);

    if (output.readiness === 'blocked') {
        return {
            gateVersion: 'design-planner/preflight-gate-v0',
            stage,
            readiness: output.readiness,
            decision: 'block',
            shouldExecute: false,
            reason: 'Planner 发现阻断项，禁止进入 Photoshop 执行。',
            blockers: output.blockers,
            warnings: output.warnings,
            requiredContext,
            verificationTargets,
            plannedStepIds,
            limitations: [
                'Preflight gate only decides whether execution may start.',
                'It does not run Photoshop and does not prove design quality.'
            ]
        };
    }

    if (output.readiness === 'needs_context' && !allowNeedsContextExecution) {
        return {
            gateVersion: 'design-planner/preflight-gate-v0',
            stage,
            readiness: output.readiness,
            decision: 'request_context',
            shouldExecute: false,
            reason: 'Planner 缺少必要上下文，不能安全进入 Photoshop 执行。',
            blockers: output.blockers,
            warnings: output.warnings,
            requiredContext,
            verificationTargets,
            plannedStepIds,
            limitations: [
                'needs_context is a safe stop for open-ended design tasks.',
                'Deterministic simple Photoshop operations may bypass this gate in their own control plane.'
            ]
        };
    }

    return {
        gateVersion: 'design-planner/preflight-gate-v0',
        stage,
        readiness: output.readiness,
        decision: 'execute',
        shouldExecute: true,
        reason: output.readiness === 'needs_context'
            ? 'Planner 缺少部分上下文，但调用方显式允许带警告执行。'
            : 'Planner readiness=ready，可以进入执行并继续收集读回结果与验收检查。',
        blockers: output.blockers,
        warnings: output.warnings,
        requiredContext,
        verificationTargets,
        plannedStepIds,
        limitations: [
            'Execution permission is not a success claim.',
            'The executor must still produce ExecutionTrace and VerificationReport.'
        ]
    };
}
