/**
 * 产品库智能扫描服务
 * 
 * 核心职责：
 * 1. 扫描用户产品图片文件夹
 * 2. 自动识别和标注产品内容
 * 3. 建立卖点与图片的关联
 * 4. 支持 CSV 导入产品信息
 * 
 * 设计理念：
 * - 零配置快速启动（文件夹扫描 + 自动标注）
 * - 渐进式丰富（用户可补充信息，系统自动学习）
 * - 与审美知识库联动
 */

import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { ProductAssetKnowledge, DesignType } from './types';
import { AssetLibraryService, AssetInfo } from '../asset-library-service';

// ==================== 类型定义 ====================

/**
 * 产品条目
 */
export interface ProductEntry {
    id: string;
    
    /** 产品名称 */
    name: string;
    
    /** SKU 编号（可选） */
    sku?: string;
    
    /** 卖点列表 */
    sellingPoints: string[];
    
    /** 关键词 */
    keywords: string[];
    
    /** 分类 */
    category?: string;
    
    /** 关联的图片 */
    images: {
        assetId: string;
        type: 'main' | 'detail' | 'sku' | 'scene' | 'other';
        isPrimary: boolean;
    }[];
    
    /** 自动识别的标签 */
    autoTags?: string[];
    
    /** 创建时间 */
    createdAt: string;
    
    /** 更新时间 */
    updatedAt: string;
}

/**
 * 产品库
 */
export interface ProductLibrary {
    id: string;
    name: string;
    description?: string;
    
    /** 关联的素材根目录 */
    assetRootPath: string;
    
    /** 产品列表 */
    products: ProductEntry[];
    
    /** 全局卖点库（所有产品共享） */
    globalSellingPoints: string[];
    
    /** 全局关键词库 */
    globalKeywords: string[];
    
    createdAt: string;
    updatedAt: string;
}

/**
 * CSV 导入格式
 */
export interface ProductCSVRow {
    name: string;
    sku?: string;
    sellingPoints: string;  // 逗号分隔
    keywords?: string;      // 逗号分隔
    category?: string;
    imagePaths?: string;    // 逗号分隔的相对路径
}

// ==================== 服务类 ====================

export class ProductLibraryService {
    private dataDir: string;
    private libraries: Map<string, ProductLibrary> = new Map();
    private assetLibraryService: AssetLibraryService;
    
    constructor() {
        this.dataDir = path.join(app.getPath('userData'), 'product-libraries');
        this.assetLibraryService = new AssetLibraryService();
    }
    
    /**
     * 初始化服务
     */
    async initialize(): Promise<void> {
        try {
            if (!fs.existsSync(this.dataDir)) {
                fs.mkdirSync(this.dataDir, { recursive: true });
            }
            
            await this.loadAllLibraries();
            console.log(`[ProductLibrary] ✓ 初始化完成，已加载 ${this.libraries.size} 个产品库`);
        } catch (error: any) {
            console.error('[ProductLibrary] 初始化失败:', error.message);
        }
    }
    
    /**
     * 加载所有产品库
     */
    private async loadAllLibraries(): Promise<void> {
        const files = fs.readdirSync(this.dataDir).filter(f => f.endsWith('.json'));
        
        for (const file of files) {
            try {
                const content = fs.readFileSync(path.join(this.dataDir, file), 'utf-8');
                const library = JSON.parse(content) as ProductLibrary;
                this.libraries.set(library.id, library);
            } catch (error: any) {
                console.warn(`[ProductLibrary] 加载失败: ${file}`, error.message);
            }
        }
    }
    
    /**
     * 保存产品库
     */
    private async saveLibrary(library: ProductLibrary): Promise<void> {
        const filePath = path.join(this.dataDir, `${library.id}.json`);
        fs.writeFileSync(filePath, JSON.stringify(library, null, 2), 'utf-8');
    }
    
    /**
     * 生成唯一 ID
     */
    private generateId(): string {
        return `lib-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }
    
    // ==================== 产品库管理 ====================
    
    /**
     * 创建产品库
     */
    async createLibrary(name: string, assetRootPath: string, description?: string): Promise<ProductLibrary> {
        const now = new Date().toISOString();
        
        const library: ProductLibrary = {
            id: this.generateId(),
            name,
            description,
            assetRootPath,
            products: [],
            globalSellingPoints: [],
            globalKeywords: [],
            createdAt: now,
            updatedAt: now
        };
        
        this.libraries.set(library.id, library);
        await this.saveLibrary(library);
        
        console.log(`[ProductLibrary] 创建产品库: ${name}`);
        return library;
    }
    
    /**
     * 获取产品库
     */
    getLibrary(id: string): ProductLibrary | undefined {
        return this.libraries.get(id);
    }
    
    /**
     * 获取所有产品库
     */
    getAllLibraries(): ProductLibrary[] {
        return Array.from(this.libraries.values());
    }
    
    /**
     * 删除产品库
     */
    async deleteLibrary(id: string): Promise<boolean> {
        const library = this.libraries.get(id);
        if (!library) return false;
        
        this.libraries.delete(id);
        
        const filePath = path.join(this.dataDir, `${id}.json`);
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }
        
        return true;
    }
    
    // ==================== 智能扫描 ====================
    
    /**
     * 扫描文件夹并自动创建产品库
     */
    async scanAndCreateLibrary(
        folderPath: string,
        libraryName: string,
        options?: {
            autoAnalyze?: boolean;
            visionModelCall?: (imageBase64: string, prompt: string) => Promise<string>;
            progressCallback?: (current: number, total: number, message: string) => void;
        }
    ): Promise<ProductLibrary> {
        // 1. 创建产品库
        const library = await this.createLibrary(libraryName, folderPath);
        
        // 2. 配置素材库服务
        this.assetLibraryService.setRootPath(folderPath);
        
        // 3. 扫描素材
        options?.progressCallback?.(0, 100, '扫描文件夹...');
        const assets = await this.assetLibraryService.scanAssets(true);
        
        console.log(`[ProductLibrary] 扫描到 ${assets.length} 个素材`);
        
        // 4. 如果启用自动分析
        if (options?.autoAnalyze && options?.visionModelCall) {
            options?.progressCallback?.(10, 100, '分析图片内容...');
            
            const imageAssets = assets.filter(a => a.type === 'image');
            let analyzed = 0;
            
            for (const asset of imageAssets) {
                try {
                    await this.assetLibraryService.analyzeAsset(asset.id, options.visionModelCall);
                    analyzed++;
                    options?.progressCallback?.(
                        10 + Math.round((analyzed / imageAssets.length) * 60),
                        100,
                        `分析图片 ${analyzed}/${imageAssets.length}`
                    );
                } catch (error) {
                    // 继续处理下一个
                }
            }
        }
        
        // 5. 智能分组：根据文件夹结构或文件名模式创建产品
        options?.progressCallback?.(70, 100, '智能分组产品...');
        await this.autoGroupProducts(library, assets);
        
        // 6. 保存
        options?.progressCallback?.(90, 100, '保存产品库...');
        await this.saveLibrary(library);
        
        options?.progressCallback?.(100, 100, '完成');
        
        return library;
    }
    
    /**
     * 智能分组：根据文件夹结构或命名规则自动分组产品
     */
    private async autoGroupProducts(library: ProductLibrary, assets: AssetInfo[]): Promise<void> {
        // 策略 1：按一级子文件夹分组
        const folderGroups = new Map<string, AssetInfo[]>();
        
        for (const asset of assets) {
            // 获取一级子文件夹名
            const parts = asset.relativePath.split(path.sep);
            const groupName = parts.length > 1 ? parts[0] : '未分组';
            
            if (!folderGroups.has(groupName)) {
                folderGroups.set(groupName, []);
            }
            folderGroups.get(groupName)!.push(asset);
        }
        
        // 为每个分组创建产品
        for (const [groupName, groupAssets] of folderGroups) {
            const product = this.createProductFromAssets(groupName, groupAssets);
            library.products.push(product);
            
            // 收集全局关键词
            for (const tag of product.autoTags || []) {
                if (!library.globalKeywords.includes(tag)) {
                    library.globalKeywords.push(tag);
                }
            }
        }
        
        library.updatedAt = new Date().toISOString();
    }
    
    /**
     * 从素材创建产品条目
     */
    private createProductFromAssets(name: string, assets: AssetInfo[]): ProductEntry {
        const now = new Date().toISOString();
        
        // 收集所有自动标签
        const allTags: string[] = [];
        for (const asset of assets) {
            if (asset.analysis?.tags) {
                allTags.push(...asset.analysis.tags);
            }
        }
        const uniqueTags = [...new Set(allTags)];
        
        // 推断图片类型
        const images = assets.map((asset, index) => ({
            assetId: asset.id,
            type: this.inferImageType(asset),
            isPrimary: index === 0
        }));
        
        return {
            id: this.generateId(),
            name,
            sellingPoints: [],
            keywords: uniqueTags.slice(0, 10),  // 取前 10 个标签作为关键词
            images,
            autoTags: uniqueTags,
            createdAt: now,
            updatedAt: now
        };
    }
    
    /**
     * 推断图片类型
     */
    private inferImageType(asset: AssetInfo): ProductEntry['images'][0]['type'] {
        const lowerPath = asset.relativePath.toLowerCase();
        const lowerName = asset.filename.toLowerCase();
        
        if (lowerPath.includes('main') || lowerPath.includes('主图') || lowerName.includes('main')) {
            return 'main';
        }
        if (lowerPath.includes('detail') || lowerPath.includes('详情') || lowerName.includes('detail')) {
            return 'detail';
        }
        if (lowerPath.includes('sku') || lowerName.includes('sku')) {
            return 'sku';
        }
        if (lowerPath.includes('scene') || lowerPath.includes('场景')) {
            return 'scene';
        }
        
        return 'other';
    }
    
    // ==================== CSV 导入 ====================
    
    /**
     * 从 CSV 导入产品信息
     */
    async importFromCSV(
        libraryId: string,
        csvContent: string
    ): Promise<{ imported: number; skipped: number; errors: string[] }> {
        const library = this.libraries.get(libraryId);
        if (!library) {
            return { imported: 0, skipped: 0, errors: ['产品库不存在'] };
        }
        
        const result = { imported: 0, skipped: 0, errors: [] as string[] };
        
        const lines = csvContent.split('\n').map(l => l.trim()).filter(l => l);
        if (lines.length < 2) {
            return { imported: 0, skipped: 0, errors: ['CSV 内容为空或格式错误'] };
        }
        
        // 解析表头
        const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
        const nameIndex = headers.findIndex(h => h === 'name' || h === '产品名称' || h === '名称');
        
        if (nameIndex < 0) {
            return { imported: 0, skipped: 0, errors: ['CSV 必须包含 name 或 产品名称 列'] };
        }
        
        // 解析数据行
        for (let i = 1; i < lines.length; i++) {
            const values = this.parseCSVLine(lines[i]);
            
            if (values.length <= nameIndex || !values[nameIndex]) {
                result.skipped++;
                continue;
            }
            
            const product: ProductEntry = {
                id: this.generateId(),
                name: values[nameIndex],
                sellingPoints: [],
                keywords: [],
                images: [],
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };
            
            // 解析可选字段
            const skuIndex = headers.findIndex(h => h === 'sku' || h === '编号');
            if (skuIndex >= 0 && values[skuIndex]) {
                product.sku = values[skuIndex];
            }
            
            const sellingPointsIndex = headers.findIndex(h => h === 'sellingpoints' || h === '卖点');
            if (sellingPointsIndex >= 0 && values[sellingPointsIndex]) {
                product.sellingPoints = values[sellingPointsIndex].split(/[,，]/).map(s => s.trim()).filter(s => s);
            }
            
            const keywordsIndex = headers.findIndex(h => h === 'keywords' || h === '关键词');
            if (keywordsIndex >= 0 && values[keywordsIndex]) {
                product.keywords = values[keywordsIndex].split(/[,，]/).map(s => s.trim()).filter(s => s);
            }
            
            const categoryIndex = headers.findIndex(h => h === 'category' || h === '分类');
            if (categoryIndex >= 0 && values[categoryIndex]) {
                product.category = values[categoryIndex];
            }
            
            library.products.push(product);
            result.imported++;
            
            // 更新全局列表
            for (const sp of product.sellingPoints) {
                if (!library.globalSellingPoints.includes(sp)) {
                    library.globalSellingPoints.push(sp);
                }
            }
            for (const kw of product.keywords) {
                if (!library.globalKeywords.includes(kw)) {
                    library.globalKeywords.push(kw);
                }
            }
        }
        
        library.updatedAt = new Date().toISOString();
        await this.saveLibrary(library);
        
        return result;
    }
    
    /**
     * 解析 CSV 行（处理引号内的逗号）
     */
    private parseCSVLine(line: string): string[] {
        const result: string[] = [];
        let current = '';
        let inQuotes = false;
        
        for (const char of line) {
            if (char === '"') {
                inQuotes = !inQuotes;
            } else if (char === ',' && !inQuotes) {
                result.push(current.trim());
                current = '';
            } else {
                current += char;
            }
        }
        result.push(current.trim());
        
        return result;
    }
    
    // ==================== 智能搜索 ====================
    
    /**
     * 根据卖点搜索相关产品图片
     */
    async searchBySellingPoint(
        libraryId: string,
        sellingPoint: string
    ): Promise<{ product: ProductEntry; images: AssetInfo[] }[]> {
        const library = this.libraries.get(libraryId);
        if (!library) return [];
        
        const results: { product: ProductEntry; images: AssetInfo[] }[] = [];
        const query = sellingPoint.toLowerCase();
        
        for (const product of library.products) {
            // 匹配卖点
            const matchesSP = product.sellingPoints.some(
                sp => sp.toLowerCase().includes(query)
            );
            
            // 匹配关键词
            const matchesKW = product.keywords.some(
                kw => kw.toLowerCase().includes(query)
            );
            
            // 匹配自动标签
            const matchesTags = product.autoTags?.some(
                tag => tag.toLowerCase().includes(query)
            );
            
            if (matchesSP || matchesKW || matchesTags) {
                // 获取关联的图片
                const images: AssetInfo[] = [];
                for (const img of product.images) {
                    const asset = await this.assetLibraryService.getAsset(img.assetId);
                    if (asset) {
                        images.push(asset);
                    }
                }
                
                results.push({ product, images });
            }
        }
        
        return results;
    }
    
    /**
     * 根据设计类型推荐产品图片
     */
    async recommendForDesignType(
        libraryId: string,
        designType: DesignType,
        sellingPoints?: string[]
    ): Promise<AssetInfo[]> {
        const library = this.libraries.get(libraryId);
        if (!library) return [];
        
        const candidates: AssetInfo[] = [];
        
        // 根据设计类型筛选图片类型
        let preferredTypes: ProductEntry['images'][0]['type'][] = [];
        switch (designType) {
            case 'mainImage':
                preferredTypes = ['main'];
                break;
            case 'detailHero':
            case 'detailSection':
                preferredTypes = ['main', 'detail', 'scene'];
                break;
            case 'skuImage':
                preferredTypes = ['sku', 'main'];
                break;
            default:
                preferredTypes = ['main', 'detail'];
        }
        
        for (const product of library.products) {
            // 如果有卖点要求，先筛选产品
            if (sellingPoints && sellingPoints.length > 0) {
                const hasMatchingSP = sellingPoints.some(sp =>
                    product.sellingPoints.some(psp => 
                        psp.toLowerCase().includes(sp.toLowerCase())
                    ) ||
                    product.keywords.some(kw =>
                        kw.toLowerCase().includes(sp.toLowerCase())
                    )
                );
                
                if (!hasMatchingSP) continue;
            }
            
            // 获取匹配类型的图片
            for (const img of product.images) {
                if (preferredTypes.includes(img.type)) {
                    const asset = await this.assetLibraryService.getAsset(img.assetId);
                    if (asset) {
                        candidates.push(asset);
                    }
                }
            }
        }
        
        // 优先返回 primary 图片
        candidates.sort((a, b) => {
            // 这里可以添加更复杂的排序逻辑
            return 0;
        });
        
        return candidates;
    }
    
    // ==================== 产品管理 ====================
    
    /**
     * 添加产品
     */
    async addProduct(libraryId: string, product: Omit<ProductEntry, 'id' | 'createdAt' | 'updatedAt'>): Promise<ProductEntry> {
        const library = this.libraries.get(libraryId);
        if (!library) throw new Error('产品库不存在');
        
        const now = new Date().toISOString();
        const newProduct: ProductEntry = {
            ...product,
            id: this.generateId(),
            createdAt: now,
            updatedAt: now
        };
        
        library.products.push(newProduct);
        library.updatedAt = now;
        
        await this.saveLibrary(library);
        return newProduct;
    }
    
    /**
     * 更新产品
     */
    async updateProduct(libraryId: string, productId: string, updates: Partial<ProductEntry>): Promise<ProductEntry | null> {
        const library = this.libraries.get(libraryId);
        if (!library) return null;
        
        const index = library.products.findIndex(p => p.id === productId);
        if (index < 0) return null;
        
        library.products[index] = {
            ...library.products[index],
            ...updates,
            id: productId,  // 保持 ID 不变
            updatedAt: new Date().toISOString()
        };
        
        library.updatedAt = new Date().toISOString();
        await this.saveLibrary(library);
        
        return library.products[index];
    }
    
    /**
     * 删除产品
     */
    async deleteProduct(libraryId: string, productId: string): Promise<boolean> {
        const library = this.libraries.get(libraryId);
        if (!library) return false;
        
        const index = library.products.findIndex(p => p.id === productId);
        if (index < 0) return false;
        
        library.products.splice(index, 1);
        library.updatedAt = new Date().toISOString();
        
        await this.saveLibrary(library);
        return true;
    }
    
    /**
     * 关联图片到产品
     */
    async linkImageToProduct(
        libraryId: string,
        productId: string,
        assetId: string,
        imageType: ProductEntry['images'][0]['type'],
        isPrimary: boolean = false
    ): Promise<boolean> {
        const library = this.libraries.get(libraryId);
        if (!library) return false;
        
        const product = library.products.find(p => p.id === productId);
        if (!product) return false;
        
        // 如果设为主图，取消其他主图
        if (isPrimary) {
            for (const img of product.images) {
                img.isPrimary = false;
            }
        }
        
        // 检查是否已关联
        const existing = product.images.find(img => img.assetId === assetId);
        if (existing) {
            existing.type = imageType;
            existing.isPrimary = isPrimary;
        } else {
            product.images.push({ assetId, type: imageType, isPrimary });
        }
        
        product.updatedAt = new Date().toISOString();
        library.updatedAt = new Date().toISOString();
        
        await this.saveLibrary(library);
        return true;
    }
}

// ==================== 单例导出 ====================

let instance: ProductLibraryService | null = null;

export function getProductLibraryService(): ProductLibraryService {
    if (!instance) {
        instance = new ProductLibraryService();
    }
    return instance;
}

export default ProductLibraryService;
