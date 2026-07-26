/**
 * Photoshop 写调用的同一 modal 提交边界。
 *
 * 该模块无共享可变状态：目标约束来自本次 ToolExecutionContext，并在
 * executeAsModal 内依次完成 before 读取、目标复核、mutation、after 读取。
 */

import type { ToolExecutionContext } from '../tools/types';
import { createToolFailureResult } from './tool-error-normalizer';
import {
    checkPhotoshopTargetGuard,
    normalizePhotoshopTargetGuard,
    readActualPhotoshopTarget,
    type PhotoshopTargetIdentity
} from './photoshop-target-guard';

const { app, core } = require('photoshop');

export const PHOTOSHOP_MUTATION_COMMIT_VERSION = 'photoshop-mutation-commit/v1' as const;

export interface PhotoshopMutationState {
    documentId: number;
    historyStateId: number;
    activeLayerId: number | null;
}

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

export interface PhotoshopMutationScope {
    document: any;
    before?: PhotoshopMutationState;
}

export interface ExecutePhotoshopMutationInput<T extends Record<string, unknown> & { success: boolean }> {
    toolName: string;
    commandName: string;
    params?: unknown;
    context?: ToolExecutionContext;
    expectedEffect?: 'allow_noop' | 'mutation_required';
    mutate(scope: PhotoshopMutationScope): Promise<T>;
}

type MutationModalOutcome<T extends Record<string, unknown> & { success: boolean }> =
    | { kind: 'target_changed'; result: Record<string, unknown> }
    | { kind: 'cancelled'; result: Record<string, unknown> }
    | { kind: 'completed'; result: T; commit: PhotoshopMutationCommit }
    | { kind: 'failed'; error: unknown; commit: PhotoshopMutationCommit };

/**
 * 执行一个单 modal 的 Photoshop mutation，并把原子 before/after commit
 * 附加到原有顶层 Tool 结果；不改变业务结果的字段形状。
 */
export async function executePhotoshopMutation<T extends Record<string, unknown> & { success: boolean }>(
    input: ExecutePhotoshopMutationInput<T>
): Promise<any> {
    let observedCommit: PhotoshopMutationCommit | undefined;
    try {
        const outcome = await core.executeAsModal(async (): Promise<MutationModalOutcome<T>> => {
            if (input.context?.isCancelled?.()) {
                return {
                    kind: 'cancelled',
                    result: {
                        success: false,
                        cancelled: true,
                        error: '请求已在 Photoshop 写入开始前取消。',
                        data: null
                    }
                };
            }

            const actualBefore = readActualPhotoshopTarget();
            const hasGuard = Boolean(input.context)
                && Object.prototype.hasOwnProperty.call(input.context, 'photoshopTargetGuard');
            if (hasGuard) {
                const mismatch = checkPhotoshopTargetGuard(
                    input.context?.photoshopTargetGuard,
                    actualBefore
                );
                if (mismatch) {
                    return {
                        kind: 'target_changed',
                        result: {
                            ...mismatch,
                            phase: 'mutation_modal'
                        }
                    };
                }
            }

            const document = app.activeDocument;
            if (!document || actualBefore.documentId === null) {
                return {
                    kind: 'target_changed',
                    result: createToolFailureResult({
                        toolName: input.toolName,
                        error: 'Photoshop 当前没有可写入的活动文档。',
                        params: input.params
                    })
                };
            }

            const before = toMutationState(actualBefore);
            let result: T | undefined;
            let mutationFailed = false;
            let mutationError: unknown;
            try {
                result = await input.mutate({ document, before });
            } catch (error) {
                mutationFailed = true;
                mutationError = error;
            }
            if (!mutationFailed
                && (!result
                    || typeof result !== 'object'
                    || Array.isArray(result)
                    || typeof result.success !== 'boolean')) {
                mutationFailed = true;
                mutationError = new Error(`${input.toolName} mutation callback 未返回结构化 Tool 结果。`);
            }

            const after = toMutationState(readActualPhotoshopTarget());
            const actionCompleted = !mutationFailed && result?.success !== false;
            const commit = buildPhotoshopMutationCommit({
                before,
                after,
                bindingStrength: resolveBindingStrength(input.context),
                toolActionCompleted: actionCompleted
            });
            observedCommit = commit;

            if (mutationFailed) {
                return { kind: 'failed', error: mutationError, commit };
            }
            return {
                kind: 'completed',
                result: result as T,
                commit
            };
        }, { commandName: input.commandName });

        if (outcome.kind === 'target_changed' || outcome.kind === 'cancelled') {
            return outcome.result;
        }
        if (outcome.kind === 'failed') {
            return attachPhotoshopMutationCommit(
                createToolFailureResult({
                    toolName: input.toolName,
                    error: outcome.error,
                    params: input.params
                }),
                outcome.commit
            );
        }
        if (outcome.result.success === false) {
            return attachPhotoshopMutationCommit(outcome.result, outcome.commit);
        }
        if (input.expectedEffect === 'mutation_required'
            && outcome.commit.mutationObserved !== true) {
            return attachPhotoshopMutationCommit(
                createToolFailureResult({
                    toolName: input.toolName,
                    error: 'Photoshop 写入回调已返回，但同一 modal 内未观察到文档历史版本变化。',
                    params: input.params
                }),
                outcome.commit
            );
        }
        return attachPhotoshopMutationCommit(outcome.result, outcome.commit);
    } catch (error) {
        const failure = createToolFailureResult({
            toolName: input.toolName,
            error,
            params: input.params
        });
        return observedCommit
            ? attachPhotoshopMutationCommit(failure, observedCommit)
            : failure;
    }
}

function resolveBindingStrength(
    context: ToolExecutionContext | undefined
): PhotoshopMutationCommit['bindingStrength'] {
    const guard = normalizePhotoshopTargetGuard(context?.photoshopTargetGuard);
    if (guard?.expectedHistoryStateRef) return 'document_revision';
    if (guard) return 'document_only';
    return 'unguarded';
}

function toMutationState(identity: PhotoshopTargetIdentity): PhotoshopMutationState | undefined {
    if (identity.documentId === null || identity.historyStateId === null) return undefined;
    return {
        documentId: identity.documentId,
        historyStateId: identity.historyStateId,
        activeLayerId: identity.activeLayerId
    };
}

function buildPhotoshopMutationCommit(input: {
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

function attachPhotoshopMutationCommit<T extends Record<string, unknown>>(
    result: T,
    commit: PhotoshopMutationCommit
): T & { photoshopMutationCommit: PhotoshopMutationCommit } {
    return {
        ...result,
        photoshopMutationCommit: commit
    };
}
