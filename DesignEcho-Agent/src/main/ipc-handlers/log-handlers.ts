/**
 * 日志相关 IPC Handlers
 * 
 * 支持功能：
 * - 获取主日志
 * - 获取错误日志
 * - 获取错误统计
 * - 按分类筛选日志
 */

import { ipcMain, IpcMainInvokeEvent, shell } from 'electron';
import type { IPCContext } from './types';
import type { LogCategory } from '../services/log-service';

/**
 * 注册日志相关 IPC handlers
 */
export function registerLogHandlers(context: IPCContext): void {
    const { logService } = context;

    // 获取最近的日志
    ipcMain.handle('log:getRecent', async (_event: IpcMainInvokeEvent, lines?: number) => {
        if (!logService) {
            return '日志服务未初始化';
        }
        return logService.getRecentLogs(lines || 100);
    });

    // 获取日志文件路径
    ipcMain.handle('log:getPath', async () => {
        if (!logService) {
            return '';
        }
        return logService.getLogFilePath();
    });
    
    // 获取日志目录路径
    ipcMain.handle('log:getDir', async () => {
        if (!logService) {
            return '';
        }
        return logService.getLogDir();
    });

    // 清空日志
    ipcMain.handle('log:clear', async () => {
        if (logService) {
            logService.clearLogs();
        }
        return { success: true };
    });

    // 从渲染进程写入日志
    ipcMain.handle('log:write', async (_event: IpcMainInvokeEvent, level: string, message: string, data?: any) => {
        if (logService) {
            const logLevel = level as 'info' | 'warn' | 'error';
            if (data) {
                logService.logAgent(logLevel, `[Renderer] ${message}`, data);
            } else {
                logService.logAgent(logLevel, `[Renderer] ${message}`);
            }
        }
        return { success: true };
    });
    
    // 获取错误日志
    ipcMain.handle('log:getErrors', async (_event: IpcMainInvokeEvent, lines?: number) => {
        if (!logService) {
            return '日志服务未初始化';
        }
        return logService.getErrorLogs(lines || 50);
    });
    
    // 获取错误统计
    ipcMain.handle('log:getErrorStats', async () => {
        if (!logService) {
            return { total: 0, byType: {}, recent: [] };
        }
        return logService.getErrorStats();
    });
    
    // 按分类获取日志
    ipcMain.handle('log:getByCategory', async (_event: IpcMainInvokeEvent, category: LogCategory, lines?: number) => {
        if (!logService) {
            return '日志服务未初始化';
        }
        return logService.getLogsByCategory(category, lines || 50);
    });
    
    // 打开日志目录
    ipcMain.handle('log:openDir', async () => {
        if (!logService) {
            return { success: false, error: '日志服务未初始化' };
        }
        try {
            await shell.openPath(logService.getLogDir());
            return { success: true };
        } catch (error) {
            return { success: false, error: String(error) };
        }
    });
}
