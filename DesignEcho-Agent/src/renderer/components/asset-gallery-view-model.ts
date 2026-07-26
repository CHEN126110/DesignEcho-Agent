import type { FolderType, ImageFile } from '../stores/app.store';

export type AssetRoleFilter = 'all' | 'source' | 'deliverable' | 'designDoc' | 'media';
export type AssetSortBy = 'name' | 'size' | 'type';

export interface AssetRoleFilterItem {
    value: AssetRoleFilter;
    label: string;
}

export interface AssetImageFilterOptions {
    query?: string;
    role?: AssetRoleFilter;
    sortBy?: AssetSortBy;
}

export const ASSET_ROLE_FILTERS: AssetRoleFilterItem[] = [
    { value: 'all', label: '全部' },
    { value: 'source', label: '项目素材' },
    { value: 'deliverable', label: '交付输出' },
    { value: 'designDoc', label: '设计文档' },
    { value: 'media', label: '视频' }
];

const FOLDER_TYPE_LABELS: Record<FolderType, string> = {
    source: '素材',
    psd: 'PSD',
    mainImage: '主图',
    detail: '详情页',
    sku: 'SKU',
    unknown: '未分类'
};

export function getAssetRole(image: ImageFile): Exclude<AssetRoleFilter, 'all'> {
    if (image.type === 'video') return 'media';
    if (image.type === 'psd' || image.type === 'design' || image.folderType === 'psd') return 'designDoc';
    if (image.folderType === 'mainImage' || image.folderType === 'detail' || image.folderType === 'sku') return 'deliverable';
    return 'source';
}

export function getAssetRoleLabel(role: AssetRoleFilter): string {
    return ASSET_ROLE_FILTERS.find((item) => item.value === role)?.label || '项目素材';
}

export function getImageDimensions(image: ImageFile): { width: number; height: number } | null {
    const width = Number(image.width);
    const height = Number(image.height);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
        return null;
    }
    return { width: Math.round(width), height: Math.round(height) };
}

export function getAspectLabel(image: ImageFile): string {
    const dimensions = getImageDimensions(image);
    if (!dimensions) return '未知比例';
    const ratio = Number(image.aspectRatio || dimensions.width / dimensions.height);
    if (!Number.isFinite(ratio) || ratio <= 0) return '未知比例';
    if (isNearRatio(ratio, 1)) return '1:1';
    if (isNearRatio(ratio, 3 / 4)) return '3:4';
    if (isNearRatio(ratio, 4 / 5)) return '4:5';
    if (isNearRatio(ratio, 9 / 16)) return '9:16';
    if (isNearRatio(ratio, 16 / 9)) return '16:9';
    if (ratio > 1.1) return '横图';
    if (ratio < 0.9) return '竖图';
    return '近方图';
}

export function filterAssetImages(images: ImageFile[], options: AssetImageFilterOptions = {}): ImageFile[] {
    const query = normalizeQuery(options.query);
    const role = options.role || 'all';
    const sortBy = options.sortBy || 'name';
    return [...images]
        .filter((image) => role === 'all' || getAssetRole(image) === role)
        .filter((image) => !query || buildSearchText(image).includes(query))
        .sort((a, b) => compareImages(a, b, sortBy));
}

function compareImages(a: ImageFile, b: ImageFile, sortBy: AssetSortBy): number {
    if (sortBy === 'size') return b.size - a.size || a.name.localeCompare(b.name, 'zh-Hans-CN');
    if (sortBy === 'type') return a.type.localeCompare(b.type) || a.name.localeCompare(b.name, 'zh-Hans-CN');
    return a.name.localeCompare(b.name, 'zh-Hans-CN');
}

function buildSearchText(image: ImageFile): string {
    return normalizeQuery([
        image.name,
        image.relativePath,
        image.parentFolder,
        image.ext,
        image.type,
        image.folderType,
        FOLDER_TYPE_LABELS[image.folderType],
        getAssetRoleLabel(getAssetRole(image)),
        getAspectLabel(image),
        formatDimensionsForSearch(image)
    ].join(' '));
}

function formatDimensionsForSearch(image: ImageFile): string {
    const dimensions = getImageDimensions(image);
    return dimensions ? `${dimensions.width}x${dimensions.height} ${dimensions.width}×${dimensions.height}` : '';
}

function normalizeQuery(value: unknown): string {
    return String(value || '').trim().toLowerCase();
}

function isNearRatio(value: number, target: number): boolean {
    return Math.abs(value - target) <= 0.035;
}
