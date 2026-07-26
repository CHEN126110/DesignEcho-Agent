/**
 * Design Project State 持久化 IPC
 *
 * 存储位置：<projectPath>/.designecho/design-state.json（UTF-8 无 BOM）
 * 合并语义在 shared/design-project-state.ts（纯逻辑，可测）；本层只校验入口，
 * Repository refs 的复核与固定锁序交给主进程协调器。
 */

import { ipcMain, IpcMainInvokeEvent } from 'electron';
import * as fs from 'fs';
import type { DesignProjectStatePatch } from '../../shared/types/design-project-state.types';
import { designProjectStateCoordinator } from '../services/design-project-state-coordinator';

function assertProjectPath(projectPath: unknown): string {
    const normalized = String(projectPath || '').trim();
    if (!normalized) {
        throw new Error('Design Project State 操作失败：缺少项目路径。请先打开项目或在参数中提供 projectPath。');
    }
    if (!fs.existsSync(normalized)) {
        throw new Error(`Design Project State 操作失败：项目目录不存在（${normalized}）。`);
    }
    return normalized;
}

export function registerDesignStateHandlers(): void {
    ipcMain.handle('design-state:get', async (_event: IpcMainInvokeEvent, projectPath: string) => {
        const root = assertProjectPath(projectPath);
        return { success: true, projectPath: root, state: await designProjectStateCoordinator.get(root) };
    });

    ipcMain.handle('design-state:update', async (
        _event: IpcMainInvokeEvent,
        projectPath: string,
        patch: DesignProjectStatePatch
    ) => {
        const root = assertProjectPath(projectPath);
        if (!patch || typeof patch !== 'object' || (!patch.set && !patch.upsertFacts && !patch.reviewFacts && !patch.upsertRules && !patch.reviewRules && !patch.appendLearning && !patch.appendVersion)) {
            throw new Error('Design Project State 更新失败：patch 为空。请提供 set、upsertFacts、reviewFacts、upsertRules、reviewRules、appendLearning 或 appendVersion。');
        }
        const next = await designProjectStateCoordinator.update(root, patch);
        console.log(`[DesignState] 已更新（${patch.updatedBy || 'unknown'}）：${root}`);
        return { success: true, projectPath: root, state: next };
    });
}
