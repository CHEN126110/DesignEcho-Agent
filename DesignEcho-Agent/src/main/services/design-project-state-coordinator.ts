/**
 * Design Project State 的主进程消费边界。
 *
 * IPC 与 MCP 不直接读取 Store：ArtifactRefs 必须先由 Artifact Repository 扫描、验证并
 * 重建投影。协调的固定锁序由 ArtifactRepositoryService 统一执行，避免 State -> Repository
 * 与 Repository -> State 互相等待。
 */

import type {
    DesignProjectState,
    DesignProjectStatePatch
} from '../../shared/types/design-project-state.types';
import {
    artifactRepositoryService,
    type ArtifactRepositoryService
} from './artifact-repository-service';

export class DesignProjectStateCoordinator {
    private readonly artifactRepository: ArtifactRepositoryService;

    constructor(artifactRepository: ArtifactRepositoryService = artifactRepositoryService) {
        this.artifactRepository = artifactRepository;
    }

    async get(projectPath: string): Promise<DesignProjectState> {
        return await this.artifactRepository.getVerifiedDesignProjectState(projectPath);
    }

    async update(
        projectPath: string,
        patch: DesignProjectStatePatch
    ): Promise<DesignProjectState> {
        return await this.artifactRepository.updateVerifiedDesignProjectState(projectPath, patch);
    }
}

export const designProjectStateCoordinator = new DesignProjectStateCoordinator();
