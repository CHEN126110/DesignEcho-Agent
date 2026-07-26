/** Artifact Repository 的窄 IPC 边界。所有 owner/hash/path 校验仍在主进程 Service。 */

import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import * as fs from 'fs';
import type {
    ArtifactRuntimeBinding
} from '../../shared/agent-runtime-v5/artifact-repository-contract';
import type { ArtifactRef } from '../../shared/agent-runtime-v5/contracts/common';
import { canonicalize, sha256Hex } from '../../shared/agent-runtime-v5/content-hash';
import {
    buildRuntimeArtifactFinalizationCandidates,
    buildRuntimeArtifactId,
    readRuntimeArtifactAuthorizationRequest,
    readRuntimeArtifactFinalizationRequest
} from '../../shared/agent-runtime-v5/runtime-artifact-finalization';
import {
    ArtifactRepositoryError,
    artifactRepositoryService
} from '../services/artifact-repository-service';
import { runtimeArtifactAuthorizationService } from '../services/runtime-artifact-authorization-service';
import type { IPCContext } from './types';

type ArtifactRepositoryHandlerContext = Pick<IPCContext, 'mainWindow' | 'resourceManagerService'>;

function assertProjectPath(projectPath: unknown): string {
    const normalized = String(projectPath || '').trim();
    if (!normalized) {
        throw new ArtifactRepositoryError('project_missing', 'Artifact Repository 操作失败：缺少项目路径。');
    }
    if (!fs.existsSync(normalized) || !fs.statSync(normalized).isDirectory()) {
        throw new ArtifactRepositoryError(
            'project_missing',
            `Artifact Repository 操作失败：项目目录不存在（${normalized}）。`
        );
    }
    return fs.realpathSync.native(normalized);
}

function failure(error: unknown): { success: false; code: string; error: string } {
    const repositoryError = error as ArtifactRepositoryError;
    return {
        success: false,
        code: repositoryError?.code || 'artifact_repository_error',
        error: repositoryError?.message || String(error)
    };
}

function assertTrustedTopLevelSender(
    event: IpcMainInvokeEvent,
    context?: ArtifactRepositoryHandlerContext
): number {
    const sender = event?.sender;
    if (!sender || !Number.isInteger(sender.id) || sender.id < 1 || sender.isDestroyed()) {
        throw new ArtifactRepositoryError(
            'authorization_sender_invalid',
            'Runtime Artifact 操作失败：调用窗口身份无效。'
        );
    }
    if (!event.senderFrame || event.senderFrame !== sender.mainFrame) {
        throw new ArtifactRepositoryError(
            'authorization_subframe_forbidden',
            'Runtime Artifact 操作失败：子页面不能签发或消费收尾授权。'
        );
    }
    if (context?.mainWindow && context.mainWindow.webContents.id !== sender.id) {
        throw new ArtifactRepositoryError(
            'authorization_window_mismatch',
            'Runtime Artifact 操作失败：只有当前主工作台可以签发或消费收尾授权。'
        );
    }
    return sender.id;
}

function assertActiveProjectPath(
    canonicalProjectPath: string,
    context?: ArtifactRepositoryHandlerContext
): void {
    const activeProjectPath = String(context?.resourceManagerService?.getProjectRoot?.() || '').trim();
    if (!activeProjectPath) return;
    const canonicalActiveProjectPath = assertProjectPath(activeProjectPath);
    const normalize = (value: string): string => (
        process.platform === 'win32' ? value.toLowerCase() : value
    );
    if (normalize(canonicalActiveProjectPath) !== normalize(canonicalProjectPath)) {
        throw new ArtifactRepositoryError(
            'authorization_active_project_mismatch',
            'Runtime Artifact 操作失败：请求项目不是当前工作台已登记的活动项目。'
        );
    }
}

export function registerArtifactRepositoryHandlers(context?: ArtifactRepositoryHandlerContext): void {
    ipcMain.handle('artifactRepository:authorizeRuntimeFinalization', async (
        event: IpcMainInvokeEvent,
        projectPath: unknown,
        request: unknown
    ) => {
        try {
            const senderId = assertTrustedTopLevelSender(event, context);
            const canonicalProjectPath = assertProjectPath(projectPath);
            assertActiveProjectPath(canonicalProjectPath, context);
            const authorizationRequest = readRuntimeArtifactAuthorizationRequest(request);
            if (!authorizationRequest) {
                throw new ArtifactRepositoryError(
                    'invalid_authorization_request',
                    'Runtime Artifact 授权请求非法或含未知字段。'
                );
            }
            const grant = runtimeArtifactAuthorizationService.issue({
                senderId,
                canonicalProjectPath,
                request: authorizationRequest
            });
            return { success: true, grant };
        } catch (error) {
            return failure(error);
        }
    });

    ipcMain.handle('artifactRepository:finalizeRuntime', async (
        event: IpcMainInvokeEvent,
        projectPath: unknown,
        request: unknown
    ) => {
        let claimedAuthorizationToken: string | undefined;
        try {
            const senderId = assertTrustedTopLevelSender(event, context);
            const canonicalProjectPath = assertProjectPath(projectPath);
            assertActiveProjectPath(canonicalProjectPath, context);
            const finalization = readRuntimeArtifactFinalizationRequest(request);
            if (!finalization) {
                throw new ArtifactRepositoryError(
                    'invalid_finalization',
                    'Runtime Artifact 收尾请求非法或含未知字段。'
                );
            }
            const authorization = runtimeArtifactAuthorizationService.claim({
                senderId,
                canonicalProjectPath,
                authorizationToken: finalization.authorizationToken,
                finalizationHash: sha256Hex(canonicalize({
                    version: finalization.version,
                    artifacts: finalization.artifacts
                }))
            });
            claimedAuthorizationToken = finalization.authorizationToken;
            const runtimeBinding: ArtifactRuntimeBinding = {
                sessionId: authorization.runtimeIdentity.sessionId,
                runId: authorization.runtimeIdentity.runId,
                generation: authorization.runtimeIdentity.generation
            };
            const sourceRefs: ArtifactRef[] = [];
            for (const candidate of buildRuntimeArtifactFinalizationCandidates(finalization)) {
                const result = await artifactRepositoryService.publishRuntimeArtifact(
                    canonicalProjectPath,
                    {
                        artifactId: buildRuntimeArtifactId(
                            candidate.artifactType,
                            runtimeBinding
                        ),
                        artifactType: candidate.artifactType,
                        projectId: authorization.projectId,
                        skillId: authorization.skillId,
                        sourceRevision: runtimeBinding.generation,
                        sourceRefs: sourceRefs.map((ref) => ({ ...ref })),
                        capabilityStatus: 'manual_verification_pending',
                        runtimeBinding: { ...runtimeBinding },
                        payload: {
                            kind: 'json',
                            value: candidate.payload
                        }
                    }
                );
                sourceRefs.push({ ...result.ref });
            }
            const projection = await artifactRepositoryService.readProjection(
                canonicalProjectPath,
                runtimeBinding
            );
            runtimeArtifactAuthorizationService.complete(finalization.authorizationToken);
            return { success: true, projection };
        } catch (error) {
            if (claimedAuthorizationToken) {
                runtimeArtifactAuthorizationService.fail(claimedAuthorizationToken);
            }
            return failure(error);
        }
    });

    ipcMain.handle('artifactRepository:get', async (
        _event: IpcMainInvokeEvent,
        projectPath: unknown,
        ref: ArtifactRef
    ) => {
        try {
            const result = await artifactRepositoryService.get(assertProjectPath(projectPath), ref);
            return { success: true, result };
        } catch (error) {
            return failure(error);
        }
    });

    ipcMain.handle('artifactRepository:readProjection', async (
        _event: IpcMainInvokeEvent,
        projectPath: unknown,
        scope: ArtifactRuntimeBinding
    ) => {
        try {
            const projection = await artifactRepositoryService.readProjection(
                assertProjectPath(projectPath),
                scope
            );
            return { success: true, projection };
        } catch (error) {
            return failure(error);
        }
    });
}
