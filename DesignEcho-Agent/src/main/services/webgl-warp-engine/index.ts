/**
 * WebGL 变形引擎
 * 
 * Agent 端图像变形解决方案
 * 使用 TPS (Thin Plate Spline) 算法实现平滑变形
 * 
 * 架构：
 * - TPSSolver: 计算 TPS 权重和变换
 * - ImageWarper: 应用变形到图像
 * 
 * 当前实现：CPU 端 (Sharp)
 * 后续可升级：WebGL GPU 加速
 */

// 类型导出
export {
    Point2D,
    ControlPointPair,
    WarpAlgorithm,
    WarpConfig,
    WarpRequest,
    WarpResult,
    TPSWeights,
    WarpMesh,
    DEFAULT_WARP_CONFIG
} from './types';

// 核心模块
export { TPSSolver } from './tps-solver';
export { ImageWarper } from './image-warper';

// 便捷函数
import { ImageWarper } from './image-warper';
import { WarpRequest, WarpResult, Point2D, ControlPointPair } from './types';

// 单例实例
let warperInstance: ImageWarper | null = null;

/**
 * 获取变形器实例
 */
export function getImageWarper(): ImageWarper {
    if (!warperInstance) {
        warperInstance = new ImageWarper();
    }
    return warperInstance;
}

/**
 * 快速变形函数
 * 
 * @param imageBase64 源图像 Base64
 * @param width 图像宽度
 * @param height 图像高度
 * @param sourcePoints 源控制点
 * @param targetPoints 目标控制点
 * @returns 变形结果
 */
export async function warpImage(
    imageBase64: string,
    width: number,
    height: number,
    sourcePoints: Point2D[],
    targetPoints: Point2D[]
): Promise<WarpResult> {
    if (sourcePoints.length !== targetPoints.length) {
        return {
            success: false,
            error: '源点和目标点数量必须相同'
        };
    }
    
    const controlPoints: ControlPointPair[] = sourcePoints.map((source, i) => ({
        source,
        target: targetPoints[i]
    }));
    
    const request: WarpRequest = {
        imageBase64,
        width,
        height,
        controlPoints
    };
    
    return getImageWarper().warp(request);
}

/**
 * 从轮廓生成变形
 * 
 * 根据源轮廓和目标轮廓自动生成控制点对
 */
export async function warpByContour(
    imageBase64: string,
    width: number,
    height: number,
    sourceContour: Point2D[],
    targetContour: Point2D[],
    numControlPoints: number = 20
): Promise<WarpResult> {
    // 对轮廓进行等距采样
    const sampleContour = (contour: Point2D[], n: number): Point2D[] => {
        if (contour.length <= n) return contour;
        
        const result: Point2D[] = [];
        const step = contour.length / n;
        
        for (let i = 0; i < n; i++) {
            const idx = Math.floor(i * step);
            result.push(contour[idx]);
        }
        
        return result;
    };
    
    const srcSampled = sampleContour(sourceContour, numControlPoints);
    const tgtSampled = sampleContour(targetContour, numControlPoints);
    
    // 确保两个采样后的轮廓点数相同
    const minLen = Math.min(srcSampled.length, tgtSampled.length);
    const srcPoints = srcSampled.slice(0, minLen);
    const tgtPoints = tgtSampled.slice(0, minLen);
    
    // 添加中心点作为额外控制点（保持中心稳定）
    const centerSrc: Point2D = {
        x: srcPoints.reduce((sum, p) => sum + p.x, 0) / srcPoints.length,
        y: srcPoints.reduce((sum, p) => sum + p.y, 0) / srcPoints.length
    };
    const centerTgt: Point2D = {
        x: tgtPoints.reduce((sum, p) => sum + p.x, 0) / tgtPoints.length,
        y: tgtPoints.reduce((sum, p) => sum + p.y, 0) / tgtPoints.length
    };
    
    srcPoints.push(centerSrc);
    tgtPoints.push(centerTgt);
    
    return warpImage(imageBase64, width, height, srcPoints, tgtPoints);
}

/**
 * 预热变形引擎
 * 在首次变形前调用，避免冷启动延迟
 */
export async function warmupEngine(): Promise<void> {
    console.log('[WebGLWarpEngine] 预热中...');
    
    // 创建一个小的测试图像进行预热
    const testSize = 32;
    const testPixels = Buffer.alloc(testSize * testSize * 4, 128);
    
    const sharp = require('sharp');
    const testImage = await sharp(testPixels, {
        raw: { width: testSize, height: testSize, channels: 4 }
    }).png().toBuffer();
    
    const testBase64 = testImage.toString('base64');
    
    // 执行一次小变形
    const testPoints: ControlPointPair[] = [
        { source: { x: 0, y: 0 }, target: { x: 0, y: 0 } },
        { source: { x: testSize, y: 0 }, target: { x: testSize, y: 0 } },
        { source: { x: 0, y: testSize }, target: { x: 0, y: testSize } },
        { source: { x: testSize, y: testSize }, target: { x: testSize, y: testSize } }
    ];
    
    await getImageWarper().warp({
        imageBase64: testBase64,
        width: testSize,
        height: testSize,
        controlPoints: testPoints
    });
    
    console.log('[WebGLWarpEngine] 预热完成');
}
