import type { DesignMemoryItem, DesignMemoryScope } from './design-memory-knowledge';

export type InteractiveCardVersion = 'interactive-card/v0';
export type InteractiveCardSubmissionVersion = 'interactive-card-submission/v0';
export type InteractiveCardMemoryMode = 'none' | 'approved_recipe' | 'approved_content';
export type InteractiveCardStatus = 'draft' | 'submitted' | 'cancelled';
export type InteractiveCardValidationSeverity = 'error' | 'warning';

export interface InteractiveCardValidationIssue {
    severity: InteractiveCardValidationSeverity;
    code: string;
    message: string;
    path?: string;
}

export interface InteractiveCardValidationResult<TValue = unknown> {
    valid: boolean;
    canSubmit: boolean;
    normalizedValue: TValue;
    issues: InteractiveCardValidationIssue[];
    blockers: string[];
    warnings: string[];
}

export interface InteractiveCardMemoryPolicy {
    enabled: boolean;
    mode: InteractiveCardMemoryMode;
    scope?: DesignMemoryScope;
    reviewRequired?: boolean;
}

export interface InteractiveCardDefinition<TPayload = unknown> {
    version: InteractiveCardVersion;
    id: string;
    kind: string;
    title: string;
    description?: string;
    payload: TPayload;
    status?: InteractiveCardStatus;
    submitAction?: string;
    memoryPolicy?: InteractiveCardMemoryPolicy;
}

export interface InteractiveCardSubmission<TValue = unknown> {
    version: InteractiveCardSubmissionVersion;
    cardId: string;
    kind: string;
    submittedAt: string;
    value: TValue;
    validation: InteractiveCardValidationResult<TValue>;
    memoryCandidate?: DesignMemoryItem;
    execution?: {
        status: 'succeeded' | 'failed' | 'unknown';
        message?: string;
    };
}

export function cleanInteractiveCardText(value: unknown): string {
    return String(value || '')
        .replace(/data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+/gi, '[redacted-image-payload]')
        .replace(/\b[A-Za-z]:[\\/][^\s"'，,；;]+/g, '[redacted-local-path]')
        .replace(/\s+/g, ' ')
        .trim();
}

export function stableInteractiveCardHash(value: unknown): string {
    const text = (() => {
        try {
            return JSON.stringify(value);
        } catch {
            return String(value || '');
        }
    })();
    let hash = 5381;
    for (let index = 0; index < text.length; index += 1) {
        hash = ((hash << 5) + hash) ^ text.charCodeAt(index);
    }
    return Math.abs(hash).toString(36);
}

/**
 * 提交指纹只描述会影响业务执行的确认内容。
 * submittedAt / memoryCandidate 属于记录元数据；把它们纳入指纹会让同一确认在崩溃恢复后
 * 因时间戳变化被误判成另一笔操作，破坏幂等承接。
 */
export function buildInteractiveCardSubmissionFingerprint(
    submission: InteractiveCardSubmission
): string {
    return stableInteractiveCardHash({
        version: submission.version,
        cardId: submission.cardId,
        kind: submission.kind,
        value: submission.validation?.normalizedValue ?? submission.value,
        validation: {
            valid: submission.validation?.valid === true,
            canSubmit: submission.validation?.canSubmit === true
        }
    });
}

export function buildInteractiveCardSubmission<TValue>(input: {
    card: InteractiveCardDefinition;
    value: TValue;
    validation: InteractiveCardValidationResult<TValue>;
    memoryCandidate?: DesignMemoryItem;
    submittedAt?: string | number | Date;
}): InteractiveCardSubmission<TValue> {
    const submittedAt = input.submittedAt instanceof Date
        ? input.submittedAt.toISOString()
        : typeof input.submittedAt === 'number'
            ? new Date(input.submittedAt).toISOString()
            : cleanInteractiveCardText(input.submittedAt) || new Date().toISOString();
    return {
        version: 'interactive-card-submission/v0',
        cardId: input.card.id,
        kind: input.card.kind,
        submittedAt,
        value: input.value,
        validation: input.validation,
        memoryCandidate: input.memoryCandidate
    };
}

export function buildInteractiveCardValidationResult<TValue>(input: {
    normalizedValue: TValue;
    issues?: InteractiveCardValidationIssue[];
}): InteractiveCardValidationResult<TValue> {
    const issues = Array.isArray(input.issues) ? input.issues : [];
    const blockers = issues
        .filter((issue) => issue.severity === 'error')
        .map((issue) => issue.message);
    const warnings = issues
        .filter((issue) => issue.severity === 'warning')
        .map((issue) => issue.message);
    return {
        valid: blockers.length === 0,
        canSubmit: blockers.length === 0,
        normalizedValue: input.normalizedValue,
        issues,
        blockers,
        warnings
    };
}
