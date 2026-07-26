import type {
    InteractiveContinuationOperationActionResult,
    InteractiveContinuationOperationBeginInput,
    InteractiveContinuationOperationClaimInput,
    InteractiveContinuationOperationSettleInput
} from '../../shared/interactive-continuation-operation';
import {
    buildInteractiveContinuationRendererEnvelope
} from '../../shared/interactive-continuation-operation';

function createRendererGenerationId(): string {
    if (typeof globalThis.crypto?.randomUUID === 'function') {
        return `renderer-generation-${globalThis.crypto.randomUUID()}`;
    }
    return `renderer-generation-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

const RENDERER_GENERATION_ID = createRendererGenerationId();

function unavailableResult(
    action: string,
    error?: unknown,
    executionMayHaveStarted = false
): InteractiveContinuationOperationActionResult {
    const detail = error instanceof Error ? error.message : String(error || '').trim();
    const failureDetail = detail
        ? `${action}失败：持久化执行账本不可用（${detail}）。`
        : `${action}失败：持久化执行账本不可用。`;
    return {
        success: false,
        code: 'interactive_continuation_operation_ledger_unavailable',
        message: executionMayHaveStarted
            ? `${failureDetail}无法确认 Photoshop 是否已经产生写入；请先检查当前画面，系统不会自动重放。`
            : `${failureDetail}本轮不会写入 Photoshop。`
    };
}

async function invokeLedger(
    channel: string,
    action: string,
    input: unknown,
    executionMayHaveStarted = false
): Promise<InteractiveContinuationOperationActionResult> {
    if (typeof window === 'undefined' || !window.designEcho?.invoke) {
        return unavailableResult(action, undefined, executionMayHaveStarted);
    }
    try {
        const result = await window.designEcho.invoke(channel, input);
        if (!result || typeof result !== 'object' || typeof result.success !== 'boolean') {
            return unavailableResult(action, '主进程返回了无效响应', executionMayHaveStarted);
        }
        return result as InteractiveContinuationOperationActionResult;
    } catch (error) {
        return unavailableResult(action, error, executionMayHaveStarted);
    }
}

export async function claimInteractiveContinuationOperation(
    input: InteractiveContinuationOperationClaimInput
): Promise<InteractiveContinuationOperationActionResult> {
    return await invokeLedger('interactiveContinuation:claim', '登记确认操作', input);
}

export async function beginInteractiveContinuationOperation(
    input: InteractiveContinuationOperationBeginInput
): Promise<InteractiveContinuationOperationActionResult> {
    return await invokeLedger(
        'interactiveContinuation:begin',
        '取得确认操作执行权',
        buildInteractiveContinuationRendererEnvelope(RENDERER_GENERATION_ID, input)
    );
}

export async function getInteractiveContinuationOperation(
    continuationId: string
): Promise<InteractiveContinuationOperationActionResult> {
    return await invokeLedger(
        'interactiveContinuation:get',
        '读取确认操作状态',
        buildInteractiveContinuationRendererEnvelope(RENDERER_GENERATION_ID, continuationId),
        true
    );
}

export async function markInteractiveContinuationOperationUnknown(
    continuationId: string,
    reason: string
): Promise<InteractiveContinuationOperationActionResult> {
    if (typeof window === 'undefined' || !window.designEcho?.invoke) {
        return unavailableResult('标记确认操作为待复核', undefined, true);
    }
    try {
        const result = await window.designEcho.invoke(
            'interactiveContinuation:markUnknown',
            buildInteractiveContinuationRendererEnvelope(RENDERER_GENERATION_ID, {
                continuationId,
                reason
            })
        );
        if (!result || typeof result !== 'object' || typeof result.success !== 'boolean') {
            return unavailableResult('标记确认操作为待复核', '主进程返回了无效响应', true);
        }
        return result as InteractiveContinuationOperationActionResult;
    } catch (error) {
        return unavailableResult('标记确认操作为待复核', error, true);
    }
}

export async function settleInteractiveContinuationOperation(
    input: InteractiveContinuationOperationSettleInput
): Promise<InteractiveContinuationOperationActionResult> {
    return await invokeLedger(
        'interactiveContinuation:settle',
        '结算确认操作',
        buildInteractiveContinuationRendererEnvelope(RENDERER_GENERATION_ID, input),
        true
    );
}
