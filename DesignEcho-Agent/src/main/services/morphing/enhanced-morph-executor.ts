/**
 * 增强的形态变形执行器
 * 
 * 整合区域分析、点匹配和MLS变形
 * 实现精确的袜子形态统一
 */

import sharp from 'sharp';
import { Point2D, ControlPointPair, DisplacementField, MorphResult, BoundingBox } from './types';
import { MLSDeformation } from './mls-deformation';
import { ContentAnalyzer } from './content-analyzer';
import { SockRegionAnalyzer, SockRegions, CuffAnalysisResult, getSockRegionAnalyzer } from './sock-region-analyzer';
import { RegionAwareMatcher, MatchingResult, getRegionAwareMatcher } from './region-aware-matcher';

// 增强变形配置
export interface EnhancedMorphConfig {
    // 变形强度
    intensity: number;           // 0-1, 默认 0.8
    
    // 内容保护
    contentProtection: number;   // 0-1, 纹理保护强度
    
    // 平滑度
    smoothness: number;          // 0-1, 变形平滑度
    
    // 区域控制
    regionControl: {
        cuff: number;   // 袜口变形强度
        leg: number;    // 袜筒变形强度
        heel: number;   // 袜跟变形强度
        body: number;   // 袜身变形强度
        toe: number;    // 袜头变形强度
    };
    
    // 质量
    quality: 'fast' | 'balanced' | 'high';
    
    // 预对齐
    preAlign: boolean;
    
    // 调试
    debug: boolean;
}

// 默认配置
export const DEFAULT_ENHANCED_CONFIG: EnhancedMorphConfig = {
    intensity: 0.8,
    contentProtection: 0.7,
    smoothness: 0.5,
    regionControl: {
        cuff: 1.0,
        leg: 0.8,
        heel: 0.9,
        body: 0.7,
        toe: 0.85
    },
    quality: 'balanced',
    preAlign: true,
    debug: false
};

// 质量预设
const QUALITY_SETTINGS = {
    fast: { gridSize: 100, morphPasses: 1 },
    balanced: { gridSize: 50, morphPasses: 2 },
    high: { gridSize: 25, morphPasses: 3 }
};

// 增强变形结果
export interface EnhancedMorphResult extends MorphResult {
    regionAnalysis?: {
        source: SockRegions | null;
        target: SockRegions | null;
        cuffAnalysis: CuffAnalysisResult | null;
    };
    matchingResult?: MatchingResult;
    appliedConfig: EnhancedMorphConfig;
}

export class EnhancedMorphExecutor {
    private mlsDeformation: MLSDeformation;
    private contentAnalyzer: ContentAnalyzer;
    private regionAnalyzer: SockRegionAnalyzer;
    private regionMatcher: RegionAwareMatcher;
    
    constructor() {
        this.mlsDeformation = new MLSDeformation();
        this.contentAnalyzer = new ContentAnalyzer();
        this.regionAnalyzer = getSockRegionAnalyzer();
        this.regionMatcher = getRegionAwareMatcher();
        
        console.log('[EnhancedMorphExecutor] 初始化完成');
    }
    
    /**
     * 执行增强形态变形
     */
    async execute(
        sourceImageBase64: string,
        sourceContour: Point2D[],
        targetContour: Point2D[],
        config: Partial<EnhancedMorphConfig> = {}
    ): Promise<EnhancedMorphResult> {
        const startTime = performance.now();
        const mergedConfig = { ...DEFAULT_ENHANCED_CONFIG, ...config };
        
        console.log('[EnhancedMorphExecutor] 开始增强形态变形');
        console.log(`  - 强度: ${mergedConfig.intensity}`);
        console.log(`  - 内容保护: ${mergedConfig.contentProtection}`);
        console.log(`  - 质量: ${mergedConfig.quality}`);
        
        try {
            // 1. 解码图像
            const step1Start = performance.now();
            const imageBuffer = await this.decodeImage(sourceImageBase64);
            const metadata = await sharp(imageBuffer).metadata();
            const width = metadata.width || 0;
            const height = metadata.height || 0;
            console.log(`  [Step 1] 图像解码: ${width}x${height}, ${(performance.now() - step1Start).toFixed(0)}ms`);
            
            // 2. 区域分析
            const step2Start = performance.now();
            const sourceAnalysis = await this.regionAnalyzer.analyze(imageBuffer, sourceContour);
            const targetAnalysis = await this.regionAnalyzer.analyze(null, targetContour);
            console.log(`  [Step 2] 区域分析完成, ${(performance.now() - step2Start).toFixed(0)}ms`);
            
            if (!sourceAnalysis.success || !sourceAnalysis.regions) {
                return this.createErrorResult('源图像区域分析失败', startTime, mergedConfig);
            }
            
            if (!targetAnalysis.success || !targetAnalysis.regions) {
                return this.createErrorResult('目标形状区域分析失败', startTime, mergedConfig);
            }
            
            // 3. 区域感知点匹配
            const step3Start = performance.now();
            
            // 更新匹配器的区域权重
            this.regionMatcher.updateConfig({
                regionWeights: mergedConfig.regionControl
            });
            
            const matchingResult = this.regionMatcher.match(
                sourceAnalysis.regions,
                targetAnalysis.regions,
                sourceAnalysis.cuffAnalysis,
                targetAnalysis.cuffAnalysis
            );
            console.log(`  [Step 3] 点匹配: ${matchingResult.controlPairs.length} 对, 质量 ${(matchingResult.qualityScore * 100).toFixed(1)}%, ${(performance.now() - step3Start).toFixed(0)}ms`);
            
            if (matchingResult.controlPairs.length < 10) {
                return this.createErrorResult('控制点数量不足', startTime, mergedConfig);
            }
            
            // 4. 应用变形强度
            const adjustedPairs = this.applyIntensity(
                matchingResult.controlPairs,
                mergedConfig.intensity
            );
            
            // 5. 内容分析（纹理保护）
            const step5Start = performance.now();
            const contentAnalysis = await this.contentAnalyzer.analyze(imageBuffer, sourceContour);
            console.log(`  [Step 5] 内容分析完成, ${(performance.now() - step5Start).toFixed(0)}ms`);
            
            // 6. 计算位移场
            const step6Start = performance.now();
            const qualitySettings = QUALITY_SETTINGS[mergedConfig.quality];
            let displacement = this.mlsDeformation.computeDisplacementField(
                width,
                height,
                adjustedPairs,
                qualitySettings.gridSize
            );
            console.log(`  [Step 6] 位移场计算完成, ${(performance.now() - step6Start).toFixed(0)}ms`);
            
            // 7. 应用内容保护
            const step7Start = performance.now();
            if (mergedConfig.contentProtection > 0 && contentAnalysis.hasPattern) {
                displacement = this.applyContentProtection(
                    displacement,
                    contentAnalysis.patternMask,
                    mergedConfig.contentProtection
                );
                console.log(`  [Step 7] 内容保护已应用`);
            }
            
            // 8. 应用平滑度
            if (mergedConfig.smoothness > 0) {
                displacement = this.smoothDisplacement(displacement, mergedConfig.smoothness);
            }
            console.log(`  [Step 7] 后处理完成, ${(performance.now() - step7Start).toFixed(0)}ms`);
            
            // 9. 应用变形
            const step9Start = performance.now();
            const morphedBuffer = await this.applyDisplacement(imageBuffer, displacement);
            console.log(`  [Step 9] 变形应用完成, ${(performance.now() - step9Start).toFixed(0)}ms`);
            
            // 10. 编码结果
            const resultBase64 = await this.encodeResult(morphedBuffer, width, height);
            
            const totalTime = performance.now() - startTime;
            console.log(`[EnhancedMorphExecutor] ✅ 完成, 总耗时 ${totalTime.toFixed(0)}ms`);
            
            return {
                success: true,
                morphedImageBase64: resultBase64,
                width,
                height,
                processingTime: totalTime,
                regionAnalysis: {
                    source: sourceAnalysis.regions,
                    target: targetAnalysis.regions,
                    cuffAnalysis: sourceAnalysis.cuffAnalysis
                },
                matchingResult,
                contentAnalysis,
                appliedConfig: mergedConfig
            };
            
        } catch (error: any) {
            console.error('[EnhancedMorphExecutor] 错误:', error.message);
            return this.createErrorResult(error.message, startTime, mergedConfig);
        }
    }
    
    /**
     * 解码图像
     */
    private async decodeImage(base64: string): Promise<Buffer> {
        // 处理不同格式
        if (base64.startsWith('RAW:') || base64.startsWith('RGBA:')) {
            const parts = base64.split(':');
            const width = parseInt(parts[1]);
            const height = parseInt(parts[2]);
            const channels = base64.startsWith('RAW:') ? parseInt(parts[3]) as 3 | 4 : 4;
            const b64Data = base64.startsWith('RAW:') ? parts.slice(4).join(':') : parts.slice(3).join(':');
            const rawBuffer = Buffer.from(b64Data, 'base64');
            
            return sharp(rawBuffer, {
                raw: { width, height, channels }
            }).png().toBuffer();
        }
        
        // 标准 base64
        let cleanBase64 = base64;
        if (base64.includes(',')) {
            cleanBase64 = base64.split(',')[1];
        }
        return Buffer.from(cleanBase64, 'base64');
    }
    
    /**
     * 应用变形强度
     */
    private applyIntensity(
        pairs: ControlPointPair[],
        intensity: number
    ): ControlPointPair[] {
        return pairs.map(pair => {
            const dx = pair.target.x - pair.source.x;
            const dy = pair.target.y - pair.source.y;
            
            return {
                source: pair.source,
                target: {
                    x: pair.source.x + dx * intensity,
                    y: pair.source.y + dy * intensity
                },
                weight: pair.weight
            };
        });
    }
    
    /**
     * 应用内容保护
     */
    private applyContentProtection(
        displacement: DisplacementField,
        patternMask: Uint8Array | null,
        protectionLevel: number
    ): DisplacementField {
        if (!patternMask) return displacement;
        
        const { width, height, dx, dy } = displacement;
        const protectedDx = new Float32Array(dx);
        const protectedDy = new Float32Array(dy);
        
        for (let i = 0; i < patternMask.length; i++) {
            // 纹理区域降低变形
            const maskValue = patternMask[i] / 255;
            const reduction = 1 - maskValue * protectionLevel;
            
            protectedDx[i] = dx[i] * reduction;
            protectedDy[i] = dy[i] * reduction;
        }
        
        return { width, height, dx: protectedDx, dy: protectedDy };
    }
    
    /**
     * 平滑位移场
     */
    private smoothDisplacement(
        displacement: DisplacementField,
        smoothness: number
    ): DisplacementField {
        const { width, height, dx, dy } = displacement;
        const kernelSize = Math.max(3, Math.floor(smoothness * 7));
        const halfKernel = Math.floor(kernelSize / 2);
        
        const smoothedDx = new Float32Array(width * height);
        const smoothedDy = new Float32Array(width * height);
        
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                let sumDx = 0, sumDy = 0, count = 0;
                
                for (let ky = -halfKernel; ky <= halfKernel; ky++) {
                    for (let kx = -halfKernel; kx <= halfKernel; kx++) {
                        const nx = x + kx;
                        const ny = y + ky;
                        
                        if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                            const idx = ny * width + nx;
                            sumDx += dx[idx];
                            sumDy += dy[idx];
                            count++;
                        }
                    }
                }
                
                const idx = y * width + x;
                smoothedDx[idx] = count > 0 ? sumDx / count : dx[idx];
                smoothedDy[idx] = count > 0 ? sumDy / count : dy[idx];
            }
        }
        
        // 混合原始和平滑结果
        for (let i = 0; i < dx.length; i++) {
            smoothedDx[i] = dx[i] * (1 - smoothness) + smoothedDx[i] * smoothness;
            smoothedDy[i] = dy[i] * (1 - smoothness) + smoothedDy[i] * smoothness;
        }
        
        return { width, height, dx: smoothedDx, dy: smoothedDy };
    }
    
    /**
     * 应用位移场到图像
     */
    private async applyDisplacement(
        imageBuffer: Buffer,
        displacement: DisplacementField
    ): Promise<Buffer> {
        const { width, height, dx, dy } = displacement;
        
        // 获取原始像素
        const rawData = await sharp(imageBuffer)
            .ensureAlpha()
            .raw()
            .toBuffer();
        
        const channels = 4;
        const result = Buffer.alloc(width * height * channels);
        
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const idx = y * width + x;
                
                // 反向映射
                const srcX = x - dx[idx];
                const srcY = y - dy[idx];
                
                // 双线性插值
                const x0 = Math.floor(srcX);
                const y0 = Math.floor(srcY);
                const x1 = x0 + 1;
                const y1 = y0 + 1;
                
                const fx = srcX - x0;
                const fy = srcY - y0;
                
                for (let c = 0; c < channels; c++) {
                    let value = 0;
                    
                    if (x0 >= 0 && x0 < width && y0 >= 0 && y0 < height) {
                        value += rawData[(y0 * width + x0) * channels + c] * (1 - fx) * (1 - fy);
                    }
                    if (x1 >= 0 && x1 < width && y0 >= 0 && y0 < height) {
                        value += rawData[(y0 * width + x1) * channels + c] * fx * (1 - fy);
                    }
                    if (x0 >= 0 && x0 < width && y1 >= 0 && y1 < height) {
                        value += rawData[(y1 * width + x0) * channels + c] * (1 - fx) * fy;
                    }
                    if (x1 >= 0 && x1 < width && y1 >= 0 && y1 < height) {
                        value += rawData[(y1 * width + x1) * channels + c] * fx * fy;
                    }
                    
                    result[idx * channels + c] = Math.round(Math.max(0, Math.min(255, value)));
                }
            }
        }
        
        return sharp(result, { raw: { width, height, channels } })
            .png()
            .toBuffer();
    }
    
    /**
     * 编码结果
     */
    private async encodeResult(
        imageBuffer: Buffer,
        width: number,
        height: number
    ): Promise<string> {
        // 返回 PNG base64
        const pngBuffer = await sharp(imageBuffer).png().toBuffer();
        return `data:image/png;base64,${pngBuffer.toString('base64')}`;
    }
    
    /**
     * 创建错误结果
     */
    private createErrorResult(
        error: string,
        startTime: number,
        config: EnhancedMorphConfig
    ): EnhancedMorphResult {
        return {
            success: false,
            error,
            processingTime: performance.now() - startTime,
            appliedConfig: config
        };
    }
}

// 单例
let executorInstance: EnhancedMorphExecutor | null = null;

export function getEnhancedMorphExecutor(): EnhancedMorphExecutor {
    if (!executorInstance) {
        executorInstance = new EnhancedMorphExecutor();
    }
    return executorInstance;
}
