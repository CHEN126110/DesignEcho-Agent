/**
 * MCP 设计平台爬虫 IPC Handlers
 */

import { ipcMain } from 'electron';
import {
    getDesignCrawlerMCP,
    SearchParams,
    SearchResult,
    DesignWork
} from '../services/mcp';

/**
 * 注册 MCP 相关 IPC handlers
 */
export function registerMCPHandlers(): void {
    console.log('[MCPHandlers] 注册 MCP IPC handlers...');
    
    const mcp = getDesignCrawlerMCP();

    // ==================== 设计平台搜索 ====================

    /**
     * 搜索设计作品
     */
    ipcMain.handle('mcp:searchDesigns', async (
        _event,
        params: SearchParams
    ): Promise<SearchResult[]> => {
        try {
            console.log(`[MCPHandlers] 搜索设计: ${params.query} (${params.platform})`);
            return await mcp.searchDesigns(params);
        } catch (error: any) {
            console.error('[MCPHandlers] mcp:searchDesigns error:', error);
            return [];
        }
    });

    /**
     * 获取热门设计
     */
    ipcMain.handle('mcp:getTrendingDesigns', async (
        _event,
        params: {
            platform: 'huaban' | 'zcool' | 'behance' | 'all';
            category?: 'ecommerce' | 'ui' | 'illustration' | 'photography' | 'branding';
            limit?: number;
        }
    ): Promise<DesignWork[]> => {
        try {
            console.log(`[MCPHandlers] 获取热门: ${params.platform} / ${params.category || 'all'}`);
            return await mcp.getTrendingDesigns(params);
        } catch (error: any) {
            console.error('[MCPHandlers] mcp:getTrendingDesigns error:', error);
            return [];
        }
    });

    /**
     * 提取设计元数据
     */
    ipcMain.handle('mcp:extractDesignMetadata', async (
        _event,
        work: DesignWork
    ): Promise<{
        colors: string[];
        tags: string[];
        style?: string;
        category?: string;
        popularity: number;
    }> => {
        try {
            return await mcp.extractDesignMetadata(work);
        } catch (error: any) {
            console.error('[MCPHandlers] mcp:extractDesignMetadata error:', error);
            return { colors: [], tags: [], popularity: 0 };
        }
    });

    /**
     * 批量获取并分析
     */
    ipcMain.handle('mcp:fetchAndAnalyze', async (
        _event,
        params: {
            query: string;
            platforms: ('huaban' | 'zcool' | 'behance')[];
            limit?: number;
        }
    ): Promise<{
        works: DesignWork[];
        analysis: {
            topColors: Array<{ color: string; count: number }>;
            topStyles: Array<{ style: string; count: number }>;
            topTags: Array<{ tag: string; count: number }>;
            avgPopularity: number;
        };
    }> => {
        try {
            console.log(`[MCPHandlers] 批量分析: ${params.query} (${params.platforms.join(', ')})`);
            return await mcp.fetchAndAnalyze(params);
        } catch (error: any) {
            console.error('[MCPHandlers] mcp:fetchAndAnalyze error:', error);
            return {
                works: [],
                analysis: {
                    topColors: [],
                    topStyles: [],
                    topTags: [],
                    avgPopularity: 0
                }
            };
        }
    });

    /**
     * 清除缓存
     */
    ipcMain.handle('mcp:clearCache', async (): Promise<void> => {
        try {
            mcp.clearCache();
            console.log('[MCPHandlers] 缓存已清除');
        } catch (error: any) {
            console.error('[MCPHandlers] mcp:clearCache error:', error);
        }
    });

    console.log('[MCPHandlers] ✅ MCP IPC handlers 注册完成 (5 handlers)');
}
