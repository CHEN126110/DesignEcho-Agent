import {
    collectTemplateLibraryMissingPreviewPaths,
    getTemplateLibraryDisconnectedState,
    getTemplateLibraryErrorMessage,
    getTemplateLibraryStatePayload,
    mergeTemplateLibraryStatePayload,
    normalizeTemplateLibraryRelativePath
} from './template-library-core';

type TemplateLibraryWsClient = {
    isConnected: () => boolean;
    sendRequest: (method: string, payload: any, timeoutMs?: number) => Promise<any>;
};

export type TemplateLibraryStateCoordinatorDeps = {
    getWsClient: () => TemplateLibraryWsClient | null;
    sendToWebView: (msgType: string, data: any) => void;
    schedule?: (callback: () => void) => void;
};

export type TemplateLibraryDetailRefreshOptions = {
    timeoutMs?: number;
    suppressErrors?: boolean;
};

const TEMPLATE_LIBRARY_PREVIEW_WARMUP_BATCH = 8;

export function createTemplateLibraryStateCoordinator(deps: TemplateLibraryStateCoordinatorDeps) {
    let lastStatePayload: any = getTemplateLibraryDisconnectedState();
    let detailRefreshSeq = 0;
    let previewWarmupInFlight = false;
    let previewWarmupLibraryId = '';
    let lastDetailStateForPreview: any = null;
    const previewWarmupRequested = new Set<string>();
    let loadPromise: Promise<void> | null = null;
    const schedule = deps.schedule || ((callback: () => void) => setTimeout(callback, 0));

    function getConnectedWsClient(): TemplateLibraryWsClient | null {
        const wsClient = deps.getWsClient();
        if (!wsClient || !wsClient.isConnected()) {
            return null;
        }
        return wsClient;
    }

    function queuePreviewWarmup(state: any): void {
        const wsClient = getConnectedWsClient();
        if (!wsClient || !state?.detailReady) return;

        const libraryId = String(state?.activeLibraryId || '').trim();
        if (!libraryId) return;

        if (previewWarmupLibraryId !== libraryId) {
            previewWarmupRequested.clear();
            previewWarmupLibraryId = libraryId;
        }

        lastDetailStateForPreview = state;
        if (previewWarmupInFlight) return;

        const missingPreviewPaths = collectTemplateLibraryMissingPreviewPaths(state);
        const batch = missingPreviewPaths
            .filter((relativePath) => !previewWarmupRequested.has(`${libraryId}|${relativePath}`))
            .slice(0, TEMPLATE_LIBRARY_PREVIEW_WARMUP_BATCH);
        if (batch.length === 0) return;

        batch.forEach((relativePath) => previewWarmupRequested.add(`${libraryId}|${relativePath}`));
        previewWarmupInFlight = true;

        void wsClient.sendRequest('template-library:ensureAssetPreviews', {
            libraryId,
            relativePaths: batch,
            currentRelativePath: String(state?.relativePath || ''),
            detailLevel: 'full',
            maxSize: 420
        }, 120000).then((result: any) => {
            if (result?.success !== false) {
                emitState(result);
            } else {
                batch.forEach((relativePath) => previewWarmupRequested.delete(`${libraryId}|${relativePath}`));
            }
        }).catch((error: any) => {
            batch.forEach((relativePath) => previewWarmupRequested.delete(`${libraryId}|${relativePath}`));
            console.warn('[DesignLibrary] Ensure asset previews failed:', error);
        }).finally(() => {
            previewWarmupInFlight = false;
            const nextState = lastDetailStateForPreview;
            if (nextState) {
                schedule(() => queuePreviewWarmup(nextState));
            }
        });
    }

    function emitState(result: any, overrides?: Record<string, any>): void {
        if (result?.detailReady) {
            detailRefreshSeq += 1;
        }
        const payload = mergeTemplateLibraryStatePayload(
            lastStatePayload,
            getTemplateLibraryStatePayload(result),
            overrides
        );
        lastStatePayload = payload;
        deps.sendToWebView('templateLibraryState', payload);
        queuePreviewWarmup(payload);
    }

    async function refreshDetailState(
        libraryId: string,
        relativePath = '',
        options?: TemplateLibraryDetailRefreshOptions
    ): Promise<any> {
        const wsClient = getConnectedWsClient();
        if (!wsClient || !libraryId) {
            return null;
        }

        try {
            const refreshSeq = ++detailRefreshSeq;
            const result = await wsClient.sendRequest('template-library:browse', {
                libraryId,
                relativePath
            }, options?.timeoutMs || 120000);
            if (refreshSeq !== detailRefreshSeq) {
                return result;
            }
            emitState(result);
            return result;
        } catch (error: any) {
            if (!options?.suppressErrors) {
                deps.sendToWebView('toast', {
                    message: getTemplateLibraryErrorMessage(error, '加载设计库内容失败'),
                    type: 'error'
                });
            }
            return null;
        }
    }

    function queueDetailRefresh(result: any, libraryIdHint = '', relativePathHint = ''): void {
        if (result?.detailReady) {
            return;
        }
        const libraryId = String(result?.activeLibraryId || libraryIdHint || '').trim();
        if (!libraryId) {
            return;
        }

        const relativePath = normalizeTemplateLibraryRelativePath(
            String(result?.relativePath || relativePathHint || '')
        );

        void refreshDetailState(libraryId, relativePath, {
            timeoutMs: 120000,
            suppressErrors: true
        });
    }

    async function loadForWebView(): Promise<void> {
        const wsClient = getConnectedWsClient();
        if (!wsClient) {
            lastStatePayload = getTemplateLibraryDisconnectedState();
            deps.sendToWebView('templateLibraryState', lastStatePayload);
            return;
        }

        if (loadPromise) {
            return loadPromise;
        }

        loadPromise = (async () => {
            try {
                const result = await wsClient.sendRequest('template-library:getState', {});
                emitState(result);
                queueDetailRefresh(result);
            } catch (error: any) {
                console.error('[DesignEcho] Load template library failed:', error);
                lastStatePayload = {
                    ...getTemplateLibraryDisconnectedState(error?.message || '加载设计库失败'),
                    connected: true
                };
                deps.sendToWebView('templateLibraryState', lastStatePayload);
            } finally {
                loadPromise = null;
            }
        })();

        return loadPromise;
    }

    return {
        emitState,
        getLastState: () => lastStatePayload,
        loadForWebView,
        queueDetailRefresh,
        queuePreviewWarmup,
        refreshDetailState
    };
}
