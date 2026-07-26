/**
 * 设计平台爬虫 Renderer 服务
 * 
 * 提供花瓣/站酷/Behance 设计作品获取接口
 */

// ==================== 类型定义 ====================

export interface DesignWork {
    id: string;
    title: string;
    url: string;
    thumbnailUrl?: string;
    largeImageUrl?: string;
    author: {
        name: string;
        url?: string;
        avatar?: string;
    };
    stats: {
        likes: number;
        views: number;
        comments: number;
        repins?: number;
    };
    tags: string[];
    colors?: string[];
    category?: string;
    platform: 'huaban' | 'zcool' | 'behance' | 'pinterest';
    publishedAt?: string;
    fetchedAt: string;
}

export interface SearchParams {
    query: string;
    platform: 'huaban' | 'zcool' | 'behance' | 'pinterest' | 'all';
    category?: 'ecommerce' | 'ui' | 'illustration' | 'photography' | 'branding';
    sort?: 'hot' | 'new' | 'popular';
    limit?: number;
    page?: number;
}

export interface SearchResult {
    works: DesignWork[];
    total: number;
    page: number;
    hasMore: boolean;
    platform: string;
}

export interface DesignAnalysis {
    topColors: Array<{ color: string; count: number }>;
    topStyles: Array<{ style: string; count: number }>;
    topTags: Array<{ tag: string; count: number }>;
    avgPopularity: number;
}

// ==================== IPC 接口 ====================

declare global {
    interface Window {
        electronAPI: {
            invoke: (channel: string, ...args: any[]) => Promise<any>;
        };
    }
}

// ==================== 服务函数 ====================

/**
 * 搜索设计作品
 */
export async function searchDesigns(params: SearchParams): Promise<SearchResult[]> {
    try {
        return await window.electronAPI.invoke('mcp:searchDesigns', params);
    } catch (error) {
        console.error('[DesignCrawlerService] searchDesigns 失败:', error);
        return [];
    }
}

/**
 * 获取热门设计
 */
export async function getTrendingDesigns(params: {
    platform: 'huaban' | 'zcool' | 'behance' | 'all';
    category?: 'ecommerce' | 'ui' | 'illustration' | 'photography' | 'branding';
    limit?: number;
}): Promise<DesignWork[]> {
    try {
        return await window.electronAPI.invoke('mcp:getTrendingDesigns', params);
    } catch (error) {
        console.error('[DesignCrawlerService] getTrendingDesigns 失败:', error);
        return [];
    }
}

/**
 * 提取设计元数据
 */
export async function extractDesignMetadata(work: DesignWork): Promise<{
    colors: string[];
    tags: string[];
    style?: string;
    category?: string;
    popularity: number;
}> {
    try {
        return await window.electronAPI.invoke('mcp:extractDesignMetadata', work);
    } catch (error) {
        console.error('[DesignCrawlerService] extractDesignMetadata 失败:', error);
        return { colors: [], tags: [], popularity: 0 };
    }
}

/**
 * 批量获取并分析
 */
export async function fetchAndAnalyze(params: {
    query: string;
    platforms: ('huaban' | 'zcool' | 'behance')[];
    limit?: number;
}): Promise<{
    works: DesignWork[];
    analysis: DesignAnalysis;
}> {
    try {
        return await window.electronAPI.invoke('mcp:fetchAndAnalyze', params);
    } catch (error) {
        console.error('[DesignCrawlerService] fetchAndAnalyze 失败:', error);
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
}

/**
 * 清除缓存
 */
export async function clearCrawlerCache(): Promise<void> {
    try {
        await window.electronAPI.invoke('mcp:clearCache');
    } catch (error) {
        console.error('[DesignCrawlerService] clearCache 失败:', error);
    }
}

// ==================== 便捷函数 ====================

/**
 * 获取电商设计灵感
 */
export async function getEcommerceInspiration(query: string = '电商详情页'): Promise<{
    works: DesignWork[];
    analysis: DesignAnalysis;
}> {
    return fetchAndAnalyze({
        query: query + ' 电商 设计',
        platforms: ['huaban', 'zcool', 'behance'],
        limit: 10
    });
}

/**
 * 获取配色参考
 */
export async function getColorInspiration(mood: string): Promise<DesignWork[]> {
    const results = await searchDesigns({
        query: `${mood} 配色 设计`,
        platform: 'all',
        limit: 20
    });
    
    return results.flatMap(r => r.works);
}

/**
 * 获取特定平台热门
 */
export async function getPlatformHot(
    platform: 'huaban' | 'zcool' | 'behance',
    category: 'ecommerce' | 'ui' | 'illustration' = 'ecommerce'
): Promise<DesignWork[]> {
    return getTrendingDesigns({
        platform,
        category,
        limit: 20
    });
}
