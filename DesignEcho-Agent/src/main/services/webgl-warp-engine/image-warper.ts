/**
 * 图像变形器
 * 
 * 使用 Sharp 进行 CPU 端图像变形
 * 后续可升级为 WebGL GPU 加速
 */

import sharp from 'sharp';
import { Point2D, ControlPointPair, WarpConfig, WarpRequest, WarpResult, DEFAULT_WARP_CONFIG } from './types';
import { TPSSolver } from './tps-solver';

/**
 * 图像变形器
 */
export class ImageWarper {
    private tpsSolver: TPSSolver;
    
    constructor() {
        this.tpsSolver = new TPSSolver();
    }
    
    /**
     * 执行图像变形
     */
    async warp(request: WarpRequest): Promise<WarpResult> {
        const startTime = performance.now();
        
        try {
            const config: WarpConfig = { ...DEFAULT_WARP_CONFIG, ...request.config };
            
            console.log(`[ImageWarper] 开始变形: ${request.width}x${request.height}, ${request.controlPoints.length} 个控制点`);
            
            // 1. 解码输入图像
            const inputBuffer = Buffer.from(request.imageBase64, 'base64');
            const image = sharp(inputBuffer);
            const metadata = await image.metadata();
            
            const width = request.width || metadata.width || 0;
            const height = request.height || metadata.height || 0;
            
            if (width === 0 || height === 0) {
                throw new Error('无法获取图像尺寸');
            }
            
            // 2. 计算 TPS 权重
            console.log('[ImageWarper] 计算 TPS 权重...');
            const tpsWeights = this.tpsSolver.solve(request.controlPoints);
            
            // 3. 生成位移场
            console.log('[ImageWarper] 生成位移场...');
            const gridSize = Math.max(5, Math.min(20, Math.floor(Math.min(width, height) / 50)));
            const displacement = this.tpsSolver.generateDisplacementField(width, height, gridSize, tpsWeights);
            
            // 4. 应用变形
            console.log('[ImageWarper] 应用变形...');
            
            // 获取原始像素数据
            const { data: srcPixels, info } = await image
                .ensureAlpha()
                .raw()
                .toBuffer({ resolveWithObject: true });
            
            const channels = 4; // RGBA
            const srcWidth = info.width;
            const srcHeight = info.height;
            
            // 创建输出缓冲区
            const dstPixels = Buffer.alloc(srcWidth * srcHeight * channels);
            
            // 反向映射变形
            for (let dstY = 0; dstY < srcHeight; dstY++) {
                for (let dstX = 0; dstX < srcWidth; dstX++) {
                    // 计算源坐标（使用位移场插值）
                    const { srcX, srcY } = this.interpolateDisplacement(
                        dstX, dstY,
                        displacement.dx, displacement.dy,
                        displacement.gridCols, displacement.gridRows,
                        gridSize
                    );
                    
                    // 双线性插值采样
                    const color = this.bilinearSample(srcPixels, srcWidth, srcHeight, channels, srcX, srcY);
                    
                    // 写入目标像素
                    const dstIdx = (dstY * srcWidth + dstX) * channels;
                    dstPixels[dstIdx] = color.r;
                    dstPixels[dstIdx + 1] = color.g;
                    dstPixels[dstIdx + 2] = color.b;
                    dstPixels[dstIdx + 3] = color.a;
                }
            }
            
            // 5. 编码输出图像
            console.log('[ImageWarper] 编码输出...');
            const outputBuffer = await sharp(dstPixels, {
                raw: { width: srcWidth, height: srcHeight, channels: 4 }
            })
                .png({ quality: config.quality })
                .toBuffer();
            
            const outputBase64 = outputBuffer.toString('base64');
            
            const duration = performance.now() - startTime;
            console.log(`[ImageWarper] 变形完成，耗时: ${duration.toFixed(0)}ms`);
            
            return {
                success: true,
                imageBase64: outputBase64,
                qualityScore: this.calculateQualityScore(request.controlPoints),
                duration
            };
            
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            console.error('[ImageWarper] 变形失败:', errorMsg);
            
            return {
                success: false,
                error: errorMsg,
                duration: performance.now() - startTime
            };
        }
    }
    
    /**
     * 从位移场插值获取源坐标
     */
    private interpolateDisplacement(
        x: number, y: number,
        dx: Float32Array, dy: Float32Array,
        gridCols: number, gridRows: number,
        gridSize: number
    ): { srcX: number; srcY: number } {
        // 计算在网格中的位置
        const gx = x / gridSize;
        const gy = y / gridSize;
        
        const gx0 = Math.floor(gx);
        const gy0 = Math.floor(gy);
        const gx1 = Math.min(gx0 + 1, gridCols - 1);
        const gy1 = Math.min(gy0 + 1, gridRows - 1);
        
        const fx = gx - gx0;
        const fy = gy - gy0;
        
        // 获取四个角的位移
        const idx00 = gy0 * gridCols + gx0;
        const idx01 = gy0 * gridCols + gx1;
        const idx10 = gy1 * gridCols + gx0;
        const idx11 = gy1 * gridCols + gx1;
        
        // 双线性插值位移
        const dispX = 
            dx[idx00] * (1 - fx) * (1 - fy) +
            dx[idx01] * fx * (1 - fy) +
            dx[idx10] * (1 - fx) * fy +
            dx[idx11] * fx * fy;
        
        const dispY = 
            dy[idx00] * (1 - fx) * (1 - fy) +
            dy[idx01] * fx * (1 - fy) +
            dy[idx10] * (1 - fx) * fy +
            dy[idx11] * fx * fy;
        
        // 反向映射：目标位置减去位移得到源位置
        return {
            srcX: x - dispX,
            srcY: y - dispY
        };
    }
    
    /**
     * 双线性插值采样
     */
    private bilinearSample(
        pixels: Buffer,
        width: number,
        height: number,
        channels: number,
        x: number,
        y: number
    ): { r: number; g: number; b: number; a: number } {
        // 边界处理
        x = Math.max(0, Math.min(width - 1.001, x));
        y = Math.max(0, Math.min(height - 1.001, y));
        
        const x0 = Math.floor(x);
        const y0 = Math.floor(y);
        const x1 = Math.min(x0 + 1, width - 1);
        const y1 = Math.min(y0 + 1, height - 1);
        
        const fx = x - x0;
        const fy = y - y0;
        
        // 获取四个角的像素
        const getPixel = (px: number, py: number) => {
            const idx = (py * width + px) * channels;
            return {
                r: pixels[idx] || 0,
                g: pixels[idx + 1] || 0,
                b: pixels[idx + 2] || 0,
                a: pixels[idx + 3] || 255
            };
        };
        
        const p00 = getPixel(x0, y0);
        const p01 = getPixel(x1, y0);
        const p10 = getPixel(x0, y1);
        const p11 = getPixel(x1, y1);
        
        // 双线性插值
        const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
        
        return {
            r: Math.round(lerp(lerp(p00.r, p01.r, fx), lerp(p10.r, p11.r, fx), fy)),
            g: Math.round(lerp(lerp(p00.g, p01.g, fx), lerp(p10.g, p11.g, fx), fy)),
            b: Math.round(lerp(lerp(p00.b, p01.b, fx), lerp(p10.b, p11.b, fx), fy)),
            a: Math.round(lerp(lerp(p00.a, p01.a, fx), lerp(p10.a, p11.a, fx), fy))
        };
    }
    
    /**
     * 计算变形质量评分
     */
    private calculateQualityScore(controlPoints: ControlPointPair[]): number {
        // 基于控制点数量和分布计算质量
        const n = controlPoints.length;
        
        // 控制点数量分数 (3-30 个最佳)
        let countScore = 0;
        if (n >= 3 && n <= 30) {
            countScore = 1 - Math.abs(n - 15) / 15;
        } else if (n > 30) {
            countScore = Math.max(0, 1 - (n - 30) / 30);
        }
        
        // 控制点分布分数 (检查是否均匀分布)
        let distributionScore = 0.5; // 默认中等
        
        if (n >= 3) {
            // 计算控制点的标准差
            const xs = controlPoints.map(p => p.source.x);
            const ys = controlPoints.map(p => p.source.y);
            
            const avgX = xs.reduce((a, b) => a + b, 0) / n;
            const avgY = ys.reduce((a, b) => a + b, 0) / n;
            
            const stdX = Math.sqrt(xs.reduce((sum, x) => sum + (x - avgX) ** 2, 0) / n);
            const stdY = Math.sqrt(ys.reduce((sum, y) => sum + (y - avgY) ** 2, 0) / n);
            
            // 标准差越大，分布越均匀
            const avgStd = (stdX + stdY) / 2;
            distributionScore = Math.min(1, avgStd / 200);
        }
        
        // 综合评分
        return Math.round((countScore * 0.4 + distributionScore * 0.6) * 100);
    }
}

export default ImageWarper;
