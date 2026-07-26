import type { DesignMemoryItem, DesignMemorySourceNote, DesignMemoryStatus } from './design-memory-knowledge';

export type DesignLearningMemoryReviewVersion = 'design-learning-memory-review/v0';
export type DesignLearningMemoryReviewDecision = 'approved' | 'needs_review' | 'rejected';
export type DesignLearningMemoryReviewStatus =
    | 'promoted_active'
    | 'kept_needs_review'
    | 'rejected_disabled'
    | 'blocked_invalid_candidate'
    | 'blocked_missing_review';

export interface ReviewDesignLearningMemoryCandidateInput {
    candidate: DesignMemoryItem;
    decision?: DesignLearningMemoryReviewDecision | string;
    reviewer?: unknown;
    notes?: unknown;
    reviewedAt?: unknown;
}

export interface DesignLearningMemoryReviewBoundary {
    readonly: true;
    doesNotCallProvider: true;
    doesNotExecuteSearch: true;
    doesNotWriteEagle: true;
    noPhotoshopWrites: true;
    doesNotPersistMemory: true;
    doesNotClaimDesignQuality: true;
}

export interface DesignLearningMemoryReviewResult {
    version: DesignLearningMemoryReviewVersion;
    status: DesignLearningMemoryReviewStatus;
    decision: DesignLearningMemoryReviewDecision | 'none';
    candidateId: string;
    reviewedAt: string;
    reviewer?: string;
    notes: string[];
    reviewedItem: DesignMemoryItem;
    blockers: string[];
    warnings: string[];
    boundaries: DesignLearningMemoryReviewBoundary;
    qualityClaim: {
        allowed: false;
        reason: string;
    };
    canPersist: false;
    canRunProvider: false;
    canRunPhotoshop: false;
    canWriteEagle: false;
}

const REVIEW_VERSION: DesignLearningMemoryReviewVersion = 'design-learning-memory-review/v0';

const UNSAFE_PAYLOAD_PATTERNS = [
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
    /置信/g
];

const LOCAL_PATH_REPLACE_PATTERN = /\b[A-Za-z]:[\\/][^\s"'，,；;]+/g;

export function reviewDesignLearningMemoryCandidate(
    input: ReviewDesignLearningMemoryCandidateInput
): DesignLearningMemoryReviewResult {
    const candidate = normalizeCandidate(input.candidate);
    const decision = normalizeDecision(input.decision);
    const reviewedAt = normalizeDateTime(input.reviewedAt) || new Date().toISOString();
    const reviewer = cleanString(input.reviewer) || undefined;
    const notes = cleanStrings(input.notes).slice(0, 12);
    const blockers: string[] = [];
    const warnings: string[] = [];

    if (!isDesignLearningCandidate(candidate)) {
        blockers.push('design_learning_candidate_required');
    }
    if (decision === 'none') {
        blockers.push('review_decision_required');
    }
    if (!reviewer) {
        warnings.push('reviewer_missing');
    }
    if (notes.length === 0) {
        warnings.push('review_notes_missing');
    }

    const status = resolveReviewStatus({ candidate, decision, blockers });
    const reviewedItem = buildReviewedItem({ candidate, status, decision, reviewer, notes, reviewedAt });

    return {
        version: REVIEW_VERSION,
        status,
        decision,
        candidateId: candidate.id,
        reviewedAt,
        reviewer,
        notes,
        reviewedItem,
        blockers,
        warnings,
        boundaries: buildDesignLearningMemoryReviewBoundary(),
        qualityClaim: {
            allowed: false,
            reason: '学习经验复核只决定候选能否进入长期记忆，不证明当前设计输出质量。'
        },
        canPersist: false,
        canRunProvider: false,
        canRunPhotoshop: false,
        canWriteEagle: false
    };
}

export function buildDesignLearningMemoryReviewBoundary(): DesignLearningMemoryReviewBoundary {
    return {
        readonly: true,
        doesNotCallProvider: true,
        doesNotExecuteSearch: true,
        doesNotWriteEagle: true,
        noPhotoshopWrites: true,
        doesNotPersistMemory: true,
        doesNotClaimDesignQuality: true
    };
}

function resolveReviewStatus(input: {
    candidate: DesignMemoryItem;
    decision: DesignLearningMemoryReviewDecision | 'none';
    blockers: string[];
}): DesignLearningMemoryReviewStatus {
    if (input.blockers.includes('design_learning_candidate_required')) return 'blocked_invalid_candidate';
    if (input.blockers.includes('review_decision_required')) return 'blocked_missing_review';
    if (input.decision === 'approved') return 'promoted_active';
    if (input.decision === 'rejected') return 'rejected_disabled';
    return 'kept_needs_review';
}

function buildReviewedItem(input: {
    candidate: DesignMemoryItem;
    status: DesignLearningMemoryReviewStatus;
    decision: DesignLearningMemoryReviewDecision | 'none';
    reviewer?: string;
    notes: string[];
    reviewedAt: string;
}): DesignMemoryItem {
    const nextStatus = statusToMemoryStatus(input.status);
    const noteStatus = statusToSourceNoteStatus(nextStatus);
    const reviewNote: DesignMemorySourceNote = {
        source: 'design-learning-review',
        summary: [
            `review=${input.decision}`,
            input.reviewer ? `reviewer=${input.reviewer}` : '',
            `reviewed_at=${input.reviewedAt}`,
            input.notes.length > 0 ? `notes=${input.notes.join('；')}` : ''
        ].map(cleanString).filter(Boolean).join('; '),
        status: noteStatus
    };
    return {
        ...input.candidate,
        status: nextStatus,
        sourceRank: nextStatus === 'active' ? Math.max(Number(input.candidate.sourceRank) || 0, 76) : 0,
        sourceNotes: [...(input.candidate.sourceNotes || []), reviewNote],
        tags: Array.from(new Set([...(input.candidate.tags || []), 'reviewed-design-learning'])).map(cleanString).filter(Boolean),
        updatedAt: input.reviewedAt
    };
}

function statusToMemoryStatus(status: DesignLearningMemoryReviewStatus): DesignMemoryStatus {
    if (status === 'promoted_active') return 'active';
    if (status === 'rejected_disabled') return 'disabled';
    return 'needs_review';
}

function statusToSourceNoteStatus(status: DesignMemoryStatus): 'active' | 'needs_review' | 'disabled' {
    if (status === 'active') return 'active';
    if (status === 'disabled' || status === 'expired' || status === 'superseded') return 'disabled';
    return 'needs_review';
}

function isDesignLearningCandidate(candidate: DesignMemoryItem): boolean {
    if (candidate.kind !== 'visual_case') return false;
    if (candidate.source !== 'imported_case') return false;
    if ((candidate.tags || []).map(cleanString).includes('design-learning')) return true;
    if ((candidate.sourceNotes || []).some((entry) => cleanString(entry.source) === 'design-learning-experience')) return true;
    return cleanString(candidate.id).startsWith('design-learning');
}

function normalizeCandidate(candidate: DesignMemoryItem): DesignMemoryItem {
    const id = cleanString(candidate?.id) || 'design-learning-candidate';
    return {
        ...candidate,
        id,
        kind: candidate?.kind || 'visual_case',
        scope: {
            type: candidate?.scope?.type || 'user',
            id: cleanString(candidate?.scope?.id) || undefined
        },
        status: normalizeMemoryStatus(candidate?.status),
        source: candidate?.source || 'imported_case',
        title: cleanString(candidate?.title) || id,
        summary: cleanString(candidate?.summary),
        sourceNotes: Array.isArray(candidate?.sourceNotes)
            ? candidate.sourceNotes.map((entry) => ({
                source: cleanString(entry.source),
                summary: cleanString(entry.summary),
                status: statusToSourceNoteStatus(normalizeMemoryStatus(entry.status))
            })).filter((entry) => entry.source && entry.summary)
            : [],
        tags: cleanStrings(candidate?.tags),
        appliesTo: Array.isArray(candidate?.appliesTo) ? candidate.appliesTo : undefined,
        allowedUses: Array.isArray(candidate?.allowedUses) ? candidate.allowedUses : undefined,
        sourceRank: Number.isFinite(Number(candidate?.sourceRank)) ? Number(candidate.sourceRank) : 0,
        createdAt: normalizeDateTime(candidate?.createdAt),
        updatedAt: normalizeDateTime(candidate?.updatedAt),
        expiresAt: normalizeDateTime(candidate?.expiresAt)
    };
}

function normalizeMemoryStatus(value: unknown): DesignMemoryStatus {
    const text = cleanString(value);
    if (text === 'active' || text === 'needs_review' || text === 'disabled' || text === 'superseded' || text === 'expired') {
        return text;
    }
    return 'needs_review';
}

function normalizeDecision(value: unknown): DesignLearningMemoryReviewDecision | 'none' {
    const text = cleanString(value);
    if (text === 'approved' || text === 'needs_review' || text === 'rejected') return text;
    return 'none';
}

function normalizeDateTime(value: unknown): string | undefined {
    if (value === undefined || value === null || value === '') return undefined;
    if (typeof value === 'number' && Number.isFinite(value)) return new Date(value).toISOString();
    const text = cleanString(value);
    if (!text) return undefined;
    const parsed = Date.parse(text);
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : text;
}

function cleanString(value: unknown): string {
    let text = String(value || '').trim();
    for (const pattern of UNSAFE_PAYLOAD_PATTERNS) {
        text = text.replace(pattern, '[redacted]');
    }
    return text.replace(LOCAL_PATH_REPLACE_PATTERN, '[redacted-local-path]').replace(/\s+/g, ' ').trim();
}

function cleanStrings(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return Array.from(new Set(value.map(cleanString).filter(Boolean)));
}
