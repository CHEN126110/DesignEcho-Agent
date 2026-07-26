/**
 * 图像变形器
 * 使用 MLS 算法对图像进行像素级变形
 */

import sharp from 'sharp';
import { Point2D, ControlPointPair, DisplacementField } from './types';
import { MLSDeformation } from './mls-deformation';

export interface WarpImageParams {
    imageBase64: string;           // 输入图像 (Base64)
    sourceContour: Point2D[];      // 源轮廓点
    targetContour: Point2D[];      // 目标轮廓点
    intensity?: number;            // 变形强度 0-1
    gridSize?: number;             // 网格大小（影响质量和速度）
    backgroundColor?: string;      // 背景颜色 (hex)
}

export interface WarpImageResult {
    success: boolean;
    imageBase64?: string;          // 变形后的图像 (Base64)
    width?: number;
    height?: number;
    processingTime?: number;
    error?: string;
}

export class ImageWarper {
    private mlsDeformation: MLSDeformation;
    
    constructor() {
        this.mlsDeformation = new MLSDeformation();
    }
    
    /**
     * 对图像进行 MLS 变形
     */
    async warpImage(params: WarpImageParams): Promise<WarpImageResult> {
        console.log('[ImageWarper] 开始图像变形...');
        const startTime = performance.now();
        
        try {
            const {
                imageBase64,
                sourceContour,
                targetContour,
                intensity = 1.0,
                gridSize = 30,
                backgroundColor = '#00000000'
            } = params;
            
            // 1. 解码图像
            const inputBuffer = Buffer.from(imageBase64, 'base64');
            const image = sharp(inputBuffer);
            const metadata = await image.metadata();
            const width = metadata.width || 0;
            const height = metadata.height || 0;
            
            console.log(`[ImageWarper] 图像尺寸: ${width}x${height}`);
            
            if (width === 0 || height === 0) {
                return { success: false, error: '无效的图像尺寸' };
            }
            
            // 2. 获取像素数据
            const { data: pixelData, info } = await image
                .ensureAlpha()
                .raw()
                .toBuffer({ resolveWithObject: true });
            
            const channels = info.channels;
            console.log(`[ImageWarper] 通道数: ${channels}`);
            
            // 3. 生成控制点对
            const controlPairs = this.mlsDeformation.generateControlPairs(
                sourceContour,
                targetContour,
                Math.min(50, Math.max(sourceContour.length, targetContour.length))
            );
            
            console.log(`[ImageWarper] 控制点对: ${controlPairs.length}`);
            
            // 4. 应用强度调整
            const adjustedPairs = this.applyIntensity(controlPairs, intensity);
            
            // 5. 计算位移场
            const displacement = this.mlsDeformation.computeDisplacementField(
                width,
                height,
                adjustedPairs,
                gridSize
            );
            
            // 6. 应用位移场变形图像
            const warpedData = this.applyDisplacement(
                pixelData,
                width,
                height,
                channels,
                displacement,
                backgroundColor
            );
            
            // 7. 编码输出图像
            const outputBuffer = await sharp(warpedData, {
                raw: {
                    width,
                    height,
                    channels
                }
            }).png().toBuffer();
            
            const outputBase64 = outputBuffer.toString('base64');
            const processingTime = performance.now() - startTime;
            
            console.log(`[ImageWarper] ✅ 变形完成, 耗时 ${processingTime.toFixed(2)}ms`);
            
            return {
                success: true,
                imageBase64: outputBase64,
                width,
                height,
                processingTime
            };
            
        } catch (error: any) {
            console.error('[ImageWarper] 变形失败:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }
    
    /**
     * 应用强度到控制点对
     */
    private applyIntensity(pairs: ControlPointPair[], intensity: number): ControlPointPair[] {
        return pairs.map(pair => ({
            source: pair.source,
            target: {
                x: pair.source.x + (pair.target.x - pair.source.x) * intensity,
                y: pair.source.y + (pair.target.y - pair.source.y) * intensity
            },
            weight: pair.weight
        }));
    }
    
    /**
     * 应用位移场变形图像
     * 使用反向映射 + 双线性插值
     */
    private applyDisplacement(
        inputData: Buffer,
        width: number,
        height: number,
        channels: number,
        displacement: DisplacementField,
        backgroundColor: string
    ): Buffer {
        console.log('[ImageWarper] 应用位移场...');
        
        const outputData = Buffer.alloc(width * height * channels);
        const bgColor = this.parseColor(backgroundColor, channels);
        
        // 反向映射：对于输出图像的每个像素，找到它在输入图像中的源位置
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const idx = y * width + x;
                
                // 位移是正向的（从源到目标），反向映射需要取反
                const srcX = x - displacement.dx[idx];
                const srcY = y - displacement.dy[idx];
                
                // 双线性插值采样
                const outIdx = idx * channels;
                
                if (srcX >= 0 && srcX < width - 1 && srcY >= 0 && srcY < height - 1) {
                    const x0 = Math.floor(srcX);
                    const y0 = Math.floor(srcY);
                    const x1 = x0 + 1;
                    const y1 = y0 + 1;
                    const fx = srcX - x0;
                    const fy = srcY - y0;
                    
                    const idx00 = (y0 * width + x0) * channels;
                    const idx10 = (y0 * width + x1) * channels;
                    const idx01 = (y1 * width + x0) * channels;
                    const idx11 = (y1 * width + x1) * channels;
                    
                    for (let c = 0; c < channels; c++) {
                        const v00 = inputData[idx00 + c];
                        const v10 = inputData[idx10 + c];
                        const v01 = inputData[idx01 + c];
                        const v11 = inputData[idx11 + c];
                        
                        const value = 
                            (1 - fx) * (1 - fy) * v00 +
                            fx * (1 - fy) * v10 +
                            (1 - fx) * fy * v01 +
                            fx * fy * v11;
                        
                        outputData[outIdx + c] = Math.round(value);
                    }
                } else {
                    // 超出边界，使用背景色
                    for (let c = 0; c < channels; c++) {
                        outputData[outIdx + c] = bgColor[c] ?? 0;
                    }
                }
            }
        }
        
        return outputData;
    }
    
    /**
     * 解析颜色字符串
     */
    private parseColor(color: string, channels: number): number[] {
        if (color.startsWith('#')) {
            const hex = color.slice(1);
            if (hex.length === 8) {
                // RGBA
                return [
                    parseInt(hex.slice(0, 2), 16),
                    parseInt(hex.slice(2, 4), 16),
                    parseInt(hex.slice(4, 6), 16),
                    parseInt(hex.slice(6, 8), 16)
                ];
            } else if (hex.length === 6) {
                // RGB
                return [
                    parseInt(hex.slice(0, 2), 16),
                    parseInt(hex.slice(2, 4), 16),
                    parseInt(hex.slice(4, 6), 16),
                    255
                ];
            }
        }
        return [0, 0, 0, 0];  // 透明
    }
}

// 单例
let imageWarperInstance: ImageWarper | null = null;

export function getImageWarper(): ImageWarper {
    if (!imageWarperInstance) {
        imageWarperInstance = new ImageWarper();
    }
    return imageWarperInstance;
}
