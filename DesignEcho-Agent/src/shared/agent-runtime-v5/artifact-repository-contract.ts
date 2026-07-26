/**
 * Artifact Repository 的进程间契约。
 *
 * Repository 是 Artifact 正文、二进制、版本与不可变性的唯一 owner。Renderer 只能提交
 * 受限 Runtime 收尾声明；主进程再组装不含调用方 producer/contentHash/path 的内部发布请求。
 * Snapshot / Project State / Run Record 只消费 Repository 返回的 ArtifactRef。
 */

import type {
    ArtifactMeta,
    ArtifactProducerUnit,
    ArtifactRef,
    CapabilityStatus
} from './contracts/common';
import {
    V5_CONTRACT_OWNERSHIP,
    V5_ARTIFACT_TYPES,
    type V5ArtifactType
} from './contracts/index';

export const ARTIFACT_REPOSITORY_RECORD_VERSION = 'artifact-repository-record/v2' as const;
export const ARTIFACT_REPOSITORY_READ_PROJECTION_VERSION = 'artifact-repository-read-projection/v0' as const;
export const MAX_ARTIFACT_REFS = 128;

const ARTIFACT_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,127}$/i;
const CONTENT_HASH_PATTERN = /^sha256-jcs-v1:[0-9a-f]{64}$/;
const RECORD_HASH_PATTERN = /^sha256-jcs-record-v1:[0-9a-f]{64}$/;

export interface ArtifactRuntimeBinding {
    sessionId: string;
    runId: string;
    generation: number;
}

export type ArtifactPayloadDraft =
    | {
        kind: 'json';
        value: unknown;
    }
    | {
        kind: 'binary';
        bytes: Uint8Array;
        mediaType?: string;
        fileName?: string;
    };

/** Repository Service 的内部发布请求；Renderer IPC 不直接暴露此结构。 */
export interface ArtifactPublishRequest {
    artifactId: string;
    artifactType: V5ArtifactType;
    projectId: string;
    skillId: string;
    sourceRevision: number;
    sourceRefs: ArtifactRef[];
    capabilityStatus: CapabilityStatus;
    modelProfile?: string;
    runtimeBinding?: ArtifactRuntimeBinding;
    supersedes?: ArtifactRef;
    payload: ArtifactPayloadDraft;
}

export interface ArtifactRepositoryPayloadDescriptor {
    kind: 'json' | 'binary';
    fileName: 'payload.json' | 'payload.bin';
    byteLength: number;
    binarySha256?: string;
    mediaType?: string;
    sourceFileName?: string;
}

export interface ArtifactRepositoryRecord {
    version: typeof ARTIFACT_REPOSITORY_RECORD_VERSION;
    meta: ArtifactMeta;
    payload: ArtifactRepositoryPayloadDescriptor;
    lineage: {
        version: number;
        supersedes?: ArtifactRef;
    };
    runtimeBinding?: ArtifactRuntimeBinding;
    /** 覆盖除自身外完整 record 清单的 Repository 权威完整性哈希。 */
    recordHash: string;
}

export interface ArtifactRepositoryReadResult {
    ref: ArtifactRef;
    record: ArtifactRepositoryRecord;
    payload: unknown | Uint8Array;
}

export interface ArtifactRepositoryPublishResult extends ArtifactRepositoryReadResult {
    idempotent: boolean;
    warnings: string[];
}

export interface ArtifactRepositoryReadProjection {
    version: typeof ARTIFACT_REPOSITORY_READ_PROJECTION_VERSION;
    source: 'artifact_repository';
    scope: ArtifactRuntimeBinding;
    refs: ArtifactRef[];
    droppedRefCount: number;
    issues: Array<{
        code: string;
        message: string;
    }>;
    boundaries: {
        repositoryOwned: true;
        artifactRefsOnly: true;
        payloadsExcluded: true;
        pathsExcluded: true;
        grantsPermission: false;
    };
}

export function isCanonicalArtifactType(value: unknown): value is V5ArtifactType {
    return typeof value === 'string'
        && (Object.values(V5_ARTIFACT_TYPES) as string[]).includes(value);
}

export function isSafeArtifactId(value: unknown): value is string {
    return typeof value === 'string'
        && ARTIFACT_ID_PATTERN.test(value)
        && value !== '.'
        && value !== '..'
        && !value.includes('..')
        // Repository 原子发布把 `.tmp-` 用作 staging 命名空间；正式 ID 必须避开。
        && !value.toLowerCase().includes('.tmp-');
}

export function isAuthoritativeContentHash(value: unknown): value is string {
    return typeof value === 'string' && CONTENT_HASH_PATTERN.test(value);
}

export function isArtifactRecordHash(value: unknown): value is string {
    return typeof value === 'string' && RECORD_HASH_PATTERN.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
    const allowed = new Set(keys);
    return Object.keys(value).every((key) => allowed.has(key));
}

function hasBoundedText(value: unknown, limit: number): value is string {
    return typeof value === 'string'
        && value.trim().length > 0
        && value.length <= limit
        && !value.includes('\0');
}

export function readArtifactRef(value: unknown): ArtifactRef | undefined {
    if (!isRecord(value)
        || !hasOnlyKeys(value, ['artifactId', 'artifactType', 'contentHash'])
        || !isSafeArtifactId(value.artifactId)
        || !isCanonicalArtifactType(value.artifactType)
        || !isAuthoritativeContentHash(value.contentHash)) {
        return undefined;
    }
    return {
        artifactId: value.artifactId,
        artifactType: value.artifactType,
        contentHash: value.contentHash
    };
}

export function normalizeArtifactRefs(value: unknown, limit = MAX_ARTIFACT_REFS): ArtifactRef[] {
    if (!Array.isArray(value)) return [];
    const byId = new Map<string, ArtifactRef>();
    for (const candidate of value) {
        const ref = readArtifactRef(candidate);
        if (!ref) continue;
        const prior = byId.get(ref.artifactId);
        if (prior && (
            prior.artifactType !== ref.artifactType
            || prior.contentHash !== ref.contentHash
        )) {
            return [];
        }
        byId.set(ref.artifactId, ref);
    }
    return Array.from(byId.values())
        .sort((left, right) => left.artifactId.localeCompare(right.artifactId))
        .slice(0, Math.max(0, limit));
}

export function isArtifactRuntimeBinding(value: unknown): value is ArtifactRuntimeBinding {
    return isRecord(value)
        && hasOnlyKeys(value, ['sessionId', 'runId', 'generation'])
        && hasBoundedText(value.sessionId, 160)
        && hasBoundedText(value.runId, 160)
        && Number.isInteger(value.generation)
        && Number(value.generation) >= 1;
}

export function readArtifactRepositoryProjection(
    value: unknown
): ArtifactRepositoryReadProjection | undefined {
    if (!isRecord(value)
        || !hasOnlyKeys(value, [
            'version', 'source', 'scope', 'refs', 'droppedRefCount', 'issues', 'boundaries'
        ])
        || value.version !== ARTIFACT_REPOSITORY_READ_PROJECTION_VERSION
        || value.source !== 'artifact_repository'
        || !isArtifactRuntimeBinding(value.scope)
        || !Array.isArray(value.refs)
        || value.refs.length > MAX_ARTIFACT_REFS
        || !Number.isInteger(value.droppedRefCount)
        || Number(value.droppedRefCount) < 0
        || !Array.isArray(value.issues)
        || value.issues.length > 32
        || !value.issues.every((issue) => (
            isRecord(issue)
            && hasOnlyKeys(issue, ['code', 'message'])
            && hasBoundedText(issue.code, 80)
            && hasBoundedText(issue.message, 360)
        ))
        || !isRecord(value.boundaries)
        || !hasOnlyKeys(value.boundaries, [
            'repositoryOwned', 'artifactRefsOnly', 'payloadsExcluded', 'pathsExcluded', 'grantsPermission'
        ])
        || value.boundaries.repositoryOwned !== true
        || value.boundaries.artifactRefsOnly !== true
        || value.boundaries.payloadsExcluded !== true
        || value.boundaries.pathsExcluded !== true
        || value.boundaries.grantsPermission !== false) {
        return undefined;
    }
    const refs = normalizeArtifactRefs(value.refs, MAX_ARTIFACT_REFS);
    if (refs.length !== value.refs.length) return undefined;
    return {
        version: ARTIFACT_REPOSITORY_READ_PROJECTION_VERSION,
        source: 'artifact_repository',
        scope: { ...(value.scope as ArtifactRuntimeBinding) },
        refs,
        droppedRefCount: Number(value.droppedRefCount),
        issues: (value.issues as Array<{ code: string; message: string }>).map((issue) => ({ ...issue })),
        boundaries: {
            repositoryOwned: true,
            artifactRefsOnly: true,
            payloadsExcluded: true,
            pathsExcluded: true,
            grantsPermission: false
        }
    };
}

export function artifactRefFromMeta(meta: ArtifactMeta): ArtifactRef {
    return {
        artifactId: meta.artifactId,
        artifactType: meta.artifactType,
        contentHash: meta.contentHash
    };
}

export function artifactProducerForType(artifactType: V5ArtifactType): ArtifactProducerUnit {
    return V5_CONTRACT_OWNERSHIP[artifactType].writer;
}
