/**
 * 素材库服务
 * 
 * 功能：
 * 1. 扫描用户指定的素材文件夹
 * 2. 获取所有图片的缩略图和元信息
 * 3. 使用视觉模型理解每张图片的内容
 * 4. 提供搜索和筛选能力
 * 5. 支持智能推荐素材
 */

import * as fs from 'fs';
import * as path from 'path';
import sharp from 'sharp';

/**
 * 素材信息
 */
export interface AssetInfo {
    id: string;                    // 唯一标识（基于路径生成）
    filename: string;              // 文件名
    path: string;                  // 完整路径
    relativePath: string;          // 相对于素材根目录的路径
    type: 'image' | 'vector' | 'psd' | 'other';
    format: string;                // jpg, png, svg, psd 等
    size: number;                  // 文件大小（字节）
    dimensions?: {
        width: number;
        height: number;
    };
    thumbnail?: string;            // 缩略图 base64
    
    // AI 分析结果（可选，需要调用分析）
    analysis?: {
        description: string;       // 图片描述
        category: string;          // 分类：产品图、背景、人物、装饰等
        tags: string[];            // 标签
        colors: string[];          // 主要颜色
        style: string;             // 风格：简约、复杂、卡通等
        suggestedUse: string[];    // 建议用途
    };
    
    // 元数据
    createdAt: Date;
    modifiedAt: Date;
}

/**
 * 素材库配置
 */
export interface AssetLibraryConfig {
    rootPath: string;              // 素材根目录
    includeSubfolders: boolean;    // 是否包含子文件夹
    supportedFormats: string[];    // 支持的格式
    thumbnailSize: number;         // 缩略图尺寸
    autoAnalyze: boolean;          // 是否自动分析图片内容
}

/**
 * 默认配置
 */
const DEFAULT_CONFIG: AssetLibraryConfig = {
    rootPath: '',
    includeSubfolders: true,
    supportedFormats: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'psd', 'ai', 'eps'],
    thumbnailSize: 200,
    autoAnalyze: false
};

/**
 * 素材库服务
 */
export class AssetLibraryService {
    private config: AssetLibraryConfig;
    private assetsCache: Map<string, AssetInfo> = new Map();
    private lastScanTime: Date | null = null;
    
    constructor(config?: Partial<AssetLibraryConfig>) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }
    
    /**
     * 设置素材根目录
     */
    setRootPath(rootPath: string): void {
        this.config.rootPath = rootPath;
        this.assetsCache.clear();
        this.lastScanTime = null;
        console.log(`[AssetLibrary] 素材根目录设置为: ${rootPath}`);
    }
    
    /**
     * 获取当前配置
     */
    getConfig(): AssetLibraryConfig {
        return { ...this.config };
    }
    
    /**
     * 扫描素材目录
     */
    async scanAssets(forceRescan: boolean = false): Promise<AssetInfo[]> {
        if (!this.config.rootPath) {
            throw new Error('请先设置素材文件夹路径');
        }
        
        if (!fs.existsSync(this.config.rootPath)) {
            throw new Error(`素材文件夹不存在: ${this.config.rootPath}`);
        }
        
        // 如果有缓存且不强制刷新，返回缓存
        if (!forceRescan && this.assetsCache.size > 0 && this.lastScanTime) {
            const cacheAge = Date.now() - this.lastScanTime.getTime();
            if (cacheAge < 5 * 60 * 1000) {  // 5分钟内的缓存有效
                return Array.from(this.assetsCache.values());
            }
        }
        
        console.log(`[AssetLibrary] 开始扫描素材目录: ${this.config.rootPath}`);
        const startTime = Date.now();
        
        const assets: AssetInfo[] = [];
        await this.scanDirectory(this.config.rootPath, '', assets);
        
        // 更新缓存
        this.assetsCache.clear();
        for (const asset of assets) {
            this.assetsCache.set(asset.id, asset);
        }
        this.lastScanTime = new Date();
        
        console.log(`[AssetLibrary] 扫描完成，找到 ${assets.length} 个素材，耗时 ${Date.now() - startTime}ms`);
        
        return assets;
    }
    
    /**
     * 递归扫描目录
     */
    private async scanDirectory(dirPath: string, relativePath: string, assets: AssetInfo[]): Promise<void> {
        const entries = fs.readdirSync(dirPath, { withFileTypes: true });
        
        for (const entry of entries) {
            const fullPath = path.join(dirPath, entry.name);
            const relPath = relativePath ? path.join(relativePath, entry.name) : entry.name;
            
            if (entry.isDirectory()) {
                if (this.config.includeSubfolders) {
                    await this.scanDirectory(fullPath, relPath, assets);
                }
            } else if (entry.isFile()) {
                const ext = path.extname(entry.name).toLowerCase().slice(1);
                if (this.config.supportedFormats.includes(ext)) {
                    try {
                        const asset = await this.createAssetInfo(fullPath, relPath);
                        assets.push(asset);
                    } catch (error) {
                        console.warn(`[AssetLibrary] 无法处理文件: ${fullPath}`, error);
                    }
                }
            }
        }
    }
    
    /**
     * 创建素材信息
     */
    private async createAssetInfo(fullPath: string, relativePath: string): Promise<AssetInfo> {
        const stats = fs.statSync(fullPath);
        const ext = path.extname(fullPath).toLowerCase().slice(1);
        const filename = path.basename(fullPath);
        
        // 生成唯一 ID
        const id = Buffer.from(relativePath).toString('base64').replace(/[+/=]/g, '_');
        
        // 确定文件类型
        let type: AssetInfo['type'] = 'other';
        if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)) {
            type = 'image';
        } else if (['svg', 'ai', 'eps'].includes(ext)) {
            type = 'vector';
        } else if (ext === 'psd') {
            type = 'psd';
        }
        
        const asset: AssetInfo = {
            id,
            filename,
            path: fullPath,
            relativePath,
            type,
            format: ext,
            size: stats.size,
            createdAt: stats.birthtime,
            modifiedAt: stats.mtime
        };
        
        // 获取图片尺寸和缩略图
        if (type === 'image') {
            try {
                const metadata = await sharp(fullPath).metadata();
                asset.dimensions = {
                    width: metadata.width || 0,
                    height: metadata.height || 0
                };
                
                // 生成缩略图
                const thumbnailBuffer = await sharp(fullPath)
                    .resize(this.config.thumbnailSize, this.config.thumbnailSize, { 
                        fit: 'inside',
                        withoutEnlargement: true 
                    })
                    .jpeg({ quality: 80 })
                    .toBuffer();
                
                asset.thumbnail = `data:image/jpeg;base64,${thumbnailBuffer.toString('base64')}`;
            } catch (error) {
                console.warn(`[AssetLibrary] 无法获取图片信息: ${fullPath}`);
            }
        }
        
        return asset;
    }
    
    /**
     * 获取单个素材详情
     */
    async getAsset(assetId: string): Promise<AssetInfo | null> {
        // 先从缓存获取
        if (this.assetsCache.has(assetId)) {
            return this.assetsCache.get(assetId) || null;
        }
        
        // 扫描后再获取
        await this.scanAssets();
        return this.assetsCache.get(assetId) || null;
    }
    
    /**
     * 根据路径获取素材
     */
    async getAssetByPath(relativePath: string): Promise<AssetInfo | null> {
        const fullPath = path.join(this.config.rootPath, relativePath);
        if (!fs.existsSync(fullPath)) {
            return null;
        }
        
        const id = Buffer.from(relativePath).toString('base64').replace(/[+/=]/g, '_');
        return this.getAsset(id);
    }
    
    /**
     * 获取素材的完整图片（Base64）
     */
    async getAssetImage(assetId: string, maxSize?: number): Promise<string | null> {
        const asset = await this.getAsset(assetId);
        if (!asset || asset.type !== 'image') {
            return null;
        }
        
        try {
            let image = sharp(asset.path);
            
            if (maxSize) {
                image = image.resize(maxSize, maxSize, { 
                    fit: 'inside',
                    withoutEnlargement: true 
                });
            }
            
            const buffer = await image.jpeg({ quality: 90 }).toBuffer();
            return `data:image/jpeg;base64,${buffer.toString('base64')}`;
        } catch (error) {
            console.error(`[AssetLibrary] 无法读取图片: ${asset.path}`, error);
            return null;
        }
    }
    
    /**
     * 搜索素材
     */
    async searchAssets(query: string, options?: {
        category?: string;
        tags?: string[];
        type?: AssetInfo['type'];
    }): Promise<AssetInfo[]> {
        await this.scanAssets();
        
        const queryLower = query.toLowerCase();
        let results = Array.from(this.assetsCache.values());
        
        // 按文件名搜索
        if (query) {
            results = results.filter(asset => {
                // 文件名匹配
                if (asset.filename.toLowerCase().includes(queryLower)) return true;
                // 路径匹配
                if (asset.relativePath.toLowerCase().includes(queryLower)) return true;
                // 分析结果匹配（如果有）
                if (asset.analysis) {
                    if (asset.analysis.description.toLowerCase().includes(queryLower)) return true;
                    if (asset.analysis.tags.some(tag => tag.toLowerCase().includes(queryLower))) return true;
                    if (asset.analysis.category.toLowerCase().includes(queryLower)) return true;
                }
                return false;
            });
        }
        
        // 按类型筛选
        if (options?.type) {
            results = results.filter(asset => asset.type === options.type);
        }
        
        // 按分类筛选（需要先分析）
        if (options?.category) {
            results = results.filter(asset => 
                asset.analysis?.category.toLowerCase() === options.category?.toLowerCase()
            );
        }
        
        // 按标签筛选（需要先分析）
        if (options?.tags && options.tags.length > 0) {
            results = results.filter(asset =>
                asset.analysis?.tags.some(tag => 
                    options.tags!.some(t => tag.toLowerCase().includes(t.toLowerCase()))
                )
            );
        }
        
        return results;
    }
    
    /**
     * 获取目录结构
     */
    async getDirectoryStructure(): Promise<{
        name: string;
        path: string;
        children: any[];
        assetCount: number;
    }> {
        if (!this.config.rootPath || !fs.existsSync(this.config.rootPath)) {
            throw new Error('素材文件夹未设置或不存在');
        }
        
        return this.buildDirectoryTree(this.config.rootPath, '');
    }
    
    private buildDirectoryTree(dirPath: string, relativePath: string): any {
        const name = path.basename(dirPath) || '素材库';
        const result: any = {
            name,
            path: relativePath,
            children: [],
            assetCount: 0
        };
        
        const entries = fs.readdirSync(dirPath, { withFileTypes: true });
        
        for (const entry of entries) {
            const fullPath = path.join(dirPath, entry.name);
            const relPath = relativePath ? path.join(relativePath, entry.name) : entry.name;
            
            if (entry.isDirectory()) {
                const child = this.buildDirectoryTree(fullPath, relPath);
                result.children.push(child);
                result.assetCount += child.assetCount;
            } else if (entry.isFile()) {
                const ext = path.extname(entry.name).toLowerCase().slice(1);
                if (this.config.supportedFormats.includes(ext)) {
                    result.assetCount++;
                }
            }
        }
        
        return result;
    }
    
    /**
     * 分析素材内容（使用视觉模型）
     */
    async analyzeAsset(assetId: string, visionModelCall: (imageBase64: string, prompt: string) => Promise<string>): Promise<AssetInfo['analysis'] | null> {
        const asset = await this.getAsset(assetId);
        if (!asset || asset.type !== 'image') {
            return null;
        }
        
        // 获取图片用于分析
        const imageBase64 = await this.getAssetImage(assetId, 512);
        if (!imageBase64) {
            return null;
        }
        
        const prompt = `分析这张图片，用于设计素材库分类。请用 JSON 格式返回：
{
    "description": "图片内容的简短描述（20字以内）",
    "category": "分类（产品图/背景/人物/装饰元素/图标/文字/场景/其他）",
    "tags": ["标签1", "标签2", "标签3"],
    "colors": ["#主色1", "#主色2"],
    "style": "风格（简约/复杂/卡通/写实/抽象）",
    "suggestedUse": ["建议用途1", "建议用途2"]
}

只返回 JSON，不要其他文字。`;

        try {
            const response = await visionModelCall(imageBase64, prompt);
            const jsonMatch = response.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                const analysis = JSON.parse(jsonMatch[0]);
                asset.analysis = analysis;
                return analysis;
            }
        } catch (error) {
            console.error(`[AssetLibrary] 分析素材失败: ${assetId}`, error);
        }
        
        return null;
    }
    
    /**
     * 批量分析素材
     */
    async analyzeAllAssets(
        visionModelCall: (imageBase64: string, prompt: string) => Promise<string>,
        progressCallback?: (current: number, total: number) => void
    ): Promise<{ analyzed: number; failed: number }> {
        const assets = await this.scanAssets();
        const imageAssets = assets.filter(a => a.type === 'image' && !a.analysis);
        
        let analyzed = 0;
        let failed = 0;
        
        for (let i = 0; i < imageAssets.length; i++) {
            const asset = imageAssets[i];
            try {
                await this.analyzeAsset(asset.id, visionModelCall);
                analyzed++;
            } catch (error) {
                failed++;
            }
            
            if (progressCallback) {
                progressCallback(i + 1, imageAssets.length);
            }
        }
        
        return { analyzed, failed };
    }
    
    /**
     * 根据设计需求推荐素材
     */
    async recommendAssets(
        requirement: string,
        visionModelCall: (imageBase64: string, prompt: string) => Promise<string>,
        maxResults: number = 5
    ): Promise<Array<AssetInfo & { matchReason: string; matchScore: number }>> {
        // 先扫描所有素材
        const allAssets = await this.scanAssets();
        const imageAssets = allAssets.filter(a => a.type === 'image');
        
        // 如果素材太多，先用文件名/路径简单筛选
        let candidates = imageAssets;
        const keywords = requirement.toLowerCase().split(/\s+/);
        
        candidates = candidates.filter(asset => {
            const searchText = `${asset.filename} ${asset.relativePath} ${asset.analysis?.description || ''} ${asset.analysis?.tags?.join(' ') || ''}`.toLowerCase();
            return keywords.some(kw => searchText.includes(kw));
        });
        
        // 如果筛选后没有结果，取前 20 个
        if (candidates.length === 0) {
            candidates = imageAssets.slice(0, 20);
        }
        
        // 用视觉模型评估匹配度
        const results: Array<AssetInfo & { matchReason: string; matchScore: number }> = [];
        
        for (const asset of candidates.slice(0, 10)) {  // 最多评估 10 个
            const imageBase64 = await this.getAssetImage(asset.id, 256);
            if (!imageBase64) continue;
            
            const prompt = `设计需求：${requirement}

请评估这张图片是否适合用于这个设计需求。用 JSON 返回：
{
    "score": 0-100的匹配分数,
    "reason": "为什么适合或不适合（一句话）"
}

只返回 JSON。`;

            try {
                const response = await visionModelCall(imageBase64, prompt);
                const jsonMatch = response.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                    const evaluation = JSON.parse(jsonMatch[0]);
                    results.push({
                        ...asset,
                        matchReason: evaluation.reason,
                        matchScore: evaluation.score
                    });
                }
            } catch (error) {
                console.warn(`[AssetLibrary] 评估素材失败: ${asset.id}`);
            }
        }
        
        // 按分数排序
        results.sort((a, b) => b.matchScore - a.matchScore);
        
        return results.slice(0, maxResults);
    }
    
    /**
     * 获取素材统计信息
     */
    async getStatistics(): Promise<{
        totalAssets: number;
        byType: Record<string, number>;
        byFormat: Record<string, number>;
        analyzedCount: number;
        totalSize: number;
    }> {
        const assets = await this.scanAssets();
        
        const byType: Record<string, number> = {};
        const byFormat: Record<string, number> = {};
        let analyzedCount = 0;
        let totalSize = 0;
        
        for (const asset of assets) {
            byType[asset.type] = (byType[asset.type] || 0) + 1;
            byFormat[asset.format] = (byFormat[asset.format] || 0) + 1;
            if (asset.analysis) analyzedCount++;
            totalSize += asset.size;
        }
        
        return {
            totalAssets: assets.length,
            byType,
            byFormat,
            analyzedCount,
            totalSize
        };
    }
}

// 导出单例
export const assetLibraryService = new AssetLibraryService();
