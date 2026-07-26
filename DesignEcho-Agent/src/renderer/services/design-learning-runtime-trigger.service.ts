import {
    buildDesignLearningCadenceSchedule,
    type DesignLearningCadenceSchedule
} from '../../shared/design-learning-cadence-scheduler';
import type {
    DesignLearningCadence,
    DesignLearningSourceAvailability
} from '../../shared/design-learning-experience';
import {
    runDesignLearningRuntime,
    type DesignLearningRuntimeRunnerResult,
    type DesignLearningRuntimeSourceProviders,
    type RunDesignLearningRuntimeInput
} from '../../shared/design-learning-runtime-runner';
import {
    buildDesignLearningRuntimeTrigger,
    type DesignLearningRuntimeAdapterAvailability,
    type DesignLearningRuntimePolicy,
    type DesignLearningRuntimeTriggerResult,
    type DesignLearningRuntimeTriggerSource
} from '../../shared/design-learning-runtime-trigger';
import type { DesignMemoryItem, DesignMemoryScope } from '../../shared/design-memory-knowledge';

export type DesignLearningRuntimeTriggerServiceVersion = 'design-learning-runtime-trigger-service/v0';
export type DesignLearningRuntimeTriggerServiceStatus =
    | 'blocked_before_runtime'
    | 'ready_waiting_manual_start'
    | 'runtime_completed_review_queued'
    | 'runtime_blocked';

export interface DesignLearningRuntimeTriggerServiceStorage {
    getLastRunAt?: () => unknown;
    setLastRunAt?: (value: string, metadata: DesignLearningRuntimeTriggerServiceStorageMetadata) => void | Promise<void>;
}

export interface DesignLearningRuntimeTriggerServiceStorageMetadata {
    status: DesignLearningRuntimeTriggerServiceStatus;
    triggerSource: DesignLearningRuntimeTriggerSource;
    runtimeStatus?: string;
    queuedCount?: number;
}

export interface DesignLearningRuntimeReviewQueue {
    enqueue?: (
        candidates: DesignMemoryItem[],
        metadata: DesignLearningRuntimeReviewQueueMetadata
    ) => Promise<DesignLearningRuntimeReviewQueueResult | undefined> | DesignLearningRuntimeReviewQueueResult | undefined;
}

export interface DesignLearningRuntimeReviewQueueMetadata {
    source: 'design-learning-runtime-trigger-service';
    generatedAt: string;
    triggerSource: DesignLearningRuntimeTriggerSource;
    planStatus?: string;
    scope?: DesignMemoryScope;
}

export interface DesignLearningRuntimeReviewQueueResult {
    queuedCount?: number;
    queueId?: string;
}

export interface RunDesignLearningRuntimeTriggerServiceInput {
    triggerSource?: DesignLearningRuntimeTriggerSource;
    now?: unknown;
    cadence?: DesignLearningCadence;
    lastRunAt?: unknown;
    preferredTopics?: unknown;
    knowledgeGaps?: unknown;
    recentRejectedTopics?: unknown;
    sourceAvailability?: DesignLearningSourceAvailability;
    maxReferences?: unknown;
    runtimePolicy?: DesignLearningRuntimePolicy;
    adapterAvailability?: DesignLearningRuntimeAdapterAvailability;
    sourceProviders?: DesignLearningRuntimeSourceProviders;
    analyzeReference?: RunDesignLearningRuntimeInput['analyzeReference'];
    reviewQueue?: DesignLearningRuntimeReviewQueue;
    storage?: DesignLearningRuntimeTriggerServiceStorage;
    scope?: DesignMemoryScope;
    executeRuntime?: boolean;
    autoRunOnAppStart?: boolean;
}

export interface DesignLearningRuntimeTriggerServiceResult {
    version: DesignLearningRuntimeTriggerServiceVersion;
    status: DesignLearningRuntimeTriggerServiceStatus;
    generatedAt: string;
    triggerSource: DesignLearningRuntimeTriggerSource;
    canRunRuntime: boolean;
    trigger: DesignLearningRuntimeTriggerResult;
    schedule: Pick<DesignLearningCadenceSchedule, 'version' | 'status' | 'due' | 'lastRunAt' | 'nextRunAt' | 'topics' | 'maxReferences'>;
    runtimeResult?: DesignLearningRuntimeRunnerResult;
    reviewQueueResult?: {
        queuedCount: number;
        queueId?: string;
    };
    blockers: string[];
    warnings: string[];
    boundaries: {
        usesSharedRuntimeTrigger: true;
        runtimeRequiresExplicitExecution: true;
        appStartDoesNotAutoRunByDefault: true;
        usesInjectedProvidersOnly: true;
        doesNotWritePhotoshop: true;
        doesNotWriteEagle: true;
        doesNotPersistMemory: true;
        queuesReviewCandidatesOnly: true;
        mustReviewBeforeActiveMemory: true;
        canClaimDesignQuality: false;
    };
}

const VERSION: DesignLearningRuntimeTriggerServiceVersion = 'design-learning-runtime-trigger-service/v0';

export async function runDesignLearningRuntimeTriggerService(
    input: RunDesignLearningRuntimeTriggerServiceInput
): Promise<DesignLearningRuntimeTriggerServiceResult> {
    const triggerSource = normalizeTriggerSource(input.triggerSource);
    const generatedAt = normalizeDateTime(input.now) || new Date().toISOString();
    const sourceAvailability = input.sourceAvailability || deriveSourceAvailability(input);
    const adapterAvailability = input.adapterAvailability || deriveAdapterAvailability(input);
    const runtimePolicy = normalizeRuntimePolicy(input.runtimePolicy, triggerSource, input.reviewQueue);
    const schedule = buildDesignLearningCadenceSchedule({
        now: generatedAt,
        cadence: input.cadence,
        lastRunAt: input.lastRunAt ?? input.storage?.getLastRunAt?.(),
        preferredTopics: input.preferredTopics,
        knowledgeGaps: input.knowledgeGaps,
        recentRejectedTopics: input.recentRejectedTopics,
        sourceAvailability,
        maxReferences: input.maxReferences
    });
    const trigger = buildDesignLearningRuntimeTrigger({
        triggerSource,
        schedule,
        runtimePolicy,
        adapterAvailability,
        generatedAt,
        scope: input.scope
    });

    if (!trigger.canStartRuntime || !trigger.runtimeEnvelope) {
        return buildServiceResult({
            status: 'blocked_before_runtime',
            generatedAt,
            triggerSource,
            schedule,
            trigger,
            canRunRuntime: false,
            blockers: trigger.blockers,
            warnings: trigger.warnings
        });
    }

    const shouldRunRuntime = input.executeRuntime === true
        && (triggerSource !== 'app_start' || input.autoRunOnAppStart === true);
    if (!shouldRunRuntime) {
        return buildServiceResult({
            status: 'ready_waiting_manual_start',
            generatedAt,
            triggerSource,
            schedule,
            trigger,
            canRunRuntime: false,
            blockers: [],
            warnings: [
                ...trigger.warnings,
                triggerSource === 'app_start'
                    ? 'app_start_heavy_learning_waits_for_manual_or_enabled_autorun'
                    : 'runtime_execution_requires_explicit_request'
            ]
        });
    }

    const runtimeResult = await runDesignLearningRuntime({
        plan: trigger.runtimeEnvelope.runtimeInput.plan,
        generatedAt,
        scope: trigger.runtimeEnvelope.runtimeInput.scope,
        sourceProviders: input.sourceProviders,
        analyzeReference: input.analyzeReference
    });

    if (runtimeResult.status !== 'completed_ready_for_review' && runtimeResult.status !== 'completed_with_partial_sources') {
        return buildServiceResult({
            status: 'runtime_blocked',
            generatedAt,
            triggerSource,
            schedule,
            trigger,
            runtimeResult,
            canRunRuntime: true,
            blockers: runtimeResult.blockers,
            warnings: [...trigger.warnings, ...runtimeResult.warnings]
        });
    }

    const reviewQueueResult = await input.reviewQueue?.enqueue?.(runtimeResult.memoryCandidates, {
        source: 'design-learning-runtime-trigger-service',
        generatedAt,
        triggerSource,
        planStatus: runtimeResult.planStatus,
        scope: input.scope
    });
    const queuedCount = clampQueuedCount(reviewQueueResult?.queuedCount, runtimeResult.memoryCandidates.length);
    await input.storage?.setLastRunAt?.(generatedAt, {
        status: 'runtime_completed_review_queued',
        triggerSource,
        runtimeStatus: runtimeResult.status,
        queuedCount
    });

    return buildServiceResult({
        status: 'runtime_completed_review_queued',
        generatedAt,
        triggerSource,
        schedule,
        trigger,
        runtimeResult,
        reviewQueueResult: {
            queuedCount,
            ...(cleanString(reviewQueueResult?.queueId) ? { queueId: cleanString(reviewQueueResult?.queueId) } : {})
        },
        canRunRuntime: true,
        blockers: [],
        warnings: [...trigger.warnings, ...runtimeResult.warnings]
    });
}

function buildServiceResult(input: {
    status: DesignLearningRuntimeTriggerServiceStatus;
    generatedAt: string;
    triggerSource: DesignLearningRuntimeTriggerSource;
    schedule: DesignLearningCadenceSchedule;
    trigger: DesignLearningRuntimeTriggerResult;
    canRunRuntime: boolean;
    runtimeResult?: DesignLearningRuntimeRunnerResult;
    reviewQueueResult?: DesignLearningRuntimeTriggerServiceResult['reviewQueueResult'];
    blockers: string[];
    warnings: string[];
}): DesignLearningRuntimeTriggerServiceResult {
    return {
        version: VERSION,
        status: input.status,
        generatedAt: input.generatedAt,
        triggerSource: input.triggerSource,
        canRunRuntime: input.canRunRuntime,
        trigger: input.trigger,
        schedule: {
            version: input.schedule.version,
            status: input.schedule.status,
            due: input.schedule.due,
            ...(input.schedule.lastRunAt ? { lastRunAt: input.schedule.lastRunAt } : {}),
            ...(input.schedule.nextRunAt ? { nextRunAt: input.schedule.nextRunAt } : {}),
            topics: input.schedule.topics,
            maxReferences: input.schedule.maxReferences
        },
        ...(input.runtimeResult ? { runtimeResult: input.runtimeResult } : {}),
        ...(input.reviewQueueResult ? { reviewQueueResult: input.reviewQueueResult } : {}),
        blockers: uniqueStrings(input.blockers),
        warnings: uniqueStrings(input.warnings),
        boundaries: {
            usesSharedRuntimeTrigger: true,
            runtimeRequiresExplicitExecution: true,
            appStartDoesNotAutoRunByDefault: true,
            usesInjectedProvidersOnly: true,
            doesNotWritePhotoshop: true,
            doesNotWriteEagle: true,
            doesNotPersistMemory: true,
            queuesReviewCandidatesOnly: true,
            mustReviewBeforeActiveMemory: true,
            canClaimDesignQuality: false
        }
    };
}

function normalizeRuntimePolicy(
    policy: DesignLearningRuntimePolicy | undefined,
    triggerSource: DesignLearningRuntimeTriggerSource,
    reviewQueue?: DesignLearningRuntimeReviewQueue
): DesignLearningRuntimePolicy {
    return {
        ...policy,
        enabled: policy?.enabled !== false,
        allowManual: policy?.allowManual !== false,
        allowAppStart: policy?.allowAppStart !== false,
        allowScheduledTimer: policy?.allowScheduledTimer === true || triggerSource !== 'scheduled_timer',
        reviewQueueAvailable: policy?.reviewQueueAvailable === true || typeof reviewQueue?.enqueue === 'function'
    };
}

function deriveSourceAvailability(input: RunDesignLearningRuntimeTriggerServiceInput): DesignLearningSourceAvailability {
    return {
        eagleReadonly: Boolean(input.sourceProviders?.eagleReadonly || input.adapterAvailability?.eagleReadonlyProvider),
        webSearch: Boolean(input.sourceProviders?.webSearch || input.adapterAvailability?.webSearchProvider),
        projectCases: Boolean(input.sourceProviders?.projectCases || input.adapterAvailability?.projectCasesProvider),
        visualAnalysis: Boolean(input.analyzeReference || input.adapterAvailability?.visualAnalysisAdapter)
    };
}

function deriveAdapterAvailability(input: RunDesignLearningRuntimeTriggerServiceInput): DesignLearningRuntimeAdapterAvailability {
    return {
        eagleReadonlyProvider: Boolean(input.sourceProviders?.eagleReadonly || input.adapterAvailability?.eagleReadonlyProvider),
        webSearchProvider: Boolean(input.sourceProviders?.webSearch || input.adapterAvailability?.webSearchProvider),
        projectCasesProvider: Boolean(input.sourceProviders?.projectCases || input.adapterAvailability?.projectCasesProvider),
        visualAnalysisAdapter: Boolean(input.analyzeReference || input.adapterAvailability?.visualAnalysisAdapter)
    };
}

function normalizeTriggerSource(value: unknown): DesignLearningRuntimeTriggerSource {
    if (value === 'manual' || value === 'app_start' || value === 'scheduled_timer' || value === 'developer_smoke') {
        return value;
    }
    return 'app_start';
}

function normalizeDateTime(value: unknown): string | undefined {
    if (value === undefined || value === null || value === '') return undefined;
    if (typeof value === 'number' && Number.isFinite(value)) return new Date(value).toISOString();
    const text = cleanString(value);
    if (!text) return undefined;
    const parsed = Date.parse(text);
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : undefined;
}

function clampQueuedCount(value: unknown, fallback: number): number {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric >= 0) return Math.floor(numeric);
    return Math.max(0, fallback);
}

function uniqueStrings(values: unknown[]): string[] {
    return Array.from(new Set(values.map(cleanString).filter(Boolean)));
}

function cleanString(value: unknown): string {
    return String(value || '').replace(/\b[A-Za-z]:[\\/][^\s"'，,；;]+/g, '[redacted-local-path]').replace(/\s+/g, ' ').trim();
}
