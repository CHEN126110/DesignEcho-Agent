/**
 * MLS (Moving Least Squares) 图像变形服务
 * 
 * 基于控制点对实现图像的平滑变形，保持局部形状特征
 */

import sharp from 'sharp';
import { ControlPointPair, Point2D } from './contour-analysis-service';

export interface MLSWarpOptions {
    alpha?: number;       // 变形强度 (0-1)，默认 1
    gridSize?: number;    // 网格大小，默认 20
    rigidity?: number;    // 刚性系数 (0-1)，越大变形越刚性
}

export interface MLSWarpResult {
    success: boolean;
    warpedImage?: Buffer;
    warpedImageBase64?: string;
    width?: number;
    height?: number;
    error?: string;
    processingTime?: number;
}

/**
 * MLS 变形服务
 */
export class MLSWarpService {
    private static instance: MLSWarpService;
    
    static getInstance(): MLSWarpService {
        if (!MLSWarpService.instance) {
            MLSWarpService.instance = new MLSWarpService();
        }
        return MLSWarpService.instance;
    }
    
    /**
     * 对图像应用 MLS 变形
     * @param imageBase64 - 输入图像的 Base64 数据
     * @param controlPoints - 控制点对数组
     * @param options - 变形选项
     */
    async warpImage(
        imageBase64: string,
        controlPoints: ControlPointPair[],
        options: MLSWarpOptions = {}
    ): Promise<MLSWarpResult> {
        const startTime = Date.now();
        const alpha = options.alpha ?? 1;
        const gridSize = options.gridSize ?? 20;
        const rigidity = options.rigidity ?? 0.5;
        
        console.log('[MLSWarp] 开始图像变形');
        console.log(`  控制点: ${controlPoints.length} 对`);
        console.log(`  alpha: ${alpha}, gridSize: ${gridSize}, rigidity: ${rigidity}`);
        
        try {
            // 1. 解码图像
            let base64Data = imageBase64;
            if (base64Data.includes(',')) {
                base64Data = base64Data.split(',')[1];
            }
            const imageBuffer = Buffer.from(base64Data, 'base64');
            
            const image = sharp(imageBuffer);
            const metadata = await image.metadata();
            const width = metadata.width || 512;
            const height = metadata.height || 512;
            const channels = metadata.channels || 4;
            
            console.log(`  图像尺寸: ${width}x${height}, 通道: ${channels}`);
            
            // 获取原始像素数据
            const { data: pixels, info } = await image
                .ensureAlpha()
                .raw()
                .toBuffer({ resolveWithObject: true });
            
            // 2. 计算变形映射（使用 MLS 仿射变换）
            console.log('  计算 MLS 变形映射...');
            const warpMap = this.computeMLSWarpMap(
                width, height, 
                controlPoints, 
                { alpha, gridSize, rigidity }
            );
            
            // 3. 应用变形映射到像素
            console.log('  应用变形到像素...');
            const warpedPixels = this.applyWarpMap(
                pixels, width, height, 4, warpMap
            );
            
            // 4. 编码结果图像
            console.log('  编码输出图像...');
            const warpedBuffer = await sharp(warpedPixels, {
                raw: { width, height, channels: 4 }
            }).png().toBuffer();
            
            const processingTime = Date.now() - startTime;
            console.log(`  ✓ 变形完成，耗时 ${processingTime}ms`);
            
            return {
                success: true,
                warpedImage: warpedBuffer,
                warpedImageBase64: `data:image/png;base64,${warpedBuffer.toString('base64')}`,
                width,
                height,
                processingTime
            };
            
        } catch (error: any) {
            console.error('[MLSWarp] 变形失败:', error);
            return {
                success: false,
                error: error.message,
                processingTime: Date.now() - startTime
            };
        }
    }
    
    /**
     * 计算 MLS 变形映射
     * 使用仿射变换的 MLS 方法
     */
    private computeMLSWarpMap(
        width: number,
        height: number,
        controlPoints: ControlPointPair[],
        options: { alpha: number; gridSize: number; rigidity: number }
    ): Float32Array {
        const { alpha, gridSize, rigidity } = options;
        
        // 创建变形映射（每个像素存储 dx, dy）
        const warpMap = new Float32Array(width * height * 2);
        
        if (controlPoints.length < 2) {
            console.warn('[MLSWarp] 控制点太少，跳过变形');
            return warpMap;
        }
        
        // 预计算控制点的源和目标位置
        const srcPoints = controlPoints.map(cp => cp.source);
        const dstPoints = controlPoints.map(cp => cp.target);
        const weights = controlPoints.map(cp => cp.weight ?? 1);
        
        // 使用网格加速：先在稀疏网格上计算，然后插值
        const gridW = Math.ceil(width / gridSize);
        const gridH = Math.ceil(height / gridSize);
        const gridWarpX = new Float32Array((gridW + 1) * (gridH + 1));
        const gridWarpY = new Float32Array((gridW + 1) * (gridH + 1));
        
        // 计算网格点的变形
        for (let gy = 0; gy <= gridH; gy++) {
            for (let gx = 0; gx <= gridW; gx++) {
                const px = Math.min(gx * gridSize, width - 1);
                const py = Math.min(gy * gridSize, height - 1);
                
                const [dx, dy] = this.computeMLSDeformation(
                    px, py, srcPoints, dstPoints, weights, alpha, rigidity
                );
                
                const gridIdx = gy * (gridW + 1) + gx;
                gridWarpX[gridIdx] = dx;
                gridWarpY[gridIdx] = dy;
            }
        }
        
        // 双线性插值到所有像素
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                // 找到网格位置
                const gx = x / gridSize;
                const gy = y / gridSize;
                const gx0 = Math.floor(gx);
                const gy0 = Math.floor(gy);
                const gx1 = Math.min(gx0 + 1, gridW);
                const gy1 = Math.min(gy0 + 1, gridH);
                
                const tx = gx - gx0;
                const ty = gy - gy0;
                
                // 双线性插值
                const idx00 = gy0 * (gridW + 1) + gx0;
                const idx10 = gy0 * (gridW + 1) + gx1;
                const idx01 = gy1 * (gridW + 1) + gx0;
                const idx11 = gy1 * (gridW + 1) + gx1;
                
                const dx = (1 - tx) * (1 - ty) * gridWarpX[idx00] +
                           tx * (1 - ty) * gridWarpX[idx10] +
                           (1 - tx) * ty * gridWarpX[idx01] +
                           tx * ty * gridWarpX[idx11];
                
                const dy = (1 - tx) * (1 - ty) * gridWarpY[idx00] +
                           tx * (1 - ty) * gridWarpY[idx10] +
                           (1 - tx) * ty * gridWarpY[idx01] +
                           tx * ty * gridWarpY[idx11];
                
                const pixelIdx = (y * width + x) * 2;
                warpMap[pixelIdx] = dx;
                warpMap[pixelIdx + 1] = dy;
            }
        }
        
        return warpMap;
    }
    
    /**
     * 计算单点的 MLS 仿射变形
     */
    private computeMLSDeformation(
        x: number, y: number,
        srcPoints: Point2D[],
        dstPoints: Point2D[],
        weights: number[],
        alpha: number,
        rigidity: number
    ): [number, number] {
        const n = srcPoints.length;
        
        // 计算权重 w_i = weight_i / |p_i - v|^(2*alpha)
        const w: number[] = [];
        let sumW = 0;
        const epsilon = 0.01;
        
        for (let i = 0; i < n; i++) {
            const dx = srcPoints[i].x - x;
            const dy = srcPoints[i].y - y;
            const d2 = dx * dx + dy * dy + epsilon;
            const wi = weights[i] / Math.pow(d2, alpha);
            w.push(wi);
            sumW += wi;
        }
        
        if (sumW < epsilon) {
            return [0, 0];
        }
        
        // 归一化权重
        for (let i = 0; i < n; i++) {
            w[i] /= sumW;
        }
        
        // 计算加权质心
        let pStarX = 0, pStarY = 0;
        let qStarX = 0, qStarY = 0;
        
        for (let i = 0; i < n; i++) {
            pStarX += w[i] * srcPoints[i].x;
            pStarY += w[i] * srcPoints[i].y;
            qStarX += w[i] * dstPoints[i].x;
            qStarY += w[i] * dstPoints[i].y;
        }
        
        // 计算相对位置
        const pHat: Point2D[] = [];
        const qHat: Point2D[] = [];
        
        for (let i = 0; i < n; i++) {
            pHat.push({
                x: srcPoints[i].x - pStarX,
                y: srcPoints[i].y - pStarY
            });
            qHat.push({
                x: dstPoints[i].x - qStarX,
                y: dstPoints[i].y - qStarY
            });
        }
        
        // 计算仿射变换矩阵（简化版：只考虑平移和缩放）
        // 完整的 MLS 使用 2x2 变换矩阵，这里简化处理
        
        // 计算目标位置
        const vx = x - pStarX;
        const vy = y - pStarY;
        
        // 应用刚性约束：混合仿射和刚性变换
        let fvx = 0, fvy = 0;
        
        // 仿射部分（基于加权最小二乘）
        let mu_s = 0;
        for (let i = 0; i < n; i++) {
            const phx = pHat[i].x;
            const phy = pHat[i].y;
            mu_s += w[i] * (phx * phx + phy * phy);
        }
        
        if (mu_s > epsilon) {
            let A00 = 0, A01 = 0, A10 = 0, A11 = 0;
            
            for (let i = 0; i < n; i++) {
                const phx = pHat[i].x;
                const phy = pHat[i].y;
                const qhx = qHat[i].x;
                const qhy = qHat[i].y;
                
                // 构建变换矩阵
                A00 += w[i] * phx * qhx;
                A01 += w[i] * phx * qhy;
                A10 += w[i] * phy * qhx;
                A11 += w[i] * phy * qhy;
            }
            
            // 归一化
            A00 /= mu_s; A01 /= mu_s;
            A10 /= mu_s; A11 /= mu_s;
            
            // 应用变换
            fvx = A00 * vx + A10 * vy + qStarX;
            fvy = A01 * vx + A11 * vy + qStarY;
        } else {
            // 直接平移
            fvx = vx + qStarX;
            fvy = vy + qStarY;
        }
        
        // 混合刚性变换（保持形状）
        const rigidX = vx + qStarX;
        const rigidY = vy + qStarY;
        
        const finalX = (1 - rigidity) * fvx + rigidity * rigidX;
        const finalY = (1 - rigidity) * fvy + rigidity * rigidY;
        
        return [finalX - x, finalY - y];
    }
    
    /**
     * 应用变形映射到像素数据
     */
    private applyWarpMap(
        pixels: Buffer,
        width: number,
        height: number,
        channels: number,
        warpMap: Float32Array
    ): Buffer {
        const result = Buffer.alloc(width * height * channels);
        
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const mapIdx = (y * width + x) * 2;
                const dx = warpMap[mapIdx];
                const dy = warpMap[mapIdx + 1];
                
                // 反向映射：目标位置 -> 源位置
                const srcX = x - dx;
                const srcY = y - dy;
                
                // 双线性插值采样
                const color = this.bilinearSample(pixels, width, height, channels, srcX, srcY);
                
                const dstIdx = (y * width + x) * channels;
                for (let c = 0; c < channels; c++) {
                    result[dstIdx + c] = color[c];
                }
            }
        }
        
        return result;
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
    ): number[] {
        const x0 = Math.floor(x);
        const y0 = Math.floor(y);
        const x1 = x0 + 1;
        const y1 = y0 + 1;
        
        const tx = x - x0;
        const ty = y - y0;
        
        const result: number[] = [];
        
        for (let c = 0; c < channels; c++) {
            const v00 = this.getPixel(pixels, width, height, channels, x0, y0, c);
            const v10 = this.getPixel(pixels, width, height, channels, x1, y0, c);
            const v01 = this.getPixel(pixels, width, height, channels, x0, y1, c);
            const v11 = this.getPixel(pixels, width, height, channels, x1, y1, c);
            
            const value = (1 - tx) * (1 - ty) * v00 +
                          tx * (1 - ty) * v10 +
                          (1 - tx) * ty * v01 +
                          tx * ty * v11;
            
            result.push(Math.round(Math.max(0, Math.min(255, value))));
        }
        
        return result;
    }
    
    /**
     * 安全获取像素值
     */
    private getPixel(
        pixels: Buffer,
        width: number,
        height: number,
        channels: number,
        x: number,
        y: number,
        channel: number
    ): number {
        // 边界处理（镜像）
        x = Math.max(0, Math.min(width - 1, x));
        y = Math.max(0, Math.min(height - 1, y));
        
        const idx = (y * width + x) * channels + channel;
        return pixels[idx] || 0;
    }
}
