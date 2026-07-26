/**
 * Photoshop 文档历史状态引用（无状态 helper）。
 *
 * document.id + activeHistoryState.id 只在文档本次打开期间作为 Host 版本身份使用。
 * 不用 history index、时间戳、图层数或 Renderer 计数器伪造版本。
 */

export interface PhotoshopHistoryStateRef {
    documentId: number;
    historyStateId: number;
}

function readPositiveInteger(value: unknown): number | undefined {
    const numeric = Number(value);
    if (!Number.isSafeInteger(numeric) || numeric <= 0) return undefined;
    return numeric;
}

export function readActiveHistoryStateRef(document: any): PhotoshopHistoryStateRef | undefined {
    const documentId = readPositiveInteger(document?.id);
    const historyStateId = readPositiveInteger(document?.activeHistoryState?.id);
    if (documentId === undefined || historyStateId === undefined) return undefined;
    return { documentId, historyStateId };
}

export function sameHistoryStateRef(
    left: PhotoshopHistoryStateRef | undefined,
    right: PhotoshopHistoryStateRef | undefined
): boolean {
    return Boolean(left
        && right
        && left.documentId === right.documentId
        && left.historyStateId === right.historyStateId);
}
