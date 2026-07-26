/**
 * 设计趋势感知服务
 * 
 * 核心职责：
 * 1. 联网搜索获取设计趋势信息
 * 2. 爬取 Behance/花瓣/站酷 热门作品
 * 3. 判断当前设计是否过时/跟风
 * 4. 提供差异化建议
 * 
 * 实现方案：
 * - 开发阶段使用免费 API（Tavily/DuckDuckGo）
 * - 支持 MCP 工具扩展
 * - 缓存机制减少请求次数
 */

import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

// ==================== 类型定义 ====================

/**
 * 趋势信息
 */
export interface TrendInfo {
    /** 趋势名称 */
    name: string;
    /** 趋势类型 */
    type: 'style' | 'color' | 'layout' | 'typography' | 'technique';
    /** 流行程度 (0-100) */
    popularity: number;
    /** 生命周期阶段 */
    lifecycle: 'emerging' | 'growing' | 'peak' | 'declining' | 'outdated';
    /** 描述 */
    description: string;
    /** 示例关键词 */
    keywords: string[];
    /** 来源平台 */
    source: string;
    /** 获取时间 */
    fetchedAt: string;
}

/**
 * 趋势洞察
 */
export interface TrendInsight {
    /** 当前流行趋势 */
    currentTrends: {
        styles: TrendInfo[];
        colors: TrendInfo[];
        layouts: TrendInfo[];
        typography: TrendInfo[];
    };
    
    /** 差异化建议 */
    differentiationSuggestions: string[];
    
    /** 避免使用（即将过时） */
    avoidTrends: TrendInfo[];
    
    /** 推荐尝试（新兴趋势） */
    emergingTrends: TrendInfo[];
    
    /** 更新时间 */
    lastUpdated: string;
}

/**
 * 搜索结果
 */
export interface SearchResult {
    title: string;
    url: string;
    snippet: string;
    source: string;
}

/**
 * 设计作品信息
 */
export interface DesignWork {
    id: string;
    title: string;
    url: string;
    thumbnailUrl?: string;
    author?: string;
    likes?: number;
    views?: number;
    tags: string[];
    platform: 'behance' | 'huaban' | 'zcool' | 'other';
    publishedAt?: string;
}

// ==================== 配置 ====================

interface TrendSensingConfig {
    /** 缓存有效期（毫秒） */
    cacheExpiry: number;
    /** 默认搜索引擎 */
    searchEngine: 'tavily' | 'duckduckgo' | 'bing';
    /** API Keys */
    apiKeys?: {
        tavily?: string;
        serpapi?: string;
    };
}

const DEFAULT_CONFIG: TrendSensingConfig = {
    cacheExpiry: 24 * 60 * 60 * 1000,  // 24小时
    searchEngine: 'duckduckgo'
};

// ==================== 服务类 ====================

export class TrendSensingService {
    private config: TrendSensingConfig;
    private cacheDir: string;
    private trendCache: TrendInsight | null = null;
    
    constructor(config?: Partial<TrendSensingConfig>) {
        this.config = { ...DEFAULT_CONFIG, ...config };
        this.cacheDir = path.join(app.getPath('userData'), 'trend-cache');
        
        // 确保缓存目录存在
        if (!fs.existsSync(this.cacheDir)) {
            fs.mkdirSync(this.cacheDir, { recursive: true });
        }
    }
    
    /**
     * 初始化服务
     */
    async initialize(): Promise<void> {
        // 加载缓存
        await this.loadCache();
        console.log('[TrendSensing] ✓ 初始化完成');
    }
    
    /**
     * 设置 API Key
     */
    setApiKey(provider: 'tavily' | 'serpapi', apiKey: string): void {
        if (!this.config.apiKeys) {
            this.config.apiKeys = {};
        }
        this.config.apiKeys[provider] = apiKey;
        
        // 如果设置了 Tavily，切换到 Tavily
        if (provider === 'tavily' && apiKey) {
            this.config.searchEngine = 'tavily';
        }
    }
    
    // ==================== 联网搜索 ====================
    
    /**
     * 搜索设计趋势
     */
    async searchDesignTrends(query: string): Promise<SearchResult[]> {
        switch (this.config.searchEngine) {
            case 'tavily':
                return this.searchWithTavily(query);
            case 'duckduckgo':
            default:
                return this.searchWithDuckDuckGo(query);
        }
    }
    
    /**
     * 使用 Tavily API 搜索
     * Tavily 提供免费额度，支持中文
     */
    private async searchWithTavily(query: string): Promise<SearchResult[]> {
        const apiKey = this.config.apiKeys?.tavily;
        if (!apiKey) {
            console.warn('[TrendSensing] Tavily API Key 未设置，降级到 DuckDuckGo');
            return this.searchWithDuckDuckGo(query);
        }
        
        try {
            const response = await fetch('https://api.tavily.com/search', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    api_key: apiKey,
                    query: query,
                    search_depth: 'basic',
                    include_answer: false,
                    max_results: 10
                })
            });
            
            if (!response.ok) {
                throw new Error(`Tavily API 错误: ${response.status}`);
            }
            
            const data = await response.json();
            
            return (data.results || []).map((r: any) => ({
                title: r.title,
                url: r.url,
                snippet: r.content || '',
                source: 'tavily'
            }));
        } catch (error: any) {
            console.error('[TrendSensing] Tavily 搜索失败:', error.message);
            return this.searchWithDuckDuckGo(query);
        }
    }
    
    /**
     * 使用 DuckDuckGo 搜索（免费，无需 API Key）
     */
    private async searchWithDuckDuckGo(query: string): Promise<SearchResult[]> {
        try {
            // DuckDuckGo Instant Answer API
            const encodedQuery = encodeURIComponent(query);
            const url = `https://api.duckduckgo.com/?q=${encodedQuery}&format=json&no_html=1&skip_disambig=1`;
            
            const response = await fetch(url);
            
            if (!response.ok) {
                throw new Error(`DuckDuckGo API 错误: ${response.status}`);
            }
            
            const data = await response.json();
            const results: SearchResult[] = [];
            
            // 主要结果
            if (data.AbstractText) {
                results.push({
                    title: data.Heading || query,
                    url: data.AbstractURL || '',
                    snippet: data.AbstractText,
                    source: 'duckduckgo'
                });
            }
            
            // 相关主题
            if (data.RelatedTopics) {
                for (const topic of data.RelatedTopics.slice(0, 5)) {
                    if (topic.Text && topic.FirstURL) {
                        results.push({
                            title: topic.Text.split(' - ')[0] || '',
                            url: topic.FirstURL,
                            snippet: topic.Text,
                            source: 'duckduckgo'
                        });
                    }
                }
            }
            
            return results;
        } catch (error: any) {
            console.error('[TrendSensing] DuckDuckGo 搜索失败:', error.message);
            return [];
        }
    }
    
    // ==================== 趋势分析 ====================
    
    /**
     * 获取当前设计趋势
     */
    async getCurrentTrends(forceRefresh: boolean = false): Promise<TrendInsight> {
        // 检查缓存
        if (!forceRefresh && this.trendCache) {
            const cacheAge = Date.now() - new Date(this.trendCache.lastUpdated).getTime();
            if (cacheAge < this.config.cacheExpiry) {
                return this.trendCache;
            }
        }
        
        // 搜索多个关键词获取趋势
        const queries = [
            '2026 电商设计趋势',
            '2026 UI设计流行风格',
            '电商详情页设计趋势',
            '主图设计最新风格',
            '配色趋势 2026'
        ];
        
        const allResults: SearchResult[] = [];
        for (const query of queries) {
            const results = await this.searchDesignTrends(query);
            allResults.push(...results);
            // 避免请求过快
            await new Promise(resolve => setTimeout(resolve, 500));
        }
        
        // 分析结果，提取趋势
        const trends = this.analyzeTrendResults(allResults);
        
        // 缓存结果
        this.trendCache = trends;
        await this.saveCache();
        
        return trends;
    }
    
    /**
     * 分析搜索结果，提取趋势信息
     */
    private analyzeTrendResults(results: SearchResult[]): TrendInsight {
        // 关键词频率统计
        const keywordFreq: Record<string, number> = {};
        
        for (const result of results) {
            const text = `${result.title} ${result.snippet}`.toLowerCase();
            
            // 常见设计趋势关键词
            const trendKeywords = [
                // 风格
                '极简', '简约', '扁平', '拟物', '新拟态', '玻璃拟态', '渐变',
                '3D', '动效', '微交互', '沉浸式', '暗黑模式', 'brutalism',
                // 配色
                '多巴胺', '克莱因蓝', '莫兰迪', '大地色', '撞色', '低饱和',
                // 排版
                '大字体', '不对称', '网格', '留白', '杂志风',
                // 技术
                '生成式', 'AI设计', '动态设计', '响应式'
            ];
            
            for (const keyword of trendKeywords) {
                if (text.includes(keyword)) {
                    keywordFreq[keyword] = (keywordFreq[keyword] || 0) + 1;
                }
            }
        }
        
        // 按频率排序
        const sortedKeywords = Object.entries(keywordFreq)
            .sort((a, b) => b[1] - a[1]);
        
        // 构建趋势信息
        const currentTrends: TrendInsight['currentTrends'] = {
            styles: [],
            colors: [],
            layouts: [],
            typography: []
        };
        
        // 分类趋势
        const styleKeywords = ['极简', '简约', '扁平', '新拟态', '玻璃拟态', '3D', '沉浸式', 'brutalism'];
        const colorKeywords = ['多巴胺', '克莱因蓝', '莫兰迪', '大地色', '撞色', '低饱和', '渐变'];
        const layoutKeywords = ['不对称', '网格', '留白', '杂志风'];
        const typographyKeywords = ['大字体'];
        
        for (const [keyword, freq] of sortedKeywords) {
            const trend: TrendInfo = {
                name: keyword,
                type: 'style',
                popularity: Math.min(100, freq * 20),
                lifecycle: freq > 3 ? 'peak' : freq > 1 ? 'growing' : 'emerging',
                description: `"${keyword}" 在搜索结果中出现 ${freq} 次`,
                keywords: [keyword],
                source: 'web_search',
                fetchedAt: new Date().toISOString()
            };
            
            if (styleKeywords.includes(keyword)) {
                trend.type = 'style';
                currentTrends.styles.push(trend);
            } else if (colorKeywords.includes(keyword)) {
                trend.type = 'color';
                currentTrends.colors.push(trend);
            } else if (layoutKeywords.includes(keyword)) {
                trend.type = 'layout';
                currentTrends.layouts.push(trend);
            } else if (typographyKeywords.includes(keyword)) {
                trend.type = 'typography';
                currentTrends.typography.push(trend);
            }
        }
        
        // 生成差异化建议
        const differentiationSuggestions = this.generateDifferentiationSuggestions(currentTrends);
        
        // 识别过时趋势（过于流行的可能即将过时）
        const avoidTrends = [...currentTrends.styles, ...currentTrends.colors]
            .filter(t => t.lifecycle === 'peak' && t.popularity > 60);
        
        // 识别新兴趋势
        const emergingTrends = [...currentTrends.styles, ...currentTrends.colors]
            .filter(t => t.lifecycle === 'emerging');
        
        return {
            currentTrends,
            differentiationSuggestions,
            avoidTrends,
            emergingTrends,
            lastUpdated: new Date().toISOString()
        };
    }
    
    /**
     * 生成差异化建议
     */
    private generateDifferentiationSuggestions(trends: TrendInsight['currentTrends']): string[] {
        const suggestions: string[] = [];
        
        // 基于当前趋势给出差异化建议
        const peakStyles = trends.styles.filter(t => t.lifecycle === 'peak');
        if (peakStyles.length > 0) {
            suggestions.push(
                `"${peakStyles[0].name}" 已达流行巅峰，考虑融合其他风格创造差异化`
            );
        }
        
        const emergingStyles = trends.styles.filter(t => t.lifecycle === 'emerging');
        if (emergingStyles.length > 0) {
            suggestions.push(
                `可以尝试新兴趋势 "${emergingStyles[0].name}"，领先市场`
            );
        }
        
        // 通用差异化建议
        suggestions.push(
            '避免完全跟随流行，保留 20-30% 的个性化元素',
            '结合行业特性，不盲目追求通用设计趋势',
            '关注目标用户群体的审美偏好，而非设计师圈子的流行'
        );
        
        return suggestions;
    }
    
    // ==================== 设计作品爬取 (使用 MCP 爬虫) ====================
    
    /**
     * 搜索设计作品
     * 使用 DesignCrawlerMCP 实现
     */
    async searchDesignWorks(params: {
        query: string;
        platform: 'behance' | 'huaban' | 'zcool' | 'all';
        limit?: number;
    }): Promise<DesignWork[]> {
        console.log('[TrendSensing] 搜索设计作品:', params.query);
        
        try {
            // 动态导入 MCP 爬虫服务
            const { getDesignCrawlerMCP } = await import('../mcp/design-crawler-mcp');
            const mcp = getDesignCrawlerMCP();
            
            const results = await mcp.searchDesigns({
                query: params.query,
                platform: params.platform,
                limit: params.limit || 20
            });
            
            // 转换为 DesignWork 格式
            const works: DesignWork[] = [];
            for (const result of results) {
                for (const work of result.works) {
                    works.push({
                        id: work.id,
                        title: work.title,
                        url: work.url,
                        thumbnailUrl: work.thumbnailUrl,
                        author: work.author.name,
                        likes: work.stats.likes,
                        views: work.stats.views,
                        tags: work.tags,
                        platform: work.platform as any,
                        publishedAt: work.publishedAt
                    });
                }
            }
            
            return works;
        } catch (error: any) {
            console.error('[TrendSensing] MCP 爬虫调用失败:', error.message);
            return [];
        }
    }
    
    /**
     * 获取热门设计作品
     */
    async getTrendingDesignWorks(params: {
        platform: 'behance' | 'huaban' | 'zcool' | 'all';
        category?: 'ecommerce' | 'ui' | 'illustration';
        limit?: number;
    }): Promise<DesignWork[]> {
        console.log('[TrendSensing] 获取热门作品:', params.platform);
        
        try {
            const { getDesignCrawlerMCP } = await import('../mcp/design-crawler-mcp');
            const mcp = getDesignCrawlerMCP();
            
            const works = await mcp.getTrendingDesigns({
                platform: params.platform,
                category: params.category,
                limit: params.limit || 20
            });
            
            return works.map(w => ({
                id: w.id,
                title: w.title,
                url: w.url,
                thumbnailUrl: w.thumbnailUrl,
                author: w.author.name,
                likes: w.stats.likes,
                views: w.stats.views,
                tags: w.tags,
                platform: w.platform as any,
                publishedAt: w.publishedAt
            }));
        } catch (error: any) {
            console.error('[TrendSensing] 获取热门失败:', error.message);
            return [];
        }
    }
    
    /**
     * 分析设计趋势（基于 MCP 爬取数据）
     */
    async analyzeDesignTrends(query: string): Promise<{
        topColors: string[];
        topStyles: string[];
        topTags: string[];
        avgPopularity: number;
    }> {
        try {
            const { getDesignCrawlerMCP } = await import('../mcp/design-crawler-mcp');
            const mcp = getDesignCrawlerMCP();
            
            const result = await mcp.fetchAndAnalyze({
                query,
                platforms: ['huaban', 'zcool', 'behance'],
                limit: 10
            });
            
            return {
                topColors: result.analysis.topColors.map(c => c.color),
                topStyles: result.analysis.topStyles.map(s => s.style),
                topTags: result.analysis.topTags.map(t => t.tag),
                avgPopularity: result.analysis.avgPopularity
            };
        } catch (error: any) {
            console.error('[TrendSensing] 趋势分析失败:', error.message);
            return { topColors: [], topStyles: [], topTags: [], avgPopularity: 0 };
        }
    }
    
    // ==================== 过时检测 ====================
    
    /**
     * 检测设计是否过时
     */
    async checkIfOutdated(designFeatures: {
        style?: string;
        colors?: string[];
        layout?: string;
    }): Promise<{
        isOutdated: boolean;
        reasons: string[];
        suggestions: string[];
    }> {
        const trends = await this.getCurrentTrends();
        const reasons: string[] = [];
        const suggestions: string[] = [];
        let outdatedScore = 0;
        
        // 检查风格
        if (designFeatures.style) {
            const styleTrend = trends.currentTrends.styles.find(
                t => designFeatures.style?.includes(t.name)
            );
            
            if (styleTrend?.lifecycle === 'declining' || styleTrend?.lifecycle === 'outdated') {
                outdatedScore += 30;
                reasons.push(`"${styleTrend.name}" 风格正在衰退`);
                suggestions.push(`考虑融入新兴趋势如 "${trends.emergingTrends[0]?.name || '极简'}"`);
            }
        }
        
        // 在避免列表中
        for (const avoidTrend of trends.avoidTrends) {
            if (designFeatures.style?.includes(avoidTrend.name)) {
                outdatedScore += 20;
                reasons.push(`"${avoidTrend.name}" 已过度流行，即将过时`);
            }
        }
        
        return {
            isOutdated: outdatedScore >= 30,
            reasons,
            suggestions: suggestions.length > 0 ? suggestions : trends.differentiationSuggestions.slice(0, 2)
        };
    }
    
    // ==================== 缓存管理 ====================
    
    /**
     * 加载缓存
     */
    private async loadCache(): Promise<void> {
        const cacheFile = path.join(this.cacheDir, 'trends.json');
        
        if (fs.existsSync(cacheFile)) {
            try {
                const content = fs.readFileSync(cacheFile, 'utf-8');
                this.trendCache = JSON.parse(content);
                console.log('[TrendSensing] 已加载趋势缓存');
            } catch (error) {
                console.warn('[TrendSensing] 缓存加载失败');
            }
        }
    }
    
    /**
     * 保存缓存
     */
    private async saveCache(): Promise<void> {
        if (!this.trendCache) return;
        
        const cacheFile = path.join(this.cacheDir, 'trends.json');
        fs.writeFileSync(cacheFile, JSON.stringify(this.trendCache, null, 2), 'utf-8');
    }
    
    /**
     * 清除缓存
     */
    clearCache(): void {
        this.trendCache = null;
        const cacheFile = path.join(this.cacheDir, 'trends.json');
        if (fs.existsSync(cacheFile)) {
            fs.unlinkSync(cacheFile);
        }
    }
}

// ==================== 单例导出 ====================

let instance: TrendSensingService | null = null;

export function getTrendSensingService(): TrendSensingService {
    if (!instance) {
        instance = new TrendSensingService();
    }
    return instance;
}

export default TrendSensingService;
