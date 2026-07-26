import {
    buildInteractiveCardSubmissionFingerprint,
    stableInteractiveCardHash,
    type InteractiveCardDefinition,
    type InteractiveCardSubmission
} from './interactive-card-contract';
import { getSkillById } from './skills/skill-declarations';

export type PendingInteractiveContinuationVersion = 'pending-interactive-continuation/v0';

export interface PendingInteractiveContinuationScope {
    requestId?: string;
    conversationId?: string;
    projectId?: string;
    projectPath?: string;
    photoshopDocumentId?: number;
}

export interface PendingInteractiveContinuationScopeObservation {
    version: 'pending-interactive-continuation-scope-observation/v0';
    observedAt: string;
    source: 'pause_boundary_get_document_info';
    photoshopDocumentState: 'present' | 'absent' | 'unknown';
    photoshopDocumentId?: number;
}

export interface PendingInteractiveContinuationOperation {
    kind: 'skill_execution';
    skillId: string;
    params: Record<string, unknown>;
    agentTaskPlan?: unknown;
}

/**
 * 一个挂起操作只拥有一张决策卡。多卡聚合需要另一套“收齐后执行”协议，
 * 不能复用 one-time continuation，否则每张卡都可能重复触发同一个写操作。
 */
export interface PendingInteractiveContinuation {
    version: PendingInteractiveContinuationVersion;
    id: string;
    createdAt: string;
    sourceTask: string;
    scope: PendingInteractiveContinuationScope;
    scopeObservation?: PendingInteractiveContinuationScopeObservation;
    operation: PendingInteractiveContinuationOperation;
    card: InteractiveCardDefinition;
    oneTime: true;
}

/**
 * UI 只提交不可执行的引用，不携带 Skill、参数或提交内容副本。
 * Engine 必须从来源消息读取权威 continuation，并从持久化操作账本取得权威 submission。
 */
export interface InteractiveContinuationRequest {
    continuationId: string;
    cardId: string;
    sourceCardFingerprint: string;
    submissionFingerprint: string;
    sourceMessageId: string;
}

export interface InteractiveContinuationOwnerMessageLike {
    id?: unknown;
    interactiveCards?: InteractiveCardDefinition[];
    pendingInteractiveContinuation?: PendingInteractiveContinuation;
    interactiveCardSubmissions?: InteractiveCardSubmission[];
}

export type InteractiveCardSubmissionDecision =
    | {
        status: 'record_only';
        nextSubmissions: InteractiveCardSubmission[];
        sourceMessageId: string;
    }
    | {
        status: 'resume_operation';
        request: InteractiveContinuationRequest;
        nextSubmissions: InteractiveCardSubmission[];
        sourceTask: string;
        sourceCard: InteractiveCardDefinition;
    }
    | {
        status: 'rejected';
        code: string;
        message: string;
    };

export type InteractiveContinuationClaimDecision =
    | {
        status: 'accepted';
        request: InteractiveContinuationRequest;
        nextSubmissions: InteractiveCardSubmission[];
        sourceTask: string;
        sourceCard: InteractiveCardDefinition;
    }
    | {
        status: 'rejected';
        code: string;
        message: string;
    };

export type InteractiveContinuationResolution =
    | {
        status: 'accepted';
        continuation: PendingInteractiveContinuation;
        submission: InteractiveCardSubmission;
        sourceMessageId: string;
        card: InteractiveCardDefinition;
        skillId: string;
        params: Record<string, unknown>;
        agentTaskPlan?: unknown;
    }
    | {
        status: 'rejected';
        code: string;
        message: string;
    };

function readRecord(value: unknown): Record<string, any> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return value as Record<string, any>;
}

function cleanIdentity(value: unknown): string {
    return String(value || '').trim();
}

function normalizeProjectPath(value: unknown): string {
    return cleanIdentity(value).replace(/\\/g, '/').replace(/\/$/, '').toLowerCase();
}

function normalizeCreatedAt(value: string | number | Date | undefined): string {
    if (value instanceof Date) return value.toISOString();
    if (typeof value === 'number') return new Date(value).toISOString();
    return cleanIdentity(value) || new Date().toISOString();
}

function validateInteractiveContinuationOwnerSkill(
    continuation: PendingInteractiveContinuation
): InteractiveContinuationResolution | undefined {
    const skillId = cleanIdentity(continuation.operation?.skillId);
    const skill = getSkillById(skillId);
    if (!skill) {
        return {
            status: 'rejected',
            code: 'interactive_continuation_owner_skill_missing',
            message: '原挂起操作引用的能力已经不存在，本轮不会执行。请重新发起任务。'
        };
    }
    if (skill.visibility !== 'user-facing') {
        return {
            status: 'rejected',
            code: 'interactive_continuation_owner_skill_not_user_facing',
            message: '原挂起操作属于系统编排能力，不能作为确认卡的执行 owner。请重新发起任务。'
        };
    }
    return undefined;
}

function resolveOwnerMessageSourceCard(input: {
    ownerMessage?: InteractiveContinuationOwnerMessageLike;
    continuation: PendingInteractiveContinuation;
}): { status: 'accepted'; card: InteractiveCardDefinition } | {
    status: 'rejected';
    code: string;
    message: string;
} {
    const ownerCards = Array.isArray(input.ownerMessage?.interactiveCards)
        ? input.ownerMessage.interactiveCards
        : [];
    const matchingCards = ownerCards.filter((card) => (
        cleanIdentity(card?.id) === cleanIdentity(input.continuation.card?.id)
    ));
    if (matchingCards.length !== 1) {
        return {
            status: 'rejected',
            code: 'interactive_continuation_source_card_missing',
            message: '来源消息没有唯一匹配的确认卡，本轮不会执行。请重新生成确认卡。'
        };
    }
    const [sourceCard] = matchingCards;
    const sameDefinition = cleanIdentity(sourceCard.kind) === cleanIdentity(input.continuation.card?.kind)
        && stableInteractiveCardHash(sourceCard) === stableInteractiveCardHash(input.continuation.card);
    if (!sameDefinition) {
        return {
            status: 'rejected',
            code: 'interactive_continuation_source_card_definition_mismatch',
            message: '来源消息中的确认卡与原挂起操作定义不一致，本轮不会执行。请重新生成确认卡。'
        };
    }
    return { status: 'accepted', card: sourceCard };
}

function readInteractiveCards(value: unknown): InteractiveCardDefinition[] {
    return Array.isArray(value) ? value as InteractiveCardDefinition[] : [];
}

function collectCardsFromValue(value: unknown, cards: InteractiveCardDefinition[]): void {
    const record = readRecord(value);
    const nestedToolCards: InteractiveCardDefinition[] = [];
    if (Array.isArray(record.toolResults)) {
        for (const entry of record.toolResults) {
            const nested = readRecord(entry);
            const direct = readInteractiveCards(nested.result?.interactiveCards);
            const data = readInteractiveCards(nested.result?.data?.interactiveCards);
            nestedToolCards.push(...direct, ...data);
        }
    }
    const candidates = [
        ...readInteractiveCards(record.interactiveCards),
        ...readInteractiveCards(record.data?.interactiveCards),
        ...nestedToolCards
    ];
    for (const card of candidates) {
        const candidate = readRecord(card);
        if (candidate.version !== 'interactive-card/v0') continue;
        if (!cleanIdentity(candidate.id) || !cleanIdentity(candidate.kind)) continue;
        if (candidate.status === 'submitted' || candidate.status === 'cancelled') continue;
        cards.push(card);
    }
}

function sanitizeContinuationParams(params: Record<string, unknown>): Record<string, unknown> {
    const {
        interactiveContinuationId: _previousContinuationId,
        interactiveCardDefinition: _previousCard,
        interactiveCardSubmission: _previousSubmission,
        ...businessParams
    } = params || {};
    return businessParams;
}

export function collectPendingInteractiveCards(result: unknown): InteractiveCardDefinition[] {
    const cards: InteractiveCardDefinition[] = [];
    collectCardsFromValue(result, cards);
    const seen = new Map<string, string>();
    return cards.filter((card) => {
        const id = cleanIdentity(card.id);
        const definitionHash = stableInteractiveCardHash(card);
        const previousHash = seen.get(id);
        if (seen.has(id)) {
            if (previousHash !== definitionHash) {
                throw new Error(`检测到相同卡片 ID 的不同定义：${id}；本轮不会选择任一卡片版本。`);
            }
            return false;
        }
        seen.set(id, definitionHash);
        return true;
    });
}

export function buildPendingInteractiveContinuation(input: {
    skillId: string;
    params: Record<string, unknown>;
    result: unknown;
    outcomeStatus: string;
    sourceTask?: string;
    requestId?: string;
    conversationId?: string;
    projectId?: string;
    projectPath?: string;
    scopeObservation?: PendingInteractiveContinuationScopeObservation;
    agentTaskPlan?: unknown;
    createdAt?: string | number | Date;
}): PendingInteractiveContinuation | null {
    if (input.outcomeStatus !== 'awaiting_confirmation') return null;
    const skillId = cleanIdentity(input.skillId);
    if (!skillId) return null;
    const cards = collectPendingInteractiveCards(input.result);
    if (cards.length === 0) return null;
    if (cards.length !== 1) {
        throw new Error(`一个挂起操作只能绑定一张确认卡，当前收到 ${cards.length} 张。`);
    }
    const createdAt = normalizeCreatedAt(input.createdAt);
    const params = sanitizeContinuationParams(input.params);
    const card = cards[0];
    const fingerprint = stableInteractiveCardHash({
        skillId,
        params,
        cardId: card.id,
        createdAt
    });
    return {
        version: 'pending-interactive-continuation/v0',
        id: `continuation-${fingerprint}`,
        createdAt,
        sourceTask: cleanIdentity(input.sourceTask),
        scope: {
            ...(cleanIdentity(input.requestId) ? { requestId: cleanIdentity(input.requestId) } : {}),
            ...(cleanIdentity(input.conversationId) ? { conversationId: cleanIdentity(input.conversationId) } : {}),
            ...(cleanIdentity(input.projectId) ? { projectId: cleanIdentity(input.projectId) } : {}),
            ...(cleanIdentity(input.projectPath) ? { projectPath: cleanIdentity(input.projectPath) } : {}),
            ...(input.scopeObservation?.photoshopDocumentState === 'present'
                && Number.isFinite(Number(input.scopeObservation.photoshopDocumentId))
                && Number(input.scopeObservation.photoshopDocumentId) > 0
                ? { photoshopDocumentId: Number(input.scopeObservation.photoshopDocumentId) }
                : {})
        },
        ...(input.scopeObservation ? { scopeObservation: input.scopeObservation } : {}),
        operation: {
            kind: 'skill_execution',
            skillId,
            params,
            ...(input.agentTaskPlan ? { agentTaskPlan: input.agentTaskPlan } : {})
        },
        card,
        oneTime: true
    };
}

export function attachPendingInteractiveContinuation(
    result: unknown,
    continuation: PendingInteractiveContinuation | null
): unknown {
    if (!continuation) return result;
    const existing = resolvePendingInteractiveContinuationLeaf(result);
    if (existing && !hasSamePendingInteractiveContinuationOwner(existing, continuation)) {
        throw new Error(
            `挂起操作所有权冲突：已有 ${existing.operation.skillId}/${existing.id}，`
            + `不能覆盖为 ${continuation.operation.skillId}/${continuation.id}。`
        );
    }
    const owner = existing || continuation;
    assertPendingInteractiveContinuationCardBinding(result, owner);
    const record = readRecord(result);
    return {
        ...record,
        data: {
            ...readRecord(record.data),
            pendingInteractiveContinuation: owner
        }
    };
}

function collectPendingInteractiveContinuationCandidates(value: unknown): PendingInteractiveContinuation[] {
    const record = readRecord(value);
    const candidates: unknown[] = [
        record.pendingInteractiveContinuation,
        record.data?.pendingInteractiveContinuation
    ];
    if (Array.isArray(record.toolResults)) {
        for (const entry of record.toolResults) {
            const nested = readRecord(entry);
            candidates.push(
                nested.result?.pendingInteractiveContinuation,
                nested.result?.data?.pendingInteractiveContinuation
            );
        }
    }
    return candidates.filter((candidate): candidate is PendingInteractiveContinuation => (
        readRecord(candidate).version === 'pending-interactive-continuation/v0'
    ));
}

function hasSamePendingInteractiveContinuationOwner(
    left: PendingInteractiveContinuation,
    right: PendingInteractiveContinuation
): boolean {
    return cleanIdentity(left.id) === cleanIdentity(right.id)
        && cleanIdentity(left.operation?.skillId) === cleanIdentity(right.operation?.skillId)
        && cleanIdentity(left.card?.id) === cleanIdentity(right.card?.id)
        && cleanIdentity(left.card?.kind) === cleanIdentity(right.card?.kind)
        && stableInteractiveCardHash(left) === stableInteractiveCardHash(right);
}

function assertPendingInteractiveContinuationCardBinding(
    result: unknown,
    continuation: PendingInteractiveContinuation
): void {
    const cards = collectPendingInteractiveCards(result);
    if (cards.length !== 1) {
        throw new Error(`一个挂起操作只能绑定一张确认卡，当前收到 ${cards.length} 张。`);
    }
    const [card] = cards;
    const sameIdentity = cleanIdentity(card.id) === cleanIdentity(continuation.card?.id)
        && cleanIdentity(card.kind) === cleanIdentity(continuation.card?.kind);
    const sameDefinition = stableInteractiveCardHash(card)
        === stableInteractiveCardHash(continuation.card);
    if (!sameIdentity || !sameDefinition) {
        throw new Error('挂起操作与当前确认卡不一致，已停止以避免把确认内容提交给错误的执行操作。');
    }
}

/**
 * 解析执行结果中唯一的叶子 continuation。
 * 同一 owner 的顶层/嵌套投影允许重复出现；不同 owner、operation id 或卡片绑定一律拒绝。
 */
export function resolvePendingInteractiveContinuationLeaf(
    value: unknown
): PendingInteractiveContinuation | undefined {
    const candidates = collectPendingInteractiveContinuationCandidates(value);
    const leaf = candidates[0];
    if (!leaf) return undefined;
    const conflicting = candidates.find((candidate) => (
        !hasSamePendingInteractiveContinuationOwner(leaf, candidate)
    ));
    if (conflicting) {
        throw new Error(
            `检测到多个不同的挂起操作 owner：${leaf.operation.skillId}/${leaf.id} 与 `
            + `${conflicting.operation.skillId}/${conflicting.id}；本轮不会选择或覆盖任一操作。`
        );
    }
    assertPendingInteractiveContinuationCardBinding(value, leaf);
    return leaf;
}

export function findPendingInteractiveContinuation(value: unknown): PendingInteractiveContinuation | undefined {
    return resolvePendingInteractiveContinuationLeaf(value);
}

function resolveInteractiveContinuationBinding(input: {
    continuation: PendingInteractiveContinuation;
    submission: InteractiveCardSubmission;
    sourceMessageId: string;
    conversationId?: string;
    projectId?: string;
    projectPath?: string;
}): InteractiveContinuationResolution {
    const continuation = input.continuation;
    if (!continuation || continuation.version !== 'pending-interactive-continuation/v0') {
        return {
            status: 'rejected',
            code: 'interactive_continuation_missing',
            message: '这张确认卡没有可恢复的原执行上下文，请重新发起任务。'
        };
    }
    if (continuation.oneTime !== true || continuation.operation?.kind !== 'skill_execution') {
        return {
            status: 'rejected',
            code: 'interactive_continuation_invalid_operation',
            message: '确认卡的续跑操作无效，本轮不会执行。'
        };
    }
    const ownerSkillIssue = validateInteractiveContinuationOwnerSkill(continuation);
    if (ownerSkillIssue) return ownerSkillIssue;
    const sourceMessageId = cleanIdentity(input.sourceMessageId);
    if (!sourceMessageId) {
        return {
            status: 'rejected',
            code: 'interactive_continuation_missing_source_message',
            message: '无法确认这张卡来自哪条消息，本轮不会执行。'
        };
    }
    const submission = input.submission;
    if (!submission || submission.version !== 'interactive-card-submission/v0') {
        return {
            status: 'rejected',
            code: 'interactive_continuation_invalid_submission',
            message: '确认内容不完整，本轮不会执行。'
        };
    }
    if (submission.validation?.canSubmit !== true || submission.validation?.valid !== true) {
        return {
            status: 'rejected',
            code: 'interactive_continuation_submission_not_validated',
            message: '确认内容还没有通过校验，请先修改。'
        };
    }
    const card = continuation.card;
    if (!card || card.id !== submission.cardId || card.kind !== submission.kind) {
        return {
            status: 'rejected',
            code: 'interactive_continuation_card_mismatch',
            message: '这次提交不属于原挂起操作，本轮不会执行。'
        };
    }
    const expectedConversationId = cleanIdentity(continuation.scope.conversationId);
    const actualConversationId = cleanIdentity(input.conversationId);
    if (expectedConversationId && expectedConversationId !== actualConversationId) {
        return {
            status: 'rejected',
            code: 'interactive_continuation_conversation_mismatch',
            message: '这张确认卡属于另一个对话，不能在当前对话执行。'
        };
    }
    const expectedProjectId = cleanIdentity(continuation.scope.projectId);
    const actualProjectId = cleanIdentity(input.projectId);
    if (expectedProjectId && expectedProjectId !== actualProjectId) {
        return {
            status: 'rejected',
            code: 'interactive_continuation_project_mismatch',
            message: '项目已经切换，这张确认卡不能继续执行。'
        };
    }
    const expectedProjectPath = normalizeProjectPath(continuation.scope.projectPath);
    const actualProjectPath = normalizeProjectPath(input.projectPath);
    if (expectedProjectPath && expectedProjectPath !== actualProjectPath) {
        return {
            status: 'rejected',
            code: 'interactive_continuation_project_path_mismatch',
            message: '项目目录已经变化，这张确认卡不能继续执行。'
        };
    }
    return {
        status: 'accepted',
        continuation,
        submission,
        sourceMessageId,
        card,
        skillId: continuation.operation.skillId,
        params: {
            ...continuation.operation.params,
            interactiveContinuationId: continuation.id,
            interactiveCardDefinition: card,
            interactiveCardSubmission: submission
        },
        ...(continuation.operation.agentTaskPlan
            ? { agentTaskPlan: continuation.operation.agentTaskPlan }
            : {})
    };
}

function resolveInteractiveContinuation(input: {
    continuation: PendingInteractiveContinuation;
    submission: InteractiveCardSubmission;
    sourceMessageId: string;
    conversationId?: string;
    projectId?: string;
    projectPath?: string;
    photoshopDocumentId?: number;
}): InteractiveContinuationResolution {
    const resolution = resolveInteractiveContinuationBinding(input);
    if (resolution.status === 'rejected') return resolution;

    const expectedPhotoshopDocumentId = Number(resolution.continuation.scope.photoshopDocumentId || 0);
    const actualPhotoshopDocumentId = Number(input.photoshopDocumentId || 0);
    if (expectedPhotoshopDocumentId > 0 && expectedPhotoshopDocumentId !== actualPhotoshopDocumentId) {
        return {
            status: 'rejected',
            code: 'interactive_continuation_photoshop_document_mismatch',
            message: 'Photoshop 当前文档已经变化，这张确认卡不会应用到新的文档。请重新发起任务。'
        };
    }
    return resolution;
}

export function resolveOwnedInteractiveContinuationRequest(input: {
    ownerMessage?: InteractiveContinuationOwnerMessageLike;
    request: InteractiveContinuationRequest;
    conversationId?: string;
    projectId?: string;
    projectPath?: string;
    photoshopDocumentId?: number;
    submission?: InteractiveCardSubmission;
}): InteractiveContinuationResolution {
    const sourceMessageId = cleanIdentity(input.ownerMessage?.id);
    if (!sourceMessageId || sourceMessageId !== cleanIdentity(input.request?.sourceMessageId)) {
        return {
            status: 'rejected',
            code: 'interactive_continuation_missing_owner',
            message: '确认记录与来源消息不一致，本轮不会执行。请重新生成确认卡。'
        };
    }
    const continuation = input.ownerMessage?.pendingInteractiveContinuation;
    if (!continuation || continuation.id !== cleanIdentity(input.request?.continuationId)) {
        return {
            status: 'rejected',
            code: 'interactive_continuation_owner_mismatch',
            message: '确认记录与原挂起操作不一致，本轮不会执行。请重新生成确认卡。'
        };
    }
    if (continuation.card.id !== cleanIdentity(input.request?.cardId)) {
        return {
            status: 'rejected',
            code: 'interactive_continuation_card_mismatch',
            message: '确认记录与原卡片不一致，本轮不会执行。'
        };
    }
    const sourceCardResolution = resolveOwnerMessageSourceCard({
        ownerMessage: input.ownerMessage,
        continuation
    });
    if (sourceCardResolution.status === 'rejected') return sourceCardResolution;
    const submissions = Array.isArray(input.ownerMessage?.interactiveCardSubmissions)
        ? input.ownerMessage.interactiveCardSubmissions
        : [];
    const suppliedSubmission = input.submission;
    const submission = suppliedSubmission || submissions.find((candidate) => (
        candidate.cardId === continuation.card.id
        && candidate.kind === continuation.card.kind
        && buildInteractiveCardSubmissionFingerprint(candidate) === cleanIdentity(input.request?.submissionFingerprint)
    ));
    if (!submission) {
        return {
            status: 'rejected',
            code: 'interactive_continuation_submission_mismatch',
            message: '确认内容没有写回来源消息，本轮不会执行。'
        };
    }
    if (buildInteractiveCardSubmissionFingerprint(submission) !== cleanIdentity(input.request?.submissionFingerprint)) {
        return {
            status: 'rejected',
            code: 'interactive_continuation_submission_mismatch',
            message: '确认内容与持久化操作记录不一致，本轮不会执行。'
        };
    }
    return resolveInteractiveContinuationOperationRequest({
        continuation,
        submission,
        request: input.request,
        conversationId: input.conversationId,
        projectId: input.projectId,
        projectPath: input.projectPath,
        photoshopDocumentId: input.photoshopDocumentId
    });
}

/**
 * 操作账本是执行真相源；会话消息只负责 UI 投影。
 * Engine 使用账本冻结的 continuation + submission 恢复原 Skill，不再从可变对话消息读取参数。
 */
export function resolveInteractiveContinuationOperationRequest(input: {
    continuation: PendingInteractiveContinuation;
    submission: InteractiveCardSubmission;
    request: InteractiveContinuationRequest;
    conversationId?: string;
    projectId?: string;
    projectPath?: string;
    photoshopDocumentId?: number;
}): InteractiveContinuationResolution {
    const continuation = input.continuation;
    const request = input.request;
    if (continuation.id !== cleanIdentity(request?.continuationId)) {
        return {
            status: 'rejected',
            code: 'interactive_continuation_operation_id_mismatch',
            message: '确认记录与持久化操作 ID 不一致，本轮不会执行。'
        };
    }
    if (continuation.card.id !== cleanIdentity(request?.cardId)) {
        return {
            status: 'rejected',
            code: 'interactive_continuation_card_mismatch',
            message: '确认记录与原卡片不一致，本轮不会执行。'
        };
    }
    if (stableInteractiveCardHash(continuation.card) !== cleanIdentity(request?.sourceCardFingerprint)) {
        return {
            status: 'rejected',
            code: 'interactive_continuation_source_card_definition_mismatch',
            message: '确认请求中的来源卡片定义与持久化操作不一致，本轮不会执行。'
        };
    }
    const sourceMessageId = cleanIdentity(request?.sourceMessageId);
    if (!sourceMessageId) {
        return {
            status: 'rejected',
            code: 'interactive_continuation_missing_source_message',
            message: '确认操作缺少来源消息标识，本轮不会执行。'
        };
    }
    if (buildInteractiveCardSubmissionFingerprint(input.submission) !== cleanIdentity(request?.submissionFingerprint)) {
        return {
            status: 'rejected',
            code: 'interactive_continuation_submission_mismatch',
            message: '确认内容与持久化操作记录不一致，本轮不会执行。'
        };
    }
    return resolveInteractiveContinuation({
        continuation,
        submission: input.submission,
        sourceMessageId,
        conversationId: input.conversationId,
        projectId: input.projectId,
        projectPath: input.projectPath,
        photoshopDocumentId: input.photoshopDocumentId
    });
}

export function buildInteractiveContinuationClaim(input: {
    ownerMessage?: InteractiveContinuationOwnerMessageLike;
    submission: InteractiveCardSubmission;
    conversationId?: string;
    projectId?: string;
    projectPath?: string;
}): InteractiveContinuationClaimDecision {
    const sourceMessageId = cleanIdentity(input.ownerMessage?.id);
    const continuation = input.ownerMessage?.pendingInteractiveContinuation;
    if (!sourceMessageId || !continuation) {
        return {
            status: 'rejected',
            code: 'interactive_continuation_missing_owner',
            message: '这张确认卡没有可恢复的原执行上下文，请重新发起任务。'
        };
    }
    const existingSubmissions = Array.isArray(input.ownerMessage?.interactiveCardSubmissions)
        ? input.ownerMessage.interactiveCardSubmissions
        : [];
    if (existingSubmissions.some((submission) => submission.cardId === continuation.card.id)) {
        return {
            status: 'rejected',
            code: 'interactive_continuation_already_claimed',
            message: '这张确认卡已经提交过了，不会重复执行。'
        };
    }
    const sourceCardResolution = resolveOwnerMessageSourceCard({
        ownerMessage: input.ownerMessage,
        continuation
    });
    if (sourceCardResolution.status === 'rejected') return sourceCardResolution;
    const resolution = resolveInteractiveContinuationBinding({
        continuation,
        submission: input.submission,
        sourceMessageId,
        conversationId: input.conversationId,
        projectId: input.projectId,
        projectPath: input.projectPath
    });
    if (resolution.status === 'rejected') return resolution;
    return {
        status: 'accepted',
        request: {
            continuationId: continuation.id,
            cardId: continuation.card.id,
            sourceCardFingerprint: stableInteractiveCardHash(sourceCardResolution.card),
            submissionFingerprint: buildInteractiveCardSubmissionFingerprint(input.submission),
            sourceMessageId
        },
        nextSubmissions: [...existingSubmissions, input.submission],
        sourceTask: continuation.sourceTask,
        sourceCard: sourceCardResolution.card
    };
}

/**
 * 明确区分两类卡片：
 * - record_only：通用 createInteractiveCard 只记录用户决定，不伪造一个可执行操作；
 * - resume_operation：业务 Skill 卡必须绑定持久化 continuation 后才能续跑。
 */
export function buildInteractiveCardSubmissionDecision(input: {
    ownerMessage?: InteractiveContinuationOwnerMessageLike;
    submission: InteractiveCardSubmission;
    mode: 'record_or_resume' | 'resume_required';
    conversationId?: string;
    projectId?: string;
    projectPath?: string;
}): InteractiveCardSubmissionDecision {
    const sourceMessageId = cleanIdentity(input.ownerMessage?.id);
    if (!sourceMessageId) {
        return {
            status: 'rejected',
            code: 'interactive_card_missing_owner',
            message: '无法确认这张卡来自哪条消息，本轮不会提交。'
        };
    }

    const existingSubmissions = Array.isArray(input.ownerMessage?.interactiveCardSubmissions)
        ? input.ownerMessage.interactiveCardSubmissions
        : [];
    if (existingSubmissions.some((submission) => submission.cardId === input.submission.cardId)) {
        return {
            status: 'rejected',
            code: 'interactive_card_already_submitted',
            message: '这张确认卡已经提交过了，不会重复处理。'
        };
    }

    if (input.ownerMessage?.pendingInteractiveContinuation) {
        const claim = buildInteractiveContinuationClaim({
            ownerMessage: input.ownerMessage,
            submission: input.submission,
            conversationId: input.conversationId,
            projectId: input.projectId,
            projectPath: input.projectPath
        });
        if (claim.status === 'rejected') return claim;
        return {
            status: 'resume_operation',
            request: claim.request,
            nextSubmissions: claim.nextSubmissions,
            sourceTask: claim.sourceTask,
            sourceCard: claim.sourceCard
        };
    }

    if (input.mode === 'resume_required') {
        return {
            status: 'rejected',
            code: 'interactive_continuation_missing_owner',
            message: '这张业务确认卡没有可恢复的原执行上下文，请重新发起任务。'
        };
    }

    const ownerCards = Array.isArray(input.ownerMessage?.interactiveCards)
        ? input.ownerMessage.interactiveCards
        : [];
    const ownsCard = ownerCards.some((card) => (
        card.id === input.submission.cardId
        && card.kind === input.submission.kind
    ));
    if (!ownsCard) {
        return {
            status: 'rejected',
            code: 'interactive_card_owner_mismatch',
            message: '提交内容与来源卡片不一致，本轮不会记录。'
        };
    }

    return {
        status: 'record_only',
        nextSubmissions: [...existingSubmissions, input.submission],
        sourceMessageId
    };
}
