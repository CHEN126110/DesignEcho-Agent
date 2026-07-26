export type HumanReviewSubjectVersion = 'human-review-subject/v0';

export type HumanReviewSubjectKind = 'sku-output-batch';

export interface HumanReviewSubject {
    version: HumanReviewSubjectVersion;
    kind: HumanReviewSubjectKind;
    fingerprint: string;
    projectFingerprint: string;
}

const SUBJECT_KINDS = new Set<HumanReviewSubjectKind>([
    'sku-output-batch'
]);

export function normalizeHumanReviewSubject(value: unknown): HumanReviewSubject | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const raw = value as Partial<HumanReviewSubject>;
    if (raw.version !== 'human-review-subject/v0') return undefined;
    if (!SUBJECT_KINDS.has(raw.kind as HumanReviewSubjectKind)) return undefined;
    const fingerprint = normalizeFingerprint(raw.fingerprint, 'review-subject');
    const projectFingerprint = normalizeFingerprint(raw.projectFingerprint, 'project');
    if (!fingerprint || !projectFingerprint) return undefined;
    return {
        version: 'human-review-subject/v0',
        kind: raw.kind as HumanReviewSubjectKind,
        fingerprint,
        projectFingerprint
    };
}

function normalizeFingerprint(value: unknown, prefix: string): string {
    const text = String(value || '').trim().toLowerCase();
    if (!new RegExp(`^${prefix}-[a-f0-9]{16}$`).test(text)) return '';
    return text;
}
