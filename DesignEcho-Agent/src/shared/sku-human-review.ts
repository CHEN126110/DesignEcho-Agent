import {
    buildHumanReviewIntake,
    type HumanReviewDecision,
    type HumanReviewIntakeViewModel
} from './human-review-intake';
import {
    normalizeHumanReviewRecord,
    type HumanReviewRecord
} from './human-review-record';
import {
    normalizeHumanReviewSubject,
    type HumanReviewSubject
} from './human-review-subject';
import {
    buildInteractiveCardValidationResult,
    cleanInteractiveCardText,
    type InteractiveCardDefinition,
    type InteractiveCardValidationIssue,
    type InteractiveCardValidationResult
} from './interactive-card-contract';

export type SkuHumanReviewTargetVersion = 'sku-human-review-target/v0';
export type SkuHumanReviewBindingVersion = 'sku-human-review-binding/v0';

export type SkuHumanReviewTargetStatus =
    | 'ready_for_review'
    | 'blocked_missing_project_identity'
    | 'blocked_invalid_export_readback'
    | 'blocked_missing_output_digest';

export type SkuHumanReviewBindingStatus =
    | 'awaiting_human_review'
    | 'fresh_review_approved'
    | 'fresh_review_needs_review'
    | 'fresh_review_rejected'
    | 'stale_review_ignored'
    | 'invalid_review_ignored'
    | 'blocked_current_output';

export interface SkuHumanReviewTarget {
    version: SkuHumanReviewTargetVersion;
    status: SkuHumanReviewTargetStatus;
    projectFingerprint?: string;
    subject?: HumanReviewSubject;
    expectedExportCount: number;
    outputDigestCount: number;
    blockers: string[];
    warnings: string[];
    boundaries: {
        contentAddressed: true;
        rawImagesRedacted: true;
        localPathsRedacted: true;
        doesNotClaimDesignQuality: true;
    };
    canRequestHumanReview: boolean;
    canClaimDesignQuality: false;
}

export interface SkuHumanReviewBinding {
    version: SkuHumanReviewBindingVersion;
    status: SkuHumanReviewBindingStatus;
    targetFingerprint?: string;
    recordId?: string;
    review?: HumanReviewRecord['review'];
    blockers: string[];
    warnings: string[];
    freshness: {
        checked: true;
        subjectMatched: boolean;
        projectMatched: boolean;
        recordIntegrityVerified: boolean;
    };
    qualityClaim: {
        allowed: false;
        reason: string;
    };
    canSatisfyHumanReviewCheck: boolean;
    canClaimDesignQuality: false;
    canRunProvider: false;
    canRunPhotoshop: false;
}

export interface BuildSkuHumanReviewTargetInput {
    projectIdentity?: unknown;
    exportReadback?: unknown;
}

export interface SkuHumanReviewCardValue {
    decision: HumanReviewDecision;
    reviewer: string;
    score?: number;
    notes: string[];
}

export interface SkuHumanReviewCardPayload {
    version: 'sku-human-review-card/v0';
    target: {
        projectFingerprint: string;
        subject: HumanReviewSubject;
        expectedExportCount: number;
        outputDigestCount: number;
    };
    requirements: string[];
    initialValue: SkuHumanReviewCardValue;
}

export type SkuHumanReviewCard = InteractiveCardDefinition<SkuHumanReviewCardPayload>;

interface NormalizedOutputDigest {
    fileName: string;
    sha256: string;
    byteLength: number;
    width: number;
    height: number;
}

export function buildSkuHumanReviewTarget(input: BuildSkuHumanReviewTargetInput): SkuHumanReviewTarget {
    const projectIdentity = String(input.projectIdentity || '').trim();
    const readback = readRecord(input.exportReadback);
    const blockers: string[] = [];
    const warnings: string[] = [];
    const expectedExportCount = toCount(readback?.expectedExportCount);
    const outputDigests = normalizeOutputDigests(readback?.fileProbes);
    const outputFileNameCount = new Set(outputDigests.map((item) => item.fileName.toLowerCase())).size;
    const readbackBoundaries = readRecord(readback?.boundaries);

    let status: SkuHumanReviewTargetStatus = 'ready_for_review';
    if (!projectIdentity) {
        status = 'blocked_missing_project_identity';
        blockers.push('缺少稳定项目标识，不能把人工复核安全地绑定到当前项目。');
    } else if (
        readback?.version !== 'sku-export-readback/v0'
        || readback.status !== 'ready_for_review'
        || expectedExportCount <= 0
        || toCount(readback.okFileProbeCount) !== expectedExportCount
        || toCount(readback.failedFileProbeCount) !== 0
        || toCount(readback.missingFileProbeCount) !== 0
        || toCount(readback.dimensionMismatchCount) !== 0
        || readbackBoundaries?.rawImagesRedacted !== true
    ) {
        status = 'blocked_invalid_export_readback';
        blockers.push('SKU 导出读回尚未达到可复核状态，不能创建人工复核对象。');
    } else if (outputDigests.length !== expectedExportCount || outputFileNameCount !== expectedExportCount) {
        status = 'blocked_missing_output_digest';
        blockers.push(`当前 ${expectedExportCount} 个导出结果中只有 ${outputDigests.length} 个具备有效内容哈希，不能证明复核针对哪一批文件。`);
    }

    const projectFingerprint = projectIdentity
        ? createStableFingerprint('project', normalizeProjectIdentity(projectIdentity))
        : undefined;
    const subject = status === 'ready_for_review' && projectFingerprint
        ? {
            version: 'human-review-subject/v0' as const,
            kind: 'sku-output-batch' as const,
            projectFingerprint,
            fingerprint: createStableFingerprint('review-subject', {
                projectFingerprint,
                outputs: outputDigests
            })
        }
        : undefined;

    return {
        version: 'sku-human-review-target/v0',
        status,
        projectFingerprint,
        subject,
        expectedExportCount,
        outputDigestCount: outputDigests.length,
        blockers,
        warnings,
        boundaries: {
            contentAddressed: true,
            rawImagesRedacted: true,
            localPathsRedacted: true,
            doesNotClaimDesignQuality: true
        },
        canRequestHumanReview: status === 'ready_for_review' && Boolean(subject),
        canClaimDesignQuality: false
    };
}

export function buildSkuHumanReviewBinding(input: {
    target: SkuHumanReviewTarget;
    record?: unknown;
}): SkuHumanReviewBinding {
    const target = input.target;
    const rawRecord = input.record;
    const record = normalizeHumanReviewRecord(rawRecord);
    const targetFingerprint = target.subject?.fingerprint;
    const recordSubject = record?.source?.subject;
    const subjectMatched = Boolean(targetFingerprint && recordSubject?.fingerprint === targetFingerprint);
    const projectMatched = Boolean(
        target.projectFingerprint
        && record?.projectId === target.projectFingerprint
        && recordSubject?.projectFingerprint === target.projectFingerprint
    );
    const recordIntegrityVerified = Boolean(record?.integrityFingerprint);
    const blockers: string[] = [];
    const warnings: string[] = [];
    let status: SkuHumanReviewBindingStatus = 'awaiting_human_review';

    if (!target.canRequestHumanReview || !target.subject) {
        status = 'blocked_current_output';
        blockers.push(...target.blockers);
    } else if (rawRecord && !record) {
        status = 'invalid_review_ignored';
        blockers.push('人工复核记录未通过完整性校验，已拒绝用于当前评价。');
    } else if (record && (!subjectMatched || !projectMatched)) {
        status = 'stale_review_ignored';
        warnings.push('已有人工复核针对另一批 SKU 导出结果，当前文件变化后必须重新复核。');
    } else if (record && subjectMatched && projectMatched) {
        if (record.status === 'recorded_approved' && record.review.decision === 'approved') {
            status = 'fresh_review_approved';
        } else if (record.status === 'recorded_rejected' && record.review.decision === 'rejected') {
            status = 'fresh_review_rejected';
        } else if (record.status === 'recorded_needs_review' && record.review.decision === 'needs_review') {
            status = 'fresh_review_needs_review';
        } else {
            status = 'invalid_review_ignored';
            blockers.push('人工复核状态与结论不一致，已拒绝用于当前评价。');
        }
    }

    const canSatisfyHumanReviewCheck = status === 'fresh_review_approved';
    return {
        version: 'sku-human-review-binding/v0',
        status,
        targetFingerprint,
        recordId: record && subjectMatched && projectMatched ? record.recordId : undefined,
        review: record && subjectMatched && projectMatched ? record.review : undefined,
        blockers: uniqueStrings(blockers).slice(0, 8),
        warnings: uniqueStrings(warnings).slice(0, 8),
        freshness: {
            checked: true,
            subjectMatched,
            projectMatched,
            recordIntegrityVerified
        },
        qualityClaim: {
            allowed: false,
            reason: canSatisfyHumanReviewCheck
                ? '该记录只证明人工复核与当前内容哈希批次一致；最终质量仍由 Evaluation Profile 和统一 DesignVerdict 收口。'
                : '没有与当前内容哈希批次一致的人工通过记录。'
        },
        canSatisfyHumanReviewCheck,
        canClaimDesignQuality: false,
        canRunProvider: false,
        canRunPhotoshop: false
    };
}

export function buildSkuHumanReviewCard(input: {
    target: SkuHumanReviewTarget;
    requirements?: unknown;
}): SkuHumanReviewCard | undefined {
    const target = input.target;
    if (!target.canRequestHumanReview || !target.subject || !target.projectFingerprint) return undefined;
    return {
        version: 'interactive-card/v0',
        id: `sku-human-review-${target.subject.fingerprint}`,
        kind: 'sku_human_review',
        title: '复核当前 SKU 导出结果',
        description: `本次复核只绑定当前 ${target.expectedExportCount} 个导出文件；文件内容变化后，旧结论会自动失效。`,
        payload: {
            version: 'sku-human-review-card/v0',
            target: {
                projectFingerprint: target.projectFingerprint,
                subject: target.subject,
                expectedExportCount: target.expectedExportCount,
                outputDigestCount: target.outputDigestCount
            },
            requirements: normalizeTextList(input.requirements).slice(0, 12),
            initialValue: {
                decision: 'needs_review',
                reviewer: '',
                notes: []
            }
        },
        status: 'draft',
        submitAction: 'submitSkuHumanReviewCard',
        memoryPolicy: {
            enabled: false,
            mode: 'none',
            reviewRequired: true
        }
    };
}

export function validateSkuHumanReviewCardValue(
    payload: SkuHumanReviewCardPayload,
    value: unknown
): InteractiveCardValidationResult<SkuHumanReviewCardValue> {
    const raw = readRecord(value) || {};
    const decision = normalizeDecision(raw.decision);
    const reviewer = cleanInteractiveCardText(raw.reviewer).slice(0, 80);
    const score = normalizeScore(raw.score);
    const notes = normalizeTextList(raw.notes).slice(0, 8);
    const normalizedValue: SkuHumanReviewCardValue = { decision, reviewer, score, notes };
    const issues: InteractiveCardValidationIssue[] = [];

    if (decision === 'none') {
        issues.push({ severity: 'error', code: 'decision_required', message: '请选择人工复核结论。' });
    }
    if ((decision === 'approved' || decision === 'rejected') && !reviewer) {
        issues.push({ severity: 'error', code: 'reviewer_required', message: '通过或驳回必须填写复核人。' });
    }
    if (decision === 'approved' && score === undefined) {
        issues.push({ severity: 'error', code: 'score_required', message: '通过复核必须填写 0 到 1 的人工评分。' });
    }
    const subject = normalizeHumanReviewSubject(payload?.target?.subject);
    if (
        payload?.version !== 'sku-human-review-card/v0'
        || !subject
        || subject.projectFingerprint !== payload.target?.projectFingerprint
        || toCount(payload.target?.expectedExportCount) <= 0
        || toCount(payload.target?.outputDigestCount) !== toCount(payload.target?.expectedExportCount)
    ) {
        issues.push({ severity: 'error', code: 'invalid_review_target', message: '复核对象已损坏，请重新生成 SKU 复核卡片。' });
    }

    return buildInteractiveCardValidationResult({ normalizedValue, issues });
}

export function buildSkuHumanReviewIntakeFromCard(input: {
    card: SkuHumanReviewCard;
    value: SkuHumanReviewCardValue;
    generatedAt?: string;
}): HumanReviewIntakeViewModel {
    const target = input.card.payload.target;
    return buildHumanReviewIntake({
        scenario: 'sku',
        source: {
            kind: 'sku_visual_review',
            stage: 'content_addressed_output_review',
            summary: `人工复核对象包含 ${target.expectedExportCount} 个 SKU 导出文件，已绑定内容哈希批次。`,
            subject: target.subject
        },
        draft: input.value,
        generatedAt: input.generatedAt
    });
}

export function isSkuHumanReviewCard(value: unknown): value is SkuHumanReviewCard {
    const card = readRecord(value);
    const payload = readRecord(card?.payload);
    return card?.version === 'interactive-card/v0'
        && card.kind === 'sku_human_review'
        && payload?.version === 'sku-human-review-card/v0';
}

function normalizeOutputDigests(value: unknown): NormalizedOutputDigest[] {
    if (!Array.isArray(value)) return [];
    return value
        .map((item): NormalizedOutputDigest | undefined => {
            const probe = readRecord(item);
            const dimensions = readRecord(probe?.dimensions);
            const fileName = cleanInteractiveCardText(probe?.fileName).slice(0, 180);
            const sha256 = String(probe?.sha256 || '').trim().toLowerCase();
            if (
                probe?.success !== true
                || probe?.rawImagesRedacted !== true
                || !fileName
                || !/^[a-f0-9]{16,64}$/.test(sha256)
            ) {
                return undefined;
            }
            return {
                fileName,
                sha256,
                byteLength: toCount(probe?.byteLength),
                width: toCount(dimensions?.width),
                height: toCount(dimensions?.height)
            };
        })
        .filter((item): item is NormalizedOutputDigest => Boolean(item))
        .sort((left, right) => left.fileName.localeCompare(right.fileName, 'zh-CN'));
}

function normalizeProjectIdentity(value: string): string {
    return value.replace(/\\/g, '/').replace(/\/+$/g, '').trim().toLowerCase();
}

function normalizeDecision(value: unknown): HumanReviewDecision {
    const decision = cleanInteractiveCardText(value).toLowerCase();
    if (decision === 'approved') return 'approved';
    if (decision === 'needs_review') return 'needs_review';
    if (decision === 'rejected') return 'rejected';
    return 'none';
}

function normalizeScore(value: unknown): number | undefined {
    if (value === '' || value === null || value === undefined) return undefined;
    const score = Number(value);
    if (!Number.isFinite(score) || score < 0 || score > 1) return undefined;
    return Math.round(score * 1000) / 1000;
}

function createStableFingerprint(prefix: 'project' | 'review-subject', value: unknown): string {
    const text = typeof value === 'string' ? value : stableStringify(value);
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

function stableStringify(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
    if (!value || typeof value !== 'object') return JSON.stringify(value);
    const entries = Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`);
    return `{${entries.join(',')}}`;
}

function normalizeTextList(value: unknown): string[] {
    const list = Array.isArray(value) ? value : [value];
    return list.map(cleanInteractiveCardText).filter(Boolean);
}

function uniqueStrings(values: string[]): string[] {
    return Array.from(new Set(values.map(cleanInteractiveCardText).filter(Boolean)));
}

function toCount(value: unknown): number {
    const numberValue = Number(value);
    if (!Number.isFinite(numberValue) || numberValue < 0) return 0;
    return Math.floor(numberValue);
}

function readRecord(value: unknown): Record<string, any> | undefined {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, any>
        : undefined;
}
