/**
 * Moving Least Squares (MLS) 变形算法
 * 
 * 参考论文: "Image Deformation Using Moving Least Squares" (Schaefer et al., 2006)
 * 实现刚性变形（Rigid），保持局部形状
 */

import { Point2D, ControlPointPair, DisplacementField } from './types';

export class MLSDeformation {
    private alpha: number = 2;  // 权重指数
    
    /**
     * 计算变形后的点位置
     */
    deformPoint(
        point: Point2D,
        controlPairs: ControlPointPair[]
    ): Point2D {
        const n = controlPairs.length;
        if (n === 0) return point;
        
        const p = controlPairs.map(cp => cp.source);
        const q = controlPairs.map(cp => cp.target);
        
        // 1. 计算权重
        const w: number[] = [];
        let wSum = 0;
        
        for (let i = 0; i < n; i++) {
            const dx = point.x - p[i].x;
            const dy = point.y - p[i].y;
            const distSq = dx * dx + dy * dy;
            
            if (distSq < 0.0001) {
                // 点在控制点上，直接返回目标位置
                return { x: q[i].x, y: q[i].y };
            }
            
            const weight = 1 / Math.pow(distSq, this.alpha / 2);
            w.push(weight);
            wSum += weight;
        }
        
        // 2. 计算加权质心
        let pStarX = 0, pStarY = 0;
        let qStarX = 0, qStarY = 0;
        
        for (let i = 0; i < n; i++) {
            pStarX += w[i] * p[i].x;
            pStarY += w[i] * p[i].y;
            qStarX += w[i] * q[i].x;
            qStarY += w[i] * q[i].y;
        }
        
        pStarX /= wSum;
        pStarY /= wSum;
        qStarX /= wSum;
        qStarY /= wSum;
        
        // 3. 计算相对位置
        const pHat: Point2D[] = p.map(pi => ({
            x: pi.x - pStarX,
            y: pi.y - pStarY
        }));
        
        const qHat: Point2D[] = q.map(qi => ({
            x: qi.x - qStarX,
            y: qi.y - qStarY
        }));
        
        // 4. 刚性变形计算
        const vMinusPStar = {
            x: point.x - pStarX,
            y: point.y - pStarY
        };
        
        let frX = 0, frY = 0;
        
        for (let i = 0; i < n; i++) {
            const pHatPerp = { x: -pHat[i].y, y: pHat[i].x };  // 垂直向量
            
            // 计算旋转分量
            const dotP = pHat[i].x * vMinusPStar.x + pHat[i].y * vMinusPStar.y;
            const dotPPerp = pHatPerp.x * vMinusPStar.x + pHatPerp.y * vMinusPStar.y;
            
            frX += w[i] * (qHat[i].x * dotP - qHat[i].y * dotPPerp);
            frY += w[i] * (qHat[i].y * dotP + qHat[i].x * dotPPerp);
        }
        
        // 归一化保持长度
        const lenV = Math.sqrt(vMinusPStar.x * vMinusPStar.x + vMinusPStar.y * vMinusPStar.y);
        const lenFr = Math.sqrt(frX * frX + frY * frY);
        
        if (lenFr > 0.0001 && lenV > 0.0001) {
            const scale = lenV / lenFr;
            frX *= scale;
            frY *= scale;
        }
        
        // 5. 最终位置
        return {
            x: frX + qStarX,
            y: frY + qStarY
        };
    }
    
    /**
     * 计算加权变形点位置
     */
    deformPointWeighted(
        point: Point2D,
        controlPairs: ControlPointPair[],
        weight: number
    ): Point2D {
        if (weight < 0.001) {
            return point;
        }
        
        const deformed = this.deformPoint(point, controlPairs);
        
        // 线性插值
        return {
            x: point.x + (deformed.x - point.x) * weight,
            y: point.y + (deformed.y - point.y) * weight
        };
    }
    
    /**
     * 使用网格加速计算位移场
     */
    computeDisplacementField(
        width: number,
        height: number,
        controlPairs: ControlPointPair[],
        gridSize: number = 50
    ): DisplacementField {
        console.log(`[MLS] 计算位移场 ${width}x${height}, 网格 ${gridSize}px`);
        const startTime = performance.now();
        
        // 计算网格尺寸
        const gridW = Math.ceil(width / gridSize) + 1;
        const gridH = Math.ceil(height / gridSize) + 1;
        
        // 在网格点上计算 MLS
        const gridDx = new Float32Array(gridW * gridH);
        const gridDy = new Float32Array(gridW * gridH);
        
        for (let gy = 0; gy < gridH; gy++) {
            for (let gx = 0; gx < gridW; gx++) {
                const x = Math.min(gx * gridSize, width - 1);
                const y = Math.min(gy * gridSize, height - 1);
                
                const deformed = this.deformPoint({ x, y }, controlPairs);
                
                const idx = gy * gridW + gx;
                gridDx[idx] = deformed.x - x;
                gridDy[idx] = deformed.y - y;
            }
        }
        
        // 双线性插值生成完整位移场
        const dx = new Float32Array(width * height);
        const dy = new Float32Array(width * height);
        
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const gx = x / gridSize;
                const gy = y / gridSize;
                
                const gx0 = Math.floor(gx);
                const gy0 = Math.floor(gy);
                const gx1 = Math.min(gx0 + 1, gridW - 1);
                const gy1 = Math.min(gy0 + 1, gridH - 1);
                
                const fx = gx - gx0;
                const fy = gy - gy0;
                
                // 双线性插值
                const idx00 = gy0 * gridW + gx0;
                const idx10 = gy0 * gridW + gx1;
                const idx01 = gy1 * gridW + gx0;
                const idx11 = gy1 * gridW + gx1;
                
                const idx = y * width + x;
                
                dx[idx] = (1 - fx) * (1 - fy) * gridDx[idx00] +
                          fx * (1 - fy) * gridDx[idx10] +
                          (1 - fx) * fy * gridDx[idx01] +
                          fx * fy * gridDx[idx11];
                
                dy[idx] = (1 - fx) * (1 - fy) * gridDy[idx00] +
                          fx * (1 - fy) * gridDy[idx10] +
                          (1 - fx) * fy * gridDy[idx01] +
                          fx * fy * gridDy[idx11];
            }
        }
        
        const duration = performance.now() - startTime;
        console.log(`[MLS] ✅ 位移场计算完成, 网格点 ${gridW * gridH}, 耗时 ${duration.toFixed(2)}ms`);
        
        return { width, height, dx, dy };
    }
    
    /**
     * 应用加权位移场
     */
    applyWeightedDisplacement(
        displacement: DisplacementField,
        weights: Float32Array
    ): DisplacementField {
        const { width, height, dx, dy } = displacement;
        const weightedDx = new Float32Array(width * height);
        const weightedDy = new Float32Array(width * height);
        
        for (let i = 0; i < weights.length; i++) {
            weightedDx[i] = dx[i] * weights[i];
            weightedDy[i] = dy[i] * weights[i];
        }
        
        return {
            width,
            height,
            dx: weightedDx,
            dy: weightedDy
        };
    }
    
    /**
     * 从轮廓生成控制点对
     */
    generateControlPairs(
        sourceContour: Point2D[],
        targetContour: Point2D[],
        sampleCount: number = 50
    ): ControlPointPair[] {
        console.log(`[MLS] 生成控制点对, 源 ${sourceContour.length} 点, 目标 ${targetContour.length} 点`);
        
        // 均匀采样源轮廓
        const sourceSampled = this.uniformSample(sourceContour, sampleCount);
        
        // 为每个源点找到对应的目标点
        const pairs: ControlPointPair[] = [];
        
        for (const srcPoint of sourceSampled) {
            // 使用归一化弧长匹配
            const targetPoint = this.findCorrespondingPoint(srcPoint, sourceContour, targetContour);
            
            pairs.push({
                source: srcPoint,
                target: targetPoint,
                weight: 1
            });
        }
        
        console.log(`[MLS] 生成 ${pairs.length} 个控制点对`);
        return pairs;
    }
    
    /**
     * 均匀采样轮廓点
     */
    private uniformSample(contour: Point2D[], count: number): Point2D[] {
        if (contour.length <= count) return [...contour];
        
        const step = contour.length / count;
        const sampled: Point2D[] = [];
        
        for (let i = 0; i < count; i++) {
            const idx = Math.floor(i * step);
            sampled.push(contour[idx]);
        }
        
        return sampled;
    }
    
    /**
     * 使用弧长参数化找到对应点
     */
    private findCorrespondingPoint(
        point: Point2D,
        sourceContour: Point2D[],
        targetContour: Point2D[]
    ): Point2D {
        // 找到源点在轮廓上的位置（归一化参数 0-1）
        const sourceParam = this.findPointParameter(point, sourceContour);
        
        // 在目标轮廓上使用相同的参数位置
        return this.getPointAtParameter(targetContour, sourceParam);
    }
    
    /**
     * 找到点在轮廓上的归一化参数
     */
    private findPointParameter(point: Point2D, contour: Point2D[]): number {
        let minDist = Infinity;
        let closestIdx = 0;
        
        for (let i = 0; i < contour.length; i++) {
            const dx = point.x - contour[i].x;
            const dy = point.y - contour[i].y;
            const dist = dx * dx + dy * dy;
            
            if (dist < minDist) {
                minDist = dist;
                closestIdx = i;
            }
        }
        
        return closestIdx / contour.length;
    }
    
    /**
     * 根据参数获取轮廓上的点
     */
    private getPointAtParameter(contour: Point2D[], param: number): Point2D {
        const idx = Math.min(Math.floor(param * contour.length), contour.length - 1);
        return contour[idx];
    }
}
