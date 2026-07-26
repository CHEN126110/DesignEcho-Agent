import type {
    EagleLibraryOpenResponse,
    EagleLibraryPreviewRequest,
    EagleLibraryPreviewResponse,
    EagleLibraryQueryRequest,
    EagleLibraryQueryResponse
} from '../../shared/eagle-library';

const EAGLE_LIBRARY_PATH_KEY = 'eagle-library:last-path';
const MAX_ACTIVE_PREVIEWS = 6;

interface PreviewQueueEntry {
    key: string;
    request: EagleLibraryPreviewRequest;
    resolve: (value: EagleLibraryPreviewResponse) => void;
}

const previewCache = new Map<string, EagleLibraryPreviewResponse>();
const previewPromises = new Map<string, Promise<EagleLibraryPreviewResponse>>();
const previewQueue: PreviewQueueEntry[] = [];
let activePreviewCount = 0;

export async function selectEagleLibrary(
    defaultPath?: string
): Promise<EagleLibraryOpenResponse> {
    const select = window.designEcho?.selectEagleLibrary;
    if (typeof select !== 'function') {
        return {
            success: false,
            status: 'unavailable',
            error: '当前桌面运行时还没有提供 Eagle 素材库导入能力。'
        };
    }
    const response = await select(defaultPath ? { defaultPath } : undefined);
    if (response.success && response.library?.path) {
        await persistEagleLibraryPath(response.library.path);
    }
    return response;
}

export async function openEagleLibrary(
    libraryPath: string,
    forceRefresh = false
): Promise<EagleLibraryOpenResponse> {
    const open = window.designEcho?.openEagleLibrary;
    if (typeof open !== 'function') {
        return {
            success: false,
            status: 'unavailable',
            error: '当前桌面运行时还没有提供 Eagle 素材库读取能力。'
        };
    }
    const response = await open(libraryPath, forceRefresh);
    if (response.success && response.library?.path) {
        await persistEagleLibraryPath(response.library.path);
    }
    return response;
}

export async function queryEagleLibrary(
    request: EagleLibraryQueryRequest
): Promise<EagleLibraryQueryResponse> {
    const query = window.designEcho?.queryEagleLibrary;
    if (typeof query !== 'function') {
        return {
            success: false,
            status: 'unavailable',
            total: 0,
            offset: 0,
            limit: request.limit || 48,
            items: [],
            error: '当前桌面运行时还没有提供 Eagle 素材库检索能力。'
        };
    }
    return query(request);
}

export function getEagleLibraryPreview(
    request: EagleLibraryPreviewRequest
): Promise<EagleLibraryPreviewResponse> {
    const key = `${request.libraryPath}:${request.itemId}:${request.maxSize || 420}`;
    const cached = previewCache.get(key);
    if (cached) return Promise.resolve(cached);
    const pending = previewPromises.get(key);
    if (pending) return pending;

    const promise = new Promise<EagleLibraryPreviewResponse>((resolve) => {
        previewQueue.push({ key, request, resolve });
        drainPreviewQueue();
    });
    previewPromises.set(key, promise);
    return promise;
}

export async function loadPersistedEagleLibraryPath(): Promise<string | null> {
    const invoke = window.designEcho?.invoke;
    if (typeof invoke !== 'function') return null;
    const response = await invoke('state:getPersistedValue', EAGLE_LIBRARY_PATH_KEY);
    if (!response?.success) return null;
    const value = String(response.value || '').trim();
    return value || null;
}

export async function clearPersistedEagleLibraryPath(): Promise<void> {
    const invoke = window.designEcho?.invoke;
    if (typeof invoke !== 'function') return;
    await invoke('state:removePersistedValue', EAGLE_LIBRARY_PATH_KEY);
}

async function persistEagleLibraryPath(libraryPath: string): Promise<void> {
    const invoke = window.designEcho?.invoke;
    if (typeof invoke !== 'function') return;
    await invoke('state:setPersistedValue', EAGLE_LIBRARY_PATH_KEY, libraryPath);
}

function drainPreviewQueue(): void {
    while (activePreviewCount < MAX_ACTIVE_PREVIEWS && previewQueue.length > 0) {
        const entry = previewQueue.shift();
        if (!entry) return;
        activePreviewCount += 1;
        void executePreviewRequest(entry);
    }
}

async function executePreviewRequest(entry: PreviewQueueEntry): Promise<void> {
    let response: EagleLibraryPreviewResponse;
    const preview = window.designEcho?.getEagleLibraryPreview;
    if (typeof preview !== 'function') {
        response = unavailablePreview(entry.request.itemId);
    } else {
        try {
            response = await preview(entry.request);
        } catch (error) {
            response = {
                ...unavailablePreview(entry.request.itemId),
                error: error instanceof Error ? error.message : 'Eagle 素材预览失败。'
            };
        }
    }
    if (response.success) previewCache.set(entry.key, response);
    previewPromises.delete(entry.key);
    activePreviewCount -= 1;
    entry.resolve(response);
    drainPreviewQueue();
}

function unavailablePreview(itemId: string): EagleLibraryPreviewResponse {
    return {
        success: false,
        status: 'unavailable',
        itemId,
        error: '当前桌面运行时还没有提供 Eagle 素材预览能力。',
        boundaries: {
            uiOnly: true,
            singleItemOnly: true,
            doesNotPersist: true,
            doesNotWriteEagle: true,
            doesNotEnterAgentContext: true,
            doesNotGrantExecution: true
        }
    };
}
