/**
 * 主进程内共享的文件级异步生命周期 owner。
 *
 * 同一目标文件的 read -> mutate -> replace 必须放在 runExclusive 内；
 * 不同文件使用不同队列，避免用全局锁牺牲跨项目并行。
 * 这里只治理单 Electron 主进程，不冒充跨进程文件锁。
 */

import * as fs from 'fs';
import * as path from 'path';

export class SerializedFileOperations {
    private readonly queues = new Map<string, Promise<void>>();
    private temporaryFileSequence = 0;

    async runExclusive<T>(
        targetPath: string,
        operation: (normalizedTargetPath: string) => Promise<T>
    ): Promise<T> {
        const normalizedTargetPath = path.resolve(targetPath);
        const queueKey = process.platform === 'win32'
            ? normalizedTargetPath.toLowerCase()
            : normalizedTargetPath;
        const previous = this.queues.get(queueKey) || Promise.resolve();
        const result = previous
            .catch(() => undefined)
            .then(async () => await operation(normalizedTargetPath));
        const tail = result.then(() => undefined, () => undefined);

        this.queues.set(queueKey, tail);

        return await result.finally(() => {
            if (this.queues.get(queueKey) === tail) {
                this.queues.delete(queueKey);
            }
        });
    }

    async writeUtf8Atomically(targetPath: string, content: string): Promise<void> {
        const normalizedTargetPath = path.resolve(targetPath);
        const targetDir = path.dirname(normalizedTargetPath);
        await fs.promises.mkdir(targetDir, { recursive: true });

        this.temporaryFileSequence += 1;
        const temporaryPath = `${normalizedTargetPath}.tmp-${process.pid}-${Date.now()}-${this.temporaryFileSequence}`;

        try {
            await fs.promises.writeFile(temporaryPath, content, { encoding: 'utf8' });
            await fs.promises.rename(temporaryPath, normalizedTargetPath);
        } finally {
            await fs.promises.rm(temporaryPath, { force: true }).catch(() => undefined);
        }
    }

    async writeBytesAtomically(targetPath: string, content: Uint8Array): Promise<void> {
        const normalizedTargetPath = path.resolve(targetPath);
        const targetDir = path.dirname(normalizedTargetPath);
        await fs.promises.mkdir(targetDir, { recursive: true });

        this.temporaryFileSequence += 1;
        const temporaryPath = `${normalizedTargetPath}.tmp-${process.pid}-${Date.now()}-${this.temporaryFileSequence}`;

        try {
            await fs.promises.writeFile(temporaryPath, content);
            await fs.promises.rename(temporaryPath, normalizedTargetPath);
        } finally {
            await fs.promises.rm(temporaryPath, { force: true }).catch(() => undefined);
        }
    }

    async writeDirectoryAtomically(
        targetPath: string,
        writer: (temporaryPath: string) => Promise<void>
    ): Promise<void> {
        const normalizedTargetPath = path.resolve(targetPath);
        const parentDir = path.dirname(normalizedTargetPath);
        await fs.promises.mkdir(parentDir, { recursive: true });

        this.temporaryFileSequence += 1;
        const temporaryPath = `${normalizedTargetPath}.tmp-${process.pid}-${Date.now()}-${this.temporaryFileSequence}`;
        await fs.promises.mkdir(temporaryPath, { recursive: false });

        try {
            await writer(temporaryPath);
            await fs.promises.rename(temporaryPath, normalizedTargetPath);
        } finally {
            await fs.promises.rm(temporaryPath, { recursive: true, force: true }).catch(() => undefined);
        }
    }
}

export const serializedFileOperations = new SerializedFileOperations();
