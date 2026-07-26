import type {
    HumanReviewDecision,
    HumanReviewDraftViewModel,
    HumanReviewIntakeVersion,
    HumanReviewIntakeViewModel,
    HumanReviewScenario,
    HumanReviewSourceViewModel
} from './human-review-intake';
import { normalizeHumanReviewSubject } from './human-review-subject';

export type HumanReviewRecordVersion = 'human-review-record/v0';

export type HumanReviewRecordStatus =
    | 'recorded_approved'
    | 'recorded_needs_review'
    | 'recorded_rejected'
    | 'blocked_invalid_review';

export interface BuildHumanReviewRecordInput {
    intake: HumanReviewIntakeViewModel;
    projectId?: unknown;
    recordId?: unknown;
    recordedAt?: unknown;
}

export interface HumanReviewRecordListOptions {
    projectId?: string;
    scenario?: HumanReviewScenario;
    subjectFingerprint?: string;
    limit?: number;
}

export interface HumanReviewRecord {
    recordVersion: HumanReviewRecordVersion;
    recordId: string;
    projectId?: string;
    scenario: HumanReviewScenario;
    status: HumanReviewRecordStatus;
    statusLabel: string;
    summary: string;
    recordedAt: string;
    createdFromIntakeVersion: HumanReviewIntakeVersion;
    source?: HumanReviewSourceViewModel;
    review: HumanReviewDraftViewModel;
    sourceFingerprint: string;
    integrityFingerprint: string;
    blockers: string[];
    warnings: string[];
    boundary: string;
    redaction: {
        imagePayloadsRedacted: true;
        localPathsRedacted: true;
        policy: string;
    };
    qualityClaim: {
        allowed: false;
        reason: string;
        boundary: string;
    };
    canPersist: boolean;
    canClaimDesignQuality: false;
    canRunProvider: false;
    canRunPhotoshop: false;
}

const HUMAN_REVIEW_SCENARIOS: readonly HumanReviewScenario[] = [
    'main-image',
    'detail-page',
    'sku',
    'reference-replication',
    'general-design'
];

const HUMAN_REVIEW_RECORD_STATUSES: readonly HumanReviewRecordStatus[] = [
    'recorded_approved',
    'recorded_needs_review',
    'recorded_rejected',
    'blocked_invalid_review'
];

export function buildHumanReviewRecord(input: BuildHumanReviewRecordInput): HumanReviewRecord {
    const intake = input.intake;
    const recordedAt = normalizeIsoTime(input.recordedAt);
    const scenario = normalizeScenario(intake?.scenario);
    const source = normalizeSource(intake?.reviewSource);
    const review = normalizeReviewDraft(intake?.reviewDraft, recordedAt);
    const blockers = normalizeTextList(intake?.blockers);
    const warnings = normalizeTextList(intake?.warnings);
    const isReady = intake?.status === 'draft_ready' && intake.canPrepareReviewDraft === true && source;

    if (!isReady) {
        if (blockers.length === 0) {
            blockers.push('人工复核草稿未就绪，不能写入本地复核记录。');
        }
    }

    const status = isReady ? mapDecisionToStatus(review.decision) : 'blocked_invalid_review';
    const sourceFingerprint = createSourceFingerprint({ scenario, source });
    const recordId = sanitizeText(input.recordId) || `human-review-${recordedAt.replace(/[^0-9]/g, '').slice(0, 14)}-${sourceFingerprint.slice(0, 10)}`;
    const statusLabel = getStatusLabel(status);
    const canPersist = status !== 'blocked_invalid_review' && Boolean(source);
    const projectId = sanitizeProjectId(input.projectId);
    const integrityFingerprint = createRecordIntegrityFingerprint({
        recordId,
        projectId,
        scenario,
        status,
        recordedAt,
        source,
        review,
        sourceFingerprint
    });

    return {
        recordVersion: 'human-review-record/v0',
        recordId,
        projectId,
        scenario,
        status,
        statusLabel,
        summary: canPersist && source
            ? `${statusLabel}：${source.summary}`
            : `人工复核记录未写入：${blockers[0] || '缺少可复核来源。'}`,
        recordedAt,
        createdFromIntakeVersion: intake?.version || 'human-review-intake/v0',
        source,
        review,
        sourceFingerprint,
        integrityFingerprint,
        blockers,
        warnings,
        boundary: '该记录只证明人工复核意见已保存到本地台账；不能替代最终设计验收，也不会触发模型、Agent 或 Photoshop 执行。',
        redaction: {
            imagePayloadsRedacted: true,
            localPathsRedacted: true,
            policy: '仅保存脱敏摘要、人工结论和来源指纹。'
        },
        qualityClaim: {
            allowed: false,
            reason: '人工复核记录是审计输入，不是自动验收结论。',
            boundary: '最终设计质量仍需由对应业务验收记录和可复核产物共同证明。'
        },
        canPersist,
        canClaimDesignQuality: false,
        canRunProvider: false,
        canRunPhotoshop: false
    };
}

export function normalizeHumanReviewRecord(value: unknown): HumanReviewRecord | undefined {
    if (!value || typeof value !== 'object') return undefined;
    const raw = value as Partial<HumanReviewRecord>;
    if (raw.recordVersion !== 'human-review-record/v0') return undefined;
    const status = normalizeStatus(raw.status);
    const recordedAt = normalizeIsoTime(raw.recordedAt);
    const scenario = normalizeScenario(raw.scenario);
    const source = normalizeSource(raw.source);
    const review = normalizeReviewDraft(raw.review, recordedAt);
    const sourceFingerprint = createSourceFingerprint({ scenario, source });
    const recordId = sanitizeText(raw.recordId) || `human-review-${recordedAt.replace(/[^0-9]/g, '').slice(0, 14)}-${sourceFingerprint.slice(0, 10)}`;
    const canPersist = status !== 'blocked_invalid_review' && Boolean(source);
    const projectId = sanitizeProjectId(raw.projectId);
    const integrityFingerprint = createRecordIntegrityFingerprint({
        recordId,
        projectId,
        scenario,
        status,
        recordedAt,
        source,
        review,
        sourceFingerprint
    });
    const storedIntegrityFingerprint = sanitizeText(raw.integrityFingerprint);
    if (storedIntegrityFingerprint && storedIntegrityFingerprint !== integrityFingerprint) return undefined;
    if (source?.subject && storedIntegrityFingerprint !== integrityFingerprint) return undefined;

    return {
        recordVersion: 'human-review-record/v0',
        recordId,
        projectId,
        scenario,
        status,
        statusLabel: getStatusLabel(status),
        summary: sanitizeText(raw.summary) || getStatusLabel(status),
        recordedAt,
        createdFromIntakeVersion: raw.createdFromIntakeVersion === 'human-review-intake/v0'
            ? raw.createdFromIntakeVersion
            : 'human-review-intake/v0',
        source,
        review,
        sourceFingerprint,
        integrityFingerprint,
        blockers: normalizeTextList(raw.blockers),
        warnings: normalizeTextList(raw.warnings),
        boundary: sanitizeText(raw.boundary) || '人工复核记录仅作为本地审计输入。',
        redaction: {
            imagePayloadsRedacted: true,
            localPathsRedacted: true,
            policy: '仅保存脱敏摘要、人工结论和来源指纹。'
        },
        qualityClaim: {
            allowed: false,
            reason: '人工复核记录是审计输入，不是自动验收结论。',
            boundary: '最终设计质量仍需由对应业务验收记录和可复核产物共同证明。'
        },
        canPersist,
        canClaimDesignQuality: false,
        canRunProvider: false,
        canRunPhotoshop: false
    };
}

function normalizeScenario(value: unknown): HumanReviewScenario {
    const normalized = sanitizeText(value);
    return HUMAN_REVIEW_SCENARIOS.includes(normalized as HumanReviewScenario)
        ? normalized as HumanReviewScenario
        : 'general-design';
}

function normalizeStatus(value: unknown): HumanReviewRecordStatus {
    const normalized = sanitizeText(value);
    return HUMAN_REVIEW_RECORD_STATUSES.includes(normalized as HumanReviewRecordStatus)
        ? normalized as HumanReviewRecordStatus
        : 'blocked_invalid_review';
}

function normalizeSource(value: unknown): HumanReviewSourceViewModel | undefined {
    if (!value || typeof value !== 'object') return undefined;
    const raw = value as Partial<HumanReviewSourceViewModel>;
    const kind = sanitizeText(raw.kind) || 'review_source';
    const stage = sanitizeText(raw.stage) || 'needs_manual_review';
    const summary = sanitizeText(raw.summary) || '存在需要人工判断的验收结果。';
    const subject = normalizeHumanReviewSubject(raw.subject);
    return { kind, stage, summary, subject };
}

function normalizeReviewDraft(value: unknown, recordedAt: string): HumanReviewDraftViewModel {
    const raw = value && typeof value === 'object' ? value as Partial<HumanReviewDraftViewModel> : {};
    const decision = normalizeDecision(raw.decision);
    const reviewer = sanitizeText(raw.reviewer);
    const score = normalizeScore(raw.score);
    const notes = normalizeTextList(raw.notes);
    return {
        decision,
        reviewer: reviewer || undefined,
        score,
        notes,
        reviewedAt: sanitizeText(raw.reviewedAt) || (decision === 'none' ? undefined : recordedAt)
    };
}

function normalizeDecision(value: unknown): HumanReviewDecision {
    const normalized = sanitizeText(value).toLowerCase();
    if (normalized === 'approved') return 'approved';
    if (normalized === 'needs_review') return 'needs_review';
    if (normalized === 'rejected') return 'rejected';
    return 'none';
}

function normalizeScore(value: unknown): number | undefined {
    if (value === '' || value === null || value === undefined) return undefined;
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric < 0 || numeric > 1) return undefined;
    return Math.round(numeric * 1000) / 1000;
}

function normalizeTextList(value: unknown): string[] {
    const rawValues = Array.isArray(value) ? value : [value];
    return rawValues
        .map((item) => sanitizeText(item))
        .filter(Boolean)
        .slice(0, 12);
}

function mapDecisionToStatus(decision: HumanReviewDecision): HumanReviewRecordStatus {
    if (decision === 'approved') return 'recorded_approved';
    if (decision === 'rejected') return 'recorded_rejected';
    if (decision === 'needs_review') return 'recorded_needs_review';
    return 'blocked_invalid_review';
}

function getStatusLabel(status: HumanReviewRecordStatus): string {
    if (status === 'recorded_approved') return '已记录通过';
    if (status === 'recorded_rejected') return '已记录驳回';
    if (status === 'recorded_needs_review') return '已记录待调整';
    return '记录未写入';
}

function normalizeIsoTime(value: unknown): string {
    const normalized = sanitizeText(value);
    const date = normalized ? new Date(normalized) : new Date();
    return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function sanitizeText(value: unknown): string {
    return String(value || '')
        .replace(/data:image\/[a-z0-9.+-]+;base64,[^\s"'<>]+/gi, '[已移除图片内容]')
        .replace(/\bbase64\b/gi, '[已移除编码内容]')
        .replace(/\brawImage\b/gi, '[已移除图片字段]')
        .replace(/[A-Za-z]:\\[^\s，。；;'"<>]+/g, '[已移除本地路径]')
        .replace(/\s+/g, ' ')
        .trim();
}

function sanitizeProjectId(value: unknown): string | undefined {
    const text = String(value || '').trim();
    if (/^project-[a-f0-9]{16}$/i.test(text)) return text.toLowerCase();
    return sanitizeText(text) || undefined;
}

function createSourceFingerprint(value: unknown): string {
    const text = sanitizeText(JSON.stringify(value || {}));
    let hash = 2166136261;
    for (let index = 0; index < text.length; index += 1) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return `hr-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function createRecordIntegrityFingerprint(value: unknown): string {
    return createFingerprint('hr-integrity', value);
}

function createFingerprint(prefix: string, value: unknown): string {
    const text = sanitizeText(JSON.stringify(value || {}));
    let left = 2166136261;
    let right = 3339675911;
    for (let index = 0; index < text.length; index += 1) {
        const code = text.charCodeAt(index);
        left ^= code;
        left = Math.imul(left, 16777619);
        right ^= code + index;
        right = Math.imul(right, 2246822519);
    }
    return `${prefix}-${(left >>> 0).toString(16).padStart(8, '0')}${(right >>> 0).toString(16).padStart(8, '0')}`;
}
