import type {
    DesignProjectRuleApplicability,
    DesignProjectRuleConfirmation,
    DesignProjectRuleEnforcement,
    DesignProjectRuleKind,
    DesignProjectRuleRecord,
    DesignProjectRuleReviewInput,
    DesignProjectRuleSource,
    DesignProjectRuleSourceKind,
    DesignProjectRuleUpsertInput,
    DesignProjectRuleWriteAuthority,
    DesignProjectState
} from './types/design-project-state.types';

const MAX_RULE_RECORDS = 160;
const SAFE_RULE_ID = /^project-rule-[a-f0-9]{16}$/;
const RULE_KINDS = new Set<DesignProjectRuleKind>([
    'visual_style', 'color', 'typography', 'copy_tone', 'asset_integrity',
    'forbidden_expression', 'delivery', 'workflow'
]);
const ENFORCEMENTS = new Set<DesignProjectRuleEnforcement>(['guidance', 'quality_gate', 'approval_required']);
const CONFIRMATIONS = new Set<DesignProjectRuleConfirmation>(['unverified', 'user_confirmed', 'source_supported', 'rejected']);
const SOURCE_KINDS = new Set<DesignProjectRuleSourceKind>([
    'user_statement', 'brand_guideline', 'project_brief', 'design_memory', 'agent_inference', 'legacy_brand_style'
]);

export interface DesignProjectRulePolicyContext {
    taskType?: string;
    deliverable?: string;
    channel?: string;
}

export interface DesignProjectRuleConflict {
    conflictKey: string;
    ruleIds: string[];
    statements: string[];
}

export interface DesignProjectRulePolicy {
    version: 'design-project-rule-policy/v0';
    status: 'ready' | 'needs_review' | 'conflict';
    applicableRules: DesignProjectRuleRecord[];
    guidanceRules: DesignProjectRuleRecord[];
    qualityGateRules: DesignProjectRuleRecord[];
    approvalRequiredRules: DesignProjectRuleRecord[];
    pendingRuleCount: number;
    pendingCriticalRuleCount: number;
    conflicts: DesignProjectRuleConflict[];
    canClaimQualityPass: boolean;
    requiresApprovalBeforeDelivery: boolean;
    /** 项目规则只能约束质量/交付判断，不能授予 Photoshop 或外部动作权限。 */
    doesNotGrantToolPermission: true;
}

export function normalizeDesignProjectRuleRecords(value: unknown): DesignProjectRuleRecord[] {
    if (!Array.isArray(value)) return [];
    const byId = new Map<string, DesignProjectRuleRecord>();
    for (const entry of value) {
        const normalized = normalizeRuleRecord(entry);
        if (normalized) byId.set(normalized.ruleId, normalized);
    }
    return Array.from(byId.values())
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.ruleId.localeCompare(right.ruleId))
        .slice(-MAX_RULE_RECORDS);
}

export function listDesignProjectRuleRecords(
    state: DesignProjectState | null | undefined,
    options: { includeLegacy?: boolean } = {}
): DesignProjectRuleRecord[] {
    const records = normalizeDesignProjectRuleRecords(state?.ruleRecords);
    if (options.includeLegacy === false) return records;
    const legacy = sanitizeText(state?.brandStyle);
    if (!legacy) return records;
    const legacyRecord = createLegacyRule(legacy, state?.updatedAt);
    return records.some((record) => record.ruleId === legacyRecord.ruleId)
        ? records
        : [...records, legacyRecord].slice(-MAX_RULE_RECORDS);
}

export function applyDesignProjectRuleOperations(input: {
    current?: unknown;
    upsertRules?: DesignProjectRuleUpsertInput[];
    reviewRules?: DesignProjectRuleReviewInput[];
    authority?: DesignProjectRuleWriteAuthority;
    updatedBy?: unknown;
    now?: string;
}): DesignProjectRuleRecord[] {
    const authority = normalizeAuthority(input.authority);
    const now = normalizeIsoTime(input.now);
    const updatedBy = sanitizeShortText(input.updatedBy, 80);
    const byId = new Map(normalizeDesignProjectRuleRecords(input.current).map((record) => [record.ruleId, record]));

    for (const candidate of normalizeUpsertInputs(input.upsertRules)) {
        const ruleId = buildDesignProjectRuleId(candidate);
        const existing = byId.get(ruleId);
        const source = normalizeSource(candidate.source);
        const confirmation = resolveCandidateConfirmation(authority, candidate.requestedConfirmation, source);
        if (existing) {
            const merged = attachRuleIntegrity({
                ...existing,
                sources: mergeSources(existing.sources, source ? [source] : []),
                confirmation: existing.confirmation === 'rejected'
                    ? 'rejected'
                    : strongestConfirmation(existing.confirmation, confirmation),
                updatedAt: now
            });
            byId.set(ruleId, merged);
            continue;
        }
        const created: DesignProjectRuleRecord = {
            version: 'design-project-rule/v0',
            ruleId,
            ruleKind: candidate.ruleKind,
            statement: candidate.statement,
            constraintKey: candidate.constraintKey,
            enforcement: candidate.enforcement,
            applicability: candidate.applicability,
            confirmation,
            status: 'active',
            sources: source ? [source] : [{ kind: 'agent_inference' }],
            createdAt: now,
            updatedAt: now,
            ...(confirmation === 'source_supported' ? { reviewedAt: now, reviewedBy: updatedBy || authority } : {})
        };
        byId.set(ruleId, attachRuleIntegrity(created));
    }

    if (authority !== 'agent_proposal') {
        for (const review of normalizeReviewInputs(input.reviewRules)) {
            const existing = byId.get(review.ruleId);
            if (!existing) continue;
            if (review.decision === 'supersede') {
                const replacement = review.supersededByRuleId ? byId.get(review.supersededByRuleId) : undefined;
                if (!replacement || replacement.ruleId === existing.ruleId) continue;
                byId.set(existing.ruleId, attachRuleIntegrity({
                    ...existing,
                    status: 'superseded',
                    supersededByRuleId: replacement.ruleId,
                    reviewedAt: now,
                    reviewedBy: updatedBy || authority,
                    reviewNote: sanitizeText(review.note) || undefined,
                    updatedAt: now
                }));
                continue;
            }
            if (review.decision === 'revoke') {
                byId.set(existing.ruleId, attachRuleIntegrity({
                    ...existing,
                    status: 'revoked',
                    reviewedAt: now,
                    reviewedBy: updatedBy || authority,
                    reviewNote: sanitizeText(review.note) || undefined,
                    updatedAt: now
                }));
                continue;
            }
            let confirmation: DesignProjectRuleConfirmation = 'unverified';
            if (review.decision === 'confirm') confirmation = authority === 'user_review' ? 'user_confirmed' : 'source_supported';
            if (review.decision === 'reject') confirmation = 'rejected';
            byId.set(existing.ruleId, attachRuleIntegrity({
                ...existing,
                confirmation,
                status: 'active',
                supersededByRuleId: undefined,
                reviewedAt: now,
                reviewedBy: updatedBy || authority,
                reviewNote: sanitizeText(review.note) || undefined,
                updatedAt: now
            }));
        }
    }

    return Array.from(byId.values())
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.ruleId.localeCompare(right.ruleId))
        .slice(-MAX_RULE_RECORDS);
}

export function buildDesignProjectRulePolicy(
    state: DesignProjectState | null | undefined,
    context: DesignProjectRulePolicyContext = {}
): DesignProjectRulePolicy {
    const records = listDesignProjectRuleRecords(state);
    const active = records.filter((rule) => rule.status === 'active' && rule.confirmation !== 'rejected');
    const applicable = active.filter((rule) => matchesApplicability(rule.applicability, context));
    const trusted = applicable.filter(canDesignProjectRuleActAsPolicy);
    const pending = applicable.filter((rule) => rule.confirmation === 'unverified');
    const conflicts = findDesignProjectRuleConflicts(trusted);
    const pendingCriticalRuleCount = pending.filter((rule) => rule.enforcement !== 'guidance').length;
    const approvalRequiredRules = trusted.filter((rule) => rule.enforcement === 'approval_required');
    const status = conflicts.length > 0 ? 'conflict' : pendingCriticalRuleCount > 0 ? 'needs_review' : 'ready';
    return {
        version: 'design-project-rule-policy/v0',
        status,
        applicableRules: trusted,
        guidanceRules: trusted.filter((rule) => rule.enforcement === 'guidance'),
        qualityGateRules: trusted.filter((rule) => rule.enforcement === 'quality_gate'),
        approvalRequiredRules,
        pendingRuleCount: pending.length,
        pendingCriticalRuleCount,
        conflicts,
        canClaimQualityPass: conflicts.length === 0 && pendingCriticalRuleCount === 0,
        requiresApprovalBeforeDelivery: approvalRequiredRules.length > 0,
        doesNotGrantToolPermission: true
    };
}

export function canDesignProjectRuleActAsPolicy(rule: DesignProjectRuleRecord): boolean {
    return rule.status === 'active'
        && (rule.confirmation === 'user_confirmed' || rule.confirmation === 'source_supported');
}

export function buildDesignProjectRuleId(input: Pick<
    DesignProjectRuleUpsertInput,
    'ruleKind' | 'statement' | 'constraintKey' | 'enforcement' | 'applicability'
>): string {
    return createStableFingerprint('project-rule', JSON.stringify({
        ruleKind: input.ruleKind,
        statement: normalizeStatement(input.statement),
        constraintKey: sanitizeShortText(input.constraintKey, 80).toLowerCase(),
        enforcement: input.enforcement || 'guidance',
        applicability: normalizeApplicability(input.applicability)
    }));
}

function findDesignProjectRuleConflicts(rules: DesignProjectRuleRecord[]): DesignProjectRuleConflict[] {
    const groups = new Map<string, DesignProjectRuleRecord[]>();
    for (const rule of rules) {
        if (!rule.constraintKey) continue;
        const key = `${rule.ruleKind}:${rule.constraintKey}:${JSON.stringify(rule.applicability)}`;
        groups.set(key, [...(groups.get(key) || []), rule]);
    }
    const conflicts: DesignProjectRuleConflict[] = [];
    for (const [conflictKey, group] of groups) {
        const statements = Array.from(new Set(group.map((rule) => normalizeStatement(rule.statement))));
        if (statements.length < 2) continue;
        conflicts.push({
            conflictKey,
            ruleIds: group.map((rule) => rule.ruleId).sort(),
            statements: group.map((rule) => rule.statement)
        });
    }
    return conflicts.sort((left, right) => left.conflictKey.localeCompare(right.conflictKey));
}

function normalizeRuleRecord(value: unknown): DesignProjectRuleRecord | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const raw = value as Partial<DesignProjectRuleRecord>;
    if (raw.version !== 'design-project-rule/v0') return undefined;
    const ruleKind = RULE_KINDS.has(raw.ruleKind as DesignProjectRuleKind) ? raw.ruleKind as DesignProjectRuleKind : undefined;
    const statement = sanitizeText(raw.statement);
    const enforcement = ENFORCEMENTS.has(raw.enforcement as DesignProjectRuleEnforcement)
        ? raw.enforcement as DesignProjectRuleEnforcement
        : 'guidance';
    const applicability = normalizeApplicability(raw.applicability);
    if (!ruleKind || !statement) return undefined;
    const constraintKey = normalizeConstraintKey(raw.constraintKey);
    const ruleId = buildDesignProjectRuleId({ ruleKind, statement, constraintKey, enforcement, applicability });
    if (raw.ruleId && (!SAFE_RULE_ID.test(raw.ruleId) || raw.ruleId !== ruleId)) return undefined;
    const confirmation = CONFIRMATIONS.has(raw.confirmation as DesignProjectRuleConfirmation)
        ? raw.confirmation as DesignProjectRuleConfirmation
        : 'unverified';
    const status = raw.status === 'superseded' || raw.status === 'revoked' ? raw.status : 'active';
    const normalized: DesignProjectRuleRecord = {
        version: 'design-project-rule/v0',
        ruleId,
        ruleKind,
        statement,
        constraintKey,
        enforcement,
        applicability,
        confirmation,
        status,
        sources: normalizeSources(raw.sources),
        createdAt: normalizeIsoTime(raw.createdAt, '1970-01-01T00:00:00.000Z'),
        updatedAt: normalizeIsoTime(raw.updatedAt, '1970-01-01T00:00:00.000Z'),
        reviewedAt: normalizeOptionalIsoTime(raw.reviewedAt),
        reviewedBy: sanitizeShortText(raw.reviewedBy, 80) || undefined,
        reviewNote: sanitizeText(raw.reviewNote) || undefined,
        supersededByRuleId: SAFE_RULE_ID.test(String(raw.supersededByRuleId || '')) ? raw.supersededByRuleId : undefined,
        integrityFingerprint: sanitizeShortText(raw.integrityFingerprint, 80) || undefined
    };
    if (requiresIntegrity(normalized) && normalized.integrityFingerprint !== createRuleIntegrity(normalized)) {
        return {
            ...normalized,
            confirmation: 'unverified',
            status: 'active',
            reviewedAt: undefined,
            reviewedBy: undefined,
            reviewNote: '规则完整性校验失败，已降级为待复核。',
            supersededByRuleId: undefined,
            integrityFingerprint: undefined
        };
    }
    return normalized;
}

function normalizeUpsertInputs(value: unknown): Array<Required<Pick<DesignProjectRuleUpsertInput, 'ruleKind' | 'statement' | 'enforcement' | 'applicability'>> & DesignProjectRuleUpsertInput> {
    if (!Array.isArray(value)) return [];
    return value.map((raw) => {
        const ruleKind = RULE_KINDS.has(raw?.ruleKind) ? raw.ruleKind as DesignProjectRuleKind : undefined;
        const statement = sanitizeText(raw?.statement);
        if (!ruleKind || !statement) return undefined;
        return {
            ...raw,
            ruleKind,
            statement,
            constraintKey: normalizeConstraintKey(raw?.constraintKey),
            enforcement: ENFORCEMENTS.has(raw?.enforcement) ? raw.enforcement : 'guidance',
            applicability: normalizeApplicability(raw?.applicability)
        };
    }).filter((item): item is Required<Pick<DesignProjectRuleUpsertInput, 'ruleKind' | 'statement' | 'enforcement' | 'applicability'>> & DesignProjectRuleUpsertInput => Boolean(item));
}

function normalizeReviewInputs(value: unknown): DesignProjectRuleReviewInput[] {
    if (!Array.isArray(value)) return [];
    return value.filter((item) => item && SAFE_RULE_ID.test(String(item.ruleId || '')) &&
        ['confirm', 'reject', 'needs_review', 'supersede', 'revoke'].includes(item.decision));
}

function normalizeApplicability(value: unknown): DesignProjectRuleApplicability {
    const raw = value && typeof value === 'object' && !Array.isArray(value) ? value as DesignProjectRuleApplicability : {};
    return {
        ...normalizeStringList('taskTypes', raw.taskTypes),
        ...normalizeStringList('deliverables', raw.deliverables),
        ...normalizeStringList('channels', raw.channels)
    };
}

function normalizeStringList(key: keyof DesignProjectRuleApplicability, value: unknown): Partial<DesignProjectRuleApplicability> {
    if (!Array.isArray(value)) return {};
    const items = Array.from(new Set(value.map((item) => sanitizeShortText(item, 80)).filter(Boolean))).sort().slice(0, 20);
    return items.length > 0 ? { [key]: items } : {};
}

function matchesApplicability(applicability: DesignProjectRuleApplicability, context: DesignProjectRulePolicyContext): boolean {
    return matchesDimension(applicability.taskTypes, context.taskType)
        && matchesDimension(applicability.deliverables, context.deliverable)
        && matchesDimension(applicability.channels, context.channel);
}

function matchesDimension(expected: string[] | undefined, actual: string | undefined): boolean {
    if (!expected?.length) return true;
    if (!actual) return false;
    return expected.some((value) => value.toLowerCase() === actual.trim().toLowerCase());
}

function normalizeSource(value: unknown): DesignProjectRuleSource | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const raw = value as Partial<DesignProjectRuleSource>;
    const kind = SOURCE_KINDS.has(raw.kind as DesignProjectRuleSourceKind) ? raw.kind as DesignProjectRuleSourceKind : undefined;
    if (!kind) return undefined;
    const sourceRef = sanitizeSourceRef(raw.sourceRef);
    const supportRefs = Array.isArray(raw.supportRefs)
        ? Array.from(new Set(raw.supportRefs.map((item) => sanitizeShortText(item, 240)).filter(isSafeSupportRef))).slice(0, 12)
        : [];
    return { kind, ...(sourceRef ? { sourceRef } : {}), ...(supportRefs.length ? { supportRefs } : {}) };
}

function normalizeSources(value: unknown): DesignProjectRuleSource[] {
    if (!Array.isArray(value)) return [];
    return mergeSources([], value.map(normalizeSource).filter((source): source is DesignProjectRuleSource => Boolean(source)));
}

function mergeSources(left: DesignProjectRuleSource[], right: DesignProjectRuleSource[]): DesignProjectRuleSource[] {
    const byKey = new Map<string, DesignProjectRuleSource>();
    for (const source of [...left, ...right]) byKey.set(JSON.stringify(source), source);
    return Array.from(byKey.values()).slice(0, 24);
}

function resolveCandidateConfirmation(
    authority: DesignProjectRuleWriteAuthority,
    requested: unknown,
    source: DesignProjectRuleSource | undefined
): DesignProjectRuleConfirmation {
    if (authority === 'agent_proposal') return 'unverified';
    if (authority === 'user_review' && requested === 'user_confirmed') return 'user_confirmed';
    if (
        authority === 'trusted_system'
        && requested === 'source_supported'
        && source
        && (source.kind === 'brand_guideline' || source.kind === 'project_brief')
        && (isSafeSupportRef(source.sourceRef) || (source.supportRefs || []).some(isSafeSupportRef))
    ) return 'source_supported';
    return 'unverified';
}

function strongestConfirmation(left: DesignProjectRuleConfirmation, right: DesignProjectRuleConfirmation): DesignProjectRuleConfirmation {
    const rank: Record<DesignProjectRuleConfirmation, number> = { rejected: 4, user_confirmed: 3, source_supported: 2, unverified: 1 };
    return rank[left] >= rank[right] ? left : right;
}

function createLegacyRule(statement: string, updatedAt: unknown): DesignProjectRuleRecord {
    const applicability: DesignProjectRuleApplicability = {};
    const ruleId = buildDesignProjectRuleId({ ruleKind: 'visual_style', statement, enforcement: 'guidance', applicability });
    const time = normalizeIsoTime(updatedAt, '1970-01-01T00:00:00.000Z');
    return {
        version: 'design-project-rule/v0', ruleId, ruleKind: 'visual_style', statement,
        enforcement: 'guidance', applicability, confirmation: 'unverified', status: 'active',
        sources: [{ kind: 'legacy_brand_style' }], createdAt: time, updatedAt: time
    };
}

function attachRuleIntegrity(record: DesignProjectRuleRecord): DesignProjectRuleRecord {
    return requiresIntegrity(record) ? { ...record, integrityFingerprint: createRuleIntegrity(record) } : { ...record, integrityFingerprint: undefined };
}

function requiresIntegrity(record: DesignProjectRuleRecord): boolean {
    return record.confirmation !== 'unverified' || record.status !== 'active';
}

function createRuleIntegrity(record: DesignProjectRuleRecord): string {
    return createStableFingerprint('rule-integrity', JSON.stringify({
        ruleId: record.ruleId,
        confirmation: record.confirmation,
        status: record.status,
        reviewedAt: record.reviewedAt || '',
        reviewedBy: record.reviewedBy || '',
        supersededByRuleId: record.supersededByRuleId || ''
    }));
}

function normalizeAuthority(value: unknown): DesignProjectRuleWriteAuthority {
    return value === 'user_review' || value === 'trusted_system' ? value : 'agent_proposal';
}

function normalizeConstraintKey(value: unknown): string | undefined {
    const text = sanitizeShortText(value, 80).toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
    return text || undefined;
}

function normalizeStatement(value: unknown): string {
    return sanitizeText(value).toLowerCase();
}

function sanitizeText(value: unknown): string {
    return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 800);
}

function sanitizeShortText(value: unknown, max: number): string {
    return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function normalizeIsoTime(value: unknown, fallback = new Date().toISOString()): string {
    const parsed = Date.parse(String(value || ''));
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : fallback;
}

function normalizeOptionalIsoTime(value: unknown): string | undefined {
    const parsed = Date.parse(String(value || ''));
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : undefined;
}

function isSafeSupportRef(value: unknown): boolean {
    const text = sanitizeShortText(value, 240);
    return /^(?:document|brand-guideline|project-brief|knowledge|design-memory):[a-z0-9._:/-]+$/i.test(text);
}

function sanitizeSourceRef(value: unknown): string {
    const text = sanitizeShortText(value, 240);
    if (!text) return '';
    if (/^(?:[a-z]:[\\/]|\\\\|\/)/i.test(text)) return '';
    if (/^(?:https?:|file:|data:)/i.test(text)) return '';
    if (/(?:api[_-]?key|secret|token|password)/i.test(text)) return '';
    return /^[a-z0-9._-]+:[a-z0-9._:/-]+$/i.test(text) ? text : '';
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
