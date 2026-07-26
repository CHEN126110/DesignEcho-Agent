import { randomUUID } from 'crypto';
import { app, ipcMain, type WebContents } from 'electron';
import * as path from 'path';
import {
    isInteractiveContinuationRendererEnvelope,
    type InteractiveContinuationOperationActionResult,
    type InteractiveContinuationOperationClaimInput,
    type InteractiveContinuationOperationBeginInput,
    type InteractiveContinuationOperationSettleInput
} from '../../shared/interactive-continuation-operation';
import { InteractiveContinuationOperationStore } from '../services/interactive-continuation-operation-store';

const OPERATIONS_DIR = 'interactive-continuation-operations';

interface RendererGenerationState {
    generationId: string;
    ownerId: string;
    gone: boolean;
    goneReason?: string;
}

interface RendererLifecycleController {
    generations: Map<string, RendererGenerationState>;
    destroyed: boolean;
    currentGenerationId?: string;
    acceptNextGeneration: boolean;
}

type RendererLifecycleResolution =
    | { status: 'accepted'; state: RendererGenerationState }
    | { status: 'rejected'; message: string };

export function registerInteractiveContinuationOperationHandlers(): void {
    const store = new InteractiveContinuationOperationStore(
        path.join(app.getPath('userData'), OPERATIONS_DIR)
    );
    const runningByRenderer = new Map<string, Set<string>>();
    const rendererLifecycleBySender = new WeakMap<WebContents, RendererLifecycleController>();

    function removeRunningOperation(rendererOwnerId: string, continuationId: string): void {
        const running = runningByRenderer.get(rendererOwnerId);
        if (!running) return;
        running.delete(continuationId);
        if (running.size === 0) runningByRenderer.delete(rendererOwnerId);
    }

    async function flushRendererOperationsUnknown(state: RendererGenerationState): Promise<void> {
        const reason = state.goneReason
            || '执行所属的渲染页面已经失效，无法判断 Photoshop 是否已经完成写入。';
        const continuationIds = Array.from(runningByRenderer.get(state.ownerId) || []);
        await Promise.all(continuationIds.map(async (continuationId) => {
            const result = await store.markRunningUnknownIfOwned({
                continuationId,
                rendererOwnerId: state.ownerId,
                reason
            });
            if (result.success || (result.record && result.record.status !== 'running')) {
                removeRunningOperation(state.ownerId, continuationId);
            }
        }));
    }

    function scheduleRendererReconciliation(state: RendererGenerationState): void {
        void flushRendererOperationsUnknown(state).catch((error) => {
                console.error(
                    '[InteractiveContinuation] 标记失效 renderer 操作为 unknown 失败:',
                    error
                );
        });
    }

    function retireRendererGeneration(state: RendererGenerationState, reason: string): void {
        if (!state.gone) {
            state.gone = true;
            state.goneReason = reason;
        }
        scheduleRendererReconciliation(state);
    }

    function retireAllRendererGenerations(
        controller: RendererLifecycleController,
        reason: string
    ): void {
        for (const state of controller.generations.values()) {
            retireRendererGeneration(state, reason);
        }
    }

    function getRendererLifecycleController(sender: WebContents): RendererLifecycleController {
        const existing = rendererLifecycleBySender.get(sender);
        if (existing) return existing;
        const controller: RendererLifecycleController = {
            generations: new Map<string, RendererGenerationState>(),
            destroyed: sender.isDestroyed(),
            acceptNextGeneration: true
        };
        rendererLifecycleBySender.set(sender, controller);

        if (!controller.destroyed) {
            sender.on('did-start-navigation', (_event, _url, isSameDocument, isMainFrame) => {
                if (!isMainFrame || isSameDocument) return;
                retireAllRendererGenerations(
                    controller,
                    '渲染页面开始重新加载或导航，无法判断旧页面中断前 Photoshop 是否已经完成写入。'
                );
                controller.acceptNextGeneration = true;
            });
            sender.on('render-process-gone', () => {
                retireAllRendererGenerations(
                    controller,
                    '执行所属的渲染进程异常退出，无法判断 Photoshop 是否已经完成写入。'
                );
                controller.acceptNextGeneration = true;
            });
            sender.once('destroyed', () => {
                controller.destroyed = true;
                controller.acceptNextGeneration = false;
                retireAllRendererGenerations(
                    controller,
                    '执行所属的渲染页面已销毁，无法判断 Photoshop 是否已经完成写入。'
                );
            });
            if (sender.isDestroyed()) {
                controller.destroyed = true;
                retireAllRendererGenerations(controller, '渲染页面在确认操作开始前已经销毁。');
            }
        }
        return controller;
    }

    async function ensureRendererLifecycle(
        sender: WebContents,
        rendererGenerationId: string
    ): Promise<RendererLifecycleResolution> {
        const controller = getRendererLifecycleController(sender);
        const existing = controller.generations.get(rendererGenerationId);
        if (existing) {
            if (existing.gone) {
                await flushRendererOperationsUnknown(existing);
                return {
                    status: 'rejected',
                    message: existing.goneReason || '这个 renderer 页面代次已经失效。'
                };
            }
            if (controller.currentGenerationId !== rendererGenerationId) {
                return {
                    status: 'rejected',
                    message: '这个 renderer 页面代次不是当前活动代次。'
                };
            }
            return { status: 'accepted', state: existing };
        }
        if (
            controller.currentGenerationId
            && controller.acceptNextGeneration !== true
        ) {
            return {
                status: 'rejected',
                message: '收到未授权的新 renderer 页面代次；当前活动页面不会被替换。'
            };
        }
        const gone = controller.destroyed || sender.isDestroyed();
        const state: RendererGenerationState = {
            generationId: rendererGenerationId,
            ownerId: `renderer-${sender.id}-${randomUUID()}`,
            gone,
            ...(gone ? { goneReason: '渲染页面在确认操作开始前已经销毁。' } : {})
        };
        controller.generations.set(rendererGenerationId, state);
        if (gone) {
            return {
                status: 'rejected',
                message: state.goneReason || '渲染页面已经销毁。'
            };
        }
        controller.currentGenerationId = rendererGenerationId;
        controller.acceptNextGeneration = false;
        return { status: 'accepted', state };
    }

    function invalidRendererEnvelopeResult(action: string): InteractiveContinuationOperationActionResult {
        return {
            success: false,
            code: 'interactive_continuation_operation_invalid_renderer_generation',
            message: `${action}缺少有效的 renderer 页面代次，本轮不会执行或修改操作状态。`
        };
    }

    ipcMain.handle('interactiveContinuation:claim', async (_event, input: unknown) => {
        const safeInput = input && typeof input === 'object' ? input : {};
        return await store.claim(safeInput as InteractiveContinuationOperationClaimInput);
    });

    ipcMain.handle('interactiveContinuation:begin', async (event, input: unknown) => {
        if (!isInteractiveContinuationRendererEnvelope(input)) {
            return invalidRendererEnvelopeResult('取得确认操作执行权');
        }
        const safeInput = input.payload && typeof input.payload === 'object' ? input.payload : {};
        const lifecycleResolution = await ensureRendererLifecycle(
            event.sender,
            input.rendererGenerationId
        );
        if (lifecycleResolution.status === 'rejected') {
            return invalidRendererEnvelopeResult(lifecycleResolution.message);
        }
        const lifecycle = lifecycleResolution.state;
        const rendererOwnerId = lifecycle.ownerId;
        if (lifecycle.gone) {
            return {
                success: false,
                code: 'interactive_continuation_operation_renderer_gone_before_begin',
                message: lifecycle.goneReason || '渲染页面已经退出，确认操作不会开始。'
            };
        }
        const result = await store.begin(
            safeInput as InteractiveContinuationOperationBeginInput,
            rendererOwnerId
        );
        if (result.success && result.record?.status === 'running') {
            const continuationId = result.record.continuationId;
            const running = runningByRenderer.get(rendererOwnerId) || new Set<string>();
            running.add(continuationId);
            runningByRenderer.set(rendererOwnerId, running);
            if (lifecycle.gone || event.sender.isDestroyed()) {
                const marked = await store.markRunningUnknownIfOwned({
                    continuationId,
                    rendererOwnerId,
                    reason: lifecycle.goneReason
                        || '渲染页面在取得执行权时已经退出，无法确认 Photoshop 是否产生写入。'
                });
                removeRunningOperation(rendererOwnerId, continuationId);
                return {
                    ...marked,
                    success: false,
                    code: 'interactive_continuation_operation_renderer_gone_after_begin',
                    message: '渲染页面在取得执行权时已经退出，操作已转为不确定状态，不会继续或自动重放。'
                };
            }
        }
        return result;
    });

    ipcMain.handle('interactiveContinuation:settle', async (event, input: unknown) => {
        if (!isInteractiveContinuationRendererEnvelope(input)) {
            return invalidRendererEnvelopeResult('结算确认操作');
        }
        const safeInput = input.payload && typeof input.payload === 'object' ? input.payload : {};
        const lifecycleResolution = await ensureRendererLifecycle(
            event.sender,
            input.rendererGenerationId
        );
        if (lifecycleResolution.status === 'rejected') {
            return invalidRendererEnvelopeResult(lifecycleResolution.message);
        }
        const rendererOwnerId = lifecycleResolution.state.ownerId;
        const result = await store.settle(
            safeInput as InteractiveContinuationOperationSettleInput,
            rendererOwnerId
        );
        if (result.success && result.record && result.record.status !== 'running') {
            removeRunningOperation(rendererOwnerId, result.record.continuationId);
        }
        return result;
    });

    ipcMain.handle('interactiveContinuation:get', async (event, input: unknown) => {
        if (!isInteractiveContinuationRendererEnvelope(input)) {
            return invalidRendererEnvelopeResult('读取确认操作');
        }
        const lifecycleResolution = await ensureRendererLifecycle(
            event.sender,
            input.rendererGenerationId
        );
        if (lifecycleResolution.status === 'rejected') {
            return invalidRendererEnvelopeResult(lifecycleResolution.message);
        }
        const rendererOwnerId = lifecycleResolution.state.ownerId;
        return await store.get(String(input.payload || ''), rendererOwnerId);
    });

    ipcMain.handle('interactiveContinuation:markUnknown', async (event, input: unknown) => {
        if (!isInteractiveContinuationRendererEnvelope(input)) {
            return invalidRendererEnvelopeResult('标记确认操作为待复核');
        }
        const lifecycleResolution = await ensureRendererLifecycle(
            event.sender,
            input.rendererGenerationId
        );
        if (lifecycleResolution.status === 'rejected') {
            return invalidRendererEnvelopeResult(lifecycleResolution.message);
        }
        const rendererOwnerId = lifecycleResolution.state.ownerId;
        const payload = input.payload && typeof input.payload === 'object'
            ? input.payload as Record<string, unknown>
            : {};
        const normalizedContinuationId = String(payload.continuationId || '').trim();
        const result = await store.markRunningUnknownIfOwned({
            continuationId: normalizedContinuationId,
            rendererOwnerId,
            reason: String(payload.reason || 'Agent 调用已经返回，但操作账本仍处于 running。')
        });
        if (result.success) {
            removeRunningOperation(rendererOwnerId, normalizedContinuationId);
        }
        return result;
    });
}
