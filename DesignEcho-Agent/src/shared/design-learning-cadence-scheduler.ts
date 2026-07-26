import {
    buildDesignLearningBoundary,
    buildDesignLearningDailyResearchPlan,
    type DesignLearningBoundary,
    type DesignLearningCadence,
    type DesignLearningDailyResearchPlan,
    type DesignLearningSourceAvailability
} from './design-learning-experience';

export type DesignLearningCadenceSchedulerVersion = 'design-learning-cadence-scheduler/v0';
export type DesignLearningCadenceSchedulerStatus =
    | 'ready_to_run'
    | 'not_due'
    | 'waiting_manual_trigger'
    | 'blocked_no_reference_sources';

export interface BuildDesignLearningCadenceScheduleInput {
    now?: unknown;
    cadence?: DesignLearningCadence;
    lastRunAt?: unknown;
    preferredTopics?: unknown;
    knowledgeGaps?: unknown;
    recentRejectedTopics?: unknown;
    sourceAvailability?: DesignLearningSourceAvailability;
    maxReferences?: unknown;
}

export interface DesignLearningRuntimeRequest {
    plan: DesignLearningDailyResearchPlan;
    canRunRuntime: boolean;
    mustUseInjectedReferenceProviders: true;
    mustUseInjectedVisualAnalysis: true;
    mustReviewBeforePersisting: true;
    runtimeRunnerVersion: 'design-learning-runtime-runner/v0';
}

export interface DesignLearningCadenceSchedule {
    version: DesignLearningCadenceSchedulerVersion;
    status: DesignLearningCadenceSchedulerStatus;
    now: string;
    cadence: DesignLearningCadence;
    due: boolean;
    lastRunAt?: string;
    nextRunAt?: string;
    topics: string[];
    sourceAvailability: Required<DesignLearningSourceAvailability>;
    maxReferences: number;
    runRequest?: DesignLearningRuntimeRequest;
    blockers: string[];
    warnings: string[];
    limitations: string[];
    boundaries: DesignLearningBoundary;
}

const VERSION: DesignLearningCadenceSchedulerVersion = 'design-learning-cadence-scheduler/v0';
const DEFAULT_TOPICS = [
    '电商袜子主图设计参考',
    'SKU 色卡精修与光影统一',
    '详情页首屏图文节奏',
    '商品选图与主体置入'
];
const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;
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
    /"pixels"/gi,
    /"confidence"/gi,
    /\bconfidence\b/gi,
    /置信/g
];
const LOCAL_PATH_PATTERN = /\b[A-Za-z]:[\\/][^\s"'，,；;]+/;

export function buildDesignLearningCadenceSchedule(
    input: BuildDesignLearningCadenceScheduleInput
): DesignLearningCadenceSchedule {
    const now = normalizeDateTime(input.now) || new Date().toISOString();
    const cadence = normalizeCadence(input.cadence);
    const lastRunAt = normalizeDateTime(input.lastRunAt);
    const sourceAvailability = normalizeSourceAvailability(input.sourceAvailability);
    const maxReferences = clampNumber(input.maxReferences, 1, 30, 8);
    const topics = buildLearningTopics({
        preferredTopics: input.preferredTopics,
        knowledgeGaps: input.knowledgeGaps,
        recentRejectedTopics: input.recentRejectedTopics
    });
    const boundaries = buildDesignLearningBoundary();
    const blockers = hasReferenceSources(sourceAvailability) ? [] : ['reference_source_required'];
    const nextRunAt = computeNextRunAt({ now, lastRunAt, cadence });
    const due = blockers.length === 0 && isDue({ now, cadence, lastRunAt });
    const status = resolveScheduleStatus({ cadence, due, blockers });
    const warnings = buildWarnings({ sourceAvailability, topics, lastRunAt });
    const limitations = [
        '该调度器只决定是否生成每日学习运行请求，不执行搜索、模型分析、Eagle 写入、Photoshop 写入或记忆持久化。',
        '学习运行必须通过 injected reference providers 和 injected visual analysis adapter 完成，不能在调度器里内置外部服务。',
        '学习结果只能进入待复核记忆候选；复核前不能成为主动设计知识，也不能改变业务 skill 写入参数。',
        '偏好和知识缺口只影响学习主题排序，不覆盖当前用户请求、项目素材观察、平台规范或人工验收。'
    ];

    const schedule: DesignLearningCadenceSchedule = {
        version: VERSION,
        status,
        now,
        cadence,
        due,
        ...(lastRunAt ? { lastRunAt } : {}),
        ...(nextRunAt ? { nextRunAt } : {}),
        topics,
        sourceAvailability,
        maxReferences,
        blockers,
        warnings,
        limitations,
        boundaries
    };

    if (status === 'ready_to_run') {
        const plan = buildDesignLearningDailyResearchPlan({
            date: now.slice(0, 10),
            cadence,
            topics,
            sourceAvailability,
            maxReferences
        });
        if (plan.status === 'ready_for_runtime') {
            schedule.runRequest = {
                plan,
                canRunRuntime: true,
                mustUseInjectedReferenceProviders: true,
                mustUseInjectedVisualAnalysis: true,
                mustReviewBeforePersisting: true,
                runtimeRunnerVersion: 'design-learning-runtime-runner/v0'
            };
        } else {
            schedule.status = 'blocked_no_reference_sources';
            schedule.due = false;
            schedule.blockers = Array.from(new Set([...schedule.blockers, ...plan.blockers]));
        }
    }

    return schedule;
}

function normalizeCadence(value: unknown): DesignLearningCadence {
    return value === 'manual' || value === 'weekly' || value === 'daily' ? value : 'daily';
}

function normalizeDateTime(value: unknown): string | undefined {
    if (value === undefined || value === null || value === '') return undefined;
    if (typeof value === 'number' && Number.isFinite(value)) return new Date(value).toISOString();
    const text = cleanString(value);
    if (!text) return undefined;
    const parsed = Date.parse(text);
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : undefined;
}

function normalizeSourceAvailability(sourceAvailability?: DesignLearningSourceAvailability): Required<DesignLearningSourceAvailability> {
    return {
        eagleReadonly: sourceAvailability?.eagleReadonly === true,
        webSearch: sourceAvailability?.webSearch === true,
        projectCases: sourceAvailability?.projectCases === true,
        visualAnalysis: sourceAvailability?.visualAnalysis === true
    };
}

function hasReferenceSources(sourceAvailability: Required<DesignLearningSourceAvailability>): boolean {
    return sourceAvailability.eagleReadonly || sourceAvailability.webSearch || sourceAvailability.projectCases;
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(min, Math.min(max, Math.round(parsed)));
}

function buildLearningTopics(input: {
    preferredTopics?: unknown;
    knowledgeGaps?: unknown;
    recentRejectedTopics?: unknown;
}): string[] {
    const rejected = new Set(toCleanStringList(input.recentRejectedTopics).map((item) => item.toLowerCase()));
    const candidates = [
        ...toCleanStringList(input.preferredTopics),
        ...toCleanStringList(input.knowledgeGaps),
        ...DEFAULT_TOPICS
    ];
    const topics: string[] = [];
    const seen = new Set<string>();
    for (const candidate of candidates) {
        const normalized = candidate.toLowerCase();
        if (!candidate || seen.has(normalized) || rejected.has(normalized)) continue;
        seen.add(normalized);
        topics.push(candidate);
        if (topics.length >= 12) break;
    }
    return topics;
}

function toCleanStringList(value: unknown): string[] {
    const input = Array.isArray(value) ? value : [value];
    return input
        .map(cleanString)
        .filter(Boolean)
        .filter((item) => !isUnsafeText(item));
}

function cleanString(value: unknown): string {
    let text = String(value || '').trim();
    for (const pattern of UNSAFE_TEXT_PATTERNS) {
        text = text.replace(pattern, '[redacted]');
    }
    return text.replace(/\s+/g, ' ').trim();
}

function isUnsafeText(value: string): boolean {
    if (!value || value.includes('[redacted]')) return true;
    return LOCAL_PATH_PATTERN.test(value);
}

function computeNextRunAt(input: {
    now: string;
    lastRunAt?: string;
    cadence: DesignLearningCadence;
}): string | undefined {
    if (input.cadence === 'manual') return undefined;
    if (!input.lastRunAt) return input.now;
    const last = Date.parse(input.lastRunAt);
    if (!Number.isFinite(last)) return input.now;
    const interval = input.cadence === 'weekly' ? WEEK_MS : DAY_MS;
    return new Date(last + interval).toISOString();
}

function isDue(input: {
    now: string;
    cadence: DesignLearningCadence;
    lastRunAt?: string;
}): boolean {
    if (input.cadence === 'manual') return false;
    if (!input.lastRunAt) return true;
    const nowMs = Date.parse(input.now);
    const lastMs = Date.parse(input.lastRunAt);
    if (!Number.isFinite(nowMs) || !Number.isFinite(lastMs)) return true;
    const interval = input.cadence === 'weekly' ? WEEK_MS : DAY_MS;
    return nowMs - lastMs >= interval;
}

function resolveScheduleStatus(input: {
    cadence: DesignLearningCadence;
    due: boolean;
    blockers: string[];
}): DesignLearningCadenceSchedulerStatus {
    if (input.blockers.length > 0) return 'blocked_no_reference_sources';
    if (input.cadence === 'manual') return 'waiting_manual_trigger';
    return input.due ? 'ready_to_run' : 'not_due';
}

function buildWarnings(input: {
    sourceAvailability: Required<DesignLearningSourceAvailability>;
    topics: string[];
    lastRunAt?: string;
}): string[] {
    const warnings: string[] = [];
    if (!input.sourceAvailability.visualAnalysis) {
        warnings.push('visual_analysis_adapter_required_before_runtime');
    }
    if (!input.sourceAvailability.webSearch) {
        warnings.push('web_search_source_unavailable');
    }
    if (!input.sourceAvailability.eagleReadonly) {
        warnings.push('eagle_readonly_source_unavailable');
    }
    if (!input.lastRunAt) {
        warnings.push('first_run_has_no_previous_learning_timestamp');
    }
    if (input.topics.length === 0) {
        warnings.push('learning_topics_fell_back_to_defaults');
    }
    return Array.from(new Set(warnings));
}
