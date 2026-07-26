import fs from 'fs';
import path from 'path';
import { TextDecoder } from 'util';

import {
    buildContextSnapshot,
    buildProjectAssetIndex,
    parseSkuConfigCsv,
    type ContextSnapshot,
    type ContextSnapshotInput,
    type ProjectAssetFolderRole,
    type ProjectAssetIndex,
    type ProjectAssetIndexFileInput,
    type ProjectAssetSkuConfigRow
} from '../../shared/project-asset-index';
import {
    buildProjectVisualInsightCacheManifest,
    buildProjectVisualInsightCacheReadResult,
    type ProjectVisualInsightCacheManifest,
    type ProjectVisualInsightCacheReadResult
} from '../../shared/project-visual-insight-cache';
import {
    buildProjectVisualSamplingPlan,
    type ProjectVisualSamplingCacheEntry,
    type ProjectVisualSamplingPlan,
    type ProjectVisualSamplingScenario
} from '../../shared/project-visual-sampling';
import {
    ecommerceProjectService,
    type EcommerceProjectStructure,
    type FolderInfo,
    type FolderType,
    type ImageFile,
    type ProjectConfig
} from './ecommerce-project-service';
import { serializedFileOperations } from './serialized-file-operations';

const fsPromises = fs.promises;

const CONFIG_EXTENSIONS = new Set(['.csv', '.json', '.txt', '.md']);
const SKU_CONFIG_NAME_PATTERN = /sku|规格|组合|配置|config|variant|color/i;
const MAX_CONFIG_FILE_BYTES = 2 * 1024 * 1024;
const MAX_CONFIG_SCAN_DEPTH = 4;
const VISUAL_INSIGHT_CACHE_RELATIVE_PATH = path.join('.designecho', 'visual-insights-cache.json');
const SKIPPED_DIRECTORIES = new Set([
    'node_modules',
    'dist',
    'build',
    'tmp',
    'temp',
    '.git'
]);

export interface ProjectContextSnapshotBuildOptions {
    projectPath: string;
    projectName?: string;
    currentDocument?: ContextSnapshotInput['currentDocument'];
    selectedAssetPaths?: string[];
    userConstraints?: string[];
    taskHistory?: string[];
    unverifiedItems?: string[];
    visualSamplingScenario?: ProjectVisualSamplingScenario;
    maxVisualSamples?: number;
    visualSamplingCache?: ProjectVisualSamplingCacheEntry[];
    usePersistedVisualInsightCache?: boolean;
}

export interface ProjectContextSnapshotBuildResult {
    success: true;
    source: 'runtime-project-service';
    projectPath: string;
    projectName: string;
    contextSnapshot: ContextSnapshot;
    assetIndex: ProjectAssetIndex;
    visualSamplingPlan: ProjectVisualSamplingPlan;
    visualInsightCache: ProjectVisualInsightCacheReadResult;
    warnings: string[];
    limitations: string[];
}

export interface ProjectVisualInsightCacheWriteOptions {
    projectPath: string;
    entries: ProjectVisualSamplingCacheEntry[];
    replace?: boolean;
    nowIso?: string;
}

export interface ProjectVisualInsightCacheWriteResult {
    success: true;
    source: 'runtime-project-service';
    cachePath: string;
    manifest: ProjectVisualInsightCacheManifest;
    readResult: ProjectVisualInsightCacheReadResult;
}

function normalizePath(value: string): string {
    return String(value || '').trim().replace(/\\/g, '/');
}

function toRelativePath(projectPath: string, filePath: string): string {
    return normalizePath(path.relative(projectPath, filePath) || path.basename(filePath));
}

function mapFolderTypeToAssetRole(folderType?: string): ProjectAssetFolderRole {
    switch (folderType) {
        case 'source':
            return 'source';
        case 'psd':
            return 'psd';
        case 'mainImage':
            return 'main-image';
        case 'detail':
            return 'detail';
        case 'sku':
            return 'sku';
        default:
            return 'unknown';
    }
}

function mapFolderMappings(config: ProjectConfig | null): Record<string, string> {
    const mappings: Record<string, string> = {};
    const source = config?.folderMappings || {};
    for (const [key, value] of Object.entries(source)) {
        mappings[key] = mapFolderTypeToAssetRole(value);
    }
    return mappings;
}

function imageToFileInput(projectPath: string, image: ImageFile): ProjectAssetIndexFileInput {
    return {
        path: image.path,
        relativePath: image.relativePath || toRelativePath(projectPath, image.path),
        name: image.name,
        extension: image.ext,
        sizeBytes: image.size,
        width: image.width,
        height: image.height,
        folderRole: mapFolderTypeToAssetRole(image.folderType)
    };
}

function collectImageFileInputs(projectPath: string, folders: FolderInfo[]): ProjectAssetIndexFileInput[] {
    const files: ProjectAssetIndexFileInput[] = [];

    function visitFolder(folder: FolderInfo): void {
        for (const image of folder.images || []) {
            files.push({
                ...imageToFileInput(projectPath, image),
                folderRole: mapFolderTypeToAssetRole(image.folderType || folder.type)
            });
        }
        for (const child of folder.children || []) {
            visitFolder(child);
        }
    }

    for (const folder of folders || []) {
        visitFolder(folder);
    }

    return files;
}

function shouldScanDirectory(entryName: string): boolean {
    if (!entryName) return false;
    if (SKIPPED_DIRECTORIES.has(entryName)) return false;
    if (entryName.startsWith('.') && entryName !== '.designecho') return false;
    return true;
}

function decodeTextBuffer(buffer: Buffer): string {
    const encodings = ['utf-8', 'gb18030'];
    for (const encoding of encodings) {
        try {
            const decoded = new TextDecoder(encoding).decode(buffer);
            if (!decoded.includes(String.fromCodePoint(0xfffd))) {
                return decoded;
            }
        } catch {
            // Try the next encoding.
        }
    }
    return buffer.toString('utf8');
}

async function readSmallTextFile(filePath: string, maxBytes = MAX_CONFIG_FILE_BYTES): Promise<string | null> {
    const stat = await fsPromises.stat(filePath);
    if (!stat.isFile() || stat.size <= 0 || stat.size > maxBytes) {
        return null;
    }
    const buffer = await fsPromises.readFile(filePath);
    return decodeTextBuffer(buffer);
}

async function collectConfigFiles(projectPath: string): Promise<ProjectAssetIndexFileInput[]> {
    const results: ProjectAssetIndexFileInput[] = [];

    async function visitDirectory(directoryPath: string, depth: number): Promise<void> {
        if (depth > MAX_CONFIG_SCAN_DEPTH) return;

        let entries: fs.Dirent[];
        try {
            entries = await fsPromises.readdir(directoryPath, { withFileTypes: true });
        } catch {
            return;
        }

        for (const entry of entries) {
            const fullPath = path.join(directoryPath, entry.name);
            if (entry.isDirectory()) {
                if (shouldScanDirectory(entry.name)) {
                    await visitDirectory(fullPath, depth + 1);
                }
                continue;
            }
            if (!entry.isFile()) continue;

            const extension = path.extname(entry.name).toLowerCase();
            if (!CONFIG_EXTENSIONS.has(extension)) continue;

            let stat: fs.Stats;
            try {
                stat = await fsPromises.stat(fullPath);
            } catch {
                continue;
            }

            results.push({
                path: fullPath,
                relativePath: toRelativePath(projectPath, fullPath),
                name: entry.name,
                extension,
                sizeBytes: stat.size,
                folderRole: fullPath.includes(`${path.sep}.designecho${path.sep}`) ? 'metadata' : 'config'
            });
        }
    }

    await visitDirectory(projectPath, 0);
    return results;
}

async function parseSkuRowsFromConfigFiles(configFiles: ProjectAssetIndexFileInput[]): Promise<ProjectAssetSkuConfigRow[]> {
    const rows: ProjectAssetSkuConfigRow[] = [];
    for (const file of configFiles) {
        if (file.extension !== '.csv') continue;
        if (!SKU_CONFIG_NAME_PATTERN.test(file.relativePath || file.name || file.path)) continue;

        try {
            const text = await readSmallTextFile(file.path);
            if (!text) continue;
            rows.push(...parseSkuConfigCsv(text));
        } catch {
            // CSV is optional input. A bad file must not block context creation.
        }
    }
    return rows;
}

function dedupeFiles(files: ProjectAssetIndexFileInput[]): ProjectAssetIndexFileInput[] {
    const seen = new Set<string>();
    const results: ProjectAssetIndexFileInput[] = [];
    for (const file of files) {
        const key = normalizePath(file.path);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        results.push(file);
    }
    return results;
}

function entriesFromCacheManifest(parsed: any): ProjectVisualSamplingCacheEntry[] {
    if (Array.isArray(parsed)) {
        return parsed;
    }
    if (Array.isArray(parsed?.entries)) {
        return parsed.entries;
    }
    return [];
}

export class ProjectContextSnapshotService {
    private getVisualInsightCachePath(projectPath: string): string {
        return path.join(projectPath, VISUAL_INSIGHT_CACHE_RELATIVE_PATH);
    }

    private async readVisualInsightCache(projectPath: string): Promise<ProjectVisualInsightCacheReadResult> {
        const cachePath = this.getVisualInsightCachePath(projectPath);
        try {
            const text = await readSmallTextFile(cachePath, MAX_CONFIG_FILE_BYTES);
            if (!text) {
                return buildProjectVisualInsightCacheReadResult({
                    source: 'missing',
                    cachePath,
                    exists: false
                });
            }

            const parsed = JSON.parse(text);
            const entries = entriesFromCacheManifest(parsed);

            return buildProjectVisualInsightCacheReadResult({
                source: 'persisted-project-cache',
                cachePath,
                exists: true,
                entries
            });
        } catch (error: any) {
            if (error?.code === 'ENOENT') {
                return buildProjectVisualInsightCacheReadResult({
                    source: 'missing',
                    cachePath,
                    exists: false
                });
            }
            return buildProjectVisualInsightCacheReadResult({
                source: 'invalid',
                cachePath,
                exists: true,
                warning: `视觉理解缓存读取失败: ${error?.message || String(error)}`
            });
        }
    }

    /**
     * 只读通道：读取并解析 .designecho/visual-insights-cache.json。
     * 与 build() 不同，本方法不扫描项目、不加载项目配置、不构建 assetIndex/抽样计划，
     * 供只需要视觉理解缓存条目的消费方（如详情页选图信号供给）走轻量路径。
     */
    async readPersistedVisualInsightCache(projectPathInput: string): Promise<ProjectVisualInsightCacheReadResult> {
        const projectPath = String(projectPathInput || '').trim();
        if (!projectPath) {
            throw new Error('缺少项目路径，无法读取视觉理解缓存。');
        }
        return await this.readVisualInsightCache(projectPath);
    }

    private mergeVisualInsightCacheEntries(
        existingEntries: ProjectVisualSamplingCacheEntry[],
        incomingEntries: ProjectVisualSamplingCacheEntry[]
    ): ProjectVisualSamplingCacheEntry[] {
        const byKey = new Map<string, ProjectVisualSamplingCacheEntry>();
        function keyForEntry(entry: ProjectVisualSamplingCacheEntry): string {
            return String(entry.cacheKey || entry.assetId || entry.path || '').trim();
        }
        for (const entry of existingEntries) {
            const key = keyForEntry(entry);
            if (key) byKey.set(key, entry);
        }
        for (const entry of incomingEntries) {
            const key = keyForEntry(entry);
            if (key) byKey.set(key, entry);
        }
        return Array.from(byKey.values());
    }

    async writeVisualInsightCache(options: ProjectVisualInsightCacheWriteOptions): Promise<ProjectVisualInsightCacheWriteResult> {
        const projectPath = String(options.projectPath || '').trim();
        if (!projectPath) {
            throw new Error('缺少项目路径，无法写入视觉理解缓存。');
        }

        const cachePath = this.getVisualInsightCachePath(projectPath);
        return await serializedFileOperations.runExclusive(cachePath, async () => {
            const current = options.replace
                ? buildProjectVisualInsightCacheReadResult({ source: 'missing', cachePath, exists: false })
                : await this.readVisualInsightCache(projectPath);
            let entries = options.entries;
            if (!options.replace) {
                entries = this.mergeVisualInsightCacheEntries(current.entries, options.entries);
            }
            const manifest = buildProjectVisualInsightCacheManifest({
                projectPath,
                entries,
                nowIso: options.nowIso
            });

            await serializedFileOperations.writeUtf8Atomically(cachePath, JSON.stringify(manifest, null, 2));

            return {
                success: true,
                source: 'runtime-project-service',
                cachePath,
                manifest,
                readResult: buildProjectVisualInsightCacheReadResult({
                    source: 'persisted-project-cache',
                    cachePath,
                    exists: true,
                    entries: manifest.entries
                })
            };
        });
    }

    async build(options: ProjectContextSnapshotBuildOptions): Promise<ProjectContextSnapshotBuildResult> {
        const projectPath = String(options.projectPath || '').trim();
        if (!projectPath) {
            throw new Error('缺少项目路径，无法构建 ContextSnapshot。');
        }

        const stat = await fsPromises.stat(projectPath);
        if (!stat.isDirectory()) {
            throw new Error(`项目路径不是文件夹: ${projectPath}`);
        }

        const config = await ecommerceProjectService.loadProjectConfig(projectPath);
        const structure: EcommerceProjectStructure = await ecommerceProjectService.scanProject(projectPath);
        const projectName = options.projectName || structure.projectName || path.basename(projectPath);
        const imageFiles = collectImageFileInputs(projectPath, structure.folders);
        const configFiles = await collectConfigFiles(projectPath);
        const skuConfigRows = await parseSkuRowsFromConfigFiles(configFiles);
        const assetIndex = buildProjectAssetIndex({
            projectPath,
            projectName,
            folderMappings: mapFolderMappings(config),
            files: dedupeFiles([...imageFiles, ...configFiles]),
            skuConfigRows
        });
        let visualInsightCache: ProjectVisualInsightCacheReadResult;
        if (options.visualSamplingCache) {
            visualInsightCache = buildProjectVisualInsightCacheReadResult({
                source: 'provided-options',
                exists: true,
                entries: options.visualSamplingCache
            });
        } else if (options.usePersistedVisualInsightCache === false) {
            visualInsightCache = buildProjectVisualInsightCacheReadResult({
                source: 'missing',
                exists: false
            });
        } else {
            visualInsightCache = await this.readVisualInsightCache(projectPath);
        }
        const visualSamplingPlan = buildProjectVisualSamplingPlan({
            assetIndex,
            scenario: options.visualSamplingScenario || 'general-design',
            maxCandidates: options.maxVisualSamples,
            cachedInsights: visualInsightCache.entries
        });
        const contextSnapshot = buildContextSnapshot({
            projectPath,
            projectName,
            currentDocument: options.currentDocument,
            selectedAssetPaths: options.selectedAssetPaths,
            userConstraints: options.userConstraints,
            taskHistory: options.taskHistory,
            unverifiedItems: options.unverifiedItems,
            assetIndex,
            visualSamplingPlan,
            visualInsightCache
        });

        return {
            success: true,
            source: 'runtime-project-service',
            projectPath,
            projectName,
            contextSnapshot,
            assetIndex,
            visualSamplingPlan,
            visualInsightCache,
            warnings: contextSnapshot.warnings,
            limitations: contextSnapshot.limitations
        };
    }
}

export const projectContextSnapshotService = new ProjectContextSnapshotService();
