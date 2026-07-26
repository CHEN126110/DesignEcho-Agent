import {
    buildDesignLearningBoundary,
    buildDesignLearningDailyResearchPlan,
    type DesignLearningBoundary,
    type DesignLearningDailyResearchPlan,
    type DesignLearningReferenceSource
} from './design-learning-experience';
import type {
    DesignLearningCadenceSchedule,
    DesignLearningRuntimeRequest
} from './design-learning-cadence-scheduler';
import type { DesignMemoryScope } from './design-memory-knowledge';

export type DesignLearningRuntimeTriggerVersion = 'design-learning-runtime-trigger/v0';
export type DesignLearningRuntimeTriggerSource =
    | 'manual'
    | 'app_start'
    | 'scheduled_timer'
    | 'developer_smoke';
export type DesignLearningRuntimeTriggerStatus =
    | 'ready_for_runtime_runner'
    | 'blocked_runtime_disabled'
    | 'blocked_schedule_not_ready'
    | 'blocked_missing_runtime_request'
    | 'blocked_missing_runtime_adapters'
    | 'blocked_review_gate_unavailable';

export type DesignLearningRuntimeAdapterRequirement =
    | 'eagleReadonlyProvider'
    | 'webSearchProvider'
    | 'projectCasesProvider'
    | 'visualAnalysisAdapter';

export interface DesignLearningRuntimePolicy {
    enabled?: boolean;
    allowManual?: boolean;
    allowAppStart?: boolean;
    allowScheduledTimer?: boolean;
    reviewQueueAvailable?: boolean;
}

export interface DesignLearningRuntimeAdapterAvailability {
    eagleReadonlyProvider?: boolean;
    webSearchProvider?: boolean;
    projectCasesProvider?: boolean;
    visualAnalysisAdapter?: boolean;
}

export interface BuildDesignLearningRuntimeTriggerInput {
    triggerSource?: DesignLearningRuntimeTriggerSource;
    schedule?: DesignLearningCadenceSchedule | null;
    runtimePolicy?: DesignLearningRuntimePolicy;
    adapterAvailability?: DesignLearningRuntimeAdapterAvailability;
    generatedAt?: unknown;
    scope?: DesignMemoryScope;
}

export interface DesignLearningRuntimeEnvelope {
    runnerVersion: 'design-learning-runtime-runner/v0';
    runtimeInput: {
        plan: DesignLearningDailyResearchPlan;
        generatedAt: string;
        scope: DesignMemoryScope;
        requiredAdapters: DesignLearningRuntimeAdapterRequirement[];
    };
    canStartRuntime: true;
    shouldCallInjectedProviders: true;
    requiresInjectedReferenceProviders: true;
    requiresInjectedVisualAnalysis: true;
    mustReviewBeforePersisting: true;
    shouldRunPhotoshop: false;
    shouldWriteEagle: false;
    shouldPersistMemory: false;
    canClaimDesignQuality: false;
}

export interface DesignLearningRuntimeTriggerResult {
    version: DesignLearningRuntimeTriggerVersion;
    status: DesignLearningRuntimeTriggerStatus;
    triggerSource: DesignLearningRuntimeTriggerSource;
    generatedAt: string;
    scheduleStatus?: string;
    canStartRuntime: boolean;
    runtimeEnvelope?: DesignLearningRuntimeEnvelope;
    requiredAdapters: DesignLearningRuntimeAdapterRequirement[];
    missingAdapters: DesignLearningRuntimeAdapterRequirement[];
    blockers: string[];
    warnings: string[];
    limitations: string[];
    boundaries: DesignLearningRuntimeTriggerBoundary;
}

export type DesignLearningRuntimeTriggerBoundary = DesignLearningBoundary & {
    doesNotRunRuntime: true;
    doesNotCallInjectedProvidersItself: true;
    runtimeMayCallInjectedProviders: true;
    reviewRequiredBeforeMemoryPersistence: true;
};

const VERSION: DesignLearningRuntimeTriggerVersion = 'design-learning-runtime-trigger/v0';
const DEFAULT_TRIGGER_SOURCE: DesignLearningRuntimeTriggerSource = 'app_start';
const UNSAFE_TEXT_PATTERNS = [
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
    /"pixels"/gi
];
const LOCAL_PATH_PATTERN = /\b[A-Za-z]:[\\/][^\s"'，,；;]+/g;

export function buildDesignLearningRuntimeTrigger(
    input: BuildDesignLearningRuntimeTriggerInput
): DesignLearningRuntimeTriggerResult {
    const triggerSource = normalizeTriggerSource(input.triggerSource);
    const generatedAt = normalizeDateTime(input.generatedAt) || new Date().toISOString();
    const boundaries = buildRuntimeTriggerBoundary();
    const schedule = input.schedule || undefined;
    const policy = normalizeRuntimePolicy(input.runtimePolicy);
    const adapterAvailability = normalizeAdapterAvailability(input.adapterAvailability);
    const warnings: string[] = [];
    const limitations = [
        '该触发器只决定是否把学习计划交给 design-learning-runtime-runner，不执行搜索、模型分析、Eagle 写入、Photoshop 写入或记忆持久化。',
        '真实参考来源和视觉分析必须由调用方注入 adapter；触发器不会内置 provider，也不会在应用启动时隐式跑重任务。',
        'runtime 输出只能进入待复核候选；用户复核前不能进入 active 设计知识，也不能改变业务 skill 写入参数。',
        '手动触发可以覆盖时间间隔，但不能覆盖缺少参考来源、缺少 adapter 或缺少复核队列的阻断。'
    ];

    const disabledBlockers = runtimePolicyBlockers(triggerSource, policy);
    if (disabledBlockers.length > 0) {
        return buildTriggerResult({
            status: 'blocked_runtime_disabled',
            triggerSource,
            generatedAt,
            schedule,
            requiredAdapters: [],
            missingAdapters: [],
            blockers: disabledBlockers,
            warnings,
            limitations,
            boundaries
        });
    }

    const requestSelection = selectRuntimeRequest({ schedule, triggerSource, generatedAt, warnings });
    if (!requestSelection.request) {
        return buildTriggerResult({
            status: requestSelection.status,
            triggerSource,
            generatedAt,
            schedule,
            requiredAdapters: [],
            missingAdapters: [],
            blockers: requestSelection.blockers,
            warnings,
            limitations,
            boundaries
        });
    }

    const requiredAdapters = deriveRequiredAdapters(requestSelection.request.plan);
    const missingAdapters = requiredAdapters.filter((adapter) => !adapterAvailability[adapter]);
    if (missingAdapters.length > 0) {
        return buildTriggerResult({
            status: 'blocked_missing_runtime_adapters',
            triggerSource,
            generatedAt,
            schedule,
            requiredAdapters,
            missingAdapters,
            blockers: missingAdapters.map((adapter) => `${adapter}_required`),
            warnings,
            limitations,
            boundaries
        });
    }

    if (!policy.reviewQueueAvailable) {
        return buildTriggerResult({
            status: 'blocked_review_gate_unavailable',
            triggerSource,
            generatedAt,
            schedule,
            requiredAdapters,
            missingAdapters: [],
            blockers: ['review_queue_required'],
            warnings,
            limitations,
            boundaries
        });
    }

    const envelope = buildRuntimeEnvelope({
        request: requestSelection.request,
        generatedAt,
        requiredAdapters,
        scope: input.scope
    });
    return buildTriggerResult({
        status: 'ready_for_runtime_runner',
        triggerSource,
        generatedAt,
        schedule,
        requiredAdapters,
        missingAdapters: [],
        blockers: [],
        warnings,
        limitations,
        boundaries,
        runtimeEnvelope: envelope
    });
}

function buildTriggerResult(input: {
    status: DesignLearningRuntimeTriggerStatus;
    triggerSource: DesignLearningRuntimeTriggerSource;
    generatedAt: string;
    schedule?: DesignLearningCadenceSchedule;
    runtimeEnvelope?: DesignLearningRuntimeEnvelope;
    requiredAdapters: DesignLearningRuntimeAdapterRequirement[];
    missingAdapters: DesignLearningRuntimeAdapterRequirement[];
    blockers: string[];
    warnings: string[];
    limitations: string[];
    boundaries: DesignLearningRuntimeTriggerBoundary;
}): DesignLearningRuntimeTriggerResult {
    return {
        version: VERSION,
        status: input.status,
        triggerSource: input.triggerSource,
        generatedAt: input.generatedAt,
        scheduleStatus: input.schedule?.status,
        canStartRuntime: input.status === 'ready_for_runtime_runner',
        ...(input.runtimeEnvelope ? { runtimeEnvelope: input.runtimeEnvelope } : {}),
        requiredAdapters: Array.from(new Set(input.requiredAdapters)),
        missingAdapters: Array.from(new Set(input.missingAdapters)),
        blockers: Array.from(new Set(input.blockers.map(cleanString).filter(Boolean))),
        warnings: Array.from(new Set(input.warnings.map(cleanString).filter(Boolean))),
        limitations: Array.from(new Set(input.limitations.map(cleanString).filter(Boolean))),
        boundaries: input.boundaries
    };
}

function selectRuntimeRequest(input: {
    schedule?: DesignLearningCadenceSchedule;
    triggerSource: DesignLearningRuntimeTriggerSource;
    generatedAt: string;
    warnings: string[];
}): {
    status: 'blocked_schedule_not_ready' | 'blocked_missing_runtime_request';
    request?: DesignLearningRuntimeRequest;
    blockers: string[];
} {
    if (!input.schedule) {
        return {
            status: 'blocked_schedule_not_ready',
            blockers: ['design_learning_schedule_required']
        };
    }
    if (input.schedule.blockers.length > 0) {
        return {
            status: 'blocked_schedule_not_ready',
            blockers: input.schedule.blockers
        };
    }
    if (input.schedule.runRequest) {
        return {
            status: 'blocked_missing_runtime_request',
            request: input.schedule.runRequest,
            blockers: []
        };
    }
    if (input.triggerSource !== 'manual') {
        return {
            status: 'blocked_schedule_not_ready',
            blockers: [`schedule_status_${input.schedule.status}`]
        };
    }

    const plan = buildDesignLearningDailyResearchPlan({
        date: input.generatedAt.slice(0, 10),
        cadence: input.schedule.cadence,
        topics: input.schedule.topics,
        sourceAvailability: input.schedule.sourceAvailability,
        maxReferences: input.schedule.maxReferences
    });
    if (plan.status !== 'ready_for_runtime') {
        return {
            status: 'blocked_schedule_not_ready',
            blockers: plan.blockers.length > 0 ? plan.blockers : ['manual_runtime_plan_not_ready']
        };
    }
    input.warnings.push('manual_trigger_overrode_cadence');
    return {
        status: 'blocked_missing_runtime_request',
        request: {
            plan,
            canRunRuntime: true,
            mustUseInjectedReferenceProviders: true,
            mustUseInjectedVisualAnalysis: true,
            mustReviewBeforePersisting: true,
            runtimeRunnerVersion: 'design-learning-runtime-runner/v0'
        },
        blockers: []
    };
}

function deriveRequiredAdapters(plan: DesignLearningDailyResearchPlan): DesignLearningRuntimeAdapterRequirement[] {
    const sourceAdapters = (plan.steps.find((step) => step.kind === 'collect_references')?.sources || [])
        .map(sourceToAdapter)
        .filter((item): item is DesignLearningRuntimeAdapterRequirement => Boolean(item));
    return Array.from(new Set([...sourceAdapters, 'visualAnalysisAdapter']));
}

function sourceToAdapter(source: DesignLearningReferenceSource): DesignLearningRuntimeAdapterRequirement | undefined {
    if (source === 'eagle_readonly') return 'eagleReadonlyProvider';
    if (source === 'web_search') return 'webSearchProvider';
    if (source === 'project_cases') return 'projectCasesProvider';
    return undefined;
}

function buildRuntimeEnvelope(input: {
    request: DesignLearningRuntimeRequest;
    generatedAt: string;
    requiredAdapters: DesignLearningRuntimeAdapterRequirement[];
    scope?: DesignMemoryScope;
}): DesignLearningRuntimeEnvelope {
    return {
        runnerVersion: 'design-learning-runtime-runner/v0',
        runtimeInput: {
            plan: input.request.plan,
            generatedAt: input.generatedAt,
            scope: normalizeScope(input.scope),
            requiredAdapters: Array.from(new Set(input.requiredAdapters))
        },
        canStartRuntime: true,
        shouldCallInjectedProviders: true,
        requiresInjectedReferenceProviders: true,
        requiresInjectedVisualAnalysis: true,
        mustReviewBeforePersisting: true,
        shouldRunPhotoshop: false,
        shouldWriteEagle: false,
        shouldPersistMemory: false,
        canClaimDesignQuality: false
    };
}

function runtimePolicyBlockers(
    triggerSource: DesignLearningRuntimeTriggerSource,
    policy: Required<DesignLearningRuntimePolicy>
): string[] {
    if (!policy.enabled) return ['design_learning_runtime_enabled_required'];
    if (triggerSource === 'manual' && !policy.allowManual) return ['manual_design_learning_trigger_disabled'];
    if (triggerSource === 'app_start' && !policy.allowAppStart) return ['app_start_design_learning_trigger_disabled'];
    if (triggerSource === 'scheduled_timer' && !policy.allowScheduledTimer) return ['scheduled_design_learning_trigger_disabled'];
    return [];
}

function normalizeRuntimePolicy(value?: DesignLearningRuntimePolicy): Required<DesignLearningRuntimePolicy> {
    return {
        enabled: value?.enabled !== false,
        allowManual: value?.allowManual !== false,
        allowAppStart: value?.allowAppStart === true,
        allowScheduledTimer: value?.allowScheduledTimer === true,
        reviewQueueAvailable: value?.reviewQueueAvailable === true
    };
}

function normalizeAdapterAvailability(value?: DesignLearningRuntimeAdapterAvailability): Required<DesignLearningRuntimeAdapterAvailability> {
    return {
        eagleReadonlyProvider: value?.eagleReadonlyProvider === true,
        webSearchProvider: value?.webSearchProvider === true,
        projectCasesProvider: value?.projectCasesProvider === true,
        visualAnalysisAdapter: value?.visualAnalysisAdapter === true
    };
}

function normalizeTriggerSource(value: unknown): DesignLearningRuntimeTriggerSource {
    if (value === 'manual' || value === 'app_start' || value === 'scheduled_timer' || value === 'developer_smoke') {
        return value;
    }
    return DEFAULT_TRIGGER_SOURCE;
}

function normalizeScope(scope?: DesignMemoryScope): DesignMemoryScope {
    const type = scope?.type === 'project' || scope?.type === 'brand' || scope?.type === 'session' || scope?.type === 'user'
        ? scope.type
        : 'user';
    const id = cleanString(scope?.id);
    return id ? { type, id } : { type };
}

function buildRuntimeTriggerBoundary(): DesignLearningRuntimeTriggerBoundary {
    return {
        ...buildDesignLearningBoundary(),
        doesNotRunRuntime: true,
        doesNotCallInjectedProvidersItself: true,
        runtimeMayCallInjectedProviders: true,
        reviewRequiredBeforeMemoryPersistence: true
    };
}

function normalizeDateTime(value: unknown): string | undefined {
    if (value === undefined || value === null || value === '') return undefined;
    if (typeof value === 'number' && Number.isFinite(value)) return new Date(value).toISOString();
    const text = cleanString(value);
    if (!text) return undefined;
    const parsed = Date.parse(text);
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : undefined;
}

function cleanString(value: unknown): string {
    let text = String(value || '').trim();
    for (const pattern of UNSAFE_TEXT_PATTERNS) {
        text = text.replace(pattern, '[redacted]');
    }
    return text.replace(LOCAL_PATH_PATTERN, '[redacted-local-path]').replace(/\s+/g, ' ').trim();
}
