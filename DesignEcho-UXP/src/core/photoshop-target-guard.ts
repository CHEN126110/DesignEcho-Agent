import type {
    PhotoshopTargetGuard,
    Tool,
    ToolExecutionContext
} from '../tools/types';
import {
    readActiveHistoryStateRef,
    sameHistoryStateRef,
    type PhotoshopHistoryStateRef
} from './photoshop-history-state-ref';

export const PHOTOSHOP_TARGET_GUARD_PARAM = '__designEchoTargetGuard';

export type { PhotoshopTargetGuard } from '../tools/types';

export interface PhotoshopTargetIdentity {
    documentId: number | null;
    activeLayerId: number | null;
    historyStateId: number | null;
}

type PhotoshopTargetMismatchReason =
    | 'invalid_guard'
    | 'missing_document'
    | 'document_changed'
    | 'active_layer_changed'
    | 'history_state_changed';

export interface PhotoshopTargetChangedResult {
    success: false;
    code: 'photoshop_target_changed_before_execution';
    error: string;
    expected: PhotoshopTargetIdentity;
    actual: PhotoshopTargetIdentity;
    phase?: 'mutation_modal';
    data: null;
}

interface GuardedToolParams {
    hasGuard: boolean;
    guard: PhotoshopTargetGuard | null;
    toolParams: any;
}

/**
 * Photoshop 写入目标的最终执行边界。
 *
 * Renderer 只为需要保护的写调用注入私有参数；UXP 不按工具名猜测读写分类。
 * 私有参数存在时必须在调用业务工具前核对真实活动文档/图层，并且绝不把
 * 该参数继续传给业务工具。
 */
export async function executeToolWithPhotoshopTargetGuard(
    tool: Tool,
    params: any,
    context?: ToolExecutionContext
): Promise<any> {
    const guardedParams = splitGuardedToolParams(params);
    if (!guardedParams.hasGuard) {
        return tool.execute(params, context);
    }

    const actual = readActualPhotoshopTarget();
    const mismatchReason = getMismatchReason(guardedParams.guard, actual);
    if (mismatchReason) {
        return createPhotoshopTargetChangedResult(guardedParams.guard, actual, mismatchReason);
    }

    const normalizedGuard = guardedParams.guard as PhotoshopTargetGuard;
    const guardedContext: ToolExecutionContext = {
        ...(context || {}),
        photoshopTargetGuard: normalizedGuard
    };
    return tool.execute(guardedParams.toolParams, guardedContext);
}

/**
 * 错误归一化与日志也不应重新暴露内部守卫参数。
 */
export function stripPhotoshopTargetGuard(params: any): any {
    return splitGuardedToolParams(params).toolParams;
}

function splitGuardedToolParams(params: any): GuardedToolParams {
    if (!params || typeof params !== 'object' || Array.isArray(params)) {
        return {
            hasGuard: false,
            guard: null,
            toolParams: params
        };
    }

    const record = params as Record<string, unknown>;
    if (!Object.prototype.hasOwnProperty.call(record, PHOTOSHOP_TARGET_GUARD_PARAM)) {
        return {
            hasGuard: false,
            guard: null,
            toolParams: params
        };
    }

    const toolParams: Record<string, unknown> = {};
    for (const key of Object.keys(record)) {
        if (key !== PHOTOSHOP_TARGET_GUARD_PARAM) {
            toolParams[key] = record[key];
        }
    }

    return {
        hasGuard: true,
        guard: normalizePhotoshopTargetGuard(record[PHOTOSHOP_TARGET_GUARD_PARAM]),
        toolParams
    };
}

export function normalizePhotoshopTargetGuard(value: unknown): PhotoshopTargetGuard | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return null;
    }

    const record = value as Record<string, unknown>;
    if (!isValidPhotoshopId(record.expectedDocumentId)) {
        return null;
    }
    if (record.expectedActiveLayerId !== undefined && !isValidPhotoshopId(record.expectedActiveLayerId)) {
        return null;
    }
    const expectedHistoryStateRef = normalizeHistoryStateRef(record.expectedHistoryStateRef);
    if (record.expectedHistoryStateRef !== undefined
        && (!expectedHistoryStateRef || expectedHistoryStateRef.documentId !== record.expectedDocumentId)) {
        return null;
    }

    const expectedHistoryStateRefValue = expectedHistoryStateRef
        ? Object.freeze({ ...expectedHistoryStateRef })
        : undefined;
    return Object.freeze({
        expectedDocumentId: record.expectedDocumentId,
        ...(record.expectedActiveLayerId === undefined
            ? {}
            : { expectedActiveLayerId: record.expectedActiveLayerId }),
        ...(expectedHistoryStateRefValue
            ? { expectedHistoryStateRef: expectedHistoryStateRefValue }
            : {}),
        ...(typeof record.observationTool === 'string'
            ? { observationTool: record.observationTool }
            : {})
    }) as PhotoshopTargetGuard;
}

export function readActualPhotoshopTarget(): PhotoshopTargetIdentity {
    try {
        const app = require('photoshop').app;
        const document = app?.activeDocument;
        if (!document || !isValidPhotoshopId(document.id)) {
            return {
                documentId: null,
                activeLayerId: null,
                historyStateId: null
            };
        }

        const activeLayer = document.activeLayers?.[0];
        const historyStateRef = readActiveHistoryStateRef(document);
        return {
            documentId: document.id,
            activeLayerId: isValidPhotoshopId(activeLayer?.id) ? activeLayer.id : null,
            historyStateId: historyStateRef?.historyStateId ?? null
        };
    } catch (_error) {
        return {
            documentId: null,
            activeLayerId: null,
            historyStateId: null
        };
    }
}

/** 在调用者指定的临界区内复核目标；value 存在但无效时一律 fail closed。 */
export function checkPhotoshopTargetGuard(
    value: unknown,
    actual: PhotoshopTargetIdentity = readActualPhotoshopTarget()
): PhotoshopTargetChangedResult | undefined {
    const guard = normalizePhotoshopTargetGuard(value);
    const mismatchReason = getMismatchReason(guard, actual);
    return mismatchReason
        ? createPhotoshopTargetChangedResult(guard, actual, mismatchReason)
        : undefined;
}

function getMismatchReason(
    guard: PhotoshopTargetGuard | null,
    actual: PhotoshopTargetIdentity
): PhotoshopTargetMismatchReason | null {
    if (!guard) {
        return 'invalid_guard';
    }
    if (actual.documentId === null) {
        return 'missing_document';
    }
    if (actual.documentId !== guard.expectedDocumentId) {
        return 'document_changed';
    }
    if (guard.expectedHistoryStateRef) {
        const actualHistoryStateRef = actual.historyStateId === null
            ? undefined
            : {
                documentId: actual.documentId,
                historyStateId: actual.historyStateId
            };
        if (!sameHistoryStateRef(guard.expectedHistoryStateRef, actualHistoryStateRef)) {
            return 'history_state_changed';
        }
    }
    if (
        guard.expectedActiveLayerId !== undefined
        && actual.activeLayerId !== guard.expectedActiveLayerId
    ) {
        return 'active_layer_changed';
    }
    return null;
}

function createPhotoshopTargetChangedResult(
    guard: PhotoshopTargetGuard | null,
    actual: PhotoshopTargetIdentity,
    reason: PhotoshopTargetMismatchReason
): PhotoshopTargetChangedResult {
    const expected: PhotoshopTargetIdentity = {
        documentId: guard?.expectedDocumentId ?? null,
        activeLayerId: guard?.expectedActiveLayerId ?? null,
        historyStateId: guard?.expectedHistoryStateRef?.historyStateId ?? null
    };

    return {
        success: false,
        code: 'photoshop_target_changed_before_execution',
        error: buildTargetChangedError(reason, expected, actual),
        expected,
        actual,
        data: null
    };
}

function buildTargetChangedError(
    reason: PhotoshopTargetMismatchReason,
    expected: PhotoshopTargetIdentity,
    actual: PhotoshopTargetIdentity
): string {
    if (reason === 'invalid_guard') {
        return 'Photoshop 写入目标守卫参数无效，已在执行前中止。请重新观察当前文档后再试。';
    }
    if (reason === 'missing_document') {
        return `Photoshop 当前没有可写入的活动文档（预期文档 ID: ${formatId(expected.documentId)}），已在执行前中止。请重新打开或选择目标文档后再试。`;
    }
    if (reason === 'document_changed') {
        return `Photoshop 活动文档已变化（预期文档 ID: ${formatId(expected.documentId)}，实际文档 ID: ${formatId(actual.documentId)}），已在执行前中止。请重新观察目标后再试。`;
    }
    if (reason === 'history_state_changed') {
        return `Photoshop 文档版本已变化（预期历史版本 ID: ${formatId(expected.historyStateId)}，实际历史版本 ID: ${formatId(actual.historyStateId)}），已在执行前中止。请重新观察当前文档后再试。`;
    }
    return `Photoshop 活动图层已变化（预期图层 ID: ${formatId(expected.activeLayerId)}，实际图层 ID: ${formatId(actual.activeLayerId)}），已在执行前中止。请重新选择目标图层后再试。`;
}

function normalizeHistoryStateRef(value: unknown): PhotoshopHistoryStateRef | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const record = value as Record<string, unknown>;
    if (!isValidPhotoshopId(record.documentId) || !isValidPhotoshopId(record.historyStateId)) {
        return undefined;
    }
    return {
        documentId: record.documentId,
        historyStateId: record.historyStateId
    };
}

function isValidPhotoshopId(value: unknown): value is number {
    return typeof value === 'number'
        && Number.isFinite(value)
        && Number.isInteger(value)
        && value > 0;
}

function formatId(value: number | null): string {
    return value === null ? '无' : String(value);
}
