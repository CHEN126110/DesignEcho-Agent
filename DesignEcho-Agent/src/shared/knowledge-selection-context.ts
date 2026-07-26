import type {
    DesignKnowledgeAllowedUse,
    DesignKnowledgeResult,
    DesignKnowledgeSourceType
} from './design-knowledge-search';
import type { DesignLearningInsights } from './design-memory-knowledge';
import {
    assessDesignKnowledgeFreshness,
    selectDesignKnowledgeResultsForUse,
    type DesignKnowledgeFreshness
} from './design-knowledge-governance';

export const KNOWLEDGE_SELECTION_CONTEXT_VERSION = 'knowledge-selection-context/v0' as const;
export const MAX_KNOWLEDGE_SELECTION_REFERENCES = 5;

/**
 * 用户声明的引用用途。决定注入提示词时的边界句与洞察侧重，
 * 让 Agent 知道"这条知识当什么用"，避免把版式参考连配色文案一起抄。
 */
export type KnowledgeReferenceUseRole =
    | 'general'
    | 'layout'
    | 'style'
    | 'color'
    | 'copy'
    | 'product_fact'
    | 'mandatory_rule'
    | 'forbidden';

export interface KnowledgeReferenceUseRoleMeta {
    /** UI 展示用的中文用途名。 */
    label: string;
    /** 注入提示词的边界句：允许参考什么、不允许外溢到什么。 */
    boundary: string;
    /** 用途选择弹层里给用户看的说明。 */
    hint: string;
}

export const KNOWLEDGE_REFERENCE_USE_ROLES: Record<KnowledgeReferenceUseRole, KnowledgeReferenceUseRoleMeta> = {
    general: {
        label: '一般参考',
        boundary: '仅作为一般参考，不强制约束输出。',
        hint: '不指定具体用途'
    },
    layout: {
        label: '版式参考',
        boundary: '只约束构图与信息层级，不代表认可其配色、文案或商品内容。',
        hint: '只看构图和信息排布'
    },
    style: {
        label: '风格参考',
        boundary: '只参考整体气质与氛围，具体商品、图案与文案不得照搬。',
        hint: '只看气质和氛围'
    },
    color: {
        label: '配色参考',
        boundary: '只参考配色关系，不约束构图、字体或文案。',
        hint: '只看颜色搭配'
    },
    copy: {
        label: '文案参考',
        boundary: '只参考文案的语气与结构，不得照抄具体词句。',
        hint: '只看语气与结构'
    },
    product_fact: {
        label: '商品事实',
        boundary: '作为商品事实依据；与实时视觉观察冲突时，以真实观察为准并向用户说明。',
        hint: '当作产品事实依据'
    },
    mandatory_rule: {
        label: '强制规则',
        boundary: '必须遵守；与用户当前明确指令冲突时，向用户说明而不是静默违反。',
        hint: '必须遵守'
    },
    forbidden: {
        label: '禁止事项',
        boundary: '红线：输出不得出现该模式；无法避免时必须停止并说明。',
        hint: '红线，不得违反'
    }
};

const INSIGHTS_FIELD_LABELS: Record<keyof DesignLearningInsights, string> = {
    whatLooksGood: '好在哪',
    whyItWorks: '为什么有效',
    reusableHeuristics: '可复用启发',
    suitableScenarios: '适用场景',
    avoidWhen: '避免情况',
    limitations: '局限'
};

/** 不同用途关注不同的洞察字段；排在前面的字段优先占用摘要预算。 */
const INSIGHTS_FIELD_PRIORITY: Record<KnowledgeReferenceUseRole, Array<keyof DesignLearningInsights>> = {
    general: ['whyItWorks', 'reusableHeuristics', 'whatLooksGood', 'suitableScenarios', 'avoidWhen', 'limitations'],
    layout: ['reusableHeuristics', 'whatLooksGood', 'whyItWorks', 'suitableScenarios', 'avoidWhen', 'limitations'],
    style: ['whatLooksGood', 'whyItWorks', 'reusableHeuristics', 'suitableScenarios', 'avoidWhen', 'limitations'],
    color: ['whatLooksGood', 'whyItWorks', 'reusableHeuristics', 'suitableScenarios', 'avoidWhen', 'limitations'],
    copy: ['reusableHeuristics', 'whyItWorks', 'whatLooksGood', 'suitableScenarios', 'avoidWhen', 'limitations'],
    product_fact: ['suitableScenarios', 'whatLooksGood', 'limitations', 'avoidWhen', 'whyItWorks', 'reusableHeuristics'],
    mandatory_rule: ['reusableHeuristics', 'limitations', 'avoidWhen', 'whyItWorks', 'whatLooksGood', 'suitableScenarios'],
    forbidden: ['avoidWhen', 'limitations', 'whyItWorks', 'reusableHeuristics', 'whatLooksGood', 'suitableScenarios']
};

const MAX_INSIGHTS_ITEMS_PER_FIELD = 3;
const MAX_INSIGHTS_ITEM_LENGTH = 120;
const MAX_INSIGHTS_EXCERPT_LENGTH = 720;

export interface KnowledgeSelectionReference {
    version: typeof KNOWLEDGE_SELECTION_CONTEXT_VERSION;
    resultId: string;
    bindingRef: string;
    title: string;
    sourceType: DesignKnowledgeSourceType;
    sourceRevision: string;
    contentFingerprint: string;
    freshness: DesignKnowledgeFreshness;
    /** 来源声明的失效时间；提交请求时会再次计算新鲜度。 */
    expiresAt?: string;
    allowedUses: DesignKnowledgeAllowedUse[];
    /** 只在当前请求中使用的脱敏短摘要，不是持久化知识副本。 */
    contextExcerpt: string;
    /** 用户声明的引用用途；缺省为 general。决定注入时的边界句与洞察侧重。 */
    useRole?: KnowledgeReferenceUseRole;
    /** 已复核条目随引用进入的有界洞察摘要（≤720 字，已脱敏）；仅作参考，不授予权限。 */
    insightsExcerpt?: string;
    selectedAt: string;
}

export interface KnowledgeSelectionResult {
    ok: boolean;
    reference?: KnowledgeSelectionReference;
    reason?: string;
}

export interface CreateKnowledgeSelectionOptions {
    useRole?: KnowledgeReferenceUseRole;
    /** 来源长期知识条目的结构化洞察；仅当条目已复核（active）并可生成引用时才会随引用进入。 */
    insights?: DesignLearningInsights;
}

export function normalizeKnowledgeReferenceUseRole(value: unknown): KnowledgeReferenceUseRole {
    return typeof value === 'string' && value in KNOWLEDGE_REFERENCE_USE_ROLES
        ? value as KnowledgeReferenceUseRole
        : 'general';
}

/**
 * 把结构化洞察压成有界摘要：按用途排字段优先级，每字段≤3 条、每条≤120 字、
 * 总计≤720 字，剥离本地路径与图像载荷；没有可用内容时返回 undefined。
 */
export function buildKnowledgeReferenceInsightsExcerpt(
    insights: DesignLearningInsights | undefined,
    useRole: KnowledgeReferenceUseRole = 'general'
): string | undefined {
    if (!insights) return undefined;
    const priority = INSIGHTS_FIELD_PRIORITY[useRole] || INSIGHTS_FIELD_PRIORITY.general;
    const segments: string[] = [];
    let total = 0;
    for (const field of priority) {
        const items = Array.from(new Set(
            (insights[field] || [])
                .map((item) => cleanText(item, MAX_INSIGHTS_ITEM_LENGTH))
                .filter(Boolean)
        )).slice(0, MAX_INSIGHTS_ITEMS_PER_FIELD);
        if (items.length === 0) continue;
        const segment = `${INSIGHTS_FIELD_LABELS[field]}：${items.join('；')}`;
        if (total + segment.length > MAX_INSIGHTS_EXCERPT_LENGTH) {
            const remaining = MAX_INSIGHTS_EXCERPT_LENGTH - total;
            // 剩余空间不足以表达一条完整语义时直接截停，不制造半句话。
            if (remaining < 32) break;
            segments.push(segment.slice(0, remaining));
            break;
        }
        segments.push(segment);
        total += segment.length;
    }
    if (segments.length === 0) return undefined;
    return cleanPayload(segments.join('；'), MAX_INSIGHTS_EXCERPT_LENGTH);
}

export function createKnowledgeSelectionReference(
    result: DesignKnowledgeResult,
    now: unknown = new Date().toISOString(),
    options?: CreateKnowledgeSelectionOptions
): KnowledgeSelectionResult {
    const selection = selectDesignKnowledgeResultsForUse([result], {
        purpose: 'user_reference',
        now
    });
    if (selection.usableResults.length !== 1) {
        return {
            ok: false,
            reason: selection.reviewResults.length > 0
                ? '这条知识已过期或缺少版本信息，请先复核更新。'
                : '这条知识当前已停用、被替代或不允许作为用户参考。'
        };
    }
    const governance = result.governance;
    const binding = selection.snapshot.bindings[0];
    if (!governance || !binding || binding.freshness !== 'current') {
        return { ok: false, reason: '这条知识缺少当前有效的治理版本。' };
    }
    const useRole = normalizeKnowledgeReferenceUseRole(options?.useRole);
    const insightsExcerpt = buildKnowledgeReferenceInsightsExcerpt(options?.insights, useRole);
    return {
        ok: true,
        reference: {
            version: KNOWLEDGE_SELECTION_CONTEXT_VERSION,
            resultId: cleanText(result.id, 240),
            bindingRef: cleanText(binding.bindingRef, 240),
            title: cleanText(result.title, 240),
            sourceType: result.sourceType,
            sourceRevision: cleanText(governance.sourceRevision, 240),
            contentFingerprint: cleanText(governance.contentFingerprint, 240),
            freshness: assessDesignKnowledgeFreshness(result, now),
            ...(normalizeOptionalIsoTime(governance.expiresAt)
                ? { expiresAt: normalizeOptionalIsoTime(governance.expiresAt) }
                : {}),
            allowedUses: [...binding.allowedUses],
            contextExcerpt: cleanPayload(result.summary, 720),
            useRole,
            ...(insightsExcerpt ? { insightsExcerpt } : {}),
            selectedAt: normalizeIsoTime(now)
        }
    };
}

export function upsertKnowledgeSelectionReference(
    references: KnowledgeSelectionReference[],
    reference: KnowledgeSelectionReference
): KnowledgeSelectionReference[] {
    return [
        reference,
        ...references.filter((item) => item.bindingRef !== reference.bindingRef)
    ].slice(0, MAX_KNOWLEDGE_SELECTION_REFERENCES);
}

export function normalizeKnowledgeSelectionReferences(
    references: KnowledgeSelectionReference[] | null | undefined,
    now: unknown = new Date().toISOString()
): KnowledgeSelectionReference[] {
    if (!Array.isArray(references)) return [];
    const normalized: KnowledgeSelectionReference[] = [];
    for (const item of references) {
        if (!item || item.version !== KNOWLEDGE_SELECTION_CONTEXT_VERSION) continue;
        const resultId = cleanText(item.resultId, 240);
        const bindingRef = cleanText(item.bindingRef, 240);
        const title = cleanText(item.title, 240);
        const sourceRevision = cleanText(item.sourceRevision, 240);
        const contentFingerprint = cleanText(item.contentFingerprint, 240);
        if (!resultId || !bindingRef || !title || !sourceRevision || !contentFingerprint) continue;
        const expiresAt = normalizeOptionalIsoTime(item.expiresAt);
        const useRole = normalizeKnowledgeReferenceUseRole(item.useRole);
        const insightsExcerpt = cleanPayload(item.insightsExcerpt, 720);
        normalized.push({
            version: KNOWLEDGE_SELECTION_CONTEXT_VERSION,
            resultId,
            bindingRef,
            title,
            sourceType: item.sourceType,
            sourceRevision,
            contentFingerprint,
            freshness: resolveReferenceFreshness(item.freshness, expiresAt, now),
            ...(expiresAt ? { expiresAt } : {}),
            allowedUses: normalizeAllowedUses(item.allowedUses),
            contextExcerpt: cleanPayload(item.contextExcerpt, 720),
            useRole,
            ...(insightsExcerpt ? { insightsExcerpt } : {}),
            selectedAt: normalizeIsoTime(item.selectedAt)
        });
    }
    return normalized.slice(0, MAX_KNOWLEDGE_SELECTION_REFERENCES);
}

function cleanText(value: unknown, limit: number): string {
    return String(value || '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit);
}

function cleanPayload(value: unknown, limit: number): string {
    return cleanText(value, limit)
        .replace(/\b[A-Za-z]:[\\/].*$/g, '[redacted-local-path]')
        .replace(/file:\/\/[^\s]+/gi, '[redacted-local-path]')
        .replace(/data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+/gi, '[redacted-image-payload]')
        .replace(/base64/gi, '[redacted]');
}

function normalizeAllowedUses(values: unknown): DesignKnowledgeAllowedUse[] {
    const allowed: DesignKnowledgeAllowedUse[] = [
        'prompt_context',
        'user_reference',
        'recipe_hint',
        'benchmark_seed'
    ];
    if (!Array.isArray(values)) return [];
    return Array.from(new Set(
        values.filter((value): value is DesignKnowledgeAllowedUse => (
            allowed.includes(value as DesignKnowledgeAllowedUse)
        ))
    ));
}

function resolveReferenceFreshness(
    freshness: DesignKnowledgeFreshness,
    expiresAt: string | undefined,
    now: unknown
): DesignKnowledgeFreshness {
    if (freshness !== 'current') return freshness;
    if (!expiresAt) return 'current';
    return Date.parse(expiresAt) <= Date.parse(normalizeIsoTime(now)) ? 'stale' : 'current';
}

function normalizeOptionalIsoTime(value: unknown): string | undefined {
    const parsed = Date.parse(String(value || ''));
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : undefined;
}

function normalizeIsoTime(value: unknown): string {
    const parsed = Date.parse(String(value || ''));
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : new Date().toISOString();
}
