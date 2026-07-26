import { createHash } from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import sharp from 'sharp';

import {
    reconcileEagleActiveLibrary,
    type EagleActiveLibraryDiskSelection,
    type EagleActiveLibraryHandshake,
    type EagleActiveLibraryLiveSignal
} from '../../shared/eagle-active-library';
import {
    EAGLE_LIBRARY_CONTRACT_VERSION,
    classifyEagleLibraryAsset,
    resolveEagleLibraryFileKind,
    type EagleLibraryAssetRole,
    type EagleLibraryDominantColor,
    type EagleLibraryFacetCounts,
    type EagleLibraryFileKind,
    type EagleLibraryFolderNode,
    type EagleLibraryInfo,
    type EagleLibraryItem,
    type EagleLibraryOpenResponse,
    type EagleLibraryPaletteColor,
    type EagleLibraryPreviewRequest,
    type EagleLibraryPreviewResponse,
    type EagleLibraryQueryRequest,
    type EagleLibraryQueryResponse,
    type EagleLibraryRoleCounts,
    type EagleLibraryShape,
    type EagleLibrarySortBy,
    type EagleLibrarySortDirection,
    type EagleLibraryTagSummary
} from '../../shared/eagle-library';

interface EagleRawFolder {
    id?: unknown;
    name?: unknown;
    description?: unknown;
    iconColor?: unknown;
    children?: unknown;
}

interface EagleRawLibraryMetadata {
    folders?: unknown;
    smartFolders?: unknown;
    applicationVersion?: unknown;
}

interface EagleRawItemMetadata {
    id?: unknown;
    name?: unknown;
    ext?: unknown;
    size?: unknown;
    width?: unknown;
    height?: unknown;
    btime?: unknown;
    mtime?: unknown;
    modificationTime?: unknown;
    lastModified?: unknown;
    folders?: unknown;
    tags?: unknown;
    annotation?: unknown;
    url?: unknown;
    palettes?: unknown;
    star?: unknown;
    isDeleted?: unknown;
}

interface FolderDescriptor {
    id: string;
    name: string;
    description: string;
    iconColor?: string;
    fullPath: string;
    childIds: string[];
    children: FolderDescriptor[];
}

interface IndexedEagleItem extends EagleLibraryItem {
    previewPath?: string;
    searchableText: string;
}

interface EagleLibraryIndex {
    canonicalPath: string;
    revisionSource: string;
    library: EagleLibraryInfo;
    items: IndexedEagleItem[];
    itemById: Map<string, IndexedEagleItem>;
    folderDescendants: Map<string, Set<string>>;
}

interface CachedLibraryIndex {
    revisionSource: string;
    index: EagleLibraryIndex;
}

const INDEX_CONCURRENCY = 24;
const DEFAULT_PAGE_SIZE = 48;
const MAX_PAGE_SIZE = 120;
const MAX_PREVIEW_CACHE_ENTRIES = 240;
const PREVIEWABLE_SOURCE_EXTENSIONS = new Set([
    'jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'avif', 'heic', 'svg', 'tif', 'tiff'
]);

/**
 * 主进程专用的素材源解析结果。携带真实本地路径，**禁止**回传渲染进程 / 模型。
 * 仅供「素材置入」「项目复制」等主进程能力从不透明 EagleAssetRef 反查真实文件。
 */
export interface EagleAssetSourceResolution {
    libraryId: string;
    libraryName: string;
    itemId: string;
    /** 仅主进程内部使用；不得进入 IPC 回包给渲染进程或模型。 */
    libraryPath: string;
    /** 仅主进程内部使用；不得进入 IPC 回包给渲染进程或模型。 */
    sourceFilePath: string;
    name: string;
    ext: string;
    fileKind: EagleLibraryFileKind;
}

/**
 * Agent 视觉观察结果：携带缩放后的图像数据与安全元数据，**不含任何本地路径**。
 * base64/format 字段与 getCanvasSnapshot 同形，会被 agent 循环的图像观察通道自动回传视觉模型。
 */
export interface EagleAssetObservationResult {
    success: boolean;
    status: 'ok' | 'library_not_opened' | 'not_found' | 'unsupported' | 'unavailable';
    itemId: string;
    name?: string;
    ext?: string;
    fileKind?: EagleLibraryFileKind;
    role?: EagleLibraryAssetRole;
    sourceWidth?: number;
    sourceHeight?: number;
    width?: number;
    height?: number;
    base64?: string;
    format?: string;
    /** 观察的是缩略图还是源文件（PSD 等设计源只有缩略图可看）。 */
    observedFrom?: 'thumbnail' | 'source';
    /** 观察能力的如实说明（如视频只能看封面帧）。 */
    note?: string;
    tags?: string[];
    annotation?: string;
    error?: string;
    boundaries: {
        readonly: true;
        entersAgentContext: true;
        localPathRedacted: true;
        doesNotWriteEagle: true;
        doesNotGrantPhotoshopExecution: true;
    };
}

export class EagleLibraryService {
    private readonly indexCache = new Map<string, CachedLibraryIndex>();
    private readonly previewCache = new Map<string, EagleLibraryPreviewResponse>();
    /** libraryId → canonical .library 路径。用于从不透明引用反查真实库位置（主进程内部）。 */
    private readonly libraryPathById = new Map<string, string>();

    async openLibrary(libraryPath: string, forceRefresh = false): Promise<EagleLibraryOpenResponse> {
        try {
            const index = await this.loadIndex(libraryPath, forceRefresh);
            return {
                success: true,
                status: 'ok',
                library: index.library,
                activeLibrary: this.buildDiskSelectionHandshake(index)
            };
        } catch (error) {
            return {
                success: false,
                status: isInvalidLibraryError(error) ? 'invalid_library' : 'unavailable',
                error: formatPublicError(error)
            };
        }
    }

    /**
     * 从不透明 EagleAssetRef（libraryId + itemId）反查真实源文件路径。
     * 仅主进程调用；返回值含本地路径，绝不回传渲染进程 / 模型。
     * libraryId 未在本会话打开过（注册表无记录）时返回 null，而不是猜测路径。
     */
    async resolveAssetSource(ref: { libraryId?: unknown; itemId?: unknown }): Promise<EagleAssetSourceResolution | null> {
        const libraryId = cleanText(ref?.libraryId, 160);
        const itemId = cleanText(ref?.itemId, 180);
        if (!libraryId || !itemId) return null;
        const canonicalPath = this.libraryPathById.get(libraryId);
        if (!canonicalPath) return null;
        const index = await this.loadIndex(canonicalPath, false).catch(() => null);
        const item = index?.itemById.get(itemId);
        if (!index || !item) return null;
        return {
            libraryId,
            libraryName: index.library.name,
            itemId,
            libraryPath: canonicalPath,
            sourceFilePath: item.sourceFilePath,
            name: item.name,
            ext: item.ext,
            fileKind: item.fileKind
        };
    }

    /**
     * Agent 真实视觉观察：把 Eagle 素材（源图或缩略图）缩放后作为图像观察返回。
     * 结果不含任何本地路径；base64/format 与画布快照同形，自动进入循环的视觉观察通道。
     */
    async observeAssetForAgent(input: {
        libraryId?: unknown;
        itemId?: unknown;
        maxSize?: unknown;
    }): Promise<EagleAssetObservationResult> {
        const boundaries = buildObservationBoundaries();
        const libraryId = cleanText(input?.libraryId, 160);
        const itemId = cleanText(input?.itemId, 180);
        if (!libraryId || !itemId) {
            return {
                success: false,
                status: 'not_found',
                itemId,
                error: '观察 Eagle 素材需要 assetRef（libraryId:itemId）。请使用情境快照或检索结果给出的引用。',
                boundaries
            };
        }
        const canonicalPath = this.libraryPathById.get(libraryId);
        if (!canonicalPath) {
            return {
                success: false,
                status: 'library_not_opened',
                itemId,
                error: '这个 Eagle 素材库尚未在本次会话打开：请先在「Eagle 素材库」页打开对应 .library，再重试观察。',
                boundaries
            };
        }
        try {
            const index = await this.loadIndex(canonicalPath, false);
            const item = index.itemById.get(itemId);
            if (!item) {
                return {
                    success: false,
                    status: 'not_found',
                    itemId,
                    error: '没有在该素材库中找到这个 Eagle 素材（可能已被删除或库已变化）。',
                    boundaries
                };
            }
            if (!item.previewPath) {
                return {
                    success: false,
                    status: 'unsupported',
                    itemId,
                    name: item.name,
                    ext: item.ext,
                    fileKind: item.fileKind,
                    role: item.role,
                    error: `当前 ${item.ext.toUpperCase() || '文件'} 没有可观察的图像（无缩略图且源格式不可直接解码）。`,
                    boundaries
                };
            }
            const maxSize = clampInteger(input?.maxSize, 256, 1600, 1024);
            const output = await sharp(item.previewPath, {
                failOnError: false,
                animated: false,
                limitInputPixels: 120_000_000
            })
                .rotate()
                .resize(maxSize, maxSize, { fit: 'inside', withoutEnlargement: true })
                .webp({ quality: 82, effort: 3 })
                .toBuffer({ resolveWithObject: true });
            return {
                success: true,
                status: 'ok',
                itemId,
                name: item.name,
                ext: item.ext,
                fileKind: item.fileKind,
                role: item.role,
                ...(item.width ? { sourceWidth: item.width } : {}),
                ...(item.height ? { sourceHeight: item.height } : {}),
                width: output.info.width,
                height: output.info.height,
                base64: output.data.toString('base64'),
                format: 'image/webp',
                observedFrom: item.previewSource === 'thumbnail' ? 'thumbnail' : 'source',
                ...(item.fileKind === 'video'
                    ? { note: '视频素材：本次观察的是封面帧（Eagle 缩略图），不代表逐帧内容；逐帧关键帧提取当前未内置。' }
                    : {}),
                tags: item.tags.slice(0, 30),
                ...(item.annotation ? { annotation: item.annotation } : {}),
                boundaries
            };
        } catch (error) {
            return {
                success: false,
                status: 'unavailable',
                itemId,
                error: formatPublicError(error, 'Eagle 素材观察失败。'),
                boundaries
            };
        }
    }

    /**
     * 活动库握手：把可选的实时 Eagle 信号与磁盘选择对账为单一诚实结果。
     * libraryId 用与索引一致的哈希算法补全，保证引用体系对齐。
     */
    reconcileActiveLibrary(input: {
        live?: EagleActiveLibraryLiveSignal;
        disk?: EagleActiveLibraryDiskSelection;
        now?: string;
    }): EagleActiveLibraryHandshake {
        return reconcileEagleActiveLibrary({
            ...(input.live ? { live: input.live } : {}),
            ...(input.disk ? { disk: input.disk } : {}),
            resolveLibraryId: (libraryPath) => computeEagleLibraryId(libraryPath),
            ...(input.now ? { now: input.now } : {})
        });
    }

    private buildDiskSelectionHandshake(index: EagleLibraryIndex): EagleActiveLibraryHandshake {
        return reconcileEagleActiveLibrary({
            disk: {
                libraryId: index.library.libraryId,
                libraryName: index.library.name,
                libraryPath: index.canonicalPath
            }
        });
    }

    async queryLibrary(request: EagleLibraryQueryRequest): Promise<EagleLibraryQueryResponse> {
        try {
            const index = await this.loadIndex(request.libraryPath, false);
            const offset = clampInteger(request.offset, 0, Number.MAX_SAFE_INTEGER, 0);
            const limit = clampInteger(request.limit, 1, MAX_PAGE_SIZE, DEFAULT_PAGE_SIZE);
            const includeDeleted = request.includeDeleted === true;
            const folderIds = resolveFolderFilterIds(index, request.folderId, request.includeDescendants !== false);
            const role = normalizeRoleFilter(request.role);
            const fileKind = normalizeFileKindFilter(request.fileKind);
            const extension = normalizeExtensionFilter(request.extension);
            const shape = normalizeShapeFilter(request.shape);
            const minimumRating = clampInteger(request.minimumRating, 0, 5, 0);
            const dominantColor = normalizeDominantColorFilter(request.dominantColor);
            const includeTags = normalizeTagFilterSet(request.includeTags, request.tag);
            const excludeTags = normalizeTagFilterSet(request.excludeTags);
            const terms = normalizeSearchTerms(request.query);
            const sortBy = normalizeSortBy(request.sortBy);
            const sortDirection = normalizeSortDirection(request.sortDirection, sortBy);
            const randomKey = Number.isFinite(Number(request.randomSeed))
                ? String(Math.trunc(Number(request.randomSeed)))
                : index.library.revision;

            const filtered = index.items.filter((item) => {
                if (!includeDeleted && item.isDeleted) return false;
                if (request.deletedOnly === true && !item.isDeleted) return false;
                if (request.unclassifiedOnly === true && item.folderIds.length > 0) return false;
                if (request.untaggedOnly === true && item.tags.length > 0) return false;
                if (folderIds && !item.folderIds.some((folderId) => folderIds.has(folderId))) return false;
                if (includeTags.size > 0 && !itemHasAllTags(item, includeTags)) return false;
                if (excludeTags.size > 0 && itemHasAnyTag(item, excludeTags)) return false;
                if (role && item.role !== role) return false;
                if (fileKind && item.fileKind !== fileKind) return false;
                if (extension && item.ext !== extension) return false;
                if (shape && !matchesShape(item, shape)) return false;
                if (minimumRating > 0 && (item.rating || 0) < minimumRating) return false;
                if (dominantColor && !matchesDominantColor(item, dominantColor)) return false;
                return terms.every((term) => item.searchableText.includes(term));
            });
            filtered.sort((left, right) => compareItems(left, right, sortBy, sortDirection, randomKey));

            return {
                success: true,
                status: 'ok',
                total: filtered.length,
                offset,
                limit,
                items: filtered.slice(offset, offset + limit).map(stripPrivateIndexFields),
                facets: buildFacetCounts(filtered),
                revision: index.library.revision
            };
        } catch (error) {
            return {
                success: false,
                status: isInvalidLibraryError(error) ? 'invalid_library' : 'unavailable',
                total: 0,
                offset: 0,
                limit: clampInteger(request.limit, 1, MAX_PAGE_SIZE, DEFAULT_PAGE_SIZE),
                items: [],
                error: formatPublicError(error)
            };
        }
    }

    async getPreview(request: EagleLibraryPreviewRequest): Promise<EagleLibraryPreviewResponse> {
        const boundaries = buildPreviewBoundaries();
        const itemId = cleanText(request.itemId, 180);
        if (request.purpose !== 'eagle_library_ui') {
            return {
                success: false,
                status: 'unavailable',
                itemId,
                error: 'Eagle 素材预览只允许由素材库页面按需请求。',
                boundaries
            };
        }

        try {
            const index = await this.loadIndex(request.libraryPath, false);
            const item = index.itemById.get(itemId);
            if (!item) {
                return {
                    success: false,
                    status: 'not_found',
                    itemId,
                    error: '没有找到这个 Eagle 素材。',
                    boundaries
                };
            }
            if (!item.previewPath) {
                return {
                    success: false,
                    status: 'unsupported',
                    itemId,
                    error: `当前 ${item.ext.toUpperCase() || '文件'} 没有可用缩略图。`,
                    boundaries
                };
            }

            const maxSize = clampInteger(request.maxSize, 96, 1600, 420);
            const cacheKey = `${index.library.revision}:${item.id}:${item.previewSource}:${maxSize}`;
            const cached = this.previewCache.get(cacheKey);
            if (cached) return cached;

            const output = await sharp(item.previewPath, {
                failOnError: false,
                animated: false,
                limitInputPixels: 120_000_000
            })
                .rotate()
                .resize(maxSize, maxSize, { fit: 'inside', withoutEnlargement: true })
                .webp({ quality: maxSize > 700 ? 86 : 78, effort: 3 })
                .toBuffer({ resolveWithObject: true });
            const response: EagleLibraryPreviewResponse = {
                success: true,
                status: 'ok',
                itemId,
                dataUrl: `data:image/webp;base64,${output.data.toString('base64')}`,
                width: output.info.width,
                height: output.info.height,
                boundaries
            };
            rememberPreview(this.previewCache, cacheKey, response);
            return response;
        } catch (error) {
            return {
                success: false,
                status: 'unavailable',
                itemId,
                error: formatPublicError(error, 'Eagle 素材预览失败。'),
                boundaries
            };
        }
    }

    private async loadIndex(libraryPath: string, forceRefresh: boolean): Promise<EagleLibraryIndex> {
        const canonicalPath = await validateLibraryPath(libraryPath);
        const revisionSource = await readLibraryRevisionSource(canonicalPath);
        const cached = this.indexCache.get(canonicalPath);
        if (!forceRefresh && cached?.revisionSource === revisionSource) {
            this.libraryPathById.set(cached.index.library.libraryId, canonicalPath);
            return cached.index;
        }

        const index = await buildLibraryIndex(canonicalPath, revisionSource);
        this.indexCache.set(canonicalPath, { revisionSource, index });
        this.libraryPathById.set(index.library.libraryId, canonicalPath);
        return index;
    }
}

/**
 * 稳定库标识：canonical path 小写后取 sha256 前 20 位。
 * 单向哈希，不可反推路径；索引与活动库握手共用同一算法，保证引用体系一致。
 */
export function computeEagleLibraryId(canonicalPath: string): string {
    return createHash('sha256').update(String(canonicalPath || '').toLowerCase()).digest('hex').slice(0, 20);
}

async function validateLibraryPath(value: unknown): Promise<string> {
    const requestedPath = String(value || '').trim();
    if (!requestedPath) throw new Error('invalid_eagle_library:请选择一个 .library 素材库目录。');
    const canonicalPath = await fs.realpath(path.resolve(requestedPath));
    if (!path.basename(canonicalPath).toLowerCase().endsWith('.library')) {
        throw new Error('invalid_eagle_library:所选目录不是 Eagle .library 素材库。');
    }
    const rootMetadataPath = path.join(canonicalPath, 'metadata.json');
    const imagesPath = path.join(canonicalPath, 'images');
    const [rootMetadataStat, imagesStat] = await Promise.all([
        fs.stat(rootMetadataPath),
        fs.stat(imagesPath)
    ]);
    if (!rootMetadataStat.isFile() || !imagesStat.isDirectory()) {
        throw new Error('invalid_eagle_library:素材库缺少 metadata.json 或 images 目录。');
    }
    return canonicalPath;
}

async function readLibraryRevisionSource(canonicalPath: string): Promise<string> {
    const candidates = ['metadata.json', 'mtime.json', 'tags.json'];
    const stats = await Promise.all(candidates.map(async (name) => {
        const target = path.join(canonicalPath, name);
        try {
            const stat = await fs.stat(target);
            return `${name}:${stat.size}:${Math.round(stat.mtimeMs)}`;
        } catch {
            return `${name}:missing`;
        }
    }));
    return stats.join('|');
}

async function buildLibraryIndex(
    canonicalPath: string,
    revisionSource: string
): Promise<EagleLibraryIndex> {
    const rootMetadataPath = path.join(canonicalPath, 'metadata.json');
    const rawMetadata = parseJsonObject<EagleRawLibraryMetadata>(await fs.readFile(rootMetadataPath, 'utf8'));
    const folderById = new Map<string, FolderDescriptor>();
    const folderRoots = buildFolderDescriptors(rawMetadata.folders, '', folderById);
    const imagesPath = path.join(canonicalPath, 'images');
    const imageEntries = (await fs.readdir(imagesPath, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory() && entry.name.toLowerCase().endsWith('.info'));
    const itemResults = await mapWithConcurrency(imageEntries, INDEX_CONCURRENCY, async (entry) => (
        readIndexedItem(canonicalPath, path.join(imagesPath, entry.name), folderById)
    ));
    const items = itemResults.filter((item): item is IndexedEagleItem => Boolean(item));
    const itemById = new Map(items.map((item) => [item.id, item]));
    const directFolderCounts = countDirectFolderItems(items);
    const publicFolders = buildPublicFolderTree(folderRoots, directFolderCounts);
    const activeItems = items.filter((item) => !item.isDeleted);
    const tags = buildTagSummaries(activeItems);
    const libraryId = computeEagleLibraryId(canonicalPath);
    for (const item of items) item.libraryId = libraryId;
    const revision = createHash('sha256')
        .update(`${canonicalPath}\n${revisionSource}\n${items.length}`)
        .digest('hex')
        .slice(0, 24);
    const roleCounts = countRoles(activeItems);
    const extensionCounts = countExtensions(activeItems);
    const library: EagleLibraryInfo = {
        contractVersion: EAGLE_LIBRARY_CONTRACT_VERSION,
        libraryId,
        name: path.basename(canonicalPath).replace(/\.library$/i, ''),
        path: canonicalPath,
        ...(cleanText(rawMetadata.applicationVersion, 80)
            ? { applicationVersion: cleanText(rawMetadata.applicationVersion, 80) }
            : {}),
        itemCount: items.length,
        activeItemCount: activeItems.length,
        unclassifiedCount: activeItems.filter((item) => item.folderIds.length === 0).length,
        untaggedCount: activeItems.filter((item) => item.tags.length === 0).length,
        deletedCount: items.filter((item) => item.isDeleted).length,
        folderCount: folderById.size,
        tagCount: tags.length,
        indexedAt: new Date().toISOString(),
        revision,
        folders: publicFolders,
        tags,
        roleCounts,
        extensionCounts,
        boundaries: {
            readonly: true,
            requiresEagleProcess: false,
            writesEagle: false,
            metadataIsNotVisualObservation: true,
            previewDoesNotGrantExecution: true
        }
    };
    return {
        canonicalPath,
        revisionSource,
        library,
        items,
        itemById,
        folderDescendants: buildFolderDescendants(folderRoots)
    };
}

function buildFolderDescriptors(
    value: unknown,
    parentPath: string,
    folderById: Map<string, FolderDescriptor>
): FolderDescriptor[] {
    if (!Array.isArray(value)) return [];
    const result: FolderDescriptor[] = [];
    for (const rawValue of value) {
        if (!rawValue || typeof rawValue !== 'object') continue;
        const raw = rawValue as EagleRawFolder;
        const id = cleanText(raw.id, 180);
        const name = cleanText(raw.name, 240);
        if (!id || !name || folderById.has(id)) continue;
        const fullPath = parentPath ? `${parentPath} / ${name}` : name;
        const descriptor: FolderDescriptor = {
            id,
            name,
            description: cleanText(raw.description, 500),
            ...(cleanText(raw.iconColor, 40) ? { iconColor: cleanText(raw.iconColor, 40) } : {}),
            fullPath,
            childIds: [],
            children: []
        };
        folderById.set(id, descriptor);
        descriptor.children = buildFolderDescriptors(raw.children, fullPath, folderById);
        descriptor.childIds = descriptor.children.map((child) => child.id);
        result.push(descriptor);
    }
    return result;
}

async function readIndexedItem(
    canonicalPath: string,
    itemDirectory: string,
    folderById: Map<string, FolderDescriptor>
): Promise<IndexedEagleItem | null> {
    const metadataPath = path.join(itemDirectory, 'metadata.json');
    try {
        const raw = parseJsonObject<EagleRawItemMetadata>(await fs.readFile(metadataPath, 'utf8'));
        const id = cleanText(raw.id, 180) || path.basename(itemDirectory).replace(/\.info$/i, '');
        const name = cleanText(raw.name, 240) || id;
        const ext = cleanText(raw.ext, 24).replace(/^\./, '').toLowerCase();
        const fileNames = await fs.readdir(itemDirectory);
        const sourceFileName = resolveSourceFileName(fileNames, name, ext);
        if (!sourceFileName) return null;
        const sourceFilePath = path.join(itemDirectory, sourceFileName);
        if (!isPathInside(canonicalPath, sourceFilePath)) return null;
        const thumbnailFileName = resolveThumbnailFileName(fileNames);
        const previewPath = thumbnailFileName
            ? path.join(itemDirectory, thumbnailFileName)
            : (PREVIEWABLE_SOURCE_EXTENSIONS.has(ext) ? sourceFilePath : undefined);
        const folderIds = normalizeStringList(raw.folders, 100).filter((folderId) => folderById.has(folderId));
        const folderPaths = folderIds.map((folderId) => folderById.get(folderId)?.fullPath || folderId);
        const tags = normalizeStringList(raw.tags, 100);
        const role = classifyEagleLibraryAsset({ ext, tags, folderPaths });
        const fileKind = resolveEagleLibraryFileKind(ext);
        const annotation = cleanText(raw.annotation, 800);
        const sourceUrl = cleanText(raw.url, 1000);
        const item: IndexedEagleItem = {
            id,
            libraryId: '',
            name,
            ext,
            fileKind,
            role,
            size: clampInteger(raw.size, 0, Number.MAX_SAFE_INTEGER, 0),
            rating: clampInteger(raw.star, 0, 5, 0),
            ...(positiveInteger(raw.width) ? { width: positiveInteger(raw.width) } : {}),
            ...(positiveInteger(raw.height) ? { height: positiveInteger(raw.height) } : {}),
            ...(normalizeEpochTime(raw.btime) ? { createdAt: normalizeEpochTime(raw.btime) } : {}),
            ...(normalizeEpochTime(raw.mtime || raw.modificationTime || raw.lastModified)
                ? { modifiedAt: normalizeEpochTime(raw.mtime || raw.modificationTime || raw.lastModified) }
                : {}),
            sourceFilePath,
            tags,
            folderIds,
            folderPaths,
            ...(annotation ? { annotation } : {}),
            ...(sourceUrl ? { sourceUrl } : {}),
            palettes: normalizePalettes(raw.palettes),
            isDeleted: raw.isDeleted === true,
            hasPreview: Boolean(previewPath),
            previewSource: thumbnailFileName ? 'thumbnail' : (previewPath ? 'source' : 'none'),
            ...(previewPath ? { previewPath } : {}),
            searchableText: [name, ext, annotation, ...tags, ...folderPaths]
                .join(' ')
                .toLowerCase()
        };
        return item;
    } catch {
        return null;
    }
}

function resolveSourceFileName(fileNames: string[], itemName: string, ext: string): string | undefined {
    const candidates = fileNames.filter((fileName) => {
        const lower = fileName.toLowerCase();
        return lower !== 'metadata.json' && !/(?:^|_)thumbnail\.[a-z0-9]+$/i.test(fileName);
    });
    const expected = `${itemName}.${ext}`.toLowerCase();
    const exact = candidates.find((fileName) => fileName.toLowerCase() === expected);
    if (exact) return exact;
    const extensionMatch = candidates.find((fileName) => path.extname(fileName).slice(1).toLowerCase() === ext);
    return extensionMatch || candidates[0];
}

function resolveThumbnailFileName(fileNames: string[]): string | undefined {
    return fileNames.find((fileName) => /(?:^|_)thumbnail\.(?:png|jpe?g|webp)$/i.test(fileName));
}

function buildPublicFolderTree(
    roots: FolderDescriptor[],
    directCounts: Map<string, number>
): EagleLibraryFolderNode[] {
    return roots.map((root) => buildPublicFolderNode(root, directCounts));
}

function buildPublicFolderNode(
    folder: FolderDescriptor,
    directCounts: Map<string, number>
): EagleLibraryFolderNode {
    const children = folder.children.map((child) => buildPublicFolderNode(child, directCounts));
    const itemCount = directCounts.get(folder.id) || 0;
    return {
        id: folder.id,
        name: folder.name,
        description: folder.description,
        ...(folder.iconColor ? { iconColor: folder.iconColor } : {}),
        itemCount,
        totalItemCount: itemCount + children.reduce((sum, child) => sum + child.totalItemCount, 0),
        children
    };
}

function countDirectFolderItems(items: IndexedEagleItem[]): Map<string, number> {
    const counts = new Map<string, number>();
    for (const item of items) {
        if (item.isDeleted) continue;
        for (const folderId of item.folderIds) counts.set(folderId, (counts.get(folderId) || 0) + 1);
    }
    return counts;
}

function buildFolderDescendants(roots: FolderDescriptor[]): Map<string, Set<string>> {
    const result = new Map<string, Set<string>>();
    function visit(folder: FolderDescriptor): Set<string> {
        const descendants = new Set<string>([folder.id]);
        for (const child of folder.children) {
            for (const childId of visit(child)) descendants.add(childId);
        }
        result.set(folder.id, descendants);
        return descendants;
    }
    for (const root of roots) visit(root);
    return result;
}

function buildTagSummaries(items: IndexedEagleItem[]): EagleLibraryTagSummary[] {
    const counts = new Map<string, number>();
    for (const item of items) {
        for (const tag of item.tags) counts.set(tag, (counts.get(tag) || 0) + 1);
    }
    return Array.from(counts.entries())
        .map(([name, count]) => ({ name, count }))
        .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name, 'zh-CN'));
}

/** 三态标签筛选集合：统一小写去空，单标签 `tag` 并入。 */
function normalizeTagFilterSet(value: unknown, extra?: unknown): Set<string> {
    const set = new Set<string>();
    const add = (raw: unknown): void => {
        const tag = cleanText(raw, 240).toLowerCase();
        if (tag) set.add(tag);
    };
    if (Array.isArray(value)) for (const item of value) add(item);
    if (extra !== undefined) add(extra);
    return set;
}

function itemHasAllTags(item: IndexedEagleItem, tags: Set<string>): boolean {
    const itemTags = new Set(item.tags.map((tag) => tag.toLowerCase()));
    for (const tag of tags) {
        if (!itemTags.has(tag)) return false;
    }
    return true;
}

function itemHasAnyTag(item: IndexedEagleItem, tags: Set<string>): boolean {
    return item.tags.some((tag) => tags.has(tag.toLowerCase()));
}

/** 基于当前筛选结果集（分页前）计算动态 facet 计数。 */
function buildFacetCounts(items: IndexedEagleItem[]): EagleLibraryFacetCounts {
    return {
        tags: buildTagSummaries(items).slice(0, 400),
        extensions: countExtensions(items)
    };
}

function countRoles(items: IndexedEagleItem[]): EagleLibraryRoleCounts {
    const counts: EagleLibraryRoleCounts = {
        reference: 0,
        main_image_template: 0,
        detail_page_template: 0,
        sku_template: 0,
        design_template: 0,
        asset: 0
    };
    for (const item of items) counts[item.role] += 1;
    return counts;
}

function countExtensions(items: IndexedEagleItem[]): Record<string, number> {
    const counts = new Map<string, number>();
    for (const item of items) counts.set(item.ext, (counts.get(item.ext) || 0) + 1);
    return Object.fromEntries(
        Array.from(counts.entries()).sort((left, right) => left[0].localeCompare(right[0]))
    );
}

function resolveFolderFilterIds(
    index: EagleLibraryIndex,
    folderIdValue: unknown,
    includeDescendants: boolean
): Set<string> | undefined {
    const folderId = cleanText(folderIdValue, 180);
    if (!folderId) return undefined;
    if (!includeDescendants) return new Set([folderId]);
    return index.folderDescendants.get(folderId) || new Set([folderId]);
}

function normalizeRoleFilter(value: unknown): EagleLibraryAssetRole | undefined {
    const roles: EagleLibraryAssetRole[] = [
        'reference', 'main_image_template', 'detail_page_template', 'sku_template', 'design_template', 'asset'
    ];
    return roles.includes(value as EagleLibraryAssetRole) ? value as EagleLibraryAssetRole : undefined;
}

function normalizeFileKindFilter(value: unknown): EagleLibraryFileKind | undefined {
    const kinds: EagleLibraryFileKind[] = ['image', 'design', 'video', 'font', 'document', 'archive', 'other'];
    return kinds.includes(value as EagleLibraryFileKind) ? value as EagleLibraryFileKind : undefined;
}

function normalizeExtensionFilter(value: unknown): string | undefined {
    const extension = cleanText(value, 24).replace(/^\./, '').toLowerCase();
    return /^[a-z0-9]{1,24}$/.test(extension) ? extension : undefined;
}

function normalizeShapeFilter(value: unknown): Exclude<EagleLibraryShape, 'all'> | undefined {
    const shapes: Array<Exclude<EagleLibraryShape, 'all'>> = [
        'square', 'portrait', 'landscape', 'tall', 'wide'
    ];
    return shapes.includes(value as Exclude<EagleLibraryShape, 'all'>)
        ? value as Exclude<EagleLibraryShape, 'all'>
        : undefined;
}

function normalizeDominantColorFilter(value: unknown): EagleLibraryDominantColor | undefined {
    const colors: EagleLibraryDominantColor[] = [
        'red', 'orange', 'yellow', 'green', 'cyan', 'blue',
        'purple', 'pink', 'brown', 'black', 'gray', 'white'
    ];
    return colors.includes(value as EagleLibraryDominantColor)
        ? value as EagleLibraryDominantColor
        : undefined;
}

function matchesShape(item: IndexedEagleItem, shape: Exclude<EagleLibraryShape, 'all'>): boolean {
    if (!item.width || !item.height) return false;
    const ratio = item.width / item.height;
    switch (shape) {
        case 'square': return ratio >= 0.9 && ratio <= 1.1;
        case 'portrait': return ratio >= 0.45 && ratio < 0.9;
        case 'landscape': return ratio > 1.1 && ratio <= 2.2;
        case 'tall': return ratio < 0.45;
        case 'wide': return ratio > 2.2;
    }
}

function matchesDominantColor(item: IndexedEagleItem, color: EagleLibraryDominantColor): boolean {
    const palettes = item.palettes.slice(0, 8);
    if (palettes.length === 0) return false;
    const totalRatio = palettes.reduce((sum, palette) => sum + Math.max(0, palette.ratio), 0);
    if (totalRatio <= 0) return classifyPaletteColor(palettes[0].color) === color;
    const matchingRatio = palettes.reduce((sum, palette) => {
        if (classifyPaletteColor(palette.color) !== color) return sum;
        return sum + Math.max(0, palette.ratio);
    }, 0);
    const strongestPalette = palettes.reduce((strongest, palette) => (
        palette.ratio > strongest.ratio ? palette : strongest
    ));
    return matchingRatio / totalRatio >= 0.22
        || classifyPaletteColor(strongestPalette.color) === color;
}

function classifyPaletteColor(color: [number, number, number]): EagleLibraryDominantColor {
    const [red, green, blue] = color.map((channel) => Math.max(0, Math.min(255, channel)) / 255);
    const maximum = Math.max(red, green, blue);
    const minimum = Math.min(red, green, blue);
    const lightness = (maximum + minimum) / 2;
    const delta = maximum - minimum;
    const saturation = delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1));
    if (lightness >= 0.88 && saturation <= 0.24) return 'white';
    if (lightness <= 0.2) return 'black';
    if (saturation <= 0.14) return 'gray';

    let hue = 0;
    if (delta > 0 && maximum === red) hue = 60 * (((green - blue) / delta) % 6);
    if (delta > 0 && maximum === green) hue = 60 * (((blue - red) / delta) + 2);
    if (delta > 0 && maximum === blue) hue = 60 * (((red - green) / delta) + 4);
    if (hue < 0) hue += 360;
    if (hue >= 12 && hue < 42 && lightness < 0.48) return 'brown';
    if (hue < 15 || hue >= 345) return 'red';
    if (hue < 45) return 'orange';
    if (hue < 70) return 'yellow';
    if (hue < 170) return 'green';
    if (hue < 205) return 'cyan';
    if (hue < 255) return 'blue';
    if (hue < 300) return 'purple';
    return 'pink';
}

function normalizeSortBy(value: unknown): EagleLibrarySortBy {
    const values: EagleLibrarySortBy[] = ['name', 'created', 'modified', 'size', 'random'];
    return values.includes(value as EagleLibrarySortBy) ? value as EagleLibrarySortBy : 'modified';
}

function normalizeSortDirection(value: unknown, sortBy: EagleLibrarySortBy): EagleLibrarySortDirection {
    if (value === 'asc' || value === 'desc') return value;
    return sortBy === 'name' ? 'asc' : 'desc';
}

function compareItems(
    left: IndexedEagleItem,
    right: IndexedEagleItem,
    sortBy: EagleLibrarySortBy,
    direction: EagleLibrarySortDirection,
    randomKey: string
): number {
    let comparison = 0;
    if (sortBy === 'name') comparison = left.name.localeCompare(right.name, 'zh-CN', { numeric: true });
    if (sortBy === 'created') comparison = compareIsoTimes(left.createdAt, right.createdAt);
    if (sortBy === 'modified') comparison = compareIsoTimes(left.modifiedAt, right.modifiedAt);
    if (sortBy === 'size') comparison = left.size - right.size;
    if (sortBy === 'random') comparison = stableHash(`${randomKey}:${left.id}`) - stableHash(`${randomKey}:${right.id}`);
    if (comparison === 0) comparison = left.id.localeCompare(right.id);
    return direction === 'desc' ? -comparison : comparison;
}

function stripPrivateIndexFields(item: IndexedEagleItem): EagleLibraryItem {
    const { previewPath: _previewPath, searchableText: _searchableText, ...publicItem } = item;
    return publicItem;
}

function buildObservationBoundaries(): EagleAssetObservationResult['boundaries'] {
    return {
        readonly: true,
        entersAgentContext: true,
        localPathRedacted: true,
        doesNotWriteEagle: true,
        doesNotGrantPhotoshopExecution: true
    };
}

function buildPreviewBoundaries(): EagleLibraryPreviewResponse['boundaries'] {
    return {
        uiOnly: true,
        singleItemOnly: true,
        doesNotPersist: true,
        doesNotWriteEagle: true,
        doesNotEnterAgentContext: true,
        doesNotGrantExecution: true
    };
}

function rememberPreview(
    cache: Map<string, EagleLibraryPreviewResponse>,
    key: string,
    response: EagleLibraryPreviewResponse
): void {
    cache.set(key, response);
    if (cache.size <= MAX_PREVIEW_CACHE_ENTRIES) return;
    const oldestKey = cache.keys().next().value;
    if (typeof oldestKey === 'string') cache.delete(oldestKey);
}

async function mapWithConcurrency<T, R>(
    values: T[],
    concurrency: number,
    mapper: (value: T, index: number) => Promise<R>
): Promise<R[]> {
    const results = new Array<R>(values.length);
    let nextIndex = 0;
    async function worker(): Promise<void> {
        while (nextIndex < values.length) {
            const currentIndex = nextIndex;
            nextIndex += 1;
            results[currentIndex] = await mapper(values[currentIndex], currentIndex);
        }
    }
    const workerCount = Math.min(Math.max(1, concurrency), Math.max(1, values.length));
    await Promise.all(Array.from({ length: workerCount }, () => worker()));
    return results;
}

function normalizeSearchTerms(value: unknown): string[] {
    return String(value || '')
        .trim()
        .toLowerCase()
        .split(/\s+/)
        .map((term) => term.trim())
        .filter(Boolean)
        .slice(0, 12);
}

function normalizeStringList(value: unknown, limit: number): string[] {
    if (!Array.isArray(value)) return [];
    return Array.from(new Set(value.map((item) => cleanText(item, 240)).filter(Boolean))).slice(0, limit);
}

function normalizePalettes(value: unknown): EagleLibraryPaletteColor[] {
    if (!Array.isArray(value)) return [];
    const result: EagleLibraryPaletteColor[] = [];
    for (const raw of value) {
        if (!raw || typeof raw !== 'object') continue;
        const record = raw as Record<string, unknown>;
        if (!Array.isArray(record.color) || record.color.length < 3) continue;
        const channels = record.color.slice(0, 3).map((channel) => clampInteger(channel, 0, 255, 0));
        const ratio = Number(record.ratio);
        result.push({
            color: [channels[0], channels[1], channels[2]],
            ratio: Number.isFinite(ratio) && ratio >= 0 ? ratio : 0
        });
    }
    return result.slice(0, 12);
}

function compareIsoTimes(left: string | undefined, right: string | undefined): number {
    return (Date.parse(left || '') || 0) - (Date.parse(right || '') || 0);
}

function stableHash(value: string): number {
    const hash = createHash('sha1').update(value).digest();
    return hash.readUInt32BE(0);
}

function normalizeEpochTime(value: unknown): string | undefined {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
    const milliseconds = parsed < 10_000_000_000 ? parsed * 1000 : parsed;
    const date = new Date(milliseconds);
    return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
}

function positiveInteger(value: unknown): number | undefined {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : undefined;
}

function clampInteger(
    value: unknown,
    min: number,
    max: number,
    fallback: number
): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function cleanText(value: unknown, limit: number): string {
    return String(value || '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit);
}

function isPathInside(rootPath: string, candidatePath: string): boolean {
    const relative = path.relative(rootPath, candidatePath);
    return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function parseJsonObject<T extends object>(value: string): T {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('invalid_eagle_library:JSON 元数据格式无效。');
    }
    return parsed as T;
}

function isInvalidLibraryError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error || '');
    return /invalid_eagle_library|ENOENT|ENOTDIR/i.test(message);
}

function formatPublicError(error: unknown, fallback = 'Eagle 素材库读取失败。'): string {
    const message = error instanceof Error ? error.message : String(error || fallback);
    return message
        .replace(/^invalid_eagle_library:/, '')
        .replace(/data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+/gi, '[图片数据已隐藏]')
        .slice(0, 1200);
}

export const eagleLibraryService = new EagleLibraryService();

export default EagleLibraryService;
