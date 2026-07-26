export const TEMPLATE_LIBRARY_MAX_BINARY_EXPORT_BYTES = 20 * 1024 * 1024;
export const TEMPLATE_LIBRARY_MAX_PREVIEW_EXPORT_BYTES = 2 * 1024 * 1024;
export const TEMPLATE_LIBRARY_PREVIEW_MAX_DIMENSION = 480;
export const TEMPLATE_LIBRARY_PREVIEW_JPEG_QUALITY = 4;
export const TEMPLATE_LIBRARY_MAX_BINARY_BASE64_LENGTH = Math.ceil((TEMPLATE_LIBRARY_MAX_BINARY_EXPORT_BYTES * 4) / 3);

export function normalizeTemplateLibraryRelativePath(input: string): string {
    return String(input || '')
        .replace(/[\\/]+/g, '/')
        .split('/')
        .filter((segment) => segment && segment !== '.' && segment !== '..')
        .join('/');
}

export function getTemplateLibraryParentRelativePath(input: string): string {
    const normalized = normalizeTemplateLibraryRelativePath(input);
    if (!normalized) {
        return '';
    }
    const parts = normalized.split('/').filter(Boolean);
    parts.pop();
    return parts.join('/');
}

export function stripTemplateLibraryExtension(input: string): string {
    return String(input || '').trim().replace(/\.[^.]+$/, '') || 'design-asset';
}

export function isGenericTemplateLibraryLayerName(input: string): boolean {
    const name = stripTemplateLibraryExtension(input).trim();
    if (!name) return true;
    return /^(group|layer|shape|copy|组|群组|图层|形状)(\s|_|-|\d|副本|拷贝)*$/i.test(name);
}

export function getTemplateLibrarySelectionBaseName(doc: any, selectedLayers: any[]): string {
    const docBaseName = stripTemplateLibraryExtension(doc?.name || 'design-asset');
    if (selectedLayers.length === 1) {
        const layerBaseName = stripTemplateLibraryExtension(selectedLayers[0]?.name || '');
        if (layerBaseName && !isGenericTemplateLibraryLayerName(layerBaseName)) {
            return layerBaseName;
        }
    }
    return docBaseName || 'design-asset';
}

export function sanitizeTemplateLibraryAssetFileName(input: string): string {
    return stripTemplateLibraryExtension(String(input || ''))
        .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/\.+$/g, '') || 'design-asset';
}

export function getTemplateLibraryStatePayload(result: any) {
    const assets = Array.isArray(result?.assets) ? result.assets : [];
    return {
        success: !!result?.success,
        detailReady: !!result?.detailReady,
        connected: true,
        error: String(result?.error || ''),
        settings: result?.settings || { localLibraryDirs: [], libraries: [] },
        libraries: Array.isArray(result?.libraries) ? result.libraries : [],
        activeLibraryId: String(result?.activeLibraryId || ''),
        relativePath: String(result?.relativePath || ''),
        breadcrumbs: Array.isArray(result?.breadcrumbs) ? result.breadcrumbs : [],
        entries: Array.isArray(result?.entries) ? result.entries : [],
        assets,
        tags: Array.isArray(result?.tags) ? result.tags : [],
        templates: Array.isArray(result?.templates) ? result.templates : [],
        storageInfo: result?.storageInfo || null
    };
}

export function getTemplateLibraryDisconnectedState(error?: string) {
    return {
        success: false,
        detailReady: false,
        connected: false,
        error: error || '',
        settings: { localLibraryDirs: [], libraries: [] },
        libraries: [],
        activeLibraryId: '',
        relativePath: '',
        breadcrumbs: [],
        entries: [],
        assets: [],
        tags: [],
        templates: [],
        storageInfo: null
    };
}

export function hasUsableTemplateLibraryCachedState(payload: any): boolean {
    if (!payload || payload.connected === false) {
        return false;
    }

    const libraries = Array.isArray(payload?.libraries) ? payload.libraries : [];
    const assets = Array.isArray(payload?.assets) ? payload.assets : [];
    const activeLibraryId = String(payload?.activeLibraryId || '').trim();

    return libraries.length > 0
        || assets.length > 0
        || !!activeLibraryId
        || payload?.detailReady === true;
}

export function upsertTemplateLibraryAssetEntries(entries: any[], asset: any): any[] {
    const nextEntries = Array.isArray(entries)
        ? entries.filter((item) => String(item?.relativePath || '').trim() !== asset.relativePath)
        : [];
    return [asset, ...nextEntries];
}

export function buildOptimisticTemplateLibraryImportOverrides(
    previous: any,
    libraryId: string,
    importedRelativePath: string,
    exported: { name?: string; extension?: string; previewBase64?: string }
): Record<string, any> | undefined {
    if (!previous || String(previous?.activeLibraryId || '').trim() !== libraryId) {
        return undefined;
    }

    const relativePath = normalizeTemplateLibraryRelativePath(importedRelativePath);
    if (!relativePath) {
        return undefined;
    }

    const extension = String(exported?.extension || 'psd').replace(/^./, '').trim().toLowerCase() || 'psd';
    const asset = {
        kind: 'template',
        name: String(exported?.name || '').trim() || stripTemplateLibraryExtension(relativePath.split('/').pop() || 'design-asset'),
        relativePath,
        fileFormat: extension,
        assetType: extension === 'psd' || extension === 'psb' ? 'design-file' : 'image',
        thumbnailUrl: String(exported?.previewBase64 || '').trim(),
        tags: []
    };

    return {
        assets: upsertTemplateLibraryAssetEntries(Array.isArray(previous?.assets) ? previous.assets : [], asset)
    };
}

export function mergeTemplateLibraryStatePayload(
    previous: any,
    basePayload: any,
    overrides?: Record<string, any>
) {
    let payload = { ...basePayload };

    if (
        !payload.detailReady
        && previous
        && String(previous?.activeLibraryId || '').trim() === String(payload?.activeLibraryId || '').trim()
        && normalizeTemplateLibraryRelativePath(String(previous?.relativePath || '')) === normalizeTemplateLibraryRelativePath(String(payload?.relativePath || ''))
    ) {
        payload = {
            ...payload,
            assets: Array.isArray(previous?.assets) ? previous.assets : payload.assets,
            tags: Array.isArray(previous?.tags) ? previous.tags : payload.tags
        };
    }

    if (overrides) {
        payload = {
            ...payload,
            ...overrides
        };
    }

    return payload;
}

export function collectTemplateLibraryMissingPreviewPaths(state: any): string[] {
    const paths: string[] = [];
    const assets = Array.isArray(state?.assets) ? state.assets : [];
    assets.forEach((item: any) => {
        const relativePath = String(item?.relativePath || '').trim();
        const thumbnailUrl = String(item?.thumbnailUrl || '').trim();
        const assetType = String(item?.assetType || '').toLowerCase();
        if (!relativePath || thumbnailUrl || assetType === 'text') {
            return;
        }
        paths.push(relativePath);
    });

    return Array.from(new Set(paths));
}

export function getTemplateLibraryErrorMessage(error: any, defaultMessage: string): string {
    if (error instanceof Error && error.message) {
        return error.message;
    }
    if (typeof error?.message === 'string' && error.message.trim()) {
        return error.message.trim();
    }
    if (typeof error === 'string' && error.trim()) {
        return error.trim();
    }
    return defaultMessage;
}

export function isTemplateLibrarySmartObjectLayer(layer: any): boolean {
    const numericKind = Number(layer?.kind);
    if (numericKind === 17) return true;
    const kind = String(layer?.kind || '').toLowerCase();
    return kind === 'smartobject' || kind.includes('smart');
}

export function hasTemplateLibraryVisibleBounds(bounds: any): boolean {
    if (!bounds) return false;
    const left = Number(bounds.left);
    const top = Number(bounds.top);
    const right = Number(bounds.right);
    const bottom = Number(bounds.bottom);
    return Number.isFinite(left)
        && Number.isFinite(top)
        && Number.isFinite(right)
        && Number.isFinite(bottom)
        && right > left
        && bottom > top;
}

export function getTemplateLibraryLayerBounds(layer: any): any {
    if (isTemplateLibrarySmartObjectLayer(layer)) {
        return layer?.bounds || layer?.boundsNoEffects;
    }
    return layer?.boundsNoEffects || layer?.bounds;
}

export function templateLibraryUint8ArrayToBase64(
    data: Uint8Array,
    maxBytes = TEMPLATE_LIBRARY_MAX_BINARY_EXPORT_BYTES
): string {
    if (data.length > maxBytes) {
        const actualMb = (data.length / 1024 / 1024).toFixed(1);
        const maxMb = (maxBytes / 1024 / 1024).toFixed(1);
        throw new Error(`Design library asset is too large to import directly (${actualMb}MB > ${maxMb}MB).`);
    }
    const chunkSize = 32768;
    const chunks: string[] = [];
    for (let index = 0; index < data.length; index += chunkSize) {
        const chunk = data.subarray(index, Math.min(index + chunkSize, data.length));
        chunks.push(String.fromCharCode.apply(null, chunk as any));
    }
    return btoa(chunks.join(''));
}
