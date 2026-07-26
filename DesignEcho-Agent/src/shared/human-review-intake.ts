import {
    normalizeHumanReviewSubject,
    type HumanReviewSubject
} from './human-review-subject';

export type HumanReviewIntakeVersion = 'human-review-intake/v0';

export type HumanReviewScenario =
    | 'main-image'
    | 'detail-page'
    | 'sku'
    | 'reference-replication'
    | 'general-design';

export type HumanReviewDecision = 'approved' | 'needs_review' | 'rejected' | 'none';

export type HumanReviewIntakeStatus =
    | 'blocked_missing_review_source'
    | 'awaiting_review_decision'
    | 'blocked_reviewer_required'
    | 'blocked_score_required'
    | 'draft_ready';

export interface HumanReviewSourceLike {
    kind?: unknown;
    stage?: unknown;
    summary?: unknown;
    subject?: unknown;
}

export interface HumanReviewDraftLike {
    decision?: unknown;
    reviewer?: unknown;
    score?: unknown;
    notes?: unknown;
}

export interface BuildHumanReviewIntakeInput {
    scenario?: HumanReviewScenario;
    source?: HumanReviewSourceLike | null;
    draft?: HumanReviewDraftLike | null;
    generatedAt?: string;
}

export interface HumanReviewDraftViewModel {
    decision: HumanReviewDecision;
    reviewer?: string;
    score?: number;
    notes: string[];
    reviewedAt?: string;
}

export interface HumanReviewSourceViewModel {
    kind: string;
    stage: string;
    summary: string;
    subject?: HumanReviewSubject;
}

export interface HumanReviewIntakeViewModel {
    version: HumanReviewIntakeVersion;
    scenario: HumanReviewScenario;
    status: HumanReviewIntakeStatus;
    statusLabel: string;
    summary: string;
    generatedAt: string;
    reviewSource?: HumanReviewSourceViewModel;
    reviewDraft: HumanReviewDraftViewModel;
    requiredFields: string[];
    blockers: string[];
    warnings: string[];
    boundary: string;
    canPrepareReviewDraft: boolean;
    canRecordReview: boolean;
    canClaimDesignQuality: false;
    canRunProvider: false;
    canRunPhotoshop: false;
}

export function buildHumanReviewIntake(
    input: BuildHumanReviewIntakeInput
): HumanReviewIntakeViewModel {
    const generatedAt = normalizeGeneratedAt(input.generatedAt);
    const scenario = input.scenario || 'general-design';
    const reviewSource = normalizeSource(input.source);
    const reviewDraft = normalizeDraft(input.draft, generatedAt);
    const requiredFields: string[] = [];
    const blockers: string[] = [];
    const warnings: string[] = [];

    let status: HumanReviewIntakeStatus = 'draft_ready';

    if (!reviewSource) {
        status = 'blocked_missing_review_source';
        requiredFields.push('reviewSource');
        blockers.push('缺少可复核的执行结果或验收来源，不能生成可靠的人工复核草稿。');
    } else if (reviewDraft.decision === 'none') {
        status = 'awaiting_review_decision';
        requiredFields.push('decision');
        warnings.push('需要先选择人工复核结论。');
    } else if (
        (reviewDraft.decision === 'approved' || reviewDraft.decision === 'rejected') &&
        !reviewDraft.reviewer
    ) {
        status = 'blocked_reviewer_required';
        requiredFields.push('reviewer');
        blockers.push('通过或驳回复核必须记录复核人，避免无来源的质量结论。');
    } else if (reviewDraft.decision === 'approved' && reviewDraft.score === undefined) {
        status = 'blocked_score_required';
        requiredFields.push('score');
        blockers.push('通过复核必须给出 0 到 1 的人工评分，作为后续验收记录的输入。');
    }

    return {
        version: 'human-review-intake/v0',
        scenario,
        status,
        statusLabel: getStatusLabel(status),
        summary: buildSummary(status, reviewSource),
        generatedAt,
        reviewSource,
        reviewDraft,
        requiredFields,
        blockers,
        warnings,
        boundary: '草稿就绪后可写入本地复核记录；记录只保存人工判断和脱敏来源，不会声明设计质量已通过。',
        canPrepareReviewDraft: status === 'draft_ready',
        canRecordReview: status === 'draft_ready',
        canClaimDesignQuality: false,
        canRunProvider: false,
        canRunPhotoshop: false
    };
}

function normalizeSource(source: HumanReviewSourceLike | null | undefined): HumanReviewSourceViewModel | undefined {
    if (!source || typeof source !== 'object') return undefined;
    const kind = sanitizeText(source.kind) || 'review_source';
    const stage = sanitizeText(source.stage) || 'needs_manual_review';
    const summary = sanitizeText(source.summary) || '存在需要人工判断的验收结果。';
    const subject = normalizeHumanReviewSubject(source.subject);
    return { kind, stage, summary, subject };
}

function normalizeDraft(
    draft: HumanReviewDraftLike | null | undefined,
    generatedAt: string
): HumanReviewDraftViewModel {
    const decision = normalizeDecision(draft?.decision);
    const reviewer = sanitizeText(draft?.reviewer);
    const score = normalizeScore(draft?.score);
    const notes = normalizeNotes(draft?.notes);
    return {
        decision,
        reviewer: reviewer || undefined,
        score,
        notes,
        reviewedAt: decision === 'none' ? undefined : generatedAt
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

function normalizeNotes(value: unknown): string[] {
    const rawNotes = Array.isArray(value) ? value : [value];
    return rawNotes
        .map((item) => sanitizeText(item))
        .filter(Boolean)
        .slice(0, 8);
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

function normalizeGeneratedAt(value: unknown): string {
    const normalized = sanitizeText(value);
    return normalized || new Date().toISOString();
}

function getStatusLabel(status: HumanReviewIntakeStatus): string {
    if (status === 'blocked_missing_review_source') return '缺少复核来源';
    if (status === 'awaiting_review_decision') return '等待复核结论';
    if (status === 'blocked_reviewer_required') return '需要复核人';
    if (status === 'blocked_score_required') return '需要人工评分';
    return '复核草稿就绪';
}

function buildSummary(
    status: HumanReviewIntakeStatus,
    source: HumanReviewSourceViewModel | undefined
): string {
    if (status === 'blocked_missing_review_source') {
        return '当前没有可用于人工复核的执行结果。';
    }
    if (!source) return '等待复核内容。';
    return `${getStatusLabel(status)}：${source.summary}`;
}
