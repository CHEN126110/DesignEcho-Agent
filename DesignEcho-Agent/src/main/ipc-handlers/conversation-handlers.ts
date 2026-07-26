/**
 * 对话持久化 IPC Handlers
 *
 * 将对话数据独立存储为文件（每个项目一个文件），
 * 避免通过 Zustand persist + sendSync 传输大量数据。
 *
 * 存储位置: {userData}/conversations/{projectId}.json
 */

import { app, ipcMain, IpcMainInvokeEvent } from 'electron';
import path from 'path';
import type { IPCContext } from './types';
import { ConversationStore } from '../services/conversation-store';

const CONVERSATIONS_DIR = 'conversations';

export function registerConversationHandlers(context: IPCContext): void {
    const { logService } = context;
    const conversationStore = new ConversationStore(path.join(app.getPath('userData'), CONVERSATIONS_DIR));

    /**
     * 保存项目对话
     * conversations: Conversation[] 数组
     */
    ipcMain.handle('conversation:save', async (
        _event: IpcMainInvokeEvent,
        projectId: string,
        conversations: any[]
    ) => {
        try {
            const { sizeKB } = await conversationStore.save(projectId, conversations);
            console.log(`[Conversation] 保存成功: project="${projectId}", ${conversations.length} 条对话, ${sizeKB}KB`);
            return { success: true };
        } catch (error: any) {
            console.error(`[Conversation] 保存失败: project="${projectId}":`, error?.message);
            logService?.logAgent('error', `[Conversation] 保存失败: ${error?.message}`);
            return { success: false, error: error?.message || String(error) };
        }
    });

    /**
     * 加载项目对话
     */
    ipcMain.handle('conversation:load', async (
        _event: IpcMainInvokeEvent,
        projectId: string
    ) => {
        try {
            const conversations = await conversationStore.load(projectId);
            console.log(`[Conversation] 加载成功: project="${projectId}", ${conversations.length} 条对话`);
            return { success: true, conversations };
        } catch (error: any) {
            console.error(`[Conversation] 加载失败: project="${projectId}":`, error?.message);
            return { success: false, error: error?.message, conversations: [] };
        }
    });

    /**
     * 删除项目对话
     */
    ipcMain.handle('conversation:delete', async (
        _event: IpcMainInvokeEvent,
        projectId: string
    ) => {
        try {
            await conversationStore.delete(projectId);
            return { success: true };
        } catch (error: any) {
            return { success: false, error: error?.message };
        }
    });

    /**
     * 批量迁移：从旧的 projectConversations 对象迁移到独立文件
     * 用于从 Zustand persist 数据迁移
     */
    ipcMain.handle('conversation:migrateFromStore', async (
        _event: IpcMainInvokeEvent,
        projectConversations: Record<string, any[]>
    ) => {
        try {
            let migrated = 0;

            for (const [projectId, conversations] of Object.entries(projectConversations)) {
                if (!Array.isArray(conversations) || conversations.length === 0) continue;
                const didMigrate = await conversationStore.migrateIfAbsent(projectId, conversations);
                if (!didMigrate) continue;
                migrated++;
                console.log(`[Conversation] 迁移: project="${projectId}", ${conversations.length} 条对话`);
            }

            console.log(`[Conversation] 迁移完成: ${migrated} 个项目`);
            return { success: true, migrated };
        } catch (error: any) {
            console.error(`[Conversation] 迁移失败:`, error?.message);
            return { success: false, error: error?.message };
        }
    });

    /**
     * 列出所有有对话数据的项目 ID
     */
    ipcMain.handle('conversation:listProjects', async () => {
        try {
            const projectIds = await conversationStore.listProjectIds();
            return { success: true, projectIds };
        } catch (error: any) {
            return { success: false, projectIds: [], error: error?.message };
        }
    });
}
