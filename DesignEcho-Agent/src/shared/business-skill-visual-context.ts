import type { ProjectAssetIndex } from './project-asset-index';
import type { ProjectVisualInsightCacheReadResult } from './project-visual-insight-cache';
import {
    hasConcreteProjectVisualInsight,
    type ProjectVisualSamplingCandidate,
    type ProjectVisualSamplingPlan,
    type ProjectVisualSamplingScenario
} from './project-visual-sampling';

export type BusinessSkillVisualContextVersion = 'business-skill-visual-context/v0';
export type BusinessSkillVisualContextStatus =
    | 'not_required'
    | 'ready'
    | 'partial'
    | 'needs_context_snapshot'
    | 'needs_visual_insight'
    | 'no_visual_candidates';

export interface BusinessSkillVisualObservationRecord {
    source: string;
    summary: string;
}

export interface BusinessSkillVisualContextCandidateSummary {
    assetIndexImageCount: number;
    assetIndexVisionCandidateCount: number;
    selectedCandidateCount: number;
    shouldAnalyzeCount: number;
    skippedCandidateCount: number;
    contextualSourceCandidateCount: number;
}

export interface BusinessSkillVisualContextCacheSummary {
    source?: ProjectVisualInsightCacheReadResult['source'];
    exists: boolean;
    totalEntries: number;
    entriesWithInsight: number;
    hit: number;
    miss: number;
    stale: number;
}

export interface BusinessSkillVisualContext {
    version: BusinessSkillVisualContextVersion;
    scenario: ProjectVisualSamplingScenario;
    status: BusinessSkillVisualContextStatus;
    reason: string;
    candidateSummary: BusinessSkillVisualContextCandidateSummary;
    cacheSummary: BusinessSkillVisualContextCacheSummary;
    requiredInputs: string[];
    warnings: string[];
    limitations: string[];
    observations: BusinessSkillVisualObservationRecord[];
}

export interface BuildBusinessSkillVisualContextInput {
    scenario?: ProjectVisualSamplingScenario;
    projectPath?: string | null;
    assetIndex?: ProjectAssetIndex | null;
    visualSamplingPlan?: ProjectVisualSamplingPlan | null;
    visualInsightCache?: ProjectVisualInsightCacheReadResult | null;
    requiresVisualObservation?: boolean;
    contextualSourceCandidateCount?: number;
}

function cleanString(value: unknown): string {
    return String(value || '').trim();
}

function normalizeScenario(value: unknown): ProjectVisualSamplingScenario {
    const scenario = cleanString(value);
    const allowed: ProjectVisualSamplingScenario[] = [
        'main-image',
        'detail-page',
        'sku',
        'reference-replication',
        'general-design',
        'unknown'
    ];
    return allowed.includes(scenario as ProjectVisualSamplingScenario)
        ? scenario as ProjectVisualSamplingScenario
        : 'unknown';
}

function buildCandidateSummary(input: BuildBusinessSkillVisualContextInput): BusinessSkillVisualContextCandidateSummary {
    const assetIndex = input.assetIndex || null;
    const visualSamplingPlan = input.visualSamplingPlan || null;
    const contextualSourceCandidateCount = Math.max(0, Math.floor(Number(input.contextualSourceCandidateCount || 0)));
    return {
        assetIndexImageCount: assetIndex?.summary.totalImages || 0,
        assetIndexVisionCandidateCount: assetIndex?.visionCandidates.length || 0,
        selectedCandidateCount: visualSamplingPlan?.selectedCandidates.length || 0,
        shouldAnalyzeCount: visualSamplingPlan?.cacheSummary.shouldAnalyze || 0,
        skippedCandidateCount: visualSamplingPlan?.skippedCandidateCount || 0,
        contextualSourceCandidateCount
    };
}

function buildCacheSummary(input: BuildBusinessSkillVisualContextInput): BusinessSkillVisualContextCacheSummary {
    const cache = input.visualInsightCache || null;
    const visualSamplingPlan = input.visualSamplingPlan || null;
    const cacheEntries = Array.isArray(cache?.entries) ? cache.entries : [];
    const candidates: ProjectVisualSamplingCandidate[] = Array.isArray(visualSamplingPlan?.selectedCandidates)
        ? visualSamplingPlan.selectedCandidates
        : [];
    return {
        source: cache?.source,
        exists: Boolean(cache?.exists),
        totalEntries: cache?.summary.totalEntries || 0,
        entriesWithInsight: cacheEntries.filter((entry) => hasConcreteProjectVisualInsight(entry.insight)).length,
        hit: candidates.filter((candidate) => (
            candidate.cacheStatus === 'hit'
            && hasConcreteProjectVisualInsight(candidate.cachedInsight)
        )).length,
        miss: visualSamplingPlan?.cacheSummary.miss || 0,
        stale: visualSamplingPlan?.cacheSummary.stale || 0
    };
}

function determineStatus(input: {
    requiresVisualObservation: boolean;
    hasProjectContext: boolean;
    candidateSummary: BusinessSkillVisualContextCandidateSummary;
    cacheSummary: BusinessSkillVisualContextCacheSummary;
}): BusinessSkillVisualContextStatus {
    if (!input.requiresVisualObservation) return 'not_required';
    if (!input.hasProjectContext) return 'needs_context_snapshot';
    if (input.candidateSummary.selectedCandidateCount <= 0) {
        if (input.candidateSummary.contextualSourceCandidateCount > 0) return 'needs_visual_insight';
        return input.cacheSummary.entriesWithInsight > 0 ? 'ready' : 'no_visual_candidates';
    }
    if (input.candidateSummary.shouldAnalyzeCount > 0) {
        return input.cacheSummary.hit > 0 || input.cacheSummary.entriesWithInsight > 0
            ? 'partial'
            : 'needs_visual_insight';
    }
    return input.cacheSummary.hit > 0 || input.cacheSummary.entriesWithInsight > 0
        ? 'ready'
        : 'needs_visual_insight';
}

function statusReason(status: BusinessSkillVisualContextStatus): string {
    switch (status) {
        case 'not_required':
            return '当前任务不需要额外素材理解。';
        case 'ready':
            return '当前设计任务已具备可复用的素材理解，暂不需要新增分析。';
        case 'partial':
            return '当前设计任务只有部分素材理解结果，仍有候选图需要视觉模型或人工确认。';
        case 'needs_context_snapshot':
            return '缺少项目上下文或素材索引，暂时不能可靠理解项目素材。';
        case 'needs_visual_insight':
            return '已找到候选素材，但还缺少可用的视觉理解结果。';
        case 'no_visual_candidates':
            return '当前没有可用于这个设计任务的图片候选。';
        default:
            return '素材理解状态未知。';
    }
}

function buildRequiredInputs(status: BusinessSkillVisualContextStatus): string[] {
    switch (status) {
        case 'needs_context_snapshot':
            return ['project_context', 'project_asset_index', 'visual_sampling_plan'];
        case 'needs_visual_insight':
        case 'partial':
            return ['visual_understanding'];
        case 'no_visual_candidates':
            return ['project_image_candidates'];
        default:
            return [];
    }
}

function buildWarnings(status: BusinessSkillVisualContextStatus): string[] {
    switch (status) {
        case 'ready':
        case 'not_required':
            return [];
        case 'partial':
            return ['视觉洞察缓存只覆盖部分候选；执行器不能把未分析候选的款式、材质、场景或卖点编造成事实。'];
        case 'needs_context_snapshot':
            return ['缺少项目上下文快照时，Agent 只能请求上下文或使用用户明确提供的素材，不能扫描全项目后直接猜。'];
        case 'needs_visual_insight':
            return ['已有候选素材但缺少视觉洞察；应显式 opt-in 调用视觉模型或等待人工确认。'];
        case 'no_visual_candidates':
            return ['项目索引未提供当前业务场景的视觉候选；需要用户选择图片或刷新项目素材索引。'];
        default:
            return [];
    }
}

export function buildBusinessSkillVisualContext(
    input: BuildBusinessSkillVisualContextInput
): BusinessSkillVisualContext {
    const scenario = normalizeScenario(input.scenario);
    const requiresVisualObservation = input.requiresVisualObservation !== false;
    const candidateSummary = buildCandidateSummary(input);
    const cacheSummary = buildCacheSummary(input);
    const hasProjectContext = Boolean(
        input.assetIndex
        || input.visualSamplingPlan
        || input.visualInsightCache?.exists
        || cleanString(input.projectPath)
    );
    const status = determineStatus({
        requiresVisualObservation,
        hasProjectContext,
        candidateSummary,
        cacheSummary
    });
    return {
        version: 'business-skill-visual-context/v0',
        scenario,
        status,
        reason: statusReason(status),
        candidateSummary,
        cacheSummary,
        requiredInputs: buildRequiredInputs(status),
        warnings: buildWarnings(status),
        limitations: [
            '这一步只描述当前素材理解情况，不决定业务 Skill 是否执行。',
            '已有素材理解只用于补充任务上下文，不代表主图、详情页、SKU 或复刻结果质量。',
            'Photoshop 写入权限继续由既有 Tool preflight 与 Policy 管理。'
        ],
        observations: []
    };
}
