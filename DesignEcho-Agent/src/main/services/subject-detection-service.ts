/**
 * 主体检测服务 - 使用抠图模型检测图片中主体的边界
 * 
 * 核心流程：
 * 1. 接收图层图像 Base64
 * 2. 调用抠图模型获取 mask（使用项目自带的 BiRefNet/IS-Net 模型）
 * 3. 分析 mask 计算主体边界框（非透明区域）
 * 4. 返回边界信息
 */

export interface SubjectBounds {
    left: number;
    top: number;
    right: number;
    bottom: number;
    width: number;
    height: number;
    centerX: number;
    centerY: number;
}

export interface SubjectDetectionResult {
    success: boolean;
    bounds?: SubjectBounds;
    maskSize?: { width: number; height: number }; // mask 的实际尺寸（用于坐标转换）
    method?: string;
    processingTime?: number;
    error?: string;
}

export class SubjectDetectionService {
    private nodeMattingService: any = null;

    constructor() {
        console.log('[SubjectDetectionService] 初始化');
    }

    /**
     * 设置抠图服务实例
     */
    setMattingService(service: any): void {
        this.nodeMattingService = service;
        console.log('[SubjectDetectionService] 抠图服务已设置');
    }

    /**
     * 从 mask 中计算主体边界框
     * 使用质心（重心）而非边界框中心，对不规则形状更准确
     * 
     * @param maskBuffer - 灰度 mask 数据 (单通道)
     * @param width - mask 宽度
     * @param height - mask 高度
     * @param threshold - 阈值 (0-255)，超过此值视为主体
     */
    /**
     * 分析 mask 的值分布，找到最佳阈值
     * 通过分析直方图找到高置信度区域的分界点
     */
    private findOptimalThreshold(maskBuffer: Buffer, width: number, height: number): number {
        // 构建直方图 (256 个 bin)
        const histogram = new Array(256).fill(0);
        const totalPixels = width * height;
        
        for (let i = 0; i < maskBuffer.length; i++) {
            histogram[maskBuffer[i]]++;
        }
        
        // 计算 mask 的统计信息
        let sum = 0;
        let sumSq = 0;
        let count = 0;
        
        for (let v = 0; v < 256; v++) {
            const freq = histogram[v];
            sum += v * freq;
            sumSq += v * v * freq;
            count += freq;
        }
        
        const mean = sum / count;
        const variance = (sumSq / count) - (mean * mean);
        const stdDev = Math.sqrt(variance);
        
        // 使用 Otsu's 方法找到最佳二值化阈值
        // 这可以更好地分离前景和背景
        let maxVariance = 0;
        let optimalThreshold = 128;
        
        let w0 = 0, w1 = 0;
        let sum0 = 0, sum1 = sum;
        
        for (let t = 0; t < 256; t++) {
            w0 += histogram[t];
            if (w0 === 0) continue;
            
            w1 = totalPixels - w0;
            if (w1 === 0) break;
            
            sum0 += t * histogram[t];
            sum1 = sum - sum0;
            
            const mean0 = sum0 / w0;
            const mean1 = sum1 / w1;
            
            const betweenVariance = w0 * w1 * (mean0 - mean1) * (mean0 - mean1);
            
            if (betweenVariance > maxVariance) {
                maxVariance = betweenVariance;
                optimalThreshold = t;
            }
        }
        
        // 如果均值很高（>180），使用更高的阈值来只保留核心主体
        if (mean > 180) {
            const conservativeThreshold = Math.min(250, Math.round(mean + stdDev * 0.3));
            return Math.max(optimalThreshold, conservativeThreshold);
        }
        
        return Math.max(128, optimalThreshold);
    }
    
    /**
     * 使用高置信度核心区域来定位主体中心
     * 即使边界检测不准确，核心区域的质心通常是可靠的
     */
    private findCoreRegionCenter(
        maskBuffer: Buffer,
        width: number,
        height: number
    ): { x: number; y: number } | null {
        // 使用非常高的阈值（230-250）找到最核心的前景区域
        const highThreshold = 230;
        
        let sumX = 0;
        let sumY = 0;
        let totalWeight = 0;
        
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const idx = y * width + x;
                const value = maskBuffer[idx];
                
                if (value >= highThreshold) {
                    // 使用 mask 值的平方作为权重，强调高置信度区域
                    const weight = value * value;
                    sumX += x * weight;
                    sumY += y * weight;
                    totalWeight += weight;
                }
            }
        }
        
        if (totalWeight === 0) {
            return null;
        }
        
        return {
            x: sumX / totalWeight,
            y: sumY / totalWeight
        };
    }
    
    private calculateBoundsFromMask(
        maskBuffer: Buffer,
        width: number,
        height: number,
        threshold: number = 128
    ): SubjectBounds | null {
        let minX = width;
        let maxX = 0;
        let minY = height;
        let maxY = 0;
        let hasSubject = false;
        
        // 用于计算质心（重心）
        let sumX = 0;
        let sumY = 0;
        let totalWeight = 0;

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const idx = y * width + x;
                const value = maskBuffer[idx];
                
                if (value >= threshold) {
                    hasSubject = true;
                    if (x < minX) minX = x;
                    if (x > maxX) maxX = x;
                    if (y < minY) minY = y;
                    if (y > maxY) maxY = y;
                    
                    // 累加质心计算（使用 mask 值作为权重，更亮的区域权重更高）
                    sumX += x * value;
                    sumY += y * value;
                    totalWeight += value;
                }
            }
        }

        if (!hasSubject || totalWeight === 0) {
            return null;
        }

        // ★★★ 边界量化：将边界舍入到 2 像素网格，减少微小波动 ★★★
        const QUANTIZE_GRID = 2;
        const qMinX = Math.floor(minX / QUANTIZE_GRID) * QUANTIZE_GRID;
        const qMinY = Math.floor(minY / QUANTIZE_GRID) * QUANTIZE_GRID;
        const qMaxX = Math.ceil((maxX + 1) / QUANTIZE_GRID) * QUANTIZE_GRID;
        const qMaxY = Math.ceil((maxY + 1) / QUANTIZE_GRID) * QUANTIZE_GRID;
        
        const boundsWidth = qMaxX - qMinX;
        const boundsHeight = qMaxY - qMinY;
        
        // 使用边界框中心（更稳定）
        const centerX = qMinX + boundsWidth / 2;
        const centerY = qMinY + boundsHeight / 2;

        return {
            left: qMinX,
            top: qMinY,
            right: qMaxX,
            bottom: qMaxY,
            width: boundsWidth,
            height: boundsHeight,
            centerX,
            centerY
        };
    }

    /**
     * 检测图像中主体的边界
     * @param imageBase64 - 图像 Base64 数据
     * @param options - 选项
     */
    async detectSubjectBounds(
        imageBase64: string,
        options?: {
            model?: string;
            threshold?: number;
            originalImageWidth?: number;  // 原始图像宽度（用于坐标缩放）
            originalImageHeight?: number; // 原始图像高度（用于坐标缩放）
            stabilityMargin?: number;     // 稳定性边距（像素），用于减少边界波动
        }
    ): Promise<SubjectDetectionResult> {
        const startTime = Date.now();
        // 使用较低的阈值（100）而不是 128，可以更完整地包含主体边缘
        const threshold = options?.threshold ?? 100;

        if (!this.nodeMattingService) {
            return { success: false, error: '抠图服务未初始化', method: 'matting' };
        }

        try {
            // 解析 base64 数据
            let imageBuffer: Buffer;
            if (imageBase64.includes(',')) {
                imageBuffer = Buffer.from(imageBase64.split(',')[1], 'base64');
            } else {
                imageBuffer = Buffer.from(imageBase64, 'base64');
            }
            
            // 检测策略：
            // 1. 首先尝试抠图模型（像素级精度）
            // 2. 如果抠图覆盖 > 90%（含背景），使用 YOLO-World 作为备选
            // 3. 如果有 YOLO 结果，在 YOLO 区域内重新抠图
            
            const modelToUse = options?.model || 'u2netp';
            
            const mattingResult = await this.nodeMattingService.removeBackground(imageBase64, {
                returnMask: true,
                model: modelToUse,
                quality: 'fast',
                binaryMaskOutput: true
            });

            if (!mattingResult?.success) {
                return {
                    success: false,
                    error: mattingResult?.error || '抠图失败',
                    method: 'matting',
                    processingTime: Date.now() - startTime
                };
            }

            // 2. 解析 mask 数据
            let maskBuffer: Buffer;
            let maskWidth: number;
            let maskHeight: number;

            if (
                Buffer.isBuffer(mattingResult.maskBuffer) &&
                typeof mattingResult.maskWidth === 'number' &&
                typeof mattingResult.maskHeight === 'number'
            ) {
                maskWidth = mattingResult.maskWidth;
                maskHeight = mattingResult.maskHeight;
                maskBuffer = Buffer.from(mattingResult.maskBuffer);
            } else {
                const maskData = mattingResult.mask || mattingResult.maskImage || mattingResult.alphaMask;

                if (!maskData) {
                    return {
                        success: false,
                        error: '未获取到 mask 数据',
                        method: 'matting',
                        processingTime: Date.now() - startTime
                    };
                }

                // 解析旧格式 mask 数据
                if (typeof maskData === 'string' && maskData.startsWith('RAW_MASK:')) {
                    const parts = maskData.split(':');
                    maskWidth = parseInt(parts[1], 10);
                    maskHeight = parseInt(parts[2], 10);
                    maskBuffer = Buffer.from(parts.slice(3).join(':'), 'base64');
                } else if (typeof maskData === 'string' && maskData.startsWith('RAW:')) {
                    const parts = maskData.split(':');
                    maskWidth = parseInt(parts[1], 10);
                    maskHeight = parseInt(parts[2], 10);
                    maskBuffer = Buffer.from(parts.slice(3).join(':'), 'base64');
                } else {
                const sharp = (await import('sharp')).default;
                let base64Data = maskData;
                if (base64Data.includes(',')) {
                    base64Data = base64Data.split(',')[1];
                }
                
                const metadata = await sharp(Buffer.from(base64Data, 'base64')).metadata();
                maskWidth = metadata.width!;
                maskHeight = metadata.height!;
                
                maskBuffer = await sharp(Buffer.from(base64Data, 'base64'))
                    .greyscale()
                    .raw()
                    .toBuffer();
                }
            }

            // 智能阈值分析
            const optimalThreshold = this.findOptimalThreshold(maskBuffer, maskWidth, maskHeight);
            const effectiveThreshold = Math.max(threshold, optimalThreshold);
            
            // 计算边界框
            let rawBounds = this.calculateBoundsFromMask(maskBuffer, maskWidth, maskHeight, effectiveThreshold);

            if (!rawBounds) {
                rawBounds = this.calculateBoundsFromMask(maskBuffer, maskWidth, maskHeight, threshold);
                
                if (!rawBounds) {
                    return {
                        success: false,
                        error: '未检测到主体',
                        method: 'matting',
                        processingTime: Date.now() - startTime
                    };
                }
            }
            
            // 自适应阈值：如果主体面积过大，尝试更高阈值
            const initialArea = rawBounds.width * rawBounds.height;
            const totalArea = maskWidth * maskHeight;
            const initialRatio = initialArea / totalArea;
            
            if (initialRatio > 0.70) {
                const higherThresholds = [180, 200, 220, 240];
                
                for (const highThreshold of higherThresholds) {
                    const refinedBounds = this.calculateBoundsFromMask(maskBuffer, maskWidth, maskHeight, highThreshold);
                    
                    if (refinedBounds) {
                        const refinedRatio = (refinedBounds.width * refinedBounds.height) / totalArea;
                        
                        if (refinedRatio < initialRatio * 0.85 && refinedRatio > 0.03) {
                            rawBounds = refinedBounds;
                        }
                    } else {
                        break;
                    }
                }
            }

            // 将 mask 坐标缩放回原始图像尺寸
            let bounds = rawBounds;
            const origWidth = options?.originalImageWidth;
            const origHeight = options?.originalImageHeight;
            
            if (origWidth && origHeight && (maskWidth !== origWidth || maskHeight !== origHeight)) {
                const scaleX = origWidth / maskWidth;
                const scaleY = origHeight / maskHeight;
                
                bounds = {
                    left: rawBounds.left * scaleX,
                    top: rawBounds.top * scaleY,
                    right: rawBounds.right * scaleX,
                    bottom: rawBounds.bottom * scaleY,
                    width: rawBounds.width * scaleX,
                    height: rawBounds.height * scaleY,
                    centerX: rawBounds.centerX * scaleX,
                    centerY: rawBounds.centerY * scaleY
                };
            }
            
            // 应用稳定性边距
            const margin = options?.stabilityMargin ?? 2;
            if (margin > 0 && bounds.width > margin * 4 && bounds.height > margin * 4) {
                bounds = {
                    ...bounds,
                    left: bounds.left + margin,
                    top: bounds.top + margin,
                    right: bounds.right - margin,
                    bottom: bounds.bottom - margin,
                    width: bounds.width - margin * 2,
                    height: bounds.height - margin * 2
                };
            }

            return {
                success: true,
                bounds,
                maskSize: { width: maskWidth, height: maskHeight },
                method: 'matting-model',
                processingTime: Date.now() - startTime
            };

        } catch (error: any) {
            return {
                success: false,
                error: error.message || '检测失败',
                method: 'matting',
                processingTime: Date.now() - startTime
            };
        }
    }
}

// 单例
let subjectDetectionService: SubjectDetectionService | null = null;

export function getSubjectDetectionService(): SubjectDetectionService {
    if (!subjectDetectionService) {
        subjectDetectionService = new SubjectDetectionService();
    }
    return subjectDetectionService;
}
