/**
 * 网页内容提取 IPC Handlers
 *
 * 供 Agent 调用：访问指定 URL 提取设计相关内容
 */

import { ipcMain } from 'electron';
import { fetchWebPageDesignContent } from '../services/playwright-web-service';

export function registerWebPageHandlers(): void {
    ipcMain.handle('web:fetchPageDesignContent', async (_event, params: {
        url: string;
        extractImages?: boolean;
        maxTextLength?: number;
    }) => {
        try {
            return await fetchWebPageDesignContent(params);
        } catch (error: any) {
            console.error('[WebPageHandlers] fetchWebPageDesignContent error:', error);
            return {
                success: false,
                url: params?.url || '',
                error: error?.message || '访问网页失败'
            };
        }
    });

    console.log('[WebPageHandlers] ✅ 注册完成 (web:fetchPageDesignContent)');
}
