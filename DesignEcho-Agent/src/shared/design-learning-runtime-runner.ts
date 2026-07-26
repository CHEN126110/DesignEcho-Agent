import {
    buildDesignLearningBoundary,
    buildDesignLearningExperienceIndex,
    designLearningExperiencesToMemoryItems,
    type DesignLearningBoundary,
    type DesignLearningDailyResearchPlan,
    type DesignLearningExperienceIndex,
    type DesignLearningReferenceObservation,
    type DesignLearningReferenceSource
} from './design-learning-experience';
import type { DesignMemoryItem } from './design-memory-knowledge';
import { sanitizeDesignLearningVisualCase } from './design-learning-visual-case';

export type DesignLearningRuntimeRunnerVersion = 'design-learning-runtime-runner/v0';
export type DesignLearningRuntimeRunnerStatus =
    | 'completed_ready_for_review'
    | 'completed_with_partial_sources'
    | 'blocked_no_plan'
    | 'blocked_no_references'
    | 'blocked_missing_visual_analysis';

export type DesignLearningRuntimeReferenceSourceType =
    | 'eagle_visual_case'
    | 'external_reference'
    | 'manual_reference';

export interface DesignLearningRuntimeReferenceCandidate {
    referenceId: string;
    title: string;
    sourceType: DesignLearningRuntimeReferenceSourceType;
    tags: string[];
    sourceUrl?: string;
    source: DesignLearningReferenceSource;
}

export interface DesignLearningRuntimeReferenceProviderInput {
    topics: string[];
    maxItems: number;
    plan: DesignLearningDailyResearchPlan;
    source: DesignLearningReferenceSource;
}

export type DesignLearningRuntimeReferenceProvider = (
    input: DesignLearningRuntimeReferenceProviderInput
) => Promise<Array<Partial<Omit<DesignLearningRuntimeReferenceCandidate, 'source'>> | undefined> | undefined>;

export interface DesignLearningRuntimeSourceProviders {
    eagleReadonly?: DesignLearningRuntimeReferenceProvider;
    webSearch?: DesignLearningRuntimeReferenceProvider;
    projectCases?: DesignLearningRuntimeReferenceProvider;
}

export interface RunDesignLearningRuntimeInput {
    plan?: DesignLearningDailyResearchPlan | null;
    generatedAt?: unknown;
    sourceProviders?: DesignLearningRuntimeSourceProviders;
    analyzeReference?: (
        reference: DesignLearningRuntimeReferenceCandidate,
        context: { plan: DesignLearningDailyResearchPlan }
    ) => Promise<DesignLearningReferenceObservation | undefined>;
    scope?: {
        type: 'user' | 'project' | 'brand' | 'session';
        id?: string;
    };
}

export interface DesignLearningRuntimeRunnerResult {
    version: DesignLearningRuntimeRunnerVersion;
    status: DesignLearningRuntimeRunnerStatus;
    generatedAt: string;
    planStatus?: string;
    referenceCandidates: DesignLearningRuntimeReferenceCandidate[];
    observations: DesignLearningReferenceObservation[];
    experienceIndex?: DesignLearningExperienceIndex;
    memoryCandidates: DesignMemoryItem[];
    sourceReports: Array<{
        source: DesignLearningReferenceSource;
        status: 'ready' | 'unavailable' | 'failed';
        count: number;
        warning?: string;
    }>;
    blockers: string[];
    warnings: string[];
    boundaries: DesignLearningRuntimeBoundary;
    canRunPhotoshop: false;
    canWriteEagle: false;
    canPersistMemory: false;
    canClaimDesignQuality: false;
}

const RUNTIME_VERSION: DesignLearningRuntimeRunnerVersion = 'design-learning-runtime-runner/v0';

export type DesignLearningRuntimeBoundary = Omit<DesignLearningBoundary, 'doesNotCallProvider' | 'doesNotExecuteSearch'> & {
    doesNotExecuteSearch: false;
    doesNotCallProvider: false;
    searchCallsRequireInjection: true;
    providerCallsRequireInjection: true;
    doesNotUseInternalSearchProvider: true;
    doesNotUseInternalProvider: true;
};

const UNSAFE_PAYLOAD_PATTERNS = [
    /raw-image-payload/gi,
    /base64-image-payload/gi,
    /data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+/gi,
    /data:image\//gi,
    /"base64"/gi,
    /"imageBase64"/gi,
    /"rawImage"/gi,
    /"rawImages"/gi,
    /"buffer"/gi,
    /"bytes"/gi,
    /"pixels"/gi,
    /"confidence"/gi,
    /\bconfidence\b/gi,
    /置信/g
];

const LOCAL_PATH_PATTERN = /\b[A-Za-z]:[\\/][^\s"'，,；;]+/g;

export async function runDesignLearningRuntime(
    input: RunDesignLearningRuntimeInput
): Promise<DesignLearningRuntimeRunnerResult> {
    const generatedAt = normalizeDateTime(input.generatedAt) || new Date().toISOString();
    const plan = input.plan || undefined;
    const boundaries = buildRuntimeBoundary();
    const sourceReports: DesignLearningRuntimeRunnerResult['sourceReports'] = [];
    const blockers: string[] = [];
    const warnings: string[] = [];

    if (!plan || plan.status === 'blocked_no_reference_sources') {
        return buildResult({
            status: 'blocked_no_plan',
            generatedAt,
            plan,
            referenceCandidates: [],
            observations: [],
            sourceReports,
            blockers: ['design_learning_plan_required'],
            warnings,
            boundaries
        });
    }

    const referenceCandidates = await collectReferenceCandidates({ plan, providers: input.sourceProviders || {}, sourceReports, warnings });
    if (referenceCandidates.length === 0) {
        return buildResult({
            status: 'blocked_no_references',
            generatedAt,
            plan,
            referenceCandidates,
            observations: [],
            sourceReports,
            blockers: ['reference_candidates_required'],
            warnings,
            boundaries
        });
    }

    if (!input.analyzeReference) {
        return buildResult({
            status: 'blocked_missing_visual_analysis',
            generatedAt,
            plan,
            referenceCandidates,
            observations: [],
            sourceReports,
            blockers: ['visual_analysis_adapter_required'],
            warnings,
            boundaries
        });
    }

    const observations = await collectObservations({ plan, referenceCandidates, analyzeReference: input.analyzeReference, warnings });
    if (observations.length === 0) {
        return buildResult({
            status: 'blocked_missing_visual_analysis',
            generatedAt,
            plan,
            referenceCandidates,
            observations,
            sourceReports,
            blockers: ['reference_design_analysis_required'],
            warnings,
            boundaries
        });
    }

    const experienceIndex = buildDesignLearningExperienceIndex({
        generatedAt,
        sourceLabel: 'design-learning-runtime-runner',
        observations
    });
    const memoryCandidates = designLearningExperiencesToMemoryItems(experienceIndex, {
        scope: input.scope || { type: 'user' },
        now: generatedAt
    });
    if (experienceIndex.status !== 'ready_for_review' || memoryCandidates.length === 0) {
        return buildResult({
            status: 'blocked_missing_visual_analysis',
            generatedAt,
            plan,
            referenceCandidates,
            observations,
            experienceIndex,
            memoryCandidates: [],
            sourceReports,
            blockers: Array.from(new Set([
                'reference_design_analysis_required',
                ...experienceIndex.blockers
            ])),
            warnings: [...warnings, ...experienceIndex.warnings],
            boundaries
        });
    }
    const failedSources = sourceReports.filter((report) => report.status === 'failed' || report.status === 'unavailable');
    return buildResult({
        status: failedSources.length > 0 ? 'completed_with_partial_sources' : 'completed_ready_for_review',
        generatedAt,
        plan,
        referenceCandidates,
        observations,
        experienceIndex,
        memoryCandidates,
        sourceReports,
        blockers,
        warnings,
        boundaries
    });
}

async function collectReferenceCandidates(input: {
    plan: DesignLearningDailyResearchPlan;
    providers: DesignLearningRuntimeSourceProviders;
    sourceReports: DesignLearningRuntimeRunnerResult['sourceReports'];
    warnings: string[];
}): Promise<DesignLearningRuntimeReferenceCandidate[]> {
    const candidates: DesignLearningRuntimeReferenceCandidate[] = [];
    const sources = input.plan.steps.find((step) => step.kind === 'collect_references')?.sources || [];
    for (const source of sources) {
        const provider = providerForSource(source, input.providers);
        if (!provider) {
            input.sourceReports.push({ source, status: 'unavailable', count: 0, warning: `${source}_provider_missing` });
            input.warnings.push(`${source}_provider_missing`);
            continue;
        }
        try {
            const rawReferences = await provider({
                topics: input.plan.topics,
                maxItems: input.plan.maxReferences,
                plan: input.plan,
                source
            });
            const normalized = normalizeReferences(rawReferences, source).slice(0, input.plan.maxReferences);
            candidates.push(...normalized);
            input.sourceReports.push({ source, status: 'ready', count: normalized.length });
        } catch (error) {
            const message = cleanString(error instanceof Error ? error.message : String(error));
            input.sourceReports.push({ source, status: 'failed', count: 0, warning: message || `${source}_provider_failed` });
            input.warnings.push(`${source}_provider_failed`);
        }
    }
    return dedupeReferences(candidates).slice(0, input.plan.maxReferences);
}

async function collectObservations(input: {
    plan: DesignLearningDailyResearchPlan;
    referenceCandidates: DesignLearningRuntimeReferenceCandidate[];
    analyzeReference: NonNullable<RunDesignLearningRuntimeInput['analyzeReference']>;
    warnings: string[];
}): Promise<DesignLearningReferenceObservation[]> {
    const observations: DesignLearningReferenceObservation[] = [];
    for (const reference of input.referenceCandidates) {
        try {
            const observation = await input.analyzeReference(reference, { plan: input.plan });
            const normalized = normalizeObservation(observation, reference);
            if (normalized) observations.push(normalized);
        } catch (error) {
            input.warnings.push(`analysis_failed:${reference.referenceId}:${cleanString(error instanceof Error ? error.message : String(error))}`);
        }
    }
    return observations;
}

function buildResult(input: {
    status: DesignLearningRuntimeRunnerStatus;
    generatedAt: string;
    plan?: DesignLearningDailyResearchPlan;
    referenceCandidates: DesignLearningRuntimeReferenceCandidate[];
    observations: DesignLearningReferenceObservation[];
    experienceIndex?: DesignLearningExperienceIndex;
    memoryCandidates?: DesignMemoryItem[];
    sourceReports: DesignLearningRuntimeRunnerResult['sourceReports'];
    blockers: string[];
    warnings: string[];
    boundaries: DesignLearningRuntimeBoundary;
}): DesignLearningRuntimeRunnerResult {
    return {
        version: RUNTIME_VERSION,
        status: input.status,
        generatedAt: input.generatedAt,
        planStatus: input.plan?.status,
        referenceCandidates: input.referenceCandidates,
        observations: input.observations,
        experienceIndex: input.experienceIndex,
        memoryCandidates: input.memoryCandidates || [],
        sourceReports: input.sourceReports,
        blockers: input.blockers,
        warnings: Array.from(new Set(input.warnings.map(cleanString).filter(Boolean))),
        boundaries: input.boundaries,
        canRunPhotoshop: false,
        canWriteEagle: false,
        canPersistMemory: false,
        canClaimDesignQuality: false
    };
}

function providerForSource(
    source: DesignLearningReferenceSource,
    providers: DesignLearningRuntimeSourceProviders
): DesignLearningRuntimeReferenceProvider | undefined {
    if (source === 'eagle_readonly') return providers.eagleReadonly;
    if (source === 'web_search') return providers.webSearch;
    if (source === 'project_cases') return providers.projectCases;
    return undefined;
}

function normalizeReferences(
    values: Array<Partial<Omit<DesignLearningRuntimeReferenceCandidate, 'source'>> | undefined> | undefined,
    source: DesignLearningReferenceSource
): DesignLearningRuntimeReferenceCandidate[] {
    if (!Array.isArray(values)) return [];
    return values
        .map((value) => {
            const referenceId = cleanString(value?.referenceId);
            const title = cleanString(value?.title) || referenceId;
            if (!referenceId || !title) return undefined;
            const sourceUrl = cleanString(value?.sourceUrl);
            const candidate: DesignLearningRuntimeReferenceCandidate = {
                referenceId,
                title,
                sourceType: normalizeReferenceSourceType(value?.sourceType, source),
                tags: uniqueStrings(value?.tags || []),
                source
            };
            if (sourceUrl) candidate.sourceUrl = sourceUrl;
            return candidate;
        })
        .filter((item): item is DesignLearningRuntimeReferenceCandidate => Boolean(item));
}

function normalizeObservation(
    value: DesignLearningReferenceObservation | undefined,
    reference: DesignLearningRuntimeReferenceCandidate
): DesignLearningReferenceObservation | undefined {
    if (!value) return undefined;
    const referenceId = cleanString(value.referenceId) || reference.referenceId;
    const summary = cleanString(value.summary);
    if (!referenceId || !summary) return undefined;
    const analysisSource = cleanString(value.analysisSource) || 'runtime-analysis-adapter';
    if (isMetadataOnlyAnalysisSource(analysisSource)) return undefined;
    const visualCase = sanitizeDesignLearningVisualCase(value.visualCase);
    return {
        referenceId,
        analysisSource,
        observedAt: cleanString(value.observedAt) || undefined,
        productCategory: cleanString(value.productCategory) || undefined,
        designType: cleanString(value.designType) || undefined,
        summary,
        strengths: Array.isArray(value.strengths)
            ? value.strengths.map((item) => ({
                aspect: cleanString(item.aspect),
                observation: cleanString(item.observation),
                reason: cleanString(item.reason),
                suitableFor: uniqueStrings(item.suitableFor || [])
            }))
            : [],
        suitableScenarios: uniqueStrings(value.suitableScenarios || []),
        avoidWhen: uniqueStrings(value.avoidWhen || []),
        reusableHeuristics: uniqueStrings(value.reusableHeuristics || []),
        reviewStatus: value.reviewStatus || 'needs_human_review',
        sourceNotes: uniqueStrings(value.sourceNotes || []),
        limitations: uniqueStrings(value.limitations || []),
        ...(visualCase ? { visualCase } : {})
    };
}

function buildRuntimeBoundary(): DesignLearningRuntimeBoundary {
    return {
        ...buildDesignLearningBoundary(),
        doesNotExecuteSearch: false,
        doesNotCallProvider: false,
        searchCallsRequireInjection: true,
        providerCallsRequireInjection: true,
        doesNotUseInternalSearchProvider: true,
        doesNotUseInternalProvider: true
    };
}

function isMetadataOnlyAnalysisSource(value: string): boolean {
    const text = value.toLowerCase().replace(/[_\s]+/g, '-');
    return text === 'metadata-only' || text.includes('metadata-only');
}

function normalizeReferenceSourceType(
    value: unknown,
    source: DesignLearningReferenceSource
): DesignLearningRuntimeReferenceSourceType {
    const text = cleanString(value);
    if (text === 'eagle_visual_case' || text === 'external_reference' || text === 'manual_reference') return text;
    if (source === 'eagle_readonly') return 'eagle_visual_case';
    if (source === 'web_search') return 'external_reference';
    return 'manual_reference';
}

function dedupeReferences(values: DesignLearningRuntimeReferenceCandidate[]): DesignLearningRuntimeReferenceCandidate[] {
    const byId = new Map<string, DesignLearningRuntimeReferenceCandidate>();
    for (const value of values) {
        if (!byId.has(value.referenceId)) byId.set(value.referenceId, value);
    }
    return Array.from(byId.values());
}

function uniqueStrings(values: unknown[]): string[] {
    return Array.from(new Set(values.map(cleanString).filter(Boolean)));
}

function normalizeDateTime(value: unknown): string | undefined {
    if (value === undefined || value === null || value === '') return undefined;
    if (typeof value === 'number' && Number.isFinite(value)) return new Date(value).toISOString();
    const text = cleanString(value);
    if (!text) return undefined;
    const parsed = Date.parse(text);
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : text;
}

function cleanString(value: unknown): string {
    let text = String(value || '').trim();
    for (const pattern of UNSAFE_PAYLOAD_PATTERNS) {
        text = text.replace(pattern, '[redacted]');
    }
    return text.replace(LOCAL_PATH_PATTERN, '[redacted-local-path]').replace(/\s+/g, ' ').trim();
}
