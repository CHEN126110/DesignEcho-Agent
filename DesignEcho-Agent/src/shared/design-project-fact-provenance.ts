import type {
    DesignProjectFactConfirmation,
    DesignProjectFactRecord,
    DesignProjectFactReviewInput,
    DesignProjectFactSource,
    DesignProjectFactSourceKind,
    DesignProjectFactUpsertInput,
    DesignProjectFactWriteAuthority,
    DesignProjectState
} from './types/design-project-state.types';

const MAX_FACT_RECORDS = 80;
const MAX_FACT_SOURCES = 8;
const MAX_SUPPORT_REFS = 8;
const SAFE_FACT_ID = /^project-fact-[a-f0-9]{16}$/;
const SAFE_SOURCE_REF = /^[a-z][a-z0-9-]{1,40}:[a-z0-9._:-]{1,160}$/i;
const SOURCE_KINDS = new Set<DesignProjectFactSourceKind>([
    'user_statement',
    'project_asset_observation',
    'product_document',
    'brand_guideline',
    'market_research',
    'agent_inference',
    'legacy_unattributed'
]);
const CONFIRMATIONS = new Set<DesignProjectFactConfirmation>([
    'unverified',
    'user_confirmed',
    'source_supported',
    'rejected'
]);

export interface DesignProjectFactProvenanceSummary {
    total: number;
    active: number;
    userConfirmed: number;
    sourceSupported: number;
    needsReview: number;
    rejected: number;
    superseded: number;
    legacyUnattributed: number;
}

export function normalizeDesignProjectFactRecords(value: unknown): DesignProjectFactRecord[] {
    if (!Array.isArray(value)) return [];
    const records = value
        .map((item) => normalizeFactRecord(item))
        .filter((item): item is DesignProjectFactRecord => Boolean(item));
    const byId = new Map<string, DesignProjectFactRecord>();
    for (const record of records) byId.set(record.factId, record);
    return Array.from(byId.values()).slice(-MAX_FACT_RECORDS);
}

export function listDesignProjectFactRecords(
    state: DesignProjectState | null | undefined,
    options: { includeLegacy?: boolean } = {}
): DesignProjectFactRecord[] {
    const records = normalizeDesignProjectFactRecords(state?.factRecords);
    if (options.includeLegacy === false) return records;
    const byId = new Map(records.map((record) => [record.factId, record]));
    const fallbackTime = normalizeIsoTime(state?.updatedAt, '1970-01-01T00:00:00.000Z');
    const appendLegacy = (claimType: DesignProjectFactRecord['claimType'], values: unknown): void => {
        if (!Array.isArray(values)) return;
        for (const value of values) {
            const statement = sanitizeFactText(value);
            if (!statement) continue;
            const factId = buildDesignProjectFactId(claimType, statement);
            if (byId.has(factId)) continue;
            byId.set(factId, {
                version: 'design-project-fact/v0',
                factId,
                claimType,
                statement,
                confirmation: 'unverified',
                status: 'active',
                sources: [{ kind: 'legacy_unattributed' }],
                createdAt: fallbackTime,
                updatedAt: fallbackTime
            });
        }
    };
    appendLegacy('product_fact', state?.productFacts);
    appendLegacy('selling_point', state?.sellingPoints);
    return Array.from(byId.values()).slice(-MAX_FACT_RECORDS);
}

export function applyDesignProjectFactOperations(input: {
    current?: unknown;
    upsertFacts?: DesignProjectFactUpsertInput[];
    reviewFacts?: DesignProjectFactReviewInput[];
    authority?: DesignProjectFactWriteAuthority;
    updatedBy?: unknown;
    now?: string;
}): DesignProjectFactRecord[] {
    const authority = normalizeAuthority(input.authority);
    const now = normalizeIsoTime(input.now);
    const updatedBy = sanitizeShortText(input.updatedBy, 80);
    const byId = new Map(normalizeDesignProjectFactRecords(input.current).map((record) => [record.factId, record]));

    for (const candidate of normalizeUpsertInputs(input.upsertFacts)) {
        const factId = buildDesignProjectFactId(candidate.claimType, candidate.statement);
        const existing = byId.get(factId);
        const source = normalizeSource(candidate.source);
        const confirmation = resolveCandidateConfirmation({
            authority,
            requested: candidate.requestedConfirmation,
            source
        });
        if (existing) {
            const sources = mergeSources(existing.sources, source ? [source] : []);
            const merged = {
                ...existing,
                statement: authority === 'agent_proposal' && existing.confirmation !== 'unverified'
                    ? existing.statement
                    : candidate.statement,
                sources,
                confirmation: existing.confirmation === 'rejected'
                    ? 'rejected'
                    : strongestConfirmation(existing.confirmation, confirmation),
                updatedAt: now,
                ...(confirmation === 'source_supported' && existing.confirmation === 'unverified' ? {
                    reviewedAt: now,
                    reviewedBy: updatedBy || authority
                } : {})
            };
            byId.set(factId, attachFactIntegrity(merged));
            continue;
        }
        const created: DesignProjectFactRecord = {
            version: 'design-project-fact/v0',
            factId,
            claimType: candidate.claimType,
            statement: candidate.statement,
            confirmation,
            status: 'active',
            sources: source ? [source] : [{ kind: 'agent_inference' }],
            createdAt: now,
            updatedAt: now,
            ...(confirmation === 'source_supported' ? {
                reviewedAt: now,
                reviewedBy: updatedBy || authority
            } : {})
        };
        byId.set(factId, attachFactIntegrity(created));
    }

    if (authority !== 'agent_proposal') {
        for (const review of normalizeReviewInputs(input.reviewFacts)) {
            const existing = byId.get(review.factId);
            if (!existing) continue;
            if (review.decision === 'supersede') {
                const replacement = review.supersededByFactId
                    ? byId.get(review.supersededByFactId)
                    : undefined;
                if (!replacement || replacement.factId === existing.factId) continue;
                byId.set(existing.factId, attachFactIntegrity({
                    ...existing,
                    status: 'superseded',
                    supersededByFactId: replacement.factId,
                    reviewedAt: now,
                    reviewedBy: updatedBy || authority,
                    reviewNote: sanitizeFactText(review.note) || undefined,
                    updatedAt: now
                }));
                continue;
            }
            let confirmation: DesignProjectFactConfirmation = 'unverified';
            if (review.decision === 'confirm') {
                confirmation = authority === 'user_review' ? 'user_confirmed' : 'source_supported';
            } else if (review.decision === 'reject') {
                confirmation = 'rejected';
            }
            byId.set(existing.factId, attachFactIntegrity({
                ...existing,
                confirmation,
                status: 'active',
                supersededByFactId: undefined,
                reviewedAt: now,
                reviewedBy: updatedBy || authority,
                reviewNote: sanitizeFactText(review.note) || undefined,
                updatedAt: now
            }));
        }
    }

    return Array.from(byId.values())
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.factId.localeCompare(right.factId))
        .slice(-MAX_FACT_RECORDS);
}

export function buildDesignProjectFactProvenanceSummary(
    state: DesignProjectState | null | undefined
): DesignProjectFactProvenanceSummary {
    const facts = listDesignProjectFactRecords(state);
    return {
        total: facts.length,
        active: facts.filter((fact) => fact.status === 'active' && fact.confirmation !== 'rejected').length,
        userConfirmed: facts.filter((fact) => fact.status === 'active' && fact.confirmation === 'user_confirmed').length,
        sourceSupported: facts.filter((fact) => fact.status === 'active' && fact.confirmation === 'source_supported').length,
        needsReview: facts.filter((fact) => fact.status === 'active' && fact.confirmation === 'unverified').length,
        rejected: facts.filter((fact) => fact.confirmation === 'rejected').length,
        superseded: facts.filter((fact) => fact.status === 'superseded').length,
        legacyUnattributed: facts.filter((fact) => fact.sources.some((source) => source.kind === 'legacy_unattributed')).length
    };
}

export function canDesignProjectFactSupportEvaluation(fact: DesignProjectFactRecord): boolean {
    return fact.status === 'active'
        && (fact.confirmation === 'user_confirmed' || fact.confirmation === 'source_supported');
}

export function buildDesignProjectFactId(
    claimType: DesignProjectFactRecord['claimType'],
    statement: unknown
): string {
    return createStableFingerprint('project-fact', `${claimType}:${normalizeStatement(statement)}`);
}

function normalizeFactRecord(value: unknown): DesignProjectFactRecord | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const raw = value as Partial<DesignProjectFactRecord>;
    if (raw.version !== 'design-project-fact/v0') return undefined;
    const statement = sanitizeFactText(raw.statement);
    const claimType = normalizeClaimType(raw.claimType);
    if (!statement || !claimType) return undefined;
    const derivedFactId = buildDesignProjectFactId(claimType, statement);
    if (raw.factId && (!SAFE_FACT_ID.test(raw.factId) || raw.factId !== derivedFactId)) return undefined;
    const confirmation = CONFIRMATIONS.has(raw.confirmation as DesignProjectFactConfirmation)
        ? raw.confirmation as DesignProjectFactConfirmation
        : 'unverified';
    const status = raw.status === 'superseded' ? 'superseded' : 'active';
    const sources = mergeSources([], Array.isArray(raw.sources) ? raw.sources.map(normalizeSource).filter(Boolean) as DesignProjectFactSource[] : []);
    const createdAt = normalizeIsoTime(raw.createdAt, '1970-01-01T00:00:00.000Z');
    const updatedAt = normalizeIsoTime(raw.updatedAt, createdAt);
    const supersededByFactId = SAFE_FACT_ID.test(String(raw.supersededByFactId || ''))
        ? String(raw.supersededByFactId)
        : undefined;
    const normalized: DesignProjectFactRecord = {
        version: 'design-project-fact/v0',
        factId: derivedFactId,
        claimType,
        statement,
        confirmation,
        status,
        sources: sources.length > 0 ? sources : [{ kind: 'legacy_unattributed' }],
        createdAt,
        updatedAt,
        reviewedAt: raw.reviewedAt ? normalizeIsoTime(raw.reviewedAt, updatedAt) : undefined,
        reviewedBy: sanitizeShortText(raw.reviewedBy, 80) || undefined,
        reviewNote: sanitizeFactText(raw.reviewNote) || undefined,
        supersededByFactId,
        integrityFingerprint: sanitizeShortText(raw.integrityFingerprint, 64) || undefined
    };
    const requiresIntegrity = normalized.confirmation !== 'unverified' || normalized.status === 'superseded';
    if (!requiresIntegrity) {
        normalized.integrityFingerprint = undefined;
        return normalized;
    }
    const expectedIntegrity = createFactIntegrityFingerprint(normalized);
    if (normalized.integrityFingerprint === expectedIntegrity) return normalized;
    return {
        ...normalized,
        confirmation: 'unverified',
        status: 'active',
        reviewedAt: undefined,
        reviewedBy: undefined,
        reviewNote: undefined,
        supersededByFactId: undefined,
        integrityFingerprint: undefined
    };
}

function normalizeUpsertInputs(value: unknown): DesignProjectFactUpsertInput[] {
    if (!Array.isArray(value)) return [];
    const result: DesignProjectFactUpsertInput[] = [];
    for (const item of value) {
        const raw = item && typeof item === 'object' ? item as Partial<DesignProjectFactUpsertInput> : {};
        const statement = sanitizeFactText(raw.statement);
        const claimType = normalizeClaimType(raw.claimType);
        if (!statement || !claimType) continue;
        result.push({
            claimType,
            statement,
            ...(raw.source ? { source: raw.source } : {}),
            ...(CONFIRMATIONS.has(raw.requestedConfirmation as DesignProjectFactConfirmation)
                ? { requestedConfirmation: raw.requestedConfirmation as DesignProjectFactConfirmation }
                : {})
        });
        if (result.length >= 24) break;
    }
    return result;
}

function normalizeReviewInputs(value: unknown): DesignProjectFactReviewInput[] {
    if (!Array.isArray(value)) return [];
    const result: DesignProjectFactReviewInput[] = [];
    for (const item of value) {
        const raw = item && typeof item === 'object' ? item as Partial<DesignProjectFactReviewInput> : {};
        const factId = String(raw.factId || '').trim();
        if (!SAFE_FACT_ID.test(factId)) continue;
        const decision = ['confirm', 'reject', 'needs_review', 'supersede'].includes(String(raw.decision || ''))
            ? raw.decision as DesignProjectFactReviewInput['decision']
            : undefined;
        if (!decision) continue;
        const supersededByFactId = SAFE_FACT_ID.test(String(raw.supersededByFactId || ''))
            ? String(raw.supersededByFactId)
            : undefined;
        result.push({
            factId,
            decision,
            ...(sanitizeFactText(raw.note) ? { note: sanitizeFactText(raw.note) } : {}),
            ...(supersededByFactId ? { supersededByFactId } : {})
        });
        if (result.length >= 24) break;
    }
    return result;
}

function normalizeSource(value: unknown): DesignProjectFactSource | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const raw = value as Partial<DesignProjectFactSource>;
    const kind = SOURCE_KINDS.has(raw.kind as DesignProjectFactSourceKind)
        ? raw.kind as DesignProjectFactSourceKind
        : undefined;
    if (!kind) return undefined;
    const sourceRef = SAFE_SOURCE_REF.test(String(raw.sourceRef || '')) ? String(raw.sourceRef) : undefined;
    const supportRefs = normalizeSupportRefs(raw.supportRefs);
    return {
        kind,
        sourceRef,
        supportRefs: supportRefs.length > 0 ? supportRefs : undefined,
        observedAt: raw.observedAt ? normalizeIsoTime(raw.observedAt) : undefined
    };
}

function resolveCandidateConfirmation(input: {
    authority: DesignProjectFactWriteAuthority;
    requested?: DesignProjectFactConfirmation;
    source?: DesignProjectFactSource;
}): DesignProjectFactConfirmation {
    if (input.authority !== 'trusted_system') return 'unverified';
    if (input.requested !== 'source_supported') return 'unverified';
    if (!input.source?.supportRefs?.length) return 'unverified';
    return 'source_supported';
}

function strongestConfirmation(
    left: DesignProjectFactConfirmation,
    right: DesignProjectFactConfirmation
): DesignProjectFactConfirmation {
    const rank: Record<DesignProjectFactConfirmation, number> = {
        rejected: 4,
        user_confirmed: 3,
        source_supported: 2,
        unverified: 1
    };
    return rank[left] >= rank[right] ? left : right;
}

function mergeSources(
    current: DesignProjectFactSource[],
    additions: DesignProjectFactSource[]
): DesignProjectFactSource[] {
    const byKey = new Map<string, DesignProjectFactSource>();
    for (const source of [...current, ...additions]) {
        const normalized = normalizeSource(source);
        if (!normalized) continue;
        const key = JSON.stringify({
            kind: normalized.kind,
            sourceRef: normalized.sourceRef || '',
            supportRefs: normalized.supportRefs || []
        });
        byKey.set(key, normalized);
    }
    return Array.from(byKey.values()).slice(-MAX_FACT_SOURCES);
}

function normalizeSupportRefs(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return Array.from(new Set(value
        .map((item) => String(item || '').trim())
        .filter((item) => SAFE_SOURCE_REF.test(item))))
        .slice(0, MAX_SUPPORT_REFS);
}

function normalizeAuthority(value: unknown): DesignProjectFactWriteAuthority {
    if (value === 'user_review') return 'user_review';
    if (value === 'trusted_system') return 'trusted_system';
    return 'agent_proposal';
}

function normalizeClaimType(value: unknown): DesignProjectFactRecord['claimType'] | undefined {
    if (value === 'product_fact') return 'product_fact';
    if (value === 'selling_point') return 'selling_point';
    return undefined;
}

function normalizeStatement(value: unknown): string {
    return sanitizeFactText(value)
        .toLowerCase()
        .replace(/[\s，。；;、,:：!！?？"'“”‘’（）()\-_/]+/g, '');
}

function sanitizeFactText(value: unknown): string {
    return String(value || '')
        .replace(/data:image\/[a-z0-9.+-]+;base64,[^\s"'<>]+/gi, '[已移除图片内容]')
        .replace(/\bbase64\b/gi, '[已移除编码内容]')
        .replace(/\brawImage\b/gi, '[已移除图片字段]')
        .replace(/[A-Za-z]:\\[^\s，。；;'"<>]+/g, '[已移除本地路径]')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 500);
}

function sanitizeShortText(value: unknown, max: number): string {
    return sanitizeFactText(value).slice(0, max);
}

function normalizeIsoTime(value: unknown, fallback = new Date().toISOString()): string {
    const text = String(value || '').trim();
    const parsed = text ? new Date(text) : new Date(fallback);
    return Number.isNaN(parsed.getTime()) ? fallback : parsed.toISOString();
}

function createStableFingerprint(prefix: string, value: string): string {
    let left = 2166136261;
    let right = 3339675911;
    for (let index = 0; index < value.length; index += 1) {
        const code = value.charCodeAt(index);
        left ^= code;
        left = Math.imul(left, 16777619);
        right ^= code + index;
        right = Math.imul(right, 2246822519);
    }
    return `${prefix}-${(left >>> 0).toString(16).padStart(8, '0')}${(right >>> 0).toString(16).padStart(8, '0')}`;
}

function attachFactIntegrity(record: DesignProjectFactRecord): DesignProjectFactRecord {
    if (record.confirmation === 'unverified' && record.status === 'active') {
        return { ...record, integrityFingerprint: undefined };
    }
    return {
        ...record,
        integrityFingerprint: createFactIntegrityFingerprint(record)
    };
}

function createFactIntegrityFingerprint(record: DesignProjectFactRecord): string {
    return createStableFingerprint('fact-integrity', JSON.stringify({
        factId: record.factId,
        statement: record.statement,
        claimType: record.claimType,
        confirmation: record.confirmation,
        status: record.status,
        sources: record.sources,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
        reviewedAt: record.reviewedAt || '',
        reviewedBy: record.reviewedBy || '',
        reviewNote: record.reviewNote || '',
        supersededByFactId: record.supersededByFactId || ''
    }));
}
