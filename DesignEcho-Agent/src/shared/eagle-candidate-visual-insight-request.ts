import type {
    EagleCandidateVisualCheck,
    EagleCandidateVisualHandoff,
    EagleCandidateVisualHandoffCandidateSnapshot,
    EagleCandidateVisualObservationRequest
} from './eagle-candidate-visual-handoff';
import {
    buildProjectVisualInsightCacheFillPlan,
    type ProjectVisualInsightCacheFillPlan
} from './project-visual-insight-cache-fill';
import type {
    ProjectVisualSamplingCandidate,
    ProjectVisualSamplingPlan,
    ProjectVisualSamplingScenario
} from './project-visual-sampling';
import type { ProjectAssetRole } from './project-asset-index';

export type EagleCandidateVisualInsightRequestVersion = 'eagle-candidate-visual-insight-request/v0';
export type EagleCandidateVisualInsightRequestStatus =
    | 'blocked_handoff_not_ready'
    | 'blocked_missing_project_asset_ref'
    | 'ready_for_visual_insight_fill_plan';

export type EagleCandidateProjectAssetRefSource =
    | 'project-asset-index'
    | 'project-context'
    | 'user-selection'
    | 'manual-review';

export interface EagleCandidateProjectAssetRef {
    assetId?: string;
    projectRelativePath: string;
    role?: ProjectAssetRole;
    source: EagleCandidateProjectAssetRefSource;
}

export interface BuildEagleCandidateVisualInsightRequestInput {
    handoff?: EagleCandidateVisualHandoff | null;
    projectAssetRef?: Partial<EagleCandidateProjectAssetRef> | null;
    projectPath?: unknown;
    requestedBy?: unknown;
    generatedAt?: unknown;
    cacheFillEnabled?: unknown;
    runtimeCanAnalyze?: boolean;
    runtimeCanWriteCache?: boolean;
    maxCandidates?: number;
    scenario?: ProjectVisualSamplingScenario;
}

export interface EagleCandidateVisualInsightRequestSideEffects {
    shouldRunEagleNow: false;
    shouldRunAgentRuntimeNow: false;
    shouldRunAnalyzerNow: false;
    shouldWriteCacheNow: false;
    shouldCallPhotoshopNow: false;
}

export interface EagleCandidateVisualInsightRequest {
    version: EagleCandidateVisualInsightRequestVersion;
    status: EagleCandidateVisualInsightRequestStatus;
    statusLabel: string;
    generatedAt: string;
    requestedBy: string;
    selectedCandidate: EagleCandidateVisualHandoffCandidateSnapshot | null;
    projectPath?: string;
    projectAssetRef?: EagleCandidateProjectAssetRef;
    requestedObservations: EagleCandidateVisualObservationRequest[];
    requiredChecks: EagleCandidateVisualCheck[];
    metadataHints: string[];
    visualSamplingPlan?: ProjectVisualSamplingPlan;
    fillPlan?: ProjectVisualInsightCacheFillPlan;
    sideEffects: EagleCandidateVisualInsightRequestSideEffects;
    requiredRuntimeContext: string[];
    requiredReview: string[];
    blockers: string[];
    warnings: string[];
    limitations: string[];
    boundary: string;
    canRunEagle: false;
    canRunAgentRuntime: false;
    canRunPhotoshop: false;
    canClaimVisualAnalysisComplete: false;
    canClaimDesignQuality: false;
}

const STATUS_LABELS: Record<EagleCandidateVisualInsightRequestStatus, string> = {
    blocked_handoff_not_ready: 'Eagle 候选交接未就绪',
    blocked_missing_project_asset_ref: '缺少项目素材引用',
    ready_for_visual_insight_fill_plan: '已生成视觉洞察填充计划请求'
};

const VALID_PROJECT_ASSET_REF_SOURCES = new Set<EagleCandidateProjectAssetRefSource>([
    'project-asset-index',
    'project-context',
    'user-selection',
    'manual-review'
]);

const VALID_PROJECT_ASSET_ROLES = new Set<ProjectAssetRole>([
    'raw-model-wear',
    'raw-product-still',
    'raw-detail-closeup',
    'color-single',
    'main-image-output',
    'sku-output',
    'detail-page-slice',
    'template',
    'psd',
    'config',
    'archive',
    'unknown'
]);

const COMMON_LIMITATIONS = [
    '该请求只把已选择的 Eagle 候选和显式项目素材引用转换为视觉洞察填充计划，不会自动执行分析。',
    'Eagle 标签、文件夹、备注和尺寸只能作为元数据提示，不能当作已经观察到的主体、主色、构图、OCR 或设计质量结论。',
    '真正的视觉模型分析和缓存写入必须由独立 runner 在显式启用后执行。',
    '该请求不改变 Photoshop 执行参数，不生成图层操作，不声明主图、详情页或 SKU 质量通过。'
];

const BOUNDARY = 'Eagle candidate visual insight request 是纯 shared 契约；不调用 Eagle、Agent runtime、视觉模型、缓存写入器或 Photoshop。';

function cleanString(value: unknown): string {
    return String(value || '')
        .replace(/data:image\/[a-z0-9.+-]+;[^\s"'<>]+/gi, '[已移除图片内容]')
        .replace(/\bbase64\b/gi, '[已移除编码内容]')
        .replace(/\brawImage\b/gi, '[已移除图片字段]')
        .replace(/[A-Za-z]:\\[^\s，。；;'"<>]+/g, '[已移除本地路径]')
        .replace(/\s+/g, ' ')
        .trim();
}

function cleanPath(value: unknown): string {
    return cleanString(value).replace(/\\/g, '/').replace(/^\/+/, '').trim();
}

function isUnsafeProjectRelativePath(pathValue: string): boolean {
    return !pathValue
        || pathValue.includes('[已移除本地路径]')
        || /^[A-Za-z]:\//.test(pathValue)
        || /^https?:\/\//i.test(pathValue)
        || /^data:/i.test(pathValue);
}

function cleanStringList(value: unknown): string[] {
    const values = Array.isArray(value) ? value : [value];
    return uniqueStrings(values.map(cleanString));
}

function uniqueStrings(values: string[]): string[] {
    return Array.from(new Set(values.map(cleanString).filter(Boolean)));
}

function cleanIsoTime(value: unknown): string {
    const text = cleanString(value);
    if (!text) return new Date().toISOString();
    const date = new Date(text);
    return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function stableHash(value: string): string {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
}

function normalizeRole(value: unknown): ProjectAssetRole {
    const role = cleanString(value) as ProjectAssetRole;
    return VALID_PROJECT_ASSET_ROLES.has(role) ? role : 'unknown';
}

function normalizeProjectAssetRef(value: Partial<EagleCandidateProjectAssetRef> | null | undefined): EagleCandidateProjectAssetRef | null {
    const projectRelativePath = cleanPath(value?.projectRelativePath);
    if (isUnsafeProjectRelativePath(projectRelativePath)) return null;
    const source = cleanString(value?.source) as EagleCandidateProjectAssetRefSource;
    return {
        assetId: cleanString(value?.assetId) || `eagle-project-asset-${stableHash(projectRelativePath)}`,
        projectRelativePath,
        role: normalizeRole(value?.role),
        source: VALID_PROJECT_ASSET_REF_SOURCES.has(source) ? source : 'manual-review'
    };
}

function buildBaseRequest(input: {
    status: EagleCandidateVisualInsightRequestStatus;
    generatedAt: string;
    requestedBy: string;
    selectedCandidate: EagleCandidateVisualHandoffCandidateSnapshot | null;
    projectPath?: string;
    projectAssetRef?: EagleCandidateProjectAssetRef;
    requestedObservations?: EagleCandidateVisualObservationRequest[];
    requiredChecks?: EagleCandidateVisualCheck[];
    metadataHints?: string[];
    visualSamplingPlan?: ProjectVisualSamplingPlan;
    fillPlan?: ProjectVisualInsightCacheFillPlan;
    requiredRuntimeContext?: string[];
    requiredReview?: string[];
    blockers?: string[];
    warnings?: string[];
    sourceSummary: string;
}): EagleCandidateVisualInsightRequest {
    return {
        version: 'eagle-candidate-visual-insight-request/v0',
        status: input.status,
        statusLabel: STATUS_LABELS[input.status],
        generatedAt: input.generatedAt,
        requestedBy: input.requestedBy,
        selectedCandidate: input.selectedCandidate,
        projectPath: input.projectPath || undefined,
        projectAssetRef: input.projectAssetRef,
        requestedObservations: input.requestedObservations || [],
        requiredChecks: input.requiredChecks || [],
        metadataHints: input.metadataHints || [],
        visualSamplingPlan: input.visualSamplingPlan,
        fillPlan: input.fillPlan,
        sideEffects: {
            shouldRunEagleNow: false,
            shouldRunAgentRuntimeNow: false,
            shouldRunAnalyzerNow: false,
            shouldWriteCacheNow: false,
            shouldCallPhotoshopNow: false
        },
        requiredRuntimeContext: uniqueStrings(input.requiredRuntimeContext || []),
        requiredReview: uniqueStrings(input.requiredReview || []),
        blockers: uniqueStrings(input.blockers || []),
        warnings: uniqueStrings(input.warnings || []),
        limitations: COMMON_LIMITATIONS,
        boundary: BOUNDARY,
        canRunEagle: false,
        canRunAgentRuntime: false,
        canRunPhotoshop: false,
        canClaimVisualAnalysisComplete: false,
        canClaimDesignQuality: false
    };
}

function buildVisualSamplingPlan(input: {
    candidate: EagleCandidateVisualHandoffCandidateSnapshot;
    projectAssetRef: EagleCandidateProjectAssetRef;
    requestedObservations: EagleCandidateVisualObservationRequest[];
    metadataHints: string[];
    generatedAt: string;
    scenario: ProjectVisualSamplingScenario;
}): ProjectVisualSamplingPlan {
    const cacheKey = `project-visual:eagle-candidate-${stableHash([
        input.projectAssetRef.assetId,
        input.projectAssetRef.projectRelativePath,
        input.candidate.candidateId
    ].join('|'))}`;
    const requiredObservations = uniqueStrings([
        ...input.requestedObservations,
        'image pixels or thumbnail must be inspected by a visual model or human',
        'project asset ref must be verified against ProjectAssetIndex before execution'
    ]);
    const samplingCandidate: ProjectVisualSamplingCandidate = {
        assetId: input.projectAssetRef.assetId || `eagle-project-asset-${stableHash(input.projectAssetRef.projectRelativePath)}`,
        path: input.projectAssetRef.projectRelativePath,
        role: input.projectAssetRef.role || 'unknown',
        priority: 95,
        score: 95,
        reason: `Eagle 候选 ${input.candidate.candidateId} 已显式选择，并由 ${input.projectAssetRef.source} 关联到项目素材；仍需真实画面观察。`,
        cacheKey,
        cacheStatus: 'miss',
        shouldAnalyze: true,
        requiredObservations,
        selectionNotes: [{
            source: input.projectAssetRef.projectRelativePath,
            summary: `${input.projectAssetRef.projectRelativePath} queued from selected Eagle candidate metadata; visual observation still required.`
        }]
    };

    return {
        planVersion: 'project-visual-sampling/v0',
        mode: 'bounded-metadata-plan',
        scenario: input.scenario,
        maxCandidates: 1,
        selectedCandidates: [samplingCandidate],
        skippedCandidateCount: 0,
        cacheSummary: {
            hit: 0,
            miss: 1,
            stale: 0,
            shouldAnalyze: 1
        },
        warnings: [],
        limitations: [
            '该 VisualSamplingPlan 来自 Eagle 候选交接和显式项目素材引用，只包含一个有界候选。',
            '该计划不读取图片像素，不调用视觉模型，不写缓存。',
            'Eagle 元数据只能辅助排序和提示，不能替代真实视觉分析。'
        ],
        sourceRecords: [
            {
                source: input.projectAssetRef.projectRelativePath,
                summary: `项目素材引用：${input.projectAssetRef.projectRelativePath}`
            }
        ]
    };
}

export function buildEagleCandidateVisualInsightRequest(
    input: BuildEagleCandidateVisualInsightRequestInput = {}
): EagleCandidateVisualInsightRequest {
    const generatedAt = cleanIsoTime(input.generatedAt);
    const requestedBy = cleanString(input.requestedBy) || 'unknown';
    const handoff = input.handoff || null;
    const selectedCandidate = handoff?.selectedCandidate || null;
    const requestedObservations = handoff?.visualAnalysisRequest?.requestedObservations || [];
    const requiredChecks = handoff?.visualAnalysisRequest?.requiredChecks || [];
    const metadataHints = cleanStringList(handoff?.visualAnalysisRequest?.metadataHints);
    const projectPath = cleanString(input.projectPath).replace(/\\/g, '/');
    const requiredReview = uniqueStrings([
        ...(handoff?.requiredReview || []),
        'visual_insight_cache_fill_runner_required'
    ]);

    if (!handoff || handoff.status !== 'ready_for_visual_analysis_request' || !selectedCandidate) {
        return buildBaseRequest({
            status: 'blocked_handoff_not_ready',
            generatedAt,
            requestedBy,
            selectedCandidate: null,
            requestedObservations: [],
            requiredChecks: [],
            metadataHints: [],
            requiredRuntimeContext: ['ready_eagle_candidate_visual_handoff_required'],
            blockers: [
                'ready_eagle_candidate_visual_handoff_required',
                ...(handoff?.blockers || [])
            ],
            warnings: handoff?.warnings || [],
            sourceSummary: 'Eagle candidate handoff is not ready; no visual sampling or cache fill plan was created.'
        });
    }

    const projectAssetRef = normalizeProjectAssetRef(input.projectAssetRef);
    if (!projectAssetRef) {
        return buildBaseRequest({
            status: 'blocked_missing_project_asset_ref',
            generatedAt,
            requestedBy,
            selectedCandidate,
            requestedObservations,
            requiredChecks,
            metadataHints,
            requiredRuntimeContext: [
                'project_asset_ref_required',
                'project_relative_path_required',
                'project_asset_ref_must_not_use_eagle_local_path'
            ],
            requiredReview,
            blockers: ['project_asset_ref_required'],
            warnings: handoff.warnings,
            sourceSummary: 'Selected Eagle candidate is ready, but no explicit project asset ref was provided.'
        });
    }

    const scenario = input.scenario || 'general-design';
    const visualSamplingPlan = buildVisualSamplingPlan({
        candidate: selectedCandidate,
        projectAssetRef,
        requestedObservations,
        metadataHints,
        generatedAt,
        scenario
    });
    const fillPlan = buildProjectVisualInsightCacheFillPlan({
        projectPath,
        visualSamplingPlan,
        enabled: input.cacheFillEnabled,
        hasAnalyzer: input.runtimeCanAnalyze === true,
        hasWriter: input.runtimeCanWriteCache === true,
        maxCandidates: input.maxCandidates
    });

    return buildBaseRequest({
        status: 'ready_for_visual_insight_fill_plan',
        generatedAt,
        requestedBy,
        selectedCandidate,
        projectPath,
        projectAssetRef,
        requestedObservations,
        requiredChecks,
        metadataHints,
        visualSamplingPlan,
        fillPlan,
        requiredRuntimeContext: uniqueStrings([
            fillPlan.enabled ? '' : 'visual_insight_cache_fill_explicit_enable_required',
            fillPlan.shouldCallAnalyzer ? '' : 'visual_insight_cache_fill_runner_may_still_be_blocked',
            projectPath ? '' : 'project_path_required_for_cache_write'
        ]),
        requiredReview,
        warnings: uniqueStrings([
            ...handoff.warnings,
            ...fillPlan.warnings
        ]),
        sourceSummary: `Built visual insight fill plan request for ${projectAssetRef.projectRelativePath}; execution remains separate.`
    });
}
