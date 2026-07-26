/**
 * 内容分析器
 * 
 * 检测图案、花边等需要保护的区域
 */

import sharp from 'sharp';
import { Point2D, BoundingBox, ContentAnalysisResult } from './types';

export class ContentAnalyzer {
    /**
     * 分析图像内容
     */
    async analyze(
        imageBuffer: Buffer,
        contour: Point2D[]
    ): Promise<ContentAnalysisResult> {
        console.log('[ContentAnalyzer] 开始内容分析...');
        const startTime = performance.now();
        
        // 获取图像信息
        const metadata = await sharp(imageBuffer).metadata();
        const width = metadata.width || 0;
        const height = metadata.height || 0;
        
        // 1. 检测图案区域
        const patternResult = await this.detectPatterns(imageBuffer, width, height);
        
        // 2. 检测花边区域
        const laceResult = await this.detectLace(imageBuffer, contour, width, height);
        
        // 3. 区域分割
        const regions = this.segmentRegions(contour, height);
        
        const duration = performance.now() - startTime;
        console.log(`[ContentAnalyzer] ✅ 完成, 耗时 ${duration.toFixed(2)}ms`);
        console.log(`  - 图案: ${patternResult.hasPattern ? '检测到' : '未检测到'}`);
        console.log(`  - 花边: ${laceResult.hasLace ? '检测到' : '未检测到'} (置信度: ${(laceResult.confidence * 100).toFixed(1)}%)`);
        
        return {
            hasPattern: patternResult.hasPattern,
            patternMask: patternResult.mask,
            patternComplexity: patternResult.complexity,
            hasLace: laceResult.hasLace,
            laceRegion: laceResult.region,
            laceConfidence: laceResult.confidence,
            regions
        };
    }
    
    /**
     * 检测图案区域
     * 使用纹理复杂度分析
     */
    private async detectPatterns(
        imageBuffer: Buffer,
        width: number,
        height: number
    ): Promise<{ hasPattern: boolean; mask: Uint8Array | null; complexity: number }> {
        try {
            // 转为灰度
            const grayscaleBuffer = await sharp(imageBuffer)
                .grayscale()
                .raw()
                .toBuffer();
            
            // 计算局部方差（纹理复杂度指标）
            const windowSize = 7;
            const varianceMap = this.computeLocalVariance(grayscaleBuffer, width, height, windowSize);
            
            // 计算平均复杂度
            let sum = 0;
            for (let i = 0; i < varianceMap.length; i++) {
                sum += varianceMap[i];
            }
            const avgComplexity = sum / varianceMap.length;
            
            // 阈值判断是否有图案
            const hasPattern = avgComplexity > 500;  // 方差阈值
            
            // 生成图案蒙版
            let mask: Uint8Array | null = null;
            if (hasPattern) {
                mask = new Uint8Array(width * height);
                const threshold = avgComplexity * 0.8;
                for (let i = 0; i < varianceMap.length; i++) {
                    mask[i] = varianceMap[i] > threshold ? 255 : 0;
                }
            }
            
            return {
                hasPattern,
                mask,
                complexity: avgComplexity
            };
            
        } catch (error: any) {
            console.warn('[ContentAnalyzer] 图案检测失败:', error.message);
            return { hasPattern: false, mask: null, complexity: 0 };
        }
    }
    
    /**
     * 计算局部方差
     */
    private computeLocalVariance(
        grayscale: Buffer,
        width: number,
        height: number,
        windowSize: number
    ): Float32Array {
        const variance = new Float32Array(width * height);
        const halfWindow = Math.floor(windowSize / 2);
        
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                // 计算窗口内的均值
                let sum = 0;
                let count = 0;
                
                for (let wy = -halfWindow; wy <= halfWindow; wy++) {
                    for (let wx = -halfWindow; wx <= halfWindow; wx++) {
                        const nx = x + wx;
                        const ny = y + wy;
                        
                        if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                            sum += grayscale[ny * width + nx];
                            count++;
                        }
                    }
                }
                
                const mean = sum / count;
                
                // 计算方差
                let varianceSum = 0;
                for (let wy = -halfWindow; wy <= halfWindow; wy++) {
                    for (let wx = -halfWindow; wx <= halfWindow; wx++) {
                        const nx = x + wx;
                        const ny = y + wy;
                        
                        if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                            const diff = grayscale[ny * width + nx] - mean;
                            varianceSum += diff * diff;
                        }
                    }
                }
                
                variance[y * width + x] = varianceSum / count;
            }
        }
        
        return variance;
    }
    
    /**
     * 检测花边区域
     */
    private async detectLace(
        imageBuffer: Buffer,
        contour: Point2D[],
        width: number,
        height: number
    ): Promise<{ hasLace: boolean; region: BoundingBox | null; confidence: number }> {
        if (contour.length < 10) {
            return { hasLace: false, region: null, confidence: 0 };
        }
        
        try {
            // 1. 确定袜口区域（顶部 20%）
            const bounds = this.computeContourBounds(contour);
            const cuffHeight = bounds.height * 0.2;
            const cuffBounds: BoundingBox = {
                x: bounds.x,
                y: bounds.y,
                width: bounds.width,
                height: cuffHeight
            };
            
            // 2. 提取袜口轮廓点
            const cuffContour = contour.filter(p =>
                p.y >= bounds.y && p.y <= bounds.y + cuffHeight
            );
            
            if (cuffContour.length < 5) {
                return { hasLace: false, region: null, confidence: 0 };
            }
            
            // 3. 分析边缘复杂度（花边特征：高频锯齿）
            const edgeComplexity = this.computeEdgeComplexity(cuffContour);
            
            // 4. 检测重复模式
            const repetitionScore = this.detectRepetitivePattern(cuffContour);
            
            // 5. 综合判断
            const confidence = (edgeComplexity + repetitionScore) / 2;
            const hasLace = confidence > 0.5;
            
            return {
                hasLace,
                region: hasLace ? cuffBounds : null,
                confidence
            };
            
        } catch (error: any) {
            console.warn('[ContentAnalyzer] 花边检测失败:', error.message);
            return { hasLace: false, region: null, confidence: 0 };
        }
    }
    
    /**
     * 计算边缘复杂度
     */
    private computeEdgeComplexity(contour: Point2D[]): number {
        if (contour.length < 3) return 0;
        
        // 计算方向变化频率
        let directionChanges = 0;
        
        for (let i = 2; i < contour.length; i++) {
            const dx1 = contour[i - 1].x - contour[i - 2].x;
            const dy1 = contour[i - 1].y - contour[i - 2].y;
            const dx2 = contour[i].x - contour[i - 1].x;
            const dy2 = contour[i].y - contour[i - 1].y;
            
            // 叉积判断方向变化
            const cross = dx1 * dy2 - dy1 * dx2;
            if (Math.abs(cross) > 0.5) {
                directionChanges++;
            }
        }
        
        // 归一化
        const frequency = directionChanges / (contour.length - 2);
        return Math.min(1, frequency * 3);
    }
    
    /**
     * 检测重复模式
     */
    private detectRepetitivePattern(contour: Point2D[]): number {
        if (contour.length < 10) return 0;
        
        // 计算 Y 坐标序列
        const yValues = contour.map(p => p.y);
        
        // 使用自相关检测周期性
        const n = yValues.length;
        let maxCorrelation = 0;
        
        for (let lag = 3; lag < n / 2; lag++) {
            let correlation = 0;
            let count = 0;
            
            for (let i = 0; i < n - lag; i++) {
                correlation += yValues[i] * yValues[i + lag];
                count++;
            }
            
            correlation /= count;
            maxCorrelation = Math.max(maxCorrelation, correlation);
        }
        
        // 归一化
        const variance = this.computeArrayVariance(yValues);
        if (variance < 0.001) return 0;
        
        return Math.min(1, maxCorrelation / (variance * 1000));
    }
    
    /**
     * 计算数组方差
     */
    private computeArrayVariance(arr: number[]): number {
        const mean = arr.reduce((s, v) => s + v, 0) / arr.length;
        const variance = arr.reduce((s, v) => s + (v - mean) * (v - mean), 0) / arr.length;
        return variance;
    }
    
    /**
     * 区域分割
     */
    private segmentRegions(
        contour: Point2D[],
        imageHeight: number
    ): ContentAnalysisResult['regions'] {
        if (contour.length < 3) {
            return { cuff: null, body: null, toe: null };
        }
        
        const bounds = this.computeContourBounds(contour);
        
        return {
            cuff: {
                x: bounds.x,
                y: bounds.y,
                width: bounds.width,
                height: bounds.height * 0.15
            },
            body: {
                x: bounds.x,
                y: bounds.y + bounds.height * 0.15,
                width: bounds.width,
                height: bounds.height * 0.6
            },
            toe: {
                x: bounds.x,
                y: bounds.y + bounds.height * 0.75,
                width: bounds.width,
                height: bounds.height * 0.25
            }
        };
    }
    
    /**
     * 计算轮廓边界框
     */
    private computeContourBounds(contour: Point2D[]): BoundingBox {
        let minX = Infinity, minY = Infinity;
        let maxX = -Infinity, maxY = -Infinity;
        
        for (const p of contour) {
            minX = Math.min(minX, p.x);
            minY = Math.min(minY, p.y);
            maxX = Math.max(maxX, p.x);
            maxY = Math.max(maxY, p.y);
        }
        
        return {
            x: minX,
            y: minY,
            width: maxX - minX,
            height: maxY - minY
        };
    }
}
