/**
 * Design Project State 的主进程唯一持久化 owner。
 *
 * Renderer IPC 与外部 MCP 必须共享同一个实例，避免各自执行
 * read -> patch -> write 时发生丢失更新或争抢同一个临时文件。
 */

import * as fs from 'fs';
import * as path from 'path';
import {
    applyDesignProjectStatePatch,
    createEmptyDesignProjectState,
    normalizeDesignProjectState
} from '../../shared/design-project-state';
import type {
    DesignProjectState,
    DesignProjectStatePatch
} from '../../shared/types/design-project-state.types';
import { normalizeArtifactRefs } from '../../shared/agent-runtime-v5/artifact-repository-contract';
import type { ArtifactRef } from '../../shared/agent-runtime-v5/contracts/common';
import {
    serializedFileOperations,
    type SerializedFileOperations
} from './serialized-file-operations';

export interface DesignProjectStateStoreOptions {
    onWarning?: (message: string) => void;
    fileOperations?: SerializedFileOperations;
}

export class DesignProjectStateStore {
    private readonly fileOperations: SerializedFileOperations;
    private readonly onWarning?: (message: string) => void;
    /**
     * 仅记录本进程内由 Repository 写入口确认过的 refs。
     *
     * design-state.json 是可恢复的项目投影，不是 Artifact 真相源。普通 get 永不返回 refs；
     * update 只允许原样保留本进程最近一次 Repository 投影。真正面向 IPC/MCP 的 refs
     * 由协调器重新扫描 Repository 后返回，合法外形的手工/历史脏引用不会被 Store 洗白。
     */
    private readonly repositoryVerifiedRefs = new Map<string, ArtifactRef[]>();

    constructor(options: DesignProjectStateStoreOptions = {}) {
        this.onWarning = options.onWarning;
        this.fileOperations = options.fileOperations || serializedFileOperations;
    }

    async get(projectPath: string): Promise<DesignProjectState> {
        const normalizedProjectPath = this.normalizeProjectPath(projectPath);
        const { file } = this.resolveStateFile(normalizedProjectPath);
        return await this.fileOperations.runExclusive(file, async () => {
            const state = await this.readState(normalizedProjectPath, false);
            // Store 只是持久化层，不能证明 Repository 文件仍存在；refs 只从受治理协调器返回。
            const withoutArtifactRefs = { ...state };
            delete withoutArtifactRefs.artifactRefs;
            return withoutArtifactRefs;
        });
    }

    async update(projectPath: string, patch: DesignProjectStatePatch): Promise<DesignProjectState> {
        const normalizedProjectPath = this.normalizeProjectPath(projectPath);
        const { file } = this.resolveStateFile(normalizedProjectPath);
        return await this.fileOperations.runExclusive(file, async () => {
            const current = await this.readState(normalizedProjectPath, true);
            const next = applyDesignProjectStatePatch(current, patch);
            await this.writeState(normalizedProjectPath, next);
            // 普通更新不能把缓存中的 refs 当作本次权威依据；协调器会用 Repository 再投影。
            const withoutArtifactRefs = { ...next };
            delete withoutArtifactRefs.artifactRefs;
            return withoutArtifactRefs;
        });
    }

    /** Repository 内部写入口；Renderer/模型 patch 不得触碰 artifactRefs。 */
    async replaceArtifactRefs(projectPath: string, refs: ArtifactRef[]): Promise<DesignProjectState> {
        const normalizedProjectPath = this.normalizeProjectPath(projectPath);
        const { file } = this.resolveStateFile(normalizedProjectPath);
        return await this.fileOperations.runExclusive(file, async () => {
            // 这里是 Repository 的唯一内部写入口：先读取其他状态字段，但绝不继承磁盘自报 refs。
            const current = await this.readState(normalizedProjectPath, true, false);
            const normalizedRefs = normalizeArtifactRefs(refs);
            if (!Array.isArray(refs) || normalizedRefs.length !== refs.length) {
                throw new Error('Artifact Repository 拒绝把非法、重复或冲突引用写入 Design Project State。');
            }
            const verifiedCopies = normalizedRefs.map((ref) => ({ ...ref }));
            if (this.sameArtifactRefs(current.artifactRefs, normalizedRefs)) {
                this.repositoryVerifiedRefs.set(
                    this.projectKey(normalizedProjectPath),
                    verifiedCopies
                );
                return {
                    ...current,
                    ...(verifiedCopies.length > 0 ? { artifactRefs: verifiedCopies } : {})
                };
            }
            const next: DesignProjectState = {
                ...current,
                ...(normalizedRefs.length > 0 ? { artifactRefs: normalizedRefs } : {}),
                updatedAt: new Date().toISOString(),
                updatedBy: 'artifact_repository'
            };
            if (normalizedRefs.length === 0) delete next.artifactRefs;
            await this.writeState(normalizedProjectPath, next);
            this.repositoryVerifiedRefs.set(
                this.projectKey(normalizedProjectPath),
                verifiedCopies
            );
            return next;
        });
    }

    private resolveStateFile(projectPath: string): { dir: string; file: string } {
        const dir = path.join(projectPath, '.designecho');
        return { dir, file: path.join(dir, 'design-state.json') };
    }

    private normalizeProjectPath(projectPath: string): string {
        const requested = String(projectPath || '').trim();
        if (!requested) {
            throw new Error('Design Project State 操作失败：缺少项目路径。');
        }
        const resolved = path.resolve(requested);
        let stats: fs.Stats;
        try {
            stats = fs.statSync(resolved);
        } catch {
            throw new Error(`Design Project State 操作失败：项目目录不存在（${resolved}）。`);
        }
        if (!stats.isDirectory()) {
            throw new Error(`Design Project State 操作失败：项目路径不是目录（${resolved}）。`);
        }
        try {
            return path.resolve(fs.realpathSync.native(resolved));
        } catch (error: any) {
            throw new Error(
                `Design Project State 操作失败：无法解析项目真实路径（${resolved}）：${error?.message || String(error)}`
            );
        }
    }

    private projectKey(projectPath: string): string {
        return process.platform === 'win32' ? projectPath.toLowerCase() : projectPath;
    }

    private sameArtifactRefs(left: ArtifactRef[] | undefined, right: ArtifactRef[]): boolean {
        const normalizedLeft = Array.isArray(left) ? left : [];
        if (normalizedLeft.length !== right.length) return false;
        return normalizedLeft.every((ref, index) => (
            ref.artifactId === right[index].artifactId
            && ref.artifactType === right[index].artifactType
            && ref.contentHash === right[index].contentHash
        ));
    }

    private keepOnlyRepositoryVerifiedRefs(
        projectPath: string,
        state: DesignProjectState
    ): DesignProjectState {
        const verified = this.repositoryVerifiedRefs.get(this.projectKey(projectPath));
        if (verified && this.sameArtifactRefs(state.artifactRefs, verified)) {
            return {
                ...state,
                ...(verified.length > 0
                    ? { artifactRefs: verified.map((ref) => ({ ...ref })) }
                    : {})
            };
        }
        const sanitized = { ...state };
        delete sanitized.artifactRefs;
        return sanitized;
    }

    private async readState(
        projectPath: string,
        failOnInvalidState: boolean,
        includeOnlyRepositoryVerifiedRefs: boolean = true
    ): Promise<DesignProjectState> {
        const { file } = this.resolveStateFile(projectPath);
        if (!fs.existsSync(file)) return createEmptyDesignProjectState();

        try {
            const raw = await fs.promises.readFile(file, 'utf8');
            const normalized = normalizeDesignProjectState(JSON.parse(raw));
            return includeOnlyRepositoryVerifiedRefs
                ? this.keepOnlyRepositoryVerifiedRefs(projectPath, normalized)
                : normalized;
        } catch (error: any) {
            const message = `Design Project State 解析失败（${file}）：${error?.message || String(error)}`;
            this.onWarning?.(message);
            if (failOnInvalidState) {
                throw new Error(`${message}。为保护原状态文件，本次更新已停止。`);
            }
            return createEmptyDesignProjectState();
        }
    }

    private async writeState(projectPath: string, state: DesignProjectState): Promise<void> {
        const { file } = this.resolveStateFile(projectPath);
        await this.fileOperations.writeUtf8Atomically(file, JSON.stringify(state, null, 2));
    }
}

/**
 * Electron 主进程内的共享实例。IPC 与 MCP 共同消费，不能各自创建 Store。
 */
export const designProjectStateStore = new DesignProjectStateStore({
    onWarning: (message) => console.warn(`[DesignState] ${message}`)
});
