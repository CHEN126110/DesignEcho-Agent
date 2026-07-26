/**
 * 设计源解析 IPC（PSD 知识库 P0）
 * psdDesignSource:analyze —— 离线解析设计师 PSD/PSB 为 design-source-profile（只读、不落盘）。
 */

import { ipcMain } from 'electron';
import { analyzePsdDesignSourceFile } from '../services/psd-design-source-service';

export function registerPsdDesignSourceHandlers(): void {
    ipcMain.handle('psdDesignSource:analyze', async (_event, filePath: string) => {
        return analyzePsdDesignSourceFile(String(filePath || ''));
    });
}
