import type {
    DesignKnowledgeAllowedUse,
    DesignKnowledgeIntent,
    DesignKnowledgeResult,
    DesignKnowledgeSourceType
} from './design-knowledge-search';

export type DesignKnowledgeProvenanceKind =
    | 'bundled_curated'
    | 'local_reviewed'
    | 'local_snapshot'
    | 'external_live'
    | 'external_snapshot'
    | 'legacy_unversioned';

export type DesignKnowledgeLifecycleStatus = 'active' | 'withdrawn' | 'superseded';
export type DesignKnowledgeFreshness =
    | 'current'
    | 'stale'
    | 'withdrawn'
    | 'superseded'
    | 'invalid'
    | 'legacy_unversioned';

export interface DesignKnowledgeGovernanceRecord {
    version: 'design-knowledge-governance/v0';
    contentFingerprint: string;
    sourceRevision: string;
    provenance: DesignKnowledgeProvenanceKind;
    lifecycleStatus: DesignKnowledgeLifecycleStatus;
    retrievedAt: string;
    publishedAt?: string;
    expiresAt?: string;
    supersededBy?: string;
    /** 本地意外修改检测；不是密码学签名或远端身份认证。 */
    integrityFingerprint: string;
}

export interface DesignKnowledgeBinding {
    bindingRef: string;
    contentFingerprint: string;
    sourceRevision: string;
    sourceType: DesignKnowledgeSourceType;
    freshness: DesignKnowledgeFreshness;
    allowedUses: DesignKnowledgeAllowedUse[];
}

/**
 * 用户对某一“具体来源版本”的治理决定。它不是新的知识副本，只覆盖该版本是否
 * 允许进入目录与 Agent 使用面；来源更新到新 revision 后会重新出现，等待再次判断。
 */
export interface DesignKnowledgeDisposition {
    version: 'design-knowledge-disposition/v0';
    dispositionId: string;
    resultId: string;
    title: string;
    sourceType: DesignKnowledgeSourceType;
    sourceRevision: string;
    contentFingerprint: string;
    status: 'disabled';
    reason: string;
    updatedAt: string;
}

export interface DesignKnowledgeDispositionSelection {
    visibleResults: DesignKnowledgeResult[];
    disabledResults: DesignKnowledgeResult[];
}

export interface DesignKnowledgeUsageSnapshot {
    version: 'design-knowledge-usage-snapshot/v0';
    capturedAt: string;
    queryFingerprint?: string;
    purpose: 'planning' | 'prompt_context' | 'user_reference' | 'evaluation';
    bindings: DesignKnowledgeBinding[];
    counts: {
        total: number;
        usable: number;
        needsReview: number;
        blocked: number;
        current: number;
        stale: number;
        legacyUnversioned: number;
        withdrawnOrSuperseded: number;
        invalid: number;
    };
    snapshotFingerprint: string;
    doesNotGrantToolPermission: true;
}

export interface DesignKnowledgeUseSelection {
    usableResults: DesignKnowledgeResult[];
    reviewResults: DesignKnowledgeResult[];
    blockedResults: DesignKnowledgeResult[];
    snapshot: DesignKnowledgeUsageSnapshot;
}

export interface GovernDesignKnowledgeOptions {
    provenance: Exclude<DesignKnowledgeProvenanceKind, 'legacy_unversioned'>;
    sourceRevision: unknown;
    retrievedAt?: unknown;
    publishedAt?: unknown;
    expiresAt?: unknown;
    lifecycleStatus?: unknown;
    supersededBy?: unknown;
}

export function buildBundledKnowledgeArtifactRecord(input: {
    id: string;
    title: string;
    summary: string;
    intent?: DesignKnowledgeIntent;
    sourceRevision: string;
}): {
    governance: DesignKnowledgeGovernanceRecord;
    usageSnapshot: DesignKnowledgeUsageSnapshot;
} {
    const result = governDesignKnowledgeResult({
        id: input.id,
        title: input.title,
        intent: input.intent || 'rule',
        sourceType: 'manual_rule',
        summary: input.summary,
        sourceNotes: ['Bundled curated knowledge artifact; content is reference context only.'],
        tags: ['bundled-knowledge-artifact'],
        allowedUses: ['prompt_context', 'user_reference'],
        sourceLevel: 'curated_rule',
        sourceRank: 100
    }, {
        provenance: 'bundled_curated',
        sourceRevision: input.sourceRevision,
        retrievedAt: '2026-07-12T00:00:00.000Z'
    });
    return {
        governance: result.governance as DesignKnowledgeGovernanceRecord,
        usageSnapshot: selectDesignKnowledgeResultsForUse([result], {
            purpose: 'prompt_context'
        }).snapshot
    };
}

const GOVERNANCE_VERSION = 'design-knowledge-governance/v0' as const;
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;

export function governDesignKnowledgeResult(
    result: DesignKnowledgeResult,
    options: GovernDesignKnowledgeOptions
): DesignKnowledgeResult {
    const retrievedAt = normalizeIsoTime(options.retrievedAt || result.updatedAt);
    const lifecycleStatus = normalizeLifecycleStatus(options.lifecycleStatus);
    const sourceRevision = sanitizeRevision(options.sourceRevision)
        || createStableFingerprint('knowledge-revision', `${result.sourceType}:${result.id}:${retrievedAt}`);
    const governanceCore: Omit<DesignKnowledgeGovernanceRecord, 'integrityFingerprint'> = {
        version: GOVERNANCE_VERSION,
        contentFingerprint: createDesignKnowledgeContentFingerprint(result),
        sourceRevision,
        provenance: options.provenance,
        lifecycleStatus,
        retrievedAt,
        publishedAt: normalizeOptionalIsoTime(options.publishedAt),
        expiresAt: normalizeOptionalIsoTime(options.expiresAt),
        supersededBy: lifecycleStatus === 'superseded'
            ? sanitizeRevision(options.supersededBy) || undefined
            : undefined
    };
    const governance: DesignKnowledgeGovernanceRecord = {
        ...governanceCore,
        integrityFingerprint: createGovernanceIntegrity(governanceCore)
    };
    return {
        ...result,
        updatedAt: result.updatedAt || retrievedAt,
        governance
    };
}

export function governExternalDesignKnowledgeResult(
    result: DesignKnowledgeResult,
    input: {
        retrievedAt?: unknown;
        publishedAt?: unknown;
        expiresAt?: unknown;
        sourceRevision?: unknown;
        lifecycleStatus?: unknown;
        supersededBy?: unknown;
    } = {}
): DesignKnowledgeResult {
    const retrievedAt = normalizeIsoTime(input.retrievedAt || result.updatedAt);
    const expiresAt = normalizeOptionalIsoTime(input.expiresAt)
        || new Date(Date.parse(retrievedAt) + defaultExternalTtlMs(result.intent, result.sourceType)).toISOString();
    return governDesignKnowledgeResult(result, {
        provenance: result.sourceType === 'eagle_library' ? 'local_snapshot' : 'external_live',
        sourceRevision: input.sourceRevision || createStableFingerprint('source-revision', `${result.sourceType}:${result.id}:${retrievedAt}`),
        retrievedAt,
        publishedAt: input.publishedAt,
        expiresAt,
        lifecycleStatus: input.lifecycleStatus,
        supersededBy: input.supersededBy
    });
}

export function assessDesignKnowledgeFreshness(
    result: DesignKnowledgeResult,
    now: unknown = new Date().toISOString()
): DesignKnowledgeFreshness {
    const governance = result.governance;
    if (!governance) return 'legacy_unversioned';
    if (governance.version !== GOVERNANCE_VERSION) return 'invalid';
    if (governance.contentFingerprint !== createDesignKnowledgeContentFingerprint(result)) return 'invalid';
    if (governance.integrityFingerprint !== createGovernanceIntegrity(governance)) return 'invalid';
    if (!sanitizeRevision(governance.sourceRevision)) return 'invalid';
    const nowMs = Date.parse(normalizeIsoTime(now));
    const retrievedAtMs = Date.parse(String(governance.retrievedAt || ''));
    if (!Number.isFinite(retrievedAtMs) || retrievedAtMs > nowMs + MAX_FUTURE_SKEW_MS) return 'invalid';
    if (governance.lifecycleStatus === 'withdrawn') return 'withdrawn';
    if (governance.lifecycleStatus === 'superseded') return 'superseded';
    const expiresAtMs = Date.parse(String(governance.expiresAt || ''));
    if (governance.expiresAt && (!Number.isFinite(expiresAtMs) || expiresAtMs <= nowMs)) return 'stale';
    return 'current';
}

export function selectDesignKnowledgeResultsForUse(
    results: DesignKnowledgeResult[] | null | undefined,
    input: {
        query?: unknown;
        now?: unknown;
        purpose?: DesignKnowledgeUsageSnapshot['purpose'];
    } = {}
): DesignKnowledgeUseSelection {
    const purpose = input.purpose || 'planning';
    const normalizedResults = Array.isArray(results) ? results.filter(Boolean) : [];
    const usableResults: DesignKnowledgeResult[] = [];
    const reviewResults: DesignKnowledgeResult[] = [];
    const blockedResults: DesignKnowledgeResult[] = [];
    const bindings: DesignKnowledgeBinding[] = [];

    for (const result of normalizedResults) {
        const freshness = assessDesignKnowledgeFreshness(result, input.now);
        const allowedUses = normalizeAllowedUses(result.allowedUses);
        const currentUseAllowed = freshness === 'current' && isPurposeAllowed(purpose, allowedUses);
        if (currentUseAllowed) usableResults.push(result);
        else if (freshness === 'stale' || freshness === 'legacy_unversioned') reviewResults.push(result);
        else blockedResults.push(result);
        bindings.push({
            bindingRef: createStableFingerprint('knowledge-binding', String(result.id || 'unknown')),
            contentFingerprint: result.governance?.contentFingerprint || createDesignKnowledgeContentFingerprint(result),
            sourceRevision: result.governance?.sourceRevision || 'legacy-unversioned',
            sourceType: result.sourceType,
            freshness,
            allowedUses
        });
    }

    const capturedAt = normalizeIsoTime(input.now);
    const counts = {
        total: bindings.length,
        usable: usableResults.length,
        needsReview: reviewResults.length,
        blocked: blockedResults.length,
        current: bindings.filter((binding) => binding.freshness === 'current').length,
        stale: bindings.filter((binding) => binding.freshness === 'stale').length,
        legacyUnversioned: bindings.filter((binding) => binding.freshness === 'legacy_unversioned').length,
        withdrawnOrSuperseded: bindings.filter((binding) => binding.freshness === 'withdrawn' || binding.freshness === 'superseded').length,
        invalid: bindings.filter((binding) => binding.freshness === 'invalid').length
    };
    const queryText = sanitizeText(input.query, 400);
    const snapshotCore = {
        purpose,
        queryFingerprint: queryText ? createStableFingerprint('knowledge-query', queryText.toLowerCase()) : undefined,
        bindings: bindings.map((binding) => ({
            bindingRef: binding.bindingRef,
            contentFingerprint: binding.contentFingerprint,
            sourceRevision: binding.sourceRevision,
            sourceType: binding.sourceType,
            freshness: binding.freshness,
            allowedUses: binding.allowedUses
        })).sort((left, right) => left.bindingRef.localeCompare(right.bindingRef)),
        counts
    };
    return {
        usableResults,
        reviewResults,
        blockedResults,
        snapshot: {
            version: 'design-knowledge-usage-snapshot/v0',
            capturedAt,
            ...(snapshotCore.queryFingerprint ? { queryFingerprint: snapshotCore.queryFingerprint } : {}),
            purpose,
            bindings,
            counts,
            snapshotFingerprint: createStableFingerprint('knowledge-snapshot', JSON.stringify(snapshotCore)),
            doesNotGrantToolPermission: true
        }
    };
}

export function createDesignKnowledgeDisposition(
    result: DesignKnowledgeResult,
    input: { reason?: unknown; now?: unknown } = {}
): DesignKnowledgeDisposition {
    const governed = result.governance;
    const sourceRevision = sanitizeRevision(governed?.sourceRevision) || 'legacy-unversioned';
    const contentFingerprint = governed?.contentFingerprint || createDesignKnowledgeContentFingerprint(result);
    const dispositionId = createStableFingerprint(
        'knowledge-disposition',
        `${result.sourceType}:${result.id}:${sourceRevision}:${contentFingerprint}`
    );
    return {
        version: 'design-knowledge-disposition/v0',
        dispositionId,
        resultId: sanitizeText(result.id, 240) || 'unknown',
        title: sanitizeText(result.title, 240) || '未命名知识',
        sourceType: result.sourceType,
        sourceRevision,
        contentFingerprint,
        status: 'disabled',
        reason: sanitizeText(input.reason, 600) || '用户从知识库中剔除该版本。',
        updatedAt: normalizeIsoTime(input.now)
    };
}

export function applyDesignKnowledgeDispositions(
    results: DesignKnowledgeResult[] | null | undefined,
    dispositions: DesignKnowledgeDisposition[] | null | undefined
): DesignKnowledgeDispositionSelection {
    const disabledKeys = new Set(
        (Array.isArray(dispositions) ? dispositions : [])
            .filter((item) => item?.version === 'design-knowledge-disposition/v0' && item.status === 'disabled')
            .map((item) => dispositionMatchKey({
                resultId: item.resultId,
                sourceType: item.sourceType,
                sourceRevision: item.sourceRevision,
                contentFingerprint: item.contentFingerprint
            }))
    );
    const visibleResults: DesignKnowledgeResult[] = [];
    const disabledResults: DesignKnowledgeResult[] = [];
    for (const result of Array.isArray(results) ? results : []) {
        const sourceRevision = sanitizeRevision(result.governance?.sourceRevision) || 'legacy-unversioned';
        const contentFingerprint = result.governance?.contentFingerprint || createDesignKnowledgeContentFingerprint(result);
        const key = dispositionMatchKey({
            resultId: result.id,
            sourceType: result.sourceType,
            sourceRevision,
            contentFingerprint
        });
        if (disabledKeys.has(key)) disabledResults.push(result);
        else visibleResults.push(result);
    }
    return { visibleResults, disabledResults };
}

function dispositionMatchKey(input: {
    resultId: string;
    sourceType: DesignKnowledgeSourceType;
    sourceRevision: string;
    contentFingerprint: string;
}): string {
    return [
        input.sourceType,
        sanitizeText(input.resultId, 240),
        sanitizeRevision(input.sourceRevision) || 'legacy-unversioned',
        sanitizeRevision(input.contentFingerprint) || 'unknown'
    ].join('|');
}

export function createDesignKnowledgeContentFingerprint(result: DesignKnowledgeResult): string {
    return createStableFingerprint('knowledge-content', JSON.stringify({
        id: sanitizeText(result.id, 240),
        title: sanitizeText(result.title, 300),
        intent: result.intent,
        sourceType: result.sourceType,
        summary: sanitizeText(result.summary, 40000),
        sourceNotes: normalizeStrings(result.sourceNotes, 40, 500),
        tags: normalizeStrings(result.tags, 40, 120).sort(),
        allowedUses: normalizeAllowedUses(result.allowedUses).sort(),
        sourceLevel: result.sourceLevel,
        sourceLocation: normalizeSourceLocation(result.sourceUrl)
    }));
}

export function buildBundledKnowledgeRevision(namespace: string): string {
    return sanitizeRevision(`bundle-${namespace}`) || 'bundle-design-knowledge-v0';
}

function isPurposeAllowed(
    purpose: DesignKnowledgeUsageSnapshot['purpose'],
    allowedUses: DesignKnowledgeAllowedUse[]
): boolean {
    if (purpose === 'prompt_context' || purpose === 'planning') return allowedUses.includes('prompt_context');
    if (purpose === 'user_reference') return allowedUses.includes('user_reference');
    return false;
}

function defaultExternalTtlMs(intent: DesignKnowledgeIntent, sourceType: DesignKnowledgeSourceType): number {
    if (intent === 'trend' || intent === 'market_insight' || intent === 'platform_spec') return 24 * 60 * 60 * 1000;
    if (sourceType === 'eagle_library' || intent === 'reference') return 30 * 24 * 60 * 60 * 1000;
    return 7 * 24 * 60 * 60 * 1000;
}

function normalizeAllowedUses(value: unknown): DesignKnowledgeAllowedUse[] {
    const allowed: DesignKnowledgeAllowedUse[] = ['prompt_context', 'user_reference', 'recipe_hint', 'benchmark_seed'];
    if (!Array.isArray(value)) return [];
    return Array.from(new Set(value.filter((item): item is DesignKnowledgeAllowedUse => allowed.includes(item as DesignKnowledgeAllowedUse))));
}

function normalizeLifecycleStatus(value: unknown): DesignKnowledgeLifecycleStatus {
    if (value === 'withdrawn' || value === 'superseded') return value;
    return 'active';
}

function normalizeStrings(value: unknown, limit: number, maxLength: number): string[] {
    if (!Array.isArray(value)) return [];
    return Array.from(new Set(value.map((item) => sanitizeText(item, maxLength)).filter(Boolean))).slice(0, limit);
}

function normalizeSourceLocation(value: unknown): string {
    const text = sanitizeText(value, 500);
    const match = text.match(/^(https?):\/\/([^/?#]+)([^?#]*)/i);
    return match ? `${match[1].toLowerCase()}://${match[2].toLowerCase()}${match[3] || '/'}` : '';
}

function sanitizeRevision(value: unknown): string {
    const text = sanitizeText(value, 160).toLowerCase();
    if (!text || /(?:api[_-]?key|secret|token|password|[a-z]:[\\/]|\\\\|:\/\/)/i.test(text)) return '';
    return text.replace(/[^a-z0-9._:@/-]+/g, '-').replace(/^-+|-+$/g, '');
}

function createGovernanceIntegrity(
    value: Omit<DesignKnowledgeGovernanceRecord, 'integrityFingerprint'> | DesignKnowledgeGovernanceRecord
): string {
    return createStableFingerprint('knowledge-integrity', JSON.stringify({
        version: value.version,
        contentFingerprint: value.contentFingerprint,
        sourceRevision: value.sourceRevision,
        provenance: value.provenance,
        lifecycleStatus: value.lifecycleStatus,
        retrievedAt: value.retrievedAt,
        publishedAt: value.publishedAt || '',
        expiresAt: value.expiresAt || '',
        supersededBy: value.supersededBy || ''
    }));
}

function sanitizeText(value: unknown, maxLength: number): string {
    return String(value || '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function normalizeIsoTime(value: unknown, fallback = new Date().toISOString()): string {
    const parsed = Date.parse(String(value || ''));
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : fallback;
}

function normalizeOptionalIsoTime(value: unknown): string | undefined {
    const parsed = Date.parse(String(value || ''));
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : undefined;
}

function createStableFingerprint(prefix: string, value: string): string {
    let left = 0x811c9dc5;
    let right = 0x9e3779b9;
    for (let index = 0; index < value.length; index += 1) {
        const code = value.charCodeAt(index);
        left = Math.imul(left ^ code, 0x01000193) >>> 0;
        right = Math.imul(right ^ code, 0x85ebca6b) >>> 0;
    }
    return `${prefix}-${left.toString(16).padStart(8, '0')}${right.toString(16).padStart(8, '0')}`;
}
