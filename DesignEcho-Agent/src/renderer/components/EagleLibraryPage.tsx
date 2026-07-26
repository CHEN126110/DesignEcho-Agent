import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
    Archive,
    ArrowLeft,
    ArrowRight,
    ChevronDown,
    ChevronRight,
    Clock3,
    File,
    FileImage,
    FileText,
    Folder,
    FolderOpen,
    Grid3X3,
    Image,
    Images,
    LayoutTemplate,
    Library,
    Link2,
    List,
    LoaderCircle,
    Lock,
    Maximize2,
    Menu,
    Minus,
    Palette,
    Pencil,
    Plus,
    RefreshCw,
    Search,
    Shuffle,
    SlidersHorizontal,
    Star,
    Tags,
    Trash2,
    Type,
    Video,
    X
} from 'lucide-react';

import {
    buildEagleLibrarySelectionContext,
    type EagleLibraryAssetRole,
    type EagleLibraryDominantColor,
    type EagleLibraryFacetCounts,
    type EagleLibraryFileKind,
    type EagleLibraryFolderNode,
    type EagleLibraryInfo,
    type EagleLibraryItem,
    type EagleLibraryQueryRequest,
    type EagleLibrarySelectionContext,
    type EagleLibraryShape,
    type EagleLibrarySortBy
} from '../../shared/eagle-library';
import { resolveEagleFolderIconColor } from '../../shared/eagle-library-appearance';
import { EAGLE_ASSET_GROUP_LIMIT, type EagleAssetRef } from '../../shared/eagle-asset-ref';
import {
    buildEagleJustifiedRows,
    resolveEagleGalleryContentWidth
} from '../../shared/eagle-justified-layout';
import {
    getEagleLibraryPreview,
    loadPersistedEagleLibraryPath,
    openEagleLibrary,
    queryEagleLibrary,
    selectEagleLibrary
} from '../services/eagle-library.service';

import './EagleLibraryPage.css';

interface EagleLibraryPageProps {
    isActive: boolean;
    selectedItemId?: string;
    /** 唯一主选（单选）经 selection 传出；多选时 selection 为 null、group 为路径安全引用集（P4）。 */
    onSelectionChange: (selection: EagleLibrarySelectionContext | null, group?: EagleAssetRef[]) => void;
}

interface LibraryFilterState {
    folderId?: string;
    folderName?: string;
    deletedOnly?: boolean;
    unclassifiedOnly?: boolean;
    untaggedOnly?: boolean;
    role: EagleLibraryAssetRole | 'all';
    fileKind: EagleLibraryFileKind | 'all';
    extension?: string;
    shape: EagleLibraryShape;
    minimumRating: number;
    dominantColor?: EagleLibraryDominantColor;
    /** 三态多选：命中项须含全部这些标签。 */
    includeTags?: string[];
    /** 三态多选：命中项不得含其中任一标签。 */
    excludeTags?: string[];
    navigationMode?: 'recent' | 'random';
    randomSeed?: number;
}

interface LibraryNavigationState {
    filters: LibraryFilterState;
    sortBy: EagleLibrarySortBy;
    sortDirection: 'asc' | 'desc';
}

interface InspectorEditValues {
    tags: string[];
    annotation: string;
    rating: number;
}

interface InspectorEditState {
    itemId: string;
    /** 编辑起点（打开编辑时素材的值），用于主进程写前冲突检测。 */
    baseline: InspectorEditValues;
    tags: string[];
    tagDraft: string;
    annotation: string;
    rating: number;
    saving: boolean;
    fromDraft: boolean;
    feedback: { kind: 'success' | 'error' | 'draft' | 'conflict'; message: string } | null;
}

interface FlatFolder {
    id: string;
    name: string;
    path: string;
    count: number;
}

type FilterPanel = 'color' | 'tag' | 'folder' | 'shape' | 'rating' | 'format' | 'role' | null;

const PAGE_SIZE = 72;
const ZOOM_MIN = 2;
const ZOOM_MAX = 7;
const DEFAULT_ZOOM = 5;
const JUSTIFIED_GAP = 10;

const ROLE_LABELS: Record<EagleLibraryAssetRole, string> = {
    reference: '设计参考',
    main_image_template: '主图模板',
    detail_page_template: '详情页模板',
    sku_template: 'SKU 模板',
    design_template: '通用模板',
    asset: '普通素材'
};

const FILE_KIND_LABELS: Record<EagleLibraryFileKind, string> = {
    image: '图片',
    design: '设计源文件',
    video: '视频',
    font: '字体',
    document: '文档',
    archive: '压缩包',
    other: '其他'
};

const SHAPE_LABELS: Record<EagleLibraryShape, string> = {
    all: '全部形状',
    square: '方形',
    portrait: '竖图',
    landscape: '横图',
    tall: '超长图',
    wide: '超宽图'
};

const COLOR_OPTIONS: Array<{ id: EagleLibraryDominantColor; label: string; value: string }> = [
    { id: 'red', label: '红色', value: '#d85b58' },
    { id: 'orange', label: '橙色', value: '#d88a49' },
    { id: 'yellow', label: '黄色', value: '#d8bd52' },
    { id: 'green', label: '绿色', value: '#5fa56d' },
    { id: 'cyan', label: '青色', value: '#55a7a6' },
    { id: 'blue', label: '蓝色', value: '#5d82c7' },
    { id: 'purple', label: '紫色', value: '#8a6cbb' },
    { id: 'pink', label: '粉色', value: '#cc7e9f' },
    { id: 'brown', label: '棕色', value: '#8d654c' },
    { id: 'black', label: '黑色', value: '#292a2d' },
    { id: 'gray', label: '灰色', value: '#8c8e93' },
    { id: 'white', label: '白色', value: '#ecebe7' }
];

const DEFAULT_EXTENSION_OPTIONS = [
    'jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'avif', 'heic',
    'psd', 'psb', 'ai', 'eps', 'svg', 'tif', 'tiff',
    'mp4', 'mov', 'mkv', 'pdf'
];

const INITIAL_FILTERS: LibraryFilterState = {
    role: 'all',
    fileKind: 'all',
    shape: 'all',
    minimumRating: 0
};

function formatCount(value: number): string {
    return new Intl.NumberFormat('zh-CN').format(Math.max(0, value || 0));
}

function formatBytes(value: number): string {
    const bytes = Math.max(0, Number(value) || 0);
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
    return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

function formatDate(value?: string): string {
    const parsed = Date.parse(String(value || ''));
    if (!Number.isFinite(parsed)) return '未知';
    return new Intl.DateTimeFormat('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).format(new Date(parsed));
}

function clampZoom(value: number): number {
    return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.round(value)));
}

function resolveItemsPerRow(zoom: number): number {
    return 9 - clampZoom(zoom);
}

function getFileKindIcon(kind: EagleLibraryFileKind): React.ReactElement {
    switch (kind) {
        case 'image': return <FileImage size={24} strokeWidth={1.45} />;
        case 'design': return <Palette size={24} strokeWidth={1.45} />;
        case 'video': return <Video size={24} strokeWidth={1.45} />;
        case 'font': return <Type size={24} strokeWidth={1.45} />;
        case 'document': return <FileText size={24} strokeWidth={1.45} />;
        case 'archive': return <Archive size={24} strokeWidth={1.45} />;
        default: return <File size={24} strokeWidth={1.45} />;
    }
}

function getRoleIcon(role: EagleLibraryAssetRole): React.ReactElement {
    switch (role) {
        case 'main_image_template': return <Image size={15} strokeWidth={1.65} />;
        case 'detail_page_template': return <LayoutTemplate size={15} strokeWidth={1.65} />;
        case 'sku_template': return <Grid3X3 size={15} strokeWidth={1.65} />;
        case 'design_template': return <Palette size={15} strokeWidth={1.65} />;
        case 'reference': return <Images size={15} strokeWidth={1.65} />;
        default: return <FileImage size={15} strokeWidth={1.65} />;
    }
}

function flattenFolders(nodes: EagleLibraryFolderNode[], parentPath = ''): FlatFolder[] {
    const result: FlatFolder[] = [];
    for (const folder of nodes) {
        const path = parentPath ? `${parentPath} / ${folder.name}` : folder.name;
        result.push({ id: folder.id, name: folder.name, path, count: folder.totalItemCount });
        result.push(...flattenFolders(folder.children, path));
    }
    return result;
}

function filterFolderTree(nodes: EagleLibraryFolderNode[], query: string): EagleLibraryFolderNode[] {
    const term = query.trim().toLocaleLowerCase('zh-CN');
    if (!term) return nodes;
    const result: EagleLibraryFolderNode[] = [];
    for (const folder of nodes) {
        const children = filterFolderTree(folder.children, term);
        if (folder.name.toLocaleLowerCase('zh-CN').includes(term) || children.length > 0) {
            result.push({ ...folder, children });
        }
    }
    return result;
}

function isEditableTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false;
    return Boolean(target.closest('input, textarea, select, [contenteditable="true"]'));
}

function isGalleryKeyboardTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false;
    if (target.closest('.eagle-item-card')) return true;
    if (target === document.body) return true;
    return target.classList.contains('eagle-library-results')
        || target.classList.contains('eagle-item-collection')
        || target.classList.contains('eagle-justified-row');
}

function hasActiveFilters(filters: LibraryFilterState): boolean {
    return Boolean(
        filters.folderId
        || filters.includeTags?.length
        || filters.excludeTags?.length
        || filters.deletedOnly
        || filters.unclassifiedOnly
        || filters.untaggedOnly
        || filters.role !== 'all'
        || filters.fileKind !== 'all'
        || filters.extension
        || filters.shape !== 'all'
        || filters.minimumRating > 0
        || filters.dominantColor
    );
}

function LibraryThumbnail({
    libraryPath,
    item,
    size = 560
}: {
    libraryPath: string;
    item: EagleLibraryItem;
    size?: number;
}): React.ReactElement {
    const [preview, setPreview] = useState<string>();
    const [visible, setVisible] = useState(false);
    const hostRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const node = hostRef.current;
        if (!node) return;
        const observer = new IntersectionObserver((entries) => {
            if (!entries.some((entry) => entry.isIntersecting)) return;
            setVisible(true);
            observer.disconnect();
        }, { rootMargin: '360px' });
        observer.observe(node);
        return () => observer.disconnect();
    }, [item.id]);

    useEffect(() => {
        let disposed = false;
        setPreview(undefined);
        if (!visible || !item.hasPreview) return () => { disposed = true; };
        void getEagleLibraryPreview({
            libraryPath,
            itemId: item.id,
            maxSize: size,
            purpose: 'eagle_library_ui'
        }).then((result) => {
            if (!disposed && result.success && result.dataUrl) setPreview(result.dataUrl);
        });
        return () => { disposed = true; };
    }, [item.hasPreview, item.id, libraryPath, size, visible]);

    return (
        <div ref={hostRef} className={`eagle-thumbnail ${preview ? 'has-image' : ''}`}>
            {preview
                ? <img src={preview} alt="" draggable={false} />
                : <span className="eagle-thumbnail-placeholder">{getFileKindIcon(item.fileKind)}</span>}
        </div>
    );
}

function FolderTree({
    nodes,
    selectedFolderId,
    expandedFolderIds,
    onToggle,
    onSelect,
    depth = 0
}: {
    nodes: EagleLibraryFolderNode[];
    selectedFolderId?: string;
    expandedFolderIds: Set<string>;
    onToggle: (folderId: string) => void;
    onSelect: (folder: EagleLibraryFolderNode) => void;
    depth?: number;
}): React.ReactElement {
    return (
        <>
            {nodes.map((folder) => {
                const hasChildren = folder.children.length > 0;
                const expanded = expandedFolderIds.has(folder.id);
                const selected = selectedFolderId === folder.id;
                return (
                    <React.Fragment key={folder.id}>
                        <div
                            className={`eagle-folder-row ${selected ? 'selected' : ''}`}
                            style={{ paddingLeft: `${8 + depth * 15}px` }}
                        >
                            <button
                                type="button"
                                className="eagle-folder-disclosure"
                                aria-label={expanded ? `折叠${folder.name}` : `展开${folder.name}`}
                                disabled={!hasChildren}
                                onClick={() => onToggle(folder.id)}
                            >
                                {hasChildren && (expanded
                                    ? <ChevronDown size={12} strokeWidth={1.7} />
                                    : <ChevronRight size={12} strokeWidth={1.7} />)}
                            </button>
                            <button
                                type="button"
                                className="eagle-folder-select"
                                onClick={() => onSelect(folder)}
                                title={folder.name}
                            >
                                {expanded
                                    ? <FolderOpen size={15} strokeWidth={1.55} style={{ color: resolveEagleFolderIconColor(folder.iconColor) }} />
                                    : <Folder size={15} strokeWidth={1.55} style={{ color: resolveEagleFolderIconColor(folder.iconColor) }} />}
                                <span>{folder.name}</span>
                                <small>{formatCount(folder.totalItemCount)}</small>
                            </button>
                        </div>
                        {hasChildren && expanded && (
                            <FolderTree
                                nodes={folder.children}
                                selectedFolderId={selectedFolderId}
                                expandedFolderIds={expandedFolderIds}
                                onToggle={onToggle}
                                onSelect={onSelect}
                                depth={depth + 1}
                            />
                        )}
                    </React.Fragment>
                );
            })}
        </>
    );
}

function AssetCard({
    libraryPath,
    item,
    width,
    mediaHeight,
    selected,
    primary,
    listMode,
    cardRef,
    onClick,
    onDoubleClick
}: {
    libraryPath: string;
    item: EagleLibraryItem;
    width?: number;
    mediaHeight?: number;
    selected: boolean;
    primary: boolean;
    listMode?: boolean;
    cardRef: (node: HTMLButtonElement | null) => void;
    onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
    onDoubleClick: () => void;
}): React.ReactElement {
    const dimensions = item.width && item.height ? `${item.width} × ${item.height}` : '';
    return (
        <button
            ref={cardRef}
            type="button"
            className={`eagle-item-card ${selected ? 'selected' : ''} ${primary ? 'primary' : ''}`}
            style={!listMode && width ? { width: `${width}px` } : undefined}
            onClick={onClick}
            onDoubleClick={onDoubleClick}
            title={`${item.name}.${item.ext}`}
            aria-pressed={selected}
            data-item-id={item.id}
        >
            <span className="eagle-item-media" style={!listMode && mediaHeight ? { height: `${mediaHeight}px` } : undefined}>
                <LibraryThumbnail libraryPath={libraryPath} item={item} />
                <span className={`eagle-format-badge format-${item.ext.toLowerCase()}`}>{item.ext.toUpperCase()}</span>
                {primary && selected && <span className="eagle-primary-selection-mark" aria-hidden="true" />}
            </span>
            <span className="eagle-item-copy">
                <strong>{item.name}</strong>
                <small>{dimensions || item.ext.toUpperCase()}</small>
            </span>
        </button>
    );
}

export const EagleLibraryPage: React.FC<EagleLibraryPageProps> = ({
    isActive,
    selectedItemId,
    onSelectionChange
}) => {
    const [library, setLibrary] = useState<EagleLibraryInfo | null>(null);
    const [items, setItems] = useState<EagleLibraryItem[]>([]);
    const [total, setTotal] = useState(0);
    const [facets, setFacets] = useState<EagleLibraryFacetCounts | null>(null);
    const [inspectorEdit, setInspectorEdit] = useState<InspectorEditState | null>(null);
    const [filters, setFilters] = useState<LibraryFilterState>(INITIAL_FILTERS);
    const [navigationHistory, setNavigationHistory] = useState<LibraryNavigationState[]>([{
        filters: INITIAL_FILTERS,
        sortBy: 'modified',
        sortDirection: 'desc'
    }]);
    const [navigationIndex, setNavigationIndex] = useState(0);
    const [searchDraft, setSearchDraft] = useState('');
    const [searchQuery, setSearchQuery] = useState('');
    const [sortBy, setSortBy] = useState<EagleLibrarySortBy>('modified');
    const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
    const [loadingLibrary, setLoadingLibrary] = useState(false);
    const [loadingItems, setLoadingItems] = useState(false);
    const [loadingMore, setLoadingMore] = useState(false);
    const [error, setError] = useState('');
    const [expandedFolderIds, setExpandedFolderIds] = useState<Set<string>>(new Set());
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [selectedItem, setSelectedItem] = useState<EagleLibraryItem | null>(null);
    const [selectionAnchorId, setSelectionAnchorId] = useState<string>();
    const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
    const [zoom, setZoom] = useState(DEFAULT_ZOOM);
    const [sidebarOpen, setSidebarOpen] = useState(true);
    const [inspectorOpen, setInspectorOpen] = useState(true);
    const [activeFilterPanel, setActiveFilterPanel] = useState<FilterPanel>(null);
    const [filterPanelSearch, setFilterPanelSearch] = useState('');
    const [folderTreeSearch, setFolderTreeSearch] = useState('');
    const [galleryWidth, setGalleryWidth] = useState(280);
    const [previewItem, setPreviewItem] = useState<EagleLibraryItem | null>(null);
    const initializedRef = useRef(false);
    const requestRevisionRef = useRef(0);
    const preserveLocalMultiSelectionRef = useRef(false);
    const externalSelectionIdRef = useRef(selectedItemId);
    const resultsRef = useRef<HTMLDivElement>(null);
    const searchInputRef = useRef<HTMLInputElement>(null);
    const previewCloseRef = useRef<HTMLButtonElement>(null);
    const itemRefs = useRef<Map<string, HTMLButtonElement>>(new Map());

    const itemsPerRow = resolveItemsPerRow(zoom);
    const flatFolders = useMemo(() => flattenFolders(library?.folders || []), [library?.folders]);
    const visibleFolderTree = useMemo(
        () => filterFolderTree(library?.folders || [], folderTreeSearch),
        [folderTreeSearch, library?.folders]
    );
    const facetTagCounts = useMemo(() => {
        const map = new Map<string, number>();
        for (const tag of facets?.tags || []) map.set(tag.name, tag.count);
        return map;
    }, [facets]);

    const extensionOptions = useMemo(() => {
        const available = Object.keys(library?.extensionCounts || {});
        const source = available.length > 0 ? available : DEFAULT_EXTENSION_OPTIONS;
        return [...new Set(source.map((extension) => extension.toLowerCase()))]
            .sort((left, right) => left.localeCompare(right));
    }, [library?.extensionCounts]);
    const selectedItems = useMemo(
        () => items.filter((item) => selectedIds.has(item.id)),
        [items, selectedIds]
    );
    const justifiedRows = useMemo(() => buildEagleJustifiedRows(items, {
        containerWidth: galleryWidth,
        itemsPerRow,
        gap: JUSTIFIED_GAP,
        minimumRowHeight: 96,
        maximumRowHeight: 520
    }), [galleryWidth, items, itemsPerRow]);

    useEffect(() => {
        const timer = window.setTimeout(() => setSearchQuery(searchDraft.trim()), 180);
        return () => window.clearTimeout(timer);
    }, [searchDraft]);

    useEffect(() => {
        if (!isActive || initializedRef.current) return;
        initializedRef.current = true;
        let disposed = false;
        void loadPersistedEagleLibraryPath().then(async (path) => {
            if (!path || disposed) return;
            setLoadingLibrary(true);
            const response = await openEagleLibrary(path);
            if (disposed) return;
            setLoadingLibrary(false);
            if (response.success && response.library) {
                setLibrary(response.library);
                setExpandedFolderIds(new Set(response.library.folders.slice(0, 5).map((folder) => folder.id)));
            } else if (response.status !== 'cancelled') {
                setError(response.error || '上次导入的 Eagle 素材库已无法读取，请重新选择。');
            }
        });
        return () => { disposed = true; };
    }, [isActive]);

    useLayoutEffect(() => {
        const node = resultsRef.current;
        if (!node || !isActive || viewMode !== 'grid') return;

        const updateFromClientWidth = (): void => {
            const styles = window.getComputedStyle(node);
            const nextWidth = resolveEagleGalleryContentWidth(
                node.clientWidth,
                Number.parseFloat(styles.paddingLeft),
                Number.parseFloat(styles.paddingRight)
            );
            setGalleryWidth((current) => current === nextWidth ? current : nextWidth);
        };
        updateFromClientWidth();

        const observer = new ResizeObserver((entries) => {
            const nextWidth = resolveEagleGalleryContentWidth(entries[0]?.contentRect.width ?? 0);
            setGalleryWidth((current) => current === nextWidth ? current : nextWidth);
        });
        observer.observe(node);
        return () => observer.disconnect();
    }, [inspectorOpen, isActive, library?.path, sidebarOpen, viewMode]);

    useEffect(() => {
        if (!library || !isActive) return;
        const revision = requestRevisionRef.current + 1;
        requestRevisionRef.current = revision;
        setLoadingItems(true);
        setError('');
        void queryEagleLibrary(buildQueryRequest(library.path, 0)).then((response) => {
            if (requestRevisionRef.current !== revision) return;
            setLoadingItems(false);
            if (!response.success) {
                setItems([]);
                setTotal(0);
                setFacets(null);
                setError(response.error || 'Eagle 素材读取失败。');
                return;
            }
            setItems(response.items);
            setTotal(response.total);
            setFacets(response.facets || null);
        });
    }, [filters, isActive, library, searchQuery, sortBy, sortDirection]);

    useEffect(() => {
        const externalSelectionChanged = externalSelectionIdRef.current !== selectedItemId;
        externalSelectionIdRef.current = selectedItemId;
        if (!selectedItemId) {
            if (!externalSelectionChanged) return;
            if (preserveLocalMultiSelectionRef.current) {
                preserveLocalMultiSelectionRef.current = false;
                return;
            }
            setSelectedIds(new Set());
            setSelectedItem(null);
            setSelectionAnchorId(undefined);
            return;
        }
        const item = items.find((candidate) => candidate.id === selectedItemId);
        if (!item) return;
        if (!externalSelectionChanged && selectedIds.size > 0) {
            if (selectedIds.size === 1 && selectedIds.has(item.id)) setSelectedItem(item);
            return;
        }
        setSelectedIds(new Set([item.id]));
        setSelectedItem(item);
        setSelectionAnchorId(item.id);
    }, [items, selectedItemId]);

    useEffect(() => {
        if (!previewItem) return;
        const timer = window.setTimeout(() => previewCloseRef.current?.focus(), 0);
        return () => window.clearTimeout(timer);
    }, [previewItem]);

    // 切换选中素材时退出 Inspector 编辑态，避免把编辑写到另一个素材上。
    useEffect(() => {
        setInspectorEdit((current) => (current && current.itemId !== selectedItem?.id ? null : current));
    }, [selectedItem?.id]);

    useEffect(() => {
        if (!isActive) return;
        function handleKeyboard(event: KeyboardEvent): void {
            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
                event.preventDefault();
                searchInputRef.current?.focus();
                return;
            }
            if (event.key === 'Escape') {
                if (previewItem) {
                    event.preventDefault();
                    closePreview();
                    return;
                }
                if (activeFilterPanel) {
                    event.preventDefault();
                    setActiveFilterPanel(null);
                    return;
                }
                if (selectedIds.size > 0 && !isEditableTarget(event.target)) {
                    event.preventDefault();
                    clearSelection();
                }
                return;
            }
            if (previewItem) {
                if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                    event.preventDefault();
                    movePreview(event.key === 'ArrowLeft' ? -1 : 1);
                }
                return;
            }
            if (isEditableTarget(event.target) || items.length === 0) return;
            if (!isGalleryKeyboardTarget(event.target)) return;
            if (event.key === 'Enter' && selectedItem) {
                event.preventDefault();
                setPreviewItem(selectedItem);
                return;
            }
            const movement = resolveKeyboardMovement(event.key, itemsPerRow);
            if (movement === undefined) return;
            event.preventDefault();
            const currentIndex = selectedItem ? items.findIndex((item) => item.id === selectedItem.id) : -1;
            const nextIndex = Math.max(0, Math.min(items.length - 1, currentIndex < 0 ? 0 : currentIndex + movement));
            selectSingleItem(items[nextIndex], true);
        }
        window.addEventListener('keydown', handleKeyboard);
        return () => window.removeEventListener('keydown', handleKeyboard);
    }, [activeFilterPanel, isActive, items, itemsPerRow, previewItem, selectedIds.size, selectedItem]);

    const activeTitle = useMemo(() => {
        if (filters.folderName) return filters.folderName;
        if (filters.includeTags?.length === 1 && !filters.excludeTags?.length) return `# ${filters.includeTags[0]}`;
        if (filters.includeTags?.length || filters.excludeTags?.length) {
            return `标签筛选 ${filters.includeTags?.length ? `+${filters.includeTags.length}` : ''}${filters.excludeTags?.length ? ` −${filters.excludeTags.length}` : ''}`.trim();
        }
        if (filters.role !== 'all') return ROLE_LABELS[filters.role];
        if (filters.navigationMode === 'recent') return '最近使用';
        if (filters.navigationMode === 'random') return '随机模式';
        if (filters.deletedOnly) return '回收站';
        if (filters.unclassifiedOnly) return '未分类';
        if (filters.untaggedOnly) return '未标签';
        return '全部';
    }, [filters]);

    function buildQueryRequest(libraryPath: string, offset: number): EagleLibraryQueryRequest {
        return {
            libraryPath,
            query: searchQuery || undefined,
            folderId: filters.folderId,
            includeDescendants: Boolean(filters.folderId),
            includeTags: filters.includeTags,
            excludeTags: filters.excludeTags,
            role: filters.role,
            fileKind: filters.fileKind,
            extension: filters.extension,
            shape: filters.shape,
            minimumRating: filters.minimumRating,
            dominantColor: filters.dominantColor,
            includeDeleted: filters.deletedOnly,
            deletedOnly: filters.deletedOnly,
            unclassifiedOnly: filters.unclassifiedOnly,
            untaggedOnly: filters.untaggedOnly,
            sortBy,
            sortDirection,
            randomSeed: filters.randomSeed,
            offset,
            limit: PAGE_SIZE
        };
    }

    async function handleSelectLibrary(): Promise<void> {
        setLoadingLibrary(true);
        setError('');
        const response = await selectEagleLibrary(library?.path);
        setLoadingLibrary(false);
        if (response.success && response.library) {
            setLibrary(response.library);
            setFilters(INITIAL_FILTERS);
            setSortBy('modified');
            setSortDirection('desc');
            setNavigationHistory([{
                filters: INITIAL_FILTERS,
                sortBy: 'modified',
                sortDirection: 'desc'
            }]);
            setNavigationIndex(0);
            setSearchDraft('');
            clearSelection();
            setExpandedFolderIds(new Set(response.library.folders.slice(0, 5).map((folder) => folder.id)));
        } else if (response.status !== 'cancelled') {
            setError(response.error || '无法导入所选 Eagle 素材库。');
        }
    }

    async function handleRefreshLibrary(): Promise<void> {
        if (!library) return;
        setLoadingLibrary(true);
        setError('');
        const response = await openEagleLibrary(library.path, true);
        setLoadingLibrary(false);
        if (response.success && response.library) setLibrary(response.library);
        else setError(response.error || '刷新 Eagle 素材库失败。');
    }

    async function handleLoadMore(): Promise<void> {
        if (!library || loadingMore || items.length >= total) return;
        const revision = requestRevisionRef.current;
        setLoadingMore(true);
        const response = await queryEagleLibrary(buildQueryRequest(library.path, items.length));
        if (requestRevisionRef.current !== revision) {
            setLoadingMore(false);
            return;
        }
        setLoadingMore(false);
        if (response.success) {
            setItems((current) => [...current, ...response.items]);
            setTotal(response.total);
            if (response.facets) setFacets(response.facets);
        } else {
            setError(response.error || '继续载入 Eagle 素材失败。');
        }
    }

    function commitNavigation(
        nextFilters: LibraryFilterState,
        nextSortBy: EagleLibrarySortBy = sortBy,
        nextSortDirection: 'asc' | 'desc' = sortDirection
    ): void {
        const nextState: LibraryNavigationState = {
            filters: nextFilters,
            sortBy: nextSortBy,
            sortDirection: nextSortDirection
        };
        const nextHistory = [...navigationHistory.slice(0, navigationIndex + 1), nextState];
        setNavigationHistory(nextHistory);
        setNavigationIndex(nextHistory.length - 1);
        setFilters(nextFilters);
        setSortBy(nextSortBy);
        setSortDirection(nextSortDirection);
        clearSelection();
    }

    function updateFilters(next: Partial<LibraryFilterState>): void {
        commitNavigation({ ...filters, ...next });
        setActiveFilterPanel(null);
        setFilterPanelSearch('');
    }

    // 三态标签：中性 → 含 → 排除 → 中性；保持面板打开以便连续多选。
    function toggleTagFilter(tagName: string): void {
        const include = new Set(filters.includeTags || []);
        const exclude = new Set(filters.excludeTags || []);
        if (include.has(tagName)) {
            include.delete(tagName);
            exclude.add(tagName);
        } else if (exclude.has(tagName)) {
            exclude.delete(tagName);
        } else {
            include.add(tagName);
        }
        commitNavigation({
            ...filters,
            includeTags: include.size > 0 ? Array.from(include) : undefined,
            excludeTags: exclude.size > 0 ? Array.from(exclude) : undefined
        });
    }

    function clearTagFilters(): void {
        updateFilters({ includeTags: undefined, excludeTags: undefined });
    }

    function selectNavigation(next: Partial<LibraryFilterState>): void {
        const nextFilters = { ...INITIAL_FILTERS, ...next };
        if (nextFilters.navigationMode === 'recent') {
            commitNavigation(nextFilters, 'modified', 'desc');
            return;
        }
        if (nextFilters.navigationMode === 'random') {
            commitNavigation({ ...nextFilters, randomSeed: Date.now() }, 'random', 'desc');
            return;
        }
        commitNavigation(nextFilters);
    }

    function changeSortBy(nextSortBy: EagleLibrarySortBy): void {
        const nextFilters: LibraryFilterState = {
            ...filters,
            navigationMode: undefined,
            randomSeed: nextSortBy === 'random' ? Date.now() : undefined
        };
        const nextDirection = nextSortBy === 'name' ? 'asc' : sortDirection;
        commitNavigation(nextFilters, nextSortBy, nextDirection);
    }

    function toggleSortDirection(): void {
        const nextDirection = sortDirection === 'asc' ? 'desc' : 'asc';
        commitNavigation({ ...filters, navigationMode: undefined }, sortBy, nextDirection);
    }

    function moveNavigationHistory(delta: number): void {
        const nextIndex = Math.max(0, Math.min(navigationHistory.length - 1, navigationIndex + delta));
        if (nextIndex === navigationIndex) return;
        setNavigationIndex(nextIndex);
        const nextState = navigationHistory[nextIndex];
        setFilters(nextState.filters);
        setSortBy(nextState.sortBy);
        setSortDirection(nextState.sortDirection);
        clearSelection();
    }

    // ── Inspector 双向编辑（P2）：编辑 → 安全闸门写回 Eagle API → 读回验证；离线转草稿 ──

    function buildDraftKey(itemId: string): string {
        return `eagle-writeback-draft:${library?.libraryId || 'unknown'}:${itemId}`;
    }

    async function startInspectorEdit(item: EagleLibraryItem): Promise<void> {
        const baseline: InspectorEditValues = {
            tags: [...item.tags],
            annotation: item.annotation || '',
            rating: item.rating || 0
        };
        let draft: InspectorEditValues | null = null;
        const invoke = window.designEcho?.invoke;
        if (typeof invoke === 'function') {
            const stored = await invoke('state:getPersistedValue', buildDraftKey(item.id));
            if (stored?.success && stored.value && typeof stored.value === 'object') {
                const candidate = stored.value as Partial<InspectorEditValues>;
                draft = {
                    tags: Array.isArray(candidate.tags) ? candidate.tags.map(String) : baseline.tags,
                    annotation: typeof candidate.annotation === 'string' ? candidate.annotation : baseline.annotation,
                    rating: Number.isFinite(Number(candidate.rating)) ? Number(candidate.rating) : baseline.rating
                };
            }
        }
        setInspectorEdit({
            itemId: item.id,
            baseline,
            tags: draft ? draft.tags : [...baseline.tags],
            tagDraft: '',
            annotation: draft ? draft.annotation : baseline.annotation,
            rating: draft ? draft.rating : baseline.rating,
            saving: false,
            fromDraft: Boolean(draft),
            feedback: draft
                ? { kind: 'draft', message: '已恢复上次未提交的离线草稿；保存成功后草稿会被清除。' }
                : null
        });
    }

    function patchItemMetadata(itemId: string, values: InspectorEditValues): void {
        setItems((current) => current.map((item) => (
            item.id === itemId
                ? { ...item, tags: [...values.tags], annotation: values.annotation || undefined, rating: values.rating }
                : item
        )));
        setSelectedItem((current) => (
            current && current.id === itemId
                ? { ...current, tags: [...values.tags], annotation: values.annotation || undefined, rating: values.rating }
                : current
        ));
    }

    async function handleInspectorSave(): Promise<void> {
        if (!inspectorEdit || inspectorEdit.saving) return;
        const edits: InspectorEditValues = {
            tags: inspectorEdit.tags,
            annotation: inspectorEdit.annotation.trim(),
            rating: inspectorEdit.rating
        };
        const bridge = window.designEcho?.executeEagleInspectorWriteback;
        if (typeof bridge !== 'function') {
            setInspectorEdit((current) => current && ({
                ...current,
                feedback: { kind: 'error', message: 'Eagle 写回桥不可用：当前应用版本较旧，请重启应用加载最新构建。' }
            }));
            return;
        }
        setInspectorEdit((current) => current && ({ ...current, saving: true, feedback: null }));
        const result = await bridge({
            itemId: inspectorEdit.itemId,
            baseline: inspectorEdit.baseline,
            edits,
            userConfirmed: true
        });
        const invoke = window.designEcho?.invoke;

        if (result.status === 'ok' || result.status === 'no_changes') {
            const finalValues = result.currentValues
                ? { tags: result.currentValues.tags, annotation: result.currentValues.annotation, rating: result.currentValues.rating }
                : edits;
            if (result.status === 'ok') patchItemMetadata(inspectorEdit.itemId, finalValues);
            if (typeof invoke === 'function') {
                await invoke('state:removePersistedValue', buildDraftKey(inspectorEdit.itemId));
            }
            setInspectorEdit(null);
            return;
        }
        if (result.status === 'conflict') {
            const currentValues = result.currentValues;
            setInspectorEdit((current) => current && ({
                ...current,
                saving: false,
                ...(currentValues ? { baseline: currentValues } : {}),
                feedback: {
                    kind: 'conflict',
                    message: '素材在编辑期间已在 Eagle 中被修改。已把冲突基线更新为 Eagle 最新值：请核对你的修改后重新保存。'
                }
            }));
            return;
        }
        if (result.status === 'eagle_offline') {
            if (typeof invoke === 'function') {
                await invoke('state:setPersistedValue', buildDraftKey(inspectorEdit.itemId), edits);
            }
            setInspectorEdit((current) => current && ({
                ...current,
                saving: false,
                feedback: {
                    kind: 'draft',
                    message: 'Eagle 当前不在线：修改已存为本地草稿，等 Eagle 运行后再进入编辑即可恢复并提交。'
                }
            }));
            return;
        }
        setInspectorEdit((current) => current && ({
            ...current,
            saving: false,
            feedback: { kind: 'error', message: result.error || 'Eagle 写回失败，请稍后重试。' }
        }));
    }

    function addInspectorTag(): void {
        setInspectorEdit((current) => {
            if (!current) return current;
            const tag = current.tagDraft.trim();
            if (!tag || current.tags.includes(tag)) return { ...current, tagDraft: '' };
            return { ...current, tags: [...current.tags, tag], tagDraft: '' };
        });
    }

    function clearSelection(): void {
        setInspectorEdit(null);
        setSelectedIds(new Set());
        setSelectedItem(null);
        setSelectionAnchorId(undefined);
        preserveLocalMultiSelectionRef.current = false;
        onSelectionChange(null);
    }

    function handleSearchDraftChange(value: string): void {
        setSearchDraft(value);
        clearSelection();
    }

    function applySelection(nextIds: Set<string>, primaryItem: EagleLibraryItem | null, anchorId?: string): void {
        setSelectedIds(nextIds);
        setSelectedItem(primaryItem);
        setSelectionAnchorId(anchorId);
        if (!library || nextIds.size !== 1) {
            preserveLocalMultiSelectionRef.current = nextIds.size > 1 && Boolean(selectedItemId);
            // 多选（P4）：以路径安全引用集传出，作为一组参考/候选；不指定唯一目标
            const group = library && nextIds.size > 1
                ? items
                    .filter((item) => nextIds.has(item.id))
                    .slice(0, EAGLE_ASSET_GROUP_LIMIT)
                    .map((item) => buildEagleLibrarySelectionContext(library, item).assetRef)
                : undefined;
            onSelectionChange(null, group && group.length > 0 ? group : undefined);
            return;
        }
        const onlyItem = items.find((item) => nextIds.has(item.id)) || primaryItem;
        if (!onlyItem) {
            onSelectionChange(null);
            return;
        }
        preserveLocalMultiSelectionRef.current = false;
        onSelectionChange(buildEagleLibrarySelectionContext(library, onlyItem));
    }

    function selectSingleItem(item: EagleLibraryItem, focusCard = false): void {
        applySelection(new Set([item.id]), item, item.id);
        if (focusCard) {
            window.requestAnimationFrame(() => {
                const card = itemRefs.current.get(item.id);
                card?.focus({ preventScroll: true });
                card?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
            });
        }
    }

    function handleSelectItem(item: EagleLibraryItem, event: React.MouseEvent<HTMLButtonElement>): void {
        if (event.shiftKey && selectionAnchorId) {
            const anchorIndex = items.findIndex((candidate) => candidate.id === selectionAnchorId);
            const itemIndex = items.findIndex((candidate) => candidate.id === item.id);
            if (anchorIndex >= 0 && itemIndex >= 0) {
                const start = Math.min(anchorIndex, itemIndex);
                const end = Math.max(anchorIndex, itemIndex);
                const nextIds = new Set(items.slice(start, end + 1).map((candidate) => candidate.id));
                applySelection(nextIds, item, selectionAnchorId);
                return;
            }
        }
        if (event.ctrlKey || event.metaKey) {
            const nextIds = new Set(selectedIds);
            if (nextIds.has(item.id)) nextIds.delete(item.id);
            else nextIds.add(item.id);
            const nextPrimary = nextIds.has(item.id)
                ? item
                : items.find((candidate) => nextIds.has(candidate.id)) || null;
            applySelection(nextIds, nextPrimary, item.id);
            return;
        }
        selectSingleItem(item);
    }

    function toggleFolder(folderId: string): void {
        setExpandedFolderIds((current) => {
            const next = new Set(current);
            if (next.has(folderId)) next.delete(folderId);
            else next.add(folderId);
            return next;
        });
    }

    function toggleFilterPanel(panel: Exclude<FilterPanel, null>): void {
        setActiveFilterPanel((current) => current === panel ? null : panel);
        setFilterPanelSearch('');
    }

    function handleGalleryWheel(event: React.WheelEvent<HTMLDivElement>): void {
        if (!event.ctrlKey && !event.metaKey) return;
        event.preventDefault();
        setZoom((current) => clampZoom(current + (event.deltaY < 0 ? 1 : -1)));
    }

    function closePreview(): void {
        const closingId = previewItem?.id;
        setPreviewItem(null);
        window.requestAnimationFrame(() => {
            if (closingId) itemRefs.current.get(closingId)?.focus({ preventScroll: true });
        });
    }

    function movePreview(delta: number): void {
        if (!previewItem || items.length === 0) return;
        const currentIndex = items.findIndex((item) => item.id === previewItem.id);
        const nextIndex = Math.max(0, Math.min(items.length - 1, currentIndex + delta));
        setPreviewItem(items[nextIndex]);
        selectSingleItem(items[nextIndex]);
    }

    function handlePreviewKeyDown(event: React.KeyboardEvent<HTMLDivElement>): void {
        if (event.key !== 'Tab') return;
        const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
        if (focusable.length === 0) return;
        const currentIndex = focusable.indexOf(document.activeElement as HTMLButtonElement);
        let nextIndex = event.shiftKey ? currentIndex - 1 : currentIndex + 1;
        if (currentIndex < 0) nextIndex = event.shiftKey ? focusable.length - 1 : 0;
        if (nextIndex < 0) nextIndex = focusable.length - 1;
        if (nextIndex >= focusable.length) nextIndex = 0;
        event.preventDefault();
        focusable[nextIndex]?.focus();
    }

    function renderFilterPopover(): React.ReactElement | null {
        if (!activeFilterPanel) return null;
        const searchTerm = filterPanelSearch.trim().toLocaleLowerCase('zh-CN');
        return (
            <div className="eagle-filter-popover" role="dialog" aria-label="素材筛选">
                {(activeFilterPanel === 'tag' || activeFilterPanel === 'folder') && (
                    <label className="eagle-filter-search">
                        <Search size={13} />
                        <input
                            autoFocus
                            value={filterPanelSearch}
                            onChange={(event) => setFilterPanelSearch(event.target.value)}
                            placeholder={activeFilterPanel === 'tag' ? '筛选标签' : '筛选文件夹'}
                        />
                    </label>
                )}
                {activeFilterPanel === 'color' && (
                    <div className="eagle-color-options">
                        <button type="button" className={!filters.dominantColor ? 'selected' : ''} onClick={() => updateFilters({ dominantColor: undefined })}>全部</button>
                        {COLOR_OPTIONS.map((color) => (
                            <button
                                key={color.id}
                                type="button"
                                className={filters.dominantColor === color.id ? 'selected' : ''}
                                onClick={() => updateFilters({ dominantColor: color.id })}
                                title={color.label}
                                aria-label={color.label}
                            >
                                <span style={{ backgroundColor: color.value }} />
                            </button>
                        ))}
                    </div>
                )}
                {activeFilterPanel === 'tag' && (
                    <div className="eagle-filter-option-list">
                        <div className="eagle-tag-toolbar">
                            <span className="eagle-tag-hint">点击循环：中性 → 含 → 排除</span>
                            {(filters.includeTags?.length || filters.excludeTags?.length)
                                ? <button type="button" className="eagle-tag-clear" onClick={clearTagFilters}>清除标签</button>
                                : null}
                        </div>
                        <div className="eagle-tag-grid">
                            {(library?.tags || [])
                                .filter((tag) => !searchTerm || tag.name.toLocaleLowerCase('zh-CN').includes(searchTerm))
                                .slice(0, 200)
                                .map((tag) => {
                                    const state = (filters.includeTags || []).includes(tag.name)
                                        ? 'include'
                                        : (filters.excludeTags || []).includes(tag.name)
                                            ? 'exclude'
                                            : '';
                                    const count = facetTagCounts.get(tag.name) ?? tag.count;
                                    return (
                                        <button
                                            key={tag.name}
                                            type="button"
                                            className={`eagle-tag-toggle ${state}`.trim()}
                                            aria-pressed={state !== ''}
                                            onClick={() => toggleTagFilter(tag.name)}
                                            title={state === 'include'
                                                ? '已包含（点击改为排除）'
                                                : state === 'exclude'
                                                    ? '已排除（点击取消）'
                                                    : '点击包含此标签'}
                                        >
                                            <span className="eagle-tag-name">{tag.name}</span>
                                            <small>{formatCount(count)}</small>
                                        </button>
                                    );
                                })}
                        </div>
                    </div>
                )}
                {activeFilterPanel === 'folder' && (
                    <div className="eagle-filter-option-list">
                        <button type="button" className={!filters.folderId ? 'selected' : ''} onClick={() => updateFilters({ folderId: undefined, folderName: undefined })}>全部文件夹</button>
                        {flatFolders
                            .filter((folder) => !searchTerm || folder.path.toLocaleLowerCase('zh-CN').includes(searchTerm))
                            .slice(0, 100)
                            .map((folder) => (
                                <button key={folder.id} type="button" className={filters.folderId === folder.id ? 'selected' : ''} onClick={() => updateFilters({ folderId: folder.id, folderName: folder.name })} title={folder.path}>
                                    <span>{folder.path}</span><small>{formatCount(folder.count)}</small>
                                </button>
                            ))}
                    </div>
                )}
                {activeFilterPanel === 'shape' && (
                    <div className="eagle-filter-option-grid">
                        {(Object.keys(SHAPE_LABELS) as EagleLibraryShape[]).map((shape) => (
                            <button key={shape} type="button" className={filters.shape === shape ? 'selected' : ''} onClick={() => updateFilters({ shape })}>{SHAPE_LABELS[shape]}</button>
                        ))}
                    </div>
                )}
                {activeFilterPanel === 'rating' && (
                    <div className="eagle-rating-options">
                        {[0, 1, 2, 3, 4, 5].map((rating) => (
                            <button key={rating} type="button" className={filters.minimumRating === rating ? 'selected' : ''} onClick={() => updateFilters({ minimumRating: rating })}>
                                {rating === 0 ? '全部评分' : <>{Array.from({ length: rating }, (_, index) => <Star key={index} size={12} fill="currentColor" />)}<span>及以上</span></>}
                            </button>
                        ))}
                    </div>
                )}
                {activeFilterPanel === 'format' && (
                    <div className="eagle-filter-option-grid format-grid">
                        <button type="button" className={!filters.extension ? 'selected' : ''} onClick={() => updateFilters({ extension: undefined, fileKind: 'all' })}>全部格式</button>
                        {extensionOptions.map((extension) => (
                            <button key={extension} type="button" className={filters.extension === extension ? 'selected' : ''} onClick={() => updateFilters({ extension, fileKind: 'all' })}>{extension.toUpperCase()}</button>
                        ))}
                    </div>
                )}
                {activeFilterPanel === 'role' && (
                    <div className="eagle-filter-option-list">
                        <button type="button" className={filters.role === 'all' ? 'selected' : ''} onClick={() => updateFilters({ role: 'all' })}>全部用途</button>
                        {(Object.keys(ROLE_LABELS) as EagleLibraryAssetRole[]).map((role) => (
                            <button key={role} type="button" className={filters.role === role ? 'selected' : ''} onClick={() => updateFilters({ role })}>
                                <span>{ROLE_LABELS[role]}</span><small>{formatCount(library?.roleCounts[role] || 0)}</small>
                            </button>
                        ))}
                    </div>
                )}
                <button type="button" className="eagle-filter-popover-close" aria-label="关闭筛选" onClick={() => setActiveFilterPanel(null)}><X size={13} /></button>
            </div>
        );
    }

    if (!library) {
        return (
            <section className="eagle-library-page eagle-library-empty" aria-label="Eagle 素材库">
                <div className="eagle-empty-mark"><Library size={30} strokeWidth={1.35} /></div>
                <h2>导入 Eagle 素材库</h2>
                <p>直接读取本机 <code>.library</code>，无需启动 Eagle。文件夹、标签、模板与参考素材会保留原有结构。</p>
                <button type="button" className="eagle-primary-button" onClick={() => void handleSelectLibrary()} disabled={loadingLibrary}>
                    {loadingLibrary ? <LoaderCircle className="spin" size={15} /> : <FolderOpen size={15} />}
                    选择 .library 文件夹
                </button>
                {error && <div className="eagle-inline-error">{error}</div>}
                <small>只读导入，不修改 Eagle 数据，也不会自动打开 Eagle。</small>
            </section>
        );
    }

    const pageClasses = [
        'eagle-library-page',
        sidebarOpen ? '' : 'sidebar-collapsed',
        inspectorOpen ? '' : 'inspector-collapsed'
    ].filter(Boolean).join(' ');
    const zoomProgress = `${((zoom - ZOOM_MIN) / (ZOOM_MAX - ZOOM_MIN)) * 100}%`;

    return (
        <section className={pageClasses} aria-label="Eagle 素材库">
            <aside className="eagle-library-sidebar" aria-label="Eagle 素材导航">
                <div className="eagle-library-identity">
                    <button type="button" className="eagle-icon-button" aria-label="收起素材库导航" onClick={() => setSidebarOpen(false)}><Menu size={16} /></button>
                    <span className="eagle-library-logo"><Library size={16} strokeWidth={1.55} /></span>
                    <strong title={library.path}>{library.name}</strong>
                    <button type="button" className="eagle-library-switch" onClick={() => void handleSelectLibrary()} title="切换素材库"><ChevronDown size={13} /></button>
                </div>

                <div className="eagle-sidebar-scroll">
                    <nav className="eagle-sidebar-nav" aria-label="素材范围">
                        <button type="button" className={activeTitle === '全部' ? 'active' : ''} onClick={() => selectNavigation({})}><Images size={15} /><span>全部</span><small>{formatCount(library.activeItemCount)}</small></button>
                        <button type="button" className={filters.unclassifiedOnly ? 'active' : ''} onClick={() => selectNavigation({ unclassifiedOnly: true })}><FileImage size={15} /><span>未分类</span><small>{formatCount(library.unclassifiedCount)}</small></button>
                        <button type="button" className={filters.untaggedOnly ? 'active' : ''} onClick={() => selectNavigation({ untaggedOnly: true })}><Tags size={15} /><span>未标签</span><small>{formatCount(library.untaggedCount)}</small></button>
                        <button type="button" className={filters.navigationMode === 'recent' ? 'active' : ''} onClick={() => selectNavigation({ navigationMode: 'recent' })}><Clock3 size={15} /><span>最近使用</span></button>
                        <button type="button" className={filters.navigationMode === 'random' ? 'active' : ''} onClick={() => selectNavigation({ navigationMode: 'random' })}><Shuffle size={15} /><span>随机模式</span></button>
                        <button type="button" className="readonly-navigation" disabled title="离线直读模式不连接 Eagle 资源社区"><Library size={15} /><span>资源社区</span></button>
                        <button type="button" className="readonly-navigation" disabled title="离线直读模式不写回 Eagle 标签"><Tags size={15} /><span>标签管理</span><small>{formatCount(library.tagCount)}</small></button>
                        <button type="button" className={filters.deletedOnly ? 'active' : ''} onClick={() => selectNavigation({ deletedOnly: true })}><Trash2 size={15} /><span>回收站</span><small>{formatCount(library.deletedCount)}</small></button>
                    </nav>

                    <div className="eagle-sidebar-section">
                        <div className="eagle-sidebar-heading"><span>智能文件夹</span></div>
                        {(['reference', 'main_image_template', 'detail_page_template', 'sku_template'] as EagleLibraryAssetRole[]).map((role) => (
                            <button key={role} type="button" className={`eagle-role-shortcut ${filters.role === role ? 'active' : ''}`} onClick={() => selectNavigation({ role })}>
                                {getRoleIcon(role)}<span>{ROLE_LABELS[role]}</span><small>{formatCount(library.roleCounts[role])}</small>
                            </button>
                        ))}
                    </div>

                    <div className="eagle-sidebar-section eagle-folder-section">
                        <div className="eagle-sidebar-heading"><span>文件夹</span><small>{formatCount(library.folderCount)}</small></div>
                        <FolderTree
                            nodes={visibleFolderTree}
                            selectedFolderId={filters.folderId}
                            expandedFolderIds={expandedFolderIds}
                            onToggle={toggleFolder}
                            onSelect={(folder) => selectNavigation({ folderId: folder.id, folderName: folder.name })}
                        />
                    </div>
                </div>

                <label className="eagle-sidebar-filter">
                    <SlidersHorizontal size={14} />
                    <input value={folderTreeSearch} onChange={(event) => setFolderTreeSearch(event.target.value)} placeholder="筛选" />
                    {folderTreeSearch && <button type="button" aria-label="清空文件夹筛选" onClick={() => setFolderTreeSearch('')}><X size={12} /></button>}
                </label>
            </aside>

            <div className="eagle-library-main">
                <header className="eagle-main-header">
                    <div className="eagle-library-toolbar">
                        {!sidebarOpen && <button type="button" className="eagle-icon-button" aria-label="展开素材库导航" onClick={() => setSidebarOpen(true)}><Menu size={16} /></button>}
                        <button type="button" className="eagle-icon-button" aria-label="返回上一个筛选" disabled={navigationIndex === 0} onClick={() => moveNavigationHistory(-1)}><ArrowLeft size={15} /></button>
                        <button type="button" className="eagle-icon-button" aria-label="前往下一个筛选" disabled={navigationIndex >= navigationHistory.length - 1} onClick={() => moveNavigationHistory(1)}><ArrowRight size={15} /></button>
                        <div className="eagle-toolbar-title"><strong>{activeTitle}</strong><small>{formatCount(total)}</small></div>

                        <div className="eagle-zoom-control" aria-label="缩略图大小">
                            <button type="button" aria-label="缩小缩略图" disabled={zoom === ZOOM_MIN} onClick={() => setZoom((current) => clampZoom(current - 1))}><Minus size={11} strokeWidth={1.35} /></button>
                            <input
                                type="range"
                                min={ZOOM_MIN}
                                max={ZOOM_MAX}
                                step="1"
                                value={zoom}
                                style={{ '--eagle-zoom-progress': zoomProgress } as React.CSSProperties}
                                onChange={(event) => setZoom(clampZoom(Number(event.target.value)))}
                            />
                            <button type="button" aria-label="放大缩略图" disabled={zoom === ZOOM_MAX} onClick={() => setZoom((current) => clampZoom(current + 1))}><Plus size={11} strokeWidth={1.35} /></button>
                        </div>

                        <div className="eagle-toolbar-actions">
                            <select className="eagle-sort-select" aria-label="排序方式" value={sortBy} onChange={(event) => changeSortBy(event.target.value as EagleLibrarySortBy)}>
                                <option value="modified">修改时间</option>
                                <option value="created">创建时间</option>
                                <option value="name">名称</option>
                                <option value="size">文件大小</option>
                                <option value="random">随机</option>
                            </select>
                            <button type="button" className="eagle-icon-button" aria-label="切换排序方向" onClick={toggleSortDirection}><SlidersHorizontal size={14} /></button>
                            <button type="button" className="eagle-icon-button" aria-label="刷新素材库" onClick={() => void handleRefreshLibrary()} disabled={loadingLibrary}><RefreshCw className={loadingLibrary ? 'spin' : ''} size={14} /></button>
                            <div className="eagle-view-toggle" role="group" aria-label="视图">
                                <button type="button" className={viewMode === 'grid' ? 'active' : ''} onClick={() => setViewMode('grid')} aria-label="网格视图"><Grid3X3 size={14} /></button>
                                <button type="button" className={viewMode === 'list' ? 'active' : ''} onClick={() => setViewMode('list')} aria-label="列表视图"><List size={14} /></button>
                            </div>
                            <button type="button" className={`eagle-icon-button ${inspectorOpen ? 'active' : ''}`} aria-label={inspectorOpen ? '收起素材信息' : '展开素材信息'} onClick={() => setInspectorOpen((current) => !current)}><FileText size={14} /></button>
                            <label className="eagle-search-box">
                                <Search size={14} />
                                <input ref={searchInputRef} value={searchDraft} onChange={(event) => handleSearchDraftChange(event.target.value)} placeholder="搜索" />
                                {searchDraft && <button type="button" aria-label="清空搜索" onClick={() => handleSearchDraftChange('')}><X size={12} /></button>}
                            </label>
                        </div>
                    </div>

                    <div className="eagle-filter-toolbar" aria-label="素材筛选">
                        <button type="button" className={filters.dominantColor ? 'active' : ''} onClick={() => toggleFilterPanel('color')}><Palette size={14} /><span>颜色</span></button>
                        <button type="button" className={(filters.includeTags?.length || filters.excludeTags?.length) ? 'active' : ''} onClick={() => toggleFilterPanel('tag')}><Tags size={14} /><span>{
                            !(filters.includeTags?.length || filters.excludeTags?.length)
                                ? '标签'
                                : (filters.includeTags?.length === 1 && !filters.excludeTags?.length)
                                    ? filters.includeTags[0]
                                    : `标签 ${(filters.includeTags?.length || 0) + (filters.excludeTags?.length || 0)}`
                        }</span></button>
                        <button type="button" className={filters.folderId ? 'active' : ''} onClick={() => toggleFilterPanel('folder')}><Folder size={14} /><span>{filters.folderName || '文件夹'}</span></button>
                        <button type="button" className={filters.shape !== 'all' ? 'active' : ''} onClick={() => toggleFilterPanel('shape')}><Grid3X3 size={14} /><span>{filters.shape === 'all' ? '形状' : SHAPE_LABELS[filters.shape]}</span></button>
                        <button type="button" className={filters.minimumRating > 0 ? 'active' : ''} onClick={() => toggleFilterPanel('rating')}><Star size={14} /><span>{filters.minimumRating > 0 ? `${filters.minimumRating} 星+` : '评分'}</span></button>
                        <button type="button" className={Boolean(filters.extension) ? 'active' : ''} onClick={() => toggleFilterPanel('format')}><File size={14} /><span>{filters.extension?.toUpperCase() || '格式'}</span></button>
                        <button type="button" className={filters.role !== 'all' ? 'active' : ''} onClick={() => toggleFilterPanel('role')}><LayoutTemplate size={14} /><span>{filters.role === 'all' ? '用途' : ROLE_LABELS[filters.role]}</span></button>
                        {hasActiveFilters(filters) && <button type="button" className="eagle-clear-filters" onClick={() => selectNavigation({})}><X size={13} /><span>清除</span></button>}
                    </div>
                    {renderFilterPopover()}
                </header>

                {error && <div className="eagle-library-error"><span>{error}</span><button type="button" onClick={() => setError('')}>关闭</button></div>}

                <div ref={resultsRef} className="eagle-library-results" onClick={(event) => {
                    if (!(event.target as Element).closest('.eagle-item-card')) clearSelection();
                }} onWheel={handleGalleryWheel}>
                    {loadingItems && items.length === 0 ? (
                        <div className="eagle-results-state"><LoaderCircle className="spin" size={22} /><span>正在读取素材库索引…</span></div>
                    ) : items.length === 0 ? (
                        <div className="eagle-results-state"><Search size={22} /><span>没有符合当前条件的素材</span><button type="button" onClick={() => { setFilters(INITIAL_FILTERS); handleSearchDraftChange(''); }}>清除筛选</button></div>
                    ) : (
                        <>
                            {viewMode === 'grid' ? (
                                <div className="eagle-item-collection grid" aria-label="素材网格">
                                    {justifiedRows.map((row, rowIndex) => (
                                        <div className="eagle-justified-row" key={`${row.entries[0]?.item.id || rowIndex}:${row.entries.length}`} style={{ gap: `${JUSTIFIED_GAP}px` }}>
                                            {row.entries.map(({ item, width }) => (
                                                <AssetCard
                                                    key={item.id}
                                                    libraryPath={library.path}
                                                    item={item}
                                                    width={width}
                                                    mediaHeight={row.height}
                                                    selected={selectedIds.has(item.id)}
                                                    primary={selectedItem?.id === item.id}
                                                    cardRef={(node) => {
                                                        if (node) itemRefs.current.set(item.id, node);
                                                        else itemRefs.current.delete(item.id);
                                                    }}
                                                    onClick={(event) => handleSelectItem(item, event)}
                                                    onDoubleClick={() => setPreviewItem(item)}
                                                />
                                            ))}
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div className="eagle-item-collection list" aria-label="素材列表">
                                    {items.map((item) => (
                                        <AssetCard
                                            key={item.id}
                                            libraryPath={library.path}
                                            item={item}
                                            listMode
                                            selected={selectedIds.has(item.id)}
                                            primary={selectedItem?.id === item.id}
                                            cardRef={(node) => {
                                                if (node) itemRefs.current.set(item.id, node);
                                                else itemRefs.current.delete(item.id);
                                            }}
                                            onClick={(event) => handleSelectItem(item, event)}
                                            onDoubleClick={() => setPreviewItem(item)}
                                        />
                                    ))}
                                </div>
                            )}
                            {items.length < total && (
                                <button type="button" className="eagle-load-more" onClick={(event) => { event.stopPropagation(); void handleLoadMore(); }} disabled={loadingMore}>
                                    {loadingMore ? <LoaderCircle className="spin" size={14} /> : null}
                                    载入更多 · 已显示 {formatCount(items.length)} / {formatCount(total)}
                                </button>
                            )}
                        </>
                    )}
                </div>
            </div>

            <aside className="eagle-inspector" aria-label="素材信息">
                {selectedIds.size > 1 ? (
                    <div className="eagle-multi-selection">
                        <Images size={30} />
                        <strong>已选择 {formatCount(selectedIds.size)} 个素材</strong>
                        <span>
                            已作为素材集提供给 Agent（一组参考/候选，不指定唯一目标
                            {selectedIds.size > EAGLE_ASSET_GROUP_LIMIT ? `；超过 ${EAGLE_ASSET_GROUP_LIMIT} 项只取前 ${EAGLE_ASSET_GROUP_LIMIT} 项` : ''}）。
                            需要绑定唯一目标时请只保留一个素材。
                        </span>
                        <button type="button" onClick={clearSelection}>取消选择</button>
                    </div>
                ) : selectedItem ? (
                    <>
                        <div className="eagle-inspector-preview">
                            <LibraryThumbnail libraryPath={library.path} item={selectedItem} size={820} />
                            <span className={`eagle-format-badge format-${selectedItem.ext.toLowerCase()}`}>{selectedItem.ext.toUpperCase()}</span>
                            <button type="button" className="eagle-inspector-expand" aria-label="打开大图预览" onClick={() => setPreviewItem(selectedItem)}><Maximize2 size={14} /></button>
                        </div>
                        <div className="eagle-inspector-scroll">
                            {selectedItem.palettes.length > 0 && (
                                <div className="eagle-inspector-palette" aria-label="素材色板">
                                    {selectedItem.palettes.slice(0, 10).map((palette, index) => <span key={`${palette.color.join('-')}-${index}`} style={{ backgroundColor: `rgb(${palette.color.join(',')})` }} />)}
                                </div>
                            )}
                            <div className="eagle-readonly-field title-field"><Lock size={12} /><span>{selectedItem.name}</span></div>
                            {inspectorEdit && inspectorEdit.itemId === selectedItem.id ? (
                                <div className="eagle-inspector-edit" aria-label="编辑素材元数据">
                                    <label className="eagle-edit-annotation">
                                        <span>注释</span>
                                        <textarea
                                            value={inspectorEdit.annotation}
                                            maxLength={800}
                                            rows={3}
                                            placeholder="给这个素材写注释"
                                            onChange={(event) => setInspectorEdit((current) => current && ({ ...current, annotation: event.target.value }))}
                                        />
                                    </label>
                                    <div className="eagle-edit-tags">
                                        <span>标签</span>
                                        <div className="eagle-edit-tag-chips">
                                            {inspectorEdit.tags.map((tag) => (
                                                <button
                                                    type="button"
                                                    key={tag}
                                                    title="移除标签"
                                                    onClick={() => setInspectorEdit((current) => current && ({ ...current, tags: current.tags.filter((entry) => entry !== tag) }))}
                                                >
                                                    {tag}<X size={11} />
                                                </button>
                                            ))}
                                            <input
                                                value={inspectorEdit.tagDraft}
                                                placeholder="添加标签后回车"
                                                onChange={(event) => setInspectorEdit((current) => current && ({ ...current, tagDraft: event.target.value }))}
                                                onKeyDown={(event) => {
                                                    if (event.key === 'Enter') {
                                                        event.preventDefault();
                                                        addInspectorTag();
                                                    }
                                                }}
                                            />
                                        </div>
                                    </div>
                                    <div className="eagle-edit-rating">
                                        <span>评分</span>
                                        <div>
                                            {Array.from({ length: 5 }, (_, index) => (
                                                <button
                                                    type="button"
                                                    key={index}
                                                    aria-label={`${index + 1} 星`}
                                                    onClick={() => setInspectorEdit((current) => current && ({
                                                        ...current,
                                                        rating: current.rating === index + 1 ? 0 : index + 1
                                                    }))}
                                                >
                                                    <Star size={15} fill={index < inspectorEdit.rating ? 'currentColor' : 'none'} />
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                    {inspectorEdit.feedback && (
                                        <div className={`eagle-edit-feedback ${inspectorEdit.feedback.kind}`}>{inspectorEdit.feedback.message}</div>
                                    )}
                                    <div className="eagle-edit-actions">
                                        <button type="button" className="eagle-edit-save" disabled={inspectorEdit.saving} onClick={() => void handleInspectorSave()}>
                                            {inspectorEdit.saving ? <LoaderCircle className="spin" size={13} /> : null}
                                            保存到 Eagle
                                        </button>
                                        <button type="button" className="eagle-edit-cancel" disabled={inspectorEdit.saving} onClick={() => setInspectorEdit(null)}>取消</button>
                                    </div>
                                    <small className="eagle-edit-note">保存经安全闸门写回运行中的 Eagle（不直接改 .library 文件）；写入前检查冲突、写入后读回验证。</small>
                                </div>
                            ) : (
                                <>
                                    <div className="eagle-readonly-field annotation-field"><span>{selectedItem.annotation || '添加注释'}</span><Lock size={12} /></div>
                                    {selectedItem.sourceUrl && <div className="eagle-readonly-field url-field"><span>{selectedItem.sourceUrl}</span><Link2 size={13} /></div>}

                                    <div className="eagle-inspector-section">
                                        <h3>
                                            <span>标签</span>
                                            <button type="button" className="eagle-inspector-edit-toggle" title="编辑标签、注释与评分" onClick={() => void startInspectorEdit(selectedItem)}>
                                                <Pencil size={11} />
                                            </button>
                                        </h3>
                                        <div className="eagle-inspector-tags">
                                            {selectedItem.tags.length > 0
                                                ? selectedItem.tags.map((tag) => <button type="button" key={tag} onClick={() => selectNavigation({ includeTags: [tag] })}>{tag}</button>)
                                                : <span className="empty-chip">无标签</span>}
                                        </div>
                                    </div>
                                </>
                            )}
                            <div className="eagle-inspector-section">
                                <h3><span>文件夹</span><Lock size={11} /></h3>
                                <div className="eagle-inspector-tags folder-chips">
                                    {selectedItem.folderPaths.length > 0
                                        ? selectedItem.folderPaths.map((path, index) => {
                                            const segments = path.split(' / ');
                                            return <button type="button" key={path} onClick={() => selectNavigation({ folderId: selectedItem.folderIds[index], folderName: segments[segments.length - 1] || path })}>{path}</button>;
                                        })
                                        : <span className="empty-chip">未分类</span>}
                                </div>
                            </div>

                            <div className="eagle-inspector-section eagle-basic-info">
                                <h3>基本信息</h3>
                                <dl className="eagle-inspector-meta">
                                    <div><dt>评分</dt><dd className="eagle-stars">{Array.from({ length: 5 }, (_, index) => <Star key={index} size={12} fill={index < (selectedItem.rating || 0) ? 'currentColor' : 'none'} />)}</dd></div>
                                    <div><dt>尺寸</dt><dd>{selectedItem.width && selectedItem.height ? `${selectedItem.width} × ${selectedItem.height}` : '未知'}</dd></div>
                                    <div><dt>文件大小</dt><dd>{formatBytes(selectedItem.size)}</dd></div>
                                    <div><dt>格式</dt><dd>{selectedItem.ext.toUpperCase()}</dd></div>
                                    <div><dt>添加日期</dt><dd>{formatDate(selectedItem.createdAt)}</dd></div>
                                    <div><dt>修改日期</dt><dd>{formatDate(selectedItem.modifiedAt)}</dd></div>
                                </dl>
                            </div>
                            <button type="button" className="eagle-inspector-use" onClick={() => selectSingleItem(selectedItem)}><Plus size={14} />用于当前设计</button>
                            <div className="eagle-source-note">
                                <span>{selectedItemId === selectedItem.id ? '已关联到当前任务' : '当前仅在素材库中选中'}</span>
                                <small>素材库保持只读；视觉结论仍需 Agent 实际看图，选择不会授予 Photoshop 权限。</small>
                            </div>
                        </div>
                    </>
                ) : (
                    <div className="eagle-inspector-empty"><FileImage size={24} /><span>选择一个素材查看信息</span><small>单选后可关联到右侧 Agent 对话；Ctrl 或 Shift 可多选。</small></div>
                )}
            </aside>

            {previewItem && (
                <div className="eagle-preview-overlay" role="dialog" aria-modal="true" aria-label={`${previewItem.name} 大图预览`} onKeyDown={handlePreviewKeyDown} onMouseDown={(event) => {
                    if (event.target === event.currentTarget) closePreview();
                }}>
                    <button type="button" className="eagle-preview-close" ref={previewCloseRef} aria-label="关闭大图预览" onClick={closePreview}><X size={18} /></button>
                    <button type="button" className="eagle-preview-nav previous" aria-label="上一个素材" disabled={items[0]?.id === previewItem.id} onClick={() => movePreview(-1)}><ArrowLeft size={22} /></button>
                    <div className="eagle-preview-content">
                        <div className="eagle-preview-image"><LibraryThumbnail libraryPath={library.path} item={previewItem} size={1600} /></div>
                        <div className="eagle-preview-caption"><strong>{previewItem.name}</strong><span>{previewItem.ext.toUpperCase()}{previewItem.width && previewItem.height ? ` · ${previewItem.width} × ${previewItem.height}` : ''}</span></div>
                    </div>
                    <button type="button" className="eagle-preview-nav next" aria-label="下一个素材" disabled={items[items.length - 1]?.id === previewItem.id} onClick={() => movePreview(1)}><ArrowRight size={22} /></button>
                </div>
            )}
        </section>
    );
};

function resolveKeyboardMovement(key: string, itemsPerRow: number): number | undefined {
    switch (key) {
        case 'ArrowLeft': return -1;
        case 'ArrowRight': return 1;
        case 'ArrowUp': return -itemsPerRow;
        case 'ArrowDown': return itemsPerRow;
        case 'Home': return -Number.MAX_SAFE_INTEGER;
        case 'End': return Number.MAX_SAFE_INTEGER;
        default: return undefined;
    }
}
