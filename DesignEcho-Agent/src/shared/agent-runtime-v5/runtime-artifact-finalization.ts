/**
 * Runtime 收尾向主进程 Artifact Repository 提交的窄契约。
 *
 * Renderer 只能提交 Agent 循环已验证的声明正文；Artifact 类型、ID、上游链、
 * source revision、producer 和 content hash 均由主进程生成。这个契约不授予 Tool
 * 权限，也不证明阶段、质量或任务已完成。
 */

import type { DesignVerdict } from '../design-quality-verdict-bundle';
import type { ArtifactRuntimeBinding } from './artifact-repository-contract';
import type { RuntimeActionPlanDeclaration } from './runtime-action-plan-declaration';
import type { RuntimeDeliveryVerification } from './runtime-delivery-receipt';
import type { RuntimeDesignBriefDeclaration } from './runtime-design-brief-declaration';
import type { RuntimeDesignStrategyDeclaration } from './runtime-design-strategy-declaration';
import {
    readStrictDesignVerdict,
    readStrictRuntimeActionPlanDeclaration,
    readStrictRuntimeDeliveryVerification,
    readStrictRuntimeDesignBriefDeclaration,
    readStrictRuntimeDesignStrategyDeclaration
} from './runtime-artifact-declaration-readers';
import {
    validateRuntimeSessionIdentity,
    type RuntimeSessionIdentity
} from './runtime-session';
import { canonicalize, sha256Hex } from './content-hash';
import { V5_ARTIFACT_TYPES, type V5ArtifactType } from './contracts/index';

export const RUNTIME_ARTIFACT_AUTHORIZATION_REQUEST_VERSION =
    'runtime-artifact-authorization-request/v0' as const;
export const RUNTIME_ARTIFACT_AUTHORIZATION_GRANT_VERSION =
    'runtime-artifact-authorization-grant/v0' as const;
export const RUNTIME_ARTIFACT_FINALIZATION_VERSION = 'runtime-artifact-finalization/v0' as const;

export interface RuntimeArtifactAuthorizationRequest {
    version: typeof RUNTIME_ARTIFACT_AUTHORIZATION_REQUEST_VERSION;
    requestId: string;
    skillId: string;
    taskType: string;
    previousRunId?: string;
}

export interface RuntimeArtifactAuthorizationGrant {
    version: typeof RUNTIME_ARTIFACT_AUTHORIZATION_GRANT_VERSION;
    authorizationToken: string;
    projectId: string;
    skillId: string;
    taskType: string;
    runtimeIdentity: RuntimeSessionIdentity;
    expiresAt: string;
    boundaries: {
        mainProcessIssued: true;
        senderBound: true;
        projectPathBound: true;
        singleUse: true;
        grantsToolPermission: false;
    };
}

export interface RuntimeArtifactFinalizationRequest {
    version: typeof RUNTIME_ARTIFACT_FINALIZATION_VERSION;
    authorizationToken: string;
    artifacts: {
        runtimeDesignBrief?: RuntimeDesignBriefDeclaration;
        runtimeDesignStrategy?: RuntimeDesignStrategyDeclaration;
        runtimeActionPlan?: RuntimeActionPlanDeclaration;
        evaluationReport?: DesignVerdict;
        runtimeDeliveryVerification?: RuntimeDeliveryVerification;
    };
}

export interface RuntimeArtifactFinalizationCandidate {
    artifactType: V5ArtifactType;
    payload: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowedKeys: readonly string[]): boolean {
    const allowed = new Set(allowedKeys);
    return Object.keys(value).every((key) => allowed.has(key));
}

function isBoundedText(value: unknown, limit = 240): value is string {
    return typeof value === 'string'
        && value.trim().length > 0
        && value.length <= limit
        && !value.includes('\0');
}

function isAuthorizationToken(value: unknown): value is string {
    return typeof value === 'string' && /^[A-Za-z0-9_-]{32,160}$/.test(value);
}

function readRuntimeSessionIdentity(value: unknown): RuntimeSessionIdentity | undefined {
    if (!isRecord(value)
        || !hasOnlyKeys(value, [
            'version',
            'sessionId',
            'runId',
            'generation',
            'parentRunId',
            'issuedAt',
            'skillId',
            'taskType',
            'boundaries'
        ])
        || !isRecord(value.boundaries)
        || !hasOnlyKeys(value.boundaries, [
            'identityOnly',
            'grantsPermission',
            'executesTools',
            'changesTaskResult',
            'categoryNeutral'
        ])) {
        return undefined;
    }
    const validation = validateRuntimeSessionIdentity(value);
    return validation.ok ? value as unknown as RuntimeSessionIdentity : undefined;
}

export function readRuntimeArtifactAuthorizationRequest(
    value: unknown
): RuntimeArtifactAuthorizationRequest | undefined {
    if (!isRecord(value)
        || !hasOnlyKeys(value, ['version', 'requestId', 'skillId', 'taskType', 'previousRunId'])
        || value.version !== RUNTIME_ARTIFACT_AUTHORIZATION_REQUEST_VERSION
        || !isBoundedText(value.requestId, 160)
        || !isBoundedText(value.skillId)
        || !isBoundedText(value.taskType)
        || (value.previousRunId !== undefined && !isBoundedText(value.previousRunId, 160))) {
        return undefined;
    }
    return {
        version: RUNTIME_ARTIFACT_AUTHORIZATION_REQUEST_VERSION,
        requestId: value.requestId.trim(),
        skillId: value.skillId.trim(),
        taskType: value.taskType.trim(),
        ...(value.previousRunId !== undefined
            ? { previousRunId: value.previousRunId.trim() }
            : {})
    };
}

export function readRuntimeArtifactAuthorizationGrant(
    value: unknown
): RuntimeArtifactAuthorizationGrant | undefined {
    if (!isRecord(value)
        || !hasOnlyKeys(value, [
            'version',
            'authorizationToken',
            'projectId',
            'skillId',
            'taskType',
            'runtimeIdentity',
            'expiresAt',
            'boundaries'
        ])
        || value.version !== RUNTIME_ARTIFACT_AUTHORIZATION_GRANT_VERSION
        || !isAuthorizationToken(value.authorizationToken)
        || !isBoundedText(value.projectId)
        || !isBoundedText(value.skillId)
        || !isBoundedText(value.taskType)
        || !isBoundedText(value.expiresAt, 40)
        || !Number.isFinite(Date.parse(value.expiresAt))
        || !isRecord(value.boundaries)
        || !hasOnlyKeys(value.boundaries, [
            'mainProcessIssued',
            'senderBound',
            'projectPathBound',
            'singleUse',
            'grantsToolPermission'
        ])
        || value.boundaries.mainProcessIssued !== true
        || value.boundaries.senderBound !== true
        || value.boundaries.projectPathBound !== true
        || value.boundaries.singleUse !== true
        || value.boundaries.grantsToolPermission !== false) {
        return undefined;
    }
    const runtimeIdentity = readRuntimeSessionIdentity(value.runtimeIdentity);
    if (!runtimeIdentity
        || runtimeIdentity.skillId !== value.skillId
        || runtimeIdentity.taskType !== value.taskType) {
        return undefined;
    }
    return {
        version: RUNTIME_ARTIFACT_AUTHORIZATION_GRANT_VERSION,
        authorizationToken: value.authorizationToken,
        projectId: value.projectId.trim(),
        skillId: value.skillId.trim(),
        taskType: value.taskType.trim(),
        runtimeIdentity: {
            ...runtimeIdentity,
            boundaries: { ...runtimeIdentity.boundaries }
        },
        expiresAt: value.expiresAt,
        boundaries: {
            mainProcessIssued: true,
            senderBound: true,
            projectPathBound: true,
            singleUse: true,
            grantsToolPermission: false
        }
    };
}

export function readRuntimeArtifactFinalizationRequest(
    value: unknown
): RuntimeArtifactFinalizationRequest | undefined {
    if (!isRecord(value)
        || !hasOnlyKeys(value, ['version', 'authorizationToken', 'artifacts'])
        || value.version !== RUNTIME_ARTIFACT_FINALIZATION_VERSION
        || !isAuthorizationToken(value.authorizationToken)
        || !isRecord(value.artifacts)
        || Object.keys(value.artifacts).length === 0
        || !hasOnlyKeys(value.artifacts, [
            'runtimeDesignBrief',
            'runtimeDesignStrategy',
            'runtimeActionPlan',
            'evaluationReport',
            'runtimeDeliveryVerification'
        ])) {
        return undefined;
    }
    const artifacts = value.artifacts as Record<string, unknown>;
    const runtimeDesignBrief = artifacts.runtimeDesignBrief !== undefined
        ? readStrictRuntimeDesignBriefDeclaration(artifacts.runtimeDesignBrief)
        : undefined;
    const runtimeDesignStrategy = artifacts.runtimeDesignStrategy !== undefined
        ? readStrictRuntimeDesignStrategyDeclaration(artifacts.runtimeDesignStrategy)
        : undefined;
    const runtimeActionPlan = artifacts.runtimeActionPlan !== undefined
        ? readStrictRuntimeActionPlanDeclaration(artifacts.runtimeActionPlan)
        : undefined;
    const evaluationReport = artifacts.evaluationReport !== undefined
        ? readStrictDesignVerdict(artifacts.evaluationReport)
        : undefined;
    const runtimeDeliveryVerification = artifacts.runtimeDeliveryVerification !== undefined
        ? readStrictRuntimeDeliveryVerification(artifacts.runtimeDeliveryVerification)
        : undefined;
    if ((artifacts.runtimeDesignBrief !== undefined && !runtimeDesignBrief)
        || (artifacts.runtimeDesignStrategy !== undefined && !runtimeDesignStrategy)
        || (artifacts.runtimeActionPlan !== undefined && !runtimeActionPlan)
        || (artifacts.evaluationReport !== undefined && !evaluationReport)
        || (artifacts.runtimeDeliveryVerification !== undefined && !runtimeDeliveryVerification)) {
        return undefined;
    }
    if (!runtimeDesignBrief
        && !runtimeDesignStrategy
        && !runtimeActionPlan
        && !evaluationReport
        && !runtimeDeliveryVerification) {
        return undefined;
    }
    return {
        version: RUNTIME_ARTIFACT_FINALIZATION_VERSION,
        authorizationToken: value.authorizationToken,
        artifacts: {
            ...(runtimeDesignBrief
                ? { runtimeDesignBrief }
                : {}),
            ...(runtimeDesignStrategy
                ? { runtimeDesignStrategy }
                : {}),
            ...(runtimeActionPlan
                ? { runtimeActionPlan }
                : {}),
            ...(evaluationReport
                ? { evaluationReport }
                : {}),
            ...(runtimeDeliveryVerification
                ? { runtimeDeliveryVerification }
                : {})
        }
    };
}

export function buildRuntimeArtifactFinalizationCandidates(
    request: RuntimeArtifactFinalizationRequest
): RuntimeArtifactFinalizationCandidate[] {
    const artifacts = request.artifacts;
    return [
        ...(artifacts.runtimeDesignBrief
            ? [{
                artifactType: V5_ARTIFACT_TYPES.runtimeDesignBrief,
                payload: artifacts.runtimeDesignBrief
            }]
            : []),
        ...(artifacts.runtimeDesignStrategy
            ? [{
                artifactType: V5_ARTIFACT_TYPES.runtimeDesignStrategy,
                payload: artifacts.runtimeDesignStrategy
            }]
            : []),
        ...(artifacts.runtimeActionPlan
            ? [{
                artifactType: V5_ARTIFACT_TYPES.runtimeActionPlan,
                payload: artifacts.runtimeActionPlan
            }]
            : []),
        ...(artifacts.evaluationReport
            ? [{
                artifactType: V5_ARTIFACT_TYPES.evaluationReport,
                payload: artifacts.evaluationReport
            }]
            : []),
        ...(artifacts.runtimeDeliveryVerification
            ? [{
                artifactType: V5_ARTIFACT_TYPES.runtimeDeliveryVerification,
                payload: artifacts.runtimeDeliveryVerification
            }]
            : [])
    ];
}

export function buildRuntimeArtifactId(
    artifactType: V5ArtifactType,
    runtimeBinding: ArtifactRuntimeBinding
): string {
    const fingerprint = sha256Hex(canonicalize({
        artifactType,
        sessionId: runtimeBinding.sessionId,
        runId: runtimeBinding.runId,
        generation: runtimeBinding.generation
    })).slice(0, 24);
    const typeSlug = artifactType.replace(/_/g, '-').slice(0, 80);
    return `${typeSlug}-g${runtimeBinding.generation}-${fingerprint}`;
}
