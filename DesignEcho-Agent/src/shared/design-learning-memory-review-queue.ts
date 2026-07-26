import type { DesignMemoryItem, DesignMemoryScope, DesignLearningInsights } from './design-memory-knowledge';
import { sanitizeDesignLearningVisualCase, type DesignLearningVisualCase } from './design-learning-visual-case';

export type DesignLearningMemoryReviewQueueVersion = 'design-learning-memory-review-queue/v0';
export type DesignLearningMemoryReviewQueueStatus = 'ready' | 'empty';

export interface BuildDesignLearningMemoryReviewQueueViewInput {
    items?: DesignMemoryItem[];
    scope?: DesignMemoryScope;
    limit?: number;
}

export interface DesignLearningMemoryReviewQueueItemView {
    candidateId: string;
    title: string;
    summary: string;
    scope: DesignMemoryScope;
    tags: string[];
    sourceNotes: string[];
    /** 结构化学习洞察明细（展示用）——让用户看清 Agent 学到的真实内容，缺省则省略。 */
    insights?: DesignLearningInsights;
    /** 学习视觉案例（真实参考图 + 分割主体框，展示用），缺省则省略。 */
    visualCase?: DesignLearningVisualCase;
    updatedAt?: string;
    actions: {
        approve: true;
        reject: true;
        keepForLater: true;
    };
}

export interface DesignLearningMemoryReviewQueueView {
    version: DesignLearningMemoryReviewQueueVersion;
    status: DesignLearningMemoryReviewQueueStatus;
    summary: {
        totalInputCount: number;
        pendingCount: number;
        returnedCount: number;
    };
    items: DesignLearningMemoryReviewQueueItemView[];
    blockers: string[];
    warnings: string[];
    boundaries: {
        readonly: true;
        doesNotPersistMemory: true;
        doesNotCallProvider: true;
        doesNotExecuteSearch: true;
        doesNotWriteEagle: true;
        noPhotoshopWrites: true;
        doesNotExposeRawImages: true;
        doesNotExposeLocalPaths: true;
        doesNotExposeScoreMarkers: true;
    };
}

const VERSION: DesignLearningMemoryReviewQueueVersion = 'design-learning-memory-review-queue/v0';
const LOCAL_PATH_PATTERN = /\b[A-Za-z]:[\\/][^\s"'，,；;]+/g;
const UNSAFE_PATTERNS = [
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
    /置信度?/g
];

export function buildDesignLearningMemoryReviewQueueView(
    input: BuildDesignLearningMemoryReviewQueueViewInput
): DesignLearningMemoryReviewQueueView {
    const limit = clampLimit(input.limit);
    const candidates = (Array.isArray(input.items) ? input.items : [])
        .filter((item) => isPendingDesignLearningCandidate(item))
        .filter((item) => matchesScope(item.scope, input.scope))
        .sort(compareMemoryItems);
    const items = candidates.slice(0, limit).map(toQueueItemView);

    return {
        version: VERSION,
        status: items.length > 0 ? 'ready' : 'empty',
        summary: {
            totalInputCount: Array.isArray(input.items) ? input.items.length : 0,
            pendingCount: candidates.length,
            returnedCount: items.length
        },
        items,
        blockers: [],
        warnings: candidates.length > limit ? [`${candidates.length - limit} 条待复核设计学习候选未在当前列表展示。`] : [],
        boundaries: {
            readonly: true,
            doesNotPersistMemory: true,
            doesNotCallProvider: true,
            doesNotExecuteSearch: true,
            doesNotWriteEagle: true,
            noPhotoshopWrites: true,
            doesNotExposeRawImages: true,
            doesNotExposeLocalPaths: true,
            doesNotExposeScoreMarkers: true
        }
    };
}

function toQueueItemView(item: DesignMemoryItem): DesignLearningMemoryReviewQueueItemView {
    return {
        candidateId: cleanString(item.id),
        title: cleanString(item.title),
        summary: cleanString(item.summary),
        scope: normalizeScope(item.scope),
        tags: uniqueStrings(item.tags || []).slice(0, 12),
        sourceNotes: (item.sourceNotes || [])
            .map((entry) => cleanString(`${entry.source}：${entry.summary}`))
            .filter(Boolean)
            .slice(0, 6),
        ...(sanitizeLearnedInsights(item.learnedInsights) ? { insights: sanitizeLearnedInsights(item.learnedInsights) } : {}),
        ...(sanitizeDesignLearningVisualCase(item.visualCase) ? { visualCase: sanitizeDesignLearningVisualCase(item.visualCase) } : {}),
        ...(normalizeDateTime(item.updatedAt || item.createdAt) ? { updatedAt: normalizeDateTime(item.updatedAt || item.createdAt) } : {}),
        actions: {
            approve: true,
            reject: true,
            keepForLater: true
        }
    };
}

/** 清洗结构化洞察：每类去空、去重、限量；全空则返回 undefined（面板不渲染空块）。 */
function sanitizeLearnedInsights(raw: DesignLearningInsights | undefined): DesignLearningInsights | undefined {
    if (!raw) return undefined;
    const pick = (list: string[] | undefined): string[] => uniqueStrings((list || []).map(cleanString).filter(Boolean)).slice(0, 8);
    const result: DesignLearningInsights = {};
    const whatLooksGood = pick(raw.whatLooksGood);
    const whyItWorks = pick(raw.whyItWorks);
    const reusableHeuristics = pick(raw.reusableHeuristics);
    const suitableScenarios = pick(raw.suitableScenarios);
    const avoidWhen = pick(raw.avoidWhen);
    const limitations = pick(raw.limitations);
    if (whatLooksGood.length) result.whatLooksGood = whatLooksGood;
    if (whyItWorks.length) result.whyItWorks = whyItWorks;
    if (reusableHeuristics.length) result.reusableHeuristics = reusableHeuristics;
    if (suitableScenarios.length) result.suitableScenarios = suitableScenarios;
    if (avoidWhen.length) result.avoidWhen = avoidWhen;
    if (limitations.length) result.limitations = limitations;
    return Object.keys(result).length > 0 ? result : undefined;
}

function isPendingDesignLearningCandidate(item: DesignMemoryItem | undefined): item is DesignMemoryItem {
    if (!item) return false;
    if (item.status !== 'needs_review') return false;
    if (item.kind !== 'visual_case') return false;
    if (item.source !== 'imported_case') return false;
    const tags = (item.tags || []).map(cleanString);
    if (tags.includes('design-learning')) return true;
    if (cleanString(item.id).startsWith('design-learning')) return true;
    return (item.sourceNotes || []).some((entry) => cleanString(entry.source) === 'design-learning-experience');
}

function compareMemoryItems(a: DesignMemoryItem, b: DesignMemoryItem): number {
    const aTime = Date.parse(String(a.updatedAt || a.createdAt || ''));
    const bTime = Date.parse(String(b.updatedAt || b.createdAt || ''));
    if (Number.isFinite(aTime) && Number.isFinite(bTime) && aTime !== bTime) {
        return bTime - aTime;
    }
    return cleanString(a.title).localeCompare(cleanString(b.title), 'zh-Hans-CN');
}

function matchesScope(itemScope: DesignMemoryScope | undefined, requested?: DesignMemoryScope): boolean {
    if (!requested) return true;
    const normalizedItem = normalizeScope(itemScope);
    const normalizedRequested = normalizeScope(requested);
    if (normalizedItem.type !== normalizedRequested.type) return false;
    if (normalizedRequested.id && normalizedItem.id !== normalizedRequested.id) return false;
    return true;
}

function normalizeScope(scope: DesignMemoryScope | undefined): DesignMemoryScope {
    const type = scope?.type === 'project' || scope?.type === 'brand' || scope?.type === 'session' || scope?.type === 'user'
        ? scope.type
        : 'user';
    const id = cleanString(scope?.id);
    return id ? { type, id } : { type };
}

function normalizeDateTime(value: unknown): string | undefined {
    if (value === undefined || value === null || value === '') return undefined;
    if (typeof value === 'number' && Number.isFinite(value)) return new Date(value).toISOString();
    const text = cleanString(value);
    if (!text) return undefined;
    const parsed = Date.parse(text);
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : text;
}

function clampLimit(value: unknown): number {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return 20;
    return Math.max(1, Math.min(100, Math.floor(numeric)));
}

function uniqueStrings(values: unknown[]): string[] {
    return Array.from(new Set(values.map(cleanString).filter(Boolean)));
}

function cleanString(value: unknown): string {
    let text = String(value || '').trim();
    for (const pattern of UNSAFE_PATTERNS) {
        text = text.replace(pattern, '[redacted]');
    }
    return text.replace(LOCAL_PATH_PATTERN, '[redacted-local-path]').replace(/\s+/g, ' ').trim();
}
