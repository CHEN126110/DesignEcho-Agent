/**
 * 主体位置缓存服务
 * 缓存每个图层的主体相对位置，避免重复检测导致的不稳定
 */

export interface SubjectPositionData {
    relativeX: number;      // 主体中心 X 相对于图层宽度的比例 (0-1)
    relativeY: number;      // 主体中心 Y 相对于图层高度的比例 (0-1)
    relativeWidth: number;  // 主体宽度相对于图层宽度的比例
    relativeHeight: number; // 主体高度相对于图层高度的比例
    timestamp: number;      // 缓存时间
}

/**
 * 主体位置缓存管理器
 */
class SubjectPositionCacheService {
    private cache = new Map<number, SubjectPositionData>();
    
    /**
     * 获取缓存的主体位置
     */
    get(layerId: number): SubjectPositionData | undefined {
        return this.cache.get(layerId);
    }
    
    /**
     * 设置主体位置缓存
     */
    set(layerId: number, data: SubjectPositionData): void {
        this.cache.set(layerId, data);
    }
    
    /**
     * 检查是否有缓存
     */
    has(layerId: number): boolean {
        return this.cache.has(layerId);
    }
    
    /**
     * 删除指定图层的缓存
     */
    delete(layerId: number): boolean {
        return this.cache.delete(layerId);
    }
    
    /**
     * 清除所有缓存
     */
    clear(): void {
        this.cache.clear();
    }
    
    /**
     * 清除指定图层的缓存（或清除全部）
     */
    clearCache(layerId?: number): void {
        if (layerId !== undefined) {
            this.cache.delete(layerId);
        } else {
            this.cache.clear();
        }
    }
    
    /**
     * 获取缓存大小
     */
    size(): number {
        return this.cache.size;
    }
}

// 单例
let instance: SubjectPositionCacheService | null = null;

/**
 * 获取主体位置缓存服务实例
 */
export function getSubjectPositionCache(): SubjectPositionCacheService {
    if (!instance) {
        instance = new SubjectPositionCacheService();
    }
    return instance;
}
