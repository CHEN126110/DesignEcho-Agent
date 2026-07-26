/**
 * 智能布局服务 - SmartLayoutService
 * 
 * 核心能力：自动识别图片主体并计算最优缩放和定位
 * 
 * 两种模式：
 * 1. CANVAS - 基于画布，需要抠图识别主体
 * 2. CLIPPING_BASE - 基于剪切蒙版，使用蒙版基底图层边界
 * 
 * 技术栈：
 * - BiRefNet ONNX - 高精度抠图获取主体 mask
 * - 规则约束 - 利用电商产品图先验知识修正边界
 * - 前景有效性检测 - 防止抠图失败导致异常
 */

import { MattingService } from './matting-service';

// ==================== 类型定义 ====================

export interface BoundingBox {
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface ImageSize {
    width: number;
    height: number;
}

export enum SubjectDetectionMode {
    /** 基于画布，需要抠图识别主体 */
    CANVAS = 'canvas',
    /** 基于剪切蒙版基底图层边界 */
    CLIPPING_BASE = 'clipping_base'
}

export interface LayerContext {
    /** 图层 ID */
    layerId: number;
    /** 是否被剪切 */
    isClipped: boolean;
    /** 剪切蒙版基底图层 ID */
    clippingBaseLayerId?: number;
    /** 剪切蒙版基底边界 */
    clippingBaseBounds?: BoundingBox;
}

export interface SmartScaleConfig {
    /** 主体填充目标区域的比例 (0-1)，默认 0.85 */
    fillRatio?: number;
    /** 对齐方式 */
    alignment?: 'center' | 'top-center' | 'bottom-center' | 'left-center' | 'right-center';
    /** 最小主体占比（低于此值视为识别失败），默认 0.01 */
    minSubjectRatio?: number;
    /** 边缘安全扩展比例，默认 0.02 */
    edgePadding?: number;
}

export interface SmartScaleResult {
    /** 是否成功 */
    success: boolean;
    /** 缩放比例 */
    scale: number;
    /** 定位位置 */
    position: { x: number; y: number };
    /** 主体边界框（相对于原图） */
    subjectBounds: BoundingBox;
    /** 使用的检测模式 */
    mode: SubjectDetectionMode;
    /** 是否使用了保守回退 */
    usedFallback: boolean;
    /** 错误信息 */
    error?: string;
    /** 结构化原因码 */
    reasonCode?: string;
    /** 处理耗时 (ms) */
    processingTime?: number;
}

export interface SubjectDetectionResult {
    success: boolean;
    bounds: BoundingBox;
    mode: SubjectDetectionMode;
    usedFallback: boolean;
    foregroundRatio?: number;
    error?: string;
    reasonCode?: string;
}

// ==================== 默认配置 ====================

const DEFAULT_CONFIG: Required<SmartScaleConfig> = {
    fillRatio: 0.85,
    alignment: 'center',
    minSubjectRatio: 0.01,  // 至少 1% 前景
    edgePadding: 0.02       // 边缘扩展 2%
};

// ==================== 智能布局服务 ====================

export class SmartLayoutService {
    private mattingService: MattingService;
    private sharp: typeof import('sharp') | null = null;
    private initialized: boolean = false;

    constructor(mattingService?: MattingService) {
        this.mattingService = mattingService || new MattingService();
    }

    /**
     * 确保依赖已加载
     */
    private async ensureInitialized(): Promise<void> {
        if (this.initialized) return;
        
        try {
            this.sharp = (await import('sharp')).default;
            this.initialized = true;
            console.log('[SmartLayoutService] ✅ 初始化完成');
        } catch (e: any) {
            console.error('[SmartLayoutService] ❌ 初始化失败:', e.message);
            throw new Error('SmartLayoutService 初始化失败');
        }
    }

    // ==================== 核心 API ====================

    /**
     * 检测主体边界
     * 
     * @param imageData - 图像数据（Base64 或 Buffer）
     * @param imageSize - 图像尺寸
     * @param layerContext - 图层上下文（用于判断剪切蒙版模式）
     */
    async detectSubject(
        imageData: string | Buffer,
        imageSize: ImageSize,
        layerContext?: LayerContext
    ): Promise<SubjectDetectionResult> {
        await this.ensureInitialized();
        
        const startTime = Date.now();
        
        // 1. 判断模式
        const mode = this.determineMode(layerContext);
        console.log(`[SmartLayoutService] 检测模式: ${mode}`);
        
        // 2. 根据模式获取边界
        if (mode === SubjectDetectionMode.CLIPPING_BASE) {
            // 剪切蒙版模式：使用基底边界
            if (!layerContext?.clippingBaseBounds) {
                return {
                    success: false,
                    bounds: this.getFallbackBounds(imageSize),
                    mode,
                    usedFallback: true,
                    error: '剪切蒙版基底边界未提供',
                    reasonCode: 'CLIPPING_BASE_MISSING'
                };
            }
            
            return {
                success: true,
                bounds: layerContext.clippingBaseBounds,
                mode,
                usedFallback: false
            };
        }
        
        // 3. CANVAS 模式：抠图识别主体
        try {
            const result = await this.detectFromCanvas(imageData, imageSize);
            console.log(`[SmartLayoutService] 检测完成，耗时: ${Date.now() - startTime}ms`);
            return result;
        } catch (e: any) {
            console.error('[SmartLayoutService] 主体检测失败:', e.message);
            return {
                success: false,
                bounds: this.getFallbackBounds(imageSize),
                mode: SubjectDetectionMode.CANVAS,
                usedFallback: true,
                error: e.message,
                reasonCode: 'DETECTION_ERROR'
            };
        }
    }

    /**
     * 计算智能缩放和定位
     * 
     * @param subjectBounds - 主体边界框
     * @param sourceImageSize - 原图尺寸
     * @param targetArea - 目标区域
     * @param config - 配置选项
     */
    calculateSmartScale(
        subjectBounds: BoundingBox,
        sourceImageSize: ImageSize,
        targetArea: BoundingBox,
        config?: SmartScaleConfig
    ): { scale: number; position: { x: number; y: number } } {
        const cfg = { ...DEFAULT_CONFIG, ...config };
        
        // 1. 计算主体中心
        const subjectCenterX = subjectBounds.x + subjectBounds.width / 2;
        const subjectCenterY = subjectBounds.y + subjectBounds.height / 2;
        
        // 2. 基于主体尺寸计算缩放比例
        const scaleX = (targetArea.width * cfg.fillRatio) / subjectBounds.width;
        const scaleY = (targetArea.height * cfg.fillRatio) / subjectBounds.height;
        const scale = Math.min(scaleX, scaleY);
        
        // 3. 计算目标区域中心
        const targetCenterX = targetArea.x + targetArea.width / 2;
        const targetCenterY = targetArea.y + targetArea.height / 2;
        
        // 4. 根据对齐方式计算位置
        let positionX: number;
        let positionY: number;
        
        // 缩放后主体中心的位置
        const scaledSubjectCenterX = subjectCenterX * scale;
        const scaledSubjectCenterY = subjectCenterY * scale;
        
        // 计算偏移使主体居中
        positionX = targetCenterX - scaledSubjectCenterX;
        positionY = targetCenterY - scaledSubjectCenterY;
        
        // 根据对齐方式调整
        switch (cfg.alignment) {
            case 'top-center':
                // 主体顶部对齐目标区域顶部
                positionY = targetArea.y - (subjectBounds.y * scale);
                break;
            case 'bottom-center':
                // 主体底部对齐目标区域底部
                const scaledSubjectBottom = (subjectBounds.y + subjectBounds.height) * scale;
                positionY = (targetArea.y + targetArea.height) - scaledSubjectBottom;
                break;
            case 'left-center':
                positionX = targetArea.x - (subjectBounds.x * scale);
                break;
            case 'right-center':
                const scaledSubjectRight = (subjectBounds.x + subjectBounds.width) * scale;
                positionX = (targetArea.x + targetArea.width) - scaledSubjectRight;
                break;
            // 'center' 使用默认计算结果
        }
        
        return {
            scale,
            position: { x: positionX, y: positionY }
        };
    }

    /**
     * 批量智能布局：处理多张图片
     * 原子函数：独立的批量处理逻辑
     * 
     * @param items - 批量处理项
     * @param config - 全局配置
     */
    async batchSmartLayout(
        items: Array<{
            imageData: string | Buffer;
            imageSize: ImageSize;
            targetArea: BoundingBox;
            layerContext?: LayerContext;
        }>,
        config?: SmartScaleConfig
    ): Promise<{
        success: boolean;
        results: SmartScaleResult[];
        totalCount: number;
        successCount: number;
        error?: string;
    }> {
        try {
            const results: SmartScaleResult[] = [];
            
            for (const item of items) {
                const result = await this.smartLayout(
                    item.imageData,
                    item.imageSize,
                    item.targetArea,
                    {
                        layerContext: item.layerContext,
                        config
                    }
                );
                results.push(result);
            }
            
            const successCount = results.filter(r => r.success).length;
            
            return {
                success: true,
                results,
                totalCount: results.length,
                successCount
            };
        } catch (error: any) {
            return {
                success: false,
                results: [],
                totalCount: 0,
                successCount: 0,
                error: error.message
            };
        }
    }

    /**
     * 一站式智能布局：检测主体 + 计算缩放定位
     * 
     * @param imageData - 图像数据
     * @param imageSize - 图像尺寸
     * @param targetArea - 目标区域
     * @param options - 配置选项
     */
    async smartLayout(
        imageData: string | Buffer,
        imageSize: ImageSize,
        targetArea: BoundingBox,
        options?: {
            layerContext?: LayerContext;
            config?: SmartScaleConfig;
        }
    ): Promise<SmartScaleResult> {
        const startTime = Date.now();
        
        // 1. 检测主体
        const detection = await this.detectSubject(
            imageData,
            imageSize,
            options?.layerContext
        );
        
        if (!detection.success && !detection.usedFallback) {
            return {
                success: false,
                scale: 1,
                position: { x: 0, y: 0 },
                subjectBounds: detection.bounds,
                mode: detection.mode,
                usedFallback: false,
                error: detection.error,
                reasonCode: detection.reasonCode || 'DETECTION_HARD_FAILED',
                processingTime: Date.now() - startTime
            };
        }
        
        // 2. 计算缩放和定位
        const scaleResult = this.calculateSmartScale(
            detection.bounds,
            imageSize,
            targetArea,
            options?.config
        );
        
        return {
            success: true,
            scale: scaleResult.scale,
            position: scaleResult.position,
            subjectBounds: detection.bounds,
            mode: detection.mode,
            usedFallback: detection.usedFallback,
            reasonCode: detection.reasonCode || (detection.usedFallback ? 'FALLBACK_USED' : 'OK'),
            processingTime: Date.now() - startTime
        };
    }

    // ==================== 内部方法 ====================

    /**
     * 判断检测模式
     */
    private determineMode(layerContext?: LayerContext): SubjectDetectionMode {
        if (layerContext?.isClipped && layerContext.clippingBaseLayerId) {
            return SubjectDetectionMode.CLIPPING_BASE;
        }
        return SubjectDetectionMode.CANVAS;
    }

    /**
     * CANVAS 模式：通过抠图识别主体
     */
    private async detectFromCanvas(
        imageData: string | Buffer,
        imageSize: ImageSize
    ): Promise<SubjectDetectionResult> {
        // 1. 执行抠图获取 mask
        const mattingResult = await this.mattingService.removeBackground(
            typeof imageData === 'string' ? imageData : imageData.toString('base64'),
            { returnMask: true, binaryMaskOutput: true }
        );
        
        if (!mattingResult.success) {
            console.warn('[SmartLayoutService] 抠图失败，使用保守回退');
            return {
                success: false,
                bounds: this.getFallbackBounds(imageSize),
                mode: SubjectDetectionMode.CANVAS,
                usedFallback: true,
                error: mattingResult.error || '抠图失败',
                reasonCode: 'MATTING_FAILED'
            };
        }
        
        // 2. 解析 mask 数据
        const maskData = this.parseMaskData(mattingResult, imageSize);
        if (!maskData) {
            return {
                success: false,
                bounds: this.getFallbackBounds(imageSize),
                mode: SubjectDetectionMode.CANVAS,
                usedFallback: true,
                error: 'Mask 解析失败',
                reasonCode: 'MASK_PARSE_FAILED'
            };
        }
        
        // 3. 前景有效性检测
        const foregroundRatio = this.calculateForegroundRatio(maskData.data, maskData.width * maskData.height);
        console.log(`[SmartLayoutService] 前景占比: ${(foregroundRatio * 100).toFixed(2)}%`);
        
        if (foregroundRatio < DEFAULT_CONFIG.minSubjectRatio) {
            console.warn(`[SmartLayoutService] 前景占比过低 (${(foregroundRatio * 100).toFixed(2)}%)，使用保守回退`);
            return {
                success: false,
                bounds: this.getFallbackBounds(imageSize),
                mode: SubjectDetectionMode.CANVAS,
                usedFallback: true,
                foregroundRatio,
                error: '前景检测失败：前景占比过低',
                reasonCode: 'DETECTION_EMPTY'
            };
        }
        
        // 4. 从 mask 计算边界框
        const rawBounds = this.getBoundsFromMask(maskData.data, maskData.width, maskData.height);
        
        // 5. 应用规则约束修正
        const correctedBounds = this.applyConstraints(rawBounds, imageSize);
        
        return {
            success: true,
            bounds: correctedBounds,
            mode: SubjectDetectionMode.CANVAS,
            usedFallback: false,
            foregroundRatio,
            reasonCode: 'OK'
        };
    }

    /**
     * 解析 mask 数据
     */
    private parseMaskData(
        mattingResult: {
            maskImage?: string;
            maskBuffer?: Buffer;
            maskWidth?: number;
            maskHeight?: number;
        },
        imageSize: ImageSize
    ): { data: Uint8Array; width: number; height: number } | null {
        try {
            if (
                mattingResult.maskBuffer &&
                mattingResult.maskWidth &&
                mattingResult.maskHeight
            ) {
                return {
                    data: new Uint8Array(mattingResult.maskBuffer),
                    width: mattingResult.maskWidth,
                    height: mattingResult.maskHeight
                };
            }

            const maskImage = mattingResult.maskImage;
            if (!maskImage) {
                console.warn('[SmartLayoutService] 抠图结果未返回 mask 数据');
                return null;
            }

            // RAW_MASK 格式: "RAW_MASK:width:height:base64"
            if (maskImage.startsWith('RAW_MASK:')) {
                const parts = maskImage.split(':');
                const width = parseInt(parts[1]);
                const height = parseInt(parts[2]);
                const base64Data = parts.slice(3).join(':');
                const buffer = Buffer.from(base64Data, 'base64');
                
                return {
                    data: new Uint8Array(buffer),
                    width,
                    height
                };
            }
            
            // 其他格式暂不支持
            console.warn('[SmartLayoutService] 不支持的 mask 格式');
            return null;
        } catch (e: any) {
            console.error('[SmartLayoutService] 解析 mask 失败:', e.message);
            return null;
        }
    }

    /**
     * 计算前景占比
     */
    private calculateForegroundRatio(maskData: Uint8Array, totalPixels: number): number {
        const threshold = 128;  // 像素值 > 128 视为前景
        let foregroundPixels = 0;
        
        for (let i = 0; i < maskData.length; i++) {
            if (maskData[i] > threshold) {
                foregroundPixels++;
            }
        }
        
        return foregroundPixels / totalPixels;
    }

    /**
     * 从 mask 计算主体边界框
     */
    private getBoundsFromMask(
        maskData: Uint8Array,
        width: number,
        height: number
    ): BoundingBox {
        const threshold = 128;
        
        let minX = width;
        let minY = height;
        let maxX = 0;
        let maxY = 0;
        
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const idx = y * width + x;
                if (maskData[idx] > threshold) {
                    minX = Math.min(minX, x);
                    minY = Math.min(minY, y);
                    maxX = Math.max(maxX, x);
                    maxY = Math.max(maxY, y);
                }
            }
        }
        
        // 如果没有检测到前景，返回整图
        if (minX > maxX || minY > maxY) {
            return { x: 0, y: 0, width, height };
        }
        
        return {
            x: minX,
            y: minY,
            width: maxX - minX + 1,
            height: maxY - minY + 1
        };
    }

    /**
     * 应用规则约束修正边界框
     */
    private applyConstraints(
        rawBounds: BoundingBox,
        imageSize: ImageSize
    ): BoundingBox {
        const { width: imgW, height: imgH } = imageSize;
        
        // 1. 边界不能超出图片
        let bounds = this.clampToImage(rawBounds, imgW, imgH);
        
        // 2. 最小尺寸约束（防止识别到噪点）
        const minSize = Math.min(imgW, imgH) * 0.1;
        if (bounds.width < minSize || bounds.height < minSize) {
            console.warn('[SmartLayoutService] 边界框过小，使用保守回退');
            return this.getFallbackBounds(imageSize);
        }
        
        // 3. 边缘安全扩展
        const padding = Math.min(imgW, imgH) * DEFAULT_CONFIG.edgePadding;
        bounds = this.expandBounds(bounds, padding, imgW, imgH);
        
        // 4. 主体比例约束
        const ratio = (bounds.width * bounds.height) / (imgW * imgH);
        if (ratio < 0.05) {
            console.warn('[SmartLayoutService] 主体占比过低，使用保守回退');
            return this.getFallbackBounds(imageSize);
        }
        
        return bounds;
    }

    /**
     * 裁剪边界到图片范围内
     */
    private clampToImage(bounds: BoundingBox, imgW: number, imgH: number): BoundingBox {
        const x = Math.max(0, bounds.x);
        const y = Math.max(0, bounds.y);
        const right = Math.min(imgW, bounds.x + bounds.width);
        const bottom = Math.min(imgH, bounds.y + bounds.height);
        
        return {
            x,
            y,
            width: right - x,
            height: bottom - y
        };
    }

    /**
     * 扩展边界框（防止切边）
     */
    private expandBounds(
        bounds: BoundingBox,
        padding: number,
        maxW: number,
        maxH: number
    ): BoundingBox {
        return {
            x: Math.max(0, bounds.x - padding),
            y: Math.max(0, bounds.y - padding),
            width: Math.min(maxW - bounds.x + padding, bounds.width + padding * 2),
            height: Math.min(maxH - bounds.y + padding, bounds.height + padding * 2)
        };
    }

    /**
     * 保守回退：假设主体居中占 70%
     */
    private getFallbackBounds(imageSize: ImageSize): BoundingBox {
        const ratio = 0.7;
        const w = imageSize.width * ratio;
        const h = imageSize.height * ratio;
        
        return {
            x: (imageSize.width - w) / 2,
            y: (imageSize.height - h) / 2,
            width: w,
            height: h
        };
    }

    // ==================== 工具方法 ====================

    /**
     * 获取服务状态
     */
    getStatus(): { initialized: boolean; mattingAvailable: boolean } {
        return {
            initialized: this.initialized,
            mattingAvailable: this.mattingService.isPythonBackendAvailable()
        };
    }
}

// 单例导出
let smartLayoutServiceInstance: SmartLayoutService | null = null;

export function getSmartLayoutService(mattingService?: MattingService): SmartLayoutService {
    if (!smartLayoutServiceInstance) {
        smartLayoutServiceInstance = new SmartLayoutService(mattingService);
    }
    return smartLayoutServiceInstance;
}
