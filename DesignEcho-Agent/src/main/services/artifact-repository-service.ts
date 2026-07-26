/**
 * 主进程唯一 Artifact Repository。
 *
 * 每个项目使用 `<project>/.designecho/artifacts/v1/objects/<artifactId>/`，目录发布采用
 * 同父目录 staging + rename。Artifact 发布后不可原地修改；相同 id/相同内容是幂等重放，
 * 相同 id/不同内容与分叉 supersede 均 fail closed。
 */

import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import {
    ARTIFACT_REPOSITORY_READ_PROJECTION_VERSION,
    ARTIFACT_REPOSITORY_RECORD_VERSION,
    MAX_ARTIFACT_REFS,
    artifactProducerForType,
    artifactRefFromMeta,
    isArtifactRecordHash,
    isArtifactRuntimeBinding,
    isAuthoritativeContentHash,
    isCanonicalArtifactType,
    isSafeArtifactId,
    normalizeArtifactRefs,
    readArtifactRef,
    type ArtifactPayloadDraft,
    type ArtifactPublishRequest,
    type ArtifactRepositoryPayloadDescriptor,
    type ArtifactRepositoryPublishResult,
    type ArtifactRepositoryReadProjection,
    type ArtifactRepositoryReadResult,
    type ArtifactRepositoryRecord,
    type ArtifactRuntimeBinding
} from '../../shared/agent-runtime-v5/artifact-repository-contract';
import {
    validateArtifactPublicationPolicy,
    type ArtifactPublicationAuthority,
    type ArtifactPublicationTransport
} from '../../shared/agent-runtime-v5/artifact-publication-policy';
import {
    canonicalize,
    computeArtifactRecordHash,
    computeAuthoritativeContentHash,
    type ArtifactRecordHashInput
} from '../../shared/agent-runtime-v5/content-hash';
import type {
    ArtifactMeta,
    ArtifactProducerUnit,
    ArtifactRef,
    CapabilityStatus
} from '../../shared/agent-runtime-v5/contracts/common';
import type { V5ArtifactType } from '../../shared/agent-runtime-v5/contracts/index';
import type {
    DesignProjectState,
    DesignProjectStatePatch
} from '../../shared/types/design-project-state.types';
import { designProjectStateStore, type DesignProjectStateStore } from './design-project-state-store';
import {
    serializedFileOperations,
    type SerializedFileOperations
} from './serialized-file-operations';

const RECORD_FILE = 'record.json';
const JSON_PAYLOAD_FILE = 'payload.json';
const BINARY_PAYLOAD_FILE = 'payload.bin';
const MAX_TEXT_FIELD = 240;
const CAPABILITY_STATUSES: readonly CapabilityStatus[] = [
    'real',
    'mock',
    'fallback',
    'not_implemented',
    'blocked_external_dependency',
    'manual_verification_pending'
];

export type ArtifactPublishAuthority = 'runtime' | 'approval_service';

export class ArtifactRepositoryError extends Error {
    readonly code: string;

    constructor(code: string, message: string) {
        super(message);
        this.name = 'ArtifactRepositoryError';
        this.code = code;
    }
}

export interface FileArtifactRepositoryOptions {
    fileOperations?: SerializedFileOperations;
    now?: () => string;
}

interface PreparedPayload {
    draft: ArtifactPayloadDraft;
    hashValue: unknown;
    descriptor: ArtifactRepositoryPayloadDescriptor;
    jsonText?: string;
    bytes?: Uint8Array;
}

interface ListedArtifact {
    ref: ArtifactRef;
    createdAt: string;
    lineage: ArtifactRepositoryRecord['lineage'];
    runtimeBinding?: ArtifactRuntimeBinding;
}

interface ArtifactListing {
    artifacts: ListedArtifact[];
    issues: Array<{ code: string; message: string }>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowedKeys: readonly string[]): boolean {
    const allowed = new Set(allowedKeys);
    return Object.keys(value).every((key) => allowed.has(key));
}

function isBoundedText(value: unknown, limit = MAX_TEXT_FIELD): value is string {
    return typeof value === 'string'
        && value.trim().length > 0
        && value.length <= limit
        && !value.includes('\0');
}

function cloneJsonValue(value: unknown): unknown {
    if (value === undefined) {
        throw new ArtifactRepositoryError('invalid_payload', 'JSON Artifact payload 不能是 undefined。');
    }
    let serialized: string | undefined;
    try {
        serialized = JSON.stringify(value);
    } catch (error: any) {
        throw new ArtifactRepositoryError(
            'invalid_payload',
            `JSON Artifact payload 无法序列化：${error?.message || String(error)}`
        );
    }
    if (serialized === undefined) {
        throw new ArtifactRepositoryError('invalid_payload', 'JSON Artifact payload 无法序列化。');
    }
    return JSON.parse(serialized);
}

function sha256Bytes(bytes: Uint8Array): string {
    return createHash('sha256').update(Buffer.from(bytes)).digest('hex');
}

function readBinaryBytes(value: unknown): Uint8Array | undefined {
    if (value instanceof Uint8Array) return new Uint8Array(value);
    if (ArrayBuffer.isView(value)) {
        const view = value as ArrayBufferView;
        return new Uint8Array(view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength));
    }
    if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
    return undefined;
}

function sanitizeSourceFileName(value: unknown): string | undefined {
    if (!isBoundedText(value, 160)) return undefined;
    const baseName = path.basename(value);
    return baseName && baseName !== '.' && baseName !== '..' ? baseName : undefined;
}

function preparePayload(payload: ArtifactPayloadDraft): PreparedPayload {
    if (!isRecord(payload) || !hasOnlyKeys(payload, ['kind', 'value', 'bytes', 'mediaType', 'fileName'])) {
        throw new ArtifactRepositoryError('invalid_payload', 'Artifact payload 结构非法。');
    }
    if (payload.kind === 'json') {
        if (!hasOnlyKeys(payload, ['kind', 'value'])) {
            throw new ArtifactRepositoryError('invalid_payload', 'JSON Artifact payload 含未知字段。');
        }
        const value = cloneJsonValue(payload.value);
        const jsonText = JSON.stringify(value);
        return {
            draft: { kind: 'json', value },
            hashValue: value,
            descriptor: {
                kind: 'json',
                fileName: JSON_PAYLOAD_FILE,
                byteLength: Buffer.byteLength(jsonText, 'utf8')
            },
            jsonText
        };
    }
    if (payload.kind !== 'binary') {
        throw new ArtifactRepositoryError('invalid_payload', 'Artifact payload kind 只允许 json 或 binary。');
    }
    if (!hasOnlyKeys(payload, ['kind', 'bytes', 'mediaType', 'fileName'])) {
        throw new ArtifactRepositoryError('invalid_payload', 'Binary Artifact payload 含未知字段。');
    }
    const bytes = readBinaryBytes(payload.bytes);
    if (!bytes) {
        throw new ArtifactRepositoryError('invalid_payload', 'Binary Artifact payload 必须是 Uint8Array。');
    }
    const mediaType = isBoundedText(payload.mediaType, 120) ? payload.mediaType.trim() : undefined;
    const sourceFileName = sanitizeSourceFileName(payload.fileName);
    const binarySha256 = sha256Bytes(bytes);
    return {
        draft: {
            kind: 'binary',
            bytes: new Uint8Array(bytes),
            ...(mediaType ? { mediaType } : {}),
            ...(sourceFileName ? { fileName: sourceFileName } : {})
        },
        hashValue: {
            kind: 'binary',
            binarySha256,
            byteLength: bytes.byteLength,
            ...(mediaType ? { mediaType } : {})
        },
        descriptor: {
            kind: 'binary',
            fileName: BINARY_PAYLOAD_FILE,
            byteLength: bytes.byteLength,
            binarySha256,
            ...(mediaType ? { mediaType } : {}),
            ...(sourceFileName ? { sourceFileName } : {})
        },
        bytes
    };
}

function sameRef(left: ArtifactRef, right: ArtifactRef): boolean {
    return left.artifactId === right.artifactId
        && left.artifactType === right.artifactType
        && left.contentHash === right.contentHash;
}

function copyRef(ref: ArtifactRef): ArtifactRef {
    return { ...ref };
}

function sameRuntimeBinding(
    left: ArtifactRuntimeBinding | undefined,
    right: ArtifactRuntimeBinding | undefined
): boolean {
    if (!left || !right) return left === right;
    return left.sessionId === right.sessionId
        && left.runId === right.runId
        && left.generation === right.generation;
}

function lineageMatchesRequest(
    lineage: ArtifactRepositoryRecord['lineage'],
    supersedes: ArtifactRef | undefined
): boolean {
    if (!supersedes) return lineage.version === 1 && lineage.supersedes === undefined;
    return Boolean(lineage.supersedes && sameRef(lineage.supersedes, supersedes));
}

function recordHashInput(
    record: Omit<ArtifactRepositoryRecord, 'recordHash'> | ArtifactRepositoryRecord
): ArtifactRecordHashInput {
    return {
        version: record.version,
        meta: record.meta,
        payload: record.payload,
        lineage: record.lineage,
        runtimeBinding: record.runtimeBinding || null
    };
}

function canonicalProjectDirectory(projectPath: string): string {
    const resolved = path.resolve(projectPath);
    let stats: fs.Stats;
    try {
        stats = fs.statSync(resolved);
    } catch {
        throw new ArtifactRepositoryError(
            'project_missing',
            `Artifact Repository 项目目录不存在（${resolved}）。`
        );
    }
    if (!stats.isDirectory()) {
        throw new ArtifactRepositoryError(
            'project_missing',
            `Artifact Repository 项目目录不存在（${resolved}）。`
        );
    }
    try {
        return path.resolve(fs.realpathSync.native(resolved));
    } catch (error: any) {
        throw new ArtifactRepositoryError(
            'project_path_unavailable',
            `Artifact Repository 无法解析项目真实路径（${resolved}）：${error?.message || String(error)}`
        );
    }
}

function comparablePath(value: string): string {
    const resolved = path.resolve(value);
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function sameResolvedPath(left: string, right: string): boolean {
    return comparablePath(left) === comparablePath(right);
}

function isResolvedPathWithin(parentPath: string, candidatePath: string): boolean {
    const relative = path.relative(path.resolve(parentPath), path.resolve(candidatePath));
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function validatePublishAuthority(owner: ArtifactProducerUnit, authority: ArtifactPublishAuthority): void {
    if (owner === 'ApprovalService' && authority !== 'approval_service') {
        throw new ArtifactRepositoryError(
            'owner_forbidden',
            'approval_record 只能由 ApprovalService 的主进程内部入口发布。'
        );
    }
    if (owner !== 'ApprovalService' && authority === 'approval_service') {
        throw new ArtifactRepositoryError(
            'owner_forbidden',
            `ApprovalService 不能发布 ${owner} 拥有的 Artifact。`
        );
    }
}

function assertPublicationPolicy(
    request: ArtifactPublishRequest,
    authority: ArtifactPublicationAuthority,
    transport: ArtifactPublicationTransport
): void {
    const result = validateArtifactPublicationPolicy({ authority, transport, request });
    if (result.ok) return;
    const first = result.issues[0];
    throw new ArtifactRepositoryError(
        first?.code || 'publication_policy_denied',
        `Artifact 发布策略拒绝：${first?.message || '未知原因'}`
    );
}

export class FileArtifactRepository {
    private readonly projectPath: string;
    private readonly repositoryRoot: string;
    private readonly objectsRoot: string;
    private readonly fileOperations: SerializedFileOperations;
    private readonly now: () => string;

    constructor(projectPath: string, options: FileArtifactRepositoryOptions = {}) {
        // 所有 Repository 实例与队列都锚定同一物理项目目录，避免 junction/symlink
        // 让同一 objectsRoot 获得两套实例和两把锁。
        this.projectPath = canonicalProjectDirectory(projectPath);
        this.repositoryRoot = path.join(this.projectPath, '.designecho', 'artifacts', 'v1');
        this.objectsRoot = path.join(this.repositoryRoot, 'objects');
        this.fileOperations = options.fileOperations || serializedFileOperations;
        this.now = options.now || (() => new Date().toISOString());
    }

    async publish(
        request: ArtifactPublishRequest,
        authority: ArtifactPublishAuthority = 'runtime'
    ): Promise<ArtifactRepositoryPublishResult> {
        this.assertProjectDirectory();
        return await this.fileOperations.runExclusive(this.repositoryRoot, async () => {
            const prepared = this.prepareRequest(request, authority);
            await this.ensureRepositoryDirectories();
            const topology = await this.listArtifacts();
            this.assertNoSupersedeFork(topology.issues);
            await this.validateSourceRefs(prepared.request.sourceRefs);
            const meta = this.buildMeta(prepared.request, prepared.payload, prepared.owner);
            const ref = artifactRefFromMeta(meta);
            const targetDir = this.resolveArtifactDir(meta.artifactId);

            if (await this.lstatIfExists(targetDir)) {
                const existing = await this.readArtifactDirectory(targetDir, new Set<string>());
                const exactReplay = sameRef(existing.ref, ref)
                    && sameRuntimeBinding(existing.record.runtimeBinding, prepared.request.runtimeBinding)
                    && lineageMatchesRequest(existing.record.lineage, prepared.request.supersedes)
                    && canonicalize(existing.record.payload) === canonicalize(prepared.payload.descriptor);
                if (exactReplay) {
                    return {
                        ...existing,
                        idempotent: true,
                        warnings: []
                    };
                }
                throw new ArtifactRepositoryError(
                    'in_place_modification',
                    `Artifact ${meta.artifactId} 已发布，禁止使用同一 artifactId 覆盖不同内容。`
                );
            }

            const lineage = await this.resolveLineage(prepared.request, topology);
            const recordWithoutHash: Omit<ArtifactRepositoryRecord, 'recordHash'> = {
                version: ARTIFACT_REPOSITORY_RECORD_VERSION,
                meta,
                payload: { ...prepared.payload.descriptor },
                lineage,
                ...(prepared.request.runtimeBinding
                    ? { runtimeBinding: { ...prepared.request.runtimeBinding } }
                    : {})
            };
            const record: ArtifactRepositoryRecord = {
                ...recordWithoutHash,
                recordHash: computeArtifactRecordHash(recordHashInput(recordWithoutHash))
            };
            await this.fileOperations.writeDirectoryAtomically(targetDir, async (temporaryDir) => {
                if (prepared.payload.draft.kind === 'json') {
                    await fs.promises.writeFile(
                        path.join(temporaryDir, JSON_PAYLOAD_FILE),
                        prepared.payload.jsonText as string,
                        { encoding: 'utf8' }
                    );
                } else {
                    await fs.promises.writeFile(
                        path.join(temporaryDir, BINARY_PAYLOAD_FILE),
                        prepared.payload.bytes as Uint8Array
                    );
                }
                await fs.promises.writeFile(
                    path.join(temporaryDir, RECORD_FILE),
                    JSON.stringify(record, null, 2),
                    { encoding: 'utf8' }
                );
            });

            const published = await this.readArtifactDirectory(targetDir, new Set<string>());
            return {
                ...published,
                idempotent: false,
                warnings: []
            };
        });
    }

    async get(ref: ArtifactRef): Promise<ArtifactRepositoryReadResult> {
        this.assertProjectDirectory();
        const expected = readArtifactRef(ref);
        if (!expected) {
            throw new ArtifactRepositoryError('invalid_ref', 'ArtifactRef 结构或权威 hash 格式非法。');
        }
        return await this.fileOperations.runExclusive(this.repositoryRoot, async () => {
            const topology = await this.listArtifacts();
            this.assertNoSupersedeFork(topology.issues);
            const result = await this.readArtifactDirectory(
                this.resolveArtifactDir(expected.artifactId),
                new Set<string>()
            );
            if (!sameRef(result.ref, expected)) {
                throw new ArtifactRepositoryError(
                    'ref_mismatch',
                    `ArtifactRef 与 Repository 中的 ${expected.artifactId} 不一致。`
                );
            }
            return result;
        });
    }

    async listRefs(): Promise<{
        refs: ArtifactRef[];
        issues: Array<{ code: string; message: string }>;
        droppedRefCount: number;
    }> {
        this.assertProjectDirectory();
        return await this.fileOperations.runExclusive(this.repositoryRoot, async () => {
            const listed = await this.listArtifacts();
            const ordered = listed.artifacts
                .sort((left, right) => (
                    left.createdAt.localeCompare(right.createdAt)
                    || left.ref.artifactId.localeCompare(right.ref.artifactId)
                ));
            const droppedRefCount = Math.max(0, ordered.length - MAX_ARTIFACT_REFS);
            return {
                refs: ordered.slice(-MAX_ARTIFACT_REFS).map((item) => copyRef(item.ref)),
                issues: listed.issues,
                droppedRefCount
            };
        });
    }

    async readProjection(scope: ArtifactRuntimeBinding): Promise<ArtifactRepositoryReadProjection> {
        this.assertProjectDirectory();
        if (!isArtifactRuntimeBinding(scope)) {
            throw new ArtifactRepositoryError('invalid_scope', 'Artifact Repository runtime scope 非法。');
        }
        return await this.fileOperations.runExclusive(this.repositoryRoot, async () => {
            const listed = await this.listArtifacts();
            const matched = listed.artifacts
                .filter((item) => item.runtimeBinding
                    && item.runtimeBinding.sessionId === scope.sessionId
                    && item.runtimeBinding.runId === scope.runId
                    && item.runtimeBinding.generation === scope.generation)
                .sort((left, right) => (
                    left.createdAt.localeCompare(right.createdAt)
                    || left.ref.artifactId.localeCompare(right.ref.artifactId)
                ));
            const droppedRefCount = Math.max(0, matched.length - MAX_ARTIFACT_REFS);
            return {
                version: ARTIFACT_REPOSITORY_READ_PROJECTION_VERSION,
                source: 'artifact_repository',
                scope: { ...scope },
                refs: matched.slice(-MAX_ARTIFACT_REFS).map((item) => copyRef(item.ref)),
                droppedRefCount,
                issues: listed.issues.slice(0, 32),
                boundaries: {
                    repositoryOwned: true,
                    artifactRefsOnly: true,
                    payloadsExcluded: true,
                    pathsExcluded: true,
                    grantsPermission: false
                }
            };
        });
    }

    private assertProjectDirectory(): void {
        let stats: fs.Stats;
        let realProjectPath: string;
        try {
            stats = fs.lstatSync(this.projectPath);
            realProjectPath = path.resolve(fs.realpathSync.native(this.projectPath));
        } catch {
            throw new ArtifactRepositoryError(
                'project_missing',
                `Artifact Repository 项目目录不存在（${this.projectPath}）。`
            );
        }
        if (!stats.isDirectory()
            || stats.isSymbolicLink()
            || !sameResolvedPath(realProjectPath, this.projectPath)) {
            throw new ArtifactRepositoryError(
                'project_path_unavailable',
                `Artifact Repository 项目真实路径已变化或不再是安全目录（${this.projectPath}）。`
            );
        }
    }

    private resolveArtifactDir(artifactId: string): string {
        if (!isSafeArtifactId(artifactId)) {
            throw new ArtifactRepositoryError('invalid_artifact_id', 'artifactId 非法或包含路径穿越片段。');
        }
        const resolved = path.resolve(this.objectsRoot, artifactId);
        const expectedParent = `${path.resolve(this.objectsRoot)}${path.sep}`;
        const comparableResolved = process.platform === 'win32' ? resolved.toLowerCase() : resolved;
        const comparableParent = process.platform === 'win32' ? expectedParent.toLowerCase() : expectedParent;
        if (!comparableResolved.startsWith(comparableParent)) {
            throw new ArtifactRepositoryError('path_escape', 'artifactId 解析结果越出 Repository objects 目录。');
        }
        return resolved;
    }

    private async lstatIfExists(targetPath: string): Promise<fs.Stats | undefined> {
        try {
            return await fs.promises.lstat(targetPath);
        } catch (error: any) {
            if (error?.code === 'ENOENT') return undefined;
            throw new ArtifactRepositoryError(
                'repository_path_unavailable',
                `Artifact Repository 无法检查路径（${targetPath}）：${error?.message || String(error)}`
            );
        }
    }

    /**
     * 逐级创建并校验 Repository 元数据目录。
     *
     * 不使用 recursive mkdir 直接穿过未知路径：每一层都必须是项目内的真实目录，
     * junction / symlink / 其他会改变 realpath 的重解析目录一律 fail closed。
     */
    private async ensureRepositoryDirectories(): Promise<void> {
        await this.validateRepositoryDirectories(true);
    }

    private async validateRepositoryDirectories(createMissing: boolean): Promise<boolean> {
        const segments = ['.designecho', 'artifacts', 'v1', 'objects'];
        let currentPath = this.projectPath;
        for (const segment of segments) {
            currentPath = path.join(currentPath, segment);
            let stats = await this.lstatIfExists(currentPath);
            if (!stats && !createMissing) return false;
            if (!stats) {
                try {
                    await fs.promises.mkdir(currentPath, { recursive: false });
                } catch (error: any) {
                    if (error?.code !== 'EEXIST') {
                        throw new ArtifactRepositoryError(
                            'repository_path_unavailable',
                            `Artifact Repository 无法创建元数据目录（${currentPath}）：${error?.message || String(error)}`
                        );
                    }
                }
                stats = await this.lstatIfExists(currentPath);
            }
            if (!stats) {
                throw new ArtifactRepositoryError(
                    'repository_path_unavailable',
                    `Artifact Repository 元数据目录创建后不可见（${currentPath}）。`
                );
            }
            if (stats.isSymbolicLink()) {
                throw new ArtifactRepositoryError(
                    'repository_path_link_forbidden',
                    `Artifact Repository 元数据路径禁止使用 junction/symlink（${currentPath}）。`
                );
            }
            if (!stats.isDirectory()) {
                throw new ArtifactRepositoryError(
                    'repository_path_invalid',
                    `Artifact Repository 元数据路径不是目录（${currentPath}）。`
                );
            }
            let realPath: string;
            try {
                realPath = path.resolve(await fs.promises.realpath(currentPath));
            } catch (error: any) {
                throw new ArtifactRepositoryError(
                    'repository_path_unavailable',
                    `Artifact Repository 无法解析元数据真实路径（${currentPath}）：${error?.message || String(error)}`
                );
            }
            if (!sameResolvedPath(realPath, currentPath)
                || !isResolvedPathWithin(this.projectPath, realPath)) {
                throw new ArtifactRepositoryError(
                    'path_escape',
                    `Artifact Repository 元数据真实路径越出项目或经过重解析目录（${currentPath}）。`
                );
            }
        }
        return true;
    }

    private async assertArtifactDirectory(artifactDir: string, artifactId: string): Promise<void> {
        const repositoryExists = await this.validateRepositoryDirectories(false);
        if (!repositoryExists) {
            throw new ArtifactRepositoryError('artifact_missing', `Artifact ${artifactId} 不存在。`);
        }
        const stats = await this.lstatIfExists(artifactDir);
        if (!stats) {
            throw new ArtifactRepositoryError('artifact_missing', `Artifact ${artifactId} 不存在。`);
        }
        if (stats.isSymbolicLink()) {
            throw new ArtifactRepositoryError(
                'artifact_directory_link_forbidden',
                `Artifact ${artifactId} 目录禁止使用 junction/symlink。`
            );
        }
        if (!stats.isDirectory()) {
            throw new ArtifactRepositoryError(
                'artifact_directory_invalid',
                `Artifact ${artifactId} 的存储路径不是目录。`
            );
        }
        let realArtifactDir: string;
        let realObjectsRoot: string;
        try {
            realArtifactDir = path.resolve(await fs.promises.realpath(artifactDir));
            realObjectsRoot = path.resolve(await fs.promises.realpath(this.objectsRoot));
        } catch (error: any) {
            throw new ArtifactRepositoryError(
                'repository_path_unavailable',
                `Artifact ${artifactId} 无法解析真实存储路径：${error?.message || String(error)}`
            );
        }
        if (!sameResolvedPath(realArtifactDir, artifactDir)
            || !sameResolvedPath(path.dirname(realArtifactDir), realObjectsRoot)) {
            throw new ArtifactRepositoryError(
                'path_escape',
                `Artifact ${artifactId} 的真实存储路径越出 Repository objects 目录。`
            );
        }
    }

    private async assertArtifactFile(
        artifactDir: string,
        filePath: string,
        missingCode: string,
        missingMessage: string
    ): Promise<void> {
        const stats = await this.lstatIfExists(filePath);
        if (!stats) {
            throw new ArtifactRepositoryError(missingCode, missingMessage);
        }
        if (stats.isSymbolicLink()) {
            throw new ArtifactRepositoryError(
                'artifact_file_link_forbidden',
                `Artifact 文件禁止使用 junction/symlink（${path.basename(filePath)}）。`
            );
        }
        if (!stats.isFile()) {
            throw new ArtifactRepositoryError(
                'artifact_file_invalid',
                `Artifact 文件不是普通文件（${path.basename(filePath)}）。`
            );
        }
        let realFilePath: string;
        let realArtifactDir: string;
        try {
            realFilePath = path.resolve(await fs.promises.realpath(filePath));
            realArtifactDir = path.resolve(await fs.promises.realpath(artifactDir));
        } catch (error: any) {
            throw new ArtifactRepositoryError(
                'repository_path_unavailable',
                `Artifact 文件无法解析真实路径（${filePath}）：${error?.message || String(error)}`
            );
        }
        if (!sameResolvedPath(realFilePath, filePath)
            || !sameResolvedPath(path.dirname(realFilePath), realArtifactDir)) {
            throw new ArtifactRepositoryError(
                'path_escape',
                `Artifact 文件真实路径越出所属制品目录（${filePath}）。`
            );
        }
    }

    private prepareRequest(
        request: ArtifactPublishRequest,
        authority: ArtifactPublishAuthority
    ): {
        request: ArtifactPublishRequest;
        payload: PreparedPayload;
        owner: ArtifactProducerUnit;
    } {
        if (!isRecord(request)
            || !hasOnlyKeys(request, [
                'artifactId', 'artifactType', 'projectId', 'skillId', 'sourceRevision', 'sourceRefs',
                'capabilityStatus', 'modelProfile', 'runtimeBinding', 'supersedes', 'payload'
            ])) {
            throw new ArtifactRepositoryError('invalid_request', 'Artifact 发布请求结构非法或含 owner/hash/path 字段。');
        }
        if (!isSafeArtifactId(request.artifactId)) {
            throw new ArtifactRepositoryError('invalid_artifact_id', 'artifactId 非法或包含路径穿越片段。');
        }
        if (!isCanonicalArtifactType(request.artifactType)) {
            throw new ArtifactRepositoryError('unknown_artifact_type', `未知 Artifact 类型：${String(request.artifactType)}`);
        }
        if (!isBoundedText(request.projectId) || !isBoundedText(request.skillId)) {
            throw new ArtifactRepositoryError('invalid_request', 'projectId 或 skillId 缺失/过长。');
        }
        if (!Number.isInteger(request.sourceRevision) || request.sourceRevision < 0) {
            throw new ArtifactRepositoryError('invalid_request', 'sourceRevision 必须是非负整数。');
        }
        if (!Array.isArray(request.sourceRefs) || request.sourceRefs.length > MAX_ARTIFACT_REFS) {
            throw new ArtifactRepositoryError('invalid_source_refs', 'sourceRefs 缺失或超过上限。');
        }
        const sourceRefs = normalizeArtifactRefs(request.sourceRefs, MAX_ARTIFACT_REFS);
        if (sourceRefs.length !== request.sourceRefs.length) {
            throw new ArtifactRepositoryError('invalid_source_refs', 'sourceRefs 含非法、重复或冲突引用。');
        }
        if (!CAPABILITY_STATUSES.includes(request.capabilityStatus)) {
            throw new ArtifactRepositoryError('invalid_request', 'capabilityStatus 非法。');
        }
        if (request.modelProfile !== undefined && !isBoundedText(request.modelProfile, 120)) {
            throw new ArtifactRepositoryError('invalid_request', 'modelProfile 非法。');
        }
        if (request.runtimeBinding !== undefined && !isArtifactRuntimeBinding(request.runtimeBinding)) {
            throw new ArtifactRepositoryError('invalid_scope', 'runtimeBinding 非法。');
        }
        const supersedes = request.supersedes === undefined ? undefined : readArtifactRef(request.supersedes);
        if (request.supersedes !== undefined && !supersedes) {
            throw new ArtifactRepositoryError('invalid_supersede', 'supersedes 不是合法 ArtifactRef。');
        }
        if (supersedes && supersedes.artifactId === request.artifactId) {
            throw new ArtifactRepositoryError('invalid_supersede', 'Artifact 不能 supersede 自己。');
        }
        if (supersedes && !sourceRefs.some((ref) => sameRef(ref, supersedes))) {
            throw new ArtifactRepositoryError('invalid_supersede', 'supersedes 必须同时出现在 sourceRefs。');
        }
        const owner = artifactProducerForType(request.artifactType);
        validatePublishAuthority(owner, authority);
        return {
            request: {
                artifactId: request.artifactId,
                artifactType: request.artifactType,
                projectId: request.projectId.trim(),
                skillId: request.skillId.trim(),
                sourceRevision: request.sourceRevision,
                sourceRefs,
                capabilityStatus: request.capabilityStatus,
                ...(request.modelProfile ? { modelProfile: request.modelProfile.trim() } : {}),
                ...(request.runtimeBinding ? { runtimeBinding: { ...request.runtimeBinding } } : {}),
                ...(supersedes ? { supersedes: copyRef(supersedes) } : {}),
                payload: request.payload
            },
            payload: preparePayload(request.payload),
            owner
        };
    }

    private buildMeta(
        request: ArtifactPublishRequest,
        payload: PreparedPayload,
        owner: ArtifactProducerUnit
    ): ArtifactMeta {
        const producer = {
            runtimeUnit: owner,
            ...(request.modelProfile ? { modelProfile: request.modelProfile } : {}),
            capabilityStatus: request.capabilityStatus
        };
        const contentHash = computeAuthoritativeContentHash({
            schemaVersion: '1.0.0',
            artifactType: request.artifactType,
            projectId: request.projectId,
            skillId: request.skillId,
            sourceRevision: request.sourceRevision,
            sourceRefs: request.sourceRefs,
            producer,
            payload: payload.hashValue
        });
        return {
            schemaVersion: '1.0.0',
            artifactId: request.artifactId,
            artifactType: request.artifactType,
            projectId: request.projectId,
            skillId: request.skillId,
            sourceRevision: request.sourceRevision,
            sourceRefs: request.sourceRefs.map(copyRef),
            createdAt: this.now(),
            producer,
            contentHash
        };
    }

    private async validateSourceRefs(sourceRefs: ArtifactRef[]): Promise<void> {
        for (const ref of sourceRefs) {
            const result = await this.readArtifactDirectory(
                this.resolveArtifactDir(ref.artifactId),
                new Set<string>()
            );
            if (!sameRef(result.ref, ref)) {
                throw new ArtifactRepositoryError(
                    'source_ref_mismatch',
                    `上游 ArtifactRef ${ref.artifactId} 与 Repository 不一致。`
                );
            }
        }
    }

    private async resolveLineage(
        request: ArtifactPublishRequest,
        listed: ArtifactListing
    ): Promise<ArtifactRepositoryRecord['lineage']> {
        if (!request.supersedes) return { version: 1 };
        const predecessor = await this.readArtifactDirectory(
            this.resolveArtifactDir(request.supersedes.artifactId),
            new Set<string>()
        );
        if (!sameRef(predecessor.ref, request.supersedes)) {
            throw new ArtifactRepositoryError('invalid_supersede', 'supersedes 与 Repository 中的前序版本不一致。');
        }
        if (predecessor.record.meta.artifactType !== request.artifactType) {
            throw new ArtifactRepositoryError('invalid_supersede', 'supersede 前后 Artifact 类型必须一致。');
        }
        if (listed.issues.length > 0) {
            throw new ArtifactRepositoryError(
                'repository_corrupt',
                'Repository 中存在损坏记录，无法安全判定 supersede 唯一后继。'
            );
        }
        const successor = listed.artifacts.find((item) => {
            return item.lineage.supersedes
                && sameRef(item.lineage.supersedes, request.supersedes as ArtifactRef);
        });
        if (successor) {
            throw new ArtifactRepositoryError(
                'supersede_conflict',
                `Artifact ${request.supersedes.artifactId} 已有后继 ${successor.ref.artifactId}，禁止静默分叉。`
            );
        }
        return {
            version: predecessor.record.lineage.version + 1,
            supersedes: copyRef(request.supersedes)
        };
    }

    private assertNoSupersedeFork(issues: Array<{ code: string; message: string }>): void {
        const fork = issues.find((issue) => issue.code === 'supersede_conflict');
        if (!fork) return;
        throw new ArtifactRepositoryError(
            'supersede_conflict',
            `Repository 版本拓扑存在分叉，读取与发布已停止：${fork.message}`
        );
    }

    private async listArtifacts(): Promise<ArtifactListing> {
        if (!await this.validateRepositoryDirectories(false)) {
            return { artifacts: [], issues: [] };
        }
        const entries = await fs.promises.readdir(this.objectsRoot, { withFileTypes: true });
        const artifacts: ListedArtifact[] = [];
        const issues: Array<{ code: string; message: string }> = [];
        for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
            if (entry.name.includes('.tmp-')) continue;
            if (entry.isSymbolicLink()) {
                issues.push({
                    code: 'artifact_directory_link_forbidden',
                    message: `Artifact 目录禁止使用 junction/symlink：${entry.name}`
                });
                continue;
            }
            if (!entry.isDirectory()) continue;
            if (!isSafeArtifactId(entry.name)) {
                issues.push({ code: 'invalid_artifact_id', message: `发现非法 Artifact 目录名：${entry.name}` });
                continue;
            }
            try {
                const result = await this.readArtifactDirectory(
                    this.resolveArtifactDir(entry.name),
                    new Set<string>()
                );
                artifacts.push({
                    ref: copyRef(result.ref),
                    createdAt: result.record.meta.createdAt,
                    lineage: {
                        version: result.record.lineage.version,
                        ...(result.record.lineage.supersedes
                            ? { supersedes: copyRef(result.record.lineage.supersedes) }
                            : {})
                    },
                    ...(result.record.runtimeBinding
                        ? { runtimeBinding: { ...result.record.runtimeBinding } }
                        : {})
                });
            } catch (error: any) {
                issues.push({
                    code: error instanceof ArtifactRepositoryError ? error.code : 'repository_corrupt',
                    message: `Artifact ${entry.name} 校验失败：${error?.message || String(error)}`
                });
            }
        }
        const successorsByPredecessor = new Map<string, ListedArtifact[]>();
        for (const artifact of artifacts) {
            const predecessor = artifact.lineage.supersedes;
            if (!predecessor) continue;
            const key = `${predecessor.artifactId}\0${predecessor.artifactType}\0${predecessor.contentHash}`;
            const successors = successorsByPredecessor.get(key) || [];
            successors.push(artifact);
            successorsByPredecessor.set(key, successors);
        }
        let hasFork = false;
        for (const successors of successorsByPredecessor.values()) {
            if (successors.length <= 1) continue;
            hasFork = true;
            const predecessor = successors[0].lineage.supersedes as ArtifactRef;
            issues.push({
                code: 'supersede_conflict',
                message: `Artifact ${predecessor.artifactId} 存在多个后继（${successors
                    .map((item) => item.ref.artifactId)
                    .sort()
                    .join('、')}），Repository 已停止恢复引用。`
            });
        }
        if (hasFork) {
            // 分叉会让后继及其下游来源变得歧义；全库 refs 投影必须 fail closed，
            // 但保留 issues 供诊断和人工修复。
            return { artifacts: [], issues };
        }
        return { artifacts, issues };
    }

    private async readArtifactDirectory(
        artifactDir: string,
        visited: Set<string>
    ): Promise<ArtifactRepositoryReadResult> {
        const artifactId = path.basename(artifactDir);
        if (visited.has(artifactId)) {
            throw new ArtifactRepositoryError('lineage_cycle', `Artifact ${artifactId} 的引用图存在循环。`);
        }
        await this.assertArtifactDirectory(artifactDir, artifactId);
        const nextVisited = new Set(visited);
        nextVisited.add(artifactId);
        const recordPath = path.join(artifactDir, RECORD_FILE);
        await this.assertArtifactFile(
            artifactDir,
            recordPath,
            'record_missing',
            `Artifact ${artifactId} 缺少 record.json。`
        );
        let record: ArtifactRepositoryRecord;
        try {
            record = JSON.parse(await fs.promises.readFile(recordPath, 'utf8')) as ArtifactRepositoryRecord;
        } catch (error: any) {
            throw new ArtifactRepositoryError(
                'record_corrupt',
                `Artifact ${artifactId} 的 record.json 无法解析：${error?.message || String(error)}`
            );
        }
        this.validateRecordShape(record, artifactId);
        const expectedRecordHash = computeArtifactRecordHash(recordHashInput(record));
        if (record.recordHash !== expectedRecordHash) {
            throw new ArtifactRepositoryError(
                'record_integrity_mismatch',
                `Artifact ${artifactId} 的 runtimeBinding/lineage/record 清单与权威 recordHash 不一致。`
            );
        }
        const payload = await this.readAndVerifyPayload(artifactDir, record);
        const expectedHash = computeAuthoritativeContentHash({
            schemaVersion: record.meta.schemaVersion,
            artifactType: record.meta.artifactType,
            projectId: record.meta.projectId,
            skillId: record.meta.skillId,
            sourceRevision: record.meta.sourceRevision,
            sourceRefs: record.meta.sourceRefs,
            producer: record.meta.producer,
            payload: record.payload.kind === 'json'
                ? payload
                : {
                    kind: 'binary',
                    binarySha256: record.payload.binarySha256,
                    byteLength: record.payload.byteLength,
                    ...(record.payload.mediaType ? { mediaType: record.payload.mediaType } : {})
                }
        });
        if (record.meta.contentHash !== expectedHash) {
            throw new ArtifactRepositoryError(
                'integrity_mismatch',
                `Artifact ${artifactId} 的 payload/meta 与权威 contentHash 不一致。`
            );
        }
        for (const sourceRef of record.meta.sourceRefs) {
            const source = await this.readArtifactDirectory(
                this.resolveArtifactDir(sourceRef.artifactId),
                nextVisited
            );
            if (!sameRef(source.ref, sourceRef)) {
                throw new ArtifactRepositoryError(
                    'source_ref_mismatch',
                    `Artifact ${artifactId} 的上游引用 ${sourceRef.artifactId} 已失配。`
                );
            }
        }
        if (record.lineage.supersedes) {
            const predecessor = await this.readArtifactDirectory(
                this.resolveArtifactDir(record.lineage.supersedes.artifactId),
                nextVisited
            );
            if (!sameRef(predecessor.ref, record.lineage.supersedes)
                || predecessor.record.meta.artifactType !== record.meta.artifactType
                || record.lineage.version !== predecessor.record.lineage.version + 1) {
                throw new ArtifactRepositoryError(
                    'lineage_mismatch',
                    `Artifact ${artifactId} 的 supersede 版本链非法。`
                );
            }
        } else if (record.lineage.version !== 1) {
            throw new ArtifactRepositoryError('lineage_mismatch', `Artifact ${artifactId} 的首版本号必须为 1。`);
        }
        return {
            ref: artifactRefFromMeta(record.meta),
            record: JSON.parse(JSON.stringify(record)) as ArtifactRepositoryRecord,
            payload: payload instanceof Uint8Array ? new Uint8Array(payload) : cloneJsonValue(payload)
        };
    }

    private validateRecordShape(record: ArtifactRepositoryRecord, artifactId: string): void {
        if (!isRecord(record)
            || !hasOnlyKeys(record, ['version', 'meta', 'payload', 'lineage', 'runtimeBinding', 'recordHash'])
            || record.version !== ARTIFACT_REPOSITORY_RECORD_VERSION
            || !isArtifactRecordHash(record.recordHash)
            || !isRecord(record.meta)
            || !hasOnlyKeys(record.meta, [
                'schemaVersion', 'artifactId', 'artifactType', 'projectId', 'skillId', 'sourceRevision',
                'sourceRefs', 'createdAt', 'producer', 'contentHash'
            ])
            || record.meta.schemaVersion !== '1.0.0'
            || record.meta.artifactId !== artifactId
            || !isSafeArtifactId(record.meta.artifactId)
            || !isCanonicalArtifactType(record.meta.artifactType)
            || !isBoundedText(record.meta.projectId)
            || !isBoundedText(record.meta.skillId)
            || !Number.isInteger(record.meta.sourceRevision)
            || record.meta.sourceRevision < 0
            || !Array.isArray(record.meta.sourceRefs)
            || record.meta.sourceRefs.length > MAX_ARTIFACT_REFS
            || normalizeArtifactRefs(record.meta.sourceRefs).length !== record.meta.sourceRefs.length
            || !isBoundedText(record.meta.createdAt, 80)
            || !isAuthoritativeContentHash(record.meta.contentHash)
            || !isRecord(record.meta.producer)
            || !hasOnlyKeys(record.meta.producer, ['runtimeUnit', 'modelProfile', 'capabilityStatus'])
            || record.meta.producer.runtimeUnit !== artifactProducerForType(record.meta.artifactType as V5ArtifactType)
            || !CAPABILITY_STATUSES.includes(record.meta.producer.capabilityStatus as CapabilityStatus)
            || (record.meta.producer.modelProfile !== undefined
                && !isBoundedText(record.meta.producer.modelProfile, 120))
            || !isRecord(record.payload)
            || !hasOnlyKeys(record.payload, [
                'kind', 'fileName', 'byteLength', 'binarySha256', 'mediaType', 'sourceFileName'
            ])
            || !Number.isInteger(record.payload.byteLength)
            || record.payload.byteLength < 0
            || !isRecord(record.lineage)
            || !hasOnlyKeys(record.lineage, ['version', 'supersedes'])
            || !Number.isInteger(record.lineage.version)
            || record.lineage.version < 1
            || (record.lineage.supersedes !== undefined && !readArtifactRef(record.lineage.supersedes))
            || (record.runtimeBinding !== undefined && !isArtifactRuntimeBinding(record.runtimeBinding))) {
            throw new ArtifactRepositoryError('record_corrupt', `Artifact ${artifactId} 的 record 结构非法。`);
        }
        if (record.payload.kind === 'json') {
            if (record.payload.fileName !== JSON_PAYLOAD_FILE
                || record.payload.binarySha256 !== undefined
                || record.payload.mediaType !== undefined
                || record.payload.sourceFileName !== undefined) {
                throw new ArtifactRepositoryError('record_corrupt', `Artifact ${artifactId} 的 JSON descriptor 非法。`);
            }
        } else if (record.payload.kind === 'binary') {
            if (record.payload.fileName !== BINARY_PAYLOAD_FILE
                || !/^[0-9a-f]{64}$/.test(String(record.payload.binarySha256 || ''))
                || (record.payload.mediaType !== undefined && !isBoundedText(record.payload.mediaType, 120))
                || (record.payload.sourceFileName !== undefined
                    && sanitizeSourceFileName(record.payload.sourceFileName) !== record.payload.sourceFileName)) {
                throw new ArtifactRepositoryError('record_corrupt', `Artifact ${artifactId} 的 binary descriptor 非法。`);
            }
        } else {
            throw new ArtifactRepositoryError('record_corrupt', `Artifact ${artifactId} 的 payload kind 非法。`);
        }
        if (record.lineage.supersedes
            && !record.meta.sourceRefs.some((ref) => sameRef(ref, record.lineage.supersedes as ArtifactRef))) {
            throw new ArtifactRepositoryError('lineage_mismatch', `Artifact ${artifactId} 的 supersedes 未进入 sourceRefs。`);
        }
    }

    private async readAndVerifyPayload(
        artifactDir: string,
        record: ArtifactRepositoryRecord
    ): Promise<unknown | Uint8Array> {
        const payloadPath = path.join(artifactDir, record.payload.fileName);
        await this.assertArtifactFile(
            artifactDir,
            payloadPath,
            'payload_missing',
            `Artifact ${record.meta.artifactId} 缺少 ${record.payload.fileName}。`
        );
        const bytes = await fs.promises.readFile(payloadPath);
        if (bytes.byteLength !== record.payload.byteLength) {
            throw new ArtifactRepositoryError(
                'payload_size_mismatch',
                `Artifact ${record.meta.artifactId} 的 payload 字节数不一致。`
            );
        }
        if (record.payload.kind === 'binary') {
            if (sha256Bytes(bytes) !== record.payload.binarySha256) {
                throw new ArtifactRepositoryError(
                    'binary_integrity_mismatch',
                    `Artifact ${record.meta.artifactId} 的二进制 SHA-256 不一致。`
                );
            }
            return new Uint8Array(bytes);
        }
        try {
            return JSON.parse(bytes.toString('utf8'));
        } catch (error: any) {
            throw new ArtifactRepositoryError(
                'payload_corrupt',
                `Artifact ${record.meta.artifactId} 的 JSON payload 无法解析：${error?.message || String(error)}`
            );
        }
    }
}

export class ArtifactRepositoryService {
    private readonly repositories = new Map<string, FileArtifactRepository>();
    private readonly stateStore: DesignProjectStateStore;

    constructor(stateStore: DesignProjectStateStore = designProjectStateStore) {
        this.stateStore = stateStore;
    }

    async publishRuntimeArtifact(
        projectPath: string,
        request: ArtifactPublishRequest
    ): Promise<ArtifactRepositoryPublishResult> {
        assertPublicationPolicy(request, 'runtime_renderer', 'renderer_ipc');
        return await this.runProjectStateCoordination(projectPath, async (canonicalProjectPath) => {
            const result = await this.repositoryFor(canonicalProjectPath).publish(request, 'runtime');
            return await this.linkProjectStateRefs(canonicalProjectPath, result);
        });
    }

    async publishApprovalArtifact(
        projectPath: string,
        request: ArtifactPublishRequest
    ): Promise<ArtifactRepositoryPublishResult> {
        assertPublicationPolicy(request, 'approval_service', 'main_process');
        return await this.runProjectStateCoordination(projectPath, async (canonicalProjectPath) => {
            const result = await this.repositoryFor(canonicalProjectPath).publish(request, 'approval_service');
            return await this.linkProjectStateRefs(canonicalProjectPath, result);
        });
    }

    async get(projectPath: string, ref: ArtifactRef): Promise<ArtifactRepositoryReadResult> {
        return await this.repositoryFor(projectPath).get(ref);
    }

    async readProjection(
        projectPath: string,
        scope: ArtifactRuntimeBinding
    ): Promise<ArtifactRepositoryReadProjection> {
        return await this.repositoryFor(projectPath).readProjection(scope);
    }

    /**
     * Project State 的受治理读取：每次都先从 Repository 重建 refs 投影，磁盘自报引用不可信。
     */
    async getVerifiedDesignProjectState(projectPath: string): Promise<DesignProjectState> {
        return await this.runProjectStateCoordination(projectPath, async (canonicalProjectPath) => {
            return await this.synchronizeProjectStateRefs(canonicalProjectPath);
        });
    }

    /**
     * Project State 的受治理更新：固定采用 Repository -> State 的锁序。
     * Repository 先签发 refs 投影，普通 patch 只能保留该投影，不能新增或替换 ArtifactRef。
     */
    async updateVerifiedDesignProjectState(
        projectPath: string,
        patch: DesignProjectStatePatch
    ): Promise<DesignProjectState> {
        return await this.runProjectStateCoordination(projectPath, async (canonicalProjectPath) => {
            await this.synchronizeProjectStateRefs(canonicalProjectPath);
            await this.stateStore.update(canonicalProjectPath, patch);
            return await this.synchronizeProjectStateRefs(canonicalProjectPath);
        });
    }

    private repositoryFor(projectPath: string): FileArtifactRepository {
        const canonical = canonicalProjectDirectory(projectPath);
        const key = process.platform === 'win32' ? canonical.toLowerCase() : canonical;
        let repository = this.repositories.get(key);
        if (!repository) {
            repository = new FileArtifactRepository(canonical);
            this.repositories.set(key, repository);
        }
        return repository;
    }

    private async runProjectStateCoordination<T>(
        projectPath: string,
        operation: (canonicalProjectPath: string) => Promise<T>
    ): Promise<T> {
        const canonicalProjectPath = canonicalProjectDirectory(projectPath);
        const coordinationKey = path.join(
            canonicalProjectPath,
            '.designecho',
            '.artifact-project-state-coordination'
        );
        return await serializedFileOperations.runExclusive(coordinationKey, async () => {
            return await operation(canonicalProjectPath);
        });
    }

    private async synchronizeProjectStateRefs(projectPath: string): Promise<DesignProjectState> {
        const listed = await this.repositoryFor(projectPath).listRefs();
        return await this.stateStore.replaceArtifactRefs(projectPath, listed.refs);
    }

    private async linkProjectStateRefs(
        projectPath: string,
        result: ArtifactRepositoryPublishResult
    ): Promise<ArtifactRepositoryPublishResult> {
        const warnings = [...result.warnings];
        try {
            const listed = await this.repositoryFor(projectPath).listRefs();
            await this.stateStore.replaceArtifactRefs(projectPath, listed.refs);
            warnings.push(...listed.issues.map((issue) => `Project State 未链接损坏 Artifact：${issue.message}`));
        } catch (error: any) {
            warnings.push(`Artifact 已发布，但 Project State 引用同步失败：${error?.message || String(error)}`);
        }
        return { ...result, warnings };
    }
}

export const artifactRepositoryService = new ArtifactRepositoryService();
