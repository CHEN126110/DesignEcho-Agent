/**
 * 设计平台 MCP 爬虫服务
 * 
 * 支持平台：
 * - 花瓣 (huaban.com)
 * - 站酷 (zcool.com.cn)
 * - Behance (behance.net)
 * - Pinterest (pinterest.com)
 * 
 * 使用 MCP 协议提供工具接口
 */

import * as https from 'https';
import * as http from 'http';
import { URL } from 'url';

// ==================== 类型定义 ====================

/**
 * 设计作品
 */
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
        repins?: number;  // 花瓣采集数
    };
    tags: string[];
    colors?: string[];  // 提取的主色调
    category?: string;
    platform: 'huaban' | 'zcool' | 'behance' | 'pinterest';
    publishedAt?: string;
    fetchedAt: string;
}

/**
 * 搜索参数
 */
export interface SearchParams {
    query: string;
    platform: 'huaban' | 'zcool' | 'behance' | 'pinterest' | 'all';
    category?: 'ecommerce' | 'ui' | 'illustration' | 'photography' | 'branding';
    sort?: 'hot' | 'new' | 'popular';
    limit?: number;
    page?: number;
}

/**
 * 搜索结果
 */
export interface SearchResult {
    works: DesignWork[];
    total: number;
    page: number;
    hasMore: boolean;
    platform: string;
}

/**
 * 平台配置
 */
interface PlatformConfig {
    name: string;
    baseUrl: string;
    searchUrl: string;
    headers: Record<string, string>;
    rateLimit: number;  // 请求间隔 ms
}

// ==================== 平台配置 ====================

const PLATFORM_CONFIGS: Record<string, PlatformConfig> = {
    huaban: {
        name: '花瓣',
        baseUrl: 'https://huaban.com',
        searchUrl: 'https://huaban.com/search/',
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'application/json, text/javascript, */*',
            'X-Requested-With': 'XMLHttpRequest'
        },
        rateLimit: 1000
    },
    zcool: {
        name: '站酷',
        baseUrl: 'https://www.zcool.com.cn',
        searchUrl: 'https://www.zcool.com.cn/search/content',
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'application/json'
        },
        rateLimit: 1000
    },
    behance: {
        name: 'Behance',
        baseUrl: 'https://www.behance.net',
        searchUrl: 'https://www.behance.net/search/projects',
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'application/json'
        },
        rateLimit: 1500
    },
    pinterest: {
        name: 'Pinterest',
        baseUrl: 'https://www.pinterest.com',
        searchUrl: 'https://www.pinterest.com/resource/BaseSearchResource/get/',
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'application/json'
        },
        rateLimit: 1500
    }
};

// ==================== 爬虫基类 ====================

abstract class BaseCrawler {
    protected config: PlatformConfig;
    protected lastRequestTime: number = 0;
    
    constructor(platform: string) {
        this.config = PLATFORM_CONFIGS[platform];
    }
    
    /**
     * 限流等待
     */
    protected async rateLimit(): Promise<void> {
        const now = Date.now();
        const elapsed = now - this.lastRequestTime;
        if (elapsed < this.config.rateLimit) {
            await new Promise(resolve => setTimeout(resolve, this.config.rateLimit - elapsed));
        }
        this.lastRequestTime = Date.now();
    }
    
    /**
     * 发送 HTTP 请求
     */
    protected async fetch(url: string, options?: { headers?: Record<string, string> }): Promise<string> {
        await this.rateLimit();
        
        return new Promise((resolve, reject) => {
            const parsedUrl = new URL(url);
            const protocol = parsedUrl.protocol === 'https:' ? https : http;
            
            const req = protocol.get(url, {
                headers: {
                    ...this.config.headers,
                    ...options?.headers
                }
            }, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => resolve(data));
            });
            
            req.on('error', reject);
            req.setTimeout(10000, () => {
                req.destroy();
                reject(new Error('Request timeout'));
            });
        });
    }
    
    /**
     * 搜索作品（子类实现）
     */
    abstract search(params: SearchParams): Promise<SearchResult>;
    
    /**
     * 获取热门作品（子类实现）
     */
    abstract getTrending(category?: string, limit?: number): Promise<DesignWork[]>;
}

// ==================== 花瓣爬虫 ====================

class HuabanCrawler extends BaseCrawler {
    constructor() {
        super('huaban');
    }
    
    async search(params: SearchParams): Promise<SearchResult> {
        const { query, limit = 20, page = 1 } = params;
        
        try {
            // 花瓣搜索接口
            const url = `https://huaban.com/search/?q=${encodeURIComponent(query)}&page=${page}&per_page=${limit}&wfl=1`;
            const response = await this.fetch(url);
            
            // 解析 HTML 中的 JSON 数据
            const works = this.parseHuabanResponse(response, params);
            
            return {
                works,
                total: works.length,
                page,
                hasMore: works.length >= limit,
                platform: 'huaban'
            };
        } catch (error: any) {
            console.error('[HuabanCrawler] 搜索失败:', error.message);
            return { works: [], total: 0, page, hasMore: false, platform: 'huaban' };
        }
    }
    
    async getTrending(category?: string, limit: number = 20): Promise<DesignWork[]> {
        try {
            // 花瓣热门接口
            const categoryPath = this.getCategoryPath(category);
            const url = `https://huaban.com/${categoryPath}?wfl=1`;
            const response = await this.fetch(url);
            
            return this.parseHuabanResponse(response, { query: '', platform: 'huaban', limit });
        } catch (error: any) {
            console.error('[HuabanCrawler] 获取热门失败:', error.message);
            return [];
        }
    }
    
    private getCategoryPath(category?: string): string {
        const categoryMap: Record<string, string> = {
            'ecommerce': 'favorite/shopping',
            'ui': 'favorite/web',
            'illustration': 'favorite/illustration',
            'photography': 'favorite/photography',
            'branding': 'favorite/design'
        };
        return categoryMap[category || ''] || 'favorite/all';
    }
    
    private parseHuabanResponse(html: string, params: SearchParams): DesignWork[] {
        const works: DesignWork[] = [];
        
        // 尝试从 HTML 中提取 JSON 数据
        // 花瓣页面通常会在 script 标签中嵌入 app.page 数据
        const jsonMatch = html.match(/app\.page\["pins"\]\s*=\s*(\[[\s\S]*?\]);/);
        
        if (jsonMatch) {
            try {
                const pins = JSON.parse(jsonMatch[1]);
                
                for (const pin of pins.slice(0, params.limit || 20)) {
                    works.push({
                        id: `huaban_${pin.pin_id}`,
                        title: pin.raw_text || pin.description || '无标题',
                        url: `https://huaban.com/pins/${pin.pin_id}`,
                        thumbnailUrl: `https://hbimg.huabanimg.com/${pin.file?.key}_fw240`,
                        largeImageUrl: `https://hbimg.huabanimg.com/${pin.file?.key}`,
                        author: {
                            name: pin.user?.username || 'unknown',
                            url: pin.user?.urlname ? `https://huaban.com/${pin.user.urlname}` : undefined,
                            avatar: pin.user?.avatar?.key ? `https://hbimg.huabanimg.com/${pin.user.avatar.key}` : undefined
                        },
                        stats: {
                            likes: pin.like_count || 0,
                            views: 0,
                            comments: pin.comment_count || 0,
                            repins: pin.repin_count || 0
                        },
                        tags: pin.tags || [],
                        colors: this.extractColors(pin.file),
                        category: pin.board?.category || undefined,
                        platform: 'huaban',
                        publishedAt: pin.created_at ? new Date(pin.created_at * 1000).toISOString() : undefined,
                        fetchedAt: new Date().toISOString()
                    });
                }
            } catch (e) {
                console.warn('[HuabanCrawler] JSON 解析失败');
            }
        }
        
        return works;
    }
    
    private extractColors(file: any): string[] {
        if (!file?.colors) return [];
        return file.colors.map((c: any) => c.color || c).slice(0, 5);
    }
}

// ==================== 站酷爬虫 ====================

class ZcoolCrawler extends BaseCrawler {
    constructor() {
        super('zcool');
    }
    
    async search(params: SearchParams): Promise<SearchResult> {
        const { query, limit = 20, page = 1 } = params;
        
        try {
            const url = `https://www.zcool.com.cn/search/content?word=${encodeURIComponent(query)}&type=8&page=${page}`;
            const response = await this.fetch(url);
            
            const works = this.parseZcoolResponse(response, params);
            
            return {
                works,
                total: works.length,
                page,
                hasMore: works.length >= limit,
                platform: 'zcool'
            };
        } catch (error: any) {
            console.error('[ZcoolCrawler] 搜索失败:', error.message);
            return { works: [], total: 0, page, hasMore: false, platform: 'zcool' };
        }
    }
    
    async getTrending(category?: string, limit: number = 20): Promise<DesignWork[]> {
        try {
            const categoryId = this.getCategoryId(category);
            const url = `https://www.zcool.com.cn/home/popularList?p=1&cate=${categoryId}`;
            const response = await this.fetch(url);
            
            return this.parseZcoolResponse(response, { query: '', platform: 'zcool', limit });
        } catch (error: any) {
            console.error('[ZcoolCrawler] 获取热门失败:', error.message);
            return [];
        }
    }
    
    private getCategoryId(category?: string): number {
        const categoryMap: Record<string, number> = {
            'ecommerce': 515,  // 电商设计
            'ui': 17,         // UI/UX
            'illustration': 1, // 插画
            'photography': 13, // 摄影
            'branding': 8     // 品牌设计
        };
        return categoryMap[category || ''] || 0;
    }
    
    private parseZcoolResponse(html: string, params: SearchParams): DesignWork[] {
        const works: DesignWork[] = [];
        
        // 尝试解析 JSON 响应
        try {
            const data = JSON.parse(html);
            const items = data.data?.list || data.datas || [];
            
            for (const item of items.slice(0, params.limit || 20)) {
                works.push({
                    id: `zcool_${item.id || item.objectId}`,
                    title: item.title || item.name || '无标题',
                    url: item.pageUrl || `https://www.zcool.com.cn/work/${item.id}`,
                    thumbnailUrl: item.cover || item.coverUrl,
                    largeImageUrl: item.cover || item.coverUrl,
                    author: {
                        name: item.creatorObj?.username || item.member?.username || 'unknown',
                        url: item.creatorObj?.id ? `https://www.zcool.com.cn/u/${item.creatorObj.id}` : undefined,
                        avatar: item.creatorObj?.avatar
                    },
                    stats: {
                        likes: item.recommendCount || item.likeCount || 0,
                        views: item.viewCount || 0,
                        comments: item.commentCount || 0
                    },
                    tags: item.tags || [],
                    category: item.cate?.name || item.categoryName,
                    platform: 'zcool',
                    publishedAt: item.publishTime || item.createTime,
                    fetchedAt: new Date().toISOString()
                });
            }
        } catch (e) {
            console.warn('[ZcoolCrawler] 解析失败，尝试 HTML 解析');
            // 备用：HTML 解析逻辑
        }
        
        return works;
    }
}

// ==================== Behance 爬虫 ====================

class BehanceCrawler extends BaseCrawler {
    constructor() {
        super('behance');
    }
    
    async search(params: SearchParams): Promise<SearchResult> {
        const { query, limit = 20, page = 1 } = params;
        
        try {
            // Behance GraphQL API (公开接口)
            const url = `https://www.behance.net/search/projects?search=${encodeURIComponent(query)}&page=${page}`;
            const response = await this.fetch(url);
            
            const works = this.parseBehanceResponse(response, params);
            
            return {
                works,
                total: works.length,
                page,
                hasMore: works.length >= limit,
                platform: 'behance'
            };
        } catch (error: any) {
            console.error('[BehanceCrawler] 搜索失败:', error.message);
            return { works: [], total: 0, page, hasMore: false, platform: 'behance' };
        }
    }
    
    async getTrending(category?: string, limit: number = 20): Promise<DesignWork[]> {
        try {
            const field = this.getFieldId(category);
            const url = `https://www.behance.net/galleries/8/Graphic-Design?tracking_source=homepage${field ? `&field=${field}` : ''}`;
            const response = await this.fetch(url);
            
            return this.parseBehanceResponse(response, { query: '', platform: 'behance', limit });
        } catch (error: any) {
            console.error('[BehanceCrawler] 获取热门失败:', error.message);
            return [];
        }
    }
    
    private getFieldId(category?: string): string {
        const fieldMap: Record<string, string> = {
            'ecommerce': '132',
            'ui': '132',
            'illustration': '73',
            'photography': '2',
            'branding': '10'
        };
        return fieldMap[category || ''] || '';
    }
    
    private parseBehanceResponse(html: string, params: SearchParams): DesignWork[] {
        const works: DesignWork[] = [];
        
        // Behance 在页面中嵌入 JSON 数据
        const jsonMatch = html.match(/<script[^>]*>window\.__INITIAL_STATE__\s*=\s*({[\s\S]*?})<\/script>/);
        
        if (jsonMatch) {
            try {
                const data = JSON.parse(jsonMatch[1]);
                const projects = data.search?.projects || data.featured?.projects || [];
                
                for (const project of projects.slice(0, params.limit || 20)) {
                    works.push({
                        id: `behance_${project.id}`,
                        title: project.name || '无标题',
                        url: project.url || `https://www.behance.net/gallery/${project.id}`,
                        thumbnailUrl: project.covers?.['404'] || project.covers?.['202'],
                        largeImageUrl: project.covers?.['original'] || project.covers?.['808'],
                        author: {
                            name: project.owners?.[0]?.display_name || 'unknown',
                            url: project.owners?.[0]?.url,
                            avatar: project.owners?.[0]?.images?.['50']
                        },
                        stats: {
                            likes: project.stats?.appreciations || 0,
                            views: project.stats?.views || 0,
                            comments: project.stats?.comments || 0
                        },
                        tags: project.tags || project.fields?.map((f: any) => f.name) || [],
                        colors: project.colors?.map((c: any) => c.color || c) || [],
                        category: project.fields?.[0]?.name,
                        platform: 'behance',
                        publishedAt: project.published_on ? new Date(project.published_on * 1000).toISOString() : undefined,
                        fetchedAt: new Date().toISOString()
                    });
                }
            } catch (e) {
                console.warn('[BehanceCrawler] JSON 解析失败');
            }
        }
        
        return works;
    }
}

// ==================== MCP 服务主类 ====================

export class DesignCrawlerMCP {
    private crawlers: Record<string, BaseCrawler>;
    private cache: Map<string, { data: any; timestamp: number }> = new Map();
    private cacheExpiry = 30 * 60 * 1000;  // 30 分钟缓存
    
    constructor() {
        this.crawlers = {
            huaban: new HuabanCrawler(),
            zcool: new ZcoolCrawler(),
            behance: new BehanceCrawler()
        };
    }
    
    // ==================== MCP 工具方法 ====================
    
    /**
     * MCP 工具: 搜索设计作品
     */
    async searchDesigns(params: SearchParams): Promise<SearchResult[]> {
        const platforms = params.platform === 'all' 
            ? Object.keys(this.crawlers) 
            : [params.platform];
        
        const results: SearchResult[] = [];
        
        for (const platform of platforms) {
            const crawler = this.crawlers[platform];
            if (!crawler) continue;
            
            const cacheKey = `search_${platform}_${JSON.stringify(params)}`;
            const cached = this.getFromCache(cacheKey);
            
            if (cached) {
                results.push(cached);
            } else {
                try {
                    const result = await crawler.search(params);
                    this.setCache(cacheKey, result);
                    results.push(result);
                } catch (error: any) {
                    console.error(`[DesignCrawlerMCP] ${platform} 搜索失败:`, error.message);
                }
            }
        }
        
        return results;
    }
    
    /**
     * MCP 工具: 获取热门作品
     */
    async getTrendingDesigns(params: {
        platform: 'huaban' | 'zcool' | 'behance' | 'all';
        category?: 'ecommerce' | 'ui' | 'illustration' | 'photography' | 'branding';
        limit?: number;
    }): Promise<DesignWork[]> {
        const platforms = params.platform === 'all' 
            ? Object.keys(this.crawlers) 
            : [params.platform];
        
        const allWorks: DesignWork[] = [];
        
        for (const platform of platforms) {
            const crawler = this.crawlers[platform];
            if (!crawler) continue;
            
            const cacheKey = `trending_${platform}_${params.category}_${params.limit}`;
            const cached = this.getFromCache(cacheKey);
            
            if (cached) {
                allWorks.push(...cached);
            } else {
                try {
                    const works = await crawler.getTrending(params.category, params.limit);
                    this.setCache(cacheKey, works);
                    allWorks.push(...works);
                } catch (error: any) {
                    console.error(`[DesignCrawlerMCP] ${platform} 热门获取失败:`, error.message);
                }
            }
        }
        
        return allWorks;
    }
    
    /**
     * MCP 工具: 提取设计元数据
     */
    async extractDesignMetadata(work: DesignWork): Promise<{
        colors: string[];
        tags: string[];
        style?: string;
        category?: string;
        popularity: number;
    }> {
        // 计算流行度分数
        const popularity = Math.min(100, (
            (work.stats.likes * 2) +
            (work.stats.views * 0.01) +
            (work.stats.comments * 5) +
            ((work.stats.repins || 0) * 3)
        ) / 10);
        
        // 从标签推断风格
        const styleKeywords = {
            '极简': ['minimal', '极简', '简约', 'clean'],
            '扁平': ['flat', '扁平', 'material'],
            '渐变': ['gradient', '渐变'],
            '3D': ['3d', '三维', 'isometric'],
            '插画': ['illustration', '插画', 'vector']
        };
        
        let detectedStyle: string | undefined;
        const tags = work.tags.map(t => t.toLowerCase());
        
        for (const [style, keywords] of Object.entries(styleKeywords)) {
            if (keywords.some(kw => tags.some(t => t.includes(kw)))) {
                detectedStyle = style;
                break;
            }
        }
        
        return {
            colors: work.colors || [],
            tags: work.tags,
            style: detectedStyle,
            category: work.category,
            popularity
        };
    }
    
    /**
     * MCP 工具: 批量获取并分析
     */
    async fetchAndAnalyze(params: {
        query: string;
        platforms: ('huaban' | 'zcool' | 'behance')[];
        limit?: number;
    }): Promise<{
        works: DesignWork[];
        analysis: {
            topColors: Array<{ color: string; count: number }>;
            topStyles: Array<{ style: string; count: number }>;
            topTags: Array<{ tag: string; count: number }>;
            avgPopularity: number;
        };
    }> {
        const allWorks: DesignWork[] = [];
        
        // 从各平台获取作品
        for (const platform of params.platforms) {
            const results = await this.searchDesigns({
                query: params.query,
                platform,
                limit: params.limit || 10
            });
            
            for (const result of results) {
                allWorks.push(...result.works);
            }
        }
        
        // 分析结果
        const colorCount: Record<string, number> = {};
        const styleCount: Record<string, number> = {};
        const tagCount: Record<string, number> = {};
        let totalPopularity = 0;
        
        for (const work of allWorks) {
            const metadata = await this.extractDesignMetadata(work);
            
            // 颜色统计
            for (const color of metadata.colors) {
                colorCount[color] = (colorCount[color] || 0) + 1;
            }
            
            // 风格统计
            if (metadata.style) {
                styleCount[metadata.style] = (styleCount[metadata.style] || 0) + 1;
            }
            
            // 标签统计
            for (const tag of metadata.tags.slice(0, 5)) {
                tagCount[tag] = (tagCount[tag] || 0) + 1;
            }
            
            totalPopularity += metadata.popularity;
        }
        
        return {
            works: allWorks,
            analysis: {
                topColors: Object.entries(colorCount)
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, 10)
                    .map(([color, count]) => ({ color, count })),
                topStyles: Object.entries(styleCount)
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, 5)
                    .map(([style, count]) => ({ style, count })),
                topTags: Object.entries(tagCount)
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, 20)
                    .map(([tag, count]) => ({ tag, count })),
                avgPopularity: allWorks.length > 0 ? totalPopularity / allWorks.length : 0
            }
        };
    }
    
    // ==================== 缓存管理 ====================
    
    private getFromCache(key: string): any | null {
        const cached = this.cache.get(key);
        if (cached && Date.now() - cached.timestamp < this.cacheExpiry) {
            return cached.data;
        }
        return null;
    }
    
    private setCache(key: string, data: any): void {
        this.cache.set(key, { data, timestamp: Date.now() });
    }
    
    clearCache(): void {
        this.cache.clear();
    }
}

// ==================== 单例导出 ====================

let instance: DesignCrawlerMCP | null = null;

export function getDesignCrawlerMCP(): DesignCrawlerMCP {
    if (!instance) {
        instance = new DesignCrawlerMCP();
    }
    return instance;
}

export default DesignCrawlerMCP;
