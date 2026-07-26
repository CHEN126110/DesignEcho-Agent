import { TemplateKnowledgeService } from '../services/template-knowledge.service';
import ResourceManagerService from '../services/resource-manager-service';
import type { UXPContext } from './types';

const resourcePreviewService = new ResourceManagerService();

function buildTemplateLibraryState(
    activeLibraryId?: string,
    relativePath = '',
    options?: { includeGrouped?: boolean }
) {
    const includeGrouped = options?.includeGrouped !== false;
    const settings = TemplateKnowledgeService.getResolverSettings();
    const currentLibraryId = activeLibraryId || settings.activeLibraryId || settings.libraries[0]?.id;
    const catalogContents = currentLibraryId
        ? TemplateKnowledgeService.getLibraryCatalogContents(currentLibraryId)
        : { library: null, assets: [], tags: [] };

    return {
        success: true,
        detailReady: includeGrouped,
        settings,
        libraries: settings.libraries,
        activeLibraryId: currentLibraryId,
        relativePath: '',
        breadcrumbs: [],
        entries: [],
        assets: catalogContents.assets,
        tags: catalogContents.tags,
        templates: [],
        storageInfo: TemplateKnowledgeService.getStorageInfo()
    };
}

function buildTemplateLibrarySummaryState(activeLibraryId?: string, relativePath = '') {
    void relativePath;
    return buildTemplateLibraryFastState(activeLibraryId);
}

function buildTemplateLibraryFastState(activeLibraryId?: string) {
    const settings = TemplateKnowledgeService.getResolverSettings();
    const currentLibraryId = activeLibraryId || settings.activeLibraryId || settings.libraries[0]?.id;
    return {
        success: true,
        detailReady: false,
        settings,
        libraries: settings.libraries,
        activeLibraryId: currentLibraryId,
        relativePath: '',
        breadcrumbs: [],
        entries: [],
        assets: [],
        tags: [],
        templates: [],
        storageInfo: TemplateKnowledgeService.getStorageInfo()
    };
}

function buildTemplateLibraryResponse(
    activeLibraryId?: string,
    relativePath = '',
    extras?: Record<string, unknown>,
    options?: { includeGrouped?: boolean }
) {
    const includeGrouped = options?.includeGrouped !== false;
    const baseState = includeGrouped
        ? buildTemplateLibraryState(activeLibraryId, relativePath, { includeGrouped: true })
        : buildTemplateLibrarySummaryState(activeLibraryId, relativePath);
    return {
        ...baseState,
        ...(extras || {})
    };
}

function resolveLibraryId(params: any): string {
    return String(params?.libraryId || '').trim() || TemplateKnowledgeService.getActiveLibrary()?.id || '';
}

function resolveIncludeGrouped(params: any, fallback = true): boolean {
    if (typeof params?.includeGrouped === 'boolean') {
        return params.includeGrouped;
    }
    const detailLevel = String(params?.detailLevel || '').trim().toLowerCase();
    if (detailLevel === 'summary' || detailLevel === 'light') {
        return false;
    }
    if (detailLevel === 'full' || detailLevel === 'detail') {
        return true;
    }
    return fallback;
}

function normalizeLibraryRelativePath(input: string): string {
    return String(input || '')
        .replace(/[\\/]+/g, '/')
        .split('/')
        .map((segment) => segment.trim())
        .filter((segment) => segment && segment !== '.' && segment !== '..')
        .join('/');
}

function parentLibraryRelativePath(input: string): string {
    const normalized = normalizeLibraryRelativePath(input);
    if (!normalized) {
        return '';
    }
    const parts = normalized.split('/').filter(Boolean);
    parts.pop();
    return parts.join('/');
}

export function registerTemplateLibraryHandlers(context: UXPContext): void {
    const { wsServer, logService } = context;

    wsServer.registerHandler('template-library:getState', async (params: any) => {
        return buildTemplateLibrarySummaryState(
            typeof params?.libraryId === 'string' ? params.libraryId : undefined,
            typeof params?.relativePath === 'string' ? params.relativePath : ''
        );
    });

    wsServer.registerHandler('template-library:createLibrary', async (params: any) => {
        const name = String(params?.name || '').trim();
        if (!name) {
            throw new Error('Missing design library name');
        }

        const dir = String(params?.dir || '').trim() || undefined;
        const dirToken = String(params?.dirToken || '').trim() || undefined;
        const { library } = TemplateKnowledgeService.createLibrary(name, dir, dirToken);
        logService?.logAgent('info', `[DesignLibrary] Created library: ${library.name}`);
        return buildTemplateLibraryFastState(library.id);
    });

    wsServer.registerHandler('template-library:setActiveLibrary', async (params: any) => {
        const id = String(params?.id || '').trim();
        if (!id) {
            throw new Error('Missing design library ID');
        }
        TemplateKnowledgeService.setActiveLibrary(id);
        return buildTemplateLibrarySummaryState(id);
    });

    wsServer.registerHandler('template-library:browse', async (params: any) => {
        const libraryId = resolveLibraryId(params);
        if (!libraryId) {
            throw new Error('Please create or select a design library first');
        }
        return buildTemplateLibraryState(libraryId, String(params?.relativePath || ''));
    });

    wsServer.registerHandler('template-library:addLocalLibraryDir', async (params: any) => {
        const libraryId = String(params?.libraryId || '').trim();
        const requestedDir = String(params?.dir || '').trim();
        const dirToken = String(params?.dirToken || '').trim();

        if (!libraryId) {
            throw new Error('Please create or select a design library first');
        }
        if (!requestedDir) {
            return {
                ...buildTemplateLibrarySummaryState(libraryId),
                cancelled: true,
                success: false
            };
        }

        const { library } = TemplateKnowledgeService.updateLibrary(libraryId, {
            dirPath: requestedDir,
            dirToken: dirToken || undefined
        });
        logService?.logAgent('info', `[DesignLibrary] Set dir: ${library.name}`);
        return buildTemplateLibrarySummaryState(library.id);
    });

    wsServer.registerHandler('template-library:removeLibrary', async (params: any) => {
        const id = String(params?.id || '').trim();
        if (!id) {
            throw new Error('Missing design library ID');
        }

        const settings = TemplateKnowledgeService.removeLibrary(id);
        logService?.logAgent('info', `[DesignLibrary] Removed library: ${id}`);
        return buildTemplateLibrarySummaryState(settings.activeLibraryId);
    });

    wsServer.registerHandler('template-library:addFromPhotoshop', async (params: any) => {
        const libraryId = resolveLibraryId(params);
        if (!libraryId) {
            throw new Error('Please create or select a design library first');
        }

        const saved = await TemplateKnowledgeService.addFromPhotoshop({
            documentName: String(params?.documentName || '').trim(),
            documentPath: typeof params?.documentPath === 'string' ? params.documentPath : undefined,
            currentProjectPath: typeof params?.currentProjectPath === 'string' ? params.currentProjectPath : undefined,
            type: 'other',
            libraryId,
            description: typeof params?.description === 'string' ? params.description : undefined,
            tags: Array.isArray(params?.tags) ? params.tags : undefined,
            metadata: params?.metadata && typeof params.metadata === 'object' ? params.metadata : undefined
        });

        logService?.logAgent('info', `[DesignLibrary] Saved current document: ${saved.name}`);
        const includeGrouped = resolveIncludeGrouped(params, true);
        return buildTemplateLibraryResponse(libraryId, '', {
            template: saved,
            success: true
        }, { includeGrouped });
    });

    wsServer.registerHandler('template-library:importFiles', async (params: any) => {
        const libraryId = resolveLibraryId(params);
        const filePaths = Array.isArray(params?.filePaths) ? params.filePaths : [];
        const fileMetas = Array.isArray(params?.fileMetas) ? params.fileMetas : [];
        const relativePath = String(params?.relativePath || '').trim();

        if (!libraryId) {
            throw new Error('Please create or select a design library first');
        }
        if (filePaths.length === 0) {
            throw new Error('No files to import');
        }

        const displayNames = filePaths.map((filePath: any, index: number) => {
            const meta = fileMetas.find((item: any) => String(item?.filePath || '').trim() === String(filePath || '').trim())
                || fileMetas[index]
                || null;
            return String(meta?.displayName || meta?.name || '').trim();
        });
        const imported = TemplateKnowledgeService.importFilesToLibrary(libraryId, filePaths, relativePath, {
            displayNames
        });
        if (imported.length === 0) {
            throw new Error('No supported design assets were imported');
        }

        logService?.logAgent('info', `[DesignLibrary] Imported files: ${imported.length}`);
        const includeGrouped = resolveIncludeGrouped(params, true);
        return buildTemplateLibraryResponse(libraryId, relativePath, {
            imported,
            success: true
        }, { includeGrouped });
    });

    wsServer.registerHandler('template-library:renameAsset', async (params: any) => {
        const libraryId = resolveLibraryId(params);
        const relativePath = String(params?.relativePath || '').trim();
        const name = String(params?.name || '').trim();

        if (!libraryId || !relativePath) {
            throw new Error('Missing asset rename parameters');
        }
        if (!name) {
            throw new Error('Missing asset name');
        }

        const updatedAsset = TemplateKnowledgeService.renameLibraryAsset(libraryId, relativePath, name);
        return buildTemplateLibraryResponse(
            libraryId,
            '',
            { updatedAsset },
            { includeGrouped: true }
        );
    });

    wsServer.registerHandler('template-library:importTextAsset', async (params: any) => {
        const libraryId = resolveLibraryId(params);
        const name = String(params?.name || '').trim();
        const content = typeof params?.content === 'string' ? params.content : '';
        const relativePath = String(params?.relativePath || '').trim();

        if (!libraryId) {
            throw new Error('Please create or select a design library first');
        }
        if (!name) {
            throw new Error('Missing text asset name');
        }
        if (!content.trim()) {
            throw new Error('Text asset content is empty');
        }

        const imported = TemplateKnowledgeService.importTextAssetToLibrary(libraryId, name, content, relativePath);
        logService?.logAgent('info', `[DesignLibrary] Imported text asset: ${imported.relativePath}`);
        const includeGrouped = resolveIncludeGrouped(params, true);
        return buildTemplateLibraryResponse(libraryId, relativePath, {
            imported,
            success: true
        }, { includeGrouped });
    });

    wsServer.registerHandler('template-library:importBinaryAsset', async (params: any) => {
        const libraryId = resolveLibraryId(params);
        const name = String(params?.name || '').trim();
        const base64Data = typeof params?.base64Data === 'string' ? params.base64Data : '';
        const extension = String(params?.extension || '').trim();
        const relativePath = String(params?.relativePath || '').trim();

        if (!libraryId) {
            throw new Error('Please create or select a design library first');
        }
        if (!name) {
            throw new Error('Missing asset name');
        }
        if (!base64Data) {
            throw new Error('Missing asset data');
        }
        if (!extension) {
            throw new Error('Missing asset format');
        }

        const imported = TemplateKnowledgeService.importBinaryAssetToLibrary(
            libraryId,
            name,
            base64Data,
            extension,
            relativePath
        );
        logService?.logAgent('info', `[DesignLibrary] Imported binary asset: ${imported.relativePath}`);
        const includeGrouped = resolveIncludeGrouped(params, true);
        return buildTemplateLibraryResponse(libraryId, relativePath, {
            imported,
            success: true
        }, { includeGrouped });
    });

    wsServer.registerHandler('template-library:readTextAsset', async (params: any) => {
        const libraryId = resolveLibraryId(params);
        const relativePath = String(params?.relativePath || '').trim();

        if (!libraryId) {
            throw new Error('Please create or select a design library first');
        }
        if (!relativePath) {
            throw new Error('Missing text asset path');
        }

        const result = TemplateKnowledgeService.readTextAsset(libraryId, relativePath);
        return {
            success: true,
            ...result
        };
    });

    wsServer.registerHandler('template-library:getAssetFileInfo', async (params: any) => {
        const libraryId = resolveLibraryId(params);
        const relativePath = String(params?.relativePath || '').trim();

        if (!libraryId) {
            throw new Error('Please create or select a design library first');
        }
        if (!relativePath) {
            throw new Error('Missing asset path');
        }

        const info = TemplateKnowledgeService.getLibraryAssetFileInfo(libraryId, relativePath);
        return {
            success: true,
            ...info
        };
    });

    wsServer.registerHandler('template-library:updateAssetTags', async (params: any) => {
        const libraryId = resolveLibraryId(params);
        const relativePath = String(params?.relativePath || '').trim();
        const tags = Array.isArray(params?.tags) ? params.tags : [];
        if (!libraryId || !relativePath) {
            throw new Error('Missing library asset tag parameters');
        }

        const updatedAsset = TemplateKnowledgeService.updateLibraryAssetTags(libraryId, relativePath, tags);
        return buildTemplateLibraryResponse(
            libraryId,
            '',
            { updatedAsset },
            { includeGrouped: true }
        );
    });

    wsServer.registerHandler('template-library:setThumbnail', async (params: any) => {
        const id = String(params?.id || '').trim();
        const thumbnailBase64 = String(params?.thumbnailBase64 || '').trim();
        if (!id || !thumbnailBase64) {
            throw new Error('Missing thumbnail parameters');
        }
        const updated = TemplateKnowledgeService.setThumbnail(id, thumbnailBase64);
        return {
            success: updated
        };
    });

    wsServer.registerHandler('template-library:setAssetPreview', async (params: any) => {
        const libraryId = resolveLibraryId(params);
        const relativePath = String(params?.relativePath || '').trim();
        const previewBase64 = String(params?.previewBase64 || '').trim();
        if (!libraryId || !relativePath || !previewBase64) {
            throw new Error('Missing asset preview parameters');
        }

        const updated = TemplateKnowledgeService.setLibraryAssetPreview(libraryId, relativePath, previewBase64);
        const includeGrouped = resolveIncludeGrouped(params, true);
        return buildTemplateLibraryResponse(
            libraryId,
            String(params?.currentRelativePath || '').trim(),
            { success: updated },
            { includeGrouped }
        );
    });

    wsServer.registerHandler('template-library:ensureAssetPreviews', async (params: any) => {
        const libraryId = resolveLibraryId(params);
        if (!libraryId) {
            throw new Error('Please create or select a design library first');
        }

        const maxSizeRaw = Number(params?.maxSize || 420);
        const maxSize = Number.isFinite(maxSizeRaw)
            ? Math.max(160, Math.min(1024, Math.floor(maxSizeRaw)))
            : 420;
        const relativePath = String(params?.currentRelativePath || params?.relativePath || '').trim();
        const requestedPaths = Array.isArray(params?.relativePaths) ? params.relativePaths : [];
        const cleanedPaths = requestedPaths
            .map((item: any) => String(item || '').trim())
            .filter((item: string) => item.length > 0);
        const uniquePaths: string[] = Array.from(new Set<string>(cleanedPaths));

        let generated = 0;
        let skipped = 0;
        let failed = 0;
        const PREVIEW_PARALLELISM = 3;
        for (let i = 0; i < uniquePaths.length; i += PREVIEW_PARALLELISM) {
            const batch = uniquePaths.slice(i, i + PREVIEW_PARALLELISM);
            const batchResults = await Promise.all(batch.map(async (assetRelativePath) => {
                try {
                    const assetInfo = TemplateKnowledgeService.getLibraryAssetFileInfo(libraryId, assetRelativePath);
                    if (assetInfo.assetType === 'text') {
                        return 'skipped' as const;
                    }

                    const previewResult = await resourcePreviewService.getImagePreview(assetInfo.filePath, maxSize);
                    const previewBase64 = String(previewResult?.imageData || previewResult?.base64 || '').trim();
                    if (!previewResult?.success || !previewBase64) {
                        return 'failed' as const;
                    }

                    const updated = TemplateKnowledgeService.setLibraryAssetPreview(
                        libraryId,
                        assetRelativePath,
                        `data:image/jpeg;base64,${previewBase64}`
                    );
                    return updated ? ('generated' as const) : ('failed' as const);
                } catch {
                    return 'failed' as const;
                }
            }));

            for (const status of batchResults) {
                if (status === 'generated') {
                    generated += 1;
                } else if (status === 'skipped') {
                    skipped += 1;
                } else {
                    failed += 1;
                }
            }
        }

        const includeGrouped = resolveIncludeGrouped(params, true);
        return buildTemplateLibraryResponse(
            libraryId,
            relativePath,
            {
                success: true,
                previewSync: {
                    requested: uniquePaths.length,
                    generated,
                    skipped,
                    failed
                }
            },
            { includeGrouped }
        );
    });

    wsServer.registerHandler('template-library:undoDelete', async (params: any) => {
        const libraryId = resolveLibraryId(params);
        const relativePath = String(params?.relativePath || '').trim();
        const restored = TemplateKnowledgeService.restoreLastDeletedEntry();
        const includeGrouped = resolveIncludeGrouped(params, true);
        return buildTemplateLibraryResponse(libraryId || undefined, relativePath, {
            restored,
            success: restored
        }, { includeGrouped });
    });

    wsServer.registerHandler('template-library:deleteTemplate', async (params: any) => {
        const id = String(params?.id || '').trim();
        const libraryId = resolveLibraryId(params);
        const relativePath = String(params?.relativePath || '').trim();

        if (libraryId && relativePath) {
            const normalizedRelativePath = normalizeLibraryRelativePath(relativePath);
            const normalizedCurrentPath = normalizeLibraryRelativePath(String(params?.currentRelativePath || ''));
            const browseRelativePath = normalizedCurrentPath && normalizedCurrentPath !== normalizedRelativePath
                ? normalizedCurrentPath
                : parentLibraryRelativePath(normalizedRelativePath);
            const deleted = TemplateKnowledgeService.deleteLibraryEntryWithUndo(libraryId, relativePath);
            const includeGrouped = resolveIncludeGrouped(params, true);
            return buildTemplateLibraryResponse(
                libraryId,
                browseRelativePath,
                {
                    deleted,
                    success: deleted,
                    undoAvailable: deleted
                },
                { includeGrouped }
            );
        }

        if (id) {
            const template = TemplateKnowledgeService.getById(id);
            const deleted = TemplateKnowledgeService.deleteTemplateWithUndo(id);
            const includeGrouped = resolveIncludeGrouped(params, true);
            return buildTemplateLibraryResponse(template?.libraryId, '', {
                deleted,
                success: deleted,
                undoAvailable: deleted
            }, { includeGrouped });
        }

        throw new Error('Missing asset information for deletion');
    });
}
