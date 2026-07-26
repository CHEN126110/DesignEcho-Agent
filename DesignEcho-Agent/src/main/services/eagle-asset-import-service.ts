import fs from 'fs/promises';
import path from 'path';

import { eagleLibraryService } from './eagle-library-service';
import { serializedFileOperations } from './serialized-file-operations';

/**
 * Eagle 素材项目导入（P3 项目复制 + 来源追踪）。
 *
 * 与 `eagle-library-service`（纯只读索引，smoke 禁一切写调用）刻意分离：
 * 本服务只写**项目目录**，永不写 `.library`（写 Eagle 元数据必须走 Eagle API，见 eagle-writeback-gate）。
 * 从不透明 EagleAssetRef（libraryId + itemId）经主进程解析层取得真实源文件，
 * 复制进当前项目，并在 `<project>/.designecho/eagle-imports.json` 留下来源追踪记录。
 */

export const EAGLE_IMPORT_DEFAULT_SUBDIR = 'Eagle素材';
const EAGLE_IMPORT_REGISTRY_RELATIVE = path.join('.designecho', 'eagle-imports.json');
const MAX_REGISTRY_ENTRIES = 500;

export interface EagleAssetImportProvenance {
    source: 'eagle';
    assetRef: string;
    libraryId: string;
    libraryName: string;
    itemId: string;
    itemName: string;
    ext: string;
    importedAt: string;
    projectRelativePath: string;
}

export interface EagleAssetImportResult {
    success: boolean;
    status: 'ok' | 'library_not_opened' | 'not_found' | 'invalid_project' | 'unavailable';
    fileName?: string;
    /** 项目内绝对路径（项目文件路径本就对模型可见，可直接交给 placeImage 置入）。 */
    importedPath?: string;
    projectRelativePath?: string;
    provenance?: EagleAssetImportProvenance;
    error?: string;
    boundaries: {
        writesProjectOnly: true;
        doesNotWriteEagle: true;
        doesNotRunPhotoshop: true;
        provenanceRecorded: boolean;
    };
}

export async function importEagleAssetToProject(input: {
    libraryId?: unknown;
    itemId?: unknown;
    projectPath?: unknown;
    targetSubdir?: unknown;
}): Promise<EagleAssetImportResult> {
    const libraryId = cleanText(input?.libraryId, 160);
    const itemId = cleanText(input?.itemId, 180);
    const projectPathRaw = cleanText(input?.projectPath, 1024);

    if (!libraryId || !itemId) {
        return failure('not_found', '导入 Eagle 素材需要 assetRef（libraryId:itemId）。请使用情境快照或检索结果给出的引用。');
    }
    if (!projectPathRaw) {
        return failure('invalid_project', '当前没有打开的项目：请先在工作台打开一个项目，再把 Eagle 素材导入项目。');
    }

    let projectRoot: string;
    try {
        projectRoot = await fs.realpath(path.resolve(projectPathRaw));
        const stat = await fs.stat(projectRoot);
        if (!stat.isDirectory()) throw new Error('not_a_directory');
    } catch {
        return failure('invalid_project', `项目目录不可用：${projectPathRaw}。请确认项目仍然存在。`);
    }
    if (projectRoot.toLowerCase().includes('.library')) {
        return failure('invalid_project', '目标项目路径位于 Eagle .library 内部，拒绝写入：Eagle 库只读，导入目标必须是普通项目目录。');
    }

    const resolution = await eagleLibraryService.resolveAssetSource({ libraryId, itemId });
    if (!resolution) {
        return failure(
            'library_not_opened',
            '无法解析这个 Eagle 素材：素材库尚未在本次会话打开，或素材已不存在。请先在「Eagle 素材库」页打开对应 .library 后重试。'
        );
    }

    const targetSubdir = sanitizeSubdir(input?.targetSubdir) || EAGLE_IMPORT_DEFAULT_SUBDIR;
    const targetDir = path.resolve(projectRoot, targetSubdir);
    if (!isPathInside(projectRoot, targetDir)) {
        return failure('invalid_project', `导入子目录不合法：${targetSubdir}。目标必须位于项目目录内。`);
    }

    try {
        await fs.mkdir(targetDir, { recursive: true });
        const fileName = await resolveCollisionFreeName(targetDir, resolution.name, resolution.ext);
        const targetPath = path.join(targetDir, fileName);
        await fs.copyFile(resolution.sourceFilePath, targetPath);

        const provenance: EagleAssetImportProvenance = {
            source: 'eagle',
            assetRef: `${libraryId}:${itemId}`,
            libraryId,
            libraryName: resolution.libraryName,
            itemId,
            itemName: resolution.name,
            ext: resolution.ext,
            importedAt: new Date().toISOString(),
            projectRelativePath: path.relative(projectRoot, targetPath).replace(/[\\/]+/g, '/')
        };
        const provenanceRecorded = await appendProvenanceRecord(projectRoot, provenance);

        return {
            success: true,
            status: 'ok',
            fileName,
            importedPath: targetPath,
            projectRelativePath: provenance.projectRelativePath,
            provenance,
            boundaries: {
                writesProjectOnly: true,
                doesNotWriteEagle: true,
                doesNotRunPhotoshop: true,
                provenanceRecorded
            }
        };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error || '');
        return failure('unavailable', `复制 Eagle 素材到项目失败：${message.slice(0, 300) || '未知文件系统错误'}。请检查磁盘空间与项目目录权限。`);
    }
}

async function appendProvenanceRecord(
    projectRoot: string,
    provenance: EagleAssetImportProvenance
): Promise<boolean> {
    const registryPath = path.join(projectRoot, EAGLE_IMPORT_REGISTRY_RELATIVE);
    try {
        await fs.mkdir(path.dirname(registryPath), { recursive: true });
        let entries: EagleAssetImportProvenance[] = [];
        try {
            const raw = await fs.readFile(registryPath, 'utf8');
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed?.imports)) entries = parsed.imports;
        } catch {
            entries = [];
        }
        entries.push(provenance);
        if (entries.length > MAX_REGISTRY_ENTRIES) entries = entries.slice(-MAX_REGISTRY_ENTRIES);
        await serializedFileOperations.writeUtf8Atomically(
            registryPath,
            JSON.stringify({ schemaVersion: 'eagle-imports/v0', imports: entries }, null, 2)
        );
        return true;
    } catch {
        // 来源登记失败不阻断导入本身，但要在结果里如实标注 provenanceRecorded=false。
        return false;
    }
}

async function resolveCollisionFreeName(targetDir: string, baseName: string, ext: string): Promise<string> {
    const safeBase = sanitizeFileBaseName(baseName) || 'eagle-asset';
    const safeExt = cleanText(ext, 24).replace(/^\./, '').toLowerCase() || 'bin';
    for (let attempt = 0; attempt < 100; attempt++) {
        const candidate = attempt === 0 ? `${safeBase}.${safeExt}` : `${safeBase}-${attempt + 1}.${safeExt}`;
        try {
            await fs.access(path.join(targetDir, candidate));
        } catch {
            return candidate;
        }
    }
    return `${safeBase}-${Date.now()}.${safeExt}`;
}

function sanitizeFileBaseName(value: unknown): string {
    return String(value ?? '')
        .replace(/[\\/:*?"<>|\r\n\t]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 120);
}

function sanitizeSubdir(value: unknown): string {
    const cleaned = String(value ?? '')
        .replace(/[:*?"<>|\r\n\t]+/g, '')
        .replace(/\\/g, '/')
        .split('/')
        .map((part) => part.trim())
        .filter((part) => part && part !== '.' && part !== '..')
        .join(path.sep);
    return cleaned.slice(0, 200);
}

function isPathInside(rootPath: string, candidatePath: string): boolean {
    const relative = path.relative(rootPath, candidatePath);
    return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function cleanText(value: unknown, limit: number): string {
    return String(value ?? '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit);
}

function failure(
    status: EagleAssetImportResult['status'],
    error: string
): EagleAssetImportResult {
    return {
        success: false,
        status,
        error,
        boundaries: {
            writesProjectOnly: true,
            doesNotWriteEagle: true,
            doesNotRunPhotoshop: true,
            provenanceRecorded: false
        }
    };
}
