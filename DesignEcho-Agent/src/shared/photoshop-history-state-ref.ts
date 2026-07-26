/** Photoshop Host 提供的文档历史版本引用；只在文档本次打开期间比较。 */
export interface PhotoshopHistoryStateRef {
    documentId: number;
    historyStateId: number;
}

export const PHOTOSHOP_HISTORY_TRANSITION_VERSION = 'photoshop-history-transition/v1' as const;
export const PHOTOSHOP_MUTATION_COMMIT_VERSION = 'photoshop-mutation-commit/v1' as const;

export interface PhotoshopMutationState extends PhotoshopHistoryStateRef {
    activeLayerId: number | null;
}

/** UXP 在一次 executeAsModal 内形成的写前/写后提交记录。 */
export interface PhotoshopMutationCommit {
    version: typeof PHOTOSHOP_MUTATION_COMMIT_VERSION;
    basis: 'same_execute_as_modal';
    bindingStrength: 'document_revision' | 'document_only' | 'unguarded';
    before?: PhotoshopMutationState;
    after?: PhotoshopMutationState;
    toolActionCompleted: boolean;
    mutationObserved: boolean | null;
    documentChanged: boolean | null;
}

/**
 * 一次 Photoshop 写调用外围的 Host 版本对账。
 *
 * 这不是第二份运行账本：它只把既有 before/after 验收快照中的 Host 引用归一到
 * 写 Tool 自身的结果信封，供有序 Tool 日志派生“失败但实际改过文档”等事实。
 */
export interface PhotoshopHistoryTransition {
    version: typeof PHOTOSHOP_HISTORY_TRANSITION_VERSION;
    basis: 'acceptance_snapshot_pair';
    before?: PhotoshopHistoryStateRef;
    after?: PhotoshopHistoryStateRef;
    mutationObserved: boolean | null;
    documentChanged: boolean | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readPositiveInteger(value: unknown): number | undefined {
    const numeric = Number(value);
    if (!Number.isSafeInteger(numeric) || numeric <= 0) return undefined;
    return numeric;
}

function parseHistoryStateRef(value: unknown): PhotoshopHistoryStateRef | undefined {
    if (!isRecord(value)) return undefined;
    const documentId = readPositiveInteger(value.documentId);
    const historyStateId = readPositiveInteger(value.historyStateId);
    if (documentId === undefined || historyStateId === undefined) return undefined;
    return { documentId, historyStateId };
}

function parseMutationState(value: unknown): PhotoshopMutationState | undefined {
    if (!isRecord(value)) return undefined;
    const historyStateRef = parseHistoryStateRef(value);
    const activeLayerId = value.activeLayerId === null
        ? null
        : readPositiveInteger(value.activeLayerId);
    if (!historyStateRef || activeLayerId === undefined) return undefined;
    return { ...historyStateRef, activeLayerId };
}

function buildMutationCommitFromStates(input: {
    before?: PhotoshopMutationState;
    after?: PhotoshopMutationState;
    bindingStrength: PhotoshopMutationCommit['bindingStrength'];
    toolActionCompleted: boolean;
}): PhotoshopMutationCommit {
    if (!input.before || !input.after) {
        return {
            version: PHOTOSHOP_MUTATION_COMMIT_VERSION,
            basis: 'same_execute_as_modal',
            bindingStrength: input.bindingStrength,
            ...(input.before ? { before: input.before } : {}),
            ...(input.after ? { after: input.after } : {}),
            toolActionCompleted: input.toolActionCompleted,
            mutationObserved: null,
            documentChanged: null
        };
    }
    const documentChanged = input.before.documentId !== input.after.documentId;
    return {
        version: PHOTOSHOP_MUTATION_COMMIT_VERSION,
        basis: 'same_execute_as_modal',
        bindingStrength: input.bindingStrength,
        before: input.before,
        after: input.after,
        toolActionCompleted: input.toolActionCompleted,
        mutationObserved: documentChanged
            || input.before.historyStateId !== input.after.historyStateId,
        documentChanged
    };
}

function buildTransitionFromRefs(
    before: PhotoshopHistoryStateRef | undefined,
    after: PhotoshopHistoryStateRef | undefined
): PhotoshopHistoryTransition {
    if (!before || !after) {
        return {
            version: PHOTOSHOP_HISTORY_TRANSITION_VERSION,
            basis: 'acceptance_snapshot_pair',
            ...(before ? { before } : {}),
            ...(after ? { after } : {}),
            mutationObserved: null,
            documentChanged: null
        };
    }
    const documentChanged = before.documentId !== after.documentId;
    return {
        version: PHOTOSHOP_HISTORY_TRANSITION_VERSION,
        basis: 'acceptance_snapshot_pair',
        before,
        after,
        mutationObserved: documentChanged || before.historyStateId !== after.historyStateId,
        documentChanged
    };
}

/** 从 Tool 结果的稳定顶层或 data 包装中读取 Host 版本；缺失时不猜。 */
export function readPhotoshopHistoryStateRef(value: unknown): PhotoshopHistoryStateRef | undefined {
    if (!isRecord(value)) return undefined;
    return parseHistoryStateRef(value.historyStateRef)
        || (isRecord(value.data) ? parseHistoryStateRef(value.data.historyStateRef) : undefined);
}

/**
 * 保存/导出 Tool 在实际文件提交边界观测到的源文档版本。
 * 它与普通 historyStateRef 分开：交付源版本不能冒充一次完成后的 Photoshop 观察。
 */
export function readPhotoshopSourceHistoryStateRef(value: unknown): PhotoshopHistoryStateRef | undefined {
    if (!isRecord(value)) return undefined;
    return parseHistoryStateRef(value.sourceHistoryStateRef)
        || (isRecord(value.data) ? parseHistoryStateRef(value.data.sourceHistoryStateRef) : undefined);
}

/** 从两份 Host 绑定的观察结果构造确定性写前/写后对账；任一引用缺失即保持 unknown。 */
export function buildPhotoshopHistoryTransition(
    beforeValue: unknown,
    afterValue: unknown
): PhotoshopHistoryTransition {
    return buildTransitionFromRefs(
        readPhotoshopHistoryStateRef(beforeValue),
        readPhotoshopHistoryStateRef(afterValue)
    );
}

/**
 * 从 Tool 结果读取并重新推导版本转移，不信任外部传入的 mutationObserved 布尔值。
 * 这样伪造或漂移字段不能误把失败调用当成真实 Photoshop 修改。
 */
export function readPhotoshopHistoryTransition(value: unknown): PhotoshopHistoryTransition | undefined {
    if (!isRecord(value)) return undefined;
    const raw = isRecord(value.photoshopHistoryTransition)
        ? value.photoshopHistoryTransition
        : (isRecord(value.data) && isRecord(value.data.photoshopHistoryTransition)
            ? value.data.photoshopHistoryTransition
            : undefined);
    if (!raw
        || raw.version !== PHOTOSHOP_HISTORY_TRANSITION_VERSION
        || raw.basis !== 'acceptance_snapshot_pair') {
        return undefined;
    }
    const before = parseHistoryStateRef(raw.before);
    const after = parseHistoryStateRef(raw.after);
    return buildTransitionFromRefs(before, after);
}

/**
 * 读取同一 modal 提交并重算派生布尔值；不信任 UXP 传入的 mutationObserved / documentChanged。
 */
export function readPhotoshopMutationCommit(value: unknown): PhotoshopMutationCommit | undefined {
    if (!isRecord(value)) return undefined;
    const raw = isRecord(value.photoshopMutationCommit)
        ? value.photoshopMutationCommit
        : (isRecord(value.data) && isRecord(value.data.photoshopMutationCommit)
            ? value.data.photoshopMutationCommit
            : undefined);
    if (!raw
        || raw.version !== PHOTOSHOP_MUTATION_COMMIT_VERSION
        || raw.basis !== 'same_execute_as_modal'
        || (raw.bindingStrength !== 'document_revision'
            && raw.bindingStrength !== 'document_only'
            && raw.bindingStrength !== 'unguarded')
        || typeof raw.toolActionCompleted !== 'boolean') {
        return undefined;
    }
    const before = parseMutationState(raw.before);
    const after = parseMutationState(raw.after);
    if ((raw.before !== undefined && !before)
        || (raw.after !== undefined && !after)
        || (raw.bindingStrength === 'document_revision' && !before)) {
        return undefined;
    }
    return buildMutationCommitFromStates({
        before,
        after,
        bindingStrength: raw.bindingStrength,
        toolActionCompleted: raw.toolActionCompleted
    });
}

export function hasObservedPhotoshopMutationCommit(value: unknown): boolean {
    return readPhotoshopMutationCommit(value)?.mutationObserved === true;
}

export function hasObservedPhotoshopHistoryMutation(value: unknown): boolean {
    return readPhotoshopHistoryTransition(value)?.mutationObserved === true;
}

export function samePhotoshopHistoryStateRef(
    left: PhotoshopHistoryStateRef | undefined,
    right: PhotoshopHistoryStateRef | undefined
): boolean {
    return Boolean(left
        && right
        && left.documentId === right.documentId
        && left.historyStateId === right.historyStateId);
}
