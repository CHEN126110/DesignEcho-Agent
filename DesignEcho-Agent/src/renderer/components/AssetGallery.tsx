/**
 * 素材预览画廊组件
 * 
 * 展示项目中的素材图片，支持分组、筛选、预览
 */

import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import {
    useAppStore,
    EcommerceProjectStructure,
    FolderType,
    ImageType,
    FolderInfo,
    ImageFile
} from '../stores/app.store';
import {
    ASSET_ROLE_FILTERS,
    filterAssetImages,
    getAspectLabel,
    getAssetRole,
    getAssetRoleLabel,
    getImageDimensions,
    type AssetRoleFilter,
    type AssetSortBy
} from './asset-gallery-view-model';

// 文件夹类型标签配置 - 统一样式
const FOLDER_TYPE_CONFIG: Record<FolderType, { label: string; shortLabel: string; color: string }> = {
    source: { label: '素材', shortLabel: '源', color: '#9ca3af' },
    psd: { label: 'PSD', shortLabel: 'PSD', color: '#9ca3af' },
    mainImage: { label: '主图', shortLabel: '主', color: '#9ca3af' },
    detail: { label: '详情页', shortLabel: '详', color: '#9ca3af' },
    sku: { label: 'SKU', shortLabel: 'SKU', color: '#9ca3af' },
    unknown: { label: '未分类', shortLabel: '未', color: '#9ca3af' }
};

// 图片类型标签配置
const IMAGE_TYPE_CONFIG: Record<ImageType, { label: string; color: string; shortLabel: string }> = {
    product: { label: '产品图', color: '#10b981', shortLabel: '产' },
    model: { label: '模特图', color: '#f59e0b', shortLabel: '模' },
    detail: { label: '细节图', color: '#3b82f6', shortLabel: '细' },
    scene: { label: '场景图', color: '#8b5cf6', shortLabel: '景' },
    package: { label: '包装图', color: '#ec4899', shortLabel: '包' },
    material: { label: '材质图', color: '#14b8a6', shortLabel: '材' },
    psd: { label: 'PSD', color: '#0066ff', shortLabel: 'PSD' },
    design: { label: '设计文件', color: '#ff6600', shortLabel: '设' },
    video: { label: '视频', color: '#ff0066', shortLabel: '视' },
    unknown: { label: '未分类', color: '#6b7280', shortLabel: '未' }
};

// 格式化文件大小
function formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export interface AssetSelectionContext {
    readonly schemaVersion: 'asset-selection-context/v0';
    readonly path: string;
    readonly name: string;
    readonly relativePath: string;
    readonly folderType: FolderType;
    readonly imageType: ImageType;
    readonly width?: number;
    readonly height?: number;
}

interface AssetGalleryProps {
    onImageClick?: (image: ImageFile) => void;
    onAssetSelectionChange?: (selection: AssetSelectionContext) => void;
    selectedImagePath?: string;
    onFolderTypeChange?: (folderName: string, type: FolderType) => void;
    onImageTypeChange?: (imagePath: string, type: ImageType) => void;
}

function buildAssetSelectionContext(image: ImageFile): AssetSelectionContext {
    return {
        schemaVersion: 'asset-selection-context/v0',
        path: image.path,
        name: image.name,
        relativePath: image.relativePath,
        folderType: image.folderType,
        imageType: image.type,
        ...(typeof image.width === 'number' ? { width: image.width } : {}),
        ...(typeof image.height === 'number' ? { height: image.height } : {})
    };
}

function findFirstImageFolder(folders: FolderInfo[]): FolderInfo | null {
    for (const folder of folders) {
        if (folder.imageCount > 0) return folder;
        const child = findFirstImageFolder(folder.children || []);
        if (child) return child;
    }
    return null;
}

export const AssetGallery: React.FC<AssetGalleryProps> = ({
    onImageClick,
    onAssetSelectionChange,
    selectedImagePath,
    onFolderTypeChange,
    onImageTypeChange
}) => {
    const { ecommerceStructure, currentProject, setEcommerceStructure } = useAppStore();
    const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
    const [filterType, setFilterType] = useState<FolderType | 'all'>('all');
    const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
    const [previewImage, setPreviewImage] = useState<ImageFile | null>(null);
    const [previewData, setPreviewData] = useState<string | null>(null);
    const [previewLoading, setPreviewLoading] = useState(false);
    const [previewDimensions, setPreviewDimensions] = useState<{ width: number; height: number } | null>(null);
    const [thumbnails, setThumbnails] = useState<Record<string, string>>({});
    const [loadingThumbnails, setLoadingThumbnails] = useState<Set<string>>(new Set());
    const [failedThumbnails, setFailedThumbnails] = useState<Set<string>>(new Set());
    const [searchQuery, setSearchQuery] = useState('');
    const [sortBy, setSortBy] = useState<AssetSortBy>('name');
    const [assetRoleFilter, setAssetRoleFilter] = useState<AssetRoleFilter>('all');
    const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
    const [isScanningStructure, setIsScanningStructure] = useState(false);
    const [initialized, setInitialized] = useState(false);
    const [scanError, setScanError] = useState<string | null>(null);
    const thumbnailsRef = useRef<Record<string, string>>({});
    const loadingThumbnailsRef = useRef<Set<string>>(new Set());
    const failedThumbnailsRef = useRef<Set<string>>(new Set());

    // 递归收集所有有子文件夹的文件夹路径
    const collectExpandableFolders = useCallback((folders: FolderInfo[]): string[] => {
        const result: string[] = [];
        for (const folder of folders) {
            if (folder.children && folder.children.length > 0) {
                result.push(folder.relativePath);
                result.push(...collectExpandableFolders(folder.children));
            }
        }
        return result;
    }, []);

    // 当项目变化时重置初始化状态
    const projectPath = ecommerceStructure?.projectPath;
    useEffect(() => {
        setInitialized(false);
        setSelectedFolder(null);
        setThumbnails({});
        setLoadingThumbnails(new Set());
        setFailedThumbnails(new Set());
    }, [projectPath]);

    useEffect(() => {
        thumbnailsRef.current = thumbnails;
    }, [thumbnails]);

    useEffect(() => {
        loadingThumbnailsRef.current = loadingThumbnails;
    }, [loadingThumbnails]);

    useEffect(() => {
        failedThumbnailsRef.current = failedThumbnails;
    }, [failedThumbnails]);

    // 结构缺失保护：如果有当前项目但结构缺失/与当前项目不一致，自动补扫一次
    useEffect(() => {
        let cancelled = false;

        const shouldScan = !!currentProject?.path && (
            !ecommerceStructure || ecommerceStructure.projectPath !== currentProject.path
        );
        if (!shouldScan || !window.designEcho?.scanEcommerceProject) return;

        const scan = async () => {
            try {
                setIsScanningStructure(true);
                setScanError(null);
                const structure = await window.designEcho.scanEcommerceProject!(currentProject.path);
                if (!cancelled && structure) {
                    setEcommerceStructure(structure as EcommerceProjectStructure);
                }
            } catch (error: any) {
                if (!cancelled) {
                    setScanError(error?.message || '扫描项目结构失败');
                }
            } finally {
                if (!cancelled) setIsScanningStructure(false);
            }
        };

        scan();
        return () => { cancelled = true; };
    }, [currentProject?.path, ecommerceStructure?.projectPath, setEcommerceStructure]);
    // 初始化时自动展开所有文件夹
    useEffect(() => {
        if (ecommerceStructure && !initialized) {
            const expandable = collectExpandableFolders(ecommerceStructure.folders);
            if (expandable.length > 0) {
                setExpandedFolders(new Set(expandable));
            }
            const firstFolder = findFirstImageFolder(ecommerceStructure.folders);
            if (firstFolder) {
                setSelectedFolder(firstFolder.relativePath);
            }
            setInitialized(true);
        }
    }, [ecommerceStructure, initialized, collectExpandableFolders]);

    // 扁平化文件夹树（用于展示）
    const flattenFolders = useCallback((folders: FolderInfo[], depth = 0): FolderInfo[] => {
        const result: FolderInfo[] = [];
        for (const folder of folders) {
            result.push({ ...folder, depth });
            if (folder.children && folder.children.length > 0 && expandedFolders.has(folder.relativePath)) {
                result.push(...flattenFolders(folder.children, depth + 1));
            }
        }
        return result;
    }, [expandedFolders]);

    // 递归查找文件夹
    const findFolder = useCallback((folders: FolderInfo[], relativePath: string): FolderInfo | null => {
        for (const folder of folders) {
            if (folder.relativePath === relativePath) return folder;
            if (folder.children) {
                const found = findFolder(folder.children, relativePath);
                if (found) return found;
            }
        }
        return null;
    }, []);

    // 切换文件夹展开状态
    const toggleFolderExpand = useCallback((relativePath: string, e: React.MouseEvent) => {
        e.stopPropagation();
        setExpandedFolders(prev => {
            const next = new Set(prev);
            if (next.has(relativePath)) {
                next.delete(relativePath);
            } else {
                next.add(relativePath);
            }
            return next;
        });
    }, []);

    // 筛选后的文件夹（扁平化后）
    const filteredFolders = useMemo(() => {
        if (!ecommerceStructure) return [];
        
        // 先按类型筛选
        let folders = ecommerceStructure.folders;
        if (filterType !== 'all') {
            // 递归筛选匹配类型的文件夹
            const filterByType = (folders: FolderInfo[]): FolderInfo[] => {
                return folders.filter(f => {
                    const matchType = f.type === filterType;
                    const hasMatchingChildren = f.children && f.children.some(c => c.type === filterType);
                    return matchType || hasMatchingChildren;
                });
            };
            folders = filterByType(folders);
        }
        
        return flattenFolders(folders);
    }, [ecommerceStructure, filterType, flattenFolders]);

    // 当前选中文件夹的图片（支持搜索和排序）
    const currentImages = useMemo(() => {
        if (!selectedFolder || !ecommerceStructure) return [];
        
        const folder = findFolder(ecommerceStructure.folders, selectedFolder);
        if (!folder) return [];
        
        return filterAssetImages(folder.images, {
            query: searchQuery,
            role: assetRoleFilter,
            sortBy
        });
    }, [selectedFolder, ecommerceStructure, searchQuery, assetRoleFilter, sortBy, findFolder]);

    const selectedFolderInfo = useMemo(() => {
        if (!selectedFolder || !ecommerceStructure) return null;
        return findFolder(ecommerceStructure.folders, selectedFolder);
    }, [selectedFolder, ecommerceStructure, findFolder]);

    const selectedFolderImages = selectedFolderInfo?.images || [];
    const visibleRoleStats = useMemo(() => {
        const stats = new Map<AssetRoleFilter, number>();
        for (const image of selectedFolderImages) {
            const role = getAssetRole(image);
            stats.set(role, (stats.get(role) || 0) + 1);
        }
        return stats;
    }, [selectedFolderImages]);

    // 预览结果类型
    interface PreviewResult {
        success?: boolean;
        base64?: string;
        imageData?: string;
        dimensions?: { width: number; height: number };
        width?: number;
        height?: number;
        error?: string;
    }

    // 加载缩略图（支持 PSD 等设计文件）
    const loadThumbnail = useCallback(async (image: ImageFile) => {
        if (
            thumbnailsRef.current[image.path] ||
            loadingThumbnailsRef.current.has(image.path) ||
            failedThumbnailsRef.current.has(image.path)
        ) {
            return;
        }
        
        setLoadingThumbnails(prev => new Set(prev).add(image.path));
        
        try {
            // 为大 PSD/PSB 预览增加超时熔断，避免卡死导致无限转圈
            const thumbnailSize = (image.ext === '.psd' || image.ext === '.psb') ? 1024 : 384;
            const preview = await Promise.race([
                window.designEcho?.getResourcePreview(image.path, thumbnailSize) as Promise<PreviewResult | null>,
                new Promise<PreviewResult>((resolve) =>
                    setTimeout(() => resolve({ success: false, error: '缩略图加载超时' }), 12000)
                )
            ]);
            // 兼容 base64 和 imageData 两种返回格式
            const base64Data = preview?.base64 || preview?.imageData;
            const isSuccess = preview?.success !== false; // 兼容旧版无 success 字段
            if (isSuccess && base64Data) {
                setThumbnails(prev => ({ ...prev, [image.path]: base64Data }));
            } else {
                // 失败后标记，避免 useEffect 反复重试造成无限加载
                setFailedThumbnails(prev => new Set(prev).add(image.path));
            }
        } catch (error) {
            console.error('加载缩略图失败:', image.path, error);
            setFailedThumbnails(prev => new Set(prev).add(image.path));
        } finally {
            setLoadingThumbnails(prev => {
                const next = new Set(prev);
                next.delete(image.path);
                return next;
            });
        }
    }, []);

    // 批量加载当前可见图片的缩略图
    useEffect(() => {
        // 加载当前选中文件夹的所有图片的缩略图
        currentImages.forEach(img => loadThumbnail(img));
    }, [currentImages, loadThumbnail]);

    // 打开预览
    const openPreview = useCallback(async (image: ImageFile) => {
        setPreviewImage(image);
        setPreviewData(null);
        setPreviewDimensions(null);
        setPreviewLoading(true);
        
        try {
            // 加载高清预览（PSD/PSB 使用更高分辨率）
            const previewSize = (image.ext === '.psd' || image.ext === '.psb') ? 3072 : 1600;
            const preview = await window.designEcho?.getResourcePreview(image.path, previewSize) as PreviewResult | null;
            const isSuccess = preview?.success !== false;
            if (isSuccess && preview) {
                const base64 = preview.base64 || preview.imageData;
                if (base64) {
                    setPreviewData(base64);
                }
                // 兼容两种尺寸返回格式
                if (preview.dimensions) {
                    setPreviewDimensions(preview.dimensions);
                } else if (preview.width && preview.height) {
                    setPreviewDimensions({ width: preview.width, height: preview.height });
                }
            }
        } catch (error) {
            console.error('加载预览失败:', error);
        } finally {
            setPreviewLoading(false);
        }
    }, []);

    // 关闭预览
    const closePreview = useCallback(() => {
        setPreviewImage(null);
        setPreviewData(null);
        setPreviewDimensions(null);
    }, []);

    // 切换到上一张/下一张
    const navigatePreview = useCallback((direction: 'prev' | 'next') => {
        if (!previewImage || currentImages.length === 0) return;
        
        const currentIndex = currentImages.findIndex(img => img.path === previewImage.path);
        if (currentIndex === -1) return;
        
        let newIndex: number;
        if (direction === 'prev') {
            newIndex = currentIndex > 0 ? currentIndex - 1 : currentImages.length - 1;
        } else {
            newIndex = currentIndex < currentImages.length - 1 ? currentIndex + 1 : 0;
        }
        
        const nextImage = currentImages[newIndex];
        onAssetSelectionChange?.(buildAssetSelectionContext(nextImage));
        openPreview(nextImage);
    }, [previewImage, currentImages, onAssetSelectionChange, openPreview]);

    // 键盘导航
    useEffect(() => {
        if (!previewImage) return;
        
        const handleKeyDown = (e: KeyboardEvent) => {
            switch (e.key) {
                case 'Escape':
                    closePreview();
                    break;
                case 'ArrowLeft':
                    navigatePreview('prev');
                    break;
                case 'ArrowRight':
                    navigatePreview('next');
                    break;
            }
        };
        
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [previewImage, closePreview, navigatePreview]);

    // 处理图片点击
    const handleImageClick = (image: ImageFile) => {
        onAssetSelectionChange?.(buildAssetSelectionContext(image));
        if (onImageClick) {
            onImageClick(image);
        } else {
            openPreview(image);
        }
    };

    // 处理文件夹类型更改
    const handleFolderTypeChange = async (folderName: string, type: FolderType) => {
        if (onFolderTypeChange && currentProject && window.designEcho?.updateFolderType) {
            onFolderTypeChange(folderName, type);
            await window.designEcho.updateFolderType(currentProject.path, folderName, type);
        }
    };

    if (!ecommerceStructure) {
        return (
            <div className="asset-gallery-empty">
                <div className="empty-icon" aria-hidden="true">库</div>
                <p>{currentProject ? (isScanningStructure ? '正在加载项目素材，请稍候...' : '项目素材未加载完成') : '请先导入项目文件夹'}</p>
                {currentProject && scanError && (
                    <p className="asset-gallery-error">
                        {scanError}
                    </p>
                )}
            </div>
        );
    }

    return (
        <div className="asset-gallery" data-testid="asset-gallery">
            {/* 主体内容 - 移除顶部统计栏，直接显示内容 */}
            <div className="gallery-content">
                {/* 左侧文件夹列表 */}
                <div className="folder-sidebar">
                    {/* 文件夹头部：统计 + 筛选 */}
                    <div className="sidebar-header">
                        <div className="sidebar-stats">
                            <strong>{ecommerceStructure.summary.totalFolders}</strong> 个文件夹 · 
                            <strong>{ecommerceStructure.summary.totalImages}</strong> 张图片
                        </div>
                        <select 
                            className="filter-select-mini"
                            value={filterType}
                            onChange={(e) => setFilterType(e.target.value as FolderType | 'all')}
                        >
                            <option value="all">全部</option>
                            {Object.entries(FOLDER_TYPE_CONFIG).map(([type, config]) => (
                                <option key={type} value={type}>{config.label}</option>
                            ))}
                        </select>
                    </div>
                    <div className="folder-list">
                        {filteredFolders.map(folder => {
                            const config = FOLDER_TYPE_CONFIG[folder.type];
                            const hasChildren = folder.children && folder.children.length > 0;
                            const isExpanded = expandedFolders.has(folder.relativePath);
                            const depth = folder.depth || 0;
                            
                            return (
                                <div 
                                    key={folder.relativePath}
                                    className={`folder-item ${selectedFolder === folder.relativePath ? 'selected' : ''}`}
                                    style={{ paddingLeft: `${12 + depth * 16}px` }}
                                    onClick={() => setSelectedFolder(folder.relativePath)}
                                >
                                    {/* 展开/折叠按钮 */}
                                    {hasChildren ? (
                                        <button 
                                            className="expand-btn"
                                            onClick={(e) => toggleFolderExpand(folder.relativePath, e)}
                                        >
                                            {isExpanded ? '▼' : '▶'}
                                        </button>
                                    ) : (
                                        <span className="expand-placeholder" />
                                    )}
                                    <span className="folder-icon" aria-hidden="true">{config.shortLabel}</span>
                                    <div className="folder-info">
                                        <div className="folder-name" title={folder.name}>{folder.name}</div>
                                        <span className="folder-count">
                                            {folder.imageCount}
                                            {folder.totalImageCount > folder.imageCount && (
                                                <span className="total-count">/{folder.totalImageCount}</span>
                                            )}
                                        </span>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* 右侧图片网格 */}
                <div className="image-panel">
                    {/* 图片面板头部 */}
                    <div className="panel-header">
                        <div className="header-left">
                            <span className="panel-title">
                                {selectedFolderInfo?.name || '项目素材'}
                            </span>
                            {selectedFolder && currentImages.length > 0 && (
                                <span className="image-count-badge">{currentImages.length}</span>
                            )}
                        </div>
                        <div className="header-controls">
                            {/* 搜索框 */}
                            <div className="search-box">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <circle cx="11" cy="11" r="8"/>
                                    <path d="M21 21l-4.35-4.35"/>
                                </svg>
                                <input
                                    type="text"
                                    placeholder="搜索文件..."
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    data-testid="asset-gallery-search"
                                />
                                {searchQuery && (
                                    <button className="clear-btn" onClick={() => setSearchQuery('')}>×</button>
                                )}
                            </div>
                            {/* 排序选择 */}
                            <select 
                                className="sort-select"
                                value={sortBy}
                                onChange={(e) => setSortBy(e.target.value as AssetSortBy)}
                            >
                                <option value="name">按名称</option>
                                <option value="size">按大小</option>
                                <option value="type">按类型</option>
                            </select>
                            {/* 视图切换 */}
                            <div className="view-toggle">
                                <button 
                                    className={viewMode === 'grid' ? 'active' : ''}
                                    onClick={() => setViewMode('grid')}
                                    title="网格视图"
                                >
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                                        <rect x="3" y="3" width="7" height="7" rx="1"/>
                                        <rect x="14" y="3" width="7" height="7" rx="1"/>
                                        <rect x="3" y="14" width="7" height="7" rx="1"/>
                                        <rect x="14" y="14" width="7" height="7" rx="1"/>
                                    </svg>
                                </button>
                                <button 
                                    className={viewMode === 'list' ? 'active' : ''}
                                    onClick={() => setViewMode('list')}
                                    title="列表视图"
                                >
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                                        <rect x="3" y="4" width="18" height="4" rx="1"/>
                                        <rect x="3" y="10" width="18" height="4" rx="1"/>
                                        <rect x="3" y="16" width="18" height="4" rx="1"/>
                                    </svg>
                                </button>
                            </div>
                        </div>
                    </div>
                    {selectedFolderInfo && (
                        <div className="asset-role-toolbar" data-testid="asset-gallery-role-filters">
                            {ASSET_ROLE_FILTERS.map((item) => {
                                const count = item.value === 'all'
                                    ? selectedFolderImages.length
                                    : visibleRoleStats.get(item.value) || 0;
                                return (
                                    <button
                                        key={item.value}
                                        type="button"
                                        className={assetRoleFilter === item.value ? 'active' : ''}
                                        onClick={() => setAssetRoleFilter(item.value)}
                                    >
                                        <span>{item.label}</span>
                                        <strong>{count}</strong>
                                    </button>
                                );
                            })}
                        </div>
                    )}
                    
                    {/* 图片内容区域 */}
                    <div className="image-content">
                    {selectedFolder ? (
                        currentImages.length > 0 ? (
                            <div className={`image-${viewMode}`}>
                                {currentImages.map(image => {
                                    const typeConfig = IMAGE_TYPE_CONFIG[image.type];
                                    const thumbnail = thumbnails[image.path];
                                    const role = getAssetRole(image);
                                    const roleLabel = getAssetRoleLabel(role);
                                    const dimensions = getImageDimensions(image);
                                    const aspectLabel = getAspectLabel(image);
                                    
                                    return (
                                        <div
                                            key={image.relativePath}
                                            className={`image-card ${selectedImagePath === image.path ? 'selected' : ''}`}
                                            onClick={() => handleImageClick(image)}
                                            onKeyDown={(event) => {
                                                if (event.key !== 'Enter' && event.key !== ' ') return;
                                                event.preventDefault();
                                                handleImageClick(image);
                                            }}
                                            role="button"
                                            tabIndex={0}
                                            aria-pressed={selectedImagePath === image.path}
                                            data-testid="asset-gallery-card"
                                        >
                                            <div className="image-thumbnail" data-testid="asset-gallery-aspect-thumbnail">
                                                {thumbnail ? (
                                                    <img
                                                        src={`data:image/jpeg;base64,${thumbnail}`}
                                                        alt={image.name}
                                                        loading="lazy"
                                                    />
                                                ) : (
                                                    <div className={`thumbnail-placeholder ${image.type}`}>
                                                        {loadingThumbnails.has(image.path) ? (
                                                            <div className="loading-spinner" />
                                                        ) : failedThumbnails.has(image.path) ? (
                                                            <>
                                                                <span className="thumbnail-token">{typeConfig.shortLabel}</span>
                                                                <span className="large-file-hint">预览失败</span>
                                                            </>
                                                        ) : (
                                                            <>
                                                                <span className="thumbnail-token">{typeConfig.shortLabel}</span>
                                                                {/* 大文件提示 */}
                                                                {image.size > 100 * 1024 * 1024 && (
                                                                    <span className="large-file-hint">大文件</span>
                                                                )}
                                                            </>
                                                        )}
                                                    </div>
                                                )}
                                                {/* PSD/设计文件角标 */}
                                                {(image.type === 'psd' || image.type === 'design' || image.type === 'video') && (
                                                    <div className="file-type-badge" style={{ backgroundColor: typeConfig.color }}>
                                                        {image.ext.toUpperCase().slice(1)}
                                                    </div>
                                                )}
                                            </div>
                                            <div className="image-info">
                                                <div className="image-name" title={image.name}>
                                                    {image.name}
                                                </div>
                                                <div className="image-meta">
                                                    <span 
                                                        className="image-type-tag"
                                                        style={{ 
                                                            backgroundColor: typeConfig.color + '20', 
                                                            color: typeConfig.color 
                                                        }}
                                                    >
                                                        {typeConfig.label}
                                                    </span>
                                                    <span className="image-size">
                                                        {formatFileSize(image.size)}
                                                    </span>
                                                </div>
                                                <div className="image-source-row">
                                                    <span className={`image-source-chip ${role}`} data-testid="asset-gallery-source-chip">
                                                        {roleLabel}
                                                    </span>
                                                    <span>{aspectLabel}</span>
                                                    <span>{image.ext.toUpperCase()}</span>
                                                </div>
                                                {dimensions && (
                                                    <div className="image-dimensions">
                                                        {dimensions.width} × {dimensions.height}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        ) : (
                            <div className="empty-folder">
                                <span aria-hidden="true">0</span>
                                <p>暂无可预览素材</p>
                            </div>
                        )
                    ) : (
                        <div className="select-folder-hint">
                            <span aria-hidden="true">0</span>
                            <p>暂无可预览素材</p>
                        </div>
                    )}
                    </div>
                </div>
            </div>

            {/* 图片预览弹窗 */}
            {previewImage && (
                <div className="preview-modal" onClick={closePreview} data-testid="asset-gallery-preview-modal">
                    <div className="preview-content" onClick={e => e.stopPropagation()}>
                        {/* 预览图片 */}
                        <div className="preview-image-container">
                            {previewLoading ? (
                                <div className="preview-loading">
                                    <div className="loading-spinner large" />
                                    <span>加载中...</span>
                                </div>
                            ) : previewData ? (
                                <img 
                                    src={`data:image/jpeg;base64,${previewData}`}
                                    alt={previewImage.name}
                                />
                            ) : (
                                <div className="preview-error">
                                    <span aria-hidden="true">!</span>
                                    <p>无法加载预览</p>
                                </div>
                            )}
                        </div>
                        
                        {/* 文件信息 */}
                        <div className="preview-info">
                            <div className="preview-info-main">
                                <h3>{previewImage.name}</h3>
                                <div className="preview-meta">
                                    <span className="meta-item">
                                        <span className="meta-label">来源</span>
                                        <span className="meta-value">{getAssetRoleLabel(getAssetRole(previewImage))}</span>
                                    </span>
                                    <span className="meta-item">
                                        <span className="meta-label">路径</span>
                                        <span className="meta-value">{previewImage.relativePath}</span>
                                    </span>
                                    <span className="meta-item">
                                        <span className="meta-label">大小</span>
                                        <span className="meta-value">{formatFileSize(previewImage.size)}</span>
                                    </span>
                                    {previewDimensions && (
                                        <span className="meta-item">
                                            <span className="meta-label">尺寸</span>
                                            <span className="meta-value">{previewDimensions.width} × {previewDimensions.height}</span>
                                        </span>
                                    )}
                                    <span className="meta-item">
                                        <span className="meta-label">比例</span>
                                        <span className="meta-value">{getAspectLabel(previewImage)}</span>
                                    </span>
                                    <span className="meta-item">
                                        <span className="meta-label">类型</span>
                                        <span 
                                            className="meta-value type-tag"
                                            style={{ 
                                                backgroundColor: IMAGE_TYPE_CONFIG[previewImage.type].color + '20',
                                                color: IMAGE_TYPE_CONFIG[previewImage.type].color 
                                            }}
                                        >
                                            {IMAGE_TYPE_CONFIG[previewImage.type].label}
                                        </span>
                                    </span>
                                </div>
                            </div>
                        </div>
                        
                        {/* 关闭按钮 */}
                        <button className="preview-close" onClick={closePreview}>✕</button>
                        
                        {/* 导航按钮 */}
                        {currentImages.length > 1 && (
                            <>
                                <button 
                                    className="preview-nav prev"
                                    onClick={(e) => { e.stopPropagation(); navigatePreview('prev'); }}
                                >
                                    ‹
                                </button>
                                <button 
                                    className="preview-nav next"
                                    onClick={(e) => { e.stopPropagation(); navigatePreview('next'); }}
                                >
                                    ›
                                </button>
                            </>
                        )}
                        
                        {/* 图片计数 */}
                        {currentImages.length > 1 && (
                            <div className="preview-counter">
                                {currentImages.findIndex(img => img.path === previewImage.path) + 1} / {currentImages.length}
                            </div>
                        )}
                    </div>
                </div>
            )}

            <style>{`
                .asset-gallery {
                    display: flex;
                    flex-direction: column;
                    height: 100%;
                    width: 100%;
                    background: var(--de-bg-dark);
                }

                .gallery-content {
                    display: flex;
                    flex: 1;
                    overflow: hidden;
                }

                .folder-sidebar {
                    width: 220px;
                    min-width: 220px;
                    border-right: 1px solid var(--de-border);
                    display: flex;
                    flex-direction: column;
                    background: var(--de-bg-card);
                }

                .sidebar-header {
                    padding: 12px;
                    border-bottom: 1px solid var(--de-border);
                    display: flex;
                    flex-direction: column;
                    gap: 8px;
                }

                .sidebar-stats {
                    font-size: 12px;
                    color: var(--de-text-secondary);
                }

                .sidebar-stats strong {
                    color: var(--de-text-primary);
                }

                .filter-select-mini {
                    padding: 4px 8px;
                    border-radius: 4px;
                    border: 1px solid var(--de-border);
                    background: var(--de-bg-light);
                    color: var(--de-text-primary);
                    font-size: 12px;
                    cursor: pointer;
                    width: 100%;
                }

                .folder-list {
                    flex: 1;
                    overflow-y: auto;
                    padding: 8px;
                }

                .image-panel {
                    flex: 1;
                    display: flex;
                    flex-direction: column;
                    overflow: hidden;
                }

                .panel-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    padding: 8px 16px;
                    border-bottom: 1px solid var(--de-border);
                    background: var(--de-bg-card);
                    gap: 12px;
                }

                .asset-role-toolbar {
                    display: flex;
                    gap: 8px;
                    align-items: center;
                    padding: 10px 16px;
                    border-bottom: 1px solid var(--de-border);
                    background: color-mix(in srgb, var(--de-bg-card) 88%, var(--de-bg-dark));
                    overflow-x: auto;
                }

                .asset-role-toolbar button {
                    display: inline-flex;
                    align-items: center;
                    gap: 6px;
                    min-height: 30px;
                    padding: 5px 9px;
                    border: 1px solid var(--de-border);
                    border-radius: 6px;
                    background: var(--de-bg-light);
                    color: var(--de-text-secondary);
                    font-size: 12px;
                    font-weight: 600;
                    white-space: nowrap;
                    cursor: pointer;
                }

                .asset-role-toolbar button.active {
                    border-color: var(--de-primary);
                    background: color-mix(in srgb, var(--de-primary) 14%, var(--de-bg-light));
                    color: var(--de-primary);
                }

                .asset-role-toolbar button strong {
                    color: var(--de-text-primary);
                    font-size: 12px;
                    font-weight: 700;
                }

                .header-left {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    flex-shrink: 0;
                }

                .image-count-badge {
                    background: var(--de-primary-dim);
                    color: var(--de-primary);
                    padding: 2px 8px;
                    border-radius: 10px;
                    font-size: 11px;
                    font-weight: 600;
                }

                .header-controls {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    flex: 1;
                    justify-content: flex-end;
                }

                .search-box {
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    background: var(--de-bg-light);
                    border: 1px solid var(--de-border);
                    border-radius: 6px;
                    padding: 4px 10px;
                    max-width: 200px;
                    flex: 1;
                }

                .search-box svg {
                    color: var(--de-text-muted);
                    flex-shrink: 0;
                }

                .search-box input {
                    background: transparent;
                    border: none;
                    outline: none;
                    color: var(--de-text-primary);
                    font-size: 12px;
                    width: 100%;
                }

                .search-box input::placeholder {
                    color: var(--de-text-muted);
                }

                .search-box .clear-btn {
                    background: none;
                    border: none;
                    color: var(--de-text-muted);
                    cursor: pointer;
                    padding: 0;
                    font-size: 14px;
                    line-height: 1;
                }

                .search-box .clear-btn:hover {
                    color: var(--de-text-primary);
                }

                .sort-select {
                    padding: 4px 8px;
                    border-radius: 4px;
                    border: 1px solid var(--de-border);
                    background: var(--de-bg-light);
                    color: var(--de-text-primary);
                    font-size: 12px;
                    cursor: pointer;
                }

                .panel-title {
                    font-size: 13px;
                    font-weight: 500;
                    color: var(--de-text-primary);
                }

                .view-toggle {
                    display: flex;
                    border: 1px solid var(--de-border);
                    border-radius: 4px;
                    overflow: hidden;
                }

                .view-toggle button {
                    padding: 4px 8px;
                    background: var(--de-bg-light);
                    border: none;
                    color: var(--de-text-secondary);
                    cursor: pointer;
                    transition: all 0.15s;
                }

                .view-toggle button:first-child {
                    border-right: 1px solid var(--de-border);
                }

                .view-toggle button.active {
                    background: var(--de-primary);
                    color: white;
                }

                .image-content {
                    flex: 1;
                    overflow-y: auto;
                    padding: 12px;
                }

                .folder-item {
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    padding: 8px 10px;
                    border-radius: 6px;
                    cursor: pointer;
                    transition: all 0.15s;
                    margin-bottom: 2px;
                }

                .folder-item:hover {
                    background: var(--de-bg-light);
                }

                .folder-item.selected {
                    background: var(--de-primary-dim);
                    border: 1px solid var(--de-primary);
                }

                .expand-btn {
                    width: 16px;
                    height: 16px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    background: none;
                    border: none;
                    color: var(--de-text-muted);
                    cursor: pointer;
                    font-size: 8px;
                    padding: 0;
                    flex-shrink: 0;
                    transition: color 0.15s;
                }

                .expand-btn:hover {
                    color: var(--de-text-primary);
                }

                .expand-placeholder {
                    width: 16px;
                    flex-shrink: 0;
                }

                .folder-icon {
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    width: 24px;
                    height: 24px;
                    border-radius: 6px;
                    background: color-mix(in srgb, var(--de-primary) 12%, var(--de-bg-light));
                    color: var(--de-text-secondary);
                    font-size: 11px;
                    font-weight: 700;
                    flex-shrink: 0;
                }

                .total-count {
                    color: var(--de-text-muted);
                    font-size: 10px;
                }

                .folder-info {
                    flex: 1;
                    min-width: 0;
                }

                .folder-name {
                    font-size: 14px;
                    font-weight: 500;
                    color: var(--de-text-primary);
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                }

                .folder-meta {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    margin-top: 4px;
                }

                .folder-type-tag {
                    font-size: 11px;
                    padding: 2px 6px;
                    border-radius: 4px;
                    font-weight: 500;
                }

                .folder-count {
                    font-size: 12px;
                    color: var(--de-text-muted);
                }

                .image-grid {
                    display: grid;
                    grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
                    gap: 16px;
                }

                .image-list {
                    display: flex;
                    flex-direction: column;
                    gap: 8px;
                }

                .image-list .image-card {
                    flex-direction: row;
                    height: 64px;
                }

                .image-list .image-thumbnail {
                    width: 64px;
                    height: 64px;
                    min-height: 64px;
                    aspect-ratio: auto;
                    flex-shrink: 0;
                }

                .image-card {
                    background: var(--de-bg-card);
                    border: 1px solid var(--de-border);
                    border-radius: 8px;
                    overflow: hidden;
                    cursor: pointer;
                    transition: all 0.2s;
                }

                .image-card:hover {
                    border-color: var(--de-primary);
                    transform: translateY(-2px);
                    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
                }

                .image-card.selected {
                    border-color: var(--de-primary);
                    box-shadow: 0 0 0 2px rgba(var(--de-primary-rgb), 0.22);
                }

                .image-thumbnail {
                    aspect-ratio: 4 / 3;
                    min-height: 120px;
                    background: var(--de-bg-light);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    position: relative;
                    overflow: hidden;
                }

                .image-thumbnail img {
                    width: 100%;
                    height: 100%;
                    object-fit: contain; /* 显示完整画布，不裁切 */
                    background: #0f1118;
                }

                .thumbnail-placeholder {
                    opacity: 0.5;
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    gap: 4px;
                }

                .thumbnail-placeholder.psd,
                .thumbnail-placeholder.design {
                    background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
                    opacity: 1;
                }

                .thumbnail-placeholder.video {
                    background: linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 100%);
                    opacity: 1;
                }

                .file-type-badge {
                    position: absolute;
                    top: 6px;
                    right: 6px;
                    padding: 2px 6px;
                    border-radius: 4px;
                    font-size: 10px;
                    font-weight: 600;
                    color: white;
                    text-transform: uppercase;
                }

                .large-file-hint {
                    font-size: 10px;
                    color: var(--de-text-muted);
                    margin-top: 4px;
                }

                .thumbnail-token {
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    min-width: 40px;
                    min-height: 40px;
                    border-radius: 8px;
                    background: color-mix(in srgb, var(--de-text-muted) 14%, transparent);
                    color: var(--de-text-secondary);
                    font-size: 13px;
                    font-weight: 700;
                    letter-spacing: 0;
                }

                .loading-spinner {
                    width: 24px;
                    height: 24px;
                    border: 2px solid var(--de-border);
                    border-top-color: var(--de-primary);
                    border-radius: 50%;
                    animation: spin 0.8s linear infinite;
                }

                @keyframes spin {
                    to { transform: rotate(360deg); }
                }

                .image-info {
                    padding: 10px;
                }

                .image-name {
                    font-size: 13px;
                    font-weight: 500;
                    color: var(--de-text-primary);
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    margin-bottom: 6px;
                }

                .image-meta {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    gap: 8px;
                }

                .image-type-tag {
                    font-size: 10px;
                    padding: 2px 6px;
                    border-radius: 4px;
                    font-weight: 500;
                }

                .image-size {
                    font-size: 11px;
                    color: var(--de-text-muted);
                    white-space: nowrap;
                }

                .image-source-row {
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    margin-top: 7px;
                    min-width: 0;
                    color: var(--de-text-muted);
                    font-size: 11px;
                    line-height: 1.35;
                }

                .image-source-row span {
                    min-width: 0;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                }

                .image-source-chip {
                    flex: 0 1 auto;
                    padding: 2px 6px;
                    border-radius: 999px;
                    background: color-mix(in srgb, var(--de-primary) 12%, transparent);
                    color: var(--de-text-secondary);
                    font-weight: 600;
                }

                .image-source-chip.deliverable {
                    color: var(--de-primary);
                }

                .image-source-chip.designDoc {
                    color: #ffb86b;
                }

                .image-source-chip.media {
                    color: #ff6b9a;
                }

                .image-dimensions {
                    margin-top: 4px;
                    color: var(--de-text-muted);
                    font-size: 11px;
                    line-height: 1.35;
                }

                .empty-folder,
                .select-folder-hint,
                .asset-gallery-empty {
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    height: 100%;
                    color: var(--de-text-secondary);
                    font-size: 14px;
                }

                .empty-folder span,
                .select-folder-hint span,
                .asset-gallery-empty .empty-icon {
                    font-size: 48px;
                    margin-bottom: 12px;
                    opacity: 0.5;
                }

                .asset-gallery-error {
                    margin-top: 8px;
                    color: var(--de-danger);
                    font-size: 12px;
                    line-height: 1.45;
                }

                .preview-modal {
                    position: fixed;
                    inset: 0;
                    background: rgba(0, 0, 0, 0.95);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    z-index: 1000;
                    padding: 40px;
                }

                .preview-content {
                    position: relative;
                    display: flex;
                    flex-direction: column;
                    max-width: 90vw;
                    max-height: 90vh;
                    background: var(--de-bg-card);
                    border-radius: 8px;
                    overflow: hidden;
                    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
                }

                .preview-image-container {
                    flex: 1;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    min-height: 300px;
                    max-height: 70vh;
                    background: #0a0a0a;
                    overflow: hidden;
                }

                .preview-image-container img {
                    width: 100%;
                    height: 100%;
                    object-fit: contain;
                    image-rendering: auto;
                }

                .preview-loading,
                .preview-error {
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    gap: 12px;
                    color: var(--de-text-muted);
                }

                .preview-loading .loading-spinner.large {
                    width: 40px;
                    height: 40px;
                    border-width: 3px;
                }

                .preview-error span {
                    font-size: 48px;
                }

                .preview-info {
                    padding: 16px 20px;
                    background: var(--de-bg-card);
                    border-top: 1px solid var(--de-border);
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    gap: 20px;
                }

                .preview-info-main {
                    flex: 1;
                    min-width: 0;
                }

                .preview-info h3 {
                    margin: 0 0 8px 0;
                    font-size: 16px;
                    font-weight: 600;
                    color: var(--de-text-primary);
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                }

                .preview-meta {
                    display: flex;
                    flex-wrap: wrap;
                    gap: 16px;
                }

                .meta-item {
                    display: flex;
                    align-items: center;
                    gap: 6px;
                }

                .meta-label {
                    font-size: 11px;
                    color: var(--de-text-muted);
                    text-transform: uppercase;
                }

                .meta-value {
                    font-size: 13px;
                    color: var(--de-text-secondary);
                }

                .meta-value.type-tag {
                    padding: 2px 8px;
                    border-radius: 4px;
                    font-size: 11px;
                    font-weight: 500;
                }

                .preview-nav-hint {
                    font-size: 11px;
                    color: var(--de-text-muted);
                    white-space: nowrap;
                }

                .preview-close {
                    position: absolute;
                    top: 12px;
                    right: 12px;
                    width: 36px;
                    height: 36px;
                    border-radius: 50%;
                    border: none;
                    background: rgba(0, 0, 0, 0.6);
                    color: white;
                    font-size: 18px;
                    cursor: pointer;
                    transition: all 0.15s;
                    z-index: 10;
                }

                .preview-close:hover {
                    background: rgba(0, 0, 0, 0.8);
                    transform: scale(1.1);
                }

                .preview-nav {
                    position: absolute;
                    top: 50%;
                    transform: translateY(-50%);
                    width: 48px;
                    height: 48px;
                    border-radius: 50%;
                    border: none;
                    background: rgba(0, 0, 0, 0.5);
                    color: white;
                    font-size: 32px;
                    cursor: pointer;
                    transition: all 0.15s;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                }

                .preview-nav:hover {
                    background: rgba(0, 0, 0, 0.8);
                    transform: translateY(-50%) scale(1.1);
                }

                .preview-nav.prev {
                    left: -60px;
                }

                .preview-nav.next {
                    right: -60px;
                }

                .preview-counter {
                    position: absolute;
                    top: 12px;
                    left: 50%;
                    transform: translateX(-50%);
                    background: rgba(0, 0, 0, 0.6);
                    color: white;
                    padding: 6px 16px;
                    border-radius: 20px;
                    font-size: 13px;
                    font-weight: 500;
                }
            `}</style>
        </div>
    );
};
