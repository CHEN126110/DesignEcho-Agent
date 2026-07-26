/**
 * 距离场计算器
 * 
 * 使用 Meijster EDT 算法计算欧几里得距离场
 * 时间复杂度: O(n)，空间复杂度: O(n)
 */

import { Point2D, BoundingBox } from './types';

export class DistanceFieldCalculator {
    private width: number = 0;
    private height: number = 0;
    
    /**
     * 从轮廓点计算距离场
     */
    computeFromContour(
        width: number,
        height: number,
        contour: Point2D[]
    ): Float32Array {
        console.log(`[DistanceField] 计算距离场 ${width}x${height}, ${contour.length} 个轮廓点`);
        const startTime = performance.now();
        
        this.width = width;
        this.height = height;
        
        // 1. 创建二值蒙版（轮廓内=1，外=0）
        const mask = this.createMaskFromContour(contour);
        
        // 2. 找到边缘像素
        const edgeMask = this.findEdgePixels(mask);
        
        // 3. 计算距离场
        const distanceField = this.computeEDT(edgeMask);
        
        const duration = performance.now() - startTime;
        console.log(`[DistanceField] ✅ 完成, 耗时 ${duration.toFixed(2)}ms`);
        
        return distanceField;
    }
    
    /**
     * 从二值蒙版计算距离场
     */
    computeFromMask(mask: Uint8Array, width: number, height: number): Float32Array {
        console.log(`[DistanceField] 从蒙版计算距离场 ${width}x${height}`);
        const startTime = performance.now();
        
        this.width = width;
        this.height = height;
        
        // 找到边缘像素
        const edgeMask = this.findEdgePixels(mask);
        
        // 计算距离场
        const distanceField = this.computeEDT(edgeMask);
        
        const duration = performance.now() - startTime;
        console.log(`[DistanceField] ✅ 完成, 耗时 ${duration.toFixed(2)}ms`);
        
        return distanceField;
    }
    
    /**
     * 从轮廓创建二值蒙版
     */
    private createMaskFromContour(contour: Point2D[]): Uint8Array {
        const mask = new Uint8Array(this.width * this.height);
        
        if (contour.length < 3) return mask;
        
        // 使用扫描线填充算法
        // 简化版：对每个像素判断是否在多边形内
        for (let y = 0; y < this.height; y++) {
            for (let x = 0; x < this.width; x++) {
                if (this.isPointInPolygon(x, y, contour)) {
                    mask[y * this.width + x] = 255;
                }
            }
        }
        
        return mask;
    }
    
    /**
     * 判断点是否在多边形内（射线法）
     */
    private isPointInPolygon(x: number, y: number, polygon: Point2D[]): boolean {
        let inside = false;
        const n = polygon.length;
        
        for (let i = 0, j = n - 1; i < n; j = i++) {
            const xi = polygon[i].x, yi = polygon[i].y;
            const xj = polygon[j].x, yj = polygon[j].y;
            
            if (((yi > y) !== (yj > y)) &&
                (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) {
                inside = !inside;
            }
        }
        
        return inside;
    }
    
    /**
     * 找到边缘像素
     */
    private findEdgePixels(mask: Uint8Array): Uint8Array {
        const edgeMask = new Uint8Array(this.width * this.height);
        
        for (let y = 0; y < this.height; y++) {
            for (let x = 0; x < this.width; x++) {
                const idx = y * this.width + x;
                const val = mask[idx];
                
                // 检查 4 邻域
                const isEdge = this.isEdgePixel(mask, x, y, val);
                edgeMask[idx] = isEdge ? 255 : 0;
            }
        }
        
        return edgeMask;
    }
    
    /**
     * 检查是否是边缘像素
     */
    private isEdgePixel(mask: Uint8Array, x: number, y: number, val: number): boolean {
        // 检查 4 邻域是否有不同值
        const neighbors = [
            [x - 1, y], [x + 1, y],
            [x, y - 1], [x, y + 1]
        ];
        
        for (const [nx, ny] of neighbors) {
            if (nx < 0 || nx >= this.width || ny < 0 || ny >= this.height) {
                if (val > 0) return true;  // 边界
                continue;
            }
            
            const nVal = mask[ny * this.width + nx];
            if ((val > 0) !== (nVal > 0)) {
                return true;
            }
        }
        
        return false;
    }
    
    /**
     * Meijster EDT 算法
     * 计算每个像素到最近边缘的欧几里得距离
     */
    private computeEDT(edgeMask: Uint8Array): Float32Array {
        const INF = this.width + this.height;
        const dt = new Float32Array(this.width * this.height);
        
        // 初始化：边缘=0，其他=INF
        for (let i = 0; i < edgeMask.length; i++) {
            dt[i] = edgeMask[i] > 0 ? 0 : INF;
        }
        
        // 分配临时数组
        const maxDim = Math.max(this.width, this.height);
        const f = new Float32Array(maxDim);
        const v = new Int32Array(maxDim);
        const z = new Float32Array(maxDim + 1);
        
        // 第一遍：水平方向
        for (let y = 0; y < this.height; y++) {
            this.edt1D(dt, y * this.width, 1, this.width, f, v, z);
        }
        
        // 第二遍：垂直方向
        for (let x = 0; x < this.width; x++) {
            this.edt1D(dt, x, this.width, this.height, f, v, z);
        }
        
        // 开平方得到真实距离
        for (let i = 0; i < dt.length; i++) {
            dt[i] = Math.sqrt(dt[i]);
        }
        
        return dt;
    }
    
    /**
     * 一维距离变换（Meijster 算法核心）
     */
    private edt1D(
        dt: Float32Array,
        offset: number,
        stride: number,
        length: number,
        f: Float32Array,
        v: Int32Array,
        z: Float32Array
    ): void {
        // 复制到工作数组
        for (let q = 0; q < length; q++) {
            f[q] = dt[offset + q * stride];
        }
        
        // 计算下包络
        let k = 0;
        v[0] = 0;
        z[0] = -Infinity;
        z[1] = Infinity;
        
        for (let q = 1; q < length; q++) {
            let s: number;
            while (true) {
                const r = v[k];
                s = ((f[q] + q * q) - (f[r] + r * r)) / (2 * q - 2 * r);
                if (s > z[k]) break;
                k--;
                if (k < 0) {
                    k = 0;
                    break;
                }
            }
            
            k++;
            v[k] = q;
            z[k] = s;
            z[k + 1] = Infinity;
        }
        
        // 填充距离值
        k = 0;
        for (let q = 0; q < length; q++) {
            while (z[k + 1] < q) k++;
            const dx = q - v[k];
            dt[offset + q * stride] = dx * dx + f[v[k]];
        }
    }
    
    /**
     * 生成变形权重图
     */
    generateWeightMap(
        distanceField: Float32Array,
        edgeBandWidth: number,
        transitionWidth: number
    ): Float32Array {
        const weights = new Float32Array(distanceField.length);
        
        for (let i = 0; i < distanceField.length; i++) {
            const dist = distanceField[i];
            
            if (dist > edgeBandWidth + transitionWidth) {
                // 内部区域：不变形
                weights[i] = 0;
            } else if (dist <= edgeBandWidth) {
                // 边缘区域：完全变形
                weights[i] = 1;
            } else {
                // 过渡区：平滑渐变
                const t = (dist - edgeBandWidth) / transitionWidth;
                weights[i] = 1 - this.smootherstep(t);
            }
        }
        
        return weights;
    }
    
    /**
     * Perlin 改进的平滑插值函数
     */
    private smootherstep(t: number): number {
        t = Math.max(0, Math.min(1, t));
        return t * t * t * (t * (t * 6 - 15) + 10);
    }
}
