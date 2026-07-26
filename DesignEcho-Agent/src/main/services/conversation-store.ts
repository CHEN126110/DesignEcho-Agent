/**
 * 项目对话文件的主进程唯一持久化 owner。
 *
 * 同一项目的 save/load/delete/migrate 共享文件级队列，保证调用顺序；
 * 不同项目仍可并行。Renderer 只负责决定何时保存，不直接拥有文件生命周期。
 */

import * as fs from 'fs';
import * as path from 'path';
import {
    serializedFileOperations,
    type SerializedFileOperations
} from './serialized-file-operations';

interface ConversationFilePayload {
    projectId: string;
    updatedAt: number;
    conversations: unknown[];
    migratedFrom?: string;
}

export class ConversationStore {
    private readonly rootDir: string;
    private readonly fileOperations: SerializedFileOperations;

    constructor(rootDir: string, fileOperations: SerializedFileOperations = serializedFileOperations) {
        this.rootDir = path.resolve(rootDir);
        this.fileOperations = fileOperations;
    }

    async save(projectId: string, conversations: unknown[]): Promise<{ sizeKB: number }> {
        const filePath = this.resolveProjectFile(projectId);
        return await this.fileOperations.runExclusive(filePath, async () => {
            const payload = this.buildPayload(projectId, conversations);
            const serialized = JSON.stringify(payload, null, 2);
            await this.fileOperations.writeUtf8Atomically(filePath, serialized);
            return { sizeKB: Math.round(serialized.length / 1024) };
        });
    }

    async load(projectId: string): Promise<unknown[]> {
        const filePath = this.resolveProjectFile(projectId);
        return await this.fileOperations.runExclusive(filePath, async () => {
            try {
                const raw = await fs.promises.readFile(filePath, 'utf8');
                const data = JSON.parse(raw) as Partial<ConversationFilePayload>;
                return Array.isArray(data.conversations) ? data.conversations : [];
            } catch (error: any) {
                if (error?.code === 'ENOENT') return [];
                throw error;
            }
        });
    }

    async delete(projectId: string): Promise<void> {
        const filePath = this.resolveProjectFile(projectId);
        await this.fileOperations.runExclusive(filePath, async () => {
            await fs.promises.rm(filePath, { force: true });
        });
    }

    async migrateIfAbsent(projectId: string, conversations: unknown[]): Promise<boolean> {
        const filePath = this.resolveProjectFile(projectId);
        return await this.fileOperations.runExclusive(filePath, async () => {
            if (fs.existsSync(filePath)) return false;
            const payload: ConversationFilePayload = {
                ...this.buildPayload(projectId, conversations),
                migratedFrom: 'zustand-persist'
            };
            await this.fileOperations.writeUtf8Atomically(filePath, JSON.stringify(payload, null, 2));
            return true;
        });
    }

    async listProjectIds(): Promise<string[]> {
        await fs.promises.mkdir(this.rootDir, { recursive: true });
        const files = await fs.promises.readdir(this.rootDir);
        return files
            .filter((fileName) => fileName.endsWith('.json'))
            .map((fileName) => fileName.replace(/\.json$/i, ''));
    }

    private buildPayload(projectId: string, conversations: unknown[]): ConversationFilePayload {
        return {
            projectId,
            updatedAt: Date.now(),
            conversations
        };
    }

    private resolveProjectFile(projectId: string): string {
        const normalizedProjectId = String(projectId || '').trim();
        if (!normalizedProjectId) {
            throw new Error('对话持久化失败：项目标识为空');
        }
        const safeId = normalizedProjectId.replace(/[^a-zA-Z0-9_-]/g, '_');
        return path.join(this.rootDir, `${safeId}.json`);
    }
}
