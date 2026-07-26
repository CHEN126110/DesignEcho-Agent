/**
 * 模板知识库服务
 *
 * 负责模板的存储、检索和管理
 */

import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { readPsd } from 'ag-psd';
import type {
    TemplateAsset,
    TemplateKnowledge,
    TemplateLibrary,
    TemplateQuery,
    AddTemplateParams,
    AddTemplateFromPhotoshopParams,
    ResolvePhotoshopTemplateFileParams,
    FindSKUTemplateParams,
    GetAvailableSKUSpecsParams,
    SKUTemplateCandidate,
    TemplateResolverSettings,
    UpdateTemplateParams,
    TemplateType,
    TemplateFormat,
    TemplateSpecs
} from '../../shared/types/template.types';

// 存储路径
const getStoragePath = () => path.join(app.getPath('userData'), 'template-knowledge');
const getDataFile = () => path.join(getStoragePath(), 'templates.json');
const getThumbnailDir = () => path.join(getStoragePath(), 'thumbnails');
const getAssetPreviewDir = () => path.join(getStoragePath(), 'asset-previews');
const getFilesDir = () => path.join(getStoragePath(), 'files');
const getResolverSettingsFile = () => path.join(getStoragePath(), 'resolver-settings.json');
const getTrashDir = () => path.join(getStoragePath(), 'trash');

// Global knowledge base name
const GLOBAL_KB_NAME = 'Template Knowledge Base';
const SUPPORTED_TEMPLATE_EXTS = ['.psd', '.psb', '.tif', '.tiff'];
const SUPPORTED_LIBRARY_ASSET_EXTS = ['.psd', '.psb', '.tif', '.tiff', '.png', '.jpg', '.jpeg', '.webp', '.svg', '.txt'];
const DESIGN_FILE_EXTS = new Set(['psd', 'psb', 'tif', 'tiff']);
const LIBRARY_ASSET_PACKAGE_INFO = 'info.json';
const SCAN_EXCLUDE_DIRS = new Set([
    '.git',
    '.idea',
    '.vscode',
    'node_modules',
    'dist',
    'build',
    'tmp',
    'temp'
]);

type LibraryAssetType = 'design-file' | 'image' | 'text' | 'vector' | 'other';

type DeletedLibraryEntry =
    | {
        kind: 'template';
        deletedAt: number;
        template: TemplateAsset;
        trashedFilePath?: string;
        trashedThumbnailPath?: string;
    }
    | {
        kind: 'library-entry';
        deletedAt: number;
        libraryId: string;
        relativePath: string;
        originalPath: string;
        trashedPath: string;
        isDirectory: boolean;
        removedTemplates: TemplateAsset[];
    };

const deletedLibraryEntries: DeletedLibraryEntry[] = [];

type AssetPreviewCacheEntry = {
    mtimeMs: number;
    size: number;
    dataUrl: string;
};

const LIBRARY_ASSET_PREVIEW_CACHE_MAX = 300;
const libraryAssetPreviewCache = new Map<string, AssetPreviewCacheEntry>();
const libraryAssetInlinePreviewCache = new Map<string, AssetPreviewCacheEntry>();
const INLINE_LIBRARY_PSD_MAX_BYTES = 160 * 1024 * 1024;

let iconvLiteForNameRepair: { encode?: (input: string, encoding: string) => Buffer } | null | undefined;
const MOJIBAKE_SIGNAL_CHARS = '\u9359\u5C83\u923F\u72C5\u7B0D\u93C8\u58D9\u93C2\u56E7\u5393\u7EF1';

function getIconvLiteForNameRepair(): { encode?: (input: string, encoding: string) => Buffer } | null {
    if (iconvLiteForNameRepair !== undefined) {
        return iconvLiteForNameRepair;
    }
    try {
        // Some Photoshop/JSX paths can surface UTF-8 Chinese as GBK-decoded mojibake.
        // Keep the repair at the filename boundary so real content is not rewritten.
        iconvLiteForNameRepair = require('iconv-lite');
    } catch {
        iconvLiteForNameRepair = null;
    }
    return iconvLiteForNameRepair || null;
}

function countMojibakeSignals(input: string): number {
    const value = String(input || '');
    let count = 0;
    for (const char of value) {
        const codePoint = char.codePointAt(0) || 0;
        if (char === '\u951F' || char === '\uFFFD' || (codePoint >= 0xE000 && codePoint <= 0xF8FF) || MOJIBAKE_SIGNAL_CHARS.includes(char)) {
            count += 1;
        }
    }
    return count;
}

function countCjkCharacters(input: string): number {
    const matches = String(input || '').match(/[\u4E00-\u9FFF]/g);
    return matches ? matches.length : 0;
}

function repairMaybeUtf8DecodedAsGbk(input: string): string {
    const value = String(input || '').trim();
    if (!value || countMojibakeSignals(value) === 0) {
        return value;
    }

    const iconv = getIconvLiteForNameRepair();
    if (!iconv?.encode) {
        return value;
    }

    try {
        const repaired = iconv.encode(value, 'gbk').toString('utf8').trim();
        if (
            repaired
            && repaired !== value
            && countCjkCharacters(repaired) > 0
            && countMojibakeSignals(repaired) < countMojibakeSignals(value)
        ) {
            return repaired;
        }
    } catch {
        return value;
    }

    return value;
}

function setLibraryAssetPreviewCache(
    previewPath: string,
    cacheEntry: AssetPreviewCacheEntry
): void {
    if (libraryAssetPreviewCache.has(previewPath)) {
        libraryAssetPreviewCache.delete(previewPath);
    }
    libraryAssetPreviewCache.set(previewPath, cacheEntry);
    if (libraryAssetPreviewCache.size > LIBRARY_ASSET_PREVIEW_CACHE_MAX) {
        const oldestKey = libraryAssetPreviewCache.keys().next().value as string | undefined;
        if (oldestKey) {
            libraryAssetPreviewCache.delete(oldestKey);
        }
    }
}

function setLibraryInlinePreviewCache(
    cacheKey: string,
    cacheEntry: AssetPreviewCacheEntry
): void {
    if (libraryAssetInlinePreviewCache.has(cacheKey)) {
        libraryAssetInlinePreviewCache.delete(cacheKey);
    }
    libraryAssetInlinePreviewCache.set(cacheKey, cacheEntry);
    if (libraryAssetInlinePreviewCache.size > LIBRARY_ASSET_PREVIEW_CACHE_MAX) {
        const oldestKey = libraryAssetInlinePreviewCache.keys().next().value as string | undefined;
        if (oldestKey) {
            libraryAssetInlinePreviewCache.delete(oldestKey);
        }
    }
}

type LibraryAssetEntry = {
    kind: 'template';
    name: string;
    relativePath: string;
    filePath?: string;
    fileFormat?: string;
    assetType?: LibraryAssetType;
    thumbnailUrl?: string;
    textPreview?: string;
    templateId?: string;
    tags?: string[];
    width?: number;
    height?: number;
    fileSize?: string;
    updatedAt?: number;
    updatedLabel?: string;
    note?: string;
};

type LibraryDirectoryEntry = {
    kind: 'directory';
    name: string;
    relativePath: string;
};

type LibraryTagStat = {
    name: string;
    count: number;
};

type LibraryAssetPackageInfo = {
    id: string;
    name: string;
    ext: string;
    width: number;
    height: number;
    size: string;
    star: number;
    find: string[];
    time: string;
    tags: string[];
    folder: string[];
    note: string;
    Y: number;
    sourceFile: string;
    previewFile?: string;
    assetType?: LibraryAssetType;
    createdAt: number;
    updatedAt: number;
};

/**
 * 确保存储目录存在
 */
function ensureStorageDir(): void {
    const storagePath = getStoragePath();
    const thumbnailDir = getThumbnailDir();
    const assetPreviewDir = getAssetPreviewDir();
    const trashDir = getTrashDir();
    
    if (!fs.existsSync(storagePath)) {
        fs.mkdirSync(storagePath, { recursive: true });
    }
    if (!fs.existsSync(thumbnailDir)) {
        fs.mkdirSync(thumbnailDir, { recursive: true });
    }
    if (!fs.existsSync(assetPreviewDir)) {
        fs.mkdirSync(assetPreviewDir, { recursive: true });
    }
    if (!fs.existsSync(trashDir)) {
        fs.mkdirSync(trashDir, { recursive: true });
    }
}

/**
 * 读取知识库数据
 */
function readKnowledge(): TemplateKnowledge {
    ensureStorageDir();
    const dataFile = getDataFile();
    
    if (fs.existsSync(dataFile)) {
        try {
            const content = fs.readFileSync(dataFile, 'utf-8');
            return JSON.parse(content);
        } catch (e) {
            console.error('[TemplateKnowledge] 读取数据失败:', e);
        }
    }
    
    // 创建默认知识库
    const defaultKB: TemplateKnowledge = {
        id: crypto.randomUUID(),
        name: GLOBAL_KB_NAME,
        templates: [],
        createdAt: Date.now(),
        updatedAt: Date.now()
    };
    
    writeKnowledge(defaultKB);
    return defaultKB;
}

/**
 * 写入知识库数据
 */
function writeKnowledge(knowledge: TemplateKnowledge): void {
    ensureStorageDir();
    const dataFile = getDataFile();
    knowledge.updatedAt = Date.now();
    fs.writeFileSync(dataFile, JSON.stringify(knowledge, null, 2), 'utf-8');
}

/**
 * 检测文件格式
 */
function detectFormat(filePath: string): TemplateFormat {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.psd') return 'psd';
    if (ext === '.tif' || ext === '.tiff') return 'tif';
    if (ext === '.psb') return 'psb';
    return 'psd'; // 默认
}

function isSupportedTemplateFile(filePath: string): boolean {
    const ext = path.extname(filePath).toLowerCase();
    return SUPPORTED_TEMPLATE_EXTS.includes(ext);
}

function isSupportedLibraryAssetFile(filePath: string): boolean {
    const ext = path.extname(filePath).toLowerCase();
    return SUPPORTED_LIBRARY_ASSET_EXTS.includes(ext);
}

function detectLibraryAssetFormat(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    return ext.replace(/^\./, '') || 'file';
}

function detectLibraryAssetType(filePath: string): 'design-file' | 'image' | 'text' | 'vector' | 'other' {
    const format = detectLibraryAssetFormat(filePath);
    if (['psd', 'psb', 'tif', 'tiff'].includes(format)) return 'design-file';
    if (['png', 'jpg', 'jpeg', 'webp'].includes(format)) return 'image';
    if (format === 'txt') return 'text';
    if (format === 'svg') return 'vector';
    return 'other';
}

function isDesignFileFormat(format: string): boolean {
    return DESIGN_FILE_EXTS.has(String(format || '').toLowerCase());
}

function formatAssetPackageTime(timestamp = Date.now()): string {
    const date = new Date(timestamp);
    const pad = (value: number): string => String(value).padStart(2, '0');
    return [
        date.getFullYear(),
        pad(date.getMonth() + 1),
        pad(date.getDate()),
        pad(date.getHours()),
        pad(date.getMinutes()),
        pad(date.getSeconds())
    ].join('');
}

function getLibraryAssetPackageInfoPath(packageDir: string): string {
    return path.join(packageDir, LIBRARY_ASSET_PACKAGE_INFO);
}

function readFileSlice(filePath: string, start: number, length: number): Buffer {
    const fd = fs.openSync(filePath, 'r');
    try {
        const buffer = Buffer.alloc(length);
        const bytesRead = fs.readSync(fd, buffer, 0, length, start);
        return buffer.subarray(0, bytesRead);
    } finally {
        fs.closeSync(fd);
    }
}

function isPositiveDimension(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function readPsdLikeDimensions(filePath: string): { width: number; height: number } | undefined {
    const buffer = readFileSlice(filePath, 0, 26);
    if (buffer.length < 22 || buffer.toString('ascii', 0, 4) !== '8BPS') {
        return undefined;
    }
    const version = buffer.readUInt16BE(4);
    if (version !== 1 && version !== 2) {
        return undefined;
    }
    const height = buffer.readUInt32BE(14);
    const width = buffer.readUInt32BE(18);
    return isPositiveDimension(width) && isPositiveDimension(height)
        ? { width, height }
        : undefined;
}

function readPngDimensions(filePath: string): { width: number; height: number } | undefined {
    const buffer = readFileSlice(filePath, 0, 24);
    const pngSignature = '89504e470d0a1a0a';
    if (buffer.length < 24 || buffer.subarray(0, 8).toString('hex') !== pngSignature) {
        return undefined;
    }
    const width = buffer.readUInt32BE(16);
    const height = buffer.readUInt32BE(20);
    return isPositiveDimension(width) && isPositiveDimension(height)
        ? { width, height }
        : undefined;
}

function readJpegDimensions(filePath: string): { width: number; height: number } | undefined {
    const buffer = readFileSlice(filePath, 0, 256 * 1024);
    if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) {
        return undefined;
    }

    const sofMarkers = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
    let offset = 2;
    while (offset + 3 < buffer.length) {
        if (buffer[offset] !== 0xff) {
            offset += 1;
            continue;
        }
        while (offset < buffer.length && buffer[offset] === 0xff) {
            offset += 1;
        }
        if (offset >= buffer.length) {
            break;
        }

        const marker = buffer[offset];
        offset += 1;
        if (marker === 0xd8 || marker === 0xd9) {
            continue;
        }
        if (marker === 0xda) {
            break;
        }
        if (offset + 1 >= buffer.length) {
            break;
        }

        const segmentLength = buffer.readUInt16BE(offset);
        if (segmentLength < 2 || offset + segmentLength > buffer.length) {
            break;
        }

        if (sofMarkers.has(marker) && offset + 7 < buffer.length) {
            const height = buffer.readUInt16BE(offset + 3);
            const width = buffer.readUInt16BE(offset + 5);
            return isPositiveDimension(width) && isPositiveDimension(height)
                ? { width, height }
                : undefined;
        }

        offset += segmentLength;
    }

    return undefined;
}

function readWebpDimensions(filePath: string): { width: number; height: number } | undefined {
    const buffer = readFileSlice(filePath, 0, 64);
    if (buffer.length < 30
        || buffer.toString('ascii', 0, 4) !== 'RIFF'
        || buffer.toString('ascii', 8, 12) !== 'WEBP') {
        return undefined;
    }

    const chunkType = buffer.toString('ascii', 12, 16);
    if (chunkType === 'VP8X' && buffer.length >= 30) {
        const width = 1 + buffer.readUIntLE(24, 3);
        const height = 1 + buffer.readUIntLE(27, 3);
        return isPositiveDimension(width) && isPositiveDimension(height)
            ? { width, height }
            : undefined;
    }

    if (chunkType === 'VP8 ' && buffer.length >= 30) {
        if (buffer[23] !== 0x9d || buffer[24] !== 0x01 || buffer[25] !== 0x2a) {
            return undefined;
        }
        const width = buffer.readUInt16LE(26) & 0x3fff;
        const height = buffer.readUInt16LE(28) & 0x3fff;
        return isPositiveDimension(width) && isPositiveDimension(height)
            ? { width, height }
            : undefined;
    }

    if (chunkType === 'VP8L' && buffer.length >= 25 && buffer[20] === 0x2f) {
        const bits = buffer.readUInt32LE(21);
        const width = (bits & 0x3fff) + 1;
        const height = ((bits >> 14) & 0x3fff) + 1;
        return isPositiveDimension(width) && isPositiveDimension(height)
            ? { width, height }
            : undefined;
    }

    return undefined;
}

function parseSvgLength(value: string | undefined): number | undefined {
    const text = String(value || '').trim();
    if (!text || text.includes('%')) {
        return undefined;
    }
    const match = text.match(/^([+-]?\d*\.?\d+(?:e[+-]?\d+)?)/i);
    if (!match) {
        return undefined;
    }
    const parsed = Number(match[1]);
    return isPositiveDimension(parsed) ? parsed : undefined;
}

function readSvgDimensions(filePath: string): { width: number; height: number } | undefined {
    const buffer = readFileSlice(filePath, 0, 64 * 1024);
    const content = buffer.toString('utf8');
    const svgTagMatch = content.match(/<svg\b[^>]*>/i);
    if (!svgTagMatch) {
        return undefined;
    }

    const svgTag = svgTagMatch[0];
    const width = parseSvgLength(svgTag.match(/\bwidth\s*=\s*["']([^"']+)["']/i)?.[1]);
    const height = parseSvgLength(svgTag.match(/\bheight\s*=\s*["']([^"']+)["']/i)?.[1]);
    if (isPositiveDimension(width) && isPositiveDimension(height)) {
        return { width, height };
    }

    const viewBoxMatch = svgTag.match(/\bviewBox\s*=\s*["']\s*([+-]?\d*\.?\d+(?:e[+-]?\d+)?)\s*[, ]+\s*([+-]?\d*\.?\d+(?:e[+-]?\d+)?)\s*[, ]+\s*([+-]?\d*\.?\d+(?:e[+-]?\d+)?)\s*[, ]+\s*([+-]?\d*\.?\d+(?:e[+-]?\d+)?)\s*["']/i);
    if (!viewBoxMatch) {
        return undefined;
    }

    const viewBoxWidth = Number(viewBoxMatch[3]);
    const viewBoxHeight = Number(viewBoxMatch[4]);
    return isPositiveDimension(viewBoxWidth) && isPositiveDimension(viewBoxHeight)
        ? { width: viewBoxWidth, height: viewBoxHeight }
        : undefined;
}

function readTiffFieldValue(buffer: Buffer, offset: number, littleEndian: boolean): number | undefined {
    if (offset + 12 > buffer.length) {
        return undefined;
    }
    const type = littleEndian ? buffer.readUInt16LE(offset + 2) : buffer.readUInt16BE(offset + 2);
    const count = littleEndian ? buffer.readUInt32LE(offset + 4) : buffer.readUInt32BE(offset + 4);
    if (count !== 1) {
        return undefined;
    }
    if (type === 3) {
        return littleEndian ? buffer.readUInt16LE(offset + 8) : buffer.readUInt16BE(offset + 8);
    }
    if (type === 4) {
        return littleEndian ? buffer.readUInt32LE(offset + 8) : buffer.readUInt32BE(offset + 8);
    }
    return undefined;
}

function readTiffDimensions(filePath: string): { width: number; height: number } | undefined {
    const buffer = readFileSlice(filePath, 0, 64 * 1024);
    if (buffer.length < 8) {
        return undefined;
    }
    const byteOrder = buffer.toString('ascii', 0, 2);
    const littleEndian = byteOrder === 'II';
    if (!littleEndian && byteOrder !== 'MM') {
        return undefined;
    }

    const magic = littleEndian ? buffer.readUInt16LE(2) : buffer.readUInt16BE(2);
    if (magic !== 42) {
        return undefined;
    }

    const ifdOffset = littleEndian ? buffer.readUInt32LE(4) : buffer.readUInt32BE(4);
    if (ifdOffset + 2 > buffer.length) {
        return undefined;
    }

    const entryCount = littleEndian ? buffer.readUInt16LE(ifdOffset) : buffer.readUInt16BE(ifdOffset);
    let width: number | undefined;
    let height: number | undefined;
    for (let index = 0; index < entryCount; index += 1) {
        const entryOffset = ifdOffset + 2 + (index * 12);
        if (entryOffset + 12 > buffer.length) {
            break;
        }
        const tag = littleEndian ? buffer.readUInt16LE(entryOffset) : buffer.readUInt16BE(entryOffset);
        if (tag === 256) {
            width = readTiffFieldValue(buffer, entryOffset, littleEndian);
        } else if (tag === 257) {
            height = readTiffFieldValue(buffer, entryOffset, littleEndian);
        }
        if (isPositiveDimension(width) && isPositiveDimension(height)) {
            return { width, height };
        }
    }

    return undefined;
}

function readLibraryAssetDimensions(filePath: string): { width: number; height: number } | undefined {
    const format = detectLibraryAssetFormat(filePath);
    try {
        if (format === 'psd' || format === 'psb') {
            return readPsdLikeDimensions(filePath);
        }
        if (format === 'png') {
            return readPngDimensions(filePath);
        }
        if (format === 'jpg' || format === 'jpeg') {
            return readJpegDimensions(filePath);
        }
        if (format === 'webp') {
            return readWebpDimensions(filePath);
        }
        if (format === 'svg') {
            return readSvgDimensions(filePath);
        }
        if (format === 'tif' || format === 'tiff') {
            return readTiffDimensions(filePath);
        }
    } catch {
        return undefined;
    }
    return undefined;
}

function findFirstSupportedAssetFileInPackage(packageDir: string): string | undefined {
    if (!fs.existsSync(packageDir)) {
        return undefined;
    }
    try {
        const entries = fs.readdirSync(packageDir, { withFileTypes: true })
            .filter((entry) => entry.isFile())
            .map((entry) => entry.name)
            .filter((name) => name !== LIBRARY_ASSET_PACKAGE_INFO && isSupportedLibraryAssetFile(name))
            .sort((a, b) => a.localeCompare(b, 'zh-CN'));
        return entries[0];
    } catch {
        return undefined;
    }
}

function readLibraryAssetPackageInfo(packageDir: string): LibraryAssetPackageInfo | undefined {
    const infoPath = getLibraryAssetPackageInfoPath(packageDir);
    if (!fs.existsSync(infoPath)) {
        return undefined;
    }

    try {
        const raw = JSON.parse(fs.readFileSync(infoPath, 'utf-8')) as Partial<LibraryAssetPackageInfo>;
        const fallbackSourceFile = findFirstSupportedAssetFileInPackage(packageDir) || '';
        const normalizedExt = String(raw?.ext || path.extname(raw?.sourceFile || fallbackSourceFile)).replace(/^\./, '').toLowerCase();
        const sourceFileName = String(raw?.sourceFile || fallbackSourceFile || (normalizedExt ? `asset.${normalizedExt}` : '')).trim();
        if (!sourceFileName) {
            return undefined;
        }
        const sourcePath = path.join(packageDir, sourceFileName);
        if (!fs.existsSync(sourcePath)) {
            return undefined;
        }

        const sourceStats = fs.statSync(sourcePath);
        const normalizedName = sanitizeAssetBaseName(
            String(raw?.name || path.basename(sourceFileName, path.extname(sourceFileName))).trim(),
            'asset'
        );
        const id = String(raw?.id || path.basename(packageDir)).trim() || crypto.randomUUID();
        const createdAt = Number(raw?.createdAt || sourceStats.birthtimeMs || Date.now());
        const updatedAt = Number(raw?.updatedAt || sourceStats.mtimeMs || createdAt);
        const storedWidth = Number(raw?.width || 0);
        const storedHeight = Number(raw?.height || 0);
        const dimensions = (storedWidth > 0 && storedHeight > 0)
            ? { width: storedWidth, height: storedHeight }
            : readLibraryAssetDimensions(sourcePath);
        const width = dimensions?.width || storedWidth || 0;
        const height = dimensions?.height || storedHeight || 0;

        const info: LibraryAssetPackageInfo = {
            id,
            name: normalizedName,
            ext: normalizedExt || detectLibraryAssetFormat(sourcePath),
            width,
            height,
            size: String(raw?.size || (sourceStats.size / 1024).toFixed(2)),
            star: Number(raw?.star || 0),
            find: Array.isArray(raw?.find) ? raw.find.map((item) => String(item || '')).filter(Boolean) : [],
            time: String(raw?.time || formatAssetPackageTime(updatedAt)).trim() || formatAssetPackageTime(updatedAt),
            tags: Array.isArray(raw?.tags) ? raw.tags.map((item) => String(item || '')).filter(Boolean) : [],
            folder: Array.isArray(raw?.folder) ? raw.folder.map((item) => String(item || '')).filter(Boolean) : [],
            note: String(raw?.note || ''),
            Y: Number(raw?.Y || 0),
            sourceFile: sourceFileName,
            previewFile: typeof raw?.previewFile === 'string' && raw.previewFile.trim() ? raw.previewFile.trim() : undefined,
            assetType: (raw?.assetType as LibraryAssetType) || detectLibraryAssetType(sourcePath),
            createdAt,
            updatedAt
        };

        if ((storedWidth <= 0 || storedHeight <= 0) && width > 0 && height > 0) {
            try {
                writeLibraryAssetPackageInfo(packageDir, info);
            } catch {
                // Ignore metadata backfill failures and keep the in-memory dimensions.
            }
        }

        return info;
    } catch {
        return undefined;
    }
}

function writeLibraryAssetPackageInfo(packageDir: string, info: LibraryAssetPackageInfo): void {
    const infoPath = getLibraryAssetPackageInfoPath(packageDir);
    fs.writeFileSync(infoPath, JSON.stringify(info), 'utf-8');
}

function resolveLibraryAssetPackageSourcePath(packageDir: string, packageInfo?: LibraryAssetPackageInfo): string | undefined {
    const info = packageInfo || readLibraryAssetPackageInfo(packageDir);
    if (!info) {
        return undefined;
    }
    const sourcePath = path.join(packageDir, info.sourceFile);
    return fs.existsSync(sourcePath) ? sourcePath : undefined;
}

function resolveLibraryAssetPackagePreviewPath(packageDir: string, packageInfo?: LibraryAssetPackageInfo): string | undefined {
    const info = packageInfo || readLibraryAssetPackageInfo(packageDir);
    if (!info) {
        return undefined;
    }

    const preferredFile = String(info.previewFile || '').trim();
    if (preferredFile) {
        const preferredPath = path.join(packageDir, preferredFile);
        if (fs.existsSync(preferredPath)) {
            return preferredPath;
        }
    }

    const fallbackPath = path.join(packageDir, `${sanitizeAssetBaseName(info.name, 'preview')}.png`);
    if (fs.existsSync(fallbackPath)) {
        return fallbackPath;
    }
    return undefined;
}

function isLibraryAssetPackageDirectory(dirPath: string): boolean {
    return !!readLibraryAssetPackageInfo(dirPath);
}

function createLibraryAssetPackageFromFile(targetDir: string, sourcePath: string, displayName?: string): {
    packageDir: string;
    sourceFilePath: string;
    sourceFileName: string;
    info: LibraryAssetPackageInfo;
} {
    ensureDirectory(targetDir);
    const packageDir = path.join(targetDir, crypto.randomUUID());
    ensureDirectory(packageDir);

    const sourceExt = path.extname(sourcePath).replace(/^\./, '').toLowerCase();
    const sourceBaseName = sanitizeAssetBaseName(
        displayName || path.basename(sourcePath, path.extname(sourcePath)),
        'asset'
    );
    const sourceFileName = `${sourceBaseName}.${sourceExt || 'psd'}`;
    const sourceFilePath = path.join(packageDir, sourceFileName);
    fs.copyFileSync(sourcePath, sourceFilePath);

    const stats = fs.statSync(sourceFilePath);
    const now = Date.now();
    const dimensions = readLibraryAssetDimensions(sourceFilePath);
    const info: LibraryAssetPackageInfo = {
        id: path.basename(packageDir),
        name: sourceBaseName,
        ext: sourceExt || detectLibraryAssetFormat(sourceFilePath),
        width: dimensions?.width || 0,
        height: dimensions?.height || 0,
        size: (stats.size / 1024).toFixed(2),
        star: 0,
        find: [],
        time: formatAssetPackageTime(now),
        tags: [],
        folder: [],
        note: '',
        Y: 0,
        sourceFile: sourceFileName,
        assetType: detectLibraryAssetType(sourceFilePath),
        createdAt: now,
        updatedAt: now
    };
    writeLibraryAssetPackageInfo(packageDir, info);

    return {
        packageDir,
        sourceFilePath,
        sourceFileName,
        info
    };
}

function createLibraryAssetPackageFromBase64(
    targetDir: string,
    name: string,
    extension: string,
    base64Data: string
): {
    packageDir: string;
    sourceFilePath: string;
    sourceFileName: string;
    info: LibraryAssetPackageInfo;
} {
    ensureDirectory(targetDir);
    const packageDir = path.join(targetDir, crypto.randomUUID());
    ensureDirectory(packageDir);

    const sourceExt = String(extension || '').replace(/^\./, '').toLowerCase() || 'psd';
    const sourceBaseName = sanitizeAssetBaseName(name, 'asset');
    const sourceFileName = `${sourceBaseName}.${sourceExt}`;
    const sourceFilePath = path.join(packageDir, sourceFileName);
    const cleanBase64 = String(base64Data || '').replace(/^data:[^;]+;base64,/, '').trim();
    if (!cleanBase64) {
        throw new Error('Missing binary data to write');
    }
    fs.writeFileSync(sourceFilePath, Buffer.from(cleanBase64, 'base64'));

    const stats = fs.statSync(sourceFilePath);
    const now = Date.now();
    const dimensions = readLibraryAssetDimensions(sourceFilePath);
    const info: LibraryAssetPackageInfo = {
        id: path.basename(packageDir),
        name: sourceBaseName,
        ext: sourceExt,
        width: dimensions?.width || 0,
        height: dimensions?.height || 0,
        size: (stats.size / 1024).toFixed(2),
        star: 0,
        find: [],
        time: formatAssetPackageTime(now),
        tags: [],
        folder: [],
        note: '',
        Y: 0,
        sourceFile: sourceFileName,
        assetType: detectLibraryAssetType(sourceFilePath),
        createdAt: now,
        updatedAt: now
    };
    writeLibraryAssetPackageInfo(packageDir, info);

    return {
        packageDir,
        sourceFilePath,
        sourceFileName,
        info
    };
}

function buildLibraryAssetPreviewKey(filePath: string): string {
    return crypto.createHash('sha1').update(path.normalize(filePath)).digest('hex');
}

function getLibraryAssetPreviewPath(filePath: string): string {
    return path.join(getAssetPreviewDir(), `${buildLibraryAssetPreviewKey(filePath)}.png`);
}

function detectPreviewMimeFromBuffer(buffer: Buffer): string {
    if (buffer.length >= 8
        && buffer[0] === 0x89
        && buffer[1] === 0x50
        && buffer[2] === 0x4e
        && buffer[3] === 0x47) {
        return 'image/png';
    }
    if (buffer.length >= 3
        && buffer[0] === 0xff
        && buffer[1] === 0xd8
        && buffer[2] === 0xff) {
        return 'image/jpeg';
    }
    if (buffer.length >= 12
        && buffer[0] === 0x52
        && buffer[1] === 0x49
        && buffer[2] === 0x46
        && buffer[3] === 0x46
        && buffer[8] === 0x57
        && buffer[9] === 0x45
        && buffer[10] === 0x42
        && buffer[11] === 0x50) {
        return 'image/webp';
    }
    return 'image/png';
}

function readPsdInlinePreviewUrl(filePath: string): string | undefined {
    try {
        const stats = fs.statSync(filePath);
        if (stats.size > INLINE_LIBRARY_PSD_MAX_BYTES) {
            return undefined;
        }
        const buffer = fs.readFileSync(filePath);
        const psd = readPsd(buffer, {
            skipLayerImageData: true,
            skipCompositeImageData: true,
            skipThumbnail: false,
            useRawThumbnail: true
        } as any) as any;
        const rawThumbnail = psd?.imageResources?.thumbnailRaw?.data;
        if (!rawThumbnail || !rawThumbnail.length) {
            return undefined;
        }
        return `data:image/jpeg;base64,${Buffer.from(rawThumbnail).toString('base64')}`;
    } catch {
        return undefined;
    }
}

function readInlineLibraryAssetPreviewUrl(filePath: string): string | undefined {
    try {
        if (!fs.existsSync(filePath)) {
            return undefined;
        }

        const stats = fs.statSync(filePath);
        const cacheKey = path.normalize(filePath).toLowerCase();
        const cached = libraryAssetInlinePreviewCache.get(cacheKey);
        if (cached && cached.mtimeMs === stats.mtimeMs && cached.size === stats.size) {
            return cached.dataUrl;
        }

        const format = detectLibraryAssetFormat(filePath);
        let dataUrl: string | undefined;
        if (format === 'psd' || format === 'psb') {
            dataUrl = readPsdInlinePreviewUrl(filePath);
        }

        if (!dataUrl) {
            libraryAssetInlinePreviewCache.delete(cacheKey);
            return undefined;
        }

        setLibraryInlinePreviewCache(cacheKey, {
            mtimeMs: stats.mtimeMs,
            size: stats.size,
            dataUrl
        });
        return dataUrl;
    } catch {
        return undefined;
    }
}

function readLibraryAssetPreviewUrl(filePath: string): string | undefined {
    const previewPath = getLibraryAssetPreviewPath(filePath);
    return readPreviewDataUrlFromPath(previewPath);
}

function readPreviewDataUrlFromPath(previewPath: string): string | undefined {
    if (!fs.existsSync(previewPath)) {
        libraryAssetPreviewCache.delete(previewPath);
        return undefined;
    }

    try {
        const stat = fs.statSync(previewPath);
        const cached = libraryAssetPreviewCache.get(previewPath);
        if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
            return cached.dataUrl;
        }
        const buffer = fs.readFileSync(previewPath);
        const mime = detectPreviewMimeFromBuffer(buffer);
        const dataUrl = `data:${mime};base64,${buffer.toString('base64')}`;
        setLibraryAssetPreviewCache(previewPath, {
            mtimeMs: stat.mtimeMs,
            size: stat.size,
            dataUrl
        });
        return dataUrl;
    } catch {
        libraryAssetPreviewCache.delete(previewPath);
        return undefined;
    }
}

function readLibraryAssetPackagePreviewUrl(packageDir: string, packageInfo?: LibraryAssetPackageInfo): string | undefined {
    const previewPath = resolveLibraryAssetPackagePreviewPath(packageDir, packageInfo);
    if (!previewPath) {
        return undefined;
    }
    return readPreviewDataUrlFromPath(previewPath);
}

function writeLibraryAssetPreview(filePath: string, previewBase64: string): string | undefined {
    ensureStorageDir();
    const previewPath = getLibraryAssetPreviewPath(filePath);
    return writePreviewDataUrlToPath(previewPath, previewBase64);
}

function writePreviewDataUrlToPath(previewPath: string, previewBase64: string): string | undefined {
    const cleanBase64 = String(previewBase64 || '').replace(/^data:image\/[^;]+;base64,/, '').trim();
    if (!cleanBase64) {
        return undefined;
    }

    ensureDirectory(path.dirname(previewPath));
    const previewBuffer = Buffer.from(cleanBase64, 'base64');
    fs.writeFileSync(previewPath, previewBuffer);
    try {
        const stat = fs.statSync(previewPath);
        const mime = detectPreviewMimeFromBuffer(previewBuffer);
        setLibraryAssetPreviewCache(previewPath, {
            mtimeMs: stat.mtimeMs,
            size: stat.size,
            dataUrl: `data:${mime};base64,${cleanBase64}`
        });
    } catch {
        libraryAssetPreviewCache.delete(previewPath);
    }
    return previewPath;
}

function writeLibraryAssetPackagePreview(
    packageDir: string,
    packageInfo: LibraryAssetPackageInfo,
    previewBase64: string
): string | undefined {
    const mimeMatch = String(previewBase64 || '').match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,/);
    const mime = String(mimeMatch?.[1] || 'image/png').toLowerCase();
    const extByMime: Record<string, string> = {
        'image/png': 'png',
        'image/jpeg': 'jpg',
        'image/webp': 'webp'
    };
    const ext = extByMime[mime] || 'png';
    const previewBaseName = sanitizeAssetBaseName(packageInfo.name || 'preview', 'preview');
    const previewFileName = `${previewBaseName}.${ext}`;
    const previewPath = path.join(packageDir, previewFileName);
    const written = writePreviewDataUrlToPath(previewPath, previewBase64);
    if (!written) {
        return undefined;
    }

    const nextInfo: LibraryAssetPackageInfo = {
        ...packageInfo,
        previewFile: previewFileName,
        updatedAt: Date.now(),
        time: formatAssetPackageTime(Date.now())
    };
    writeLibraryAssetPackageInfo(packageDir, nextInfo);
    return written;
}

function moveLibraryAssetPreview(sourcePath: string, destinationPath: string): void {
    const sourcePreviewPath = getLibraryAssetPreviewPath(sourcePath);
    if (!fs.existsSync(sourcePreviewPath)) {
        libraryAssetPreviewCache.delete(sourcePreviewPath);
        return;
    }

    const destinationPreviewPath = getLibraryAssetPreviewPath(destinationPath);
    movePathSync(sourcePreviewPath, destinationPreviewPath);
    const cached = libraryAssetPreviewCache.get(sourcePreviewPath);
    libraryAssetPreviewCache.delete(sourcePreviewPath);
    if (cached) {
        setLibraryAssetPreviewCache(destinationPreviewPath, cached);
    } else {
        libraryAssetPreviewCache.delete(destinationPreviewPath);
    }
}

function getLibraryAssetPreviewInfo(
    filePath: string,
    linkedTemplate?: TemplateAsset,
    options?: {
        packageDir?: string;
        packageInfo?: LibraryAssetPackageInfo;
    }
): {
    thumbnailUrl?: string;
    textPreview?: string;
} {
    const packageDir = options?.packageDir;
    const packageInfo = options?.packageInfo;
    if (packageDir) {
        const packagePreview = readLibraryAssetPackagePreviewUrl(packageDir, packageInfo);
        if (packagePreview) {
            return { thumbnailUrl: packagePreview };
        }
    }

    const storedPreview = readLibraryAssetPreviewUrl(filePath);
    if (storedPreview) {
        return { thumbnailUrl: storedPreview };
    }

    const assetType = detectLibraryAssetType(filePath);
    if (linkedTemplate?.thumbnail) {
        return { thumbnailUrl: linkedTemplate.thumbnail };
    }
    if (assetType === 'text') {
        try {
            const raw = fs.readFileSync(filePath, 'utf-8');
            return {
                textPreview: raw.replace(/\s+/g, ' ').trim().slice(0, 80)
            };
        } catch {
            return {};
        }
    }
    return {};
}

type BuildLibraryAssetEntryOptions = {
    packageDir?: string;
    packageInfo?: LibraryAssetPackageInfo;
    displayName?: string;
    fileFormat?: string;
    assetType?: LibraryAssetType;
};

function sanitizeLibraryRelativePath(relativePath = ''): string {
    return String(relativePath || '')
        .replace(/[\\/]+/g, '/')
        .split('/')
        .map((segment) => segment.trim())
        .filter((segment) => segment && segment !== '.' && segment !== '..')
        .join('/');
}

function sanitizeAssetBaseName(input: string, fallback = 'asset'): string {
    const normalized = repairMaybeUtf8DecodedAsGbk(String(input || ''))
        .trim()
        .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
        .replace(/\s+/g, ' ')
        .replace(/\.[^.]+$/, '')
        .trim();
    return normalized || fallback;
}

function ensureDirectory(dirPath: string): void {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
}

function movePathSync(sourcePath: string, targetPath: string): void {
    ensureDirectory(path.dirname(targetPath));

    try {
        fs.renameSync(sourcePath, targetPath);
        return;
    } catch (error: any) {
        if (error?.code !== 'EXDEV') {
            throw error;
        }
    }

    const stats = fs.statSync(sourcePath);
    if (stats.isDirectory()) {
        fs.cpSync(sourcePath, targetPath, { recursive: true, force: true });
        fs.rmSync(sourcePath, { recursive: true, force: true });
        return;
    }

    fs.copyFileSync(sourcePath, targetPath);
    fs.rmSync(sourcePath, { force: true });
}

function buildLibraryAssetEntry(
    libraryTemplates: TemplateAsset[],
    fullPath: string,
    itemRelativePath: string,
    options?: BuildLibraryAssetEntryOptions
): LibraryAssetEntry {
    const linkedTemplate = libraryTemplates.find((item) => path.normalize(item.filePath) === path.normalize(fullPath));
    const name = String(options?.displayName || path.basename(fullPath, path.extname(fullPath))).trim()
        || path.basename(fullPath, path.extname(fullPath));
    const fileFormat = String(options?.fileFormat || detectLibraryAssetFormat(fullPath)).replace(/^\./, '').toLowerCase()
        || detectLibraryAssetFormat(fullPath);
    const assetType = options?.assetType || detectLibraryAssetType(fullPath);
    const packageInfo = options?.packageInfo;
    const tags = Array.from(new Set(
        (packageInfo?.tags || linkedTemplate?.tags || [])
            .map((item) => String(item || '').trim())
            .filter(Boolean)
    ));
    return {
        kind: 'template',
        name,
        relativePath: itemRelativePath,
        filePath: fullPath,
        fileFormat,
        assetType,
        ...getLibraryAssetPreviewInfo(fullPath, linkedTemplate, {
            packageDir: options?.packageDir,
            packageInfo
        }),
        templateId: linkedTemplate?.id,
        tags,
        width: Number(packageInfo?.width || 0),
        height: Number(packageInfo?.height || 0),
        fileSize: packageInfo?.size ? String(packageInfo.size) : undefined,
        updatedAt: Number(packageInfo?.updatedAt || 0) || undefined,
        updatedLabel: packageInfo?.time ? String(packageInfo.time) : undefined,
        note: packageInfo?.note ? String(packageInfo.note) : undefined
    };
}

function listLibraryDirectoryEntries(rootDir: string, relativePath: string, libraryTemplates: TemplateAsset[]): {
    directories: LibraryDirectoryEntry[];
    assets: LibraryAssetEntry[];
} {
    const cleanedRelativePath = sanitizeLibraryRelativePath(relativePath);
    const currentDir = path.resolve(rootDir, cleanedRelativePath || '.');
    const normalizedRootDir = path.resolve(rootDir);
    if (!currentDir.startsWith(normalizedRootDir) || !fs.existsSync(currentDir)) {
        return { directories: [], assets: [] };
    }

    const dirEntries = fs.readdirSync(currentDir, { withFileTypes: true })
        .filter((entry) => !SCAN_EXCLUDE_DIRS.has(entry.name.toLowerCase()));

    const directories: LibraryDirectoryEntry[] = [];
    const assets: LibraryAssetEntry[] = [];
    const sortedEntries = [...dirEntries].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));

    sortedEntries.forEach((entry) => {
        const itemRelativePath = [cleanedRelativePath, entry.name].filter(Boolean).join('/');
        const fullPath = path.join(currentDir, entry.name);

        if (entry.isDirectory()) {
            const packageInfo = readLibraryAssetPackageInfo(fullPath);
            const packageSourcePath = packageInfo
                ? resolveLibraryAssetPackageSourcePath(fullPath, packageInfo)
                : undefined;
            if (packageInfo && packageSourcePath) {
                assets.push(buildLibraryAssetEntry(
                    libraryTemplates,
                    packageSourcePath,
                    itemRelativePath,
                    {
                        packageDir: fullPath,
                        packageInfo,
                        displayName: packageInfo.name,
                        fileFormat: packageInfo.ext,
                        assetType: packageInfo.assetType || detectLibraryAssetType(packageSourcePath)
                    }
                ));
                return;
            }

            directories.push({
                kind: 'directory',
                name: entry.name,
                relativePath: itemRelativePath
            });
            return;
        }

        if (entry.isFile() && isSupportedLibraryAssetFile(entry.name)) {
            assets.push(buildLibraryAssetEntry(libraryTemplates, fullPath, itemRelativePath));
        }
    });

    directories.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
    assets.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));

    return { directories, assets };
}

function collectLibraryCatalogAssets(rootDir: string, libraryTemplates: TemplateAsset[]): LibraryAssetEntry[] {
    const assets: LibraryAssetEntry[] = [];
    const visit = (relativePath: string) => {
        const current = listLibraryDirectoryEntries(rootDir, relativePath, libraryTemplates);
        current.assets.forEach((asset) => assets.push(asset));
        current.directories.forEach((directory) => visit(directory.relativePath));
    };
    visit('');
    return assets;
}

function buildLibraryTagStats(assets: LibraryAssetEntry[]): LibraryTagStat[] {
    const counts = new Map<string, number>();
    (Array.isArray(assets) ? assets : []).forEach((asset) => {
        (Array.isArray(asset.tags) ? asset.tags : []).forEach((tag) => {
            const normalized = String(tag || '').trim();
            if (!normalized) {
                return;
            }
            counts.set(normalized, (counts.get(normalized) || 0) + 1);
        });
    });

    return Array.from(counts.entries())
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => {
            if (b.count !== a.count) {
                return b.count - a.count;
            }
            return a.name.localeCompare(b.name, 'zh-CN');
        });
}

function resolveLibraryDirectory(library: TemplateLibrary, relativePath = ''): {
    rootDir: string;
    targetDir: string;
    relativePath: string;
} {
    if (!library.dirPath || !library.dirPath.trim()) {
        throw new Error('Current design library has no directory configured');
    }

    const rootDir = path.resolve(library.dirPath);
    const cleanedRelativePath = sanitizeLibraryRelativePath(relativePath);
    const targetDir = path.resolve(rootDir, cleanedRelativePath || '.');
    const relativeToRoot = path.relative(rootDir, targetDir);
    if (relativeToRoot.startsWith('..') || path.isAbsolute(relativeToRoot)) {
        throw new Error('Invalid design library path');
    }

    ensureDirectory(targetDir);

    return {
        rootDir,
        targetDir,
        relativePath: cleanedRelativePath
    };
}

function buildUniqueNameInDirectory(targetDir: string, fileName: string): string {
    const ext = path.extname(fileName);
    const baseName = sanitizeAssetBaseName(path.basename(fileName, ext));
    let candidate = path.join(targetDir, `${baseName}${ext}`);
    let index = 2;

    while (fs.existsSync(candidate)) {
        candidate = path.join(targetDir, `${baseName}-${index}${ext}`);
        index += 1;
    }

    return candidate;
}

function resolveLibraryAssetPath(rootDir: string, cleanedRelativePath: string): {
    targetPath: string;
    sourcePath: string;
    sourceRelativePath: string;
    packageDir?: string;
    packageInfo?: LibraryAssetPackageInfo;
} {
    const targetPath = path.resolve(rootDir, cleanedRelativePath);
    const relativeToRoot = path.relative(rootDir, targetPath);
    if (relativeToRoot.startsWith('..') || path.isAbsolute(relativeToRoot) || !fs.existsSync(targetPath)) {
        throw new Error('Asset not found');
    }

    const stats = fs.statSync(targetPath);
    if (stats.isFile()) {
        return {
            targetPath,
            sourcePath: targetPath,
            sourceRelativePath: cleanedRelativePath
        };
    }

    if (stats.isDirectory()) {
        const packageInfo = readLibraryAssetPackageInfo(targetPath);
        if (!packageInfo) {
            throw new Error('Asset path is a group directory');
        }
        const sourcePath = resolveLibraryAssetPackageSourcePath(targetPath, packageInfo);
        if (!sourcePath) {
            throw new Error('Asset package source file is missing');
        }

        const sourceRelativePath = path.relative(rootDir, sourcePath).replace(/[\\/]+/g, '/');
        return {
            targetPath,
            sourcePath,
            sourceRelativePath,
            packageDir: targetPath,
            packageInfo
        };
    }

    throw new Error('Asset path is invalid');
}

function renameLibraryAssetPackage(
    libraryTemplates: TemplateAsset[],
    cleanedRelativePath: string,
    resolved: {
        sourcePath: string;
        packageDir?: string;
        packageInfo?: LibraryAssetPackageInfo;
    },
    nextName: string
): LibraryAssetEntry {
    if (!resolved.packageDir || !resolved.packageInfo) {
        throw new Error('Only packaged design library assets support renaming');
    }

    const packageDir = resolved.packageDir;
    const currentInfo = resolved.packageInfo;
    const cleanName = sanitizeAssetBaseName(nextName, currentInfo.name || 'asset');
    if (!cleanName) {
        throw new Error('Missing asset name');
    }

    const sourceExt = String(currentInfo.ext || path.extname(currentInfo.sourceFile)).replace(/^\./, '').toLowerCase()
        || detectLibraryAssetFormat(resolved.sourcePath)
        || 'psd';
    const currentSourcePath = resolved.sourcePath;
    const desiredSourceFileName = `${cleanName}.${sourceExt}`;
    let nextSourcePath = path.join(packageDir, desiredSourceFileName);

    if (path.normalize(nextSourcePath) !== path.normalize(currentSourcePath)) {
        if (fs.existsSync(nextSourcePath)) {
            nextSourcePath = buildUniqueNameInDirectory(packageDir, desiredSourceFileName);
        }
        fs.renameSync(currentSourcePath, nextSourcePath);
        moveLibraryAssetPreview(currentSourcePath, nextSourcePath);
    }

    const now = Date.now();
    const nextInfo: LibraryAssetPackageInfo = {
        ...currentInfo,
        name: cleanName,
        sourceFile: path.basename(nextSourcePath),
        updatedAt: now,
        time: formatAssetPackageTime(now)
    };
    writeLibraryAssetPackageInfo(packageDir, nextInfo);

    return buildLibraryAssetEntry(libraryTemplates, nextSourcePath, cleanedRelativePath, {
        packageDir,
        packageInfo: nextInfo,
        displayName: nextInfo.name,
        fileFormat: nextInfo.ext,
        assetType: nextInfo.assetType || detectLibraryAssetType(nextSourcePath)
    });
}

function movePathToTrash(originalPath: string): string {
    ensureStorageDir();
    const trashDir = getTrashDir();
    const ext = path.extname(originalPath);
    const baseName = sanitizeAssetBaseName(path.basename(originalPath, ext), 'deleted-item');
    const uniqueName = `${baseName}-${Date.now()}-${crypto.randomUUID().slice(0, 8)}${ext}`;
    const targetPath = path.join(trashDir, uniqueName);
    movePathSync(originalPath, targetPath);
    return targetPath;
}

function isPathInside(parentPath: string, candidatePath: string): boolean {
    const normalizedParent = path.resolve(parentPath);
    const normalizedCandidate = path.resolve(candidatePath);
    const relative = path.relative(normalizedParent, normalizedCandidate);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function pruneEmptyLibraryDirectories(rootDir: string, startDir: string): void {
    const normalizedRoot = path.resolve(rootDir);
    let currentDir = path.resolve(startDir);

    while (
        currentDir !== normalizedRoot &&
        isPathInside(normalizedRoot, currentDir)
    ) {
        if (!fs.existsSync(currentDir)) {
            currentDir = path.dirname(currentDir);
            continue;
        }

        let stats: fs.Stats;
        try {
            stats = fs.statSync(currentDir);
        } catch {
            break;
        }

        if (!stats.isDirectory()) {
            currentDir = path.dirname(currentDir);
            continue;
        }

        let entries: string[] = [];
        try {
            entries = fs.readdirSync(currentDir);
        } catch {
            break;
        }

        if (entries.length > 0) {
            break;
        }

        try {
            fs.rmdirSync(currentDir);
        } catch {
            break;
        }

        currentDir = path.dirname(currentDir);
    }
}

function takeTemplatesForLibraryPath(targetPath: string): TemplateAsset[] {
    const kb = readKnowledge();
    const removedTemplates = kb.templates.filter((item) => {
        const filePath = String(item.filePath || '').trim();
        return !!filePath && isPathInside(targetPath, filePath);
    });

    if (removedTemplates.length === 0) {
        return [];
    }

    kb.templates = kb.templates.filter((item) => !removedTemplates.some((removed) => removed.id === item.id));
    writeKnowledge(kb);
    return removedTemplates;
}

function restoreTemplates(templates: TemplateAsset[]): void {
    if (!Array.isArray(templates) || templates.length === 0) {
        return;
    }

    const kb = readKnowledge();
    const existingIds = new Set(kb.templates.map((item) => item.id));
    templates.forEach((item) => {
        if (!existingIds.has(item.id)) {
            kb.templates.push({
                ...item,
                updatedAt: Date.now()
            });
        }
    });
    writeKnowledge(kb);
}

function normalizeName(input: string): string {
    return input.trim().replace(/\.[^.]+$/, '').toLowerCase();
}

function extractComboSizeFromName(input: string): number | undefined {
    const match = input.match(/(\d+)/);
    if (!match) return undefined;
    const parsed = parseInt(match[1], 10);
    return Number.isFinite(parsed) ? parsed : undefined;
}

function scoreMatchedFile(filePath: string, targetName: string): number {
    const fileName = path.basename(filePath);
    const base = normalizeName(fileName);
    const target = normalizeName(targetName);
    let score = 0;

    if (base === target) score += 100;
    if (base.startsWith(target)) score += 30;
    if (base.includes(target)) score += 20;
    if (target.includes(base)) score += 8;
    if (filePath.includes(`${path.sep}模板文件${path.sep}`)) score += 15;

    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.psd') score += 5;
    if (ext === '.psb') score += 3;

    return score;
}

function findTemplateFilesByName(rootDir: string, targetName: string, maxDepth = 6, maxCount = 80): string[] {
    if (!rootDir || !fs.existsSync(rootDir)) return [];

    const queue: Array<{ dir: string; depth: number }> = [{ dir: rootDir, depth: 0 }];
    const candidates: string[] = [];

    while (queue.length > 0 && candidates.length < maxCount) {
        const current = queue.shift()!;
        let entries: fs.Dirent[] = [];
        try {
            entries = fs.readdirSync(current.dir, { withFileTypes: true });
        } catch {
            continue;
        }

        for (const entry of entries) {
            const fullPath = path.join(current.dir, entry.name);
            if (entry.isDirectory()) {
                if (current.depth >= maxDepth) continue;
                if (SCAN_EXCLUDE_DIRS.has(entry.name.toLowerCase())) continue;
                queue.push({ dir: fullPath, depth: current.depth + 1 });
                continue;
            }

            if (!entry.isFile()) continue;
            if (!isSupportedTemplateFile(entry.name)) continue;

            const normalizedFileName = normalizeName(entry.name);
            const normalizedTarget = normalizeName(targetName);
            if (normalizedFileName === normalizedTarget ||
                normalizedFileName.includes(normalizedTarget) ||
                normalizedTarget.includes(normalizedFileName)) {
                candidates.push(fullPath);
            }
        }
    }

    return candidates
        .sort((a, b) => scoreMatchedFile(b, targetName) - scoreMatchedFile(a, targetName))
        .slice(0, maxCount);
}

function getDefaultResolverSettings(): TemplateResolverSettings {
    return {
        localLibraryDirs: [],
        libraries: [],
        activeLibraryId: undefined
    };
}

function buildLibraryNameFromDir(dirPath: string, index: number): string {
    const baseName = path.basename(dirPath || '').trim();
    return baseName || `Library ${index + 1}`;
}

function normalizeLibrary(entry: Partial<TemplateLibrary>, index: number): TemplateLibrary | null {
    const name = String(entry.name || '').trim();
    const dirPath = String(entry.dirPath || '').trim();
    const dirToken = String((entry as any).dirToken || '').trim();
    if (!name && !dirPath) {
        return null;
    }

    return {
        id: String(entry.id || crypto.randomUUID()),
        name: name || buildLibraryNameFromDir(dirPath, index),
        dirPath: dirPath ? path.normalize(dirPath) : undefined,
        dirToken: dirToken || undefined,
        createdAt: Number(entry.createdAt || Date.now()),
        updatedAt: Number(entry.updatedAt || Date.now())
    };
}

function normalizeLibraries(parsed: Partial<TemplateResolverSettings>): TemplateLibrary[] {
    if (Array.isArray(parsed.libraries) && parsed.libraries.length > 0) {
        return parsed.libraries
            .map((entry, index) => normalizeLibrary(entry, index))
            .filter((entry): entry is TemplateLibrary => !!entry);
    }

    const legacyDirs = Array.isArray(parsed.localLibraryDirs)
        ? parsed.localLibraryDirs.filter((dir): dir is string => typeof dir === 'string' && !!dir.trim())
        : [];

    return legacyDirs.map((dir, index) => ({
        id: crypto.randomUUID(),
        name: buildLibraryNameFromDir(dir, index),
        dirPath: path.normalize(dir),
        createdAt: Date.now(),
        updatedAt: Date.now()
    }));
}

function readResolverSettings(): TemplateResolverSettings {
    ensureStorageDir();
    const settingsFile = getResolverSettingsFile();

    if (!fs.existsSync(settingsFile)) {
        const defaults = getDefaultResolverSettings();
        fs.writeFileSync(settingsFile, JSON.stringify(defaults, null, 2), 'utf-8');
        return defaults;
    }

    try {
        const content = fs.readFileSync(settingsFile, 'utf-8');
        const parsed = JSON.parse(content) as Partial<TemplateResolverSettings>;
        const libraries = normalizeLibraries(parsed);
        const activeLibraryId = String(parsed.activeLibraryId || '').trim();
        return {
            localLibraryDirs: libraries
                .map((item) => item.dirPath)
                .filter((dir): dir is string => !!dir),
            libraries,
            activeLibraryId: libraries.some((item) => item.id === activeLibraryId)
                ? activeLibraryId
                : libraries[0]?.id
        };
    } catch (error) {
        console.warn('[TemplateKnowledge] Failed to read resolver settings, using defaults.', error);
        return getDefaultResolverSettings();
    }
}

function writeResolverSettings(settings: TemplateResolverSettings): TemplateResolverSettings {
    ensureStorageDir();
    const libraries = (settings.libraries || [])
        .map((entry, index) => normalizeLibrary(entry, index))
        .filter((entry): entry is TemplateLibrary => !!entry);
    const normalizedDirs = Array.from(
        new Set(
            libraries
                .map((item) => item.dirPath)
                .filter((dir): dir is string => !!dir)
        )
    );

    const finalSettings: TemplateResolverSettings = {
        localLibraryDirs: normalizedDirs,
        libraries,
        activeLibraryId: libraries.some((item) => item.id === settings.activeLibraryId)
            ? settings.activeLibraryId
            : libraries[0]?.id
    };

    fs.writeFileSync(getResolverSettingsFile(), JSON.stringify(finalSettings, null, 2), 'utf-8');
    return finalSettings;
}

function listTemplateFilesInDirectory(rootDir: string, maxDepth = 5, maxCount = 300): string[] {
    if (!rootDir || !fs.existsSync(rootDir)) return [];

    const queue: Array<{ dir: string; depth: number }> = [{ dir: rootDir, depth: 0 }];
    const files: string[] = [];

    while (queue.length > 0 && files.length < maxCount) {
        const current = queue.shift()!;
        let entries: fs.Dirent[] = [];
        try {
            entries = fs.readdirSync(current.dir, { withFileTypes: true });
        } catch {
            continue;
        }

        for (const entry of entries) {
            const fullPath = path.join(current.dir, entry.name);
            if (entry.isDirectory()) {
                if (current.depth >= maxDepth) continue;
                if (SCAN_EXCLUDE_DIRS.has(entry.name.toLowerCase())) continue;
                queue.push({ dir: fullPath, depth: current.depth + 1 });
                continue;
            }
            if (!entry.isFile()) continue;
            if (!isSupportedTemplateFile(entry.name)) continue;
            files.push(fullPath);
            if (files.length >= maxCount) break;
        }
    }

    return files;
}

/**
 * 复制模板文件到知识库目录。
 */
function buildUniqueFilePath(targetDir: string, sourcePath: string): string {
    const ext = path.extname(sourcePath);
    const baseName = path.basename(sourcePath, ext);
    let candidate = path.join(targetDir, `${baseName}${ext}`);
    let index = 2;

    while (fs.existsSync(candidate)) {
        candidate = path.join(targetDir, `${baseName}-${index}${ext}`);
        index += 1;
    }

    return candidate;
}

function copyTemplateFile(sourcePath: string, targetDir?: string): string {
    ensureStorageDir();
    const resolvedTargetDir = targetDir && targetDir.trim() ? targetDir : getFilesDir();
    
    // 确保 files 目录存在。
    if (!fs.existsSync(resolvedTargetDir)) {
        fs.mkdirSync(resolvedTargetDir, { recursive: true });
    }

    const destPath = targetDir
        ? buildUniqueFilePath(resolvedTargetDir, sourcePath)
        : path.join(resolvedTargetDir, `${crypto.randomUUID()}${path.extname(sourcePath)}`);

    fs.copyFileSync(sourcePath, destPath);
    return destPath;
}

/**
 * 模板知识库服务类
 */
export class TemplateKnowledgeService {
    /**
     * 获取模板库存储信息
     */
    static getStorageInfo(): {
        rootPath: string;
        filesPath: string;
        dataFile: string;
        totalTemplates: number;
        supportedFormats: string[];
    } {
        const templates = this.getAll();
        return {
            rootPath: getStoragePath(),
            filesPath: getFilesDir(),
            dataFile: getDataFile(),
            totalTemplates: templates.length,
            supportedFormats: [...SUPPORTED_TEMPLATE_EXTS]
        };
    }

    static getLibraryContents(libraryId: string, relativePath = ''): {
        library: TemplateLibrary | null;
        relativePath: string;
        breadcrumbs: Array<{ name: string; relativePath: string }>;
        entries: Array<LibraryDirectoryEntry | LibraryAssetEntry>;
    } {
        const library = this.getLibraryById(libraryId);
        if (!library) {
            return { library: null, relativePath: '', breadcrumbs: [], entries: [] };
        }

        const cleanedRelativePath = String(relativePath || '')
            .replace(/[\\/]+/g, '/')
            .split('/')
            .filter((segment) => segment && segment !== '.' && segment !== '..')
            .join('/');

        const breadcrumbs = cleanedRelativePath
            ? cleanedRelativePath.split('/').map((segment, index, list) => ({
                name: segment,
                relativePath: list.slice(0, index + 1).join('/')
            }))
            : [];

        const entries: Array<LibraryDirectoryEntry | LibraryAssetEntry> = [];

        if (library.dirPath && fs.existsSync(library.dirPath)) {
            const libraryTemplates = this.getAll(libraryId);
            const current = listLibraryDirectoryEntries(library.dirPath, cleanedRelativePath, libraryTemplates);
            current.directories.forEach((entry) => {
                entries.push({
                    kind: 'directory',
                    name: entry.name,
                    relativePath: entry.relativePath
                });
            });
            current.assets.forEach((entry) => entries.push(entry));
        } else {
            this.getAll(libraryId).forEach((item) => {
                entries.push({
                    kind: 'template',
                    name: item.name,
                    relativePath: item.name,
                    filePath: item.filePath,
                    fileFormat: item.fileFormat,
                    assetType: detectLibraryAssetType(item.filePath),
                    ...getLibraryAssetPreviewInfo(item.filePath, item),
                    templateId: item.id
                });
            });
        }

        return {
            library,
            relativePath: cleanedRelativePath,
            breadcrumbs,
            entries
        };
    }

    static getLibraryCatalogContents(libraryId: string): {
        library: TemplateLibrary | null;
        assets: LibraryAssetEntry[];
        tags: LibraryTagStat[];
    } {
        const library = this.getLibraryById(libraryId);
        if (!library) {
            return { library: null, assets: [], tags: [] };
        }

        const assets: LibraryAssetEntry[] = library.dirPath && fs.existsSync(library.dirPath)
            ? collectLibraryCatalogAssets(library.dirPath, this.getAll(libraryId))
            : this.getAll(libraryId).map((item): LibraryAssetEntry => ({
                kind: 'template',
                name: item.name,
                relativePath: item.name,
                filePath: item.filePath,
                fileFormat: item.fileFormat,
                assetType: detectLibraryAssetType(item.filePath),
                ...getLibraryAssetPreviewInfo(item.filePath, item),
                templateId: item.id,
                tags: Array.isArray(item.tags) ? item.tags : []
            }));
        assets.sort((a, b) => {
            const updatedDiff = Number(b.updatedAt || 0) - Number(a.updatedAt || 0);
            if (updatedDiff !== 0) {
                return updatedDiff;
            }
            return String(a.name || '').localeCompare(String(b.name || ''), 'zh-CN');
        });
        return {
            library,
            assets,
            tags: buildLibraryTagStats(assets)
        };
    }

    /**
     * 获取模板解析设置
     */
    static getResolverSettings(): TemplateResolverSettings {
        return readResolverSettings();
    }

    /**
     * 保存模板解析设置
     */
    static setResolverSettings(settings: Partial<TemplateResolverSettings>): TemplateResolverSettings {
        const current = readResolverSettings();
        return writeResolverSettings({
            localLibraryDirs: Array.isArray(settings.localLibraryDirs)
                ? settings.localLibraryDirs
                : current.localLibraryDirs,
            libraries: Array.isArray(settings.libraries)
                ? settings.libraries
                : current.libraries,
            activeLibraryId: typeof settings.activeLibraryId === 'string'
                ? settings.activeLibraryId
                : current.activeLibraryId
        });
    }

    static getLibraries(): TemplateLibrary[] {
        return this.getResolverSettings().libraries || [];
    }

    static getActiveLibrary(): TemplateLibrary | null {
        const settings = this.getResolverSettings();
        return settings.libraries.find((item) => item.id === settings.activeLibraryId) || settings.libraries[0] || null;
    }

    static getLibraryById(id: string): TemplateLibrary | null {
        return this.getResolverSettings().libraries.find((item) => item.id === id) || null;
    }

    static createLibrary(name: string, dirPath?: string, dirToken?: string): { library: TemplateLibrary; settings: TemplateResolverSettings } {
        const trimmedName = String(name || '').trim();
        if (!trimmedName) {
            throw new Error('Missing template library name');
        }

        const current = this.getResolverSettings();
        const library: TemplateLibrary = {
            id: crypto.randomUUID(),
            name: trimmedName,
            dirPath: dirPath ? path.normalize(String(dirPath).trim()) : undefined,
            dirToken: dirToken ? String(dirToken).trim() : undefined,
            createdAt: Date.now(),
            updatedAt: Date.now()
        };
        const settings = this.setResolverSettings({
            libraries: [...current.libraries, library],
            activeLibraryId: library.id
        });
        return { library, settings };
    }

    static updateLibrary(id: string, updates: Partial<Pick<TemplateLibrary, 'name' | 'dirPath' | 'dirToken'>>): { library: TemplateLibrary; settings: TemplateResolverSettings } {
        const current = this.getResolverSettings();
        const libraries = current.libraries.map((item) => {
            if (item.id !== id) return item;
            return {
                ...item,
                name: typeof updates.name === 'string' && updates.name.trim() ? updates.name.trim() : item.name,
                dirPath: typeof updates.dirPath === 'string' && updates.dirPath.trim()
                    ? path.normalize(updates.dirPath.trim())
                    : item.dirPath,
                dirToken: typeof updates.dirToken === 'string' && updates.dirToken.trim()
                    ? updates.dirToken.trim()
                    : item.dirToken,
                updatedAt: Date.now()
            };
        });
        const library = libraries.find((item) => item.id === id);
        if (!library) {
            throw new Error('Design library not found');
        }
        const settings = this.setResolverSettings({
            libraries,
            activeLibraryId: current.activeLibraryId === id ? id : current.activeLibraryId
        });
        return { library, settings };
    }

    static importFilesToLibrary(libraryId: string, filePaths: string[], relativePath = '', options?: {
        displayNames?: string[];
    }): Array<{
        name: string;
        filePath: string;
        relativePath: string;
        fileFormat: string;
        assetType: 'design-file' | 'image' | 'text' | 'vector' | 'other';
    }> {
        const library = this.getLibraryById(libraryId);
        if (!library) {
            throw new Error('Design library not found');
        }
        const { rootDir, targetDir } = resolveLibraryDirectory(library, relativePath);
        const imported: Array<{
            name: string;
            filePath: string;
            relativePath: string;
            fileFormat: string;
            assetType: 'design-file' | 'image' | 'text' | 'vector' | 'other';
        }> = [];

        const displayNames = Array.isArray(options?.displayNames) ? options?.displayNames : [];

        for (let index = 0; index < filePaths.length; index += 1) {
            const originalPath = filePaths[index];
            const sourcePath = String(originalPath || '').trim();
            if (!sourcePath || !fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile()) {
                continue;
            }
            if (!isSupportedLibraryAssetFile(sourcePath)) {
                continue;
            }

            const sourceFormat = detectLibraryAssetFormat(sourcePath);
            const packaged = createLibraryAssetPackageFromFile(targetDir, sourcePath, displayNames[index]);
            imported.push({
                name: packaged.info.name,
                filePath: packaged.sourceFilePath,
                relativePath: path.relative(rootDir, packaged.packageDir).replace(/[\\/]+/g, '/'),
                fileFormat: packaged.info.ext || sourceFormat,
                assetType: packaged.info.assetType || detectLibraryAssetType(packaged.sourceFilePath)
            });
        }

        return imported;
    }

    static renameLibraryAsset(libraryId: string, relativePath: string, nextName: string): LibraryAssetEntry {
        const library = this.getLibraryById(libraryId);
        if (!library) {
            throw new Error('Design library not found');
        }
        const { rootDir } = resolveLibraryDirectory(library, '.');
        const cleanedRelativePath = sanitizeLibraryRelativePath(relativePath);
        if (!cleanedRelativePath) {
            throw new Error('Missing asset path');
        }

        const resolved = resolveLibraryAssetPath(rootDir, cleanedRelativePath);
        return renameLibraryAssetPackage(
            this.getAll(libraryId),
            cleanedRelativePath,
            resolved,
            nextName
        );
    }

    static importTextAssetToLibrary(libraryId: string, name: string, content: string, relativePath = ''): {
        name: string;
        filePath: string;
        relativePath: string;
        fileFormat: string;
        assetType: 'text';
    } {
        const library = this.getLibraryById(libraryId);
        if (!library) {
            throw new Error('Design library not found');
        }
        const { rootDir, targetDir } = resolveLibraryDirectory(library, relativePath);
        const packaged = createLibraryAssetPackageFromBase64(
            targetDir,
            name,
            'txt',
            Buffer.from(String(content || ''), 'utf-8').toString('base64')
        );
        return {
            name: packaged.info.name,
            filePath: packaged.sourceFilePath,
            relativePath: path.relative(rootDir, packaged.packageDir).replace(/[\\/]+/g, '/'),
            fileFormat: 'txt',
            assetType: 'text'
        };
    }

    static importBinaryAssetToLibrary(libraryId: string, name: string, base64Data: string, extension: string, relativePath = ''): {
        name: string;
        filePath: string;
        relativePath: string;
        fileFormat: string;
        assetType: 'design-file' | 'image' | 'text' | 'vector' | 'other';
    } {
        const library = this.getLibraryById(libraryId);
        if (!library) {
            throw new Error('Design library not found');
        }
        const normalizedExt = String(extension || 'png').replace(/^\./, '').toLowerCase();
        if (!SUPPORTED_LIBRARY_ASSET_EXTS.includes(`.${normalizedExt}`)) {
            throw new Error(`Unsupported asset format for import: ${normalizedExt}`);
        }
        const { rootDir, targetDir } = resolveLibraryDirectory(library, relativePath);
        const packaged = createLibraryAssetPackageFromBase64(targetDir, name, normalizedExt, base64Data);
        return {
            name: packaged.info.name,
            filePath: packaged.sourceFilePath,
            relativePath: path.relative(rootDir, packaged.packageDir).replace(/[\\/]+/g, '/'),
            fileFormat: packaged.info.ext || normalizedExt,
            assetType: packaged.info.assetType || detectLibraryAssetType(packaged.sourceFilePath)
        };
    }

    static readTextAsset(libraryId: string, relativePath: string): { content: string; filePath: string } {
        const library = this.getLibraryById(libraryId);
        if (!library) {
            throw new Error('Design library not found');
        }
        const { rootDir } = resolveLibraryDirectory(library, '.');
        const cleanedRelativePath = sanitizeLibraryRelativePath(relativePath);
        if (!cleanedRelativePath) {
            throw new Error('Missing text asset path');
        }
        const resolved = resolveLibraryAssetPath(rootDir, cleanedRelativePath);
        const filePath = resolved.sourcePath;
        return {
            content: fs.readFileSync(filePath, 'utf-8'),
            filePath
        };
    }

    static updateLibraryAssetTags(libraryId: string, relativePath: string, tags: string[]): LibraryAssetEntry {
        const library = this.getLibraryById(libraryId);
        if (!library) {
            throw new Error('Design library not found');
        }
        const { rootDir } = resolveLibraryDirectory(library, '.');
        const cleanedRelativePath = sanitizeLibraryRelativePath(relativePath);
        if (!cleanedRelativePath) {
            throw new Error('Missing asset path');
        }

        const resolved = resolveLibraryAssetPath(rootDir, cleanedRelativePath);
        if (!resolved.packageDir || !resolved.packageInfo) {
            throw new Error('Only packaged library assets support tags');
        }

        const normalizedTags = Array.from(new Set(
            (Array.isArray(tags) ? tags : [])
                .map((item) => String(item || '').trim())
                .filter(Boolean)
        ));
        const now = Date.now();
        const nextInfo: LibraryAssetPackageInfo = {
            ...resolved.packageInfo,
            tags: normalizedTags,
            updatedAt: now,
            time: formatAssetPackageTime(now)
        };
        writeLibraryAssetPackageInfo(resolved.packageDir, nextInfo);

        return buildLibraryAssetEntry(this.getAll(libraryId), resolved.sourcePath, cleanedRelativePath, {
            packageDir: resolved.packageDir,
            packageInfo: nextInfo,
            displayName: nextInfo.name,
            fileFormat: nextInfo.ext,
            assetType: nextInfo.assetType || detectLibraryAssetType(resolved.sourcePath)
        });
    }

    static getLibraryAssetFileInfo(libraryId: string, relativePath: string): {
        filePath: string;
        fileFormat: string;
        assetType: LibraryAssetType;
        resolvedRelativePath: string;
    } {
        const library = this.getLibraryById(libraryId);
        if (!library) {
            throw new Error('Library not found');
        }
        const { rootDir } = resolveLibraryDirectory(library, '.');
        const cleanedRelativePath = sanitizeLibraryRelativePath(relativePath);
        if (!cleanedRelativePath) {
            throw new Error('Missing asset path');
        }

        const resolved = resolveLibraryAssetPath(rootDir, cleanedRelativePath);
        const filePath = resolved.sourcePath;

        return {
            filePath,
            fileFormat: detectLibraryAssetFormat(filePath),
            assetType: detectLibraryAssetType(filePath),
            resolvedRelativePath: resolved.sourceRelativePath
        };
    }

    static setLibraryAssetPreview(libraryId: string, relativePath: string, previewBase64: string): boolean {
        const library = this.getLibraryById(libraryId);
        if (!library) {
            throw new Error('Design library not found');
        }

        const { rootDir } = resolveLibraryDirectory(library, '.');
        const cleanedRelativePath = sanitizeLibraryRelativePath(relativePath);
        if (!cleanedRelativePath) {
            throw new Error('Missing asset path');
        }

        const resolved = resolveLibraryAssetPath(rootDir, cleanedRelativePath);
        if (resolved.packageDir && resolved.packageInfo) {
            return !!writeLibraryAssetPackagePreview(resolved.packageDir, resolved.packageInfo, previewBase64);
        }
        return !!writeLibraryAssetPreview(resolved.sourcePath, previewBase64);
    }

    static deleteLibraryEntry(libraryId: string, relativePath: string): boolean {
        const library = this.getLibraryById(libraryId);
        if (!library) {
            throw new Error('Design library not found');
        }
        const { rootDir } = resolveLibraryDirectory(library, '.');
        const cleanedRelativePath = sanitizeLibraryRelativePath(relativePath);
        if (!cleanedRelativePath) {
            throw new Error('Missing asset path');
        }
        const targetPath = path.resolve(rootDir, cleanedRelativePath);
        const relativeToRoot = path.relative(rootDir, targetPath);
        if (relativeToRoot.startsWith('..') || path.isAbsolute(relativeToRoot) || !fs.existsSync(targetPath)) {
            return false;
        }
        fs.rmSync(targetPath, { recursive: true, force: true });
        pruneEmptyLibraryDirectories(rootDir, path.dirname(targetPath));
        return true;
    }

    static deleteLibraryEntryWithUndo(libraryId: string, relativePath: string): boolean {
        const library = this.getLibraryById(libraryId);
        if (!library) {
            throw new Error('Design library not found');
        }
        const { rootDir } = resolveLibraryDirectory(library, '.');
        const cleanedRelativePath = sanitizeLibraryRelativePath(relativePath);
        if (!cleanedRelativePath) {
            throw new Error('Missing asset path');
        }
        const targetPath = path.resolve(rootDir, cleanedRelativePath);
        const relativeToRoot = path.relative(rootDir, targetPath);
        if (relativeToRoot.startsWith('..') || path.isAbsolute(relativeToRoot) || !fs.existsSync(targetPath)) {
            return false;
        }

        const trashedPath = movePathToTrash(targetPath);
        const removedTemplates = takeTemplatesForLibraryPath(targetPath);
        pruneEmptyLibraryDirectories(rootDir, path.dirname(targetPath));
        deletedLibraryEntries.push({
            kind: 'library-entry',
            deletedAt: Date.now(),
            libraryId,
            relativePath: cleanedRelativePath,
            originalPath: targetPath,
            trashedPath,
            isDirectory: fs.existsSync(trashedPath) && fs.statSync(trashedPath).isDirectory(),
            removedTemplates
        });
        return true;
    }

    static deleteTemplateWithUndo(id: string): boolean {
        const kb = readKnowledge();
        const index = kb.templates.findIndex((item) => item.id === id);
        if (index === -1) return false;

        const template = kb.templates[index];
        let trashedFilePath: string | undefined;
        let trashedThumbnailPath: string | undefined;

        if (template.filePath && fs.existsSync(template.filePath)) {
            trashedFilePath = movePathToTrash(template.filePath);
        }

        try {
            if (template.thumbnail) {
                const thumbPath = path.join(getThumbnailDir(), `${template.id}.jpg`);
                if (fs.existsSync(thumbPath)) {
                    trashedThumbnailPath = movePathToTrash(thumbPath);
                }
            }
        } catch (error) {
            console.warn('[TemplateKnowledge] Move deleted template thumbnail to trash failed:', error);
        }

        kb.templates.splice(index, 1);
        writeKnowledge(kb);

        deletedLibraryEntries.push({
            kind: 'template',
            deletedAt: Date.now(),
            template,
            trashedFilePath,
            trashedThumbnailPath
        });
        return true;
    }

    static restoreLastDeletedEntry(): boolean {
        const last = deletedLibraryEntries.pop();
        if (!last) return false;

        if (last.kind === 'library-entry') {
            ensureDirectory(path.dirname(last.originalPath));
            if (fs.existsSync(last.trashedPath)) {
                movePathSync(last.trashedPath, last.originalPath);
                restoreTemplates(last.removedTemplates);
                return true;
            }
            return false;
        }

        const kb = readKnowledge();
        if (last.trashedFilePath && fs.existsSync(last.trashedFilePath)) {
            ensureDirectory(path.dirname(last.template.filePath));
            movePathSync(last.trashedFilePath, last.template.filePath);
        }
        if (last.trashedThumbnailPath && fs.existsSync(last.trashedThumbnailPath)) {
            const thumbPath = path.join(getThumbnailDir(), `${last.template.id}.jpg`);
            ensureDirectory(path.dirname(thumbPath));
            movePathSync(last.trashedThumbnailPath, thumbPath);
        }

        kb.templates.push({
            ...last.template,
            updatedAt: Date.now()
        });
        writeKnowledge(kb);
        return true;
    }

    static removeLibrary(id: string): TemplateResolverSettings {
        const current = this.getResolverSettings();
        const libraries = current.libraries.filter((item) => item.id !== id);
        const nextActiveId = current.activeLibraryId === id ? libraries[0]?.id : current.activeLibraryId;
        return this.setResolverSettings({
            libraries,
            activeLibraryId: nextActiveId
        });
    }

    static setActiveLibrary(id: string): TemplateResolverSettings {
        const current = this.getResolverSettings();
        if (!current.libraries.some((item) => item.id === id)) {
            throw new Error('Design library not found');
        }
        return this.setResolverSettings({ activeLibraryId: id });
    }

    /**
     * 获取 SKU 模板候选（顺序：用户本地库 → 知识库）
     */
    static getSKUTemplateCandidates(): SKUTemplateCandidate[] {
        const settings = this.getResolverSettings();
        const candidates: SKUTemplateCandidate[] = [];
        const seen = new Set<string>();

        // 1) 用户设置的本地模板库
        settings.localLibraryDirs.forEach((dir, dirIndex) => {
            if (!dir || !fs.existsSync(dir)) return;
            const files = listTemplateFilesInDirectory(dir, 5, 300);
            for (const filePath of files) {
                const normalizedPath = path.normalize(filePath).toLowerCase();
                if (seen.has(normalizedPath)) continue;
                seen.add(normalizedPath);
                const fileName = path.basename(filePath, path.extname(filePath));
                candidates.push({
                    id: `local-${crypto.createHash('md5').update(normalizedPath).digest('hex')}`,
                    name: fileName,
                    filePath,
                    source: 'local-library',
                    sourcePriority: dirIndex
                });
            }
        });

        // 2) 已入库的模板知识（作为补充）
        const knowledgeTemplates = this.query({ type: 'sku' });
        for (const item of knowledgeTemplates) {
            const normalizedPath = path.normalize(item.filePath).toLowerCase();
            if (seen.has(normalizedPath)) continue;
            seen.add(normalizedPath);
            candidates.push({
                id: item.id,
                name: item.name,
                filePath: item.filePath,
                description: item.description,
                metadata: item.metadata ? { comboSize: item.metadata.comboSize } : undefined,
                source: 'template-library',
                sourcePriority: 1000
            });
        }

        return candidates;
    }

    /**
     * 查找最匹配的 SKU 模板（顺序仍遵循 `sourcePriority`）
     */
    static findTemplateForSKU(params: FindSKUTemplateParams): SKUTemplateCandidate | null {
        const comboSize = Number(params.comboSize || 0);
        if (!Number.isFinite(comboSize) || comboSize <= 0) return null;

        const keyword = String(params.keyword || '').trim().toLowerCase();
        const noteMode = params.noteMode === true;
        const sourceSet = Array.isArray(params.sources) && params.sources.length > 0
            ? new Set(params.sources)
            : null;
        const sizeKeyword = `${comboSize}\u53ea`;
        const noteKeyword = '\u81ea\u9009\u5907\u6ce8';

        const scored = this.getSKUTemplateCandidates()
            .filter(item => !sourceSet || sourceSet.has(item.source))
            .map((item) => {
                const name = normalizeName(item.name || path.basename(item.filePath));
                const description = String(item.description || '').toLowerCase();
                const hasNote = name.includes(noteKeyword);
                if (noteMode && !hasNote) return { item, score: -Infinity };
                if (!noteMode && hasNote) return { item, score: -Infinity };

                let score = 0;
                const inferredSize = item.metadata?.comboSize ?? extractComboSizeFromName(item.name) ?? extractComboSizeFromName(item.filePath);
                if (inferredSize === comboSize) score += 100;
                if (name.includes(sizeKeyword)) score += 60;
                if (keyword && (name.includes(keyword) || description.includes(keyword))) score += 25;
                if (name.includes('模板')) score += 8;
                if (/\.psd$/i.test(item.filePath)) score += 4;
                if (/\.psb$/i.test(item.filePath)) score += 2;

                // 同分时优先 sourcePriority 更小（即用户本地库优先）
                score += Math.max(0, 20 - item.sourcePriority / 100);
                return { item, score };
            })
            .filter(row => Number.isFinite(row.score))
            .sort((a, b) => {
                if (b.score !== a.score) return b.score - a.score;
                return a.item.sourcePriority - b.item.sourcePriority;
            });

        return scored.length > 0 ? scored[0].item : null;
    }

    /**
     * 获取可用 SKU 规格（从候选模板提取）
     */
    static getAvailableSKUSpecs(params?: GetAvailableSKUSpecsParams): number[] {
        const sources = params?.sources;
        const sourceSet = Array.isArray(sources) && sources.length > 0
            ? new Set(sources)
            : null;
        const noteKeyword = '\u81ea\u9009\u5907\u6ce8';
        const specs = new Set<number>();
        for (const item of this.getSKUTemplateCandidates()) {
            if (sourceSet && !sourceSet.has(item.source)) continue;
            const name = normalizeName(item.name || '');
            if (name.includes(noteKeyword)) continue;
            const size = item.metadata?.comboSize ?? extractComboSizeFromName(item.name) ?? extractComboSizeFromName(item.filePath);
            if (size && size > 0) specs.add(size);
        }
        return Array.from(specs).sort((a, b) => a - b);
    }

    /**
     * 解析 Photoshop 文档对应的源文件路径
     */
    static resolvePhotoshopDocumentFile(params: ResolvePhotoshopTemplateFileParams): { filePath: string } {
        const documentName = (params.documentName || '').trim();
        if (!documentName) {
            throw new Error('缺少 documentName，无法解析模板源文件');
        }

        // 1) 如果 UXP 已提供文档路径，直接使用
        const docPath = params.documentPath?.trim();
        if (docPath && fs.existsSync(docPath) && isSupportedTemplateFile(docPath)) {
            return { filePath: docPath };
        }

        // 2) 在项目目录中尝试解析（优先"模板文件"目录）
        const projectPath = params.currentProjectPath?.trim();
        if (projectPath && fs.existsSync(projectPath)) {
            const targetBase = normalizeName(documentName);
            const targetExt = path.extname(documentName).toLowerCase();
            const roots = [
                path.join(projectPath, '模板文件'),
                projectPath
            ].filter((dirPath, index, arr) => arr.indexOf(dirPath) === index && fs.existsSync(dirPath));

            for (const root of roots) {
                // Fast O(1) direct checks for exact filename matches.
                const directCandidates: string[] = [];
                if (targetExt && SUPPORTED_TEMPLATE_EXTS.includes(targetExt)) {
                    directCandidates.push(path.join(root, documentName));
                }
                for (const ext of SUPPORTED_TEMPLATE_EXTS) {
                    directCandidates.push(path.join(root, `${targetBase}${ext}`));
                }

                const direct = directCandidates.find(candidate => fs.existsSync(candidate) && isSupportedTemplateFile(candidate));
                if (direct) {
                    return { filePath: direct };
                }

                // 再做有限深度扫描（支持如"双装-模板A"这类命名）。
                // 防静默开错文件（真机：请求"4双装.tif"不存在→模糊匹配开了"4双自选备注-卡片模板v4.tif"）：
                // 当请求名带明确规格数（N双）时，模糊匹配结果必须同规格，否则视为未命中——
                // 宁可诚实报"找不到"，不静默打开一个规格不符的模板导致后续占位槽数不匹配。
                const requestedSize = extractComboSizeFromName(documentName);
                const scanned = findTemplateFilesByName(root, documentName)
                    .filter((candidate) => {
                        if (requestedSize === undefined) return true;
                        const candidateSize = extractComboSizeFromName(path.basename(candidate));
                        return candidateSize === undefined || candidateSize === requestedSize;
                    });
                if (scanned.length > 0) {
                    return { filePath: scanned[0] };
                }
            }
        }

        // 3) 在用户设置的本地模板库中查找
        const resolver = this.getResolverSettings();
        for (const localDir of resolver.localLibraryDirs) {
            if (!localDir || !fs.existsSync(localDir)) continue;
            const scanned = findTemplateFilesByName(localDir, documentName);
            if (scanned.length > 0) {
                return { filePath: scanned[0] };
            }
        }

        throw new Error('无法定位 Photoshop 文档对应的模板文件，请先保存文档或手动选择文件');
    }
    /**
     * 获取所有模板
     */
    static getAll(libraryId?: string): TemplateAsset[] {
        const kb = readKnowledge();
        if (!libraryId) {
            return kb.templates;
        }
        return kb.templates.filter((item) => item.libraryId === libraryId);
    }
    
    /**
     * 按条件查询模板
     */
    static query(params: TemplateQuery): TemplateAsset[] {
        const kb = readKnowledge();
        let templates = [...kb.templates];
        
        // 按类型筛选
        if (params.type) {
            templates = templates.filter(t => t.type === params.type);
        }

        if (params.libraryId) {
            templates = templates.filter(t => t.libraryId === params.libraryId);
        }
        
        // 按标签筛选
        if (params.tags && params.tags.length > 0) {
            templates = templates.filter(t => 
                t.tags?.some(tag => params.tags!.includes(tag))
            );
        }
        
        // 按类目筛选
        if (params.category) {
            templates = templates.filter(t => 
                t.metadata?.category === params.category
            );
        }
        
        // 按规格筛选
        if (params.comboSize !== undefined) {
            templates = templates.filter(t => 
                t.metadata?.comboSize === params.comboSize
            );
        }
        
        // 关键词搜索
        if (params.keyword) {
            const kw = params.keyword.toLowerCase();
            templates = templates.filter(t => 
                t.name.toLowerCase().includes(kw) ||
                t.description.toLowerCase().includes(kw) ||
                t.tags?.some(tag => tag.toLowerCase().includes(kw))
            );
        }
        
        return templates;
    }
    
    /**
     * 获取单个模板
     */
    static getById(id: string): TemplateAsset | null {
        const kb = readKnowledge();
        return kb.templates.find(t => t.id === id) || null;
    }
    
    /**
     * 按类型获取模板（供 AI 使用）
     */
    static getByType(type: TemplateType): TemplateAsset[] {
        return this.query({ type });
    }
    
    /**
     * 获取 SKU 模板（按规格）
     */
    static getSKUTemplate(comboSize: number): TemplateAsset | null {
        const templates = this.query({ type: 'sku', comboSize });
        return templates[0] || null;
    }
    
    /**
     * 添加模板
     */
    static async add(params: AddTemplateParams): Promise<TemplateAsset> {
        const kb = readKnowledge();
        
        // Validate that the source file exists.
        if (!fs.existsSync(params.filePath)) {
            throw new Error(`模板文件不存在:  ${params.filePath}`);
        }
        if (!isSupportedTemplateFile(params.filePath)) {
            throw new Error(`不支持的模板格式: ${path.extname(params.filePath)}`);
        }
        
        // Copy the source file into managed storage.
        const targetLibrary = params.libraryId ? this.getLibraryById(params.libraryId) : this.getActiveLibrary();
        const targetDir = targetLibrary?.dirPath && fs.existsSync(targetLibrary.dirPath)
            ? targetLibrary.dirPath
            : undefined;
        const storedPath = copyTemplateFile(params.filePath, targetDir);
        
        // Detect the source file format.
        const fileFormat = detectFormat(params.filePath);
        
        const template: TemplateAsset = {
            id: crypto.randomUUID(),
            libraryId: params.libraryId || this.getActiveLibrary()?.id,
            name: params.name,
            type: params.type,
            filePath: storedPath,
            fileFormat,
            description: params.description,
            aiPrompt: params.aiPrompt,
            metadata: params.metadata,
            tags: params.tags,
            source: 'user',
            createdAt: Date.now(),
            updatedAt: Date.now()
        };
        
        kb.templates.push(template);
        writeKnowledge(kb);
        
        console.log(`[TemplateKnowledge] 添加模板: ${template.name} (${template.id})`);
        return template;
    }

    /**
     * 从 Photoshop 文档直接添加模板
     */
    static async addFromPhotoshop(params: AddTemplateFromPhotoshopParams): Promise<TemplateAsset> {
        const resolved = this.resolvePhotoshopDocumentFile({
            documentName: params.documentName,
            documentPath: params.documentPath,
            currentProjectPath: params.currentProjectPath
        });

        const defaultName = path.basename(params.documentName || resolved.filePath, path.extname(params.documentName || resolved.filePath));
        const comboSize = extractComboSizeFromName(params.documentName || defaultName);
        const mergedMetadata = {
            ...params.metadata,
            sourcePath: resolved.filePath,
            sourceDocumentName: params.documentName
        };

        if (params.type === 'sku' && !mergedMetadata.comboSize && comboSize) {
            mergedMetadata.comboSize = comboSize;
        }

        return this.add({
            name: defaultName,
            type: params.type,
            libraryId: params.libraryId,
            filePath: resolved.filePath,
            description: params.description?.trim() || `Imported from Photoshop document "${defaultName}"`,
            aiPrompt: params.aiPrompt,
            metadata: mergedMetadata,
            tags: params.tags
        });
    }
    
    /**
     * 更新模板
     */
    static update(params: UpdateTemplateParams): TemplateAsset {
        const kb = readKnowledge();
        const index = kb.templates.findIndex(t => t.id === params.id);
        
        if (index === -1) {
            throw new Error(`模板不存在: ${params.id}`);
        }
        
        const template = kb.templates[index];
        
        // 更新字段
        if (params.name !== undefined) template.name = params.name;
        if (params.description !== undefined) template.description = params.description;
        if (params.aiPrompt !== undefined) template.aiPrompt = params.aiPrompt;
        if (params.metadata !== undefined) template.metadata = { ...template.metadata, ...params.metadata };
        if (params.tags !== undefined) template.tags = params.tags;
        
        template.updatedAt = Date.now();
        
        kb.templates[index] = template;
        writeKnowledge(kb);
        
        console.log(`[TemplateKnowledge] 更新模板: ${template.name}`);
        return template;
    }
    
    /**
     * 删除模板
     */
    static delete(id: string): boolean {
        const kb = readKnowledge();
        const index = kb.templates.findIndex(t => t.id === id);
        
        if (index === -1) {
            return false;
        }
        
        const template = kb.templates[index];
        
        // 删除关联文件
        try {
            if (template.filePath && fs.existsSync(template.filePath)) {
                fs.unlinkSync(template.filePath);
            }
            if (template.thumbnail) {
                const thumbPath = path.join(getThumbnailDir(), `${template.id}.jpg`);
                if (fs.existsSync(thumbPath)) {
                    fs.unlinkSync(thumbPath);
                }
            }
        } catch (e) {
            console.warn('[TemplateKnowledge] 删除文件失败:', e);
        }
        
        kb.templates.splice(index, 1);
        writeKnowledge(kb);
        
        console.log(`[TemplateKnowledge] 删除模板: ${template.name}`);
        return true;
    }
    
    /**
     * 设置缩略图
     */
    static setThumbnail(id: string, thumbnailBase64: string): boolean {
        const kb = readKnowledge();
        const template = kb.templates.find(t => t.id === id);
        
        if (!template) return false;
        
        // 保存缩略图文件
        const thumbnailDir = getThumbnailDir();
        const thumbPath = path.join(thumbnailDir, `${id}.jpg`);
        
        // 去除 Base64 前缀
        const base64Data = thumbnailBase64.replace(/^data:image\/\w+;base64,/, '');
        fs.writeFileSync(thumbPath, Buffer.from(base64Data, 'base64'));
        
        template.thumbnail = `file://${thumbPath}`;
        template.updatedAt = Date.now();
        
        writeKnowledge(kb);
        return true;
    }
    
    /**
     * 设置模板规格
     */
    static setSpecs(id: string, specs: TemplateSpecs): boolean {
        const kb = readKnowledge();
        const template = kb.templates.find(t => t.id === id);
        
        if (!template) return false;
        
        template.specs = specs;
        template.updatedAt = Date.now();
        
        writeKnowledge(kb);
        return true;
    }
    
    /**
     * 获取模板描述（供 AI 使用）
     */
    static getTemplateDescriptionForAI(id: string): string {
        const template = this.getById(id);
        if (!template) return '';
        
        let description = `模板名称: ${template.name}\n`;
        description += `类型: ${template.type}\n`;
        description += `描述: ${template.description}\n`;
        
        if (template.aiPrompt) {
            description += `使用提示: ${template.aiPrompt}\n`;
        }
        
        if (template.metadata) {
            const meta = template.metadata;
            if (meta.comboSize) description += `规格: ${meta.comboSize}只装\n`;
            if (meta.category) description += `类目: ${meta.category}\n`;
            if (meta.placeholderLayers?.length) {
                description += `占位图层: ${meta.placeholderLayers.join(', ')}\n`;
            }
            if (meta.textLayers?.length) {
                description += `文字图层: ${meta.textLayers.join(', ')}\n`;
            }
            if (meta.layerStructure) {
                description += `图层结构: ${meta.layerStructure}\n`;
            }
        }
        
        if (template.specs) {
            description += `尺寸: ${template.specs.width}x${template.specs.height}px\n`;
        }
        
        return description;
    }
    
    /**
     * 获取所有模板的 AI 摘要
     */
    static getAllTemplatesForAI(): string {
        const templates = this.getAll();
        
        if (templates.length === 0) {
            return 'No templates in knowledge base.';
        }
        
        let summary = `Knowledge base contains ${templates.length} template(s).\n\n`;
        
        // 按类型分组
        const byType: Record<string, TemplateAsset[]> = {};
        for (const t of templates) {
            if (!byType[t.type]) byType[t.type] = [];
            byType[t.type].push(t);
        }
        
        const typeLabels: Record<string, string> = {
            'sku': 'SKU Template',
            'detail-page': 'Detail Page Template',
            'banner': 'Banner Template',
            'main-image': 'Main Image Template',
            'other': 'Other Template'
        };
        
        for (const [type, list] of Object.entries(byType)) {
            summary += `## ${typeLabels[type] || type}\n`;
            for (const t of list) {
                summary += `- ${t.name}`;
                if (t.metadata?.comboSize) summary += ` (${t.metadata.comboSize}-pack)`;
                summary += `: ${t.description}\n`;
            }
            summary += '\n';
        }
        
        return summary;
    }
    
    /**
     * 导出模板列表（JSON）
     */
    static exportJSON(): string {
        const templates = this.getAll();
        return JSON.stringify(templates, null, 2);
    }
    
    /**
     * 导入模板列表（JSON）
     */
    static importJSON(jsonContent: string): { imported: number; errors: string[] } {
        const errors: string[] = [];
        let imported = 0;
        
        try {
            const data = JSON.parse(jsonContent);
            const templates = Array.isArray(data) ? data : data.templates || [];
            
            for (const item of templates) {
                try {
                    if (!item.name || !item.filePath || !item.description) {
                        errors.push(`Skip invalid template: ${item.name || 'Unnamed'}`);
                        continue;
                    }
                    
                    // 检查文件是否存在
                    if (!fs.existsSync(item.filePath)) {
                        errors.push(`File does not exist: ${item.filePath}`);
                        continue;
                    }
                    
                    this.add({
                        name: item.name,
                        type: item.type || 'other',
                        filePath: item.filePath,
                        description: item.description,
                        aiPrompt: item.aiPrompt,
                        metadata: item.metadata,
                        tags: item.tags
                    });
                    
                    imported++;
                } catch (e: any) {
                    errors.push(`Import failed: ${item.name} - ${e.message}`);
                }
            }
        } catch (e: any) {
            errors.push(`JSON parse failed: ${e.message}`);
        }
        
        return { imported, errors };
    }
}

export default TemplateKnowledgeService;
