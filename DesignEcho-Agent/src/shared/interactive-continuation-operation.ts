import {
    buildInteractiveCardSubmissionFingerprint,
    stableInteractiveCardHash,
    type InteractiveCardDefinition,
    type InteractiveCardSubmission
} from './interactive-card-contract';
import type { PendingInteractiveContinuation } from './pending-interactive-continuation';
import { getSkillById } from './skills/skill-declarations';

export const INTERACTIVE_CONTINUATION_OPERATION_VERSION = 'interactive-continuation-operation/v0' as const;
export const INTERACTIVE_CONTINUATION_RENDERER_ENVELOPE_VERSION =
    'interactive-continuation-renderer-envelope/v0' as const;

export type InteractiveContinuationOperationStatus =
    | 'claimed'
    | 'running'
    | 'succeeded'
    | 'failed'
    | 'unknown';

export type InteractiveContinuationMutationState =
    | 'none'
    | 'observed'
    | 'unknown';

export interface InteractiveContinuationOperationIdentity {
    continuationId: string;
    sourceMessageId: string;
    cardId: string;
    submissionFingerprint: string;
    conversationId?: string;
    projectId?: string;
    projectPath?: string;
}

export interface InteractiveContinuationOperationClaimInput
    extends InteractiveContinuationOperationIdentity {
    submission: InteractiveCardSubmission;
    continuation: PendingInteractiveContinuation;
    sourceCard: InteractiveCardDefinition;
}

export interface InteractiveContinuationOperationBeginInput
    extends InteractiveContinuationOperationIdentity {
    executionRunId: string;
}

export interface InteractiveContinuationOperationSettleInput
    extends InteractiveContinuationOperationIdentity {
    status: 'succeeded' | 'failed';
    /**
     * 本次叶子执行的 Photoshop 修改事实。仅 `none` 可以把 running + failed 安全结算为 failed；
     * 已观察到修改或缺少可靠统计时都必须保持不可自动重放的 unknown。
     */
    mutationState?: InteractiveContinuationMutationState;
    executionRunId?: string;
    summary?: string;
}

export interface InteractiveContinuationOperationRecord
    extends InteractiveContinuationOperationIdentity {
    version: typeof INTERACTIVE_CONTINUATION_OPERATION_VERSION;
    status: InteractiveContinuationOperationStatus;
    submission: InteractiveCardSubmission;
    continuation: PendingInteractiveContinuation;
    continuationFingerprint: string;
    claimedAt: string;
    updatedAt: string;
    runningHostSessionId?: string;
    runningRendererOwnerId?: string;
    runningExecutionRunId?: string;
    startedAt?: string;
    settledAt?: string;
    outcomeSummary?: string;
    mutationState?: InteractiveContinuationMutationState;
    uncertaintyReason?: string;
}

export interface InteractiveContinuationOperationActionResult {
    success: boolean;
    code: string;
    message: string;
    record?: InteractiveContinuationOperationRecord;
    idempotent?: boolean;
}

export interface InteractiveContinuationRendererEnvelope {
    version: typeof INTERACTIVE_CONTINUATION_RENDERER_ENVELOPE_VERSION;
    rendererGenerationId: string;
    payload: unknown;
}

function cleanIdentity(value: unknown): string {
    return String(value || '').trim();
}

function normalizeProjectPath(value: unknown): string {
    return cleanIdentity(value).replace(/\\/g, '/').replace(/\/$/, '').toLowerCase();
}

function cleanSummary(value: unknown): string | undefined {
    const text = cleanIdentity(value).replace(/\s+/g, ' ');
    return text ? text.slice(0, 500) : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : undefined;
}

/**
 * 从叶子 Skill 的统一执行摘要读取修改事实。正常结果明确报告 0 才能视为未写入；
 * 抛异常、旧 Skill 没有摘要或计数无效时一律保持 unknown，避免误放行重复执行。
 */
export function resolveInteractiveContinuationMutationState(
    result: unknown
): InteractiveContinuationMutationState {
    const root = asRecord(result);
    const data = asRecord(root?.data);
    const summary = asRecord(root?.executionSummary) || asRecord(data?.executionSummary);
    const mutationCount = summary?.successfulMutationCalls;
    if (typeof mutationCount !== 'number' || !Number.isFinite(mutationCount) || mutationCount < 0) {
        return 'unknown';
    }
    return mutationCount > 0 ? 'observed' : 'none';
}

export function buildInteractiveContinuationRendererEnvelope(
    rendererGenerationId: string,
    payload: unknown
): InteractiveContinuationRendererEnvelope {
    return {
        version: INTERACTIVE_CONTINUATION_RENDERER_ENVELOPE_VERSION,
        rendererGenerationId: cleanIdentity(rendererGenerationId),
        payload
    };
}

export function isInteractiveContinuationRendererEnvelope(
    value: unknown
): value is InteractiveContinuationRendererEnvelope {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const record = value as Record<string, unknown>;
    if (record.version !== INTERACTIVE_CONTINUATION_RENDERER_ENVELOPE_VERSION) return false;
    const rendererGenerationId = cleanIdentity(record.rendererGenerationId);
    return rendererGenerationId.length >= 8
        && rendererGenerationId.length <= 128
        && Object.prototype.hasOwnProperty.call(record, 'payload');
}

export function normalizeInteractiveContinuationOperationIdentity(
    input: InteractiveContinuationOperationIdentity
): InteractiveContinuationOperationIdentity {
    return {
        continuationId: cleanIdentity(input.continuationId),
        sourceMessageId: cleanIdentity(input.sourceMessageId),
        cardId: cleanIdentity(input.cardId),
        submissionFingerprint: cleanIdentity(input.submissionFingerprint),
        ...(cleanIdentity(input.conversationId)
            ? { conversationId: cleanIdentity(input.conversationId) }
            : {}),
        ...(cleanIdentity(input.projectId)
            ? { projectId: cleanIdentity(input.projectId) }
            : {}),
        ...(normalizeProjectPath(input.projectPath)
            ? { projectPath: normalizeProjectPath(input.projectPath) }
            : {})
    };
}

export function validateInteractiveContinuationOperationIdentity(
    input: InteractiveContinuationOperationIdentity
): string | undefined {
    const normalized = normalizeInteractiveContinuationOperationIdentity(input);
    if (!normalized.continuationId) return '缺少 continuationId。';
    if (!normalized.sourceMessageId) return '缺少来源消息 ID。';
    if (!normalized.cardId) return '缺少卡片 ID。';
    if (!normalized.submissionFingerprint) return '缺少提交指纹。';
    return undefined;
}

export function validateInteractiveContinuationOperationClaim(
    input: InteractiveContinuationOperationClaimInput
): string | undefined {
    const identityIssue = validateInteractiveContinuationOperationIdentity(input);
    if (identityIssue) return identityIssue;
    if (!input.submission || input.submission.version !== 'interactive-card-submission/v0') {
        return '提交内容不是受支持的交互卡协议。';
    }
    if (input.submission.cardId !== cleanIdentity(input.cardId)) {
        return '提交内容与卡片 ID 不一致。';
    }
    const actualFingerprint = buildInteractiveCardSubmissionFingerprint(input.submission);
    if (actualFingerprint !== cleanIdentity(input.submissionFingerprint)) {
        return '提交内容与提交指纹不一致。';
    }
    const continuation = input.continuation;
    if (!continuation || continuation.version !== 'pending-interactive-continuation/v0') {
        return '缺少受支持的 continuation envelope。';
    }
    if (continuation.id !== cleanIdentity(input.continuationId)) {
        return 'continuation envelope 与 continuationId 不一致。';
    }
    if (continuation.oneTime !== true || continuation.operation?.kind !== 'skill_execution') {
        return 'continuation envelope 不是一次性 Skill 操作。';
    }
    const ownerSkill = getSkillById(cleanIdentity(continuation.operation.skillId));
    if (!ownerSkill) {
        return 'continuation envelope 引用的 owner Skill 不存在。';
    }
    if (ownerSkill.visibility !== 'user-facing') {
        return 'continuation envelope 的 owner Skill 不是 user-facing 能力。';
    }
    if (continuation.card?.id !== cleanIdentity(input.cardId)) {
        return 'continuation envelope 与卡片 ID 不一致。';
    }
    if (continuation.card?.kind !== input.submission.kind) {
        return 'continuation envelope 与提交卡片类型不一致。';
    }
    const sourceCard = input.sourceCard;
    if (!sourceCard || sourceCard.version !== 'interactive-card/v0') {
        return '来源消息缺少受支持的确认卡定义。';
    }
    if (sourceCard.id !== continuation.card.id || sourceCard.kind !== continuation.card.kind) {
        return '来源消息卡片与 continuation envelope 不一致。';
    }
    if (stableInteractiveCardHash(sourceCard) !== stableInteractiveCardHash(continuation.card)) {
        return '来源消息卡片定义与 continuation envelope 不一致。';
    }
    const identity = normalizeInteractiveContinuationOperationIdentity(input);
    if (cleanIdentity(continuation.scope.conversationId) !== cleanIdentity(identity.conversationId)) {
        return 'continuation envelope 与对话作用域不一致。';
    }
    if (cleanIdentity(continuation.scope.projectId) !== cleanIdentity(identity.projectId)) {
        return 'continuation envelope 与项目作用域不一致。';
    }
    if (normalizeProjectPath(continuation.scope.projectPath) !== normalizeProjectPath(identity.projectPath)) {
        return 'continuation envelope 与项目目录作用域不一致。';
    }
    const serializedSize = new TextEncoder().encode(JSON.stringify({
        submission: input.submission,
        continuation,
        sourceCard
    })).byteLength;
    if (serializedSize > 512 * 1024) {
        return '确认操作超过 512KB，拒绝写入操作账本。';
    }
    return undefined;
}

export function buildInteractiveContinuationEnvelopeFingerprint(
    continuation: PendingInteractiveContinuation
): string {
    return stableInteractiveCardHash({
        version: continuation.version,
        id: continuation.id,
        scope: continuation.scope,
        operation: continuation.operation,
        card: continuation.card,
        oneTime: continuation.oneTime
    });
}

export function isSameInteractiveContinuationOperationIdentity(
    record: InteractiveContinuationOperationIdentity,
    input: InteractiveContinuationOperationIdentity
): boolean {
    const left = normalizeInteractiveContinuationOperationIdentity(record);
    const right = normalizeInteractiveContinuationOperationIdentity(input);
    return left.continuationId === right.continuationId
        && left.sourceMessageId === right.sourceMessageId
        && left.cardId === right.cardId
        && left.submissionFingerprint === right.submissionFingerprint
        && cleanIdentity(left.conversationId) === cleanIdentity(right.conversationId)
        && cleanIdentity(left.projectId) === cleanIdentity(right.projectId)
        && normalizeProjectPath(left.projectPath) === normalizeProjectPath(right.projectPath);
}

export function buildClaimedInteractiveContinuationOperationRecord(input: {
    claim: InteractiveContinuationOperationClaimInput;
    now: string;
}): InteractiveContinuationOperationRecord {
    const identity = normalizeInteractiveContinuationOperationIdentity(input.claim);
    return {
        version: INTERACTIVE_CONTINUATION_OPERATION_VERSION,
        ...identity,
        status: 'claimed',
        submission: input.claim.submission,
        continuation: input.claim.continuation,
        continuationFingerprint: buildInteractiveContinuationEnvelopeFingerprint(input.claim.continuation),
        claimedAt: input.now,
        updatedAt: input.now
    };
}

export function markInteractiveContinuationOperationRunning(input: {
    record: InteractiveContinuationOperationRecord;
    hostSessionId: string;
    rendererOwnerId: string;
    executionRunId: string;
    now: string;
}): InteractiveContinuationOperationRecord {
    return {
        ...input.record,
        status: 'running',
        runningHostSessionId: cleanIdentity(input.hostSessionId),
        runningRendererOwnerId: cleanIdentity(input.rendererOwnerId),
        runningExecutionRunId: cleanIdentity(input.executionRunId),
        startedAt: input.now,
        updatedAt: input.now,
        uncertaintyReason: undefined
    };
}

export function settleInteractiveContinuationOperationRecord(input: {
    record: InteractiveContinuationOperationRecord;
    status: 'succeeded' | 'failed';
    mutationState?: InteractiveContinuationMutationState;
    summary?: string;
    now: string;
}): InteractiveContinuationOperationRecord {
    return {
        ...input.record,
        status: input.status,
        updatedAt: input.now,
        settledAt: input.now,
        outcomeSummary: cleanSummary(input.summary),
        mutationState: input.mutationState,
        uncertaintyReason: undefined
    };
}

export function markInteractiveContinuationOperationUnknown(input: {
    record: InteractiveContinuationOperationRecord;
    reason: string;
    mutationState?: Exclude<InteractiveContinuationMutationState, 'none'>;
    now: string;
}): InteractiveContinuationOperationRecord {
    return {
        ...input.record,
        status: 'unknown',
        updatedAt: input.now,
        settledAt: input.now,
        mutationState: input.mutationState || 'unknown',
        uncertaintyReason: cleanSummary(input.reason) || '执行进程中断，无法确认 Photoshop 是否已经产生写入。'
    };
}

export function isInteractiveContinuationOperationRecord(
    value: unknown
): value is InteractiveContinuationOperationRecord {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const record = value as Record<string, unknown>;
    if (record.version !== INTERACTIVE_CONTINUATION_OPERATION_VERSION) return false;
    if (!['claimed', 'running', 'succeeded', 'failed', 'unknown'].includes(String(record.status || ''))) {
        return false;
    }
    if (record.mutationState !== undefined
        && !['none', 'observed', 'unknown'].includes(String(record.mutationState))) {
        return false;
    }
    if (validateInteractiveContinuationOperationIdentity(record as unknown as InteractiveContinuationOperationIdentity)) {
        return false;
    }
    const submission = record.submission as InteractiveCardSubmission | undefined;
    if (!submission || submission.version !== 'interactive-card-submission/v0') return false;
    const continuation = record.continuation as PendingInteractiveContinuation | undefined;
    if (!continuation || continuation.version !== 'pending-interactive-continuation/v0') return false;
    if (record.continuationFingerprint !== buildInteractiveContinuationEnvelopeFingerprint(continuation)) {
        return false;
    }
    return !validateInteractiveContinuationOperationClaim({
        ...(record as unknown as InteractiveContinuationOperationClaimInput),
        sourceCard: continuation.card
    });
}
