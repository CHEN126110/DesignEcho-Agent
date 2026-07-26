import type { BusinessDesignSkillId } from './business-skill-implementation-checkpoint';
import type { ProjectAssetIndex, ProjectAssetRole } from './project-asset-index';
import type { ProjectVisualInsightCacheReadResult } from './project-visual-insight-cache';
import {
    hasConcreteProjectVisualInsight,
    type ProjectVisualInsight,
    type ProjectVisualSamplingCandidate,
    type ProjectVisualSamplingPlan,
    type ProjectVisualSamplingScenario
} from './project-visual-sampling';

export type ProjectAssetUnderstandingIntakeStatus =
    | 'ready_with_cached_visual_observations'
    | 'needs_bounded_visual_analysis'
    | 'needs_visual_sampling_plan'
    | 'needs_project_assets'
    | 'needs_context_snapshot';

export interface ProjectAssetUnderstandingCandidate {
    assetId: string;
    path: string;
    role: ProjectAssetRole;
    cacheStatus: string;
    shouldAnalyze: boolean;
    reason: string;
    cachedInsightSummary?: string;
    cachedProductType?: string;
    cachedScene?: string;
    cachedMaterial?: string;
    styleTags: string[];
}

export interface ProjectAssetUnderstandingCoverage {
    totalImages: number;
    totalCandidates: number;
    selectedCandidates: number;
    cacheHits: number;
    cacheMisses: number;
    staleCandidates: number;
    shouldAnalyze: number;
    entriesWithInsight: number;
}

export interface BuildProjectAssetUnderstandingIntakeInput {
    skillId: BusinessDesignSkillId;
    projectContext?: {
        projectPath?: string;
        assetIndex?: ProjectAssetIndex;
        visualSamplingPlan?: ProjectVisualSamplingPlan;
        visualInsightCache?: ProjectVisualInsightCacheReadResult;
    } | null;
}

export interface ProjectAssetUnderstandingIntake {
    version: 'project-asset-understanding-intake/v0';
    skillId: BusinessDesignSkillId;
    scenario: ProjectVisualSamplingScenario | 'unknown';
    status: ProjectAssetUnderstandingIntakeStatus;
    projectPath?: string;
    hasProjectContext: boolean;
    hasAssetIndex: boolean;
    hasVisualSamplingPlan: boolean;
    hasVisualInsightCache: boolean;
    canUseCachedVisualObservations: boolean;
    canSelectAssetsForDesign: boolean;
    canClaimDesignQuality: false;
    controlContextOnly: true;
    userVisible: false;
    mustNotChangeBusinessStrategy: true;
    mustNotChangeExecutor: true;
    roleCounts: Partial<Record<ProjectAssetRole, number>>;
    skillReadinessStatus?: string;
    selectedCandidates: ProjectAssetUnderstandingCandidate[];
    visualInsightCoverage: ProjectAssetUnderstandingCoverage;
    requiredNextObservations: string[];
    blockers: string[];
    warnings: string[];
    limitations: string[];
}

export function buildProjectAssetUnderstandingIntake(
    input: BuildProjectAssetUnderstandingIntakeInput
): ProjectAssetUnderstandingIntake {
    const projectContext = input.projectContext || null;
    const assetIndex = projectContext?.assetIndex;
    const visualSamplingPlan = projectContext?.visualSamplingPlan;
    const visualInsightCache = projectContext?.visualInsightCache;
    const selectedCandidates = sanitizeCandidates(visualSamplingPlan?.selectedCandidates);
    const coverage = buildCoverage(assetIndex, visualSamplingPlan, visualInsightCache, selectedCandidates);
    const status = buildStatus({
        hasProjectContext: Boolean(projectContext),
        assetIndex,
        visualSamplingPlan,
        coverage
    });
    const requiredNextObservations = buildRequiredNextObservations(status);
    const blockers = buildBlockers(status);
    const warnings = buildWarnings(assetIndex, visualSamplingPlan, visualInsightCache, status);

    return {
        version: 'project-asset-understanding-intake/v0',
        skillId: input.skillId,
        scenario: visualSamplingPlan?.scenario || scenarioFromSkillId(input.skillId),
        status,
        projectPath: normalizePath(projectContext?.projectPath || assetIndex?.projectPath),
        hasProjectContext: Boolean(projectContext),
        hasAssetIndex: Boolean(assetIndex),
        hasVisualSamplingPlan: Boolean(visualSamplingPlan),
        hasVisualInsightCache: Boolean(visualInsightCache),
        canUseCachedVisualObservations: coverage.entriesWithInsight > 0 || coverage.cacheHits > 0,
        canSelectAssetsForDesign: selectedCandidates.length > 0,
        canClaimDesignQuality: false,
        controlContextOnly: true,
        userVisible: false,
        mustNotChangeBusinessStrategy: true,
        mustNotChangeExecutor: true,
        roleCounts: assetIndex?.summary?.roleCounts || {},
        skillReadinessStatus: findSkillReadinessStatus(input.skillId, assetIndex),
        selectedCandidates,
        visualInsightCoverage: coverage,
        requiredNextObservations,
        blockers,
        warnings,
        limitations: [
            'ProjectAssetUnderstandingIntake is hidden control context and must not be shown as model thinking.',
            'It summarizes project asset candidates and visual observation readiness only.',
            'It does not read image bitmap data, call a vision model, touch Photoshop, or change executor behavior.',
            'It cannot choose the best image or claim design quality without downstream visual observations and QA checks.',
            'Cached visual observations can reduce repeated analysis, but still require design-specific verification.'
        ]
    };
}

function scenarioFromSkillId(skillId: BusinessDesignSkillId): ProjectVisualSamplingScenario {
    switch (skillId) {
        case 'main-image-design':
            return 'main-image';
        case 'detail-page-design':
            return 'detail-page';
        case 'sku-batch':
            return 'sku';
        default:
            return 'unknown';
    }
}

function findSkillReadinessStatus(skillId: BusinessDesignSkillId, assetIndex: ProjectAssetIndex | undefined): string | undefined {
    const scenario = scenarioFromSkillId(skillId);
    const skillName = scenario === 'main-image' ? 'main-image' : scenario === 'detail-page' ? 'detail-page' : scenario === 'sku' ? 'sku' : '';
    if (!skillName) return undefined;
    return assetIndex?.skillReadiness?.find((item) => item.skill === skillName)?.status;
}

function sanitizeCandidates(
    candidates: ProjectVisualSamplingCandidate[] | undefined
): ProjectAssetUnderstandingCandidate[] {
    return (candidates || []).map((candidate) => {
        const insight = sanitizeInsight(candidate.cachedInsight);
        return {
            assetId: normalizeText(candidate.assetId),
            path: normalizePath(candidate.path) || '',
            role: candidate.role,
            cacheStatus: normalizeText(candidate.cacheStatus),
            shouldAnalyze: candidate.shouldAnalyze === true,
            reason: normalizeText(candidate.reason),
            cachedInsightSummary: insight.summary,
            cachedProductType: insight.productType,
            cachedScene: insight.scene,
            cachedMaterial: insight.material,
            styleTags: insight.styleTags
        };
    });
}

function sanitizeInsight(insight: ProjectVisualInsight | undefined): {
    summary?: string;
    productType?: string;
    scene?: string;
    material?: string;
    styleTags: string[];
} {
    if (!hasConcreteProjectVisualInsight(insight)) {
        return { styleTags: [] };
    }
    return {
        summary: normalizeText(insight?.summary) || undefined,
        productType: normalizeText(insight?.productType) || undefined,
        scene: normalizeText(insight?.scene) || undefined,
        material: normalizeText(insight?.material) || undefined,
        styleTags: Array.isArray(insight?.styleTags)
            ? insight.styleTags.map(normalizeText).filter(Boolean).slice(0, 8)
            : []
    };
}

function buildCoverage(
    assetIndex: ProjectAssetIndex | undefined,
    visualSamplingPlan: ProjectVisualSamplingPlan | undefined,
    visualInsightCache: ProjectVisualInsightCacheReadResult | undefined,
    selectedCandidates: ProjectAssetUnderstandingCandidate[]
): ProjectAssetUnderstandingCoverage {
    const concreteCacheHits = (visualSamplingPlan?.selectedCandidates || []).filter((candidate) => (
        candidate.cacheStatus === 'hit'
        && hasConcreteProjectVisualInsight(candidate.cachedInsight)
    )).length;
    const concreteInsightEntries = (visualInsightCache?.entries || []).filter((entry) => (
        hasConcreteProjectVisualInsight(entry.insight)
    )).length;
    return {
        totalImages: Number(assetIndex?.summary?.totalImages || 0),
        totalCandidates: Number(assetIndex?.visionCandidates?.length || 0),
        selectedCandidates: selectedCandidates.length,
        cacheHits: concreteCacheHits,
        cacheMisses: Number(visualSamplingPlan?.cacheSummary?.miss || 0),
        staleCandidates: Number(visualSamplingPlan?.cacheSummary?.stale || 0),
        shouldAnalyze: Number(visualSamplingPlan?.cacheSummary?.shouldAnalyze || 0),
        entriesWithInsight: concreteInsightEntries
    };
}

function buildStatus(input: {
    hasProjectContext: boolean;
    assetIndex?: ProjectAssetIndex;
    visualSamplingPlan?: ProjectVisualSamplingPlan;
    coverage: ProjectAssetUnderstandingCoverage;
}): ProjectAssetUnderstandingIntakeStatus {
    if (!input.hasProjectContext) {
        return 'needs_context_snapshot';
    }
    if (!input.assetIndex || input.coverage.totalImages <= 0) {
        return 'needs_project_assets';
    }
    if (!input.visualSamplingPlan) {
        return 'needs_visual_sampling_plan';
    }
    if (input.coverage.entriesWithInsight > 0 || input.coverage.cacheHits > 0) {
        return 'ready_with_cached_visual_observations';
    }
    return 'needs_bounded_visual_analysis';
}

function buildRequiredNextObservations(status: ProjectAssetUnderstandingIntakeStatus): string[] {
    switch (status) {
        case 'ready_with_cached_visual_observations':
            return [];
        case 'needs_context_snapshot':
            return ['context_snapshot_required'];
        case 'needs_project_assets':
            return ['project_assets_required'];
        case 'needs_visual_sampling_plan':
            return ['visual_sampling_plan_required'];
        case 'needs_bounded_visual_analysis':
        default:
            return ['visual_understanding_required'];
    }
}

function buildBlockers(status: ProjectAssetUnderstandingIntakeStatus): string[] {
    if (status === 'needs_context_snapshot') return ['context_snapshot_missing'];
    if (status === 'needs_project_assets') return ['project_assets_missing'];
    return [];
}

function buildWarnings(
    assetIndex: ProjectAssetIndex | undefined,
    visualSamplingPlan: ProjectVisualSamplingPlan | undefined,
    visualInsightCache: ProjectVisualInsightCacheReadResult | undefined,
    status: ProjectAssetUnderstandingIntakeStatus
): string[] {
    return uniqueStrings([
        ...(assetIndex?.warnings || []),
        ...(visualSamplingPlan?.warnings || []),
        ...(visualInsightCache?.warnings || []),
        status === 'needs_bounded_visual_analysis'
            ? 'visual_candidates_need_bounded_analysis_before_design_judgment'
            : '',
        status === 'ready_with_cached_visual_observations'
            ? 'cached_visual_observations_are_not_design_quality_acceptance'
            : ''
    ]);
}

function normalizeText(value: unknown): string {
    return String(value || '').trim();
}

function normalizePath(value: unknown): string | undefined {
    const text = normalizeText(value).replace(/\\/g, '/');
    return text || undefined;
}

function uniqueStrings(values: string[]): string[] {
    return Array.from(new Set(values.map(normalizeText).filter(Boolean)));
}
