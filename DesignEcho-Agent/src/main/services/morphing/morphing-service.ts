/**
 * 形态变形服务
 * 
 * 主服务类，协调所有变形相关功能
 */

import sharp from 'sharp';
import * as crypto from 'crypto';
import {
    Point2D,
    MorphingConfig,
    MorphRequest,
    MorphResult,
    DisplacementField,
    DEFAULT_MORPHING_CONFIG,
    QUALITY_PRESETS,
    MorphingLogEntry
} from './types';
import { DistanceFieldCalculator } from './distance-field';
import { MLSDeformation } from './mls-deformation';
import { ContentAnalyzer } from './content-analyzer';

// 缓存变形结果，用于分块传输
const morphResultCache = new Map<string, { data: string; createdAt: number }>();
const CACHE_EXPIRY_MS = 5 * 60 * 1000; // 5 分钟过期

// 单例实例
let morphingServiceInstance: MorphingService | null = null;

export function getMorphingService(): MorphingService {
    if (!morphingServiceInstance) {
        morphingServiceInstance = new MorphingService();
    }
    return morphingServiceInstance;
}

export class MorphingService {
    private distanceFieldCalculator: DistanceFieldCalculator;
    private mlsDeformation: MLSDeformation;
    private contentAnalyzer: ContentAnalyzer;
    private logs: MorphingLogEntry[] = [];
    
    constructor() {
        this.distanceFieldCalculator = new DistanceFieldCalculator();
        this.mlsDeformation = new MLSDeformation();
        this.contentAnalyzer = new ContentAnalyzer();
        
        console.log('[MorphingService] 服务已初始化');
    }
    
    /**
     * 执行形态变形
     */
    async executeMorphing(request: MorphRequest): Promise<MorphResult> {
        this.logs = [];
        this.log('info', 'start', '开始形态变形');
        const startTime = performance.now();
        
        try {
            // 合并配置
            const config = this.mergeConfig(request.config);
            this.log('info', 'config', '配置', { 
                qualityPreset: config.qualityPreset,
                edgeBandWidth: config.edgeBandWidth,
                gridSize: config.gridSize
            });
            
            // 1. 解码图像（支持 RAW/RGBA 格式和标准 Base64）
            const step1Start = performance.now();
            this.log('info', 'decode', '解码图像...');
            
            let imageBuffer: Buffer;
            let width: number;
            let height: number;
            
            if (request.sourceImageBase64.startsWith('RAW:')) {
                // 解析新的 RAW 格式: "RAW:width:height:channels:base64data"
                const parts = request.sourceImageBase64.split(':');
                width = parseInt(parts[1]);
                height = parseInt(parts[2]);
                const channels = parseInt(parts[3]) as 3 | 4;
                const b64Data = parts.slice(4).join(':');
                const rawBuffer = Buffer.from(b64Data, 'base64');
                
                this.log('info', 'decode', `解析 RAW 格式: ${width}x${height}, 通道: ${channels}, 数据大小: ${rawBuffer.length}`);
                
                // 转换原始数据为 sharp 可用的格式
                imageBuffer = await sharp(rawBuffer, {
                    raw: { width, height, channels }
                }).png().toBuffer();
                
                this.log('info', 'decode', `转换完成, PNG 大小: ${imageBuffer.length}`);
            } else if (request.sourceImageBase64.startsWith('RGBA:')) {
                // 旧的 RGBA 格式（向后兼容）: "RGBA:width:height:base64data"
                const parts = request.sourceImageBase64.split(':');
                width = parseInt(parts[1]);
                height = parseInt(parts[2]);
                const b64Data = parts.slice(3).join(':');
                const rawBuffer = Buffer.from(b64Data, 'base64');
                
                // 转换 RGBA 原始数据为 sharp 可用的格式
                imageBuffer = await sharp(rawBuffer, {
                    raw: { width, height, channels: 4 }
                }).png().toBuffer();
                
                this.log('info', 'decode', `解析 RGBA 格式: ${width}x${height}`);
            } else {
                // 标准 Base64 PNG/JPG
                imageBuffer = Buffer.from(request.sourceImageBase64, 'base64');
                const metadata = await sharp(imageBuffer).metadata();
                width = metadata.width || 0;
                height = metadata.height || 0;
            }
            
            this.log('perf', 'decode', `图像尺寸 ${width}x${height}`, {
                duration: performance.now() - step1Start
            });
            
            // 2. 内容分析
            const step2Start = performance.now();
            this.log('info', 'analysis', '分析内容...');
            
            let contentAnalysis;
            if (config.detectPatterns || config.detectLace) {
                contentAnalysis = await this.contentAnalyzer.analyze(
                    imageBuffer,
                    request.sourceContour
                );
            } else {
                contentAnalysis = {
                    hasPattern: false,
                    patternMask: null,
                    patternComplexity: 0,
                    hasLace: false,
                    laceRegion: null,
                    laceConfidence: 0,
                    regions: { cuff: null, body: null, toe: null }
                };
            }
            
            const analysisTime = performance.now() - step2Start;
            this.log('perf', 'analysis', '内容分析完成', { 
                duration: analysisTime,
                hasPattern: contentAnalysis.hasPattern,
                hasLace: contentAnalysis.hasLace
            });
            
            // 3. 计算距离场
            const step3Start = performance.now();
            this.log('info', 'distanceField', '计算距离场...');
            
            const distanceField = this.distanceFieldCalculator.computeFromContour(
                width, height,
                request.sourceContour
            );
            
            const distanceFieldTime = performance.now() - step3Start;
            this.log('perf', 'distanceField', '距离场完成', { duration: distanceFieldTime });
            
            // 4. 生成变形权重图
            const step4Start = performance.now();
            this.log('info', 'weights', '生成变形权重...');
            
            let weights = this.distanceFieldCalculator.generateWeightMap(
                distanceField,
                config.edgeBandWidth,
                config.transitionWidth
            );
            
            // 应用内容保护
            if (contentAnalysis.patternMask && config.patternProtection > 0) {
                weights = this.applyPatternProtection(
                    weights,
                    contentAnalysis.patternMask,
                    config.patternProtection
                );
            }
            
            if (contentAnalysis.laceRegion) {
                weights = this.applyLaceProtection(weights, width, height, contentAnalysis.laceRegion);
            }
            
            this.log('perf', 'weights', '权重生成完成', { 
                duration: performance.now() - step4Start 
            });
            
            // 5. 生成控制点对
            const step5Start = performance.now();
            this.log('info', 'controlPoints', '生成控制点...');
            
            const controlPairs = this.mlsDeformation.generateControlPairs(
                request.sourceContour,
                request.targetContour,
                Math.max(30, request.sourceContour.length / 3)
            );
            
            this.log('perf', 'controlPoints', `生成 ${controlPairs.length} 个控制点`, {
                duration: performance.now() - step5Start
            });
            
            // 6. 计算位移场
            const step6Start = performance.now();
            this.log('info', 'displacement', '计算位移场...');
            
            let displacement = this.mlsDeformation.computeDisplacementField(
                width, height,
                controlPairs,
                config.gridSize
            );
            
            // 应用权重
            displacement = this.mlsDeformation.applyWeightedDisplacement(displacement, weights);
            
            const mlsTime = performance.now() - step6Start;
            this.log('perf', 'displacement', '位移场完成', { duration: mlsTime });
            
            // 7. 应用变形
            const step7Start = performance.now();
            this.log('info', 'warp', '应用变形...');
            
            const morphedBuffer = await this.applyWarp(imageBuffer, displacement, width, height);
            
            const warpTime = performance.now() - step7Start;
            this.log('perf', 'warp', '变形完成', { duration: warpTime });
            
            // 8. 后处理（锐化）并转换为 RGBA 格式
            const step8Start = performance.now();
            this.log('info', 'postprocess', '后处理...');
            
            // 先锐化
            const sharpenedBuffer = await sharp(morphedBuffer)
                .sharpen({ sigma: 0.5, m1: 1.0, m2: 2.0 })
                .ensureAlpha()
                .raw()
                .toBuffer({ resolveWithObject: true });
            
            // 转换为 RGBA 格式字符串: "RGBA:width:height:base64data"
            const rgbaBase64 = `RGBA:${width}:${height}:${sharpenedBuffer.data.toString('base64')}`;
            
            this.log('perf', 'postprocess', '后处理完成', {
                duration: performance.now() - step8Start,
                outputSize: `${(rgbaBase64.length / 1024).toFixed(1)}KB`
            });
            
            // 完成
            const totalTime = performance.now() - startTime;
            this.log('info', 'complete', `✅ 变形完成, 总耗时 ${totalTime.toFixed(2)}ms`);
            
            // 由于 WebSocket 消息大小限制，将大数据保存到缓存，返回 ID 供分块获取
            const resultId = crypto.randomUUID();
            morphResultCache.set(resultId, {
                data: rgbaBase64,
                createdAt: Date.now()
            });
            
            // 清理过期缓存
            this.cleanupCache();
            
            this.log('info', 'cache', `结果已缓存, ID: ${resultId}, 大小: ${(rgbaBase64.length / 1024).toFixed(1)}KB`);
            
            return {
                success: true,
                resultId,  // 用于分块获取数据
                width,
                height,
                dataSize: rgbaBase64.length,
                contentAnalysis,
                processingTime: totalTime,
                stats: {
                    distanceFieldTime,
                    contentAnalysisTime: analysisTime,
                    mlsTime,
                    warpTime
                }
            };
            
        } catch (error: any) {
            const totalTime = performance.now() - startTime;
            this.log('error', 'error', `变形失败: ${error.message}`, {
                stack: error.stack
            });
            
            return {
                success: false,
                processingTime: totalTime,
                error: error.message
            };
        }
    }
    
    /**
     * 获取缓存的变形结果（分块）
     * @param resultId 结果 ID
     * @param chunkIndex 块索引
     * @param chunkSize 块大小（字节），默认 100KB
     */
    getResultChunk(resultId: string, chunkIndex: number, chunkSize: number = 100 * 1024): {
        success: boolean;
        chunk?: string;
        chunkIndex: number;
        totalChunks: number;
        isLast: boolean;
        error?: string;
    } {
        const cached = morphResultCache.get(resultId);
        
        if (!cached) {
            return {
                success: false,
                chunkIndex: 0,
                totalChunks: 0,
                isLast: true,
                error: '结果不存在或已过期'
            };
        }
        
        const data = cached.data;
        const totalChunks = Math.ceil(data.length / chunkSize);
        const start = chunkIndex * chunkSize;
        const end = Math.min(start + chunkSize, data.length);
        const chunk = data.substring(start, end);
        const isLast = chunkIndex >= totalChunks - 1;
        
        this.log('info', 'chunk', `发送分块 ${chunkIndex + 1}/${totalChunks}, 大小: ${(chunk.length / 1024).toFixed(1)}KB`);
        
        // 如果是最后一块，删除缓存
        if (isLast) {
            morphResultCache.delete(resultId);
            this.log('info', 'cache', `缓存已清理: ${resultId}`);
        }
        
        return {
            success: true,
            chunk,
            chunkIndex,
            totalChunks,
            isLast
        };
    }
    
    /**
     * 清理过期缓存
     */
    private cleanupCache(): void {
        const now = Date.now();
        let cleaned = 0;
        
        for (const [id, entry] of morphResultCache.entries()) {
            if (now - entry.createdAt > CACHE_EXPIRY_MS) {
                morphResultCache.delete(id);
                cleaned++;
            }
        }
        
        if (cleaned > 0) {
            this.log('info', 'cache', `清理了 ${cleaned} 个过期缓存`);
        }
    }
    
    /**
     * 合并配置
     */
    private mergeConfig(config: MorphingConfig): MorphingConfig {
        const base = { ...DEFAULT_MORPHING_CONFIG };
        
        // 应用质量预设
        if (config.qualityPreset && QUALITY_PRESETS[config.qualityPreset]) {
            Object.assign(base, QUALITY_PRESETS[config.qualityPreset]);
        }
        
        // 应用自定义配置
        return { ...base, ...config };
    }
    
    /**
     * 应用图案保护
     */
    private applyPatternProtection(
        weights: Float32Array,
        patternMask: Uint8Array,
        protection: number
    ): Float32Array {
        const result = new Float32Array(weights.length);
        
        for (let i = 0; i < weights.length; i++) {
            if (patternMask[i] > 0) {
                // 图案区域：减少变形权重
                result[i] = weights[i] * (1 - protection);
            } else {
                result[i] = weights[i];
            }
        }
        
        return result;
    }
    
    /**
     * 应用花边保护
     */
    private applyLaceProtection(
        weights: Float32Array,
        width: number,
        height: number,
        laceRegion: { x: number; y: number; width: number; height: number }
    ): Float32Array {
        const result = new Float32Array(weights);
        
        // 花边区域完全不变形
        for (let y = Math.floor(laceRegion.y); y < laceRegion.y + laceRegion.height && y < height; y++) {
            for (let x = Math.floor(laceRegion.x); x < laceRegion.x + laceRegion.width && x < width; x++) {
                if (x >= 0 && y >= 0) {
                    result[y * width + x] = 0;
                }
            }
        }
        
        return result;
    }
    
    /**
     * 应用变形
     */
    private async applyWarp(
        imageBuffer: Buffer,
        displacement: DisplacementField,
        width: number,
        height: number
    ): Promise<Buffer> {
        // 获取原始像素数据
        const { data, info } = await sharp(imageBuffer)
            .ensureAlpha()
            .raw()
            .toBuffer({ resolveWithObject: true });
        
        const channels = info.channels;
        const result = Buffer.alloc(width * height * channels);
        
        // 应用位移
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const idx = y * width + x;
                
                // 源坐标
                const srcX = x - displacement.dx[idx];
                const srcY = y - displacement.dy[idx];
                
                // 双线性插值采样
                this.sampleBilinear(data, result, srcX, srcY, x, y, width, height, channels);
            }
        }
        
        // 转回图像
        return sharp(result, {
            raw: { width, height, channels }
        }).png().toBuffer();
    }
    
    /**
     * 双线性插值采样
     */
    private sampleBilinear(
        src: Buffer,
        dst: Buffer,
        srcX: number,
        srcY: number,
        dstX: number,
        dstY: number,
        width: number,
        height: number,
        channels: number
    ): void {
        const x0 = Math.floor(srcX);
        const y0 = Math.floor(srcY);
        const x1 = Math.min(x0 + 1, width - 1);
        const y1 = Math.min(y0 + 1, height - 1);
        
        const fx = srcX - x0;
        const fy = srcY - y0;
        
        // 边界检查
        if (x0 < 0 || y0 < 0 || x0 >= width || y0 >= height) {
            // 超出边界，使用透明
            const dstIdx = (dstY * width + dstX) * channels;
            for (let c = 0; c < channels; c++) {
                dst[dstIdx + c] = 0;
            }
            return;
        }
        
        const idx00 = (y0 * width + Math.max(0, x0)) * channels;
        const idx10 = (y0 * width + x1) * channels;
        const idx01 = (Math.min(y1, height - 1) * width + Math.max(0, x0)) * channels;
        const idx11 = (Math.min(y1, height - 1) * width + x1) * channels;
        const dstIdx = (dstY * width + dstX) * channels;
        
        for (let c = 0; c < channels; c++) {
            const v00 = src[idx00 + c];
            const v10 = src[idx10 + c];
            const v01 = src[idx01 + c];
            const v11 = src[idx11 + c];
            
            const value = (1 - fx) * (1 - fy) * v00 +
                          fx * (1 - fy) * v10 +
                          (1 - fx) * fy * v01 +
                          fx * fy * v11;
            
            dst[dstIdx + c] = Math.round(value);
        }
    }
    
    /**
     * 记录日志
     */
    private log(level: MorphingLogEntry['level'], step: string, message: string, data?: any): void {
        const entry: MorphingLogEntry = {
            timestamp: new Date().toISOString(),
            level,
            step,
            message,
            data,
            duration: data?.duration
        };
        
        this.logs.push(entry);
        
        // 控制台输出
        const prefix = level === 'error' ? '❌' :
                       level === 'warn' ? '⚠️' :
                       level === 'perf' ? '⏱️' :
                       level === 'debug' ? '🔍' : 'ℹ️';
        
        const durationStr = data?.duration ? ` (${data.duration.toFixed(2)}ms)` : '';
        console.log(`[Morphing] ${prefix} [${step}] ${message}${durationStr}`);
    }
    
    /**
     * 获取日志
     */
    getLogs(): MorphingLogEntry[] {
        return [...this.logs];
    }
    
    /**
     * 导出日志报告
     */
    exportLogReport(): string {
        let report = '═══════════════════════════════════════════════════════════\n';
        report += '                 形态变形执行报告\n';
        report += '═══════════════════════════════════════════════════════════\n\n';
        
        for (const log of this.logs) {
            const prefix = log.level.toUpperCase().padEnd(5);
            const step = log.step.padEnd(15);
            const duration = log.duration ? ` (${log.duration.toFixed(2)}ms)` : '';
            report += `[${log.timestamp}] ${prefix} ${step} ${log.message}${duration}\n`;
            
            if (log.data && log.level !== 'perf') {
                report += `    ${JSON.stringify(log.data)}\n`;
            }
        }
        
        return report;
    }
}
