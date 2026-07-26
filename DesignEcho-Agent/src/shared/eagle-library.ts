import { buildEagleAssetRef, type EagleAssetRef } from './eagle-asset-ref';
import type { EagleActiveLibraryHandshake } from './eagle-active-library';

export const EAGLE_LIBRARY_CONTRACT_VERSION = 'eagle-library/v0' as const;
export const EAGLE_LIBRARY_SELECTION_VERSION = 'eagle-library-selection/v0' as const;

/**
 * 禁止直接写 JSON（P0 安全与契约）。
 * `.library` 目录是 Eagle 自己的数据库；DesignEcho 对它只做只读索引。
 * 任何对素材元数据的写入都必须走 Eagle 官方 API（见 `eagle-writeback-gate`），
 * 绝不直接改写 `.library` 下的 `metadata.json` / `tags.json` / `mtime.json` 等文件，
 * 否则会损坏用户素材库，破坏 Eagle 自身的数据一致性。
 */
export const EAGLE_LIBRARY_WRITE_POLICY = {
    directLibraryJsonWrite: 'forbidden',
    writeChannel: 'eagle_api_only'
} as const;

export type EagleLibraryAssetRole =
    | 'reference'
    | 'main_image_template'
    | 'detail_page_template'
    | 'sku_template'
    | 'design_template'
    | 'asset';

export type EagleLibraryFileKind =
    | 'image'
    | 'design'
    | 'video'
    | 'font'
    | 'document'
    | 'archive'
    | 'other';

export type EagleLibrarySortBy = 'name' | 'created' | 'modified' | 'size' | 'random';
export type EagleLibrarySortDirection = 'asc' | 'desc';
export type EagleLibraryShape = 'all' | 'square' | 'portrait' | 'landscape' | 'tall' | 'wide';
export type EagleLibraryDominantColor =
    | 'red'
    | 'orange'
    | 'yellow'
    | 'green'
    | 'cyan'
    | 'blue'
    | 'purple'
    | 'pink'
    | 'brown'
    | 'black'
    | 'gray'
    | 'white';

export interface EagleLibraryPaletteColor {
    color: [number, number, number];
    ratio: number;
}

export interface EagleLibraryFolderNode {
    id: string;
    name: string;
    description: string;
    iconColor?: string;
    itemCount: number;
    totalItemCount: number;
    children: EagleLibraryFolderNode[];
}

export interface EagleLibraryTagSummary {
    name: string;
    count: number;
}

export interface EagleLibraryRoleCounts {
    reference: number;
    main_image_template: number;
    detail_page_template: number;
    sku_template: number;
    design_template: number;
    asset: number;
}

export interface EagleLibraryInfo {
    contractVersion: typeof EAGLE_LIBRARY_CONTRACT_VERSION;
    libraryId: string;
    name: string;
    path: string;
    applicationVersion?: string;
    itemCount: number;
    activeItemCount: number;
    unclassifiedCount: number;
    untaggedCount: number;
    deletedCount: number;
    folderCount: number;
    tagCount: number;
    indexedAt: string;
    revision: string;
    folders: EagleLibraryFolderNode[];
    tags: EagleLibraryTagSummary[];
    roleCounts: EagleLibraryRoleCounts;
    extensionCounts?: Record<string, number>;
    boundaries: {
        readonly: true;
        requiresEagleProcess: false;
        writesEagle: false;
        metadataIsNotVisualObservation: true;
        previewDoesNotGrantExecution: true;
    };
}

export interface EagleLibraryItem {
    id: string;
    libraryId: string;
    name: string;
    ext: string;
    fileKind: EagleLibraryFileKind;
    role: EagleLibraryAssetRole;
    size: number;
    rating?: number;
    width?: number;
    height?: number;
    createdAt?: string;
    modifiedAt?: string;
    sourceFilePath: string;
    tags: string[];
    folderIds: string[];
    folderPaths: string[];
    annotation?: string;
    sourceUrl?: string;
    palettes: EagleLibraryPaletteColor[];
    isDeleted: boolean;
    hasPreview: boolean;
    previewSource: 'thumbnail' | 'source' | 'none';
}

export interface EagleLibraryQueryRequest {
    libraryPath: string;
    query?: string;
    folderId?: string;
    includeDescendants?: boolean;
    /** 单标签快捷筛选（向后兼容，等价于 includeTags 里的一项）。 */
    tag?: string;
    /** 三态多选：命中项必须同时含全部这些标签。 */
    includeTags?: string[];
    /** 三态多选：命中项不得含其中任一标签。 */
    excludeTags?: string[];
    role?: EagleLibraryAssetRole | 'all';
    fileKind?: EagleLibraryFileKind | 'all';
    extension?: string;
    shape?: EagleLibraryShape;
    minimumRating?: number;
    dominantColor?: EagleLibraryDominantColor;
    includeDeleted?: boolean;
    deletedOnly?: boolean;
    unclassifiedOnly?: boolean;
    untaggedOnly?: boolean;
    sortBy?: EagleLibrarySortBy;
    sortDirection?: EagleLibrarySortDirection;
    randomSeed?: number;
    offset?: number;
    limit?: number;
}

export interface EagleLibraryFacetCounts {
    /** 当前筛选结果集内每个标签的命中数（动态计数，按数量降序）。 */
    tags: EagleLibraryTagSummary[];
    /** 当前筛选结果集内每个扩展名的命中数。 */
    extensions: Record<string, number>;
}

export interface EagleLibraryQueryResponse {
    success: boolean;
    status: 'ok' | 'invalid_library' | 'unavailable';
    total: number;
    offset: number;
    limit: number;
    items: EagleLibraryItem[];
    /** 基于当前筛选结果集的动态 facet 计数，供筛选面板显示实时数量。 */
    facets?: EagleLibraryFacetCounts;
    revision?: string;
    error?: string;
}

export interface EagleLibraryOpenResponse {
    success: boolean;
    status: 'ok' | 'cancelled' | 'invalid_library' | 'unavailable';
    library?: EagleLibraryInfo;
    /** 打开成功时同时给出「活动库握手」结果（当前为磁盘选择来源；实时 Eagle 对账在后续阶段接入）。 */
    activeLibrary?: EagleActiveLibraryHandshake;
    error?: string;
}

export interface EagleLibraryPreviewRequest {
    libraryPath: string;
    itemId: string;
    maxSize?: number;
    purpose: 'eagle_library_ui';
}

export interface EagleLibraryPreviewResponse {
    success: boolean;
    status: 'ok' | 'not_found' | 'unsupported' | 'unavailable';
    itemId: string;
    dataUrl?: string;
    width?: number;
    height?: number;
    error?: string;
    boundaries: {
        uiOnly: true;
        singleItemOnly: true;
        doesNotPersist: true;
        doesNotWriteEagle: true;
        doesNotEnterAgentContext: true;
        doesNotGrantExecution: true;
    };
}

export interface EagleLibrarySelectionContext {
    schemaVersion: typeof EAGLE_LIBRARY_SELECTION_VERSION;
    /** 面向模型的不透明引用（不含本地路径）。模型只应看到它，不应看到 sourceFilePath/libraryPath。 */
    assetRef: EagleAssetRef;
    libraryId: string;
    libraryName: string;
    /** 仅 renderer/main 使用；不进入模型提示词。 */
    libraryPath: string;
    itemId: string;
    name: string;
    /** 仅主进程解析层使用；不进入模型提示词。 */
    sourceFilePath: string;
    ext: string;
    fileKind: EagleLibraryFileKind;
    role: EagleLibraryAssetRole;
    tags: string[];
    folderPaths: string[];
    width?: number;
    height?: number;
    selectedAt: string;
}

const DESIGN_EXTENSIONS = new Set(['psd', 'psb', 'tif', 'tiff', 'ai', 'eps']);
const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'avif', 'heic', 'svg']);
const VIDEO_EXTENSIONS = new Set(['mp4', 'avi', 'mov', 'm4v', 'mkv', 'webm']);
const FONT_EXTENSIONS = new Set(['ttf', 'ttc', 'otf', 'woff', 'woff2']);
const DOCUMENT_EXTENSIONS = new Set(['txt', 'md', 'pdf', 'doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx', 'jsx', 'js', 'py']);
const ARCHIVE_EXTENSIONS = new Set(['zip', 'rar', '7z', 'tar', 'gz']);

export function resolveEagleLibraryFileKind(extValue: unknown): EagleLibraryFileKind {
    const ext = normalizeToken(extValue).replace(/^\./, '');
    if (DESIGN_EXTENSIONS.has(ext)) return 'design';
    if (IMAGE_EXTENSIONS.has(ext)) return 'image';
    if (VIDEO_EXTENSIONS.has(ext)) return 'video';
    if (FONT_EXTENSIONS.has(ext)) return 'font';
    if (DOCUMENT_EXTENSIONS.has(ext)) return 'document';
    if (ARCHIVE_EXTENSIONS.has(ext)) return 'archive';
    return 'other';
}

export function classifyEagleLibraryAsset(input: {
    ext?: unknown;
    tags?: unknown;
    folderPaths?: unknown;
}): EagleLibraryAssetRole {
    const ext = normalizeToken(input.ext).replace(/^\./, '');
    const tags = normalizeStringList(input.tags);
    const folderPaths = normalizeStringList(input.folderPaths);
    const classificationText = [...tags, ...folderPaths].join(' ').toLowerCase();
    const looksLikeTemplate = /(?:^|[\s/:_-])(模板|template)(?:$|[\s/:_-])/i.test(` ${classificationText} `)
        || tags.includes('分类:设计模板')
        || DESIGN_EXTENSIONS.has(ext);

    if (looksLikeTemplate && /(?:分类:sku|(?:^|[\/\s:_-])sku(?:$|[\/\s:_-]))/i.test(classificationText)) {
        return 'sku_template';
    }
    if (looksLikeTemplate && /(详情页|详情模板|detail[\s_-]*page)/i.test(classificationText)) {
        return 'detail_page_template';
    }
    if (looksLikeTemplate && /(主图|点击图|转化图|main[\s_-]*image)/i.test(classificationText)) {
        return 'main_image_template';
    }
    if (looksLikeTemplate) return 'design_template';
    if (/(参考|灵感|inspiration|reference)/i.test(classificationText)) return 'reference';
    return 'asset';
}

export function buildEagleLibrarySelectionContext(
    library: EagleLibraryInfo,
    item: EagleLibraryItem,
    now: unknown = new Date().toISOString()
): EagleLibrarySelectionContext {
    const libraryId = cleanText(library.libraryId, 160);
    const libraryName = cleanText(library.name, 180);
    const itemId = cleanText(item.id, 180);
    const name = cleanText(item.name, 240);
    const ext = cleanText(item.ext, 24).toLowerCase();
    const tags = normalizeStringList(item.tags).slice(0, 30);
    const folderPaths = normalizeStringList(item.folderPaths).slice(0, 20);
    const width = positiveNumber(item.width);
    const height = positiveNumber(item.height);
    const selectedAt = normalizeIsoTime(now);
    const assetRef = buildEagleAssetRef({
        libraryId,
        libraryName,
        itemId,
        name,
        ext,
        fileKind: item.fileKind,
        role: item.role,
        tags,
        folderPaths,
        width,
        height,
        selectedAt
    });
    return {
        schemaVersion: EAGLE_LIBRARY_SELECTION_VERSION,
        assetRef,
        libraryId,
        libraryName,
        libraryPath: cleanOpaquePath(library.path),
        itemId,
        name,
        sourceFilePath: cleanOpaquePath(item.sourceFilePath),
        ext,
        fileKind: item.fileKind,
        role: item.role,
        tags,
        folderPaths,
        ...(width ? { width } : {}),
        ...(height ? { height } : {}),
        selectedAt
    };
}

function normalizeStringList(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return Array.from(new Set(value.map((item) => cleanText(item, 240)).filter(Boolean)));
}

function normalizeToken(value: unknown): string {
    return String(value || '').trim().toLowerCase();
}

function cleanText(value: unknown, limit: number): string {
    return String(value || '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit);
}

function cleanOpaquePath(value: unknown): string {
    return String(value || '').replace(/[\r\n\t]+/g, '').trim().slice(0, 1024);
}

function positiveNumber(value: unknown): number | undefined {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : undefined;
}

function normalizeIsoTime(value: unknown): string {
    const parsed = Date.parse(String(value || ''));
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : new Date().toISOString();
}
