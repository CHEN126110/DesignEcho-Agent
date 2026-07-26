/**
 * Photoshop 当前文档的稳定只读观察区间。
 *
 * 只借用 Host 的 executeAsModal 防止读取期间与其他 Tool 写入交错；不保存状态、不创建版本账本。
 * 成功结果唯一版本身份仍是 document.id + activeHistoryState.id。
 */

import {
    readActiveHistoryStateRef,
    sameHistoryStateRef,
    type PhotoshopHistoryStateRef
} from './photoshop-history-state-ref';

const app = require('photoshop').app;
const { core } = require('photoshop');

export interface StablePhotoshopDocumentObservation<T> {
    value: T;
    historyStateRef: PhotoshopHistoryStateRef;
}

export interface StablePhotoshopDocumentObservationOptions {
    commandName: string;
    timeOut?: number;
    unavailableMessage?: string;
    changedMessage?: string;
}

export type PhotoshopDocumentObservationErrorCode =
    | 'no_active_document'
    | 'history_state_unavailable'
    | 'document_changed_during_observation';

export class PhotoshopDocumentObservationError extends Error {
    readonly code: PhotoshopDocumentObservationErrorCode;

    constructor(code: PhotoshopDocumentObservationErrorCode, message: string) {
        super(message);
        this.name = 'PhotoshopDocumentObservationError';
        this.code = code;
    }
}

/**
 * 在一个短 modal 区间内读取当前文档，并要求 reader 前后 Host 版本完全一致。
 * 任一版本字段不可读时 fail closed；绝不回退到时间戳、图层数或 Renderer 计数器。
 */
export async function observeActiveDocumentAtHistoryState<T>(
    options: StablePhotoshopDocumentObservationOptions,
    reader: (document: any, historyStateRef: PhotoshopHistoryStateRef) => Promise<T> | T
): Promise<StablePhotoshopDocumentObservation<T>> {
    return core.executeAsModal(async () => {
        const document = app.activeDocument;
        if (!document) {
            throw new PhotoshopDocumentObservationError('no_active_document', '没有打开的文档');
        }
        const historyBefore = readActiveHistoryStateRef(document);
        if (!historyBefore) {
            throw new PhotoshopDocumentObservationError(
                'history_state_unavailable',
                options.unavailableMessage
                    || '无法读取 Photoshop 文档历史版本，未返回可能过期的观察结果。'
            );
        }

        const value = await reader(document, historyBefore);
        const activeDocument = app.activeDocument;
        const historyAfter = readActiveHistoryStateRef(activeDocument);
        if (Number(activeDocument?.id) !== historyBefore.documentId
            || !historyAfter
            || !sameHistoryStateRef(historyBefore, historyAfter)) {
            throw new PhotoshopDocumentObservationError(
                'document_changed_during_observation',
                options.changedMessage
                    || '读取期间 Photoshop 文档发生变化，已丢弃这次不一致的观察结果。'
            );
        }

        return {
            value,
            historyStateRef: historyAfter
        };
    }, {
        commandName: options.commandName,
        timeOut: options.timeOut ?? 5
    });
}
